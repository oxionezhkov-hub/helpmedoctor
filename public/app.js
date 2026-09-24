// =====================================================
// Help me, Doctor — веб-приложение (работает и в Telegram, и в браузере)
// Без сборки: чистый ES-модуль. Данные — /api, живая синхронизация — WebSocket.
// =====================================================

// Скрипт Telegram грузим только когда нас открыли из Telegram — в браузере он не нужен
const TG_LAUNCH = /tgWebApp/.test(location.hash + location.search) || sessionStore("hmd_tg") === "1";
let tg = null;
let IN_TG = false;

function sessionStore(key, val) {
  try {
    if (val === undefined) return sessionStorage.getItem(key);
    sessionStorage.setItem(key, val);
  } catch {}
  return null;
}

function loadTelegramSdk() {
  if (!TG_LAUNCH) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js?57";
    s.onload = s.onerror = resolve;
    document.head.appendChild(s);
    setTimeout(resolve, 5000);
  });
}
const root = document.getElementById("app");
const sheetRoot = document.getElementById("sheet-root");
const toastRoot = document.getElementById("toast-root");
const TOKEN_KEY = "hmd_token";
const IS_TOUCH = matchMedia("(pointer: coarse)").matches;

const S = {
  token: null,
  me: null,            // снимок: профиль, пациенты, тесты, конфиг
  patients: new Map(), // id -> { patient, quiz } полные карточки
  route: { name: "home", params: {} },
  ws: null,
  wsOk: false,
  typing: new Set(),   // пациенты, которые «печатают»
  inflight: new Set(), // пациенты с запросом в процессе (с этой вкладки)
  expectNewPatient: 0, // когда нажали «Новый пациент» на этой вкладке
  evalWaiting: null,   // id пациента, чей разбор ждём в открытом листе
};

// ---------------------------------------------------
// Утилиты
// ---------------------------------------------------
const RAW = Symbol("raw");
const raw = (s) => ({ [RAW]: String(s) });
function fmt(v) {
  if (v == null || v === false) return "";
  if (Array.isArray(v)) return v.map(fmt).join("");
  if (typeof v === "object" && RAW in v) return v[RAW];
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function html(strings, ...vals) {
  let out = "";
  strings.forEach((s, i) => { out += s + (i < vals.length ? fmt(vals[i]) : ""); });
  return raw(out);
}
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- Иконки (линейные SVG в едином стиле) ----------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/><path d="M22 21a7 7 0 0 0-5-6.7"/>',
  quiz: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.7-3.6-7.2-.3 1.8-1.3 3-2.4 3.5.4-3.4-1-6.6-3.5-8.5.1 3-1.6 5.1-3.2 7C4.9 11.4 5 13.4 5 15.2 5 19.3 8 22 12 22Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5v14l11-7Z"/>',
  repeat: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>',
  flask: '<path d="M9 3h6"/><path d="M10 3v6L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9V3"/><path d="M7.5 15h9"/>',
  steth: '<path d="M6 3H5v6a5 5 0 0 0 10 0V3h-1"/><path d="M10 14v1a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>',
  card: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 10h6M9 14h6M9 18h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4Z"/>',
  gem: '<path d="M6 3h12l4 6-10 12L2 9Z"/><path d="M2 9h20M12 21 8 9l4-6 4 6-4 12"/>',
  pill: '<path d="m10.5 20.5 10-10a4.9 4.9 0 0 0-7-7l-10 10a4.9 4.9 0 0 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z"/><path d="M4 21a2 2 0 0 1 2-2h14"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5.5 5h13L21 13v6H3v-6Z"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
  alien: '<path d="M12 3C7.6 3 4 6.2 4 10.3 4 15.3 9 21 12 21s8-5.7 8-10.7C20 6.2 16.4 3 12 3Z"/><path d="M7.5 11c1.8 0 3 .9 3.5 2.3-1.8.3-3.5-.6-3.5-2.3ZM16.5 11c-1.8 0-3 .9-3.5 2.3 1.8.3 3.5-.6 3.5-2.3Z"/>',
  logout: '<path d="M9 21H5V3h4M16 17l5-5-5-5M21 12H9"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/><path d="M3.5 12h4l2-3 3 6 2-3h6" class="pulse"/>',
  telegram: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4Z"/><path d="m9 13 12-9"/>',
  party: '<path d="M4 20 9 7l8 8Z"/><path d="M14 4v2M19 9h2M17 3l-1 2M20 6l-2 1"/>',
  sad: '<circle cx="12" cy="12" r="9"/><path d="M8 16a5 5 0 0 1 8 0M9 9.5h.01M15 9.5h.01"/>',
};
const ic = (name, cls = "") => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`);

function hashHue(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
/** Аватар пациента: цветной кружок с инициалами (у инопланетянина — своя иконка) */
function patAvatar(p, size = "") {
  if (p.is_alien) return html`<div class="pav alien ${size}">${ic("alien")}</div>`;
  const letters = String(p.name || "?").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return html`<div class="pav ${size}" style="--h:${hashHue(p.name)}">${letters}</div>`;
}
function starsRow(n) {
  const r = Math.round(n);
  return html`<span class="stars">${[0, 1, 2, 3, 4].map((i) => ic("star", i < r ? "on" : ""))}</span>`;
}

// ---------- Ожидание с оценкой времени ----------
// Средняя длительность операций (мс) — подстраивается под реальную скорость и хранится в браузере
const ETA_DEFAULT = { patient: 16000, reply: 5000, test: 7000, exam: 6000, finish: 5000, evaluation: 22000, voice: 7000, quiz: 40000 };
const ETA_STEPS = {
  patient: ["Выбираем клинический случай", "Пишем анамнез", "Продумываем характер", "Готовим карточку"],
  evaluation: ["Эксперт изучает диалог", "Сверяет диагноз", "Оценивает лечение", "Пишет разбор"],
  test: ["Берём материал", "Лаборатория работает", "Оформляем протокол"],
  exam: ["Осматриваем пациента", "Записываем находки"],
  voice: ["Загружаем запись", "Распознаём речь", "Пациент отвечает"],
  reply: ["Пациент думает"],
  finish: ["Пациент прощается"],
  quiz: ["Эксперт составляет тест"],
};
function etaEstimate(kind) {
  const v = Number(store(`hmd_eta_${kind}`));
  return v > 500 && v < 120000 ? v : ETA_DEFAULT[kind] || 8000;
}
function etaRecord(kind, ms) {
  if (ms < 300 || ms > 120000) return;
  store(`hmd_eta_${kind}`, String(Math.round(etaEstimate(kind) * 0.6 + ms * 0.4)));
}
/** Блок прогресса: полоса + этап + «осталось ≈ N сек». Обновляется глобальным таймером. */
function etaBox(kind, start, extraCls = "") {
  return html`<div class="eta ${extraCls}" data-eta="${kind}" data-start="${start}" data-est="${etaEstimate(kind)}">
    <div class="eta-top"><span class="eta-step">${ETA_STEPS[kind]?.[0] || "Загрузка"}</span><span class="eta-left"></span></div>
    <div class="eta-bar"><i></i></div></div>`;
}
function tickEta() {
  const now = Date.now();
  document.querySelectorAll("[data-eta]").forEach((el) => {
    const start = Number(el.dataset.start), est = Number(el.dataset.est);
    const t = Math.max(0, now - start);
    // до оценки — почти линейно, после — медленно ползём к 97%
    const frac = t < est ? 0.9 * (t / est) : 0.9 + 0.07 * (1 - Math.exp(-(t - est) / est));
    const bar = el.querySelector(".eta-bar i");
    if (bar) bar.style.width = `${Math.round(frac * 1000) / 10}%`;
    const left = el.querySelector(".eta-left");
    if (left) {
      const sec = Math.ceil((est - t) / 1000);
      left.textContent = sec > 0 ? `≈ ${sec} сек` : "ещё немного…";
    }
    const steps = ETA_STEPS[el.dataset.eta] || [];
    const stepEl = el.querySelector(".eta-step");
    if (stepEl && steps.length) stepEl.textContent = steps[Math.min(steps.length - 1, Math.floor(Math.min(frac, 0.95) / 0.95 * steps.length))] + "…";
  });
}
setInterval(tickEta, 250);

// ---------- Кнопка в состоянии загрузки: размер не меняется ----------
function btnBusy(btn, on = true) {
  if (!btn) return;
  if (on) {
    btn.style.minWidth = `${btn.offsetWidth}px`;
    btn.classList.add("busy");
    btn.disabled = true;
  } else {
    btn.classList.remove("busy");
    btn.style.minWidth = "";
    btn.disabled = false;
  }
}

// ---------- Мягкое обновление DOM без перерисовки всего экрана ----------
function morph(from, to) {
  if (from.nodeType !== to.nodeType || from.nodeName !== to.nodeName || (from.id && to.id && from.id !== to.id)) {
    from.replaceWith(to);
    return;
  }
  if (from.nodeType === 3 || from.nodeType === 8) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  if (from.nodeType !== 1) return;
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name) && a.name !== "style") from.removeAttribute(a.name);
  for (const a of [...to.attributes]) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
  if (to.hasAttribute("data-eta")) return; // прогресс обновляет таймер
  if (from.tagName === "TEXTAREA" || from.tagName === "INPUT") return; // не трогаем ввод пользователя
  if (from.tagName === "DETAILS" && from.open) to.setAttribute("open", ""); // раскрытые блоки не схлопываем
  morphChildren(from, to);
}
function morphChildren(from, to) {
  const a = [...from.childNodes], b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    if (i < a.length) morph(a[i], b[i]);
    else from.appendChild(b[i]);
  }
  for (let i = b.length; i < a.length; i++) a[i].remove();
}
/** Экран с тем же маршрутом обновляем точечно (без мигания и сброса прокрутки), новый — рисуем заново */
function patchRoot(markup) {
  const key = `${S.route.name}:${S.route.params.id || ""}`;
  const same = root.dataset.view === key && !root.querySelector(".boot, .login");
  root.dataset.view = key;
  if (!same) {
    root.innerHTML = markup;
  } else {
    const tpl = document.createElement("div");
    tpl.innerHTML = markup;
    morphChildren(root, tpl);
  }
  tickEta();
}

function store(key, val) {
  try {
    if (val === undefined) return localStorage.getItem(key);
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {}
  return null;
}

function haptic(type = "light") {
  try {
    if (!tg?.HapticFeedback) return;
    if (["success", "error", "warning"].includes(type)) tg.HapticFeedback.notificationOccurred(type);
    else tg.HapticFeedback.impactOccurred(type);
  } catch {}
}

function toast(text, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = text;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), kind === "error" ? 4500 : 3000);
  if (kind === "error") haptic("error");
}

const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, m = a % 10;
  if (a > 10 && a < 20) return many;
  if (m === 1) return one;
  if (m >= 2 && m <= 4) return few;
  return many;
};
const ageText = (p) => (p.is_alien ? String(p.age) : `${p.age} ${plural(Number(p.age) || 0, "год", "года", "лет")}`);
const patIcon = (p) => patAvatar(p);

const timeText = (ts) => new Date(ts).toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
const dateText = (ts) => new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "long" });
const initials = (name) => String(name || "Д").trim().slice(0, 1).toUpperCase();

// ---------------------------------------------------
// API
// ---------------------------------------------------
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

async function api(method, path, body, opts = {}) {
  const headers = {};
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  let payload;
  if (body instanceof Blob) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try {
    r = await fetch(`/api${path}`, { method, headers, body: payload, signal: opts.signal });
  } catch (e) {
    throw new ApiError("Нет соединения. Проверьте интернет.", 0, "network");
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && data.code === "auth") {
    logout(false);
    throw new ApiError("Сессия истекла — войдите снова", 401, "auth");
  }
  if (!r.ok) throw new ApiError(data.error || "Ошибка сервера", r.status, data.code);
  return data;
}

// ---------------------------------------------------
// Авторизация
// ---------------------------------------------------
async function boot() {
  await loadTelegramSdk();
  tg = window.Telegram?.WebApp || null;
  IN_TG = !!tg?.initData;
  if (IN_TG) sessionStore("hmd_tg", "1");
  // Ссылки из бота: /app?go=/patient/123 → #/patient/123
  const goParam = new URLSearchParams(location.search).get("go");
  if (goParam && goParam.startsWith("/")) {
    history.replaceState(null, "", `${location.pathname}#${goParam}`);
  } else if (/tgWebApp/.test(location.hash)) {
    history.replaceState(null, "", `${location.pathname}#/`);
  }
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      tg.disableVerticalSwipes?.();
      tg.setHeaderColor?.("secondary_bg_color");
      tg.setBackgroundColor?.("secondary_bg_color");
    } catch {}
  }
  if (IN_TG) {
    document.documentElement.classList.add("tg");
    applyTgViewport();
    tg.onEvent?.("viewportChanged", applyTgViewport);
    tg.BackButton?.onClick(() => goBack());
  }

  if (IN_TG) {
    try {
      const { token } = await api("POST", "/auth/telegram", { initData: tg.initData });
      S.token = token;
    } catch (e) {
      return renderFatal("Не удалось войти через Telegram. Закройте и откройте приложение ещё раз.");
    }
  } else {
    S.token = store(TOKEN_KEY);
    if (!S.token) return renderLogin();
  }

  try {
    await loadMe();
  } catch (e) {
    if (e.code === "auth") return renderLogin();
    return renderFatal(e.message);
  }
  connectWs();
  window.addEventListener("hashchange", route);
  route();
}

