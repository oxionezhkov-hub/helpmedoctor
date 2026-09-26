// =====================================================
// Help me, Doctor — веб-приложение (работает и в Telegram, и в браузере)
// Без сборки: чистый ES-модуль. Данные — /api, живая синхронизация — WebSocket.
// =====================================================

// Скрипт Telegram грузим только когда нас открыли из Telegram — в браузере он не нужен
const TG_LAUNCH = /tgWebApp/.test(location.hash + (window.__hmdQs ?? location.search)) || sessionStore("hmd_tg") === "1";
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
  more: new Set(),     // раскрытые длинные списки
  reveal: null,        // реплика пациента, которая сейчас «печатается» по словам
  revealTs: 0,         // результат обследования/осмотра, который появляется с анимацией
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
  key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 17 11"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  heart: '<path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/><path d="M3.5 12h4l2-3 3 6 2-3h6" class="pulse"/>',
  telegram: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4Z"/><path d="m9 13 12-9"/>',
  party: '<path d="M4 20 9 7l8 8Z"/><path d="M14 4v2M19 9h2M17 3l-1 2M20 6l-2 1"/>',
  sad: '<circle cx="12" cy="12" r="9"/><path d="M8 16a5 5 0 0 1 8 0M9 9.5h.01M15 9.5h.01"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
