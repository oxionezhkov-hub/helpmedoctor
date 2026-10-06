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
  guidePending: new Set(),
  guideStart: new Map(),
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
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.8 0-3.2-2-5.7-3.6-7.2-.3 1.8-1.3 3-2.4 3.5.4-3.4-1-6.6-3.5-8.5.1 3-1.6 5.1-3.2 7C4.9 11.4 5 13.4 5 15.2 5 19.3 8 22 12 22Z"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9Z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  xCircle: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3v3a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5"/>',
  handshake: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>',
  share: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
  dots: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
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
  gift: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8S10.5 3 8 3.5 7 8 12 8Zm0 0s1.5-5 4-4.5S17 8 12 8Z"/>',
  pill: '<path d="m10.5 20.5 10-10a4.9 4.9 0 0 0-7-7l-10 10a4.9 4.9 0 0 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2Z"/><path d="M4 21a2 2 0 0 1 2-2h14"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7Z"/>',
  swords: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6M16 16l4 4M19 21l2-2"/><path d="M14.5 6.5 18 3h3v3l-3.5 3.5"/><path d="m5 14 4 4M7 17l-3 3M3 19l2 2"/>',
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
  pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
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
  vk: '<svg class="i brand" viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#0077FF"/><path fill="#fff" d="M19.376 17.123h-1.744c-.66 0-.864-.525-2.05-1.727-1.033-1-1.49-1.135-1.744-1.135-.356 0-.458.102-.458.593v1.575c0 .424-.135.678-1.253.678-1.846 0-3.896-1.118-5.335-3.202C4.624 10.857 4.03 8.57 4.03 8.096c0-.254.102-.491.593-.491h1.744c.44 0 .61.203.78.677.863 2.49 2.303 4.675 2.896 4.675.22 0 .322-.102.322-.66V9.721c-.068-1.186-.695-1.287-.695-1.71 0-.204.17-.407.44-.407h2.744c.373 0 .508.203.508.643v3.473c0 .372.17.508.271.508.22 0 .407-.136.813-.542 1.254-1.406 2.151-3.574 2.151-3.574.119-.254.322-.491.763-.491h1.744c.525 0 .644.27.525.643-.22 1.017-2.354 4.031-2.354 4.031-.186.305-.254.44 0 .78.186.254.796.779 1.203 1.253.745.847 1.32 1.558 1.473 2.05.17.49-.085.744-.576.744z"/></svg>',
  instagram: '<svg class="i brand" viewBox="0 0 24 24" aria-hidden="true"><defs><radialGradient id="ig-grad" cx="30%" cy="107%" r="150%"><stop offset="0" stop-color="#FDF497"/><stop offset=".05" stop-color="#FDF497"/><stop offset=".45" stop-color="#FD5949"/><stop offset=".6" stop-color="#D6249F"/><stop offset=".9" stop-color="#285AEB"/></radialGradient></defs><rect width="24" height="24" rx="6" fill="url(#ig-grad)"/><rect x="5.5" y="5.5" width="13" height="13" rx="4" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="12" cy="12" r="3.1" fill="none" stroke="#fff" stroke-width="1.8"/><circle cx="15.9" cy="8.1" r="1" fill="#fff"/></svg>',
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
  return html`<div class="pav face ${size}" style="--h:${hashHue(p.name)}"><img src="${API_BASE}/api/face?${q}" alt="" loading="lazy"></div>`;
}
/** Аватар врача: фото (из Telegram или своё) или первая буква имени */
function userAvatar(p, cls = "") {
  if (p.avatar?.id) return html`<img class="avatar ${cls}" src="${API_BASE}/api/avatar/${p.avatar.id}" alt="">`;
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
const ETA_DEFAULT = { patient: 16000, reply: 5000, test: 7000, exam: 6000, finish: 5000, evaluation: 22000, voice: 7000, quiz: 40000, guide: 45000 };
const ETA_STEPS = {
  patient: ["Выбираем клинический случай", "Пишем анамнез", "Продумываем характер", "Готовим карточку"],
  evaluation: ["Эксперт изучает диалог", "Сверяет диагноз", "Оценивает лечение", "Пишет разбор"],
  test: ["Берём материал", "Лаборатория работает", "Оформляем протокол"],
  exam: ["Осматриваем пациента", "Записываем находки"],
  voice: ["Загружаем запись", "Распознаём речь", "Пациент отвечает"],
  reply: ["Пациент думает"],
  finish: ["Пациент прощается"],
  quiz: ["Эксперт составляет тест"],
  guide: ["Находим клинические рекомендации", "Сверяем с вашим приёмом", "Подбираем препараты и дозы", "Оформляем разбор"],
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
  return html`<div class="eta ${extraCls}" id="eta-${kind}-${start}" data-eta="${kind}" data-eta-start="${start}" data-est="${est}">
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
      const st = etaState(el.dataset.eta, Number(el.dataset.etaStart), Number(el.dataset.est), now);
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
/** Экран с тем же маршрутом обновляем точечно (без мигания и сброса прокрутки), новый — рисуем заново и с начала */
function patchRoot(markup) {
  const key = `${S.route.name}:${S.route.params.id || ""}`;
  const same = root.dataset.view === key && !root.querySelector(".boot, .login");
  root.dataset.view = key;
  if (!same) {
    root.innerHTML = markup;
    window.scrollTo(0, 0);
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
const shortDate = (ts) => new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "short" }).replace(".", "");
const dateText = (ts) => new Date(ts).toLocaleDateString("ru", { day: "numeric", month: "long", ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
const initials = (name) => String(name || "Д").trim().slice(0, 1).toUpperCase();

// ---------------------------------------------------
// API
// ---------------------------------------------------
class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

// ---------- Запасной путь к API ----------
// helpmedoctor.ru открывается через прокси. Если прокси молчит (замечено с VPN), идём в воркер Cloudflare напрямую:
// GET-запрос, который не ответил за 2 секунды, дублируем на прямой адрес; кто ответил первым — тот путь и держим до конца сессии.
// POST не дублируем (нельзя дважды завершить приём) — он сразу идёт выбранным путём.
const DIRECT_API = window.__hmdDirect || "https://helpmedoctor.oxion-ezhkov.workers.dev";
const CAN_DIRECT = location.hostname === "helpmedoctor.ru";
let API_BASE = window.__hmdApiBase || (CAN_DIRECT && sessionStore("hmd_api_direct") === "1" ? DIRECT_API : "");
let apiProbed = !CAN_DIRECT || !!API_BASE;
function useDirectApi() {
  if (API_BASE) return;
  API_BASE = DIRECT_API;
  apiProbed = true;
  sessionStore("hmd_api_direct", "1");
  try { S.ws?.close(); } catch {}
}
async function apiFetch(method, path, init) {
  const url = (base) => `${base}/api${path}`;
  if (apiProbed || method !== "GET") return fetch(url(API_BASE), init);
  return new Promise((resolve, reject) => {
    let done = false, fails = 0, directStarted = false;
    const win = (r, direct) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (direct) useDirectApi(); else apiProbed = true;
      resolve(r);
    };
    // Ошибка одного пути не мешает другому; отказ — только если не ответили оба
    const lose = (e) => { if (++fails === 2 && !done) reject(e); };
    const tryDirect = () => {
      if (directStarted || done) return;
      directStarted = true;
      fetch(url(DIRECT_API), init).then((r) => win(r, true), lose);
    };
    const timer = setTimeout(tryDirect, 2000);
    fetch(url(""), init).then((r) => win(r, false), (e) => { lose(e); tryDirect(); });
  });
}

async function api(method, path, body, opts = {}) {
  const headers = { "X-Client": IN_TG ? "miniapp" : "web" };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  let payload;
  if (body instanceof Blob) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let r;
  try {
    r = await apiFetch(method, path, { method, headers, body: payload, signal: opts.signal });
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
  else { registerSw(); cookieBar(); }
  // Ссылки из бота: /app?go=/patient/123 → #/patient/123
  const goParam = new URLSearchParams(window.__hmdQs ?? location.search).get("go");
  if (goParam && goParam.startsWith("/")) {
    history.replaceState(null, "", `${location.pathname}#${goParam}`);
    // Ссылка-вызов «Кто круче?» — помним её на время входа (после Google/Яндекса адрес теряется)
    if (goParam.startsWith("/battle/")) sessionStore("hmd_go", goParam);
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
  } else {
    // В браузере высоту экрана берём по реально видимой области: у части мобильных браузеров 100dvh
    // включает зону под панелью браузера — тогда нижнее меню и строка ввода уходят за край
    applyWebViewport();
    window.visualViewport?.addEventListener("resize", applyWebViewport);
    window.visualViewport?.addEventListener("scroll", applyWebViewport);
    window.addEventListener("resize", applyWebViewport);
    document.addEventListener("focusin", (e) => { if (e.target.matches?.("input, textarea")) followViewport(); });
    document.addEventListener("focusout", (e) => { if (e.target.matches?.("input, textarea")) followViewport(); });
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
    // Промокод из ссылки (/app?promo=КОД) — применим сразу после входа или регистрации
    if (qs.get("promo")) sessionStore("hmd_promo", qs.get("promo").slice(0, 32));
    // Личная ссылка партнёра (?ref=r_<код>, или сохранённая сайтом) — метка уходит в регистрацию любым способом входа
    let refLabel = qs.get("ref") || "";
    try { if (!refLabel) { const saved = JSON.parse(localStorage.getItem("hmd_ref") || "null"); if (saved && Date.now() - saved.at < 30 * 86400000) refLabel = saved.r; } } catch {}
    if (/^r_[a-z0-9]{4,12}$/i.test(refLabel)) sessionStore("hmd_from", refLabel);
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
  const pendingGo = sessionStore("hmd_go");
  if (pendingGo) {
    sessionStore("hmd_go", "");
    if (location.hash !== `#${pendingGo}`) history.replaceState(null, "", `${location.pathname}#${pendingGo}`);
  }
  window.addEventListener("hashchange", route);
  route();
  if (S.authNotice) toast(S.authNotice, S.authNoticeKind), (S.authNotice = null);
  api("POST", "/event", { type: "app_open" }).catch(() => {});
  followIntent();
  resumePaymentWatch();
  sendAttribution();
  registrationGoal();
}

/** Цели Яндекс Метрики (счётчик сайта) и пикселя VK Рекламы (3799574) — одни и те же имена */
function goal(name, params) {
  try { window.ym?.(113057442, "reachGoal", name, params); } catch {}
  try { (window._tmr = window._tmr || []).push({ type: "reachGoal", id: 3799574, goal: name }); } catch {}
}

/** Пришли с сайта по кнопке тарифа (from=…_trial / _month …) — после входа сразу открываем тарифы */
/** Промокод: из «Тарифов» или по ссылке /app?promo=КОД (сохраняется на время входа и регистрации) */
async function redeemPromo(code, btn) {
  code = String(code || "").trim();
  if (!code) return toast("Введите промокод", "error");
  if (btn) btnBusy(btn);
  try {
    S.promoAt = Date.now();
    const r = await api("POST", "/promo", { code });
    sessionStore("hmd_promo", "");
    goal("promo_ok", { code: r.code });
    haptic("success");
    await loadMe().catch(() => {});
    rerender(true);
    openSheet(html`<div class="stack center notice-sheet">
      <div class="tile ok lg" style="margin:0 auto">${ic("gift")}</div>
      <h2>Промокод активирован</h2>
      <p class="muted">+${r.days} ${plural(r.days, "день", "дня", "дней")} премиума${r.until ? ` — доступ до ${r.until}` : ""}. Пациенты без лимита, разбор по клиническим рекомендациям и тесты уже открыты.</p>
      <button class="btn lg block" data-close-sheet>${ic("plus")}<span>Принять пациента</span></button></div>`, (el) => {
      el.querySelector("[data-close-sheet]").onclick = () => { closeSheet(); go("/"); };
    });
  } catch (e) {
    sessionStore("hmd_promo", "");
    toast(e.message, "error");
    if (btn && document.body.contains(btn)) btnBusy(btn, false);
  }
}

function followIntent() {
  const promo = sessionStore("hmd_promo");
  if (promo && S.me?.profile) { redeemPromo(promo); return; }
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
        sendAttribution();
        registrationGoal();
      } else if (r.status === "expired") {
        renderLogin();
      }
    } catch {}
  }, 2000);
}

// ---------------------------------------------------
// Данные и синхронизация
// ---------------------------------------------------
// Не больше одного запроса профиля одновременно: пока идёт один, следующие вызовы ждут ОДИН общий
// повторный запрос, отправленный после него, — так данные всегда не старше момента вызова, а запросов меньше.
// Справочники (config) не меняются между загрузками — после первой просим профиль без них.
let meInflight = null;
let meQueued = null;
function fetchMe() {
  const cfg = S.me?.config;
  meInflight = api("GET", cfg ? "/me?lite=1" : "/me")
    .then((me) => {
      S.me = cfg && !me.config ? { ...me, config: cfg } : me;
      if (S.me.profile?.notice) setTimeout(() => showNotice(S.me.profile.notice), 300);
      return S.me;
    })
    .finally(() => { meInflight = null; });
  return meInflight;
}
function loadMe() {
  if (!meInflight) return fetchMe();
  if (!meQueued) meQueued = meInflight.catch(() => {}).then(() => { meQueued = null; return fetchMe(); });
  return meQueued;
}

// ---------------------------------------------------
// Откуда пришёл человек: сайт сохраняет первое касание (hmd_src: внешний источник, страница входа, UTM) и последнюю
// страницу перед переходом. Отправляем один раз на аккаунт — сервер запишет, только если регистрация свежая.
// ---------------------------------------------------
(() => {
  try {
    if (localStorage.getItem("hmd_src")) return;
    let host = "";
    try { host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : ""; } catch {}
    if (/(^|\.)helpmedoctor\.ru$|workers\.dev$/.test(host)) host = "";
    localStorage.setItem("hmd_src", JSON.stringify({ r: host, l: location.pathname, u: "", at: Date.now() }));
  } catch {}
})();

function metrikaClientId() {
  return new Promise((resolve) => {
    try {
      if (!window.ym) return resolve("");
      const t = setTimeout(() => resolve(""), 1500);
      window.ym(113057442, "getClientID", (id) => { clearTimeout(t); resolve(String(id || "")); });
    } catch { resolve(""); }
  });
}

/** Цель «registration» (Метрика и пиксель VK): один раз на аккаунт, если он создан меньше суток назад */
function registrationGoal() {
  try {
    const p = S.me?.profile;
    if (!p?.uid || !p.registered_at || Date.now() - p.registered_at > 86400000 || localStorage.getItem("hmd_reg_goal") === String(p.uid)) return;
    goal("registration", { via: IN_TG ? "telegram_app" : "site" });
    localStorage.setItem("hmd_reg_goal", String(p.uid));
  } catch {}
}

async function sendAttribution() {
  try {
    const uid = S.me?.profile?.uid;
    // Мини-приложение в Telegram — человек пришёл через бота, сайт тут ни при чём
    if (IN_TG || !uid || localStorage.getItem("hmd_src_sent") === String(uid)) return;
    const src = JSON.parse(localStorage.getItem("hmd_src") || "null") || {};
    const cid = await metrikaClientId();
    await api("POST", "/attribution", { r: src.r || "", l: src.l || "", u: src.u || "", p: localStorage.getItem("hmd_last_page") || "", at: src.at || 0, cid });
    localStorage.setItem("hmd_src_sent", String(uid));
  } catch {}
}

// ---------------------------------------------------
// Проверка оплаты: не ждём уведомления банка — приложение само спрашивает статус,
// пока человек на странице оплаты и сразу после возврата
// ---------------------------------------------------
const PAY_KEY = "hmd_pay_at";
let payWatch = null;

/** Важное уведомление от сервиса (например, решение по студенческому): окно, пока пользователь его не закроет */
function showNotice(n) {
  if (!n?.id || S.noticeShown === n.id) return;
  S.noticeShown = n.id;
  haptic(n.kind === "ok" ? "success" : "warning");
  const seen = () => api("POST", "/notice/seen", { id: n.id }).catch(() => {});
  openSheet(html`<div class="stack center notice-sheet">
    <h2>${n.title}</h2>
    <p class="muted">${n.text}</p>
    ${n.button ? html`<button class="btn lg block" data-notice-go>${n.button.text}</button>` : ""}
    <button class="btn block ghost" data-notice-close>Понятно</button>
  </div>`, (sheet) => {
    sheet.querySelector("[data-notice-close]").onclick = () => { seen(); closeSheet(true); };
    const g = sheet.querySelector("[data-notice-go]");
    if (g) g.onclick = () => { seen(); closeSheet(true); go(n.button.go); };
  });
  seen();
}

