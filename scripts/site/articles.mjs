// Статьи блога. Текст — HTML без обёртки; заголовки разделов — <h2>.
// Новые статьи — отдельными файлами в scripts/site/posts/<slug>.mjs (export default { … }), формат и правила —
// .claude/skills/blog-article/SKILL.md. После правок: node scripts/build-site.mjs (пересобирает public/blog, главную и sitemap.xml)
import fs from "node:fs";

const BASE = [];

// Статьи из отдельных файлов; порядок в блоге — от новых к старым
const dir = new URL("./posts/", import.meta.url);
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".mjs")).sort() : [];
const POSTS = await Promise.all(files.map(async (f) => ({ ...(await import(new URL(f, dir))).default, file: f })));

export const ARTICLES = [...POSTS, ...BASE].sort((a, b) => b.date.localeCompare(a.date));
