// Реклама в VK Рекламе: 10 объявлений — картинки 1:1 (1080×1080) и 4:5 (1080×1350) и сводка текстов для кабинета.
// Данные — content/ads/vk-10/ads.mjs, результат — content/ads/vk-10/img/<ключ>-1x1.jpg, <ключ>-4x5.jpg и content/ads/vk-10/README.md.
// Запуск: node scripts/vk-ads.mjs [ключ…]  (без ключей — все). Нужен Playwright, браузер — /opt/pw-browsers.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { ADS, LINK } from "../content/ads/vk-10/ads.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "content/ads/vk-10");
const OUT = join(DIR, "img");
const FONTS = pathToFileURL(join(ROOT, "content/telegram-channel/fonts/fonts.css")).href;
mkdirSync(OUT, { recursive: true });

// Лимиты полей универсального объявления в кабинете VK Рекламы
const LIMITS = { title: 40, short: 90, long: 220, near: 30 };
const bad = ADS.flatMap((a) => Object.entries(LIMITS).filter(([k, n]) => a[k].length > n).map(([k, n]) => `${a.key}.${k}: ${a[k].length} > ${n}`));
if (bad.length) { console.error("Длиннее лимита:\n" + bad.join("\n")); process.exit(1); }

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s) => esc(s).replace(/[^\s=*]+-[^\s=*,.]+/g, '<span style="white-space:nowrap">$&</span>').replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/==([\s\S]+?)==/g, "<mark>$1</mark>").replace(/\n/g, "<br>");

