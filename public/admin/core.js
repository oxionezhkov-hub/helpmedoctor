// Ядро админки: состояние, API, шаблоны, иконки, модальные окна, форматирование.

export const S = {
  token: null,
  me: null,
  admins: [],
  info: {},
  route: { name: "dashboard", params: {}, q: {} },
  period: { key: "30d", from: 0, to: 0 },
};

// ---------- Экранирование и шаблоны ----------
const RAW = Symbol("raw");
export const raw = (s) => ({ [RAW]: String(s) });
export function fmt(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(fmt).join("");
  if (typeof v === "object" && RAW in v) return v[RAW];
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ""); });
  return raw(out);
}
export const str = (h) => (h && typeof h === "object" && RAW in h ? h[RAW] : fmt(h));
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------- Иконки ----------
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/><path d="M22 21a7 7 0 0 0-5-6.7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9Z"/><path d="M2 9h20M12 21 8 9l4-6 4 6-4 12"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4Z"/>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5.5 5h13L21 13v6H3v-6Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
  tasks: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 2 2 4-4M7 15h10"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8S10.5 3 8 3.5 7 8 12 8Zm0 0s1.5-5 4-4.5S17 8 12 8Z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.7-3.6-7.2-.3 1.8-1.3 3-2.4 3.5.4-3.4-1-6.6-3.5-8.5.1 3-1.6 5.1-3.2 7C4.9 11.4 5 13.4 5 15.2 5 19.3 8 22 12 22Z"/>',
  steth: '<path d="M6 3H5v6a5 5 0 0 0 10 0V3h-1"/><path d="M10 14v1a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9V3"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  quiz: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>',
  telegram: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4Z"/><path d="m9 13 12-9"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16Z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  note: '<path d="M4 4h16v12l-4 4H4Z"/><path d="M16 20v-4h4"/>',
};
export const ic = (name, cls = "") => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`);

// ---------- Форматирование (всё по Москве) ----------
const TZ = "Europe/Moscow";
const dtf = (opts) => new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, ...opts });
const F_DATE = dtf({ day: "numeric", month: "short" });
const F_DATE_Y = dtf({ day: "numeric", month: "short", year: "numeric" });
const F_TIME = dtf({ hour: "2-digit", minute: "2-digit" });
const F_DT = dtf({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fDate = (ts) => (ts ? (new Date(ts).getFullYear() === new Date().getFullYear() ? F_DATE : F_DATE_Y).format(ts) : "—");
export const fTime = (ts) => (ts ? F_TIME.format(ts) : "");
export const fDT = (ts) => (ts ? F_DT.format(ts) : "—");
export function fAgo(ts) {
  if (!ts) return "—";
  const d = Date.now() - ts;
  if (d < 60000) return "только что";
  if (d < 3600000) return `${Math.floor(d / 60000)} мин назад`;
  if (d < 86400000) return `${Math.floor(d / 3600000)} ч назад`;
  if (d < 7 * 86400000) return `${Math.floor(d / 86400000)} дн назад`;
  return fDate(ts);
}
export const fNum = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export const fRub = (n) => (n == null ? "—" : `${fNum(n)} ₽`);
export const fUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(n > 0 && n < 1 ? 4 : 2)}`);
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, m = a % 10;
  if (a > 10 && a < 20) return many;
  if (m === 1) return one;
  if (m >= 2 && m <= 4) return few;
  return many;
}
/** Полночь МСК для даты YYYY-MM-DD */
export const mskDayStart = (day) => Date.parse(`${day}T00:00:00+03:00`);
export const mskDay = (ts) => new Date(ts + 3 * 3600000).toISOString().slice(0, 10);

