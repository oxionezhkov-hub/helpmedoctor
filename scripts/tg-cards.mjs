// Картинки для Telegram-канала: карусели-шпаргалки, обложка знакомства, задача, промо для закрепа, аватар.
// Данные — content/telegram-channel/decks.mjs, результат — content/telegram-channel/img/*.jpg.
// Запуск: node scripts/tg-cards.mjs [колода…]  (нужен Playwright: npm i --no-save playwright; браузер — /opt/pw-browsers)
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { faceSvg } from "../src/lib/face.js";
import { CASE, DECKS, PROMO, YULIA } from "../content/telegram-channel/decks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "content/telegram-channel");
const OUT = join(DIR, "img");
const HANDLE = "@i_am_doctorrr";
mkdirSync(OUT, { recursive: true });

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// **жирный**, ==маркер==, перевод строки
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/==(.+?)==/g, "<mark>$1</mark>").replace(/\n/g, "<br>");
const face = (f) => `data:image/svg+xml;base64,${Buffer.from(faceSvg({ ...f, clean: true })).toString("base64")}`;

const CSS = `
@import url("${pathToFileURL(join(DIR, "fonts/fonts.css")).href}");
:root { --paper: #f5f2e9; --card: #fffdf8; --ink: #1b1f1d; --ink2: #3a403d; --muted: #6a716d; --green: #0d5c55; --gsoft: #dceae5; --red: #b3391f; --rule: #dcd6c6; --mark: #f5d97c; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1350px; overflow: hidden; }
body { font-family: Manrope, "DejaVu Sans", sans-serif; color: var(--ink); background: var(--paper);
  background-image: linear-gradient(rgba(13,92,85,.07) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(13,92,85,.07) 1.5px, transparent 1.5px);
  background-size: 54px 54px; position: relative; -webkit-font-smoothing: antialiased; }
body::before { content: ""; position: absolute; top: 0; bottom: 0; left: 104px; width: 3px; background: rgba(179,57,31,.38); }
.f { position: absolute; inset: 0; padding: 78px 84px 70px 150px; display: flex; flex-direction: column; }
.top { display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 26px; letter-spacing: .02em; }
.kick { background: var(--red); color: #fff; padding: 9px 20px; border-radius: 999px; text-transform: uppercase; font-size: 23px; letter-spacing: .08em; }
.handle { color: var(--muted); }
h1 { font-family: Literata, serif; font-weight: 800; font-size: 94px; line-height: 1.02; letter-spacing: -.02em; margin-top: 58px; }
h2 { font-family: Literata, serif; font-weight: 700; font-size: 62px; line-height: 1.08; letter-spacing: -.01em; }
mark { background: linear-gradient(transparent 52%, var(--mark) 52%, var(--mark) 92%, transparent 92%); color: inherit; padding: 0 .06em; }
.sub { font-size: 36px; font-weight: 500; color: var(--ink2); margin-top: 30px; line-height: 1.35; max-width: 820px; }
.grow { flex: 1; }
.pt { display: flex; align-items: flex-end; gap: 26px; margin-top: 30px; }
.pt img { width: 380px; height: 380px; border-radius: 50%; background: var(--card); border: 5px solid var(--ink); flex: none; }
.bubble { background: var(--card); border: 3px solid var(--ink); border-radius: 30px 30px 30px 6px; padding: 26px 32px; font-family: Literata, serif; font-style: italic; font-weight: 500; font-size: 42px; line-height: 1.25; margin-bottom: 230px; box-shadow: 8px 8px 0 rgba(13,92,85,.18); }
.author { display: flex; align-items: center; gap: 18px; font-size: 28px; font-weight: 600; color: var(--ink2); }
.author img { width: 84px; height: 84px; border-radius: 50%; background: var(--gsoft); border: 3px solid var(--green); }
.bottom { display: flex; justify-content: space-between; align-items: center; }
.swipe { background: var(--green); color: #fff; font-weight: 800; font-size: 30px; padding: 18px 34px; border-radius: 999px; }
.num { font-family: Literata, serif; font-weight: 800; font-size: 150px; line-height: .9; color: var(--green); opacity: .22; letter-spacing: -.03em; }
.head { margin-top: 44px; display: flex; flex-direction: column; gap: 6px; }
.items { margin-top: 44px; display: flex; flex-direction: column; }
.it { padding: 24px 0; border-top: 2.5px solid var(--rule); }
.it:last-child { border-bottom: 2.5px solid var(--rule); }
.it b { display: block; font-size: 38px; font-weight: 800; line-height: 1.22; }
.it span { display: block; font-size: 32px; font-weight: 500; color: var(--ink2); line-height: 1.38; margin-top: 6px; }
.body { margin-top: 48px; font-size: 42px; line-height: 1.42; font-weight: 500; color: var(--ink2); }
.body b { color: var(--ink); font-weight: 800; }
.tip { margin-top: 38px; background: var(--gsoft); border-radius: 26px; padding: 28px 32px; font-size: 32px; line-height: 1.38; font-weight: 600; display: flex; gap: 18px; }
.tip i { font-style: normal; font-size: 38px; }
.foot { display: flex; align-items: center; gap: 22px; font-size: 26px; font-weight: 700; color: var(--muted); }
.dots { display: flex; gap: 8px; flex: 1; }
.dots i { flex: 1; height: 8px; border-radius: 4px; background: var(--rule); }
.dots i.on { background: var(--green); }
.card { background: var(--card); border: 3px solid var(--ink); border-radius: 34px; padding: 40px 44px; box-shadow: 10px 10px 0 rgba(13,92,85,.18); }
`;

