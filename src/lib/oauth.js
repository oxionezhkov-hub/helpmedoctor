// Вход на сайт через Google и Яндекс (OAuth 2.0, authorization code).
// Ключи приложений — секреты воркера: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET.
// Провайдер без ключей просто не показывается на странице входа.

export const PROVIDERS = {
  google: {
    label: "Google",
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    idVar: "GOOGLE_CLIENT_ID",
    secretVar: "GOOGLE_CLIENT_SECRET",
  },
  yandex: {
    label: "Яндекс ID",
    authorize: "https://oauth.yandex.ru/authorize",
    token: "https://oauth.yandex.ru/token",
    scope: "", // права (login:info, login:email) задаются в настройках приложения Яндекс ID
    idVar: "YANDEX_CLIENT_ID",
    secretVar: "YANDEX_CLIENT_SECRET",
  },
};

/** Тестовый режим (только wrangler.test.jsonc): код вида "test:<sub>:<email>:<имя>" вместо похода к провайдеру */
const testMode = (env) => env.OAUTH_TEST_MODE === "1";

export function enabledProviders(env) {
  return Object.keys(PROVIDERS).filter((k) => testMode(env) || (env[PROVIDERS[k].idVar] && env[PROVIDERS[k].secretVar]));
}

/** origin — адрес сайта, с которого пришёл пользователь: cookie с nonce живёт на нём же */
export function redirectUri(provider, origin) {
  return `${origin.replace(/\/$/, "")}/api/auth/oauth/${provider}/callback`;
}

export function authorizeUrl(env, provider, state, redirect) {
  const p = PROVIDERS[provider];
  const q = new URLSearchParams({ response_type: "code", client_id: env[p.idVar] || "test", redirect_uri: redirect, state });
  if (p.scope) q.set("scope", p.scope);
  if (provider === "google") q.set("prompt", "select_account");
  if (testMode(env)) return `${redirect}?${new URLSearchParams({ state, code: `test:${provider}-user:user@example.com:Тест` })}`;
  return `${p.authorize}?${q}`;
}

/**
 * Обмен кода на данные пользователя.
 * @returns {Promise<{sub: string, email: string, name: string}>}
 */
export async function fetchIdentity(env, provider, code, redirect) {
  if (testMode(env) && code.startsWith("test:")) {
    const [, sub, email, name] = code.split(":");
    return { sub, email: email || "", name: name || "" };
  }
  const p = PROVIDERS[provider];
  const body = new URLSearchParams({ grant_type: "authorization_code", code, client_id: env[p.idVar], client_secret: env[p.secretVar] });
  if (provider === "google") body.set("redirect_uri", redirect);
  const r = await fetch(p.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${provider} token: ${tok.error_description || tok.error || r.status}`);

  if (provider === "google") {
    // id_token получен напрямую от Google по TLS в обмен на client_secret — подпись можно не проверять (OIDC Core 3.1.3.7),
    // но получателя, издателя и срок сверяем
    const claims = decodeJwtPayload(tok.id_token);
    if (!claims?.sub) throw new Error("google: нет id_token");
    if (claims.aud !== env[p.idVar]) throw new Error("google: чужой aud");
    if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("google: чужой iss");
    if (claims.exp * 1000 < Date.now()) throw new Error("google: id_token истёк");
    return { sub: String(claims.sub), email: claims.email_verified ? claims.email || "" : "", name: claims.given_name || claims.name || "" };
  }

  const info = await fetch("https://login.yandex.ru/info?format=json", { headers: { Authorization: `OAuth ${tok.access_token}` } });
  const u = await info.json().catch(() => ({}));
  if (!info.ok || !u.id) throw new Error(`yandex info: ${info.status}`);
  return { sub: String(u.id), email: u.default_email || "", name: u.first_name || u.real_name || u.display_name || u.login || "" };
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || "").split(".")[1];
  if (!part) return null;
  try {
    let s = part.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

/** Пользователь, вошедший только через Google/Яндекс: uid начинается с «w» (Telegram ID — всегда число) */
export const isTelegramUid = (uid) => /^\d+$/.test(String(uid));

export function newWebUid() {
  const digits = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b % 10).join("");
  return `w${digits}`;
}
