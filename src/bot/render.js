// Тексты и клавиатуры бота
import { PHYSICAL_EXAMPLES, TEST_TYPES } from "../config.js";
import { declDays, esc, firstName } from "../lib/util.js";
import { appBtn, btn } from "../lib/telegram.js";

export function appUrl(env, path = "") {
  const base = (env.PUBLIC_URL || "").replace(/\/$/, "");
  // Путь передаём в query: Telegram дописывает свои параметры в hash
  return `${base}/app${path ? `?go=${encodeURIComponent(path)}` : ""}`;
}

export const kbActions = () => [[btn("⚕️ Действия", "act")]];

export const kbActionsMenu = () => [
  [btn("🔬 Обследование", "act_test"), btn("🤲 Осмотр", "act_phys")],
  [btn("🏁 Завершить приём", "act_end")],
  [btn("⏸ Пауза", "act_pause"), btn("✖️ Закрыть", "act_close")],
];

export const kbTests = () => {
  const rows = [];
  for (let i = 0; i < TEST_TYPES.length; i += 2) {
    rows.push(TEST_TYPES.slice(i, i + 2).map((t, j) => btn(t, `t_${i + j}`)));
  }
  rows.push([btn("✏️ Другое…", "t_custom"), btn("◀️ Назад", "act")]);
  return rows;
};

export const kbPhysical = () => {
  const rows = [];
  for (let i = 0; i < PHYSICAL_EXAMPLES.length; i += 2) {
    rows.push(PHYSICAL_EXAMPLES.slice(i, i + 2).map((t, j) => btn(t, `px_${i + j}`)));
  }
  rows.push([btn("✏️ Другое…", "px_custom"), btn("◀️ Назад", "act")]);
  return rows;
};

export const kbEnd = () => [
  [btn("🩺 Поставить диагноз", "end_dx")],
  [btn("➡️ Направить к специалисту", "end_ref")],
  [btn("❌ Отказаться от пациента", "end_dis")],
  [btn("◀️ Назад", "act")],
];

export const kbConfirmDischarge = () => [[btn("✅ Да, завершить", "end_dis_ok")], [btn("◀️ Отмена", "act_end")]];

export const kbCancelInput = () => [[btn("✖️ Отмена", "input_cancel")]];

export const kbSkipTreatment = () => [[btn("Пропустить →", "tx_skip")]];

export const kbNewPatient = () => [[btn("➕ Новый пациент", "new")]];

export function kbMain(env) {
  return [
    [appBtn("🏥 Открыть приложение", appUrl(env))],
    [btn("➕ Новый пациент", "new"), btn("👥 Мои пациенты", "list")],
  ];
}

export function patientMsg(name, text) {
  return `👤 <b>${esc(firstName(name))}:</b> ${esc(text)}`;
}

export function consultationHeader(start) {
  const p = start.patient;
  const age = p.is_alien ? String(p.age) : `${p.age} лет`;
  if (start.is_new_consultation && start.consultation_number === 1) {
    const icon = p.is_alien ? "👽" : "🟢";
    return `${icon} <b>${p.is_alien ? "ОСОБЫЙ ПАЦИЕНТ" : "НОВЫЙ ПАЦИЕНТ"}</b> · приём №1\n${esc(p.name)}, ${esc(age)}\n\n` +
      `<blockquote>💡 Общайтесь с пациентом текстом или голосовыми.\nОбследования и осмотр — кнопка «Действия».\nВ конце поставьте диагноз — приём оценит эксперт.</blockquote>`;
  }
  return `▶️ <b>ПРОДОЛЖЕНИЕ</b> · приём №${start.consultation_number}\n${esc(p.name)}, ${esc(age)}`;
}

export function newPatientReady(env, pat) {
  const age = pat.is_alien ? String(pat.age) : `${pat.age} лет`;
  return {
    text: `✅ <b>Новый пациент готов!</b>\n\n<b>${esc(pat.name)}</b>, ${esc(age)}\n<i>${esc(pat.chief_complaint || "")}</i>\n\nНачать приём?`,
    kb: [
      [btn(`▶️ Начать приём с ${firstName(pat.name)}`, `sp_${pat.id}`)],
      [appBtn("🏥 Открыть в приложении", appUrl(env, `/patient/${pat.id}`))],
    ],
  };
}

export function testResult(test, result) {
  return `📋 <b>Результат: ${esc(test)}</b>\n\n<blockquote expandable>${esc(result)}</blockquote>`;
}

export function examResult(exam) {
  return `🩺 <b>Осмотр: ${esc(exam.action)}</b>\n\n<b>Врач отмечает:</b>\n${esc(exam.sensation)}\n\n<b>Пациент:</b> ${esc(exam.reaction)}`;
}

