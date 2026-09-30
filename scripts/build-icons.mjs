// Иконки сайта и приложения из логотипа в шапке (квадрат-карта с кардиограммой):
// icon.svg (вкладка браузера, светлая и тёмная тема), favicon.ico, apple-touch-icon.png, icon-192/512.png (PWA), badge-72.png (значок пуша).
// Запуск: node scripts/build-icons.mjs  (Playwright: браузер из /opt/pw-browsers или CHROME_PATH)
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (f) => join(ROOT, "public", f);
const PAPER = "#f6f4ee", INK = "#191c1b", RED = "#b3391f";
const PULSE = "M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8";

// Вкладка браузера: линии толще, чем в шапке, — иначе на 16 px рамка пропадает
const tabSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>
.b{fill:${PAPER};stroke:${INK}}.p{stroke:${RED}}
@media (prefers-color-scheme:dark){.b{fill:#1c211f;stroke:#ecebe5}.p{stroke:#f08a6f}}
</style><rect class="b" x="2.5" y="2.5" width="27" height="27" rx="5" stroke-width="2.4"/><path class="p" d="${PULSE}" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
`;
writeFileSync(out("icon.svg"), tabSvg);

// Картинки: логотип на бумажном фоне во весь квадрат; scale — доля логотипа (для maskable — в безопасной зоне 80%)
const tile = (size, scale) => `<html><body style="margin:0;width:${size}px;height:${size}px;background:${PAPER};display:grid;place-items:center">
<svg width="${Math.round(size * scale)}" height="${Math.round(size * scale)}" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="3" width="26" height="26" rx="4" stroke="${INK}" stroke-width="1.8"/><path d="${PULSE}" stroke="${RED}" stroke-width="2.4"/></svg></body></html>`;
// Значок уведомления Android: только силуэт (белый по прозрачному), без рамки
const badge = `<html><body style="margin:0;width:72px;height:72px;background:transparent">
<svg width="72" height="72" viewBox="3 3 26 26" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PULSE}"/></svg></body></html>`;
// favicon.ico для старых браузеров и ботов — логотип без фона-подложки
const ico = (size) => `<html><body style="margin:0;width:${size}px;height:${size}px;background:transparent">
<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" stroke-linecap="round" stroke-linejoin="round">
<rect x="2.5" y="2.5" width="27" height="27" rx="5" fill="${PAPER}" stroke="${INK}" stroke-width="2.4"/><path d="${PULSE}" stroke="${RED}" stroke-width="3"/></svg></body></html>`;

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = createRequire("/opt/node22/lib/node_modules/")("playwright")); }
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
async function shot(markup, size, file, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(markup);
  return page.screenshot({ path: file && out(file), omitBackground: transparent });
}
await shot(tile(180, 0.7), 180, "apple-touch-icon.png");
await shot(tile(192, 0.62), 192, "icon-192.png");
await shot(tile(512, 0.62), 512, "icon-512.png");
await shot(badge, 72, "badge-72.png", true);
const pngs = [];
for (const s of [16, 32, 48]) pngs.push([s, await shot(ico(s), s, null, true)]);
await browser.close();

// ICO с PNG внутри: заголовок 6 байт + 16 байт на каждый размер
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let offset = head.length;
pngs.forEach(([s, png], i) => {
  const o = 6 + 16 * i;
  head.writeUInt8(s, o); head.writeUInt8(s, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(offset, o + 12);
  offset += png.length;
});
writeFileSync(out("favicon.ico"), Buffer.concat([head, ...pngs.map(([, p]) => p)]));
console.log("✓ public/icon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, badge-72.png");
