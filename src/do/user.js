// =====================================================
// UserDO — единый источник правды для одного врача.
// Бот и сайт вызывают одни и те же методы, поэтому данные всегда синхронны.
// Durable Object сериализует запросы, а изменения рассылаются в открытые вкладки по WebSocket.
// Тяжёлые ИИ-задачи (новый пациент, разбор приёма) выполняются в alarm() — там лимит 15 минут.
// =====================================================
import { DurableObject } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  DIFFICULTIES, DOCTOR_LEVELS, HISTORY_SUMMARIZE_AT, HISTORY_WINDOW,
  EARLY_UNTIL, HINTS_PER_PATIENT, MAX_ACTIVE_PATIENTS, PACKS, PHYSICAL_EXAMPLES, PLANS, SPECIALIZATIONS, TEST_TYPES, TRIAL, planPrice, productLabel,
} from "../config.js";
import { SYSTEM_TEXTS } from "../lib/analytics.js";
import { aiJson, aiText, transcribe } from "../lib/ai.js";
import * as P from "../lib/prompts.js";
import { krForPatient, krText, matchKr } from "../lib/kr.js";
import * as G from "../lib/game.js";
import { clampStr, daysBetween, declDays, esc, mskDate, pick, stripForeignDeep, UserError, userError } from "../lib/util.js";
import { tg } from "../lib/telegram.js";
import * as R from "../bot/render.js";

const PROFILE = "profile";
const STATE = "state";
const JOBS = "jobs";
const TOMBSTONE = "merged_into";
const patKey = (id) => `pat:${id}`;
const quizKey = (patId) => `quiz:${patId}`;

// Откуда пришло действие: bot | miniapp | web | system — задаётся в rpc()
const als = new AsyncLocalStorage();
// Что нельзя делать заблокированному админом пользователю
const BLOCKED_METHODS = new Set(["requestNewPatient", "startConsultation", "doctorMessage", "voiceMessage", "orderTest", "physicalExam", "requestHint", "finishConsultation", "answerQuiz", "reopenPatient"]);

