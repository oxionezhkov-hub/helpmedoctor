// Админка: вход, каркас, маршруты.
import { S, $, $$, api, q, html, str, ic, store, toast, setPeriod } from "./core.js";
import { renderCharts } from "./charts.js";
import { viewDashboard, viewAnalytics } from "./views-stats.js";
import { viewUsers, viewUser, viewPatient } from "./views-users.js";
import { viewSubs, viewMessages, viewBroadcast, viewFeedback, viewTasks, viewSettings, quickIdea, openTask } from "./views-ops.js";

const app = $("#app");
const TOKEN_KEY = "hmd_admin_token";
let tg = null;

// ---------- Вход ----------
async function boot() {
  try {
    const p = JSON.parse(store("adm_period") || "null");
    setPeriod(p?.key || "30d", p?.custom);
  } catch {
    setPeriod("30d");
  }
  // Внутри Telegram (кнопка «Открыть админку» в боте) — вход автоматически
  if (/tgWebApp/.test(location.hash + location.search)) await loadTelegram();
  tg = window.Telegram?.WebApp;
  if (tg?.initData) {
    try { tg.ready(); tg.expand(); } catch {}
    try {
      const r = await api("POST", "/auth/telegram", { initData: tg.initData });
      S.token = r.token;
      store(TOKEN_KEY, r.token);
    } catch (e) {
      return renderLogin(e.status === 403 ? "У этого Telegram-аккаунта нет доступа к админке." : e.message);
    }
    if (/tgWebApp/.test(location.hash)) history.replaceState(null, "", `${location.pathname}#/`);
  } else {
    S.token = store(TOKEN_KEY);
  }
  if (!S.token) return renderLogin();
  try {
    await loadMe();
  } catch (e) {
    if (e.code === "auth" || e.status === 403) return renderLogin(e.status === 403 ? "Нет доступа" : "");
    return renderFatal(e.message);
  }
  start();
}

function loadTelegram() {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-web-app.js?57";
    s.onload = s.onerror = resolve;
    document.head.appendChild(s);
    setTimeout(resolve, 4000);
  });
}

async function loadMe() {
  const r = await api("GET", "/me");
  S.me = r.me;
  S.admins = r.admins;
  S.info = r;
}

let started = false;
function start() {
  if (!started) {
    started = true;
    window.addEventListener("hashchange", route);
  }
  renderLayout();
  route();
}

window.addEventListener("admin-logout", () => {
  store(TOKEN_KEY, null);
  S.token = null;
  renderLogin("Сессия истекла — войдите снова");
});

let poll = null;
async function renderLogin(err = "") {
  clearInterval(poll);
  app.innerHTML = str(html`<div class="login"><div class="card stack">
    <div class="logo">${ic("heart")}</div>
    <h1>Админка Help me, Doctor</h1>
    <p class="muted">Доступ только для администраторов. Вход через Telegram.</p>
    ${err ? html`<div class="callout warn">${err}</div>` : ""}
    <a class="btn" id="login-btn" target="_blank" rel="noopener">${ic("telegram")}<span>Войти через Telegram</span></a>
    <p class="tiny muted" id="login-hint">Откроется бот — нажмите «Запустить», и админка откроется сама.</p>
  </div></div>`);
  let code;
  try {
    const r = await api("POST", "/auth/login");
    code = r.code;
    $("#login-btn").href = r.url;
  } catch (e) {
    $("#login-hint").textContent = e.message;
    return;
  }
  const t0 = Date.now();
  poll = setInterval(async () => {
    if (Date.now() - t0 > 9 * 60000) return renderLogin();
    try {
      const r = await api("GET", `/auth/poll?code=${encodeURIComponent(code)}`);
      if (r.status === "ok") {
        clearInterval(poll);
        S.token = r.token;
        store(TOKEN_KEY, r.token);
        await loadMe();
        start();
      } else if (r.status === "expired") renderLogin();
    } catch (e) {
      if (e.status === 403) { clearInterval(poll); renderLogin("Этот Telegram-аккаунт не админ."); }
    }
  }, 2000);
}

function renderFatal(text) {
  app.innerHTML = str(html`<div class="login"><div class="card stack"><h2>Что-то пошло не так</h2><p class="muted">${text}</p><button class="btn" onclick="location.reload()">Обновить</button></div></div>`);
}

// ---------- Каркас ----------
const NAV = [
  ["dashboard", "/", "dashboard", "Дашборд"],
  ["analytics", "/analytics", "chart", "Аналитика"],
  ["users", "/users", "users", "Пользователи"],
  ["subs", "/subs", "gem", "Подписки и платежи"],
  ["messages", "/messages", "send", "Сообщения"],
  ["feedback", "/feedback", "star", "Отзывы и анкеты"],
  ["tasks", "/tasks", "tasks", "Задачи"],
  ["settings", "/settings", "settings", "Настройки"],
];

