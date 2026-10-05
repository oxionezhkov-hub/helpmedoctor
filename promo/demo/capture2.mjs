// Досъёмка: разбор по КР и битва «Кто круче?» с одногруппником (тот же пользователь, что в capture.mjs)
import { createRequire } from "module";
import crypto from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8787", OUT = new URL("./shots/", import.meta.url).pathname;
const FONT_CSS = fs.readFileSync(new URL("./font/inter.css", import.meta.url), "utf8");
const addFont = (c) => c.addInitScript((css) => { const s = document.createElement("style"); s.textContent = css; document.documentElement.appendChild(s); }, FONT_CSS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const M = JSON.parse(fs.readFileSync(OUT + "meta.json"));
const { token, pid } = M;
function initData(uid, name) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(uid), first_name: name, username: `u${uid}` }) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update("123:TEST").digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}
const api = async (tok, method, path, body) => (await fetch(`${BASE}/api${path}`, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", deviceScaleFactor: 2, hasTouch: true });
await ctx.addInitScript((t) => { localStorage.setItem("hmd_token", t); localStorage.setItem("hmd_theme", "light"); localStorage.setItem("hmd_cookies", "1"); }, token);
await ctx.route(/telegram\.org|mc\.yandex/, (r) => r.abort());
await addFont(ctx);
const p = await ctx.newPage();
let n = 80;
async function shot(name, extra = {}) { await sleep(350); const file = `${++n}-${name}.png`; await p.screenshot({ path: OUT + file }); M.meta.push({ file, name, ...extra }); console.log("shot", file); }
async function rect(sel) { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }

// 1. Разбор по КР
if (!process.argv.includes("--battle-only")) {
await p.goto(`${BASE}/app#/patient/${pid}`);
await p.waitForSelector("[data-guide-req]");
await shot("kr-cta", { tap: await rect("[data-guide-req]") });
await p.click("[data-guide-req]");
await sleep(1200); await shot("kr-pending");
await p.waitForSelector(".guide .guide-head", { timeout: 60000 });
await p.locator(".guide").scrollIntoViewIfNeeded(); await sleep(800);
await p.evaluate(() => document.querySelector(".guide").scrollIntoView({ block: "start" })); await p.mouse.wheel(0, -70); await sleep(600);
await shot("kr-guide-1");
for (let k = 2; k <= 5; k++) { await p.mouse.wheel(0, 520); await sleep(600); await shot("kr-guide-" + k); }
} else { n = 87; M.meta = M.meta.filter((m) => !/battle|stats-after/.test(m.name)); }

// 2. Битва с одногруппником
const tb = (await api(null, "POST", "/auth/telegram", { initData: initData(String(6100 + Math.floor(Math.random() * 800)), "Кирилл") })).token;
await api(tb, "PATCH", "/profile", { name: "Кирилл", onboarding_done: true, level: "врач", profession: "Терапевт", specializations: ["гастроэнтерология"], difficulty: "medium" });
await p.goto(`${BASE}/app#/battles`); await p.waitForSelector("body"); await sleep(1200);
await shot("battles-empty", { tap: await rect("text=Новая битва") });
await p.click("text=Новая битва"); await sleep(1500); await shot("battle-invite");
const list = await api(token, "GET", "/battles");
const bt = (list.battles || []).find((x) => x.status !== "finished" && x.status !== "cancelled") || (await api(token, "POST", "/battles"));
const id = bt.id;
await api(tb, "POST", `/battles/${id}/join`); await sleep(1500); await shot("battle-joined");
await api(token, "POST", `/battles/${id}/start`);
let b; for (let i = 0; i < 80; i++) { b = await api(token, "GET", `/battles/${id}`); if (b.status === "active") break; await sleep(250); }
const bB = await api(tb, "GET", `/battles/${id}`);
for (const [tok, ppid, dx] of [[token, b.me.patient_id, "Язвенная болезнь ДПК"], [tb, bB.me.patient_id, "Хронический гастрит"]]) {
  await api(tok, "POST", `/patients/${ppid}/start`);
  await api(tok, "POST", `/patients/${ppid}/message`, { text: "Что вас беспокоит?" });
  await api(tok, "POST", `/patients/${ppid}/finish`, { type: "diagnosis", value: dx, treatment: "По КР" });
  await sleep(1500);
}
for (let i = 0; i < 120; i++) { b = await api(token, "GET", `/battles/${id}`); if (b.status === "finished") break; await sleep(300); }
await p.goto(`${BASE}/app#/battle/${id}`); await sleep(2000); await shot("battle-result");
await p.mouse.wheel(0, 500); await sleep(600); await shot("battle-result-2");
await p.goto(`${BASE}/app#/profile/stats`); await sleep(1500); await shot("stats-after");
fs.writeFileSync(OUT + "meta.json", JSON.stringify(M, null, 1));
await browser.close();