function applyTgViewport() {
  const h = tg?.viewportStableHeight;
  if (h) document.documentElement.style.setProperty("--tg-viewport-stable-height", `${h}px`);
}

function logout(reload = true) {
  S.token = null;
  store(TOKEN_KEY, null);
  try { S.ws?.close(); } catch {}
  if (reload) location.hash = "";
  if (!IN_TG) renderLogin();
}

function renderFatal(text) {
  root.dataset.view = "";
  root.innerHTML = html`<div class="login"><div class="card stack">
    <div class="logo">${ic("sad")}</div><h2>Что-то пошло не так</h2><p class="muted">${text}</p>
    <button class="btn block" onclick="location.reload()">Обновить</button></div></div>`[RAW];
}

let loginPoll = null;
async function renderLogin() {
  clearInterval(loginPoll);
  root.dataset.view = "";
  root.innerHTML = html`<div class="login"><div class="card stack">
    <div class="logo">${ic("heart")}</div>
    <h1>Help me, Doctor</h1>
    <p class="muted">Тренажёр врача: ИИ-пациенты, обследования, диагноз и разбор от эксперта. Прогресс общий с Telegram-ботом.</p>
    <a class="btn lg block busy" id="login-btn" target="_blank" rel="noopener" aria-disabled="true"><span>Войти через Telegram</span></a>
    <p class="tiny muted" id="login-hint">Откроется бот — нажмите в нём «Запустить», и сайт войдёт сам.</p>
  </div></div>`[RAW];
  let code;
  try {
    const r = await api("POST", "/auth/login");
    code = r.code;
    const btn = $("#login-btn");
    btn.href = r.url;
    btn.classList.remove("busy");
    btn.innerHTML = html`${ic("telegram")}<span>Войти через Telegram</span>`[RAW];
    btn.removeAttribute("aria-disabled");
    btn.onclick = () => {
      btn.innerHTML = html`${ic("clock")}<span>Ждём подтверждения…</span>`[RAW];
      $("#login-hint").innerHTML = html`Бот не открылся? <a href="${r.url}" target="_blank" rel="noopener">Нажмите сюда</a>. После «Запустить» вернитесь на эту вкладку.`[RAW];
    };
  } catch (e) {
    $("#login-hint").textContent = e.message;
    return;
  }
  // Опрашиваем сразу: пользователь может подтвердить вход с телефона
  const started = Date.now();
  loginPoll = setInterval(async () => {
    if (Date.now() - started > 9 * 60 * 1000) return renderLogin(); // код скоро истечёт — берём новый
    try {
      const r = await api("GET", `/auth/poll?code=${encodeURIComponent(code)}`);
      if (r.status === "ok") {
        clearInterval(loginPoll);
        S.token = r.token;
        store(TOKEN_KEY, r.token);
        await loadMe();
        connectWs();
        window.addEventListener("hashchange", route);
        route();
        toast("Вы вошли");
      } else if (r.status === "expired") {
        renderLogin();
      }
    } catch {}
  }, 2000);
}

// ---------------------------------------------------
// Данные и синхронизация
// ---------------------------------------------------
async function loadMe() {
  S.me = await api("GET", "/me");
  return S.me;
}

async function loadPatient(id) {
  const data = await api("GET", `/patients/${encodeURIComponent(id)}`);
  S.patients.set(id, data);
  return data;
}

let refreshTimer = null;
function scheduleRefresh(delay = 250) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      await loadMe();
      const r = S.route;
      if (["patient", "consult"].includes(r.name) && r.params.id) await loadPatient(r.params.id);
      rerender();
    } catch {}
  }, delay);
}