export class UserDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.locks = new Map();
  }

  /**
   * Единая точка RPC: ожидаемые ошибки (лимит, «пациент не найден»…) возвращаем как данные,
   * чтобы они не попадали в логи Cloudflare как Uncaught Error.
   */
  async rpc(method, args = [], source = "system") {
    if (method.startsWith("_") || typeof this[method] !== "function" || ["rpc", "fetch", "alarm", "constructor"].includes(method)) {
      throw new Error(`unknown method ${method}`);
    }
    try {
      // Аккаунт склеен с Telegram: данные переехали, здесь только «надгробие» — ничего не создаём заново
      if (method !== "absorb" && (await this.ctx.storage.get(TOMBSTONE))) {
        throw new UserError("Аккаунт объединён с Telegram — обновите страницу", "merged");
      }
      if (BLOCKED_METHODS.has(method)) {
        const prof = await this.ctx.storage.get(PROFILE);
        if (prof?.blocked) throw new UserError("Доступ к тренажёру ограничен. Если это ошибка — напишите в поддержку.", "blocked");
      }
      return { ok: await als.run({ source }, () => this[method](...args)) };
    } catch (e) {
      const ue = userError(e);
      if (ue) return { userError: ue };
      throw e;
    }
  }

  // ---------------------------------------------------
  // Инициализация и миграция из старого KV
  // ---------------------------------------------------

  /** Гарантирует профиль. Возвращает { profile, isNew } */
  async init(uid, meta = {}) {
    let prof = await this.ctx.storage.get(PROFILE);
    let isNew = false;
    if (!prof) {
      prof = await this.migrateFromKv(uid);
      if (!prof) {
        prof = G.newProfile(uid, { name: meta.first_name, username: meta.username });
        isNew = true;
      }
      if (isNew && meta.ref) prof.ref = clampStr(meta.ref, 64);
      G.ensureDailyTask(prof);
      await this.ctx.storage.put(PROFILE, prof);
      await this.hub().registerUser(prof.uid, { name: prof.name, username: prof.username, isNew, ref: prof.ref || "" });
      if (isNew) await this.track("signup", { ref: prof.ref || null });
    } else {
      let changed = G.ensureDailyTask(prof);
      if (meta.username && meta.username !== prof.username) {
        prof.username = meta.username;
        changed = true;
      }
      if (changed) await this.ctx.storage.put(PROFILE, prof);
    }
    return { profile: prof, isNew };
  }

  // ---------------------------------------------------
  // Склейка аккаунтов: веб-аккаунт (Google/Яндекс) + Telegram
  // ---------------------------------------------------
  /** Все данные аккаунта для переноса в другой UserDO */
  async exportData() {
    const prof = await this.ctx.storage.get(PROFILE);
    if (!prof) return null;
    const jobs = (await this.ctx.storage.get(JOBS)) || [];
    if (jobs.length || (prof.generating_patient && Date.now() - prof.generating_patient < 120000)) {
      throw new UserError("Сейчас готовится пациент или разбор приёма — подождите минуту, привязка продолжится сама", "busy");
    }
    const entries = {};
    for (const prefix of ["pat:", "quiz:"]) {
      for (const [k, v] of await this.ctx.storage.list({ prefix })) entries[k] = v;
    }
    return { profile: prof, state: await this.state(), entries };
  }

  /**
   * Принимает данные другого аккаунта. Пустой профиль (только что открыл бота) заменяется целиком,
   * иначе прогресс складывается: приёмы, опыт, подписка и покупки не теряются.
   */
  async absorb(dump, uid) {
    if (!dump?.profile) return { ok: true };
    uid = String(uid);
    const src = G.normalizeProfile(dump.profile);
    let prof = await this.ctx.storage.get(PROFILE);
    // Повторная склейка того же аккаунта (сбой после absorb) ничего не удваивает
    if (prof?.merged_from?.includes(String(dump.profile.uid))) return { ok: true, repeated: true };
    const empty = !prof || (!prof.active_patient_ids?.length && !prof.closed_patient_ids?.length && !prof.xp && !G.hasActiveSub(prof) && !prof.payments?.length);
    if (empty) {
      prof = { ...src, uid, username: prof?.username || src.username || "", ref: src.ref || prof?.ref || "", blocked: !!(src.blocked || prof?.blocked) };
      await this.ctx.storage.put(STATE, dump.state || { active_patient_id: null, bot: null });
    } else {
      prof = G.normalizeProfile(prof);
      const st = prof.stats;
      const ss = src.stats;
      const ratings = (st.ratings_count || 0) + (ss.ratings_count || 0);
      st.avg_rating = ratings ? ((st.avg_rating || 0) * (st.ratings_count || 0) + (ss.avg_rating || 0) * (ss.ratings_count || 0)) / ratings : 0;
      st.ratings_count = ratings;
      for (const k of ["patients_total", "consultations_total", "quizzes_done"]) st[k] = (st[k] || 0) + (ss[k] || 0);
      prof.xp = (prof.xp || 0) + (src.xp || 0);
      prof.streak = Math.max(prof.streak || 0, src.streak || 0);
      prof.active_patient_ids = [...prof.active_patient_ids, ...src.active_patient_ids];
      prof.closed_patient_ids = [...prof.closed_patient_ids, ...src.closed_patient_ids];
      prof.test_ids = [...prof.test_ids, ...src.test_ids];
      prof.daily_patients = [...prof.daily_patients, ...src.daily_patients];
      prof.patient_counter = (prof.patient_counter || 0) + (src.patient_counter || 0);
      // Подписка: оплаченные дни веб-аккаунта добавляются к сроку Telegram-аккаунта
      const now = Date.now();
      if (src.sub_until === -1 || prof.sub_until === -1) prof.sub_until = -1;
      else if ((src.sub_until || 0) > now) {
        prof.sub_until = Math.max(prof.sub_until || 0, now) + (src.sub_until - now);
        prof.sub_plan = prof.sub_plan || src.sub_plan;
      }
      prof.blocked = !!(prof.blocked || src.blocked);
      prof.trial_used = !!(prof.trial_used || src.trial_used);
      prof.patient_credits = (prof.patient_credits || 0) + (src.patient_credits || 0);
      prof.streak_freezes = (prof.streak_freezes || 0) + (src.streak_freezes || 0);
      prof.payments = [...(prof.payments || []), ...(src.payments || [])];
      if (!prof.autopay && src.autopay) prof.autopay = src.autopay;
      for (const k of ["strengths", "weaknesses", "recommendations"]) prof[k] = [...new Set([...prof[k], ...src[k]])].slice(0, 20);
      if (!prof.onboarding_done && src.onboarding_done) {
        Object.assign(prof, { onboarding_done: true, level: src.level, profession: src.profession, specializations: src.specializations, difficulty: src.difficulty });
      }
      prof.registered_at = Math.min(prof.registered_at || Date.now(), src.registered_at || Date.now());
    }
    // Пациенты и тесты: id содержат старый uid и уникальны, ключи не пересекаются
    const entries = Object.entries(dump.entries || {}).map(([k, v]) => [k, k.startsWith("pat:") && v ? { ...v, doctor_uid: uid } : v]);
    for (let i = 0; i < entries.length; i += 100) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 100)));
    prof.merged_from = [...new Set([...(prof.merged_from || []), String(dump.profile.uid)])];
    G.ensureDailyTask(prof);
    await this.ctx.storage.put(PROFILE, prof);
    await this.track("account_merge", { from: dump.profile.uid, into_empty: empty });
    this.broadcast("profile");
    return { ok: true, into_empty: empty };
  }

  /** Аккаунт перенесён в другой: очищаем хранилище, открытые вкладки перезайдут */
  async wipe(into) {
    this.broadcast("merged");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.put(TOMBSTONE, { into: String(into || ""), at: Date.now() });
    return { ok: true };
  }

  async migrateFromKv(uid) {
    const KV = this.env.HELPMEDOCTOR;
    if (!KV) return null;
    const raw = await KV.get(`profile:${uid}`);
    if (!raw) return null;
    const prof = G.normalizeProfile(JSON.parse(raw));
    prof.uid = String(uid);
    const ids = [...new Set([...prof.active_patient_ids, ...prof.closed_patient_ids])];
    const pats = await Promise.all(ids.map((id) => KV.get(`patient:${id}`)));
    const entries = {};
    const alive = new Set();
    pats.forEach((r, i) => {
      if (!r) return;
      try {
        const pat = normalizePatient(JSON.parse(r));
        entries[patKey(ids[i])] = pat;
        alive.add(ids[i]);
      } catch (e) {
        console.error("migrate patient", ids[i], e);
      }
    });
    prof.active_patient_ids = prof.active_patient_ids.filter((id) => alive.has(id));
    prof.closed_patient_ids = prof.closed_patient_ids.filter((id) => alive.has(id));
    const testKeys = prof.test_ids.filter((k) => typeof k === "string");
    const tests = await Promise.all(testKeys.map((k) => KV.get(k)));
    const quizIds = [];
    tests.forEach((r) => {
      if (!r) return;
      try {
        const q = normalizeQuiz(JSON.parse(r));
        entries[quizKey(q.pat_id)] = q;
        quizIds.push(q.pat_id);
      } catch {}
    });
    prof.test_ids = quizIds;
    prof.migrated_at = Date.now();
    // storage.put с объектом пишет пачками по 128 ключей
    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = {};
      for (const k of keys.slice(i, i + 100)) chunk[k] = entries[k];
      await this.ctx.storage.put(chunk);
    }
    console.log(`migrated ${uid}: ${alive.size} patients, ${quizIds.length} quizzes`);
    return prof;
  }

  hub() {
    return this.env.HUB.get(this.env.HUB.idFromName("hub"));
  }

  // ---------------------------------------------------
  // Чтение
  // ---------------------------------------------------

  async profile() {
    const prof = await this.ctx.storage.get(PROFILE);
    if (!prof) throw new UserError("Профиль не найден", "no_profile");
    return prof;
  }

  async state() {
    return (await this.ctx.storage.get(STATE)) || { active_patient_id: null, bot: null };
  }

  async patient(id) {
    const pat = await this.ctx.storage.get(patKey(id));
    if (!pat) throw new UserError("Пациент не найден", "no_patient");
    return pat;
  }

  /** Всё для главного экрана веб-версии */
  async snapshot() {
    const prof = await this.profile();
    if (!prof.avatar && !prof.avatar_off && (!prof.avatar_checked || Date.now() - prof.avatar_checked > 7 * 86400000)) {
      this.ctx.waitUntil(this.ensureTgAvatar().catch((e) => console.warn("avatar", e.message)));
    }
    const st = await this.state();
    const ids = [...prof.active_patient_ids, ...prof.closed_patient_ids.slice(-60).reverse()];
    const pats = await this.ctx.storage.get(ids.map(patKey));
    const quizzes = await this.ctx.storage.get(prof.test_ids.slice(0, 40).map(quizKey));
    return {
      profile: publicProfile(prof),
      active_patient_id: st.active_patient_id,
      patients: ids.map((id) => pats.get(patKey(id))).filter(Boolean).map((p) => patientSummary(p)),
      quizzes: prof.test_ids.slice(0, 40).map((id) => quizzes.get(quizKey(id))).filter(Boolean).map((q) => ({ ...quizSummary(q), locked: !G.isPremium(prof) })),
      plans: offerPlans().plans,
      offer: offerPlans(),
      config: { specializations: SPECIALIZATIONS, levels: DOCTOR_LEVELS, difficulties: DIFFICULTIES, tests: TEST_TYPES, exams: PHYSICAL_EXAMPLES, max_active: MAX_ACTIVE_PATIENTS },
    };
  }

  async patientView(id) {
    const pat = await this.patient(id);
    const quiz = await this.ctx.storage.get(quizKey(id));
    const premium = G.isPremium(await this.profile());
    return { patient: publicPatient(pat, premium), quiz: quiz ? { ...quizSummary(quiz), locked: !premium } : null };
  }

  // ---------------------------------------------------
  // Профиль
  // ---------------------------------------------------

  async updateProfile(patch) {
    const prof = await this.profile();
    if (patch.name !== undefined) prof.name = clampStr(patch.name, 40) || prof.name;
    if (patch.level && DOCTOR_LEVELS.some((l) => l.key === patch.level)) prof.level = patch.level;
    if (patch.profession !== undefined) {
      const profession = clampStr(patch.profession, 40);
      if (profession) prof.profession = profession;
    }
    if (Array.isArray(patch.specializations)) {
      const specs = patch.specializations.map((s) => clampStr(s, 60)).filter(Boolean).slice(0, 12);
      if (specs.length) prof.specializations = [...new Set(specs)];
    }
    if (patch.difficulty !== undefined && (patch.difficulty === "" || DIFFICULTIES.some((d) => d.key === patch.difficulty))) prof.difficulty = patch.difficulty;
    if (patch.notifications !== undefined) prof.notifications = !!patch.notifications;
    if (patch.about !== undefined) prof.about = clampStr(patch.about, 600);
    if (patch.expectations !== undefined) prof.expectations = clampStr(patch.expectations, 600);
    const finishedOnboarding = patch.onboarding_done === true && !prof.onboarding_done;
    if (finishedOnboarding) prof.onboarding_done = true;
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    const fields = Object.keys(patch).filter((k) => k !== "onboarding_done");
    if (finishedOnboarding) {
      await this.track("onboarding", {
        answered: !!(prof.about || prof.expectations), level: prof.level, profession: prof.profession,
        specs: prof.specializations, difficulty: G.complexityFor(prof), skipped: !!patch.skipped,
      });
      if (!patch.skipped) await this.hub().notifyAdmin(onboardingNote(prof, "📝 Анкета"), "onboarding");
    } else if (fields.length) await this.track("profile_update", { fields, profession: prof.profession, notifications: prof.notifications !== false });
    return publicProfile(prof);
  }

  /** Ответ «о себе» после анкеты (в боте его спрашивают, пока готовится первый пациент) */
  async saveOnboardingAbout(text) {
    const prof = await this.profile();
    prof.about = clampStr(text, 600);
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("onboarding_about", { len: prof.about.length });
    await this.hub().notifyAdmin(onboardingNote(prof, "📝 Анкета дополнена"), "onboarding");
    return publicProfile(prof);
  }

  /** Разделы для своей специальности (ИИ, с кэшем на пользователя) */
  async suggestSections(profession) {
    profession = clampStr(profession, 40);
    if (!profession) return [];
    const known = Object.keys(SPECIALIZATIONS).find((k) => k.toLowerCase() === profession.toLowerCase());
    if (known) return SPECIALIZATIONS[known];
    const key = `sections:${profession.toLowerCase()}`;
    const cached = await this.ctx.storage.get(key);
    if (cached) return cached;
    const p = P.sectionsPrompt(profession);
    let data;
    try {
      data = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "sections", uid: (await this.profile()).uid });
    } catch (e) {
      console.error("sections", e);
      throw new UserError("Не удалось подобрать разделы — добавьте их вручную", "ai_error");
    }
    const list = [...new Set((Array.isArray(data?.sections) ? data.sections : [])
      .map((x) => clampStr(x, 60).toLowerCase()).filter(Boolean))].slice(0, 6);
    await this.ctx.storage.put(key, list);
    return list;
  }

  /** Отзыв о тренажёре. rating 1-5 и/или текст; текст без оценки дописывается к последнему отзыву. */
  async saveFeedback({ rating, text } = {}, source = "web") {
    const prof = await this.profile();
    const r = Math.round(Number(rating));
    const stars = r >= 1 && r <= 5 ? r : null;
    const body = clampStr(text, 1500);
    if (!stars && !body) throw new UserError("Поставьте оценку или напишите пару слов");
    prof.feedback = Array.isArray(prof.feedback) ? prof.feedback : [];
    const last = prof.feedback[prof.feedback.length - 1];
    let entry;
    if (!stars && last && !last.text && Date.now() - last.ts < 3600000) {
      last.text = body;
      entry = last;
    } else {
      entry = { ts: Date.now(), rating: stars, text: body, source };
      prof.feedback = [...prof.feedback, entry].slice(-10);
    }
    prof.review_asked = true;
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.hub().saveFeedback(prof.uid, { name: prof.name, username: prof.username, rating: entry.rating, text: entry.text, source, ts: entry.ts });
    await this.track("feedback", { rating: entry.rating, has_text: !!entry.text }, { val: entry.rating });
    return { ok: true };
  }

  // ---------------------------------------------------
  // Новый пациент (через очередь задач)
  // ---------------------------------------------------

  async requestNewPatient(origin = "web", botMsgId = 0) {
    const prof = await this.profile();
    if (prof.generating_patient && Date.now() - prof.generating_patient < 120000) {
      throw new UserError("Пациент уже готовится — подождите несколько секунд", "busy");
    }
    if (prof.active_patient_ids.length >= MAX_ACTIVE_PATIENTS) {
      throw new UserError(`У вас уже ${MAX_ACTIVE_PATIENTS} активных пациентов. Завершите один из приёмов, чтобы принять нового.`, "max_active");
    }
    if (!G.canAcceptPatient(prof)) {
      await this.track("limit_hit");
      throw new UserError(prof.trial_used
        ? `Бесплатный пациент на сегодня уже принят. Новый — после полуночи по Москве. Или безлимит в «Тарифах», или +3 пациента за ${Number(PACKS.patients3.price)} ₽.`
        : "Бесплатный пациент на сегодня уже принят. Попробуйте премиум: 7 дней безлимита за 1 ₽ — в «Тарифах».", "limit");
    }
    prof.generating_patient = Date.now();
    await this.ctx.storage.put(PROFILE, prof);
    await this.enqueue({ type: "new_patient", origin, botMsgId, source: this.source(), requested_at: Date.now() });
    await this.track("patient_request");
    this.broadcast("profile");
    return { queued: true };
  }

  async jobNewPatient(job) {
    const prof0 = await this.profile();
    const spec = pick(prof0.specializations);
    const counter = (prof0.patient_counter || 0) + 1;
    const used = [];
    const ids = [...prof0.active_patient_ids, ...prof0.closed_patient_ids.slice(-15)];
    const pats = await this.ctx.storage.get(ids.map(patKey));
    for (const p of pats.values()) if (p?.true_diagnosis) used.push(p.true_diagnosis);

    const p = P.patientPrompt({
      spec, profession: prof0.profession, complexity: G.complexityFor(prof0), usedDiagnoses: used,
    });
    const data = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: 0.95, kind: "patient", uid: prof0.uid });
    validatePatient(data);

    const now = Date.now();
    const id = `pat_${prof0.uid}_${now}`;
    const pat = {
      id,
      doctor_uid: prof0.uid,
      is_alien: false,
      specialization: spec,
      name: clampStr(data.name, 60),
      age: data.age,
      sex: data.sex,
      chief_complaint: clampStr(data.chief_complaint, 300),
      true_diagnosis: clampStr(data.true_diagnosis, 200),
      mkb10: clampStr(data.mkb10, 20),
      full_history: clampStr(data.full_history, 1500),
      personality: clampStr(data.personality, 300),
      opening_phrase: clampStr(data.opening_phrase, 400),
      key_findings: clampStr(data.key_findings, 600),
      findings: normalizeFindings(data.findings),
      condition_trajectory: data.condition_trajectory || "stable",
      status: "new",
      created_at: now,
      closed_at: null,
      consultations: [],
      conversation_history: [],
      summary: null,
      test_results: [],
      exam_results: [],
      hints: [],
      current: null,
    };
    // Клиническая рекомендация Минздрава по диагнозу: для подсказок и разбора. Текст подтягиваем заранее (кэш KV).
    pat.kr = matchKr({ diagnosis: pat.true_diagnosis, mkb: pat.mkb10, pediatric: Number(pat.age) < 18 });
    if (pat.kr) this.ctx.waitUntil(krText(this.env, pat.kr.id).catch(() => null));

    // Профиль перечитываем после ИИ — он мог измениться
    const prof = await this.profile();
    prof.patient_counter = counter;
    prof.active_patient_ids = [...prof.active_patient_ids, id];
    // Бесплатный лимит исчерпан, подписки нет — списываем купленного пациента
    if (G.needsPatientCredit(prof, now)) {
      prof.patient_credits -= 1;
      await this.track("patient_credit_used", { left: prof.patient_credits });
    }
    prof.daily_patients = [...prof.daily_patients.filter((ts) => ts >= now - 2 * 86400000), now];
    prof.stats.patients_total = (prof.stats.patients_total || 0) + 1;
    delete prof.generating_patient;
    await this.ctx.storage.put({ [patKey(id)]: pat, [PROFILE]: prof });
    this.broadcast("patients", { new_patient_id: id });

    if (job.origin === "bot") {
      const bot = tg(this.env);
      await bot.del(prof.uid, job.botMsgId);
      const m = R.newPatientReady(this.env, pat);
      await bot.send(prof.uid, m.text, m.kb);
    }
    await this.track("patient_ready", { spec, diagnosis: pat.true_diagnosis, name: pat.name }, { dur: job.requested_at ? Date.now() - job.requested_at : null, source: job.source });
    if (prof.stats.patients_total === 1) {
      await this.hub().notifyAdmin(`🩺 Первый пациент\nВрач: ${esc(prof.name)} ${prof.username ? "@" + esc(prof.username) : ""}\nuid: ${prof.uid}`, "first_patient");
    }
  }

  async jobNewPatientFailed(job, err) {
    const prof = await this.profile();
    delete prof.generating_patient;
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile", { error: "Не удалось создать пациента. Попробуйте ещё раз." });
    if (job.origin === "bot") {
      const bot = tg(this.env);
      await bot.del(prof.uid, job.botMsgId);
      await bot.send(prof.uid, "😔 Не получилось подготовить пациента. Попробуйте ещё раз.", R.kbNewPatient());
    }
    console.error("new_patient failed", err);
    await this.track("patient_failed", { error: String(err?.message || err).slice(0, 300) }, { source: job.source });
  }

  async rejectPatient(patId) {
    const prof = await this.profile();
    if (!prof.active_patient_ids.includes(patId)) throw new UserError("Этого пациента нет среди активных");
    const pat = await this.patient(patId);
    if ((pat.consultations || []).length) throw new UserError("С этим пациентом уже был приём — завершите его через «Завершить приём»");
    prof.active_patient_ids = prof.active_patient_ids.filter((id) => id !== patId);
    await this.ctx.storage.put(PROFILE, prof);
    await this.ctx.storage.delete(patKey(patId));
    await this.track("patient_reject", { name: pat.name, diagnosis: pat.true_diagnosis, complaint: pat.chief_complaint, spec: pat.specialization });
    const st = await this.state();
    if (st.active_patient_id === patId) await this.ctx.storage.put(STATE, { ...st, active_patient_id: null, bot: null });
    this.broadcast("patients");
    return { ok: true };
  }

  /** Повторный приём закрытого пациента */
  async reopenPatient(patId) {
    const prof = await this.profile();
    if (!prof.closed_patient_ids.includes(patId)) throw new UserError("Пациент не найден в архиве");
    if (prof.active_patient_ids.length >= MAX_ACTIVE_PATIENTS) {
      throw new UserError(`У вас уже ${MAX_ACTIVE_PATIENTS} активных пациентов. Завершите один, чтобы принять повторно.`, "max_active");
    }
    const pat = await this.patient(patId);
    pat.status = "active";
    pat.closed_at = null;
    prof.closed_patient_ids = prof.closed_patient_ids.filter((id) => id !== patId);
    prof.active_patient_ids = [patId, ...prof.active_patient_ids];
    await this.ctx.storage.put({ [patKey(patId)]: pat, [PROFILE]: prof });
    this.broadcast("patients");
    await this.track("patient_reopen", { name: pat.name });
    return { ok: true };
  }

  /** Удалить пациента насовсем (из очереди или архива) вместе с его тестом. Статистика и XP остаются. */
  async deletePatient(patId) {
    const prof = await this.profile();
    const known = prof.active_patient_ids.includes(patId) || prof.closed_patient_ids.includes(patId);
    if (!known) throw new UserError("Пациент не найден");
    const pat = await this.patient(patId);
    if (pat.consultations?.at(-1)?.evaluating) throw new UserError("Эксперт ещё разбирает приём — удалить можно после разбора", "busy");
    prof.active_patient_ids = prof.active_patient_ids.filter((id) => id !== patId);
    prof.closed_patient_ids = prof.closed_patient_ids.filter((id) => id !== patId);
    prof.test_ids = prof.test_ids.filter((id) => id !== patId);
    await this.ctx.storage.put(PROFILE, prof);
    await this.ctx.storage.delete([patKey(patId), quizKey(patId)]);
    const st = await this.state();
    if (st.active_patient_id === patId) await this.ctx.storage.put(STATE, { ...st, active_patient_id: null, bot: null });
    await this.track("patient_delete", { name: pat.name, diagnosis: pat.true_diagnosis, status: pat.status, consultations: (pat.consultations || []).length });
    this.broadcast("patients");
    return { ok: true };
  }

  /** Удалить тест «работа над ошибками» */
  async deleteQuiz(patId) {
    const prof = await this.profile();
    if (!prof.test_ids.includes(patId)) throw new UserError("Тест не найден");
    prof.test_ids = prof.test_ids.filter((id) => id !== patId);
    await this.ctx.storage.put(PROFILE, prof);
    await this.ctx.storage.delete(quizKey(patId));
    await this.track("quiz_delete", { patient: patId });
    this.broadcast("patients");
    return { ok: true };
  }

  // ---------------------------------------------------
  // Аватар: фото из Telegram или своё (хранится в KV, отдаётся по случайному id)
  // ---------------------------------------------------

  /** Один раз (и раз в неделю, если фото не было) подтягиваем фото профиля Telegram */
  async ensureTgAvatar(force = false) {
    const prof = await this.profile();
    if (!force && (prof.avatar || prof.avatar_off)) return prof.avatar || null;
    if (!force && prof.avatar_checked && Date.now() - prof.avatar_checked < 7 * 86400000) return null;
    // Вошёл через Google/Яндекс без Telegram — фото из Telegram брать неоткуда
    if (!/^\d+$/.test(String(prof.uid))) return null;
    prof.avatar_checked = Date.now();
    await this.ctx.storage.put(PROFILE, prof);
    const bot = tg(this.env, { log: false });
    const photos = await bot.call("getUserProfilePhotos", { user_id: Number(prof.uid), limit: 1 });
    const sizes = photos?.photos?.[0];
    if (!sizes?.length) return null;
    // Самый маленький размер не меньше 160 px — чётко на ретине и лёгкий
    const size = [...sizes].sort((a, b) => a.width - b.width).find((x) => x.width >= 160) || sizes.at(-1);
    let buf;
    try {
      buf = await bot.downloadFile(size.file_id);
    } catch (e) {
      console.warn("avatar download", e.message);
      return null;
    }
    return this.storeAvatar(buf, "image/jpeg", "tg");
  }

  async storeAvatar(buf, type, src) {
    if (!this.env.HELPMEDOCTOR) throw new UserError("Хранилище недоступно");
    const prof = await this.profile();
    const id = crypto.randomUUID().replace(/-/g, "");
    await this.env.HELPMEDOCTOR.put(`avatar:${id}`, buf, { metadata: { type, uid: prof.uid } });
    const old = prof.avatar?.id;
    prof.avatar = { id, src };
    prof.avatar_off = false;
    await this.ctx.storage.put(PROFILE, prof);
    if (old) await this.env.HELPMEDOCTOR.delete(`avatar:${old}`).catch(() => {});
    this.broadcast("profile");
    return prof.avatar;
  }

  /** Своё фото из настроек (уже сжатое в браузере) */
  async setAvatar(buf, type) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new UserError("Нужна картинка JPG, PNG или WebP");
    if (!buf?.byteLength || buf.byteLength > 400 * 1024) throw new UserError("Файл слишком большой — до 400 КБ");
    const avatar = await this.storeAvatar(buf, type, "custom");
    await this.track("avatar", { src: "custom" });
    return { profile: publicProfile(await this.profile()), avatar };
  }

  async avatarFromTelegram() {
    const avatar = await this.ensureTgAvatar(true);
    if (!avatar) throw new UserError("В Telegram нет фото профиля или оно скрыто настройками приватности");
    await this.track("avatar", { src: "tg" });
    return { profile: publicProfile(await this.profile()), avatar };
  }

  async removeAvatar() {
    const prof = await this.profile();
    const old = prof.avatar?.id;
    prof.avatar = null;
    prof.avatar_off = true;
    await this.ctx.storage.put(PROFILE, prof);
    if (old) await this.env.HELPMEDOCTOR?.delete(`avatar:${old}`).catch(() => {});
    this.broadcast("profile");
    return { profile: publicProfile(prof) };
  }

  // ---------------------------------------------------
  // Приём
  // ---------------------------------------------------

  /** Начать/продолжить приём. Делает пациента активным и в боте, и на сайте. */
  async startConsultation(patId) {
    const prof = await this.profile();
    if (!prof.active_patient_ids.includes(patId)) throw new UserError("Этот пациент не в очереди на приём");
    const pat = await this.patient(patId);
    const st = await this.state();
    const prevId = st.active_patient_id;
    let isNewConsultation = false;
    if (!pat.current) {
      isNewConsultation = true;
      pat.current = { started_at: Date.now(), tests: [], physicals: [], diagnosis: null, treatment: null, referrals: [], discharged: false };
      pat.status = "active";
      if (!pat.conversation_history.length && pat.opening_phrase) {
        pat.conversation_history.push({ role: "patient", text: pat.opening_phrase, ts: Date.now() });
      }
    }
    await this.ctx.storage.put({ [patKey(patId)]: pat, [STATE]: { ...st, active_patient_id: patId, bot: null } });
    this.broadcast("consultation", { patient_id: patId });
    await this.track("consult_start", { patient: patId, name: pat.name, new: isNewConsultation, n: (pat.consultations || []).length + 1 });
    const lastPatientMsg = [...pat.conversation_history].reverse().find((m) => m.role === "patient");
    return {
      patient: publicPatient(pat, G.isPremium(await this.profile())),
      paused_other: prevId && prevId !== patId ? prevId : null,
      is_new_consultation: isNewConsultation,
      consultation_number: (pat.consultations || []).length + 1,
      last_patient_message: lastPatientMsg?.text || null,
    };
  }

  /** Активный пациент с открытым приёмом (или null) */
  async activeConsultation() {
    const st = await this.state();
    if (!st.active_patient_id) return null;
    const pat = await this.ctx.storage.get(patKey(st.active_patient_id));
    if (!pat || !pat.current || pat.status === "closed") return null;
    return pat;
  }

  async doctorMessage(patId, text, { voice = false } = {}) {
    text = clampStr(text, 1500);
    if (!text) throw new UserError("Пустое сообщение");
    return this.withLock(patId, async () => {
      const pat = await this.openPatient(patId);
      pat.conversation_history.push({ role: "doctor", text, ts: Date.now(), ...(voice ? { voice: true } : {}) });
      await this.ctx.storage.put(patKey(patId), pat);
      this.broadcast("consultation", { patient_id: patId, typing: true });

      await this.track("message", { patient: patId, voice, len: text.length });
      const p = P.patientReplyPrompt(pat, text);
      let reply;
      const t0 = Date.now();
      try {
        reply = await aiText(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, kind: "reply", uid: pat.doctor_uid });
      } catch (e) {
        console.error("patient reply", e);
        this.broadcast("consultation", { patient_id: patId });
        await this.track("ai_error", { what: "reply", error: String(e.message || e).slice(0, 300) });
        throw new UserError("Пациент задумался… Попробуйте задать вопрос ещё раз.", "ai_error");
      }
      await this.track("reply", { patient: patId }, { dur: Date.now() - t0 });
      const fresh = await this.patient(patId);
      fresh.conversation_history.push({ role: "patient", text: reply, ts: Date.now() });
      await this.ctx.storage.put(patKey(patId), fresh);
      this.broadcast("consultation", { patient_id: patId });
      this.ctx.waitUntil(this.maybeSummarize(patId).catch((e) => console.error("summarize", e)));
      return { reply };
    });
  }

  async voiceMessage(patId, base64Audio) {
    let text;
    try {
      text = await transcribe(this.env, base64Audio, { uid: (await this.profile()).uid });
    } catch (e) {
      console.error("transcribe", e);
      await this.track("stt_error", { error: String(e.message || e).slice(0, 300) });
      throw new UserError("Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.", "stt_error");
    }
    if (!text) throw new UserError("В записи не слышно речи. Попробуйте ещё раз.", "stt_empty");
    const res = await this.doctorMessage(patId, text, { voice: true });
    return { transcript: text, ...res };
  }

  async orderTest(patId, testName) {
    testName = clampStr(testName, 80);
    if (!testName) throw new UserError("Укажите обследование");
    return this.withLock(patId, async () => {
      const pat = await this.openPatient(patId);
      // Повторный заказ того же обследования в этом приёме — отдаём готовый результат без ИИ
      const existing = pat.test_results.find((t) => t.test.toLowerCase() === testName.toLowerCase() && t.ordered_at >= pat.current.started_at);
      if (existing) {
        await this.track("test", { name: existing.test, cached: true, custom: !TEST_TYPES.includes(existing.test), patient: patId });
        return { test: existing.test, result: existing.result, cached: true };
      }
      this.broadcast("consultation", { patient_id: patId, typing: true });
      const p = P.testResultPrompt(pat, testName);
      let result;
      const t0 = Date.now();
      try {
        result = await aiText(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "test", uid: pat.doctor_uid });
      } catch (e) {
        console.error("test result", e);
        this.broadcast("consultation", { patient_id: patId });
        await this.track("ai_error", { what: "test", name: testName, error: String(e.message || e).slice(0, 300) });
        throw new UserError(`Результат «${testName}» временно недоступен. Попробуйте ещё раз.`, "ai_error");
      }
      const fresh = await this.patient(patId);
      fresh.current.tests.push(testName);
      fresh.test_results.push({ test: testName, result, ordered_at: Date.now() });
      await this.ctx.storage.put(patKey(patId), fresh);
      this.broadcast("consultation", { patient_id: patId });
      await this.track("test", { name: testName, custom: !TEST_TYPES.includes(testName), patient: patId }, { dur: Date.now() - t0 });
      return { test: testName, result };
    });
  }

  async physicalExam(patId, action) {
    action = clampStr(action, 200);
    if (!action) throw new UserError("Опишите, что осматриваете");
    return this.withLock(patId, async () => {
      const pat = await this.openPatient(patId);
      this.broadcast("consultation", { patient_id: patId, typing: true });
      const p = P.physicalExamPrompt(pat, action);
      let res;
      const t0 = Date.now();
      try {
        res = await aiJson(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "exam", uid: pat.doctor_uid });
      } catch (e) {
        console.error("physical", e);
        this.broadcast("consultation", { patient_id: patId });
        await this.track("ai_error", { what: "exam", name: action, error: String(e.message || e).slice(0, 300) });
        throw new UserError("Результат осмотра временно недоступен. Попробуйте ещё раз.", "ai_error");
      }
      const exam = {
        action,
        sensation: clampStr(res.sensation || res.ОЩУЩЕНИЯ || "", 1200),
        reaction: clampStr(res.reaction || res.РЕАКЦИЯ || "", 600),
        ts: Date.now(),
      };
      const fresh = await this.patient(patId);
      fresh.current.physicals.push(action);
      fresh.exam_results.push(exam);
      await this.ctx.storage.put(patKey(patId), fresh);
      this.broadcast("consultation", { patient_id: patId });
      await this.track("exam", { name: action, custom: !PHYSICAL_EXAMPLES.includes(action), patient: patId }, { dur: Date.now() - t0 });
      return exam;
    });
  }

  /**
   * Подсказка на приёме: ИИ смотрит диалог и назначения и называет один следующий шаг.
   * Не больше HINTS_PER_PATIENT на пациента; каждая снижает оценку и опыт за приём (см. game.js).
   */
  async requestHint(patId) {
    return this.withLock(`hint:${patId}`, async () => {
      const pat = await this.openPatient(patId);
      const used = (pat.hints || []).length;
      if (used >= HINTS_PER_PATIENT) throw new UserError(`Подсказки по этому пациенту закончились — все ${HINTS_PER_PATIENT} использованы`, "hints_out");
      const kr = pat.kr === undefined ? matchKr({ diagnosis: pat.true_diagnosis, mkb: pat.mkb10, pediatric: Number(pat.age) < 18 && !pat.is_alien }) : pat.kr;
      const text = kr ? await krText(this.env, kr.id) : null;
      const p = P.hintPrompt(pat, G.consultationFacts(pat), (pat.hints || []).map((h) => h.text), text?.diagnostics || "");
      let res;
      const t0 = Date.now();
      try {
        res = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "hint", uid: pat.doctor_uid });
      } catch (e) {
        console.error("hint", e);
        await this.track("ai_error", { what: "hint", error: String(e.message || e).slice(0, 300) });
        throw new UserError("Наставник задумался — попробуйте ещё раз. Подсказка не списана.", "ai_error");
      }
      const hintText = clampStr(res.hint || res.text || "", 400);
      if (!hintText) throw new UserError("Не получилось сформулировать подсказку — попробуйте ещё раз. Подсказка не списана.", "ai_error");
      const hint = { n: used + 1, text: hintText, kind: ["question", "exam", "test"].includes(res.kind) ? res.kind : "question", ts: Date.now() };
      const fresh = await this.patient(patId);
      fresh.hints = [...(fresh.hints || []), hint];
      if (fresh.kr === undefined) fresh.kr = kr;
      await this.ctx.storage.put(patKey(patId), fresh);
      this.broadcast("consultation", { patient_id: patId });
      await this.track("hint", { patient: patId, n: hint.n, kind: hint.kind }, { dur: Date.now() - t0 });
      return { hint, left: HINTS_PER_PATIENT - hint.n, total: HINTS_PER_PATIENT };
    });
  }

  /**
   * Завершить приём.
   * @param {{type: "diagnosis"|"referral"|"discharge", value?: string, treatment?: string}} action
   */
  async finishConsultation(patId, action, origin = "web") {
    const type = action?.type;
    if (!["diagnosis", "referral", "discharge"].includes(type)) throw new UserError("Неизвестное действие");
    const value = clampStr(action.value, 300);
    if (type !== "discharge" && !value) throw new UserError(type === "diagnosis" ? "Введите диагноз" : "Укажите специалиста");
    const refDiagnosis = clampStr(action.diagnosis, 300);
    if (type === "referral" && !refDiagnosis) throw new UserError("Укажите диагноз, с которым направляете пациента");
    return this.withLock(patId, async () => {
      const pat = await this.openPatient(patId);
      if (type === "diagnosis") pat.current.diagnosis = value;
      if (type === "referral") {
        pat.current.referrals.push(value);
        pat.current.diagnosis = refDiagnosis;
      }
      if (type === "discharge") pat.current.discharged = true;
      const treatment = clampStr(action.treatment, 500);
      if (treatment) pat.current.treatment = treatment;

      let farewell;
      try {
        const p = P.farewellPrompt(pat, actionsList(pat.current));
        farewell = await aiText(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, kind: "farewell", uid: pat.doctor_uid });
      } catch {
        farewell = "Спасибо, доктор. До свидания.";
      }

      const fresh = await this.patient(patId);
      fresh.current = pat.current;
      fresh.conversation_history.push({ role: "patient", text: farewell, ts: Date.now() });
      const facts = G.consultationFacts(fresh);
      const record = {
        id: `cons_${Date.now()}`,
        date: Date.now(),
        started_at: fresh.current.started_at,
        actions: actionsList(fresh.current),
        tests: facts.tests,
        physicals: facts.physicals,
        diagnosis: facts.diagnosis,
        treatment: facts.treatment,
        referrals: facts.referrals,
        discharged: facts.discharged,
        doctor_messages: facts.doctorMessages.length,
        hints: facts.hints.length,
        rating: null,
        feedback: null,
        evaluating: true,
      };
      fresh.consultations = [...(fresh.consultations || []), record];
      fresh.last_facts = facts;
      fresh.current = null;
      fresh.status = "closed";
      fresh.closed_at = Date.now();

      const prof = await this.profile();
      prof.active_patient_ids = prof.active_patient_ids.filter((id) => id !== patId);
      prof.closed_patient_ids = [...prof.closed_patient_ids.filter((id) => id !== patId), patId];
      prof.stats.consultations_total = (prof.stats.consultations_total || 0) + 1;
      prof.last_active = Date.now();
      const st = await this.state();
      await this.ctx.storage.put({
        [patKey(patId)]: fresh,
        [PROFILE]: prof,
        [STATE]: st.active_patient_id === patId ? { ...st, active_patient_id: null, bot: null } : st,
      });
      await this.enqueue({ type: "evaluate", patId, origin, source: this.source() });
      this.broadcast("patients", { patient_id: patId });
      await this.track("finish", {
        patient: patId, name: fresh.name, type, diagnosis: facts.diagnosis, referral: type === "referral" ? value : null, treatment: !!facts.treatment,
        tests: facts.tests.length, exams: facts.physicals.length, msgs: facts.doctorMessages.length,
        minutes: Math.round((Date.now() - (record.started_at || Date.now())) / 60000),
      });
      return { farewell, true_diagnosis: fresh.true_diagnosis, consultation_number: fresh.consultations.length, patient_name: fresh.name };
    });
  }

  async jobEvaluate(job) {
    const pat = await this.patient(job.patId);
    const record = pat.consultations[pat.consultations.length - 1];
    if (!record || !record.evaluating) return;
    const facts = pat.last_facts || G.consultationFacts(pat);

    let ev;
    const empty = !facts.doctorMessages.length && !facts.tests.length && !facts.physicals.length && !facts.diagnosis && !facts.treatment;
    if (empty) {
      ev = {
        rating: 0, axes: { diagnosis: 0, communication: 0, treatment: 0 }, diagnosis_correct: "no",
        expert_text: "Приём фактически не состоялся: ни одного вопроса, осмотра или назначения.",
        dialog_moments: [], strengths: [], weaknesses: ["Сбор анамнеза"], recommendation: "Начинайте приём с расспроса о жалобах.",
        outcome_update: "worsening", post_story: `${pat.name} ушёл без назначений и через неделю обратился в другую клинику.`,
      };
    } else {
      const p = P.evaluationPrompt(pat, { ...facts, profession: (await this.profile()).profession });
      try {
        ev = normalizeEvaluation(await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "evaluation", uid: pat.doctor_uid }));
        Object.assign(ev, G.scoreConsultation(ev, facts));
      } catch (e) {
        console.error("evaluate", e);
        if ((job.attempt || 0) < 2) throw e; // alarm повторит
        ev = normalizeEvaluation({ rating: 2.5, expert_text: "Оценка временно недоступна." });
      }
    }

    // Профиль: стрик, XP, задания — всё синхронно после ИИ
    const prof = await this.profile();
    const prevXp = prof.xp || 0;
    const prevStreak = prof.streak || 0;
    G.applyStreak(prof);
    const correct = ev.diagnosis_correct === "yes" || (ev.diagnosis_correct !== "no" && ev.rating >= 4 && facts.diagnosis);
    prof.stats.correct_diagnoses_streak = correct ? (prof.stats.correct_diagnoses_streak || 0) + 1 : 0;
    const earned = G.consultationXp(prof, facts, ev.rating);
    prof.xp = prevXp + earned;
    const taskDone = G.applyDailyTask(prof, facts, ev.rating);
    const rc = prof.stats.ratings_count || 0;
    prof.stats.avg_rating = Math.round((((prof.stats.avg_rating || 0) * rc + ev.rating) / (rc + 1)) * 10) / 10;
    prof.stats.ratings_count = rc + 1;
    prof.strengths = mergeList(ev.strengths, prof.strengths, 10);
    prof.weaknesses = mergeList(ev.weaknesses, prof.weaknesses, 10);
    if (ev.recommendation) prof.recommendations = mergeList([ev.recommendation], prof.recommendations, 5);

    const fresh = await this.patient(job.patId);
    const rec = fresh.consultations[fresh.consultations.length - 1];
    rec.rating = ev.rating;
    rec.feedback = {
      axes: ev.axes, expert_text: ev.expert_text, dialog_moments: ev.dialog_moments,
      diagnosis_correct: ev.diagnosis_correct, recommendation: ev.recommendation,
      strengths: ev.strengths, weaknesses: ev.weaknesses,
    };
    rec.post_story = ev.post_story;
    rec.xp = earned;
    rec.evaluating = false;
    fresh.post_story = ev.post_story;
    fresh.condition_trajectory = ev.outcome_update || fresh.condition_trajectory;
    delete fresh.last_facts;
    await this.ctx.storage.put({ [patKey(job.patId)]: fresh, [PROFILE]: prof });

    const lvlBefore = G.levelInfo(prevXp).level;
    const lvlAfter = G.levelInfo(prof.xp).level;
    const result = {
      patient_id: job.patId, patient_name: fresh.name, true_diagnosis: fresh.true_diagnosis,
      rating: ev.rating, axes: ev.axes, expert_text: ev.expert_text, dialog_moments: ev.dialog_moments,
      post_story: ev.post_story, xp: earned, streak: prof.streak, streak_bonus: G.streakBonus(prof.streak),
      level: lvlAfter, level_up: lvlAfter > lvlBefore ? { from: lvlBefore, to: lvlAfter } : null,
      task_done: taskDone ? prof.daily_task : null, consultation_number: fresh.consultations.length,
      hints: facts.hints?.length || 0, guide_pending: true,
    };
    // Без премиума: оценка и вывод эксперта; цитаты из диалога и «что было дальше» — закрыты
    if (!G.isPremium(prof)) Object.assign(result, { dialog_moments: [], post_story: null, locked: true, trial_available: !prof.trial_used });
    this.broadcast("evaluation", result);
    const evSource = { source: job.source || (job.origin === "bot" ? "bot" : "web") };
    await this.track("evaluation", {
      patient: job.patId, spec: fresh.specialization, rating: ev.rating, axes: ev.axes, correct: ev.diagnosis_correct, xp: earned,
      tests: facts.tests, exams: facts.physicals, weaknesses: ev.weaknesses, level: prof.level,
    }, { val: ev.rating, ...evSource });
    if (lvlAfter > lvlBefore) await this.track("level_up", { from: lvlBefore, to: lvlAfter }, evSource);
    if (taskDone) await this.track("task_done", { id: prof.daily_task.id, desc: prof.daily_task.desc, xp: prof.daily_task.xp }, evSource);
    if (prof.streak !== prevStreak) await this.track(prof.streak > prevStreak ? "streak_up" : "streak_reset", { streak: prof.streak, before: prevStreak }, evSource);

    if (job.origin === "bot") {
      const m = R.evaluation(this.env, result);
      await tg(this.env).send(prof.uid, m.text, m.kb);
      // Первый разобранный приём и отзыва ещё нет — сразу просим оценить тренажёр (на сайте это окно в листе завершения)
      if (G.shouldAskReviewAfterFirst(prof)) {
        prof.review_first_asked = true;
        await this.ctx.storage.put(PROFILE, prof);
        const texts = await this.hub().systemTexts().catch(() => ({}));
        await tg(this.env, { kind: "system" }).send(prof.uid, sysText(texts, "review_first", { имя: prof.name }), R.kbRating());
        await this.track("review_ask", { when: "first_patient" }, evSource);
      }
    }

    // Подробный разбор по клиническим рекомендациям Минздрава — отдельным шагом, чтобы оценка пришла быстрее
    let guide = null;
    try {
      guide = await this.buildGuide(job.patId, facts, ev);
    } catch (e) {
      console.error("guide", e);
      await this.track("ai_error", { what: "guide", error: String(e.message || e).slice(0, 300) });
    }
    if (guide && job.origin === "bot") {
      const m = R.guide(this.env, { patient_id: job.patId, patient_name: fresh.name, guide, premium: G.isPremium(prof) });
      await tg(this.env).send(prof.uid, m.text, m.kb).catch((e) => console.error("guide tg", e));
    }

    // Тест «работа над ошибками» — с упором на диагностику и лечение по КР
    try {
      await this.generateQuiz(fresh, ev, facts, guide);
    } catch (e) {
      console.error("quiz gen", e);
    }
  }

  /** Разбор по КР: находим рекомендацию, берём её текст, ИИ раскладывает случай по пунктам */
  async buildGuide(patId, facts, ev) {
    const pat = await this.patient(patId);
    let kr = pat.kr || null;
    if (!kr) kr = matchKr({ diagnosis: pat.true_diagnosis, mkb: ev.mkb10 || pat.mkb10, pediatric: Number(pat.age) < 18 && !pat.is_alien });
    const text = kr ? await krText(this.env, kr.id) : null;
    const p = P.guidePrompt(pat, facts, ev, kr, text);
    const t0 = Date.now();
    let raw;
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      try {
        raw = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "guide", uid: pat.doctor_uid });
      } catch (e) {
        if (attempt) throw e;
      }
    }
    const guide = { ...normalizeGuide(raw), kr, grounded: !!text, at: Date.now() };
    if (!guide.must.length && !guide.treatment.length) throw new Error("guide: пустой разбор");
    const fresh = await this.patient(patId);
    const rec = fresh.consultations[fresh.consultations.length - 1];
    if (!rec) return null;
    rec.guide = guide;
    if (!fresh.kr && kr) fresh.kr = kr;
    await this.ctx.storage.put(patKey(patId), fresh);
    this.broadcast("guide", { patient_id: patId });
    await this.track("guide", { patient: patId, kr: kr?.id || null, grounded: !!text, must: guide.must.length, missed: guide.must.filter((x) => !x.done).length, drugs: guide.treatment.length }, { dur: Date.now() - t0 });
    return guide;
  }

  async generateQuiz(pat, ev, facts, guide = null) {
    const topics = [
      ...(guide?.mistakes || []),
      ...(ev.weaknesses || []),
      ...(ev.dialog_moments || []).map((m) => m.comment),
      ev.recommendation,
    ].filter(Boolean).slice(0, 6);
    if (!topics.length) topics.push(`Диагностика и лечение: ${pat.true_diagnosis}`);
    const p = P.quizPrompt(pat, topics, guide, guide?.kr?.name || "");
    const data = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "quiz", uid: pat.doctor_uid });
    const questions = (data.questions || []).map(normalizeQuestion).filter(Boolean).slice(0, 5);
    if (questions.length < 3) throw new Error("quiz: мало валидных вопросов");
    const quiz = {
      pat_id: pat.id, pat_name: pat.name, pat_diagnosis: pat.true_diagnosis, specialization: pat.specialization,
      kr: guide?.kr || null,
      created_at: Date.now(), status: "pending", questions, answers: [], score: null, finished_at: null,
    };
    const prof = await this.profile();
    prof.test_ids = [pat.id, ...prof.test_ids.filter((id) => id !== pat.id)];
    await this.ctx.storage.put({ [quizKey(pat.id)]: quiz, [PROFILE]: prof });
    this.broadcast("quizzes", { patient_id: pat.id });
    await this.track("quiz_ready", { patient: pat.id, diagnosis: pat.true_diagnosis });
  }

  // ---------------------------------------------------
  // Тесты «работа над ошибками»
  // ---------------------------------------------------

  /** Тест по ошибкам — в премиуме (сам тест готовится для всех: после оплаты он сразу доступен) */
  async requirePremium(what) {
    const prof = await this.profile();
    if (G.isPremium(prof)) return prof;
    await this.track("paywall", { what });
    throw new UserError(prof.trial_used
      ? "Тест по вашим ошибкам — в премиуме. Оформите подписку в «Тарифах»."
      : "Тест по вашим ошибкам — в премиуме. Попробуйте 7 дней за 1 ₽ в «Тарифах».", "premium");
  }

  async quiz(patId) {
    const q = await this.ctx.storage.get(quizKey(patId));
    if (!q) throw new UserError("Тест ещё готовится — загляните через минуту", "quiz_pending");
    await this.requirePremium("quiz");
    if (q.status !== "done") await this.track("quiz_open", { patient: patId, answered: q.answers.length });
    return publicQuiz(q);
  }

  /** Ответ на вопрос. Возвращает правильность и объяснение. */
  async answerQuiz(patId, index, chosen) {
    const q = await this.ctx.storage.get(quizKey(patId));
    if (!q) throw new UserError("Тест не найден");
    await this.requirePremium("quiz");
    if (q.status === "done") return { done: true, quiz: publicQuiz(q) };
    if (index !== q.answers.length) {
      // Ответ на уже отвеченный/будущий вопрос (двойной клик, вторая вкладка) — просто отдаём состояние
      return { stale: true, quiz: publicQuiz(q) };
    }
    const question = q.questions[index];
    const c = Number(chosen);
    if (!question || !(c >= 0 && c < question.options.length)) throw new UserError("Неверный вариант ответа");
    const isCorrect = c === question.correct;
    q.answers.push({ chosen: c, is_correct: isCorrect });
    if (q.status === "pending") q.status = "in_progress";
    let taskDone = false;
    const done = q.answers.length === q.questions.length;
    const entries = {};
    if (done) {
      q.status = "done";
      q.finished_at = Date.now();
      q.score = q.answers.filter((a) => a.is_correct).length;
      const prof = await this.profile();
      prof.stats.quizzes_done = (prof.stats.quizzes_done || 0) + 1;
      const bonus = q.score * 5;
      prof.xp = (prof.xp || 0) + bonus;
      q.xp = bonus;
      taskDone = G.applyQuizTask(prof);
      entries[PROFILE] = prof;
    }
    entries[quizKey(patId)] = q;
    await this.ctx.storage.put(entries);
    this.broadcast("quizzes", { patient_id: patId });
    await this.track("quiz_answer", { patient: patId, i: index, correct: isCorrect, q: clampStr(question.text, 200) });
    if (done) await this.track("quiz_done", { patient: patId, score: q.score, total: q.questions.length }, { val: q.score });
    if (taskDone) await this.track("task_done", { id: entries[PROFILE].daily_task.id, desc: entries[PROFILE].daily_task.desc, xp: entries[PROFILE].daily_task.xp });
    return {
      is_correct: isCorrect, correct: question.correct, explanation: question.explanation,
      done, score: q.score, xp: q.xp || 0, task_done: taskDone, quiz: publicQuiz(q),
    };
  }

  // ---------------------------------------------------
  // Подписка
  // ---------------------------------------------------

  /** Оплата прошла (вебхук Точки): тариф, пробный период с автопродлением или разовая покупка */
  async activateSubscription(planKey, operationId, amount = null) {
    const product = planKey === TRIAL.key ? TRIAL : PLANS[planKey] || PACKS[planKey];
    if (!product) return null;
    const prof = await this.profile();
    prof.payments = prof.payments || [];
    if (operationId && prof.payments.some((p) => p.op === operationId)) return publicProfile(prof);
    const price = Number(amount || planPrice(planKey));
    prof.payments.push({ op: operationId, plan: planKey, ts: Date.now(), amount: price });
    prof.payments = prof.payments.slice(-20);
    const bot = tg(this.env);

    // Разовые покупки: пациенты сверх лимита и заморозки стрика
    if (PACKS[planKey]) {
      const pack = PACKS[planKey];
      if (pack.patients) prof.patient_credits = (prof.patient_credits || 0) + pack.patients;
      if (pack.freezes) prof.streak_freezes = (prof.streak_freezes || 0) + pack.freezes;
      await this.ctx.storage.put(PROFILE, prof);
      this.broadcast("profile", { paid: planKey });
      await this.track("paid", { plan: planKey, op: operationId }, { val: price });
      await bot.send(prof.uid, pack.patients
        ? `✅ <b>+${pack.patients} пациента</b> — можно принимать сверх бесплатного лимита в любой день.`
        : `❄️ <b>Заморозка стрика</b> добавлена. Если пропустите день, серия не сгорит.`, [[{ text: "➕ Принять пациента", callback_data: "new" }]]);
      return publicProfile(prof);
    }

    const days = product.days;
    if (planKey === "forever") prof.sub_until = -1;
    else if (prof.sub_until !== -1) {
      const from = prof.sub_until && prof.sub_until > Date.now() ? prof.sub_until : Date.now();
      prof.sub_until = from + days * 86400000;
    }
    prof.sub_plan = planKey;
    prof.sub_activated_at = Date.now();
    // Пробный период и месячный тариф — с автопродлением: цена фиксируется на момент оформления
    const recurring = planKey === TRIAL.key || PLANS[planKey]?.recurring;
    if (planKey === TRIAL.key) prof.trial_used = true;
    if (recurring && operationId && prof.sub_until !== -1) {
      const renewPlan = planKey === TRIAL.key ? TRIAL.then : planKey;
      const renewPrice = Number(planKey === TRIAL.key ? planPrice(TRIAL.then) : price);
      prof.autopay = { op: operationId, plan: renewPlan, price: renewPrice, next_at: prof.sub_until, status: "active", trial: planKey === TRIAL.key };
      await this.hub().autopaySet(prof.uid, { op: operationId, plan: renewPlan, price: renewPrice, next_at: prof.sub_until, trial: planKey === TRIAL.key });
    }
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile", { paid: planKey });
    await this.track(planKey === TRIAL.key ? "trial_start" : "paid", { plan: planKey, op: operationId }, { val: price });
    const until = prof.sub_until === -1 ? "навсегда" : fmtDay(prof.sub_until);
    const renewNote = prof.autopay?.status === "active" && recurring
      ? `\n\nДальше — автопродление: ${fmtRub(prof.autopay.price)} ₽ в месяц, первое списание ${fmtDay(prof.autopay.next_at)}. Отключить можно в профиле → «Подписка».` : "";
    await bot.send(prof.uid, planKey === TRIAL.key
      ? `🎉 <b>Премиум на 7 дней включён!</b>\n\nБезлимит пациентов, полный разбор эксперта, тесты по ошибкам и «Очень сложные» случаи — до ${until}.${renewNote}`
      : `✅ <b>Подписка активирована!</b>\n\nТариф: ${productLabel(planKey)}\nДоступ: ${until}${renewNote}\n\nТеперь можно принимать сколько угодно пациентов.`,
    [[{ text: "➕ Принять пациента", callback_data: "new" }]]);
    return publicProfile(prof);
  }

  /** Можно ли купить: пробный период — один раз и без действующей подписки; вторую подписку с автопродлением не оформляем */
  async checkPurchase(key) {
    const prof = await this.profile();
    if (key === TRIAL.key && (prof.trial_used || G.hasActiveSub(prof))) {
      throw new UserError(prof.trial_used ? "Пробный период уже использован" : "Премиум уже активен", "trial_used");
    }
    if ((key === TRIAL.key || PLANS[key]?.recurring) && prof.autopay?.status === "active") {
      throw new UserError("Подписка с автопродлением уже оформлена — она продлится сама", "autopay_active");
    }
    if (prof.sub_until === -1 && !PACKS[key]) throw new UserError("У вас бессрочный доступ — докупать ничего не нужно", "forever");
    return { price: planPrice(key) };
  }

  /** Автопродление прошло (списание из HubDO): доступ до until */
  async renewSubscription({ plan, op, amount, until, wasTrial = false }) {
    const prof = await this.profile();
    prof.payments = [...(prof.payments || []), { op, plan, ts: Date.now(), amount, renew: true }].slice(-20);
    if (prof.sub_until !== -1) prof.sub_until = Math.max(prof.sub_until || 0, until);
    prof.sub_plan = plan;
    prof.autopay = { ...(prof.autopay || {}), next_at: until, status: "active", trial: false };
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track(wasTrial ? "trial_converted" : "renewed", { plan, op }, { val: Number(amount), source: "system" });
    await tg(this.env, { kind: "system" }).send(prof.uid, `💳 <b>Подписка продлена</b>: списано ${fmtRub(amount)} ₽, доступ до ${fmtDay(until)}.\nОтключить автопродление можно в профиле → «Подписка».`);
    return publicProfile(prof);
  }

  /** Автопродление выключено (пользователем или после неудачных списаний) */
  async autopayEnded(reason = "user") {
    const prof = await this.profile();
    if (!prof.autopay) return publicProfile(prof);
    prof.autopay = { ...prof.autopay, status: reason === "failed" ? "failed" : "cancelled" };
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("autopay_off", { reason }, { source: reason === "failed" ? "system" : undefined });
    if (reason === "failed") {
      await tg(this.env, { kind: "system" }).send(prof.uid, "⚠️ <b>Автопродление отключено</b>: банк трижды отклонил списание. Премиум действует до конца оплаченного срока, продлить можно вручную в «Тарифах».");
    }
    return publicProfile(prof);
  }

  /** Пользователь отключает автопродление */
  async cancelAutopay() {
    const prof = await this.profile();
    if (prof.autopay?.status !== "active") throw new UserError("Автопродление уже отключено");
    await this.hub().autopayCancel(prof.uid, "user");
    const res = await this.autopayEnded("user");
    await tg(this.env, { kind: "system" }).send(prof.uid, `Автопродление отключено. Премиум действует ${prof.sub_until === -1 ? "бессрочно" : `до ${fmtDay(prof.sub_until)}`}, дальше — бесплатный тариф.`);
    return res;
  }

  /**
   * Бесплатная подписка от админа: дни добавляются к текущей подписке.
   * @param {number} days
   * @param {{reason?: string, notify?: boolean, text?: string, admin?: string, texts?: object}} opts
   */
  async grantSubscription(days, { reason = "", notify = true, text = "", admin = "", texts = {} } = {}) {
    days = Math.round(Number(days));
    if (!(days >= 1 && days <= 36500)) throw new UserError("Срок — от 1 дня");
    const prof = await this.profile();
    const forever = days >= 36500;
    if (forever) prof.sub_until = -1;
    else if (prof.sub_until !== -1) {
      const from = prof.sub_until && prof.sub_until > Date.now() ? prof.sub_until : Date.now();
      prof.sub_until = from + days * 86400000;
    }
    // Платный тариф не перетираем: подарок продлевает его
    const hadPaid = G.hasActiveSub(prof) && prof.sub_plan && prof.sub_plan !== "gift" && prof.sub_activated_at;
    if (!hadPaid) prof.sub_plan = "gift";
    prof.payments = [...(prof.payments || []), { op: `gift_${Date.now()}`, plan: "gift", days, ts: Date.now(), reason, admin }].slice(-20);
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile", { paid: "gift" });
    await this.track("gift", { days, reason, admin }, { source: "admin" });
    const until = prof.sub_until === -1 ? "навсегда" : new Date(prof.sub_until).toLocaleDateString("ru", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
    const term = forever ? "навсегда" : `${days} ${declDays(days)}`;
    if (notify) {
      const body = text
        ? text.replace(/\{срок\}/g, term).replace(/\{до\}/g, until).replace(/\{имя\}/g, esc(String(prof.name || "").split(" ")[0]))
        : sysText(texts, "gift", { срок: term, до: until, имя: prof.name });
      await tg(this.env, { kind: "admin", admin }).send(prof.uid, body, [[{ text: "➕ Принять пациента", callback_data: "new" }]]);
    }
    return { uid: prof.uid, name: prof.name, until };
  }

  /** Отмена подписки админом (сразу) */
  async adminCancelSubscription({ admin = "", notify = false, text = "" } = {}) {
    // Вместе с доступом отключаем и автопродление — иначе карта продолжит списываться
    if ((await this.profile()).autopay?.status === "active") {
      await this.hub().autopayCancel((await this.profile()).uid, `admin ${admin}`);
      await this.autopayEnded("admin");
    }
    const prof = await this.profile();
    prof.sub_until = Date.now() - 1;
    prof.payments = [...(prof.payments || []), { op: `cancel_${Date.now()}`, plan: "cancel", ts: Date.now(), admin }].slice(-20);
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("sub_cancel", { admin }, { source: "admin" });
    if (notify && text) await tg(this.env, { kind: "admin", admin }).send(prof.uid, text);
    return { ok: true };
  }

  /** Сократить подписку до даты (ts) */
  async adminSetSubUntil(ts, { admin = "" } = {}) {
    const prof = await this.profile();
    prof.sub_until = Number(ts);
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("sub_change", { admin, until: prof.sub_until }, { source: "admin" });
    return { ok: true };
  }

  /** Дополнительные бесплатные пациенты на сегодня */
  async adminExtraPatients(n, { admin = "", notify = true } = {}) {
    n = Math.max(1, Math.min(50, Math.round(Number(n) || 1)));
    const prof = await this.profile();
    const today = mskDate();
    const cur = prof.extra_patients?.date === today ? prof.extra_patients.n : 0;
    prof.extra_patients = { date: today, n: cur + n };
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("extra_patients", { n, admin }, { source: "admin" });
    if (notify) {
      await tg(this.env, { kind: "admin", admin }).send(prof.uid, `🎁 Сегодня вам доступно ещё <b>${n}</b> ${n === 1 ? "пациент" : n < 5 ? "пациента" : "пациентов"} бесплатно.`, [[{ text: "➕ Принять пациента", callback_data: "new" }]]);
    }
    return { ok: true, extra: prof.extra_patients };
  }

  async adminSetBlocked(blocked, { admin = "" } = {}) {
    const prof = await this.profile();
    prof.blocked = !!blocked;
    await this.ctx.storage.put(PROFILE, prof);
    await this.track(blocked ? "blocked" : "unblocked", { admin }, { source: "admin" });
    return { ok: true };
  }

  async adminResetStreak({ admin = "" } = {}) {
    const prof = await this.profile();
    prof.streak = 0;
    prof.last_consult_date = null;
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    await this.track("streak_reset", { admin, by_admin: true }, { source: "admin" });
    return { ok: true };
  }

  /** Всё о пользователе для карточки админки: профиль, пациенты целиком, тесты */
  async adminView() {
    const prof = await this.ctx.storage.get(PROFILE);
    if (!prof) return null;
    const ids = [...new Set([...prof.active_patient_ids, ...prof.closed_patient_ids])];
    const pats = ids.length ? await this.ctx.storage.get(ids.map(patKey)) : new Map();
    const quizzes = prof.test_ids.length ? await this.ctx.storage.get(prof.test_ids.map(quizKey)) : new Map();
    const st = await this.state();
    return {
      profile: { ...publicProfile(prof), payments: prof.payments || [], daily_patients: prof.daily_patients || [] },
      state: { active_patient_id: st.active_patient_id, bot_pending: st.bot?.pending || null },
      patients: ids.map((id) => pats.get(patKey(id))).filter(Boolean).map((p) => ({
        ...patientSummary(p), true_diagnosis: p.true_diagnosis,
        consultations_list: (p.consultations || []).map((c) => ({ date: c.date, rating: c.rating, diagnosis: c.diagnosis, referrals: c.referrals, discharged: c.discharged, evaluating: c.evaluating })),
        messages_count: (p.conversation_history || []).length,
      })).sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
      quizzes: prof.test_ids.map((id) => quizzes.get(quizKey(id))).filter(Boolean).map((q) => ({
        ...quizSummary(q),
        questions: q.questions.map((qq, i) => ({ text: qq.text, options: qq.options, correct: qq.correct, chosen: q.answers[i]?.chosen ?? null, explanation: qq.explanation })),
        finished_at: q.finished_at,
      })),
    };
  }

  /** Пациент целиком: скрытые данные, весь диалог, обследования, осмотры, разборы */
  async adminPatient(id) {
    const pat = await this.ctx.storage.get(patKey(id));
    if (!pat) return null;
    const quiz = await this.ctx.storage.get(quizKey(id));
    return { patient: pat, quiz: quiz || null };
  }

  /** Сводка для таблицы users в HubDO и события из прошлого (один раз при запуске админки) */
  async adminBackfill(uid) {
    let prof = await this.ctx.storage.get(PROFILE);
    if (!prof && uid) {
      prof = await this.migrateFromKv(uid);
      if (prof) await this.ctx.storage.put(PROFILE, prof);
    }
    if (!prof) return null;
    const events = [];
    const add = (ts, type, meta = {}, extra = {}) => ts && events.push({ uid: prof.uid, ts, type, meta, ...extra });
    add(prof.registered_at, "signup", {});
    const ids = [...new Set([...prof.active_patient_ids, ...prof.closed_patient_ids])];
    const pats = ids.length ? await this.ctx.storage.get(ids.map(patKey)) : new Map();
    for (const p of pats.values()) {
      if (!p) continue;
      add(p.created_at, "patient_ready", { spec: p.specialization, diagnosis: p.true_diagnosis, name: p.name });
      for (const m of p.conversation_history || []) if (m.role === "doctor") add(m.ts, "message", { patient: p.id, voice: !!m.voice, len: (m.text || "").length });
      for (const t of p.test_results || []) add(t.ordered_at, "test", { name: t.test, custom: !TEST_TYPES.includes(t.test), patient: p.id });
      for (const x of p.exam_results || []) add(x.ts, "exam", { name: x.action, custom: !PHYSICAL_EXAMPLES.includes(x.action), patient: p.id });
      for (const c of p.consultations || []) {
        const type = c.discharged ? "discharge" : (c.referrals || []).length ? "referral" : "diagnosis";
        add(c.started_at, "consult_start", { patient: p.id, name: p.name });
        add(c.date, "finish", { patient: p.id, name: p.name, type, diagnosis: c.diagnosis, treatment: !!c.treatment, tests: (c.tests || []).length, exams: (c.physicals || []).length, msgs: c.doctor_messages || 0, minutes: c.started_at ? Math.round((c.date - c.started_at) / 60000) : null });
        if (c.rating != null) add(c.date + 1000, "evaluation", { patient: p.id, spec: p.specialization, rating: c.rating, axes: c.feedback?.axes, correct: c.feedback?.diagnosis_correct, xp: c.xp, tests: c.tests || [], exams: c.physicals || [] }, { val: c.rating });
      }
    }
    const quizzes = prof.test_ids.length ? await this.ctx.storage.get(prof.test_ids.map(quizKey)) : new Map();
    for (const q of quizzes.values()) {
      if (!q) continue;
      add(q.created_at, "quiz_ready", { patient: q.pat_id });
      if (q.status === "done") add(q.finished_at, "quiz_done", { patient: q.pat_id, score: q.score, total: q.questions.length }, { val: q.score });
    }
    for (const f of prof.feedback || []) add(f.ts, "feedback", { rating: f.rating, has_text: !!f.text }, { val: f.rating });
    const payments = [];
    for (const pay of prof.payments || []) {
      if (pay.plan === "gift") { add(pay.ts, "gift", { days: pay.days }); continue; }
      if (!(PLANS[pay.plan] || PACKS[pay.plan] || pay.plan === TRIAL.key)) continue;
      const amount = Number(pay.amount ?? (PLANS[pay.plan]?.price || planPrice(pay.plan) || 0));
      add(pay.ts, "paid", { plan: pay.plan, op: pay.op }, { val: amount });
      if (pay.op) payments.push({ op: pay.op, plan: pay.plan, ts: pay.ts, amount, status: "paid" });
    }
    return { summary: this.summary(prof), events: events.filter((e) => e.ts > 0), payments };
  }

  /** Событие из бота/сайта/воркера (пауза, открыл тарифы, нажал «Оплатить»…) */
  async trackEvent(type, meta = {}, opts = {}) {
    await this.track(String(type).slice(0, 40), meta, opts);
    return { ok: true };
  }

  // ---------------------------------------------------
  // Состояние бота (ожидание ввода текста)
  // ---------------------------------------------------

  async setBotPending(pending) {
    const st = await this.state();
    await this.ctx.storage.put(STATE, { ...st, bot: pending });
  }

  /** Дедупликация апдейтов Telegram (ретраи вебхука) */
  async seenUpdate(updateId) {
    const seen = (await this.ctx.storage.get("tg_updates")) || [];
    if (seen.includes(updateId)) return true;
    seen.push(updateId);
    await this.ctx.storage.put("tg_updates", seen.slice(-50));
    return false;
  }

  /** Для /start: сводка по ожидающим пациентам */
  async waitingSummary() {
    const prof = await this.profile();
    const pats = await this.ctx.storage.get(prof.active_patient_ids.map(patKey));
    return {
      profile: publicProfile(prof),
      waiting: prof.active_patient_ids.map((id) => pats.get(patKey(id))).filter(Boolean).map(patientSummary),
    };
  }

  async touch(meta = {}) {
    const prof = await this.profile();
    prof.last_active = Date.now();
    if (meta.username) prof.username = meta.username;
    G.ensureDailyTask(prof);
    await this.ctx.storage.put(PROFILE, prof);
  }

  // ---------------------------------------------------
  // Напоминания (cron)
  // ---------------------------------------------------

  async cronTick(kind, uid, texts = {}) {
    let prof = await this.ctx.storage.get(PROFILE);
    if (!prof && uid) {
      // Старый пользователь, ещё не заходивший после переезда — переносим данные из KV
      prof = await this.migrateFromKv(uid);
      if (prof) await this.ctx.storage.put(PROFILE, prof);
    }
    if (!prof) return "skip";
    // Подписка закончилась — отмечаем один раз
    if (prof.sub_until > 0 && prof.sub_until < Date.now() && prof.sub_expired_logged !== prof.sub_until) {
      prof.sub_expired_logged = prof.sub_until;
      await this.ctx.storage.put(PROFILE, prof);
      await this.track("sub_expired", { plan: prof.sub_plan || null }, { source: "system" });
    }
    if (prof.notifications === false || prof.blocked) return "skip";
    const today = mskDate();
    const gap = daysBetween(prof.last_consult_date, today);
    const streak = prof.streak || 0;
    const bot = tg(this.env, { kind: "system" });
    const vars = { стрик: streak, дней: declDays(streak), имя: prof.name };
    const send = async (what, key, kb, v = vars) => {
      await bot.send(prof.uid, sysText(texts, key, v), kb);
      const delivered = bot.last.ok;
      if (!delivered && bot.last.code === 403) {
        prof.bot_blocked = true;
        await this.ctx.storage.put(PROFILE, prof);
        await this.track("bot_blocked", { error: bot.last.description }, { source: "system" });
      } else if (delivered && prof.bot_blocked) {
        prof.bot_blocked = false;
        await this.ctx.storage.put(PROFILE, prof);
      }
      await this.track("reminder", { kind: what, delivered }, { source: "system" });
      return what;
    };
    if (kind === "morning") {
      if (G.ensureDailyTask(prof)) await this.ctx.storage.put(PROFILE, prof);
      if (G.shouldAskReview(prof)) {
        prof.review_asked = true;
        await this.ctx.storage.put(PROFILE, prof);
        return send("review", "review_request", R.kbRating());
      }
      if (gap === 0) return "active";
      if (gap === 1 && streak >= 2) return send("reminder", "streak_reminder", R.streakReminder(this.env, streak).kb);
      if (gap === 2 && !(prof.streak_freezes > 0) && !prof.streak_broken_notified && (prof.streak_before_break || streak) >= 2) {
        prof.streak_broken_notified = true;
        await this.ctx.storage.put(PROFILE, prof);
        const lost = prof.streak_before_break || streak;
        return send("lost", "streak_lost", R.streakLost(this.env, lost).kb, { ...vars, стрик: lost, дней: declDays(lost) });
      }
    }
    if (kind === "evening" && gap === 1 && streak >= 3) return send("warning", "streak_warning", R.streakWarning(this.env, streak, { freezes: prof.streak_freezes || 0 }).kb);
    return "none";
  }

  /** Источник текущего действия (bot / miniapp / web / system / admin) */
  source() {
    return als.getStore()?.source || "system";
  }

  /** Сводка профиля для таблицы пользователей в HubDO */
  summary(prof) {
    const lvl = G.levelInfo(prof.xp || 0).level;
    const today = mskDate();
    return {
      name: prof.name, username: prof.username, registered_at: prof.registered_at, last_active: prof.last_active,
      level: prof.level, profession: prof.profession, specs: prof.specializations || [], xp: prof.xp || 0, lvl, streak: prof.streak || 0,
      cons: prof.stats?.consultations_total || 0, patients: prof.stats?.patients_total || 0, quizzes: prof.stats?.quizzes_done || 0,
      avg_rating: prof.stats?.avg_rating || 0, ratings_count: prof.stats?.ratings_count || 0, correct_streak: prof.stats?.correct_diagnoses_streak || 0,
      sub_until: prof.sub_until || 0, sub_plan: prof.sub_plan || null, paid: G.hasActiveSub(prof) ? 1 : 0,
      onboarding_done: prof.onboarding_done === false ? 0 : 1, about: prof.about || "", expectations: prof.expectations || "",
      notifications: prof.notifications === false ? 0 : 1, feedback_count: (prof.feedback || []).length,
      blocked: prof.blocked ? 1 : 0, bot_blocked: prof.bot_blocked ? 1 : 0, ref: prof.ref || null,
      extra_today: prof.extra_patients?.date === today ? prof.extra_patients.n : 0,
    };
  }

  /**
   * Событие для аналитики админки + свежая сводка профиля.
   * @param {string} type
   * @param {object} meta
   * @param {{dur?: number, val?: number, source?: string}} opts
   */
  async track(type, meta = {}, { dur = null, val = null, source = null } = {}) {
    try {
      const prof = await this.ctx.storage.get(PROFILE);
      if (!prof) return;
      if (prof.last_active < Date.now() - 60000 && !["reminder", "bot_blocked", "sub_expired", "gift", "sub_cancel", "sub_change", "extra_patients", "blocked", "unblocked"].includes(type)) {
        prof.last_active = Date.now();
        await this.ctx.storage.put(PROFILE, prof);
      }
      await this.hub().logEvent({ uid: prof.uid, type, source: source || this.source(), meta, dur, val, summary: this.summary(prof) });
    } catch (e) {
      console.error("track", type, e);
    }
  }

  // ---------------------------------------------------
  // Очередь задач на alarm
  // ---------------------------------------------------

  async enqueue(job) {
    const jobs = (await this.ctx.storage.get(JOBS)) || [];
    jobs.push({ id: crypto.randomUUID(), attempt: 0, ...job });
    await this.ctx.storage.put(JOBS, jobs);
    await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    if (await this.ctx.storage.get(TOMBSTONE)) return;
    for (let guard = 0; guard < 20; guard++) {
      const jobs = (await this.ctx.storage.get(JOBS)) || [];
      const job = jobs[0];
      if (!job) return;
      try {
        if (job.type === "new_patient") await this.jobNewPatient(job);
        if (job.type === "evaluate") await this.jobEvaluate(job);
        await this.dropJob(job.id);
      } catch (e) {
        console.error(`job ${job.type} attempt ${job.attempt}`, e);
        if (job.attempt < 2) {
          await this.bumpJob(job.id);
        } else {
          await this.dropJob(job.id);
          if (job.type === "new_patient") await this.jobNewPatientFailed(job, e);
          if (job.type === "evaluate") await this.jobEvaluateFailed(job, e);
        }
      }
    }
  }

  async jobEvaluateFailed(job, err) {
    console.error("evaluate failed completely", err);
    // На последней попытке jobEvaluate сам ставит заглушку, сюда попадаем только при ошибке хранения
  }

  async dropJob(id) {
    const jobs = (await this.ctx.storage.get(JOBS)) || [];
    await this.ctx.storage.put(JOBS, jobs.filter((j) => j.id !== id));
  }

  async bumpJob(id) {
    const jobs = (await this.ctx.storage.get(JOBS)) || [];
    const j = jobs.find((x) => x.id === id);
    if (j) j.attempt = (j.attempt || 0) + 1;
    await this.ctx.storage.put(JOBS, jobs);
  }

  // ---------------------------------------------------
  // WebSocket: живая синхронизация вкладок
  // ---------------------------------------------------

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    if (msg === "ping") ws.send("pong");
  }

  async webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch {}
  }

  broadcast(scope, data = {}) {
    const payload = JSON.stringify({ type: "sync", scope, ...data, ts: Date.now() });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch {}
    }
  }

  // ---------------------------------------------------
  // Вспомогательное
  // ---------------------------------------------------

  /** Операции над одним пациентом выполняются строго по очереди (два быстрых сообщения подряд — оба получат ответ) */
  async withLock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    let release;
    const mine = new Promise((r) => (release = r));
    const chain = prev.then(() => mine);
    this.locks.set(key, chain);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new UserError("Пациент ещё отвечает — подождите пару секунд", "busy")), 45000));
    try {
      await Promise.race([prev, timeout]);
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) this.locks.delete(key);
    }
  }

  /** Пациент с открытым приёмом; иначе ошибка */
  async openPatient(patId) {
    const pat = await this.patient(patId);
    if (!pat.current || pat.status === "closed") throw new UserError("Приём с этим пациентом не начат", "not_in_consultation");
    return pat;
  }

  async maybeSummarize(patId) {
    const pat = await this.patient(patId);
    const msgs = pat.conversation_history.filter((m) => m.role === "doctor" || m.role === "patient");
    const upto = pat.summary?.upto || 0;
    const cut = msgs.length - HISTORY_WINDOW;
    if (cut - upto < HISTORY_SUMMARIZE_AT - HISTORY_WINDOW) return;
    const chunk = msgs.slice(upto, cut);
    const prev = pat.summary?.text ? [{ role: "patient", text: `(Ранее) ${pat.summary.text}` }] : [];
    const p = P.summaryPrompt([...prev, ...chunk]);
    const text = await aiText(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "summarize", uid: pat.doctor_uid });
    const fresh = await this.patient(patId);
    fresh.summary = { text, upto: cut };
    await this.ctx.storage.put(patKey(patId), fresh);
  }
}