const CSS = (w, h) => `
@import url("${FONTS}");
:root { --paper: #f5f2e9; --card: #fffdf8; --ink: #1b1f1d; --ink2: #3a403d; --muted: #6a716d; --green: #0d5c55; --teal: #0f766e; --gsoft: #dceae5;
  --red: #b3391f; --rsoft: #f7e3dc; --rule: #dcd6c6; --mark: #f5d97c; --app: #f4f7f7; --border: #dde6e5; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${w}px; height: ${h}px; overflow: hidden; }
body { font-family: Manrope, "DejaVu Sans", sans-serif; color: var(--ink); background: var(--paper);
  background-image: linear-gradient(rgba(13,92,85,.07) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(13,92,85,.07) 1.5px, transparent 1.5px);
  background-size: 54px 54px; position: relative; -webkit-font-smoothing: antialiased; }
mark { background: linear-gradient(transparent 54%, var(--mark) 54%, var(--mark) 94%, transparent 94%); color: inherit; padding: 0 .04em; }
h1 { font-family: Literata, serif; font-weight: 800; letter-spacing: -.02em; line-height: 1.04; }
.kick { background: var(--red); color: #fff; padding: 10px 22px; border-radius: 999px; text-transform: uppercase; font-size: 22px; letter-spacing: .08em; font-weight: 700; white-space: nowrap; }
.box { background: var(--card); border: 3px solid var(--ink); border-radius: 30px; box-shadow: 10px 10px 0 rgba(13,92,85,.18); }
.bub { max-width: 82%; padding: 18px 24px; border-radius: 24px; font-size: 29px; line-height: 1.32; font-weight: 500; }
.bub.p { background: #fff; border: 2px solid var(--border); border-bottom-left-radius: 8px; align-self: flex-start; }
.bub.d { background: var(--teal); color: #fff; border-bottom-right-radius: 8px; align-self: flex-end; }
.tag { display: inline-flex; align-items: center; gap: 10px; background: var(--mark); border: 3px solid var(--ink); border-radius: 18px; padding: 12px 20px; font-size: 27px; font-weight: 700; box-shadow: 6px 6px 0 rgba(13,92,85,.18); }
`;
const page = (w, h, inner) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS(w, h)}</style></head><body>${inner}</body></html>`;
const logo = `<svg width="64" height="64" viewBox="0 0 32 32" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="27" height="27" rx="6" stroke="#1b1f1d" stroke-width="2.2" fill="#fff"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>`;
const check = (c = "#fff") => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const cross = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b3391f" stroke-width="3.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const mic = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
const initials = (n, bg) => `<div style="width:64px;height:64px;border-radius:50%;background:${bg};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:28px;flex:none">${esc(n[0])}</div>`;

// ---------- Картинки-«экраны» под заголовком ----------
const V = {
  steps: (v) => `<div class="box" style="padding:12px 40px;width:100%">${v.items.map(([h, t], i) => `
    <div style="display:flex;align-items:center;gap:26px;padding:22px 0;${i ? "border-top:2.5px solid var(--rule)" : ""}">
      <div style="width:58px;height:58px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;flex:none">${check()}</div>
      <div><b style="display:block;font-size:36px;font-weight:800">${esc(h)}</b><span style="font-size:27px;color:var(--ink2);font-weight:500">${esc(t)}</span></div>
    </div>`).join("")}</div>`,

  chat: (v) => `<div style="width:100%;display:flex;flex-direction:column;align-items:center;gap:0">
    <div class="box" style="width:100%;overflow:hidden;background:var(--app)">
      <div style="display:flex;align-items:center;gap:18px;padding:20px 28px;background:#fff;border-bottom:2px solid var(--border)">${initials(v.name, "#8a6d3b")}
        <div><b style="font-size:29px">${esc(v.name)}</b><div style="font-size:22px;color:var(--muted);font-weight:600">ИИ-пациент · на приёме</div></div></div>
      <div style="display:flex;flex-direction:column;gap:16px;padding:26px 28px">${v.msgs.map(([who, t]) => `<div class="bub ${who}">${esc(t)}</div>`).join("")}</div>
    </div>
    ${v.note ? `<div class="tag" style="margin-top:-26px;position:relative">💡 ${esc(v.note)}</div>` : ""}</div>`,

  review: (v) => `<div class="box" style="padding:34px 40px;width:100%">
    <div style="display:flex;align-items:center;justify-content:space-between">
      <b style="font-size:32px">Разбор приёма</b>
      <div style="display:flex;align-items:baseline;gap:14px"><span style="font-family:Literata,serif;font-weight:800;font-size:66px;line-height:1">${v.score}</span><span style="font-size:34px;color:#d99a06;letter-spacing:2px">★★★☆☆</span></div></div>
    <div style="margin-top:20px;display:flex;flex-direction:column;gap:14px">${v.bars.map(([l, n]) => `
      <div style="display:flex;align-items:center;gap:20px;font-size:27px;font-weight:600"><span style="width:210px">${l}</span>
        <div style="flex:1;height:18px;border-radius:9px;background:#e7ece9;overflow:hidden"><div style="height:100%;width:${n * 20}%;background:${n <= 2 ? "var(--red)" : "var(--teal)"}"></div></div><b style="width:24px">${n}</b></div>`).join("")}</div>
    <div style="margin-top:24px;padding-top:20px;border-top:2.5px solid var(--rule);font-size:21px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700">Что упущено</div>
    ${v.misses.map((m) => `<div style="display:flex;align-items:center;gap:14px;margin-top:12px;font-size:29px;font-weight:600">${cross}${esc(m)}</div>`).join("")}</div>`,

  voice: (v) => `<div style="width:100%;display:flex;flex-direction:column;gap:20px">
    <div style="align-self:flex-end;display:flex;align-items:center;gap:22px;background:var(--teal);color:#fff;border-radius:30px 30px 8px 30px;padding:22px 30px;max-width:88%;box-shadow:10px 10px 0 rgba(13,92,85,.18)">
      <div style="width:78px;height:78px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;flex:none">${mic}</div>
      <div><div style="display:flex;align-items:center;gap:5px;height:40px">${[14, 26, 38, 22, 32, 18, 36, 28, 12, 30, 20, 34, 16, 26, 10, 22, 30, 14].map((hh) => `<span style="width:7px;height:${hh}px;border-radius:4px;background:#fff;opacity:.9"></span>`).join("")}<span style="margin-left:12px;font-size:24px;font-weight:700;opacity:.85">0:04</span></div>
        <div style="font-size:28px;line-height:1.3;margin-top:8px;font-weight:500">«${esc(v.ask)}»</div></div></div>
    <div class="bub p" style="font-size:29px;box-shadow:10px 10px 0 rgba(13,92,85,.12);border:3px solid var(--ink)">${esc(v.answer)}</div></div>`,

  labs: (v) => `<div class="box" style="padding:30px 38px;width:100%">
    <div style="display:flex;align-items:center;gap:14px;font-size:30px;font-weight:800">🧪 ${esc(v.title)}</div>
    <div style="margin-top:14px">${v.rows.map(([n, val, ref, f]) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 18px;margin-top:8px;border-radius:14px;background:${f ? "#fdf3dd" : "transparent"}">
        <span style="font-size:28px;font-weight:600;color:var(--ink2)">${esc(n)}</span>
        <span style="text-align:right"><b style="font-size:29px;color:${f ? "var(--red)" : "var(--ink)"}">${esc(val)} ${f === "low" ? "↓" : f === "high" ? "↑" : ""}</b><span style="display:block;font-size:20px;color:var(--muted);font-weight:600">норма ${esc(ref)}</span></span></div>`).join("")}</div>
    ${v.q ? `<div class="tag" style="margin-top:22px">🤔 ${esc(v.q)}</div>` : ""}</div>`,

  duel: (v) => {
    const side = ([n, sc, t], win, bg) => `<div class="box" style="flex:1;padding:30px 26px;text-align:center;${win ? "border-color:var(--green);border-width:4px" : ""}">
      <div style="display:flex;justify-content:center">${initials(n, bg).replace(/64px/g, "96px").replace("28px", "42px")}</div>
      <b style="display:block;font-size:34px;margin-top:14px">${esc(n)}</b>
      <div style="font-family:Literata,serif;font-weight:800;font-size:72px;line-height:1.1;margin-top:6px;color:${win ? "var(--green)" : "var(--ink2)"}">${sc}</div>
      <div style="font-size:25px;color:var(--muted);font-weight:600">приём за ${t}</div>
      ${win ? `<div style="margin-top:14px;display:inline-block;background:var(--mark);border-radius:999px;padding:6px 18px;font-weight:800;font-size:24px">🏆 Победа</div>` : `<div style="margin-top:14px;display:inline-block;background:var(--rsoft);border-radius:999px;padding:6px 18px;font-weight:800;font-size:24px;color:var(--red)">Реванш?</div>`}</div>`;
    return `<div style="width:100%"><div style="text-align:center;font-size:27px;font-weight:700;color:var(--ink2);margin-bottom:22px">Один пациент на двоих · одышка и отёки</div>
      <div style="display:flex;align-items:center;gap:22px">${side(v.a, true, "#0f766e")}
      <div style="font-family:Literata,serif;font-weight:800;font-size:58px;color:var(--red)">VS</div>${side(v.b, false, "#8a6d3b")}</div></div>`;
  },

  free: (v) => `<div class="box" style="padding:30px 40px;width:100%;display:flex;align-items:center;gap:36px">
    <div style="text-align:center;flex:none"><div style="font-family:Literata,serif;font-weight:800;font-size:220px;line-height:.9;color:var(--green)">${v.big}</div>
      <div style="font-size:27px;font-weight:800;max-width:240px;line-height:1.2;margin-top:8px">${esc(v.label)}</div></div>
    <div style="flex:1;border-left:2.5px solid var(--rule);padding-left:34px">${v.items.map((t) => `<div style="display:flex;gap:14px;align-items:flex-start;padding:12px 0;font-size:28px;font-weight:600;line-height:1.28"><span style="flex:none;margin-top:2px">${check("#0d5c55")}</span>${esc(t)}</div>`).join("")}</div></div>`,

  specs: (v) => `<div style="width:100%"><div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center">${v.items.map((t, i) => `<span style="background:${i % 3 === 0 ? "var(--gsoft)" : "var(--card)"};border:3px solid var(--ink);border-radius:999px;padding:14px 28px;font-size:31px;font-weight:700;box-shadow:5px 5px 0 rgba(13,92,85,.18)">${esc(t)}</span>`).join("")}</div>
    <div class="box" style="margin-top:34px;padding:22px 30px;display:flex;justify-content:space-between;align-items:center;gap:10px">${v.levels.map(([e, l]) => `<span style="font-size:26px;font-weight:700;white-space:nowrap">${e} ${esc(l)}</span>`).join("")}</div></div>`,

  quiz: (v) => `<div class="box" style="padding:30px 38px;width:100%;position:relative">
    <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:22px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:800">Работа над ошибками</span>
      <span style="background:#fdeee6;color:var(--red);border-radius:999px;padding:8px 20px;font-weight:800;font-size:27px">🔥 ${v.streak} дней</span></div>
    <div style="font-size:29px;font-weight:600;line-height:1.36;margin-top:16px">${esc(v.q)}</div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:20px">${v.opts.map(([t, s]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-radius:16px;font-size:28px;font-weight:700;
      border:2.5px solid ${s === "ok" ? "var(--teal)" : s === "bad" ? "var(--red)" : "var(--border)"};background:${s === "ok" ? "#e3f5e8" : s === "bad" ? "var(--rsoft)" : "#fff"}">${esc(t)}${s === "ok" ? check("#0f766e") : s === "bad" ? cross : ""}</div>`).join("")}</div></div>`,
};

function ad(a, w, h) {
  const sq = h === w;
  return page(w, h, `
    <div style="position:absolute;inset:0;padding:${sq ? "58px 70px 54px" : "70px 76px 64px"};display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:16px">${logo}<div><b style="font-size:31px;display:block;line-height:1.1">Help me, Doctor</b><span style="font-size:22px;color:var(--muted);font-weight:600">helpmedoctor.ru</span></div></div>
        <span class="kick">${esc(a.kicker)}</span></div>
      <h1 style="font-size:${sq ? 70 : 84}px;margin-top:${sq ? 38 : 52}px">${md(a.img)}</h1>
      <div id="vis" style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:${sq ? "28px 0" : "40px 0"}">
        <div id="fit" style="width:100%;zoom:${sq ? 0.88 : 1}">${V[a.visual.type](a.visual)}</div></div>
      <div style="background:var(--green);color:#fff;border-radius:26px;padding:${sq ? "22px 32px" : "28px 36px"};display:flex;align-items:center;justify-content:space-between;gap:20px">
        <b style="font-size:${sq ? 32 : 36}px;font-weight:800">${esc(a.offer)}</b>
        <span style="width:${sq ? 56 : 64}px;height:${sq ? 56 : 64}px;border-radius:50%;background:var(--mark);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:${sq ? 32 : 36}px;font-weight:800;flex:none">→</span></div>
    </div>`);
}

// ---------- Сводка для кабинета ----------
function readme() {
  const row = (k, v, lim) => `| ${k} | ${v.replace(/\|/g, "\\|")} | ${v.length}${lim ? `/${lim}` : ""} |`;
  return `# VK Реклама — 10 объявлений

