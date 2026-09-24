// =====================================================
// UserDO — единый источник правды для одного врача.
// Бот и сайт вызывают одни и те же методы, поэтому данные всегда синхронны.
// Durable Object сериализует запросы, а изменения рассылаются в открытые вкладки по WebSocket.
// Тяжёлые ИИ-задачи (новый пациент, разбор приёма) выполняются в alarm() — там лимит 15 минут.
// =====================================================
import { DurableObject } from "cloudflare:workers";
import {
  ALIEN_PATIENT_EVERY, DOCTOR_LEVELS, HISTORY_SUMMARIZE_AT, HISTORY_WINDOW,
  MAX_ACTIVE_PATIENTS, PLANS, SPECIALIZATIONS, TEST_TYPES,
} from "../config.js";
import { aiJson, aiText, transcribe } from "../lib/ai.js";
import * as P from "../lib/prompts.js";
import * as G from "../lib/game.js";
import { clampStr, daysBetween, mskDate, pick, UserError, userError } from "../lib/util.js";
import { tg } from "../lib/telegram.js";
import * as R from "../bot/render.js";

const PROFILE = "profile";
const STATE = "state";
const JOBS = "jobs";
const patKey = (id) => `pat:${id}`;
const quizKey = (patId) => `quiz:${patId}`;