function paidNotice(text = "Оплата прошла — подписка активирована!") {
  store(PAY_KEY, null);
  payWatch = null;
  if (Date.now() - (S.paidToastAt || 0) < 15000) return;
  S.paidToastAt = Date.now();
  toast(text, "ok");
  haptic("success");
  loadMe().then(() => rerender()).catch(() => {});
}

/** Спрашивает сервер о свежих неоплаченных ссылках каждые 3 с в течение ms */
function watchPayment(ms = 180000) {
  const until = Date.now() + ms;
  if (payWatch) { payWatch.until = Math.max(payWatch.until, until); return; }
  const w = (payWatch = { until });
  const tick = async () => {
    if (payWatch !== w || !S.token) return;
    let r = null;
    try { r = await api("POST", "/pay/check"); } catch {}
    if (payWatch !== w) return;
    if (r?.activated) return paidNotice();
    // Неоплаченных ссылок нет (или время вышло) — перестаём спрашивать
    if ((r && !r.pending) || Date.now() > w.until) { payWatch = null; return; }
    setTimeout(tick, document.hidden ? 6000 : 3000);
  };
  tick();
}

/** После ухода на страницу банка: вернулся во вкладку в течение получаса — сразу проверяем */
function resumePaymentWatch() {
  const at = Number(store(PAY_KEY)) || 0;
  if (at && Date.now() - at < 1800000) watchPayment(120000);
  else if (at) store(PAY_KEY, null);
}

async function loadPatient(id) {
  const data = await api("GET", `/patients/${encodeURIComponent(id)}`);
  S.patients.set(id, data);
  return data;
}

let refreshTimer = null;
function scheduleRefresh(delay = 250) {
  clearTimeout(refreshTimer);
  // Вкладка в фоне — не обновляем зря: при возвращении обновится сразу (visibilitychange)
  if (document.hidden) return;
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
  const ws = new WebSocket(API_BASE ? `${API_BASE.replace(/^http/, "ws")}/api/ws?token=${encodeURIComponent(S.token)}` : `${proto}://${location.host}/api/ws?token=${encodeURIComponent(S.token)}`);
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

let vvLast = "";
function applyWebViewport() {
  const vv = window.visualViewport;
  const h = Math.round(vv?.height || window.innerHeight);
  const top = Math.max(0, Math.round(vv?.offsetTop || 0));
  const key = `${h}:${top}`;
  if (key === vvLast) return;
  vvLast = key;
  const st = document.documentElement.style;
  if (h > 200) st.setProperty("--app-h", `${h}px`);
  // iOS при открытой клавиатуре сдвигает видимую область вниз (offsetTop), а не сжимает страницу.
  // Экран приёма закреплён по этой области — строка ввода стоит ровно над клавиатурой, без пустоты.
  st.setProperty("--vv-top", `${top}px`);
}
// События visualViewport на iOS приходят в конце анимации клавиатуры — шапка сначала уезжает, потом прыгает.
// Пока клавиатура выезжает или прячется, сверяемся с видимой областью каждый кадр: шапка стоит на месте.
let vvFollowUntil = 0;
function followViewport() {
  const was = vvFollowUntil > performance.now();
  vvFollowUntil = performance.now() + 900;
  if (was) return;
  const step = () => {
    applyWebViewport();
    if (performance.now() < vvFollowUntil) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
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
    // Ответ пациента приходит по словам — показываем, пока он «печатает»
    if (typeof msg.partial === "string") {
      if (S.partial?.id !== msg.patient_id) S.partial = { id: msg.patient_id, target: "", n: 0, text: "" };
      S.partial.target = msg.partial;
      if (!S.streamTimer) { S.streamTimer = setInterval(streamTick, REVEAL_MS); streamTick(); }
      return;
    }
    // Ответ готов: если его ждал не наш запрос (бот, другое устройство) — черновик больше не нужен
    if (!msg.typing && S.partial?.id === msg.patient_id && !S.inflight.has(msg.patient_id)) stopStream();
  }
  if (msg.scope === "profile" && msg.error) toast(msg.error, "error");
  if (msg.scope === "profile" && msg.notice) showNotice(msg.notice);
  // Промокод показывает своё окно — общее «Подписка активирована» поверх него не нужно
  if (msg.scope === "profile" && msg.paid && !(msg.paid === "gift" && Date.now() - (S.promoAt || 0) < 15000)) paidNotice(msg.paid === "gift" ? "Подписка активирована!" : undefined);
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
  if (msg.scope === "battle") {
    onBattleSync(msg);
    return;
  }
  if (msg.scope === "partner") {
    if (msg.reward) toast(`+${rub(msg.reward)} ₽ партнёрского вознаграждения`, "ok");
    partnerData = null;
    if (S.route.name === "partner") viewPartner(true);
    return;
  }
  if (msg.scope === "expert" && msg.patient_id) {
    onExpertSync(msg);
    return;
  }
  if (msg.scope === "guide" && msg.patient_id) {
    if (!msg.pending) refreshGuide(msg.patient_id, msg.error);
    return;
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
    resumePaymentWatch();
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
  if (parts[0] === "expert" && parts[1]) return { name: "expert", params: { id: parts[1] }, q };
  if (parts[0] === "profile" && parts[1] === "stats") return { name: "stats", params: {}, q };
  if (parts[0] === "profile" && parts[1] === "settings") return { name: "settings", params: {}, q };
  if (parts[0] === "profile" && parts[1] === "accounts") return { name: "accounts", params: {}, q };
  if (parts[0] === "profile" && parts[1] === "app") return { name: "install", params: {}, q };
  if (parts[0] === "partner") return { name: "partner", params: {}, q };
  if (parts[0] === "battles") return { name: "battles", params: {}, q };
  if (parts[0] === "battle" && parts[1]) return { name: "battle", params: { id: parts[1].toLowerCase() }, q };
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
  if (["plans", "stats", "settings", "battles"].includes(r.name)) return go("/profile");
  if (r.name === "battle") return go("/battles");
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
  if (["patient", "consult", "expert"].includes(r.name) && !S.patients.has(r.params.id)) {
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
  const views = { home: viewHome, patients: viewPatients, patient: viewPatient, consult: viewConsult, quizzes: viewQuizzes, quiz: viewQuiz, expert: viewExpert, profile: viewProfile, stats: viewStats, settings: viewSettings, plans: viewPlans, accounts: viewAccounts, install: viewInstall, partner: viewPartner, battles: viewBattles, battle: viewBattle };
  (views[r.name] || viewHome)(fresh);
}

function renderShell(content, withNav = true) {
  const r = S.route.name;
  const pendingQuizzes = (S.me?.quizzes || []).filter((q) => q.status !== "done").length;
  const queue = (S.me?.patients || []).filter((p) => p.status !== "closed").length;
  const tab = (name, href, ico, label, badge) => html`<a href="#${href}" class="${r === name || (name === "patients" && ["patient", "expert"].includes(r)) || (name === "quizzes" && r === "quiz") || (name === "profile" && ["plans", "stats", "settings", "accounts", "install", "partner", "battles", "battle"].includes(r)) ? "active" : ""}">
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

// ---------- Светлая / тёмная тема (общая с сайтом настройка hmd_theme) ----------
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-theme-toggle]");
  if (!b) return;
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("hmd_theme", next); } catch {}
  goal("theme", { to: next });
  rerender();
});

// Нажали на уже открытую вкладку меню — плавно наверх
document.addEventListener("click", (e) => {
  const a = e.target.closest(".nav a.active");
  // Внутри раздела (статистика, карточка пациента, тест) — назад к списку вкладки; на самой вкладке — наверх
  if (a && (location.hash || "#/").replace(/\?.*$/, "") === a.getAttribute("href")) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

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
  const y = renderShell(html`<div class="page">
    <div class="hello">
      <a href="#/profile" class="avatar-link" aria-label="Профиль">${userAvatar(p)}</a>
      <div class="grow">
        <h1 class="ellipsis">Врач ${p.name}</h1>
        <div class="muted small">${!p.onboarding_done ? "Настройка профиля" : html`${p.level_label} · ${p.profession}`}</div>
      </div>
      ${IN_TG ? html`<button class="icon-btn site-btn" data-open-site aria-label="Открыть на сайте" title="Открыть на сайте">${ic("external")}</button>`
        : html`<button class="icon-btn" data-theme-toggle aria-label="Светлая или тёмная тема" title="Светлая / тёмная тема">${ic(isDark() ? "sun" : "moon")}</button>`}
    </div>

    ${trialNotice(p)}
    ${p.onboarding_done ? html`<a class="card lvl-card" href="#/profile/stats" aria-label="Статистика">${levelHead(p)}${kpis(p)}</a>` : ""}

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

    ${active.length ? (inConsult.length ? patientCard(inConsult[0], `/consult/${inConsult[0].id}`, "Продолжить приём") : patientCard(waiting[0])) : ""}

    ${pendingQuiz ? html`<a class="card tap row" href="#/quiz/${pendingQuiz.pat_id}" style="text-decoration:none;color:inherit">
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

// ---------- Уровень и ключевые цифры ----------
// Кольцо с номером уровня, звание, лестница званий; серия и оценка — плитки с такими же шкалами-сегментами
function levelHead(p) {
  const lvl = p.level_info;
  const left = lvl.to ? Math.max(0, lvl.to - (p.xp || 0)) : 0;
  const pct = Math.round((lvl.progress || 0) * 100);
  const ranks = S.me.config.level_ranks || [];
  const rank = p.level_rank || { index: 0, title: "", from: 1, to: null };
  // Окно из 4 ступеней: одна пройденная, текущая и две следующие
  const start = Math.max(0, Math.min(rank.index - 1, ranks.length - 4));
  const inRank = rank.to ? Math.min(1, (lvl.level - rank.from + (lvl.progress || 0)) / (rank.to - rank.from)) : 1;
  return html`<div class="lvl-top">
    <div class="lvl-ring" style="--p:${pct}"><b>${lvl.level}</b></div>
    <div class="grow">
      <b class="lvl-title">${rank.title}</b>
      <div class="small muted">${lvl.to ? `ещё ${left} XP до повышения` : "максимальный уровень"}</div>
    </div>
  </div>
  ${ranks.length ? html`<div class="ladder">${ranks.slice(start, start + 4).map(([, title], k) => {
    const i = start + k;
    const cls = i < rank.index ? "done" : i === rank.index ? "now" : "";
    return html`<div class="${cls}"><i style="${i === rank.index ? `--f:${Math.round(inRank * 100)}%` : ""}"></i><span>${title}</span></div>`;
  })}</div>` : ""}`;
}
function segs(n, filled) {
  return html`<div class="segs">${Array.from({ length: n }, (_, i) => html`<i style="--f:${Math.round(Math.max(0, Math.min(1, filled - i)) * 100)}%"></i>`)}</div>`;
}
function kpi(icon, cls, value, label, bar) {
  return html`<div class="kpi ${cls}"><div class="kpi-h">${ic(icon)}<b>${value}</b></div><span>${label}</span>${bar}</div>`;
}
function kpis(p, full = false) {
  const st = p.stats || {};
  const streak = p.streak || 0;
  const week = streak ? streak % 7 || 7 : 0; // неделя серии: каждые 7 дней — бонус к опыту
  return html`<div class="kpis">
    ${kpi("flame", "flame", streak, `${plural(streak, "день", "дня", "дней")} подряд`, segs(7, week))}
    ${kpi("star", "star", st.ratings_count ? st.avg_rating.toFixed(1).replace(".", ",") : "—", full ? "средняя оценка" : "ср. оценка", segs(5, st.ratings_count ? st.avg_rating : 0))}
  </div>`;
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
      <div class="field">${professionSelect("onb-prof", o.profession)}</div>
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
  const op = $("#onb-prof");
  if (op) op.onchange = () => {
    o.profession = op.value;
    if (o.profession !== "__custom") { o.custom = ""; o.options = [...cfg.specializations[o.profession]]; o.specs = new Set(); o.step = 3; }
    redraw();
    if (o.profession === "__custom") $("#onb-custom")?.focus();
  };
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
    const more = (p.bonus_today || 0) < (p.bonus_max || 0);
    return html`<div class="card stack center">
      <b>Бесплатные пациенты на сегодня закончились</b>
      <p class="small muted">Новые — завтра после полуночи (МСК).${more ? ` Если на одном из ваших приёмов разбор ещё не готов — оценка от ${dec(p.bonus_rating)} даст ещё одного пациента сегодня.` : ""}${p.trial_available ? " Или 7 дней безлимита за 1 ₽." : ""}</p>
      <a class="btn block" href="#/plans" ${p.trial_available ? html`data-checkout="trial"` : ""}>${ic("gem")}<span>${p.trial_available ? "Премиум 7 дней за 1 ₽" : "Безлимитный доступ"}</span></a>
      ${pack ? html`<a class="btn block ghost" href="#/plans" data-checkout="patients3">${ic("plus")}<span>${pack.label.replace(/^\+/, "")} — ${rub(pack.price)} ₽</span></a>` : ""}
    </div>`;
  }
  return html`<button class="btn lg block" id="new-patient">${ic("plus")}<span>Принять нового пациента</span></button>${freeNote(p)}`;
}

/** Сколько бесплатных пациентов осталось сегодня и как получить ещё (без премиума) */
function freeNote(p) {
  if (p.has_sub || p.free_limit == null) return "";
  const left = p.free_left || 0;
  const credits = left <= 0 && p.patient_credits ? ` · купленных: ${p.patient_credits}` : "";
  const more = (p.bonus_today || 0) < (p.bonus_max || 0) ? ` · оценка от ${dec(p.bonus_rating)} — +1 пациент` : "";
  return html`<div class="tiny muted center" style="margin-top:6px">Сегодня бесплатно: ${left} из ${p.free_limit}${p.bonus_today ? ` (бонус за оценки: +${p.bonus_today})` : ""}${credits}${more}</div>`;
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
      <div class="row between"><span class="name ellipsis">${x.battle ? html`<span class="badge accent battle-tag">${ic("swords")} битва</span> ` : ""}${x.name}</span>
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
  // Пациент битвы: диагноз, оценка и разбор — только после итога битвы
  const battleLock = !!(p.battle?.id && consults.length && !battleRevealed(p.battle.id));

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
      ${closed && !battleLock ? html`<div class="card flat" style="background:var(--surface-2)"><div class="tiny muted">ИСТИННЫЙ ДИАГНОЗ</div><b>${p.true_diagnosis}</b></div>` : ""}
      ${battleLock ? html`<a class="card flat row" href="#/battle/${p.battle.id}" style="text-decoration:none;color:inherit;background:var(--warn-soft)"><div class="tile warn">${ic("swords")}</div><div class="grow"><b>Пациент битвы</b><div class="small muted">Диагноз и разбор откроются после итога</div></div>${ic("chevron", "c-muted")}</a>` : ""}
      <div class="stack-sm">
        ${!closed ? html`<button class="btn lg block" data-start="${p.id}">${ic(IN_TG ? "chat" : "play")}<span>${p.current ? "Продолжить приём" : p.consultations?.length ? "Начать повторный приём" : "Начать приём"}${IN_TG ? " в чате" : ""}</span></button>` : ""}
        ${closed && !battleLock ? html`<button class="btn block outline" data-reopen="${p.id}">${ic("repeat")}<span>Повторный приём</span></button>` : ""}
        ${(p.conversation_history || []).length ? html`<a class="btn block ghost" href="#/consult/${p.id}">${ic("chat")}<span>${closed || IN_TG ? "История диалога" : "Открыть чат приёма"}</span></a>` : ""}
        ${never ? html`<button class="btn block danger" data-reject="${p.id}">Отказаться от пациента</button>` : ""}
      </div>
    </div>

    ${quiz && !battleLock ? html`<a class="card tap row" href="#/quiz/${p.id}" style="text-decoration:none;color:inherit">
      <div class="tile warn">${ic("quiz")}</div>
      <div class="grow"><b>Работа над ошибками</b><div class="small muted">${quiz.locked ? `${quiz.total} вопросов по вашим ошибкам · в премиуме` : quiz.status === "done" ? `Пройден: ${quiz.score} из ${quiz.total}` : `${quiz.answered} из ${quiz.total} вопросов`}</div></div>
      ${quiz.locked ? html`<span class="badge accent">${ic("gem")} премиум</span>` : ic("chevron", "c-muted")}</a>` : ""}

    ${consults.length && !battleLock ? html`<div class="section-title">Приёмы</div>
      ${consults.map((c, i) => html`<div class="card stack">
        <div class="row between"><b>Приём №${consults.length - i}</b><span class="tiny muted">${dateText(c.date)}</span></div>
        ${c.evaluating ? etaBox("evaluation", c.date) : evaluationBlock(c)}
        ${actionsSummary(c)}
        ${!c.evaluating && i === 0 ? html`<div data-guide-slot="${p.id}">${guideBlock(c, p.id, p.gift_kr)}</div>${c.rating != null ? expertCta(p) : ""}` : ""}
      </div>`)}` : ""}

    ${p.test_results?.length ? html`<div class="section-title">Результаты обследований</div>
      ${[...p.test_results].reverse().map((t) => html`<details class="card"><summary><b class="row-c">${ic("flask", "c-accent")}${t.test}</b> <span class="tiny muted">· ${dateText(t.ordered_at)}</span></summary><div style="margin-top:10px">${labTable(t.result)}</div></details>`)}` : ""}

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

/** Текст эксперта — короткими абзацами: по пустым строкам, а если модель прислала сплошной текст — по два предложения */
function paragraphs(text) {
  const t = String(text || "").trim();
  const byLines = t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (byLines.length > 1) return byLines;
  const sentences = t.match(/[^.!?…]+[.!?…]+(\s|$)|[^.!?…]+$/g)?.map((x) => x.trim()).filter(Boolean) || [t];
  const out = [];
  for (let i = 0; i < sentences.length; i += 2) out.push(sentences.slice(i, i + 2).join(" "));
  return out;
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
    ${f.expert_text ? html`<div class="expert-text">${paragraphs(f.expert_text).map((p) => html`<p>${p}</p>`)}</div>` : (f.good || []).map((g) => html`<p>${g}</p>`)}
    ${c.hints ? html`<div class="small fact">${ic("bulb", "c-warn")}<span>Подсказок взято: ${c.hints} — оценка ниже на ${String(Math.round(c.hints * 2) / 10).replace(".", ",")}</span></div>` : ""}
    ${(f.dialog_moments || []).length ? html`<div class="stack-sm"><div class="tiny muted">МОМЕНТЫ ИЗ ДИАЛОГА</div>${f.dialog_moments.map((m) => html`<div class="moment">${m.quote ? html`<div class="quote small">«${m.quote}»</div>` : ""}<div class="small">${m.comment}</div></div>`)}</div>` : ""}
    ${f.recommendation ? html`<div class="small fact">${ic("bulb", "c-warn")}<div><b>Совет:</b> ${f.recommendation}</div></div>` : ""}
    ${c.post_story ? html`<div class="card flat" style="background:var(--surface-2)"><div class="tiny muted row-c">${ic("book")} ЧТО БЫЛО ДАЛЬШЕ</div><div class="small">${c.post_story}</div></div>` : ""}
  </div>`;
}

/** Разбор по клиническим рекомендациям Минздрава: как распознать, обязательный минимум, диагностика, лечение с дозами */
function guideBlock(c, id, gift = false) {
  const g = c.guide;
  if (!g) {
    const pending = S.guidePending.has(id) || (c.guide_pending && Date.now() - c.guide_pending < 3 * 60000);
    if (pending) {
      const start = S.guideStart.get(id) || c.guide_pending || Date.now();
      if (!S.guideStart.has(id)) S.guideStart.set(id, start);
      return html`<div class="guide-cta pending" role="status"><b>Готовим разбор по клиническим рекомендациям Минздрава</b>
        ${etaBox("guide", start)}
        <p class="small muted">Как надо было распознать, обязательный минимум, препараты и дозы. Разбор появится здесь сам — пока можно обсудить приём с экспертом.</p></div>`;
    }
    // Первый пациент нового пользователя — разбор по КР в подарок
    const premium = S.me?.profile?.premium || gift;
    return html`<div class="guide-cta">
      ${gift && !S.me?.profile?.premium ? html`<span class="badge accent gift-badge">${ic("gem")} Первый пациент — разбор по КР в подарок</span>` : ""}
      <div class="row-c"><div class="tile accent">${ic("book")}</div><div class="grow"><b>Разбор по клиническим рекомендациям Минздрава</b><div class="small muted">Как надо было распознать, что обязательно по КР, лучшая диагностика, препараты и дозы</div></div></div>
      ${premium ? html`<button class="btn block" data-guide-req="${id}">${ic("book")}<span>Получить разбор по КР</span></button>`
        : html`<a class="btn block" href="#/plans" ${S.me?.profile?.trial_available ? html`data-checkout="trial"` : ""}>${ic("gem")}<span>${S.me?.profile?.trial_available ? "Премиум: 7 дней за 1 ₽" : "Открыть в премиуме"}</span></a>`}
    </div>`;
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
  if (S.partial?.id === p.id && S.partial.text) {
    return html`<div class="msg from-patient revealing streaming"><span class="txt">${S.partial.text}</span></div>`;
  }
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
    // Часть ответа уже показана по мере генерации — дальше «печатаем» с того же места
    const shownLen = S.partial?.id === id ? (S.partial.text || "").length : 0;
    try {
      const { patient } = await loadPatient(id);
      if (S.partial?.id === id) stopStream(); // черновик убираем, когда в ленте уже настоящая реплика
      if (kind === "reply" || kind === "voice") startReveal(patient, since, shownLen);
      if (kind === "test") S.revealTs = patient.test_results?.at(-1)?.ordered_at || 0;
      if (kind === "exam") S.revealTs = patient.exam_results?.at(-1)?.ts || 0;
      if (S.revealTs) setTimeout(() => { S.revealTs = 0; }, 6000);
    } catch {
      if (S.partial?.id === id) stopStream();
    }
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
      return html`${sep}<div class="event test${fresh}"><div class="event-title">${ic("flask", "c-accent")}${it.t.test}</div><div class="event-body">${labTable(it.t.result)}</div></div>`;
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
// ---------- Протокол обследования: строки «Показатель — значение (норма …)» → таблица без рамок ----------
const num = (x) => Number(String(x).replace(",", ".").replace(/[^\d.\-]/g, ""));
/** Выше или ниже нормы: «3,5–5,5», «< 5», «> 80», «до 10». Не поняли норму — null */
function outOfRange(value, norm) {
  const v = String(value).match(/-?\d+(?:[.,]\d+)?/);
  if (!v || !norm || norm.includes("%") !== String(value).includes("%")) return null; // «3,2 л» против «> 80% от должного» не сравниваем
  const x = num(v[0]);
  const range = norm.match(/(-?\d+(?:[.,]\d+)?)\s*[–—-]\s*(-?\d+(?:[.,]\d+)?)/);
  if (range) return x < num(range[1]) ? "low" : x > num(range[2]) ? "high" : "ok";
  const lt = norm.match(/(?:<|≤|до|менее|ниже)\s*(-?\d+(?:[.,]\d+)?)/i);
  if (lt) return x > num(lt[1]) ? "high" : "ok";
  const gt = norm.match(/(?:>|≥|от|более|выше)\s*(-?\d+(?:[.,]\d+)?)/i);
  if (gt) return x < num(gt[1]) ? "low" : "ok";
  return null;
}
/** Разбор строки протокола: { name, value, norm } или null для обычного текста */
function labRow(line) {
  // «Гемоглобин — 118 г/л (норма 130–160)», «СОЭ: 25 мм/ч», а без разделителя — «Hb 118 г/л (130-160)»
  // Делим только вне скобок: «ось сердца в норме (от -30 до +90)» и «увеличены (норма — по возрасту)» — не таблица
  const balanced = (x) => !x || (x.match(/\(/g) || []).length === (x.match(/\)/g) || []).length;
  const m = [line.match(/^\s*[•\-–]?\s*([^:]{2,70}?)(?::|\s[—–-])\s+(.+)$/), line.match(/^\s*[•\-–]?\s*(.{2,70}?)\s+(-?\d[\d.,]*\S*(?:\s.*)?)$/)]
    .find((x) => x && balanced(x[1]));
  if (!m) return null;
  let value = m[2].trim(), norm = "";
  // Норма — в скобках в конце: «(норма 130–160)» или просто «(4–9)», «(< 5)»; «(нормальный)» и «(5%)» — часть значения
  const nm = value.match(/\((?:норма|N|референс\S*)(?:\s*:\s*|\s+)([^)]*)\)\s*\.?$/i) || value.match(/\(([^)]*\d[^)]*(?:[–—-]|<|>|≤|≥|до|от)[^)]*|(?:<|>|≤|≥|до|от)[^)]*\d[^)]*)\)\s*\.?$/);
  if (nm) { norm = nm[1].trim().replace(/^[—–:-]\s*/, ""); value = value.slice(0, nm.index).trim(); }
  if (!value || value.length > 90 || m[1].trim().split(/\s+/).length > 8) return null;
  return { name: m[1].trim(), value, norm };
}
function labTable(text) {
  const lines = String(text || "").split("\n").filter((l) => l.trim());
  return html`<div class="lab">${lines.map((line, i) => {
    const r = labRow(line);
    if (!r) return html`<div class="lab-text line" style="--i:${i}">${line}</div>`;
    const st = outOfRange(r.value, r.norm);
    // Длинное словесное значение («структура и подвижность в пределах нормы») — под названием, на всю ширину
    const wide = !/^[-+<>≤≥]?\s*\d/.test(r.value) && r.value.length > 22;
    return html`<div class="lab-row line ${wide ? "wide" : ""} ${st && st !== "ok" ? "off" : ""}" style="--i:${i}">
      <div class="lab-name">${r.name}</div>
      <div class="lab-val"><b>${r.value}</b>${st === "high" ? html`<span class="lab-arrow" title="Выше нормы">↑</span>` : st === "low" ? html`<span class="lab-arrow" title="Ниже нормы">↓</span>` : ""}${r.norm ? html`<span class="lab-norm">норма ${r.norm}</span>` : ""}</div>
    </div>`;
  })}</div>`;
}

