// =====================================================
// Help me, Doctor 👩‍⚕️ — константы игры
// Секреты здесь НЕ храним: они в env (wrangler secret put ...)
// =====================================================

export const ADMIN_ID = "1326867567";

/** Админы: env.ADMIN_ID — список Telegram ID через запятую (Олег, Саша) */
export function adminIds(env) {
  return String(env?.ADMIN_ID || ADMIN_ID).split(",").map((s) => s.trim()).filter(Boolean);
}
export const BOT_USERNAME = "helpmedoctor_aibot";

export const MAX_ACTIVE_PATIENTS = 6;

// Подсказки на приёме: сколько на пациента и чем платит врач за каждую
export const HINTS_PER_PATIENT = 3;
export const HINT_RATING_PENALTY = 0.2; // минус к оценке приёма
export const HINT_XP_CUT = 0.15;        // доля опыта за приём
export const FREE_DAILY_LIMIT = 1; // пациентов в день бесплатно

// Сколько последних реплик отдаём ИИ целиком; всё что старше — сжимается в резюме
export const HISTORY_WINDOW = 8;
export const HISTORY_SUMMARIZE_AT = 14;

// Тарифы. early — цена для ранних пользователей до EARLY_UNTIL. month — подписка с автопродлением
// (карта привязывается в Точке, дальше списываем сами раз в 30 дней по цене, зафиксированной при оформлении).
// hidden — старые тарифы: их больше не продаём, но старые оплаты и вебхуки должны распознаваться.
export const PLANS = {
  week:    { label: "1 неделя", days: 7,     price: "149.00",  early: "99.00" },
  month:   { label: "1 месяц",  days: 30,    price: "390.00",  early: "249.00", recurring: true },
  quarter: { label: "3 месяца", days: 91,    price: "890.00",  early: "590.00", best: true },
  year:    { label: "1 год",    days: 365,   price: "2490.00", early: "1490.00" },
  day:     { label: "1 день",   days: 1,     price: "30.00",   hidden: true },
  forever: { label: "Навсегда", days: 36500, price: "1990.00", hidden: true },
};
// Ранние цены действуют до конца 31 октября 2026 (МСК)
export const EARLY_UNTIL = Date.parse("2026-10-31T21:00:00Z");
// Пробный премиум: 1 ₽ с привязкой карты, через 7 дней — автопродление на месяц
export const TRIAL = { key: "trial", label: "Премиум на 7 дней", days: 7, price: "1.00", then: "month" };
// Разовые покупки без подписки
export const PACKS = {
  patients3: { label: "+3 пациента", price: "39.00", patients: 3 },
  freeze:    { label: "Заморозка стрика", price: "29.00", freezes: 1 },
};
// Сколько раз пробуем списать продление, прежде чем отключить автоплатёж
export const AUTOPAY_MAX_FAILS = 3;

/** Цена тарифа на момент покупки (ранняя — до EARLY_UNTIL) */
export function planPrice(key, now = Date.now()) {
  if (key === TRIAL.key) return TRIAL.price;
  if (PACKS[key]) return PACKS[key].price;
  const p = PLANS[key];
  if (!p) return null;
  return p.early && now < EARLY_UNTIL ? p.early : p.price;
}

/** Название покупки для чеков, уведомлений и отчётов */
export function productLabel(key) {
  if (key === TRIAL.key) return TRIAL.label;
  return PLANS[key]?.label || PACKS[key]?.label || key;
}

export const SPECIALIZATIONS = {
  "Онколог": ["маммология", "онкогинекология", "онкоурология", "опухоли ЖКТ", "опухоли лёгких"],
  "Терапевт": ["гастроэнтерология", "пульмонология", "эндокринология", "ревматология"],
  "Кардиолог": ["аритмология", "ХСН", "ИБС", "гипертензия"],
  "Хирург": ["абдоминальная хирургия", "торакальная хирургия", "сосудистая хирургия"],
  "Педиатр": ["неонатология", "детская инфекция", "детская кардиология"],
  "Невролог": ["инсульт", "эпилепсия", "нейродегенеративные заболевания"],
  "Психиатр": ["депрессия", "психоз", "тревожные расстройства"],
  "Дерматолог": ["дерматиты", "онкодерматология", "аутоиммунные заболевания кожи"],
  "Анестезиолог": ["интенсивная терапия", "болевые синдромы", "реанимация"],
  "Скорая помощь": ["политравма", "острые состояния", "сердечно-сосудистые катастрофы"],
};

