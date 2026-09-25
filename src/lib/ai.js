// ИИ: текст, JSON и распознавание речи.
// Основной путь — Workers AI (binding env.AI), модель выбирается по шагу приёма (kind) — см. AI_MODELS в config.js.
// Когда бесплатные нейроны Cloudflare на сегодня кончились или Workers AI отказал — запасные провайдеры (Cerebras, Groq).
import { AI_DEFAULT_MODEL, AI_FALLBACKS, AI_MODELS, AI_NEURONS, AI_ROUTING_DEFAULT, WHISPER_MODEL } from "../config.js";
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

// Настройки маршрутизации из HubDO (модели по шагам, «Cloudflare на сегодня исчерпан») — кэш на минуту в изоляте
let routeCache = { at: 0, v: null };
const ROUTE_TTL_MS = 60_000;

async function route(env) {
  if (routeCache.v && Date.now() - routeCache.at < ROUTE_TTL_MS) return routeCache.v;
  let v = { routing: {}, cf_blocked: false };
  if (env.HUB) {
    try {
      v = await env.HUB.get(env.HUB.idFromName("hub")).aiRoute();
    } catch (e) {
      console.error("aiRoute", e);
    }
  }
  routeCache = { at: Date.now(), v };
  return v;
}

/** Сбросить кэш маршрутизации (после смены настроек и в тестах) */
export function resetAiRoute() {
  routeCache = { at: 0, v: null };
}

/** Модель Workers AI для шага: настройка админки → умолчание шага → общая модель по умолчанию */
export function modelFor(kind, routing = {}) {
  const key = [routing?.[kind], AI_ROUTING_DEFAULT[kind], AI_DEFAULT_MODEL].find((k) => k && AI_MODELS[k]);
  return { key, ...AI_MODELS[key] };
}

/** Запасные провайдеры, для которых задан ключ */
export function fallbacksFor(env) {
  return AI_FALLBACKS.filter((f) => env[f.secret]);
}

/** Workers AI отказал из-за исчерпанного лимита нейронов (на Free-плане — до конца суток UTC) */
export function isQuotaError(e) {
  return /4006|daily free allocation|used up your daily/i.test(String(e?.message || e));
}

async function runWithRetry(env, input, meta = {}) {
  const r = await route(env);
  const model = modelFor(meta.kind, r.routing);
  const ext = fallbacksFor(env);
  let lastErr;
  if (!r.cf_blocked || !ext.length) {
    try {
      return await runCf(env, model, input, meta);
    } catch (e) {
      lastErr = e;
      if (!ext.length) throw e;
      if (isQuotaError(e)) await markCfBlocked(env, e);
      console.warn(`Workers AI недоступен (${e.message}) — запасной провайдер`);
    }
  }
  for (const f of ext) {
    try {
      return await runExternal(env, f, input, meta);
    } catch (e) {
      lastErr = e;
      console.warn(`${f.key} недоступен: ${e.message}`);
    }
  }
  // Запасные не ответили, а Cloudflare мы пропустили — последняя попытка через него
  if (r.cf_blocked) return runCf(env, model, input, meta, 1);
  throw lastErr;
}

async function runCf(env, model, input, meta, attempts = 3) {
  let lastErr;
  const promptText = (input.messages || []).map((m) => m.content).join("\n");
  const payload = model.noThink ? { ...input, messages: noThink(input.messages) } : input;
  for (let i = 0; i < attempts; i++) {
    const t0 = Date.now();
    try {
      const res = await ai(env).run(model.id, payload);
      const u = res?.usage || {};
      const exact = Number(u.prompt_tokens) > 0;
      await logUsage(env, {
        uid: meta.uid || "", kind: meta.kind || "other", model: model.id, ms: Date.now() - t0, ok: 1,
        tin: exact ? Number(u.prompt_tokens) : estimateTokens(promptText),
        tout: exact ? Number(u.completion_tokens || 0) : estimateTokens(responseToText(res)),
        estimated: exact ? 0 : 1,
      });
      return res;
    } catch (e) {
      lastErr = e;
      await logUsage(env, { uid: meta.uid || "", kind: meta.kind || "other", model: model.id, ms: Date.now() - t0, ok: 0, err: String(e.message || e).slice(0, 300) });
      console.warn(`Workers AI attempt ${i + 1} failed: ${e.message}`);
      if (isQuotaError(e)) break; // лимит — повторять бесполезно
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Qwen3 по умолчанию «думает» вслух — отключаем мягким переключателем /no_think */
function noThink(messages = []) {
  const out = messages.map((m) => ({ ...m }));
  const last = out.findLastIndex((m) => m.role === "user");
  if (last >= 0) out[last].content = `${out[last].content}\n/no_think`;
  return out;
}

/** OpenAI-совместимый запасной провайдер (Cerebras, Groq). Ответ приводим к виду Workers AI: { response, usage } */
async function runExternal(env, f, input, meta) {
  const t0 = Date.now();
  const model = `${f.key}:${f.model}`;
  try {
    const res = await fetch(f.url, {
      method: "POST",
      headers: { authorization: `Bearer ${env[f.secret]}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: f.model,
        messages: input.messages,
        // GPT-OSS рассуждает перед ответом — даём запас токенов, но рассуждение держим коротким
        max_completion_tokens: (input.max_tokens || 300) + 600,
        temperature: input.temperature ?? 0.7,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`${f.key} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content;
    if (!text) throw new Error(`${f.key}: пустой ответ`);
    const u = j.usage || {};
    await logUsage(env, { uid: meta.uid || "", kind: meta.kind || "other", model, ms: Date.now() - t0, ok: 1, tin: Number(u.prompt_tokens || 0), tout: Number(u.completion_tokens || 0) });
    return { response: text, usage: u };
  } catch (e) {
    await logUsage(env, { uid: meta.uid || "", kind: meta.kind || "other", model, ms: Date.now() - t0, ok: 0, err: String(e.message || e).slice(0, 300) });
    throw e;
  }
}

/** Лимит Cloudflare кончился: запоминаем до конца суток UTC (у себя и в HubDO — для остальных изолятов) */
async function markCfBlocked(env, e) {
  if (routeCache.v) routeCache.v = { ...routeCache.v, cf_blocked: true };
  if (!env.HUB) return;
  try {
    await env.HUB.get(env.HUB.idFromName("hub")).aiCfBlocked(String(e?.message || e).slice(0, 300));
  } catch (err) {
    console.error("aiCfBlocked", err);
  }
}

export function responseToText(result) {
  // Workers AI отдаёт { response } у одних моделей и формат OpenAI { choices } — у других (Qwen3)
  const r = result?.response ?? result?.choices?.[0]?.message?.content;
  if (r == null) return "";
  return stripThink(typeof r === "string" ? r : JSON.stringify(r)).trim();
}

/** Блок рассуждений <think>…</think> (Qwen3) — пользователю не показываем */
export function stripThink(text) {
  return String(text).replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/<\/think>/gi, "");
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
