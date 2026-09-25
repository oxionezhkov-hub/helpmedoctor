// Отчёты и операции админки поверх SQLite HubDO.
// Все функции получают hub (с методами all/one/sql) — выполняются внутри HubDO.
import { AI_CAP_DEFAULT, AI_DEFAULT_MODEL, AI_FALLBACKS, AI_FREE_NEURONS_PER_DAY, AI_MODELS, AI_ROUTING_DEFAULT, AI_STEPS, AI_USD_PER_1000_NEURONS, PLANS, SPECIALIZATIONS, DOCTOR_LEVELS } from "../config.js";
import { mskDate, toTelegramHtml, utcDate } from "./util.js";

const DAY = 86400000;
const MSK = 3 * 3600000;
const ERROR_TYPES = ["ai_error", "patient_failed", "pay_error", "stt_error", "bot_blocked"];

// ---------------------------------------------------
// Фильтры
// ---------------------------------------------------
function activeSubSql(now) {
  return `(u.sub_until = -1 OR u.sub_until > ${Number(now)})`;
}

/** WHERE для таблицы users (алиас u) по фильтру списка пользователей / сегмента рассылки */
export function userWhere(f = {}) {
  const w = ["1 = 1"];
  const args = [];
  const now = Date.now();
  if (f.q) {
    const q = String(f.q).trim().replace(/^@/, "").toLowerCase();
    w.push("(u.search LIKE ? OR u.uid = ?)");
    args.push(`%${q}%`, q);
  }
  if (f.reg_from) { w.push("u.registered_at >= ?"); args.push(Number(f.reg_from)); }
  if (f.reg_to) { w.push("u.registered_at < ?"); args.push(Number(f.reg_to)); }
  if (f.active === "today") { w.push("u.last_active >= ?"); args.push(dayStart(now)); }
  if (f.active === "7d") { w.push("u.last_active >= ?"); args.push(now - 7 * DAY); }
  if (f.active === "sleep14") { w.push("COALESCE(u.last_active, 0) < ?"); args.push(now - 14 * DAY); }
  if (f.active === "sleep7") { w.push("COALESCE(u.last_active, 0) < ?"); args.push(now - 7 * DAY); }
  if (f.tariff === "paid") w.push(`${activeSubSql(now)} AND COALESCE(u.sub_plan, '') != 'gift'`);
  if (f.tariff === "gift") w.push(`${activeSubSql(now)} AND u.sub_plan = 'gift'`);
  if (f.tariff === "sub") w.push(activeSubSql(now));
  if (f.tariff === "free") w.push(`NOT ${activeSubSql(now)}`);
  if (f.tariff === "expired") w.push(`u.sub_until > 0 AND u.sub_until < ${now}`);
  if (f.level) { w.push("u.level = ?"); args.push(f.level); }
  if (f.profession) { w.push("u.prof_lc LIKE ?"); args.push(`%${String(f.profession).trim().toLowerCase()}%`); }
  if (f.cons_min != null && f.cons_min !== "") { w.push("COALESCE(u.cons, 0) >= ?"); args.push(Number(f.cons_min)); }
  if (f.cons_max != null && f.cons_max !== "") { w.push("COALESCE(u.cons, 0) <= ?"); args.push(Number(f.cons_max)); }
  if (f.rating_min != null && f.rating_min !== "") { w.push("u.ratings_count > 0 AND u.avg_rating >= ?"); args.push(Number(f.rating_min)); }
  if (f.rating_max != null && f.rating_max !== "") { w.push("u.ratings_count > 0 AND u.avg_rating <= ?"); args.push(Number(f.rating_max)); }
  if (f.onboarding === "yes") w.push("(COALESCE(u.about, '') != '' OR COALESCE(u.expectations, '') != '')");
  if (f.onboarding === "no") w.push("COALESCE(u.about, '') = '' AND COALESCE(u.expectations, '') = ''");
  if (f.feedback === "yes") w.push("COALESCE(u.feedback_count, 0) > 0");
  if (f.feedback === "no") w.push("COALESCE(u.feedback_count, 0) = 0");
  if (f.bot_blocked === "yes") w.push("COALESCE(u.bot_blocked, 0) = 1");
  if (f.bot_blocked === "no") w.push("COALESCE(u.bot_blocked, 0) = 0");
  if (f.blocked === "yes") w.push("COALESCE(u.blocked, 0) = 1");
  if (f.source) { w.push("u.last_source = ?"); args.push(f.source); }
  if (Array.isArray(f.uids)) {
    const ids = f.uids.map(String).slice(0, 5000);
    if (!ids.length) w.push("0 = 1");
    else { w.push(`u.uid IN (${ids.map(() => "?").join(",")})`); args.push(...ids); }
  }
  return { where: w.join(" AND "), args };
}

/** Фильтры отчётов: источник действия + уровень/специальность/тариф пользователя */
function evWhere(f = {}, alias = "e") {
  const w = [`${alias}.ts >= ?`, `${alias}.ts < ?`];
  const args = [Number(f.from), Number(f.to)];
  if (f.source) { w.push(`${alias}.source = ?`); args.push(f.source); }
  const uw = userWhere({ level: f.level, profession: f.profession, tariff: f.tariff });
  if (uw.args.length || uw.where !== "1 = 1") {
    w.push(`${alias}.uid IN (SELECT u.uid FROM users u WHERE ${uw.where})`);
    args.push(...uw.args);
  }
  return { where: w.join(" AND "), args };
}

function dayStart(ts) {
  return Math.floor((ts + MSK) / DAY) * DAY - MSK;
}

function daysBetween(from, to) {
  const out = [];
  for (let t = dayStart(from); t < to; t += DAY) out.push(mskDate(t));
  return out;
}

function meta(row) {
  try { return JSON.parse(row.meta || "{}") || {}; } catch { return {}; }
}

const round = (x, n = 1) => (x == null ? null : Math.round(Number(x) * 10 ** n) / 10 ** n);
const usd = (neurons) => (Math.max(0, neurons) / 1000) * AI_USD_PER_1000_NEURONS;

// ---------------------------------------------------
// Дашборд
// ---------------------------------------------------
function tiles(h, from, to) {
  const n = (q, ...a) => h.one(q, ...a)?.n || 0;
  const evCount = (type) => n("SELECT COUNT(*) AS n FROM events WHERE type = ? AND ts >= ? AND ts < ?", type, from, to);
  const firstPaid = n(`SELECT COUNT(*) AS n FROM (SELECT uid, MIN(updated_at) AS t FROM payments WHERE status = 'paid' GROUP BY uid) WHERE t >= ? AND t < ?`, from, to);
  const newUsers = n("SELECT COUNT(*) AS n FROM users WHERE registered_at >= ? AND registered_at < ?", from, to);
  return {
    new_users: newUsers,
    active: n("SELECT COUNT(DISTINCT uid) AS n FROM events WHERE ts >= ? AND ts < ? AND uid != ''", from, to),
    patients: evCount("patient_ready"),
    finished: evCount("finish"),
    avg_rating: round(h.one("SELECT AVG(val) AS n FROM events WHERE type = 'evaluation' AND ts >= ? AND ts < ?", from, to)?.n, 2),
    revenue: n("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'paid' AND updated_at >= ? AND updated_at < ?", from, to),
    first_paid: firstPaid,
    conversion: newUsers ? round((firstPaid / newUsers) * 100, 1) : null,
    errors: n(`SELECT COUNT(*) AS n FROM events WHERE type IN (${ERROR_TYPES.map(() => "?").join(",")}) AND ts >= ? AND ts < ?`, ...ERROR_TYPES, from, to)
      + n("SELECT COUNT(*) AS n FROM ai_usage WHERE ok = 0 AND ts >= ? AND ts < ?", from, to),
    neurons: round(n("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage WHERE ts >= ? AND ts < ?", from, to), 0),
    ai_requests: n("SELECT COUNT(*) AS n FROM ai_usage WHERE ts >= ? AND ts < ?", from, to),
  };
}

