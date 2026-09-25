// =====================================================
// API админки: /api/admin/*
// Доступ — только Telegram ID из ADMIN_ID. Сессия 12 часов, проверяется на каждом запросе.
// =====================================================
import { adminIds, AI_FREE_NEURONS_PER_DAY, PLANS } from "./config.js";
import { ADMIN_SESSION_TTL_MS, bearer, createSession, loginLinks, newLoginCode, verifyInitData, verifySession } from "./lib/auth.js";
import { aiText } from "./lib/ai.js";
import { declDays, esc, json, toTelegramHtml, userError } from "./lib/util.js";
import { fetchPayment } from "./lib/tochka.js";
import { tg, stripHtml } from "./lib/telegram.js";
import { hubStub, userStub } from "./bot/handlers.js";
import { buildKeyboard } from "./do/hub.js";

// Операции HubDO, которые можно вызывать из интерфейса (остальные — только изнутри сервера)
const HUB_OPS = new Set([
  "dashboard", "live", "report", "users", "chat", "events", "subscriptions", "payments", "inbox", "broadcasts", "broadcast",
  "segment_count", "broadcast_create", "broadcast_stop", "broadcast_test", "templates", "template_save", "template_delete", "texts", "texts_save",
  "feedback", "feedback_status", "onboarding", "notes_add", "notes_delete", "tasks", "task", "task_create", "task_update", "task_delete",
  "task_comment", "payment_status", "audit_log", "notify_get", "notify_save", "backfill_status", "counts", "ai_models_get", "ai_models_set",
]);

const ADMIN_NAMES = { "1326867567": "Олег", "1062804986": "Саша" };

