// Настройка бота после деплоя: вебхук с секретом, кнопка меню «Открыть приложение», список команд.
// Запуск (токены не сохраняются в файлы):
//   TELEGRAM_TOKEN=... WEBHOOK_SECRET=... node scripts/set-webhook.mjs
// С флагом --menu-only вебхук не трогаем — только кнопка меню и команды (так запускает деплой).
import { ADMIN_ID, FORMER_ADMIN_IDS } from "../src/config.js";
import { founderWebhookToken } from "../src/lib/founder-webhook.js";
const token = process.env.TELEGRAM_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const base = (process.env.PUBLIC_URL || "https://helpmedoctor.ru").replace(/\/$/, "");
// Мини-приложение — с workers.dev: helpmedoctor.ru не открывается с VPN (см. APP_URL в wrangler.jsonc)
const appBase = (process.env.APP_URL || "https://helpmedoctor.oxion-ezhkov.workers.dev").replace(/\/$/, "");
if (!token) {
  console.error("Укажите TELEGRAM_TOKEN");
  process.exit(1);
}
async function call(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json();
  console.log(method, d.ok ? "✅" : `❌ ${d.description}`);
}
if (process.argv.includes("--founder-auth")) {
  const auth = await founderWebhookToken(process.env.SESSION_SECRET);
  if (!auth) throw new Error("SESSION_SECRET отсутствует");
  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { method: "POST" })
    .then((response) => response.json());
  if (!info.ok) throw new Error("Не удалось проверить действующий вебхук Telegram");
  const existing = info.result.url ? new URL(info.result.url) : null;
  if (existing && (existing.protocol !== "https:" || ![new URL(base).hostname, new URL(appBase).hostname].includes(existing.hostname) ||
      !["/", "/tg/webhook"].includes(existing.pathname))) throw new Error("Вебхук Telegram настроен на другой сервис");
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: existing?.href || `${base}/tg/webhook`,
      allowed_updates: info.result.allowed_updates || ["message", "callback_query"],
      ...(info.result.max_connections ? { max_connections: info.result.max_connections } : {}),
      drop_pending_updates: false,
      secret_token: auth,
    }),
  }).then((result) => result.json());
  if (!response.ok) throw new Error("Telegram не подтвердил настройку подписанного вебхука");
  console.log("Telegram подтвердил настройку подписанного вебхука.");
  process.exit(0);
}
const menuOnly = process.argv.includes("--menu-only");
if (!menuOnly) await call("setWebhook", {
  url: `${base}/tg/webhook`,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
  ...(secret ? { secret_token: secret } : {}),
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Приложение", web_app: { url: `${appBase}/app` } } });
const userCommands = [
    { command: "new", description: "Принять нового пациента" },
    { command: "patients", description: "Мои пациенты" },
    { command: "app", description: "Открыть приложение" },
    { command: "feedback", description: "Оставить отзыв" },
    { command: "help", description: "Как пользоваться" },
];
await call("setMyCommands", { commands: userCommands });
// Админам — те же команды плюс админские (видны только им)
const admins = (process.env.ADMIN_ID || ADMIN_ID).split(",").map((s) => s.trim()).filter(Boolean);
for (const id of admins) {
  await call("setMyCommands", {
    scope: { type: "chat", chat_id: Number(id) },
    commands: [
      ...userCommands,
      { command: "admin", description: "Админка и сводка" },
      { command: "idea", description: "Записать идею в бэклог" },
      { command: "grant", description: "Выдать подписку: /grant @user 7" },
    ],
  });
}
// Бывшим админам — снова обычное меню (у них оставались /admin, /idea, /grant)
for (const id of FORMER_ADMIN_IDS.filter((x) => !admins.includes(x))) {
  await call("deleteMyCommands", { scope: { type: "chat", chat_id: Number(id) } });
}
