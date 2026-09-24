// =====================================================
// Telegram-бот: разбор апдейтов и отрисовка ответов.
// Вся логика и данные — в UserDO (общие с сайтом), здесь только интерфейс.
// =====================================================
import { ADMIN_ID, PHYSICAL_EXAMPLES, TEST_TYPES } from "../config.js";
import { arrayBufferToBase64, declPatients, esc, firstName, UserError, userError } from "../lib/util.js";
import { appBtn, btn, tg } from "../lib/telegram.js";
import * as R from "./render.js";

/**
 * Клиент UserDO: user.method(...args) → rpc. Пользовательские ошибки
 * пересоздаются здесь как UserError, чтобы их обрабатывал вызывающий код.
 */
export function userStub(env, uid) {
  const stub = env.USER.get(env.USER.idFromName(String(uid)));
  return new Proxy({}, {
    get(_, method) {
      if (method === "fetch") return (req) => stub.fetch(req);
      if (typeof method !== "string" || method === "then") return undefined;
      return async (...args) => {
        const res = await stub.rpc(method, args);
        if (res.userError) throw new UserError(res.userError.message, res.userError.code);
        return res.ok;
      };
    },
  });
}

export function hubStub(env) {
  return env.HUB.get(env.HUB.idFromName("hub"));
}

export async function handleUpdate(env, update) {
  const msg = update.message;
  const cb = update.callback_query;
  const from = msg?.from || cb?.from;
  if (!from || from.is_bot) return;
  // Работаем только в личке с ботом
  const chat = msg?.chat || cb?.message?.chat;
  if (chat && chat.type !== "private") return;

  const uid = String(from.id);
  const user = userStub(env, uid);
  const bot = tg(env);
  const ctx = { env, uid, user, bot, from };

  try {
    if (await user.seenUpdate(update.update_id)) return;
    const { isNew } = await user.init(uid, { first_name: from.first_name, username: from.username });
    ctx.isNew = isNew;
    if (cb) await onCallback(ctx, cb);
    else if (msg) await onMessage(ctx, msg);
  } catch (e) {
    const ue = userError(e);
    if (ue) {
      await bot.send(uid, `⚠️ ${esc(ue.message)}`, ue.code === "limit" ? [[appBtn("💎 Тарифы", R.appUrl(env, "/plans"))]] : undefined);
    } else {
      console.error("bot update error", e);
      await bot.send(uid, "😔 Что-то пошло не так. Попробуйте ещё раз.");
    }
    if (cb) await bot.answerCb(cb.id).catch(() => {});
  }
}

// ---------------------------------------------------
// Сообщения
// ---------------------------------------------------
async function onMessage(ctx, msg) {
  const { user, bot, uid, env } = ctx;
  const text = (msg.text || "").trim();

  if (msg.voice || msg.audio) return onVoice(ctx, msg);

  if (text.startsWith("/")) {
    const [cmd, payload] = text.split(/\s+/, 2);
    const command = cmd.split("@")[0].toLowerCase();
    if (command === "/start") return onStart(ctx, payload || "");
    if (command === "/new") return newPatient(ctx);
    if (command === "/patients") return listPatients(ctx);
    if (command === "/app") return bot.send(uid, "Откройте приложение:", R.kbMain(env));
    if (command === "/stop") {
      await user.setBotPending(null);
      return bot.send(uid, "Ок, ввод отменён.");
    }
    if (command === "/help") return help(ctx);
    if (command === "/admin" && uid === String(env.ADMIN_ID || ADMIN_ID)) return admin(ctx);
    return help(ctx);
  }
  if (!text) return;

  const st = await user.state();
  if (st.bot?.pending) return onPendingInput(ctx, st, text);

  const active = st.active_patient_id ? await activePatientOrNull(ctx) : null;
  if (active) return doctorSays(ctx, active.id, active.name, text);

  await bot.send(uid, "Сейчас нет открытого приёма. Выберите пациента или примите нового:", [
    [btn("👥 Мои пациенты", "list"), btn("➕ Новый пациент", "new")],
    [appBtn("🏥 Открыть приложение", R.appUrl(env))],
  ]);
}

async function activePatientOrNull(ctx) {
  const st = await ctx.user.state();
  if (!st.active_patient_id) return null;
  try {
    const { patient } = await ctx.user.patientView(st.active_patient_id);
    return patient.current && patient.status !== "closed" ? patient : null;
  } catch {
    return null;
  }
}

async function doctorSays(ctx, patId, name, text, voice = false) {
  const { user, bot, uid } = ctx;
  await bot.typing(uid);
  const res = voice ? await user.voiceMessage(patId, text) : await user.doctorMessage(patId, text);
  if (voice) await bot.send(uid, `🎙️ <i>${esc(res.transcript)}</i>`);
  await bot.send(uid, R.patientMsg(name, res.reply), R.kbActions());
}

