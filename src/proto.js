// Прототип голосового приёма без входа: страница /test362861 и API /api/proto/*.
// Состояния на сервере нет: историю диалога присылает страница, пациенты — готовые карточки ниже
// (так на странице нельзя подменить роль пациента). Расход ИИ и синтеза пишется в «Расход ИИ» с uid "proto".
import { PHYSICAL_EXAMPLES, TEST_TYPES } from "./config.js";
import { aiJson, aiText, transcribe } from "./lib/ai.js";
import * as P from "./lib/prompts.js";
import { synthesize, ttsErrorReason, TTS_QUALITIES, voiceFor } from "./lib/tts.js";
import { arrayBufferToBase64, clampStr, isRefusal, json } from "./lib/util.js";

const UID = "proto";
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY = 24;

export const PROTO_PATIENTS = [
  {
    id: "p1", name: "Галина Петровна Сурикова", age: 63, sex: "female", specialty: "кардиология",
    chief_complaint: "давит за грудиной при ходьбе",
    true_diagnosis: "Стабильная стенокардия напряжения, ФК II; артериальная гипертензия 2 ст.", mkb10: "I20.8",
    full_history: "Три недели давящая боль за грудиной при подъёме на 2-й этаж и быстрой ходьбе, отдаёт в левую руку, проходит за 3-5 минут в покое. Гипертензия 10 лет, таблетки пьёт нерегулярно. Отец умер от инфаркта в 60 лет. Не курит, вес лишний, ест солёное. Одышки в покое нет, отёков нет. Сама не скажет, что ночью иногда просыпается от тяжести в груди.",
    personality: "говорливая, тревожная, называет врача «доктор, миленький», переживает за внуков",
    opening_phrase: "Здравствуйте, доктор. Да вот, давит в груди, когда по лестнице иду. Дочка заставила прийти.",
    findings: { exam: "АД 158/96, пульс 82 ритмичный. Тоны сердца приглушены, акцент II тона на аорте. Лёгкие чистые. Отёков нет. ИМТ 31.", lab: "Общий холестерин 6,8 ммоль/л, ЛПНП 4,4, глюкоза 5,9. ОАК без особенностей. Тропонин отрицательный.", imaging: "Эхо-КГ: умеренная гипертрофия левого желудочка, ФВ 58%, зон гипокинеза нет.", endoscopy: "норма", ecg: "Синусовый ритм 80, признаки гипертрофии левого желудочка; на нагрузочной пробе — горизонтальная депрессия ST 1,5 мм в V4–V6 на 6-й минуте.", pathology: "" },
  },
  {
    id: "p2", name: "Артём Лаврушин", age: 34, sex: "male", specialty: "гастроэнтерология",
    chief_complaint: "болит под ложечкой натощак и ночью",
    true_diagnosis: "Язвенная болезнь двенадцатиперстной кишки, ассоциированная с H. pylori и приёмом НПВП, обострение", mkb10: "K26.3",
    full_history: "Месяц ноющие боли в эпигастрии натощак и ночью, после еды легчает. Две недели пил ибупрофен от боли в спине. Курит пачку в день, много кофе, работа сменная, нервная. Изжога. Стул обычный, чёрного стула не было. Похудел на 2 кг. Сам не скажет про ибупрофен, пока не спросят про лекарства.",
    personality: "сдержанный, отвечает коротко, торопится на работу, немного иронизирует",
    opening_phrase: "Добрый день. Живот болит, вот тут, под ложечкой. Особенно ночью спать не даёт.",
    findings: { exam: "Язык обложен белым налётом. Живот мягкий, локальная болезненность в эпигастрии справа от средней линии, симптом Менделя положительный. Печень не увеличена. АД 124/78, пульс 76.", lab: "ОАК: гемоглобин 132 г/л. Дыхательный уреазный тест на H. pylori положительный. Кал на скрытую кровь отрицательный.", imaging: "УЗИ органов брюшной полости: без патологии.", endoscopy: "ФГДС: на передней стенке луковицы двенадцатиперстной кишки язва 7 мм с фибриновым дном, отёчным валом; слизистая антрума гиперемирована.", ecg: "норма", pathology: "Биопсия антрума: хронический активный гастрит, H. pylori обнаружены." },
  },
  {
    id: "p3", name: "Миша Голованов", age: 6, sex: "male", specialty: "педиатрия",
    chief_complaint: "болит горло и температура",
    true_diagnosis: "Острый стрептококковый тонзиллофарингит", mkb10: "J03.0",
    full_history: "Второй день температура до 38,8, болит горло, больно глотать, отказывается от еды. Кашля и насморка нет. Болит живот немного. В садике болеют. Прививки по календарю. Отвечает ребёнок, мама рядом и иногда подсказывает.",
    personality: "ребёнок 6 лет: говорит просто, по-детски, капризничает, боится уколов и палочки для горла",
    opening_phrase: "У меня горло болит. И глотать больно. Мама сказала, ты посмотришь.",
    findings: { exam: "Температура 38,6. Миндалины гиперемированы, увеличены до II степени, с налётами белого цвета в лакунах. Передние шейные лимфоузлы увеличены до 1,5 см, болезненны. Сыпи нет. Лёгкие чистые.", lab: "ОАК: лейкоциты 15,8×10⁹/л, нейтрофилы 82%, СОЭ 28 мм/ч. Экспресс-тест на стрептококк группы А положительный.", imaging: "норма", endoscopy: "норма", ecg: "норма", pathology: "" },
  },
  {
    id: "p4", name: "Николай Иванович Ферапонтов", age: 78, sex: "male", specialty: "неврология",
    chief_complaint: "кружится голова и шатает при ходьбе",
    true_diagnosis: "Ортостатическая гипотензия на фоне передозировки антигипертензивных препаратов; дисциркуляторная энцефалопатия", mkb10: "I95.1",
    full_history: "Месяц головокружение и потемнение в глазах при вставании с кровати, один раз чуть не упал в ванной. В покое проходит. Кардиолог месяц назад добавил второй препарат от давления (амлодипин к лизиноприлу), а он ещё и мочегонное пьёт сам. Пьёт мало воды. Шума в ушах нет, слабости в руках и ногах нет, речь не нарушена. Немного забывчив.",
    personality: "старой закалки, обстоятельный, немного глуховат, переспрашивает, шутит про возраст, недоверчив к таблеткам",
    opening_phrase: "Здравствуйте, доктор. Голова у меня кружится, как встану. Старость, наверное, не радость.",
    findings: { exam: "АД лёжа 132/78, стоя через 3 минуты 98/60, пульс 72 → 88. Неврологически: очаговой симптоматики нет, в позе Ромберга лёгкое пошатывание, пальценосовую выполняет. Кожа и слизистые суховаты.", lab: "Натрий 132 ммоль/л, калий 3,4, креатинин 118 мкмоль/л. ОАК без особенностей. Глюкоза 5,4.", imaging: "МРТ головного мозга: умеренные признаки хронической ишемии, единичные очаги в белом веществе, острых изменений нет. УЗИ брахиоцефальных артерий: стеноз ВСА до 30%.", endoscopy: "норма", ecg: "Синусовый ритм 74, отклонение ЭОС влево, без острых изменений.", pathology: "" },
  },
  {
    id: "p5", name: "Валерия Струкова", age: 27, sex: "female", specialty: "эндокринология",
    chief_complaint: "сердце колотится, худеет и всё раздражает",
    true_diagnosis: "Диффузный токсический зоб (болезнь Грейвса), тиреотоксикоз средней тяжести", mkb10: "E05.0",
    full_history: "Три месяца сердцебиение, потливость, дрожь в руках, похудела на 6 кг при хорошем аппетите. Плохо спит, плаксивая, раздражительная. Жарко, когда всем нормально. Месячные стали скудными. Глаза «стали больше», подруги заметили. Думает, что это от стресса на работе.",
    personality: "быстрая, эмоциональная, перебивает, говорит много и сбивчиво, раздражается от долгих вопросов",
    opening_phrase: "Здравствуйте. Слушайте, у меня сердце всё время колотится, я уже спать не могу. Это нервы, да?",
    findings: { exam: "Пульс 112 ритмичный, АД 138/62. Кожа тёплая, влажная. Мелкий тремор пальцев вытянутых рук. Щитовидная железа диффузно увеличена, безболезненная, эластичная. Блеск глаз, симптом Грефе положительный.", lab: "ТТГ < 0,01 мЕд/л, свободный Т4 48 пмоль/л, свободный Т3 18 пмоль/л, антитела к рецептору ТТГ 12 МЕ/л (норма < 1,75).", imaging: "УЗИ щитовидной железы: объём 32 мл, диффузно неоднородная, гипоэхогенная, усиленный кровоток («щитовидное пекло»).", endoscopy: "норма", ecg: "Синусовая тахикардия 110 в минуту, без других изменений.", pathology: "" },
  },
];

