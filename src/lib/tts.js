// Синтез речи (Google Cloud Text-to-Speech). Ключ — секрет воркера GOOGLE_TTS_API_KEY.
// Голос подбирается по полу и возрасту пациента; высота и темп — по возрасту.
// Бесплатно в месяц: 1 млн символов WaveNet и Chirp 3 HD, 4 млн Standard (cloud.google.com/text-to-speech/pricing).

const TTS_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
export const TTS_MAX_CHARS = 600;

// Русские голоса Google: A, C, E — женские, B, D — мужские. У Chirp 3 HD — свои имена, высоту он не меняет.
export const TTS_QUALITIES = {
  wavenet: { label: "WaveNet", female: ["ru-RU-Wavenet-A", "ru-RU-Wavenet-C", "ru-RU-Wavenet-E"], male: ["ru-RU-Wavenet-B", "ru-RU-Wavenet-D"], pitch: true },
  chirp: { label: "Chirp 3 HD", female: ["ru-RU-Chirp3-HD-Kore", "ru-RU-Chirp3-HD-Aoede", "ru-RU-Chirp3-HD-Leda"], male: ["ru-RU-Chirp3-HD-Charon", "ru-RU-Chirp3-HD-Orus", "ru-RU-Chirp3-HD-Fenrir"], pitch: false },
  standard: { label: "Standard", female: ["ru-RU-Standard-A", "ru-RU-Standard-C", "ru-RU-Standard-E"], male: ["ru-RU-Standard-B", "ru-RU-Standard-D"], pitch: true },
};

function hash(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/**
 * Голос пациента: один и тот же на весь приём (по seed — обычно id пациента).
 * Детям — женский голос выше и быстрее (так звучит детская речь у синтеза), пожилым — ниже и медленнее.
 */
export function voiceFor({ sex, age, seed = "" }, quality = "wavenet") {
  const q = TTS_QUALITIES[quality] || TTS_QUALITIES.wavenet;
  const a = parseInt(age, 10) || 40;
  const child = a < 13;
  const list = child || sex === "female" ? q.female : q.male;
  const name = list[hash(seed) % list.length];
  let pitch = 0;
  let rate = 1;
  if (child) { pitch = 4; rate = 1.08; }
  else if (a >= 75) { pitch = -2.5; rate = 0.86; }
  else if (a >= 60) { pitch = -1.5; rate = 0.93; }
  else if (a < 25) { rate = 1.05; }
  return { name, pitch: q.pitch ? pitch : 0, rate, quality: TTS_QUALITIES[quality] ? quality : "wavenet" };
}

/** Текст для озвучки: без ремарок в скобках и звёздочках, эмодзи и разметки */
export function speakableText(text) {
  return String(text || "")
    .replace(/\*[^*]{0,80}\*/g, " ")
    .replace(/\([^)]{0,80}\)/g, " ")
    .replace(/\[[^\]]{0,80}\]/g, " ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[_#>`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TTS_MAX_CHARS);
}

/**
 * Озвучить текст. Возвращает { audio: base64 MP3, voice, chars } или бросает ошибку.
 * Ответы кэшируются (одинаковая фраза тем же голосом — без повторного запроса к Google).
 */
export async function synthesize(env, text, voice) {
  const clean = speakableText(text);
  if (!clean) throw new Error("пустой текст для озвучки");
  if (!env.GOOGLE_TTS_API_KEY) throw new Error("GOOGLE_TTS_API_KEY не задан");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(`https://tts.cache/${voice.name}/${voice.pitch}/${voice.rate}/${hash(clean)}/${clean.length}`);
  if (cache) {
    const hit = await cache.match(cacheKey).catch(() => null);
    if (hit) return { audio: await hit.text(), voice: voice.name, chars: 0, cached: true };
  }
  const audioConfig = { audioEncoding: "MP3", speakingRate: voice.rate };
  if (voice.pitch) audioConfig.pitch = voice.pitch;
  const res = await fetch(`${TTS_URL}?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: { text: clean }, voice: { languageCode: "ru-RU", name: voice.name }, audioConfig }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Google TTS HTTP ${res.status}: ${err.slice(0, 300)}`);
  }
  const j = await res.json();
  if (!j.audioContent) throw new Error("Google TTS: пустой ответ");
  if (cache) {
    await cache.put(cacheKey, new Response(j.audioContent, { headers: { "Cache-Control": "public, max-age=604800" } })).catch(() => {});
  }
  return { audio: j.audioContent, voice: voice.name, chars: clean.length };
}