function revealLines(text, fresh) {
  // Строки всегда отдельными элементами: когда анимация заканчивается, разметка не меняется и текст не мигает
  return String(text || "").split("\n").map((line, i) => html`<span class="line" style="--i:${i}">${line || " "}</span>`);
}

// ---------- Реплика пациента «печатается» по словам ----------
// ИИ отвечает быстро и целиком — показываем постепенно, как в живом разговоре
const REVEAL_MS = 110; // одно слово за 110 мс — спокойный темп живой речи
/** Ответ идёт с сервера кусками — показываем его по словам в своём темпе (последнее, возможно недописанное, слово ждём) */
function streamTick() {
  const s = S.partial;
  if (!s) { clearInterval(S.streamTimer); S.streamTimer = null; return; }
  const parts = s.target.split(/(\s+)/).filter(Boolean);
  const ready = Math.max(0, parts.length - 1);
  if (s.n >= ready) return;
  s.n = Math.min(ready, s.n + 2); // слово + пробел
  s.text = parts.slice(0, s.n).join("");
  const el = document.querySelector(".msg.streaming .txt");
  if (el && S.route.name === "consult" && S.route.params.id === s.id) {
    el.textContent = s.text;
    const box = $("#messages");
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 160) box.scrollTop = box.scrollHeight;
  } else renderTypingOnly();
}
function stopStream() {
  clearInterval(S.streamTimer);
  S.streamTimer = null;
  S.partial = null;
}
/** Реплика пациента «печатается» по словам; fromLen — сколько символов уже показано по ходу генерации */
function startReveal(p, since, fromLen = 0) {
  const m = [...(p.conversation_history || [])].reverse().find((x) => x.role === "patient" && x.ts >= since);
  if (!m || !m.text) return;
  const parts = m.text.split(/(\s+)/).filter(Boolean);
  if (parts.length < 3) return;
  let n = 0;
  for (let len = 0; n < parts.length && len + parts[n].length <= fromLen; n++) len += parts[n].length;
  if (n >= parts.length) return;
  S.reveal = { ts: m.ts, parts, n };
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
    ${tests.length ? html`<div class="section-title" style="margin:6px 0 8px">Обследования</div>${tests.map((t) => html`<details class="card flat sum-item"><summary><b>${t.test}</b></summary>${labTable(t.result)}</details>`)}` : ""}
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
    haptic("success");
    // Битва: ни оценки, ни диагноза — сразу экран ожидания соперника, итог откроется, когда закончат оба
    if (p.battle?.id) {
      closeSheet();
      battleCache.delete(p.battle.id);
      Promise.all([loadPatient(p.id), loadMe()]).catch(() => {});
      go(`/battle/${p.battle.id}`);
      return;
    }
    S.evalStart = Date.now();
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
  }, 55);
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
    // В битве оценку не показываем до итога — интрига
    if (r.battle_id) { battleCache.delete(r.battle_id); if (S.route.name === "battle" && S.route.params.id === r.battle_id) viewBattle(true); return; }
    if (!r.fromPoll) toast(`Разбор приёма готов: ${Number(r.rating).toFixed(1)} из 5`, "ok");
    return;
  }
  S.evalWaiting = null;
  if (S.evalStart) etaRecord("evaluation", Date.now() - S.evalStart);
  haptic("success");
  const slot = $("#eval-slot");
  if (!slot) return;
  const c = { rating: r.rating, xp: r.xp, hints: r.hints, post_story: r.post_story, feedback: { axes: r.axes, expert_text: r.expert_text, dialog_moments: r.dialog_moments, recommendation: r.recommendation } };
  slot.outerHTML = html`<div class="stack" style="margin-top:16px">
    <h3 class="row-c">${ic("card", "c-accent")}Разбор приёма</h3>
    ${evaluationBlock(c)}
    ${r.level_up ? html`<div class="card flat center" style="background:var(--accent-soft)"><b class="row-c" style="justify-content:center">${ic("trophy", "c-accent")}Новый уровень: ${r.level_up.to}</b>${r.rank_up ? html`<div class="small">Новое звание — «${r.rank_up}»</div>` : ""}</div>` : ""}
    ${r.task_done ? html`<div class="card flat center" style="background:var(--ok-soft)"><span class="row-c" style="justify-content:center">${ic("target", "c-ok")}Задание дня выполнено! +${r.task_done.xp} XP</span></div>` : ""}
    ${r.bonus_patient ? html`<div class="card flat center" style="background:var(--ok-soft)"><span class="row-c" style="justify-content:center">${ic("party", "c-ok")}Оценка от ${dec(S.me?.profile?.bonus_rating || 4.5)} — ещё один бесплатный пациент сегодня!</span></div>` : ""}
    <div data-guide-slot="${r.patient_id}">${guideBlock({}, r.patient_id, r.gift_kr)}</div>
    ${expertCta({ id: r.patient_id })}
    ${r.battle_id ? html`<a class="btn block" href="#/battle/${r.battle_id}">${ic("swords")}<span>Итог битвы «Кто круче?»</span></a>` : ""}
    <div class="grid-2"><a class="btn ghost" href="#/patient/${r.patient_id}">Карточка</a><button class="btn${r.battle_id ? " ghost" : ""}" id="eval-new">${ic("plus")}<span>Новый пациент</span></button></div>
    <p class="tiny muted center">${r.premium ? "Тест «работа над ошибками» появится во вкладке «Тесты» через минуту." : "Тест по вашим ошибкам уже готовится — он откроется в премиуме."}</p>
  </div>`[RAW];
  const nb = $("#eval-new");
  if (nb) nb.onclick = () => { closeSheet(); go("/"); };
}

// ---------- Обсуждение разбора с экспертом (премиум) ----------
const EXPERT_STARTERS = ["Почему такая оценка?", "Какие вопросы я упустил?", "Как лечить по клиническим рекомендациям?", "С чем дифференцировать этот диагноз?"];

/** Кнопка «Обсудить с экспертом» под разбором; без премиума — ведёт в тарифы */
function expertCta(p) {
  const prem = S.me?.profile?.premium;
  const n = (p.expert_chat || []).length;
  return html`<a class="card tap row expert-cta" href="#/expert/${p.id}" ${!prem && S.me?.profile?.trial_available ? html`data-checkout="trial"` : ""} style="text-decoration:none;color:inherit">
    <div class="tile accent">${ic("chat")}</div>
    <div class="grow"><b>Обсудить с экспертом</b><div class="small muted">${n ? `${n} ${plural(n, "сообщение", "сообщения", "сообщений")} · продолжить разговор` : "ИИ-профессор знает диагноз, ваши действия и КР"}</div></div>
    ${prem ? ic("chevron", "c-muted") : html`<span class="badge accent">${ic("gem")} премиум</span>`}</a>`;
}