// =====================================================
// Нормализация и представления
// =====================================================

/** Текст системного сообщения бота: правка из админки или текст по умолчанию */
function sysText(texts, key, vars = {}) {
  let t = (texts && texts[key]) || SYSTEM_TEXTS[key]?.def || "";
  for (const [k, v] of Object.entries(vars)) {
    const val = k === "имя" ? String(v || "").split(" ")[0] || "доктор" : String(v ?? "");
    t = t.split(`{${k}}`).join(esc(val));
  }
  return t;
}

function actionsList(cur) {
  const a = [];
  for (const t of cur.tests || []) a.push(`Обследование: ${t}`);
  for (const p of cur.physicals || []) a.push(`Осмотр: ${p}`);
  if (cur.diagnosis) a.push(`Диагноз: ${cur.diagnosis}`);
  if (cur.treatment) a.push(`Лечение: ${cur.treatment}`);
  for (const r of cur.referrals || []) a.push(`Направление: ${r}`);
  if (cur.discharged) a.push("Отказ от пациента");
  return a;
}

function mergeList(fresh = [], old = [], max) {
  return [...new Set([...(fresh || []).filter(Boolean).map((s) => clampStr(s, 160)), ...(old || [])])].slice(0, max);
}

function normalizeFindings(f) {
  if (!f || typeof f !== "object") return null;
  const out = {};
  for (const k of ["exam", "lab", "imaging", "endoscopy", "ecg", "pathology"]) out[k] = clampStr(typeof f[k] === "string" ? f[k] : "", 500);
  return out;
}

