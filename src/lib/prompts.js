// Промпты. Пишем коротко: каждое слово промпта — это входные токены на каждом вызове.
import { HISTORY_WINDOW, PEDIATRIC_SPECS } from "../config.js";
import { pick } from "./util.js";

const SEEDS = [
  "живёт в деревне, работает физически",
  "офисный работник, сидячий образ жизни",
  "спортсмен-любитель",
  "пенсионер с сопутствующими заболеваниями",
  "молодой, без хронических заболеваний",
  "медработник, хорошо знает симптомы",
  "тревожный, склонен к ипохондрии",
  "отрицает болезнь, затянул с визитом",
  "приехал из другого города, наблюдался у другого врача",
  "курильщик со стажем 20+ лет",
];

const COMPLEXITY = {
  easy: "типичный хрестоматийный случай, классические симптомы",
  medium: "нетипичное начало, один отвлекающий фактор",
  medium_hard: "маскирующиеся симптомы, два конкурирующих диагноза",
  hard: "редкая патология, противоречивые данные",
};

export function patientPrompt({ spec, profession, complexity, usedDiagnoses, isAlien }) {
  if (isAlien) {
    return {
      maxTokens: 700,
      prompt: `Создай пациента-ИНОПЛАНЕТЯНИНА для медицинского симулятора: абсурдно, но внутренне логично, с юмором.
JSON:
{"name":"труднопроизносимое имя","age":"возраст по-инопланетному, строкой","sex":"неизвестен","chief_complaint":"жалоба на орган, которого у людей нет","true_diagnosis":"выдуманная болезнь с псевдолатинским названием","full_history":"история болезни, 3-5 предложений","personality":"манера речи","condition_trajectory":"stable","opening_phrase":"странная дружелюбная первая фраза","key_findings":"2-3 абсурдных объективных признака для обследований"}`,
    };
  }
  const pediatric = PEDIATRIC_SPECS.includes(spec);
  const ages = pickAgeRange(pediatric);
  const sex = pick(["male", "female"]);
  const used = usedDiagnoses.length ? `\nНе повторяй диагнозы: ${usedDiagnoses.slice(-15).join("; ")}.` : "";
  return {
    maxTokens: 800,
    prompt: `Создай уникального реалистичного пациента для тренировки врача.
Врач: ${profession || spec}, раздел: ${spec}. Диагноз строго из этого раздела.
Сложность: ${COMPLEXITY[complexity] || COMPLEXITY.medium}.
Пол: ${sex === "male" ? "мужской" : "женский"}${pediatric ? " (ребёнок)" : ""}, возраст ${ages[0]}–${ages[1]} лет, фон: ${pick(SEEDS)}.
Русские имя и фамилия, редкие.${used}
JSON:
{"name":"Имя Фамилия","age":число,"sex":"${sex}","chief_complaint":"с чем пришёл, живым языком","true_diagnosis":"точный диагноз со стадией","full_history":"анамнез, образ жизни, привычки, ВСЕ симптомы, включая те, что пациент сам не назовёт — 4-7 предложений","personality":"характер и манера речи","condition_trajectory":"improving|stable|worsening","opening_phrase":"первая фраза пациента в кабинете, разговорная","key_findings":"ключевые объективные находки (анализы, визуализация, осмотр), которые должны подтверждаться обследованиями — 2-4 предложения, с цифрами"}`,
  };
}

function pickAgeRange(pediatric) {
  return pick(pediatric ? [[0, 3], [4, 10], [11, 17]] : [[18, 30], [31, 45], [46, 60], [61, 75], [76, 90]]);
}

function patientCard(pat) {
  const age = pat.is_alien ? pat.age : `${pat.age} лет`;
  const sex = pat.sex === "female" ? "женщина" : pat.sex === "male" ? "мужчина" : pat.sex || "";
  return `${pat.name}, ${age}${sex ? ", " + sex : ""}`;
}

/** Системный промпт роли пациента — один на весь диалог */
export function patientSystem(pat) {
  return `Ты — пациент на приёме у врача. Никогда не выходи из роли.
Ты: ${patientCard(pat)}. Характер: ${pat.personality}.
Твоё состояние (ты его чувствуешь, но диагноза не знаешь): ${pat.full_history}
${pat.is_alien ? "Ты инопланетянин: говоришь странно, иногда не понимаешь человеческих вопросов.\n" : ""}Правила: ты не врач и не знаешь терминов; отвечай только на заданный вопрос, не выкладывай всё сразу; на грубость реагируй эмоционально, на внимание — доверием; 1-3 коротких предложения разговорным языком; без имени и ремарок в скобках.`;
}

export function historyForAi(history) {
  const summary = history.filter((m) => m.role === "summary").map((m) => m.text).join(" ");
  const msgs = history.filter((m) => m.role === "doctor" || m.role === "patient").slice(-HISTORY_WINDOW);
  const lines = msgs.map((m) => `${m.role === "doctor" ? "Врач" : "Пациент"}: ${m.text}`);
  return (summary ? `[Ранее: ${summary}]\n` : "") + lines.join("\n");
}

