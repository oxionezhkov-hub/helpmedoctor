// Эквайринг Точка Банка.
// Вебхуку не доверяем: из него берём только operationId и перепроверяем
// статус платежа запросом к API Точки с нашим токеном.
import { PLANS } from "../config.js";

const API = "https://enter.tochka.com/uapi/acquiring/v1.0/payments";

export async function createPayment(env, uid, planKey) {
  const plan = PLANS[planKey];
  if (!plan) throw new Error("unknown plan");
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.TOCHKA_TOKEN}` },
    body: JSON.stringify({
      Data: {
        customerCode: env.TOCHKA_CUSTOMER,
        merchantId: env.TOCHKA_MERCHANT,
        amount: plan.price,
        purpose: `HelpMeDoctor uid${uid}: ${plan.label}`,
        paymentMode: ["sbp", "card"],
        consumerId: String(uid),
        ttl: 600,
        ...(env.PUBLIC_URL ? { redirectUrl: `${env.PUBLIC_URL}/app#/plans?paid=1` } : {}),
      },
    }),
  });
  if (!r.ok) throw new Error(`Tochka ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  const link = d.Data?.paymentLink || d.Data?.redirectUrl;
  if (!link) throw new Error("no payment link");
  return { link, operationId: d.Data?.operationId || null };
}

/** Актуальный статус платежа из API Точки */
export async function fetchPayment(env, operationId) {
  const r = await fetch(`${API}/${encodeURIComponent(operationId)}`, {
    headers: { Authorization: `Bearer ${env.TOCHKA_TOKEN}` },
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