export function dashboard(h, { from, to }) {
  from = Number(from); to = Number(to);
  const len = to - from;
  const cur = tiles(h, from, to);
  const prev = tiles(h, from - len, from);
  const now = Math.min(Date.now(), to);
  const act = (days) => h.one("SELECT COUNT(DISTINCT uid) AS n FROM events WHERE ts >= ? AND ts < ? AND uid != ''", now - days * DAY, now)?.n || 0;
  const dau = act(1), wau = act(7), mau = act(30);
  const subs = h.one(`SELECT SUM(COALESCE(sub_plan, '') != 'gift') AS paid, SUM(sub_plan = 'gift') AS gift FROM users u WHERE ${activeSubSql(Date.now())}`) || {};
  const today = utcDate();
  const aiToday = h.one("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage WHERE day_utc = ?", today)?.n || 0;
  const days = daysBetween(from, to);
  const byDay = (q, ...a) => Object.fromEntries(h.all(q, ...a).map((r) => [r.day, r]));

  const newU = {};
  for (const r of h.all("SELECT registered_at FROM users WHERE registered_at >= ? AND registered_at < ?", from, to)) {
    const d = mskDate(r.registered_at);
    newU[d] = (newU[d] || 0) + 1;
  }
  const actD = byDay("SELECT day, COUNT(DISTINCT uid) AS n FROM events WHERE ts >= ? AND ts < ? AND uid != '' GROUP BY day", from, to);
  const fin = {};
  for (const r of h.all("SELECT day, meta FROM events WHERE type = 'finish' AND ts >= ? AND ts < ?", from, to)) {
    const t = meta(r).type || "diagnosis";
    fin[r.day] = fin[r.day] || { diagnosis: 0, referral: 0, discharge: 0 };
    fin[r.day][t] = (fin[r.day][t] || 0) + 1;
  }
  const rev = {};
  for (const r of h.all("SELECT updated_at, plan, amount FROM payments WHERE status = 'paid' AND updated_at >= ? AND updated_at < ?", from, to)) {
    const d = mskDate(r.updated_at);
    rev[d] = rev[d] || { day: 0, week: 0, month: 0, forever: 0 };
    rev[d][r.plan] = (rev[d][r.plan] || 0) + Number(r.amount || 0);
  }
  const src = {};
  for (const r of h.all("SELECT day, source, COUNT(DISTINCT uid) AS n FROM events WHERE ts >= ? AND ts < ? AND uid != '' AND source IS NOT NULL GROUP BY day, source", from, to)) {
    src[r.day] = src[r.day] || {};
    src[r.day][r.source] = r.n;
  }
  // ИИ — по суткам UTC: так Cloudflare считает бесплатный лимит
  const aiDays = [];
  for (let t = Date.parse(`${utcDate(from)}T00:00:00Z`); t < to; t += DAY) aiDays.push(utcDate(t));
  const ai = Object.fromEntries(h.all("SELECT day_utc AS day, SUM(neurons) AS n, COUNT(*) AS req FROM ai_usage WHERE ts >= ? AND ts < ? GROUP BY day_utc", from, to).map((r) => [r.day, r]));

  return {
    tiles: cur, prev,
    dau, wau, mau, stickiness: mau ? round((dau / mau) * 100, 1) : null,
    subs_paid: subs.paid || 0, subs_gift: subs.gift || 0,
    ai_today: { neurons: round(aiToday, 0), free: AI_FREE_NEURONS_PER_DAY, left: Math.max(0, round(AI_FREE_NEURONS_PER_DAY - aiToday, 0)), usd_over: round(usd(aiToday - AI_FREE_NEURONS_PER_DAY), 4) },
    series: {
      days,
      new_users: days.map((d) => newU[d] || 0),
      active: days.map((d) => actD[d]?.n || 0),
      finish: days.map((d) => fin[d] || { diagnosis: 0, referral: 0, discharge: 0 }),
      revenue: days.map((d) => rev[d] || { day: 0, week: 0, month: 0, forever: 0 }),
      sources: days.map((d) => src[d] || {}),
      ai_days: aiDays,
      ai: aiDays.map((d) => round(ai[d]?.n || 0, 0)),
    },
    funnel: funnel(h, from, to),
    backfill: h.getMeta("backfill"),
    events_since: h.one("SELECT MIN(ts) AS t FROM events WHERE meta IS NULL OR meta NOT LIKE '%\"backfill\":1%'")?.t || null,
  };
}

function funnel(h, from, to) {
  const cohort = h.all("SELECT uid, registered_at, about, expectations, patients, cons, quizzes FROM users WHERE registered_at >= ? AND registered_at < ?", from, to);
  if (!cohort.length) return { total: 0, steps: [] };
  const ids = cohort.map((u) => u.uid);
  const inList = (col) => `${col} IN (${ids.map(() => "?").join(",")})`;
  const setOf = (q) => new Set(h.all(q, ...ids).map((r) => r.uid));
  const started = setOf(`SELECT DISTINCT uid FROM events WHERE type = 'consult_start' AND ${inList("uid")}`);
  const plans = setOf(`SELECT DISTINCT uid FROM events WHERE type IN ('plans_open', 'pay_click') AND ${inList("uid")}`);
  const paid = setOf(`SELECT DISTINCT uid FROM payments WHERE status = 'paid' AND ${inList("uid")}`);
  const days = {};
  for (const r of h.all(`SELECT uid, day FROM active WHERE ${inList("uid")}`, ...ids)) (days[r.uid] = days[r.uid] || new Set()).add(r.day);
  const steps = [
    ["signup", "Запустил бота", () => true],
    ["onboarding", "Заполнил анкету", (u) => !!(u.about || u.expectations)],
    ["patient", "Получил пациента", (u) => u.patients > 0],
    ["consult", "Начал приём", (u) => started.has(u.uid) || u.cons > 0],
    ["finished", "Завершил приём", (u) => u.cons > 0],
    ["quiz", "Прошёл тест", (u) => u.quizzes > 0],
    ["returned", "Вернулся на 2-й день", (u) => [...(days[u.uid] || [])].some((d) => d > mskDate(u.registered_at))],
    ["plans", "Открыл тарифы", (u) => plans.has(u.uid) || paid.has(u.uid)],
    ["paid", "Оплатил", (u) => paid.has(u.uid)],
  ].map(([key, label, test]) => {
    const users = cohort.filter(test).map((u) => u.uid);
    return { key, label, count: users.length, uids: users.slice(0, 500) };
  });
  return { total: cohort.length, steps };
}

export function live(h, { limit = 50 } = {}) {
  return h.all(`SELECT e.id, e.ts, e.uid, e.type, e.source, e.meta, e.val, u.name, u.username FROM events e LEFT JOIN users u ON u.uid = e.uid
    ORDER BY e.id DESC LIMIT ?`, Math.min(200, Number(limit) || 50)).map((r) => ({ ...r, meta: meta(r) }));
}

