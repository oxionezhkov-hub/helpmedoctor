// Публикация поста в группу ВК «Для будущих врачей» через ленту RSS (ВК сам забирает https://helpmedoctor.ru/vk/rss.xml).
// Пост — content/vk-group/queue/<дата>-<тема>.json: { title, text, image?, link? }
//   title — заголовок (первая строка поста), text — текст без HTML (ВК не понимает разметку), абзацы через пустую строку;
//   image — картинка из репозитория (jpg/png, до 4 МБ); link — ссылка записи (только для поста с призывом в тренажёр).
// Запуск: SESSION_SECRET=… node scripts/vk-feed.mjs <файл.json> [--dry]
// В GitHub Actions — workflow «Группа ВК» при пуше ветки vk/** (секрет SESSION_SECRET уже есть в репозитории).
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createHmac } from "node:crypto";
import { styleIssues } from "./site/style.mjs";

const [file, flag] = process.argv.slice(2);
const dry = flag === "--dry";
if (!file) throw new Error("укажите файл поста");
const secret = process.env.SESSION_SECRET;
if (!secret && !dry) throw new Error("нет SESSION_SECRET");
const url = process.env.VK_FEED_URL || "https://helpmedoctor.oxion-ezhkov.workers.dev/feed/vk/push";

const post = JSON.parse(readFileSync(file, "utf8"));
const id = basename(file, ".json");
const errors = [];
if (!/^[a-z0-9-]{3,80}$/.test(id)) errors.push("имя файла — латиница, цифры и дефис (например 2026-10-07-anamnez)");
if (!post.title || post.title.length > 120) errors.push("нужен заголовок до 120 символов");
if (!post.text || post.text.length > 6000) errors.push("нужен текст до 6000 символов");
if (/<\/?[a-z][^>]*>/i.test(`${post.title} ${post.text}`)) errors.push("без HTML-тегов: ВК покажет их как есть");
if (/\*\*|__|==/.test(post.text || "")) errors.push("без markdown (**, __, ==): ВК покажет символы как есть");
const ad = /helpmedoctor/i.test(`${post.text} ${post.link || ""}`);
if (post.link && !ad) errors.push("link — только для поста с призывом в тренажёр");
const bad = styleIssues(`${post.title}\n${post.text}`);
if (bad.length) errors.push(`перепишите по-человечески — ${bad.join("; ")}`);
let image = null;
if (post.image) {
  const buf = readFileSync(post.image);
  if (buf.byteLength > 4 * 1024 * 1024) errors.push("картинка больше 4 МБ");
  image = { data: buf.toString("base64"), type: extname(post.image).toLowerCase() === ".png" ? "image/png" : "image/jpeg" };
}
if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);

// Заголовок — первой строкой текста: импорт ВК публикует описание записи
const text = `${post.title}\n\n${post.text.trim()}`;
console.log(`${id}${ad ? " · с призывом в тренажёр" : ""}${image ? " · с картинкой" : ""}\n\n${text}\n`);
if (dry) process.exit(0);

const body = JSON.stringify({ id, title: post.title, text, link: post.link || null, image: image?.data || null, image_type: image?.type || null, ts: Date.now() });
const sig = createHmac("sha256", secret).update(`vkfeed:${body}`).digest("hex");
const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Feed-Sig": sig }, body });
const out = await r.text();
if (!r.ok) throw new Error(`лента ВК ответила ${r.status}: ${out.slice(0, 200)}`);
console.log("в ленте:", out);