let wsRetry = 0;
let wsPing = null;
function connectWs() {
  if (!S.token) return;
  try { S.ws?.close(); } catch {}
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(S.token)}`);
  S.ws = ws;
  ws.onopen = () => {
    const wasDown = wsRetry > 0;
    S.wsOk = true;
    wsRetry = 0;
    clearInterval(wsPing);
    wsPing = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000);
    if (wasDown) scheduleRefresh(0); // пока были офлайн, могли пропустить изменения
  };
  ws.onmessage = (e) => {
    if (e.data === "pong") return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    onSync(msg);
  };
  ws.onclose = () => {
    S.wsOk = false;
    clearInterval(wsPing);
    if (!S.token) return;
    wsRetry++;
    setTimeout(connectWs, Math.min(1000 * 2 ** wsRetry, 20000));
  };
}

function onSync(msg) {
  if (msg.scope === "consultation" && msg.patient_id) {
    if (msg.typing) S.typing.add(msg.patient_id);
    else S.typing.delete(msg.patient_id);
  }
  if (msg.scope === "profile" && msg.error) toast(msg.error, "error");
  if (msg.scope === "profile" && msg.paid) { toast("Подписка активирована!", "ok"); haptic("success"); }
  if (msg.scope === "patients" && msg.new_patient_id && Date.now() - S.expectNewPatient < 120000) {
    etaRecord("patient", Date.now() - S.expectNewPatient);
    S.expectNewPatient = 0;
    haptic("success");
    toast("Новый пациент готов", "ok");
    loadMe().then(() => go(`/patient/${msg.new_patient_id}`));
    return;
  }
  if (msg.scope === "evaluation") {
    onEvaluation(msg);
  }
  // Пока идёт наш собственный запрос по этому пациенту — обновим после ответа
  if (msg.patient_id && S.inflight.has(msg.patient_id) && msg.scope === "consultation") {
    return;
  }
  scheduleRefresh();
}

// Резервный опрос, если WebSocket недоступен
setInterval(() => {
  if (!S.token || S.wsOk || document.hidden) return;
  const generating = S.me?.profile?.generating_patient;
  const evaluating = S.me?.patients?.some((p) => p.evaluating);
  if (generating || evaluating || S.route.name === "consult") scheduleRefresh(0);
}, 5000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && S.token) {
    if (!S.wsOk) connectWs();
    scheduleRefresh(0);
  }
});

// ---------------------------------------------------
// Роутинг
// ---------------------------------------------------
const ROOT_TABS = ["home", "patients", "quizzes", "profile"];

function parseRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(query));
  if (!parts.length) return { name: "home", params: {}, q };
  if (parts[0] === "patients") return { name: "patients", params: {}, q };
  if (parts[0] === "patient" && parts[1]) return { name: "patient", params: { id: parts[1] }, q };
  if (parts[0] === "consult" && parts[1]) return { name: "consult", params: { id: parts[1] }, q };
  if (parts[0] === "quizzes") return { name: "quizzes", params: {}, q };
  if (parts[0] === "quiz" && parts[1]) return { name: "quiz", params: { id: parts[1] }, q };
  if (parts[0] === "profile") return { name: "profile", params: {}, q };
  if (parts[0] === "plans") return { name: "plans", params: {}, q };
  return { name: "home", params: {}, q };
}

function go(path, replace = false) {
  const target = `#${path}`;
  if (location.hash === target) return route();
  if (replace) history.replaceState(null, "", target), route();
  else location.hash = target;
}

function goBack() {
  const r = S.route;
  if (r.name === "consult") return go(`/patient/${r.params.id}`);
  if (r.name === "patient") return go("/patients");
  if (r.name === "quiz") return go("/quizzes");
  if (r.name === "plans") return go("/profile");
  go("/");
}

async function route() {
  closeSheet();
  S.route = parseRoute();
  const r = S.route;
  if (IN_TG) {
    if (ROOT_TABS.includes(r.name)) tg.BackButton?.hide();
    else tg.BackButton?.show();
  }
  if (["patient", "consult"].includes(r.name) && !S.patients.has(r.params.id)) {
    renderShell(html`<div class="page"><div class="skeleton" style="height:140px"></div><div class="skeleton"></div></div>`, r.name !== "consult");
    try {
      await loadPatient(r.params.id);
    } catch (e) {
      toast(e.message, "error");
      return go("/patients", true);
    }
  }
  if (r.name === "quiz" && !S.patients.has(r.params.id)) {
    try { await loadPatient(r.params.id); } catch {}
  }
  rerender(true);
}

function rerender(fresh = false) {
  const r = S.route;
  if (!S.me) return;
  const views = { home: viewHome, patients: viewPatients, patient: viewPatient, consult: viewConsult, quizzes: viewQuizzes, quiz: viewQuiz, profile: viewProfile, plans: viewPlans };
  (views[r.name] || viewHome)(fresh);
}

function renderShell(content, withNav = true) {
  const r = S.route.name;
  const pendingQuizzes = (S.me?.quizzes || []).filter((q) => q.status !== "done").length;
  const queue = (S.me?.patients || []).filter((p) => p.status !== "closed").length;
  const tab = (name, href, ico, label, badge) => html`<a href="#${href}" class="${r === name || (name === "patients" && r === "patient") || (name === "quizzes" && r === "quiz") || (name === "profile" && r === "plans") ? "active" : ""}">
    ${ic(ico, "nav-i")}<span>${label}</span>${badge ? html`<span class="dot">${badge}</span>` : ""}</a>`;
  const scrollY = window.scrollY;
  patchRoot(html`${content}${withNav ? html`<nav class="nav"><div class="nav-inner">
    ${tab("home", "/", "home", "Главная")}
    ${tab("patients", "/patients", "users", "Пациенты", queue)}
    ${tab("quizzes", "/quizzes", "quiz", "Тесты", pendingQuizzes)}
    ${tab("profile", "/profile", "user", "Профиль")}
  </div></nav>` : ""}`[RAW]);
  return scrollY;
}

// ---------------------------------------------------
// Главная
// ---------------------------------------------------
function viewHome(fresh) {
  const { profile: p, patients } = S.me;
  const lvl = p.level_info;
  const active = patients.filter((x) => x.status !== "closed");
  const inConsult = active.filter((x) => x.in_consultation);
  const waiting = active.filter((x) => !x.in_consultation);
  const pendingQuiz = S.me.quizzes.find((q) => q.status !== "done");
  const task = p.daily_task;
  const xpPct = Math.round((lvl.progress || 0) * 100);

  const y = renderShell(html`<div class="page">
    <div class="hello">
      <div class="avatar">${initials(p.name)}</div>
      <div class="grow">
        <h1 class="ellipsis">Доктор ${p.name}</h1>
        <div class="muted small">${p.level_label} · ${p.profession}${p.has_sub ? html` · <span class="badge accent">${ic("gem")} Безлимит</span>` : ""}</div>
      </div>
    </div>

    <div class="card stack">
      <div class="row between"><b>Уровень ${lvl.level}</b><span class="small muted">${p.xp || 0}${lvl.to ? ` / ${lvl.to}` : ""} XP</span></div>
      <div class="xp-bar"><i style="width:${xpPct}%"></i></div>
      <div class="stats">
        <div class="stat"><b class="row-c">${ic("flame", "c-flame")}${p.streak || 0}</b><span>${plural(p.streak || 0, "день", "дня", "дней")} подряд</span></div>
        <div class="stat"><b>${p.stats.ratings_count ? p.stats.avg_rating.toFixed(1) : "—"}</b><span>средняя оценка</span></div>
        <div class="stat"><b>${p.stats.consultations_total || 0}</b><span>${plural(p.stats.consultations_total || 0, "приём", "приёма", "приёмов")}</span></div>
      </div>
    </div>

    ${task ? html`<div class="card task">
      <div class="tile ${task.done ? "ok" : "accent"}">${ic(task.done ? "checkCircle" : "target")}</div>
      <div class="grow">
        <div class="tiny muted">ЗАДАНИЕ ДНЯ · +${task.xp} XP</div>
        <div><b>${task.desc}</b></div>
        ${task.done ? html`<div class="small" style="color:var(--ok)">Выполнено!</div>` : html`<div class="progress"><i style="width:${Math.min(100, Math.round(((task.progress || 0) / task.target) * 100))}%"></i></div>`}
      </div>
    </div>` : ""}

    ${newPatientBlock()}

    ${inConsult.length ? html`<div class="section-title">Идёт приём</div>
      ${inConsult.map((x) => patientCard(x, `/consult/${x.id}`, "Продолжить приём"))}` : ""}

    ${waiting.length ? html`<div class="section-title">Ждут приёма</div>${waiting.map((x) => patientCard(x))}` : ""}

    ${pendingQuiz ? html`<a class="card tap row" href="#/quiz/${pendingQuiz.pat_id}" style="text-decoration:none;color:inherit">
      <div class="tile warn">${ic("quiz")}</div>
      <div class="grow"><b>Работа над ошибками</b><div class="small muted ellipsis">${pendingQuiz.pat_name} · ${pendingQuiz.pat_diagnosis}</div></div>
      <span class="badge warn">${pendingQuiz.answered}/${pendingQuiz.total}</span>
    </a>` : ""}

    ${!active.length && !patients.length ? html`<div class="card stack center">
      <div class="tile accent lg">${ic("steth")}</div>
      <b>Как это работает</b>
      <p class="small muted">Примите пациента, расспросите его текстом или голосом, назначьте обследования и осмотр, поставьте диагноз. Эксперт разберёт приём, а вы получите опыт и тест по своим ошибкам.</p>
    </div>` : ""}
  </div>`);
  if (!fresh) window.scrollTo(0, y);
  bindNewPatient();
}

function newPatientBlock() {
  const p = S.me.profile;
  const activeCount = S.me.patients.filter((x) => x.status !== "closed").length;
  const max = S.me.config.max_active;
  if (p.generating_patient) {
    return html`<div class="card eta-card">${etaBox("patient", p.generating_since || S.expectNewPatient || Date.now())}</div>`;
  }
  if (activeCount >= max) {
    return html`<div class="card small muted center">В очереди ${max} пациентов — это максимум. Завершите один из приёмов, чтобы принять нового.</div>`;
  }
  if (!p.can_accept) {
    return html`<div class="card stack center">
      <b>Бесплатный пациент на сегодня принят</b>
      <p class="small muted">Новый — завтра после полуночи (МСК). Или безлимит с подпиской.</p>
      <a class="btn block" href="#/plans">${ic("gem")}<span>Безлимитный доступ</span></a>
    </div>`;
  }
  return html`<button class="btn lg block" id="new-patient">${ic("plus")}<span>Принять нового пациента</span></button>`;
}

function bindNewPatient() {
  const btn = $("#new-patient");
  if (!btn) return;
  btn.onclick = async () => {
    btnBusy(btn);
    haptic();
    try {
      S.expectNewPatient = Date.now();
      await api("POST", "/patients/new");
      S.me.profile.generating_patient = true;
    } catch (e) {
      S.expectNewPatient = 0;
      btnBusy(btn, false);
      toast(e.message, "error");
      if (e.code === "limit") go("/plans");
      await loadMe().catch(() => {});
    }
    rerender();
  };
}

