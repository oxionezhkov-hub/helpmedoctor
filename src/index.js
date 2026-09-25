// =====================================================
// Cloudflare Worker — Help me, Doctor 👩‍⚕️
// Telegram-бот + веб-приложение (/app) на общих данных (Durable Objects)
// =====================================================
import { PLANS } from "./config.js";
import { bearer, createSession, loginLinks, newLoginCode, verifyInitData, verifySession } from "./lib/auth.js";
import { arrayBufferToBase64, esc, json, userError } from "./lib/util.js";
import { createPayment, fetchPayment, planFromPurpose, webhookOperationId } from "./lib/tochka.js";
import { handleUpdate, hubStub, startInBot, userStub } from "./bot/handlers.js";
import { adminApi } from "./admin-api.js";

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
        return new Response(null, { status: 302, headers: { Location: "/app" } });
      }
      const canonicalHost = isCanonicalHost(request);
      if (path === "/robots.txt") return robotsTxt(canonicalHost);
      const res = await env.ASSETS.fetch(request);
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
  const hub = hubStub(env);
  const known = await hub.getPayment(op);
  // Статус и сумму берём из API Точки, а не из тела вебхука
  const pay = await fetchPayment(env, op).catch((e) => {
    console.error("tochka status", e);
    return null;
  });
  if (!pay) return new Response("retry", { status: 503 });
  if (pay.status !== "APPROVED") return new Response("OK");
  const uid = known?.uid || pay.consumerId || (/uid(\d+)/.exec(pay.purpose) || [])[1];
  const plan = known?.plan || planFromPurpose(pay.purpose);
  if (!uid || !PLANS[plan]) {
    console.error("payment without uid/plan", op, pay);
    return new Response("OK");
  }
  if (!known) await hub.savePayment(op, uid, plan);
  if (await hub.markPaymentDone(op, pay.amount || PLANS[plan].price)) {
    await userStub(env, uid, "system").activateSubscription(plan, op);
    await hub.notifyAdmin(`💰 Новая оплата\nuid: ${uid}\nТариф: ${PLANS[plan].label}\nСумма: ${pay.amount || PLANS[plan].price} ₽`, "payment");
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
    await hubStub(env).createLogin(code);
    return json({ code, ...loginLinks(env, code) });
  }
  if (path === "/auth/poll" && method === "GET") {
    const code = url.searchParams.get("code") || "";
    const res = await hubStub(env).pollLogin(code);
    if (res.status !== "ok") return json({ status: res.status });
    await userStub(env, res.uid).init(res.uid);
    return json({ status: "ok", token: await createSession(env, res.uid) });
  }
  // Аватар по случайному id (без авторизации: <img> не умеет заголовки; id не угадать)
  let am = path.match(/^\/avatar\/([a-f0-9]{32})$/);
  if (am && method === "GET") {
    const { value, metadata } = await env.HELPMEDOCTOR.getWithMetadata(`avatar:${am[1]}`, "arrayBuffer");
    if (!value) return new Response("not found", { status: 404 });
    return new Response(value, { headers: { "Content-Type": metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  }
  if (path === "/config" && method === "GET") {
    return json({ bot_username: env.BOT_USERNAME });
  }

  // --- WebSocket синхронизации (токен в query: браузер не умеет заголовки для WS) ---
  if (path === "/ws") {
    const uid = await verifySession(env, url.searchParams.get("token"));
    if (!uid) return new Response("unauthorized", { status: 401 });
    return userStub(env, uid).fetch(request);
  }

  const uid = await verifySession(env, bearer(request));
  if (!uid) return json({ error: "Нужно войти", code: "auth" }, 401);
  // Мини-приложение в Telegram или сайт в браузере — для аналитики каналов
  const source = request.headers.get("X-Client") === "miniapp" ? "miniapp" : "web";
  const user = userStub(env, uid, source);

  try {
    if (path === "/me" && method === "GET") {
      await user.init(uid);
      return json({ ...(await user.snapshot()), bot_username: env.BOT_USERNAME });
    }
    if (path === "/profile" && method === "PATCH") {
      return json({ profile: await user.updateProfile(await readJson(request)) });
    }
    // Мини-приложение → сайт в браузере: одноразовый код входа, уже подтверждённый этим пользователем
    if (path === "/auth/handoff" && method === "POST") {
      const code = newLoginCode();
      await hubStub(env).createLogin(code);
      await hubStub(env).confirmLogin(code, uid);
      const base = (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, "");
      return json({ url: `${base}/app?login=${encodeURIComponent(code)}` });
    }
    if (path === "/avatar" && method === "POST") {
      const buf = await request.arrayBuffer();
      return json(await user.setAvatar(buf, (request.headers.get("Content-Type") || "").split(";")[0]));
    }
    if (path === "/avatar/telegram" && method === "POST") return json(await user.avatarFromTelegram());
    if (path === "/avatar" && method === "DELETE") return json(await user.removeAvatar());
    if (path === "/feedback" && method === "POST") {
      return json(await user.saveFeedback(await readJson(request), "web"));
    }
    if (path === "/sections/suggest" && method === "POST") {
      return json({ sections: await user.suggestSections((await readJson(request)).profession) });
    }
    if (path === "/patients/new" && method === "POST") {
      return json(await user.requestNewPatient("web"));
    }
    if (path === "/event" && method === "POST") {
      // Клиентские события: открыл приложение, открыл тарифы
      const { type, meta } = await readJson(request);
      if (!["app_open", "plans_open"].includes(type)) return json({ error: "Неизвестное событие" }, 400);
      return json(await user.trackEvent(type, typeof meta === "object" && meta ? meta : {}));
    }
    if (path === "/pay" && method === "POST") {
      const { plan } = await readJson(request);
      if (!PLANS[plan]) return json({ error: "Неизвестный тариф" }, 400);
      await user.trackEvent("pay_click", { plan });
      let payment;
      try {
        payment = await createPayment(env, uid, plan);
      } catch (e) {
        console.error("tochka create", e);
        await hubStub(env).paymentError(uid, plan, e.message);
        await user.trackEvent("pay_error", { plan, error: String(e.message).slice(0, 300) });
        await hubStub(env).notifyAdmin(`⚠️ Оплата не создана (uid ${uid}, тариф ${PLANS[plan].label})\n${esc(e.message).slice(0, 700)}`, "payment_error");
        return json({ error: "Платёжная система сейчас не отвечает. Мы уже разбираемся — попробуйте чуть позже.", code: "payment" }, 502);
      }
      if (payment.operationId) await hubStub(env).savePayment(payment.operationId, uid, plan);
      await user.trackEvent("pay_link", { plan, op: payment.operationId });
      return json({ link: payment.link });
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
    ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: https://${MAIN_HOST}/sitemap.xml\n`
    : "User-agent: *\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
