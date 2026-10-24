// Баннеры для Яндекс Директа (комбинаторное объявление ЕПК): 1:1 (1080×1080), 4:3 (1440×1080) и ровно 16:9 (1920×1080).
// Данные — direct/banners/ads.mjs, результат — direct/banners/<ключ>-1x1.png, -4x3.png, -16x9.png.
// Запуск: node scripts/direct-banners.mjs [ключ…]  (без ключей — все). Нужен Playwright, браузер — /opt/pw-browsers.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { BANNERS } from "../direct/banners/ads.mjs";
import { chromium, esc, md, page, logo, V } from "./ad-kit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "direct/banners");
mkdirSync(OUT, { recursive: true });

const SIZES = [["1x1", 1080, 1080], ["4x3", 1440, 1080], ["16x9", 1920, 1080]];

const head = `<div style="display:flex;align-items:center;gap:16px">${logo}<div><b style="font-size:31px;display:block;line-height:1.1">Help me, Doctor</b><span style="font-size:22px;color:var(--muted);font-weight:600">helpmedoctor.ru</span></div></div>`;
const offer = (a, big) => `<div style="background:var(--green);color:#fff;border-radius:26px;padding:${big ? "28px 36px" : "22px 32px"};display:flex;align-items:center;justify-content:space-between;gap:20px">
  <b style="font-size:${big ? 36 : 32}px;font-weight:800">${esc(a.offer)}</b>
  <span style="width:${big ? 64 : 56}px;height:${big ? 64 : 56}px;border-radius:50%;background:var(--mark);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:${big ? 36 : 32}px;font-weight:800;flex:none">→</span></div>`;
const visual = (a, zoom, pad) => `<div id="vis" style="flex:1;min-height:0;min-width:0;display:flex;align-items:center;justify-content:center;padding:${pad}">
  <div id="fit" style="width:100%;zoom:${zoom}">${V[a.visual.type](a.visual)}</div></div>`;

function banner(a, w, h) {
  // Квадрат — колонкой, как в VK; широкие — заголовок слева, «экран» справа (Директ обрезает края, главное — по центру)
  if (w === h) return page(w, h, `
    <div style="position:absolute;inset:0;padding:58px 70px 54px;display:flex;flex-direction:column">
      <div style="display:flex;justify-content:space-between;align-items:center">${head}<span class="kick">${esc(a.kicker)}</span></div>
      <h1 style="font-size:70px;margin-top:38px">${md(a.img)}</h1>
      ${visual(a, 0.88, "28px 0")}
      ${offer(a, false)}
    </div>`);
  const wide = w / h > 1.5;
  return page(w, h, `
    <div style="position:absolute;inset:0;padding:${wide ? "70px 96px" : "64px 72px"};display:flex;gap:${wide ? 80 : 52}px">
      <div style="flex:${wide ? "0 0 46%" : "0 0 50%"};display:flex;flex-direction:column">
        ${head}
        <div style="margin-top:44px"><span class="kick">${esc(a.kicker)}</span></div>
        <h1 style="font-size:${wide ? 84 : 72}px;margin-top:30px">${md(a.img)}</h1>
        <div style="flex:1"></div>
        ${offer(a, wide)}
      </div>
      ${visual(a, wide ? 1 : 0.92, "0")}
    </div>`);
}

const want = new Set(process.argv.slice(2));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }).catch(() => chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }));
const tmp = join(OUT, ".tmp.html");
for (const a of BANNERS) {
  if (want.size && !want.has(a.key)) continue;
  for (const [suf, w, h] of SIZES) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    writeFileSync(tmp, banner(a, w, h));
    await p.goto(pathToFileURL(tmp).href);
    await p.evaluate(() => document.fonts.ready);
    // «Экран» не влез по высоте — уменьшаем, пока не влезет
    await p.evaluate(() => {
      const box = document.getElementById("vis"), fit = document.getElementById("fit"), cs = getComputedStyle(box);
      const room = () => box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let z = parseFloat(fit.style.zoom);
      while (fit.getBoundingClientRect().height > room() && z > 0.5) fit.style.zoom = z = +(z - 0.02).toFixed(2);
    });
    await p.waitForTimeout(150);
    await p.screenshot({ path: join(OUT, `${a.key}-${suf}.png`), type: "png" });
    await p.close();
  }
  console.log(a.key);
}
await browser.close();
rmSync(tmp, { force: true });