function patientCard(x, href = `/patient/${x.id}`, cta) {
  const last = x.last_rating;
  return html`<a class="card tap patient" href="#${href}">
    ${patAvatar(x)}
    <div class="grow stack-sm" style="gap:3px">
      <div class="row between"><span class="name ellipsis">${x.name}</span>
        ${x.evaluating ? html`<span class="badge warn">разбор…</span>` : last != null ? html`<span class="badge ${last >= 4 ? "ok" : last >= 3 ? "warn" : "danger"}">${ic("star", "on")} ${Number(last).toFixed(1)}</span>` : x.in_consultation ? html`<span class="badge accent">на приёме</span>` : x.status === "closed" ? "" : html`<span class="badge">новый</span>`}
      </div>
      <div class="tiny muted">${ageText(x)} · ${x.specialization}${x.consultations ? ` · приёмов: ${x.consultations}` : ""}</div>
      ${x.true_diagnosis ? html`<div class="small"><b>Диагноз:</b> ${x.true_diagnosis}</div>` : html`<div class="complaint">${x.chief_complaint || ""}</div>`}
      ${cta ? html`<div class="small cta">${cta}${ic("arrowRight")}</div>` : ""}
    </div>
  </a>`;
}

// ---------------------------------------------------
// Пациенты
// ---------------------------------------------------
let patientsTab = "queue";
function viewPatients() {
  const list = S.me.patients;
  const queue = list.filter((x) => x.status !== "closed");
  const archive = list.filter((x) => x.status === "closed");
  const items = patientsTab === "queue" ? queue : archive;
  renderShell(html`<div class="page">
    <h1>Пациенты</h1>
    <div class="tabs">
      <button data-tab="queue" class="${patientsTab === "queue" ? "on" : ""}">Очередь · ${queue.length}</button>
      <button data-tab="archive" class="${patientsTab === "archive" ? "on" : ""}">Архив · ${archive.length}</button>
    </div>
    ${patientsTab === "queue" ? newPatientBlock() : ""}
    ${items.length ? items.map((x) => patientCard(x)) : html`<div class="empty"><div class="tile lg">${ic(patientsTab === "queue" ? "inbox" : "archive")}</div>${patientsTab === "queue" ? "Очередь пуста" : "Здесь появятся пациенты после приёма"}</div>`}
  </div>`);
  root.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { patientsTab = b.dataset.tab; viewPatients(); }));
  bindNewPatient();
}

