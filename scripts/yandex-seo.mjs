// Данные Яндекса для подбора ключей: частотность из Вордстата и запросы, по которым сайт показывается в поиске (Вебмастер).
// Токен — YANDEX_METRIKA_TOKEN (один OAuth-токен с доступами metrika:read, wordstat:api, webmaster:*). Запускается в GitHub Actions
// (workflow «Ключи из Яндекса»), результат — в логе и сводке запуска.
// Запуск: YANDEX_METRIKA_TOKEN=… node scripts/yandex-seo.mjs wordstat "ситуационные задачи; история болезни по терапии"
//         YANDEX_METRIKA_TOKEN=… node scripts/yandex-seo.mjs webmaster
import { appendFileSync } from "node:fs";

const [mode = "wordstat", arg = ""] = process.argv.slice(2);
const TOKEN = process.env.YANDEX_METRIKA_TOKEN;
if (!TOKEN) throw new Error("нет YANDEX_METRIKA_TOKEN — добавьте секрет репозитория");
// Вордстат принимает «Bearer», Вебмастер — только «OAuth»
const bearer = { Authorization: `Bearer ${TOKEN}` };
const oauth = { Authorization: `OAuth ${TOKEN}` };
const SITE = process.env.SITE || "helpmedoctor.ru";
let out = "";
const say = (s = "") => { out += `${s}\n`; };

async function wordstat(phrase) {
  try {
    return await wordstatOnce(phrase);
  } catch (e) {
    say(`\n## ${phrase}\nСбой запроса: ${e.cause?.code || ""} ${String(e.message || e).slice(0, 200)}`);
  }
}

async function wordstatOnce(phrase) {
  // Топ запросов с фразой за 30 дней по России (регион 225) и похожие запросы
  const r = await fetch("https://api.wordstat.yandex.net/v1/topRequests", {
    method: "POST", headers: { ...bearer, "Content-Type": "application/json" },
    body: JSON.stringify({ phrase, numPhrases: 50, regions: [225], devices: ["all"] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return say(`\n## ${phrase}\nОшибка ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  say(`\n## ${phrase} — ${j.totalCount ?? "?"} показов в месяц`);
  for (const x of j.topRequests || []) say(`- ${x.phrase} — ${x.count}`);
  if (j.associations?.length) {
    say("Похожие запросы:");
    for (const x of j.associations.slice(0, 20)) say(`- ${x.phrase} — ${x.count}`);
  }
}

async function webmaster() {
  const api = (p) => fetch(`https://api.webmaster.yandex.net/v4${p}`, { headers: oauth }).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }));
  const me = await api("/user");
  if (!me.ok) return say(`Вебмастер: ошибка ${me.status} ${JSON.stringify(me.j).slice(0, 300)} — проверьте доступ токена к Вебмастеру`);
  const uid = me.j.user_id;
  const hosts = await api(`/user/${uid}/hosts`);
  const host = (hosts.j.hosts || []).find((h) => String(h.ascii_host_url || "").includes(SITE));
  if (!host) return say(`Вебмастер: сайт ${SITE} не найден среди ${(hosts.j.hosts || []).map((h) => h.ascii_host_url).join(", ") || "—"}`);
  const id = encodeURIComponent(host.host_id);
  const q = await api(`/user/${uid}/hosts/${id}/search-queries/popular?order_by=TOTAL_SHOWS&query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&limit=500`);
  if (!q.ok) return say(`Вебмастер, поисковые запросы: ошибка ${q.status} ${JSON.stringify(q.j).slice(0, 300)} — возможно, нужен доступ «Получение информации о сайтах» (webmaster:hostinfo)`);
  say(`# Запросы, по которым ${SITE} показывается в Яндексе (${q.j.date_from || ""} — ${q.j.date_to || ""}): ${q.j.queries?.length || 0}`);
  say("показы · клики · средняя позиция · запрос");
  for (const x of q.j.queries || []) {
    const ind = x.indicators || {};
    say(`- ${ind.TOTAL_SHOWS ?? 0} · ${ind.TOTAL_CLICKS ?? 0} · ${ind.AVG_SHOW_POSITION != null ? Number(ind.AVG_SHOW_POSITION).toFixed(1) : "—"} · ${x.query_text}`);
  }
}

// Проверка токена: Метрика (metrika:read) и какие доступы у токена
async function check() {
  const m = await fetch("https://api-metrika.yandex.net/management/v1/counters?per_page=5", { headers: oauth });
  const mj = await m.json().catch(() => ({}));
  say(`Метрика: ${m.status} ${m.ok ? `счётчики: ${(mj.counters || []).map((c) => `${c.id} ${c.site}`).join(", ")}` : JSON.stringify(mj).slice(0, 200)}`);
  const i = await fetch("https://login.yandex.ru/info?format=json", { headers: oauth });
  say(`Яндекс ID: ${i.status} ${i.ok ? "токен действителен" : (await i.text()).slice(0, 200)}`);
}

if (mode === "check") await check();
else if (mode === "webmaster") await webmaster();
else for (const p of arg.split(/[;\n]/).map((s) => s.trim()).filter(Boolean)) await wordstat(p);
console.log(out);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, out);
