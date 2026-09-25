// Игровая механика: уровни, опыт, стрики, задания дня, лимиты
import {
  DAILY_TASKS, DIFFICULTIES, DOCTOR_LEVELS, FREE_DAILY_LIMIT, MAX_LEVEL, SPECIALIZATIONS,
} from "../config.js";
import { mskDate, mskMidnight, daysBetween, pick } from "./util.js";

// ---------- XP и уровни ----------
export function xpForLevel(level) {
  return Math.round(100 * level + 5 * level * (level - 1));
}

export function totalXpForLevel(level) {
  let total = 0;
  for (let i = 1; i < level; i++) total += xpForLevel(i);
  return total;
}

export function levelInfo(xp = 0) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= totalXpForLevel(level + 1)) level++;
  const from = totalXpForLevel(level);
  const to = level < MAX_LEVEL ? totalXpForLevel(level + 1) : null;
  return { level, from, to, progress: to ? (xp - from) / (to - from) : 1 };
}

export function streakBonus(streak) {
  return Math.min(Math.floor(streak / 7) * 0.1, 0.5);
}

// ---------- Профиль ----------
export function newProfile(uid, { name, username } = {}) {
  const now = Date.now();
  return {
    uid: String(uid),
    name: (name || "Доктор").slice(0, 40),
    username: username || "",
    level: "студент",
    profession: "Терапевт",
    specializations: [...SPECIALIZATIONS["Терапевт"]],
    difficulty: "", // пусто — сложность по роли
    onboarding_done: false, // анкета: роль, специальность, разделы, сложность → первый пациент
    about: "",
    expectations: "",
    review_asked: false,
    feedback: [],
    registered_at: now,
    last_active: now,
    patient_counter: 0,
    active_patient_ids: [],
    closed_patient_ids: [],
    test_ids: [],
    xp: 0,
    streak: 0,
    last_consult_date: null,
    daily_patients: [],
    stats: {
      patients_total: 0, consultations_total: 0, avg_rating: 0, ratings_count: 0,
      quizzes_done: 0, correct_diagnoses_streak: 0,
    },
    strengths: [],
    weaknesses: [],
    recommendations: [],
    daily_task: null,
  };
}

/** Мягкая нормализация старых профилей из KV */
export function normalizeProfile(p) {
  const base = newProfile(p.uid, p);
  const prof = { ...base, ...p, stats: { ...base.stats, ...(p.stats || {}) } };
  // Анкету показываем только новым пользователям
  if (p.onboarding_done === undefined) prof.onboarding_done = true;
  for (const k of ["active_patient_ids", "closed_patient_ids", "test_ids", "daily_patients", "strengths", "weaknesses", "recommendations", "feedback"]) {
    if (!Array.isArray(prof[k])) prof[k] = [];
  }
  if (!Array.isArray(prof.specializations) || !prof.specializations.length) {
    prof.specializations = [...(SPECIALIZATIONS[prof.profession] || SPECIALIZATIONS["Терапевт"])];
  }
  if (!DOCTOR_LEVELS.some((l) => l.key === prof.level)) prof.level = "студент";
  return prof;
}

/** Сложность пациентов: выбранная пользователем или по его роли */
/** Ключ сложности, доступный только в премиуме */
export const PREMIUM_DIFFICULTY = "hard";

export function complexityFor(prof, now = Date.now()) {
  const key = DIFFICULTIES.some((d) => d.key === prof.difficulty) ? prof.difficulty : levelMeta(prof.level).complexity;
  // «Очень сложные» случаи — в премиуме; без него — на ступень проще
  return key === PREMIUM_DIFFICULTY && !hasActiveSub(prof, now) ? "medium_hard" : key;
}

export function difficultyMeta(key) {
  return DIFFICULTIES.find((d) => d.key === key) || DIFFICULTIES[1];
}

export function levelMeta(levelKey) {
  return DOCTOR_LEVELS.find((l) => l.key === levelKey) || DOCTOR_LEVELS[0];
}