function viewExpert() {
  const id = S.route.params.id;
  const data = S.patients.get(id);
  if (!data) return;
  const p = data.patient;
  const prem = S.me.profile.premium;
  const chat = p.expert_chat || [];
  const busy = S.expertBusy === id || (p.expert_busy && Date.now() - p.expert_busy < 90000);
  const partial = S.expertPartial?.id === id ? S.expertPartial.text : "";
  const evaluated = (p.consultations || []).some((c) => c.rating != null && !c.evaluating);
  // Карточка в памяти могла быть загружена до разбора — подтягиваем свежую, чтобы чат открылся сразу
  if (!evaluated && !S.expertFresh?.has(id)) {
    (S.expertFresh ||= new Set()).add(id);
    loadPatient(id).then(() => S.route.name === "expert" && S.route.params.id === id && viewExpert()).catch(() => {}).finally(() => setTimeout(() => S.expertFresh.delete(id), 5000));
  }
  const ta = $("#expert-input");
  const draft = ta ? ta.value : "";
  const hadFocus = document.activeElement === ta;
  renderShell(html`<div class="consult">
    <div class="consult-head">
      <button class="back" data-go="/patient/${p.id}" aria-label="Назад">${ic("back")}</button>
      <div class="tile accent">${ic("chat")}</div>
      <div class="grow">
        <div class="title ellipsis">Обсуждение с экспертом · ИИ</div>
        <div class="tiny muted ellipsis">${p.name}${p.true_diagnosis ? ` · ${p.true_diagnosis}` : ""}</div>
      </div>
    </div>
    <div class="messages" id="messages">
      <div class="msg from-patient"><span class="txt">${evaluated ? `Посмотрел ваш приём (пациент — ${p.name}). Спрашивайте что угодно: почему такая оценка, что упустили, как лечить по КР, с чем спутать. Можно без церемоний.` : "Обсудить приём можно после разбора — завершите приём, и я отвечу на вопросы по нему."}</span></div>
      ${chat.map((m) => html`<div class="msg from-${m.role === "expert" ? "patient" : "doctor"}"><span class="txt">${m.text}</span><div class="meta">${timeText(m.ts)}</div></div>`)}
      ${partial ? html`<div class="msg from-patient revealing"><span class="txt" id="expert-partial">${partial}</span></div>`
        : busy ? html`<div class="typing-wrap"><div class="typing"><i></i><i></i><i></i></div></div>` : ""}
      ${prem && evaluated && !chat.length && !busy ? html`<div class="stack-sm" style="align-self:flex-end;align-items:flex-end">${EXPERT_STARTERS.map((t) => html`<button class="chip multi" data-expert-q="${t}">${t}</button>`)}</div>` : ""}
    </div>
    ${!evaluated ? html`<div class="composer"><a class="btn block" href="#/patient/${p.id}">К карточке пациента</a></div>`
      : prem ? html`<div class="composer" id="composer">
        <textarea id="expert-input" rows="1" placeholder="Спросите эксперта…" maxlength="1500"></textarea>
        <button class="icon-btn send" id="expert-send" aria-label="Отправить" ${busy ? "disabled" : ""}>${ic("send")}</button>
      </div>`
      : html`<div class="composer"><div class="stack-sm" style="width:100%">
        <p class="small muted center">Обсуждение разбора с экспертом — в премиуме, без ограничения по числу вопросов.</p>
        <a class="btn block" href="#/plans" ${S.me.profile.trial_available ? html`data-checkout="trial"` : ""}>${ic("gem")}<span>${S.me.profile.trial_available ? "Премиум 7 дней за 1 ₽" : "Открыть в премиуме"}</span></a></div></div>`}
  </div>`, false);
  const box = $("#messages");
  if (box) box.scrollTop = box.scrollHeight;
  const input = $("#expert-input");
  if (!input) return;
  input.value = draft;
  if (hadFocus) input.focus();
  const send = () => sendExpert(id, input.value);
  $("#expert-send").onclick = send;
  input.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) { e.preventDefault(); send(); } };
  root.querySelectorAll("[data-expert-q]").forEach((b) => (b.onclick = () => sendExpert(id, b.dataset.expertQ)));
}

async function sendExpert(id, text) {
  text = String(text || "").trim();
  const data = S.patients.get(id);
  if (!text || !data || S.expertBusy) return;
  const before = data.patient.expert_chat || [];
  data.patient.expert_chat = [...before, { role: "doctor", text, ts: Date.now() }];
  S.expertBusy = id;
  S.expertPartial = null;
  const input = $("#expert-input");
  if (input) input.value = "";
  haptic();
  viewExpert();
  try {
    const r = await api("POST", `/patients/${encodeURIComponent(id)}/expert`, { text });
    data.patient.expert_chat = r.chat;
  } catch (e) {
    data.patient.expert_chat = before;
    toast(e.message, "error");
    S.expertBusy = null;
    if (S.route.name === "expert" && S.route.params.id === id) {
      viewExpert();
      const ta = $("#expert-input");
      if (ta && !ta.value) ta.value = text;
    }
    return;
  }
  S.expertBusy = null;
  S.expertPartial = null;
  if (S.route.name === "expert" && S.route.params.id === id) viewExpert();
}

/** Ответ эксперта приходит по кусочкам; с другого устройства — просто обновляем чат */
function onExpertSync(msg) {
  const here = S.route.name === "expert" && S.route.params.id === msg.patient_id;
  if (typeof msg.partial === "string") {
    S.expertPartial = { id: msg.patient_id, text: msg.partial };
    const el = $("#expert-partial");
    if (here && el) {
      el.textContent = msg.partial;
      const box = $("#messages");
      if (box) box.scrollTop = box.scrollHeight;
    } else if (here) viewExpert();
    return;
  }
  if (S.expertBusy === msg.patient_id) return; // наш запрос — обновим по ответу
  S.expertPartial = null;
  if (here || S.patients.has(msg.patient_id)) loadPatient(msg.patient_id).then(() => here && S.route.name === "expert" && viewExpert()).catch(() => {});
}

/** Разбор по КР: запрос по кнопке, ожидание, готовый разбор — во всех местах, где он показан (лист завершения, карточка) */
async function requestGuide(id, btn) {
  btnBusy(btn);
  goal("guide_request");
  try {
    const res = await api("POST", `/patients/${id}/guide`);
    if (res.pending) { S.guidePending.add(id); if (!S.guideStart.has(id)) S.guideStart.set(id, res.since || Date.now()); }
    await refreshGuide(id);
  } catch (e) {
    toast(e.message, "error");
    if (document.body.contains(btn)) btnBusy(btn, false);
  }
}
async function refreshGuide(id, error) {
  if (error) { S.guidePending.delete(id); toast(error, "error"); }
  try {
    const { patient } = await loadPatient(id);
    const c = patient.consultations[patient.consultations.length - 1];
    if (c?.guide && S.guidePending.has(id)) {
      S.guidePending.delete(id);
      if (S.guideStart.has(id)) etaRecord("guide", Date.now() - S.guideStart.get(id));
    }
    if (c?.guide) S.guideStart.delete(id);
    document.querySelectorAll(`[data-guide-slot="${id}"]`).forEach((slot) => { slot.innerHTML = c ? guideBlock(c, id, patient.gift_kr)[RAW] : ""; });
    if (c?.guide) haptic("success");
  } catch {}
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-guide-req]");
  if (b) { e.preventDefault(); requestGuide(b.dataset.guideReq, b); }
});
// Если WebSocket молчит — спрашиваем сами
setInterval(() => { if (!S.wsOk) S.guidePending.forEach((id) => refreshGuide(id)); }, 6000);

// ---------------------------------------------------
// Тесты
// ---------------------------------------------------
/** После ответа — плавно к пояснению и кнопке «Далее»: кнопка над нижним меню, начало пояснения не уезжает за верх */
function revealQuizNext() {
  const btn = $("#quiz-next"), card = btn?.previousElementSibling;
  if (!btn) return;
  const nav = document.querySelector(".nav")?.getBoundingClientRect().height || 0;
  const want = btn.getBoundingClientRect().bottom - (window.innerHeight - nav - 16);
  const limit = (card || btn).getBoundingClientRect().top - 80;
  const dy = Math.min(want, limit);
  if (dy > 0) window.scrollBy({ top: dy, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

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
        <b class="row-c">${ic(ans.is_correct ? "checkCircle" : "xCircle", ans.is_correct ? "c-ok" : "c-danger")}${ans.is_correct ? "Верно!" : `Неверно. Правильно: ${q.options[ans.correct]}`}</b>${whyNot(q, ans.chosen, ans.why_chosen)}<div class="quiz-expl" style="margin-top:6px">${ans.explanation || ""}</div></div>
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
        quizState.answer = { chosen: Number(b.dataset.opt), correct: res.correct, is_correct: res.is_correct, explanation: res.explanation, why_chosen: res.why_chosen, done: res.done, res };
      }
    } catch (e) {
      toast(e.message, "error");
    }
    quizState.busy = false;
    viewQuiz();
    if (quizState.answer) revealQuizNext();
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
      ${q.chosen !== q.correct ? html`<div class="small">Правильно: <b>${q.options[q.correct]}</b></div>${whyNot(q, q.chosen, q.why_chosen)}` : ""}
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

/** Ползунок по шагам: метки-точки на дорожке, подпись текущего выбора — под ним */
function stepSlider(id, items, idx) {
  const max = items.length - 1;
  return html`<div class="steps" style="--f:${idx / max}">
      <input type="range" id="${id}" min="0" max="${max}" step="1" value="${idx}" aria-valuetext="${items[idx].label}">
      <div class="steps-ticks">${items.map((_, i) => html`<i class="${i < idx ? "on" : i === idx ? "cur" : ""}" style="--t:${i / max}"></i>`)}</div>
    </div>
    <div class="steps-cap" id="${id}-cap">${stepCap(items[idx])}</div>`;
}
const stepCap = (it) => html`<b>${it.label}</b><span class="small muted">${it.hint || ""}</span>`;
/** Пока тянут — меняем только подпись и заливку; выбор фиксируем, когда отпустили */
function bindStepSlider(id, items, onPick) {
  const el = $(`#${id}`);
  const box = el.parentElement;
  const max = items.length - 1;
  const paint = () => {
    const i = Number(el.value);
    box.style.setProperty("--f", i / max);
    box.querySelectorAll(".steps-ticks i").forEach((t, j) => (t.className = j < i ? "on" : j === i ? "cur" : ""));
    $(`#${id}-cap`).innerHTML = stepCap(items[i])[RAW];
    el.setAttribute("aria-valuetext", items[i].label);
  };
  el.oninput = () => { paint(); haptic(); };
  el.onchange = () => onPick(Number(el.value));
}

/** Специальность выпадающим списком: по алфавиту, «Другая…» — в конце */
function professionSelect(id, value) {
  const names = Object.keys(S.me.config.specializations).sort((a, b) => a.localeCompare(b, "ru"));
  return html`<select id="${id}">${value ? "" : html`<option value="" selected disabled>Выберите специальность</option>`}${names.map((x) => html`<option value="${x}" ${value === x ? "selected" : ""}>${x}</option>`)}<option value="__custom" ${value === "__custom" ? "selected" : ""}>Другая…</option></select>`;
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
  const custom = pf.profession === "__custom";
  // Ползунки «Кто вы» и «Сложность»: подпись текущего выбора — под ползунком
  const diffLabel = (key) => cfg.difficulties.find((d) => d.key === key)?.label || "";
  const levelItems = cfg.levels.map((l) => ({ label: l.label, hint: `по умолчанию сложность «${diffLabel(l.complexity)}» · опыт ×${String(l.xpMult).replace(".", ",")}` }));
  const levelIdx = Math.max(0, cfg.levels.findIndex((l) => l.key === pf.level));
  const diffItems = [
    { label: "По уровню", hint: `сейчас «${diffLabel(cfg.levels[levelIdx]?.complexity)}» — меняется вместе с «Кто вы»` },
    ...cfg.difficulties.map((d) => ({ label: `${d.emoji} ${d.label}`, hint: d.key === "hard" && !p.premium ? `${d.hint} · в премиуме` : d.hint })),
  ];
  const diffIdx = pf.difficulty ? cfg.difficulties.findIndex((d) => d.key === pf.difficulty) + 1 : 0;

  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Настройки</h2></div>

    <div class="card row-c pf-head">
      <button class="pf-ava" id="av-edit" type="button" aria-label="Изменить фото">${userAvatar(p, "xl")}<span class="pf-ava-pen">${ic("pencil")}</span></button>
      <div class="field grow"><label for="pf-name">Имя</label><input class="input" id="pf-name" value="${pf.name}" maxlength="40" autocomplete="given-name"></div>
    </div>

    <div class="section-title">Настройка тренажёра</div>
    <div class="card stack" id="profile-form">
      <div class="field"><label>Кто вы</label>${stepSlider("pf-level", levelItems, levelIdx)}</div>
      <div class="field"><label>Сложность пациентов</label>${stepSlider("pf-diff", diffItems, diffIdx)}</div>
      <div class="field"><label for="pf-prof">Специальность</label>
        ${professionSelect("pf-prof", pf.profession)}
        <input class="input ${custom ? "" : "hidden"}" id="pf-prof-custom" value="${pf.custom}" placeholder="Ваша специальность, например: неонатолог" maxlength="40"></div>
      <div class="field"><label>Разделы, из которых приходят пациенты${custom ? "" : ` · ${pf.profession}`}</label>
        ${pf.suggesting ? html`<div class="small muted row-c"><span class="spin"></span>Подбираем разделы для «${pf.custom}»…</div>` : ""}
        ${!pf.suggesting && pf.options.length ? html`<div class="row wrap" style="gap:6px">${pf.options.map((s) => html`<button class="chip ${pf.specs.has(s) ? "on" : ""}" data-spec="${s}">${s}</button>`)}</div>` : ""}
        ${!pf.suggesting && !pf.options.length ? html`<div class="small muted">${custom ? (pf.custom ? "Добавьте разделы ниже — или сохраните без них: пациенты будут по всей специальности." : "Введите специальность — разделы подберутся автоматически.") : "Добавьте хотя бы один раздел."}</div>` : ""}
        ${inlineForm("pf-spec-add", "Свой раздел, например: желтуха новорождённых", 60, ic("plus"), "btn ghost")}
      </div>
    </div>
    <button class="btn block" id="pf-save">Сохранить</button>

  </div>`);

  $("#pf-name").oninput = (e) => { pf.name = e.target.value; };
  // «По уровню» зависит от «Кто вы» — после выбора уровня перерисовываем
  bindStepSlider("pf-level", levelItems, (i) => { pf.level = cfg.levels[i].key; viewSettings(); });
  bindStepSlider("pf-diff", diffItems, (i) => {
    const d = cfg.difficulties[i - 1];
    if (d?.key === "hard" && !p.premium) { toast("«Очень сложные» случаи — в премиуме"); return go("/plans"); }
    pf.difficulty = d?.key || "";
  });
  $("#av-edit").onclick = () => openSheet(html`<h2>Фото профиля</h2>
    <div class="stack-sm" style="margin-top:12px">
      <label class="btn ghost block file-btn">${ic("camera")}<span>Загрузить фото</span><input type="file" accept="image/*" id="av-file" hidden></label>
      <button class="btn ghost block" id="av-tg" type="button">${ic("telegram")}<span>Взять из Telegram</span></button>
      ${p.avatar ? html`<button class="btn danger block" id="av-del" type="button">${ic("trash")}<span>Убрать фото</span></button>` : ""}
    </div>`, bindAvatar);
  $("#pf-prof").onchange = (e) => {
    if (e.target.value !== "__custom") return pickProfession(e.target.value);
    pf.profession = "__custom";
    pf.options = [];
    pf.specs = new Set();
    viewSettings();
    $("#pf-prof-custom").focus();
    if (pf.custom) suggestSections(pf.custom);
  };
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
        name: pf.name, level: pf.level, difficulty: pf.difficulty, profession, specializations: specs,
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
      const r = await fetch(`${API_BASE}/api/avatar`, { method: "POST", headers: { Authorization: `Bearer ${S.token}`, "Content-Type": blob.type, "X-Client": IN_TG ? "miniapp" : "web" }, body: blob });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Не удалось загрузить фото");
      S.me.profile = data.profile;
      haptic("success");
      toast("Фото обновлено", "ok");
      closeSheet();
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
      closeSheet();
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
      closeSheet();
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

/** Фото документа: уменьшаем до max px по длинной стороне, JPEG — чтобы быстро загрузилось и читалось */
async function fitImage(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Не удалось открыть картинку")); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
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
    <div class="hello">${userAvatar(p, "lg")}<div class="grow"><h1 class="ellipsis">Врач ${p.name}</h1><div class="small muted">${p.username ? "@" + p.username : /^\d+$/.test(p.uid) ? "Telegram ID " + p.uid : "Аккаунт сайта"}</div>
      <div class="small muted">${p.level_label} · ${p.profession} · уровень ${p.level_info.level}</div></div></div>
    <div class="menu card">
      ${item({ a: 'href="#/plans"' }, "accent", "gem", sub ? "Подписка" : "Премиум", sub ? `Активна ${sub}` : p.trial_available ? "7 дней за 1 ₽" : "Безлимит и разбор по КР")}
      ${item({ a: 'href="#/profile/stats"' }, "ok", "chart", "Статистика", `${p.stats.consultations_total || 0} ${plural(p.stats.consultations_total || 0, "приём", "приёма", "приёмов")}${p.stats.ratings_count ? ` · ★ ${dec(p.stats.avg_rating.toFixed(1))}` : ""}`)}
      ${item({ a: 'href="#/battles"' }, "warn", "swords", "Кто круче?", "Битва с другом на одном пациенте")}
      ${item({ a: 'href="#/profile/settings"' }, "", "settings", "Настройки", "Профиль и сложность")}
      ${item({ a: 'href="#/partner"' }, "ok", "handshake", "Партнёрская программа", p.partner ? "50% с оплат приглашённых" : "До 30% с оплат друзей")}
      ${item({ a: 'href="#/profile/app"' }, "accent", "phone", "Приложение на телефон", IN_TG ? "iPhone и Android" : pushLabel(true))}
      ${item({ a: 'href="#/profile/accounts"' }, "", "key", "Способы входа", /^\d+$/.test(p.uid) ? "Telegram, Яндекс, Google" : "Привязать Telegram")}
      ${item({ tag: "button", a: 'id="feedback-open" type="button"' }, "warn", "star", "Оставить отзыв", "Что улучшить")}
      ${item({ a: `href="https://t.me/${S.me.bot_username || "helpmedoctor_aibot"}" target="_blank" rel="noopener"` }, "accent", "telegram", "Бот в Telegram", "Приёмы в чате", ic("external", "c-muted"))}
      ${item({ a: 'href="https://t.me/oleg_ezhkov" target="_blank" rel="noopener"' }, "", "telegram", "Поддержка", "@oleg_ezhkov", ic("external", "c-muted"))}
      ${item({ a: `href="${DOCS.offer}" target="_blank" rel="noopener"` }, "", "book", "Документы", "Оферта и политика", ic("external", "c-muted"))}
      ${!IN_TG ? item({ tag: "button", a: 'id="logout" type="button"', cls: "danger" }, "", "logout", "Выйти", "") : ""}
    </div>
  </div>`);
  $("#feedback-open").onclick = () => sheetFeedback();
  const lo = $("#logout");
  if (lo) lo.onclick = async () => { if (await confirmDialog("Выйти?", "На этом устройстве нужно будет войти снова.", "Выйти")) logout(); };
}

