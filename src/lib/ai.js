// Workers AI: текст, JSON и распознавание речи.
// Все вызовы идут через binding env.AI — без внешних ключей.
import { AI_MODEL, WHISPER_MODEL } from "../config.js";
import { mockAi } from "./mock-ai.js";

const JSON_SYSTEM = "Отвечай ТОЛЬКО валидным JSON без markdown, без ``` и без пояснений. Все тексты внутри JSON — на русском языке.";

/**
 * Текстовый ответ модели.
 * @param {object} env
 * @param {{system?: string, prompt: string, maxTokens?: number, temperature?: number}} opts
 */
export async function aiText(env, { system, prompt, maxTokens = 300, temperature = 0.8 }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const text = responseToText(await runWithRetry(env, { messages, max_tokens: maxTokens, temperature }));
  if (!text) throw new Error("Workers AI: пустой ответ");
  return stripQuotes(text);
}

/**
 * JSON-ответ модели: парсит, а при битом JSON делает одну повторную попытку.
 */
export async function aiJson(env, { system, prompt, maxTokens = 800, temperature = 0.7 }) {
  const messages = [
    { role: "system", content: system ? `${system}\n\n${JSON_SYSTEM}` : JSON_SYSTEM },
    { role: "user", content: prompt },
  ];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runWithRetry(env, { messages, max_tokens: maxTokens, temperature: attempt ? 0.3 : temperature });
    // Workers AI сам парсит JSON-ответ в объект — тогда он уже готов
    if (result?.response && typeof result.response === "object") return result.response;
    try {
      return parseJsonLoose(responseToText(result));
    } catch (e) {
      lastErr = e;
      console.warn("aiJson: невалидный JSON, повтор", e.message);
    }
  }
  throw lastErr;
}

/** Распознавание речи (Whisper). base64Audio — строка base64. */
export async function transcribe(env, base64Audio) {
  const result = await ai(env).run(WHISPER_MODEL, { audio: base64Audio, language: "ru", task: "transcribe" });
  return String(result?.text ?? "").trim();
}

/** Binding Workers AI; в локальных тестах (AI_MOCK=1) — заглушка */
function ai(env) {
  if (env.AI) return env.AI;
  if (env.AI_MOCK === "1") return mockAi;
  throw new Error("Workers AI binding не настроен");
}

async function runWithRetry(env, input, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await ai(env).run(AI_MODEL, input);
    } catch (e) {
      lastErr = e;
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

/** Модель иногда оборачивает реплику в кавычки или добавляет «Пациент:» */
function stripQuotes(text) {
  let t = text.replace(/^(пациент|ответ|реплика)\s*:\s*/i, "").trim();
  if (/^["«“].*["»”]$/s.test(t) && t.length > 2) t = t.slice(1, -1).trim();
  return t;
}
