// Документы — страницы в духе Notion: Markdown, правка по клику прямо на странице (блоками), чекбоксы,
// быстрые идеи в раздел «Идеи», импорт и выгрузка .md. Хранятся в HubDO (src/lib/docs.js), не в репозитории.
import { S, $, $$, q, html, raw, str, ic, fAgo, toast, withBusy, openModal, confirmDialog } from "./core.js";

// ---------- Markdown → HTML (свой маленький разборщик: заголовки, списки, чекбоксы, таблицы, цитаты) ----------
function inline(text) {
  let s = str(html`${text}`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const href = u.replace(/&amp;/g, "&");
    if (!/^(https?:\/\/|\/|#)/.test(href)) return m;
    return `<a href="${str(html`${href}`)}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ""}>${t}</a>`;
  });
  return s;
}

/** Разбиение текста на блоки: пустая строка, заголовок и линия — границы блока */
export function toBlocks(body) {
  const blocks = [];
  let cur = [];
  const flush = () => { if (cur.length) blocks.push(cur.join("\n")); cur = []; };
  for (const line of String(body || "").replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim()) { flush(); continue; }
    if (/^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); blocks.push(line); continue; }
    cur.push(line);
  }
  flush();
  return blocks;
}
const fromBlocks = (blocks) => blocks.filter((b) => b.trim()).join("\n\n") + "\n";

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
function renderList(lines) {
  // Вложенность — по отступу; номер строки в блоке нужен, чтобы переключать чекбокс
  let out = "";
  const stack = [];
  lines.forEach((line, n) => {
    const m = LIST_RE.exec(line);
    if (!m) { out += `<div class="doc-cont">${inline(line.trim())}</div>`; return; }
    const depth = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
    const tag = /\d/.test(m[2]) ? "ol" : "ul";
    while (stack.length > depth + 1) out += `</li></${stack.pop()}>`;
    if (stack.length === depth + 1) out += "</li>";
    while (stack.length < depth + 1) { out += `<${tag}>`; stack.push(tag); }
    const cb = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
    out += cb
      ? `<li class="todo${cb[1] !== " " ? " done" : ""}"><input type="checkbox" data-line="${n}"${cb[1] !== " " ? " checked" : ""}><span>${inline(cb[2])}</span>`
      : `<li>${inline(m[3])}`;
  });
  while (stack.length) out += `</li></${stack.pop()}>`;
  return out;
}