export async function adminApi(request, env, url, ctx) {
  const path = url.pathname.slice("/api/admin".length);
  const method = request.method;
  const hub = hubStub(env);

  // --- Вход ---
  if (path === "/auth/telegram" && method === "POST") {
    const { initData } = await readJson(request);
    const u = await verifyInitData(env, initData, 86400);
    if (!u) return json({ error: "Не удалось проверить вход через Telegram" }, 401);
    if (!adminIds(env).includes(u.id)) return json({ error: "Нет доступа", code: "forbidden" }, 403);
    await hub.admin("audit", { action: "login", details: { via: "telegram" } }, u.id);
    return json({ token: await createSession(env, u.id, { scope: "admin", ttl: ADMIN_SESSION_TTL_MS }), me: adminMe(env, u.id) });
  }
  if (path === "/auth/login" && method === "POST") {
    // Префикс «adm-» (в обычных кодах дефиса нет): бот поймёт, что после входа вести в админку
    const code = `adm-${newLoginCode()}`;
    await hub.createLogin(code);
    return json({ code, ...loginLinks(env, code) });
  }
  if (path === "/auth/poll" && method === "GET") {
    const res = await hub.pollLogin(url.searchParams.get("code") || "");
    if (res.status !== "ok") return json({ status: res.status });
    if (!adminIds(env).includes(String(res.uid))) return json({ status: "forbidden", error: "Этот Telegram-аккаунт не админ" }, 403);
    await hub.admin("audit", { action: "login", details: { via: "link" } }, res.uid);
    return json({ status: "ok", token: await createSession(env, res.uid, { scope: "admin", ttl: ADMIN_SESSION_TTL_MS }), me: adminMe(env, res.uid) });
  }

  // --- Всё остальное — только с сессией админа ---
  const admin = await verifySession(env, bearer(request), "admin");
  if (!admin) return json({ error: "Нужно войти", code: "auth" }, 401);
  if (!adminIds(env).includes(admin)) return json({ error: "Нет доступа", code: "forbidden" }, 403);

  try {
    if (path === "/me" && method === "GET") {
      // Первый вход после обновления — достраиваем историю из профилей пользователей
      ctx?.waitUntil?.(hub.startBackfill());
      return json({ me: adminMe(env, admin), admins: adminIds(env).map((id) => ({ id, name: ADMIN_NAMES[id] || id })), bot_username: env.BOT_USERNAME, public_url: env.PUBLIC_URL, cf_configured: !!(env.CF_ANALYTICS_TOKEN && env.CF_ACCOUNT_ID) });
    }

    // Универсальные операции HubDO
    if (path === "/q" && method === "POST") {
      const { op, args } = await readJson(request);
      if (!HUB_OPS.has(op)) return json({ error: "Неизвестная операция" }, 400);
      return json(await hub.admin(op, args || {}, admin));
    }

    if (path === "/backfill" && method === "POST") return json(await hub.startBackfill(true));

    // Карточка пользователя: сводка из HubDO + всё из его UserDO
    let m = path.match(/^\/user\/(\d+)$/);
    if (m && method === "GET") {
      const uid = m[1];
      const [h, view] = await Promise.all([hub.admin("user_hub", { uid }, admin), userStub(env, uid, "admin").adminView()]);
      if (!h && !view) return json({ error: "Пользователь не найден" }, 404);
      return json({ ...(h || {}), view });
    }
    m = path.match(/^\/user\/(\d+)\/patient\/([\w-]+)$/);
    if (m && method === "GET") {
      const res = await userStub(env, m[1], "admin").adminPatient(m[2]);
      if (!res) return json({ error: "Пациент не найден (возможно, врач от него отказался)" }, 404);
      return json(res);
    }
    m = path.match(/^\/user\/(\d+)\/action$/);
    if (m && method === "POST") return json(await userAction(env, hub, admin, m[1], await readJson(request)));

    m = path.match(/^\/user\/(\d+)\/message$/);
    if (m && method === "POST") return json(await sendMessage(env, hub, admin, m[1], request));

    // Массовые действия по выбранным пользователям
    if (path === "/bulk" && method === "POST") {
      const { uids, action, days, reason, notify } = await readJson(request);
      const list = [...new Set((uids || []).map(String))].slice(0, 5000);
      if (!list.length) return json({ error: "Никого не выбрано" }, 400);
      let ok = 0;
      const errors = [];
      for (const uid of list) {
        try {
          await userAction(env, hub, admin, uid, { action, days, reason, notify }, { silent: true });
          ok++;
        } catch (e) {
          errors.push({ uid, error: userError(e)?.message || e.message });
        }
      }
      await hub.admin("audit", { action: `bulk_${action}`, target: `${list.length} польз.`, details: { days, reason, ok } }, admin);
      if (action === "grant") {
        await hub.notifyAdmin(`🎁 ${esc(ADMIN_NAMES[admin] || admin)} выдал(а) подписку ${ok} пользователям на ${days} ${declDays(Number(days))}`, "grant", { except: admin });
      }
      return json({ ok, errors });
    }

    // Проверка платежа в Точке вручную: если деньги пришли, а подписка не включилась
    if (path === "/payments/check" && method === "POST") {
      const { op } = await readJson(request);
      const row = await hub.getPayment(op);
      if (!row) return json({ error: "Платёж не найден" }, 404);
      let pay;
      try {
        pay = await fetchPayment(env, op);
      } catch (e) {
        return json({ error: `Точка не ответила: ${e.message}` }, 502);
      }
      let activated = false;
      if (pay.status === "APPROVED" && (await hub.markPaymentDone(op, pay.amount || PLANS[row.plan]?.price))) {
        await userStub(env, row.uid, "admin").activateSubscription(row.plan, op);
        activated = true;
      }
      await hub.admin("audit", { action: "payment_check", target: op, details: { status: pay.status, activated } }, admin);
      return json({ status: pay.status, amount: pay.amount, activated });
    }

    // Точный расход ИИ из Cloudflare (GraphQL Analytics API)
    if (path === "/ai/cloudflare" && method === "POST") {
      const { from, to } = await readJson(request);
      return json(await cloudflareAiUsage(env, hub, Number(from), Number(to)));
    }

    // ИИ-сводка отзывов и ожиданий из анкет
    if (path === "/feedback/summary" && method === "POST") {
      const [fb, ob] = await Promise.all([hub.admin("feedback", {}, admin), hub.admin("onboarding", {}, admin)]);
      const lines = [
        ...fb.rows.filter((r) => r.text).slice(0, 150).map((r) => `Отзыв ${r.rating || "-"}★: ${r.text}`),
        ...ob.rows.filter((r) => r.expectations).slice(0, 150).map((r) => `Ожидание: ${r.expectations}`),
      ];
      if (!lines.length) return json({ error: "Пока нет отзывов и ответов анкеты" }, 400);
      const text = await aiText(env, {
        kind: "admin_summary", maxTokens: 700, temperature: 0.3,
        prompt: `Ниже отзывы пользователей медицинского тренажёра и их ожидания из анкеты. Сгруппируй по темам: для каждой темы — название, сколько упоминаний, 1 короткая типичная цитата. Отсортируй по числу упоминаний. Затем 3 главных вывода для команды. Кратко, по-русски, без вступлений.\n\n${lines.join("\n").slice(0, 12000)}`,
      });
      const summary = { text, ts: Date.now(), count: lines.length };
      await hub.admin("set_setting", { k: "ai_feedback_summary", v: summary }, admin);
      return json(summary);
    }

    return json({ error: "Не найдено" }, 404);
  } catch (e) {
    const ue = userError(e);
    if (ue) return json({ error: ue.message, code: ue.code }, 409);
    console.error("admin api error", path, e);
    return json({ error: `Ошибка: ${e.message}` }, 500);
  }
}