export const PEDIATRIC_SPECS = ["неонатология", "детская инфекция", "детская кардиология"];

export const DOCTOR_LEVELS = [
  { key: "студент",    label: "Студент",            complexity: "easy",        xpMult: 1.0 },
  { key: "ординатор",  label: "Ординатор",          complexity: "medium",      xpMult: 1.2 },
  { key: "врач",       label: "Врач",               complexity: "medium_hard", xpMult: 1.5 },
  { key: "специалист", label: "Опытный специалист", complexity: "hard",        xpMult: 2.0 },
];

// Сложность пациентов: выбирается в анкете и в профиле; по умолчанию — по роли (DOCTOR_LEVELS.complexity)
export const DIFFICULTIES = [
  { key: "easy",        label: "Лёгкая",        emoji: "🟢", hint: "типичная картина болезни" },
  { key: "medium",      label: "Средняя",       emoji: "🟡", hint: "нетипичное начало, отвлекающий симптом" },
  { key: "medium_hard", label: "Сложная",       emoji: "🟠", hint: "маскирующиеся симптомы, два похожих диагноза" },
  { key: "hard",        label: "Очень сложная", emoji: "🔴", hint: "редкая патология, противоречивые данные" },
];

export const TEST_TYPES = ["КТ", "МРТ", "УЗИ", "Биопсия", "Анализ крови", "ЭКГ", "Онкомаркеры", "Эхо-КГ"];

export const PHYSICAL_EXAMPLES = [
  "Аускультация лёгких", "Аускультация сердца", "Пальпация живота",
  "Перкуссия грудной клетки", "Осмотр кожи", "Измерить давление и пульс",
  "Неврологический осмотр", "Осмотр зева",
];

export const DAILY_TASKS = [
  // Базовые
  { id: "dt_1",  desc: "Провести консультацию",                         xp: 25,  type: "consultations",      target: 1 },
  { id: "dt_2",  desc: "Назначить 2 обследования за один приём",        xp: 30,  type: "tests_per_consult",  target: 2 },
  { id: "dt_3",  desc: "Провести физический осмотр",                    xp: 25,  type: "physical",           target: 1 },
  { id: "dt_4",  desc: "Завершить приём с диагнозом",                   xp: 30,  type: "diagnosis",          target: 1 },
  { id: "dt_5",  desc: "Направить пациента к специалисту",              xp: 25,  type: "referral",           target: 1 },
  { id: "dt_6",  desc: "Принять нового пациента",                       xp: 20,  type: "consultations",      target: 1 },
  { id: "dt_7",  desc: "Провести 2 консультации за день",               xp: 50,  type: "consultations",      target: 2 },
  { id: "dt_8",  desc: "Назначить КТ или МРТ",                          xp: 25,  type: "test_imaging",       target: 1 },
  { id: "dt_9",  desc: "Задать пациенту 5+ вопросов",                   xp: 30,  type: "messages",           target: 5 },
  { id: "dt_10", desc: "Провести аускультацию или пальпацию",           xp: 25,  type: "specific_physical",  target: 1 },
  // Средние
  { id: "dt_11", desc: "Получить оценку 3.5+",                          xp: 40,  type: "rating",             target: 3.5 },
  { id: "dt_12", desc: "Назначить анализ крови",                        xp: 35,  type: "blood_test",         target: 1 },
  { id: "dt_13", desc: "Провести 3 физических осмотра за приём",        xp: 45,  type: "physical",           target: 3 },
  { id: "dt_14", desc: "Завершить приём с назначенным лечением",        xp: 40,  type: "treatment",          target: 1 },
  { id: "dt_15", desc: "Получить оценку 4.0+",                          xp: 50,  type: "rating",             target: 4.0 },
  { id: "dt_16", desc: "Провести 2 консультации с диагнозом",           xp: 60,  type: "diagnosis",          target: 2 },
  { id: "dt_17", desc: "Назначить биопсию",                             xp: 40,  type: "test_biopsy",        target: 1 },
  { id: "dt_18", desc: "Задать 10+ вопросов за консультацию",           xp: 45,  type: "messages",           target: 10 },
  { id: "dt_19", desc: "Провести ЭКГ и Эхо-КГ в одном приёме",          xp: 50,  type: "test_cardio",        target: 1 },
  { id: "dt_20", desc: "Получить оценку 4.5+",                          xp: 60,  type: "rating",             target: 4.5 },
  // Сложные
  { id: "dt_21", desc: "2 верных диагноза подряд",                      xp: 70,  type: "correct_streak",     target: 2 },
  { id: "dt_22", desc: "Провести 3 консультации за день",               xp: 80,  type: "consultations",      target: 3 },
  { id: "dt_23", desc: "Назначить 5 разных обследований за приём",      xp: 75,  type: "tests_per_consult",  target: 5 },
  { id: "dt_24", desc: "Получить оценку 4.8+",                          xp: 80,  type: "rating",             target: 4.8 },
  { id: "dt_25", desc: "Провести 5 физосмотров за один приём",          xp: 70,  type: "physical",           target: 5 },
  { id: "dt_26", desc: "Пройти тест на ошибки",                         xp: 60,  type: "quiz",               target: 1 },
  { id: "dt_29", desc: "3 верных диагноза подряд",                      xp: 100, type: "correct_streak",     target: 3 },
  { id: "dt_30", desc: "Провести 4 консультации за день",               xp: 100, type: "consultations",      target: 4 },
  // Экспертные
  { id: "dt_32", desc: "Получить оценку 5.0",                           xp: 150, type: "rating",             target: 5.0 },
  { id: "dt_33", desc: "Пройти 3 теста на ошибки",                      xp: 120, type: "quiz",               target: 3 },
  { id: "dt_34", desc: "5 верных диагнозов подряд",                     xp: 150, type: "correct_streak",     target: 5 },
  { id: "dt_38", desc: "Провести осмотр и верно поставить диагноз",     xp: 130, type: "physical_diagnosis", target: 1 },
];

