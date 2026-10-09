// Рассылка партнёрам (scripts/outreach-mail.mjs работает в GitHub Actions — там SMTP и IMAP ящика рассылки).
// Бот её только запускает через GitHub API: по cron — отправку и проверку почты, по ответу админа в Telegram — письмо-ответ.
// Нужен секрет GH_DISPATCH_TOKEN: fine-grained токен GitHub с правом Actions: Read and write на репозиторий; без него — тихо выключено.

/** Метка адресата в карточке «Ответ на рассылку»: #em_<id> */
export const OUTREACH_TAG = /#em_([0-9a-f]{8})\b/;

/** Cron воркера для рассылки: каждый час 09:20–21:20 МСК по будням; первый — отправка, остальные — проверка почты */
export const OUTREACH_CRON = "20 6-18 * * 1-5";

/** Запустить workflow в репозитории (workflow_dispatch). true — GitHub принял запуск */
export async function dispatchWorkflow(env, file, inputs) {
  if (!env.GH_DISPATCH_TOKEN) return false;
  const repo = env.GH_REPO || "oxionezhkov-hub/helpmedoctor";
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "helpmedoctor-bot",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });
  if (r.status !== 204) console.error("dispatchWorkflow", file, r.status, (await r.text()).slice(0, 300));
  return r.status === 204;
}

/** Cron: в 06:20 UTC — отправка писем, в остальные часы — проверка почты (ответы приходят в Telegram) */
export function outreachCron(env, scheduledTime) {
  const mode = new Date(scheduledTime).getUTCHours() === 6 ? "send" : "inbox";
  return dispatchWorkflow(env, "outreach-mail.yml", { mode });
}
