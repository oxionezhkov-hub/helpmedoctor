// Подтверждение оплаты Точки: общий путь для вебхука банка, проверки из приложения и опроса HubDO.
// Статус и сумму всегда берём из API Точки; активация идемпотентна (HubDO.markPaymentDone).
import { PACKS, PLANS, TRIAL } from "../config.js";
import { fetchPayment, isPaidStatus, planFromPurpose } from "./tochka.js";
import { isTelegramUid } from "./oauth.js";

// Через сколько после создания ссылки HubDO спрашивает банк о статусе (мс от created_at).
// Дальше часа не ждём: ссылка брошена, а если оплата всё же придёт — сработает вебхук.
export const PAY_POLL = [15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800, 3600].map((s) => s * 1000);

/**
 * Проверяет платёж в банке и, если он оплачен, включает доступ.
 * hub — HubDO (или его stub). Возвращает { status: "paid" | "pending" | "ignored", activated }.
 * Ошибку связи с банком пробрасывает — вызывающий решает, повторять ли.
 */
export async function confirmPayment(env, hub, op) {
  const known = await hub.getPayment(op);
  if (known?.done) return { status: "paid", activated: false };
  const pay = await fetchPayment(env, op);
  if (!isPaidStatus(pay.status)) return { status: "pending", activated: false };
  let uid = known?.uid || pay.consumerId || (/uid(w?\d+)/.exec(pay.purpose) || [])[1];
  // Оплата веб-аккаунта, который потом склеили с Telegram
  if (uid && !isTelegramUid(uid)) uid = (await hub.aliasGet(uid)) || uid;
  const plan = known?.plan || planFromPurpose(pay.purpose);
  if (!uid || !(PLANS[plan] || PACKS[plan] || plan === TRIAL.key)) {
    console.error("payment without uid/plan", op, pay);
    return { status: "ignored", activated: false };
  }
  if (!known) {
    // Уведомление о нашем же автосписании (charge) — продление уже учтено в HubDO.chargeDueSubs
    const ap = await hub.autopayGet(uid);
    if (ap?.last_charge_at && Date.now() - ap.last_charge_at < 2 * 86400000 && ap.plan === plan) return { status: "ignored", activated: false };
    await hub.savePayment(op, uid, plan);
  }
  const amount = pay.amount || known?.amount;
  // Сначала «захватываем» платёж (защита от двойной активации при одновременных вебхуке и опросе),
  // при сбое активации — отпускаем, чтобы следующая проверка или повтор вебхука включили доступ
  if (!(await hub.markPaymentDone(op, amount))) return { status: "paid", activated: false };
  try {
    const res = await env.USER.get(env.USER.idFromName(String(uid))).rpc("activateSubscription", [plan, op, amount], "system");
    if (res?.userError) throw new Error(res.userError.message || "userError");
  } catch (e) {
    console.error("activateSubscription", op, e);
    await hub.unmarkPaymentDone(op);
    await hub.paymentNotice(uid, plan, amount, op, String(e?.message || e)).catch(() => {});
    throw e;
  }
  await hub.paymentNotice(uid, plan, amount, op);
  return { status: "paid", activated: true, plan };
}
