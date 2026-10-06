// Картинки группы ВК «Для будущих врачей»: обложка (1920×768), аватар (1000×1000), карточки к постам (1080×1350).
// Данные — content/vk-group/cards.mjs, результат — content/vk-group/img/*.jpg.
// Запуск: node scripts/vk-cards.mjs [имя…]  (cover, avatar или ключ карточки; без имён — всё). Нужен Playwright, браузер — /opt/pw-browsers.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { GROUP, CARDS } from "../content/vk-group/cards.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "content/vk-group/img");
const FONTS = pathToFileURL(join(ROOT, "content/telegram-channel/fonts/fonts.css")).href;
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/==([\s\S]+?)==/g, "<mark>$1</mark>").replace(/\n/g, "<br>");

const CSS = (w, h) => `
@import url("${FONTS}");
:root { --paper: #f5f2e9; --card: #fffdf8; --ink: #1b1f1d; --ink2: #3a403d; --muted: #6a716d; --green: #0d5c55; --gsoft: #dceae5; --red: #b3391f; --rule: #dcd6c6; --mark: #f5d97c; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { font-family: Manrope, "DejaVu Sans", sans-serif; color: var(--ink); background: var(--paper);
  background-image: linear-gradient(rgba(13,92,85,.07) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(13,92,85,.07) 1.5px, transparent 1.5px);
  background-size: 54px 54px; position: relative; -webkit-font-smoothing: antialiased; }
mark { background: linear-gradient(transparent 52%, var(--mark) 52%, var(--mark) 92%, transparent 92%); color: inherit; padding: 0 .06em; }
h1 { font-family: Literata, serif; font-weight: 800; letter-spacing: -.02em; line-height: 1.02; }
.kick { display: inline-block; background: var(--red); color: #fff; padding: 9px 20px; border-radius: 999px; text-transform: uppercase; font-size: 23px; letter-spacing: .08em; font-weight: 700; }
`;
const page = (w, h, inner) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS(w, h)}</style></head><body>${inner}</body></html>`;
// Кардиограмма — общий мотив группы (как в значке сайта)
const pulse = (stroke, width = 6) => `<svg viewBox="0 0 120 60" fill="none"><path d="M4 34h28l8-18 14 36 9-18h53" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Обложка: на телефоне ВК показывает только середину — всё важное в центральной полосе ~1100×400
function cover() {
  return page(1920, 768, `
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">
      <div style="width:1240px;display:flex;align-items:center;gap:56px;margin-top:-90px">
        <div style="width:220px;height:220px;flex:none;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;box-shadow:12px 12px 0 rgba(13,92,85,.2)"><div style="width:150px">${pulse("#fff", 7)}</div></div>
        <div>
          <h1 style="font-size:104px">Для <mark>будущих</mark> врачей</h1>
          <p style="font-size:34px;font-weight:600;color:var(--ink2);line-height:1.35;margin-top:22px">${md(GROUP.tagline)}</p>
        </div>
      </div>
    </div>
    <div style="position:absolute;left:0;right:0;bottom:140px;display:flex;justify-content:center;gap:16px">
      ${GROUP.rubrics.map((r) => `<span style="background:var(--card);border:3px solid var(--ink);border-radius:999px;padding:12px 26px;font-size:26px;font-weight:700;box-shadow:5px 5px 0 rgba(13,92,85,.18)">${esc(r)}</span>`).join("")}
    </div>`);
}

// Аватар: ВК обрезает в круг — знак по центру, без мелкого текста
function avatar() {
  return page(1000, 1000, `
    <div style="position:absolute;inset:0;background:var(--green);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px">
      <div style="width:520px">${pulse("#fff", 7)}</div>
      <div style="font-family:Manrope,sans-serif;font-weight:700;font-size:46px;color:var(--mark);letter-spacing:.14em;text-transform:uppercase;margin-top:10px">будущим</div>
      <div style="font-family:Literata,serif;font-weight:800;font-size:120px;color:#fff;letter-spacing:-.01em;line-height:1">врачам</div>
    </div>`);
}

// Карточка к посту: рубрика, заголовок, 3–5 пунктов
function card(c) {
  return page(1080, 1350, `
    <div style="position:absolute;inset:0;padding:78px 84px 70px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center"><span class="kick">${esc(c.kicker)}</span>
        <span style="display:flex;align-items:center;gap:12px;font-weight:700;font-size:24px;color:var(--muted)"><span style="width:56px">${pulse("var(--green)", 9)}</span>${esc(GROUP.name)}</span></div>
      <h1 style="font-size:84px;margin-top:56px">${md(c.title)}</h1>
      <div style="margin-top:46px;display:flex;flex-direction:column">${(c.points || []).map(([h, t]) => `
        <div style="padding:24px 0;border-top:2.5px solid var(--rule)"><b style="display:block;font-size:38px;font-weight:800;line-height:1.22">${md(h)}</b>${t ? `<span style="display:block;font-size:31px;font-weight:500;color:var(--ink2);line-height:1.38;margin-top:6px">${md(t)}</span>` : ""}</div>`).join("")}
        <div style="border-top:2.5px solid var(--rule)"></div>
      </div>
      <div style="flex:1"></div>
      ${c.foot ? `<div style="background:var(--gsoft);border-radius:26px;padding:26px 30px;font-size:31px;line-height:1.38;font-weight:600">${md(c.foot)}</div>` : ""}
      <div style="margin-top:28px;font-size:26px;font-weight:700;color:var(--muted)">Сохрани и перешли одногруппнику 📌</div>
    </div>`);
}

const jobs = [["cover", cover(), { width: 1920, height: 768 }], ["avatar", avatar(), { width: 1000, height: 1000 }],
  ...Object.entries(CARDS).map(([k, c]) => [k, card(c), { width: 1080, height: 1350 }])];
const want = new Set(process.argv.slice(2));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }));
const tmp = join(OUT, ".tmp.html");
for (const [name, html, size] of jobs) {
  if (want.size && !want.has(name)) continue;
  const p = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  writeFileSync(tmp, html);
  await p.goto(pathToFileURL(tmp).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(OUT, `${name}.jpg`), type: "jpeg", quality: 90 });
  await p.close();
  console.log(name);
}
await browser.close();
rmSync(tmp, { force: true });