function page(inner) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="f">${inner}</div></body></html>`;
}
const top = (kicker) => `<div class="top"><span class="kick">${esc(kicker)}</span><span class="handle">${HANDLE}</span></div>`;
const foot = (i, n) => `<div class="foot"><div class="dots">${Array.from({ length: n }, (_, k) => `<i class="${k <= i ? "on" : ""}"></i>`).join("")}</div><span>${i + 1} / ${n}</span></div>`;

function cover(d, n) {
  return page(`${top(d.kicker)}
    <h1>${md(d.title)}</h1><p class="sub">${md(d.sub)}</p>
    <div class="grow"></div>
    <div class="pt"><img src="${face(d.patient)}"><div class="bubble">«${esc(d.patient.say)}»</div></div>
    <div class="bottom" style="margin-top:34px"><div class="author"><img src="${face(YULIA)}">Юля · 5 курс лечфака</div><span class="swipe">Листай →</span></div>`);
}

function slide(d, s, i, n) {
  const content = s.items
    ? `<div class="items">${s.items.map(([h, t]) => `<div class="it"><b>${md(h)}</b>${t ? `<span>${md(t)}</span>` : ""}</div>`).join("")}</div>`
    : `<div class="body">${md(s.body)}</div>`;
  const tip = s.tip ? `<div class="tip"><i>💡</i><div>${md(s.tip)}</div></div>` : s.why ? `<div class="tip"><i>⚠️</i><div>${md(s.why)}</div></div>` : "";
  return page(`${top(d.kicker)}
    <div class="head"><div class="num">${esc(s.n)}</div><h2>${md(s.title)}</h2></div>
    ${content}${tip}<div class="grow"></div>${foot(i, n)}`);
}

function outro(d, i, n) {
  return page(`${top(d.kicker)}
    <h1 style="font-size:104px">Сохрани 📌</h1>
    <p class="sub" style="font-size:42px">и перешли одногруппнику, который идёт на практику</p>
    ${d.outro ? `<div class="card" style="margin-top:56px;font-size:42px;line-height:1.35;font-weight:700">${md(d.outro)}</div>` : ""}
    <div class="grow"></div>
    <div class="card" style="display:flex;gap:30px;align-items:center;background:var(--gsoft)">
      <img src="${face(YULIA)}" style="width:150px;height:150px;border-radius:50%;background:var(--card);border:4px solid var(--green);flex:none">
      <div style="font-size:34px;line-height:1.35;font-weight:600">Потренировать такой приём на пациенте — <b style="color:var(--green)">ссылка в закрепе</b></div>
    </div>
    <div style="height:40px"></div>${foot(i, n)}`);
}

function intro() {
  return page(`${top("Знакомство")}
    <div style="display:flex;justify-content:center;margin-top:70px"><img src="${face(YULIA)}" style="width:430px;height:430px;border-radius:50%;background:var(--gsoft);border:6px solid var(--ink);box-shadow:14px 14px 0 rgba(13,92,85,.2)"></div>
    <h1 style="text-align:center;font-size:104px;margin-top:60px">Юля <mark>станет</mark><br>врачом</h1>
    <p class="sub" style="text-align:center;margin:30px auto 0">5 курс лечфака · готовлюсь к аккредитации</p>
    <div class="grow"></div>
    <div style="display:flex;justify-content:center;gap:16px;flex-wrap:wrap;font-size:30px;font-weight:700">
      ${["📋 шпаргалки", "🩺 клинические задачи", "🔎 разборы ошибок"].map((t) => `<span class="card" style="padding:18px 28px;border-radius:999px;box-shadow:5px 5px 0 rgba(13,92,85,.18)">${t}</span>`).join("")}
    </div>`);
}

function caseCard() {
  const c = CASE;
  return page(`${top(c.kicker)}
    <h1>${md(c.title)}</h1>
    <div class="card" style="margin-top:56px">
      <div style="display:flex;align-items:center;gap:30px"><img src="${face(c.patient)}" style="width:190px;height:190px;border-radius:50%;background:var(--paper);border:4px solid var(--ink)">
        <div><div style="font-size:24px;letter-spacing:.08em;text-transform:uppercase;color:var(--red);font-weight:800">Приёмный покой</div><h2 style="font-size:54px;margin-top:6px">${esc(c.name)}</h2></div></div>
      <p style="font-family:Literata,serif;font-style:italic;font-weight:500;font-size:42px;line-height:1.3;margin-top:34px;padding-left:24px;border-left:6px solid var(--red)">«${esc(c.quote)}»</p>
      <div style="margin-top:34px;display:flex;flex-direction:column;gap:14px">${c.facts.map(([k, v]) => `<div style="font-size:32px;line-height:1.35"><b style="display:block;font-size:22px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)">${esc(k)}</b>${esc(v)}</div>`).join("")}</div>
    </div>
    <div class="grow"></div>
    <div class="tip" style="font-size:36px"><i>❓</i><div>${md(c.ask)}</div></div>`);
}

function promo() {
  const p = PROMO;
  const bubble = (who, text) => `<div style="align-self:${who === "pat" ? "flex-start" : "flex-end"};max-width:78%;background:${who === "pat" ? "var(--card)" : "var(--green)"};color:${who === "pat" ? "var(--ink)" : "#fff"};border:${who === "pat" ? "2.5px solid var(--rule)" : "0"};border-radius:${who === "pat" ? "26px 26px 26px 6px" : "26px 26px 6px 26px"};padding:18px 24px;font-size:28px;line-height:1.3;font-weight:600">${esc(text)}</div>`;
  return page(`${top(p.kicker)}
    <h1 style="font-size:70px;margin-top:36px">${md(p.title)}</h1>
    <div class="card" style="margin-top:34px;padding:26px 28px;display:flex;flex-direction:column;gap:12px;background:#eef3f1">
      ${bubble("pat", "Доктор, жжёт под ложечкой третью неделю. Сил нет.")}
      ${bubble("doc", "Боль больше натощак или после еды? Обезболивающие принимаете?")}
      <div style="background:var(--card);border-radius:22px;padding:22px 26px;border:2.5px solid var(--green);margin-top:6px">
        <div style="display:flex;justify-content:space-between;font-size:24px;font-weight:800;color:var(--green);letter-spacing:.04em;text-transform:uppercase"><span>Разбор по КР Минздрава</span><span style="color:var(--ink)">4,5 / 5</span></div>
        <div style="font-size:27px;line-height:1.5;margin-top:10px;font-weight:600">✅ Спросили о связи боли с едой<br>❌ Не назначили ЭГДС с тестом на H. pylori<br>💊 Эрадикация 14 дней: ИПП + амоксициллин + кларитромицин</div>
      </div>
    </div>
    <div style="margin-top:30px;display:grid;grid-template-columns:1fr 1fr;gap:12px 26px">${p.points.map((t) => `<div style="font-size:27px;line-height:1.3;font-weight:700;display:flex;gap:12px"><span style="color:var(--green)">✓</span><span>${esc(t)}</span></div>`).join("")}</div>
    <div class="grow"></div>
    <div class="bottom"><div class="author"><img src="${face(YULIA)}">Юля тренируется здесь</div><span class="swipe" style="background:var(--red)">Жми кнопку ↓</span></div>`);
}

