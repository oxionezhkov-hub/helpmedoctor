// Блогеры в партнёрке: воронка переговоров в админке (Партнёры → Блогеры).
// Карточка блогера: площадка, аудитория, этап, следующий шаг, чек-лист, ERID. Когда блогер зарегистрирован,
// карточка связывается с его uid — и подтягивает живую статистику личной ссылки (приглашённые, оплаты, начисления).
// Хранится в SQLite HubDO. Инструкция, шаблоны и план запуска — на странице админки (public/admin/bloggers-guide.js).
import { refBalance, refCode } from "./partners.js";

// Этапы воронки (порядок важен: по нему строится доска и конверсия)
export const BLOGGER_STAGES = ["found", "contacted", "talks", "agreed", "onboarded", "published", "repeat", "lost"];
const FIELDS = {
  name: 120, handle: 80, platform: 20, url: 300, niche: 200, segment: 40, contact: 200, offer: 20,
  next_action: 300, post_url: 300, erid: 60, notes: 4000, lost_reason: 300, owner: 30,
};
const NUMS = ["audience", "reach", "fee", "rate", "next_at", "post_at"];
const round2 = (v) => Math.round(Number(v || 0) * 100) / 100;

export function initBloggerTables(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS bloggers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, handle TEXT, platform TEXT, url TEXT,
      audience INTEGER DEFAULT 0, reach INTEGER DEFAULT 0, niche TEXT, segment TEXT, contact TEXT, stage TEXT DEFAULT 'found', owner TEXT,
      offer TEXT, fee REAL DEFAULT 0, rate REAL, uid TEXT, next_action TEXT, next_at INTEGER, post_url TEXT, post_at INTEGER, erid TEXT,
      checklist TEXT, notes TEXT, lost_reason TEXT, created_at INTEGER, updated_at INTEGER, stage_at INTEGER, created_by TEXT);
    CREATE INDEX IF NOT EXISTS bloggers_stage ON bloggers (stage);
    CREATE TABLE IF NOT EXISTS blogger_log (id INTEGER PRIMARY KEY AUTOINCREMENT, blogger_id INTEGER, ts INTEGER, admin TEXT, kind TEXT, text TEXT);
    CREATE INDEX IF NOT EXISTS blogger_log_id ON blogger_log (blogger_id, ts);
  `);
}

function safeJson(s, def) {
  try { return JSON.parse(s || "null") ?? def; } catch { return def; }
}

/** uid из ввода админа: число / w… / @username (ищем среди пользователей) */
export function resolveUid(hub, input) {
  const s = String(input || "").trim();
  if (!s) return "";
  const handle = s.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "");
  if (/^(\d{3,15}|w[\w-]{3,40})$/.test(handle) && hub.one("SELECT 1 AS x FROM users WHERE uid = ?", handle)) return handle;
  const byName = hub.one("SELECT uid FROM users WHERE LOWER(username) = LOWER(?)", handle);
  if (byName) return byName.uid;
  throw new Error(`Пользователь «${s}» не найден — пусть блогер сначала зайдёт в бота или приложение`);
}

/** Живая статистика личной ссылки блогера (с момента выхода поста — отдельно) */
function statsFor(hub, uid, postAt) {
  if (!uid) return null;
  const r = hub.one(
    `SELECT COUNT(*) AS invited,
            SUM(CASE WHEN COALESCE(u.cons, 0) > 0 OR COALESCE(u.patients, 0) > 0 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN r.at >= ? THEN 1 ELSE 0 END) AS after_post,
            MAX(r.at) AS last_at
     FROM referrals r LEFT JOIN users u ON u.uid = r.uid WHERE r.referrer = ?`, Number(postAt) || 0, uid);
  const e = hub.one(
    `SELECT COUNT(DISTINCT uid) AS paying, COALESCE(SUM(amount), 0) AS revenue, COALESCE(SUM(reward), 0) AS earned
     FROM ref_earnings WHERE referrer = ? AND status = 'ok'`, uid);
  const p = hub.one("SELECT status, rate FROM partners WHERE uid = ?", uid);
  const u = hub.one("SELECT name, username FROM users WHERE uid = ?", uid);
  return {
    invited: r?.invited || 0, active: r?.active || 0, after_post: postAt ? r?.after_post || 0 : null, last_at: r?.last_at || null,
    paying: e?.paying || 0, revenue: round2(e?.revenue), earned: round2(e?.earned),
    partner: p ? { status: p.status, rate: p.rate } : null,
    user: u ? { name: u.name, username: u.username } : null,
    balance: refBalance(hub, uid),
  };
}

function row(hub, b, base) {
  const stats = statsFor(hub, b.uid, b.post_at);
  const code = b.uid ? refCode(hub, b.uid) : null;
  const utm = `utm_source=blogger&utm_medium=${encodeURIComponent(b.platform || "other")}&utm_campaign=${encodeURIComponent((b.handle || `b${b.id}`).replace(/^@/, ""))}`;
  return {
    ...b,
    checklist: safeJson(b.checklist, {}),
    stats,
    links: code ? { site: `${base}/?ref=r_${code}&${utm}`, bot: `https://t.me/${hub.env.BOT_USERNAME || "helpmedoctor_aibot"}?start=r_${code}`, code } : null,
  };
}

export function adminBloggers(hub) {
  const base = String(hub.env.PUBLIC_URL || "https://helpmedoctor.ru").replace(/\/$/, "");
  const rows = hub.all("SELECT * FROM bloggers ORDER BY COALESCE(next_at, 9e15) ASC, updated_at DESC LIMIT 1000").map((b) => row(hub, b, base));
  return { rows, stages: BLOGGER_STAGES, plan: hub.getSetting("bloggers_plan", {}) || {} };
}