// ---------- Согласие на cookie (общая с сайтом настройка hmd_cookies; в Telegram не показываем) ----------
function cookieBar() {
  try { if (localStorage.getItem("hmd_cookies")) return; } catch { return; }
  const bar = document.createElement("div");
  bar.className = "cookie";
  bar.innerHTML = `<p>Мы используем cookie и Яндекс Метрику, чтобы приложение работало и становилось удобнее. Продолжая, вы соглашаетесь с <a href="${DOCS.privacy}" target="_blank" rel="noopener">политикой обработки данных</a>.</p><button type="button" class="btn sm">Хорошо</button>`;
  bar.querySelector("button").onclick = () => { try { localStorage.setItem("hmd_cookies", "1"); } catch {} bar.remove(); goal("cookie_ok"); };
  document.body.append(bar);
}

// ---------- Приложение на телефоне и уведомления в браузере ----------
const PLATFORM = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : /Android/i.test(navigator.userAgent) ? "android" : "desktop";
const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let swReg = null;
let installPrompt = null; // событие beforeinstallprompt (Chrome, Яндекс, Edge на Android и компьютере)
let pushSub = null;
let pushBusy = false;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; if (S.route?.name === "install") rerender(); });

function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").then(async (reg) => {
    swReg = reg;
    pushSub = await reg.pushManager?.getSubscription().catch(() => null) || null;
    if (S.route?.name === "install" || S.route?.name === "profile") rerender();
  }).catch((e) => console.warn("sw", e));
}
function pushLabel(short = false) {
  if (pushSub && Notification.permission === "granted") return short ? "Уведомления включены" : "Уведомления включены на этом устройстве";
  if (short) return PLATFORM === "ios" && !STANDALONE ? "На экран «Домой»" : "Установка и уведомления";
  return PLATFORM === "ios" && !STANDALONE ? "Установите на экран «Домой» и включите уведомления" : "Установка и уведомления о пациентах";
}
function b64uToBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function pushEnable() {
  if (pushBusy) return;
  pushBusy = true; rerender();
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast(perm === "denied" ? "Уведомления запрещены в настройках браузера" : "Уведомления не включены", "error");
      return;
    }
    const reg = swReg || (await navigator.serviceWorker.ready);
    const { key } = await api("GET", "/push/key");
    let sub = await reg.pushManager.getSubscription();
    // Подписка на старый ключ сервера — пересоздаём
    if (sub && sub.options?.applicationServerKey && btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") !== key) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
    await api("POST", "/push/subscribe", { subscription: sub.toJSON() });
    pushSub = sub;
    goal("push_on", { platform: PLATFORM, standalone: STANDALONE });
    await api("POST", "/push/test").catch(() => {});
    toast("Уведомления включены");
  } catch (e) {
    toast(e.message || "Не удалось включить уведомления", "error");
  } finally {
    pushBusy = false; rerender();
  }
}
async function pushDisable() {
  if (!pushSub) return;
  pushBusy = true; rerender();
  try {
    await api("POST", "/push/unsubscribe", { endpoint: pushSub.endpoint }).catch(() => {});
    await pushSub.unsubscribe().catch(() => {});
    pushSub = null;
    goal("push_off");
    toast("Уведомления на этом устройстве выключены");
  } finally {
    pushBusy = false; rerender();
  }
}

function pushCard() {
  if (IN_TG) return "";
  const head = html`<div class="row"><div class="tile accent">${ic("bell")}</div><div class="grow"><b>Уведомления в браузере</b><div class="small muted">Пациент готов, разбор готов, серия скоро сгорит</div></div></div>`;
  let body;
  if (PLATFORM === "ios" && !STANDALONE) {
    body = html`<p class="small muted">На iPhone уведомления работают только в установленном приложении (iOS 16.4 и новее). Добавьте его на экран «Домой» по инструкции ниже, откройте с иконки и включите уведомления здесь.</p>`;
  } else if (!PUSH_OK) {
    body = html`<p class="small muted">Этот браузер не поддерживает уведомления. Откройте приложение в Chrome, Яндекс Браузере или Safari.</p>`;
  } else if (Notification.permission === "denied") {
    body = html`<p class="small muted">Уведомления запрещены для сайта. Разрешите их в настройках браузера (значок замка у адреса → Уведомления) и вернитесь сюда.</p>`;
  } else if (pushSub && Notification.permission === "granted") {
    body = html`<div class="row between"><span class="badge ok">${ic("check")} Включены на этом устройстве</span><button class="btn ghost sm" id="push-off" ${pushBusy ? "disabled" : ""}>Выключить</button></div>`;
  } else {
    body = html`<button class="btn primary block" id="push-on" ${pushBusy ? "disabled" : ""}>${ic("bell")} ${pushBusy ? "Включаем…" : "Включить уведомления"}</button>`;
  }
  return html`<div class="card stack">${head}${body}</div>`;
}

function installSteps(kind) {
  const step = (n, text) => html`<li><span class="num">${n}</span><div>${text}</div></li>`;
  if (kind === "ios") {
    return html`<ol class="steps-list">
      ${step(1, html`Откройте <b>helpmedoctor.ru/app</b> в <b>Safari</b> (в других браузерах на iPhone кнопки может не быть).`)}
      ${step(2, html`Нажмите <b>«Поделиться»</b> ${ic("share", "inline-i")} внизу экрана (на iPad — вверху).`)}
      ${step(3, html`Прокрутите список и выберите <b>«На экран „Домой“»</b>, затем <b>«Добавить»</b>.`)}
      ${step(4, html`Откройте Help me, Doctor <b>с иконки</b> и один раз войдите — приложение хранит вход отдельно от Safari.`)}
      ${step(5, html`Здесь же, в профиле → «Приложение на телефон», включите уведомления.`)}
    </ol>`;
  }
  return html`<ol class="steps-list">
    ${step(1, html`Откройте <b>helpmedoctor.ru/app</b> в <b>Chrome</b> или <b>Яндекс Браузере</b>.`)}
    ${step(2, html`Нажмите меню ${ic("dots", "inline-i")} справа вверху (в Яндекс Браузере — внизу).`)}
    ${step(3, html`Выберите <b>«Установить приложение»</b> или <b>«Добавить на главный экран»</b>.`)}
    ${step(4, html`Иконка появится на главном экране и в списке приложений. Уведомления включите кнопкой выше.`)}
  </ol>`;
}