export class UserDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.locks = new Map();
  }

  /**
   * Единая точка RPC: ожидаемые ошибки (лимит, «пациент не найден»…) возвращаем как данные,
   * чтобы они не попадали в логи Cloudflare как Uncaught Error.
   */
  async rpc(method, args = []) {
    if (method.startsWith("_") || typeof this[method] !== "function" || ["rpc", "fetch", "alarm", "constructor"].includes(method)) {
      throw new Error(`unknown method ${method}`);
    }
    try {
      return { ok: await this[method](...args) };
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
      G.ensureDailyTask(prof);
      await this.ctx.storage.put(PROFILE, prof);
      await this.hub().registerUser(prof.uid, { name: prof.name, username: prof.username, isNew });
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
    const st = await this.state();
    const ids = [...prof.active_patient_ids, ...prof.closed_patient_ids.slice(-60).reverse()];
    const pats = await this.ctx.storage.get(ids.map(patKey));
    const quizzes = await this.ctx.storage.get(prof.test_ids.slice(0, 40).map(quizKey));
    return {
      profile: publicProfile(prof),
      active_patient_id: st.active_patient_id,
      patients: ids.map((id) => pats.get(patKey(id))).filter(Boolean).map((p) => patientSummary(p)),
      quizzes: prof.test_ids.slice(0, 40).map((id) => quizzes.get(quizKey(id))).filter(Boolean).map(quizSummary),
      plans: PLANS,
      config: { specializations: SPECIALIZATIONS, levels: DOCTOR_LEVELS, tests: TEST_TYPES, max_active: MAX_ACTIVE_PATIENTS },
    };
  }

  async patientView(id) {
    const pat = await this.patient(id);
    const quiz = await this.ctx.storage.get(quizKey(id));
    return { patient: publicPatient(pat), quiz: quiz ? publicQuiz(quiz) : null };
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
    if (patch.notifications !== undefined) prof.notifications = !!patch.notifications;
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile");
    return publicProfile(prof);
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
      throw new UserError("Бесплатный лимит на сегодня исчерпан. Лимит сбрасывается в полночь по Москве — или оформите подписку.", "limit");
    }
    prof.generating_patient = Date.now();
    await this.ctx.storage.put(PROFILE, prof);
    await this.enqueue({ type: "new_patient", origin, botMsgId });
    this.broadcast("profile");
    return { queued: true };
  }

  async jobNewPatient(job) {
    const prof0 = await this.profile();
    const spec = pick(prof0.specializations);
    const counter = (prof0.patient_counter || 0) + 1;
    const isAlien = counter % ALIEN_PATIENT_EVERY === 0;
    const used = [];
    const ids = [...prof0.active_patient_ids, ...prof0.closed_patient_ids.slice(-15)];
    const pats = await this.ctx.storage.get(ids.map(patKey));
    for (const p of pats.values()) if (p?.true_diagnosis) used.push(p.true_diagnosis);

    const p = P.patientPrompt({
      spec, profession: prof0.profession, complexity: G.levelMeta(prof0.level).complexity, usedDiagnoses: used, isAlien,
    });
    const data = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: 0.95 });
    validatePatient(data);

    const now = Date.now();
    const id = `pat_${prof0.uid}_${now}`;
    const pat = {
      id,
      doctor_uid: prof0.uid,
      is_alien: isAlien,
      specialization: spec,
      name: clampStr(data.name, 60),
      age: data.age,
      sex: data.sex,
      chief_complaint: clampStr(data.chief_complaint, 300),
      true_diagnosis: clampStr(data.true_diagnosis, 200),
      full_history: clampStr(data.full_history, 1500),
      personality: clampStr(data.personality, 300),
      opening_phrase: clampStr(data.opening_phrase, 400),
      key_findings: clampStr(data.key_findings, 600),
      condition_trajectory: data.condition_trajectory || "stable",
      status: "new",
      created_at: now,
      closed_at: null,
      consultations: [],
      conversation_history: [],
      summary: null,
      test_results: [],
      exam_results: [],
      current: null,
    };

    // Профиль перечитываем после ИИ — он мог измениться
    const prof = await this.profile();
    prof.patient_counter = counter;
    prof.active_patient_ids = [...prof.active_patient_ids, id];
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
    await this.report("patient", prof);
    if (prof.stats.patients_total === 1) {
      await this.hub().notifyAdmin(`🩺 Первый пациент\nВрач: ${prof.name} ${prof.username ? "@" + prof.username : ""}\nuid: ${prof.uid}`);
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
  }

  async rejectPatient(patId) {
    const prof = await this.profile();
    if (!prof.active_patient_ids.includes(patId)) throw new UserError("Этого пациента нет среди активных");
    const pat = await this.patient(patId);
    if ((pat.consultations || []).length) throw new UserError("С этим пациентом уже был приём — завершите его через «Завершить приём»");
    prof.active_patient_ids = prof.active_patient_ids.filter((id) => id !== patId);
    await this.ctx.storage.put(PROFILE, prof);
    await this.ctx.storage.delete(patKey(patId));
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
    return { ok: true };
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
    const lastPatientMsg = [...pat.conversation_history].reverse().find((m) => m.role === "patient");
    return {
      patient: publicPatient(pat),
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

      const p = P.patientReplyPrompt(pat, text);
      let reply;
      try {
        reply = await aiText(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens });
      } catch (e) {
        console.error("patient reply", e);
        this.broadcast("consultation", { patient_id: patId });
        throw new UserError("Пациент задумался… Попробуйте задать вопрос ещё раз.", "ai_error");
      }
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
      text = await transcribe(this.env, base64Audio);
    } catch (e) {
      console.error("transcribe", e);
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
      if (existing) return { test: existing.test, result: existing.result, cached: true };
      this.broadcast("consultation", { patient_id: patId, typing: true });
      const p = P.testResultPrompt(pat, testName);
      let result;
      try {
        result = await aiText(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature });
      } catch (e) {
        console.error("test result", e);
        this.broadcast("consultation", { patient_id: patId });
        throw new UserError(`Результат «${testName}» временно недоступен. Попробуйте ещё раз.`, "ai_error");
      }
      const fresh = await this.patient(patId);
      fresh.current.tests.push(testName);
      fresh.test_results.push({ test: testName, result, ordered_at: Date.now() });
      await this.ctx.storage.put(patKey(patId), fresh);
      this.broadcast("consultation", { patient_id: patId });
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
      try {
        res = await aiJson(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature });
      } catch (e) {
        console.error("physical", e);
        this.broadcast("consultation", { patient_id: patId });
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
      return exam;
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
    return this.withLock(patId, async () => {
      const pat = await this.openPatient(patId);
      if (type === "diagnosis") pat.current.diagnosis = value;
      if (type === "referral") pat.current.referrals.push(value);
      if (type === "discharge") pat.current.discharged = true;
      const treatment = clampStr(action.treatment, 500);
      if (treatment) pat.current.treatment = treatment;

      let farewell;
      try {
        const p = P.farewellPrompt(pat, actionsList(pat.current));
        farewell = await aiText(this.env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens });
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
      await this.enqueue({ type: "evaluate", patId, origin });
      this.broadcast("patients", { patient_id: patId });
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
      const p = P.evaluationPrompt(pat, facts);
      try {
        ev = normalizeEvaluation(await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature }));
      } catch (e) {
        console.error("evaluate", e);
        if ((job.attempt || 0) < 2) throw e; // alarm повторит
        ev = normalizeEvaluation({ rating: 2.5, expert_text: "Оценка временно недоступна." });
      }
    }

    // Профиль: стрик, XP, задания — всё синхронно после ИИ
    const prof = await this.profile();
    const prevXp = prof.xp || 0;
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
    };
    this.broadcast("evaluation", result);
    await this.report("consultation", prof);

    if (job.origin === "bot") {
      const m = R.evaluation(this.env, result);
      await tg(this.env).send(prof.uid, m.text, m.kb);
    }

    // Тест «работа над ошибками»
    try {
      await this.generateQuiz(fresh, ev, facts);
    } catch (e) {
      console.error("quiz gen", e);
    }
  }

  async generateQuiz(pat, ev, facts) {
    const topics = [
      ...(ev.weaknesses || []),
      ...(ev.dialog_moments || []).map((m) => m.comment),
      ev.recommendation,
    ].filter(Boolean).slice(0, 5);
    if (!topics.length) topics.push(`Диагностика и лечение: ${pat.true_diagnosis}`);
    const p = P.quizPrompt(pat, topics);
    const data = await aiJson(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature });
    const questions = (data.questions || []).map(normalizeQuestion).filter(Boolean).slice(0, 5);
    if (questions.length < 3) throw new Error("quiz: мало валидных вопросов");
    const quiz = {
      pat_id: pat.id, pat_name: pat.name, pat_diagnosis: pat.true_diagnosis, specialization: pat.specialization,
      created_at: Date.now(), status: "pending", questions, answers: [], score: null, finished_at: null,
    };
    const prof = await this.profile();
    prof.test_ids = [pat.id, ...prof.test_ids.filter((id) => id !== pat.id)];
    await this.ctx.storage.put({ [quizKey(pat.id)]: quiz, [PROFILE]: prof });
    this.broadcast("quizzes", { patient_id: pat.id });
  }

  // ---------------------------------------------------
  // Тесты «работа над ошибками»
  // ---------------------------------------------------

  async quiz(patId) {
    const q = await this.ctx.storage.get(quizKey(patId));
    if (!q) throw new UserError("Тест ещё готовится — загляните через минуту", "quiz_pending");
    return publicQuiz(q);
  }

  /** Ответ на вопрос. Возвращает правильность и объяснение. */
  async answerQuiz(patId, index, chosen) {
    const q = await this.ctx.storage.get(quizKey(patId));
    if (!q) throw new UserError("Тест не найден");
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
    if (done) await this.report("quiz", entries[PROFILE]);
    this.broadcast("quizzes", { patient_id: patId });
    return {
      is_correct: isCorrect, correct: question.correct, explanation: question.explanation,
      done, score: q.score, xp: q.xp || 0, task_done: taskDone, quiz: publicQuiz(q),
    };
  }

  // ---------------------------------------------------
  // Подписка
  // ---------------------------------------------------

  async activateSubscription(planKey, operationId) {
    const plan = PLANS[planKey];
    if (!plan) return null;
    const prof = await this.profile();
    prof.payments = prof.payments || [];
    if (operationId && prof.payments.some((p) => p.op === operationId)) return publicProfile(prof);
    if (planKey === "forever") prof.sub_until = -1;
    else if (prof.sub_until !== -1) {
      const from = prof.sub_until && prof.sub_until > Date.now() ? prof.sub_until : Date.now();
      prof.sub_until = from + plan.days * 86400000;
    }
    prof.sub_plan = planKey;
    prof.sub_activated_at = Date.now();
    prof.payments.push({ op: operationId, plan: planKey, ts: Date.now() });
    prof.payments = prof.payments.slice(-20);
    await this.ctx.storage.put(PROFILE, prof);
    this.broadcast("profile", { paid: planKey });
    await this.report("payment", prof);
    const until = planKey === "forever" || prof.sub_until === -1 ? "навсегда" : new Date(prof.sub_until).toLocaleDateString("ru", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
    await tg(this.env).send(prof.uid, `✅ <b>Подписка активирована!</b>\n\nТариф: ${plan.label}\nДоступ: ${until}\n\nТеперь можно принимать сколько угодно пациентов.`);
    return publicProfile(prof);
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

  async cronTick(kind, uid) {
    let prof = await this.ctx.storage.get(PROFILE);
    if (!prof && uid) {
      // Старый пользователь, ещё не заходивший после переезда — переносим данные из KV
      prof = await this.migrateFromKv(uid);
      if (prof) await this.ctx.storage.put(PROFILE, prof);
    }
    if (!prof || prof.notifications === false) return "skip";
    const today = mskDate();
    const gap = daysBetween(prof.last_consult_date, today);
    const streak = prof.streak || 0;
    const bot = tg(this.env);
    let sent = "none";
    if (kind === "morning") {
      if (G.ensureDailyTask(prof)) await this.ctx.storage.put(PROFILE, prof);
      if (gap === 0) return "active";
      if (gap === 1 && streak >= 2) {
        const m = R.streakReminder(this.env, streak);
        await bot.send(prof.uid, m.text, m.kb);
        sent = "reminder";
      } else if (gap === 2 && !prof.streak_broken_notified && (prof.streak_before_break || streak) >= 2) {
        prof.streak_broken_notified = true;
        await this.ctx.storage.put(PROFILE, prof);
        const m = R.streakLost(this.env, prof.streak_before_break || streak);
        await bot.send(prof.uid, m.text, m.kb);
        sent = "lost";
      }
    }
    if (kind === "evening" && gap === 1 && streak >= 3) {
      const m = R.streakWarning(this.env, streak);
      await bot.send(prof.uid, m.text, m.kb);
      sent = "warning";
    }
    return sent;
  }

  /** Отправляет в HubDO событие и свежую сводку профиля для админки */
  async report(event, prof) {
    try {
      await this.hub().track(event, prof.uid, {
        name: prof.name, username: prof.username, cons: prof.stats?.consultations_total || 0,
        quizzes: prof.stats?.quizzes_done || 0, patients: prof.stats?.patients_total || 0, paid: !!prof.sub_until,
      });
    } catch (e) {
      console.error("hub report", e);
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
    const text = await aiText(this.env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature });
    const fresh = await this.patient(patId);
    fresh.summary = { text, upto: cut };
    await this.ctx.storage.put(patKey(patId), fresh);
  }
}

// =====================================================
// Нормализация и представления
// =====================================================

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
    diagnosis_correct: ["yes", "partial", "no"].includes(e.diagnosis_correct) ? e.diagnosis_correct : null,
    expert_text: clampStr(e.expert_text, 1500),
    dialog_moments: (Array.isArray(e.dialog_moments) ? e.dialog_moments : [])
      .filter((m) => m && m.comment).slice(0, 2).map((m) => ({ quote: clampStr(m.quote, 300), comment: clampStr(m.comment, 400) })),
    strengths: (Array.isArray(e.strengths) ? e.strengths : []).slice(0, 3),
    weaknesses: (Array.isArray(e.weaknesses) ? e.weaknesses : []).slice(0, 3),
    recommendation: clampStr(e.recommendation, 300),
    outcome_update: ["improving", "stable", "worsening", "critical"].includes(e.outcome_update) ? e.outcome_update : "stable",
    post_story: clampStr(e.post_story, 800),
  };
}

