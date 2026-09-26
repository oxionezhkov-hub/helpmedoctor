// =====================================================
// HubDO — один на весь сервис (idFromName("hub")).
// Реестр пользователей, события и расход ИИ для аналитики, вся переписка бота,
// платежи, коды входа, задачи, рассылки и настройки админки. Хранилище — SQLite Durable Object.
// =====================================================
import { DurableObject } from "cloudflare:workers";
import { adminIds, AI_CAP_DEFAULT, AI_FALLBACKS, AI_FREE_NEURONS_PER_DAY, AUTOPAY_MAX_FAILS, PLANS, planPrice, productLabel } from "../config.js";
import { cancelSubscription, chargeSubscription } from "../lib/tochka.js";
import { mskDate, mskParts, utcDate } from "../lib/util.js";
import { tg, btn } from "../lib/telegram.js";
import * as A from "../lib/analytics.js";

const NOTIFY_KINDS = A.NOTIFY_KINDS;

const LOGIN_TTL_MS = 10 * 60 * 1000;
const HOUR = 3600000;

// Колонки сводки пользователя (приходят из UserDO с каждым событием)
const USER_COLS = {
  search: "TEXT", prof_lc: "TEXT",
  name: "TEXT", username: "TEXT", registered_at: "INTEGER", last_active: "INTEGER DEFAULT 0",
  cons: "INTEGER DEFAULT 0", patients: "INTEGER DEFAULT 0", quizzes: "INTEGER DEFAULT 0", paid: "INTEGER DEFAULT 0",
  level: "TEXT", profession: "TEXT", specs: "TEXT", xp: "INTEGER DEFAULT 0", lvl: "INTEGER DEFAULT 1", streak: "INTEGER DEFAULT 0",
  avg_rating: "REAL DEFAULT 0", ratings_count: "INTEGER DEFAULT 0", correct_streak: "INTEGER DEFAULT 0",
  sub_until: "INTEGER DEFAULT 0", sub_plan: "TEXT", onboarding_done: "INTEGER DEFAULT 1", about: "TEXT", expectations: "TEXT",
  notifications: "INTEGER DEFAULT 1", feedback_count: "INTEGER DEFAULT 0", blocked: "INTEGER DEFAULT 0", bot_blocked: "INTEGER DEFAULT 0",
  ref: "TEXT", last_source: "TEXT", extra_today: "INTEGER DEFAULT 0",
};
const SUMMARY_KEYS = Object.keys(USER_COLS).filter((k) => k !== "registered_at");