// ---------------------------------------------------
// Отчёты
// ---------------------------------------------------
const REPORTS = {
  retention(h, f) {
    const weekStart = (ts) => {
      const d = new Date(ts + MSK);
      const dow = (d.getUTCDay() + 6) % 7;
      return Math.floor((ts + MSK) / DAY - dow) * DAY - MSK;
    };
    const from = weekStart(Number(f.from));
    const users = h.all("SELECT uid, registered_at FROM users WHERE registered_at >= ? AND registered_at < ?", from, Number(f.to));
    const act = {};
    for (const r of h.all("SELECT uid, day FROM active WHERE day >= ?", mskDate(from))) (act[r.uid] = act[r.uid] || []).push(Date.parse(`${r.day}T00:00:00Z`) - MSK);
    const cohorts = {};
    for (const u of users) {
      const w = weekStart(u.registered_at);
      const c = (cohorts[w] = cohorts[w] || { week: mskDate(w), size: 0, weeks: Array(9).fill(0), d1: 0, d7: 0, d14: 0, d30: 0 });
      c.size++;
      const days = act[u.uid] || [];
      const seen = new Set();
      for (const t of days) {
        const k = Math.floor((t - w) / (7 * DAY));
        if (k >= 0 && k < 9 && !seen.has(k)) { seen.add(k); c.weeks[k]++; }
      }
      const reg = dayStart(u.registered_at);
      const on = (n) => days.some((t) => t >= reg + n * DAY);
      if (on(1)) c.d1++;
      if (on(7)) c.d7++;
      if (on(14)) c.d14++;
      if (on(30)) c.d30++;
    }
    return { cohorts: Object.values(cohorts).sort((a, b) => a.week.localeCompare(b.week)) };
  },

  consultations(h, f) {
    const { where, args } = evWhere(f);
    const cnt = (type) => h.one(`SELECT COUNT(*) AS n FROM events e WHERE ${where} AND e.type = ?`, ...args, type).n;
    const starts = cnt("consult_start"), finishes = cnt("finish");
    const fins = h.all(`SELECT e.meta, e.source FROM events e WHERE ${where} AND e.type = 'finish'`, ...args).map(meta);
    const msgs = h.all(`SELECT e.meta FROM events e WHERE ${where} AND e.type = 'message'`, ...args).map(meta);
    const avg = (arr) => (arr.length ? round(arr.reduce((a, b) => a + b, 0) / arr.length, 1) : null);
    const byType = { diagnosis: 0, referral: 0, discharge: 0 };
    for (const m of fins) byType[m.type || "diagnosis"] = (byType[m.type || "diagnosis"] || 0) + 1;
    return {
      starts, finishes, abandoned: Math.max(0, starts - finishes),
      by_type: byType,
      with_treatment: fins.filter((m) => m.treatment).length,
      avg_minutes: avg(fins.map((m) => m.minutes).filter((x) => x != null)),
      avg_questions: avg(fins.map((m) => m.msgs).filter((x) => x != null)),
      avg_tests: avg(fins.map((m) => m.tests).filter((x) => x != null)),
      avg_exams: avg(fins.map((m) => m.exams).filter((x) => x != null)),
      messages: msgs.length,
      voice_share: msgs.length ? round((msgs.filter((m) => m.voice).length / msgs.length) * 100, 1) : null,
      reply_ms: round(h.one(`SELECT AVG(e.dur) AS n FROM events e WHERE ${where} AND e.type = 'reply'`, ...args).n, 0),
    };
  },

  quality(h, f) {
    const { where, args } = evWhere(f);
    const rows = h.all(`SELECT e.meta, e.val, u.level, u.profession FROM events e LEFT JOIN users u ON u.uid = e.uid WHERE ${where} AND e.type = 'evaluation'`, ...args);
    const group = (keyFn) => {
      const g = {};
      for (const r of rows) {
        const m = meta(r);
        const k = keyFn(r, m) || "—";
        const x = (g[k] = g[k] || { key: k, count: 0, sum: 0, correct: 0, diag: 0, comm: 0, treat: 0 });
        x.count++; x.sum += Number(r.val) || 0;
        if (m.correct === "yes") x.correct++;
        x.diag += m.axes?.diagnosis || 0; x.comm += m.axes?.communication || 0; x.treat += m.axes?.treatment || 0;
      }
      return Object.values(g).map((x) => ({
        key: x.key, count: x.count, avg: round(x.sum / x.count, 2), correct_pct: round((x.correct / x.count) * 100, 0),
        diagnosis: round(x.diag / x.count, 1), communication: round(x.comm / x.count, 1), treatment: round(x.treat / x.count, 1),
      })).sort((a, b) => b.count - a.count);
    };
    const levelLabel = Object.fromEntries(DOCTOR_LEVELS.map((l) => [l.key, l.label]));
    const weak = {};
    for (const r of rows) for (const w of meta(r).weaknesses || []) weak[w] = (weak[w] || 0) + 1;
    return {
      total: rows.length,
      avg: rows.length ? round(rows.reduce((a, r) => a + (Number(r.val) || 0), 0) / rows.length, 2) : null,
      by_section: group((r, m) => m.spec),
      by_profession: group((r) => r.profession),
      by_level: group((r) => levelLabel[r.level] || r.level),
      weaknesses: Object.entries(weak).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, count]) => ({ name, count })),
    };
  },

  procedures(h, f) {
    const { where, args } = evWhere(f);
    const agg = (type) => {
      const g = {};
      for (const r of h.all(`SELECT e.meta, e.dur FROM events e WHERE ${where} AND e.type = ?`, ...args, type)) {
        const m = meta(r);
        const k = m.name || "—";
        const x = (g[k] = g[k] || { name: k, count: 0, custom: !!m.custom, ms: 0, msN: 0 });
        x.count++;
        if (r.dur) { x.ms += r.dur; x.msN++; }
      }
      return g;
    };
    const tests = agg("test"), exams = agg("exam");
    // Средняя оценка приёмов, где это назначали
    for (const r of h.all(`SELECT e.meta, e.val FROM events e WHERE ${where} AND e.type = 'evaluation'`, ...args)) {
      const m = meta(r);
      for (const [list, g] of [[m.tests, tests], [m.exams, exams]]) {
        for (const name of list || []) {
          if (!g[name]) continue;
          g[name].rs = (g[name].rs || 0) + (Number(r.val) || 0);
          g[name].rn = (g[name].rn || 0) + 1;
        }
      }
    }
    const out = (g) => Object.values(g).map((x) => ({ name: x.name, count: x.count, custom: x.custom, avg_ms: x.msN ? Math.round(x.ms / x.msN) : null, avg_rating: x.rn ? round(x.rs / x.rn, 2) : null }))
      .sort((a, b) => b.count - a.count);
    return { tests: out(tests), exams: out(exams) };
  },

  specialties(h) {
    const known = new Set(Object.keys(SPECIALIZATIONS));
    const knownSections = new Set(Object.values(SPECIALIZATIONS).flat());
    const prof = h.all("SELECT profession AS name, COUNT(*) AS users, AVG(NULLIF(avg_rating, 0)) AS rating, SUM(cons) AS cons FROM users WHERE profession IS NOT NULL GROUP BY profession ORDER BY users DESC")
      .map((r) => ({ ...r, rating: round(r.rating, 2), custom: !known.has(r.name) }));
    const sec = {};
    for (const r of h.all("SELECT specs FROM users WHERE specs IS NOT NULL")) {
      let list = [];
      try { list = JSON.parse(r.specs) || []; } catch {}
      for (const s of list) sec[s] = (sec[s] || 0) + 1;
    }
    return {
      professions: prof,
      sections: Object.entries(sec).map(([name, users]) => ({ name, users, custom: !knownSections.has(name) })).sort((a, b) => b.users - a.users),
    };
  },

  quizzes(h, f) {
    const { where, args } = evWhere(f);
    const cnt = (type) => h.one(`SELECT COUNT(*) AS n FROM events e WHERE ${where} AND e.type = ?`, ...args, type).n;
    const done = h.all(`SELECT e.val FROM events e WHERE ${where} AND e.type = 'quiz_done'`, ...args);
    const q = {};
    for (const r of h.all(`SELECT e.meta FROM events e WHERE ${where} AND e.type = 'quiz_answer'`, ...args)) {
      const m = meta(r);
      if (!m.q) continue;
      const x = (q[m.q] = q[m.q] || { question: m.q, answers: 0, wrong: 0 });
      x.answers++;
      if (!m.correct) x.wrong++;
    }
    return {
      ready: cnt("quiz_ready"), opened: cnt("quiz_open"), done: done.length,
      avg_score: done.length ? round(done.reduce((a, r) => a + (Number(r.val) || 0), 0) / done.length, 2) : null,
      pass_pct: done.length ? round((done.filter((r) => Number(r.val) >= 4).length / done.length) * 100, 0) : null,
      hardest: Object.values(q).filter((x) => x.answers >= 1).map((x) => ({ ...x, wrong_pct: round((x.wrong / x.answers) * 100, 0) }))
        .sort((a, b) => b.wrong_pct - a.wrong_pct || b.answers - a.answers).slice(0, 15),
    };
  },

  gamification(h, f) {
    const { where, args } = evWhere(f);
    const lv = h.all("SELECT lvl, COUNT(*) AS n FROM users GROUP BY lvl ORDER BY lvl");
    const buckets = [[0, 0, "0"], [1, 2, "1–2"], [3, 6, "3–6"], [7, 13, "7–13"], [14, 29, "14–29"], [30, 1e9, "30+"]];
    const streaks = buckets.map(([a, b, label]) => ({ label, n: h.one("SELECT COUNT(*) AS n FROM users WHERE COALESCE(streak, 0) BETWEEN ? AND ?", a, b).n }));
    const tasks = {};
    for (const r of h.all(`SELECT e.meta FROM events e WHERE ${where} AND e.type = 'task_done'`, ...args)) {
      const m = meta(r);
      tasks[m.desc || m.id] = (tasks[m.desc || m.id] || 0) + 1;
    }
    return {
      levels: lv.map((r) => ({ label: `Ур. ${r.lvl || 1}`, n: r.n })),
      streaks,
      level_ups: h.one(`SELECT COUNT(*) AS n FROM events e WHERE ${where} AND e.type = 'level_up'`, ...args).n,
      streaks_lost: h.one(`SELECT COUNT(*) AS n FROM events e WHERE ${where} AND e.type = 'streak_lost'`, ...args).n,
      daily_tasks: Object.entries(tasks).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n),
    };
  },

  money(h, f) {
    const from = Number(f.from), to = Number(f.to);
    const paid = h.all("SELECT uid, plan, amount, updated_at FROM payments WHERE status = 'paid' AND updated_at >= ? AND updated_at < ?", from, to);
    const byPlan = {};
    for (const p of paid) {
      const x = (byPlan[p.plan] = byPlan[p.plan] || { plan: p.plan, label: PLANS[p.plan]?.label || p.plan, count: 0, sum: 0 });
      x.count++; x.sum += Number(p.amount) || 0;
    }
    const allPaid = h.all("SELECT uid, COUNT(*) AS n, MIN(updated_at) AS first FROM payments WHERE status = 'paid' GROUP BY uid");
    const repeat = allPaid.filter((r) => r.n > 1).length;
    const clicks = h.all("SELECT DISTINCT uid FROM events WHERE type = 'pay_click' AND ts >= ? AND ts < ?", from, to).map((r) => r.uid);
    const paidSet = new Set(allPaid.map((r) => r.uid));
    const firstDays = allPaid.map((r) => {
      const u = h.one("SELECT registered_at FROM users WHERE uid = ?", r.uid);
      return u?.registered_at ? (r.first - u.registered_at) / DAY : null;
    }).filter((x) => x != null && x >= 0);
    const total = paid.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    return {
      total, payments: paid.length, avg_check: paid.length ? round(total / paid.length, 0) : null,
      by_plan: Object.values(byPlan),
      payers: allPaid.length, repeat_payers: repeat,
      clicked_not_paid: clicks.filter((u) => !paidSet.has(u)).length, clicked: clicks.length,
      avg_days_to_first: firstDays.length ? round(firstDays.reduce((a, b) => a + b, 0) / firstDays.length, 1) : null,
      gifts: h.one("SELECT COUNT(*) AS n FROM payments WHERE status = 'gift' AND created_at >= ? AND created_at < ?", from, to).n,
      errors: h.one("SELECT COUNT(*) AS n FROM payments WHERE status = 'error' AND created_at >= ? AND created_at < ?", from, to).n,
    };
  },

  ai(h, f) {
    const from = Number(f.from), to = Number(f.to);
    const kinds = h.all(`SELECT kind, COUNT(*) AS requests, SUM(ok = 0) AS errors, AVG(ms) AS ms, SUM(tin) AS tin, SUM(tout) AS tout,
      SUM(audio_sec) AS audio_sec, SUM(neurons) AS neurons, SUM(estimated) AS estimated FROM ai_usage WHERE ts >= ? AND ts < ? GROUP BY kind ORDER BY neurons DESC`, from, to)
      .map((r) => ({ ...r, ms: Math.round(r.ms || 0), neurons: round(r.neurons, 1), usd: round(usd(r.neurons), 4), error_pct: r.requests ? round((r.errors / r.requests) * 100, 1) : 0 }));
    const users = h.all(`SELECT a.uid, u.name, u.username, COUNT(*) AS requests, SUM(a.neurons) AS neurons FROM ai_usage a LEFT JOIN users u ON u.uid = a.uid
      WHERE a.ts >= ? AND a.ts < ? AND a.uid != '' GROUP BY a.uid ORDER BY neurons DESC LIMIT 15`, from, to).map((r) => ({ ...r, neurons: round(r.neurons, 1) }));
    const perDay = h.all("SELECT day_utc AS day, SUM(neurons) AS neurons, COUNT(*) AS requests FROM ai_usage WHERE ts >= ? AND ts < ? GROUP BY day_utc ORDER BY day_utc", from, to)
      .map((r) => ({ ...r, neurons: round(r.neurons, 0), over: round(Math.max(0, r.neurons - AI_FREE_NEURONS_PER_DAY), 0), usd: round(usd(r.neurons - AI_FREE_NEURONS_PER_DAY), 4) }));
    const models = h.all(`SELECT model, COUNT(*) AS requests, SUM(ok = 0) AS errors, AVG(ms) AS ms, SUM(neurons) AS neurons FROM ai_usage
      WHERE ts >= ? AND ts < ? AND model != '' GROUP BY model ORDER BY requests DESC`, from, to)
      .map((r) => ({ ...r, ms: Math.round(r.ms || 0), neurons: round(r.neurons, 1), error_pct: r.requests ? round((r.errors / r.requests) * 100, 1) : 0 }));
    const totalN = kinds.reduce((a, k) => a + (k.neurons || 0), 0);
    const activeUsers = h.one("SELECT COUNT(DISTINCT uid) AS n FROM ai_usage WHERE ts >= ? AND ts < ? AND uid != ''", from, to).n;
    return {
      kinds, users, models, per_day: perDay, setup: aiModels(h),
      total_neurons: round(totalN, 0), total_requests: kinds.reduce((a, k) => a + k.requests, 0),
      usd_over_free: round(perDay.reduce((a, d) => a + (d.usd || 0), 0), 4),
      per_user: activeUsers ? round(totalN / activeUsers, 1) : null,
      free_per_day: AI_FREE_NEURONS_PER_DAY,
      cloudflare: h.getSetting("cf_ai_cache", null),
    };
  },

  channels(h, f) {
    const { where, args } = evWhere({ ...f, source: "" });
    return {
      channels: h.all(`SELECT COALESCE(e.source, '—') AS source, COUNT(DISTINCT e.uid) AS users, COUNT(*) AS events,
        SUM(e.type = 'finish') AS finished, AVG(CASE WHEN e.type = 'evaluation' THEN e.val END) AS rating FROM events e WHERE ${where} GROUP BY e.source ORDER BY users DESC`, ...args)
        .map((r) => ({ ...r, rating: round(r.rating, 2) })),
    };
  },

  heatmap(h, f) {
    const { where, args } = evWhere(f);
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of h.all(`SELECT e.dow, e.hour, COUNT(*) AS n FROM events e WHERE ${where} AND e.uid != '' GROUP BY e.dow, e.hour`, ...args)) grid[r.dow][r.hour] = r.n;
    return { grid };
  },

  errors(h, f) {
    const from = Number(f.from), to = Number(f.to);
    const ev = h.all(`SELECT e.id, e.ts, e.uid, e.type, e.meta, u.name FROM events e LEFT JOIN users u ON u.uid = e.uid
      WHERE e.type IN (${ERROR_TYPES.map(() => "?").join(",")}) AND e.ts >= ? AND e.ts < ? ORDER BY e.id DESC LIMIT 300`, ...ERROR_TYPES, from, to)
      .map((r) => ({ id: `e${r.id}`, ts: r.ts, uid: r.uid, name: r.name, type: r.type, text: meta(r).error || meta(r).message || "" }));
    const ai = h.all(`SELECT a.id, a.ts, a.uid, a.kind, a.err, u.name FROM ai_usage a LEFT JOIN users u ON u.uid = a.uid WHERE a.ok = 0 AND a.ts >= ? AND a.ts < ? ORDER BY a.id DESC LIMIT 300`, from, to)
      .map((r) => ({ id: `a${r.id}`, ts: r.ts, uid: r.uid, name: r.name, type: `ai:${r.kind}`, text: r.err || "" }));
    const pay = h.all(`SELECT p.op, p.created_at AS ts, p.uid, p.error, u.name FROM payments p LEFT JOIN users u ON u.uid = p.uid WHERE p.status = 'error' AND p.created_at >= ? AND p.created_at < ? ORDER BY p.created_at DESC LIMIT 100`, from, to)
      .map((r) => ({ id: r.op, ts: r.ts, uid: r.uid, name: r.name, type: "pay_error", text: r.error || "" }));
    const tgFail = h.all(`SELECT c.id, c.ts, c.uid, c.err, u.name FROM chat c LEFT JOIN users u ON u.uid = c.uid WHERE c.ok = 0 AND c.ts >= ? AND c.ts < ? ORDER BY c.id DESC LIMIT 200`, from, to)
      .map((r) => ({ id: `c${r.id}`, ts: r.ts, uid: r.uid, name: r.name, type: "telegram", text: r.err || "" }));
    const list = [...ev, ...ai, ...pay, ...tgFail].sort((a, b) => b.ts - a.ts);
    const groups = {};
    for (const x of list) groups[x.type] = (groups[x.type] || 0) + 1;
    return { list: list.slice(0, 400), groups: Object.entries(groups).map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n) };
  },
};