// ---------- Подписка и лимиты ----------
export function hasActiveSub(prof, now = Date.now()) {
  if (!prof.sub_until) return false;
  if (prof.sub_until === -1) return true;
  return now < prof.sub_until;
}

export function todayPatientsCount(prof, now = Date.now()) {
  const midnight = mskMidnight(now);
  return (prof.daily_patients || []).filter((ts) => ts >= midnight).length;
}

/** Премиум: полный разбор, тесты по ошибкам, «Очень сложные» случаи, статистика слабых мест */
export function isPremium(prof, now = Date.now()) {
  return hasActiveSub(prof, now);
}

/** Бесплатный лимит на сегодня (с учётом пациентов, которых админ добавил на сегодня) */
export function freeLeftToday(prof, now = Date.now()) {
  const extra = prof.extra_patients?.date === mskDate(now) ? prof.extra_patients.n || 0 : 0;
  return FREE_DAILY_LIMIT + extra - todayPatientsCount(prof, now);
}

export function canAcceptPatient(prof, now = Date.now()) {
  // Сверх бесплатного лимита — купленные пациенты (patient_credits), они не сгорают
  return hasActiveSub(prof, now) || freeLeftToday(prof, now) > 0 || (prof.patient_credits || 0) > 0;
}

/** Нужно ли списать купленного пациента за нового (лимит исчерпан, подписки нет) */
export function needsPatientCredit(prof, now = Date.now()) {
  return !hasActiveSub(prof, now) && freeLeftToday(prof, now) <= 0 && (prof.patient_credits || 0) > 0;
}

// ---------- Задание дня ----------
export function ensureDailyTask(prof, now = Date.now()) {
  const today = mskDate(now);
  // Задание сегодняшнего дня оставляем, если такой тип заданий ещё существует
  if (prof.daily_task?.date === today && DAILY_TASKS.some((t) => t.id === prof.daily_task.id)) return false;
  prof.daily_task = { date: today, ...pick(DAILY_TASKS), progress: 0, done: false };
  return true;
}

/**
 * Прогресс задания дня после приёма. Возвращает true, если задание выполнено этим приёмом.
 * @param {object} prof
 * @param {object} c — факты приёма (см. consultationFacts)
 * @param {number} rating
 */
export function applyDailyTask(prof, c, rating) {
  ensureDailyTask(prof);
  const task = prof.daily_task;
  if (task.done) return false;
  const tests = c.tests;
  const map = {
    consultations: 1,
    tests_per_consult: new Set(tests).size,
    physical: c.physicals.length,
    diagnosis: c.diagnosis ? 1 : 0,
    referral: c.referrals.length ? 1 : 0,
    treatment: c.treatment ? 1 : 0,
    rating: rating >= task.target ? 1 : 0,
    messages: c.doctorMessages.length,
    test_imaging: tests.some((t) => ["КТ", "МРТ"].includes(t)) ? 1 : 0,
    test_biopsy: tests.includes("Биопсия") ? 1 : 0,
    test_cardio: tests.includes("ЭКГ") && tests.includes("Эхо-КГ") ? 1 : 0,
    blood_test: tests.includes("Анализ крови") ? 1 : 0,
    correct_streak: prof.stats.correct_diagnoses_streak,
    physical_diagnosis: c.physicals.length && c.diagnosis && rating >= 4 ? 1 : 0,
    specific_physical: c.physicals.some((p) => /аускульт|пальп/i.test(p)) ? 1 : 0,
  };
  if (!(task.type in map)) return false;
  const value = map[task.type];
  const prev = task.progress || 0;
  if (task.type === "rating") task.progress = value ? task.target : prev;
  else if (task.type === "correct_streak") task.progress = value;
  // «За один приём» — лучший результат, остальное — накопительно за день
  else if (["tests_per_consult", "physical", "messages"].includes(task.type)) task.progress = Math.max(prev, value);
  else task.progress = prev + value;
  task.progress = Math.min(task.progress, task.target);
  if (task.progress >= task.target) {
    task.done = true;
    prof.xp = (prof.xp || 0) + task.xp;
    return true;
  }
  return false;
}

