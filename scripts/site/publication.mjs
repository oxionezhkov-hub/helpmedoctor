import fs from "node:fs";
import path from "node:path";
import sanitizeHtml from "sanitize-html";
import { withFigures } from "./figures.mjs";

export const INITIAL_QUEUE = [
  "auskultaciya-serdca-shumy",
  "uchebnaya-istoriya-bolezni-pediatriya",
  "ferritin-obmen-zheleza-rasshifrovka",
  "testy-akkreditacii-podgotovka",
  "akkreditaciya-pediatriya",
  "uchebnaya-istoriya-bolezni-nevrologiya",
];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IMAGES = ["cover.jpg", "og.jpg"];
const STATE_FILE = "released.json";
export function articleImageDir(slug) {
  return path.join(INITIAL_QUEUE.includes(slug) ? "content/blog-publication" : "public/blog", slug);
}
export const moscowDay = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

function requireValid(condition, message) {
  if (!condition) throw new Error(message);
}

function readFile(dir, filename, maxBytes) {
  const file = path.join(dir, filename);
  const stat = fs.lstatSync(file);
  requireValid(stat.isFile() && stat.size <= maxBytes, `Недопустимый файл статьи: ${filename}`);
  return fs.readFileSync(file);
}

export function readState(dir) {
  const file = dir && path.join(dir, STATE_FILE);
  if (!file || !fs.existsSync(file)) return { articles: [], published: 0, lastPublishedDay: "" };
  const state = JSON.parse(readFile(dir, STATE_FILE, 1_000_000));
  requireValid(Array.isArray(state.articles) && Number.isInteger(state.published) && state.published >= 0 &&
    state.published <= state.articles.length && state.articles.length - state.published <= 2 &&
    (state.lastPublishedDay === "" || DAY.test(state.lastPublishedDay)), "Повреждено состояние публикаций");
  const seen = new Set();
  for (const item of state.articles) {
    requireValid(SLUG.test(item.slug) && DAY.test(item.date) && !seen.has(item.slug), "Некорректная запись выпуска");
    seen.add(item.slug);
  }
  return state;
}

