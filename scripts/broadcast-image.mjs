// Картинка для рассылки в боте: «перезапуск и обновления сентября» → public/files/relaunch-0927.jpg
// Запуск: node scripts/broadcast-image.mjs  (Playwright: npm i --no-save playwright; браузер — /opt/pw-browsers)
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { faceSvg } from "../src/lib/face.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FONTS = pathToFileURL(join(ROOT, "content/telegram-channel/fonts/fonts.css")).href;
const OUT = join(ROOT, "public/files/relaunch-0927.jpg");
mkdirSync(dirname(OUT), { recursive: true });

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }

const face = (f) => `data:image/svg+xml;base64,${Buffer.from(faceSvg({ ...f, clean: true })).toString("base64")}`;
const I = {
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z"/>',
  quiz: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>',
};
const FEATS = [
  ["book", "Разбор по КР Минздрава", "схемы лечения с дозами"],
  ["bulb", "Подсказка наставника", "когда зашли в тупик"],
  ["quiz", "Тест по вашим ошибкам", "с объяснениями"],
  ["trophy", "Звания и уровни", "серия и календарь приёмов"],
  ["phone", "Новое приложение", "тёмная тема, уведомления"],
  ["users", "Партнёрская программа", "до 50% с оплат друзей"],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@import url("${FONTS}");
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1200px; height: 1200px; overflow: hidden; }
body { font-family: Manrope, "DejaVu Sans", sans-serif; color: #1b1f1d; background: #f5f2e9; position: relative; -webkit-font-smoothing: antialiased;
  background-image: linear-gradient(rgba(13,92,85,.07) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(13,92,85,.07) 1.5px, transparent 1.5px); background-size: 60px 60px; }
body::before { content: ""; position: absolute; top: 0; bottom: 0; left: 108px; width: 3px; background: rgba(179,57,31,.38); }
.f { position: absolute; inset: 0; padding: 76px 80px 70px 156px; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 26px; }
.kick { background: #b3391f; color: #fff; padding: 10px 22px; border-radius: 999px; text-transform: uppercase; font-size: 22px; letter-spacing: .08em; }
.brand { color: #0d5c55; display: flex; align-items: center; gap: 12px; }
.brand svg { width: 38px; height: 38px; }
h1 { font-family: Literata, serif; font-weight: 800; font-size: 78px; line-height: 1.02; letter-spacing: -.02em; margin-top: 54px; max-width: 690px; }
h1 mark { background: linear-gradient(transparent 58%, #f5d97c 58%); color: inherit; padding: 0 6px; }
.sub { font-size: 30px; color: #3a403d; margin-top: 22px; line-height: 1.3; max-width: 640px; }
.pat { position: absolute; right: 76px; top: 176px; width: 230px; text-align: center; }
.pat img { width: 230px; height: 230px; border-radius: 50%; background: #dceae5; border: 6px solid #fffdf8; box-shadow: 0 14px 30px -14px rgba(0,0,0,.35); }
.bubble { position: absolute; right: 70px; top: 424px; background: #fffdf8; border: 2px solid #1b1f1d; border-radius: 4px 22px 22px 22px; padding: 14px 20px; font-family: Literata, serif; font-style: italic; font-weight: 500; font-size: 27px; white-space: nowrap; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: auto; }
.t { background: #fffdf8; border: 2px solid #dcd6c6; border-radius: 22px; padding: 22px 24px; display: flex; gap: 18px; align-items: center; }
.t i { width: 64px; height: 64px; border-radius: 18px; background: #dceae5; display: grid; place-items: center; flex: none; }
.t svg { width: 34px; height: 34px; fill: none; stroke: #0d5c55; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.t b { display: block; font-size: 27px; line-height: 1.15; }
.t span { display: block; font-size: 21px; color: #6a716d; margin-top: 4px; }
.cta { margin-top: 30px; display: flex; justify-content: space-between; align-items: center; }
.btn { background: #0d5c55; color: #fff; font-weight: 800; font-size: 32px; padding: 22px 36px; border-radius: 20px; }
.free { font-size: 25px; color: #3a403d; font-weight: 600; text-align: right; line-height: 1.3; }
</style></head><body><div class="f">
  <div class="top"><span class="kick">Обновления сентября</span><span class="brand"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0d5c55"/><path d="M27 14h10v13h13v10H37v13H27V37H14V27h13z" fill="#fff"/></svg>Help me, Doctor</span></div>
  <h1>Мы <mark>перезапустили</mark><br>тренажёр</h1>
  <p class="sub">Приём ИИ-пациентов стал умнее: разбор по клиническим рекомендациям, тесты и новое приложение.</p>
  <div class="bubble">Доктор, я вас жду!</div>
  <div class="pat"><img src="${face({ s: "relaunch-0927", g: "f", a: 46, m: "bad" })}"></div>
  <div class="grid">${FEATS.map(([ic, t, s]) => `<div class="t"><i><svg viewBox="0 0 24 24">${I[ic]}</svg></i><div><b>${t}</b><span>${s}</span></div></div>`).join("")}</div>
  <div class="cta"><span class="btn">Принять пациента →</span><span class="free">Один приём в день —<br>бесплатно</span></div>
</div></body></html>`;

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT, type: "jpeg", quality: 90 });
await browser.close();
console.log("✓", OUT);
