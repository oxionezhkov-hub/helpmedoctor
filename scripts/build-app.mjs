// Сборка веб-приложения перед деплоем (только в CI, результат не коммитится):
// сжимает public/app.js и public/app.css и ставит в app.html версию файлов (?v=хеш содержимого).
// Файлы с версией браузер хранит у себя и не скачивает заново, пока код не изменится (см. assetCache в src/index.js);
// сама страница app.html маленькая и всегда проверяется у сервера — после деплоя она ссылается на новую версию.
// Запуск: node scripts/build-app.mjs  (esbuild приходит вместе с wrangler)
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = (f) => join(ROOT, "public", f);
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 10);

let page = readFileSync(pub("app.html"), "utf8");
for (const [file, loader] of [["app.js", "js"], ["app.css", "css"]]) {
  const src = readFileSync(pub(file), "utf8");
  // Без понижения синтаксиса (target не задан): код и стили остаются теми же, убираются только пробелы и комментарии
  const { code } = await transform(src, { loader, minify: true, format: loader === "js" ? "esm" : undefined, legalComments: "none" });
  writeFileSync(pub(file), code);
  const re = new RegExp(`"/${file.replace(".", "\\.")}(\\?v=[\\w]+)?"`, "g");
  if (!re.test(page)) throw new Error(`В app.html нет ссылки на /${file}`);
  page = page.replace(re, `"/${file}?v=${hash(code)}"`);
  console.log(`✓ ${file}: ${Math.round(src.length / 1024)} → ${Math.round(code.length / 1024)} КБ`);
}
writeFileSync(pub("app.html"), page);
console.log("✓ app.html: ссылки с версией файлов");