export function finishCard(res) {
  return `✅ <b>ПРИЁМ ЗАВЕРШЁН</b> · №${res.consultation_number}\n👤 ${esc(res.patient_name)}\n🔬 Истинный диагноз: <b>${esc(res.true_diagnosis)}</b>\n\n⏳ Эксперт готовит разбор…`;
}

const stars = (n) => "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(5 - Math.max(0, Math.min(5, n)));

export function evaluation(env, r) {
  let t = `📋 <b>Разбор приёма · ${esc(r.patient_name)}</b>\n`;
  t += `Оценка: <b>${r.rating.toFixed(1)}</b> / 5\n\n`;
  if (r.axes) {
    t += `<code>Диагностика ${stars(r.axes.diagnosis)}\nОбщение     ${stars(r.axes.communication)}\nЛечение     ${stars(r.axes.treatment)}</code>\n\n`;
  }
  if (r.expert_text) t += `${esc(r.expert_text)}\n`;
  for (const m of r.dialog_moments || []) {
    t += `\n💬 <i>«${esc(m.quote)}»</i>\n→ ${esc(m.comment)}\n`;
  }
  if (r.post_story) t += `\n📖 <b>Что было дальше</b>\n${esc(r.post_story)}\n`;
  t += `\n⚡ <b>+${r.xp} XP</b>${r.streak_bonus > 0 ? ` (стрик ×${(1 + r.streak_bonus).toFixed(1)})` : ""}`;
  if (r.level_up) t += `\n🎉 <b>Новый уровень: ${r.level_up.from} → ${r.level_up.to}</b>`;
  t += `\n📊 Уровень ${r.level} · 🔥 ${r.streak} ${declDays(r.streak)} подряд`;
  if (r.task_done) t += `\n🎯 <b>Задание дня выполнено!</b> +${r.task_done.xp} XP`;
  return {
    text: t,
    kb: [
      [btn("📝 Работа над ошибками", `qz_${r.patient_id}`)],
      [btn("➕ Новый пациент", "new"), appBtn("📋 Карточка", appUrl(env, `/patient/${r.patient_id}`))],
    ],
  };
}

export function quizQuestion(quiz, index) {
  const q = quiz.questions[index];
  const text = `📝 <b>Работа над ошибками · ${esc(quiz.pat_name)}</b>\nВопрос ${index + 1} из ${quiz.questions.length}\n\n${esc(q.text)}`;
  const kb = q.options.map((o, i) => [btn(`${["А", "Б", "В", "Г"][i]}. ${o}`.slice(0, 60), `qa_${quiz.pat_id}_${index}_${i}`)]);
  return { text, kb };
}

export function quizFeedback(quiz, index, res) {
  const q = quiz.questions[index];
  const mark = res.is_correct ? "✅ Верно!" : `❌ Неверно. Правильно: <b>${esc(q.options[res.correct])}</b>`;
  return `📝 <b>Вопрос ${index + 1}.</b> ${esc(q.text)}\n\n${mark}\n💡 ${esc(res.explanation || "")}`;
}

export function quizDone(res) {
  const total = res.quiz.total;
  const praise = res.score === total ? "Отлично! 🎉" : res.score >= total - 1 ? "Хороший результат! 👍" : res.score >= total / 2 ? "Неплохо, есть пробелы." : "Стоит повторить материал 📚";
  return `📊 <b>Тест завершён: ${res.score} из ${total}</b> — ${praise}\n⚡ +${res.xp} XP${res.task_done ? "\n🎯 Задание дня выполнено!" : ""}`;
}

export function streakReminder(env, streak) {
  return {
    text: `🔥 <b>Стрик ${streak} ${declDays(streak)} — не дайте ему сгореть!</b>\n\nПримите хотя бы одного пациента сегодня, чтобы сохранить серию.`,
    kb: [[btn("➕ Принять пациента", "new"), appBtn("🏥 Приложение", appUrl(env))]],
  };
}

export function streakLost(env, lost) {
  return {
    text: `😔 <b>Стрик сгорел</b>\n\nВы пропустили 2 дня и потеряли серию ${lost} ${declDays(lost)}.\nНачните новую сегодня — регулярная практика делает диагнозы точнее.`,
    kb: [[btn("➕ Начать заново", "new")]],
  };
}

export function streakWarning(env, streak) {
  return {
    text: `⚠️ <b>Осталось 4 часа!</b>\n\n🔥 Стрик ${streak} ${declDays(streak)} сгорит в полночь. Один короткий приём — и серия сохранена.`,
    kb: [[btn("➕ Принять пациента", "new")]],
  };
}
