// =====================================================
// Cloudflare Worker — Help me, Doctor 👩‍⚕️
// Telegram-бот + веб-приложение (/app) на общих данных (Durable Objects)
// =====================================================
import { vapidKeys } from "./lib/webpush.js";
import { PACKS, PLANS, TRIAL, adminIds, productLabel } from "./config.js";
import { bearer, createSession, loginLinks, newLoginCode, randomToken, readSignedData, signData, verifyInitData, verifySession } from "./lib/auth.js";
import { authorizeUrl, enabledProviders, fetchIdentity, isTelegramUid, newWebUid, PROVIDERS, redirectUri } from "./lib/oauth.js";
import { arrayBufferToBase64, esc, json, userError } from "./lib/util.js";
import { createPayment, createSubscription, webhookOperationId } from "./lib/tochka.js";
import { confirmPayment } from "./lib/payments.js";
import { handleUpdate, hubStub, startInBot, userStub } from "./bot/handlers.js";
import { adminApi } from "./admin-api.js";
import { faceSvg } from "./lib/face.js";

export { UserDO } from "./do/user.js";
export { HubDO } from "./do/hub.js";

const MAX_VOICE_BYTES = 6 * 1024 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    // www.helpmedoctor.ru → helpmedoctor.ru (один адрес для входа и сохранённой сессии)
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    try {
      // ---- Telegram webhook (старый адрес "/" тоже принимаем) ----
      if (request.method === "POST" && (path === "/tg/webhook" || path === "/")) {
        return telegramWebhook(request, env, ctx);
      }
      if (request.method === "POST" && path === "/payment-callback") {
        return paymentCallback(request, env);
      }
      if (path.startsWith("/api/admin/")) return adminApi(request, env, url, ctx);
      if (path.startsWith("/api/")) return api(request, env, url);
      // Админка — отдельное одностраничное приложение в public/admin
      if (path === "/admin" || path === "/admin/") {
        return env.ASSETS.fetch(new Request(`${url.origin}/admin/`, request));
      }

      // Старые ссылки мини-приложения ведут в новое.
      // Адрес относительный: за прокси (helpmedoctor.ru → workers.dev) хост у воркера другой
      if (path.startsWith("/mini-app")) {
        return new Response(null, { status: 301, headers: { Location: "/app" } });
      }
      const canonicalHost = isCanonicalHost(request);
      if (path === "/robots.txt") return robotsTxt(canonicalHost);
      let res = await env.ASSETS.fetch(request);
      // Код приложения с версией в адресе (?v=хеш, ставит scripts/build-app.mjs) не меняется — браузер хранит его год
      // и при повторном открытии не скачивает; после деплоя app.html ссылается на новую версию
      if ((path === "/app.js" || path === "/app.css") && url.searchParams.has("v") && res.ok) {
        res = new Response(res.body, res);
        res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      }
      // Запасной адрес *.workers.dev не должен попадать в поиск — только helpmedoctor.ru
      if (canonicalHost) return res;
      const out = new Response(res.body, res);
      out.headers.set("X-Robots-Tag", "noindex");
      return out;
    } catch (e) {
      console.error("fetch error", path, e);
      return json({ error: "Внутренняя ошибка" }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // 07:00 UTC = 10:00 МСК — утреннее напоминание; 17:00 UTC = 20:00 МСК — «стрик сгорит»; 18:00 UTC = 21:00 МСК — итоги дня админам
    if (event.cron === "0 18 * * *") return ctx.waitUntil(hubStub(env).dailySummary());
    const kind = event.cron === "0 17 * * *" ? "evening" : "morning";
    ctx.waitUntil(hubStub(env).startCron(kind));
    // Автопродления: 10:00 и 20:00 МСК (неудачное списание повторится на следующий день)
    ctx.waitUntil(hubStub(env).chargeDueSubs().catch((e) => console.error("chargeDueSubs", e)));
  },
};

// ---------------------------------------------------
// Telegram
// ---------------------------------------------------
async function telegramWebhook(request, env, ctx) {
  if (env.WEBHOOK_SECRET && request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("OK");
  }
  // Отвечаем Telegram сразу; тяжёлые задачи (генерация пациента, разбор) идут через alarm в UserDO
  ctx.waitUntil(handleUpdate(env, update));
  return new Response("OK");
}