function validatePatient(d) {
  if (!d || typeof d !== "object") throw new Error("patient: не объект");
  for (const k of ["name", "true_diagnosis", "full_history", "opening_phrase"]) {
    if (!d[k] || typeof d[k] !== "string") throw new Error(`patient: нет поля ${k}`);
  }
}

function normalizeEvaluation(e) {
  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : d;
  };
  const axes = e.axes || {};
  return {
    rating: Math.round(num(e.rating, 2.5) * 10) / 10,
    axes: { diagnosis: Math.round(num(axes.diagnosis)), communication: Math.round(num(axes.communication)), treatment: Math.round(num(axes.treatment)) },
    diagnosis_correct: ["yes", "partial", "no", "none"].includes(e.diagnosis_correct) ? e.diagnosis_correct : null,
    critical_error: clampStr(e.critical_error, 300),
    expert_text: clampStr(e.expert_text, 1500),
    dialog_moments: (Array.isArray(e.dialog_moments) ? e.dialog_moments : [])
      .filter((m) => m && m.comment).slice(0, 2).map((m) => ({ quote: clampStr(m.quote, 300), comment: clampStr(m.comment, 400) })),
    strengths: (Array.isArray(e.strengths) ? e.strengths : []).slice(0, 3),
    weaknesses: (Array.isArray(e.weaknesses) ? e.weaknesses : []).slice(0, 3),
    recommendation: clampStr(e.recommendation, 300),
    outcome_update: ["improving", "stable", "worsening", "critical"].includes(e.outcome_update) ? e.outcome_update : "stable",
    post_story: clampStr(e.post_story, 800),
    mkb10: clampStr(e.mkb10, 20),
  };
}

