// Эквайринг Точка Банка.
// Вебхуку не доверяем: из него берём только operationId и перепроверяем
// статус платежа запросом к API Точки с нашим токеном.
import { PACKS, PLANS, TRIAL, planPrice, productLabel } from "../config.js";

const API_HOST = "https://enter.tochka.com";
const API_PATH = "/uapi/acquiring/v1.0/payments";
const SUB_PATH = "/uapi/acquiring/v1.0/subscriptions";

/**
 * Запрос к API Точки. Точка работает на сертификате НУЦ Минцифры, которому Cloudflare не доверяет (ошибка 526),
 * поэтому, если задан TOCHKA_PROXY_URL, идём через посредника в Yandex Cloud (yandex/tochka-proxy):
 * он проверяет TOCHKA_PROXY_SECRET и пересылает запрос в Точку.
 */
function tochkaFetch(env, path, { method = "GET", body } = {}) {
  const proxy = String(env.TOCHKA_PROXY_URL || "").trim();
  const headers = body ? { "Content-Type": "application/json" } : {};
  if (!proxy) return fetch(`${API_HOST}${path}`, { method, body, headers: { ...headers, Authorization: auth(env) } });
  const url = `${proxy}${proxy.includes("?") ? "&" : "?"}path=${encodeURIComponent(path)}`;
  return fetch(url, { method, body, headers: { ...headers, "X-Tochka-Auth": auth(env), "X-Proxy-Secret": String(env.TOCHKA_PROXY_SECRET || "").trim() } });
}

/** Ошибка API Точки: статус и ответ банка (без токена) — для уведомления админу */
export class TochkaError extends Error {
  constructor(status, body) {
    super(`Tochka ${status}: ${String(body).slice(0, 300)}`);
    this.status = status;
    this.body = String(body).slice(0, 600);
  }
}

// Токен, вставленный в секрет с пробелом или переводом строки (или уже с «Bearer »), ломает заголовок запроса
function auth(env) {
  const token = String(env.TOCHKA_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new TochkaError(0, "секрет TOCHKA_TOKEN пустой");
  return `Bearer ${token}`;
}

function paymentData(env, uid, key, amount) {
  return {
    customerCode: env.TOCHKA_CUSTOMER,
    merchantId: env.TOCHKA_MERCHANT,
    amount,
    purpose: `HelpMeDoctor uid${uid}: ${productLabel(key)}`,
    consumerId: String(uid),
    // Без «#» в адресе: страница сама откроет экран тарифов по параметру go
    ...(env.PUBLIC_URL ? { redirectUrl: `${env.PUBLIC_URL.replace(/\/$/, "")}/app?go=${encodeURIComponent("/plans?paid=1")}` } : {}),
  };
}

async function postJson(env, path, data) {
  const r = await tochkaFetch(env, path, { method: "POST", body: JSON.stringify({ Data: data }) });
  const text = await r.text();
  if (!r.ok) throw new TochkaError(r.status, text);
  try {
    return JSON.parse(text).Data || {};
  } catch {
    throw new TochkaError(r.status, `не JSON: ${text}`);
  }
}

/** Разовая оплата (СБП или карта): неделя, 3 месяца, год, разовые покупки */
export async function createPayment(env, uid, key, amount = planPrice(key)) {
  if (!amount || (!PLANS[key] && !PACKS[key])) throw new Error("unknown plan");
  const d = await postJson(env, API_PATH, { ...paymentData(env, uid, key, amount), paymentMode: ["sbp", "card"], ttl: 600 });
  const link = d.paymentLink || d.redirectUrl;
  if (!link) throw new TochkaError(200, `нет paymentLink: ${JSON.stringify(d).slice(0, 300)}`);
  return { link, operationId: d.operationId || null };
}

/**
 * Подписка с автопродлением: первый платёж по ссылке (карта сохраняется), дальше списываем сами методом charge.
 * recurring: true — подписка без графика, сумму и дату списания задаём мы (Точка.API, «Подписки»).
 */
export async function createSubscription(env, uid, key, amount = planPrice(key)) {
  if (!amount || !(key === TRIAL.key || PLANS[key]?.recurring)) throw new Error("not a subscription plan");
  const d = await postJson(env, SUB_PATH, { ...paymentData(env, uid, key, amount), saveCard: true, recurring: true });
  const link = d.paymentLink || d.redirectUrl || d.url;
  if (!link) throw new TochkaError(200, `нет paymentLink: ${JSON.stringify(d).slice(0, 300)}`);
  return { link, operationId: d.operationId || null };
}

/** Списание по подписке. Возвращает статус банка; ok — деньги списаны или списание принято */
export async function chargeSubscription(env, operationId, amount) {
  const d = await postJson(env, `${SUB_PATH}/${encodeURIComponent(operationId)}/charge`, { amount: Number(amount) });
  const status = String(d.status || d.Status || "").toUpperCase();
  return { status, ok: !/DECLIN|REJECT|FAIL|ERROR|CANCEL|EXPIRED/.test(status), operationId: d.operationId || null };
}

/** Отключить подписку в Точке (карта больше не списывается) */
export async function cancelSubscription(env, operationId) {
  await postJson(env, `${SUB_PATH}/${encodeURIComponent(operationId)}/status`, { status: "Cancelled" });
  return true;
}

/** Оплата прошла: статусы Точки для разового платежа и подписки */
export function isPaidStatus(status) {
  return /^(APPROVED|AUTHORIZED|ACTIVE|PAID|SUCCESS)/i.test(String(status || ""));
}

/** Актуальный статус платежа из API Точки */
export async function fetchPayment(env, operationId) {
  let r = await tochkaFetch(env, `${API_PATH}/${encodeURIComponent(operationId)}`);
  // Первый платёж подписки может не находиться среди разовых — спрашиваем статус подписки
  if (!r.ok) r = await tochkaFetch(env, `${SUB_PATH}/${encodeURIComponent(operationId)}/status`);
  if (!r.ok) throw new Error(`Tochka status ${r.status}`);
  const d = await r.json();
  const op = Array.isArray(d.Data?.Operation) ? d.Data.Operation[0] : d.Data?.Operation || d.Data;
  return {
    status: op?.status || "",
    amount: op?.amount != null ? String(op.amount) : "",
    purpose: op?.purpose || "",
    consumerId: op?.consumerId ? String(op.consumerId) : "",
  };
}

/** Из тела вебхука (JWT или JSON) достаём operationId — без доверия к остальным полям */
export function webhookOperationId(raw) {
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    const parts = String(raw).trim().split(".");
    if (parts.length === 3) {
      try {
        let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        while (b64.length % 4) b64 += "=";
        payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
      } catch {}
    }
  }
  return payload?.operationId || payload?.Data?.operationId || null;
}

export function planFromPurpose(purpose) {
  const p = String(purpose).toLowerCase();
  if (p.includes("7 дней") || p.includes("пробн")) return TRIAL.key;
  if (p.includes("пациент")) return "patients3";
  if (p.includes("замороз")) return "freeze";
  if (p.includes("навсегда")) return "forever";
  if (p.includes("3 месяц")) return "quarter";
  if (p.includes("год")) return "year";
  if (p.includes("месяц")) return "month";
  if (p.includes("недел")) return "week";
  return "day";
}