export class HubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, name TEXT, username TEXT, registered_at INTEGER,
        cons INTEGER DEFAULT 0, patients INTEGER DEFAULT 0, quizzes INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, last_active INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cron (id INTEGER PRIMARY KEY CHECK (id = 1), kind TEXT, cursor TEXT);
      CREATE TABLE IF NOT EXISTS logins (code TEXT PRIMARY KEY, uid TEXT, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS identities (provider TEXT, sub TEXT, uid TEXT, email TEXT, name TEXT, created_at INTEGER, PRIMARY KEY (provider, sub));
      CREATE INDEX IF NOT EXISTS identities_uid ON identities (uid);
      CREATE TABLE IF NOT EXISTS aliases (from_uid TEXT PRIMARY KEY, to_uid TEXT, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS payments (op TEXT PRIMARY KEY, uid TEXT, plan TEXT, created_at INTEGER, done INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS daily (day TEXT, metric TEXT, value INTEGER, PRIMARY KEY (day, metric));
      CREATE TABLE IF NOT EXISTS active (day TEXT, uid TEXT, PRIMARY KEY (day, uid));
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS feedback (uid TEXT, ts INTEGER, rating INTEGER, text TEXT, source TEXT, PRIMARY KEY (uid, ts));

      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, hour INTEGER, dow INTEGER,
        uid TEXT, type TEXT, source TEXT, meta TEXT, dur INTEGER, val REAL);
      CREATE INDEX IF NOT EXISTS ev_ts ON events (ts);
      CREATE INDEX IF NOT EXISTS ev_uid ON events (uid, ts);
      CREATE INDEX IF NOT EXISTS ev_type ON events (type, ts);

      CREATE TABLE IF NOT EXISTS ai_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, day_utc TEXT, uid TEXT, kind TEXT,
        model TEXT, tin INTEGER DEFAULT 0, tout INTEGER DEFAULT 0, audio_sec REAL DEFAULT 0, neurons REAL DEFAULT 0, ms INTEGER, ok INTEGER, err TEXT, estimated INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS ai_ts ON ai_usage (ts);

      CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, uid TEXT, dir TEXT, kind TEXT, text TEXT,
        admin TEXT, ref TEXT, tg_mid INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, err TEXT, buttons TEXT);
      CREATE INDEX IF NOT EXISTS chat_uid ON chat (uid, ts);
      CREATE INDEX IF NOT EXISTS chat_kind ON chat (kind, ts);

      CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT, ts INTEGER, admin TEXT, text TEXT);
      CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, admin TEXT, action TEXT, target TEXT, details TEXT);
      CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, text TEXT, buttons TEXT, updated_at INTEGER);

      CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, descr TEXT, type TEXT, status TEXT, priority TEXT,
        assignee TEXT, due TEXT, labels TEXT, impact INTEGER, effort INTEGER, links TEXT, checklist TEXT, created_by TEXT, created_at INTEGER, updated_at INTEGER, sort REAL);
      CREATE TABLE IF NOT EXISTS task_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, ts INTEGER, admin TEXT, text TEXT);
      CREATE TABLE IF NOT EXISTS task_history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, ts INTEGER, admin TEXT, field TEXT, old TEXT, new TEXT);

      CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER, admin TEXT, text TEXT, buttons TEXT, filter TEXT,
        status TEXT, scheduled_at INTEGER, total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, started_at INTEGER, finished_at INTEGER);
      CREATE TABLE IF NOT EXISTS autopay (uid TEXT PRIMARY KEY, op TEXT, plan TEXT, price REAL, next_at INTEGER, status TEXT,
        fails INTEGER DEFAULT 0, trial INTEGER DEFAULT 0, notified INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER, last_charge_at INTEGER, last_error TEXT);
      CREATE TABLE IF NOT EXISTS bc_targets (bid INTEGER, uid TEXT, status TEXT, ts INTEGER, err TEXT, clicked INTEGER DEFAULT 0, tg_mid INTEGER DEFAULT 0, PRIMARY KEY (bid, uid));
    `);
    // Миграции: новые колонки в старых таблицах
    for (const [col, type] of Object.entries(USER_COLS)) this.addColumn("users", col, type);
    this.addColumn("payments", "amount", "REAL DEFAULT 0");
    this.addColumn("payments", "status", "TEXT DEFAULT 'link'");
    this.addColumn("payments", "error", "TEXT");
    this.addColumn("payments", "updated_at", "INTEGER");
    this.addColumn("payments", "admin", "TEXT");
    this.addColumn("payments", "note", "TEXT");
    this.addColumn("feedback", "status", "TEXT DEFAULT 'new'");
    // Код входа для привязки Telegram к веб-аккаунту: purpose = 'link', owner — uid веб-аккаунта
    this.addColumn("logins", "purpose", "TEXT");
    this.addColumn("logins", "owner", "TEXT");
    this.addColumn("logins", "ref", "TEXT");
    this.addColumn("feedback", "task_id", "INTEGER");
    // Когда задача закрыта — для вкладки «История» в трекере
    this.addColumn("tasks", "done_at", "INTEGER");
    for (const r of this.all("SELECT uid FROM users WHERE search IS NULL LIMIT 20000")) this.refreshSearch(r.uid);
    this.sql.exec("UPDATE payments SET status = 'paid' WHERE done = 1 AND (status IS NULL OR status = 'link')");
  }

  addColumn(table, col, type) {
    try {
      this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    } catch {}
  }

  all(q, ...args) {
    return this.sql.exec(q, ...args).toArray();
  }

  one(q, ...args) {
    return this.sql.exec(q, ...args).toArray()[0] || null;
  }

  getMeta(k, def = null) {
    const r = this.one("SELECT v FROM meta WHERE k = ?", k);
    if (!r) return def;
    try { return JSON.parse(r.v); } catch { return r.v; }
  }

  setMeta(k, v) {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, JSON.stringify(v));
  }

  getSetting(k, def = null) {
    const r = this.one("SELECT v FROM settings WHERE k = ?", k);
    if (!r) return def;
    try { return JSON.parse(r.v); } catch { return def; }
  }

  setSetting(k, v) {
    this.sql.exec("INSERT OR REPLACE INTO settings (k, v) VALUES (?, ?)", k, JSON.stringify(v));
  }

  // ---------------------------------------------------
  // Пользователи
  // ---------------------------------------------------
  async registerUser(uid, { name = "", username = "", isNew = false, ref = "" } = {}) {
    uid = String(uid);
    const existed = !!this.one("SELECT 1 AS x FROM users WHERE uid = ?", uid);
    this.sql.exec(
      "INSERT INTO users (uid, name, username, registered_at, ref) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name, username = excluded.username",
      uid, name, username, Date.now(), ref || null,
    );
    this.refreshSearch(uid);
    if (!existed && isNew) {
      this.bump("new_users");
      await this.notifyNewUser(uid, name, username, ref);
    }
  }

  /** Сводка профиля из UserDO → строка в users */
  upsertUser(uid, s) {
    if (!s) return;
    const cols = SUMMARY_KEYS.filter((k) => s[k] !== undefined);
    if (!cols.length) return;
    const vals = cols.map((k) => (k === "specs" ? JSON.stringify(s[k] || []) : typeof s[k] === "boolean" ? (s[k] ? 1 : 0) : s[k]));
    const reg = s.registered_at || Date.now();
    this.sql.exec(
      `INSERT INTO users (uid, registered_at, ${cols.join(", ")}) VALUES (?, ?, ${cols.map(() => "?").join(", ")})
       ON CONFLICT(uid) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")},
         registered_at = COALESCE(NULLIF(users.registered_at, 0), excluded.registered_at)`,
      String(uid), reg, ...vals,
    );
    this.refreshSearch(uid);
  }

  /** SQLite lower() не понимает кириллицу — храним строку поиска в нижнем регистре, собранную в JS */
  refreshSearch(uid) {
    const u = this.one("SELECT name, username, profession FROM users WHERE uid = ?", String(uid));
    if (!u) return;
    const emails = this.all("SELECT email FROM identities WHERE uid = ?", String(uid)).map((r) => r.email || "").join(" ");
    this.sql.exec("UPDATE users SET search = ?, prof_lc = ? WHERE uid = ?",
      `${u.name || ""} ${u.username || ""} ${emails}`.trim().toLowerCase(), String(u.profession || "").toLowerCase(), String(uid));
  }

  async findByUsername(username) {
    const u = String(username || "").trim().replace(/^@/, "").toLowerCase();
    if (!u) return null;
    return this.one("SELECT uid, name, username FROM users WHERE lower(username) = ?", u);
  }

  async listUsers() {
    await this.seedFromKv();
    return this.all("SELECT uid FROM users").map((r) => r.uid);
  }

  async seedFromKv() {
    if (this.one("SELECT v FROM meta WHERE k = 'seeded'")) return;
    const KV = this.env.HELPMEDOCTOR;
    if (KV) {
      let cursor;
      do {
        const page = await KV.list({ prefix: "profile:", cursor });
        for (const k of page.keys) {
          const uid = k.name.slice("profile:".length);
          this.sql.exec("INSERT OR IGNORE INTO users (uid, name, username, registered_at) VALUES (?, '', '', 0)", uid);
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
    }
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES ('seeded', '1')");
  }

  userRow(uid) {
    return this.one("SELECT * FROM users WHERE uid = ?", String(uid));
  }

  setBotBlocked(uid, blocked) {
    this.sql.exec("UPDATE users SET bot_blocked = ? WHERE uid = ?", blocked ? 1 : 0, String(uid));
  }

  // ---------------------------------------------------
  // События, ИИ, переписка
  // ---------------------------------------------------
  /**
   * Событие пользователя. summary — свежая сводка профиля (обновляет строку в users).
   * @param {{uid, type, source?, meta?, dur?, val?, ts?, summary?}} e
   */
  async logEvent(e) {
    const ts = e.ts || Date.now();
    const p = mskParts(ts);
    const uid = e.uid ? String(e.uid) : "";
    this.sql.exec(
      "INSERT INTO events (ts, day, hour, dow, uid, type, source, meta, dur, val) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ts, p.day, p.hour, p.dow, uid, e.type, e.source || null, e.meta ? JSON.stringify(e.meta) : null, e.dur ?? null, e.val ?? null,
    );
    if (uid) {
      this.sql.exec("INSERT OR IGNORE INTO active (day, uid) VALUES (?, ?)", p.day, uid);
      if (e.summary) this.upsertUser(uid, { ...e.summary, last_active: Math.max(ts, e.summary.last_active || 0), ...(e.source ? { last_source: e.source } : {}) });
      else this.sql.exec("UPDATE users SET last_active = MAX(COALESCE(last_active, 0), ?) WHERE uid = ?", ts, uid);
    }
    if (e.type === "finish") this.bump("consultations");
    if (e.type === "quiz_done") this.bump("quizzes");
    if (e.type === "patient_failed" || e.type === "ai_error") await this.checkAiErrors();
  }

  /** Пачка событий (бэкфилл истории) */
  logEvents(list) {
    for (const e of list) {
      const p = mskParts(e.ts);
      this.sql.exec(
        "INSERT INTO events (ts, day, hour, dow, uid, type, source, meta, dur, val) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        e.ts, p.day, p.hour, p.dow, String(e.uid), e.type, e.source || null, JSON.stringify({ ...(e.meta || {}), backfill: 1 }), e.dur ?? null, e.val ?? null,
      );
      this.sql.exec("INSERT OR IGNORE INTO active (day, uid) VALUES (?, ?)", p.day, String(e.uid));
    }
  }

  async logAi(r) {
    const ts = Date.now();
    this.sql.exec(
      `INSERT INTO ai_usage (ts, day, day_utc, uid, kind, model, tin, tout, audio_sec, neurons, ms, ok, err, estimated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ts, mskDate(ts), utcDate(ts), r.uid || "", r.kind || "other", r.model || "", r.tin || 0, r.tout || 0, r.audio_sec || 0,
      r.neurons || 0, r.ms || 0, r.ok ? 1 : 0, r.err || null, r.estimated ? 1 : 0,
    );
    if (!r.ok) await this.checkAiErrors();
    await this.checkAiLimit();
  }

  async logChat(r) {
    this.sql.exec(
      "INSERT INTO chat (ts, uid, dir, kind, text, admin, ref, tg_mid, ok, err, buttons) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      r.ts || Date.now(), String(r.uid), r.dir || "out", r.kind || "bot", String(r.text || "").slice(0, 4000), r.admin || null,
      r.ref != null ? String(r.ref) : null, r.tg_mid || 0, r.ok === 0 ? 0 : 1, r.err || null, r.buttons || null,
    );
    // Пользователь заблокировал бота — отмечаем, чтобы не слать рассылки впустую
    if (r.dir === "out" && r.ok === 0 && /blocked|deactivated|chat not found/i.test(r.err || "")) this.setBotBlocked(r.uid, true);
    if (r.dir === "in") this.setBotBlocked(r.uid, false);
  }

  /** Сообщение админа или рассылки, на которое пользователь ответил через «Ответить» */
  findAdminMessage(uid, tgMid) {
    if (!tgMid) return null;
    return this.one("SELECT id, kind, admin, ref FROM chat WHERE uid = ? AND tg_mid = ? AND dir = 'out' AND kind IN ('admin', 'broadcast') ORDER BY id DESC LIMIT 1", String(uid), tgMid);
  }

  async userReplied(uid, text) {
    const u = this.userRow(uid) || {};
    await this.notifyAdmin(`💬 <b>Ответ пользователя</b> — ${esc(u.name || "")}${u.username ? " @" + esc(u.username) : ""} (${uid})\n${esc(text).slice(0, 1500)}`,
      "reply", { kb: [[{ text: "Открыть переписку", url: this.adminUrl(`/users/${uid}?tab=chat`) }]] });
  }

  // ---------------------------------------------------
  // Вход на сайт и в админку через бота
  // ---------------------------------------------------
  async createLogin(code, { purpose = null, owner = null, ref = "" } = {}) {
    this.sql.exec("DELETE FROM logins WHERE created_at < ?", Date.now() - LOGIN_TTL_MS);
    this.sql.exec("INSERT INTO logins (code, uid, created_at, purpose, owner, ref) VALUES (?, NULL, ?, ?, ?, ?)", code, Date.now(), purpose, owner, String(ref || "").slice(0, 64));
  }

  /** Подтверждение кода из бота. Возвращает { purpose } или false, если код устарел или он для другого действия */
  async confirmLogin(code, uid, purpose = "login") {
    const row = this.one("SELECT uid, created_at, purpose FROM logins WHERE code = ?", code);
    if (!row || row.created_at < Date.now() - LOGIN_TTL_MS || (row.purpose || "login") !== purpose) return false;
    this.sql.exec("UPDATE logins SET uid = ? WHERE code = ?", String(uid), code);
    return { purpose: row.purpose || "login" };
  }

  /** Код привязки Telegram: к какому веб-аккаунту (почты) — бот показывает их перед подтверждением */
  async linkPreview(code) {
    const row = this.one("SELECT owner, created_at, purpose FROM logins WHERE code = ?", code);
    if (!row || row.purpose !== "link" || row.created_at < Date.now() - LOGIN_TTL_MS) return null;
    const ids = this.all("SELECT provider, email, name FROM identities WHERE uid = ?", row.owner);
    const u = this.one("SELECT name FROM users WHERE uid = ?", row.owner);
    return { owner: row.owner, name: u?.name || ids[0]?.name || "", accounts: ids.map((i) => ({ provider: i.provider, email: i.email })) };
  }

  /**
   * Результат кода входа. Обычный код («login») забирает кто угодно — так работает вход через бота.
   * Код после Google/Яндекса («oauth») — только браузер, начавший вход (owner = его nonce), чтобы чужую ссылку ?login= нельзя было подсунуть.
   * Код привязки Telegram («link») — только владелец веб-аккаунта; keep — не удалять код до успешной склейки.
   */
  async pollLogin(code, { owner = null, link = false, keep = false } = {}) {
    const row = this.one("SELECT uid, created_at, purpose, owner FROM logins WHERE code = ?", code);
    if (!row) return { status: "expired" };
    const p = row.purpose || "login";
    const allowed = link ? p === "link" && row.owner === String(owner) : p === "login" || (p === "oauth" && !!owner && row.owner === String(owner));
    if (!allowed) return { status: "expired" };
    if (row.created_at < Date.now() - LOGIN_TTL_MS) {
      this.sql.exec("DELETE FROM logins WHERE code = ?", code);
      return { status: "expired" };
    }
    if (!row.uid) return { status: "pending" };
    if (!keep) this.sql.exec("DELETE FROM logins WHERE code = ?", code);
    return { status: "ok", uid: row.uid };
  }

  async deleteLogin(code) {
    this.sql.exec("DELETE FROM logins WHERE code = ?", code);
  }

  /** Источник регистрации (метка from с сайта) для входа через бота */
  async loginRef(code) {
    return this.one("SELECT ref FROM logins WHERE code = ?", code)?.ref || "";
  }

  // ---------------------------------------------------
  // Платежи
  // ---------------------------------------------------
  async savePayment(op, uid, plan, amount = planPrice(plan)) {
    const now = Date.now();
    this.sql.exec(
      "INSERT OR IGNORE INTO payments (op, uid, plan, created_at, amount, status, updated_at) VALUES (?, ?, ?, ?, ?, 'link', ?)",
      op, String(uid), plan, now, Number(amount || 0), now,
    );
    this.bump("payment_links");
  }

  async paymentError(uid, plan, error) {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO payments (op, uid, plan, created_at, amount, status, error, updated_at) VALUES (?, ?, ?, ?, ?, 'error', ?, ?)",
      `err_${uid}_${now}`, String(uid), plan, now, Number(planPrice(plan) || 0), String(error).slice(0, 800), now,
    );
  }

  // ---------------------------------------------------
  // Способы входа: Google, Яндекс (provider + sub → uid) и склейка аккаунтов
  // ---------------------------------------------------
  async identityGet(provider, sub) {
    return this.one("SELECT provider, sub, uid, email, name FROM identities WHERE provider = ? AND sub = ?", provider, String(sub));
  }

  /** Привязать вход к uid. Если он уже привязан к другому аккаунту — { error: "taken" } */
  async identityLink(provider, sub, uid, { email = "", name = "" } = {}) {
    const row = await this.identityGet(provider, sub);
    if (row && row.uid !== String(uid)) return { error: "taken" };
    const same = this.one("SELECT sub FROM identities WHERE provider = ? AND uid = ?", provider, String(uid));
    if (same && same.sub !== String(sub)) return { error: "has_other" };
    this.sql.exec(
      "INSERT INTO identities (provider, sub, uid, email, name, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, sub) DO UPDATE SET email = excluded.email, name = excluded.name",
      provider, String(sub), String(uid), String(email).slice(0, 200), String(name).slice(0, 80), Date.now(),
    );
    this.refreshSearch(uid);
    return { ok: true };
  }

  async identitiesOf(uid) {
    return this.all("SELECT provider, email, name, created_at FROM identities WHERE uid = ? ORDER BY created_at", String(uid));
  }

  /** Отвязка: проверка «не последний способ входа» и удаление — одной операцией (без гонки двух запросов) */
  async identityUnlink(uid, provider, { hasTelegram = false } = {}) {
    const n = this.one("SELECT COUNT(*) AS n FROM identities WHERE uid = ?", String(uid)).n;
    if (!hasTelegram && n <= 1) return { error: "last" };
    this.sql.exec("DELETE FROM identities WHERE uid = ? AND provider = ?", String(uid), provider);
    this.refreshSearch(uid);
    return { ok: true };
  }

  /** Можно ли склеить веб-аккаунт from с Telegram-аккаунтом to: две активные автоподписки не склеиваем */
  async mergeCheck(from, to) {
    const a = this.one("SELECT status FROM autopay WHERE uid = ?", String(from));
    const b = this.one("SELECT status FROM autopay WHERE uid = ?", String(to));
    if (a?.status === "active" && b?.status === "active") return { error: "two_autopays" };
    return { ok: true };
  }

  /** Веб-аккаунт склеен с Telegram: старые сессии веб-аккаунта ведут в новый uid */
  async aliasGet(uid) {
    return this.one("SELECT to_uid FROM aliases WHERE from_uid = ?", String(uid))?.to_uid || null;
  }

  /** Переносит служебные записи с веб-аккаунта from на аккаунт to (данные профиля переносит UserDO) */
  async mergeUsers(from, to) {
    from = String(from);
    to = String(to);
    this.sql.exec("UPDATE identities SET uid = ? WHERE uid = ?", to, from);
    this.sql.exec("UPDATE payments SET uid = ? WHERE uid = ?", to, from);
    // Автоподписка: активная переезжает; неактивная (отменённая, неудачная) строка у to ей не мешает
    const fa = this.one("SELECT status FROM autopay WHERE uid = ?", from);
    const ta = this.one("SELECT status FROM autopay WHERE uid = ?", to);
    if (fa && (!ta || (fa.status === "active" && ta.status !== "active"))) {
      this.sql.exec("DELETE FROM autopay WHERE uid = ?", to);
      this.sql.exec("UPDATE autopay SET uid = ? WHERE uid = ?", to, from);
    }
    this.sql.exec("UPDATE aliases SET to_uid = ? WHERE to_uid = ?", to, from);
    this.sql.exec("INSERT OR REPLACE INTO aliases (from_uid, to_uid, created_at) VALUES (?, ?, ?)", from, to, Date.now());
    const src = this.one("SELECT ref, registered_at FROM users WHERE uid = ?", from);
    if (src) {
      this.sql.exec("UPDATE users SET ref = COALESCE(NULLIF(ref, ''), ?), registered_at = MIN(COALESCE(NULLIF(registered_at, 0), ?), ?) WHERE uid = ?",
        src.ref || "", src.registered_at || Date.now(), src.registered_at || Date.now(), to);
      this.sql.exec("DELETE FROM users WHERE uid = ?", from);
    }
    this.refreshSearch(to);
    return { ok: true };
  }

  async getPayment(op) {
    return this.one("SELECT op, uid, plan, done, status, amount FROM payments WHERE op = ?", op);
  }

  // ---------------------------------------------------
  // Автопродление (подписка Точки с сохранённой картой)
  // ---------------------------------------------------
  /** Подписка оформлена или продлена вручную: следующее списание — next_at по цене price */
  async autopaySet(uid, { op, plan = "month", price, next_at, trial = false }) {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO autopay (uid, op, plan, price, next_at, status, fails, trial, notified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, 0, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET op = excluded.op, plan = excluded.plan, price = excluded.price, next_at = excluded.next_at,
         status = 'active', fails = 0, trial = excluded.trial, notified = 0, updated_at = excluded.updated_at`,
      String(uid), op, plan, Number(price), next_at, trial ? 1 : 0, now, now,
    );
  }

  async autopayGet(uid) {
    return this.one("SELECT * FROM autopay WHERE uid = ?", String(uid));
  }

  /** Пользователь отключил автопродление: доступ остаётся до конца оплаченного срока */
  async autopayCancel(uid, reason = "user") {
    const row = this.one("SELECT op, status FROM autopay WHERE uid = ?", String(uid));
    if (!row || row.status !== "active") return false;
    this.sql.exec("UPDATE autopay SET status = 'cancelled', updated_at = ?, last_error = ? WHERE uid = ?", Date.now(), reason, String(uid));
    try {
      await cancelSubscription(this.env, row.op);
    } catch (e) {
      console.error("tochka cancel", e);
      await this.notifyAdmin(`⚠️ Не удалось отключить подписку в Точке (uid ${esc(uid)}, ${esc(row.op)}): ${esc(e.message)}. Списаний с нашей стороны не будет.`, "payment_error");
    }
    return true;
  }

  /**
   * Списание продлений: утром и вечером (cron). Перед концом пробного периода — предупреждение за сутки.
   * Неудачное списание повторяем на следующий день; после AUTOPAY_MAX_FAILS — отключаем автопродление.
   */
  async chargeDueSubs(now = Date.now()) {
    const bot = tg(this.env, { kind: "system" });
    // Предупреждение: завтра закончится пробный период и спишется месяц
    for (const r of this.all("SELECT * FROM autopay WHERE status = 'active' AND trial = 1 AND notified = 0 AND next_at > ? AND next_at <= ?", now, now + 36 * HOUR)) {
      this.sql.exec("UPDATE autopay SET notified = 1 WHERE uid = ?", r.uid);
      const when = new Date(r.next_at).toLocaleDateString("ru", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
      await bot.send(r.uid, `⏳ <b>Пробный премиум заканчивается ${when}</b>\n\nДальше подписка продлится автоматически: <b>${fmtRub(r.price)} ₽ в месяц</b>. Отключить автопродление можно в любой момент в профиле → «Подписка».`,
        [[{ text: "💎 Управлять подпиской", web_app: { url: this.appUrl("/plans") } }]]).catch(() => {});
    }
    let charged = 0;
    for (const r of this.all("SELECT * FROM autopay WHERE status = 'active' AND next_at <= ? LIMIT 200", now)) {
      let res;
      try {
        res = await chargeSubscription(this.env, r.op, r.price);
      } catch (e) {
        res = { ok: false, status: "ERROR", error: String(e.message || e).slice(0, 300) };
      }
      const user = this.env.USER.get(this.env.USER.idFromName(r.uid));
      if (res.ok) {
        const op = res.operationId || `${r.op}:${mskDate(now)}`;
        this.sql.exec("INSERT OR IGNORE INTO payments (op, uid, plan, created_at, amount, status, done, updated_at, note) VALUES (?, ?, ?, ?, ?, 'paid', 1, ?, 'автопродление')",
          op, r.uid, r.plan, now, r.price, now);
        this.bump("payments");
        this.bump("revenue", Math.round(r.price));
        const next = Math.max(r.next_at, now) + (PLANS[r.plan]?.days || 30) * 86400000;
        this.sql.exec("UPDATE autopay SET next_at = ?, fails = 0, trial = 0, notified = 0, last_charge_at = ?, last_error = NULL, updated_at = ? WHERE uid = ?", next, now, now, r.uid);
        await user.renewSubscription({ plan: r.plan, op, amount: r.price, until: next, wasTrial: !!r.trial }).catch((e) => console.error("renew", e));
        await this.notifyAdmin(`🔁 Автопродление: uid ${esc(r.uid)} · ${esc(productLabel(r.plan))} · ${fmtRub(r.price)} ₽${r.trial ? " (после пробного)" : ""}`, "payment");
        charged++;
      } else {
        const fails = (r.fails || 0) + 1;
        const err = res.error || res.status || "отказ";
        if (fails >= AUTOPAY_MAX_FAILS) {
          this.sql.exec("UPDATE autopay SET status = 'failed', fails = ?, last_error = ?, updated_at = ? WHERE uid = ?", fails, err, now, r.uid);
          await cancelSubscription(this.env, r.op).catch(() => {});
          await user.autopayEnded("failed").catch(() => {});
          await this.notifyAdmin(`⚠️ Автопродление отключено после ${fails} неудачных списаний: uid ${esc(r.uid)} · ${esc(err)}`, "payment_error");
        } else {
          // Пробуем снова через сутки; доступ пока не продлеваем
          this.sql.exec("UPDATE autopay SET fails = ?, next_at = ?, last_error = ?, updated_at = ? WHERE uid = ?", fails, now + 22 * HOUR, err, now, r.uid);
          if (fails === 1) {
            await bot.send(r.uid, `⚠️ <b>Не получилось продлить подписку</b>\n\nБанк не провёл списание ${fmtRub(r.price)} ₽. Проверьте карту — попробуем ещё раз завтра. Или оплатите вручную.`,
              [[{ text: "💎 Тарифы", web_app: { url: this.appUrl("/plans") } }]]).catch(() => {});
          }
        }
      }
    }
    return { charged };
  }

  async markPaymentDone(op, amount) {
    const row = this.one("SELECT done FROM payments WHERE op = ?", op);
    if (!row || row.done) return false;
    this.sql.exec("UPDATE payments SET done = 1, status = 'paid', amount = ?, updated_at = ? WHERE op = ?", Number(amount) || 0, Date.now(), op);
    this.bump("payments");
    this.bump("revenue", Math.round(Number(amount) || 0));
    return true;
  }

  /** Подарок/компенсация от админа — строка в истории платежей с суммой 0 */
  recordGift(uid, days, admin, reason) {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO payments (op, uid, plan, created_at, amount, status, updated_at, admin, note, done) VALUES (?, ?, 'gift', ?, 0, 'gift', ?, ?, ?, 1)",
      `gift_${uid}_${now}`, String(uid), now, now, admin || null, `${days} дн.${reason ? ` · ${reason}` : ""}`,
    );
  }

  setPaymentStatus(op, status, note) {
    this.sql.exec("UPDATE payments SET status = ?, note = COALESCE(?, note), updated_at = ? WHERE op = ?", status, note || null, Date.now(), op);
  }

  /** Цифры для сайта: только агрегаты, без личных данных */
  async publicStats() {
    if (this._stats && Date.now() - this._stats.at < 10 * 60000) return this._stats.data;
    this._stats = { at: Date.now(), data: this.computePublicStats() };
    return this._stats.data;
  }

  computePublicStats() {
    const today = mskDate();
    const cons = (d) => this.one("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = 'consultations' AND day >= ?", d).v;
    const weekAgo = mskDate(Date.now() - 7 * 86400000);
    const fb = this.one("SELECT COUNT(*) AS n, AVG(rating) AS avg FROM feedback WHERE rating > 0");
    return {
      users: this.one("SELECT COUNT(*) AS v FROM users").v,
      consultations_total: this.one("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = 'consultations'").v,
      consultations_today: cons(today),
      consultations_week: cons(weekAgo),
      rating: fb.n >= 10 ? Math.round(fb.avg * 10) / 10 : null,
      ratings: fb.n,
    };
  }

  bump(metric, by = 1, day = mskDate()) {
    this.sql.exec(
      "INSERT INTO daily (day, metric, value) VALUES (?, ?, ?) ON CONFLICT(day, metric) DO UPDATE SET value = value + excluded.value",
      day, metric, by,
    );
  }

  /** Совместимость со старыми вызовами UserDO.report */
  async track(event, uid, info) {
    if (!uid) return;
    this.sql.exec("INSERT OR IGNORE INTO active (day, uid) VALUES (?, ?)", mskDate(), String(uid));
    if (info) this.upsertUser(uid, { name: info.name, username: info.username, cons: info.cons, patients: info.patients, quizzes: info.quizzes, paid: info.paid });
  }

  // ---------------------------------------------------
  // Отзывы
  // ---------------------------------------------------
  async saveFeedback(uid, { name = "", username = "", rating = null, text = "", source = "", ts = Date.now() } = {}) {
    const existed = !!this.one("SELECT 1 AS x FROM feedback WHERE uid = ? AND ts = ?", String(uid), ts);
    this.sql.exec(
      "INSERT INTO feedback (uid, ts, rating, text, source, status) VALUES (?, ?, ?, ?, ?, 'new') ON CONFLICT(uid, ts) DO UPDATE SET rating = excluded.rating, text = excluded.text, status = 'new'",
      String(uid), ts, rating, text || "", source,
    );
    this.sql.exec("UPDATE users SET feedback_count = (SELECT COUNT(*) FROM feedback WHERE uid = ?) WHERE uid = ?", String(uid), String(uid));
    const stars = rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "";
    const who = `${esc(name)}${username ? " @" + esc(username) : ""} (${uid})`;
    const kb = [[{ text: "Ответить", url: this.adminUrl(`/feedback`) }]];
    await this.notifyAdmin(existed
      ? `💬 Отзыв дополнен — ${who}\n${esc(text)}`
      : `⭐ Новый отзыв ${stars} — ${who}${source === "bot" ? " · бот" : " · сайт"}${text ? `\n${esc(text)}` : ""}`, "feedback", { kb });
    if (!existed && rating && rating <= 2) {
      await this.notifyAdmin(`🚨 <b>Срочно: низкая оценка ${rating} ★</b> — ${who}`, "low_rating", { kb });
    }
  }

  // ---------------------------------------------------
  // Уведомления админам
  // ---------------------------------------------------
  /** Ссылка на экран приложения (в Telegram открывается как мини-приложение) */
  appUrl(path = "") {
    const base = (this.env.PUBLIC_URL || "").replace(/\/$/, "");
    return `${base}/app${path ? `?go=${encodeURIComponent(path)}` : ""}`;
  }

  adminUrl(path = "") {
    const base = (this.env.PUBLIC_URL || "").replace(/\/$/, "");
    return `${base}/admin${path ? `#${path}` : ""}`;
  }

  notifyPrefs(adminId) {
    return { ...Object.fromEntries(Object.keys(NOTIFY_KINDS).map((k) => [k, true])), ...(this.getSetting(`notify:${adminId}`, {}) || {}) };
  }

  /**
   * Уведомление всем админам, у кого включён этот вид.
   * @param {string} text HTML
   * @param {string} kind вид из NOTIFY_KINDS
   */
  async notifyAdmin(text, kind = "other", { kb = null, except = null, only = null } = {}) {
    const bot = tg(this.env, { log: false });
    const ids = adminIds(this.env).filter((id) => id !== except && (!only || only.includes(id)) && this.notifyPrefs(id)[kind] !== false);
    await Promise.all(ids.map(async (id) => {
      try {
        await bot.send(id, text, kb || undefined);
      } catch (e) {
        console.error("notifyAdmin", e);
      }
    }));
  }

  /** Новые пользователи: при наплыве (больше 20 в час) — одно сообщение в час */
  async notifyNewUser(uid, name, username, ref) {
    const now = Date.now();
    const w = this.getMeta("nu_window", { start: now, count: 0, pending: [] });
    if (now - w.start > HOUR) Object.assign(w, { start: now, count: 0 });
    w.count += 1;
    const line = `${esc(name || "—")} ${username ? "@" + esc(username) : ""} ${uid}${ref ? ` · из «${esc(ref)}»` : ""}`;
    if (w.count > 20) {
      w.pending = [...(w.pending || []), line].slice(-200);
      this.setMeta("nu_window", w);
      await this.wake(w.start + HOUR);
      return;
    }
    this.setMeta("nu_window", w);
    await this.notifyAdmin(`🆕 Новый пользователь: ${line}`, "new_user", { kb: [[{ text: "Карточка", url: this.adminUrl(`/users/${uid}`) }]] });
  }

  async flushNewUsers() {
    const w = this.getMeta("nu_window");
    if (!w?.pending?.length || Date.now() - w.start < HOUR) return;
    const list = w.pending;
    this.setMeta("nu_window", { start: Date.now(), count: 0, pending: [] });
    await this.notifyAdmin(`🆕 <b>Ещё ${list.length} новых пользователей за час</b>\n${list.slice(0, 40).join("\n")}${list.length > 40 ? "\n…" : ""}`, "new_user");
  }

  async checkAiErrors() {
    const since = Date.now() - 10 * 60000;
    const n = this.one("SELECT COUNT(*) AS n FROM ai_usage WHERE ts >= ? AND ok = 0", since).n
      + this.one("SELECT COUNT(*) AS n FROM events WHERE ts >= ? AND type IN ('ai_error', 'patient_failed')", since).n;
    const lastAlert = this.getMeta("ai_err_alert", 0);
    if (n > 5 && Date.now() - lastAlert > 30 * 60000) {
      this.setMeta("ai_err_alert", Date.now());
      const last = this.one("SELECT err FROM ai_usage WHERE ok = 0 ORDER BY id DESC LIMIT 1");
      await this.notifyAdmin(`⚠️ <b>Сбои ИИ: ${n} за 10 минут</b>${last?.err ? `\nПоследняя ошибка: ${esc(last.err)}` : ""}`, "ai_errors",
        { kb: [[{ text: "Ошибки в админке", url: this.adminUrl("/analytics?r=errors") }]] });
    }
  }

  /** Тексты системных сообщений, изменённые в админке */
  systemTexts() {
    return this.getSetting("texts", {}) || {};
  }

  aiUsedToday() {
    return this.one("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage WHERE day_utc = ?", utcDate()).n;
  }

  aiCap() {
    const v = Number(this.getSetting("ai_cap", AI_CAP_DEFAULT));
    return Number.isFinite(v) && v >= 0 ? v : AI_CAP_DEFAULT;
  }

  /** Маршрутизация ИИ для воркера: модели по шагам и «на сегодня уходим с Cloudflare на запасных» */
  aiRoute() {
    const cap = this.aiCap();
    const cf_blocked = this.getMeta("ai_cf_blocked") === utcDate() || (cap > 0 && this.aiUsedToday() >= cap);
    return { routing: this.getSetting("ai_routing", {}) || {}, cf_blocked };
  }

  fallbackNames() {
    return AI_FALLBACKS.filter((f) => this.env[f.secret]).map((f) => f.label);
  }

  /** Workers AI ответил «лимит исчерпан» — до конца суток UTC работаем через запасных */
  async aiCfBlocked(err = "") {
    const day = utcDate();
    if (this.getMeta("ai_cf_blocked") === day) return;
    this.setMeta("ai_cf_blocked", day);
    await this.notifyFallback(`Cloudflare ответил: ${esc(err)}`);
  }

  async notifyFallback(reason) {
    const day = utcDate();
    if (this.getMeta("ai_fallback_alert") === day) return;
    this.setMeta("ai_fallback_alert", day);
    const names = this.fallbackNames();
    await this.notifyAdmin(names.length
      ? `🔁 <b>ИИ переключён на запасной</b>: ${esc(names.join(", "))} — до 03:00 МСК, когда обнулится лимит Cloudflare.\n${reason}`
      : `🛑 <b>Бесплатные нейроны Cloudflare кончились</b>, а запасной ИИ не настроен (ключи CEREBRAS_API_KEY / GROQ_API_KEY).\n${reason}`, "ai_limit",
    { kb: [[{ text: "Модели ИИ", url: this.adminUrl("/analytics?r=ai") }]] });
  }

  async checkAiLimit() {
    const day = utcDate();
    const used = this.aiUsedToday();
    const cap = this.aiCap();
    if (cap > 0 && used >= cap) await this.notifyFallback(`Израсходовано ${Math.round(used)} нейронов из порога ${cap}.`);
    if (used >= AI_FREE_NEURONS_PER_DAY * 0.8 && this.getMeta("ai_limit_alert") !== day) {
      this.setMeta("ai_limit_alert", day);
      await this.notifyAdmin(`📈 Расход ИИ сегодня: ${Math.round(used)} из ${AI_FREE_NEURONS_PER_DAY} бесплатных нейронов (${Math.round((used / AI_FREE_NEURONS_PER_DAY) * 100)}%). Сверх лимита — $0.011 за 1000 нейронов.`, "ai_limit");
    }
  }

  /** Итоги дня (cron 21:00 МСК) */
  async dailySummary() {
    const t = mskDate();
    const d = A.daySummary(this, t);
    const text = `📊 <b>Итоги дня · ${t}</b>\n\n` +
      `🆕 Новых: ${d.new_users}\n👥 Активных: ${d.active}\n🩺 Приёмов: ${d.finished} (оценка ${d.avg_rating ?? "—"})\n` +
      `📝 Тестов пройдено: ${d.quizzes}\n💰 Выручка: ${d.revenue} ₽ (${d.payments} оплат)\n⭐ Отзывов: ${d.feedback}${d.feedback_avg ? ` (средняя ${d.feedback_avg})` : ""}\n` +
      `🤖 ИИ: ${Math.round(d.neurons)} нейронов (≈ $${d.usd.toFixed(3)} сверх бесплатного лимита — ${d.over_free ? "да" : "нет"})` +
      (d.errors ? `\n⚠️ Ошибок: ${d.errors}` : "") + (d.tasks_due ? `\n📌 Задач со сроком сегодня: ${d.tasks_due}` : "");
    await this.notifyAdmin(text, "daily", { kb: [[{ text: "Открыть админку", url: this.adminUrl("/") }]] });
    // Напоминание о задачах со сроком сегодня — исполнителю
    for (const task of this.all("SELECT id, title, assignee FROM tasks WHERE due = ? AND status NOT IN ('done', 'rejected') AND assignee IS NOT NULL", t)) {
      await this.notifyAdmin(`📌 Срок сегодня: <b>${esc(task.title)}</b>`, "task", { only: [task.assignee], kb: [[{ text: "Открыть задачу", url: this.adminUrl(`/tasks/${task.id}`) }]] });
    }
  }

  // ---------------------------------------------------
  // Журнал действий админов
  // ---------------------------------------------------
  audit(admin, action, target = "", details = null) {
    this.sql.exec("INSERT INTO admin_log (ts, admin, action, target, details) VALUES (?, ?, ?, ?, ?)",
      Date.now(), String(admin), action, String(target || ""), details ? JSON.stringify(details) : null);
  }

  // ---------------------------------------------------
  // Alarm: cron по пользователям, рассылки, дайджест новых пользователей, бэкфилл
  // ---------------------------------------------------
  async wake(at) {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur || at < cur) await this.ctx.storage.setAlarm(at);
  }

  async startCron(kind) {
    await this.seedFromKv();
    this.sql.exec("INSERT OR REPLACE INTO cron (id, kind, cursor) VALUES (1, ?, '')", kind);
    await this.wake(Date.now());
  }

  async alarm() {
    let soon = false;
    try {
      soon = (await this.cronStep()) || soon;
    } catch (e) {
      console.error("cronStep", e);
    }
    try {
      soon = (await this.broadcastStep()) || soon;
    } catch (e) {
      console.error("broadcastStep", e);
    }
    try {
      soon = (await this.backfillStep()) || soon;
    } catch (e) {
      console.error("backfillStep", e);
    }
    try {
      await this.flushNewUsers();
    } catch (e) {
      console.error("flushNewUsers", e);
    }
    let next = soon ? Date.now() + 1000 : null;
    const sched = this.one("SELECT MIN(scheduled_at) AS t FROM broadcasts WHERE status = 'scheduled'")?.t;
    if (sched && (!next || sched < next)) next = Math.max(sched, Date.now() + 1000);
    const w = this.getMeta("nu_window");
    if (w?.pending?.length) {
      const t = w.start + HOUR;
      if (!next || t < next) next = Math.max(t, Date.now() + 1000);
    }
    if (next) await this.ctx.storage.setAlarm(next);
  }

  async cronStep() {
    const job = this.one("SELECT kind, cursor FROM cron WHERE id = 1");
    if (!job) return false;
    const batch = this.all("SELECT uid FROM users WHERE uid > ? ORDER BY uid LIMIT 25", job.cursor).map((r) => r.uid);
    if (!batch.length) {
      this.sql.exec("DELETE FROM cron WHERE id = 1");
      return false;
    }
    const texts = this.getSetting("texts", {});
    await Promise.all(batch.map(async (uid) => {
      try {
        await this.env.USER.get(this.env.USER.idFromName(uid)).cronTick(job.kind, uid, texts);
      } catch (e) {
        console.error("cronTick", uid, e);
      }
    }));
    this.sql.exec("UPDATE cron SET cursor = ? WHERE id = 1", batch[batch.length - 1]);
    return true;
  }

  // ---------------------------------------------------
  // Рассылки
  // ---------------------------------------------------
  /** Сегмент пользователей по фильтру (тот же, что в списке пользователей) */
  segment(filter = {}) {
    const { where, args } = A.userWhere(filter);
    return this.all(`SELECT uid, name, username, streak, lvl, level FROM users u WHERE ${where} AND COALESCE(u.blocked, 0) = 0 AND COALESCE(u.bot_blocked, 0) = 0 AND u.uid NOT GLOB 'w*'`, ...args);
  }

  createBroadcast({ admin, text, buttons = [], filter = {}, scheduled_at = null }) {
    const targets = this.segment(filter);
    const now = Date.now();
    const status = scheduled_at && scheduled_at > now + 30000 ? "scheduled" : "sending";
    this.sql.exec(
      "INSERT INTO broadcasts (created_at, admin, text, buttons, filter, status, scheduled_at, total, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      now, String(admin), text, JSON.stringify(buttons || []), JSON.stringify(filter || {}), status, scheduled_at || null, targets.length, status === "sending" ? now : null,
    );
    const bid = this.one("SELECT last_insert_rowid() AS id").id;
    for (const t of targets) this.sql.exec("INSERT OR IGNORE INTO bc_targets (bid, uid, status) VALUES (?, ?, 'pending')", bid, t.uid);
    this.audit(admin, "broadcast_create", bid, { total: targets.length, scheduled_at, filter });
    return bid;
  }

  async startBroadcast(bid) {
    await this.wake(Date.now());
    return bid;
  }

  stopBroadcast(bid, admin) {
    this.sql.exec("UPDATE broadcasts SET status = 'stopped', finished_at = ? WHERE id = ? AND status IN ('sending', 'scheduled')", Date.now(), bid);
    this.audit(admin, "broadcast_stop", bid);
  }

  async broadcastStep() {
    const now = Date.now();
    this.sql.exec("UPDATE broadcasts SET status = 'sending', started_at = ? WHERE status = 'scheduled' AND scheduled_at <= ?", now, now);
    const b = this.one("SELECT * FROM broadcasts WHERE status = 'sending' ORDER BY id LIMIT 1");
    if (!b) return false;
    // Telegram: не больше ~30 сообщений в секунду — шлём по 25 за тик
    const batch = this.all("SELECT t.uid, u.name, u.streak, u.lvl, u.level FROM bc_targets t LEFT JOIN users u ON u.uid = t.uid WHERE t.bid = ? AND t.status = 'pending' LIMIT 25", b.id);
    if (!batch.length) {
      this.sql.exec("UPDATE broadcasts SET status = 'done', finished_at = ? WHERE id = ?", now, b.id);
      await this.notifyAdmin(`📣 Рассылка №${b.id} завершена: доставлено ${b.sent}, не доставлено ${b.failed}`, "other", { only: [b.admin] });
      return !!this.one("SELECT 1 AS x FROM broadcasts WHERE status = 'sending'");
    }
    const buttons = JSON.parse(b.buttons || "[]");
    await Promise.all(batch.map(async (t) => {
      const text = personalize(b.text, t);
      const bot = tg(this.env, { log: false });
      const mid = await bot.send(t.uid, text, buildKeyboard(this.env, buttons, b.id));
      const ok = bot.last.ok;
      this.sql.exec("UPDATE bc_targets SET status = ?, ts = ?, err = ?, tg_mid = ? WHERE bid = ? AND uid = ?", ok ? "sent" : "failed", Date.now(), ok ? null : bot.last.description, mid || 0, b.id, t.uid);
      await this.logChat({ uid: t.uid, dir: "out", kind: "broadcast", text: stripTags(text), admin: b.admin, ref: b.id, tg_mid: mid || 0, ok: ok ? 1 : 0, err: ok ? "" : bot.last.description, buttons: buttons.map((x) => x.text).join(" · ") });
    }));
    const c = this.one("SELECT SUM(status = 'sent') AS sent, SUM(status = 'failed') AS failed FROM bc_targets WHERE bid = ?", b.id);
    this.sql.exec("UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?", c.sent || 0, c.failed || 0, b.id);
    return true;
  }

  bcClick(bid, uid) {
    this.sql.exec("UPDATE bc_targets SET clicked = clicked + 1 WHERE bid = ? AND uid = ?", Number(bid), String(uid));
  }

  /** Тестовая отправка рассылки самому админу */
  async testBroadcast(admin, text, buttons) {
    const u = this.userRow(admin) || { name: "Админ", streak: 3, lvl: 5 };
    const bot = tg(this.env, { log: false });
    await bot.send(admin, `🧪 <i>Тест рассылки</i>\n\n${personalize(text, u)}`, buildKeyboard(this.env, buttons || [], 0));
    return { ok: bot.last.ok, error: bot.last.ok ? null : bot.last.description };
  }

  // ---------------------------------------------------
  // Бэкфилл истории из UserDO (один раз после запуска админки)
  // ---------------------------------------------------
  async startBackfill(force = false) {
    const st = this.getMeta("backfill");
    if (st && !force) return st;
    await this.seedFromKv();
    const s = { cursor: "", done: false, processed: 0, total: this.one("SELECT COUNT(*) AS n FROM users").n, started_at: Date.now() };
    this.setMeta("backfill", s);
    await this.wake(Date.now());
    return s;
  }

  async backfillStep() {
    const st = this.getMeta("backfill");
    if (!st || st.done) return false;
    const batch = this.all("SELECT uid FROM users WHERE uid > ? ORDER BY uid LIMIT 10", st.cursor).map((r) => r.uid);
    if (!batch.length) {
      this.setMeta("backfill", { ...st, done: true, finished_at: Date.now() });
      return false;
    }
    for (const uid of batch) {
      try {
        const res = await this.env.USER.get(this.env.USER.idFromName(uid)).adminBackfill(uid);
        if (!res) continue;
        this.upsertUser(uid, res.summary);
        const already = this.one("SELECT 1 AS x FROM events WHERE uid = ? AND meta LIKE '%\"backfill\":1%' LIMIT 1", uid);
        // Из прошлого берём только то, что было до начала записи событий в реальном времени — без дублей
        const firstLive = this.one("SELECT MIN(ts) AS t FROM events WHERE uid = ? AND (meta IS NULL OR meta NOT LIKE '%\"backfill\":1%')", uid)?.t || Infinity;
        if (!already) this.logEvents((res.events || []).filter((e) => e.ts < firstLive));
        for (const p of res.payments || []) {
          this.sql.exec(
            "INSERT OR IGNORE INTO payments (op, uid, plan, created_at, amount, status, updated_at, done) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
            p.op, uid, p.plan, p.ts, p.amount, p.status, p.ts,
          );
        }
      } catch (e) {
        console.error("backfill", uid, e);
      }
    }
    this.setMeta("backfill", { ...st, cursor: batch[batch.length - 1], processed: st.processed + batch.length });
    return true;
  }

  // ---------------------------------------------------
  // Совместимость: старый /admin в боте
  // ---------------------------------------------------
  async stats() {
    await this.seedFromKv();
    const sum = (metric, days) => {
      const from = mskDate(Date.now() - (days - 1) * 86400000);
      return this.one("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = ? AND day >= ?", metric, from).v;
    };
    const activeFor = (days) => {
      const from = mskDate(Date.now() - (days - 1) * 86400000);
      return this.one("SELECT COUNT(DISTINCT uid) AS v FROM active WHERE day >= ?", from).v;
    };
    const all = (metric) => this.one("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = ?", metric).v;
    let legacy = {};
    try {
      legacy = JSON.parse((await this.env.HELPMEDOCTOR?.get("stats:global")) || "{}");
    } catch {}
    return {
      users_total: this.one("SELECT COUNT(*) AS v FROM users").v,
      new_users: [sum("new_users", 1), sum("new_users", 7), sum("new_users", 14)],
      active: [activeFor(1), activeFor(7), activeFor(14)],
      consultations_total: all("consultations") + (legacy.consultations_total || 0),
      quizzes_total: all("quizzes") + (legacy.quizzes_total || 0),
      payments_total: all("payments") + (legacy.payments_total || 0),
      revenue_total: all("revenue") + (legacy.payments_revenue || 0),
      payment_links: all("payment_links"),
      feedback: this.one("SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM feedback"),
      top: this.all("SELECT name, username, cons, quizzes FROM users ORDER BY cons * 2 + quizzes DESC LIMIT 5"),
      funnel: this.one("SELECT SUM(patients >= 1) AS p1, SUM(patients >= 3) AS p3, SUM(paid) AS paid, SUM(last_active > 0) AS known FROM users"),
    };
  }

  // ---------------------------------------------------
  // API админки: один вход, чтобы не плодить RPC-методы
  // ---------------------------------------------------
  async admin(op, args = {}, adminId = "") {
    const fn = A.ADMIN_OPS[op];
    if (!fn) throw new Error(`unknown admin op ${op}`);
    return fn(this, args, String(adminId));
  }
}

// ---------------------------------------------------
// Вспомогательное
// ---------------------------------------------------
const fmtRub = (v) => Number(v).toLocaleString("ru", { maximumFractionDigits: 2 });

export function esc(t) {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stripTags(s) {
  return String(s || "").replace(/<[^>]+>/g, "");
}

/** Подстановки в тексте рассылки: {имя}, {стрик}, {уровень} */
export function personalize(text, u = {}) {
  const first = String(u.name || "").split(" ")[0] || "доктор";
  return String(text || "")
    .replace(/\{имя\}/g, esc(first))
    .replace(/\{стрик\}/g, String(u.streak ?? 0))
    .replace(/\{уровень\}/g, String(u.lvl ?? 1));
}

/**
 * Кнопки рассылки/сообщения: {type: "new"|"app"|"plans"|"url", text, url?}.
 * «Принять пациента» идёт через callback — так считаем клики.
 */
export function buildKeyboard(env, buttons, bid = 0) {
  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  const rows = [];
  for (const b of buttons || []) {
    const text = String(b.text || "").slice(0, 60);
    if (!text) continue;
    if (b.type === "new") rows.push([btn(text, bid ? `bc:${bid}:new` : "new")]);
    else if (b.type === "app") rows.push([{ text, web_app: { url: `${base}/app` } }]);
    else if (b.type === "plans") rows.push([{ text, web_app: { url: `${base}/app?go=${encodeURIComponent("/plans")}` } }]);
    else if (b.type === "url" && /^https?:\/\//.test(b.url || "")) rows.push([{ text, url: b.url }]);
  }
  return rows.length ? rows : undefined;
}