function normalizeQuestion(q) {
  if (!q || !q.text || !Array.isArray(q.options) || q.options.length < 2) return null;
  const options = q.options.map((o) => clampStr(o, 120)).slice(0, 4);
  const correct = Number(q.correct);
  if (!(correct >= 0 && correct < options.length)) return null;
  return { text: clampStr(q.text, 400), options, correct, explanation: clampStr(q.explanation, 500) };
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
    pat_id: t.pat_id, pat_name: t.pat_name, pat_diagnosis: t.pat_diagnosis, specialization: t.specialization,
    created_at: t.created_at || Date.now(), status: t.status || "pending",
    questions: (t.questions || []).map(normalizeQuestion).filter(Boolean),
    answers: (t.answers || []).map((a) => ({ chosen: a.chosen, is_correct: !!a.is_correct })),
    score: t.score ?? null, finished_at: t.finished_at || null,
  };
}

export function publicProfile(prof) {
  const lvl = G.levelInfo(prof.xp || 0);
  const { payments, daily_patients, ...rest } = prof;
  return {
    ...rest,
    level_info: lvl,
    level_label: G.levelMeta(prof.level).label,
    has_sub: G.hasActiveSub(prof),
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

export function publicPatient(p) {
  const closed = p.status === "closed";
  const { full_history, key_findings, personality, last_facts, summary, ...rest } = p;
  return {
    ...rest,
    true_diagnosis: closed ? p.true_diagnosis : null,
    current: p.current,
  };
}

function quizSummary(q) {
  return {
    pat_id: q.pat_id, pat_name: q.pat_name, pat_diagnosis: q.pat_diagnosis, status: q.status,
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
      // Правильный ответ и объяснение — только для уже отвеченных вопросов
      ...(i < answered || q.status === "done" ? { correct: qq.correct, explanation: qq.explanation, chosen: q.answers[i]?.chosen } : {}),
    })),
    xp: q.xp || 0,
  };
}
