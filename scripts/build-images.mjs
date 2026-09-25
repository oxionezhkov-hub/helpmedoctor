// Картинки сайта: превью для соцсетей (og.png 1200×630), иконка iOS (apple-touch-icon.png 180×180)
// и обложки статей блога (public/blog/<slug>/cover.jpg — сцена, og.jpg — сцена с заголовком для соцсетей).
// Запуск: node scripts/build-images.mjs  (нужен Playwright с Chromium; результат коммитится в public/)
// Только обложки выбранных статей: node scripts/build-images.mjs <slug> [<slug> …]
import { chromium } from "playwright";
import { ARTICLES } from "./site/articles.mjs";
import { faceSvg } from "../src/lib/face.js";

const HEART = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/><path d="M2.5 12h5l2-3.5 3 7 2-3.5h7"/></svg>`;
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;

// Превью для соцсетей — в стиле сайта: бумага, Literata, карта приёма со штампом разбора
const fontData = (f) => `data:font/woff2;base64,${fs.readFileSync(`public/fonts/${f}`).toString("base64")}`;
const og = `<html><head><style>
@font-face{font-family:L;font-weight:700 800;src:url(${fontData("literata-700.woff2")}) format("woff2")}
@font-face{font-family:L;font-style:italic;font-weight:400 700;src:url(${fontData("literata-italic-500.woff2")}) format("woff2")}
body{margin:0;width:1200px;height:630px;background:#f6f4ee;color:#191c1b;font-family:${FONT};position:relative;overflow:hidden}
.mono{font-family:'DejaVu Sans Mono',Menlo,monospace;text-transform:uppercase;letter-spacing:.06em;font-size:15px;color:#5f6662}
dl{margin:0;display:grid;grid-template-columns:120px 1fr;font-size:19px;line-height:40px}
dt{font-family:'DejaVu Sans Mono',monospace;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#5f6662}
dd{margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.i{font-family:L;font-style:italic;color:#1e3a8a}
</style></head><body>
<div style="position:absolute;left:72px;right:72px;top:54px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #191c1b;padding-bottom:18px">
  <div style="display:flex;align-items:center;gap:14px;font:700 30px L"><svg width="40" height="40" viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="26" height="26" rx="4" stroke="#191c1b" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>Help me, Doctor</div>
  <span class="mono">helpmedoctor.ru</span>
</div>
<div style="position:absolute;left:72px;top:170px;width:520px">
  <div class="mono" style="color:#b3391f;margin-bottom:18px">Тренажёр клинического мышления</div>
  <div style="font:700 58px/1.04 L;letter-spacing:-.015em">Тренажёр врача с&nbsp;виртуальными пациентами</div>
  <div style="margin-top:24px;font-size:24px;line-height:1.4;color:#353a38">Расспрос, анализы, диагноз — и разбор приёма сразу после. Первый пациент в день бесплатно.</div>
</div>
<div style="position:absolute;right:72px;top:168px;width:440px;background:#fffdf8;border:1.5px solid #c7c0ae;border-radius:4px;padding:22px 24px 16px;transform:rotate(1deg);box-shadow:0 20px 40px -24px rgba(0,0,0,.35);background-image:repeating-linear-gradient(transparent 0 39px,#e6e1d4 39px 40px);background-position:0 72px">
  <div style="display:flex;justify-content:space-between;border-bottom:2px solid #191c1b;padding-bottom:10px;margin-bottom:10px" class="mono"><span style="font-size:12px">Карта приёма № 0147</span><span style="font-size:12px">гастро</span></div>
  <dl>
    <dt>Жалобы</dt><dd class="i">«Жжёт под ложечкой»</dd>
    <dt>Вопрос</dt><dd class="i">натощак или после еды?</dd>
    <dt>Лекарства</dt><dd class="i">«ибупрофен, месяц»</dd>
    <dt>ФГДС</dt><dd>язва луковицы ДПК</dd>
    <dt>Диагноз</dt><dd class="i">язва ДПК на фоне НПВП</dd>
  </dl>
  <div style="position:absolute;right:18px;bottom:18px;transform:rotate(-9deg);border:3px solid #b3391f;color:#b3391f;border-radius:8px;padding:6px 14px;text-align:center;font-family:'DejaVu Sans Mono',monospace;font-size:13px;letter-spacing:.08em;text-transform:uppercase;background:rgba(255,253,248,.85)">Разбор<div style="font:700 34px/1.05 L;letter-spacing:0">4,5</div>из 5</div>
</div>
</body></html>`;

const icon = `<html><body style="margin:0;width:180px;height:180px;background:#0f766e;display:grid;place-items:center"><div style="width:112px;height:112px">${HEART}</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
// --og — только превью и иконка, без обложек статей
const ogOnly = process.argv[2] === "--og";
const only = ogOnly ? [] : process.argv.slice(2);
if (!only.length) {
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(og);
  await page.screenshot({ path: "public/og.png" });
  await page.setViewportSize({ width: 180, height: 180 });
  await page.setContent(icon);
  await page.screenshot({ path: "public/apple-touch-icon.png" });
}

// ---------- Обложки статей: врач и пациент (Open Peeps, CC0) с репликами ----------
// Лица Open Peeps смотрят вправо, поэтому врача (справа) отражаем — собеседники смотрят друг на друга.
const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// const STETH = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H5v6a5 5 0 0 0 10 0V3h-1"/><path d="M10 14v1a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg>`;
function scene(c, withTitle, title) {
  // Стиль сайта: бумага с линовкой, рамки чернилами, реплики — как записи в карте приёма
  const size = withTitle ? 200 : 240;
  const person = (p, doctor) => `<div style="position:relative;width:${size}px;height:${size}px">
    <div style="width:100%;height:100%;border-radius:4px;overflow:hidden;background:${doctor ? "#dceae5" : "#eeebe2"};border:2px solid #191c1b"><div style="${doctor ? "transform:scaleX(-1)" : ""}">${faceSvg({ ...p, clean: true })}</div></div>
    <div style="position:absolute;left:0;bottom:-34px;font-family:'DejaVu Sans Mono',monospace;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:#5f6662">${doctor ? "Врач" : "Пациент"}</div></div>`;
  const labels = c.labels || ["Пациент", "Врач"];
  const bubble = (t, mine) => `<div style="width:max-content;max-width:${withTitle ? 250 : 330}px;padding:12px 16px 13px;border-radius:4px;background:#fffdf8;border:1.5px solid ${mine ? "#0d5c55" : "#c7c0ae"};box-shadow:0 12px 26px -18px rgba(0,0,0,.4)">
    <div style="font-family:'DejaVu Sans Mono',monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${mine ? "#0d5c55" : "#b3391f"};margin-bottom:4px">${mine ? labels[1] : labels[0]}</div>
    <div style="font-family:L;font-style:italic;font-size:${withTitle ? 22 : 26}px;line-height:1.25;color:${mine ? "#1e3a8a" : "#191c1b"}">${esc(t)}</div></div>`;
  const L = withTitle ? { pat: [640, 330], doc: [915, 330], b1: [600, 118], b2: [860, 205] } : { pat: [170, 270], doc: [790, 270], b1: [150, 90], b2: [650, 160] };
  return `<html><head><style>
@font-face{font-family:L;font-weight:700 800;src:url(${fontData("literata-700.woff2")}) format("woff2")}
@font-face{font-family:L;font-style:italic;font-weight:400 700;src:url(${fontData("literata-italic-500.woff2")}) format("woff2")}
</style></head><body style="margin:0;width:1200px;height:630px;font-family:${FONT};background:#f6f4ee;background-image:repeating-linear-gradient(transparent 0 41px,#e4dfd2 41px 42px);position:relative;overflow:hidden">
<div style="position:absolute;left:${withTitle ? 560 : 96}px;top:0;bottom:0;width:1.5px;background:rgba(179,57,31,.35)"></div>
${withTitle ? `<div style="position:absolute;left:0;top:0;bottom:0;width:560px;background:#f6f4ee"></div>
<div style="position:absolute;left:64px;top:60px;width:450px;color:#191c1b">
  <div style="font-family:'DejaVu Sans Mono',monospace;font-size:16px;letter-spacing:.08em;text-transform:uppercase;color:#b3391f">${esc(c.tag)}</div>
  <div style="margin-top:22px;font:700 ${title.length > 26 || title.split(" ").some((w) => w.length > 14) ? 42 : 50}px/1.08 L;letter-spacing:-.015em;hyphens:auto" lang="ru">${esc(title)}</div>
</div>
<div style="position:absolute;left:64px;bottom:52px;display:flex;align-items:center;gap:12px;font:700 22px L;color:#191c1b"><svg width="30" height="30" viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="26" height="26" rx="4" stroke="#191c1b" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>Help me, Doctor · блог</div>` : ""}
<div style="position:absolute;left:${L.pat[0]}px;top:${L.pat[1]}px">${person(c.patient, false)}</div>
<div style="position:absolute;left:${L.doc[0]}px;top:${L.doc[1]}px">${person(c.doctor, true)}</div>
<div style="position:absolute;left:${L.b1[0]}px;top:${L.b1[1]}px">${bubble(c.says[0], false)}</div>
<div style="position:absolute;left:${L.b2[0]}px;top:${L.b2[1]}px">${bubble(c.says[1], true)}</div>
</body></html>`;
}

import fs from "node:fs";
await page.setViewportSize({ width: 1200, height: 630 });
for (const a of ogOnly ? [] : ARTICLES) {
  if (!a.cover || (only.length && !only.includes(a.slug))) continue;
  fs.mkdirSync(`public/blog/${a.slug}`, { recursive: true });
  await page.setContent(scene(a.cover, false));
  await page.screenshot({ path: `public/blog/${a.slug}/cover.jpg`, type: "jpeg", quality: 84 });
  await page.setContent(scene(a.cover, true, a.h1.split(":")[0]));
  await page.screenshot({ path: `public/blog/${a.slug}/og.jpg`, type: "jpeg", quality: 84 });
  console.log(`✓ public/blog/${a.slug}/cover.jpg, og.jpg`);
}

await browser.close();
if (!only.length) console.log("✓ public/og.png, public/apple-touch-icon.png");