function viewInstall() {
  const other = PLATFORM === "ios" ? "android" : "ios";
  const first = PLATFORM === "desktop" ? "ios" : PLATFORM;
  const names = { ios: "iPhone и iPad", android: "Android" };
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Приложение на телефон</h2></div>
    <p class="small muted">Help me, Doctor можно поставить на телефон как обычное приложение: иконка на экране, открывается без адресной строки, приходят уведомления. Ничего скачивать из магазина не нужно.</p>
    ${IN_TG ? html`<div class="card stack"><p class="small">Вы сейчас в Telegram. Чтобы установить приложение, откройте его в браузере телефона.</p><button class="btn primary block" data-open-site>${ic("external")} Открыть в браузере</button></div>` : ""}
    ${STANDALONE ? html`<div class="card row"><div class="tile ok">${ic("checkCircle")}</div><div class="grow"><b>Приложение уже установлено</b><div class="small muted">Вы открыли его с иконки на экране</div></div></div>` : ""}
    ${!STANDALONE && installPrompt ? html`<button class="btn primary block" id="install-now">${ic("phone")} Установить приложение</button>` : ""}
    ${pushCard()}
    <div class="card stack"><b class="row-c">${ic("phone", "c-accent")}${names[first]}</b>${installSteps(first)}</div>
    ${PLATFORM === "desktop" ? html`<div class="card stack"><b class="row-c">${ic("phone", "c-accent")}${names.android}</b>${installSteps("android")}</div>`
      : html`<details class="card"><summary><b>${names[other]}</b></summary>${installSteps(other)}</details>`}
  </div>`);
  const on = $("#push-on"); if (on) on.onclick = pushEnable;
  const off = $("#push-off"); if (off) off.onclick = pushDisable;
  const inst = $("#install-now");
  if (inst) inst.onclick = async () => {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice.catch(() => ({}));
    goal("pwa_install", { outcome });
    installPrompt = null;
    rerender();
  };
}

// ---------- Партнёрская программа ----------
let partnerData = null;
const pct = (r) => `${Math.round(Number(r) * 100)}%`;
const REF_STATUS = { joined: ["Зарегистрировался", ""], active: ["Принимает пациентов", "accent"], paid: ["Оплатил", "ok"] };
function inviteTexts(link) {
  return [
    ["В чат группы", `Ребят, нашла тренажёр, где можно принимать ИИ-пациентов: расспрашиваешь, назначаешь анализы, ставишь диагноз — и сразу разбор по клиническим рекомендациям Минздрава. Два пациента в день бесплатно. Попробуйте: ${link}`],
    ["Перед аккредитацией", `Кто готовится к станциям по сбору анамнеза и клиническому мышлению — тут можно тренироваться на пациентах с характером, и сразу видно, что упустил: ${link}`],
    ["Коротко в сторис", `Поставила диагноз ИИ-пациенту и получила разбор по КР 🩺 А вы бы справились? ${link}`],
  ];
}
async function copyText(text, okMsg = "Скопировано") {
  try { await navigator.clipboard.writeText(text); toast(okMsg, "ok"); haptic("success"); }
  catch { prompt("Скопируйте:", text); }
}
// ---------------------------------------------------
// «Кто круче?» — битва двух врачей на одном пациенте
// ---------------------------------------------------
let battlesData = null;
const battleCache = new Map();
const BATTLE_STATUS = { waiting: ["ждём", "warn"], ready: ["выбор", "accent"], draft: ["выбор", "accent"], preparing: ["готовим", "accent"], active: ["идёт", "accent"], finished: ["итог", ""], cancelled: ["отменена", ""], failed: ["ошибка", "danger"] };
const DIFF_LIST = [
  { key: "easy", label: "Лёгкая", emoji: "🟢", hint: "типичная картина" },
  { key: "medium", label: "Средняя", emoji: "🟡", hint: "отвлекающий симптом" },
  { key: "medium_hard", label: "Сложная", emoji: "🟠", hint: "два похожих диагноза" },
  { key: "hard", label: "Очень сложная", emoji: "🔴", hint: "редкая патология" },
];
const diffLabel = (k) => DIFF_LIST.find((x) => x.key === k)?.label || "";
/** Итог битвы уже известен (тогда разбор приёма открыт). Не знаем — спрашиваем и перерисовываем карточку */
const battleFetching = new Set();
function battleRevealed(id) {
  const b = battleCache.get(id);
  if (b) return ["finished", "cancelled"].includes(b.status);
  if (!battleFetching.has(id)) {
    battleFetching.add(id);
    api("GET", `/battles/${id}`).then((x) => {
      battleCache.set(id, x);
      if (S.route.name === "patient" && S.patients.get(S.route.params.id)?.patient?.battle?.id === id) viewPatient();
    }).catch(() => {}).finally(() => battleFetching.delete(id));
  }
  return false;
}
const msText = (ms) => { const s = Math.round((Number(ms) || 0) / 1000); if (!s) return "—"; const m = Math.floor(s / 60); return m ? `${m} мин ${String(s % 60).padStart(2, "0")} с` : `${s} с`; };
const battleShareText = "Вызываю тебя на битву «Кто круче?» в Help me, Doctor: один ИИ-пациент на двоих — кто поставит диагноз лучше?";

function battleRules() {
  return html`<div class="small fact">${ic("check", "c-ok")}<span>По очереди вычёркиваете профессии — по последней будет пациент</span></div>
    <div class="small fact">${ic("check", "c-ok")}<span>Пациент один на двоих, каждый принимает его сам</span></div>
    <div class="small fact">${ic("trophy", "c-warn")}<span>Побеждает оценка эксперта выше, при равной — кто быстрее</span></div>
    <div class="small fact">${ic("gem", "c-accent")}<span>Пациент битвы не тратит бесплатный лимит</span></div>`;
}

async function newBattle(btn, rematchOf = null) {
  if (btn) btnBusy(btn);
  try {
    const b = await api("POST", "/battles", rematchOf ? { rematch_of: rematchOf } : {});
    battleCache.set(b.id, b);
    battlesData = null;
    goal(rematchOf ? "battle_rematch" : "battle_create");
    go(`/battle/${b.id}`);
  } catch (e) {
    toast(e.message, "error");
    if (btn) btnBusy(btn, false);
  }
}

async function viewBattles(fresh) {
  const head = html`<div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Кто круче?</h2></div>`;
  if (fresh || !battlesData) {
    if (!battlesData) renderShell(html`<div class="page">${head}<div class="skeleton" style="height:200px"></div><div class="skeleton"></div></div>`);
    try {
      battlesData = await api("GET", "/battles");
    } catch (e) {
      renderShell(html`<div class="page">${head}<div class="card center small muted">${e.message}</div></div>`);
      return;
    }
    if (S.route.name !== "battles") return;
  }
  const d = battlesData;
  const sc = d.score;
  const played = sc.wins + sc.losses + sc.draws;
  renderShell(html`<div class="page">
    ${head}
    <div class="card stack battle-hero">
      <div class="row-c"><div class="tile warn">${ic("swords")}</div><div class="grow"><b>Битва с другом на одном пациенте</b><div class="small muted">Покажите QR-код или отправьте ссылку</div></div></div>
      ${battleRules()}
      <button class="btn block lg" id="battle-new">${ic("swords")}<span>Новая битва</span></button>
    </div>
    ${played ? html`<div class="ref-kpis battle-score">
      <div><b class="c-ok">${sc.wins}</b><span>${plural(sc.wins, "победа", "победы", "побед")}</span></div>
      <div><b class="c-danger">${sc.losses}</b><span>${plural(sc.losses, "поражение", "поражения", "поражений")}</span></div>
      <div><b>${sc.draws}</b><span>${plural(sc.draws, "ничья", "ничьи", "ничьих")}</span></div>
    </div>` : ""}
    ${d.battles.length ? html`<div class="section-title">Мои битвы</div>
    <div class="card ref-list">${d.battles.map((b) => {
      const st = b.status === "finished" ? (b.winner === "me" ? ["победа", "ok"] : b.winner === "draw" ? ["ничья", ""] : ["поражение", "danger"])
        : b.status === "waiting" && b.role === "invitee" ? ["вызов вам", "warn"] : BATTLE_STATUS[b.status] || [b.status, ""];
      const prof = b.patient?.profession || b.draft?.pick || "";
      return html`<a class="ref-row tap battle-row" href="#/battle/${b.id}">
        <div class="grow battle-row-main"><b class="ellipsis">${b.opponent ? b.opponent.name : "Без соперника"}</b>
          <div class="tiny muted ellipsis">${shortDate(b.created_at)}${prof ? ` · ${prof}` : ""}</div></div>
        <div class="ref-sum">${b.status === "finished" && b.me?.result ? html`<b class="tiny">${dec(Number(b.me.result.rating).toFixed(1))} : ${b.opponent?.result ? dec(Number(b.opponent.result.rating).toFixed(1)) : "—"}</b>` : ""}<span class="badge ${st[1]}">${st[0]}</span></div>
      </a>`;
    })}</div>` : html`<div class="card center stack-sm"><div class="tile warn lg">${ic("trophy")}</div><b>Пока ни одной битвы</b><p class="small muted">Создайте битву и покажите однокурснику QR-код — посмотрим, кто круче.</p></div>`}
  </div>`);
  $("#battle-new").onclick = (e) => newBattle(e.currentTarget);
}

async function viewBattle(fresh) {
  const id = S.route.params.id;
  const head = html`<div class="page-head"><button class="back" data-go="/battles" aria-label="Назад">${ic("back")}</button><h2 class="grow">Кто круче?</h2></div>`;
  let b = battleCache.get(id);
  if (fresh || !b) {
    if (!b) renderShell(html`<div class="page">${head}<div class="skeleton" style="height:260px"></div></div>`);
    try {
      b = await api("GET", `/battles/${id}`);
      // Пришли по ссылке-вызову — сразу подключаемся
      if (b.status === "waiting" && (!b.role || b.role === "invitee")) {
        b = await api("POST", `/battles/${id}/join`);
        goal("battle_join");
        haptic("success");
      }
    } catch (e) {
      renderShell(html`<div class="page">${head}<div class="card center stack-sm"><div class="tile danger lg">${ic("swords")}</div><b>${e.message}</b><button class="btn" id="battle-new">${ic("swords")}<span>Создать свою битву</span></button></div></div>`);
      const nb = $("#battle-new");
      if (nb) nb.onclick = (ev) => newBattle(ev.currentTarget);
      return;
    }
    battleCache.set(id, b);
    if (S.route.name !== "battle" || S.route.params.id !== id) return;
  }
  const isOwner = b.role === "owner";
  const op = b.opponent;
  const me = b.me;
  // В подсказках — только имя: «Константин Константинопольский» ломает строки
  const opName = String(op?.name || "").split(/\s+/)[0] || "Соперник";
  const versus = html`<div class="vs">
    <div class="vs-side">${userAvatar(S.me.profile)}<b class="ellipsis">Вы</b></div>
    <div class="vs-mid">${ic("swords")}</div>
    <div class="vs-side">${op && (b.status !== "waiting" || !isOwner) ? html`<div class="avatar">${initials(op.name)}</div><b class="ellipsis">${op.name}</b>` : html`<div class="avatar vs-wait">?</div><b class="muted">ждём</b>`}</div>
  </div>`;
  let body = "";
  if (b.status === "waiting" && isOwner) {
    const link = IN_TG ? b.links.bot : b.links.site;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(battleShareText)}`;
    body = html`<div class="card stack center battle-wait">
        <b>${op ? `Ждём, когда ${op.name} примет реванш` : "Покажите QR-код сопернику"}</b>
        <img class="qr" src="${API_BASE}/api/qr?d=${encodeURIComponent(b.links.site)}" alt="QR-код битвы" width="220" height="220">
        <p class="small muted">${op ? "Мы отправили ему приглашение. Можно поторопить ссылкой:" : "Он наводит камеру — и сразу попадает в битву. Или отправьте ссылку:"}</p>
        <div class="ref-link"><span class="ellipsis">${link.replace(/^https?:\/\//, "")}</span><button class="btn sm" data-copy="${link}">${ic("copy")}<span>Копировать</span></button></div>
        <div class="ref-share">
          ${navigator.share ? html`<button class="btn ghost sm" id="battle-share">${ic("share")}<span>Поделиться</span></button>` : ""}
          <a class="btn ghost sm" href="${shareUrl}" target="_blank" rel="noopener">${ic("telegram")}<span>Telegram</span></a>
        </div>
        <div class="row-c small muted wait-pulse"><span class="pulse"></span>Ждём подключения — придёт уведомление</div>
      </div>
      <button class="btn ghost block" id="battle-cancel">Отменить битву</button>`;
  } else if (b.status === "waiting") {
    body = html`<div class="card center stack-sm"><b>Подключаемся к битве…</b></div>`;
  } else if (b.status === "draft" && b.draft && !b.draft.pick) {
    const d = b.draft;
    const myTurn = d.turn === "me";
    body = html`<div class="card stack battle-draft">
        <div class="center"><b>${myTurn ? "Ваш ход: вычеркните профессию" : html`<span class="row-c" style="justify-content:center"><span class="pulse"></span>Ход: ${opName}</span>`}</b>
          <div class="small muted">По очереди — пока не останется одна. По ней будет пациент.</div></div>
        <div class="stack-sm">${d.options.map((name) => {
          const ban = d.banned.find((x) => x.name === name);
          return html`<button class="draft-opt ${ban ? "out" : ""}" ${ban || !myTurn ? "disabled" : ""} data-ban="${name}">
            <span class="grow">${name}</span>${ban ? html`<span class="tiny muted">${ban.by === "me" ? "вы" : op?.name || "соперник"}</span>` : myTurn ? ic("x", "c-muted") : ""}</button>`;
        })}</div>
      </div>
      <button class="btn ghost block" id="battle-cancel">Отменить битву</button>`;
  } else if (b.status === "draft" && b.draft?.pick) {
    const d = b.draft;
    body = html`<div class="card stack center battle-draft">
        <div class="tiny muted">ПРОФЕССИЯ</div><h2 class="battle-pick">${d.pick}</h2>
        ${d.level_by === "me" ? html`<b>Выберите сложность</b>
          <div class="stack-sm" style="text-align:left">${DIFF_LIST.map((x) => html`<button class="draft-opt" data-level="${x.key}"><span>${x.emoji}</span><span class="grow"><b>${x.label}</b><span class="tiny muted"> · ${x.hint}</span></span></button>`)}</div>`
          : html`<div class="row-c small muted" style="justify-content:center"><span class="pulse"></span>${opName} выбирает сложность</div>`}
      </div>`;
  } else if (b.status === "preparing") {
    body = html`<div class="card stack center"><b>Создаём пациента</b>
      <div class="small muted">${b.draft?.pick || ""}${b.draft?.level ? ` · ${diffLabel(b.draft.level)}` : ""}</div>${etaBox("patient", b.joined_at || Date.now())}</div>`;
  } else if (b.status === "active") {
    const p = b.patient;
    const mp = S.me?.patients?.find((x) => x.id === me.patient_id);
    const myDone = !!me.result || mp?.status === "closed";
    body = myDone
      ? html`<div class="card stack center battle-waiting">
          <div class="battle-waiting-ic">${ic("swords")}</div>
          <h2>${op?.done ? "Подводим итог…" : "Ждём соперника"}</h2>
          <p class="small muted">${op?.done ? "Оба закончили — сравниваем результаты" : `Ваш приём завершён. Итог откроется, когда ${opName} закончит.`}</p>
          <div class="row-c small muted" style="justify-content:center"><span class="pulse"></span>${op?.done ? "Эксперт сверяет приёмы" : `${opName} ещё на приёме`}</div>
        </div>`
      : html`<div class="card stack">
          <div class="tiny muted">${[p.profession, diffLabel(b.draft?.level)].filter(Boolean).join(" · ").toUpperCase()}</div>
          <div class="row-c">${patAvatar({ id: me.patient_id, name: p.name, sex: p.sex, age: p.age })}<div class="grow"><b>${p.name}, ${p.age}</b><div class="small muted">«${p.chief_complaint}»</div></div></div>
          <button class="btn block lg" data-start="${me.patient_id}">${ic(IN_TG ? "chat" : "play")}<span>Начать приём</span></button>
          <div class="small muted row-c">${op?.done ? html`${ic("check", "c-ok")}${opName} уже закончил` : html`<span class="pulse"></span>${opName} на приёме`}</div>
        </div>`;
  } else if (b.status === "finished") {
    const mr = me.result;
    const orr = op?.result;
    const row = (label, a, c, better) => html`<tr><td class="muted">${label}</td><td class="${better === "me" ? "win" : ""}">${a}</td><td class="${better === "op" ? "win" : ""}">${c}</td></tr>`;
    const cmp = (a, c, higher = true) => (a == null || c == null || a === c ? null : (higher ? a > c : a < c) ? "me" : "op");
    const corr = (r) => (!r ? "—" : r.correct === "yes" ? "верный" : r.correct === "partial" ? "частично" : r.correct === "none" ? "нет" : "неверный");
    body = html`<div class="card stack center battle-result ${b.winner}">
        <div class="tile ${b.winner === "me" ? "ok" : b.winner === "draw" ? "accent" : "danger"} lg">${ic(b.winner === "me" ? "trophy" : b.winner === "draw" ? "handshake" : "swords")}</div>
        <h2>${b.winner === "me" ? "Вы победили!" : b.winner === "draw" ? "Ничья!" : "Победа за соперником"}</h2>
        <div class="battle-score-big">${mr ? dec(Number(mr.rating).toFixed(1)) : "—"} <span class="muted">:</span> ${orr ? dec(Number(orr.rating).toFixed(1)) : "—"}</div>
        <p class="small muted">Диагноз: <b>${b.patient?.true_diagnosis || "—"}</b></p>
        ${b.next_id && !b.next_mine ? html`<div class="badge warn">${ic("swords")} ${opName} зовёт на реванш</div>` : ""}
      </div>
      <div class="card"><table class="battle-table">
        <thead><tr><th></th><th>Вы</th><th class="ellipsis">${opName}</th></tr></thead>
        <tbody>
          ${row("Оценка", mr ? dec(Number(mr.rating).toFixed(1)) : "—", orr ? dec(Number(orr.rating).toFixed(1)) : "—", cmp(mr?.rating, orr?.rating))}
          ${row("Диагноз", corr(mr), corr(orr), null)}
          ${row("Время", mr ? msText(mr.ms) : "—", orr ? msText(orr.ms) : "—", mr && orr && Math.abs(mr.ms - orr.ms) >= 5000 ? cmp(mr.ms, orr.ms, false) : null)}
          ${row("Вопросов", mr?.questions ?? "—", orr?.questions ?? "—", null)}
          ${row("Обследований", mr?.tests ?? "—", orr?.tests ?? "—", null)}
          ${row("Подсказок", mr?.hints ?? "—", orr?.hints ?? "—", cmp(mr?.hints, orr?.hints, false))}
        </tbody></table></div>
      <div class="grid-2">
        <button class="btn" id="battle-rematch">${ic("repeat")}<span>${!b.next_id ? "Реванш" : b.next_mine ? "К реваншу" : "Принять реванш"}</span></button>
        <button class="btn ghost" id="battle-new">${ic("swords")}<span>Новая битва</span></button>
      </div>
      ${me.patient_id ? html`<a class="card tap row" href="#/patient/${me.patient_id}" style="text-decoration:none;color:inherit">
        <div class="tile accent">${ic("card")}</div><div class="grow"><b>Мой разбор от эксперта</b><div class="small muted">Оценка по шагам, КР Минздрава, чат с экспертом</div></div>${ic("chevron", "c-muted")}</a>` : ""}`;
  } else {
    body = html`<div class="card center stack-sm"><b>Битва отменена</b><button class="btn" id="battle-new">${ic("swords")}<span>Новая битва</span></button></div>`;
  }
  renderShell(html`<div class="page">${head}${versus}${body}</div>`);
  document.querySelectorAll("[data-copy]").forEach((el) => { el.onclick = () => { copyText(el.dataset.copy, "Ссылка скопирована"); goal("battle_copy"); }; });
  const sh = $("#battle-share");
  if (sh) sh.onclick = () => { navigator.share({ title: "Кто круче?", text: battleShareText, url: IN_TG ? b.links.bot : b.links.site }).catch(() => {}); goal("battle_share"); };
  const cn = $("#battle-cancel");
  if (cn) cn.onclick = async () => {
    if (!(await confirmDialog("Отменить битву?", "Ссылка и QR-код перестанут работать.", "Отменить"))) return;
    try { await api("POST", `/battles/${id}/cancel`); battleCache.delete(id); battlesData = null; go("/battles"); } catch (e) { toast(e.message, "error"); }
  };
  document.querySelectorAll("[data-ban]").forEach((el) => (el.onclick = async () => {
    document.querySelectorAll("[data-ban]").forEach((x) => (x.disabled = true));
    el.classList.add("out");
    haptic();
    try { battleCache.set(id, await api("POST", `/battles/${id}/ban`, { name: el.dataset.ban })); } catch (e) { toast(e.message, "error"); battleCache.delete(id); }
    viewBattle(!battleCache.has(id));
  }));
  document.querySelectorAll("[data-level]").forEach((el) => (el.onclick = async () => {
    btnBusy(el);
    try { battleCache.set(id, await api("POST", `/battles/${id}/level`, { level: el.dataset.level })); goal("battle_start"); } catch (e) { toast(e.message, "error"); battleCache.delete(id); }
    viewBattle(!battleCache.has(id));
  }));
  const rm = $("#battle-rematch");
  if (rm) rm.onclick = (e) => (b.next_id ? go(`/battle/${b.next_id}`) : newBattle(e.currentTarget, id));
  const nb = $("#battle-new");
  if (nb) nb.onclick = (e) => newBattle(e.currentTarget);
}

const BATTLE_TOASTS = { joined: "Соперник в битве — ваш ход", started: "Пациент готов — битва началась", opponent_done: "Соперник закончил приём", finished: "Итог битвы готов", rematch: "Вас зовут на реванш", failed: "Пациент не создался — выберите сложность ещё раз" };

function onBattleSync(msg) {
  battlesData = null;
  battleCache.delete(msg.battle_id);
  if (msg.rematch_of) battleCache.delete(msg.rematch_of);
  const here = S.route.name === "battle" && [msg.battle_id, msg.rematch_of].includes(S.route.params.id);
  if (msg.kind === "started") scheduleRefresh(0);
  if (here) {
    if (["joined", "started", "finished"].includes(msg.kind)) haptic("success");
    viewBattle(true);
    return;
  }
  if (S.route.name === "battles") viewBattles(true);
  const t = BATTLE_TOASTS[msg.kind];
  if (t) toast(t, "ok");
}

