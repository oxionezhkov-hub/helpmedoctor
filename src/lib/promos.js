// Промокоды: админ создаёт код (название, срок действия, бонус — дни премиума), пользователь вводит его в «Тарифах»
// или приходит по ссылке /app?promo=КОД. Один код — один раз на человека; счётчик активаций в таблице.
import { UserError } from "./util.js";

const DAY = 86400000;
const MSK = 3 * 3600000;

export function initPromoTables(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY, title TEXT, days INTEGER, until INTEGER, active INTEGER DEFAULT 1,
      uses INTEGER DEFAULT 0, created_at INTEGER, admin TEXT);
    CREATE TABLE IF NOT EXISTS promo_uses (code TEXT, uid TEXT, ts INTEGER, PRIMARY KEY (code, uid));
  `);
}

/** Код: латиница, кириллица, цифры, дефис; регистр не важен */
export function normCode(code) {
  return String(code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 32);
}

/** «2026-10-15» → конец этого дня по Москве */
export function untilFromDate(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? t - MSK + DAY - 1 : null;
}

/** Проверка без активации: почему код не подходит (или null) */
export function promoProblem(p, now = Date.now()) {
  if (!p) return "Такого промокода нет — проверьте написание";
  if (!p.active) return "Этот промокод отключён";
  if (p.until && now > p.until) return "Срок действия промокода закончился";
  return null;
}

/** Активация: запись об использовании, счётчик, дни премиума у пользователя */
export async function promoRedeem(h, uid, raw) {
  uid = String(uid);
  const code = normCode(raw);
  if (!code) throw new UserError("Введите промокод", "promo");
  const p = h.one("SELECT * FROM promos WHERE code = ?", code);
  const problem = promoProblem(p);
  if (problem) throw new UserError(problem, "promo");
  if (h.one("SELECT 1 AS x FROM promo_uses WHERE code = ? AND uid = ?", code, uid)) throw new UserError("Вы уже активировали этот промокод", "promo");
  h.sql.exec("INSERT INTO promo_uses (code, uid, ts) VALUES (?, ?, ?)", code, uid, Date.now());
  h.sql.exec("UPDATE promos SET uses = uses + 1 WHERE code = ?", code);
  const user = h.env.USER.get(h.env.USER.idFromName(uid));
  try {
    const res = await user.grantSubscription(p.days, { reason: `промокод ${code}`, notify: false, admin: "promo" });
    await user.trackEvent("promo", { code, days: p.days });
    return { code, days: p.days, title: p.title, until: res.until };
  } catch (e) {
    // Не выдали — откатываем использование, чтобы можно было попробовать ещё раз
    h.sql.exec("DELETE FROM promo_uses WHERE code = ? AND uid = ?", code, uid);
    h.sql.exec("UPDATE promos SET uses = MAX(0, uses - 1) WHERE code = ?", code);
    throw e;
  }
}

const err = (m) => new UserError(m, "promo");

export const PROMO_OPS = {
  promos: (h) => ({
    rows: h.all("SELECT * FROM promos ORDER BY created_at DESC").map((p) => ({ ...p, expired: !!(p.until && Date.now() > p.until) })),
  }),
  promo_create: (h, a, admin) => {
    const code = normCode(a.code);
    if (!/^[A-ZА-ЯЁ0-9-]{3,32}$/.test(code)) throw err("Код — 3–32 символа: буквы, цифры, дефис");
    const days = Math.round(Number(a.days));
    if (!(days >= 1 && days <= 365)) throw err("Бонус — от 1 до 365 дней премиума");
    const until = a.until ? untilFromDate(String(a.until)) : null;
    if (a.until && !until) throw err("Неверная дата окончания");
    if (h.one("SELECT 1 AS x FROM promos WHERE code = ?", code)) throw err("Такой код уже есть");
    h.sql.exec("INSERT INTO promos (code, title, days, until, active, uses, created_at, admin) VALUES (?, ?, ?, ?, 1, 0, ?, ?)",
      code, String(a.title || "").trim().slice(0, 120) || code, days, until, Date.now(), String(admin));
    h.audit?.(admin, "promo_create", code, { days, until });
    return { ok: true, code };
  },
  promo_toggle: (h, a, admin) => {
    const code = normCode(a.code);
    h.sql.exec("UPDATE promos SET active = ? WHERE code = ?", a.active ? 1 : 0, code);
    h.audit?.(admin, a.active ? "promo_on" : "promo_off", code);
    return { ok: true };
  },
  promo_uses: (h, a) => ({
    rows: h.all(`SELECT pu.uid, pu.ts, u.name, u.username FROM promo_uses pu LEFT JOIN users u ON u.uid = pu.uid WHERE pu.code = ? ORDER BY pu.ts DESC LIMIT 500`, normCode(a.code)),
  }),
};
