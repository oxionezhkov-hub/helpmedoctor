// IndexNow: сообщает Яндексу и Bing об адресах из sitemap.xml, чтобы их быстрее переобошли.
// Запускается последним шагом деплоя. Ключ — публичный файл public/<ключ>.txt (так требует протокол).
import fs from "node:fs";

const HOST = "helpmedoctor.ru";
const KEY = "a5aa31d988a1097e73ee35407171e21d";
const urls = [...fs.readFileSync("public/sitemap.xml", "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls });

for (const endpoint of ["https://yandex.com/indexnow", "https://www.bing.com/indexnow"]) {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body });
    console.log(endpoint, r.status, `(${urls.length} адресов)`);
  } catch (e) {
    console.log(endpoint, "ошибка:", e.message);
  }
}
