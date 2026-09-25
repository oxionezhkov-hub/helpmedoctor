// Мок Telegram Bot API для локальных тестов: пишет все вызовы в JSONL и отвечает ok.
import http from "node:http";
import fs from "node:fs";

const LOG = process.env.TG_LOG || ".wrangler/tg-calls.jsonl";
let mid = 1000;
fs.mkdirSync(".wrangler", { recursive: true });
fs.writeFileSync(LOG, "");

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
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
