// Данные приложения для Claude (только чтение): то же, что видно в админке, через /api/admin/export.
// Ключ ADMIN_EXPORT_KEY: из окружения или его подставляет сетевой секрет среды Claude (заголовок X-Export-Key).
// Примеры:
//   node scripts/app-data.mjs users '{"filter":{"q":"почта или имя"},"limit":50}'
//   node scripts/app-data.mjs report '{"name":"cjm","channel":"Реклама: Яндекс Директ","from":0,"to":9999999999999}'
//   node scripts/app-data.mjs dashboard '{"from":<ts>,"to":<ts>}'
//   node scripts/app-data.mjs user w123456789012          — карточка пользователя
//   node scripts/app-data.mjs patient w123456789012 pat_1 — пациент пользователя
// Операции — READ_OPS в src/admin-api.js. Вывод — JSON в stdout.
const [op, a1 = "", a2 = ""] = process.argv.slice(2);
if (!op) throw new Error("укажите операцию: users, report, dashboard, events, chat, payments, user, patient…");
const BASE = (process.env.BASE || "https://helpmedoctor.ru").replace(/\/$/, "");
const key = process.env.ADMIN_EXPORT_KEY;

const qs = op === "user" ? `user=${encodeURIComponent(a1)}`
  : op === "patient" ? `user=${encodeURIComponent(a1)}&patient=${encodeURIComponent(a2)}`
  : `op=${encodeURIComponent(op)}&args=${encodeURIComponent(a1 || "{}")}`;
const r = await fetch(`${BASE}/api/admin/export?${qs}`, { headers: key ? { "X-Export-Key": key } : {} });
const text = await r.text();
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  process.exit(1);
}
console.log(text);