export function patientReplyPrompt(pat, doctorMessage) {
  // Последняя реплика врача уже в истории — не дублируем её
  const history = historyForAi(pat.conversation_history.slice(0, -1));
  return {
    system: patientSystem(pat),
    maxTokens: 160,
    prompt: `${history ? `Диалог:\n${history}\n\n` : ""}Врач: ${doctorMessage}\nТвой ответ:`,
  };
}

export function farewellPrompt(pat, actions) {
  return {
    system: patientSystem(pat),
    maxTokens: 70,
    prompt: `Врач завершает приём. Его действия: ${actions.join("; ") || "без назначений"}.
Последние реплики:\n${historyForAi(pat.conversation_history).split("\n").slice(-4).join("\n")}
Попрощайся одной-двумя фразами в своём характере:`,
  };
}

export function testResultPrompt(pat, testName) {
  return {
    maxTokens: 420,
    temperature: 0.5,
    prompt: `Напиши протокол обследования «${testName}» как врач-диагност.
Пациент: ${patientCard(pat)}.
Скрытый диагноз (НЕ называй его): ${pat.true_diagnosis}.
Ключевые находки, которые должны подтверждаться, если относятся к этому обследованию: ${pat.key_findings || "по диагнозу"}.
${pat.is_alien ? "Пациент — инопланетянин: заключение абсурдное, с пометкой «референсные значения для вида не установлены».\n" : ""}Требования: 6-10 строк; анализы — значения с единицами и нормой в скобках; визуализация — размеры, структура, локализация; ЭКГ — ритм, ЧСС, интервалы, ось. Только объективные данные, без финального диагноза и без вступлений.`,
  };
}

export function physicalExamPrompt(pat, action) {
  return {
    system: patientSystem(pat),
    maxTokens: 260,
    temperature: 0.6,
    prompt: `Врач выполняет осмотр: «${action}». Скрытый диагноз: ${pat.true_diagnosis}. Находки: ${pat.key_findings || "по диагнозу"}.
Верни JSON: {"sensation":"что врач видит/слышит/чувствует — профессионально, 2-4 предложения, находки соответствуют диагнозу","reaction":"реакция пациента — слова или эмоция, 1-2 предложения, в характере"}`,
  };
}

export function evaluationPrompt(pat, facts) {
  const questions = facts.doctorMessages.length
    ? facts.doctorMessages.slice(-20).map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "не задал ни одного вопроса";
  return {
    maxTokens: 900,
    temperature: 0.4,
    prompt: `Ты — профессор (${pat.specialization}), 25 лет клинического стажа. Разбери приём ординатора прямо и конкретно, как коллега.
Пациент: ${patientCard(pat)}. ИСТИННЫЙ ДИАГНОЗ: ${pat.true_diagnosis}.
Вопросы врача:
${questions}
Действия: обследования — ${facts.tests.join(", ") || "нет"}; осмотр — ${facts.physicals.join(", ") || "нет"}; диагноз — ${facts.diagnosis || "не поставлен"}; лечение — ${facts.treatment || "не назначено"}${facts.referrals.length ? `; направление — ${facts.referrals.join(", ")}` : ""}${facts.discharged ? "; врач отказался от пациента" : ""}.
Шкала: верный полный диагноз 4.5-5; частично верный 3.5-4; неверный 1-2.5; меньше 3 вопросов −1; нет осмотра −0.5; нет нужных обследований −0.5.
Верни JSON:
{"rating":0-5 с одним знаком,"axes":{"diagnosis":0-5,"communication":0-5,"treatment":0-5},"diagnosis_correct":"yes|partial|no","expert_text":"разбор, 3-5 предложений","dialog_moments":[{"quote":"цитата врача","comment":"что было хорошо/плохо"}],"strengths":["короткая сильная сторона"],"weaknesses":["короткий пробел в знаниях"],"recommendation":"один совет на будущее","outcome_update":"improving|stable|worsening|critical","post_story":"что стало с пациентом через 2-4 недели, 2-3 конкретных предложения, исход логично следует из оценки"}
dialog_moments — не больше 2, strengths и weaknesses — не больше 3.`,
  };
}

export function quizPrompt(pat, topics) {
  return {
    maxTokens: 1300,
    temperature: 0.5,
    prompt: `Составь клинический тест «работа над ошибками» из 5 вопросов.
Случай: ${pat.true_diagnosis} (${pat.specialization}). Пробелы врача: ${topics.join("; ")}.
Правила: у каждого вопроса ровно один верный ответ; 3 остальных — правдоподобные, клинически обоснованные, но неверные; без «всё перечисленное»; варианты по 2-6 слов.
JSON: {"questions":[{"text":"вопрос","options":["A","B","C","D"],"correct":индекс 0-3,"explanation":"почему верно, 1-2 предложения"}]}`,
  };
}

export function summaryPrompt(messages) {
  return {
    maxTokens: 220,
    temperature: 0.3,
    prompt: `Сожми диалог врача и пациента в резюме 3-5 предложений: что пациент уже рассказал (симптомы, факты, анамнез) и о чём врач спрашивал. Без оценок.
${messages.map((m) => `${m.role === "doctor" ? "Врач" : "Пациент"}: ${m.text}`).join("\n")}`,
  };
}