Файл собирается скриптом \`node scripts/vk-ads.mjs\` из \`ads.mjs\` — правьте тексты там.

**Формат:** универсальное объявление, цель «Сайт». Картинки: \`img/<ключ>-1x1.jpg\` (1080×1080) и \`img/<ключ>-4x5.jpg\` (1080×1350) — грузите обе, кабинет сам подберёт под площадку.
**Ссылка:** у каждого объявления своя метка \`from=vk_<ключ>\` — переходы и регистрации видны в админке → «Источники».
**Лимиты полей:** заголовок 40, короткое описание 90, длинное 220, текст рядом с кнопкой 30 символов (скрипт проверяет).

Как тестировать: запустите все 10 в одной группе с одинаковым бюджетом на 2–3 дня, отключите те, где цена регистрации (метка в «Источниках») выше средней в 1,5 раза, и долейте бюджет в 2–3 лучших.

Модерация: в текстах нет «лучший / №1» (по закону о рекламе нужно подтверждение) и упоминаний Минздрава как «одобрения» — не добавляйте их. Объявления про обучение, а не про медицинские услуги, поэтому лицензия не нужна; если модератор спросит — это образовательный тренажёр для студентов.

## Промпты для ChatGPT — как пользоваться

1. Вставьте промпт как есть. Если формат не тот — допишите «соотношение сторон 1:1» или «4:5».
2. В большинстве промптов текста на картинке нет: так модель не ошибётся в русских буквах, а заголовок и подпись под картинкой даёт сам ВК. Хотите надпись на картинке — допишите: «Сверху крупная надпись на русском: "<заголовок>" шрифтом с засечками, проверь орфографию».
3. Текст на картинке в VK Рекламе — не больше ~20% площади, иначе охват может падать.

${ADS.map((a) => `---