async function viewPartner(fresh) {
  const head = html`<div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Партнёрская программа</h2></div>`;
  if (fresh || !partnerData) {
    if (!partnerData) renderShell(html`<div class="page">${head}<div class="skeleton" style="height:200px"></div><div class="skeleton"></div></div>`);
    try {
      partnerData = await api("GET", "/partner");
    } catch (e) {
      renderShell(html`<div class="page">${head}<div class="card center small muted">${e.message}</div></div>`);
      return;
    }
    if (S.route.name !== "partner") return;
  }
  const d = partnerData;
  const isPartner = d.partner?.status === "active";
  const link = IN_TG ? d.links.bot : d.links.site;
  const b = d.balance;
  const shareText = "Тренажёр врача: ИИ-пациенты, анализы, диагноз и разбор по клиническим рекомендациям Минздрава. Попробуй:";
  // У Instagram нет ссылки «поделиться» — кнопка копирует текст со ссылкой и открывает приложение
  const shareLinks = [
    ["telegram", "Telegram", `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`],
    ["vk", "ВКонтакте", `https://vk.com/share.php?url=${encodeURIComponent(link)}`],
    ["instagram", "Instagram", "https://www.instagram.com/", 'id="ref-ig"'],
  ];
  const canWithdraw = b.available >= d.min_payout && !b.requested;
  // Пока никого не пригласили: вместо нулевой статистики — советы сразу под балансом, предложение стать партнёром — в самом низу
  const noRefs = !d.counts.invited;
  const hasStats = d.counts.invited || d.counts.active || d.counts.paying || b.earned;
  const partner = partnerBlock(d);
  const tips = html`<div class="card stack-sm">
      <b class="row-c">${ic("bulb", "c-warn")}Как приглашать, чтобы работало</b>
      <div class="small fact">${ic("check", "c-ok")}<span>Сначала примите 2–3 пациентов сами — рассказывать своими словами проще и честнее.</span></div>
      <div class="small fact">${ic("check", "c-ok")}<span>Лучшие места: чат группы и потока, сторис, староста; лучшее время — перед сессией, аккредитацией и практикой.</span></div>
      <div class="small fact">${ic("check", "c-ok")}<span>Показывайте, а не рекламируйте: скриншот своего разбора с оценкой работает лучше любого текста.</span></div>
      <div class="small fact">${ic("xCircle", "c-danger")}<span>Без спама в чужих чатах, обещаний «сдашь аккредитацию» и регистрации самого себя — начисления за такое аннулируются.</span></div>
      <a class="more-link" href="/partneram/" target="_blank" rel="noopener">Все подсказки и правила ${ic("chevron")}</a>
    </div>`;
  renderShell(html`<div class="page">
    ${head}

    <div class="card stack ref-hero">
      <div class="row-c"><div class="tile ok">${ic("handshake")}</div><div class="grow">
        ${isPartner ? html`<span class="badge ok">${ic("check")} Партнёр · ${pct(d.partner.rate || d.rates.partner)} с каждой оплаты</span>`
          : html`<b>Приглашайте коллег — получайте деньги</b>`}
      </div></div>
      <p class="small">${isPartner
        ? html`Вы получаете <b>${pct(d.partner.rate || d.rates.partner)}</b> с каждой оплаты тех, кто пришёл по вашей ссылке, — навсегда. Доступ к тренажёру у вас бессрочный.`
        : html`<b>${pct(d.rates.first)}</b> с первой оплаты каждого приглашённого и <b>${pct(d.rates.next)}</b> со всех следующих. Человек закрепляется за вами навсегда.`}</p>
      <div class="ref-link"><span class="ellipsis">${link.replace(/^https?:\/\//, "")}</span><button class="btn sm" data-copy="${link}">${ic("copy")}<span>Копировать</span></button></div>
      <div class="ref-share">
        ${navigator.share ? html`<button class="btn ghost sm" id="ref-native">${ic("share")}<span>Поделиться</span></button>` : ""}
        ${shareLinks.map(([i, t, u, attr]) => html`<a class="btn ghost sm" href="${u}" target="_blank" rel="noopener" ${raw(attr || "")}>${brand(i)}<span>${t}</span></a>`)}
      </div>
    </div>

    <div class="card stack">
      <div class="row between"><b class="row-c">${ic("wallet", "c-accent")}Баланс</b><span class="tiny muted">вывод от ${rub(d.min_payout)} ₽</span></div>
      <div class="bal-main"><b>${rub(b.available)} ₽</b><span class="small muted">${["доступно к выводу", b.hold && `ещё ${rub(b.hold)} ₽ в ожидании ${d.hold_days} дней`, b.requested && `${rub(b.requested)} ₽ выводится`].filter(Boolean).join(" · ")}</span></div>
      <button class="btn block" id="payout-open" ${canWithdraw ? "" : "disabled"}>${ic("wallet")}<span>${b.requested ? "Выплата в работе" : "Вывести на карту или по СБП"}</span></button>
      <a class="small center" href="https://t.me/oleg_ezhkov" target="_blank" rel="noopener">Написать в поддержку</a>
    </div>

    ${noRefs ? tips : ""}

    ${hasStats ? html`<div class="ref-kpis">
      <div><b>${d.counts.invited}</b><span>${plural(d.counts.invited, "приглашён", "приглашено", "приглашено")}</span></div>
      <div><b>${d.counts.active}</b><span>принимают пациентов</span></div>
      <div><b>${d.counts.paying}</b><span>${plural(d.counts.paying, "оплатил", "оплатили", "оплатили")}</span></div>
      <div><b>${rub(b.earned)} ₽</b><span>заработано всего</span></div>
    </div>` : ""}

    <div class="section-title">Приглашённые</div>
    ${d.referrals.length ? html`<div class="card ref-list">${d.referrals.map((r) => html`<div class="ref-row">
        <div class="grow"><b>${r.name}</b><div class="tiny muted">с ${dateText(r.at)}${r.patients ? ` · ${r.patients} ${plural(r.patients, "пациент", "пациента", "пациентов")}` : ""}</div>
          <span class="badge ${REF_STATUS[r.status][1]}">${REF_STATUS[r.status][0]}${r.payments > 1 ? ` · ${r.payments} ${plural(r.payments, "оплата", "оплаты", "оплат")}` : ""}</span></div>
        <div class="ref-sum"><b>${r.reward_sum ? `+${rub(r.reward_sum)} ₽` : "—"}</b><span class="tiny muted">${r.paid_sum ? `оплатил ${rub(r.paid_sum)} ₽` : "пока без оплат"}</span></div>
      </div>`)}</div>`
      : html`<div class="card center stack-sm"><div class="tile accent lg">${ic("users")}</div><b>Пока никого</b><p class="small muted">Отправьте ссылку в чат группы или потока — как только кто-то зарегистрируется, он появится здесь, а после оплаты вы увидите сумму и свою долю.</p></div>`}

    ${d.recent.length ? html`<div class="section-title">Начисления</div>
    <div class="card ref-list">${d.recent.map((e) => html`<div class="ref-row"><div class="grow"><b>${e.name}</b><div class="tiny muted">${dateText(e.at)} · оплата ${rub(e.amount)} ₽ · ${pct(e.rate)}</div></div><div class="ref-sum"><b class="c-ok">+${rub(e.reward)} ₽</b></div></div>`)}</div>` : ""}

    ${d.payouts.length ? html`<div class="section-title">Выплаты</div>
    <div class="card ref-list">${d.payouts.map((p) => html`<div class="ref-row"><div class="grow"><b>${rub(p.amount)} ₽</b><div class="tiny muted">${dateText(p.created_at)} · ${p.method === "sbp" ? "СБП" : "карта"}${p.note ? ` · ${p.note}` : ""}</div></div>
      <span class="badge ${p.status === "paid" ? "ok" : p.status === "rejected" ? "danger" : "warn"}">${p.status === "paid" ? "Выплачено" : p.status === "rejected" ? "Отклонено" : "В работе"}</span></div>`)}</div>` : ""}

    ${noRefs ? "" : partner}

    <div class="section-title">Готовые тексты</div>
    <div class="stack-sm">${inviteTexts(link).map(([t, text], i) => html`<div class="card stack-sm ref-tpl"><div class="row between"><b class="small">${t}</b><button class="btn ghost sm" data-copy-tpl="${i}">${ic("copy")}<span>Скопировать</span></button></div><p class="small muted">${text}</p></div>`)}</div>

    ${noRefs ? partner : tips}

    <p class="tiny muted center">Участвуя, вы принимаете <a href="/partner-oferta/" target="_blank" rel="noopener">партнёрское соглашение</a>. Налоги с вознаграждения уплачиваете самостоятельно.</p>
  </div>`);
  document.querySelectorAll("[data-copy]").forEach((el) => { el.onclick = () => { copyText(el.dataset.copy, "Ссылка скопирована"); goal("ref_copy"); }; });
  document.querySelectorAll("[data-copy-tpl]").forEach((el) => { el.onclick = () => { copyText(inviteTexts(link)[Number(el.dataset.copyTpl)][1], "Текст со ссылкой скопирован"); goal("ref_copy_tpl"); }; });
  const ig = $("#ref-ig");
  if (ig) ig.onclick = () => { copyText(`${shareText} ${link}`, "Текст со ссылкой скопирован — вставьте в сторис или директ"); goal("ref_share_ig"); };
  const nat = $("#ref-native");
  if (nat) nat.onclick = () => { navigator.share({ title: "Help me, Doctor", text: shareText, url: link }).catch(() => {}); goal("ref_share"); };
  const po = $("#payout-open");
  if (po) po.onclick = () => sheetPayout(d);
  const ap = $("#partner-apply");
  if (ap) ap.onclick = () => sheetPartnerApply();
  if (S.route.q?.apply && !d.partner && !S.partnerApplyShown) { S.partnerApplyShown = true; sheetPartnerApply(); }
}

function partnerBlock(d) {
  const st = d.partner?.status;
  if (st === "active") {
    return html`<div class="card stack-sm">
      <b class="row-c">${ic("target", "c-accent")}Первые 48 часов партнёра</b>
      <div class="small fact"><span class="num-dot">1</span><span>Примите 2–3 пациентов и сохраните скриншот лучшего разбора.</span></div>
      <div class="small fact"><span class="num-dot">2</span><span>Скопируйте текст «В чат группы» ниже и отправьте в чат группы или потока.</span></div>
      <div class="small fact"><span class="num-dot">3</span><span>Выложите сторис со скриншотом разбора и ссылкой — вопрос «а вы бы справились?» работает лучше всего.</span></div>
      <div class="tiny muted">Вопросы и идеи — <a href="https://t.me/oleg_ezhkov" target="_blank" rel="noopener">@oleg_ezhkov</a></div>
    </div>`;
  }
  if (st === "applied") {
    return html`<div class="card row-c"><div class="tile warn">${ic("clock")}</div><div class="grow"><b>Заявка в партнёры на рассмотрении</b><div class="small muted">Обычно отвечаем за 1–2 дня в Telegram. Пока вы получаете обычные ${pct(d.rates.first)} / ${pct(d.rates.next)}.</div></div></div>`;
  }
  if (st === "excluded") return "";
  return html`<div class="card stack partner-cta">
    <div class="row-c"><div class="tile accent">${ic("gem")}</div><div class="grow"><b>Станьте партнёром: ${pct(d.rates.partner)} с каждой оплаты</b><div class="small muted">и бессрочный доступ к тренажёру</div></div></div>
    <p class="small">Для тех, кто готов рассказывать о тренажёре регулярно: в своей группе, на потоке, в чатах курса или в своём канале. Мы дадим готовые тексты и материалы.</p>
    ${st === "rejected" ? html`<p class="tiny muted">Прошлая заявка не одобрена${d.partner.note ? `: ${d.partner.note}` : ""}. Можно подать новую.</p>` : ""}
    <button class="btn block" id="partner-apply">${ic("handshake")}<span>Подать заявку</span></button>
    <a class="more-link" href="/partneram/" target="_blank" rel="noopener">Как это работает ${ic("chevron")}</a>
  </div>`;
}

function sheetPartnerApply() {
  const p = S.me.profile;
  openSheet(html`<h2 class="row-c">${ic("handshake", "c-accent")}Заявка в партнёры</h2>
    <p class="small muted">${pct(partnerData?.rates?.partner || 0.5)} с каждой оплаты приглашённых и бессрочный доступ. Ответим в Telegram за 1–2 дня.</p>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label>Вуз</label><input class="input" id="pa-uni" maxlength="200" placeholder="Например: ПСПбГМУ им. Павлова"></div>
      <div class="grid-2"><div class="field"><label>Курс</label><input class="input" id="pa-course" maxlength="40" placeholder="4 курс / ординатура"></div>
        <div class="field"><label>Город</label><input class="input" id="pa-city" maxlength="80" placeholder="Санкт-Петербург"></div></div>
      <div class="field"><label>Где будете рассказывать</label><textarea id="pa-ch" maxlength="500" placeholder="Чат группы (25 чел.), чат потока (~300), свой канал в Telegram…"></textarea></div>
      <div class="field"><label>Ссылки на соцсети <span class="muted">— необязательно</span></label><input class="input" id="pa-links" maxlength="300" placeholder="t.me/…, vk.com/…"></div>
      <div class="field"><label>Пара слов о себе <span class="muted">— необязательно</span></label><textarea id="pa-about" maxlength="500"></textarea></div>
      <label class="row-c small"><input type="checkbox" id="pa-agree" style="width:20px;height:20px;accent-color:var(--accent)"><span>Принимаю <a href="/partner-oferta/" target="_blank" rel="noopener">партнёрское соглашение</a> и сам(а) плачу налоги с вознаграждения</span></label>
      <button class="btn block" id="pa-send">Отправить заявку</button>
      ${!(p.stats?.consultations_total > 0) ? html`<p class="tiny muted">Совет: перед заявкой примите хотя бы одного пациента — так проще рассказывать о тренажёре.</p>` : ""}
    </div>`, (el) => {
    $("#pa-send", el).onclick = async (e) => {
      const btn = e.currentTarget;
      btnBusy(btn);
      try {
        const res = await api("POST", "/partner/apply", {
          university: $("#pa-uni", el).value, course: $("#pa-course", el).value, city: $("#pa-city", el).value,
          channels: $("#pa-ch", el).value, links: $("#pa-links", el).value, about: $("#pa-about", el).value, agree: $("#pa-agree", el).checked,
        });
        goal("partner_apply");
        closeSheet();
        toast(res.status === "active" ? "Вы уже партнёр" : "Заявка отправлена — ответим в Telegram", "ok");
        partnerData = null;
        viewPartner(true);
      } catch (err) {
        toast(err.message, "error");
        btnBusy(btn, false);
      }
    };
  });
}