async function onVoice(ctx, msg) {
  const { bot, uid } = ctx;
  const active = await activePatientOrNull(ctx);
  if (!active) return bot.send(uid, "Голосовые работают во время приёма. Сначала начните приём с пациентом.", [[btn("👥 Мои пациенты", "list")]]);
  const file = msg.voice || msg.audio;
  if ((file.file_size || 0) > 8 * 1024 * 1024) return bot.send(uid, "Слишком длинное голосовое. Запишите покороче (до 3–4 минут).");
  const wait = await bot.send(uid, "🎙️ Слушаю…");
  try {
    const audio = arrayBufferToBase64(await bot.downloadFile(file.file_id));
    await bot.del(uid, wait);
    await doctorSays(ctx, active.id, active.name, audio, true);
  } catch (e) {
    await bot.del(uid, wait);
    throw e;
  }
}

async function onStart(ctx, payload) {
  const { user, bot, uid, env, from } = ctx;
  if (payload.startsWith("login_")) {
    const ok = await hubStub(env).confirmLogin(payload.slice(6), uid);
    return bot.send(uid, ok
      ? "✅ <b>Вход подтверждён.</b>\n\nВернитесь в браузер — сайт откроется сам через пару секунд."
      : "⏰ Ссылка для входа устарела. Обновите страницу сайта и нажмите «Войти через Telegram» ещё раз.");
  }
  await user.touch({ username: from.username });
  const { profile, waiting } = await user.waitingSummary();
  if (ctx.isNew) {
    return bot.send(uid,
      `👩‍⚕️ <b>Добро пожаловать в «Help me, Doctor», ${esc(profile.name)}!</b>\n\n` +
      `Это тренажёр врача: ИИ-пациенты с настоящими жалобами, обследования, осмотр, диагноз — и разбор от эксперта.\n\n` +
      `Вы — <b>${esc(profile.level_label)}</b> (${esc(profile.profession)}). Уровень и специализацию можно поменять в приложении.\n\n` +
      `Начнём с первого пациента?`,
      [[btn("➕ Принять первого пациента", "new")], [appBtn("🏥 Открыть приложение", R.appUrl(env))]]);
  }
  let t = `С возвращением, ${esc(profile.name)}! 👋\n\n📊 Уровень ${profile.level_info.level} · 🔥 ${profile.streak || 0} · ⚡ ${profile.xp || 0} XP`;
  if (profile.daily_task) t += `\n🎯 Задание дня: ${esc(profile.daily_task.desc)}${profile.daily_task.done ? " ✅" : ` (${profile.daily_task.progress || 0}/${profile.daily_task.target})`}`;
  if (waiting.length) t += `\n\n⏳ Ждут приёма: ${waiting.length} ${declPatients(waiting.length)}`;
  await bot.send(uid, t, R.kbMain(env));
}

async function help(ctx) {
  await ctx.bot.send(ctx.uid,
    `<b>Help me, Doctor</b> — тренажёр врача.\n\n` +
    `/new — принять нового пациента\n/patients — мои пациенты\n/app — открыть приложение\n/stop — отменить ввод\n\n` +
    `Во время приёма просто пишите пациенту (можно голосом), а обследования, осмотр и диагноз — через кнопку «⚕️ Действия».\n\n` +
    `Всё синхронизировано с сайтом: начали в боте — продолжайте в приложении, и наоборот.`,
    R.kbMain(ctx.env));
}

async function newPatient(ctx) {
  const { user, bot, uid } = ctx;
  const wait = await bot.send(uid, "⏳ Готовлю карточку пациента… (10–20 секунд)");
  try {
    await user.requestNewPatient("bot", wait);
  } catch (e) {
    await bot.del(uid, wait);
    throw e;
  }
}

async function listPatients(ctx) {
  const { user, bot, uid, env } = ctx;
  const { waiting, profile } = await user.waitingSummary();
  if (!waiting.length) {
    return bot.send(uid, "Очередь пуста. Примем нового пациента?", [[btn("➕ Новый пациент", "new")], [appBtn("📚 Архив в приложении", R.appUrl(env, "/patients"))]]);
  }
  const rows = waiting.map((p) => [btn(`${p.is_alien ? "👽" : p.in_consultation ? "🟡" : "🟢"} ${p.name}${p.consultations ? ` · приём №${p.consultations + 1}` : ""}`.slice(0, 60), `sp_${p.id}`)]);
  if (profile.can_accept && waiting.length < 6) rows.push([btn("➕ Новый пациент", "new")]);
  await bot.send(uid, `👥 <b>Ожидают приёма (${waiting.length}):</b>\nВыберите пациента:`, rows);
}