const validString = (value, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const safeLink = (url) => typeof url === "string" && !/[\s\\]/.test(url) &&
  (/^\/(?!\/)/.test(url) || /^https:\/\/[^/?#]+/i.test(url));

export function readArticle(dir, slug) {
  requireValid(SLUG.test(slug) && slug.length <= 85, "Некорректный адрес статьи");
  const a = JSON.parse(readFile(dir, "article.json", 125_000));
  requireValid(a.slug === slug && validString(a.title, 60) && validString(a.h1, 90) &&
    validString(a.description, 160) && a.description.length >= 120 && /^(ЗАД|СИМ|АНЛ|АКК|ОРД|УЧБ|НЕО)$/.test(a.cluster) &&
    Number.isInteger(a.minutes) && a.minutes >= 3 && a.minutes <= 30, `Некорректные метаданные: ${slug}`);
  const strings = (items, min, max) => Array.isArray(items) && items.length >= min && items.length <= max &&
    items.every((item) => validString(item));
  const pairs = (items, min, max, check) => Array.isArray(items) && items.length >= min && items.length <= max &&
    items.every((pair) => Array.isArray(pair) && pair.length === 2 && validString(pair[0]) && check(pair[1]));
  requireValid(strings(a.tags, 2, 5) && strings(a.summary, 3, 5) && strings(a.cover?.says, 2, 2) &&
    pairs(a.faq, 3, 5, (v) => validString(v, 1000) && v.length >= 60) && a.faq.every(([q]) => q.endsWith("?")) &&
    pairs(a.sources, 2, 6, (v) => validString(v, 500) && /^https:\/\//i.test(v) && safeLink(v)), `Недопустимые поля: ${slug}`);
  requireValid(validString(a.body, 80_000), `Статья без текста: ${slug}`);
  // Именованные схемы берутся только из генератора на main. В статье разрешены обычные текстовые элементы.
  const figures = [];
  const marked = a.body.replace(/<!--fig:([\w-]+)-->/g, (_, name) => {
    figures.push(name);
    return `<span>HMD-FIGURE-${figures.length}-HMD</span>`;
  });
  requireValid(figures.length <= 2 && !a.body.includes("HMD-FIGURE-"), `Недопустимые схемы: ${slug}`);
  const body = sanitizeHtml(marked, {
    allowedTags: ["p", "h2", "h3", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "strong", "em", "a", "blockquote", "cite", "span", "code"],
    allowedAttributes: { a: ["href"], p: ["class"] },
    allowedClasses: { p: ["lead", "note"] },
    allowedSchemes: ["https"],
    allowProtocolRelative: false,
    exclusiveFilter: (frame) => frame.tag === "a" && !safeLink(frame.attribs.href) ? "excludeTag" : false,
  }).replace(/<span>HMD-FIGURE-(\d+)-HMD<\/span>/g, (_, n) => `<!--fig:${figures[Number(n) - 1]}-->`);
  const words = body.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").match(/[а-яёa-z0-9-]+/gi) || [];
  requireValid(body.trim().startsWith('<p class="lead">') && (body.match(/<h2>/g)?.length || 0) >= 4 && words.length >= 1400,
    `Не хватает лида, разделов или объёма: ${slug}`);
  withFigures(body);
  for (const image of IMAGES) {
    const bytes = readFile(dir, image, 500_000);
    requireValid(bytes.length > 1024 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9,
      `Некорректное изображение: ${slug}/${image}`);
  }
  const { title, h1, description, cluster, minutes, tags, summary, faq, sources } = a;
  return { slug, title, h1, description, cluster, minutes, tags, summary, faq, sources, cover: { says: a.cover.says }, body };
}

export function publishedArticles(articles, dir) {
  const state = readState(dir);
  const dates = new Map(state.articles.map(({ slug, date }) => [slug, date]));
  const seeds = new Set(INITIAL_QUEUE);
  const known = new Set(articles.map(({ slug }) => slug));
  const visible = articles.filter(({ slug }) => !seeds.has(slug) || dates.has(slug))
    .map((a) => seeds.has(a.slug) ? { ...a, date: dates.get(a.slug), assetDir: articleImageDir(a.slug) } : a);
  for (const { slug, date } of state.articles) {
    if (seeds.has(slug)) {
      requireValid(known.has(slug), `Нет статьи из очереди: ${slug}`);
      continue;
    }
    requireValid(!known.has(slug), `Занятый адрес статьи: ${slug}`);
    const assetDir = path.join(dir, "articles", slug);
    visible.push({ ...readArticle(assetDir, slug), date, assetDir });
  }
  return visible.sort((a, b) => b.date.localeCompare(a.date));
}

export function copyArticleImages(article, out) {
  if (!article.assetDir) return;
  const target = path.join(out, "blog", article.slug);
  for (const image of IMAGES) fs.copyFileSync(path.join(article.assetDir, image), path.join(target, image));
}

export function prepareRelease(stateDir, queueDir, articles, day) {
  const state = readState(stateDir);
  if (state.published < state.articles.length) return true;
  if (state.lastPublishedDay === day) return false;
  const released = new Set(state.articles.map(({ slug }) => slug));
  const known = new Set(articles.map(({ slug }) => slug));
  const pending = INITIAL_QUEUE.filter((slug) => !released.has(slug)).slice(0, 2);
  const snapshots = [];
  if (pending.length < 2 && fs.existsSync(queueDir)) {
    for (const entry of fs.readdirSync(queueDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const slug = entry.name.slice(11);
      if (!entry.isDirectory() || !DAY.test(entry.name.slice(0, 10)) || entry.name[10] !== "_" ||
          !SLUG.test(slug) || released.has(slug) || known.has(slug) || pending.includes(slug)) continue;
      const source = path.join(queueDir, entry.name);
      snapshots.push({ slug, source, article: readArticle(source, slug) });
      pending.push(slug);
      if (pending.length === 2) break;
    }
  }
  if (!pending.length) return false;
  for (const { slug, source, article } of snapshots) {
    const dest = path.join(stateDir, "articles", slug);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "article.json"), JSON.stringify(article));
    for (const image of IMAGES) fs.copyFileSync(path.join(source, image), path.join(dest, image));
  }
  state.articles.push(...pending.map((slug) => ({ slug, date: day })));
  writeState(stateDir, state);
  return true;
}

export function markPublished(dir, day) {
  const state = readState(dir);
  state.published = state.articles.length;
  state.lastPublishedDay = day;
  writeState(dir, state);
}

function writeState(dir, state) {
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}
