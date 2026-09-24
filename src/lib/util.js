// Общие утилиты: даты по Москве, HTML-экранирование, ответы API

const MSK_OFFSET_MS = 3 * 3600 * 1000; // Москва без перехода на летнее время

/** Дата по Москве в формате YYYY-MM-DD */
export function mskDate(ts = Date.now()) {
  return new Date(ts + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Timestamp полуночи текущих московских суток */
export function mskMidnight(ts = Date.now()) {
  const d = new Date(ts + MSK_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - MSK_OFFSET_MS;
}

/** Сколько календарных (московских) дней между двумя датами YYYY-MM-DD */
export function daysBetween(fromDate, toDate) {
  if (!fromDate || !toDate) return Infinity;
  return Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000);
}

export function esc(t) {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function declDays(n) {
  const abs = Math.abs(n) % 100;
  const mod = abs % 10;
  if (abs >= 11 && abs <= 19) return "дней";
  if (mod === 1) return "день";
  if (mod >= 2 && mod <= 4) return "дня";
  return "дней";
}

export function declPatients(n) {
  const abs = Math.abs(n) % 100;
  const mod = abs % 10;
  if (abs >= 11 && abs <= 19) return "пациентов";
  if (mod === 1) return "пациент";
  if (mod >= 2 && mod <= 4) return "пациента";
  return "пациентов";
}

export function firstName(fullName) {
  return String(fullName || "").split(" ")[0];
}

export function clampStr(s, max) {
  return String(s ?? "").trim().slice(0, max);
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/**
 * Ошибка, текст которой можно показать пользователю.
 * Через RPC Durable Object доходит только message, поэтому код и текст кодируем в нём.
 */
export class UserError extends Error {
  constructor(message, code = "user_error") {
    super(`USER:${code}:${message}`);
  }
}

/** Разбирает UserError (в т.ч. пришедшую через RPC). null — если это внутренняя ошибка */
export function userError(e) {
  const m = /^USER:([a-z_]+):([\s\S]*)$/.exec(e?.message || "");
  return m ? { code: m[1], message: m[2] } : null;
}

export function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