// ---------------------------------------------------
// Карточка пациента
// ---------------------------------------------------
function viewPatient() {
  const id = S.route.params.id;
  const data = S.patients.get(id);
  if (!data) return;
  const { patient: p, quiz } = data;
  const closed = p.status === "closed";
  const consults = [...(p.consultations || [])].reverse();
  const never = !(p.consultations || []).length && !p.current;

  const y = renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/patients" aria-label="Назад">${ic("back")}</button><h2 class="grow ellipsis">Карточка пациента</h2></div>
    <div class="card stack">
      <div class="patient">
        ${patAvatar(p, "lg")}
        <div class="grow">
          <h2>${p.name}</h2>
          <div class="small muted">${ageText(p)}${p.is_alien ? " · инопланетянин" : p.sex === "female" ? " · женщина" : p.sex === "male" ? " · мужчина" : ""} · ${p.specialization}</div>
        </div>
      </div>
      ${p.chief_complaint ? html`<div class="quote">${p.chief_complaint}</div>` : ""}
      ${closed ? html`<div class="card flat" style="background:var(--surface-2)"><div class="tiny muted">ИСТИННЫЙ ДИАГНОЗ</div><b>${p.true_diagnosis}</b></div>` : ""}
      <div class="stack-sm">
        ${!closed ? html`<button class="btn lg block" data-start="${p.id}">${ic(IN_TG ? "chat" : "play")}<span>${p.current ? "Продолжить приём" : p.consultations?.length ? "Начать повторный приём" : "Начать приём"}${IN_TG ? " в чате" : ""}</span></button>` : ""}
        ${closed ? html`<button class="btn block outline" data-reopen="${p.id}">${ic("repeat")}<span>Повторный приём</span></button>` : ""}
        ${(p.conversation_history || []).length ? html`<a class="btn block ghost" href="#/consult/${p.id}">${ic("chat")}<span>${closed || IN_TG ? "История диалога" : "Открыть чат приёма"}</span></a>` : ""}
        ${never ? html`<button class="btn block danger" data-reject="${p.id}">Отказаться от пациента</button>` : ""}
      </div>
    </div>

    ${quiz ? html`<a class="card tap row" href="#/quiz/${p.id}" style="text-decoration:none;color:inherit">
      <div class="tile warn">${ic("quiz")}</div>
      <div class="grow"><b>Работа над ошибками</b><div class="small muted">${quiz.status === "done" ? `Пройден: ${quiz.score} из ${quiz.total}` : `${quiz.answered} из ${quiz.total} вопросов`}</div></div>
      ${ic("chevron", "c-muted")}</a>` : ""}

    ${consults.length ? html`<div class="section-title">Приёмы</div>
      ${consults.map((c, i) => html`<div class="card stack">
        <div class="row between"><b>Приём №${consults.length - i}</b><span class="tiny muted">${dateText(c.date)}</span></div>
        ${c.evaluating ? etaBox("evaluation", c.date) : evaluationBlock(c)}
        ${actionsSummary(c)}
      </div>`)}` : ""}

    ${p.test_results?.length ? html`<div class="section-title">Результаты обследований</div>
      ${[...p.test_results].reverse().map((t) => html`<details class="card"><summary><b class="row-c">${ic("flask", "c-accent")}${t.test}</b> <span class="tiny muted">· ${dateText(t.ordered_at)}</span></summary><div class="pre small" style="margin-top:10px;font-family:ui-monospace,Menlo,monospace">${t.result}</div></details>`)}` : ""}
  </div>`, true);
  window.scrollTo(0, y);
}

function actionsSummary(c) {
  const rows = [];
  if (c.diagnosis) rows.push(["steth", "Ваш диагноз", c.diagnosis]);
  if (c.treatment) rows.push(["pill", "Лечение", c.treatment]);
  if (c.tests?.length) rows.push(["flask", "Обследования", c.tests.join(", ")]);
  if (c.physicals?.length) rows.push(["activity", "Осмотр", c.physicals.join(", ")]);
  if (c.referrals?.length) rows.push(["arrowRight", "Направление", c.referrals.join(", ")]);
  if (c.discharged) rows.push(["xCircle", "Отказ от пациента", ""]);
  if (!rows.length && c.actions?.length) rows.push(["card", "Действия", c.actions.join("; ")]);
  if (!rows.length) return "";
  return html`<div class="facts">${rows.map(([i, k, v]) => html`<div class="fact">${ic(i, "c-muted")}<div><span class="muted">${k}${v ? ":" : ""}</span> ${v}</div></div>`)}</div>`;
}

function evaluationBlock(c) {
  if (c.rating == null) return "";
  const f = c.feedback || {};
  const axes = f.axes;
  return html`<div class="stack">
    <div class="row"><div class="rating-big">${Number(c.rating).toFixed(1)}</div><div>${starsRow(c.rating)}${c.xp ? html`<span class="xp-pill small">${ic("zap")} +${c.xp} XP</span>` : ""}</div></div>
    ${axes ? html`<div class="stack-sm">
      ${[["Диагностика", axes.diagnosis], ["Общение", axes.communication], ["Лечение", axes.treatment]].map(([k, v]) => html`<div class="axis"><span>${k}</span><span class="bar"><i style="width:${(v / 5) * 100}%"></i></span><b>${v}</b></div>`)}
    </div>` : ""}
    ${f.expert_text ? html`<p>${f.expert_text}</p>` : (f.good || []).map((g) => html`<p>${g}</p>`)}
    ${(f.dialog_moments || []).map((m) => html`<div class="stack-sm">${m.quote ? html`<div class="quote small">«${m.quote}»</div>` : ""}<div class="small">${m.comment}</div></div>`)}
    ${f.recommendation ? html`<div class="small fact">${ic("bulb", "c-warn")}<div><b>Совет:</b> ${f.recommendation}</div></div>` : ""}
    ${c.post_story ? html`<div class="card flat" style="background:var(--surface-2)"><div class="tiny muted row-c">${ic("book")} ЧТО БЫЛО ДАЛЬШЕ</div><div class="small">${c.post_story}</div></div>` : ""}
  </div>`;
}

// Кнопки на карточке пациента и в чате
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-start],[data-reopen],[data-reject],[data-go]");
  if (!t) return;
  if (t.dataset.go) return go(t.dataset.go);
  e.preventDefault();
  if (t.disabled) return;
  btnBusy(t);
  try {
    if (t.dataset.start) {
      await startConsult(t.dataset.start);
      return;
    }
    if (t.dataset.reopen) {
      await api("POST", `/patients/${t.dataset.reopen}/reopen`);
      await startConsult(t.dataset.reopen);
      return;
    }
    if (t.dataset.reject) {
      const ok = await confirmDialog("Отказаться от пациента?", "Пациент будет удалён из очереди. Приём не засчитается.");
      if (!ok) return;
      await api("POST", `/patients/${t.dataset.reject}/reject`);
      S.patients.delete(t.dataset.reject);
      await loadMe();
      toast("Пациент удалён из очереди");
      go("/patients");
    }
  } catch (err) {
    toast(err.message, "error");
  } finally {
    if (document.body.contains(t)) btnBusy(t, false);
  }
});

async function startConsult(id) {
  haptic();
  if (IN_TG) {
    // В Telegram приём идёт в чате с ботом: бот пришлёт карточку и первую фразу пациента
    await api("POST", `/patients/${id}/start?in_bot=1`);
    haptic("success");
    try { tg.close(); } catch {}
    return;
  }
  await api("POST", `/patients/${id}/start`);
  await Promise.all([loadPatient(id), loadMe()]);
  go(`/consult/${id}`);
}

function confirmDialog(title, text, okLabel = "Да") {
  return new Promise((resolve) => {
    if (IN_TG && tg.showConfirm) return tg.showConfirm(`${title}\n\n${text}`, (ok) => resolve(!!ok));
    openSheet(html`<h2>${title}</h2><p class="muted" style="margin-bottom:16px">${text}</p>
      <div class="grid-2"><button class="btn ghost" data-no>Отмена</button><button class="btn danger" data-yes>${okLabel}</button></div>`, (el) => {
      el.querySelector("[data-no]").onclick = () => { closeSheet(); resolve(false); };
      el.querySelector("[data-yes]").onclick = () => { closeSheet(); resolve(true); };
    }, () => resolve(false));
  });
}

// ---------------------------------------------------
// Приём (чат)
// ---------------------------------------------------
let draft = "";
function viewConsult(fresh) {
  const id = S.route.params.id;
  const data = S.patients.get(id);
  if (!data) return;
  const p = data.patient;
  const open = !!p.current && p.status !== "closed";
  const prevMessages = $(".messages");
  const atBottom = !prevMessages || prevMessages.scrollHeight - prevMessages.scrollTop - prevMessages.clientHeight < 80;
  const ta = $("#composer-input");
  if (ta) draft = ta.value;
  if (S.restoreDraft) { draft = S.restoreDraft; S.restoreDraft = null; }
  const hadFocus = document.activeElement === ta;

  renderShell(html`<div class="consult">
    <div class="consult-head">
      <button class="back" data-go="/patient/${p.id}" aria-label="Назад">${ic("back")}</button>
      ${patAvatar(p, "sm")}
      <div class="grow">
        <div class="title ellipsis">${p.name}</div>
        <div class="tiny muted ellipsis">${open ? `Приём №${(p.consultations || []).length + 1} · ${ageText(p)}` : "Приём завершён"}</div>
      </div>
      <a class="icon-btn" href="#/patient/${p.id}" aria-label="Карточка">${ic("card")}</a>
    </div>
    <div class="messages" id="messages">${timeline(p)}${pendingBlock(p)}</div>
    ${open && IN_TG ? html`<div class="composer"><div class="card flat tg-note">
        <div class="row-c">${ic("chat", "c-accent")}<b>Приём идёт в чате с ботом</b></div>
        <p class="small muted">Пишите пациенту прямо в Telegram — здесь история обновляется сама.</p>
        <button class="btn block" id="to-chat">${ic("telegram")}<span>Перейти в чат</span></button></div></div>` : ""}
    ${open && !IN_TG ? html`
      <div class="actions-bar">
        <button class="chip" data-sheet="tests">${ic("flask")}<span>Анализы</span></button>
        <button class="chip" data-sheet="exam">${ic("steth")}<span>Осмотр</span></button>
        <button class="chip" data-sheet="finish">${ic("flag")}<span>Завершить</span></button>
      </div>
      <div class="composer" id="composer">
        <textarea id="composer-input" rows="1" placeholder="Спросите пациента…" maxlength="1500"></textarea>
        <button class="icon-btn" id="mic" aria-label="Голосовое">${ic("mic")}</button>
        <button class="icon-btn send hidden" id="send" aria-label="Отправить">${ic("send")}</button>
      </div>` : ""}
    ${!open ? html`<div class="composer"><a class="btn block" href="#/patient/${p.id}">К карточке пациента</a></div>` : ""}
  </div>`, false);
  const toChat = $("#to-chat");
  if (toChat) toChat.onclick = async () => {
    btnBusy(toChat);
    try { await api("POST", `/patients/${p.id}/start?in_bot=1`); tg.close(); }
    catch (e) { toast(e.message, "error"); btnBusy(toChat, false); }
  };

  const box = $("#messages");
  if (fresh || atBottom) box.scrollTop = box.scrollHeight;
  else if (prevMessages) box.scrollTop = prevMessages.scrollTop;
  if (open && !IN_TG) bindComposer(p, hadFocus);
  root.querySelectorAll("[data-sheet]").forEach((b) => (b.onclick = () => {
    haptic();
    if (b.dataset.sheet === "tests") sheetTests(p);
    if (b.dataset.sheet === "exam") sheetExam(p);
    if (b.dataset.sheet === "finish") sheetFinish(p);
  }));
}

function renderTypingOnly() {
  if (S.route.name === "consult") viewConsult();
}

/** Что показываем, пока ждём ответа: пациент печатает / лаборатория работает — с оценкой времени */
function pendingBlock(p) {
  const op = S.op?.id === p.id ? S.op : null;
  if (op && (op.kind === "test" || op.kind === "exam")) {
    return html`<div class="event pending-event"><div class="event-title">${ic(op.kind === "test" ? "flask" : "steth", "c-accent")}${op.kind === "exam" ? "Осмотр: " : ""}${op.label}</div>${etaBox(op.kind, op.start)}</div>`;
  }
  if (op) {
    return html`<div class="typing-wrap"><div class="typing"><i></i><i></i><i></i></div>${etaBox(op.kind, op.start, "mini")}</div>`;
  }
  if (S.typing.has(p.id)) return html`<div class="typing-wrap"><div class="typing"><i></i><i></i><i></i></div></div>`;
  return "";
}

/** Запуск операции в приёме с замером длительности (для оценки времени в следующий раз) */
async function consultOp(id, kind, label, fn) {
  S.op = { id, kind, label, start: Date.now() };
  S.inflight.add(id);
  viewConsult();
  scrollChatDown();
  const t0 = Date.now();
  try {
    await fn();
    etaRecord(kind, Date.now() - t0);
  } catch (e) {
    toast(e.message, "error");
    throw e;
  } finally {
    S.op = null;
    S.inflight.delete(id);
    S.typing.delete(id);
    try { await loadPatient(id); } catch {}
    if (S.route.name === "consult" && S.route.params.id === id) viewConsult();
    scrollChatDown();
  }
}
function scrollChatDown() {
  const b = $("#messages");
  if (b) b.scrollTop = b.scrollHeight;
}

function timeline(p) {
  const items = [];
  for (const m of p.conversation_history || []) items.push({ ts: m.ts, kind: m.role, m });
  for (const t of p.test_results || []) items.push({ ts: t.ordered_at, kind: "test", t });
  for (const x of p.exam_results || []) items.push({ ts: x.ts, kind: "exam", x });
  (p.consultations || []).forEach((c, i) => items.push({ ts: c.date + 1, kind: "end", c, n: i + 1 }));
  (p._pending || []).forEach((m) => items.push({ ts: m.ts, kind: "doctor", m, pending: true }));
  items.sort((a, b) => a.ts - b.ts);
  if (!items.length) return html`<div class="divider">Приём ещё не начат</div>`;
  let lastDay = "";
  return items.map((it) => {
    const day = dateText(it.ts);
    const sep = day !== lastDay ? html`<div class="divider">${day}</div>` : "";
    lastDay = day;
    if (it.kind === "patient" || it.kind === "doctor") {
      return html`${sep}<div class="msg from-${it.kind}${it.pending ? " pending" : ""}">${it.m.voice ? ic("mic", "c-soft") : ""}${it.m.text}<div class="meta">${it.pending ? "отправка…" : timeText(it.ts)}</div></div>`;
    }
    if (it.kind === "test") {
      return html`${sep}<div class="event test"><div class="event-title">${ic("flask", "c-accent")}${it.t.test}</div><div class="event-body">${it.t.result}</div></div>`;
    }
    if (it.kind === "exam") {
      return html`${sep}<div class="event"><div class="event-title">${ic("steth", "c-accent")}Осмотр: ${it.x.action}</div><div class="event-body">${it.x.sensation}</div>${it.x.reaction ? html`<div class="event-body" style="margin-top:8px"><b>Пациент:</b> ${it.x.reaction}</div>` : ""}</div>`;
    }
    if (it.kind === "end") {
      return html`${sep}<div class="divider">${ic("flag")} Приём №${it.n} завершён${it.c.rating != null ? ` · ${Number(it.c.rating).toFixed(1)} из 5` : ""}</div>`;
    }
    return "";
  });
}

function bindComposer(p, refocus) {
  const ta = $("#composer-input");
  const send = $("#send");
  const mic = $("#mic");
  if (ta.value !== draft) ta.value = draft;
  const sync = () => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
    ta.style.overflowY = ta.scrollHeight > 140 ? "auto" : "hidden";
    const has = ta.value.trim().length > 0;
    send.classList.toggle("hidden", !has);
    mic.classList.toggle("hidden", has);
  };
  sync();
  if (refocus && document.activeElement !== ta) ta.focus();
  ta.oninput = () => { draft = ta.value; sync(); };
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !IS_TOUCH) { e.preventDefault(); submit(); }
  };
  ta.onfocus = () => setTimeout(scrollChatDown, 250);
  send.onclick = submit;
  mic.onclick = () => startRecording(p);

  function submit() {
    const text = ta.value.trim();
    if (!text) return;
    if (S.inflight.has(p.id)) return toast("Пациент ещё отвечает…");
    draft = "";
    ta.value = "";
    sync();
    ta.focus();
    sendDoctorMessage(p.id, text);
  }
}

async function sendDoctorMessage(id, text) {
  haptic();
  S.patients.get(id).patient._pending = [{ text, ts: Date.now() }];
  try {
    await consultOp(id, "reply", "", () => api("POST", `/patients/${id}/message`, { text }));
  } catch (e) {
    if (e.code === "network" || e.status >= 500) { S.restoreDraft = text; viewConsult(); } // вернём текст в поле
  }
}

// ---------- Голосовые ----------
let recorder = null;
function startRecording(p) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    return toast("Запись голоса не поддерживается этим браузером", "error");
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks = [];
    let cancelled = false;
    const started = Date.now();
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer);
      recorder = null;
      viewConsult();
      if (cancelled || Date.now() - started < 800) return;
      const blob = new Blob(chunks, { type: rec.mimeType || type || "audio/webm" });
      await sendVoice(p.id, blob);
    };
    recorder = rec;
    rec.start();
    haptic("medium");
    const composer = $("#composer");
    composer.innerHTML = html`<button class="icon-btn" id="rec-cancel" aria-label="Отмена">${ic("x")}</button>
      <div class="rec-bar"><span>● Запись</span><span id="rec-time">0:00</span></div>
      <button class="icon-btn rec" id="rec-stop" aria-label="Отправить">${ic("send")}</button>`[RAW];
    const timer = setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      const el = $("#rec-time");
      if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      if (s >= 120) rec.stop();
    }, 250);
    $("#rec-stop").onclick = () => rec.state !== "inactive" && rec.stop();
    $("#rec-cancel").onclick = () => { cancelled = true; rec.state !== "inactive" && rec.stop(); };
  }).catch(() => toast("Нет доступа к микрофону. Разрешите его в настройках браузера.", "error"));
}

async function sendVoice(id, blob) {
  S.patients.get(id).patient._pending = [{ text: "Голосовое сообщение", voice: true, ts: Date.now() }];
  await consultOp(id, "voice", "", () => api("POST", `/patients/${id}/voice`, blob)).catch(() => {});
}

// ---------- Листы действий ----------
function sheetTests(p) {
  const done = new Set(p.current?.tests || []);
  openSheet(html`<h2 class="row-c">${ic("flask", "c-accent")}Назначить обследование</h2>
    <div class="grid-2">${S.me.config.tests.map((t) => html`<button class="option" data-test="${t}">${done.has(t) ? ic("check", "c-ok") : ""}${t}</button>`)}</div>
    <div class="field" style="margin-top:14px"><label>Другое обследование</label>
      <div class="row"><input class="input grow" id="custom-test" placeholder="Например: рентген кисти, ФГДС…" maxlength="80"><button class="btn" id="custom-test-go">OK</button></div>
    </div>`, (el) => {
    el.querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => runAction(p.id, "test", b.dataset.test)));
    const go1 = () => { const v = $("#custom-test").value.trim(); if (v) runAction(p.id, "test", v); };
    $("#custom-test-go").onclick = go1;
    $("#custom-test").onkeydown = (e) => e.key === "Enter" && go1();
  });
}

const EXAMS = ["Аускультация лёгких", "Аускультация сердца", "Пальпация живота", "Перкуссия грудной клетки", "Осмотр кожи", "Измерить давление и пульс", "Неврологический осмотр", "Осмотр зева"];
function sheetExam(p) {
  openSheet(html`<h2 class="row-c">${ic("steth", "c-accent")}Физический осмотр</h2>
    <div class="grid-2">${EXAMS.map((t) => html`<button class="option" data-exam="${t}">${t}</button>`)}</div>
    <div class="field" style="margin-top:14px"><label>Свой вариант</label>
      <div class="row"><input class="input grow" id="custom-exam" placeholder="Например: пальпация щитовидной железы" maxlength="200"><button class="btn" id="custom-exam-go">OK</button></div>
    </div>`, (el) => {
    el.querySelectorAll("[data-exam]").forEach((b) => (b.onclick = () => runAction(p.id, "exam", b.dataset.exam)));
    const go1 = () => { const v = $("#custom-exam").value.trim(); if (v) runAction(p.id, "exam", v); };
    $("#custom-exam-go").onclick = go1;
    $("#custom-exam").onkeydown = (e) => e.key === "Enter" && go1();
  });
}

async function runAction(id, kind, value) {
  closeSheet();
  haptic();
  if (S.inflight.has(id)) return toast("Дождитесь окончания предыдущего действия");
  await consultOp(id, kind, value, () => kind === "test"
    ? api("POST", `/patients/${id}/test`, { name: value })
    : api("POST", `/patients/${id}/exam`, { action: value })).catch(() => {});
}

function sheetFinish(p) {
  let mode = "diagnosis";
  const draw = (el) => {
    el.innerHTML = html`<div class="grip"></div><h2 class="row-c">${ic("flag", "c-accent")}Завершить приём</h2>
      <div class="tabs" style="margin-bottom:14px">
        <button data-mode="diagnosis" class="${mode === "diagnosis" ? "on" : ""}">Диагноз</button>
        <button data-mode="referral" class="${mode === "referral" ? "on" : ""}">Направить</button>
        <button data-mode="discharge" class="${mode === "discharge" ? "on" : ""}">Отказаться</button>
      </div>
      ${mode === "diagnosis" ? html`<div class="stack">
        <div class="field"><label>Диагноз</label><input class="input" id="dx" placeholder="Например: острый панкреатит, отёчная форма" maxlength="300"></div>
        <div class="field"><label>Лечение и рекомендации (по желанию)</label><textarea id="tx" placeholder="Препараты, дозы, режим, диета…" maxlength="500"></textarea></div>
        <button class="btn lg block" id="finish-go">Поставить диагноз и завершить</button></div>` : ""}
      ${mode === "referral" ? html`<div class="stack">
        <div class="field"><label>К какому специалисту направляете?</label><input class="input" id="ref" placeholder="Например: гастроэнтеролог" maxlength="300"></div>
        <button class="btn lg block" id="finish-go">Направить и завершить</button></div>` : ""}
      ${mode === "discharge" ? html`<div class="stack"><p class="muted">Приём завершится без диагноза. Эксперт всё равно разберёт ваши действия.</p>
        <button class="btn lg block danger" id="finish-go">Отказаться от пациента</button></div>` : ""}`[RAW];
    el.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => { mode = b.dataset.mode; draw(el); }));
    $("#finish-go").onclick = async () => {
      const body = { type: mode };
      if (mode === "diagnosis") {
        body.value = $("#dx").value.trim();
        body.treatment = $("#tx").value.trim();
        if (!body.value) return toast("Введите диагноз", "error");
      }
      if (mode === "referral") {
        body.value = $("#ref").value.trim();
        if (!body.value) return toast("Укажите специалиста", "error");
      }
      await finishConsult(p, body);
    };
    setTimeout(() => el.querySelector("input")?.focus(), 50);
  };
  openSheet("", draw);
}

async function finishConsult(p, body) {
  const btn = $("#finish-go");
  btnBusy(btn);
  try {
    const t0 = Date.now();
    const res = await api("POST", `/patients/${p.id}/finish`, body);
    etaRecord("finish", Date.now() - t0);
    S.evalStart = Date.now();
    haptic("success");
    S.evalWaiting = p.id;
    openSheet(html`<h2 class="row-c">${ic("checkCircle", "c-ok")}Приём завершён</h2>
      <div class="msg from-patient" style="max-width:100%;margin-bottom:12px">${res.farewell}</div>
      <div class="card flat" style="background:var(--surface-2)"><div class="tiny muted">ИСТИННЫЙ ДИАГНОЗ</div><b>${res.true_diagnosis}</b></div>
      <div id="eval-slot" style="margin-top:16px">${etaBox("evaluation", S.evalStart)}</div>`, null, () => { S.evalWaiting = null; });
    await Promise.all([loadPatient(p.id), loadMe()]);
    if (S.route.name === "consult") viewConsult();
    pollEvaluation(p.id);
  } catch (e) {
    toast(e.message, "error");
    btnBusy(btn, false);
  }
}

// Если WebSocket не донёс разбор — проверяем сами
async function pollEvaluation(id) {
  for (let i = 0; i < 30 && S.evalWaiting === id; i++) {
    await new Promise((r) => setTimeout(r, S.wsOk ? 6000 : 3000));
    if (S.evalWaiting !== id) return;
    try {
      const { patient } = await loadPatient(id);
      const c = patient.consultations[patient.consultations.length - 1];
      if (c && !c.evaluating && c.rating != null) {
        return onEvaluation({ patient_id: id, rating: c.rating, axes: c.feedback?.axes, expert_text: c.feedback?.expert_text, dialog_moments: c.feedback?.dialog_moments, post_story: c.post_story, xp: c.xp, fromPoll: true });
      }
    } catch {}
  }
}

function onEvaluation(r) {
  scheduleRefresh(0);
  if (S.evalWaiting !== r.patient_id) {
    if (!r.fromPoll) toast(`Разбор приёма готов: ${Number(r.rating).toFixed(1)} из 5`, "ok");
    return;
  }
  S.evalWaiting = null;
  if (S.evalStart) etaRecord("evaluation", Date.now() - S.evalStart);
  haptic("success");
  const slot = $("#eval-slot");
  if (!slot) return;
  const c = { rating: r.rating, xp: r.xp, post_story: r.post_story, feedback: { axes: r.axes, expert_text: r.expert_text, dialog_moments: r.dialog_moments } };
  slot.outerHTML = html`<div class="stack" style="margin-top:16px">
    <h3 class="row-c">${ic("card", "c-accent")}Разбор эксперта</h3>
    ${evaluationBlock(c)}
    ${r.level_up ? html`<div class="card flat center" style="background:var(--accent-soft)"><b class="row-c" style="justify-content:center">${ic("trophy", "c-accent")}Новый уровень: ${r.level_up.to}</b></div>` : ""}
    ${r.task_done ? html`<div class="card flat center" style="background:var(--ok-soft)"><span class="row-c" style="justify-content:center">${ic("target", "c-ok")}Задание дня выполнено! +${r.task_done.xp} XP</span></div>` : ""}
    <div class="grid-2"><a class="btn ghost" href="#/patient/${r.patient_id}">Карточка</a><button class="btn" id="eval-new">${ic("plus")}<span>Новый пациент</span></button></div>
    <p class="tiny muted center">Тест «работа над ошибками» появится во вкладке «Тесты» через минуту.</p>
  </div>`[RAW];
  const nb = $("#eval-new");
  if (nb) nb.onclick = () => { closeSheet(); go("/"); };
}

// ---------------------------------------------------
// Тесты
// ---------------------------------------------------
function viewQuizzes() {
  const list = S.me.quizzes;
  const pending = list.filter((q) => q.status !== "done");
  const done = list.filter((q) => q.status === "done");
  const item = (q) => html`<a class="card tap row" href="#/quiz/${q.pat_id}" style="text-decoration:none;color:inherit">
    <div class="tile ${q.status === "done" ? (q.score >= q.total - 1 ? "ok" : "") : "warn"}">${ic(q.status === "done" ? (q.score >= q.total - 1 ? "trophy" : "book") : "quiz")}</div>
    <div class="grow"><b class="ellipsis" style="display:block">${q.pat_diagnosis || q.pat_name}</b><div class="small muted ellipsis">${q.pat_name}</div></div>
    ${q.status === "done" ? html`<span class="badge ${q.score >= q.total - 1 ? "ok" : "warn"}">${q.score}/${q.total}</span>` : html`<span class="badge accent">${q.answered}/${q.total}</span>`}
  </a>`;
  renderShell(html`<div class="page">
    <h1>Работа над ошибками</h1>
    <p class="muted small">После каждого приёма эксперт составляет тест по вашим пробелам. +5 XP за каждый верный ответ.</p>
    ${pending.length ? html`<div class="section-title">Ждут прохождения</div>${pending.map(item)}` : ""}
    ${done.length ? html`<div class="section-title">Пройдены</div>${done.map(item)}` : ""}
    ${!list.length ? html`<div class="empty"><div class="tile lg">${ic("quiz")}</div>Тесты появятся после первого приёма</div>` : ""}
  </div>`);
}

let quizState = null; // { id, quiz, index, answer }
async function viewQuiz(fresh) {
  const id = S.route.params.id;
  if (fresh || !quizState || quizState.id !== id) {
    renderShell(html`<div class="page"><div class="skeleton" style="height:220px"></div></div>`);
    try {
      const { quiz } = await api("GET", `/quiz/${encodeURIComponent(id)}`);
      quizState = { id, quiz, index: Math.min(quiz.answered, quiz.total - 1), answer: null };
    } catch (e) {
      renderShell(html`<div class="page"><div class="page-head"><button class="back" data-go="/quizzes" aria-label="Назад">${ic("back")}</button><h2>Тест</h2></div>
        <div class="empty"><div class="tile lg">${ic("clock")}</div>${e.message}</div></div>`);
      return;
    }
  }
  const { quiz } = quizState;
  if (quiz.status === "done" && quizState.answer == null) return renderQuizResult();
  const i = quizState.index;
  const q = quiz.questions[i];
  const ans = quizState.answer;
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/quizzes" aria-label="Назад">${ic("back")}</button>
      <div class="grow"><div class="tiny muted">РАБОТА НАД ОШИБКАМИ</div><b class="ellipsis" style="display:block">${quiz.pat_diagnosis}</b></div></div>
    <div class="steps">${quiz.questions.map((qq, k) => html`<i class="${qq.chosen != null ? (qq.chosen === qq.correct ? "ok" : "bad") : k === i ? "cur" : ""}"></i>`)}</div>
    <div class="card stack">
      <div class="tiny muted">Вопрос ${i + 1} из ${quiz.total}</div>
      <h2>${q.text}</h2>
      <div class="stack-sm">${q.options.map((o, k) => {
        let cls = "";
        if (ans) {
          if (k === ans.correct) cls = "correct";
          else if (k === ans.chosen) cls = "wrong";
        }
        return html`<button class="quiz-opt ${cls}" data-opt="${k}" ${ans ? "disabled" : ""}>${["А", "Б", "В", "Г"][k]}. ${o}</button>`;
      })}</div>
      ${ans ? html`<div class="card flat" style="background:${ans.is_correct ? "var(--ok-soft)" : "var(--danger-soft)"}">
        <b class="row-c">${ic(ans.is_correct ? "checkCircle" : "xCircle", ans.is_correct ? "c-ok" : "c-danger")}${ans.is_correct ? "Верно!" : "Неверно"}</b><div class="small" style="margin-top:4px">${ans.explanation || ""}</div></div>
        <button class="btn lg block" id="quiz-next">${ans.done ? "Результат" : "Следующий вопрос"}</button>` : ""}
    </div>
  </div>`);
  root.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = async () => {
    if (quizState.busy) return;
    quizState.busy = true;
    b.classList.add("picked");
    try {
      const res = await api("POST", `/quiz/${encodeURIComponent(id)}/answer`, { index: i, chosen: Number(b.dataset.opt) });
      quizState.quiz = res.quiz;
      if (res.stale) {
        quizState.index = Math.min(res.quiz.answered, res.quiz.total - 1);
        quizState.answer = null;
      } else {
        haptic(res.is_correct ? "success" : "error");
        quizState.answer = { chosen: Number(b.dataset.opt), correct: res.correct, is_correct: res.is_correct, explanation: res.explanation, done: res.done, res };
      }
    } catch (e) {
      toast(e.message, "error");
    }
    quizState.busy = false;
    viewQuiz();
  }));
  const next = $("#quiz-next");
  if (next) next.onclick = () => {
    const a = quizState.answer;
    quizState.answer = null;
    if (a.done) {
      quizState.final = a.res;
      loadMe().catch(() => {});
      return renderQuizResult();
    }
    quizState.index = i + 1;
    viewQuiz();
    window.scrollTo(0, 0);
  };
}