export function report(h, f) {
  const fn = REPORTS[f.name];
  if (!fn) throw new Error(`unknown report ${f.name}`);
  return fn(h, { ...f, from: Number(f.from), to: Number(f.to) });
}

// ---------------------------------------------------
// Итоги дня
// ---------------------------------------------------
export function daySummary(h, day) {
  const from = Date.parse(`${day}T00:00:00Z`) - MSK;
  const to = from + DAY;
  const t = tiles(h, from, to);
  const fb = h.one("SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM feedback WHERE ts >= ? AND ts < ?", from, to);
  const neurons = h.one("SELECT COALESCE(SUM(neurons), 0) AS n FROM ai_usage WHERE ts >= ? AND ts < ?", from, to).n;
  return {
    new_users: t.new_users, active: t.active, finished: t.finished, avg_rating: t.avg_rating, revenue: t.revenue,
    payments: h.one("SELECT COUNT(*) AS n FROM payments WHERE status = 'paid' AND updated_at >= ? AND updated_at < ?", from, to).n,
    quizzes: h.one("SELECT COUNT(*) AS n FROM events WHERE type = 'quiz_done' AND ts >= ? AND ts < ?", from, to).n,
    feedback: fb.n, feedback_avg: fb.avg, neurons, usd: usd(neurons - AI_FREE_NEURONS_PER_DAY), over_free: neurons > AI_FREE_NEURONS_PER_DAY,
    errors: t.errors, tasks_due: h.one("SELECT COUNT(*) AS n FROM tasks WHERE due = ? AND status NOT IN ('done', 'rejected')", day).n,
  };
}

// ---------------------------------------------------
// Пользователи
// ---------------------------------------------------
const USER_SORT = {
  registered_at: "u.registered_at", last_active: "u.last_active", name: "u.search", xp: "u.xp", streak: "u.streak",
  cons: "u.cons", avg_rating: "u.avg_rating", sub_until: "CASE WHEN u.sub_until = -1 THEN 9e15 ELSE u.sub_until END", paid_total: "paid_total", lvl: "u.lvl",
};

function users(h, { filter = {}, sort = "last_active", dir = "desc", limit = 50, offset = 0 } = {}) {
  const { where, args } = userWhere(filter);
  const order = USER_SORT[sort] || USER_SORT.last_active;
  const d = dir === "asc" ? "ASC" : "DESC";
  const total = h.one(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, ...args).n;
  const rows = h.all(`SELECT u.*, (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.uid = u.uid AND p.status = 'paid') AS paid_total
    FROM users u WHERE ${where} ORDER BY ${order} ${d} NULLS LAST, u.uid LIMIT ? OFFSET ?`, ...args, Math.min(5000, Number(limit) || 50), Number(offset) || 0);
  return { total, rows: rows.map(publicUserRow) };
}

export function publicUserRow(u) {
  if (!u) return null;
  let specs = [];
  try { specs = JSON.parse(u.specs || "[]") || []; } catch {}
  const now = Date.now();
  return { ...u, specs, sub_active: u.sub_until === -1 || u.sub_until > now };
}