function adminMe(env, uid) {
  return { id: String(uid), name: ADMIN_NAMES[uid] || String(uid) };
}

/** Действия с пользователем: подписка, доп. пациенты, блокировка, стрик */
async function userAction(env, hub, admin, uid, a, { silent = false } = {}) {
  const user = userStub(env, uid, "admin");
  const texts = (await hub.admin("get_setting", { k: "texts" }, admin)) || {};
  const notify = a.notify !== false;
  let res;
  switch (a.action) {
    case "grant": {
      const days = a.days === "forever" ? 36500 : Number(a.days);
      res = await user.grantSubscription(days, { admin, reason: a.reason || "", notify, text: a.text ? toTelegramHtml(a.text) : "", texts });
      await hub.admin("record_gift", { uid, days, reason: a.reason || "" }, admin);
      if (!silent) {
        await hub.notifyAdmin(`🎁 ${esc(ADMIN_NAMES[admin] || admin)} выдал(а) подписку: ${esc(res.name || "")} (${uid}) — ${days >= 36500 ? "навсегда" : `${days} ${declDays(days)}`}${a.reason ? ` · ${esc(a.reason)}` : ""}`, "grant", { except: admin });
      }
      break;
    }
    case "cancel":
      res = await user.adminCancelSubscription({ admin, notify: !!a.notify && !!a.text, text: a.text ? toTelegramHtml(a.text) : "" });
      break;
    case "set_until":
      res = await user.adminSetSubUntil(Number(a.until), { admin });
      break;
    case "extra":
      res = await user.adminExtraPatients(Number(a.n || 1), { admin, notify });
      break;
    case "block":
      res = await user.adminSetBlocked(true, { admin });
      break;
    case "unblock":
      res = await user.adminSetBlocked(false, { admin });
      break;
    case "reset_streak":
      res = await user.adminResetStreak({ admin });
      break;
    default:
      throw new Error("Неизвестное действие");
  }
  if (!silent) await hub.admin("audit", { action: a.action, target: uid, details: { days: a.days, n: a.n, reason: a.reason, until: a.until } }, admin);
  return res;
}