function renderQuizResult() {
  const { quiz, final } = quizState;
  const score = quiz.score ?? quiz.questions.filter((q) => q.chosen === q.correct).length;
  const total = quiz.total;
  const praise = score === total ? "Отлично!" : score >= total - 1 ? "Хороший результат" : score >= total / 2 ? "Неплохо, есть пробелы" : "Стоит повторить материал";
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/quizzes" aria-label="Назад">${ic("back")}</button><h2>Результат теста</h2></div>
    <div class="card stack center">
      <div class="rating-big">${score} / ${total}</div>
      <b>${praise}</b>
      ${quiz.xp ? html`<div><span class="xp-pill">${ic("zap")} +${quiz.xp} XP</span></div>` : ""}
      ${final?.task_done ? html`<div class="small row-c" style="color:var(--ok);justify-content:center">${ic("target")}Задание дня выполнено!</div>` : ""}
    </div>
    ${quiz.questions.map((q, k) => html`<div class="card stack-sm">
      <div class="small fact">${ic(q.chosen === q.correct ? "checkCircle" : "xCircle", q.chosen === q.correct ? "c-ok" : "c-danger")}<b>${k + 1}. ${q.text}</b></div>
      ${q.chosen !== q.correct ? html`<div class="small">Правильно: <b>${q.options[q.correct]}</b></div>` : ""}
      <div class="small muted fact">${ic("bulb")}<span>${q.explanation || ""}</span></div>
    </div>`)}
    <a class="btn block" href="#/">На главную</a>
  </div>`);
}

// ---------------------------------------------------
// Профиль
// ---------------------------------------------------
function viewProfile() {
  const p = S.me.profile;
  const cfg = S.me.config;
  const professions = Object.keys(cfg.specializations);
  const isCustomProf = !professions.includes(p.profession);
  const available = [...new Set([...(cfg.specializations[p.profession] || []), ...p.specializations])];
  const sub = p.has_sub ? (p.sub_until === -1 ? "навсегда" : `до ${dateText(p.sub_until)}`) : null;

  renderShell(html`<div class="page">
    <div class="hello"><div class="avatar">${initials(p.name)}</div><div class="grow"><h1 class="ellipsis">${p.name}</h1><div class="small muted">${p.username ? "@" + p.username : "Telegram ID " + p.uid}</div></div></div>

    <a class="card tap row" href="#/plans" style="text-decoration:none;color:inherit">
      <div class="tile accent">${ic("gem")}</div>
      <div class="grow"><b>${sub ? "Безлимитный доступ" : "Бесплатный тариф"}</b><div class="small muted">${sub ? `Активен ${sub}` : "1 пациент в день · безлимит от 30 ₽"}</div></div>${ic("chevron", "c-muted")}
    </a>

    <div class="card stack">
      <h3>Статистика</h3>
      <div class="stats">
        <div class="stat"><b>${p.stats.patients_total || 0}</b><span>${plural(p.stats.patients_total || 0, "пациент", "пациента", "пациентов")}</span></div>
        <div class="stat"><b>${p.stats.quizzes_done || 0}</b><span>${plural(p.stats.quizzes_done || 0, "тест", "теста", "тестов")}</span></div>
        <div class="stat"><b>${p.stats.correct_diagnoses_streak || 0}</b><span>верных подряд</span></div>
      </div>
      ${p.strengths?.length ? html`<div><div class="tiny muted">СИЛЬНЫЕ СТОРОНЫ</div><div class="row wrap" style="gap:6px;margin-top:6px">${p.strengths.slice(0, 6).map((s) => html`<span class="badge ok">${s}</span>`)}</div></div>` : ""}
      ${p.weaknesses?.length ? html`<div><div class="tiny muted">ЧТО ПОДТЯНУТЬ</div><div class="row wrap" style="gap:6px;margin-top:6px">${p.weaknesses.slice(0, 6).map((s) => html`<span class="badge warn">${s}</span>`)}</div></div>` : ""}
      ${p.recommendations?.length ? html`<div class="small fact">${ic("bulb", "c-warn")}<span>${p.recommendations[0]}</span></div>` : ""}
    </div>

    <div class="card stack" id="profile-form">
      <h3>Настройки</h3>
      <div class="field"><label>Имя</label><input class="input" id="pf-name" value="${p.name}" maxlength="40"></div>
      <div class="field"><label>Уровень подготовки — влияет на сложность пациентов</label>
        <div class="row wrap" style="gap:6px">${cfg.levels.map((l) => html`<button class="chip ${p.level === l.key ? "on" : ""}" data-level="${l.key}">${l.label}</button>`)}</div></div>
      <div class="field"><label>Специальность</label>
        <div class="row wrap" style="gap:6px">${professions.map((x) => html`<button class="chip ${p.profession === x ? "on" : ""}" data-prof="${x}">${x}</button>`)}<button class="chip ${isCustomProf ? "on" : ""}" data-prof="__custom">Другая…</button></div>
        <input class="input ${isCustomProf ? "" : "hidden"}" id="pf-prof-custom" value="${isCustomProf ? p.profession : ""}" placeholder="Ваша специальность" maxlength="40"></div>
      <div class="field"><label>Разделы, из которых приходят пациенты</label>
        <div class="row wrap" style="gap:6px" id="pf-specs">${available.map((s) => html`<button class="chip ${p.specializations.includes(s) ? "on" : ""}" data-spec="${s}">${s}</button>`)}</div>
        <div class="row"><input class="input grow" id="pf-spec-add" placeholder="Добавить раздел" maxlength="60"><button class="btn ghost sm" id="pf-spec-add-btn">+</button></div></div>
      <label class="row" style="justify-content:space-between"><span>Напоминания в Telegram о стрике</span><input type="checkbox" id="pf-notify" ${p.notifications === false ? "" : "checked"} style="width:22px;height:22px;accent-color:var(--accent)"></label>
      <button class="btn block" id="pf-save">Сохранить</button>
    </div>

    <div class="card stack-sm small">
      <a href="https://t.me/${S.me.bot_username || "helpmedoctor_aibot"}" target="_blank" rel="noopener" class="row-c">${ic("telegram")}Открыть бота в Telegram</a>
      ${!IN_TG ? html`<a href="#" id="logout" class="row-c" style="color:var(--danger)">${ic("logout")}Выйти</a>` : ""}
    </div>
  </div>`);

  const form = { level: p.level, profession: p.profession, specs: new Set(p.specializations) };
  root.querySelectorAll("[data-level]").forEach((b) => (b.onclick = () => {
    form.level = b.dataset.level;
    root.querySelectorAll("[data-level]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  root.querySelectorAll("[data-prof]").forEach((b) => (b.onclick = () => {
    root.querySelectorAll("[data-prof]").forEach((x) => x.classList.toggle("on", x === b));
    const custom = b.dataset.prof === "__custom";
    $("#pf-prof-custom").classList.toggle("hidden", !custom);
    if (custom) { $("#pf-prof-custom").focus(); form.profession = null; return; }
    form.profession = b.dataset.prof;
    form.specs = new Set(cfg.specializations[form.profession]);
    $("#pf-specs").innerHTML = html`${cfg.specializations[form.profession].map((s) => html`<button class="chip on" data-spec="${s}">${s}</button>`)}`[RAW];
    bindSpecs();
  }));
  const bindSpecs = () => root.querySelectorAll("[data-spec]").forEach((b) => (b.onclick = () => {
    const s = b.dataset.spec;
    if (form.specs.has(s)) form.specs.delete(s); else form.specs.add(s);
    b.classList.toggle("on", form.specs.has(s));
  }));
  bindSpecs();
  const addSpec = () => {
    const v = $("#pf-spec-add").value.trim();
    if (!v) return;
    form.specs.add(v);
    $("#pf-specs").insertAdjacentHTML("beforeend", html`<button class="chip on" data-spec="${v}">${v}</button>`[RAW]);
    $("#pf-spec-add").value = "";
    bindSpecs();
  };
  $("#pf-spec-add-btn").onclick = addSpec;
  $("#pf-spec-add").onkeydown = (e) => e.key === "Enter" && addSpec();
  $("#pf-save").onclick = async () => {
    const profession = form.profession || $("#pf-prof-custom").value.trim();
    if (!profession) return toast("Укажите специальность", "error");
    const specs = [...form.specs];
    if (!specs.length) {
      if (form.profession) return toast("Выберите хотя бы один раздел", "error");
      specs.push(profession); // своя специальность без разделов — пациенты по ней целиком
    }
    const btn = $("#pf-save");
    btn.disabled = true;
    try {
      const { profile } = await api("PATCH", "/profile", {
        name: $("#pf-name").value, level: form.level, profession, specializations: specs, notifications: $("#pf-notify").checked,
      });
      S.me.profile = profile;
      haptic("success");
      toast("Сохранено", "ok");
      viewProfile();
    } catch (e) {
      toast(e.message, "error");
      btn.disabled = false;
    }
  };
  const lo = $("#logout");
  if (lo) lo.onclick = (e) => { e.preventDefault(); logout(); };
}

// ---------------------------------------------------
// Тарифы
// ---------------------------------------------------
function viewPlans(fresh) {
  const p = S.me.profile;
  const plans = S.me.plans;
  const order = ["day", "week", "month", "forever"];
  if (fresh && S.route.q.paid) toast("Спасибо! Подписка активируется в течение минуты.");
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2>Безлимитный доступ</h2></div>
    ${p.has_sub ? html`<div class="card center"><b class="row-c" style="justify-content:center">${ic("gem", "c-accent")}Подписка активна ${p.sub_until === -1 ? "навсегда" : `до ${dateText(p.sub_until)}`}</b><p class="small muted">Можно продлить — дни суммируются.</p></div>` : html`<div class="card stack-sm">
      <b>Бесплатно — 1 пациент в день.</b><span class="small muted">С подпиской — сколько угодно пациентов, все функции те же. Оплата картой или через СБП.</span></div>`}
    <div class="plans">${order.map((k) => html`<div class="plan ${k === "month" ? "best" : ""}">
      <div class="small muted">${plans[k].label}</div>
      <div class="price">${Number(plans[k].price).toLocaleString("ru")} ₽</div>
      <button class="btn block sm" data-plan="${k}">Оплатить</button></div>`)}</div>
    <p class="tiny muted center">После оплаты доступ включится автоматически — и в боте, и на сайте.</p>
  </div>`);
  root.querySelectorAll("[data-plan]").forEach((b) => (b.onclick = async () => {
    btnBusy(b);
    try {
      const { link } = await api("POST", "/pay", { plan: b.dataset.plan });
      if (IN_TG && tg.openLink) tg.openLink(link);
      else location.href = link;
    } catch (e) {
      toast(e.message, "error");
    }
    btnBusy(b, false);
  }));
}

// ---------------------------------------------------
// Нижний лист
// ---------------------------------------------------
let sheetOnClose = null;
function openSheet(content, bind, onClose) {
  closeSheet(true);
  sheetOnClose = onClose || null;
  sheetRoot.innerHTML = html`<div class="sheet-backdrop" id="sheet-bg"><div class="sheet" role="dialog" aria-modal="true"><div class="grip"></div>${content}</div></div>`[RAW];
  const bg = $("#sheet-bg");
  bg.addEventListener("click", (e) => { if (e.target === bg) closeSheet(); });
  const sheet = bg.querySelector(".sheet");
  if (bind) bind(sheet);
  document.addEventListener("keydown", escClose);
}
function escClose(e) { if (e.key === "Escape") closeSheet(); }
function closeSheet(silent = false) {
  if (!sheetRoot.innerHTML) return;
  sheetRoot.innerHTML = "";
  document.removeEventListener("keydown", escClose);
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (!silent && cb) cb();
}

boot();
