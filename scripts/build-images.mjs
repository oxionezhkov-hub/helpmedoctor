// Картинки сайта: превью для соцсетей (og.png 1200×630), иконка iOS (apple-touch-icon.png 180×180)
// и обложки статей блога (public/blog/<slug>/cover.jpg — сцена, og.jpg — сцена с заголовком для соцсетей).
// Запуск: node scripts/build-images.mjs  (нужен Playwright с Chromium; результат коммитится в public/)
// Только обложки выбранных статей: node scripts/build-images.mjs <slug> [<slug> …]
import { chromium } from "playwright";
import { ARTICLES } from "./site/articles.mjs";
import { faceSvg } from "../src/lib/face.js";

const HEART = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/><path d="M2.5 12h5l2-3.5 3 7 2-3.5h7"/></svg>`;
const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;

const og = `<html><body style="margin:0;width:1200px;height:630px;font-family:${FONT};background:linear-gradient(135deg,#0b4f4a 0%,#0f766e 45%,#14b8a6 100%);color:#fff;position:relative;overflow:hidden">
<div style="position:absolute;right:-120px;top:-140px;width:620px;height:620px;border-radius:50%;background:rgba(255,255,255,.08)"></div>
<div style="position:absolute;right:120px;bottom:-220px;width:480px;height:480px;border-radius:50%;background:rgba(255,255,255,.06)"></div>
<div style="position:absolute;left:80px;top:72px;display:flex;align-items:center;gap:18px">
  <div style="width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,.18);display:grid;place-items:center"><div style="width:46px;height:46px">${HEART}</div></div>
  <div style="font-size:34px;font-weight:800;letter-spacing:-.01em">Help me, Doctor</div>
</div>
<div style="position:absolute;left:80px;top:210px;width:760px">
  <div style="font-size:66px;font-weight:800;line-height:1.05;letter-spacing:-.03em">Тренажёр врача<br>с ИИ-пациентами</div>
  <div style="margin-top:26px;font-size:28px;line-height:1.35;opacity:.92">Расспрос, осмотр, анализы, диагноз —<br>и разбор приёма от эксперта</div>
</div>
<div style="position:absolute;left:80px;bottom:64px;display:flex;gap:14px;font-size:22px;font-weight:700">
  <span style="background:#fff;color:#0f766e;padding:12px 22px;border-radius:14px">helpmedoctor.ru</span>
  <span style="background:rgba(255,255,255,.16);padding:12px 22px;border-radius:14px">Telegram · браузер</span>
</div>
<div style="position:absolute;right:80px;top:170px;width:300px;display:flex;flex-direction:column;gap:12px;font-size:19px;line-height:1.35">
  <div style="background:#fff;color:#0f1f1d;padding:14px 16px;border-radius:18px 18px 18px 6px">Доктор, жжёт под ложечкой третью неделю…</div>
  <div style="background:#0b4f4a;padding:14px 16px;border-radius:18px 18px 6px 18px;align-self:flex-end">Натощак или после еды?</div>
  <div style="background:rgba(255,255,255,.95);color:#0f1f1d;padding:14px 16px;border-radius:16px"><b style="color:#0f766e">★ 4,5</b> · разбор эксперта</div>
</div>
</body></html>`;

const icon = `<html><body style="margin:0;width:180px;height:180px;background:#0f766e;display:grid;place-items:center"><div style="width:112px;height:112px">${HEART}</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
const only = process.argv.slice(2);
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
const STETH = `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3H5v6a5 5 0 0 0 10 0V3h-1"/><path d="M10 14v1a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/></svg>`;
function scene(c, withTitle, title) {
  const h = c.hue;
  const size = withTitle ? 210 : 250;
  const person = (p, doctor) => `<div style="position:relative;width:${size}px;height:${size}px">
    <div style="width:100%;height:100%;border-radius:${size / 4}px;overflow:hidden;background:hsl(${doctor ? h : (h + 40) % 360} 60% ${doctor ? 88 : 92}%);box-shadow:0 18px 40px hsl(${h} 40% 30% / .18)"><div style="${doctor ? "transform:scaleX(-1)" : ""}">${faceSvg({ ...p, clean: true })}</div></div>
    ${doctor ? `<div style="position:absolute;right:-12px;bottom:-12px;width:62px;height:62px;border-radius:20px;background:#0f766e;display:grid;place-items:center;box-shadow:0 8px 20px rgba(0,0,0,.2)"><div style="width:36px;height:36px">${STETH}</div></div>` : ""}</div>`;
  const bubble = (t, mine) => `<div style="width:max-content;max-width:${withTitle ? 250 : 320}px;padding:14px 18px;border-radius:22px;${mine ? "border-bottom-right-radius:8px;background:#0f766e;color:#fff" : "border-bottom-left-radius:8px;background:#fff;color:#0f1f1d"};font-size:${withTitle ? 21 : 25}px;line-height:1.3;box-shadow:0 10px 30px hsl(${h} 40% 30% / .15)">${esc(t)}</div>`;
  // Без заголовка: пациент слева, врач справа, реплики над ними. С заголовком — сцена справа от текста.
  const L = withTitle ? { pat: [640, 330], doc: [915, 330], b1: [600, 120], b2: [860, 205] } : { pat: [170, 280], doc: [780, 280], b1: [150, 110], b2: [650, 170] };
  return `<html><body style="margin:0;width:1200px;height:630px;font-family:${FONT};background:linear-gradient(135deg,hsl(${h} 70% 96%) 0%,hsl(${h} 60% 88%) 100%);position:relative;overflow:hidden">
<div style="position:absolute;right:-160px;top:-180px;width:560px;height:560px;border-radius:50%;background:hsl(${h} 70% 80% / .35)"></div>
<div style="position:absolute;left:-120px;bottom:-200px;width:460px;height:460px;border-radius:50%;background:hsl(${(h + 40) % 360} 70% 85% / .35)"></div>
${withTitle ? `<div style="position:absolute;left:64px;top:64px;width:500px;color:#0f1f1d">
  <div style="display:inline-block;background:#0f766e;color:#fff;font-weight:700;font-size:20px;padding:8px 16px;border-radius:12px">${esc(c.tag)}</div>
  <div style="margin-top:26px;font-size:${title.length > 26 || title.split(" ").some((w) => w.length > 14) ? 38 : 44}px;font-weight:800;line-height:1.1;letter-spacing:-.02em;hyphens:auto" lang="ru">${esc(title)}</div>
</div>
<div style="position:absolute;left:64px;bottom:56px;font-size:22px;font-weight:700;color:#0f766e">helpmedoctor.ru · блог</div>` : ""}
<div style="position:absolute;left:${L.pat[0]}px;top:${L.pat[1]}px">${person(c.patient, false)}</div>
<div style="position:absolute;left:${L.doc[0]}px;top:${L.doc[1]}px">${person(c.doctor, true)}</div>
<div style="position:absolute;left:${L.b1[0]}px;top:${L.b1[1]}px">${bubble(c.says[0], false)}</div>
<div style="position:absolute;left:${L.b2[0]}px;top:${L.b2[1]}px">${bubble(c.says[1], true)}</div>
</body></html>`;
}

import fs from "node:fs";
await page.setViewportSize({ width: 1200, height: 630 });
for (const a of ARTICLES) {
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
