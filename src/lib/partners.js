// Партнёрская программа: личные ссылки, привязка приглашённых навсегда, начисления с каждой оплаты, выплаты по запросу.
// Хранится в SQLite HubDO. Обычный пользователь: 30% с первой оплаты приглашённого и 15% со всех следующих.
// Партнёр (одобренная заявка): 50% с любой оплаты и вечный доступ. Ставки и холд — REFERRAL в config.js.
import { REFERRAL } from "../config.js";

const DAY = 86400000;
const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789"; // без похожих символов (l/1, o/0)

export function initPartnerTables(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS ref_codes (code TEXT PRIMARY KEY, uid TEXT UNIQUE, created_at INTEGER);
    CREATE TABLE IF NOT EXISTS referrals (uid TEXT PRIMARY KEY, referrer TEXT, at INTEGER, code TEXT);
    CREATE INDEX IF NOT EXISTS referrals_referrer ON referrals (referrer);
    CREATE TABLE IF NOT EXISTS partners (uid TEXT PRIMARY KEY, status TEXT, rate REAL, applied_at INTEGER, decided_at INTEGER,
      admin TEXT, info TEXT, note TEXT, granted INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS ref_earnings (op TEXT PRIMARY KEY, referrer TEXT, uid TEXT, amount REAL, rate REAL, reward REAL,
      plan TEXT, kind TEXT, at INTEGER, status TEXT DEFAULT 'ok', note TEXT);
    CREATE INDEX IF NOT EXISTS ref_earnings_referrer ON ref_earnings (referrer);
    CREATE TABLE IF NOT EXISTS ref_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, amount REAL, method TEXT, details TEXT,
      status TEXT, created_at INTEGER, decided_at INTEGER, admin TEXT, note TEXT);
  `);
}

const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

/** Личный код пользователя (создаётся при первом обращении) */
export function refCode(hub, uid) {
  uid = String(uid);
  const row = hub.one("SELECT code FROM ref_codes WHERE uid = ?", uid);
  if (row) return row.code;
  for (let i = 0; i < 20; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => CODE_ABC[b % CODE_ABC.length]).join("");
    if (hub.one("SELECT 1 AS x FROM ref_codes WHERE code = ?", code)) continue;
    hub.sql.exec("INSERT INTO ref_codes (code, uid, created_at) VALUES (?, ?, ?)", code, uid, Date.now());
    return code;
  }
  throw new Error("ref code");
}

/** Метка из ссылки (r_<код>) → код или null */
export function refFromLabel(label) {
  const m = /^r_([a-z0-9]{4,12})$/i.exec(String(label || ""));
  return m ? m[1].toLowerCase() : null;
}

/** Новый пользователь пришёл по личной ссылке — привязываем к пригласившему навсегда. Возвращает uid пригласившего. */
export function refBind(hub, uid, code) {
  uid = String(uid);
  const owner = hub.one("SELECT uid FROM ref_codes WHERE code = ?", String(code || "").toLowerCase())?.uid;
  if (!owner || owner === uid) return null;
  if (hub.one("SELECT 1 AS x FROM referrals WHERE uid = ?", uid)) return null;
  // Нельзя пригласить того, кто пригласил тебя (круговая схема)
  if (hub.one("SELECT 1 AS x FROM referrals WHERE uid = ? AND referrer = ?", owner, uid)) return null;
  hub.sql.exec("INSERT INTO referrals (uid, referrer, at, code) VALUES (?, ?, ?, ?)", uid, owner, Date.now(), code);
  return owner;
}

function partnerRow(hub, uid) {
  return hub.one("SELECT uid, status, rate, applied_at, decided_at, info, note, granted FROM partners WHERE uid = ?", String(uid));
}

/**
 * Оплата приглашённого (не пробный период за 1 ₽) → начисление пригласившему.
 * @returns {{referrer: string, reward: number, rate: number, kind: string} | null}
 */
export function refAccrue(hub, { uid, op, amount, plan }) {
  uid = String(uid);
  amount = Number(amount || 0);
  if (!op || !(amount > 0) || plan === "trial") return null;
  const ref = hub.one("SELECT referrer FROM referrals WHERE uid = ?", uid);
  if (!ref) return null;
  if (hub.one("SELECT 1 AS x FROM ref_earnings WHERE op = ?", String(op))) return null;
  const partner = partnerRow(hub, ref.referrer);
  if (partner?.status === "excluded") return null;
  const first = !hub.one("SELECT 1 AS x FROM ref_earnings WHERE uid = ? AND referrer = ?", uid, ref.referrer);
  let kind = first ? "first" : "next";
  let rate = first ? REFERRAL.first : REFERRAL.next;
  if (partner?.status === "active") {
    kind = "partner";
    rate = Number(partner.rate || REFERRAL.partner);
  }
  const reward = round2(amount * rate);
  hub.sql.exec(
    "INSERT INTO ref_earnings (op, referrer, uid, amount, rate, reward, plan, kind, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    String(op), ref.referrer, uid, amount, rate, reward, plan || null, kind, Date.now(),
  );
  return { referrer: ref.referrer, reward, rate, kind };
}

/** Баланс: всего начислено, в холде, доступно к выплате, запрошено, выплачено */
export function refBalance(hub, uid) {
  uid = String(uid);
  const holdFrom = Date.now() - REFERRAL.hold_days * DAY;
  const e = hub.one(
    `SELECT COALESCE(SUM(reward), 0) AS earned, COALESCE(SUM(CASE WHEN at >= ? THEN reward ELSE 0 END), 0) AS hold
     FROM ref_earnings WHERE referrer = ? AND status = 'ok'`, holdFrom, uid);
  const p = hub.one(
    `SELECT COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid,
            COALESCE(SUM(CASE WHEN status = 'requested' THEN amount ELSE 0 END), 0) AS requested
     FROM ref_payouts WHERE uid = ?`, uid);
  const available = Math.max(0, round2(e.earned - e.hold - p.paid - p.requested));
  return { earned: round2(e.earned), hold: round2(e.hold), paid: round2(p.paid), requested: round2(p.requested), available };
}

/** Всё для раздела «Партнёрская программа» в приложении */
export function partnerInfo(hub, uid) {
  uid = String(uid);
  const code = refCode(hub, uid);
  const partner = partnerRow(hub, uid);
  const people = hub.all(
    `SELECT r.uid, r.at, u.name, u.username, u.cons, u.patients, u.sub_until,
            COALESCE(SUM(CASE WHEN e.status = 'ok' THEN e.amount END), 0) AS paid_sum,
            COALESCE(SUM(CASE WHEN e.status = 'ok' THEN e.reward END), 0) AS reward_sum,
            COUNT(CASE WHEN e.status = 'ok' THEN 1 END) AS payments
     FROM referrals r LEFT JOIN users u ON u.uid = r.uid LEFT JOIN ref_earnings e ON e.uid = r.uid AND e.referrer = r.referrer
     WHERE r.referrer = ? GROUP BY r.uid ORDER BY r.at DESC LIMIT 500`, uid);
  const now = Date.now();
  const referrals = people.map((p) => ({
    // Имя как в профиле тренажёра; фамилию сокращаем до инициала — контакты приглашённых партнёру не показываем
    name: shortName(p.name),
    at: p.at,
    status: p.payments ? "paid" : (p.cons || p.patients) ? "active" : "joined",
    premium: p.sub_until === -1 || p.sub_until > now,
    patients: p.patients || 0,
    paid_sum: round2(p.paid_sum),
    reward_sum: round2(p.reward_sum),
    payments: p.payments,
  }));
  const payouts = hub.all("SELECT id, amount, method, status, created_at, decided_at, note FROM ref_payouts WHERE uid = ? ORDER BY id DESC LIMIT 50", uid)
    .map((r) => ({ ...r, amount: round2(r.amount) }));
  const recent = hub.all("SELECT e.at, e.amount, e.reward, e.rate, e.kind, e.plan, u.name FROM ref_earnings e LEFT JOIN users u ON u.uid = e.uid WHERE e.referrer = ? AND e.status = 'ok' ORDER BY e.at DESC LIMIT 30", uid)
    .map((r) => ({ at: r.at, amount: round2(r.amount), reward: round2(r.reward), rate: r.rate, kind: r.kind, plan: r.plan, name: shortName(r.name) }));
  return {
    code,
    rates: { first: REFERRAL.first, next: REFERRAL.next, partner: REFERRAL.partner },
    hold_days: REFERRAL.hold_days,
    min_payout: REFERRAL.min_payout,
    partner: partner ? { status: partner.status, rate: partner.rate, applied_at: partner.applied_at, decided_at: partner.decided_at, note: partner.status === "rejected" ? partner.note || "" : "" } : null,
    counts: {
      invited: referrals.length,
      active: referrals.filter((r) => r.status !== "joined").length,
      paying: referrals.filter((r) => r.status === "paid").length,
    },
    balance: refBalance(hub, uid),
    referrals,
    recent,
    payouts,
  };
}

function shortName(name) {
  const parts = String(name || "Без имени").trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

/** Заявка в партнёры. Повторная заявка после отказа — можно; активного партнёра не трогаем. */
export function partnerApply(hub, uid, info) {
  uid = String(uid);
  const row = partnerRow(hub, uid);
  if (row?.status === "active") return { status: "active" };
  if (row?.status === "excluded") return { status: "excluded" };
  hub.sql.exec(
    `INSERT INTO partners (uid, status, rate, applied_at, info) VALUES (?, 'applied', ?, ?, ?)
     ON CONFLICT(uid) DO UPDATE SET status = 'applied', applied_at = excluded.applied_at, info = excluded.info`,
    uid, REFERRAL.partner, Date.now(), JSON.stringify(info),
  );
  return { status: "applied" };
}

/** Запрос выплаты: вся доступная сумма, реквизиты — в момент запроса */
export function payoutRequest(hub, uid, { method, details }) {
  uid = String(uid);
  if (hub.one("SELECT 1 AS x FROM ref_payouts WHERE uid = ? AND status = 'requested'", uid)) {
    return { error: "Предыдущая выплата ещё в работе — дождитесь её, пожалуйста", code: "payout_pending" };
  }
  const bal = refBalance(hub, uid);
  if (bal.available < REFERRAL.min_payout) {
    return { error: `Вывести можно от ${REFERRAL.min_payout} ₽. Сейчас доступно ${bal.available} ₽.`, code: "payout_min" };
  }
  hub.sql.exec(
    "INSERT INTO ref_payouts (uid, amount, method, details, status, created_at) VALUES (?, ?, ?, ?, 'requested', ?)",
    uid, bal.available, method, JSON.stringify(details), Date.now(),
  );
  return { ok: true, amount: bal.available };
}

/** Перенос при объединении аккаунтов (веб → Telegram) */
export function partnersMerge(hub, from, to) {
  for (const sql of [
    "UPDATE OR IGNORE referrals SET uid = ? WHERE uid = ?",
    "UPDATE referrals SET referrer = ? WHERE referrer = ?",
    "UPDATE ref_earnings SET referrer = ? WHERE referrer = ?",
    "UPDATE ref_earnings SET uid = ? WHERE uid = ?",
    "UPDATE ref_payouts SET uid = ? WHERE uid = ?",
    "UPDATE OR IGNORE partners SET uid = ? WHERE uid = ?",
    "UPDATE OR IGNORE ref_codes SET uid = ? WHERE uid = ?",
  ]) hub.sql.exec(sql, to, from);
  hub.sql.exec("DELETE FROM referrals WHERE uid = ? AND referrer = ?", to, to);
}

// ---------------------------------------------------
// Админка
// ---------------------------------------------------
export function adminPartners(hub) {
  const rows = hub.all(
    `SELECT p.uid, p.status, p.rate, p.applied_at, p.decided_at, p.info, p.note, p.granted, u.name, u.username
     FROM partners p LEFT JOIN users u ON u.uid = p.uid ORDER BY CASE p.status WHEN 'applied' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, p.applied_at DESC LIMIT 500`);
  // Все, у кого есть приглашённые (и обычные пользователи), — со сводкой
  const refs = hub.all(
    `SELECT r.referrer AS uid, u.name, u.username, COUNT(DISTINCT r.uid) AS invited,
            (SELECT COUNT(DISTINCT e.uid) FROM ref_earnings e WHERE e.referrer = r.referrer AND e.status = 'ok') AS paying,
            (SELECT COALESCE(SUM(e.amount), 0) FROM ref_earnings e WHERE e.referrer = r.referrer AND e.status = 'ok') AS revenue,
            (SELECT COALESCE(SUM(e.reward), 0) FROM ref_earnings e WHERE e.referrer = r.referrer AND e.status = 'ok') AS earned
     FROM referrals r LEFT JOIN users u ON u.uid = r.referrer GROUP BY r.referrer ORDER BY earned DESC, invited DESC LIMIT 500`);
  const balances = Object.fromEntries(refs.map((r) => [r.uid, refBalance(hub, r.uid)]));
  return {
    partners: rows.map((r) => ({ ...r, info: safeJson(r.info), balance: refBalance(hub, r.uid) })),
    referrers: refs.map((r) => ({ ...r, revenue: round2(r.revenue), earned: round2(r.earned), balance: balances[r.uid] })),
    payouts: hub.all(
      `SELECT p.id, p.uid, p.amount, p.method, p.details, p.status, p.created_at, p.decided_at, p.admin, p.note, u.name, u.username
       FROM ref_payouts p LEFT JOIN users u ON u.uid = p.uid ORDER BY CASE p.status WHEN 'requested' THEN 0 ELSE 1 END, p.id DESC LIMIT 300`)
      .map((r) => ({ ...r, details: safeJson(r.details) })),
    earnings: hub.all(
      `SELECT e.op, e.referrer, e.uid, e.amount, e.rate, e.reward, e.plan, e.kind, e.at, e.status, e.note, a.name AS referrer_name, b.name AS user_name
       FROM ref_earnings e LEFT JOIN users a ON a.uid = e.referrer LEFT JOIN users b ON b.uid = e.uid ORDER BY e.at DESC LIMIT 300`),
    config: REFERRAL,
  };
}

function safeJson(s) {
  try { return JSON.parse(s || "null"); } catch { return null; }
}