// ---------------------------------------------------
// Точка Банк
// ---------------------------------------------------
async function paymentCallback(request, env) {
  const raw = await request.text();
  const op = webhookOperationId(raw);
  if (!op) return new Response("bad payload", { status: 400 });
  try {
    await confirmPayment(env, hubStub(env), op);
  } catch (e) {
    console.error("tochka status", e);
    return new Response("retry", { status: 503 });
  }
  return new Response("OK");
}

// ---------------------------------------------------
// API веб-приложения
// ---------------------------------------------------
async function api(request, env, url) {
  const path = url.pathname.slice(4); // без "/api"
  const method = request.method;

  // --- Авторизация ---
  if (path === "/auth/telegram" && method === "POST") {
    const { initData } = await readJson(request);
    const tgUser = await verifyInitData(env, initData);
    if (!tgUser) return json({ error: "Не удалось проверить вход через Telegram" }, 401);
    await userStub(env, tgUser.id, "miniapp").init(tgUser.id, tgUser);
    return json({ token: await createSession(env, tgUser.id) });
  }
  if (path === "/auth/login" && method === "POST") {
    const code = newLoginCode();
    const { from = "" } = await readJson(request);
    await hubStub(env).createLogin(code, { ref: String(from).replace(/[^\w-]/g, "").slice(0, 40) });
    return json({ code, ...loginLinks(env, code) });
  }
  if (path === "/auth/poll" && method === "GET") {
    const code = url.searchParams.get("code") || "";
    // cn — nonce браузера, начавшего вход через Google/Яндекс (без него такой код не забрать)
    const res = await hubStub(env).pollLogin(code, { owner: url.searchParams.get("cn") || null });
    if (res.status !== "ok") return json({ status: res.status });
    await userStub(env, res.uid).init(res.uid);
    return json({ status: "ok", token: await createSession(env, res.uid) });
  }
  // Лицо пациента (DiceBear Open Peeps): детерминировано параметрами, поэтому кэшируется навсегда
  if (path === "/face" && method === "GET") {
    const q = url.searchParams;
    const params = { s: q.get("s") || "", g: q.get("g") === "f" ? "f" : "m", a: Math.max(0, Math.min(120, Number(q.get("a")) || 0)), m: ["good", "bad", "odd", "sad"].includes(q.get("m")) ? q.get("m") : "", clean: q.get("c") === "1" };
    const cacheKey = new Request(`https://face.cache/${params.s}/${params.g}/${params.a}/${params.m}/${params.clean ? "c" : ""}/v3`);
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const hit = cache && (await cache.match(cacheKey));
    if (hit) return hit;
    const res = new Response(faceSvg(params), { headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" } });
    if (cache) await cache.put(cacheKey, res.clone()).catch(() => {});
    return res;
  }
  // Аватар по случайному id (без авторизации: <img> не умеет заголовки; id не угадать)
  let am = path.match(/^\/avatar\/([a-f0-9]{32})$/);
  if (am && method === "GET") {
    const { value, metadata } = await env.HELPMEDOCTOR.getWithMetadata(`avatar:${am[1]}`, "arrayBuffer");
    if (!value) return new Response("not found", { status: 404 });
    return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (path === "/config" && method === "GET") {
    return json({ bot_username: env.BOT_USERNAME, providers: enabledProviders(env) });
  }
  // Живые цифры для сайта (без личных данных), кэш 10 минут
  if (path === "/public-stats" && method === "GET") {
    const cache = typeof caches !== "undefined" ? caches.default : null;
    const key = new Request("https://stats.cache/public/v1");
    const hit = cache && (await cache.match(key));
    if (hit) return hit;
    const res = json(await hubStub(env).publicStats(), 200, { "Cache-Control": "public, max-age=600" });
    if (cache) await cache.put(key, res.clone()).catch(() => {});
    return res;
  }

  // --- Вход через Google / Яндекс ---
  let om = path.match(/^\/auth\/oauth\/(\w+)\/callback$/);
  if (om && method === "GET" && PROVIDERS[om[1]]) return oauthCallback(request, env, url, om[1]);
  if (path === "/auth/oauth/start" && method === "POST") {
    const { provider, mode = "login", from = "", cn = "" } = await readJson(request);
    if (!enabledProviders(env).includes(provider)) return json({ error: "Этот способ входа сейчас недоступен" }, 400);
    let owner = null;
    if (mode === "link") {
      owner = await sessionUid(env, bearer(request));
      if (!owner) return json({ error: "Нужно войти", code: "auth" }, 401);
    }
    const nonce = randomToken(16);
    // mode "admin" — вход в админку: только существующий аккаунт, привязанный к Telegram админа (см. oauthCallback)
    const state = await signData(env, { p: provider, m: mode === "link" ? "link" : mode === "admin" ? "admin" : "login", u: owner, n: nonce, c: String(cn).replace(/[^\w-]/g, "").slice(0, 40), r: String(from).replace(/[^\w-]/g, "").slice(0, 40), exp: Date.now() + 10 * 60000 });
    const secure = siteOrigin(request, env).startsWith("https:") ? "; Secure" : "";
    return json({ url: authorizeUrl(env, provider, state, redirectUri(provider, siteOrigin(request, env))) }, 200, {
      "Set-Cookie": `${OAUTH_COOKIE}=${nonce}; Path=/api/auth/oauth/; Max-Age=600; HttpOnly; SameSite=Lax${secure}`,
    });
  }

  // --- WebSocket синхронизации (токен в query: браузер не умеет заголовки для WS) ---
  if (path === "/ws") {
    const uid = await sessionUid(env, url.searchParams.get("token"));
    if (!uid) return new Response("unauthorized", { status: 401 });
    return userStub(env, uid).fetch(request);
  }

  const uid = await sessionUid(env, bearer(request));
  if (!uid) return json({ error: "Нужно войти", code: "auth" }, 401);
  // Мини-приложение в Telegram или сайт в браузере — для аналитики каналов
  const source = request.headers.get("X-Client") === "miniapp" ? "miniapp" : "web";
  const user = userStub(env, uid, source);

  try {
    if (path === "/me" && method === "GET") {
      await user.init(uid);
      const snap = await user.snapshot();
      // ?lite=1 — приложение уже получило справочники (config) при первой загрузке: не шлём их повторно
      if (url.searchParams.get("lite") === "1") delete snap.config;
      return json({ ...snap, bot_username: env.BOT_USERNAME });
    }
    if (path === "/profile" && method === "PATCH") {
      return json({ profile: await user.updateProfile(await readJson(request)) });
    }
    // --- Партнёрская программа ---
    if (path === "/partner" && method === "GET") {
      const info = await hubStub(env).partnerInfo(uid);
      const base = (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
      return json({ ...info, links: { site: `${base}/?ref=r_${info.code}`, app: `${base}/app?ref=r_${info.code}`, bot: `https://t.me/${env.BOT_USERNAME}?start=r_${info.code}` } });
    }
    if (path === "/partner/apply" && method === "POST") {
      const b = await readJson(request);
      if (!b.agree) return json({ error: "Нужно принять партнёрское соглашение", code: "agree" }, 400);
      const info = Object.fromEntries(["university", "course", "city", "channels", "links", "about"].map((k) => [k, String(b[k] || "").trim().slice(0, 500)]));
      if (!info.channels) return json({ error: "Расскажите, где будете рассказывать о тренажёре", code: "channels" }, 400);
      return json(await hubStub(env).partnerApply(uid, info));
    }
    if (path === "/partner/payout" && method === "POST") {
      const b = await readJson(request);
      const details = payoutDetails(b);
      if (details.error) return json({ error: details.error, code: "details" }, 400);
      const res = await hubStub(env).payoutRequest(uid, { method: details.method, details: details.data });
      return json(res, res.error ? 409 : 200);
    }

    // --- Уведомления в браузере (Web Push) ---
    if (path === "/push/key" && method === "GET") return json({ key: (await vapidKeys(env)).publicKey });
    if (path === "/push/subscribe" && method === "POST") {
      const body = await readJson(request);
      return json(await user.pushSubscribe(body.subscription, request.headers.get("User-Agent") || ""));
    }
    if (path === "/push/unsubscribe" && method === "POST") return json(await user.pushUnsubscribe(String((await readJson(request)).endpoint || "")));
    if (path === "/push/test" && method === "POST") {
      return json({ ok: await user.pushNotify({ title: "🔔 Уведомления включены", body: "Сюда придут напоминания о серии и новости о пациентах.", url: "/app#/profile/app", tag: "test" }) });
    }
    // Мини-приложение → сайт в браузере: одноразовый код входа, уже подтверждённый этим пользователем
    if (path === "/auth/handoff" && method === "POST") {
      const code = newLoginCode();
      await hubStub(env).createLogin(code);
      await hubStub(env).confirmLogin(code, uid);
      const base = (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
      return json({ url: `${base}/app?login=${encodeURIComponent(code)}` });
    }
    // --- Способы входа: Telegram, Google, Яндекс ---
    if (path === "/accounts" && method === "GET") return json(await accountsInfo(env, uid));
    let lm = path.match(/^\/accounts\/(\w+)$/);
    if (lm && method === "DELETE" && PROVIDERS[lm[1]]) {
      const r = await hubStub(env).identityUnlink(uid, lm[1], { hasTelegram: isTelegramUid(uid) });
      if (r.error) return json({ error: "Это единственный способ входа — сначала привяжите другой" }, 409);
      return json(await accountsInfo(env, uid));
    }
    if (path === "/auth/link-telegram" && method === "POST") {
      if (isTelegramUid(uid)) return json({ error: "Telegram уже привязан" }, 409);
      const code = newLoginCode();
      await hubStub(env).createLogin(code, { purpose: "link", owner: uid });
      return json({ code, ...loginLinks(env, code, "link") });
    }
    if (path === "/auth/link-telegram/poll" && method === "GET") {
      const code = url.searchParams.get("code") || "";
      // Код удаляем только после успешной склейки: если склейка отложилась (busy), следующий опрос повторит её
      const res = await hubStub(env).pollLogin(code, { owner: uid, link: true, keep: true });
      if (res.status !== "ok") return json({ status: res.status });
      const check = await hubStub(env).mergeCheck(uid, res.uid);
      if (check.error) {
        await hubStub(env).deleteLogin(code);
        return json({ error: "У этого Telegram и у аккаунта сайта обе подписки с автопродлением. Отключите одну из них в «Подписке» и привяжите снова.", code: "two_autopays" }, 409);
      }
      await mergeAccounts(env, uid, res.uid);
      await hubStub(env).deleteLogin(code);
      return json({ status: "ok", token: await createSession(env, res.uid) });
    }
    if (path === "/avatar" && method === "POST") {
      const buf = await request.arrayBuffer();
      return json(await user.setAvatar(buf, (request.headers.get("Content-Type") || "").split(";")[0]));
    }
    if (path === "/avatar/telegram" && method === "POST") return json(await user.avatarFromTelegram());
    if (path === "/student" && method === "POST") {
      const buf = await request.arrayBuffer();
      return json(await user.submitStudentCard(buf, (request.headers.get("Content-Type") || "").split(";")[0]));
    }
    if (path === "/avatar" && method === "DELETE") return json(await user.removeAvatar());
    if (path === "/autopay/cancel" && method === "POST") return json({ profile: await user.cancelAutopay() });
    if (path === "/feedback" && method === "POST") {
      return json(await user.saveFeedback(await readJson(request), "web"));
    }
    if (path === "/sections/suggest" && method === "POST") {
      return json({ sections: await user.suggestSections((await readJson(request)).profession) });
    }
    if (path === "/patients/new" && method === "POST") {
      return json(await user.requestNewPatient("web"));
    }
    if (path === "/attribution" && method === "POST") {
      return json(await user.setAttribution(await readJson(request)));
    }
    if (path === "/event" && method === "POST") {
      // Клиентские события: открыл приложение, открыл тарифы
      const { type, meta } = await readJson(request);
      if (!["app_open", "plans_open"].includes(type)) return json({ error: "Неизвестное событие" }, 400);
      return json(await user.trackEvent(type, typeof meta === "object" && meta ? meta : {}));
    }
    if (path === "/pay" && method === "POST") {
      const { plan, consent } = await readJson(request);
      if (!(plan === TRIAL.key || PACKS[plan] || (PLANS[plan] && !PLANS[plan].hidden))) return json({ error: "Неизвестный тариф" }, 400);
      // Согласие с офертой и на автосписания — обязательное условие оплаты; фиксируем его в истории пользователя
      if (!consent) return json({ error: "Отметьте согласие с условиями оплаты", code: "consent" }, 400);
      await user.trackEvent("consent", { plan, offer: "/oferta/", privacy: "/privacy/", recurring: plan === TRIAL.key || !!PLANS[plan]?.recurring });
      // Пробный период — один раз; вторую подписку с автопродлением не оформляем. Цена — на момент покупки.
      const { price } = await user.checkPurchase(plan);
      await user.trackEvent("pay_click", { plan });
      let payment;
      try {
        payment = plan === TRIAL.key || PLANS[plan]?.recurring
          ? await createSubscription(env, uid, plan, price)
          : await createPayment(env, uid, plan, price);
      } catch (e) {
        console.error("tochka create", e);
        await hubStub(env).paymentError(uid, plan, e.message);
        await user.trackEvent("pay_error", { plan, error: String(e.message).slice(0, 300) });
        await hubStub(env).notifyAdmin(`⚠️ Оплата не создана (uid ${uid}, тариф ${productLabel(plan)})\n${esc(e.message).slice(0, 700)}`, "payment_error");
        return json({ error: "Платёжная система сейчас не отвечает. Мы уже разбираемся — попробуйте чуть позже.", code: "payment" }, 502);
      }
      if (payment.operationId) await hubStub(env).savePayment(payment.operationId, uid, plan, price);
      await user.trackEvent("pay_link", { plan, op: payment.operationId });
      return json({ link: payment.link });
    }
    if (path === "/pay/check" && method === "POST") {
      // Приложение спрашивает сразу после возврата с оплаты, не дожидаясь вебхука банка
      const hub = hubStub(env);
      let activated = null;
      let pending = 0;
      for (const op of await hub.pendingPayments(uid)) {
        const r = await confirmPayment(env, hub, op).catch((e) => (console.error("pay check", op, e), { status: "pending" }));
        if (r.activated) activated = r.plan;
        else if (r.status === "pending") pending++;
      }
      return json({ activated, pending });
    }

    let m = path.match(/^\/patients\/([\w-]+)(?:\/(\w+))?$/);
    if (m) {
      const [, id, action] = m;
      if (!action && method === "GET") return json(await user.patientView(id));
      if (!action && method === "DELETE") return json(await user.deletePatient(id));
      if (method !== "POST") return json({ error: "Метод не поддерживается" }, 405);
      if (action === "start") {
        // Из мини-приложения Telegram приём идёт в чате с ботом
        if (url.searchParams.get("in_bot") === "1") return json(await startInBot(env, uid, id));
        return json(await user.startConsultation(id));
      }
      if (action === "reject") return json(await user.rejectPatient(id));
      if (action === "reopen") return json(await user.reopenPatient(id));
      if (action === "message") return json(await user.doctorMessage(id, (await readJson(request)).text));
      if (action === "test") return json(await user.orderTest(id, (await readJson(request)).name));
      if (action === "exam") return json(await user.physicalExam(id, (await readJson(request)).action));
      if (action === "hint") return json(await user.requestHint(id));
      if (action === "guide") return json(await user.requestGuide(id));
      if (action === "finish") return json(await user.finishConsultation(id, await readJson(request), "web"));
      if (action === "voice") {
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) return json({ error: "Пустая запись" }, 400);
        if (buf.byteLength > MAX_VOICE_BYTES) return json({ error: "Запись слишком длинная — до 3 минут" }, 413);
        return json(await user.voiceMessage(id, arrayBufferToBase64(buf)));
      }
    }

    m = path.match(/^\/quiz\/([\w-]+)(?:\/(answer))?$/);
    if (m) {
      const [, patId, action] = m;
      if (!action && method === "GET") return json({ quiz: await user.quiz(patId) });
      if (!action && method === "DELETE") return json(await user.deleteQuiz(patId));
      if (action === "answer" && method === "POST") {
        const { index, chosen } = await readJson(request);
        return json(await user.answerQuiz(patId, Number(index), Number(chosen)));
      }
    }
    return json({ error: "Не найдено" }, 404);
  } catch (e) {
    const ue = userError(e);
    if (ue) return json({ error: ue.message, code: ue.code }, 409);
    console.error("api error", path, e);
    return json({ error: "Что-то пошло не так. Попробуйте ещё раз." }, 500);
  }
}

// ---------------------------------------------------
// Сессии и способы входа
// ---------------------------------------------------
const OAUTH_COOKIE = "hmd_oa";
// Веб-аккаунт, склеенный с Telegram: старые токены ведут в новый uid (кэш на время жизни изолята)
const aliasCache = new Map();

async function sessionUid(env, token) {
  const uid = await verifySession(env, token);
  if (!uid || isTelegramUid(uid)) return uid;
  const hit = aliasCache.get(uid);
  if (hit && hit.exp > Date.now()) return hit.to || uid;
  const to = await hubStub(env).aliasGet(uid);
  aliasCache.set(uid, { to, exp: Date.now() + (to ? 3600000 : 5000) });
  if (aliasCache.size > 5000) aliasCache.clear();
  return to || uid;
}

async function accountsInfo(env, uid) {
  const identities = await hubStub(env).identitiesOf(uid);
  return {
    telegram: isTelegramUid(uid),
    identities: identities.map((i) => ({ provider: i.provider, label: PROVIDERS[i.provider]?.label || i.provider, email: i.email, name: i.name, linked_at: i.created_at })),
    providers: enabledProviders(env),
  };
}

/** Веб-аккаунт from → Telegram-аккаунт to: данные, подписка, способы входа; from очищается */
async function mergeAccounts(env, from, to) {
  if (String(from) === String(to)) return;
  const src = userStub(env, from, "web");
  const dump = await src.exportData();
  await userStub(env, to, "web").absorb(dump, to);
  await hubStub(env).mergeUsers(from, to);
  aliasCache.set(String(from), { to: String(to), exp: Date.now() + 3600000 });
  await src.wipe(to);
}

/** Адрес сайта для пользователя: helpmedoctor.ru приходит через прокси, у воркера в этом случае другой хост */
function siteOrigin(request, env) {
  return isCanonicalHost(request) && env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/$/, "") : new URL(request.url).origin;
}

function readCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

/** Возврат от Google / Яндекса. Итог — редирект в приложение: ?login=<одноразовый код> или ?auth_error=… */
async function oauthCallback(request, env, url, provider) {
  const back = (query, hash = "") => new Response(null, {
    status: 302,
    headers: { Location: `/app?${query}${hash}`, "Cache-Control": "no-store", "Set-Cookie": `${OAUTH_COOKIE}=; Path=/api/auth/oauth/; Max-Age=0; HttpOnly; SameSite=Lax` },
  });
  const st = await readSignedData(env, url.searchParams.get("state"));
  const nonce = readCookie(request, OAUTH_COOKIE);
  if (url.searchParams.get("error")) return back("auth_error=cancel");
  if (!st || st.p !== provider || !nonce || nonce !== st.n) return back("auth_error=state");
  const code = url.searchParams.get("code");
  if (!code) return back("auth_error=cancel");
  let id;
  try {
    id = await fetchIdentity(env, provider, code, redirectUri(provider, siteOrigin(request, env)));
  } catch (e) {
    console.error("oauth", provider, e.message);
    return back("auth_error=provider");
  }
  const hub = hubStub(env);
  const meta = { email: id.email, name: id.name };

  if (st.m === "admin") {
    // Вход в админку: новый аккаунт не заводим; Google должен быть привязан к Telegram-аккаунту админа
    const toAdmin = (query) => new Response(null, { status: 302, headers: { Location: `/admin/?${query}`, "Cache-Control": "no-store", "Set-Cookie": `${OAUTH_COOKIE}=; Path=/api/auth/oauth/; Max-Age=0; HttpOnly; SameSite=Lax` } });
    const found = (await hub.identityGet(provider, id.sub))?.uid;
    if (!found) return toAdmin("auth_error=noaccount");
    const tgUid = isTelegramUid(found) ? found : (await hub.aliasGet(found)) || found;
    if (!adminIds(env).includes(String(tgUid))) return toAdmin("auth_error=forbidden");
    if (!st.c) return toAdmin("auth_error=state");
    const lc = newLoginCode();
    await hub.createLogin(lc, { purpose: "oauth", owner: st.c });
    await hub.confirmLogin(lc, tgUid, "oauth");
    return toAdmin(`login=${encodeURIComponent(lc)}`);
  }

  if (st.m === "link") {
    if (!st.u) return back("auth_error=state");
    // Пока шёл вход, веб-аккаунт могли склеить с Telegram — привязываем к актуальному
    const owner = isTelegramUid(st.u) ? st.u : (await hub.aliasGet(st.u)) || st.u;
    const r = await hub.identityLink(provider, id.sub, owner, meta);
    if (r.error) return back(`link_error=${r.error}&p=${provider}`, "#/profile/accounts");
    await userStub(env, owner, "web").track("account_link", { provider }).catch(() => {});
    return back(`linked=${provider}`, "#/profile/accounts");
  }

  let uid = (await hub.identityGet(provider, id.sub))?.uid;
  if (uid) {
    await hub.identityLink(provider, id.sub, uid, meta); // свежие имя и почта
  } else {
    uid = newWebUid();
    const r = await hub.identityLink(provider, id.sub, uid, meta);
    if (r.error) uid = (await hub.identityGet(provider, id.sub)).uid; // параллельный вход тем же аккаунтом
    else await userStub(env, uid, "web").init(uid, { first_name: id.name || "Доктор", ref: st.r || `oauth_${provider}` });
  }
  // Код привязан к браузеру, начавшему вход (nonce в sessionStorage): чужую ссылку ?login= подсунуть нельзя
  if (!st.c) return back("auth_error=state");
  const lc = newLoginCode();
  await hub.createLogin(lc, { purpose: "oauth", owner: st.c });
  await hub.confirmLogin(lc, uid, "oauth");
  return back(`login=${encodeURIComponent(lc)}`);
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------
// Поисковики: индексируется только основной домен
// ---------------------------------------------------
const MAIN_HOST = "helpmedoctor.ru";

/** helpmedoctor.ru приходит через прокси на VPS: nginx передаёт исходный хост в X-Forwarded-Host */
function isCanonicalHost(request) {
  const fwd = (request.headers.get("X-Forwarded-Host") || "").toLowerCase();
  const host = new URL(request.url).hostname.toLowerCase();
  return fwd === MAIN_HOST || host === MAIN_HOST;
}

function robotsTxt(canonicalHost) {
  const body = canonicalHost
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /app\n\nUser-agent: Yandex\nAllow: /\nDisallow: /api/\nDisallow: /admin\nDisallow: /app\nClean-param: from /app\n\nSitemap: https://${MAIN_HOST}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}

/** Реквизиты для выплаты партнёрского вознаграждения: номер карты (с проверкой Луна) или телефон для СБП и банк */
function payoutDetails(b) {
  const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (name.split(" ").length < 2) return { error: "Укажите имя и фамилию получателя" };
  if (b.method === "sbp") {
    const digits = String(b.phone || "").replace(/\D/g, "").replace(/^8/, "7");
    if (!/^7\d{10}$/.test(digits)) return { error: "Телефон для СБП: +7 и 10 цифр" };
    const bank = String(b.bank || "").trim().slice(0, 80);
    if (!bank) return { error: "Укажите банк для перевода по СБП" };
    return { method: "sbp", data: { phone: `+${digits}`, bank, name } };
  }
  const card = String(b.card || "").replace(/\D/g, "");
  if (card.length < 16 || card.length > 19 || !luhn(card)) return { error: "Проверьте номер карты" };
  return { method: "card", data: { card, name } };
}

function luhn(num) {
  let sum = 0;
  for (let i = 0; i < num.length; i++) {
    let d = Number(num[num.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