function userHub(h, { uid }) {
  uid = String(uid);
  const row = h.one(`SELECT u.*, (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.uid = u.uid AND p.status = 'paid') AS paid_total FROM users u WHERE u.uid = ?`, uid);
  if (!row) return null;
  return {
    user: publicUserRow(row),
    notes: h.all("SELECT * FROM notes WHERE uid = ? ORDER BY ts DESC", uid),
    payments: h.all("SELECT * FROM payments WHERE uid = ? ORDER BY created_at DESC", uid),
    feedback: h.all("SELECT * FROM feedback WHERE uid = ? ORDER BY ts DESC", uid),
    activity: h.all("SELECT day, COUNT(*) AS n FROM events WHERE uid = ? AND ts >= ? GROUP BY day", uid, Date.now() - 91 * DAY),
    counts: h.one("SELECT COUNT(*) AS events, MIN(ts) AS first FROM events WHERE uid = ?", uid),
    chat_count: h.one("SELECT COUNT(*) AS n FROM chat WHERE uid = ?", uid).n,
  };
}

function chat(h, { uid, before = null, limit = 300 }) {
  const rows = h.all(`SELECT * FROM chat WHERE uid = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT ?`, String(uid), ...(before ? [Number(before)] : []), Math.min(1000, Number(limit) || 300));
  return { rows: rows.reverse(), more: rows.length >= (Number(limit) || 300) };
}