const byId = (id) => PROTO_PATIENTS.find((p) => p.id === id);
const publicCard = (p) => ({ id: p.id, name: p.name, age: p.age, sex: p.sex, specialty: p.specialty, complaint: p.chief_complaint, opening: p.opening_phrase });

/** Защита от перебора без входа: 30 запросов в минуту с одного адреса (binding PROTO_LIMIT, если настроен) */
async function limited(request, env) {
  if (!env.PROTO_LIMIT) return false;
  const ip = request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "?";
  try {
    const { success } = await env.PROTO_LIMIT.limit({ key: `proto:${ip}` });
    return !success;
  } catch {
    return false;
  }
}

/** История от страницы: только реплики врача и пациента, не длиннее MAX_HISTORY */
function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === "doctor" || m.role === "patient") && typeof m.text === "string")
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, text: clampStr(m.text, 600) }))
    .filter((m) => m.text);
}

async function logTts(env, row) {
  if (!env.HUB) return;
  try {
    await env.HUB.get(env.HUB.idFromName("hub")).logAi({ uid: UID, kind: "tts", neurons: 0, ...row });
  } catch (e) {
    console.error("logAi tts", e);
  }
}

/** Озвучка реплики пациента; без ключа или при ошибке Google — null и причина (текст всё равно показываем) */
async function voiceOf(env, pat, text, quality) {
  if (!text) return { audio: null };
  if (!env.GOOGLE_TTS_API_KEY) return { audio: null, tts_error: "Ключ Google TTS не задан — пациент отвечает текстом" };
  const voice = voiceFor({ sex: pat.sex, age: pat.age, seed: pat.id }, quality);
  const t0 = Date.now();
  try {
    const r = await synthesize(env, text, voice);
    if (!r.cached) await logTts(env, { model: `google:${r.voice}`, tin: r.chars, ms: Date.now() - t0, ok: 1 });
    return { audio: r.audio, voice: r.voice };
  } catch (e) {
    console.error("tts", e);
    await logTts(env, { model: `google:${voice.name}`, ms: Date.now() - t0, ok: 0, err: String(e.message || e).slice(0, 300) });
    return { audio: null, tts_error: `Не удалось озвучить: ${ttsErrorReason(e.message)}` };
  }
}

