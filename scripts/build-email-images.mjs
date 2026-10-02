// Картинки для писем (PNG — SVG почтовые клиенты не показывают): логотип и сцены с персонажами для серии «вернись» и служебных писем.
// Персонажи — те же нарисованные пациенты и врачи, что на сайте (src/lib/face.js). Результат коммитится в public/email/.
// Запуск: node scripts/build-email-images.mjs  (нужен Playwright с Chromium; CHROME_PATH=/opt/pw-browsers/chromium, если не находит)
import { chromium } from "playwright";
import { faceSvg } from "../src/lib/face.js";

const W = 560, H = 240;
const face = (p, size, extra = "") => `<div style="width:${size}px;height:${size}px;${extra}">${faceSvg(p).replace("<svg", `<svg width="${size}" height="${size}"`)}</div>`;
const bubble = (t, extra = "") => `<div style="position:absolute;background:#fffdf8;border:2px solid #191c1b;border-radius:16px;padding:8px 12px;font:600 17px/1.25 system-ui,Arial,sans-serif;color:#191c1b;${extra}">${t}</div>`;
const scene = (inner, bg = "#f6f4ee") => `<html><body style="margin:0;width:${W}px;height:${H}px;background:${bg};position:relative;overflow:hidden">${inner}</body></html>`;

const SCENES = {
  // День 1: стрик горит
  s1: scene(`
    <div style="position:absolute;left:60px;top:28px;font-size:150px;line-height:1">🔥</div>
    ${face({ s: "mail-doc-1", g: "f", a: 27, m: "odd" }, 170, "position:absolute;right:70px;bottom:0")}
    ${bubble("Ещё не поздно!", "right:40px;top:26px")}`, "#fff3e6"),
  // День 3: пациенты ждут в очереди
  s3: scene(`
    <div style="position:absolute;left:0;right:0;bottom:0;height:46px;background:#e8e3d6"></div>
    ${face({ s: "mail-q-1", g: "m", a: 64, m: "bad" }, 140, "position:absolute;left:40px;bottom:20px")}
    ${face({ s: "mail-q-2", g: "f", a: 35, m: "odd" }, 140, "position:absolute;left:200px;bottom:20px")}
    ${face({ s: "mail-q-3", g: "m", a: 8 }, 120, "position:absolute;left:360px;bottom:20px")}
    ${bubble("А доктор придёт?", "left:240px;top:18px")}
    <div style="position:absolute;right:26px;top:24px;font:700 14px/1 'DejaVu Sans Mono',monospace;letter-spacing:.06em;background:#191c1b;color:#f6f4ee;padding:8px 10px;border-radius:6px">ОЧЕРЕДЬ</div>`),
  // День 7: неделя — календарь
  s7: scene(`
    <div style="position:absolute;left:60px;top:34px;width:150px;height:170px;background:#fffdf8;border:2px solid #191c1b;border-radius:14px;overflow:hidden;text-align:center">
      <div style="background:#b3391f;color:#fff;font:700 18px/40px system-ui,Arial,sans-serif">НЕДЕЛЯ</div>
      <div style="font:800 92px/120px system-ui,Arial,sans-serif;color:#191c1b">7</div>
    </div>
    ${face({ s: "mail-pt-7", g: "f", a: 52, m: "sad" }, 180, "position:absolute;right:60px;bottom:0")}
    ${bubble("Я всё ещё кашляю…", "right:220px;top:30px")}`),
  // День 14: профессор разбирает приёмы сам с собой
  s14: scene(`
    ${face({ s: "mail-prof", g: "m", a: 66, m: "odd", clean: true }, 190, "position:absolute;left:40px;bottom:0")}
    ${bubble("Коллега, а вы что думаете?", "right:24px;top:36px")}
    ${bubble("Думаю, что я тут один…", "right:60px;top:116px")}`, "#eef3f1"),
  // День 30: прощание
  s30: scene(`
    ${face({ s: "mail-bye", g: "f", a: 30, m: "good" }, 180, "position:absolute;left:190px;bottom:0")}
    <div style="position:absolute;left:390px;top:40px;font-size:70px">👋</div>
    ${bubble("Будем ждать!", "left:40px;top:40px")}`),
  // Служебные: хорошая новость
  ok: scene(`
    ${face({ s: "mail-ok", g: "f", a: 24, m: "good", clean: true }, 180, "position:absolute;left:120px;bottom:0")}
    <div style="position:absolute;right:110px;top:60px;width:110px;height:110px;border-radius:50%;background:#0d5c55;color:#fff;font:800 70px/110px system-ui,Arial,sans-serif;text-align:center">✓</div>`, "#eaf4f0"),
};

const LOGO = `<html><body style="margin:0;background:transparent"><div style="display:flex;align-items:center;gap:10px;padding:4px;font:700 24px Georgia,serif;color:#191c1b;width:max-content">
<svg width="34" height="34" viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="26" height="26" rx="4" stroke="#191c1b" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>Help me, Doctor</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const [name, html] of Object.entries(SCENES)) {
  await page.setViewportSize({ width: W, height: H });
  await page.setContent(html);
  await page.screenshot({ path: `public/email/${name}.png` });
  console.log(`✓ public/email/${name}.png`);
}
await page.setViewportSize({ width: 300, height: 50 });
await page.setContent(LOGO);
await page.locator("div").first().screenshot({ path: "public/email/logo.png", omitBackground: true });
console.log("✓ public/email/logo.png");
await browser.close();