/** Сообщение пользователю от имени бота: текст (HTML), кнопки, картинка по желанию */
async function sendMessage(env, hub, admin, uid, request) {
  let text = "", buttons = [], image = null;
  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("multipart/form-data")) {
    const fd = await request.formData();
    text = String(fd.get("text") || "");
    try { buttons = JSON.parse(String(fd.get("buttons") || "[]")); } catch {}
    const f = fd.get("image");
    if (f && typeof f === "object" && f.size) {
      if (f.size > 8 * 1024 * 1024) throw new Error("Картинка больше 8 МБ");
      image = f;
    }
  } else {
    ({ text = "", buttons = [] } = await readJson(request));
  }
  text = text.trim().slice(0, image ? 1000 : 4000);
  if (!text && !image) throw new Error("Пустое сообщение");
  const html = toTelegramHtml(text);
  const kb = buildKeyboard(env, buttons, 0);
  const bot = tg(env, { kind: "admin", admin });
  const mid = image ? await bot.sendPhoto(uid, image, html, kb) : await bot.send(uid, html, kb);
  await hub.admin("audit", { action: "message", target: uid, details: { text: stripHtml(html).slice(0, 200), image: !!image } }, admin);
  return { ok: bot.last.ok, error: bot.last.ok ? null : bot.last.description, message_id: mid };
}

// ---------------------------------------------------
// Cloudflare GraphQL: точный расход нейронов Workers AI
// ---------------------------------------------------
async function cloudflareAiUsage(env, hub, from, to) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) {
    return { configured: false, error: "Не настроен доступ к API Cloudflare: нужны секреты CF_ANALYTICS_TOKEN и CF_ACCOUNT_ID" };
  }
  const vars = { acc: env.CF_ACCOUNT_ID, from: new Date(from).toISOString(), to: new Date(Math.min(to, Date.now())).toISOString() };
  const queries = [
    `query($acc: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: { accountTag: $acc }) {
      aiInferenceAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }, orderBy: [date_ASC]) {
        count sum { totalNeurons totalInputTokens totalOutputTokens } dimensions { date modelId } } } } }`,
    `query($acc: string!, $from: Time!, $to: Time!) { viewer { accounts(filter: { accountTag: $acc }) {
      aiInferenceAdaptiveGroups(limit: 10000, filter: { datetime_geq: $from, datetime_leq: $to }, orderBy: [date_ASC]) {
        count sum { totalNeurons } dimensions { date modelId } } } } }`,
  ];
  let lastErr = "";
  for (const query of queries) {
    try {
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${String(env.CF_ANALYTICS_TOKEN).trim()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: vars }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.errors?.length) {
        lastErr = d.errors.map((e) => e.message).join("; ");
        continue;
      }
      const groups = d.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups || [];
      const byDay = {};
      const byModel = {};
      for (const g of groups) {
        const day = g.dimensions?.date;
        const n = Number(g.sum?.totalNeurons || 0);
        const x = (byDay[day] = byDay[day] || { day, neurons: 0, requests: 0, tin: 0, tout: 0 });
        x.neurons += n; x.requests += g.count || 0; x.tin += Number(g.sum?.totalInputTokens || 0); x.tout += Number(g.sum?.totalOutputTokens || 0);
        const mm = (byModel[g.dimensions?.modelId] = byModel[g.dimensions?.modelId] || { model: g.dimensions?.modelId, neurons: 0, requests: 0 });
        mm.neurons += n; mm.requests += g.count || 0;
      }
      const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)).map((x) => ({
        ...x, neurons: Math.round(x.neurons), over: Math.max(0, Math.round(x.neurons - AI_FREE_NEURONS_PER_DAY)),
        usd: Math.max(0, x.neurons - AI_FREE_NEURONS_PER_DAY) / 1000 * 0.011,
      }));
      const result = {
        configured: true, fetched_at: Date.now(), from, to, days, models: Object.values(byModel),
        total_neurons: Math.round(days.reduce((a, x) => a + x.neurons, 0)), usd_over_free: days.reduce((a, x) => a + x.usd, 0),
      };
      await hub.admin("cf_cache_set", { value: result });
      return result;
    } catch (e) {
      lastErr = e.message;
    }
  }
  return { configured: true, error: `Cloudflare API: ${lastErr}` };
}

async function readJson(request) {
  try {
    return (await request.json()) || {};
  } catch {
    return {};
  }
}