async function patientReply(env, pat, history, text) {
  const p = P.patientReplyPrompt({ ...pat, conversation_history: [...history, { role: "doctor", text }] }, text);
  return aiText(env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, kind: "reply", uid: UID });
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("multipart/form-data")) {
    const form = await request.formData();
    const audio = form.get("audio");
    let history = [];
    try { history = JSON.parse(form.get("history") || "[]"); } catch {}
    return { pid: form.get("pid"), text: form.get("text") || "", voice: form.get("voice") === "1", quality: form.get("quality") || "", history, audio: audio && typeof audio === "object" ? audio : null };
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function protoApi(request, env, url) {
  const path = url.pathname.slice("/api/proto".length);
  const method = request.method;

  if (path === "/config" && method === "GET") {
    return json({
      patients: PROTO_PATIENTS.map(publicCard),
      tts: !!env.GOOGLE_TTS_API_KEY,
      qualities: Object.entries(TTS_QUALITIES).map(([key, q]) => ({ key, label: q.label })),
      tests: TEST_TYPES,
      exams: PHYSICAL_EXAMPLES,
    });
  }
  if (method !== "POST") return json({ error: "Не найдено" }, 404);
  if (await limited(request, env)) return json({ error: "Слишком много запросов. Подождите минуту." }, 429);

  const body = await readBody(request);
  const pat = byId(body.pid);
  if (!pat) return json({ error: "Пациент не найден" }, 400);
  const quality = TTS_QUALITIES[body.quality] ? body.quality : "wavenet";

  // Реплика пациента вслух (первая фраза, реакция на осмотр) — только тексты этого пациента не длиннее 600 символов
  if (path === "/say") {
    const text = clampStr(body.text, 600);
    if (!text) return json({ error: "Пустой текст" }, 400);
    return json(await voiceOf(env, pat, text, quality));
  }

  // Ход диалога: вопрос врача текстом или голосом → ответ пациента (и его озвучка, если voice)
  if (path === "/turn") {
    const history = cleanHistory(body.history);
    let heard = "";
    let text = clampStr(body.text, 1500);
    if (body.audio) {
      if (body.audio.size > MAX_AUDIO_BYTES) return json({ error: "Запись слишком длинная — до минуты" }, 413);
      try {
        heard = await transcribe(env, arrayBufferToBase64(await body.audio.arrayBuffer()), { uid: UID });
      } catch (e) {
        console.error("proto stt", e);
        return json({ error: "Не удалось распознать речь. Попробуйте ещё раз." }, 502);
      }
      if (!heard) return json({ error: "В записи не слышно речи", empty: true }, 422);
      text = clampStr(heard, 1500);
    }
    if (!text) return json({ error: "Пустое сообщение" }, 400);
    let reply;
    try {
      reply = await patientReply(env, pat, history, text);
    } catch (e) {
      console.error("proto reply", e);
      return json({ error: "Пациент задумался… Повторите вопрос.", heard }, 502);
    }
    const voice = body.voice ? await voiceOf(env, pat, reply, quality) : {};
    return json({ heard, reply, ...voice });
  }

  if (path === "/test") {
    const name = clampStr(body.name, 80);
    if (!name) return json({ error: "Укажите обследование" }, 400);
    const p = P.testResultPrompt(pat, name);
    try {
      const result = await aiText(env, { prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "test", uid: UID });
      return json({ test: name, result });
    } catch (e) {
      console.error("proto test", e);
      return json({ error: `Результат «${name}» временно недоступен` }, 502);
    }
  }

  if (path === "/exam") {
    const name = clampStr(body.name, 200);
    if (!name) return json({ error: "Опишите, что осматриваете" }, 400);
    let res;
    try {
      const p = P.physicalExamPrompt(pat, name);
      res = await aiJson(env, { system: p.system, prompt: p.prompt, maxTokens: p.maxTokens, temperature: p.temperature, kind: "exam", uid: UID });
      if (isRefusal(res?.sensation)) throw new Error("отказ модели");
    } catch {
      try {
        const f = P.physicalExamFallbackPrompt(pat, name);
        const text = await aiText(env, { system: f.system, prompt: f.prompt, maxTokens: f.maxTokens, temperature: f.temperature, kind: "exam", uid: UID });
        if (isRefusal(text)) throw new Error("отказ модели");
        res = { sensation: text, reaction: "" };
      } catch (e) {
        console.error("proto exam", e);
        return json({ error: "Результат осмотра временно недоступен" }, 502);
      }
    }
    const reaction = clampStr(res.reaction || "", 400);
    const voice = body.voice && reaction ? await voiceOf(env, pat, reaction, quality) : {};
    return json({ action: name, sensation: clampStr(res.sensation || "", 1200), reaction, ...voice });
  }

  // Завершение: прощание пациента, верный диагноз и короткая сверка с диагнозом врача
  if (path === "/finish") {
    const diagnosis = clampStr(body.diagnosis, 300);
    const history = cleanHistory(body.history);
    const actions = (Array.isArray(body.actions) ? body.actions : []).map((a) => clampStr(a, 100)).filter(Boolean).slice(0, 20);
    const withDx = diagnosis ? [...actions, `диагноз: ${diagnosis}`] : actions;
    const fp = P.farewellPrompt({ ...pat, conversation_history: history }, withDx);
    const [farewell, verdict] = await Promise.all([
      aiText(env, { system: fp.system, prompt: fp.prompt, maxTokens: fp.maxTokens, kind: "farewell", uid: UID }).catch(() => "Спасибо, доктор. До свидания."),
      diagnosis
        ? aiJson(env, {
            prompt: `Истинный диагноз: ${pat.true_diagnosis}. Диагноз врача: ${diagnosis}. Сравни по смыслу, синонимы считаются верными.
Верни JSON: {"match":"yes|partial|no","comment":"одно короткое предложение: что совпало или что упущено"}`,
            maxTokens: 120, temperature: 0.2, kind: "evaluation", uid: UID,
          }).catch(() => null)
        : null,
    ]);
    const voice = body.voice ? await voiceOf(env, pat, farewell, quality) : {};
    return json({
      farewell, true_diagnosis: pat.true_diagnosis, mkb10: pat.mkb10,
      match: ["yes", "partial", "no"].includes(verdict?.match) ? verdict.match : diagnosis ? "unknown" : "none",
      comment: clampStr(verdict?.comment || "", 300),
      ...voice,
    });
  }

  return json({ error: "Не найдено" }, 404);
}
