// Эквайринг Точка Банка.
// Вебхуку не доверяем: из него берём только operationId и перепроверяем
// статус платежа запросом к API Точки с нашим токеном.
import { PLANS } from "../config.js";

const API = "https://enter.tochka.com/uapi/acquiring/v1.0/payments";

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

export async function createPayment(env, uid, planKey) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error("unknown plan");
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth(env) },
    body: JSON.stringify({
      Data: {
        customerCode: env.TOCHKA_CUSTOMER,
        merchantId: env.TOCHKA_MERCHANT,
        amount: plan.price,
        purpose: `HelpMeDoctor uid${uid}: ${plan.label}`,
        paymentMode: ["sbp", "card"],
        consumerId: String(uid),
        ttl: 600,
        // Без «#» в адресе: страница сама откроет экран тарифов по параметру go
        ...(env.PUBLIC_URL ? { redirectUrl: `${env.PUBLIC_URL.replace(/\/$/, "")}/app?go=${encodeURIComponent("/plans?paid=1")}` } : {}),
      },
    }),
  });
  const text = await r.text();
  if (!r.ok) throw new TochkaError(r.status, text);
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    throw new TochkaError(r.status, `не JSON: ${text}`);
  }
  const link = d.Data?.paymentLink || d.Data?.redirectUrl;
  if (!link) throw new TochkaError(r.status, `нет paymentLink: ${text}`);
  return { link, operationId: d.Data?.operationId || null };
}

/** Актуальный статус платежа из API Точки */
export async function fetchPayment(env, operationId) {
  const r = await fetch(`${API}/${encodeURIComponent(operationId)}`, {
    headers: { Authorization: auth(env) },
  });
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
  if (p.includes("навсегда")) return "forever";
  if (p.includes("месяц")) return "month";
  if (p.includes("недел")) return "week";
  return "day";
}