## ${a.key} · ${a.name}

| | |
|---|---|
| 1:1 | ![](img/${a.key}-1x1.jpg) |
| 4:5 | ![](img/${a.key}-4x5.jpg) |

| Поле | Текст | Символов |
|---|---|---|
${row("Заголовок", a.title, LIMITS.title)}
${row("Короткое описание", a.short, LIMITS.short)}
${row("Длинное описание", a.long, LIMITS.long)}
${row("Текст рядом с кнопкой", a.near, LIMITS.near)}
| Кнопка | ${a.button} | |
| Ссылка | ${LINK(a.key)} | |

**Промпт для ChatGPT:**

> ${a.prompt}
`).join("\n")}`;
}

const want = new Set(process.argv.slice(2));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }));
const tmp = join(OUT, ".tmp.html");
for (const a of ADS) {
  if (want.size && !want.has(a.key)) continue;
  for (const [suf, w, h] of [["1x1", 1080, 1080], ["4x5", 1080, 1350]]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    writeFileSync(tmp, ad(a, w, h));
    await p.goto(pathToFileURL(tmp).href);
    await p.evaluate(() => document.fonts.ready);
    // Картинка-«экран» не влезла по высоте — уменьшаем, пока не влезет
    await p.evaluate(() => {
      const box = document.getElementById("vis"), fit = document.getElementById("fit"), cs = getComputedStyle(box);
      const room = () => box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let z = parseFloat(fit.style.zoom);
      while (fit.getBoundingClientRect().height > room() && z > 0.5) fit.style.zoom = z = +(z - 0.02).toFixed(2);
    });
    await p.waitForTimeout(150);
    await p.screenshot({ path: join(OUT, `${a.key}-${suf}.jpg`), type: "jpeg", quality: 90 });
    await p.close();
  }
  console.log(a.key);
}
await browser.close();
rmSync(tmp, { force: true });
writeFileSync(join(DIR, "README.md"), readme());
