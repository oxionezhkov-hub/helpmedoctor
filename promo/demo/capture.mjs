// Съёмка реального приложения (локальный wrangler dev + заглушка ИИ): скриншоты состояний + координаты нажатий.
// Запуск: scripts/dev-local.sh, затем node promo/demo/capture.mjs
import { createRequire } from "module";
import crypto from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8787", OUT = new URL("./shots/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const FONT_CSS = fs.readFileSync(new URL("./font/inter.css", import.meta.url), "utf8");
const addFont = (c) => c.addInitScript((css) => { const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s); }, FONT_CSS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function initData(uid, name) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(uid), first_name: name, username: `u${uid}` }) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update("123:TEST").digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}
const api = async (token, method, path, body) => (await fetch(`${BASE}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

const uid = process.argv[2] || String(7000 + Math.floor(Math.random() * 900));
const { token } = await api(null, "POST", "/auth/telegram", { initData: initData(uid, "Артём") });
await api(token, "PATCH", "/profile", { name: "Артём" });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript((t) => { localStorage.setItem("hmd_token", t); localStorage.setItem("hmd_theme", "light"); localStorage.setItem("hmd_cookies", "1"); }, token);
await ctx.route(/telegram\.org|mc\.yandex/, (r) => r.abort());
await addFont(ctx);
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message));
const meta = [];
let n = 0;
async function shot(name, extra = {}) {
  await sleep(350);
  const file = `${String(++n).padStart(2, "0")}-${name}.png`;
  await p.screenshot({ path: OUT + file });
  const scrollY = await p.evaluate(() => scrollY);
  meta.push({ file, name, scrollY, ...extra });
  console.log("shot", file);
}
async function rect(sel) {
  const el = typeof sel === "string" ? p.locator(sel).first() : sel;
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } : null;
}
async function tap(sel, name) { const r = await rect(sel); await shot(name, { tap: r }); await (typeof sel === "string" ? p.locator(sel).first() : sel).click(); return r; }

await p.goto(`${BASE}/app`);
await p.waitForSelector("#onb");
await shot("onb-1");
await tap(p.getByRole("button", { name: "Врач", exact: true }), "onb-1-tap");
await shot("onb-2");
await tap(`[data-onb-prof="Терапевт"]`, "onb-2-tap");
await shot("onb-3");
await tap(`[data-onb-spec="гастроэнтерология"]`, "onb-3-tap");
await shot("onb-3b");
await tap("#onb-next", "onb-3-next");
await shot("onb-4");
await tap("#onb-finish", "onb-4-tap");
await sleep(600); await shot("waiting");
await sleep(1500); await shot("waiting2");
let me;
for (let i = 0; i < 60; i++) { me = await api(token, "GET", "/me"); if (me.patients?.length) break; await sleep(250); }
const pid = me.patients[0].id;
await sleep(800); await shot("patient-card");
await tap("[data-start]", "start-tap");
await p.waitForSelector("#composer-input"); await shot("consult-open");
async function ask(text, name) {
  await p.fill("#composer-input", text); await shot(name + "-typed", { tap: await rect("#send") });
  const before = await p.locator(".msg.from-patient").count();
  await p.click("#send");
  await sleep(900); await shot(name + "-stream");
  await p.waitForFunction((b) => document.querySelectorAll(".msg.from-patient").length > b && !document.querySelector(".typing, .streaming"), before, { timeout: 20000 }).catch(() => {});
  await sleep(1200); await shot(name + "-answer");
}
await ask("Здравствуйте! Что вас беспокоит?", "q1");
await ask("Когда болит сильнее — натощак или после еды?", "q2");
await tap("[data-sheet=tests]", "tests-tap");
await p.waitForSelector(".sheet"); await shot("tests-sheet");
await tap("[data-test='Анализ крови']", "test-blood-tap");
await p.waitForSelector(".event.test", { timeout: 15000 }); await sleep(1500); await shot("test-blood-result");
await ask("Какие лекарства принимаете постоянно?", "q3");
await ask("Не было чёрного стула?", "q4");
await tap("[data-sheet=exam]", "exam-tap");
await p.waitForSelector(".sheet"); await shot("exam-sheet");
await tap("[data-exam='Пальпация живота']", "exam-palp-tap");
await sleep(2500); await shot("exam-result");
await tap("[data-sheet=finish]", "finish-tap");
await p.waitForSelector("#dx"); await shot("finish-sheet");
await p.fill("#dx", "Язвенная болезнь ДПК, обострение, на фоне приёма НПВС"); await shot("finish-dx");
await p.fill("#tx", "Отменить ибупрофен. ЭГДС с тестом на H. pylori. Омепразол 20 мг 2 раза в сутки + амоксициллин + кларитромицин, 14 дней."); await shot("finish-tx", { tap: await rect("#finish-go") });
await p.click("#finish-go");
await sleep(1200); await shot("eval-wait");
await p.waitForSelector(".sheet .rating-big", { timeout: 30000 }); await sleep(1500); await shot("eval-top");
const sh = p.locator(".sheet .sheet-body, .sheet").first();
for (let k = 1; k <= 8; k++) {
  const done = await p.evaluate((k) => { const el = [...document.querySelectorAll(".sheet *, .sheet")].find((e) => e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== "visible"); if (!el) return true; const before = el.scrollTop; el.scrollTop = before + 600; return el.scrollTop === before; }, k);
  await sleep(700); await shot("eval-scroll-" + k);
  if (done) break;
}
fs.writeFileSync(OUT + "meta.json", JSON.stringify({ pid, token, meta }, null, 1));
await p.keyboard.press("Escape");
for (let i = 0; i < 60; i++) { const q = await api(token, "GET", `/quiz/${pid}`); if (q.quiz) break; await sleep(250); }
await p.goto(`${BASE}/app#/expert/${pid}`); await sleep(5000); await shot("expert-top");
for (let k = 1; k <= 6; k++) { await p.mouse.wheel(0, 600); await sleep(600); await shot("expert-scroll-" + k); }
await p.goto(`${BASE}/app#/quiz/${pid}`); await p.waitForSelector("[data-opt]"); await shot("quiz-q1");
for (let qn = 1; qn <= 3; qn++) {
  const right = [0, 2, 1][qn - 1], pick = qn === 2 ? 1 : right;
  await tap(`[data-opt='${pick}']`, `quiz-q${qn}-tap`);
  await sleep(700); await shot(`quiz-q${qn}-answered`);
  await p.locator("#quiz-next").scrollIntoViewIfNeeded(); await sleep(300); await shot(`quiz-q${qn}-explain`);
  await tap("#quiz-next", `quiz-q${qn}-next`); await sleep(700); await shot(`quiz-q${qn + 1}`);
}
await p.goto(`${BASE}/app#/`); await sleep(1500); await shot("home-after");
await p.goto(`${BASE}/app#/profile`); await sleep(1500); await shot("profile");
await p.goto(`${BASE}/app#/profile/stats`); await sleep(1500); await shot("stats");
await p.mouse.wheel(0, 700); await sleep(600); await shot("stats-2");
await p.goto(`${BASE}/app#/battles`); await sleep(1500); await shot("battles");
fs.writeFileSync(OUT + "meta.json", JSON.stringify({ pid, token, meta }, null, 1));
// экран входа для финала
const lc = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, hasTouch: true });
await addFont(lc);
await lc.addInitScript(() => localStorage.setItem("hmd_cookies", "1"));
const lp = await lc.newPage(); await lp.goto(`${BASE}/app`); await lp.waitForSelector("#login-btn[href]"); await sleep(500); await lp.screenshot({ path: OUT + "99-login.png" });
await browser.close();
