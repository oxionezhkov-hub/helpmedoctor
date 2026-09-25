// PDF-материалы в фирменном стиле (для Telegram-канала и лид-магнитов сайта).
// Исходники: content/telegram-channel/pdf/*.html (+ общий _brand.css). Результат: content/telegram-channel/pdf/out/*.pdf,
// а файлы из списка PUBLISH — ещё и в public/files/ (их отдаёт сайт).
// Запуск: node scripts/build-pdf.mjs [имя-без-расширения]   — нужен playwright (npx playwright или глобальная установка)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIR = path.resolve("content/telegram-channel/pdf");
const OUT = path.join(DIR, "out");
const PUBLISH = ["chek-list-sbor-anamneza"]; // эти PDF выкладываются на сайт: /files/<имя>.pdf

const LOGO = `<svg viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" stroke="#191c1b" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8" stroke="#b3391f"/></svg>`;
const QR = fs.readFileSync(path.join(DIR, "qr-app.svg"), "utf8");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  const { createRequire } = await import("node:module");
  const { execSync } = await import("node:child_process");
  ({ chromium } = createRequire(`${execSync("npm root -g").toString().trim()}/`)("playwright"));
}

const only = process.argv[2];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html") && !f.startsWith("_") && (!only || f === `${only}.html`));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
for (const f of files) {
  const name = f.replace(/\.html$/, "");
  const tmp = path.join(DIR, `.${name}.render.html`);
  fs.writeFileSync(tmp, fs.readFileSync(path.join(DIR, f), "utf8").replaceAll("{{LOGO}}", LOGO).replaceAll("{{QR}}", QR));
  await page.goto(pathToFileURL(tmp).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = path.join(OUT, `${name}.pdf`);
  await page.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true, tagged: true });
  fs.rmSync(tmp);
  if (PUBLISH.includes(name)) {
    fs.mkdirSync("public/files", { recursive: true });
    fs.copyFileSync(pdf, `public/files/${name}.pdf`);
  }
  console.log("✓", path.relative(process.cwd(), pdf), PUBLISH.includes(name) ? `→ public/files/${name}.pdf` : "");
}
await browser.close();
