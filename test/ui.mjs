// Скриншоты ключевых экранов (Playwright). Требует запущенного local-dev (как в scripts/local-test.sh).
import { chromium } from "playwright";
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:8787";
const OUT = ".wrangler/shots";
const TOKEN = "123:TEST";

function initData(uid) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(uid), first_name: "Мария", username: `u${uid}` }) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}
async function api(token, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const uid = process.argv[2] || "901";
const { token } = await api(null, "POST", "/auth/telegram", { initData: initData(uid) });
await api(token, "PATCH", "/profile", { name: "Мария" });
await api(token, "POST", "/patients/new");
let me;
for (let i = 0; i < 50; i++) { me = await api(token, "GET", "/me"); if (me.patients.length) break; await sleep(200); }
const pid = me.patients[0].id;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const errors = [];
async function page(viewport, scheme = "light", extra = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, deviceScaleFactor: 2, hasTouch: viewport.width < 700, ...extra });
  await ctx.addInitScript((t) => localStorage.setItem("hmd_token", t), token);
  await ctx.route(/telegram\.org/, (r) => r.abort());
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${viewport.width}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && !m.text().includes("telegram.org") && !m.text().includes("ERR_FAILED") && errors.push(`console ${viewport.width}: ${m.text()}`));
  return p;
}
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
const hscroll = async (p, name) => {
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) errors.push(`horizontal scroll on ${name}: ${w}`);
};

const phone = { width: 390, height: 844 };
const m = await page(phone);
await m.goto(`${BASE}/app`);
await m.waitForSelector(".hello");
await shot(m, "01-home-mobile"); await hscroll(m, "home");
await m.goto(`${BASE}/app#/patient/${pid}`); await m.waitForSelector("[data-start]");
await shot(m, "02-patient-mobile"); await hscroll(m, "patient");
await m.click("[data-start]"); await m.waitForSelector("#composer-input");
await m.fill("#composer-input", "Здравствуйте! Что вас беспокоит и как давно?");
await m.click("#send"); await m.waitForSelector(".msg.from-patient >> nth=1", { timeout: 10000 });
await m.click("[data-sheet=tests]"); await m.waitForSelector(".sheet"); await shot(m, "04-tests-sheet-mobile");
await m.click("[data-test='Анализ крови']"); await m.waitForSelector(".event.test", { timeout: 10000 });
await m.click("[data-sheet=exam]"); await m.click("[data-exam='Пальпация живота']"); await m.waitForSelector(".event >> nth=1", { timeout: 10000 });
await sleep(300);
await shot(m, "03-consult-mobile"); await hscroll(m, "consult");
await m.click("[data-sheet=finish]"); await m.fill("#dx", "Язвенная болезнь ДПК"); await m.fill("#tx", "Омепразол, эрадикационная терапия 14 дней");
await shot(m, "05-finish-sheet-mobile");
await m.click("#finish-go"); await m.waitForSelector("#eval-slot, .rating-big", { timeout: 10000 });
await m.waitForSelector(".sheet .rating-big", { timeout: 20000 });
await shot(m, "06-evaluation-mobile");
await m.keyboard.press("Escape");
for (let i = 0; i < 50; i++) { const q = await api(token, "GET", `/quiz/${pid}`); if (q.quiz) break; await sleep(200); }
await m.goto(`${BASE}/app#/quiz/${pid}`); await m.waitForSelector("[data-opt]");
await m.click("[data-opt='0']"); await m.waitForSelector("#quiz-next"); await shot(m, "07-quiz-mobile");
await m.goto(`${BASE}/app#/profile`); await m.waitForSelector("#pf-save"); await shot(m, "08-profile-mobile"); await hscroll(m, "profile");
await m.goto(`${BASE}/app#/plans`); await m.waitForSelector("[data-plan]"); await shot(m, "09-plans-mobile");
await m.goto(`${BASE}/app#/patients`); await m.waitForSelector(".tabs"); await m.click("[data-tab=archive]"); await shot(m, "10-archive-mobile");

const d = await page({ width: 390, height: 844 }, "dark");
await d.goto(`${BASE}/app#/consult/${pid}`); await d.waitForSelector(".messages"); await sleep(300);
await shot(d, "11-consult-dark");
await d.goto(`${BASE}/app#/`); await d.waitForSelector(".hello"); await shot(d, "12-home-dark");

const desk = await page({ width: 1280, height: 800 });
await desk.goto(`${BASE}/app`); await desk.waitForSelector(".hello"); await shot(desk, "13-home-desktop");
await desk.goto(`${BASE}/app#/consult/${pid}`); await desk.waitForSelector(".messages"); await sleep(300); await shot(desk, "14-consult-desktop");

// Логин-экран в браузере (без токена)
const ctx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2 });
const lp = await ctx.newPage();
lp.on("pageerror", (e) => errors.push(`login: ${e.message}`));
await lp.goto(`${BASE}/app`); await lp.waitForSelector("#login-btn[href]"); await shot(lp, "15-login");

// Запуск из Telegram: заглушка WebApp + hash tgWebAppData
const tctx = await browser.newContext({ viewport: phone, deviceScaleFactor: 2, hasTouch: true });
await tctx.route(/telegram\.org/, (r) => r.abort());
await tctx.addInitScript((data) => {
  const noop = () => {};
  window.Telegram = { WebApp: { initData: data, ready: noop, expand: noop, disableVerticalSwipes: noop, setHeaderColor: noop, setBackgroundColor: noop, onEvent: noop, viewportStableHeight: 780,
    BackButton: { show: noop, hide: noop, onClick: noop }, HapticFeedback: { impactOccurred: noop, notificationOccurred: noop } } };
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.style.setProperty("--tg-theme-button-color", "#2481cc");
    document.documentElement.style.setProperty("--tg-theme-secondary-bg-color", "#efeff4");
  });
}, initData("902"));
const tp = await tctx.newPage();
tp.on("pageerror", (e) => errors.push(`tg: ${e.message}`));
await tp.goto(`${BASE}/app?go=${encodeURIComponent("/profile")}#tgWebAppData=x&tgWebAppVersion=8.0`);
await tp.waitForSelector("#pf-save", { timeout: 15000 });
await shot(tp, "16-telegram-profile");
const tgClass = await tp.evaluate(() => document.documentElement.classList.contains("tg"));
if (!tgClass) errors.push("telegram mode not detected");

await browser.close();
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "UI OK, без ошибок в консоли");
