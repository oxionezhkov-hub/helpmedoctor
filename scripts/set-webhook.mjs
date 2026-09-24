// Настройка бота после деплоя: вебхук с секретом, кнопка меню «Открыть приложение», список команд.
// Запуск (токены не сохраняются в файлы):
//   TELEGRAM_TOKEN=... WEBHOOK_SECRET=... node scripts/set-webhook.mjs
const token = process.env.TELEGRAM_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const base = (process.env.PUBLIC_URL || "https://helpmedoctor.oxion-ezhkov.workers.dev").replace(/\/$/, "");
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
await call("setWebhook", {
  url: `${base}/tg/webhook`,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: false,
  ...(secret ? { secret_token: secret } : {}),
});
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Приложение", web_app: { url: `${base}/app` } } });
await call("setMyCommands", {
  commands: [
    { command: "new", description: "Принять нового пациента" },
    { command: "patients", description: "Мои пациенты" },
    { command: "app", description: "Открыть приложение" },
    { command: "feedback", description: "Оставить отзыв" },
    { command: "help", description: "Как пользоваться" },
  ],
});