export function hashHue(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
export function avatar(name, uid, size = "") {
  const letters = String(name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return html`<span class="av ${size}" style="--h:${hashHue(uid || name)}">${letters}</span>`;
}

export const LEVELS = { "студент": "Студент", "ординатор": "Ординатор", "врач": "Врач", "специалист": "Опытный специалист" };
export const SOURCES = { bot: "Бот", miniapp: "Мини-приложение", web: "Сайт", system: "Система", admin: "Админ" };
export const PLAN_LABELS = { day: "1 день", week: "1 неделя", month: "1 месяц", quarter: "3 месяца", year: "1 год", forever: "Навсегда", trial: "Пробный 7 дней", patients3: "+3 пациента", freeze: "Заморозка стрика", gift: "Подарок" };

export function subBadge(u) {
  if (u.sub_until === -1 || u.sub_until > Date.now()) {
    const until = u.sub_until === -1 ? "навсегда" : `до ${fDate(u.sub_until)}`;
    return u.sub_plan === "gift" ? html`<span class="badge info">${ic("gift", "sm")} Подарок ${until}</span>` : html`<span class="badge ok">${ic("gem", "sm")} ${PLAN_LABELS[u.sub_plan] || "Подписка"} ${until}</span>`;
  }
  if (u.sub_until > 0) return html`<span class="badge warn">Истекла ${fDate(u.sub_until)}</span>`;
  return html`<span class="badge">Бесплатно</span>`;
}

// ---------- API ----------
export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
export async function api(method, path, body) {
  const headers = {};
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try {
    r = await fetch(`/api/admin${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError("Нет соединения. Проверьте интернет.", 0, "network");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.code === "auth") {
    window.dispatchEvent(new CustomEvent("admin-logout"));
    throw new ApiError("Сессия истекла — войдите снова", 401, "auth");
  }
  if (!r.ok) throw new ApiError(data.error || `Ошибка ${r.status}`, r.status, data.code);
  return data;
}
export const q = (op, args = {}) => api("POST", "/q", { op, args });

// ---------- Хранилище браузера ----------
export function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {}
  return null;
}

// ---------- Тосты ----------
export function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  $("#toast-root").appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 5000 : 3000);
}

export function btnBusy(btn, on = true) {
  if (!btn) return;
  if (on) { btn.style.minWidth = `${btn.offsetWidth}px`; btn.classList.add("busy"); btn.disabled = true; }
  else { btn.classList.remove("busy"); btn.style.minWidth = ""; btn.disabled = false; }
}

/** Кнопка с загрузкой: выполняет fn, показывает ошибку тостом */
export async function withBusy(btn, fn) {
  btnBusy(btn);
  try {
    return await fn();
  } catch (e) {
    toast(e.message, "error");
    throw e;
  } finally {
    if (btn && document.body.contains(btn)) btnBusy(btn, false);
  }
}

// ---------- Модальные окна ----------
let modalStack = [];
export function openModal({ title, body, foot = "", wide = false, onClose = null, bind = null }) {
  const root = $("#modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-bg";
  wrap.innerHTML = str(html`<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${title}">
    <div class="modal-head"><h2>${title}</h2><button class="btn ghost sm icon" data-close aria-label="Закрыть">${ic("x")}</button></div>
    <div class="modal-body">${body}</div>
    ${foot ? html`<div class="modal-foot">${foot}</div>` : ""}
  </div>`);
  root.appendChild(wrap);
  const close = (silent = false) => {
    wrap.remove();
    modalStack = modalStack.filter((m) => m !== entry);
    document.body.style.overflow = modalStack.length ? "hidden" : "";
    if (!silent && onClose) onClose();
  };
  const entry = { wrap, close };
  modalStack.push(entry);
  document.body.style.overflow = "hidden";
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  $$("[data-close]", wrap).forEach((b) => (b.onclick = () => close()));
  const el = $(".modal", wrap);
  if (bind) bind(el, close);
  setTimeout(() => $("input:not([type=checkbox]):not([type=hidden]), textarea, select", el)?.focus(), 30);
  return { el, close };
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalStack.length) modalStack[modalStack.length - 1].close();
});

export function confirmDialog(title, text, okLabel = "Да", danger = false) {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title,
      body: html`<p>${text}</p>`,
      foot: html`<button class="btn ghost" data-no>Отмена</button><button class="btn ${danger ? "danger" : ""}" data-yes>${okLabel}</button>`,
      onClose: () => { if (!done) resolve(false); },
      bind: (el, close) => {
        $("[data-no]", el).onclick = () => { done = true; close(true); resolve(false); };
        $("[data-yes]", el).onclick = () => { done = true; close(true); resolve(true); };
      },
    });
  });
}

// ---------- Подсказки при наведении (графики, ячейки) ----------
const tip = () => $("#tip");
document.addEventListener("pointermove", (e) => {
  const t = e.target.closest?.("[data-tip]");
  const el = tip();
  if (!el) return;
  if (!t) { el.hidden = true; return; }
  el.textContent = t.getAttribute("data-tip");
  el.hidden = false;
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  el.style.left = `${Math.max(8, x)}px`;
  el.style.top = `${Math.max(8, y)}px`;
});
document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.("[data-tip]")) { const el = tip(); if (el) el.hidden = true; } });
document.addEventListener("scroll", () => { const el = tip(); if (el) el.hidden = true; }, true);

// ---------- CSV ----------
export function downloadCsv(name, columns, rows) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(";"), ...rows.map((r) => columns.map((c) => esc(typeof c.value === "function" ? c.value(r) : r[c.key])).join(";"))];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${name}-${mskDay(Date.now())}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------- Таблица с сортировкой ----------
/**
 * @param {{columns: {key, label, render?, sort?, cls?, value?}[], rows: any[], sort?: {key, dir}, onSort?, rowAttrs?, empty?}} o
 */
export function table(o) {
  const { columns, rows, sort, rowAttrs, empty = "Пусто" } = o;
  if (!rows.length) return html`<div class="empty">${ic("inbox")}${empty}</div>`;
  return html`<div class="table-wrap"><table class="t"><thead><tr>${columns.map((c) => html`<th class="${c.cls || ""} ${c.sort ? "sortable" : ""}" ${c.sort ? raw(`data-sort="${fmt(c.key)}"`) : ""}>${c.label}${sort?.key === c.key ? html` <span class="arrow">${sort.dir === "asc" ? "↑" : "↓"}</span>` : ""}</th>`)}</tr></thead>
    <tbody>${rows.map((r) => html`<tr ${rowAttrs ? raw(rowAttrs(r)) : ""}>${columns.map((c) => html`<td class="${c.cls || ""}">${c.render ? c.render(r) : r[c.key] ?? "—"}</td>`)}</tr>`)}</tbody></table></div>`;
}

/** Сортировка на клиенте для небольших таблиц */
export function sortRows(rows, key, dir = "desc") {
  const k = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * k;
  });
}

// ---------- Период ----------
export const PERIODS = [
  ["today", "Сегодня"], ["7d", "7 дней"], ["14d", "14 дней"], ["30d", "30 дней"], ["90d", "90 дней"], ["custom", "Свои даты"],
];
export function periodRange(key, custom = {}) {
  const now = Date.now();
  const today = mskDayStart(mskDay(now));
  const end = now + 60000;
  if (key === "today") return { from: today, to: end };
  const days = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 }[key];
  if (days) return { from: today - (days - 1) * 86400000, to: end };
  const from = custom.from ? mskDayStart(custom.from) : today - 29 * 86400000;
  const to = custom.to ? mskDayStart(custom.to) + 86400000 : end;
  return { from, to: Math.max(from + 3600000, to) };
}
export function setPeriod(key, custom) {
  const r = periodRange(key, custom);
  S.period = { key, ...r, custom: custom || S.period.custom };
  store("adm_period", JSON.stringify({ key, custom: S.period.custom }));
}
export function periodPicker() {
  const p = S.period;
  return html`<div class="row wrap" data-period>
    <div class="seg">${PERIODS.map(([k, l]) => html`<button data-p="${k}" class="${p.key === k ? "on" : ""}">${l}</button>`)}</div>
    ${p.key === "custom" ? html`<div class="row"><input type="date" class="input" style="width:auto" data-pfrom value="${p.custom?.from || mskDay(p.from)}"><span class="muted">—</span><input type="date" class="input" style="width:auto" data-pto value="${p.custom?.to || mskDay(p.to - 1)}"></div>` : ""}
  </div>`;
}
export function bindPeriod(el, onChange) {
  $$("[data-p]", el).forEach((b) => (b.onclick = () => { setPeriod(b.dataset.p, S.period.custom); onChange(); }));
  const f = $("[data-pfrom]", el), t = $("[data-pto]", el);
  const upd = () => { if (f.value && t.value) { setPeriod("custom", { from: f.value, to: t.value }); onChange(); } };
  if (f) f.onchange = upd;
  if (t) t.onchange = upd;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