async function startPatient(ctx, patId) {
  const { user, bot, uid } = ctx;
  const start = await user.startConsultation(patId);
  if (start.paused_other) await bot.send(uid, "⏸ Предыдущий приём поставлен на паузу — к нему можно вернуться в любой момент.");
  await bot.send(uid, R.consultationHeader(start));
  const opening = start.last_patient_message || start.patient.opening_phrase;
  if (opening) await bot.send(uid, R.patientMsg(start.patient.name, opening), R.kbActions());
}

// ---------------------------------------------------
// Ввод текста после кнопки (обследование, осмотр, диагноз…)
// ---------------------------------------------------
async function onPendingInput(ctx, st, text) {
  const { user, bot, uid } = ctx;
  const pending = st.bot.pending;
  const patId = st.active_patient_id;
  await user.setBotPending(null);
  if (!patId) return bot.send(uid, "Приём не найден. Выберите пациента заново.", [[btn("👥 Мои пациенты", "list")]]);
  if (pending === "test") return doTest(ctx, patId, text);
  if (pending === "phys") return doExam(ctx, patId, text);
  if (pending === "ref") return finish(ctx, patId, { type: "referral", value: text });
  if (pending === "dx") {
    await user.setBotPending({ pending: "tx", diagnosis: text.slice(0, 300) });
    return bot.send(uid, `Диагноз: <b>${esc(text)}</b>\n\nНазначьте лечение (препараты, режим, рекомендации) — или пропустите:`, R.kbSkipTreatment());
  }
  if (pending === "tx") return finish(ctx, patId, { type: "diagnosis", value: st.bot.diagnosis, treatment: text });
}

async function doTest(ctx, patId, name) {
  const { user, bot, uid } = ctx;
  await bot.typing(uid);
  const wait = await bot.send(uid, `🔬 Назначено: <b>${esc(name)}</b>\nЖдём результат…`);
  try {
    const res = await user.orderTest(patId, name);
    await bot.del(uid, wait);
    await bot.send(uid, R.testResult(res.test, res.result), R.kbActions());
  } catch (e) {
    await bot.del(uid, wait);
    throw e;
  }
}

async function doExam(ctx, patId, action) {
  const { user, bot, uid } = ctx;
  await bot.typing(uid);
  const wait = await bot.send(uid, `🤲 Осмотр: <b>${esc(action)}</b>…`);
  try {
    const exam = await user.physicalExam(patId, action);
    await bot.del(uid, wait);
    await bot.send(uid, R.examResult(exam), R.kbActions());
  } catch (e) {
    await bot.del(uid, wait);
    throw e;
  }
}

async function finish(ctx, patId, action) {
  const { user, bot, uid } = ctx;
  await bot.typing(uid);
  const res = await user.finishConsultation(patId, action, "bot");
  await bot.send(uid, R.patientMsg(res.patient_name, res.farewell));
  await bot.send(uid, R.finishCard(res));
}

// ---------------------------------------------------
// Кнопки
// ---------------------------------------------------
async function onCallback(ctx, cb) {
  const { user, bot, uid, env } = ctx;
  const data = cb.data || "";
  const mid = cb.message?.message_id;
  await bot.answerCb(cb.id);

  if (data === "new") return newPatient(ctx);
  if (data === "list") return listPatients(ctx);
  if (data.startsWith("sp_")) {
    await bot.editKeyboard(uid, mid, []);
    return startPatient(ctx, data.slice(3));
  }
  if (data.startsWith("qz_")) return startQuiz(ctx, data.slice(3));
  if (data.startsWith("qa_")) return quizAnswer(ctx, data, mid);

  // Всё ниже — действия внутри приёма
  const active = await activePatientOrNull(ctx);
  if (!active) {
    await bot.editKeyboard(uid, mid, []);
    return bot.send(uid, "Этот приём уже завершён или на паузе. Выберите пациента:", [[btn("👥 Мои пациенты", "list")]]);
  }
  const patId = active.id;

  if (data === "act") return bot.editKeyboard(uid, mid, R.kbActionsMenu());
  if (data === "act_close") return bot.editKeyboard(uid, mid, R.kbActions());
  if (data === "act_test") return bot.editKeyboard(uid, mid, R.kbTests());
  if (data === "act_phys") return bot.editKeyboard(uid, mid, R.kbPhysical());
  if (data === "act_end") return bot.editKeyboard(uid, mid, R.kbEnd());
  if (data === "act_pause") {
    await bot.editKeyboard(uid, mid, []);
    return bot.send(uid, `⏸ Приём с ${esc(firstName(active.name))} на паузе. Вернуться можно в любой момент — в боте или в приложении.`, [[btn("👥 Мои пациенты", "list"), btn("➕ Новый пациент", "new")]]);
  }
  if (data.startsWith("t_")) {
    if (data === "t_custom") await user.setBotPending({ pending: "test" });
    await bot.editKeyboard(uid, mid, []);
    if (data === "t_custom") {
      return bot.send(uid, "Введите название обследования:", R.kbCancelInput());
    }
    const name = TEST_TYPES[Number(data.slice(2))];
    if (name) return doTest(ctx, patId, name);
  }
  if (data.startsWith("px_")) {
    if (data === "px_custom") await user.setBotPending({ pending: "phys" });
    await bot.editKeyboard(uid, mid, []);
    if (data === "px_custom") {
      return bot.send(uid, "Опишите осмотр:\n<i>например: пальпация щитовидной железы, осмотр глазного дна…</i>", R.kbCancelInput());
    }
    const name = PHYSICAL_EXAMPLES[Number(data.slice(3))];
    if (name) return doExam(ctx, patId, name);
  }
  if (data === "end_dx") {
    await user.setBotPending({ pending: "dx" });
    await bot.editKeyboard(uid, mid, []);
    return bot.send(uid, "🩺 Введите диагноз:", R.kbCancelInput());
  }
  if (data === "end_ref") {
    await user.setBotPending({ pending: "ref" });
    await bot.editKeyboard(uid, mid, []);
    return bot.send(uid, "➡️ К какому специалисту направляете?", R.kbCancelInput());
  }
  if (data === "end_dis") return bot.editKeyboard(uid, mid, R.kbConfirmDischarge());
  if (data === "end_dis_ok") {
    await bot.editKeyboard(uid, mid, []);
    return finish(ctx, patId, { type: "discharge" });
  }
  if (data === "tx_skip") {
    const st = await user.state();
    await bot.editKeyboard(uid, mid, []);
    await user.setBotPending(null);
    if (st.bot?.pending === "tx") return finish(ctx, patId, { type: "diagnosis", value: st.bot.diagnosis });
    return;
  }
  if (data === "input_cancel") {
    await user.setBotPending(null);
    return bot.edit(uid, mid, "Ввод отменён.", R.kbActions());
  }
}

