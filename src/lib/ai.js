// Workers AI: текст, JSON и распознавание речи.
// Все вызовы идут через binding env.AI — без внешних ключей.
import { AI_MODEL, AI_NEURONS, WHISPER_MODEL } from "../config.js";
import { mockAi } from "./mock-ai.js";
import { stripForeignScripts } from "./util.js";

const JSON_SYSTEM = "Отвечай ТОЛЬКО валидным JSON без markdown, без ``` и без пояснений. Все тексты внутри JSON — на русском языке.";

/**
 * Текстовый ответ модели.
 * @param {object} env
 * @param {{system?: string, prompt: string, maxTokens?: number, temperature?: number}} opts
 */
export async function aiText(env, { system, prompt, maxTokens = 300, temperature = 0.8, kind = "other", uid = "" }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const text = responseToText(await runWithRetry(env, { messages, max_tokens: maxTokens, temperature }, { kind, uid }));
  if (!text) throw new Error("Workers AI: пустой ответ");
  return stripQuotes(cleanText(text));
}

/**
 * JSON-ответ модели: парсит, а при битом JSON делает одну повторную попытку.
 */
export async function aiJson(env, { system, prompt, maxTokens = 800, temperature = 0.7, kind = "other", uid = "" }) {
  const messages = [
    { role: "system", content: system ? `${system}\n\n${JSON_SYSTEM}` : JSON_SYSTEM },
    { role: "user", content: prompt },
  ];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runWithRetry(env, { messages, max_tokens: maxTokens, temperature: attempt ? 0.3 : temperature }, { kind, uid });
    // Workers AI сам парсит JSON-ответ в объект — тогда он уже готов
    if (result?.response && typeof result.response === "object") return cleanDeep(result.response);
    try {
      return cleanDeep(parseJsonLoose(responseToText(result)));
    } catch (e) {
      lastErr = e;
      console.warn("aiJson: невалидный JSON, повтор", e.message);
    }
  }
  throw lastErr;
}

/** Распознавание речи (Whisper). base64Audio — строка base64. */
export async function transcribe(env, base64Audio, { uid = "" } = {}) {
  const t0 = Date.now();
  let result;
  try {
    result = await ai(env).run(WHISPER_MODEL, { audio: base64Audio, language: "ru", task: "transcribe" });
  } catch (e) {
    await logUsage(env, { uid, kind: "voice", model: WHISPER_MODEL, ms: Date.now() - t0, ok: 0, err: e.message });
    throw e;
  }
  // Длительность из ответа Whisper; если её нет — оценка по размеру (Opus ≈ 4 КБ/с)
  let sec = Number(result?.transcription_info?.duration);
  const estimated = !(sec > 0);
  if (estimated) sec = Math.max(1, Math.round((base64Audio.length * 0.75) / 4000));
  await logUsage(env, { uid, kind: "voice", model: WHISPER_MODEL, audio_sec: sec, ms: Date.now() - t0, ok: 1, estimated: estimated ? 1 : 0 });
  // Whisper на шуме иногда «слышит» китайский — чистим так же, как ответы модели
  return cleanText(result?.text ?? "");
}

/** Нейроны за запрос по тарифу модели (цены Cloudflare в нейронах) */
export function neuronsFor(model, { tin = 0, tout = 0, audio_sec = 0 } = {}) {
  const r = AI_NEURONS[model];
  if (!r) return 0;
  return (tin * (r.in || 0)) / 1e6 + (tout * (r.out || 0)) / 1e6 + (audio_sec / 60) * (r.audio_min || 0);
}

/** Запись расхода ИИ в HubDO: по ней админка считает нейроны, скорость и ошибки */
async function logUsage(env, row) {
  if (!env.HUB) return;
  try {
    await env.HUB.get(env.HUB.idFromName("hub")).logAi({ ...row, neurons: neuronsFor(row.model, row) });
  } catch (e) {
    console.error("logAi", e);
  }
}

function estimateTokens(text) {
  // Кириллица в токенизаторе Llama — примерно 2,5 символа на токен
  return Math.ceil(String(text || "").length / 2.5);
}

/** Binding Workers AI; в локальных тестах (AI_MOCK=1) — заглушка */
function ai(env) {
  if (env.AI) return env.AI;
  if (env.AI_MOCK === "1") return mockAi;
  throw new Error("Workers AI binding не настроен");
}

async function runWithRetry(env, input, meta = {}, attempts = 3) {
  let lastErr;
  const promptText = (input.messages || []).map((m) => m.content).join("\n");
  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now();
    try {
      const res = await ai(env).run(AI_MODEL, input);
      const u = res?.usage || {};
      const exact = Number(u.prompt_tokens) > 0;
      await logUsage(env, {
        uid: meta.uid || "", kind: meta.kind || "other", model: AI_MODEL, ms: Date.now() - t0, ok: 1,
        tin: exact ? Number(u.prompt_tokens) : estimateTokens(promptText),
        tout: exact ? Number(u.completion_tokens || 0) : estimateTokens(responseToText(res)),
        estimated: exact ? 0 : 1,
      });
      return res;
    } catch (e) {
      lastErr = e;
      await logUsage(env, { uid: meta.uid || "", kind: meta.kind || "other", model: AI_MODEL, ms: Date.now() - t0, ok: 0, err: String(e.message || e).slice(0, 300) });
      console.warn(`Workers AI attempt ${i + 1} failed: ${e.message}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

export function responseToText(result) {
  const r = result?.response;
  if (r == null) return "";
  return (typeof r === "string" ? r : JSON.stringify(r)).trim();
}

/** Достаёт JSON-объект из ответа, даже если модель добавила текст или ``` вокруг */
export function parseJsonLoose(text) {
  const clean = String(text).replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {}
  const start = clean.search(/[{[]/);
  const end = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
  if (start === -1 || end <= start) throw new Error("в ответе нет JSON");
  return JSON.parse(clean.slice(start, end + 1));
}

// Иероглифы и другие чужие письменности в ответах модели — см. stripForeignScripts
export function cleanText(text) {
  return stripForeignScripts(text).trim();
}

function cleanDeep(v) {
  if (typeof v === "string") return cleanText(v);
  if (Array.isArray(v)) return v.map(cleanDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)]));
  return v;
}

/** Модель иногда оборачивает реплику в кавычки или добавляет «Пациент:» */
function stripQuotes(text) {
  let t = text.replace(/^(пациент|ответ|реплика)\s*:\s*/i, "").trim();
  if (/^["«“].*["»”]$/s.test(t) && t.length > 2) t = t.slice(1, -1).trim();
  return t;
}
