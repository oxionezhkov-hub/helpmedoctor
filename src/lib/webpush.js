// Web Push без сторонних сервисов: VAPID (RFC 8292) + шифрование aes128gcm (RFC 8291) на WebCrypto.
// Ключи VAPID: из секретов VAPID_PUBLIC / VAPID_PRIVATE (JWK) или создаются один раз и хранятся в KV.
const KV_KEY = "vapid:v1";
const enc = new TextEncoder();

export const b64u = {
  encode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(str).length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
};

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** Пара ключей VAPID: { publicKey (base64url, 65 байт), privateJwk } */
export async function vapidKeys(env) {
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE) return { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE) };
  const kv = env.HELPMEDOCTOR;
  const hit = kv && (await kv.get(KV_KEY, "json").catch(() => null));
  if (hit) return hit;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const keys = {
    publicKey: b64u.encode(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
  if (kv) await kv.put(KV_KEY, JSON.stringify(keys));
  return keys;
}

async function vapidAuth(endpoint, keys, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${keys.publicKey}`;
}

/** Шифрует payload для подписки (RFC 8291, одна запись aes128gcm) */
export async function encryptPayload(sub, payload) {
  const uaPublic = b64u.decode(sub.keys.p256dh);
  const authSecret = b64u.decode(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 0x02 — последняя запись
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Отправить уведомление на одну подписку.
 * @returns {Promise<{ok: boolean, gone: boolean, status: number}>} gone — подписка больше не действует, её надо удалить
 */
export async function sendPush(env, sub, message, { ttl = 24 * 3600, urgency = "normal", keys } = {}) {
  try {
    keys ||= await vapidKeys(env);
    const body = await encryptPayload(sub, JSON.stringify(message));
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuth(sub.endpoint, keys, env.VAPID_SUBJECT || "https://helpmedoctor.ru"),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(ttl),
        Urgency: urgency,
      },
      body,
    });
    // 404/410 — подписка удалена; 401/403 — подписана другим ключом VAPID (ключи сменились)
    return { ok: res.ok, gone: [401, 403, 404, 410].includes(res.status), status: res.status };
  } catch (e) {
    console.warn("push failed", e?.message || e);
    return { ok: false, gone: false, status: 0 };
  }
}

// Сервисы пушей браузеров: Chrome/Яндекс/Edge — FCM и WNS, Firefox — Mozilla, Safari — Apple
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

/** Проверка подписки из браузера: адрес известного сервиса пушей и ключи нужной длины */
export function validSubscription(sub) {
  try {
    const u = new URL(sub?.endpoint);
    if (u.protocol !== "https:" || !PUSH_HOSTS.some((re) => re.test(u.hostname))) return false;
    return b64u.decode(sub.keys.p256dh).length === 65 && b64u.decode(sub.keys.auth).length === 16;
  } catch {
    return false;
  }
}
