// Документы в админке — страницы в духе Notion: Markdown, правка прямо на странице по блокам, быстрые идеи.
// Хранятся только в HubDO (не в репозитории): сюда кладут внутреннюю стратегию, планы и черновики.
import { ADMIN_NAMES } from "../config.js";
import { UserError } from "./util.js";

const MAX_BODY = 300_000; // ~300 КБ Markdown на страницу
const err = (m, code = "docs") => new UserError(m, code);

export function initDocTables(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, title TEXT, icon TEXT, body TEXT, pos INTEGER DEFAULT 0,
    created_at INTEGER, created_by TEXT, updated_at INTEGER, updated_by TEXT)`);
}

const who = (admin) => ADMIN_NAMES[admin] || (admin ? `админ ${admin}` : "");
const cleanTitle = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 200) || "Без названия";
const cleanIcon = (i) => [...String(i || "").trim()].slice(0, 2).join("");

/** Markdown-файл → заголовок из первой строки «# …» и тело без неё */
export function splitTitle(md) {
  const text = String(md || "").replace(/\r\n?/g, "\n");
  const m = /^\s*#\s+(.+)\n?/.exec(text);
  return m ? { title: m[1].trim(), body: text.slice(m[0].length).replace(/^\n+/, "") } : { title: "", body: text };
}

/** Идея в раздел «## Идеи» в конце страницы (раздела нет — создаём) */
export function appendIdea(body, line) {
  const text = String(body || "").replace(/\s+$/, "");
  const re = /^##\s+Идеи\s*$/m;
  if (!re.test(text)) return `${text}${text ? "\n\n" : ""}## Идеи\n\n${line}\n`;
  // Вставляем в конец раздела «Идеи» — перед следующим заголовком того же или более высокого уровня
  const start = text.search(re);
  const after = text.slice(start).split("\n");
  let end = after.length;
  for (let i = 1; i < after.length; i++) if (/^#{1,2}\s/.test(after[i])) { end = i; break; }
  const section = after.slice(0, end).join("\n").replace(/\s+$/, "");
  const rest = after.slice(end).join("\n");
  return `${text.slice(0, start)}${section}\n${line}\n${rest ? `\n${rest}` : ""}`.replace(/\s+$/, "") + "\n";
}

const row = (h, id) => h.one("SELECT * FROM docs WHERE id = ?", String(id || ""));

export const DOC_OPS = {
  docs: (h) => ({
    rows: h.all("SELECT id, title, icon, pos, created_at, updated_at, updated_by, length(body) AS size FROM docs ORDER BY pos ASC, created_at ASC")
      .map((d) => ({ ...d, updated_by_name: who(d.updated_by) })),
  }),
  doc: (h, a) => {
    const d = row(h, a.id);
    if (!d) throw err("Страница не найдена — возможно, её удалили", "not_found");
    return { doc: { ...d, updated_by_name: who(d.updated_by), created_by_name: who(d.created_by) } };
  },
  doc_create: (h, a, admin) => {
    let { title, body } = { title: a.title, body: a.body };
    if (a.markdown) ({ title, body } = (() => { const s = splitTitle(a.markdown); return { title: title || s.title, body: s.body }; })());
    body = String(body || "");
    if (body.length > MAX_BODY) throw err("Слишком большой текст — до 300 КБ на страницу");
    const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const pos = (h.one("SELECT MAX(pos) AS m FROM docs")?.m ?? -1) + 1;
    const now = Date.now();
    h.sql.exec("INSERT INTO docs (id, title, icon, body, pos, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, cleanTitle(title), cleanIcon(a.icon) || "📄", body, pos, now, String(admin), now, String(admin));
    h.audit?.(admin, "doc_create", id, { title: cleanTitle(title) });
    return { ok: true, id };
  },
  // Сохранение всей страницы. base — updated_at, с которого начали правку: если страницу успели изменить, не затираем
  doc_save: (h, a, admin) => {
    const d = row(h, a.id);
    if (!d) throw err("Страница не найдена — возможно, её удалили", "not_found");
    if (a.base && Number(a.base) !== d.updated_at) throw err(`Страницу только что изменил${d.updated_by ? ` ${who(d.updated_by)}` : "и"} — открываем свежую версию`, "conflict");
    const body = a.body != null ? String(a.body) : d.body;
    if (body.length > MAX_BODY) throw err("Слишком большой текст — до 300 КБ на страницу");
    const now = Math.max(Date.now(), d.updated_at + 1);
    h.sql.exec("UPDATE docs SET title = ?, icon = ?, body = ?, updated_at = ?, updated_by = ? WHERE id = ?",
      a.title != null ? cleanTitle(a.title) : d.title, a.icon != null ? cleanIcon(a.icon) || "📄" : d.icon, body, now, String(admin), d.id);
    return { ok: true, updated_at: now };
  },
  // Быстрая идея: дописываем строку на сервере, без base — две идеи от двух админов не затрут друг друга
  doc_idea: (h, a, admin) => {
    const d = row(h, a.id);
    if (!d) throw err("Страница не найдена — возможно, её удалили", "not_found");
    const text = String(a.text || "").replace(/\s+/g, " ").trim().slice(0, 1000);
    if (!text) throw err("Напишите идею");
    const date = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10).split("-").reverse().slice(0, 2).join(".");
    const body = appendIdea(d.body, `- [ ] ${text} — ${who(admin) || "админ"}, ${date}`);
    if (body.length > MAX_BODY) throw err("Страница переполнена — перенесите часть идей на новую страницу");
    const now = Math.max(Date.now(), d.updated_at + 1);
    h.sql.exec("UPDATE docs SET body = ?, updated_at = ?, updated_by = ? WHERE id = ?", body, now, String(admin), d.id);
    return { ok: true, updated_at: now, body };
  },
  doc_delete: (h, a, admin) => {
    const d = row(h, a.id);
    if (!d) return { ok: true };
    h.sql.exec("DELETE FROM docs WHERE id = ?", d.id);
    h.audit?.(admin, "doc_delete", d.id, { title: d.title });
    return { ok: true };
  },
};
