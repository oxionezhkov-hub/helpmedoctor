// Выгрузка задач и идей из админки в лог GitHub Actions — чтобы Claude мог их прочитать и согласовать с командой.
// Доступ — отдельный ключ ADMIN_EXPORT_KEY (секрет репозитория и воркера), только чтение задач (/api/admin/export).
// Запуск: ADMIN_EXPORT_KEY=… node scripts/admin-export.mjs [ideas|open|tasks|task|replies] [id | дней для replies]
import { appendFileSync } from "node:fs";

const [what = "ideas", id = ""] = process.argv.slice(2);
const BASE = (process.env.BASE || "https://helpmedoctor.ru").replace(/\/$/, "");
const KEY = process.env.ADMIN_EXPORT_KEY;
if (!KEY) throw new Error("нет ADMIN_EXPORT_KEY — добавьте секрет в репозиторий и перезапустите деплой");

async function get(query = "") {
  const r = await fetch(`${BASE}/api/admin/export${query}`, { headers: { "X-Export-Key": KEY } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`export: HTTP ${r.status} ${j.error || ""}`);
  return j;
}

const WHO = { "1326867567": "Олег", "1062804986": "Саша" };
const STATUS = { idea: "Идеи", backlog: "Бэклог", doing: "В работе", review: "На проверке", done: "Готово", rejected: "Отклонено" };
const date = (ts) => (ts ? new Date(ts).toLocaleDateString("ru", { timeZone: "Europe/Moscow" }) : "");
const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

const LEVELS = { student: "студент", ordinator: "ординатор", resident: "ординатор", doctor: "врач" };
let out = "";
if (what === "replies") {
  // Ответы пользователей на рассылки — источник настоящих цитат для блога и канала (с согласия, см. скилл blog-article)
  const { rows } = await get(`?what=replies&days=${encodeURIComponent(id || "30")}`);
  out += `# Ответы на рассылки за ${id || 30} дн.: ${rows.length}\n`;
  for (const r of rows) {
    out += `\n- ${date(r.ts)} · ${r.name || "без имени"}${r.level ? `, ${LEVELS[r.level] || r.level}` : ""}${r.profession ? `, ${r.profession}` : ""}\n  Вопрос: ${clip(r.question, 200)}\n  Ответ: ${clip(r.text, 1500)}\n`;
  }
} else if (what === "task") {
  const t = await get(`?id=${encodeURIComponent(id)}`);
  if (!t) throw new Error(`задача ${id} не найдена`);
  out += `# #${t.id} ${t.title}\n${STATUS[t.status] || t.status} · ${t.type} · ${t.priority || ""} · ${WHO[t.assignee] || t.assignee || "без исполнителя"} · создана ${date(t.created_at)}\n\n${t.descr || ""}\n`;
  if (t.checklist?.length) out += `\nЧек-лист:\n${t.checklist.map((c) => `- [${c.done ? "x" : " "}] ${c.text}`).join("\n")}\n`;
  if (t.comments_list?.length) out += `\nКомментарии:\n${t.comments_list.map((c) => `- ${date(c.ts)} ${WHO[c.author] || c.author}: ${c.text}`).join("\n")}\n`;
} else {
  const { rows } = await get();
  const pick = what === "ideas" ? rows.filter((t) => t.status === "idea" || t.type === "idea")
    : what === "open" ? rows.filter((t) => !["done", "rejected"].includes(t.status)) : rows;
  out += `# ${what === "ideas" ? "Идеи" : what === "open" ? "Открытые задачи" : "Все задачи"}: ${pick.length}\n`;
  for (const st of Object.keys(STATUS)) {
    const list = pick.filter((t) => t.status === st);
    if (!list.length) continue;
    out += `\n## ${STATUS[st]} (${list.length})\n`;
    for (const t of list) {
      out += `- #${t.id} [${t.type}${t.priority ? `, ${t.priority}` : ""}] ${t.title}${t.assignee ? ` — ${WHO[t.assignee] || t.assignee}` : ""} · ${date(t.created_at)}${t.comments ? ` · комментариев: ${t.comments}` : ""}\n`;
      if (t.descr) out += `  ${clip(t.descr, 600)}\n`;
    }
  }
}
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
