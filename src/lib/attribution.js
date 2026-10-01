// Откуда пришёл пользователь: канал по сайту-источнику (document.referrer) и UTM-меткам первого визита на сайт.
// Поисковые фразы в referrer не передаются (Яндекс и Google их скрывают) — их видно только в Метрике в целом.
import { clampStr } from "./util.js";

const SEARCH = [
  [/(^|\.)(yandex\.[a-z.]+|ya\.ru)$/, "Поиск: Яндекс"],
  [/(^|\.)google\.[a-z.]+$/, "Поиск: Google"],
  [/(^|\.)bing\.com$/, "Поиск: Bing"],
  [/(^|\.)(go\.mail\.ru|search\.mail\.ru)$/, "Поиск: Mail.ru"],
  [/(^|\.)duckduckgo\.com$/, "Поиск: DuckDuckGo"],
];
const SOCIAL = [
  [/(^|\.)(t\.me|telegram\.org|web\.telegram\.org)$/, "Telegram"],
  [/(^|\.)(vk\.com|vk\.ru|m\.vk\.com)$/, "ВКонтакте"],
  [/(^|\.)(dzen\.ru|zen\.yandex\.ru)$/, "Дзен"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(ok\.ru)$/, "Одноклассники"],
  [/(^|\.)(pikabu\.ru)$/, "Пикабу"],
];

/** Канал: реклама (UTM / yclid) → поисковик → соцсеть → другой сайт → прямой заход */
export function channelOf(host = "", utm = "") {
  const q = new URLSearchParams(utm);
  if (q.get("yclid")) return "Реклама: Яндекс Директ";
  if (q.get("source")) return `UTM: ${clampStr(q.get("source"), 40)}${q.get("medium") ? ` / ${clampStr(q.get("medium"), 30)}` : ""}`;
  const h = String(host || "").toLowerCase();
  if (!h) return "Прямой заход";
  for (const [re, name] of [...SEARCH, ...SOCIAL]) if (re.test(h)) return name;
  return `Сайт: ${h}`;
}

/** Нормализация того, что прислало приложение (из localStorage сайта) */
export function cleanAttribution(a = {}) {
  const path = (s) => clampStr(String(s || "").replace(/[^\w\-/.%~]/g, ""), 160);
  const host = clampStr(String(a.r || "").toLowerCase().replace(/[^a-z0-9.\-]/g, ""), 80);
  const utm = clampStr(String(a.u || ""), 300);
  return {
    host, land: path(a.l), last: path(a.p), utm,
    cid: clampStr(String(a.cid || "").replace(/\D/g, ""), 30),
    at: Number(a.at) > 0 ? Number(a.at) : null,
    channel: channelOf(host, utm),
  };
}