/** Разбор по КР: только ожидаемые поля и разумные длины */
export function normalizeGuide(g) {
  const arr = (v, n) => (Array.isArray(v) ? v : []).slice(0, n);
  const str = (v, n) => clampStr(typeof v === "string" ? v : "", n);
  return {
    diagnosis_path: arr(g?.diagnosis_path, 6).map((x) => str(x, 300)).filter(Boolean),
    must: arr(g?.must, 8).map((x) => (typeof x === "string" ? { item: str(x, 250), done: false } : { item: str(x?.item, 250), done: x?.done === true || x?.done === "true" })).filter((x) => x.item),
    optional: arr(g?.optional, 4).map((x) => str(x, 250)).filter(Boolean),
    tests: arr(g?.tests, 6).map((x) => (typeof x === "string" ? { name: str(x, 120), why: "" } : { name: str(x?.name, 120), why: str(x?.why, 300) })).filter((x) => x.name),
    treatment: arr(g?.treatment, 6).map((x) => ({
      drug: str(x?.drug, 120), dose: str(x?.dose, 200), duration: str(x?.duration, 120), note: str(x?.note, 250),
      source: x?.source === "kr" ? "kr" : "instr",
    })).filter((x) => x.drug),
    non_drug: str(g?.non_drug, 500),
    red_flags: arr(g?.red_flags, 3).map((x) => str(x, 250)).filter(Boolean),
    mistakes: arr(g?.mistakes, 4).map((x) => str(x, 300)).filter(Boolean),
  };
}