function events(h, { uid, type = "", before = null, limit = 300 }) {
  const w = ["uid = ?"];
  const a = [String(uid)];
  if (type) { w.push("type = ?"); a.push(type); }
  if (before) { w.push("id < ?"); a.push(Number(before)); }
  const rows = h.all(`SELECT * FROM events WHERE ${w.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...a, Math.min(1000, Number(limit) || 300));
  return { rows: rows.map((r) => ({ ...r, meta: meta(r) })), more: rows.length >= (Number(limit) || 300) };
}

// ---------------------------------------------------
// Подписки, платежи
// ---------------------------------------------------
function subscriptions(h, { expiring = false } = {}) {
  const now = Date.now();
  const rows = h.all(`SELECT u.uid, u.name, u.username, u.sub_until, u.sub_plan, u.last_active,
    (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.uid = u.uid AND p.status = 'paid') AS paid_total
    FROM users u WHERE ${activeSubSql(now)} ${expiring ? `AND u.sub_until != -1 AND u.sub_until < ${now + 3 * DAY}` : ""}
    ORDER BY CASE WHEN u.sub_until = -1 THEN 9e15 ELSE u.sub_until END ASC LIMIT 2000`);
  return { rows };
}

function payments(h, { status = "", from = 0, to = Date.now() + DAY, limit = 500 } = {}) {
  const w = ["p.created_at >= ?", "p.created_at < ?"];
  const a = [Number(from) || 0, Number(to)];
  if (status) { w.push("p.status = ?"); a.push(status); }
  return {
    rows: h.all(`SELECT p.*, u.name, u.username FROM payments p LEFT JOIN users u ON u.uid = p.uid WHERE ${w.join(" AND ")} ORDER BY p.created_at DESC LIMIT ?`, ...a, Math.min(2000, Number(limit) || 500)),
    totals: h.one(`SELECT SUM(status = 'paid') AS paid, SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS revenue, SUM(status = 'error') AS errors,
      SUM(status = 'link') AS links, SUM(status = 'gift') AS gifts, SUM(status = 'refunded') AS refunded FROM payments p WHERE ${w.slice(0, 2).join(" AND ")}`, ...a.slice(0, 2)),
  };
}

// ---------------------------------------------------
// Сообщения: входящие ответы, рассылки, шаблоны, тексты бота
// ---------------------------------------------------
function inbox(h) {
  // Переписки, где мы писали пользователю или он ответил на наше сообщение
  const rows = h.all(`SELECT c.uid, MAX(c.id) AS last_id, MAX(c.ts) AS last_ts,
      MAX(CASE WHEN c.dir = 'in' AND c.kind = 'reply' THEN c.ts END) AS last_in,
      MAX(CASE WHEN c.dir = 'out' AND c.kind = 'admin' THEN c.ts END) AS last_out,
      u.name, u.username
    FROM chat c LEFT JOIN users u ON u.uid = c.uid
    WHERE (c.kind = 'admin' OR c.kind = 'reply') GROUP BY c.uid ORDER BY last_ts DESC LIMIT 500`);
  return {
    rows: rows.map((r) => {
      const last = h.one("SELECT text, dir, kind FROM chat WHERE uid = ? AND kind IN ('admin', 'reply') ORDER BY id DESC LIMIT 1", r.uid) || {};
      return { ...r, unanswered: !!(r.last_in && (!r.last_out || r.last_in > r.last_out)), last_text: last.text, last_dir: last.dir };
    }).sort((a, b) => (b.unanswered - a.unanswered) || (b.last_ts - a.last_ts)),
  };
}

function broadcasts(h) {
  return { rows: h.all("SELECT * FROM broadcasts ORDER BY id DESC LIMIT 200").map((b) => ({ ...b, buttons: JSON.parse(b.buttons || "[]"), filter: JSON.parse(b.filter || "{}") })) };
}

function broadcast(h, { id }) {
  const b = h.one("SELECT * FROM broadcasts WHERE id = ?", Number(id));
  if (!b) return null;
  const targets = h.all("SELECT t.*, u.name, u.username FROM bc_targets t LEFT JOIN users u ON u.uid = t.uid WHERE t.bid = ? ORDER BY t.ts DESC", b.id);
  const sent = targets.filter((t) => t.status === "sent");
  const returned48 = sent.filter((t) => h.one("SELECT 1 AS x FROM events WHERE uid = ? AND ts > ? AND ts < ? AND type NOT IN ('reminder', 'bot_blocked') LIMIT 1", t.uid, t.ts, t.ts + 2 * DAY)).length;
  const consult48 = sent.filter((t) => h.one("SELECT 1 AS x FROM events WHERE uid = ? AND type = 'finish' AND ts > ? AND ts < ? LIMIT 1", t.uid, t.ts, t.ts + 2 * DAY)).length;
  const paid7 = sent.filter((t) => h.one("SELECT 1 AS x FROM payments WHERE uid = ? AND status = 'paid' AND updated_at > ? AND updated_at < ? LIMIT 1", t.uid, t.ts, t.ts + 7 * DAY)).length;
  return {
    ...b, buttons: JSON.parse(b.buttons || "[]"), filter: JSON.parse(b.filter || "{}"),
    stats: {
      total: targets.length, sent: sent.length, failed: targets.filter((t) => t.status === "failed").length, pending: targets.filter((t) => t.status === "pending").length,
      clicked: targets.filter((t) => t.clicked > 0).length, returned48, consult48, paid7,
    },
    targets: targets.slice(0, 1000),
  };
}

export const SYSTEM_TEXTS = {
  streak_reminder: { label: "Напоминание о стрике (утро, 10:00)", def: "🔥 <b>Стрик {стрик} {дней} — не дайте ему сгореть!</b>\n\nПримите хотя бы одного пациента сегодня, чтобы сохранить серию." },
  streak_warning: { label: "Стрик сгорит сегодня (вечер, 20:00)", def: "⚠️ <b>Осталось 4 часа!</b>\n\n🔥 Стрик {стрик} {дней} сгорит в полночь. Один короткий приём — и серия сохранена." },
  streak_lost: { label: "Стрик сгорел", def: "😔 <b>Стрик сгорел</b>\n\nВы пропустили 2 дня и потеряли серию {стрик} {дней}.\nНачните новую сегодня — регулярная практика делает диагнозы точнее." },
  review_request: { label: "Просьба оценить (через 2 дня после старта)", def: "👋 {имя}, вы пользуетесь «Help me, Doctor» уже пару дней.\n\n<b>Как вам тренажёр?</b> Оцените от 1 до 5 — это займёт секунду и очень поможет сделать его лучше." },
  review_first: { label: "Просьба оценить (после первого разбора в боте)", def: "🙏 {имя}, это был ваш первый разобранный приём.\n\n<b>Как вам тренажёр?</b> Оцените от 1 до 5 — это займёт секунду и очень поможет сделать его лучше." },
  gift: { label: "Подарок подписки", def: "🎁 <b>Вам подарок — безлимитный доступ на {срок}!</b>\n\nПринимайте сколько угодно пациентов — в боте и в приложении.\nДоступ до: {до}" },
};

// ---------------------------------------------------
// Отзывы и анкеты
// ---------------------------------------------------
function feedback(h, { rating = "", has_text = "", source = "", status = "", from = 0, to = Date.now() + DAY } = {}) {
  const w = ["f.ts >= ?", "f.ts < ?"];
  const a = [Number(from) || 0, Number(to)];
  if (rating) { w.push("f.rating = ?"); a.push(Number(rating)); }
  if (has_text === "yes") w.push("COALESCE(f.text, '') != ''");
  if (has_text === "no") w.push("COALESCE(f.text, '') = ''");
  if (source) { w.push("f.source = ?"); a.push(source); }
  if (status) { w.push("COALESCE(f.status, 'new') = ?"); a.push(status); }
  const rows = h.all(`SELECT f.*, u.name, u.username, u.cons, u.avg_rating, u.sub_until, u.sub_plan FROM feedback f LEFT JOIN users u ON u.uid = f.uid
    WHERE ${w.join(" AND ")} ORDER BY f.ts DESC LIMIT 1000`, ...a).map((r) => {
    const req = h.one("SELECT 1 AS x FROM chat WHERE uid = ? AND kind = 'bot' AND text LIKE '%Как вам тренажёр%' AND ts < ? LIMIT 1", r.uid, r.ts);
    return { ...r, origin: req ? "request" : "button", sub_active: r.sub_until === -1 || r.sub_until > Date.now() };
  });
  const dist = [1, 2, 3, 4, 5].map((s) => h.one("SELECT COUNT(*) AS n FROM feedback WHERE rating = ? AND ts >= ? AND ts < ?", s, a[0], a[1]).n);
  const avg = h.one("SELECT ROUND(AVG(rating), 2) AS v, COUNT(*) AS n FROM feedback WHERE ts >= ? AND ts < ?", a[0], a[1]);
  return { rows, dist, avg: avg.v, total: avg.n, summary: h.getSetting("ai_feedback_summary", null) };
}

function onboarding(h) {
  const rows = h.all(`SELECT uid, name, username, level, about, expectations, registered_at, onboarding_done FROM users
    WHERE COALESCE(about, '') != '' OR COALESCE(expectations, '') != '' ORDER BY registered_at DESC LIMIT 2000`);
  const since = h.one("SELECT MIN(registered_at) AS t FROM users WHERE onboarding_done = 0 OR COALESCE(about, '') != '' OR COALESCE(expectations, '') != ''")?.t || 0;
  const newTotal = h.one("SELECT COUNT(*) AS n FROM users WHERE registered_at >= ?", since).n;
  const levels = h.all("SELECT level, COUNT(*) AS n FROM users WHERE registered_at >= ? GROUP BY level", since);
  const skipped = h.one("SELECT COUNT(*) AS n FROM users WHERE registered_at >= ? AND onboarding_done = 1 AND COALESCE(about, '') = '' AND COALESCE(expectations, '') = ''", since).n;
  const labels = Object.fromEntries(DOCTOR_LEVELS.map((l) => [l.key, l.label]));
  return {
    rows, total_new: newTotal, skipped, answered: rows.length,
    levels: levels.map((l) => ({ label: labels[l.level] || l.level || "—", n: l.n })),
  };
}

// ---------------------------------------------------
// Задачи
// ---------------------------------------------------
export const TASK_STATUSES = ["idea", "backlog", "doing", "review", "done", "rejected"];
const TASK_FIELDS = ["title", "descr", "type", "status", "priority", "assignee", "due", "labels", "impact", "effort", "links", "checklist", "sort"];

function taskOut(t) {
  const j = (s, d) => { try { return JSON.parse(s || "null") ?? d; } catch { return d; } };
  return { ...t, labels: j(t.labels, []), links: j(t.links, []), checklist: j(t.checklist, []) };
}

const SEED_TASKS = [
  { title: "Проверить оплату после исправления", descr: "Попробовать оплатить любой тариф. Если банк откажет — админам придёт текст ошибки Точки.", type: "bug", status: "backlog", priority: "high" },
  { title: "Проверить качество ответов ИИ на новых промптах", descr: "Пройти 2–3 приёма: обследования и осмотры должны показывать только данные своего метода.", type: "feature", status: "backlog", priority: "medium" },
  { title: "Выпустить токен Cloudflare для точного расхода ИИ", descr: "Деплойному токену CLOUDFLARE_API_TOKEN выдать право Account Analytics: Read и перезапустить деплой.", type: "feature", status: "backlog", priority: "medium" },
  { title: "Обновить меню команд бота", descr: "Запустить node scripts/set-webhook.mjs — появятся /feedback и /idea.", type: "feature", status: "backlog", priority: "low" },
];

// Разовые импорты задач (например, итоги созвонов): каждый добавляется один раз, даже если трекер уже заполнен
const OLEG = "1326867567", SASHA = "1062804986";
const CALL_0924 = "созвон 24.09";
const TASK_IMPORTS = {
  call_2026_09_24: [
    // Олег
    { title: "Прислать Александру договор (ГПХ / самозанятость)", descr: "Как только Александр пришлёт паспортные данные, ИНН и реквизиты.", type: "org", status: "backlog", priority: "high", assignee: OLEG },
    { title: "Иероглифы / китайские символы в ответах ИИ на русском", descr: "Сделано: ответы ИИ очищаются от символов CJK (обновление бота от 24.09).", type: "bug", status: "done", priority: "high", assignee: OLEG },
    { title: "Продумать монетизацию и подписку", descr: "Решение со созвона: поверх бесплатного бота — платные «программы» по специализациям.", type: "idea", status: "backlog", priority: "high", assignee: OLEG },
    { title: "Стартовый вопрос в боте: кто пользователь и какая специальность", descr: "Сделано: анкета при первом входе (студент / ординатор / врач, где учится или работает, ожидания) и выбор специальности с разделами в профиле.", type: "feature", status: "done", priority: "high", assignee: OLEG },
    { title: "Уведомления Александру о новых пользователях и отзывах", descr: "Сделано: Саша в админах, получает все уведомления; включить или выключить отдельные виды можно в «Настройках».", type: "feature", status: "done", priority: "medium", assignee: OLEG },
    { title: "Предлагать оставить отзыв после первого завершённого пациента", descr: "Сейчас бот просит оценку через 2 дня после старта и принимает /feedback. Нужно добавить просьбу сразу после первого разбора.", type: "feature", status: "backlog", priority: "medium", assignee: OLEG },
    { title: "Дашборд с аналитикой и общий трекер задач", descr: "Сделано: админка /admin — дашборд, аналитика, пользователи и переписка, задачи.", type: "feature", status: "done", priority: "high", assignee: OLEG },
    { title: "Три посадочные страницы: кардиология, терапия, неврология", descr: "Для SEO и таргетированной рекламы. Материалы собирает Александр.", type: "marketing", status: "backlog", priority: "medium", assignee: OLEG },
    { title: "Купить домен и запустить SEO через статьи", descr: "Статьи и полезные материалы по специальностям.", type: "marketing", status: "backlog", priority: "medium", assignee: OLEG },
    { title: "Разослать ~54 пользователям уведомление об обновлении сервиса", descr: "Админка → Сообщения → Новая рассылка. Сначала «Отправить себе».", type: "marketing", status: "backlog", priority: "high", assignee: OLEG },
    { title: "Выдать неделю премиума одногруппнику Александра", descr: "После того как Александр пришлёт его Telegram: /grant @username 7 в боте или «Подписка» в карточке пользователя.", type: "org", status: "backlog", priority: "medium", assignee: OLEG },
    { title: "Скинуть саммари встречи 24.09", descr: "", type: "org", status: "backlog", priority: "low", assignee: OLEG },
    // Александр (Саша)
    { title: "Прислать Telegram одногруппника, который тестировал бота", descr: "Ему выдадим неделю премиума.", type: "org", status: "backlog", priority: "medium", assignee: SASHA },
    { title: "Прислать паспортные данные, ИНН и реквизиты для договора", descr: "Реквизиты: номер карты или телефон для Сбера.", type: "org", status: "backlog", priority: "high", assignee: SASHA },
    { title: "Собрать материалы: кардиология, терапия, неврология", descr: "Примерно по 5 материалов на тему — для посадочных страниц и статей.", type: "content", status: "backlog", priority: "medium", assignee: SASHA },
    { title: "Найти примеры платных Telegram-каналов с медицинским контентом", descr: "Посмотреть, как оформлены и как продают доступ.", type: "marketing", status: "backlog", priority: "medium", assignee: SASHA },
    { title: "Проверить у знакомого гипотезу «стартового пациента» при первом входе", descr: "Результат написать на следующий день после созвона.", type: "idea", status: "backlog", priority: "medium", assignee: SASHA, due: "2026-09-25" },
    { title: "Подготовить вопросы для нетворкинга на бизнес-фестивале 29.09", descr: "", type: "marketing", status: "backlog", priority: "medium", assignee: SASHA, due: "2026-09-28" },
    // Решения
    { title: "Договорённости созвона 24.09", descr: "• Прибыль делится 50/50 за вычетом расходов (например, на маркетинг).\n• Фокус пока на B2C, B2B — позже.\n• Название сервиса пока не меняем, ребрендинг возможен в будущем.\n• Поверх бесплатного бота делаем платные «программы» по специализациям.", type: "org", status: "done", priority: "low" },
  ],
};

// Разовые смены статусов (по названию задачи): что уже сделано в коде
const TASK_STATUS_UPDATES = {
  done_2026_09_25: [
    ["Проверить оплату после исправления", "Оплата работает через посредника в Yandex Cloud."],
    ["Выпустить токен Cloudflare для точного расхода ИИ", "Деплойный токен читает аналитику — «Расход ИИ» → «Загрузить из Cloudflare»."],
    ["Обновить меню команд бота", "Меню и кнопка приложения обновляются при каждом деплое."],
    ["Купить домен и запустить SEO через статьи", "helpmedoctor.ru: главная, блог из 5 статей, sitemap, IndexNow, Яндекс Метрика."],
    ["Предлагать оставить отзыв после первого завершённого пациента", "Бот просит оценку сразу после первого разбора; на сайте форма отзыва появляется, пока эксперт пишет разбор."],
  ],
};
const UPDATE_0925 = "обновление 25.09";
const DONE_0925 = [
  { title: "Запасной ИИ и модели по шагам", descr: "Qwen3 по умолчанию, разбор эксперта — Llama 70B; при исчерпании лимита Cloudflare — Cerebras / Groq. Настройка в «Расход ИИ».", type: "feature" },
  { title: "Мини-приложение: кнопка «Открыть на сайте»", descr: "Открывает сайт в браузере сразу с входом (одноразовый код).", type: "feature" },
  { title: "Фото профиля из Telegram и своё", descr: "Фото подтягивается из Telegram, в «Настройках» можно загрузить своё или убрать.", type: "feature" },
  { title: "Удаление пациентов и тестов", descr: "Кнопка в карточке пациента и в тесте; опыт и статистика сохраняются.", type: "feature" },
  { title: "Новая главная и профиль", descr: "Главная: один пациент на приёме, один новый, один тест. Профиль — меню: подписка, статистика, настройки, отзыв, Telegram, выход. Списки — по 5 с кнопкой «Показать все».", type: "feature" },
  { title: "Диалог: анимации и сводка пациента", descr: "Реплика пациента выводится по словам, результаты обследований — построчно; сводка открывается поверх чата; скруглённая шапка, без полосы прокрутки; плавные переходы между экранами.", type: "feature" },
];

function runTaskStatusUpdates(h) {
  const now = Date.now();
  for (const [key, list] of Object.entries(TASK_STATUS_UPDATES)) {
    if (h.getMeta(`task_update:${key}`)) continue;
    h.setMeta(`task_update:${key}`, now);
    for (const [title, note] of list) {
      for (const t of h.all("SELECT id, status FROM tasks WHERE title = ? AND status NOT IN ('done', 'rejected')", title)) {
        h.sql.exec("UPDATE tasks SET status = 'done', updated_at = ? WHERE id = ?", now, t.id);
        h.sql.exec("INSERT INTO task_history (task_id, ts, admin, field, old, new) VALUES (?, ?, 'system', 'status', ?, 'done')", t.id, now, t.status);
        h.sql.exec("INSERT INTO task_comments (task_id, ts, admin, text) VALUES (?, ?, 'system', ?)", t.id, now, `✅ ${note}`);
      }
    }
    if (key === "done_2026_09_25") {
      DONE_0925.forEach((t, i) => h.sql.exec(
        "INSERT INTO tasks (title, descr, type, status, priority, assignee, labels, links, checklist, created_by, created_at, updated_at, sort) VALUES (?, ?, ?, 'done', 'medium', ?, ?, '[]', '[]', 'system', ?, ?, ?)",
        t.title, t.descr, t.type, OLEG, JSON.stringify([UPDATE_0925]), now, now, -2000 + i,
      ));
    }
  }
}

function runTaskImports(h) {
  const now = Date.now();
  for (const [key, list] of Object.entries(TASK_IMPORTS)) {
    if (h.getMeta(`task_import:${key}`)) continue;
    h.setMeta(`task_import:${key}`, now);
    list.forEach((t, i) => h.sql.exec(
      "INSERT INTO tasks (title, descr, type, status, priority, assignee, due, labels, links, checklist, created_by, created_at, updated_at, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', 'system', ?, ?, ?)",
      t.title, t.descr, t.type, t.status, t.priority, t.assignee || null, t.due || null, JSON.stringify([CALL_0924]), now, now, -1000 + i,
    ));
  }
  runTaskStatusUpdates(h); // после импортов: обновляет и только что добавленные задачи
}

function tasks(h, { status = "", assignee = "", type = "", q = "" } = {}) {
  if (!h.getMeta("tasks_seeded")) {
    h.setMeta("tasks_seeded", 1);
    if (!h.one("SELECT 1 AS x FROM tasks LIMIT 1")) {
      const now = Date.now();
      SEED_TASKS.forEach((t, i) => h.sql.exec(
        "INSERT INTO tasks (title, descr, type, status, priority, labels, links, checklist, created_by, created_at, updated_at, sort) VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', 'system', ?, ?, ?)",
        t.title, t.descr, t.type, t.status, t.priority, now, now, i,
      ));
    }
  }
  runTaskImports(h);
  const w = ["1 = 1"];
  const a = [];
  if (status) { w.push("status = ?"); a.push(status); }
  if (assignee) { w.push(assignee === "none" ? "assignee IS NULL" : "assignee = ?"); if (assignee !== "none") a.push(assignee); }
  if (type) { w.push("type = ?"); a.push(type); }
  let rows = h.all(`SELECT t.*, (SELECT COUNT(*) FROM task_comments c WHERE c.task_id = t.id) AS comments FROM tasks t WHERE ${w.join(" AND ")} ORDER BY sort ASC, id DESC LIMIT 2000`, ...a);
  // Поиск в JS: SQLite lower()/LIKE не различают регистр кириллицы
  const ql = String(q || "").trim().toLowerCase();
  if (ql) rows = rows.filter((t) => `${t.title || ""} ${t.descr || ""}`.toLowerCase().includes(ql));
  return { rows: rows.map(taskOut) };
}

function task(h, { id }) {
  const t = h.one("SELECT * FROM tasks WHERE id = ?", Number(id));
  if (!t) return null;
  return {
    ...taskOut(t),
    comments_list: h.all("SELECT * FROM task_comments WHERE task_id = ? ORDER BY ts", t.id),
    history: h.all("SELECT * FROM task_history WHERE task_id = ? ORDER BY ts DESC LIMIT 100", t.id),
  };
}

function normTask(p) {
  const out = {};
  for (const k of TASK_FIELDS) {
    if (p[k] === undefined) continue;
    let v = p[k];
    if (["labels", "links", "checklist"].includes(k)) v = JSON.stringify(Array.isArray(v) ? v.slice(0, 50) : []);
    else if (["impact", "effort"].includes(k)) v = v === "" || v == null ? null : Math.max(1, Math.min(5, Number(v)));
    else if (k === "sort") v = Number(v) || 0;
    else v = v == null || v === "" ? null : String(v).slice(0, k === "descr" ? 20000 : 300);
    if (k === "status" && !TASK_STATUSES.includes(v)) continue;
    out[k] = v;
  }
  return out;
}

export async function taskCreate(h, p, admin) {
  const t = normTask({ status: "idea", priority: "medium", type: "idea", ...p });
  if (!t.title) throw new Error("title required");
  const now = Date.now();
  const cols = Object.keys(t);
  const id = h.one(`INSERT INTO tasks (${cols.join(", ")}, created_by, created_at, updated_at) VALUES (${cols.map(() => "?").join(", ")}, ?, ?, ?) RETURNING id`,
    ...cols.map((c) => t[c]), admin, now, now).id;
  h.audit(admin, "task_create", id, { title: t.title });
  if (t.assignee && t.assignee !== admin) await notifyTaskAssigned(h, id, t.title, t.assignee);
  return task(h, { id });
}

async function notifyTaskAssigned(h, id, title, assignee) {
  await h.notifyAdmin(`📌 На вас задача: <b>${escHtml(title)}</b>`, "task", { only: [String(assignee)], kb: [[{ text: "Открыть", url: h.adminUrl(`/tasks/${id}`) }]] });
}

function escHtml(t) {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function taskUpdate(h, { id, patch }, admin) {
  const cur = h.one("SELECT * FROM tasks WHERE id = ?", Number(id));
  if (!cur) throw new Error("task not found");
  const t = normTask(patch || {});
  const cols = Object.keys(t).filter((c) => String(t[c] ?? "") !== String(cur[c] ?? ""));
  if (!cols.length) return task(h, { id });
  h.sql.exec(`UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, ...cols.map((c) => t[c]), Date.now(), cur.id);
  for (const c of cols) {
    if (c === "sort") continue;
    h.sql.exec("INSERT INTO task_history (task_id, ts, admin, field, old, new) VALUES (?, ?, ?, ?, ?, ?)", cur.id, Date.now(), admin, c,
      String(cur[c] ?? "").slice(0, 500), String(t[c] ?? "").slice(0, 500));
  }
  if (cols.includes("assignee") && t.assignee && t.assignee !== admin) await notifyTaskAssigned(h, cur.id, t.title || cur.title, t.assignee);
  return task(h, { id });
}