function renderLayout() {
  app.innerHTML = str(html`<div class="layout">
    <aside class="side" id="side">
      <div class="brand"><span class="logo">${ic("heart")}</span><span>Help me, Doctor<div class="tiny muted" style="font-weight:500">Админка</div></span></div>
      <nav class="stack-sm" style="gap:2px">${NAV.map(([k, href, icon, label]) => html`<a class="nav-link" data-nav="${k}" href="#${href}">${ic(icon)}<span>${label}</span><span class="badge danger hidden" data-badge="${k}"></span></a>`)}</nav>
      <div class="side-foot">
        <button class="btn soft" id="idea-btn">${ic("bulb")}<span>Идея</span></button>
        <div class="row small"><span class="muted grow ellipsis">${S.me.name}</span><button class="btn ghost sm" id="logout" title="Выйти">${ic("logout")}</button></div>
      </div>
    </aside>
    <div class="backdrop" id="backdrop"></div>
    <div class="main">
      <header class="topbar" id="topbar">
        <button class="btn ghost icon menu-btn" id="menu" aria-label="Меню">${ic("menu")}</button>
        <h1 class="grow ellipsis" id="title"></h1>
        <button class="btn ghost sm" id="idea-top" title="Записать идею">${ic("bulb")}<span class="desk-only">Идея</span></button>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`);
  const side = $("#side"), bd = $("#backdrop");
  const toggle = (open) => { side.classList.toggle("open", open); bd.classList.toggle("open", open); };
  $("#menu").onclick = () => toggle(true);
  bd.onclick = () => toggle(false);
  $$(".nav-link").forEach((a) => a.addEventListener("click", () => toggle(false)));
  $("#idea-btn").onclick = () => { toggle(false); quickIdea(); };
  $("#idea-top").onclick = () => quickIdea();
  $("#logout").onclick = () => { store(TOKEN_KEY, null); S.token = null; location.hash = ""; renderLogin(); };
  window.addEventListener("scroll", () => $("#topbar")?.classList.toggle("scrolled", scrollY > 4), { passive: true });
  refreshBadges();
}

async function refreshBadges() {
  try {
    const c = await q("counts");
    const set = (k, n) => {
      const el = $(`[data-badge="${k}"]`);
      if (!el) return;
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.toggle("hidden", !n);
    };
    set("messages", c.unanswered);
    set("feedback", c.feedback_new);
    set("tasks", c.my_tasks);
  } catch {}
}
setInterval(() => { if (S.token && !document.hidden) refreshBadges(); }, 60000);

// ---------- Маршруты ----------
function parseRoute() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  const qs = Object.fromEntries(new URLSearchParams(query));
  const r = (name, params = {}) => ({ name, params, q: qs, path });
  if (!parts.length) return r("dashboard");
  if (parts[0] === "analytics") return r("analytics");
  if (parts[0] === "users" && parts[1] && parts[2] === "patient" && parts[3]) return r("patient", { uid: parts[1], pid: parts[3] });
  if (parts[0] === "users" && parts[1]) return r("user", { uid: parts[1] });
  if (parts[0] === "users") return r("users");
  if (parts[0] === "subs") return r("subs");
  if (parts[0] === "messages" && parts[1] === "broadcast" && parts[2]) return r("broadcast", { id: parts[2] });
  if (parts[0] === "messages") return r("messages");
  if (parts[0] === "feedback") return r("feedback");
  if (parts[0] === "tasks" && parts[1]) return r("tasks", { id: parts[1] });
  if (parts[0] === "tasks") return r("tasks");
  if (parts[0] === "settings") return r("settings");
  return r("dashboard");
}

const VIEWS = {
  dashboard: [viewDashboard, "Дашборд", "dashboard"],
  analytics: [viewAnalytics, "Аналитика", "analytics"],
  users: [viewUsers, "Пользователи", "users"],
  user: [viewUser, "Пользователь", "users"],
  patient: [viewPatient, "Пациент", "users"],
  subs: [viewSubs, "Подписки и платежи", "subs"],
  messages: [viewMessages, "Сообщения", "messages"],
  broadcast: [viewBroadcast, "Рассылка", "messages"],
  feedback: [viewFeedback, "Отзывы и анкеты", "feedback"],
  tasks: [viewTasks, "Задачи", "tasks"],
  settings: [viewSettings, "Настройки", "settings"],
};

let routeSeq = 0;
export async function route() {
  if (!S.token) return;
  const prev = S.route;
  S.route = parseRoute();
  const [fn, title, nav] = VIEWS[S.route.name];
  $$(".nav-link").forEach((a) => a.classList.toggle("on", a.dataset.nav === nav));
  $("#title").textContent = title;
  document.title = `${title} · Админка`;
  const samePage = prev?.name === S.route.name && prev?.params?.uid === S.route.params.uid;
  if (!samePage) window.scrollTo(0, 0);
  const my = ++routeSeq;
  const content = $("#content");
  if (!samePage) content.innerHTML = '<div class="grid" style="gap:12px"><div class="sk"></div><div class="sk" style="min-height:260px"></div></div>';
  try {
    await fn(content, { isCurrent: () => my === routeSeq, setTitle: (t) => { $("#title").textContent = t; document.title = `${t} · Админка`; } });
    if (my === routeSeq) renderCharts(content);
  } catch (e) {
    if (my !== routeSeq) return;
    if (e.code === "auth") return;
    content.innerHTML = str(html`<div class="card empty">${ic("alert")}${e.message}<div class="mt"><button class="btn ghost" onclick="location.reload()">Обновить</button></div></div>`);
  }
  // Открыть задачу по ссылке #/tasks/<id>
  if (S.route.name === "tasks" && S.route.params.id) openTask(S.route.params.id);
  refreshBadges();
}

export function rerender() {
  route();
}

window.addEventListener("error", (e) => console.error(e.error || e.message));
window.addEventListener("unhandledrejection", (e) => { if (e.reason?.code !== "auth") console.error(e.reason); });

boot();
export { toast };