function normalizeQuestion(q) {
  if (!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) return null;
  const options = q.options.map((o) => clampStr(o, 160)).slice(0, 4);
  const correct = Number(q.correct);
  if (!(correct >= 0 && correct < options.length)) return null;
  const topic = ["treatment", "diagnostics", "error"].includes(q.topic) ? q.topic : null;
  return { text: clampStr(q.text, 500), options, correct, explanation: clampStr(q.explanation, 1000), ...(topic ? { topic } : {}) };
}

/** Приводим старых пациентов из KV к новому формату */
export function normalizePatient(p) {
  const pat = {
    conversation_history: [], consultations: [], test_results: [], exam_results: [], summary: null, current: null, ...p,
  };
  const summaries = pat.conversation_history.filter((m) => m.role === "summary");
  if (summaries.length && !pat.summary) {
    pat.summary = { text: summaries.map((m) => m.text).join(" "), upto: 0 };
  }
  pat.conversation_history = pat.conversation_history.filter((m) => m.role === "doctor" || m.role === "patient");
  if (!Array.isArray(pat.test_results)) pat.test_results = [];
  pat.consultations = (pat.consultations || []).map((c) => ({
    ...c,
    actions: c.actions || c.actions_taken || [],
    tests: c.tests || c.tests_ordered || [],
    diagnosis: c.diagnosis ?? c.diagnosis_given ?? null,
    treatment: c.treatment ?? c.treatment_prescribed ?? null,
    referrals: c.referrals || [],
    evaluating: false,
  }));
  if (pat.status !== "closed" && (pat._current_actions?.length || pat.conversation_history.length)) {
    pat.current = {
      started_at: pat.conversation_history[0]?.ts || pat.created_at || Date.now(),
      tests: pat._current_tests || [],
      physicals: (pat._current_actions || []).filter((a) => a.startsWith("Физический осмотр")).map((a) => a.replace("Физический осмотр: ", "")),
      diagnosis: null, treatment: null, referrals: [], discharged: false,
    };
  }
  for (const k of ["_current_actions", "_current_tests", "_current_diagnosis", "_current_treatment", "_current_referrals", "test_results_data"]) delete pat[k];
  return pat;
}