export const MAX_LEVEL = 200;

// Модели ИИ. Каждый шаг приёма (kind) идёт в свою модель — выбор в админке («Расход ИИ» → «Модели по шагам»).
// По умолчанию всё на дешёвой Qwen3 (≈ в 6 раз меньше нейронов), разбор эксперта — на Llama 70B.
export const AI_MODELS = {
  qwen3: { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B", note: "быстрая и дешёвая, ≈ 200 нейронов на приём", noThink: true },
  llama70: { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", note: "самая аккуратная, ≈ 1300 нейронов на приём" },
};
export const AI_DEFAULT_MODEL = "qwen3";
export const AI_ROUTING_DEFAULT = { evaluation: "llama70", guide: "llama70" };
// Шаги, для которых в админке есть переключатель (ключи совпадают с kind в ai_usage)
export const AI_STEPS = {
  patient: "Новый пациент", reply: "Ответ пациента", test: "Обследование", exam: "Осмотр", farewell: "Прощание",
  evaluation: "Разбор эксперта", guide: "Разбор по КР", hint: "Подсказка", quiz: "Тест по ошибкам", summarize: "Сжатие диалога", sections: "Разделы специальности", admin_summary: "Сводка отзывов",
};
// Совместимость: модель по умолчанию для старых вызовов
export const AI_MODEL = AI_MODELS.llama70.id;
export const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

// Запасные провайдеры (OpenAI-совместимые, бесплатные тарифы). Включаются, когда бесплатные нейроны Cloudflare
// на сегодня кончились (или Workers AI отказал). Ключи — секреты воркера CEREBRAS_API_KEY / GROQ_API_KEY.
export const AI_FALLBACKS = [
  { key: "cerebras", label: "Cerebras · GPT-OSS 120B", url: "https://api.cerebras.ai/v1/chat/completions", model: "gpt-oss-120b", secret: "CEREBRAS_API_KEY" },
  { key: "groq", label: "Groq · GPT-OSS 120B", url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-120b", secret: "GROQ_API_KEY" },
];
// Порог нейронов за сутки (UTC), после которого уходим на запасных — чтобы не платить за перерасход. 0 — не переключаться.
export const AI_CAP_DEFAULT = 9500;

// Цена моделей в нейронах (developers.cloudflare.com/workers-ai/platform/pricing):
// in/out — за 1 млн токенов, audio_min — за минуту аудио. 10 000 нейронов в сутки (UTC) бесплатно, дальше $0.011 за 1000.
export const AI_NEURONS = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { in: 26668, out: 204805 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { in: 4625, out: 30475 },
  "@cf/openai/whisper-large-v3-turbo": { audio_min: 46.63 },
};
export const AI_FREE_NEURONS_PER_DAY = 10000;
export const AI_USD_PER_1000_NEURONS = 0.011;
