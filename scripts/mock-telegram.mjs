// Мок Telegram Bot API для локальных тестов: пишет все вызовы в JSONL и отвечает ok.
import http from "node:http";
import fs from "node:fs";

const LOG = process.env.TG_LOG || ".wrangler/tg-calls.jsonl";
let mid = 1000;
fs.mkdirSync(".wrangler", { recursive: true });
fs.writeFileSync(LOG, "");

// Мок API Точки (через «посредника»: /tochka?path=/uapi/...). Неделю не продаём — проверка ошибки банка.
const tochkaOps = new Map();
let opN = 0;
function tochka(req, res, body) {
  const u = new URL(req.url, "http://x");
  const path = u.searchParams.get("path") || "";
  let data = {};
  try { data = JSON.parse(body || "{}").Data || {}; } catch {}
  fs.appendFileSync(LOG, JSON.stringify({ method: `tochka ${req.method} ${path}`, ...data }) + "\n");
  const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
  const base = "/uapi/acquiring/v1.0";
  if (req.method === "POST" && (path === `${base}/payments` || path === `${base}/subscriptions`)) {
    if (String(data.purpose).includes("неделя")) return send(500, { message: "Bank says no" });
    const op = `${path.endsWith("subscriptions") ? "sub" : "pay"}_${++opN}`;
    tochkaOps.set(op, { amount: data.amount, purpose: data.purpose, consumerId: data.consumerId, sub: path.endsWith("subscriptions"), recurring: data.recurring, saveCard: data.saveCard });
    return send(200, { Data: { operationId: op, paymentLink: `https://pay.example/${op}` } });
  }
  let m = path.match(/\/payments\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const o = tochkaOps.get(m[1]);
    if (!o || o.sub) return send(404, { message: "not found" });
    return send(200, { Data: { Operation: [{ status: "APPROVED", amount: o.amount, purpose: o.purpose, consumerId: o.consumerId }] } });
  }
  m = path.match(/\/subscriptions\/([^/]+)\/status$/);
  if (m && req.method === "GET") {
    const o = tochkaOps.get(m[1]);
    return o ? send(200, { Data: { status: o.cancelled ? "Cancelled" : "Active", amount: o.amount, purpose: o.purpose, consumerId: o.consumerId } }) : send(404, {});
  }
  if (m && req.method === "POST") {
    const o = tochkaOps.get(m[1]);
    if (o) o.cancelled = true;
    return send(200, { Data: { status: data.status } });
  }
  m = path.match(/\/subscriptions\/([^/]+)\/charge$/);
  if (m && req.method === "POST") return send(200, { Data: { status: "APPROVED", operationId: `ch_${++opN}` } });
  return send(404, { message: `unknown ${path}` });
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url.startsWith("/tochka")) return tochka(req, res, body);
    if (req.url.includes("/file/")) {
      res.writeHead(200, { "Content-Type": "audio/ogg" });
      return res.end(Buffer.from("OggS-fake-audio"));
    }
    const method = req.url.split("/").pop();
    let data = {};
    try { data = JSON.parse(body || "{}"); } catch {}
    fs.appendFileSync(LOG, JSON.stringify({ method, ...data }) + "\n");
    let result = true;
    if (method === "sendMessage") result = { message_id: ++mid };
    if (method === "getFile") result = { file_path: "voice/file_1.oga" };
    // Фото профиля есть только у пользователя 777
    if (method === "getUserProfilePhotos") result = data.user_id === 777 ? { total_count: 1, photos: [[{ file_id: "ph_s", width: 160, height: 160 }, { file_id: "ph_b", width: 640, height: 640 }]] } : { total_count: 0, photos: [] };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, result }));
  });
}).listen(8790, () => console.log("mock telegram on :8790"));