function normalizeQuiz(t) {
  return {
    pat_id: t.pat_id, pat_name: t.pat_name, pat_diagnosis: t.pat_diagnosis, specialization: t.specialization, kr: t.kr || null,
    created_at: t.created_at || Date.now(), status: t.status || "pending",
    questions: (t.questions || []).map(normalizeQuestion).filter(Boolean),
    answers: (t.answers || []).map((a) => ({ chosen: a.chosen, is_correct: !!a.is_correct })),
    score: t.score ?? null, finished_at: t.finished_at || null,
  };
}

/** Текст уведомления админам об анкете (HTML) */
function onboardingNote(prof, title) {
  const e = (x) => esc(String(x || ""));
  return `${title}: ${e(prof.name)}${prof.username ? " @" + e(prof.username) : ""} (${prof.uid})\n` +
    `Кто: ${e(G.levelMeta(prof.level).label)}\n` +
    `Специальность: ${e(prof.profession)}\n` +
    `Разделы: ${e((prof.specializations || []).join(", "))}\n` +
    `Сложность: ${e(G.difficultyMeta(G.complexityFor(prof)).label)}` +
    (prof.about ? `\nО себе: ${e(prof.about)}` : "") +
    (prof.expectations ? `\nОжидания: ${e(prof.expectations)}` : "");
}