function sheetPayout(d) {
  let method = "card";
  const render = () => html`<h2 class="row-c">${ic("wallet", "c-accent")}Вывод ${rub(d.balance.available)} ₽</h2>
    <p class="small muted">Переведём всю доступную сумму на карту любого банка РФ или по СБП. Обычно — в течение нескольких рабочих дней.</p>
    <div class="row" style="gap:8px;margin-top:12px">
      <button class="chip ${method === "card" ? "on" : ""}" data-m="card">${ic("card")} Карта</button>
      <button class="chip ${method === "sbp" ? "on" : ""}" data-m="sbp">${ic("phone")} СБП</button>
    </div>
    <div class="stack" style="margin-top:12px">
      ${method === "card" ? html`<div class="field"><label>Номер карты</label><input class="input" id="po-card" inputmode="numeric" autocomplete="cc-number" maxlength="23" placeholder="0000 0000 0000 0000"></div>`
        : html`<div class="field"><label>Телефон, привязанный к СБП</label><input class="input" id="po-phone" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="+7 900 000-00-00"></div>
          <div class="field"><label>Банк</label><input class="input" id="po-bank" maxlength="80" placeholder="Т-Банк, Сбер, Альфа…"></div>`}
      <div class="field"><label>Имя и фамилия получателя</label><input class="input" id="po-name" autocomplete="name" maxlength="120" placeholder="Как в банке"></div>
      <label class="row-c small"><input type="checkbox" id="po-agree" style="width:20px;height:20px;accent-color:var(--accent)"><span>Реквизиты верны; налоги с вознаграждения уплачиваю самостоятельно (<a href="/partner-oferta/" target="_blank" rel="noopener">соглашение</a>)</span></label>
      <button class="btn block" id="po-send">Запросить выплату</button>
    </div>`;
  const bind = (el) => {
    el.querySelectorAll("[data-m]").forEach((b) => { b.onclick = () => { method = b.dataset.m; el.innerHTML = `<div class="grip"></div>${render()[RAW]}`; bind(el); }; });
    $("#po-send", el).onclick = async (e) => {
      if (!$("#po-agree", el).checked) return toast("Подтвердите реквизиты и условия", "error");
      const btn = e.currentTarget;
      btnBusy(btn);
      try {
        const body = method === "card" ? { method, card: $("#po-card", el).value, name: $("#po-name", el).value }
          : { method, phone: $("#po-phone", el).value, bank: $("#po-bank", el).value, name: $("#po-name", el).value };
        const res = await api("POST", "/partner/payout", body);
        goal("payout_request", { amount: res.amount });
        closeSheet();
        toast(`Запрос на ${rub(res.amount)} ₽ отправлен`, "ok");
        partnerData = null;
        viewPartner(true);
      } catch (err) {
        toast(err.message, "error");
        btnBusy(btn, false);
      }
    };
  };
  openSheet(render(), bind);
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
  // Единый вид строк: галочка у названия = привязан, справа — только действие одного размера
  const row = (key, linked, sub, action) => html`<div class="menu-item acc-row"><div class="tile plain">${brand(key)}</div>
    <div class="grow"><b class="acc-name">${PROVIDER_LABEL[key]}${linked ? html`<span class="acc-ok" aria-label="привязан">${ic("check")}</span>` : ""}</b><div class="small muted ellipsis">${sub}</div></div>${action}</div>`;
  const tgRow = row("telegram", a.telegram, a.telegram ? (p.username ? "@" + p.username : "Привязан") : "Приёмы в чате с ботом, напоминания и стрики",
    a.telegram ? "" : html`<button class="btn sm outline acc-btn" id="link-tg" type="button">Привязать</button>`);
  const provRows = a.providers.map((key) => {
    const i = ids[key];
    if (i) return row(key, true, i.email || i.name || "Привязан", total > 1 ? html`<button class="btn sm ghost acc-btn" data-unlink="${key}" type="button">Отвязать</button>` : "");
    if (IN_TG) return row(key, false, "Привязывается в веб-версии", "");
    return row(key, false, "Вход без Telegram", html`<button class="btn sm outline acc-btn" data-link="${key}" type="button">Привязать</button>`);
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
  btn.outerHTML = html`<a class="btn sm outline acc-btn" href="${r.tg || r.url}" id="link-tg-open">${ic("clock")}Ждём…</a>`[RAW];
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
  const st = p.stats || {};
  const rated = st.ratings_count || 0;
  const avg = rated ? st.avg_rating : 0;
  const quality = !rated ? "" : avg >= 4.5 ? "отлично — так держать" : avg >= 4 ? "хорошо, есть что подтянуть" : avg >= 3 ? "средне — смотрите советы ниже" : "ниже среднего — начните с советов ниже";
  // Что сделать дальше: одна понятная подсказка из того, что уже известно
  const next = !rated ? ["steth", "Примите первого пациента", "После разбора здесь появятся ваши оценки, сильные стороны и пробелы."]
    : !p.streak ? ["flame", "Начните серию заново", "Один приём в день — и серия дней растёт, а вместе с ней бонус к опыту."]
    : meaningful(p.weaknesses).length ? ["target", `Подтяните: ${meaningful(p.weaknesses)[0]}`, "Это чаще всего встречается в ваших разборах. Обратите внимание на следующем приёме."]
    : ["trophy", "Попробуйте сложнее", "Оценки высокие — поднимите сложность в настройках, чтобы расти дальше."];
  renderShell(html`<div class="page">
    <div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button><h2 class="grow">Статистика</h2></div>

    <div class="card lvl-card">${levelHead(p)}${kpis(p, true)}</div>
    ${consultCalendar(p)}

    <div class="card next-step"><div class="tile accent">${ic(next[0])}</div><div class="grow"><div class="tiny muted">ЧТО ДЕЛАТЬ ДАЛЬШЕ</div><b>${next[1]}</b><div class="small muted">${next[2]}</div></div></div>
    ${rated || !p.onboarding_done ? "" : html`<button class="btn block" data-go="/">${ic("plus")}<span>Принять пациента</span></button>`}

    ${rated ? html`<div class="section-title">Качество приёмов</div>
    <div class="card stack">
      <div class="row"><div class="rating-big">${avg.toFixed(1).replace(".", ",")}</div><div class="grow">${starsRow(avg)}<div class="small muted">средняя оценка за ${rated} ${plural(rated, "приём", "приёма", "приёмов")} · ${quality}</div></div></div>
      <div class="stat-rows">
        ${statRow("checkCircle", "Верных диагнозов подряд", st.correct_diagnoses_streak || 0, "сбрасывается при неверном диагнозе")}
        ${statRow("quiz", "Тестов по ошибкам пройдено", st.quizzes_done || 0, "закрепляют пробелы конкретного приёма")}
        ${statRow("users", "Пациентов принято", st.patients_total || 0, "")}
      </div>
    </div>` : ""}

    ${meaningful(p.strengths).length || meaningful(p.weaknesses).length ? html`<div class="section-title">Сильные стороны и пробелы</div>
    <div class="card stack">
      ${meaningful(p.strengths).length ? html`<div class="stack-sm"><div class="tiny muted row-c">${ic("checkCircle", "c-ok")} ПОЛУЧАЕТСЯ</div><div class="row wrap" style="gap:6px">${meaningful(p.strengths).slice(0, 6).map((x) => html`<span class="badge ok multi">${x}</span>`)}</div></div>` : ""}
      ${meaningful(p.weaknesses).length ? html`<div class="stack-sm"><div class="tiny muted row-c">${ic("target", "c-warn")} ПОДТЯНУТЬ</div><div class="row wrap" style="gap:6px">${meaningful(p.weaknesses).slice(0, 6).map((x) => html`<span class="badge warn multi">${x}</span>`)}</div></div>` : ""}
    </div>` : ""}

    ${p.recommendations?.length ? html`<div class="section-title">Советы из разборов</div>
    <div class="card stack-sm">${p.recommendations.slice(0, 3).map((r) => html`<div class="small fact">${ic("bulb", "c-warn")}<span>${r}</span></div>`)}</div>` : ""}
  </div>`);
}
// Календарь приёмов за 30 дней (даты МСК, как на сервере): без чисел — только дни с приёмами и без
const mskDay = (ts) => new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
function consultCalendar(p) {
  const days = p.consult_days || {};
  const now = Date.now();
  const list = Array.from({ length: 30 }, (_, i) => {
    const ts = now - (29 - i) * 86400000;
    return { n: days[mskDay(ts)] || 0, today: i === 29, wd: (new Date(ts + 3 * 3600000).getUTCDay() + 6) % 7 };
  });
  const active = list.filter((d) => d.n).length;
  const total = p.stats?.consultations_total || 0;
  const lead = list[0].wd; // пустые клетки до первого дня, чтобы недели шли строками Пн–Вс
  return html`<div class="card stack cal-card">
    <div class="row between"><b>Приёмы за 30 дней</b><span class="small muted">всего ${total} ${plural(total, "приём", "приёма", "приёмов")}</span></div>
    <div class="cal">
      ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => html`<span class="cal-wd">${d}</span>`)}
      ${Array.from({ length: lead }, () => html`<i class="cal-pad"></i>`)}
      ${list.map((d) => html`<i class="${d.n >= 3 ? "l3" : d.n === 2 ? "l2" : d.n ? "l1" : ""}${d.today ? " today" : ""}" title="${d.n ? `${d.n} ${plural(d.n, "приём", "приёма", "приёмов")}` : "без приёмов"}"></i>`)}
    </div>
    <div class="cal-sum">
      <div><b class="c-accent">${active}</b><span>${plural(active, "день", "дня", "дней")} с приёмами</span></div>
      <div><b>${30 - active}</b><span>без приёмов</span></div>
    </div>
  </div>`;
}
function statRow(icon, label, value, hint) {
  return html`<div class="stat-row">${ic(icon, "c-muted")}<div class="grow"><div>${label}</div>${hint ? html`<div class="tiny muted">${hint}</div>` : ""}</div><b>${value}</b></div>`;
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
/** Без пустышек от ИИ: «Нет», «Нет выявленных пробелов…», «—» */
const meaningful = (list) => (list || []).filter((x) => { const t = String(x || "").trim(); return t.length > 3 && !/^(нет(?![а-яё])|не выявлен|не обнаружен|отсутству|n\/a)/i.test(t); });
const dec = (v) => String(v ?? "").replace(".", ",");
const PREMIUM_PERKS = [
  ["users", "Безлимит пациентов"],
  ["pill", "Разбор по клиническим рекомендациям Минздрава: препараты, дозы, схемы"],
  ["flask", "Лучшая диагностика и обязательный минимум по КР для каждого случая"],
  ["quiz", "Тест по лечению и диагностике после каждого приёма"],
  ["chat", "Обсуждение разбора с экспертом — без ограничений"],
  ["flame", "«Очень сложные» случаи"],
  ["chart", "Слабые места и советы эксперта"],
];

// Документы: публичная оферта и политика обработки персональных данных (статичные страницы сайта)
const DOCS = { offer: "/oferta/", privacy: "/privacy/" };
const docLink = (key, text) => html`<a href="${DOCS[key]}" target="_blank" rel="noopener">${text}</a>`;

/** Почему выбранный неверный вариант не подходит (в новых тестах) */
function whyNot(q, chosen, why) {
  if (!why || chosen == null || !q.options[chosen]) return "";
  return html`<div class="quiz-why small" style="margin-top:6px"><b>Почему не «${q.options[chosen]}»:</b> ${why}</div>`;
}

function viewPlans(fresh) {
  const p = S.me.profile;
  const o = S.me.offer || { plans: S.me.plans, packs: {}, trial: null };
  const ap = p.autopay;
  // С активной подпиской показываем только апгрейд: с месяца (и студенческого, пробного) — на год; с года и бессрочного — ничего
  const maxed = p.sub_until === -1 || p.sub_plan === "year";
  // Подписка с автопродлением (месяц, студенческий, пробный) — апгрейд только на год; подарок и разовые без продления — можно продлить любым тарифом
  const upgradeOnly = p.has_sub && ap?.status === "active";
  const order = (p.has_sub ? (maxed ? [] : upgradeOnly ? ["year"] : ["month", "year"]) : ["month", "year"]).filter((k) => o.plans[k]);
  const PLAN_NAMES = { trial: "пробный период", month: "1 месяц", year: "1 год", student: "студенческий", week: "1 неделя", quarter: "3 месяца", gift: "подарок", forever: "навсегда" };
  if (fresh && S.route.q.paid && !S.paidToastAt) { toast("Проверяем оплату…"); watchPayment(); }
  if (fresh) api("POST", "/event", { type: "plans_open" }).catch(() => {});
  const planCard = (k) => {
    const x = o.plans[k];
    const monthly = x.days >= 60 ? Math.round(Number(x.price) / (x.days / 30)) : null;
    const disabled = x.recurring && ap?.status === "active";
    return html`<div class="plan ${x.best ? "best" : ""}">
      <b class="plan-name">${x.label}</b>
      <span class="tiny muted">${x.recurring ? "автопродление" : "разовый платёж"}</span>
      <div class="price">${rub(x.price)} ₽</div>
      <div class="tiny muted plan-sub">${monthly ? `≈ ${monthly} ₽/мес` : x.recurring ? "каждые 30 дней" : `${x.days} дней`}</div>
      <button class="btn block sm" data-plan="${k}" ${disabled ? "disabled" : ""}>${disabled ? "Оформлено" : "Оплатить"}</button></div>`;
  };
  renderShell(html`<div class="page">
    ${!IN_TG ? html`<div class="page-head"><button class="back" data-go="/profile" aria-label="Назад">${ic("back")}</button></div>` : ""}

    ${p.has_sub ? html`<div class="card stack-sm sub-card">
      <h2 class="row-c">${ic("gem", "c-accent")}Ваша подписка</h2>
      <div class="small">Премиум ${p.sub_until === -1 ? "навсегда" : html`до <b>${dateText(p.sub_until)}</b>`}${p.sub_plan && PLAN_NAMES[p.sub_plan] ? ` · тариф: ${PLAN_NAMES[p.sub_plan]}` : ""}</div>
      ${ap?.status === "active" ? html`<div class="small">Автопродление включено: <b>${rub(ap.price)} ₽</b> спишется ${dateText(ap.next_at)}${ap.trial ? " (после пробного периода)" : ""}.</div>
        <button class="btn block outline c-danger" id="autopay-off">${ic("x")}<span>Отключить автопродление</span></button>
        <span class="tiny muted">Премиум останется до конца оплаченного срока, деньги больше списываться не будут.</span>`
        : p.sub_until !== -1 ? html`<div class="small muted">Автопродление выключено — после ${dateText(p.sub_until)} вернётся бесплатный тариф.</div>` : ""}
    </div>
    ${order.length ? html`<div class="section-title">${upgradeOnly ? "Перейти на год" : "Продлить премиум"}</div>
      <p class="small muted">${upgradeOnly ? `Год — около ${Math.round(Number(o.plans.year?.price || 1000) / ((o.plans.year?.days || 365) / 30))} ₽ в месяц вместо ${rub(o.plans.month?.price || 200)} ₽. Срок прибавится к текущему, а автопродление месяца выключим само.` : `Новый срок начнётся после ${dateText(p.sub_until)} — ничего не сгорит.`}</p>` : ""}` : ""}

    ${p.trial_available && o.trial ? html`<div class="card trial-card stack">
      <h2>Премиум 7 дней за ${rub(o.trial.price)} ₽</h2>
      <div class="perks">${PREMIUM_PERKS.map(([i, t]) => html`<div class="fact">${ic(i, "c-accent")}<span>${t}</span></div>`)}</div>
      <button class="btn lg block" data-plan="trial">Попробовать за ${rub(o.trial.price)} ₽</button>
      <p class="tiny muted">Через 7 дней — ${rub(o.trial.then_price)} ₽ в месяц автоматически. Отключить можно в любой момент здесь же, до конца пробного периода — бесплатно.</p>
    </div>` : !p.has_sub ? html`<div class="card stack-sm">
      <b>Бесплатно — 2 пациента в день</b><span class="small muted">и ещё один за каждую оценку от ${dec(p.bonus_rating || 4.5)} (до ${p.bonus_max || 3} в день)</span><span class="small muted">с оценкой и выводом эксперта. В премиуме:</span>
      <div class="perks">${PREMIUM_PERKS.map(([i, t]) => html`<div class="fact">${ic(i, "c-accent")}<span>${t}</span></div>`)}</div></div>` : ""}

    ${order.length ? html`<div class="plans ${order.length === 1 ? "single" : ""}">${order.map(planCard)}</div>` : ""}
    ${p.has_sub ? "" : studentCard(p, o.student, ap)}

    <details class="card promo-box" ${S.promoOpen ? "open" : ""}><summary class="row-c">${ic("gift", "c-accent")}<b>Есть промокод?</b></summary>
      <form class="row" id="promo-form" style="margin-top:10px;gap:8px"><input class="input grow" id="promo-code" placeholder="Введите промокод" maxlength="32" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"><button class="btn" id="promo-go">Применить</button></form>
    </details>

    ${consentBox()}

    ${Object.keys(o.packs || {}).length ? html`<div class="section-title">Разовые покупки</div>
      <div class="card packs">${Object.entries(o.packs).filter(([k]) => !(p.has_sub && k === "patients3")).map(([k, x]) => html`<div class="pack-row">
        <div class="tile ${k === "freeze" ? "accent" : "warn"}">${ic(k === "freeze" ? "flame" : "users")}</div>
        <div class="grow"><b>${x.label}</b><div class="small muted">${k === "freeze" ? `Пропуск дня не сожжёт стрик${p.streak_freezes ? ` · у вас: ${p.streak_freezes}` : ""}` : `Сверх бесплатного лимита, не сгорают${p.patient_credits ? ` · у вас: ${p.patient_credits}` : ""}`}</div></div>
        <button class="btn sm" data-plan="${k}">${rub(x.price)} ₽</button></div>`)}</div>` : ""}

    <p class="tiny muted center">Карта или СБП. Доступ включается сразу — и в боте, и на сайте.<br>${docLink("offer", "Оферта")} · ${docLink("privacy", "Политика конфиденциальности")}</p>
  </div>`);
  bindConsent(root);
  root.querySelectorAll("[data-plan]").forEach((b) => (b.onclick = () => payFor(b.dataset.plan, b, root)));
  bindStudent();
  const pf = $("#promo-form");
  if (pf) pf.onsubmit = (e) => { e.preventDefault(); redeemPromo($("#promo-code").value, $("#promo-go")); };
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

/** Студенческий тариф: загрузить фото студенческого → проверка админом → оплата по студенческой цене */
function studentCard(p, st, ap) {
  if (!st || p.sub_until === -1) return "";
  const status = p.student?.status;
  const upload = (text) => html`<label class="btn block sm ghost file-btn">${ic("camera")}<span>${text}</span><input type="file" accept="image/*" id="stu-file" hidden></label>`;
  const body = status === "approved"
    ? html`<span class="small muted">Статус студента подтверждён.</span>
      <button class="btn block sm" data-plan="student" ${ap?.status === "active" ? "disabled" : ""}>${ap?.status === "active" ? "Подписка уже оформлена" : `Оплатить ${rub(st.price)} ₽`}</button>`
    : status === "pending"
      ? html`<span class="small muted">Студенческий на проверке — обычно отвечаем в течение дня. Напишем в Telegram и здесь.</span>`
      : html`<span class="small muted">${status === "declined" ? "Не получилось подтвердить по прошлому фото — загрузите другое. " : ""}Загрузите фото студенческого билета: должны быть видны ФИО, вуз и срок действия. Фото видят только админы и нигде не хранят.</span>
        ${upload(status === "declined" ? "Загрузить другое фото" : "Загрузить студенческий")}`;
  return html`<div class="card stack-sm">
    <b class="row-c">${ic("book", "c-accent")}Студентам — ${rub(st.price)} ₽ в месяц</b>
    ${body}
    <span class="tiny muted">Тот же премиум, с автопродлением каждые 30 дней.</span>
  </div>`;
}

function bindStudent() {
  const file = $("#stu-file");
  if (!file) return;
  file.onchange = async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    const label = file.closest("label");
    btnBusy(label);
    try {
      const blob = await fitImage(f, 1600);
      const r = await fetch(`${API_BASE}/api/student`, { method: "POST", headers: { Authorization: `Bearer ${S.token}`, "Content-Type": blob.type, "X-Client": IN_TG ? "miniapp" : "web" }, body: blob });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Не удалось отправить фото");
      S.me.profile = data.profile;
      haptic("success");
      toast("Отправили на проверку", "ok");
      viewPlans();
    } catch (e) {
      toast(e.message, "error");
      btnBusy(label, false);
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
    store(PAY_KEY, String(Date.now()));
    watchPayment(600000);
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

// Запасная копия приложения (app.html грузит её, если основная не ответила) не запускается второй раз
if (!window.__hmdBooted) {
  window.__hmdBooted = true;
  boot();
}