// ---------------------------------------------------
// Реестр операций (HubDO.admin(op, args, adminId))
// ---------------------------------------------------
export const ADMIN_OPS = {
  dashboard: (h, a) => dashboard(h, a),
  live: (h, a) => live(h, a),
  report: (h, a) => report(h, a),
  users: (h, a) => users(h, a),
  user_hub: (h, a) => userHub(h, a),
  chat: (h, a) => chat(h, a),
  events: (h, a) => events(h, a),
  subscriptions: (h, a) => subscriptions(h, a),
  payments: (h, a) => payments(h, a),
  inbox: (h) => inbox(h),
  broadcasts: (h) => broadcasts(h),
  broadcast: (h, a) => broadcast(h, a),
  segment_count: (h, a) => ({ count: h.segment(a.filter || {}).length }),
  broadcast_create: async (h, a, admin) => {
    const text = String(a.text || "").trim().slice(0, 4000);
    if (!text) throw new Error("Пустой текст рассылки");
    const id = h.createBroadcast({ ...a, text: toTelegramHtml(text), admin });
    await h.startBroadcast(id);
    return { id };
  },
  broadcast_stop: (h, a, admin) => { h.stopBroadcast(Number(a.id), admin); return { ok: true }; },
  broadcast_test: (h, a, admin) => h.testBroadcast(admin, toTelegramHtml(String(a.text || "").slice(0, 4000)), a.buttons),
  templates: (h) => ({ rows: h.all("SELECT * FROM templates ORDER BY name").map((t) => ({ ...t, buttons: JSON.parse(t.buttons || "[]") })) }),
  template_save: (h, a, admin) => {
    const now = Date.now();
    const name = String(a.name || "").slice(0, 100) || "Без названия";
    const text = String(a.text || "").slice(0, 4000);
    const buttons = JSON.stringify(a.buttons || []);
    if (a.id) h.sql.exec("UPDATE templates SET name = ?, text = ?, buttons = ?, updated_at = ? WHERE id = ?", name, text, buttons, now, Number(a.id));
    else a.id = h.one("INSERT INTO templates (name, text, buttons, updated_at) VALUES (?, ?, ?, ?) RETURNING id", name, text, buttons, now).id;
    h.audit(admin, "template_save", a.id, { name });
    return { id: a.id };
  },
  template_delete: (h, a, admin) => { h.sql.exec("DELETE FROM templates WHERE id = ?", Number(a.id)); h.audit(admin, "template_delete", a.id); return { ok: true }; },
  texts: (h) => {
    const cur = h.getSetting("texts", {});
    return { rows: Object.entries(SYSTEM_TEXTS).map(([key, t]) => ({ key, label: t.label, def: t.def, value: cur[key] || "" })) };
  },
  texts_save: (h, a, admin) => {
    const cur = h.getSetting("texts", {});
    for (const [k, v] of Object.entries(a.texts || {})) {
      if (!SYSTEM_TEXTS[k]) continue;
      // В интерфейсе тексты правят разметкой **жирный** / _курсив_; храним готовый HTML для Telegram
      const s = toTelegramHtml(String(v || "").trim().slice(0, 3000));
      if (s && s !== SYSTEM_TEXTS[k].def) cur[k] = s; else delete cur[k];
    }
    h.setSetting("texts", cur);
    h.audit(admin, "texts_save", "", { keys: Object.keys(a.texts || {}) });
    return { ok: true };
  },
  feedback: (h, a) => feedback(h, a),
  feedback_status: (h, a, admin) => {
    h.sql.exec("UPDATE feedback SET status = ? WHERE uid = ? AND ts = ?", String(a.status), String(a.uid), Number(a.ts));
    h.audit(admin, "feedback_status", a.uid, { ts: a.ts, status: a.status });
    return { ok: true };
  },
  onboarding: (h) => onboarding(h),
  notes_add: (h, a, admin) => {
    const text = String(a.text || "").trim().slice(0, 4000);
    if (!text) throw new Error("empty note");
    h.sql.exec("INSERT INTO notes (uid, ts, admin, text) VALUES (?, ?, ?, ?)", String(a.uid), Date.now(), admin, text);
    h.audit(admin, "note_add", a.uid);
    return { ok: true };
  },
  notes_delete: (h, a, admin) => { h.sql.exec("DELETE FROM notes WHERE id = ?", Number(a.id)); h.audit(admin, "note_delete", a.id); return { ok: true }; },
  tasks: (h, a) => tasks(h, a),
  task: (h, a) => task(h, a),
  task_create: (h, a, admin) => taskCreate(h, a, admin),
  task_update: (h, a, admin) => taskUpdate(h, a, admin),
  task_delete: (h, a, admin) => {
    h.sql.exec("DELETE FROM tasks WHERE id = ?", Number(a.id));
    h.sql.exec("DELETE FROM task_comments WHERE task_id = ?", Number(a.id));
    h.audit(admin, "task_delete", a.id);
    return { ok: true };
  },
  task_comment: (h, a, admin) => {
    const text = String(a.text || "").trim().slice(0, 4000);
    if (!text) throw new Error("empty comment");
    h.sql.exec("INSERT INTO task_comments (task_id, ts, admin, text) VALUES (?, ?, ?, ?)", Number(a.id), Date.now(), admin, text);
    h.sql.exec("UPDATE tasks SET updated_at = ? WHERE id = ?", Date.now(), Number(a.id));
    return task(h, { id: a.id });
  },
  payment_status: (h, a, admin) => {
    if (!["refunded", "paid", "error", "link", "expired"].includes(a.status)) throw new Error("bad status");
    h.setPaymentStatus(String(a.op), a.status, a.note);
    h.audit(admin, "payment_status", a.op, { status: a.status, note: a.note });
    return { ok: true };
  },
  audit_log: (h, a) => ({
    rows: h.all(`SELECT * FROM admin_log ${a.before ? "WHERE id < ?" : ""} ORDER BY id DESC LIMIT ?`, ...(a.before ? [Number(a.before)] : []), Math.min(500, Number(a.limit) || 200)),
  }),
  notify_get: (h, a, admin) => ({ prefs: h.notifyPrefs(admin), kinds: NOTIFY_KINDS }),
  notify_save: (h, a, admin) => {
    const prefs = {};
    for (const k of Object.keys(NOTIFY_KINDS)) prefs[k] = a.prefs?.[k] !== false;
    h.setSetting(`notify:${admin}`, prefs);
    h.audit(admin, "notify_save", admin);
    return { prefs };
  },
  backfill_status: (h) => h.getMeta("backfill"),
  audit: (h, a, admin) => { h.audit(admin, a.action, a.target, a.details); return { ok: true }; },
  record_gift: (h, a, admin) => { h.recordGift(a.uid, a.days, admin, a.reason); return { ok: true }; },
  cf_cache_set: (h, a) => { h.setSetting("cf_ai_cache", a.value); return { ok: true }; },
  cf_cache_get: (h) => h.getSetting("cf_ai_cache", null),
  ai_models_get: (h) => aiModels(h),
  ai_models_set: (h, a, admin) => {
    const routing = {};
    for (const [k, v] of Object.entries(a.routing || {})) if (AI_STEPS[k] && AI_MODELS[v]) routing[k] = v;
    h.setSetting("ai_routing", routing);
    if (a.cap != null) h.setSetting("ai_cap", Math.max(0, Math.round(Number(a.cap) || 0)));
    h.audit(admin, "ai_models", "", { routing, cap: a.cap });
    return aiModels(h);
  },
  set_setting: (h, a) => { h.setSetting(a.k, a.v); return { ok: true }; },
  get_setting: (h, a) => h.getSetting(a.k, null),
  day_summary: (h, a) => daySummary(h, a.day || mskDate()),
  counts: (h, a, admin) => ({
    unanswered: inbox(h).rows.filter((r) => r.unanswered).length,
    feedback_new: h.one("SELECT COUNT(*) AS n FROM feedback WHERE COALESCE(status, 'new') = 'new'").n,
    my_tasks: h.one("SELECT COUNT(*) AS n FROM tasks WHERE assignee = ? AND status NOT IN ('done', 'rejected')", admin).n,
  }),
};

