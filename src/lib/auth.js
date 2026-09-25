// Авторизация веб-версии.
// 1) Внутри Telegram: проверяем подпись initData (HMAC от токена бота).
// 2) В обычном браузере: вход по одноразовой ссылке t.me/<bot>?start=login_<code>.
// В обоих случаях выдаём подписанный токен сессии (HMAC-SHA256 от SESSION_SECRET).

const enc = new TextEncoder();
const SESSION_TTL_MS = 90 * 86400000;

async function hmacKey(secret) {
  const raw = typeof secret === "string" ? enc.encode(secret) : secret;
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function hmac(secret, data) {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- Сессии ----------
export async function createSession(env, uid, { scope = "user", ttl = SESSION_TTL_MS } = {}) {
  const payload = b64url(enc.encode(JSON.stringify({ uid: String(uid), exp: Date.now() + ttl, ...(scope !== "user" ? { scope } : {}) })));
  const sig = b64url(await hmac(env.SESSION_SECRET, payload));
  return `${payload}.${sig}`;
}

/** uid из токена; scope — "user" (сайт) или "admin" (админка). Токены разных scope не взаимозаменяемы. */
export async function verifySession(env, token, scope = "user") {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(await hmac(env.SESSION_SECRET, payload));
  if (!safeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload));
    if (!data.uid || data.exp < Date.now()) return null;
    if ((data.scope || "user") !== scope) return null;
    return data.uid;
  } catch {
    return null;
  }
}

// ---------- Подписанные данные (state для OAuth) ----------
export async function signData(env, obj) {
  const payload = b64url(enc.encode(JSON.stringify(obj)));
  return `${payload}.${b64url(await hmac(env.SESSION_SECRET, `data:${payload}`))}`;
}

/** Данные из signData или null, если подпись не сходится или срок (exp) истёк */
export async function readSignedData(env, token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, b64url(await hmac(env.SESSION_SECRET, `data:${payload}`)))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(b64urlDecode(payload), (c) => c.charCodeAt(0))));
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

/** Случайная строка для nonce / кодов */
export function randomToken(bytes = 18) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---------- Telegram Mini App initData ----------
/**
 * Проверка initData по документации Telegram:
 * secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string)
 * @returns {{id: string, first_name?: string, username?: string} | null}
 */
export async function verifyInitData(env, initData, maxAgeSec = 7 * 86400) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac("WebAppData", env.TELEGRAM_TOKEN);
  const expected = toHex(await hmac(secret, dataCheck));
  if (!safeEqual(hash, expected)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return null;
    return { id: String(user.id), first_name: user.first_name, username: user.username };
  } catch {
    return null;
  }
}

// ---------- Вход по ссылке через бота ----------
/** Ссылки на вход через бота: tg:// открывает приложение Telegram сразу, без новой вкладки; t.me — запасной вариант */
export function loginLinks(env, code, kind = "login") {
  const start = `${kind}_${code}`;
  return {
    url: `https://t.me/${env.BOT_USERNAME}?start=${start}`,
    tg: `tg://resolve?domain=${env.BOT_USERNAME}&start=${start}`,
  };
}

export function newLoginCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return b64url(bytes).replace(/[-_]/g, "x");
}

/** Извлекает токен из заголовка Authorization: Bearer ... */
export function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export const ADMIN_SESSION_TTL_MS = 12 * 3600 * 1000;
