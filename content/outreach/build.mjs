// Презентация для рассылки партнёрам: content/outreach/presentation.html → presentation.pdf (альбомный A4, ссылки кликабельны).
// Запуск из корня репозитория: node content/outreach/build.mjs   — нужен playwright (как для scripts/build-pdf.mjs)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = path.resolve("content/outreach");
const LOGO = `<svg viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" stroke="#191c1b" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>`;
const QR = fs.readFileSync(path.join(DIR, "img/qr-app.svg"), "utf8"); // https://helpmedoctor.ru/app?from=partner_deck

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const { createRequire } = await import("node:module");
  const { execSync } = await import("node:child_process");
  ({ chromium } = createRequire(`${execSync("npm root -g").toString().trim()}/`)("playwright"));
}

const tmp = path.join(DIR, ".presentation.render.html");
fs.writeFileSync(tmp, fs.readFileSync(path.join(DIR, "presentation.html"), "utf8").replaceAll("{{LOGO}}", LOGO).replaceAll("{{QR}}", QR));
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const out = path.join(DIR, "help-me-doctor-presentation.pdf");
await page.pdf({ path: out, width: "297mm", height: "210mm", printBackground: true, preferCSSPageSize: true, tagged: true });
if (process.argv.includes("--png")) {
  await page.setViewportSize({ width: 1123, height: 794 });
  const n = await page.locator(".slide").count();
  for (let i = 0; i < n; i++) await page.locator(".slide").nth(i).screenshot({ path: path.join(DIR, `.slide-${i + 1}.png`) });
}
fs.rmSync(tmp);
fs.copyFileSync(out, path.resolve("public/files/help-me-doctor-presentation.pdf")); // ссылка из писем рассылки
await browser.close();
console.log("✓", path.relative(process.cwd(), out));