/** Настройки моделей ИИ для админки */
function aiModels(h) {
  const saved = h.getSetting("ai_routing", {}) || {};
  const routing = Object.fromEntries(Object.keys(AI_STEPS).map((k) => [k, [saved[k], AI_ROUTING_DEFAULT[k], AI_DEFAULT_MODEL].find((m) => m && AI_MODELS[m])]));
  return {
    steps: AI_STEPS, routing, defaults: Object.fromEntries(Object.keys(AI_STEPS).map((k) => [k, AI_ROUTING_DEFAULT[k] || AI_DEFAULT_MODEL])),
    models: Object.fromEntries(Object.entries(AI_MODELS).map(([k, m]) => [k, { label: m.label, note: m.note }])),
    cap: h.aiCap(), cap_default: AI_CAP_DEFAULT, used_today: round(h.aiUsedToday(), 0), cf_blocked: h.aiRoute().cf_blocked,
    fallbacks: AI_FALLBACKS.map((f) => ({ label: f.label, secret: f.secret, configured: !!h.env[f.secret] })),
  };
}

// Виды уведомлений админам (каждый админ включает/выключает у себя)
export const NOTIFY_KINDS = {
  new_user: "Новый пользователь",
  onboarding: "Анкета заполнена",
  first_patient: "Первый пациент пользователя",
  feedback: "Новый отзыв / отзыв дополнен",
  low_rating: "Низкая оценка сервиса (1–2 ★)",
  payment: "Оплата",
  payment_error: "Ошибка оплаты в банке",
  grant: "Подписка выдана другим админом",
  reply: "Ответ пользователя на наше сообщение",
  ai_errors: "Сбои ИИ (больше 5 за 10 минут)",
  ai_limit: "Расход ИИ: 80% бесплатного лимита, переключение на запасной ИИ",
  task: "Задача назначена на меня / срок сегодня",
  daily: "Итоги дня в 21:00",
  other: "Прочее",
};