function renderTable(lines) {
  const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l)).map(cells);
  const [head, ...body] = rows;
  return `<div class="doc-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderBlock(src) {
  const lines = src.split("\n");
  const h = /^(#{1,6})\s+(.*)$/.exec(lines[0]);
  if (h && lines.length === 1) { const lv = Math.min(4, h[1].length + 1); return `<h${lv}>${inline(h[2])}</h${lv}>`; }
  if (/^(-{3,}|\*{3,})\s*$/.test(src)) return "<hr>";
  if (lines.every((l) => l.trim().startsWith("|"))) return renderTable(lines);
  if (LIST_RE.test(lines[0])) return renderList(lines);
  if (lines.every((l) => l.startsWith(">"))) return `<blockquote>${lines.map((l) => inline(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`;
  return `<p>${lines.map(inline).join("<br>")}</p>`;
}

// ---------- Страница раздела ----------
let cache = { list: null, doc: null };

export async function viewDocs(el, ctx) {
  const id = S.route.params.id;
  const [list, docRes] = await Promise.all([q("docs"), id ? q("doc", { id }).catch((e) => ({ error: e })) : null]);
  if (!ctx.isCurrent()) return;
  cache.list = list.rows;
  if (docRes?.error) { toast(docRes.error.message, "error"); location.hash = "#/docs"; return; }
  cache.doc = docRes?.doc || null;
  if (cache.doc) ctx.setTitle(cache.doc.title);
  el.innerHTML = str(html`<div class="docs ${cache.doc ? "has-doc" : ""}">
    <aside class="docs-side">
      <button class="btn block" id="doc-new">${ic("plus", "sm")}<span>Новая страница</span></button>
      <nav class="docs-list">${list.rows.length ? list.rows.map((d) => html`<a class="docs-item ${d.id === id ? "on" : ""}" href="#/docs/${d.id}"><span class="docs-ico">${d.icon || "📄"}</span><span class="grow ellipsis">${d.title}</span></a>`)
        : html`<p class="small muted">Пока пусто. Создайте страницу или импортируйте .md — например, итоги обсуждения стратегии.</p>`}</nav>
    </aside>
    <section class="docs-main">${cache.doc ? raw("") : html`<div class="card empty">${ic("tasks")}<div>Выберите страницу слева или создайте новую.</div><p class="small muted">Страницы правятся прямо на месте: нажмите на любой абзац, таблицу или список — откроется Markdown этого куска. Идеи накидываются строкой внизу страницы.</p></div>`}</section>
  </div>`);
  $("#doc-new").onclick = () => newDocModal();
  if (cache.doc) renderDoc($(".docs-main", el));
}

function renderDoc(root) {
  const d = cache.doc;
  const blocks = toBlocks(d.body);
  root.innerHTML = str(html`<article class="doc">
    <a class="docs-back small" href="#/docs">${ic("back", "sm")} Все страницы</a>
    <div class="doc-head">
      <button class="doc-icon" id="doc-icon" title="Сменить значок">${d.icon || "📄"}</button>
      <h1 class="doc-title" id="doc-title" contenteditable="true" spellcheck="true">${d.title}</h1>
      <div class="row small muted doc-meta"><span class="grow">Изменено ${fAgo(d.updated_at)}${d.updated_by_name ? ` · ${d.updated_by_name}` : ""}</span>
        <button class="btn ghost sm" id="doc-raw" title="Править весь текст в Markdown">${ic("edit", "sm")}<span class="desk-only">Весь текст</span></button>
        <button class="btn ghost sm" id="doc-dl" title="Скачать .md">${ic("download", "sm")}</button>
        <button class="btn ghost sm" id="doc-del" title="Удалить страницу">${ic("trash", "sm")}</button></div>
    </div>
    <div class="doc-body" id="doc-body">${blocks.map((b, i) => raw(`<div class="doc-block" data-i="${i}">${renderBlock(b)}</div>`))}</div>
    <button class="doc-add" id="doc-add">${ic("plus", "sm")}<span>Добавить блок</span></button>
    <form class="doc-idea" id="doc-idea"><span class="doc-idea-ico">💡</span><input class="input" id="doc-idea-text" placeholder="Накинуть идею — попадёт в раздел «Идеи» с вашим именем и датой" maxlength="1000"><button class="btn sm">Добавить</button></form>
    <p class="tiny muted doc-hint">Нажмите на любой блок, чтобы править его Markdown: **жирный**, *курсив*, «- » список, «- [ ] » задача, «## » заголовок, таблица через «|». Пустой блок удаляется. Ctrl+Enter — сохранить, Esc — отменить.</p>
  </article>`);
  bindDoc(root, blocks);
}

async function save(patch) {
  const d = cache.doc;
  try {
    const r = await q("doc_save", { id: d.id, base: d.updated_at, ...patch });
    Object.assign(d, patch, { updated_at: r.updated_at, updated_by_name: S.me?.name || d.updated_by_name });
    const item = $(`.docs-item[href="#/docs/${d.id}"]`);
    if (item && (patch.title || patch.icon)) item.innerHTML = str(html`<span class="docs-ico">${d.icon || "📄"}</span><span class="grow ellipsis">${d.title}</span>`);
    return true;
  } catch (e) {
    toast(e.message, "error");
    if (e.code === "conflict") reloadDoc();
    return false;
  }
}

async function reloadDoc() {
  const r = await q("doc", { id: cache.doc.id });
  cache.doc = r.doc;
  const main = $(".docs-main");
  if (main) renderDoc(main);
}

function bindDoc(root, blocks) {
  const d = cache.doc;
  const body = $("#doc-body", root);
  const saveBlocks = () => save({ body: fromBlocks(blocks) });

  // Заголовок страницы: правится на месте, Enter — готово
  const title = $("#doc-title", root);
  title.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } };
  title.onblur = () => {
    const t = title.textContent.replace(/\s+/g, " ").trim() || "Без названия";
    if (t !== d.title) save({ title: t }).then((ok) => ok && (document.title = `${t} · Админка`, ($("#title").textContent = t)));
  };
  $("#doc-icon", root).onclick = () => {
    const v = prompt("Значок страницы (эмодзи):", d.icon || "📄");
    if (v != null && v.trim()) save({ icon: v.trim() }).then((ok) => ok && ($("#doc-icon", root).textContent = d.icon));
  };

  // Блок → поле Markdown по клику
  const edit = (i, isNew = false) => {
    const cell = $(`.doc-block[data-i="${i}"]`, body);
    if (!cell || cell.classList.contains("editing")) return;
    const before = blocks[i] || "";
    cell.classList.add("editing");
    cell.innerHTML = str(html`<textarea class="doc-edit" spellcheck="true" rows="1">${before}</textarea>`);
    const ta = $("textarea", cell);
    const fit = () => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight + 2}px`; };
    fit();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const val = ta.value.replace(/\s+$/, "");
      if (commit && val !== before) {
        // Пустая строка внутри поля делит блок на несколько — пересобираем страницу целиком
        const next = [...blocks.slice(0, i), ...toBlocks(val), ...blocks.slice(i + 1)];
        blocks.splice(0, blocks.length, ...next);
        if (await saveBlocks()) return renderDoc(root);
        return reloadDoc();
      }
      if (isNew && !before) { blocks.splice(i, 1); return renderDoc(root); }
      cell.classList.remove("editing");
      cell.innerHTML = renderBlock(before);
    };
    ta.oninput = fit;
    ta.onblur = () => finish(true);
    ta.onkeydown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ta.blur(); }
    };
  };
  body.addEventListener("click", (e) => {
    if (e.target.closest("a, input, textarea")) return;
    if ($(".doc-block.editing", body)) return; // первый клик мимо — только сохраняет открытый блок
    const cell = e.target.closest(".doc-block");
    if (cell && !getSelection()?.toString()) edit(Number(cell.dataset.i));
  });
  // Чекбокс задачи — переключаем «[ ]» ↔ «[x]» в нужной строке блока
  body.addEventListener("change", (e) => {
    const cb = e.target.closest("input[type=checkbox][data-line]");
    if (!cb) return;
    const i = Number(cb.closest(".doc-block").dataset.i);
    const lines = blocks[i].split("\n");
    const n = Number(cb.dataset.line);
    lines[n] = lines[n].replace(/\[( |x|X)\]/, cb.checked ? "[x]" : "[ ]");
    blocks[i] = lines.join("\n");
    cb.closest("li")?.classList.toggle("done", cb.checked);
    saveBlocks();
  });
  $("#doc-add", root).onclick = () => {
    blocks.push("");
    body.insertAdjacentHTML("beforeend", `<div class="doc-block" data-i="${blocks.length - 1}"></div>`);
    edit(blocks.length - 1, true);
  };

  // Быстрая идея — дописывается на сервере в раздел «Идеи»
  $("#doc-idea", root).onsubmit = (e) => {
    e.preventDefault();
    const inp = $("#doc-idea-text", root);
    const text = inp.value.trim();
    if (!text) return inp.focus();
    withBusy($("button", e.currentTarget), async () => {
      const r = await q("doc_idea", { id: d.id, text });
      Object.assign(d, { body: r.body, updated_at: r.updated_at, updated_by_name: S.me?.name || d.updated_by_name });
      toast("Идея записана", "ok");
      renderDoc(root);
      $("#doc-idea-text", root)?.focus();
    });
  };

  $("#doc-raw", root).onclick = () => rawModal();
  $("#doc-dl", root).onclick = () => {
    const blob = new Blob([`# ${d.title}\n\n${d.body}`], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${d.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "page"}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("#doc-del", root).onclick = async () => {
    if (!(await confirmDialog("Удалить страницу?", `«${d.title}» удалится для всех админов. Перед удалением можно скачать .md.`, "Удалить", true))) return;
    await q("doc_delete", { id: d.id });
    toast("Страница удалена");
    location.hash = "#/docs";
  };
}

/** Весь текст страницы одним полем — для больших правок и вставки */
function rawModal() {
  const d = cache.doc;
  openModal({
    title: "Весь текст (Markdown)",
    wide: true,
    body: html`<textarea class="input doc-raw" id="doc-raw-text" spellcheck="true">${d.body}</textarea>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="doc-raw-ok">Сохранить</button>`,
    bind: (m, close) => {
      $("#doc-raw-ok", m).onclick = (e) => withBusy(e.currentTarget, async () => {
        if (await save({ body: $("#doc-raw-text", m).value })) { close(true); renderDoc($(".docs-main")); toast("Сохранено", "ok"); }
      });
    },
  });
}

function newDocModal() {
  openModal({
    title: "Новая страница",
    body: html`<div class="stack">
      <div class="row" style="gap:8px"><input class="input" id="nd-icon" value="📄" maxlength="4" style="width:64px;text-align:center"><input class="input grow" id="nd-title" placeholder="Название, например: Стратегия" maxlength="200"></div>
      <label class="field"><span>Или импортировать Markdown — файл .md или вставьте текст</span>
        <input type="file" id="nd-file" accept=".md,.markdown,.txt,text/markdown,text/plain"></label>
      <textarea class="input" id="nd-md" rows="6" placeholder="# Заголовок&#10;&#10;Текст страницы…"></textarea>
      <p class="small muted">Если текст начинается с «# Заголовок», он станет названием страницы.</p>
    </div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="nd-ok">Создать</button>`,
    bind: (m, close) => {
      $("#nd-file", m).onchange = async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 300_000) return toast("Файл больше 300 КБ", "error");
        $("#nd-md", m).value = await f.text();
      };
      $("#nd-ok", m).onclick = (e) => withBusy(e.currentTarget, async () => {
        const md = $("#nd-md", m).value;
        const r = await q("doc_create", { title: $("#nd-title", m).value.trim(), icon: $("#nd-icon", m).value, ...(md.trim() ? { markdown: md } : { body: "" }) });
        close(true);
        location.hash = `#/docs/${r.id}`;
      });
    },
  });
}