// Логотипы способов входа — в фирменных цветах
const BRAND = {
  google: '<svg class="i brand" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
  yandex: '<svg class="i brand" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#FC3F1D"/><path fill="#fff" d="M13.32 7.666h-.924c-1.694 0-2.585.858-2.585 2.123 0 1.43.616 2.1 1.881 2.959l1.045.704-3.003 4.487H7.49l2.695-4.014c-1.55-1.111-2.42-2.19-2.42-4.015 0-2.288 1.595-3.85 4.62-3.85h3.003v11.868H13.32V7.666z"/></svg>',
  telegram: '<svg class="i brand" viewBox="0 0 240 240" aria-hidden="true"><circle cx="120" cy="120" r="120" fill="#2AABEE"/><path fill="#fff" d="M54.3 118.8c35-15.2 58.3-25.3 70-30.2 33.3-13.9 40.3-16.3 44.8-16.4 1 0 3.2.2 4.7 1.4 1.2 1 1.5 2.3 1.7 3.3s.4 3.1.2 4.7c-1.8 19-9.6 65.1-13.6 86.3-1.7 9-5 12-8.2 12.3-7 .6-12.3-4.6-19-9-10.6-6.9-16.5-11.2-26.8-18-11.9-7.8-4.2-12.1 2.6-19.1 1.8-1.8 32.5-29.8 33.1-32.3.1-.3.1-1.5-.6-2.1-.7-.6-1.7-.4-2.5-.2-1.1.2-17.9 11.4-50.6 33.5-4.8 3.3-9.1 4.9-13 4.8-4.3-.1-12.5-2.4-18.7-4.4-7.5-2.4-13.5-3.7-13-7.9.3-2.2 3.3-4.4 8.9-6.7z"/></svg>',
};
const PROVIDER_LABEL = { google: "Google", yandex: "Яндекс ID", telegram: "Telegram" };
const brand = (name) => raw(BRAND[name] || "");
const ic = (name, cls = "") => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`);

function hashHue(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
/** Аватар пациента: рисованное лицо (Open Peeps) по полу, возрасту и самочувствию; у инопланетянина — своя иконка */
function patAvatar(p, size = "") {
  if (p.is_alien) return html`<div class="pav alien ${size}">${ic("alien")}</div>`;
  const rating = p.last_rating ?? p.consultations?.at?.(-1)?.rating;
  const mood = rating == null ? "" : rating >= 4 ? "good" : rating < 3 ? "bad" : "";
  const q = new URLSearchParams({ v: "3", s: p.id || p.name || "", g: p.sex === "female" ? "f" : "m", a: String(parseInt(p.age, 10) || 0), ...(mood ? { m: mood } : {}) });
  return html`<div class="pav face ${size}" style="--h:${hashHue(p.name)}"><img src="/api/face?${q}" alt="" loading="lazy"></div>`;
}
/** Аватар врача: фото (из Telegram или своё) или первая буква имени */
function userAvatar(p, cls = "") {
  if (p.avatar?.id) return html`<img class="avatar ${cls}" src="/api/avatar/${p.avatar.id}" alt="">`;
  return html`<div class="avatar ${cls}">${initials(p.name)}</div>`;
}

/** Длинные списки: первые 5, остальное — по кнопке */
const LIST_LIMIT = 5;
function limited(key, items, render) {
  if (items.length <= LIST_LIMIT || S.more.has(key)) return items.map(render);
  return html`${items.slice(0, LIST_LIMIT).map(render)}<button class="btn ghost block more-btn" data-more="${key}">Показать все · ${items.length}</button>`;
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
// Доля выполнения: до оценки — почти линейно, после — медленно ползём к 97%. Никогда не убывает.
const etaMax = new Map();
function etaState(kind, start, est, now = Date.now()) {
  const t = Math.max(0, now - start);
  let frac = t < est ? 0.9 * (t / est) : 0.9 + 0.07 * (1 - Math.exp(-(t - est) / est));
  const key = `${kind}:${start}`;
  frac = Math.max(frac, etaMax.get(key) || 0);
  etaMax.set(key, frac);
  const sec = Math.ceil((est - t) / 1000);
  const steps = ETA_STEPS[kind] || [];
  const step = steps.length ? steps[Math.min(steps.length - 1, Math.floor((Math.min(frac, 0.9) / 0.9) * steps.length))] + "…" : "Загрузка…";
  return { frac, left: sec > 0 ? `≈ ${sec} сек` : "ещё немного…", step };
}
/** Блок прогресса: полоса + этап + «осталось ≈ N сек». Сразу рисуется с актуальным заполнением. */
function etaBox(kind, start, extraCls = "") {
  const est = etaEstimate(kind);
  const st = etaState(kind, start, est);
  return html`<div class="eta ${extraCls}" id="eta-${kind}-${start}" data-eta="${kind}" data-start="${start}" data-est="${est}">
    <div class="eta-top"><span class="eta-step">${st.step}</span><span class="eta-left">${st.left}</span></div>
    <div class="eta-bar"><i style="transform:scaleX(${st.frac.toFixed(4)})"></i></div></div>`;
}
// Полоса — каждый кадр (плавно), текст — не чаще 4 раз в секунду
let etaTextAt = 0;
function tickEta() {
  const els = document.querySelectorAll("[data-eta]");
  if (els.length) {
    const now = Date.now();
    const updText = now - etaTextAt > 250;
    if (updText) etaTextAt = now;
    els.forEach((el) => {
      const st = etaState(el.dataset.eta, Number(el.dataset.start), Number(el.dataset.est), now);
      const bar = el.firstElementChild?.nextElementSibling?.firstElementChild;
      if (bar) bar.style.transform = `scaleX(${st.frac.toFixed(4)})`;
      if (updText) {
        const step = el.querySelector(".eta-step"), left = el.querySelector(".eta-left");
        if (step && step.textContent !== st.step) step.textContent = st.step;
        if (left && left.textContent !== st.left) left.textContent = st.left;
      }
    });
  }
  requestAnimationFrame(tickEta);
}
requestAnimationFrame(tickEta);

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

// ---------- Поле + кнопка «OK» ----------
// Форма, а не keydown: «Готово»/«Ввод» на мобильной клавиатуре отправляет её везде.
// pointerdown без blur: иначе клавиатура закрывается, вёрстка прыгает и нажатие проходит мимо кнопки.
function inlineForm(id, placeholder, maxlength, btnLabel = "OK", btnCls = "btn") {
  return html`<form class="row inline-form" data-inline="${id}" autocomplete="off">
    <input class="input grow" id="${id}" placeholder="${placeholder}" maxlength="${maxlength}" enterkeyhint="done">
    <button type="submit" class="${btnCls}" id="${id}-go">${btnLabel}</button></form>`;
}
function bindInlineForm(id, onValue) {
  const form = document.querySelector(`[data-inline="${id}"]`);
  if (!form) return;
  const input = form.querySelector("input");
  const btn = form.querySelector("button");
  btn.onpointerdown = (e) => { if (document.activeElement === input) e.preventDefault(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return input.focus();
    onValue(v, input);
  };
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
  // style, выставленный из JS (полоса прогресса, высота поля ввода), не трогаем; устаревший из разметки — убираем
  const liveStyle = from.tagName === "TEXTAREA" || from.closest?.("[data-eta]");
  for (const a of [...from.attributes]) if (!to.hasAttribute(a.name) && !(a.name === "style" && liveStyle)) from.removeAttribute(a.name);
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
    // Небольшая анимация входа на новый экран
    root.classList.remove("enter");
    void root.offsetWidth;
    root.classList.add("enter");
    clearTimeout(patchRoot.t);
    patchRoot.t = setTimeout(() => root.classList.remove("enter"), 400);
  } else {
    const tpl = document.createElement("div");
    tpl.innerHTML = markup;
    morphChildren(root, tpl);
  }
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
  const headers = { "X-Client": IN_TG ? "miniapp" : "web" };
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
  const goParam = new URLSearchParams(window.__hmdQs ?? location.search).get("go");
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
    // Одноразовый код входа: из мини-приложения («Открыть на сайте») или после Google / Яндекса.
    // Остальные параметры — итог привязки способа входа и метка, откуда пришёл посетитель (для аналитики)
    // app.html убирает параметры из адреса до загрузки Метрики (код входа не должен уходить в аналитику) и оставляет их в window.__hmdQs
    const qs = new URLSearchParams(window.__hmdQs ?? location.search);
    const handoff = qs.get("login");
    if (qs.get("from")) sessionStore("hmd_from", qs.get("from").slice(0, 40));
    S.authNotice = AUTH_NOTICES[qs.get("auth_error")] || (qs.get("linked") ? `${PROVIDER_LABEL[qs.get("linked")] || "Аккаунт"} привязан — теперь можно входить и так` : null)
      || (qs.get("link_error") ? LINK_ERRORS[qs.get("link_error")] || "Не удалось привязать аккаунт" : null);
    S.authNoticeKind = qs.get("linked") ? "ok" : "error";
    if (location.search) history.replaceState(null, "", `${location.pathname}${location.hash}`);
    if (handoff) {
      try {
        // cn — nonce этого браузера из oauthStart: код после Google/Яндекса без него не отдаётся
        const cn = sessionStore("hmd_oauth_cn") || "";
        const r = await api("GET", `/auth/poll?code=${encodeURIComponent(handoff)}${cn ? `&cn=${encodeURIComponent(cn)}` : ""}`);
        if (r.status === "ok") {
          store(TOKEN_KEY, r.token);
          goal("login_ok", { via: cn ? "oauth" : "handoff" });
        } else if (cn) S.authNotice = AUTH_NOTICES.state;
      } catch {}
      sessionStore("hmd_oauth_cn", "");
    }
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
  if (S.authNotice) toast(S.authNotice, S.authNoticeKind), (S.authNotice = null);
  api("POST", "/event", { type: "app_open" }).catch(() => {});
  followIntent();
}

/** Цели Яндекс Метрики (счётчик сайта) */
function goal(name, params) {
  try { window.ym?.(113057442, "reachGoal", name, params); } catch {}
}

/** Пришли с сайта по кнопке тарифа (from=…_trial / _month …) — после входа сразу открываем тарифы */
function followIntent() {
  const from = sessionStore("hmd_from") || "";
  if (!/_(trial|week|month|quarter|year)$/.test(from) || !S.me?.profile?.onboarding_done || IN_TG) return;
  sessionStore("hmd_from", from.replace(/_(trial|week|month|quarter|year)$/, "_done"));
  if (!location.hash || location.hash === "#/") go("/plans", true);
}

const AUTH_NOTICES = {
  cancel: "Вход отменён",
  state: "Ссылка входа устарела — попробуйте ещё раз",
  provider: "Сервис входа не ответил — попробуйте ещё раз или войдите через Telegram",
};
const LINK_ERRORS = {
  taken: "Этот аккаунт уже привязан к другому профилю. Войдите через него и отвяжите его там",
  has_other: "К профилю уже привязан другой аккаунт этого сервиса — сначала отвяжите его",
};

/** Google / Яндекс: сервер ставит cookie с nonce и отдаёт адрес страницы входа провайдера.
 *  cn — ещё один nonce, в sessionStorage этой вкладки: без него код входа после возврата не отдаётся */
async function oauthStart(provider, mode = "login", btn = null) {
  if (btn) btnBusy(btn);
  try {
    const cn = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
    sessionStore("hmd_oauth_cn", mode === "login" ? cn : "");
    const { url } = await api("POST", "/auth/oauth/start", { provider, mode, cn, from: sessionStore("hmd_from") || "" });
    goal(`auth_${provider}`, { mode });
    location.href = url;
  } catch (e) {
    toast(e.message, "error");
    if (btn) btnBusy(btn, false);
  }
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
  goal("login_view");
  // Способы входа и код для бота запрашиваем вместе — экран рисуется один раз, без прыжков
  const [cfg, lr] = await Promise.all([
    api("GET", "/config").catch(() => ({ providers: [] })),
    api("POST", "/auth/login", { from: sessionStore("hmd_from") || "" }).catch((e) => ({ error: e.message })),
  ]);
  const providers = ["yandex", "google"].filter((p) => (cfg.providers || []).includes(p));
  // Порядок: Telegram (прогресс общий с ботом), затем Яндекс ID и Google
  root.innerHTML = html`<div class="login"><div class="card stack">
    <div class="logo">${ic("heart")}</div>
    <h1>Help me, Doctor</h1>
    <p class="muted">Войдите, чтобы принять первого пациента. Дальше — четыре вопроса о вас, около минуты.</p>
    <div class="stack-sm">
      <a class="btn lg block oauth-btn" id="login-btn" href="${lr.tg || lr.url || "#"}">${brand("telegram")}<span>Войти через Telegram</span></a>
      ${providers.map((p) => html`<button class="btn lg block oauth-btn" data-oauth="${p}" type="button">${brand(p)}<span>Войти через ${PROVIDER_LABEL[p]}</span></button>`)}
    </div>
    <p class="tiny muted" id="login-hint" hidden></p>
  </div></div>`[RAW];
  if (S.authNotice) toast(S.authNotice, S.authNoticeKind), (S.authNotice = null);
  root.querySelectorAll("[data-oauth]").forEach((b) => (b.onclick = () => oauthStart(b.dataset.oauth, "login", b)));
  if (lr.error) {
    $("#login-hint").textContent = lr.error;
    $("#login-hint").hidden = false;
    return;
  }
  const code = lr.code;
  const r = lr;
  const btn = $("#login-btn");
  // tg:// открывает приложение Telegram сразу, без новой вкладки; эта страница остаётся и ждёт подтверждения
  btn.onclick = () => {
    goal("auth_telegram");
    btn.innerHTML = html`${ic("clock")}<span>Ждём подтверждения…</span>`[RAW];
    $("#login-hint").innerHTML = html`Нажмите в боте «Запустить» и вернитесь сюда — сайт войдёт сам.<br>Telegram не открылся? <a href="${r.url}" target="_blank" rel="noopener">Открыть бота в браузере</a>`[RAW];
    $("#login-hint").hidden = false;
  };
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
        goal("login_ok", { via: "telegram" });
        await loadMe();
        connectWs();
        window.addEventListener("hashchange", route);
        route();
        toast("Вы вошли");
        followIntent();
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
  // Этот веб-аккаунт объединён с Telegram: тот же токен теперь ведёт в общий профиль
  if (msg.scope === "merged") {
    try { S.ws?.close(); } catch {}
    S.patients.clear();
    loadMe().then(() => rerender(true)).catch(() => {});
    return;
  }
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
  if (msg.scope === "guide" && msg.patient_id) onGuide(msg.patient_id);
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
  if (parts[0] === "profile" && parts[1] === "stats") return { name: "stats", params: {}, q };
  if (parts[0] === "profile" && parts[1] === "settings") return { name: "settings", params: {}, q };
  if (parts[0] === "profile" && parts[1] === "accounts") return { name: "accounts", params: {}, q };
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
  if (sheetRoot.innerHTML) return closeSheet(); // сначала закрываем открытый лист
  if (r.name === "consult") return go(`/patient/${r.params.id}`);
  if (r.name === "patient") return go(r.q.from === "consult" ? `/consult/${r.params.id}` : "/patients");
  if (r.name === "quiz") return go("/quizzes");
  if (["plans", "stats", "settings"].includes(r.name)) return go("/profile");
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
  const views = { home: viewHome, patients: viewPatients, patient: viewPatient, consult: viewConsult, quizzes: viewQuizzes, quiz: viewQuiz, profile: viewProfile, stats: viewStats, settings: viewSettings, plans: viewPlans, accounts: viewAccounts };
  (views[r.name] || viewHome)(fresh);
}

function renderShell(content, withNav = true) {
  const r = S.route.name;
  const pendingQuizzes = (S.me?.quizzes || []).filter((q) => q.status !== "done").length;
  const queue = (S.me?.patients || []).filter((p) => p.status !== "closed").length;
  const tab = (name, href, ico, label, badge) => html`<a href="#${href}" class="${r === name || (name === "patients" && r === "patient") || (name === "quizzes" && r === "quiz") || (name === "profile" && ["plans", "stats", "settings", "accounts"].includes(r)) ? "active" : ""}">
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
      <a href="#/profile" class="avatar-link" aria-label="Профиль">${userAvatar(p)}</a>
      <div class="grow">
        <h1 class="ellipsis">Доктор ${p.name}</h1>
        <div class="muted small">${!p.onboarding_done ? "Настройка профиля" : html`${p.level_label} · ${p.profession}`}${p.has_sub ? html` · <span class="badge accent">${ic("gem")} Безлимит</span>` : ""}</div>
      </div>
      ${IN_TG ? html`<button class="icon-btn site-btn" data-open-site aria-label="Открыть на сайте" title="Открыть на сайте">${ic("external")}</button>` : ""}
    </div>

    ${trialNotice(p)}
    ${p.onboarding_done ? html`<div class="card stack">
      <div class="row between"><b>Уровень ${lvl.level}</b><span class="small muted">${p.xp || 0}${lvl.to ? ` / ${lvl.to}` : ""} XP</span></div>
      <div class="xp-bar"><i style="width:${xpPct}%"></i></div>
      <div class="stats">
        <div class="stat"><b class="row-c">${ic("flame", "c-flame")}${p.streak || 0}</b><span>${plural(p.streak || 0, "день", "дня", "дней")} подряд</span></div>
        <div class="stat"><b>${p.stats.ratings_count ? p.stats.avg_rating.toFixed(1) : "—"}</b><span>средняя оценка</span></div>
        <div class="stat"><b>${p.stats.consultations_total || 0}</b><span>${plural(p.stats.consultations_total || 0, "приём", "приёма", "приёмов")}</span></div>
      </div>
    </div>` : ""}

    ${!p.onboarding_done ? onboardingCard() : ""}

    ${task && p.onboarding_done ? html`<div class="card task">
      <div class="tile ${task.done ? "ok" : "accent"}">${ic(task.done ? "checkCircle" : "target")}</div>
      <div class="grow">
        <div class="tiny muted">ЗАДАНИЕ ДНЯ · +${task.xp} XP</div>
        <div><b>${task.desc}</b></div>
        ${task.done ? html`<div class="small" style="color:var(--ok)">Выполнено!</div>` : html`<div class="progress"><i style="width:${Math.min(100, Math.round(((task.progress || 0) / task.target) * 100))}%"></i></div>`}
      </div>
    </div>` : ""}

    ${p.onboarding_done ? newPatientBlock() : ""}

    ${inConsult.length ? html`<div class="section-title">Идёт приём</div>
      ${patientCard(inConsult[0], `/consult/${inConsult[0].id}`, "Продолжить приём")}` : ""}

    ${waiting.length ? html`<div class="section-title">Ждёт приёма</div>${patientCard(waiting[0])}` : ""}

    ${active.length > (inConsult.length ? 1 : 0) + (waiting.length ? 1 : 0) ? html`<a class="more-link" href="#/patients">Все пациенты в очереди · ${active.length}${ic("chevron")}</a>` : ""}

    ${pendingQuiz ? html`<div class="section-title">Тест</div><a class="card tap row" href="#/quiz/${pendingQuiz.pat_id}" style="text-decoration:none;color:inherit">
      <div class="tile warn">${ic("quiz")}</div>
      <div class="grow"><b>Работа над ошибками</b><div class="small muted ellipsis">${pendingQuiz.pat_name} · ${pendingQuiz.pat_diagnosis}</div></div>
      ${pendingQuiz.locked ? html`<span class="badge accent">${ic("gem")}</span>` : html`<span class="badge warn">${pendingQuiz.answered}/${pendingQuiz.total}</span>`}
    </a>` : ""}

    ${p.onboarding_done && !active.length && !patients.length ? html`<div class="card stack center">
      <div class="tile accent lg">${ic("steth")}</div>
      <b>Как это работает</b>
      <p class="small muted">Примите пациента, расспросите его текстом или голосом, назначьте обследования и осмотр, поставьте диагноз. Эксперт разберёт приём, а вы получите опыт и тест по своим ошибкам.</p>
    </div>` : ""}
  </div>`);
  if (!fresh) window.scrollTo(0, y);
  bindNewPatient();
  bindOnboarding();
}

// ---------- Анкета нового пользователя ----------
// Роль → специальность → разделы → сложность (+ пара слов о себе) → профиль и сразу первый пациент
let onb = null;
const ONB_STEPS = 4;
function onbState() {
  if (!onb) onb = { step: 1, level: null, profession: null, custom: "", options: [], specs: new Set(), difficulty: null, about: "", suggesting: false };
  return onb;
}
function onbRecommended() {
  const lvl = S.me.config.levels.find((l) => l.key === onb.level);
  return lvl?.complexity || "medium";
}

/** За двое суток до конца пробного премиума — напоминание прямо в приложении (веб-аккаунтам бот не пишет) */
function trialNotice(p) {
  const a = p.autopay;
  if (!a || a.status !== "active" || !a.trial || !a.next_at) return "";
  const left = a.next_at - Date.now();
  if (left <= 0 || left > 2 * 86400000) return "";
  return html`<a class="card row notice" href="#/plans" style="text-decoration:none;color:inherit">
    <div class="tile warn">${ic("clock")}</div>
    <div class="grow"><b>Пробный премиум заканчивается ${dateText(a.next_at)}</b><div class="small muted">Дальше — ${a.price} ₽ в месяц автоматически. Отключить можно в «Подписке» в один клик.</div></div>${ic("chevron", "c-muted")}</a>`;
}

function onboardingCard() {
  const o = onbState();
  const cfg = S.me.config;
  const back = o.step > 1 ? html`<button class="btn ghost" id="onb-back">${ic("back")}<span>Назад</span></button>` : html`<button class="btn ghost" id="onb-skip">Пропустить</button>`;
  let body = "";
  let next = "";
  if (o.step === 1) {
    body = html`<h3>Кто вы?</h3>
      <div class="stack-sm">${cfg.levels.map((l) => html`<button class="onb-opt ${o.level === l.key ? "on" : ""}" data-onb-level="${l.key}"><b>${l.label}</b></button>`)}</div>`;
  } else if (o.step === 2) {
    const custom = o.profession === "__custom";
    body = html`<h3>Какая специальность вам интересна?</h3><p class="small muted">Пациенты будут из этой области.</p>
      <div class="row wrap" style="gap:6px">${Object.keys(cfg.specializations).map((x) => html`<button class="chip ${o.profession === x ? "on" : ""}" data-onb-prof="${x}">${x}</button>`)}<button class="chip ${custom ? "on" : ""}" data-onb-prof="__custom">Другая…</button></div>
      ${custom ? html`<input class="input" id="onb-custom" value="${o.custom}" placeholder="Например: эндокринолог" maxlength="40">` : ""}`;
    next = html`<button class="btn" id="onb-next" ${o.profession && (!custom || o.custom.length >= 3) ? "" : "disabled"}>${o.suggesting ? html`<span class="spin"></span>` : ""}<span>Далее</span></button>`;
  } else if (o.step === 3) {
    body = html`<h3>Какие разделы интересны?</h3><p class="small muted">${o.custom || o.profession}: отметьте один или несколько — пациенты будут из них. Без отметок — из всех.</p>
      <div class="row wrap" style="gap:6px">${o.options.map((x) => html`<button class="chip ${o.specs.has(x) ? "on" : ""}" data-onb-spec="${x}">${x}</button>`)}</div>`;
    next = html`<button class="btn" id="onb-next"><span>${o.specs.size ? `Далее · ${o.specs.size}` : "Далее · все разделы"}</span></button>`;
  } else {
    const rec = onbRecommended();
    const cur = o.difficulty || rec;
    body = html`<h3>Какая сложность пациентов?</h3>
      <div class="stack-sm">${cfg.difficulties.map((d) => html`<button class="onb-opt ${cur === d.key ? "on" : ""}" data-onb-diff="${d.key}">
        <b>${d.emoji} ${d.label}${d.key === rec ? html` <span class="badge accent">рекомендуем</span>` : ""}${d.key === "hard" && !S.me.profile.premium ? html` <span class="badge">${ic("gem")} премиум</span>` : ""}</b><span class="small muted">${d.hint}</span></button>`)}</div>
      <div class="field"><label>Пара слов о себе <span class="muted">— необязательно</span></label>
        <textarea id="onb-about" maxlength="600" placeholder="Где учитесь или работаете, что хотите прокачать">${o.about}</textarea></div>`;
    next = html`<button class="btn" id="onb-finish">${ic("steth")}<span>Получить первого пациента</span></button>`;
  }
  return html`<div class="card stack onb" id="onb">
    <div class="row between"><span class="tiny muted">НАСТРОЙКА ПОД ВАС · ${o.step}/${ONB_STEPS}</span></div>
    <div class="onb-dots">${[1, 2, 3, 4].map((i) => html`<i class="${i <= o.step ? "on" : ""}"></i>`)}</div>
    ${body}
    <div class="grid-2">${back}${next || html`<span></span>`}</div>
  </div>`;
}

async function onbSuggest() {
  const o = onb;
  const known = Object.keys(S.me.config.specializations).find((k) => k.toLowerCase() === o.custom.toLowerCase());
  if (known) { o.profession = known; o.custom = ""; o.options = [...S.me.config.specializations[known]]; return true; }
  o.suggesting = true;
  viewHome();
  try {
    const { sections } = await api("POST", "/sections/suggest", { profession: o.custom });
    o.options = sections.length ? sections : [o.custom.toLowerCase()];
    return true;
  } catch (e) {
    toast(e.message, "error");
    return false;
  } finally {
    o.suggesting = false;
  }
}

function bindOnboarding() {
  if (!$("#onb") || !onb) return;
  const o = onb;
  const cfg = S.me.config;
  const redraw = () => { viewHome(); $("#onb")?.scrollIntoView({ block: "nearest" }); };
  const skip = $("#onb-skip");
  if (skip) skip.onclick = async (e) => {
    btnBusy(e.currentTarget);
    try {
      const { profile } = await api("PATCH", "/profile", { onboarding_done: true, skipped: true });
      S.me.profile = profile;
      onb = null;
      viewHome();
    } catch (err) { toast(err.message, "error"); btnBusy(e.currentTarget, false); }
  };
  const back = $("#onb-back");
  if (back) back.onclick = () => { o.step -= 1; redraw(); };
  root.querySelectorAll("[data-onb-level]").forEach((b) => (b.onclick = () => { o.level = b.dataset.onbLevel; o.difficulty = null; o.step = 2; haptic(); redraw(); }));
  root.querySelectorAll("[data-onb-prof]").forEach((b) => (b.onclick = () => {
    o.profession = b.dataset.onbProf;
    if (o.profession !== "__custom") { o.custom = ""; o.options = [...cfg.specializations[o.profession]]; o.specs = new Set(); o.step = 3; }
    redraw();
    if (o.profession === "__custom") $("#onb-custom")?.focus();
  }));
  const ci = $("#onb-custom");
  if (ci) ci.oninput = () => { o.custom = ci.value.trim(); const n = $("#onb-next"); if (n) n.disabled = o.custom.length < 3; };
  root.querySelectorAll("[data-onb-spec]").forEach((b) => (b.onclick = () => {
    const x = b.dataset.onbSpec;
    if (o.specs.has(x)) o.specs.delete(x); else o.specs.add(x);
    redraw();
  }));
  root.querySelectorAll("[data-onb-diff]").forEach((b) => (b.onclick = () => { o.difficulty = b.dataset.onbDiff; o.about = $("#onb-about")?.value || o.about; redraw(); }));
  const about = $("#onb-about");
  if (about) about.oninput = () => { o.about = about.value; };
  const next = $("#onb-next");
  if (next) next.onclick = async () => {
    if (o.step === 2 && o.profession === "__custom") {
      if (o.custom.length < 3 || o.suggesting) return;
      o.specs = new Set();
      if (!(await onbSuggest())) return redraw();
    }
    o.step += 1;
    redraw();
  };
  const fin = $("#onb-finish");
  if (fin) fin.onclick = async () => {
    btnBusy(fin);
    haptic("success");
    const profession = o.profession === "__custom" ? o.custom[0].toUpperCase() + o.custom.slice(1) : o.profession;
    const specs = o.specs.size ? o.options.filter((x) => o.specs.has(x)) : o.options;
    try {
      const { profile } = await api("PATCH", "/profile", {
        level: o.level, profession, specializations: specs, difficulty: o.difficulty || onbRecommended(),
        about: (o.about || "").trim(), onboarding_done: true,
      });
      S.me.profile = profile;
      onb = null;
      goal("onboarding_done", { level: o.level });
      // Первый пациент — сразу, по только что выбранному профилю
      try {
        S.expectNewPatient = Date.now();
        await api("POST", "/patients/new");
        S.me.profile.generating_patient = true;
      } catch (e) {
        S.expectNewPatient = 0;
        toast(e.message, "error");
      }
      toast("Профиль готов — подбираем первого пациента", "ok");
      viewHome(true);
    } catch (e) {
      toast(e.message, "error");
      btnBusy(fin, false);
    }
  };
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
    const pack = S.me.offer?.packs?.patients3;
    return html`<div class="card stack center">
      <b>Бесплатный пациент на сегодня принят</b>
      <p class="small muted">Новый — завтра после полуночи (МСК).${p.trial_available ? " Или 7 дней безлимита за 1 ₽." : ""}</p>
      <a class="btn block" href="#/plans" ${p.trial_available ? html`data-checkout="trial"` : ""}>${ic("gem")}<span>${p.trial_available ? "Премиум 7 дней за 1 ₽" : "Безлимитный доступ"}</span></a>
      ${pack ? html`<a class="btn block ghost" href="#/plans" data-checkout="patients3">${ic("plus")}<span>${pack.label.replace(/^\+/, "")} — ${rub(pack.price)} ₽</span></a>` : ""}
    </div>`;
  }
  return html`<button class="btn lg block" id="new-patient">${ic("plus")}<span>Принять нового пациента</span></button>
    <p class="tiny muted center kr-note">${ic("book")} Разбор каждого приёма — по клиническим рекомендациям Минздрава РФ</p>`;
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
      if (e.code === "limit") checkout(S.me.offer?.packs?.patients3 && !S.me.profile.trial_available ? "patients3" : "trial");
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
    ${items.length ? limited(`patients-${patientsTab}`, items, (x) => patientCard(x)) : html`<div class="empty"><div class="tile lg">${ic(patientsTab === "queue" ? "inbox" : "archive")}</div>${patientsTab === "queue" ? "Очередь пуста" : "Здесь появятся пациенты после приёма"}</div>`}
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
    <div class="page-head"><button class="back" data-go="${S.route.q.from === "consult" ? `/consult/${p.id}` : "/patients"}" aria-label="Назад">${ic("back")}</button><h2 class="grow ellipsis">Карточка пациента</h2></div>
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
      <div class="grow"><b>Работа над ошибками</b><div class="small muted">${quiz.locked ? `${quiz.total} вопросов по вашим ошибкам · в премиуме` : quiz.status === "done" ? `Пройден: ${quiz.score} из ${quiz.total}` : `${quiz.answered} из ${quiz.total} вопросов`}</div></div>
      ${quiz.locked ? html`<span class="badge accent">${ic("gem")} премиум</span>` : ic("chevron", "c-muted")}</a>` : ""}

    ${consults.length ? html`<div class="section-title">Приёмы</div>
      ${consults.map((c, i) => html`<div class="card stack">
        <div class="row between"><b>Приём №${consults.length - i}</b><span class="tiny muted">${dateText(c.date)}</span></div>
        ${c.evaluating ? etaBox("evaluation", c.date) : evaluationBlock(c)}
        ${actionsSummary(c)}
        ${!c.evaluating ? guideBlock(c, { pending: i === 0 && Date.now() - c.date < 5 * 60000 }) : ""}
      </div>`)}` : ""}

    ${p.test_results?.length ? html`<div class="section-title">Результаты обследований</div>
      ${[...p.test_results].reverse().map((t) => html`<details class="card"><summary><b class="row-c">${ic("flask", "c-accent")}${t.test}</b> <span class="tiny muted">· ${dateText(t.ordered_at)}</span></summary><div class="pre small" style="margin-top:10px;font-family:ui-monospace,Menlo,monospace">${t.result}</div></details>`)}` : ""}

    ${!never && !consults.some((c) => c.evaluating) ? html`<button class="btn block ghost c-danger" data-delete-patient="${p.id}">${ic("trash")}<span>Удалить пациента</span></button>` : ""}
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
    ${c.hints ? html`<div class="small fact">${ic("bulb", "c-warn")}<span>Подсказок взято: ${c.hints} — оценка ниже на ${String(Math.round(c.hints * 2) / 10).replace(".", ",")}</span></div>` : ""}
    ${c.locked ? html`<div class="locked-teaser" aria-hidden="true"><div class="quote small">«Где именно болит и когда началось?»</div><div class="small">Хороший открытый вопрос, но не уточнили…</div><div class="small">Что было дальше: через три недели…</div></div>
      ${premiumCta("Полный разбор: цитаты из диалога, совет эксперта и «что было дальше»")}` : ""}
    ${(f.dialog_moments || []).map((m) => html`<div class="stack-sm">${m.quote ? html`<div class="quote small">«${m.quote}»</div>` : ""}<div class="small">${m.comment}</div></div>`)}
    ${f.recommendation ? html`<div class="small fact">${ic("bulb", "c-warn")}<div><b>Совет:</b> ${f.recommendation}</div></div>` : ""}
    ${c.post_story ? html`<div class="card flat" style="background:var(--surface-2)"><div class="tiny muted row-c">${ic("book")} ЧТО БЫЛО ДАЛЬШЕ</div><div class="small">${c.post_story}</div></div>` : ""}
  </div>`;
}

/** Разбор по клиническим рекомендациям Минздрава: как распознать, обязательный минимум, диагностика, лечение с дозами */
function guideBlock(c, { pending = false } = {}) {
  const g = c.guide;
  if (!g) {
    if (!pending) return "";
    return html`<div class="card flat guide guide-wait"><div class="row-c"><span class="spinner"></span><b>Готовим разбор по клиническим рекомендациям Минздрава РФ</b></div><p class="small muted">Чек-лист диагностики, препараты и схемы лечения с дозами — обычно около минуты.</p></div>`;
  }
  const missed = g.must.filter((x) => !x.done).length;
  return html`<div class="guide stack">
    <div class="guide-head">
      <div class="tiny muted">РАЗБОР ПО КЛИНИЧЕСКИМ РЕКОМЕНДАЦИЯМ</div>
      ${g.kr ? html`<a class="guide-kr" href="${g.kr.url}" target="_blank" rel="noopener">${ic("book")}<span>КР Минздрава РФ «${g.kr.name}»</span>${ic("external")}</a>`
        : html`<div class="small muted">Действующих клинических рекомендаций Минздрава по этому диагнозу в рубрикаторе нет — разбор по российской клинической практике.</div>`}
    </div>
    ${g.diagnosis_path?.length ? html`<div class="stack-sm"><h4>Как надо было распознать</h4><ol class="guide-path">${g.diagnosis_path.map((x) => html`<li>${x}</li>`)}</ol></div>` : ""}
    ${g.must?.length ? html`<div class="stack-sm"><h4>Обязательно по КР <span class="badge ${missed ? "warn" : "ok"}">${g.must.length - missed} из ${g.must.length}</span></h4>
      <ul class="checklist">${g.must.map((x) => html`<li class="${x.done ? "done" : "miss"}">${ic(x.done ? "checkCircle" : "xCircle", x.done ? "c-ok" : "c-danger")}<span>${x.item}</span></li>`)}</ul></div>` : ""}
    ${g.optional?.length ? html`<div class="stack-sm"><h4>Желательно, но не обязательно</h4><ul class="checklist soft">${g.optional.map((x) => html`<li>${ic("plus", "c-muted")}<span>${x}</span></li>`)}</ul></div>` : ""}
    ${g.locked ? html`<div class="locked-teaser" aria-hidden="true"><h4>Лучшая диагностика</h4><div class="small">ЭГДС с биопсией — подтвердить…</div><h4>Лечение</h4><div class="small">Препарат — 20 мг 2 раза в сутки, 14 дней…</div></div>
      ${premiumCta(`Лучшая диагностика${g.counts?.treatment ? `, ${g.counts.treatment} ${plural(g.counts.treatment, "препарат", "препарата", "препаратов")} с дозами` : ""} и схема лечения по КР`)}` : ""}
    ${g.tests?.length ? html`<div class="stack-sm"><h4>Лучшая диагностика</h4>${g.tests.map((x) => html`<div class="guide-item">${ic("flask", "c-accent")}<div><b>${x.name}</b>${x.why ? html`<div class="small muted">${x.why}</div>` : ""}</div></div>`)}</div>` : ""}
    ${g.treatment?.length ? html`<div class="stack-sm"><h4>Лечение и дозировки</h4>${g.treatment.map((x) => html`<div class="rx">
        <div class="row between"><b>${ic("pill", "c-accent")} ${x.drug}</b><span class="badge ${x.source === "kr" ? "accent" : ""}" title="${x.source === "kr" ? "Доза из текста клинических рекомендаций" : "В тексте КР дозы нет — стандартная доза из инструкции к препарату"}">${x.source === "kr" ? "КР" : "инструкция"}</span></div>
        <div class="small">${x.dose}${x.duration ? html` · <span class="muted">${x.duration}</span>` : ""}</div>
        ${x.note ? html`<div class="tiny muted">${x.note}</div>` : ""}</div>`)}
      ${g.non_drug ? html`<div class="small fact">${ic("activity", "c-muted")}<span>${g.non_drug}</span></div>` : ""}</div>` : ""}
    ${g.red_flags?.length ? html`<div class="stack-sm"><h4>Нельзя пропустить</h4>${g.red_flags.map((x) => html`<div class="small fact red-flag">${ic("flag", "c-danger")}<span>${x}</span></div>`)}</div>` : ""}
    ${g.mistakes?.length ? html`<div class="stack-sm"><h4>Ваши отступления от КР</h4>${g.mistakes.map((x) => html`<div class="small fact">${ic("xCircle", "c-warn")}<span>${x}</span></div>`)}</div>` : ""}
    <p class="tiny muted">Учебный ИИ-разбор${g.grounded ? " на основе текста клинических рекомендаций из рубрикатора Минздрава" : ""}. Перед применением у реальных пациентов сверяйтесь с актуальной версией КР на cr.minzdrav.gov.ru.</p>
  </div>`;
}

// Кнопки на карточке пациента и в чате
document.addEventListener("click", async (e) => {
  const more = e.target.closest("[data-more]");
  if (more) {
    S.more.add(more.dataset.more);
    return rerender();
  }
  const site = e.target.closest("[data-open-site]");
  if (site) return openOnSite(site);
  const buy = e.target.closest("[data-checkout]");
  if (buy) { e.preventDefault(); return checkout(buy.dataset.checkout); }
  const t = e.target.closest("[data-start],[data-reopen],[data-reject],[data-delete-patient],[data-delete-quiz],[data-go]");
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
    if (t.dataset.deletePatient) {
      const ok = await confirmDialog("Удалить пациента?", "Пациент, его приёмы и тест будут удалены насовсем. Опыт и статистика сохранятся.", "Удалить");
      if (!ok) return;
      await api("DELETE", `/patients/${t.dataset.deletePatient}`);
      S.patients.delete(t.dataset.deletePatient);
      await loadMe();
      toast("Пациент удалён");
      go("/patients");
      return;
    }
    if (t.dataset.deleteQuiz) {
      const ok = await confirmDialog("Удалить тест?", "Тест «работа над ошибками» по этому пациенту будет удалён. Полученный опыт сохранится.", "Удалить");
      if (!ok) return;
      await api("DELETE", `/quiz/${t.dataset.deleteQuiz}`);
      quizState = null;
      await loadMe();
      toast("Тест удалён");
      go("/quizzes");
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

/** Мини-приложение → сайт в браузере, сразу с входом (одноразовый код) */
async function openOnSite(btn) {
  btnBusy(btn);
  try {
    const { url } = await api("POST", "/auth/handoff");
    if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank", "noopener");
  } catch (e) {
    toast(e.message, "error");
  }
  btnBusy(btn, false);
}

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
      // Закрываем «тихо»: иначе onClose первым вернёт false и «Да» не сработает
      el.querySelector("[data-no]").onclick = () => { closeSheet(true); resolve(false); };
      el.querySelector("[data-yes]").onclick = () => { closeSheet(true); resolve(true); };
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
      ${open && !IN_TG ? hintButton(p) : ""}
      <button class="icon-btn" id="summary-open" aria-label="Сводка пациента">${ic("card")}</button>
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
  $("#summary-open").onclick = () => sheetSummary(p);
  const hb = $("#hint-open");
  if (hb) hb.onclick = () => sheetHint(p);
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
  const since = Date.now() - 1000;
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
    try {
      const { patient } = await loadPatient(id);
      if (kind === "reply" || kind === "voice") startReveal(patient, since);
      if (kind === "test") S.revealTs = patient.test_results?.at(-1)?.ordered_at || 0;
      if (kind === "exam") S.revealTs = patient.exam_results?.at(-1)?.ts || 0;
      if (S.revealTs) setTimeout(() => { S.revealTs = 0; }, 6000);
    } catch {}
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
  for (const h of p.hints || []) items.push({ ts: h.ts, kind: "hint", h });
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
      const rv = it.kind === "patient" && S.reveal?.ts === it.ts ? S.reveal : null;
      const text = rv ? rv.parts.slice(0, rv.n).join("") : it.m.text;
      return html`${sep}<div class="msg from-${it.kind}${it.pending ? " pending" : ""}${rv ? " revealing" : ""}" data-ts="${it.ts}">${it.m.voice ? ic("mic", "c-soft") : ""}<span class="txt">${text}</span><div class="meta">${it.pending ? "отправка…" : timeText(it.ts)}</div></div>`;
    }
    const fresh = S.revealTs && it.ts === S.revealTs ? " reveal" : "";
    if (it.kind === "test") {
      return html`${sep}<div class="event test${fresh}"><div class="event-title">${ic("flask", "c-accent")}${it.t.test}</div><div class="event-body">${revealLines(it.t.result, fresh)}</div></div>`;
    }
    if (it.kind === "exam") {
      return html`${sep}<div class="event${fresh}"><div class="event-title">${ic("steth", "c-accent")}Осмотр: ${it.x.action}</div><div class="event-body">${revealLines(it.x.sensation, fresh)}</div>${it.x.reaction ? html`<div class="event-body line" style="margin-top:8px;--i:${String(it.x.sensation || "").split("\n").length}"><b>Пациент:</b> ${it.x.reaction}</div>` : ""}</div>`;
    }
    if (it.kind === "hint") {
      return html`${sep}<div class="event hint-event"><div class="event-title">${ic("bulb", "c-warn")}Подсказка ${it.h.n} из ${HINTS_TOTAL}</div><div class="event-body">${it.h.text}</div></div>`;
    }
    if (it.kind === "end") {
      return html`${sep}<div class="divider">${ic("flag")} Приём №${it.n} завершён${it.c.rating != null ? ` · ${Number(it.c.rating).toFixed(1)} из 5` : ""}</div>`;
    }
    return "";
  });
}

/** Строки результата по одной (у свежего результата — с задержкой, см. .event.reveal .line) */
function revealLines(text, fresh) {
  if (!fresh) return text;
  return String(text || "").split("\n").map((line, i) => html`<span class="line" style="--i:${i}">${line || " "}</span>`);
}

// ---------- Реплика пациента «печатается» по словам ----------
// ИИ отвечает быстро и целиком — показываем постепенно, как в живом разговоре
const REVEAL_MS = 55;
function startReveal(p, since) {
  const m = [...(p.conversation_history || [])].reverse().find((x) => x.role === "patient" && x.ts >= since);
  if (!m || !m.text) return;
  const parts = m.text.split(/(\s+)/).filter(Boolean);
  if (parts.length < 3) return;
  S.reveal = { ts: m.ts, parts, n: 0 };
  clearInterval(S.revealTimer);
  S.revealTimer = setInterval(() => {
    const r = S.reveal;
    if (!r) return clearInterval(S.revealTimer);
    r.n = Math.min(r.parts.length, r.n + 2); // слово + пробел
    const el = document.querySelector(`.msg[data-ts="${r.ts}"] .txt`);
    if (el) el.textContent = r.parts.slice(0, r.n).join("");
    const box = $("#messages");
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
    if (r.n >= r.parts.length) {
      clearInterval(S.revealTimer);
      S.reveal = null;
      document.querySelector(`.msg[data-ts="${r.ts}"]`)?.classList.remove("revealing");
    }
  }, REVEAL_MS);
}

// ---------- Подсказка наставника ----------
const HINTS_TOTAL = 3;
const HINT_PENALTY = "0,2";
function hintsLeft(p) {
  return Math.max(0, HINTS_TOTAL - (p.hints || []).length);
}
function hintButton(p) {
  const left = hintsLeft(p);
  return html`<button class="icon-btn hint-btn${left ? "" : " out"}" id="hint-open" aria-label="Подсказка: осталось ${left} из ${HINTS_TOTAL}" title="Подсказка: что сделать дальше">${ic("bulb")}<span class="hint-count">${left}</span></button>`;
}

/** Подтверждение → ИИ генерирует подсказку по текущему диалогу → «Всё понял» */
function sheetHint(p) {
  haptic();
  const left = hintsLeft(p);
  if (!left) {
    return openSheet(html`<h2 class="row-c">${ic("bulb", "c-warn")}Подсказки закончились</h2>
      <p class="muted">По этому пациенту использованы все ${HINTS_TOTAL} подсказки. Прошлые остались в ленте приёма — пролистайте диалог вверх.</p>
      <button class="btn block" data-close-sheet style="margin-top:14px">Понятно</button>`, (el) => { el.querySelector("[data-close-sheet]").onclick = () => closeSheet(); });
  }
  openSheet(html`<h2 class="row-c">${ic("bulb", "c-warn")}Нужна подсказка?</h2>
    <p class="muted">Наставник посмотрит ваш диалог и назначения и назовёт <b>один следующий шаг</b>: что спросить у пациента, какой осмотр сделать или что назначить.</p>
    <div class="hint-meter">${Array.from({ length: HINTS_TOTAL }, (_, i) => html`<i class="${i < left ? "on" : ""}"></i>`)}<span class="small">Осталось ${left} из ${HINTS_TOTAL}</span></div>
    <p class="small muted">Каждая подсказка снижает оценку за приём на ${HINT_PENALTY} балла и опыт — на 15%. Эксперт в разборе учтёт, что было сделано по подсказке.</p>
    <div class="grid-2" style="margin-top:14px"><button class="btn ghost" data-no>Сам справлюсь</button><button class="btn" data-yes>${ic("bulb")}<span>Получить</span></button></div>`, (el) => {
    el.querySelector("[data-no]").onclick = () => closeSheet();
    const yes = el.querySelector("[data-yes]");
    yes.onclick = async () => {
      btnBusy(yes);
      el.querySelector("[data-no]").disabled = true;
      goal("hint_request");
      try {
        const res = await api("POST", `/patients/${p.id}/hint`);
        haptic("success");
        el.innerHTML = html`<div class="grip"></div><div class="tiny muted row-c">${ic("bulb", "c-warn")}ПОДСКАЗКА ${res.hint.n} ИЗ ${res.total}</div>
          <p class="hint-text">${res.hint.text}</p>
          <p class="small muted">${res.left ? `Осталось подсказок: ${res.left}. ` : "Это была последняя подсказка по этому пациенту. "}Подсказка сохранена в ленте приёма.</p>
          <button class="btn lg block" data-ok>${ic("check")}<span>Всё понял</span></button>`[RAW];
        el.querySelector("[data-ok]").onclick = () => closeSheet();
        const fresh = S.patients.get(p.id);
        if (fresh) fresh.patient.hints = [...(fresh.patient.hints || []), res.hint];
        if (S.route.name === "consult") { viewConsult(); scrollChatDown(); }
      } catch (e) {
        toast(e.message, "error");
        btnBusy(yes, false);
        el.querySelector("[data-no]").disabled = false;
      }
    };
  });
}

/** Сводка пациента поверх диалога: закрыли — остались в чате */
function sheetSummary(p) {
  const tests = [...(p.test_results || [])].reverse();
  const exams = [...(p.exam_results || [])].reverse();
  openSheet(html`<div class="patient" style="margin-bottom:12px">${patAvatar(p, "lg")}<div class="grow"><h2 style="margin:0">${p.name}</h2>
      <div class="small muted">${ageText(p)}${p.is_alien ? " · инопланетянин" : p.sex === "female" ? " · женщина" : p.sex === "male" ? " · мужчина" : ""} · ${p.specialization}</div></div></div>
    ${p.chief_complaint ? html`<div class="quote" style="margin-bottom:12px">${p.chief_complaint}</div>` : ""}
    ${p.current ? html`<div style="margin-bottom:12px">${actionsSummary({ tests: p.current.tests, physicals: p.current.physicals })}</div>` : ""}
    ${tests.length ? html`<div class="section-title" style="margin:6px 0 8px">Обследования</div>${tests.map((t) => html`<details class="card flat sum-item"><summary><b>${t.test}</b></summary><div class="pre small mono">${t.result}</div></details>`)}` : ""}
    ${exams.length ? html`<div class="section-title" style="margin:10px 0 8px">Осмотр</div>${exams.map((x) => html`<details class="card flat sum-item"><summary><b>${x.action}</b></summary><div class="pre small">${x.sensation}</div></details>`)}` : ""}
    ${!tests.length && !exams.length ? html`<p class="small muted">Обследований и осмотров пока не было.</p>` : ""}
    <div class="grid-2" style="margin-top:14px"><button class="btn ghost" data-close-sheet>${ic("chat")}<span>К диалогу</span></button><a class="btn" href="#/patient/${p.id}?from=consult">Карточка</a></div>`, (el) => {
    el.querySelector("[data-close-sheet]").onclick = () => closeSheet();
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
    ${[...done].filter((t) => !S.me.config.tests.includes(t)).length ? html`<div class="tiny muted" style="margin-top:10px">Уже назначено: ${[...done].filter((t) => !S.me.config.tests.includes(t)).join(", ")}</div>` : ""}
    <div class="field" style="margin-top:14px"><label>Другое обследование</label>
      ${inlineForm("custom-test", "Например: рентген кисти, ФГДС…", 80)}
    </div>`, (el) => {
    el.querySelectorAll("[data-test]").forEach((b) => (b.onclick = () => runAction(p.id, "test", b.dataset.test)));
    bindInlineForm("custom-test", (v) => runAction(p.id, "test", v));
  });
}

