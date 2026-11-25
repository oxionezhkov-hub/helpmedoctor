// Домен отделяет токен Telegram от всех остальных подписей SESSION_SECRET.
export async function founderWebhookToken(secret) {
  if (!secret) return "";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const value = await crypto.subtle.sign("HMAC", key, encoder.encode("helpmedoctor:telegram-webhook:v1"));
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
