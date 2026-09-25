// =====================================================
// HubDO — один на весь сервис (idFromName("hub")).
// Реестр пользователей (для рассылок и админки), коды входа на сайт,
// привязка платежей к пользователям и общая статистика.
// Всё строго консистентно — в отличие от KV, где запись видна не сразу.
// =====================================================
import { DurableObject } from "cloudflare:workers";
import { ADMIN_ID } from "../config.js";
import { mskDate } from "../lib/util.js";
import { tg } from "../lib/telegram.js";

const LOGIN_TTL_MS = 10 * 60 * 1000;

export class HubDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, name TEXT, username TEXT, registered_at INTEGER,
        cons INTEGER DEFAULT 0, patients INTEGER DEFAULT 0, quizzes INTEGER DEFAULT 0, paid INTEGER DEFAULT 0, last_active INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS cron (id INTEGER PRIMARY KEY CHECK (id = 1), kind TEXT, cursor TEXT);
      CREATE TABLE IF NOT EXISTS logins (code TEXT PRIMARY KEY, uid TEXT, created_at INTEGER);
      CREATE TABLE IF NOT EXISTS payments (op TEXT PRIMARY KEY, uid TEXT, plan TEXT, created_at INTEGER, done INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS daily (day TEXT, metric TEXT, value INTEGER, PRIMARY KEY (day, metric));
      CREATE TABLE IF NOT EXISTS active (day TEXT, uid TEXT, PRIMARY KEY (day, uid));
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE IF NOT EXISTS feedback (uid TEXT, ts INTEGER, rating INTEGER, text TEXT, source TEXT, PRIMARY KEY (uid, ts));
    `);
  }

  // ---------- Пользователи ----------
  async registerUser(uid, { name = "", username = "", isNew = false } = {}) {
    const existed = this.sql.exec("SELECT 1 FROM users WHERE uid = ?", uid).toArray().length > 0;
    this.sql.exec(
      "INSERT INTO users (uid, name, username, registered_at) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET name = excluded.name, username = excluded.username",
      uid, name, username, Date.now(),
    );
    if (!existed && isNew) {
      this.bump("new_users");
      await this.notifyAdmin(`🆕 ${name} ${username ? "@" + username : "-"} ${uid}`);
    }
  }

  /** uid по @username (без учёта регистра) */
  async findByUsername(username) {
    const u = String(username || "").trim().replace(/^@/, "").toLowerCase();
    if (!u) return null;
    return this.sql.exec("SELECT uid, name, username FROM users WHERE lower(username) = ?", u).toArray()[0] || null;
  }

  async listUsers() {
    await this.seedFromKv();
    return this.sql.exec("SELECT uid FROM users").toArray().map((r) => r.uid);
  }

  /** Однократно переносим список пользователей из старого KV */
  async seedFromKv() {
    if (this.sql.exec("SELECT v FROM meta WHERE k = 'seeded'").toArray().length) return;
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

  // ---------- Вход на сайт через бота ----------
  async createLogin(code) {
    this.sql.exec("DELETE FROM logins WHERE created_at < ?", Date.now() - LOGIN_TTL_MS);
    this.sql.exec("INSERT INTO logins (code, uid, created_at) VALUES (?, NULL, ?)", code, Date.now());
  }

  /** Бот подтвердил код: привязываем к пользователю. true — если код валиден */
  async confirmLogin(code, uid) {
    const row = this.sql.exec("SELECT uid, created_at FROM logins WHERE code = ?", code).toArray()[0];
    if (!row || row.created_at < Date.now() - LOGIN_TTL_MS) return false;
    this.sql.exec("UPDATE logins SET uid = ? WHERE code = ?", String(uid), code);
    return true;
  }

  /** Сайт спрашивает, подтверждён ли код. Код одноразовый. */
  async pollLogin(code) {
    const row = this.sql.exec("SELECT uid, created_at FROM logins WHERE code = ?", code).toArray()[0];
    if (!row) return { status: "expired" };
    if (row.created_at < Date.now() - LOGIN_TTL_MS) {
      this.sql.exec("DELETE FROM logins WHERE code = ?", code);
      return { status: "expired" };
    }
    if (!row.uid) return { status: "pending" };
    this.sql.exec("DELETE FROM logins WHERE code = ?", code);
    return { status: "ok", uid: row.uid };
  }

  // ---------- Платежи ----------
  async savePayment(op, uid, plan) {
    this.sql.exec("INSERT OR IGNORE INTO payments (op, uid, plan, created_at) VALUES (?, ?, ?, ?)", op, String(uid), plan, Date.now());
    this.bump("payment_links");
  }

  async getPayment(op) {
    return this.sql.exec("SELECT op, uid, plan, done FROM payments WHERE op = ?", op).toArray()[0] || null;
  }

  /** Помечает платёж обработанным. true — если это первый раз (защита от повторов вебхука) */
  async markPaymentDone(op, amount) {
    const row = this.sql.exec("SELECT done FROM payments WHERE op = ?", op).toArray()[0];
    if (!row || row.done) return false;
    this.sql.exec("UPDATE payments SET done = 1 WHERE op = ?", op);
    this.bump("payments");
    this.bump("revenue", Math.round(Number(amount) || 0));
    return true;
  }

  // ---------- Статистика ----------
  bump(metric, by = 1, day = mskDate()) {
    this.sql.exec(
      "INSERT INTO daily (day, metric, value) VALUES (?, ?, ?) ON CONFLICT(day, metric) DO UPDATE SET value = value + excluded.value",
      day, metric, by,
    );
  }

  /**
   * Событие пользователя. info — свежая сводка профиля для админки
   * (храним её здесь, чтобы не опрашивать сотни UserDO за один запрос).
   */
  async track(event, uid, info) {
    if (event === "consultation") this.bump("consultations");
    if (event === "quiz") this.bump("quizzes");
    if (!uid) return;
    uid = String(uid);
    this.sql.exec("INSERT OR IGNORE INTO active (day, uid) VALUES (?, ?)", mskDate(), uid);
    if (info) {
      this.sql.exec(
        `INSERT INTO users (uid, name, username, registered_at, cons, patients, quizzes, paid, last_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uid) DO UPDATE SET name = excluded.name, username = excluded.username, cons = excluded.cons,
           patients = excluded.patients, quizzes = excluded.quizzes, paid = excluded.paid, last_active = excluded.last_active`,
        uid, info.name || "", info.username || "", Date.now(), info.cons || 0, info.patients || 0, info.quizzes || 0, info.paid ? 1 : 0, Date.now(),
      );
    }
  }

  // ---------- Отзывы ----------
  async saveFeedback(uid, { name = "", username = "", rating = null, text = "", source = "", ts = Date.now() } = {}) {
    const existed = this.sql.exec("SELECT 1 FROM feedback WHERE uid = ? AND ts = ?", String(uid), ts).toArray().length > 0;
    this.sql.exec(
      "INSERT INTO feedback (uid, ts, rating, text, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid, ts) DO UPDATE SET rating = excluded.rating, text = excluded.text",
      String(uid), ts, rating, text || "", source,
    );
    const stars = rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "";
    const who = `${name}${username ? " @" + username : ""} (${uid})`;
    await this.notifyAdmin(existed
      ? `💬 Отзыв дополнен — ${who}\n${text}`
      : `⭐ Новый отзыв ${stars} — ${who}${source === "bot" ? " · бот" : " · сайт"}${text ? `\n${text}` : ""}`);
  }

  // ---------- Рассылки по расписанию ----------
  // Обходим пользователей порциями: каждый alarm — новый лимит подзапросов.
  async startCron(kind) {
    await this.seedFromKv();
    this.sql.exec("INSERT OR REPLACE INTO cron (id, kind, cursor) VALUES (1, ?, '')", kind);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const job = this.sql.exec("SELECT kind, cursor FROM cron WHERE id = 1").toArray()[0];
    if (!job) return;
    const batch = this.sql.exec("SELECT uid FROM users WHERE uid > ? ORDER BY uid LIMIT 25", job.cursor).toArray().map((r) => r.uid);
    if (!batch.length) {
      this.sql.exec("DELETE FROM cron WHERE id = 1");
      return;
    }
    await Promise.all(batch.map(async (uid) => {
      try {
        await this.env.USER.get(this.env.USER.idFromName(uid)).cronTick(job.kind, uid);
      } catch (e) {
        console.error("cronTick", uid, e);
      }
    }));
    this.sql.exec("UPDATE cron SET cursor = ? WHERE id = 1", batch[batch.length - 1]);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  async stats() {
    await this.seedFromKv();
    const sum = (metric, days) => {
      const from = mskDate(Date.now() - (days - 1) * 86400000);
      return this.sql.exec("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = ? AND day >= ?", metric, from).one().v;
    };
    const activeFor = (days) => {
      const from = mskDate(Date.now() - (days - 1) * 86400000);
      return this.sql.exec("SELECT COUNT(DISTINCT uid) AS v FROM active WHERE day >= ?", from).one().v;
    };
    const all = (metric) => this.sql.exec("SELECT COALESCE(SUM(value), 0) AS v FROM daily WHERE metric = ?", metric).one().v;
    // Старые итоги из KV — чтобы цифры не обнулились после переезда
    let legacy = {};
    try {
      legacy = JSON.parse((await this.env.HELPMEDOCTOR?.get("stats:global")) || "{}");
    } catch {}
    return {
      users_total: this.sql.exec("SELECT COUNT(*) AS v FROM users").one().v,
      new_users: [sum("new_users", 1), sum("new_users", 7), sum("new_users", 14)],
      active: [activeFor(1), activeFor(7), activeFor(14)],
      consultations_total: all("consultations") + (legacy.consultations_total || 0),
      quizzes_total: all("quizzes") + (legacy.quizzes_total || 0),
      payments_total: all("payments") + (legacy.payments_total || 0),
      revenue_total: all("revenue") + (legacy.payments_revenue || 0),
      payment_links: all("payment_links"),
      feedback: this.sql.exec("SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM feedback").one(),
      top: this.sql.exec("SELECT name, username, cons, quizzes FROM users ORDER BY cons * 2 + quizzes DESC LIMIT 5").toArray(),
      funnel: this.sql.exec(
        "SELECT SUM(patients >= 1) AS p1, SUM(patients >= 3) AS p3, SUM(paid) AS paid, SUM(last_active > 0) AS known FROM users",
      ).one(),
    };
  }

  async notifyAdmin(text) {
    try {
      await tg(this.env).send(this.env.ADMIN_ID || ADMIN_ID, text);
    } catch (e) {
      console.error("notifyAdmin", e);
    }
  }
}
