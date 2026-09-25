// Картинки сайта: превью для соцсетей (og.png 1200×630) и иконка iOS (apple-touch-icon.png 180×180).
// Запуск: node scripts/build-images.mjs  (нужен Playwright с Chromium; результат коммитится в public/)
import { chromium } from "playwright";

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
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(og);
await page.screenshot({ path: "public/og.png" });
await page.setViewportSize({ width: 180, height: 180 });
await page.setContent(icon);
await page.screenshot({ path: "public/apple-touch-icon.png" });
await browser.close();
console.log("✓ public/og.png, public/apple-touch-icon.png");