/** Прогресс заданий типа quiz — после прохождения теста */
export function applyQuizTask(prof) {
  ensureDailyTask(prof);
  const task = prof.daily_task;
  if (task.done || task.type !== "quiz") return false;
  task.progress = Math.min((task.progress || 0) + 1, task.target);
  if (task.progress >= task.target) {
    task.done = true;
    prof.xp = (prof.xp || 0) + task.xp;
    return true;
  }
  return false;
}

// ---------- Просьба об отзыве ----------
const REVIEW_AFTER_MS = 2 * 86400000;
const REVIEW_ACTIVE_WITHIN_MS = 14 * 86400000;

/** Через 2+ дня после регистрации — один раз, и только тем, кто недавно заходил */
export function shouldAskReview(prof, now = Date.now()) {
  if (prof.review_asked || prof.review_first_asked || (prof.feedback || []).length) return false;
  if (!prof.registered_at || now - prof.registered_at < REVIEW_AFTER_MS) return false;
  return now - (prof.last_active || 0) < REVIEW_ACTIVE_WITHIN_MS;
}

/** Сразу после первого разобранного приёма — один раз, если отзыва ещё нет */
export function shouldAskReviewAfterFirst(prof) {
  return !prof.review_first_asked && !(prof.feedback || []).length && (prof.stats?.ratings_count || 0) >= 1;
}

// ---------- Стрик ----------
export function applyStreak(prof, now = Date.now()) {
  const today = mskDate(now);
  const gap = daysBetween(prof.last_consult_date, today);
  if (gap === 0) return;
  // Пропущенные дни закрываются заморозками стрика (покупаются разово)
  const missed = gap - 1;
  if (gap > 1 && missed <= (prof.streak_freezes || 0) && prof.streak) {
    prof.streak_freezes -= missed;
    prof.streak_freezes_used = (prof.streak_freezes_used || 0) + missed;
    prof.streak = (prof.streak || 0) + 1;
  } else if (gap === 1) {
    prof.streak = (prof.streak || 0) + 1;
  } else {
    if (prof.last_consult_date) prof.streak_before_break = prof.streak || 0;
    prof.streak = 1;
  }
  prof.streak_broken_notified = false;
  prof.last_consult_date = today;
}

// ---------- Факты приёма ----------
const TREATMENT_RE = /назнач|принима|примите|пейте|таблетк|препарат|лечени|терапи|доз[аы]|курс |капсул|сироп|укол|инъекц|мазь|крем|спрей|капли|антибиотик|обезбол|диет|режим|постельн|ингаляц|массаж|лфк|омепразол|амоксицилл|ибупрофен|парацетамол|дротаверин|но-шп/i;

export function consultationFacts(pat) {
  const cur = pat.current || {};
  const doctorMessages = (pat.conversation_history || []).filter((m) => m.role === "doctor" && m.ts >= (cur.started_at || 0)).map((m) => m.text);
  const treatmentFromDialog = doctorMessages.filter((t) => TREATMENT_RE.test(t)).join("; ");
  return {
    doctorMessages,
    tests: cur.tests || [],
    physicals: cur.physicals || [],
    diagnosis: cur.diagnosis || null,
    treatment: cur.treatment || treatmentFromDialog || null,
    referrals: cur.referrals || [],
    discharged: !!cur.discharged,
  };
}

/** XP за приём */
export function consultationXp(prof, facts, rating) {
  const mult = levelMeta(prof.level).xpMult;
  const active = facts.doctorMessages.length > 1 || facts.tests.length || facts.physicals.length || facts.diagnosis;
  const base = active ? Math.round((100 + rating * 20) * mult) : Math.round(10 * mult);
  return Math.round(base * (1 + streakBonus(prof.streak || 0)));
}