export function bloggerLog(hub, id) {
  return hub.all("SELECT id, ts, admin, kind, text FROM blogger_log WHERE blogger_id = ? ORDER BY ts DESC, id DESC LIMIT 200", Number(id));
}

function log(hub, id, admin, kind, text) {
  hub.sql.exec("INSERT INTO blogger_log (blogger_id, ts, admin, kind, text) VALUES (?, ?, ?, ?, ?)", Number(id), Date.now(), String(admin || ""), kind, String(text || "").slice(0, 2000));
}

/** Создать или обновить карточку. Смена этапа и связь с пользователем пишутся в историю. */
export function bloggerSave(hub, a, admin) {
  const now = Date.now();
  const id = Number(a.id) || 0;
  const cur = id ? hub.one("SELECT * FROM bloggers WHERE id = ?", id) : null;
  if (id && !cur) throw new Error("Карточка не найдена");
  const v = {};
  for (const [k, max] of Object.entries(FIELDS)) if (k in a) v[k] = String(a[k] ?? "").trim().slice(0, max);
  for (const k of NUMS) if (k in a) v[k] = a[k] === "" || a[k] == null ? null : Number(a[k]) || 0;
  if ("rate" in v && v.rate != null) v.rate = Math.min(0.9, Math.max(0, v.rate));
  if ("stage" in a) {
    if (!BLOGGER_STAGES.includes(a.stage)) throw new Error("Неизвестный этап");
    v.stage = a.stage;
  }
  if ("checklist" in a) v.checklist = JSON.stringify(Object.fromEntries(Object.entries(a.checklist || {}).filter(([, x]) => x).map(([k]) => [String(k).slice(0, 40), true])));
  if ("uid" in a) v.uid = resolveUid(hub, a.uid);
  if (!cur && !v.name && !v.handle) throw new Error("Укажите имя или ник блогера");

  if (!cur) {
    v.stage ||= "found";
    const cols = Object.keys(v);
    hub.sql.exec(
      `INSERT INTO bloggers (${cols.join(", ")}, created_at, updated_at, stage_at, created_by) VALUES (${cols.map(() => "?").join(", ")}, ?, ?, ?, ?)`,
      ...cols.map((k) => v[k]), now, now, now, String(admin || ""),
    );
    const newId = hub.one("SELECT last_insert_rowid() AS id").id;
    log(hub, newId, admin, "created", `Добавлен на этап «${v.stage}»`);
    if (v.uid) log(hub, newId, admin, "uid", `Связан с пользователем ${v.uid}`);
    hub.audit?.(admin, "blogger_create", String(newId), { name: v.name || v.handle });
    return { ok: true, id: newId };
  }

  const changed = Object.keys(v).filter((k) => String(v[k] ?? "") !== String(cur[k] ?? ""));
  if (!changed.length) return { ok: true, id };
  if (changed.includes("stage")) v.stage_at = now;
  const cols = changed.concat(changed.includes("stage") ? ["stage_at"] : []);
  hub.sql.exec(`UPDATE bloggers SET ${cols.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...cols.map((k) => v[k]), now, id);
  if (changed.includes("stage")) log(hub, id, admin, "stage", `${cur.stage} → ${v.stage}${v.stage === "lost" && v.lost_reason ? `: ${v.lost_reason}` : ""}`);
  if (changed.includes("uid")) log(hub, id, admin, "uid", v.uid ? `Связан с пользователем ${v.uid}` : "Связь с пользователем снята");
  if (changed.includes("next_action") || changed.includes("next_at")) log(hub, id, admin, "next", `Следующий шаг: ${v.next_action ?? cur.next_action ?? ""}`);
  if (changed.includes("post_url") && v.post_url) log(hub, id, admin, "post", `Публикация: ${v.post_url}`);
  return { ok: true, id };
}

export const BLOGGER_OPS = {
  bloggers: (h) => adminBloggers(h),
  blogger_log: (h, a) => bloggerLog(h, a.id),
  blogger_save: (h, a, admin) => bloggerSave(h, a, admin),
  blogger_note: (h, a, admin) => {
    const text = String(a.text || "").trim();
    if (!text) throw new Error("Пустая заметка");
    if (!h.one("SELECT 1 AS x FROM bloggers WHERE id = ?", Number(a.id))) throw new Error("Карточка не найдена");
    log(h, a.id, admin, "note", text);
    h.sql.exec("UPDATE bloggers SET updated_at = ? WHERE id = ?", Date.now(), Number(a.id));
    return { ok: true };
  },
  blogger_delete: (h, a, admin) => {
    const id = Number(a.id);
    h.sql.exec("DELETE FROM bloggers WHERE id = ?", id);
    h.sql.exec("DELETE FROM blogger_log WHERE blogger_id = ?", id);
    h.audit?.(admin, "blogger_delete", String(id));
    return { ok: true };
  },
  // План запуска: отмеченные шаги { ключ: { by, at } }
  bloggers_plan: (h, a, admin) => {
    const plan = h.getSetting("bloggers_plan", {}) || {};
    const key = String(a.key || "").slice(0, 40);
    if (!key) throw new Error("Нет шага");
    if (a.done) plan[key] = { by: String(admin || ""), at: Date.now() };
    else delete plan[key];
    h.setSetting("bloggers_plan", plan);
    return { ok: true, plan };
  },
};