/** Что продаём сейчас: тарифы с ранними ценами, пробный период и разовые покупки */
export function offerPlans(now = Date.now()) {
  const early = now < EARLY_UNTIL;
  const plans = Object.fromEntries(Object.entries(PLANS).filter(([, p]) => !p.hidden).map(([k, p]) => [k, {
    label: p.label, days: p.days, price: planPrice(k, now), regular: p.price, recurring: !!p.recurring, best: !!p.best,
  }]));
  return { plans, early, early_until: EARLY_UNTIL, trial: { ...TRIAL, then_price: planPrice(TRIAL.then, now) }, packs: PACKS };
}

const fmtDay = (ts) => new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const fmtRub = (v) => Number(v).toLocaleString("ru", { maximumFractionDigits: 2 });

export function publicProfile(prof) {
  const lvl = G.levelInfo(prof.xp || 0);
  const { payments, daily_patients, ...rest } = prof;
  return {
    ...rest,
    level_info: lvl,
    level_label: G.levelMeta(prof.level).label,
    complexity: G.complexityFor(prof),
    has_sub: G.hasActiveSub(prof),
    premium: G.isPremium(prof),
    // Пробный премиум — один раз и только тем, у кого сейчас нет подписки
    trial_available: !prof.trial_used && !G.hasActiveSub(prof),
    autopay: prof.autopay ? { plan: prof.autopay.plan, price: prof.autopay.price, next_at: prof.autopay.next_at, status: prof.autopay.status, trial: !!prof.autopay.trial } : null,
    patient_credits: prof.patient_credits || 0,
    streak_freezes: prof.streak_freezes || 0,
    // Слабые места и советы эксперта — в премиуме; бесплатным показываем, сколько их накопилось
    weaknesses: G.isPremium(prof) ? prof.weaknesses || [] : [],
    recommendations: G.isPremium(prof) ? prof.recommendations || [] : [],
    locked_insights: G.isPremium(prof) ? 0 : (prof.weaknesses || []).length + (prof.recommendations || []).length,
    today_patients: G.todayPatientsCount(prof),
    can_accept: G.canAcceptPatient(prof),
    generating_patient: !!(prof.generating_patient && Date.now() - prof.generating_patient < 120000),
    generating_since: prof.generating_patient && Date.now() - prof.generating_patient < 120000 ? prof.generating_patient : null,
  };
}

export function patientSummary(p) {
  const last = p.consultations?.[p.consultations.length - 1];
  const msgs = p.conversation_history || [];
  return {
    id: p.id, name: p.name, age: p.age, sex: p.sex, is_alien: !!p.is_alien, specialization: p.specialization,
    chief_complaint: p.chief_complaint, status: p.status, created_at: p.created_at, closed_at: p.closed_at,
    in_consultation: !!p.current,
    consultations: (p.consultations || []).length,
    last_rating: last?.rating ?? null,
    evaluating: !!last?.evaluating,
    true_diagnosis: p.status === "closed" ? p.true_diagnosis : null,
    last_message: msgs.length ? { role: msgs[msgs.length - 1].role, text: clampStr(msgs[msgs.length - 1].text, 120) } : null,
  };
}

export function publicPatient(p, premium = true) {
  const closed = p.status === "closed";
  const { full_history, key_findings, findings, personality, last_facts, summary, mkb10, kr, ...rest } = p;
  // Без премиума: оценка, оси и вывод эксперта; цитаты, совет и «что было дальше» — закрыты.
  // В разборе по КР бесплатно — как надо было распознать и чек-лист; диагностика и лечение с дозами — в премиуме.
  const lock = (c) => (premium || !c.feedback ? c : {
    ...c, post_story: null, locked: true,
    feedback: { axes: c.feedback.axes, expert_text: c.feedback.expert_text, diagnosis_correct: c.feedback.diagnosis_correct },
    guide: lockGuide(c.guide),
  });
  // Старые пациенты могли сохраниться с иероглифами от ИИ — чистим при показе
  return stripForeignDeep({
    ...rest,
    consultations: (p.consultations || []).map(lock),
    post_story: premium ? p.post_story : null,
    true_diagnosis: closed ? p.true_diagnosis : null,
    // Название КР выдаёт диагноз — показываем только после приёма
    kr: closed ? kr || null : null,
    current: p.current,
  });
}

export function lockGuide(g) {
  if (!g) return g;
  return {
    kr: g.kr, grounded: g.grounded, at: g.at, diagnosis_path: g.diagnosis_path, must: g.must, optional: g.optional,
    locked: true, counts: { tests: g.tests?.length || 0, treatment: g.treatment?.length || 0, red_flags: g.red_flags?.length || 0 },
  };
}

function quizSummary(q) {
  return {
    pat_id: q.pat_id, pat_name: q.pat_name, pat_diagnosis: q.pat_diagnosis, status: q.status, kr: q.kr || null,
    total: q.questions.length, answered: q.answers.length, score: q.score, created_at: q.created_at,
  };
}

export function publicQuiz(q) {
  const answered = q.answers.length;
  return {
    ...quizSummary(q),
    questions: q.questions.map((qq, i) => ({
      text: qq.text,
      options: qq.options,
      topic: qq.topic || null,
      // Правильный ответ и объяснение — только для уже отвеченных вопросов
      ...(i < answered || q.status === "done" ? { correct: qq.correct, explanation: qq.explanation, chosen: q.answers[i]?.chosen } : {}),
    })),
    xp: q.xp || 0,
  };
}