function avatar() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:640px;height:640px;overflow:hidden}
    body{background:radial-gradient(circle at 50% 44%, #e7f1ed 0 60%, #cfe2db 60.2% 100%);position:relative}
    img{position:absolute;left:50%;bottom:-8px;width:600px;height:600px;transform:translateX(-50%)}</style></head><body><img src="${face(YULIA)}"></body></html>`;
}

const jobs = [];
const want = new Set(process.argv.slice(2));
const add = (name, html, size) => { if (!want.size || want.has(name.split("-")[0])) jobs.push({ name, html, size }); };
for (const [key, d] of Object.entries(DECKS)) {
  const n = d.slides.length + 2;
  add(`${key}-1`, cover(d, n));
  d.slides.forEach((s, i) => add(`${key}-${i + 2}`, slide(d, s, i + 1, n)));
  add(`${key}-${n}`, outro(d, n - 1, n));
}
add("intro-1", intro());
add("case-1", caseCard());
add("promo-1", promo());
add("avatar-1", avatar(), { width: 640, height: 640 });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }));
const tmp = join(OUT, ".tmp.html");
for (const j of jobs) {
  const size = j.size || { width: 1080, height: 1350 };
  const p = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  writeFileSync(tmp, j.html);
  await p.goto(pathToFileURL(tmp).href);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(OUT, `${j.name}.jpg`), type: "jpeg", quality: 90 });
  await p.close();
  console.log(j.name);
}
await browser.close();
(await import("node:fs")).rmSync(tmp, { force: true });