const EXAMS = ["Аускультация лёгких", "Аускультация сердца", "Пальпация живота", "Перкуссия грудной клетки", "Осмотр кожи", "Измерить давление и пульс", "Неврологический осмотр", "Осмотр зева"];
function sheetExam(p) {
  const done = new Set(p.current?.physicals || []);
  const exams = S.me.config.exams || EXAMS;
  const own = [...done].filter((t) => !exams.includes(t));
  openSheet(html`<h2 class="row-c">${ic("steth", "c-accent")}Физический осмотр</h2>
    <div class="grid-2">${exams.map((t) => html`<button class="option" data-exam="${t}">${done.has(t) ? ic("check", "c-ok") : ""}${t}</button>`)}</div>
    ${own.length ? html`<div class="tiny muted row-c" style="margin-top:10px">${ic("check", "c-ok")}Уже проведено: ${own.join(", ")}</div>` : ""}
    <div class="field" style="margin-top:14px"><label>Свой вариант осмотра</label>
      ${inlineForm("custom-exam", "Например: пальпация щитовидной железы", 200)}
    </div>`, (el) => {
    el.querySelectorAll("[data-exam]").forEach((b) => (b.onclick = () => runAction(p.id, "exam", b.dataset.exam)));
    bindInlineForm("custom-exam", (v) => runAction(p.id, "exam", v));
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
        <div class="field"><label>Диагноз направления</label><input class="input" id="ref-dx" placeholder="Например: язвенная болезнь желудка, обострение" maxlength="300"></div>
        <div class="field"><label>Рекомендации до консультации (по желанию)</label><textarea id="ref-tx" placeholder="Обследования, препараты, режим…" maxlength="500"></textarea></div>
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
        body.diagnosis = $("#ref-dx").value.trim();
        body.treatment = $("#ref-tx").value.trim();
        if (!body.value) return toast("Укажите специалиста", "error");
        if (!body.diagnosis) return toast("Укажите диагноз направления", "error");
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
      <div class="msg from-patient" style="max-width:100%;margin-bottom:12px"><span class="txt" id="farewell-txt"></span></div>
      <div class="card flat" style="background:var(--surface-2)"><div class="tiny muted">ИСТИННЫЙ ДИАГНОЗ</div><b>${res.true_diagnosis}</b></div>
      <div id="eval-slot" style="margin-top:16px">${etaBox("evaluation", S.evalStart)}</div>
      ${wantsFeedbackPrompt() ? html`<div class="card flat fb-prompt" id="fb-prompt"></div>` : ""}`, () => mountFeedbackPrompt(), () => { S.evalWaiting = null; });
    typeWords($("#farewell-txt"), res.farewell || "");
    await Promise.all([loadPatient(p.id), loadMe()]);
    if (S.route.name === "consult") viewConsult();
    pollEvaluation(p.id);
  } catch (e) {
    toast(e.message, "error");
    btnBusy(btn, false);
  }
}

/** Текст по словам в отдельном элементе (прощание пациента) */
function typeWords(el, text) {
  if (!el) return;
  const parts = String(text).split(/(\s+)/).filter(Boolean);
  let n = 0;
  const t = setInterval(() => {
    n = Math.min(parts.length, n + 2);
    if (!document.body.contains(el)) return clearInterval(t);
    el.textContent = parts.slice(0, n).join("");
    if (n >= parts.length) clearInterval(t);
  }, REVEAL_MS);
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
  const c = { rating: r.rating, xp: r.xp, hints: r.hints, post_story: r.post_story, locked: r.locked, feedback: { axes: r.axes, expert_text: r.expert_text, dialog_moments: r.dialog_moments } };
  S.guideWaiting = r.patient_id;
  slot.outerHTML = html`<div class="stack" style="margin-top:16px">
    <h3 class="row-c">${ic("card", "c-accent")}Разбор приёма</h3>
    ${evaluationBlock(c)}
    ${r.level_up ? html`<div class="card flat center" style="background:var(--accent-soft)"><b class="row-c" style="justify-content:center">${ic("trophy", "c-accent")}Новый уровень: ${r.level_up.to}</b></div>` : ""}
    ${r.task_done ? html`<div class="card flat center" style="background:var(--ok-soft)"><span class="row-c" style="justify-content:center">${ic("target", "c-ok")}Задание дня выполнено! +${r.task_done.xp} XP</span></div>` : ""}
    <div id="guide-slot">${guideBlock({}, { pending: true })}</div>
    <div class="grid-2"><a class="btn ghost" href="#/patient/${r.patient_id}">Карточка</a><button class="btn" id="eval-new">${ic("plus")}<span>Новый пациент</span></button></div>
    <p class="tiny muted center">${r.locked ? "Тест по вашим ошибкам уже готовится — он откроется в премиуме." : "Тест «работа над ошибками» появится во вкладке «Тесты» через минуту."}</p>
  </div>`[RAW];
  const nb = $("#eval-new");
  if (nb) nb.onclick = () => { closeSheet(); go("/"); };
}

/** Разбор по КР готов: дорисовываем его в листе завершения приёма */
async function onGuide(id) {
  if (S.guideWaiting !== id) return;
  try {
    const { patient } = await loadPatient(id);
    const c = patient.consultations[patient.consultations.length - 1];
    const slot = $("#guide-slot");
    if (c?.guide && slot) {
      S.guideWaiting = null;
      slot.innerHTML = guideBlock(c)[RAW];
    }
  } catch {}
}
// Если WebSocket молчит — спрашиваем сами
setInterval(() => { if (S.guideWaiting && !S.wsOk) onGuide(S.guideWaiting); }, 6000);

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
    ${q.locked && q.status !== "done" ? html`<span class="badge accent">${ic("gem")}</span>` : q.status === "done" ? html`<span class="badge ${q.score >= q.total - 1 ? "ok" : "warn"}">${q.score}/${q.total}</span>` : html`<span class="badge accent">${q.answered}/${q.total}</span>`}
  </a>`;
  renderShell(html`<div class="page">
    <h1>Работа над ошибками</h1>
    <p class="muted small">После каждого приёма эксперт составляет тест по вашим пробелам. +5 XP за каждый верный ответ.</p>
    ${list.some((q) => q.locked && q.status !== "done") ? premiumCta("Тесты по вашим ошибкам — в премиуме") : ""}
    ${pending.length ? html`<div class="section-title">Ждут прохождения</div>${limited("quizzes-pending", pending, item)}` : ""}
    ${done.length ? html`<div class="section-title">Пройдены</div>${limited("quizzes-done", done, item)}` : ""}
    ${!list.length ? html`<div class="empty"><div class="tile lg">${ic("quiz")}</div>Тесты появятся после первого приёма</div>` : ""}
  </div>`);
}

let quizState = null; // { id, quiz, index, answer }
const QUIZ_TOPIC = { treatment: "Лечение", diagnostics: "Диагностика", error: "Ваша ошибка" };
async function viewQuiz(fresh) {
  const id = S.route.params.id;
  if (fresh || !quizState || quizState.id !== id) {
    renderShell(html`<div class="page"><div class="skeleton" style="height:220px"></div></div>`);
    try {
      const { quiz } = await api("GET", `/quiz/${encodeURIComponent(id)}`);
      quizState = { id, quiz, index: Math.min(quiz.answered, quiz.total - 1), answer: null };
    } catch (e) {
      renderShell(html`<div class="page"><div class="page-head"><button class="back" data-go="/quizzes" aria-label="Назад">${ic("back")}</button><h2>Тест</h2></div>
        ${e.code === "premium" ? lockedQuiz(id)
          : html`<div class="empty"><div class="tile lg">${ic("clock")}</div>${e.message}</div>`}</div>`);
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
      <div class="grow"><div class="tiny muted">РАБОТА НАД ОШИБКАМИ</div><b class="ellipsis" style="display:block">${quiz.pat_diagnosis}</b></div>
      <button class="icon-btn" data-delete-quiz="${id}" aria-label="Удалить тест">${ic("trash")}</button></div>
    <div class="steps">${quiz.questions.map((qq, k) => html`<i class="${qq.chosen != null ? (qq.chosen === qq.correct ? "ok" : "bad") : k === i ? "cur" : ""}"></i>`)}</div>
    ${quiz.kr ? html`<a class="guide-kr small" href="${quiz.kr.url}" target="_blank" rel="noopener">${ic("book")}<span>По КР Минздрава РФ «${quiz.kr.name}»</span>${ic("external")}</a>` : ""}
    <div class="card stack">
      <div class="row between"><span class="tiny muted">Вопрос ${i + 1} из ${quiz.total}</span>${q.topic ? html`<span class="badge ${q.topic === "treatment" ? "accent" : q.topic === "diagnostics" ? "ok" : "warn"}">${QUIZ_TOPIC[q.topic]}</span>` : ""}</div>
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
        <b class="row-c">${ic(ans.is_correct ? "checkCircle" : "xCircle", ans.is_correct ? "c-ok" : "c-danger")}${ans.is_correct ? "Верно!" : `Неверно. Правильно: ${q.options[ans.correct]}`}</b><div class="quiz-expl" style="margin-top:6px">${ans.explanation || ""}</div></div>
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

/** Тест без подписки: что внутри и как открыть */
function lockedQuiz(id) {
  const q = (S.me.quizzes || []).find((x) => x.pat_id === id) || {};
  return html`<div class="card stack">
      <div class="row"><div class="tile warn">${ic("quiz")}</div><div class="grow"><div class="tiny muted">РАБОТА НАД ОШИБКАМИ</div><b>${q.pat_diagnosis || "Тест по приёму"}</b></div></div>
      <p class="small muted">Эксперт составил ${q.total || 5} ${plural(q.total || 5, "вопрос", "вопроса", "вопросов")} по пробелам, которые заметил в вашем приёме${q.pat_name ? ` с пациентом ${q.pat_name}` : ""}. За каждый верный ответ — +5 XP.</p>
      <div class="locked-teaser" aria-hidden="true">
        <b>Какое исследование первым подтвердит диагноз?</b>
        <div class="quiz-opt">А. ФГДС с биопсией</div><div class="quiz-opt">Б. УЗИ органов брюшной полости</div>
      </div>
    </div>
    ${premiumCta("Откройте тест и полный разбор приёма")}`;
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
      <div class="small fact">${ic("bulb", "c-warn")}<span>${q.explanation || ""}</span></div>
    </div>`)}
    ${quiz.kr ? html`<a class="guide-kr small" href="${quiz.kr.url}" target="_blank" rel="noopener">${ic("book")}<span>Перечитать КР «${quiz.kr.name}»</span>${ic("external")}</a>` : ""}
    <a class="btn block" href="#/">На главную</a>
    <button class="btn block ghost c-danger" data-delete-quiz="${quizState.id}">${ic("trash")}<span>Удалить тест</span></button>
  </div>`);
}

// ---------------------------------------------------
// Профиль
// ---------------------------------------------------
// Черновик формы живёт отдельно от DOM: фоновые обновления экрана не сбрасывают выбор
let pf = null;

function profileDraft(p, cfg) {
  const all = new Set(Object.values(cfg.specializations).flat());
  const known = !!cfg.specializations[p.profession];
  // Свои разделы пользователя — те, что не входят в стандартные ни одной специальности
  const own = p.specializations.filter((s) => !all.has(s) && s !== p.profession);
  const options = known ? [...new Set([...cfg.specializations[p.profession], ...own])] : own;
  let specs = new Set(p.specializations.filter((s) => options.includes(s)));
  if (!specs.size && known) specs = new Set(cfg.specializations[p.profession]);
  return { name: p.name, level: p.level, difficulty: p.difficulty || "", profession: known ? p.profession : "__custom", custom: known ? "" : p.profession, options, specs, suggesting: false, suggested: known };
}

let suggestTimer = null;
async function suggestSections(profession) {
  clearTimeout(suggestTimer);
  if (!pf || profession.length < 3) return;
  const known = Object.keys(S.me.config.specializations).find((k) => k.toLowerCase() === profession.toLowerCase());
  if (known) return pickProfession(known);
  pf.suggesting = true;
  viewSettings();
  try {
    const { sections } = await api("POST", "/sections/suggest", { profession });
    if (!pf || pf.custom !== profession) return; // пока ждали, специальность поменяли
    const own = pf.options.filter((s) => pf.specs.has(s) && pf.added?.has(s));
    pf.options = [...new Set([...sections, ...own])];
    pf.specs = new Set(pf.options);
    pf.suggested = true;
    if (!sections.length) toast("Не нашли разделы для такой специальности — добавьте свои", "error");
  } catch (e) {
    toast(e.message, "error");
  } finally {
    if (pf) pf.suggesting = false;
    if (S.route.name === "settings") viewSettings();
  }
}

function pickProfession(name) {
  const cfg = S.me.config;
  pf.profession = name;
  pf.custom = "";
  pf.options = [...cfg.specializations[name]];
  pf.specs = new Set(pf.options);
  pf.suggesting = false;
  viewSettings();
}

function viewSettings(fresh) {
  const p = S.me.profile;
  const cfg = S.me.config;
  if (fresh || !pf) pf = profileDraft(p, cfg);
  const professions = Object.keys(cfg.specializations);
  const custom = pf.profession === "__custom";

  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Настройки</h2></div>

    <div class="card stack">
      <h3>Фото профиля</h3>
      <div class="row">
        ${userAvatar(p, "xl")}
        <div class="stack-sm grow">
          <label class="btn sm ghost file-btn">${ic("camera")}<span>Загрузить фото</span><input type="file" accept="image/*" id="av-file" hidden></label>
          <div class="row" style="gap:6px">
            <button class="btn sm ghost grow" id="av-tg">${ic("telegram")}<span>Из Telegram</span></button>
            ${p.avatar ? html`<button class="btn sm ghost" id="av-del" aria-label="Убрать фото">${ic("trash")}</button>` : ""}
          </div>
        </div>
      </div>
    </div>

    <div class="card stack" id="profile-form">
      <h3>Профиль врача</h3>
      <div class="field"><label>Имя</label><input class="input" id="pf-name" value="${pf.name}" maxlength="40"></div>
      <div class="field"><label>Кто вы</label>
        <div class="row wrap" style="gap:6px">${cfg.levels.map((l) => html`<button class="chip ${pf.level === l.key ? "on" : ""}" data-level="${l.key}">${l.label}</button>`)}</div></div>
      <div class="field"><label>Сложность пациентов</label>
        <div class="row wrap" style="gap:6px"><button class="chip ${!pf.difficulty ? "on" : ""}" data-diff="">По уровню</button>${cfg.difficulties.map((d) => html`<button class="chip ${pf.difficulty === d.key ? "on" : ""}" data-diff="${d.key}">${d.emoji} ${d.label}${d.key === "hard" && !p.premium ? html` ${ic("gem")}` : ""}</button>`)}</div>
        <span class="tiny muted">${(cfg.difficulties.find((d) => d.key === (pf.difficulty || cfg.levels.find((l) => l.key === pf.level)?.complexity)) || {}).hint || ""}</span></div>
      <div class="field"><label>Специальность</label>
        <div class="row wrap" style="gap:6px">${professions.map((x) => html`<button class="chip ${pf.profession === x ? "on" : ""}" data-prof="${x}">${x}</button>`)}<button class="chip ${custom ? "on" : ""}" data-prof="__custom">Другая…</button></div>
        <input class="input ${custom ? "" : "hidden"}" id="pf-prof-custom" value="${pf.custom}" placeholder="Ваша специальность, например: неонатолог" maxlength="40"></div>
      <div class="field"><label>Разделы, из которых приходят пациенты${custom ? "" : ` · ${pf.profession}`}</label>
        ${pf.suggesting ? html`<div class="small muted row-c"><span class="spin"></span>Подбираем разделы для «${pf.custom}»…</div>` : ""}
        ${!pf.suggesting && pf.options.length ? html`<div class="row wrap" style="gap:6px">${pf.options.map((s) => html`<button class="chip ${pf.specs.has(s) ? "on" : ""}" data-spec="${s}">${s}</button>`)}</div>` : ""}
        ${!pf.suggesting && !pf.options.length ? html`<div class="small muted">${custom ? (pf.custom ? "Добавьте разделы ниже — или сохраните без них: пациенты будут по всей специальности." : "Введите специальность — разделы подберутся автоматически.") : "Добавьте хотя бы один раздел."}</div>` : ""}
        ${inlineForm("pf-spec-add", "Свой раздел, например: желтуха новорождённых", 60, ic("plus"), "btn ghost")}
      </div>
      <label class="row" style="justify-content:space-between"><span>Напоминания в Telegram о стрике</span><input type="checkbox" id="pf-notify" ${p.notifications === false ? "" : "checked"} style="width:22px;height:22px;accent-color:var(--accent)"></label>
      <button class="btn block" id="pf-save">Сохранить</button>
    </div>

  </div>`);

  $("#pf-name").oninput = (e) => { pf.name = e.target.value; };
  root.querySelectorAll("[data-level]").forEach((b) => (b.onclick = () => { pf.level = b.dataset.level; viewSettings(); }));
  root.querySelectorAll("[data-diff]").forEach((b) => (b.onclick = () => {
    if (b.dataset.diff === "hard" && !p.premium) { toast("«Очень сложные» случаи — в премиуме"); return go("/plans"); }
    pf.difficulty = b.dataset.diff;
    viewSettings();
  }));
  root.querySelectorAll("[data-prof]").forEach((b) => (b.onclick = () => {
    if (b.dataset.prof !== "__custom") return pickProfession(b.dataset.prof);
    if (custom) return;
    pf.profession = "__custom";
    pf.options = [];
    pf.specs = new Set();
    viewSettings();
    const inp = $("#pf-prof-custom");
    inp.focus();
    if (pf.custom) suggestSections(pf.custom);
  }));
  const customInput = $("#pf-prof-custom");
  customInput.oninput = () => {
    pf.custom = customInput.value.trim();
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => suggestSections(pf.custom), 900);
  };
  customInput.onchange = () => { if (pf.custom && !pf.suggesting) suggestSections(pf.custom); };
  // Своя специальность, для которой ещё не подбирали разделы (сохранена до этого обновления)
  if (custom && pf.custom && !pf.suggested && !pf.options.length && !pf.suggesting) {
    pf.suggested = true;
    suggestSections(pf.custom);
  }
  root.querySelectorAll("[data-spec]").forEach((b) => (b.onclick = () => {
    const s = b.dataset.spec;
    if (pf.specs.has(s)) pf.specs.delete(s); else pf.specs.add(s);
    viewSettings();
  }));
  const addSpec = (v, input) => {
    v = pf.options.find((o) => o.toLowerCase() === v.toLowerCase()) || v;
    pf.added = pf.added || new Set();
    pf.added.add(v);
    if (!pf.options.includes(v)) pf.options = [...pf.options, v];
    pf.specs.add(v);
    if (input) input.value = "";
    viewSettings();
  };
  bindInlineForm("pf-spec-add", addSpec);
  $("#pf-save").onclick = async () => {
    // Раздел, который ввели, но не нажали «+», тоже сохраняем
    const pending = $("#pf-spec-add").value.trim();
    if (pending) addSpec(pending, $("#pf-spec-add"));
    const profession = custom ? pf.custom : pf.profession;
    if (!profession) return toast("Укажите специальность", "error");
    const specs = pf.options.filter((s) => pf.specs.has(s));
    if (!specs.length) {
      if (!custom) return toast("Выберите хотя бы один раздел", "error");
      specs.push(profession); // своя специальность без разделов — пациенты по ней целиком
    }
    const btn = $("#pf-save");
    btnBusy(btn);
    try {
      const { profile } = await api("PATCH", "/profile", {
        name: pf.name, level: pf.level, difficulty: pf.difficulty, profession, specializations: specs, notifications: $("#pf-notify").checked,
      });
      S.me.profile = profile;
      pf = null;
      haptic("success");
      toast("Сохранено", "ok");
      viewSettings(true);
    } catch (e) {
      toast(e.message, "error");
      btnBusy(btn, false);
    }
  };
  bindAvatar();
}

/** Фото профиля: своё (сжимаем в браузере до 320 px), из Telegram или без фото */
function bindAvatar() {
  const file = $("#av-file");
  if (file) file.onchange = async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    const label = file.closest("label");
    btnBusy(label);
    try {
      const blob = await squareImage(f, 320);
      const r = await fetch("/api/avatar", { method: "POST", headers: { Authorization: `Bearer ${S.token}`, "Content-Type": blob.type, "X-Client": IN_TG ? "miniapp" : "web" }, body: blob });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Не удалось загрузить фото");
      S.me.profile = data.profile;
      haptic("success");
      toast("Фото обновлено", "ok");
      viewSettings();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(label, false);
    }
  };
  const fromTg = $("#av-tg");
  if (fromTg) fromTg.onclick = async () => {
    btnBusy(fromTg);
    try {
      const { profile } = await api("POST", "/avatar/telegram");
      S.me.profile = profile;
      toast("Фото из Telegram", "ok");
      viewSettings();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(fromTg, false);
    }
  };
  const del = $("#av-del");
  if (del) del.onclick = async () => {
    btnBusy(del);
    try {
      const { profile } = await api("DELETE", "/avatar");
      S.me.profile = profile;
      viewSettings();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(del, false);
    }
  };
}

/** Квадратная обрезка по центру и JPEG — аватар весит 20–40 КБ */
async function squareImage(file, size) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Не удалось открыть картинку")); i.src = url; });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.86));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Профиль: меню ----------
function viewProfile() {
  const p = S.me.profile;
  const sub = p.has_sub ? (p.sub_until === -1 ? "навсегда" : `до ${dateText(p.sub_until)}`) : null;
  const item = (attrs, tile, icon, title, sub2, extra = "") => html`<${attrs.tag || "a"} class="menu-item${attrs.cls ? " " + attrs.cls : ""}" ${raw(attrs.a || "")}>
    <div class="tile ${tile}">${ic(icon)}</div><div class="grow"><b>${title}</b>${sub2 ? html`<div class="small muted ellipsis">${sub2}</div>` : ""}</div>${extra || ic("chevron", "c-muted")}</${attrs.tag || "a"}>`;
  renderShell(html`<div class="page">
    <div class="hello">${userAvatar(p, "lg")}<div class="grow"><h1 class="ellipsis">${p.name}</h1><div class="small muted">${p.username ? "@" + p.username : /^\d+$/.test(p.uid) ? "Telegram ID " + p.uid : "Аккаунт сайта"}</div>
      <div class="small muted">${p.level_label} · ${p.profession} · уровень ${p.level_info.level}</div></div></div>
    <div class="menu card">
      ${item({ a: 'href="#/plans"' }, "accent", "gem", sub ? "Подписка" : "Премиум", sub ? `Активна ${sub}${p.autopay?.status === "active" ? ` · автопродление ${dateText(p.autopay.next_at)}` : ""}` : p.trial_available ? "7 дней за 1 ₽ · безлимит, лечение по КР, тесты" : "Безлимит, лечение и дозы по КР, тесты")}
      ${item({ a: 'href="#/profile/stats"' }, "ok", "chart", "Статистика", `${p.stats.consultations_total || 0} ${plural(p.stats.consultations_total || 0, "приём", "приёма", "приёмов")} · средняя оценка ${p.stats.ratings_count ? p.stats.avg_rating.toFixed(1) : "—"}`)}
      ${item({ a: 'href="#/profile/settings"' }, "", "settings", "Настройки", "Фото, специальность, сложность, уведомления")}
      ${item({ a: 'href="#/profile/accounts"' }, "", "key", "Способы входа", /^\d+$/.test(p.uid) ? "Telegram, Яндекс, Google" : "Привяжите Telegram — приёмы в чате и напоминания")}
      ${item({ tag: "button", a: 'id="feedback-open" type="button"' }, "warn", "star", "Оставить отзыв", "Что нравится, что мешает, чего не хватает")}
      ${item({ a: `href="https://t.me/${S.me.bot_username || "helpmedoctor_aibot"}" target="_blank" rel="noopener"` }, "accent", "telegram", "Бот в Telegram", "Приёмы в чате и напоминания", ic("external", "c-muted"))}
      ${item({ a: 'href="https://t.me/oleg_ezhkov" target="_blank" rel="noopener"' }, "", "telegram", "Поддержка", "@oleg_ezhkov в Telegram — вопросы, оплата, сотрудничество", ic("external", "c-muted"))}
      ${item({ a: `href="${DOCS.offer}" target="_blank" rel="noopener"` }, "", "book", "Документы", "Оферта и политика конфиденциальности", ic("external", "c-muted"))}
      ${!IN_TG ? item({ tag: "button", a: 'id="logout" type="button"', cls: "danger" }, "", "logout", "Выйти", "") : ""}
    </div>
  </div>`);
  $("#feedback-open").onclick = () => sheetFeedback();
  const lo = $("#logout");
  if (lo) lo.onclick = async () => { if (await confirmDialog("Выйти?", "На этом устройстве нужно будет войти снова.", "Выйти")) logout(); };
}

// ---------- Способы входа ----------
let accountsData = null;
let linkPoll = null;
let linkBusyShown = false;
async function viewAccounts(fresh) {
  const head = html`<div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Способы входа</h2></div>`;
  if (fresh || !accountsData) {
    renderShell(html`<div class="page">${head}<div class="skeleton" style="height:180px"></div></div>`);
    try {
      accountsData = await api("GET", "/accounts");
    } catch (e) {
      toast(e.message, "error");
      return go("/profile", true);
    }
    if (S.route.name !== "accounts") return;
  }
  const a = accountsData;
  const p = S.me.profile;
  const ids = Object.fromEntries(a.identities.map((i) => [i.provider, i]));
  const total = (a.telegram ? 1 : 0) + a.identities.length;
  const row = (key, linked, sub, action) => html`<div class="menu-item acc-row"><div class="tile plain">${brand(key)}</div>
    <div class="grow"><b>${PROVIDER_LABEL[key]}</b><div class="small muted ellipsis">${sub}</div></div>${action}</div>`;
  const tgRow = row("telegram", a.telegram, a.telegram ? (p.username ? "@" + p.username : "Привязан") : "Приёмы в чате с ботом, напоминания и стрики",
    a.telegram ? html`<span class="badge ok">привязан</span>` : html`<button class="btn sm" id="link-tg" type="button">Привязать</button>`);
  const provRows = a.providers.map((key) => {
    const i = ids[key];
    if (i) return row(key, true, i.email || i.name || "Привязан", total > 1 ? html`<button class="btn sm ghost" data-unlink="${key}" type="button">Отвязать</button>` : html`<span class="badge ok">привязан</span>`);
    if (IN_TG) return row(key, false, "Привязывается в веб-версии", "");
    return row(key, false, "Входить без Telegram", html`<button class="btn sm outline" data-link="${key}" type="button">Привязать</button>`);
  });
  renderShell(html`<div class="page">${head}
    <div class="menu card">${tgRow}${provRows}</div>
    <p class="small muted">Все способы ведут в один профиль: пациенты, опыт и подписка общие.${!a.telegram ? " При привязке Telegram прогресс сайта объединится с прогрессом бота — ничего не потеряется." : ""}</p>
    ${IN_TG && a.providers.some((k) => !ids[k]) ? html`<button class="btn ghost block" id="acc-site" type="button">${ic("external")}Открыть веб-версию</button>` : ""}
    <div id="link-tg-hint"></div>
  </div>`);
  root.querySelectorAll("[data-link]").forEach((b) => (b.onclick = () => oauthStart(b.dataset.link, "link", b)));
  root.querySelectorAll("[data-unlink]").forEach((b) => (b.onclick = async () => {
    const key = b.dataset.unlink;
    if (!(await confirmDialog(`Отвязать ${PROVIDER_LABEL[key]}?`, "Входить через этот аккаунт больше не получится. Прогресс останется в профиле.", "Отвязать"))) return;
    btnBusy(b);
    try {
      accountsData = await api("DELETE", `/accounts/${key}`);
      toast(`${PROVIDER_LABEL[key]} отвязан`);
      viewAccounts();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(b, false);
    }
  }));
  const site = $("#acc-site");
  if (site) site.onclick = () => openOnSite(site);
  const lt = $("#link-tg");
  if (lt) lt.onclick = () => linkTelegram(lt);
}

/** Привязка Telegram к аккаунту сайта: бот спросит подтверждение, сайт дождётся и объединит прогресс */
async function linkTelegram(btn) {
  btnBusy(btn);
  let r;
  try {
    r = await api("POST", "/auth/link-telegram");
  } catch (e) {
    toast(e.message, "error");
    return btnBusy(btn, false);
  }
  btnBusy(btn, false);
  btn.outerHTML = html`<a class="btn sm" href="${r.tg || r.url}" id="link-tg-open">${ic("clock")}Ждём…</a>`[RAW];
  const hint = $("#link-tg-hint");
  if (hint) hint.innerHTML = html`<div class="card small">В Telegram нажмите «Запустить», затем «✅ Привязать» — эта страница обновится сама.<br>Telegram не открылся? <a href="${r.url}" target="_blank" rel="noopener">Открыть бота в браузере</a></div>`[RAW];
  location.href = r.tg || r.url;
  clearInterval(linkPoll);
  const started = Date.now();
  linkPoll = setInterval(async () => {
    if (Date.now() - started > 9 * 60 * 1000 || S.route.name !== "accounts") return clearInterval(linkPoll);
    try {
      const x = await api("GET", `/auth/link-telegram/poll?code=${encodeURIComponent(r.code)}`);
      if (x.status === "expired") {
        clearInterval(linkPoll);
        toast("Ссылка устарела — нажмите «Привязать» ещё раз", "error");
        return viewAccounts(true);
      }
      if (x.status !== "ok") return;
      clearInterval(linkPoll);
      goal("link_telegram");
      S.token = x.token;
      store(TOKEN_KEY, x.token);
      try { S.ws?.close(); } catch {}
      S.patients.clear();
      await loadMe();
      haptic("success");
      toast("Telegram привязан, прогресс объединён", "ok");
      viewAccounts(true);
    } catch (e) {
      // busy — идёт генерация пациента или разбор: склейка повторится при следующем опросе
      if (e.code === "busy" && !linkBusyShown) { linkBusyShown = true; toast(e.message); }
      else if (e.code === "two_autopays") { clearInterval(linkPoll); toast(e.message, "error"); viewAccounts(true); }
    }
  }, 2000);
}

function viewStats() {
  const p = S.me.profile;
  const lvl = p.level_info;
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Статистика</h2></div>
    <div class="card stack">
      <div class="row between"><b>Уровень ${lvl.level}</b><span class="small muted">${p.xp || 0}${lvl.to ? ` / ${lvl.to}` : ""} XP</span></div>
      <div class="xp-bar"><i style="width:${Math.round((lvl.progress || 0) * 100)}%"></i></div>
      <div class="stats">
        <div class="stat"><b>${p.stats.consultations_total || 0}</b><span>${plural(p.stats.consultations_total || 0, "приём", "приёма", "приёмов")}</span></div>
        <div class="stat"><b>${p.stats.ratings_count ? p.stats.avg_rating.toFixed(1) : "—"}</b><span>средняя оценка</span></div>
        <div class="stat"><b class="row-c">${ic("flame", "c-flame")}${p.streak || 0}</b><span>${plural(p.streak || 0, "день", "дня", "дней")} подряд</span></div>
        <div class="stat"><b>${p.stats.patients_total || 0}</b><span>${plural(p.stats.patients_total || 0, "пациент", "пациента", "пациентов")}</span></div>
        <div class="stat"><b>${p.stats.quizzes_done || 0}</b><span>${plural(p.stats.quizzes_done || 0, "тест", "теста", "тестов")}</span></div>
        <div class="stat"><b>${p.stats.correct_diagnoses_streak || 0}</b><span>верных подряд</span></div>
      </div>
    </div>
    ${p.strengths?.length ? html`<div class="card stack-sm"><div class="tiny muted">СИЛЬНЫЕ СТОРОНЫ</div><div class="row wrap" style="gap:6px">${p.strengths.slice(0, 8).map((s) => html`<span class="badge ok">${s}</span>`)}</div></div>` : ""}
    ${p.weaknesses?.length ? html`<div class="card stack-sm"><div class="tiny muted">ЧТО ПОДТЯНУТЬ</div><div class="row wrap" style="gap:6px">${p.weaknesses.slice(0, 8).map((s) => html`<span class="badge warn">${s}</span>`)}</div></div>` : ""}
    ${p.recommendations?.length ? html`<div class="card stack-sm"><div class="tiny muted">СОВЕТЫ ЭКСПЕРТА</div>${p.recommendations.slice(0, 3).map((r) => html`<div class="small fact">${ic("bulb", "c-warn")}<span>${r}</span></div>`)}</div>` : ""}
    ${p.locked_insights ? premiumCta(`Слабые места и советы эксперта: ${p.locked_insights}`) : ""}
    ${!p.stats.ratings_count ? html`<div class="empty"><div class="tile lg">${ic("chart")}</div>Статистика появится после первого разобранного приёма</div>` : ""}
  </div>`);
}

// ---------- Отзыв ----------
/** Форма отзыва: звёзды + текст. Рисуется в любом контейнере (лист или окно в листе завершения приёма). */
function feedbackForm(box, { title, hint, onDone, onSkip }) {
  let rating = 0;
  const draw = () => {
    const text = box.querySelector("#fb-text")?.value || "";
    box.innerHTML = html`${title}
      <p class="small muted" style="margin-bottom:12px">${hint}</p>
      <div class="rate-row">${[1, 2, 3, 4, 5].map((n) => html`<button class="rate ${n <= rating ? "on" : ""}" data-rate="${n}" aria-label="${n} из 5">${ic("star", n <= rating ? "on" : "")}</button>`)}</div>
      <div class="field" style="margin-top:14px"><textarea id="fb-text" placeholder="Что понравилось, что мешает, чего не хватает?" maxlength="1500"></textarea></div>
      <div class="${onSkip ? "grid-2" : ""}" style="margin-top:14px">${onSkip ? html`<button class="btn ghost" id="fb-skip">Не сейчас</button>` : ""}<button class="btn ${onSkip ? "" : "lg block"}" id="fb-send">Отправить</button></div>`[RAW];
    box.querySelector("#fb-text").value = text;
    box.querySelectorAll("[data-rate]").forEach((b) => (b.onclick = () => { rating = Number(b.dataset.rate); haptic(); draw(); }));
    const skip = box.querySelector("#fb-skip");
    if (skip) skip.onclick = onSkip;
    box.querySelector("#fb-send").onclick = async (e) => {
      const body = { rating, text: box.querySelector("#fb-text").value.trim() };
      if (!body.rating && !body.text) return toast("Поставьте оценку или напишите пару слов", "error");
      btnBusy(e.currentTarget);
      try {
        await api("POST", "/feedback", body);
        S.me.profile.feedback = [...(S.me.profile.feedback || []), { ts: Date.now(), rating: body.rating }];
        haptic("success");
        toast("Спасибо за отзыв!", "ok");
        onDone();
      } catch (err) {
        toast(err.message, "error");
        btnBusy(box.querySelector("#fb-send"), false);
      }
    };
  };
  draw();
}

function sheetFeedback() {
  openSheet("", (el) => {
    const box = document.createElement("div");
    el.appendChild(box);
    feedbackForm(box, {
      title: html`<h2 class="row-c">${ic("star", "c-warn")}Отзыв о тренажёре</h2>`,
      hint: "Оцените и напишите пару слов — мы читаем каждый отзыв.",
      onDone: () => closeSheet(),
    });
  });
}

// Пока эксперт пишет разбор — просим отзыв у тех, кто его ещё не оставлял. «Не сейчас» — спросим через 3 приёма.
const FB_SNOOZE_KEY = "hmd_fb_snooze";
function wantsFeedbackPrompt() {
  if ((S.me?.profile?.feedback || []).length) return false;
  const left = Number(store(FB_SNOOZE_KEY) || 0);
  if (left > 0) { store(FB_SNOOZE_KEY, String(left - 1)); return false; }
  return true;
}
function mountFeedbackPrompt() {
  const box = $("#fb-prompt");
  if (!box) return;
  feedbackForm(box, {
    title: html`<b class="row-c">${ic("star", "c-warn")}Пока эксперт пишет разбор — как вам тренажёр?</b>`,
    hint: "Оценка и пара слов очень помогут сделать его лучше.",
    onDone: () => { box.innerHTML = html`<div class="small row-c" style="color:var(--ok)">${ic("checkCircle")}Спасибо за отзыв!</div>`[RAW]; },
    onSkip: () => { store(FB_SNOOZE_KEY, "3"); box.remove(); },
  });
}

// ---------------------------------------------------
// Тарифы
// ---------------------------------------------------
const rub = (v) => Number(v).toLocaleString("ru", { maximumFractionDigits: 2 });
const PREMIUM_PERKS = [
  ["users", "Безлимит пациентов"],
  ["pill", "Лечение по клиническим рекомендациям Минздрава РФ: препараты, дозы, схемы"],
  ["flask", "Лучшая диагностика по КР для каждого случая"],
  ["card", "Полный разбор: цитаты из диалога и «что было дальше»"],
  ["quiz", "Тест по лечению и диагностике после каждого приёма"],
  ["flame", "«Очень сложные» случаи"],
  ["chart", "Слабые места и советы эксперта"],
];

// Документы: публичная оферта и политика обработки персональных данных (статичные страницы сайта)
const DOCS = { offer: "/oferta/", privacy: "/privacy/" };
const docLink = (key, text) => html`<a href="${DOCS[key]}" target="_blank" rel="noopener">${text}</a>`;

function viewPlans(fresh) {
  const p = S.me.profile;
  const o = S.me.offer || { plans: S.me.plans, packs: {}, trial: null };
  const order = ["month", "quarter", "year", "week"].filter((k) => o.plans[k]);
  const earlyDate = o.early_until ? new Date(o.early_until - 1).toLocaleDateString("ru", { day: "numeric", month: "long" }) : "";
  const ap = p.autopay;
  if (fresh && S.route.q.paid) toast("Спасибо! Доступ включится в течение минуты.");
  if (fresh) api("POST", "/event", { type: "plans_open" }).catch(() => {});
  const planCard = (k) => {
    const x = o.plans[k];
    const monthly = x.days >= 60 ? Math.round(Number(x.price) / (x.days / 30)) : null;
    const disabled = x.recurring && ap?.status === "active";
    return html`<div class="plan ${x.best ? "best" : ""}">
      <b class="plan-name">${x.label}</b>
      <span class="tiny muted">${x.recurring ? "автопродление" : "разовый платёж"}</span>
      <div class="price">${rub(x.price)} ₽</div>
      <div class="tiny muted plan-sub">${o.early && x.regular !== x.price ? html`<s>${rub(x.regular)} ₽</s> · ` : ""}${monthly ? `≈ ${monthly} ₽/мес` : x.recurring ? "каждые 30 дней" : `${x.days} дней`}</div>
      <button class="btn block sm" data-plan="${k}" ${disabled ? "disabled" : ""}>${disabled ? "Оформлено" : "Оплатить"}</button></div>`;
  };
  renderShell(html`<div class="page">
    ${!IN_TG ? html`<div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button></div>` : ""}

    ${p.has_sub ? html`<div class="card stack-sm">
      <b class="row-c">${ic("gem", "c-accent")}Премиум активен ${p.sub_until === -1 ? "навсегда" : `до ${dateText(p.sub_until)}`}</b>
      ${ap?.status === "active" ? html`<span class="small muted">Автопродление: ${rub(ap.price)} ₽ ${dateText(ap.next_at)}${ap.trial ? " — после пробного периода" : ""}.</span>
        <button class="btn sm ghost" id="autopay-off">Отключить автопродление</button>` : ""}
      ${ap && ap.status !== "active" ? html`<span class="small muted">Автопродление отключено — после окончания срока останется бесплатный тариф.</span>` : ""}
    </div>` : ""}

    ${p.trial_available && o.trial ? html`<div class="card trial-card stack">
      <h2>Премиум 7 дней за ${rub(o.trial.price)} ₽</h2>
      <div class="perks">${PREMIUM_PERKS.map(([i, t]) => html`<div class="fact">${ic(i, "c-accent")}<span>${t}</span></div>`)}</div>
      <button class="btn lg block" data-plan="trial">Попробовать за ${rub(o.trial.price)} ₽</button>
      <p class="tiny muted">Через 7 дней — ${rub(o.trial.then_price)} ₽ в месяц автоматически${o.early ? " (цена ранних пользователей сохранится, пока подписка активна)" : ""}. Отключить можно в любой момент здесь же, до конца пробного периода — бесплатно.</p>
    </div>` : !p.has_sub ? html`<div class="card stack-sm">
      <b>Бесплатно — 1 пациент в день</b><span class="small muted">с оценкой и выводом эксперта. В премиуме:</span>
      <div class="perks">${PREMIUM_PERKS.map(([i, t]) => html`<div class="fact">${ic(i, "c-accent")}<span>${t}</span></div>`)}</div></div>` : ""}

    ${o.early ? html`<div class="early-note">${ic("zap")}<span>Цены для ранних пользователей — до ${earlyDate}</span></div>` : ""}
    <div class="plans">${order.map(planCard)}</div>

    ${consentBox()}

    ${Object.keys(o.packs || {}).length ? html`<div class="section-title">Разовые покупки</div>
      <div class="card packs">${Object.entries(o.packs).map(([k, x]) => html`<div class="pack-row">
        <div class="tile ${k === "freeze" ? "accent" : "warn"}">${ic(k === "freeze" ? "flame" : "users")}</div>
        <div class="grow"><b>${x.label}</b><div class="small muted">${k === "freeze" ? `Пропуск дня не сожжёт стрик${p.streak_freezes ? ` · у вас: ${p.streak_freezes}` : ""}` : `Сверх бесплатного лимита, не сгорают${p.patient_credits ? ` · у вас: ${p.patient_credits}` : ""}`}</div></div>
        <button class="btn sm" data-plan="${k}">${rub(x.price)} ₽</button></div>`)}</div>` : ""}

    <p class="tiny muted center">Карта или СБП. Доступ включается сразу — и в боте, и на сайте.<br>${docLink("offer", "Оферта")} · ${docLink("privacy", "Политика конфиденциальности")}</p>
  </div>`);
  bindConsent(root);
  root.querySelectorAll("[data-plan]").forEach((b) => (b.onclick = () => payFor(b.dataset.plan, b, root)));
  // Переход из другого раздела с конкретной покупкой (?buy=freeze) — сразу открываем её, а не всю страницу тарифов
  if (fresh && S.route.q.buy) checkout(S.route.q.buy);
  const off = $("#autopay-off");
  if (off) off.onclick = async () => {
    const ok = await confirmDialog("Отключить автопродление?", `Премиум останется до ${dateText(p.sub_until)}, дальше — бесплатный тариф.`, "Отключить");
    if (!ok) return;
    btnBusy(off);
    try {
      const { profile } = await api("POST", "/autopay/cancel");
      S.me.profile = profile;
      toast("Автопродление отключено");
      viewPlans();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(off, false);
    }
  };
}

// Согласие с офертой и на автосписания: отмечено по умолчанию, снять галочку можно
const consentOn = () => store("hmd_consent") !== "0";
function consentBox() {
  return html`<label class="consent"><input type="checkbox" data-consent ${consentOn() ? "checked" : ""}>
      <span>Принимаю ${docLink("offer", "условия оферты")} и ${docLink("privacy", "политику обработки данных")}, согласен на автоматические списания по подписке — их можно отключить в любой момент.</span></label>`;
}
function bindConsent(scope) {
  scope.querySelectorAll("[data-consent]").forEach((c) => (c.onchange = () => {
    store("hmd_consent", c.checked ? null : "0");
    c.closest(".consent").classList.remove("need");
  }));
}

/** Создаёт платёж и открывает страницу банка */
async function payFor(key, b, scope) {
  const consent = scope.querySelector("[data-consent]");
  if (consent && !consent.checked) {
    const box = consent.closest(".consent");
    box.classList.add("need");
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    return toast("Отметьте согласие с условиями оплаты", "error");
  }
  btnBusy(b);
  try {
    const { link } = await api("POST", "/pay", { plan: key, consent: true });
    goal("pay_click", { plan: key });
    if (IN_TG && tg.openLink) tg.openLink(link);
    else location.href = link;
  } catch (e) {
    toast(e.message, "error");
  }
  btnBusy(b, false);
}

/** Покупка на месте: лист с одним товаром (пробный период или разовая покупка) без перехода к тарифам */
function checkout(key) {
  const p = S.me.profile;
  const o = S.me.offer || {};
  const pack = o.packs?.[key];
  const trial = key === "trial" && p.trial_available ? o.trial : null;
  if (!pack && !trial) return key === "trial" || key === "premium" ? go("/plans") : null;
  haptic();
  const body = trial
    ? html`<h2>Премиум 7 дней за ${rub(trial.price)} ₽</h2>
      <div class="perks">${PREMIUM_PERKS.map(([i, t]) => html`<div class="fact">${ic(i, "c-accent")}<span>${t}</span></div>`)}</div>
      <p class="tiny muted">Через 7 дней — ${rub(trial.then_price)} ₽ в месяц автоматически. Отключить можно в любой момент в профиле, до конца пробного периода — бесплатно.</p>`
    : html`<div class="row-c"><div class="tile ${key === "freeze" ? "accent" : "warn"}">${ic(key === "freeze" ? "flame" : "users")}</div>
        <div class="grow"><h2>${pack.label}</h2><div class="small muted">${key === "freeze" ? `Пропуск дня не сожжёт стрик${p.streak_freezes ? ` · у вас: ${p.streak_freezes}` : ""}` : `Сверх бесплатного лимита, не сгорают${p.patient_credits ? ` · у вас: ${p.patient_credits}` : ""}`}</div></div></div>`;
  const price = trial ? trial.price : pack.price;
  openSheet(html`<div class="stack checkout">${body}
    <button class="btn lg block" data-buy="${key}">Оплатить ${rub(price)} ₽</button>
    ${consentBox()}
    <a class="small center" href="#/plans" data-close>Все тарифы</a></div>`, (sheet) => {
    bindConsent(sheet);
    sheet.querySelector("[data-buy]").onclick = (e) => payFor(key, e.currentTarget, sheet);
    sheet.querySelector("[data-close]").onclick = () => closeSheet(true);
  });
}

/** Карточка «откройте в премиуме» — после разбора, в тесте, при лимите */
function premiumCta(text, compact = false) {
  const p = S.me.profile;
  const label = p.trial_available ? `Премиум 7 дней за ${rub(S.me.offer?.trial?.price || 1)} ₽` : "Открыть премиум";
  return html`<a class="card premium-cta ${compact ? "compact" : ""}" href="#/plans" ${p.trial_available ? html`data-checkout="trial"` : ""}>
    <div class="tile accent">${ic("gem")}</div>
    <div class="grow"><b>${text}</b><div class="small">${label}</div></div>${ic("chevron")}</a>`;
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