// ---------------------------------------------------
// Тест «работа над ошибками» в боте
// ---------------------------------------------------
async function startQuiz(ctx, patId) {
  const { user, bot, uid } = ctx;
  const quiz = await user.quiz(patId);
  if (quiz.status === "done") return bot.send(uid, `Этот тест уже пройден: ${quiz.score} из ${quiz.total}. Подробности — в приложении.`);
  const { text, kb } = R.quizQuestion(quiz, quiz.answered);
  await bot.send(uid, text, kb);
}

async function quizAnswer(ctx, data, mid) {
  const { user, bot, uid } = ctx;
  const parts = data.split("_");
  const chosen = Number(parts.pop());
  const index = Number(parts.pop());
  const patId = parts.slice(1).join("_");
  const res = await user.answerQuiz(patId, index, chosen);
  if (res.stale || (res.done && res.is_correct === undefined)) {
    return bot.editKeyboard(uid, mid, []);
  }
  await bot.edit(uid, mid, R.quizFeedback(res.quiz, index, res));
  if (res.done) return bot.send(uid, R.quizDone(res), [[btn("➕ Новый пациент", "new")]]);
  const next = R.quizQuestion(res.quiz, index + 1);
  await bot.send(uid, next.text, next.kb);
}

// ---------------------------------------------------
// Админка
// ---------------------------------------------------
async function admin(ctx) {
  const { bot, uid, env } = ctx;
  const s = await hubStub(env).stats();
  const f = s.funnel || {};
  const base = s.users_total || 0;
  const pct = (n) => (base ? Math.round(((n || 0) / base) * 100) : 0);
  await bot.send(uid,
    `📊 <b>Help me, Doctor — дашборд</b>\n\n` +
    `👥 Пользователей: ${base}\nНовых: ${s.new_users.join(" / ")} (1/7/14 дн.)\nАктивных: ${s.active.join(" / ")} (1/7/14 дн.)\n\n` +
    `Консультаций: ${s.consultations_total}\nТестов пройдено: ${s.quizzes_total}\n\n` +
    `💰 Оплат: ${s.payments_total} · выручка ${s.revenue_total} ₽\nПлатёжных ссылок: ${s.payment_links}\n\n` +
    `🏆 <b>Топ-5</b>\n${(s.top || []).map((u, i) => `${i + 1}. ${esc(u.name || "—")}${u.username ? " @" + esc(u.username) : ""} — ${u.cons} приёмов`).join("\n") || "—"}\n\n` +
    `🔽 <b>Воронка</b> (данные по ${f.known || 0} активным после обновления)\n≥1 пациента: ${f.p1 || 0} (${pct(f.p1)}%)\n≥3 пациентов: ${f.p3 || 0} (${pct(f.p3)}%)\nС подпиской: ${f.paid || 0} (${pct(f.paid)}%)`);
}
