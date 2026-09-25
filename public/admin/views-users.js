// Пользователи: список, карточка, пациент целиком
import {
  S, $, $$, api, q, html, str, raw, ic, fNum, fRub, fDT, fDate, fAgo, fTime, plural, toast, table, downloadCsv, avatar, subBadge,
  LEVELS, SOURCES, PLAN_LABELS, withBusy, openModal, confirmDialog, debounce, mskDayStart, mskDay,
} from "./core.js";
import { calendar, renderCharts } from "./charts.js";
import { evLabel } from "./views-stats.js";
import { openComposer, messageComposer, newTaskFrom, grantModal } from "./views-ops.js";

// ---------- Список ----------
const UF_KEY = "adm_users_filter";
let UF = loadUF();
let sort = { key: "last_active", dir: "desc" };
let selected = new Set();
let limit = 50;

function loadUF() {
  try { return JSON.parse(sessionStorage.getItem(UF_KEY) || "{}") || {}; } catch { return {}; }
}
function saveUF() {
  try { sessionStorage.setItem(UF_KEY, JSON.stringify(UF)); } catch {}
}

function currentFilter() {
  const f = { ...UF };
  delete f.more;
  if (f.reg_from) f.reg_from = mskDayStart(f.reg_from);
  if (f.reg_to) f.reg_to = mskDayStart(f.reg_to) + 86400000;
  if (S.route.q.uids) {
    try {
      const u = JSON.parse(sessionStorage.getItem("adm_uids") || "null");
      if (u) f.uids = u.uids;
    } catch {}
  }
  for (const k of Object.keys(f)) if (f[k] === "" || f[k] == null) delete f[k];
  return f;
}

let usersSeq = 0;
export async function viewUsers(el, ctx) {
  const mySeq = ++usersSeq;
  const funnel = S.route.q.uids ? JSON.parse(sessionStorage.getItem("adm_uids") || "null") : null;
  const filter = currentFilter();
  const data = await q("users", { filter, sort: sort.key, dir: sort.dir, limit, offset: 0 });
  // Ответ на устаревший запрос (фильтр успели поменять) не должен затирать свежий
  if (!ctx.isCurrent() || mySeq !== usersSeq) return;
  const sel = (k, opts, label) => html`<div class="field"><label>${label}</label><select class="input" data-uf="${k}"><option value="">Все</option>${opts.map(([v, l]) => html`<option value="${v}" ${UF[k] === v ? "selected" : ""}>${l}</option>`)}</select></div>`;
  const moreCount = ["reg_from", "reg_to", "cons_min", "cons_max", "rating_min", "rating_max", "onboarding", "feedback", "bot_blocked", "blocked", "source"].filter((k) => UF[k]).length;
  el.innerHTML = str(html`
    ${funnel ? html`<div class="callout mb row"><span class="grow">${ic("filter", "sm")} ${funnel.label}: ${funnel.uids.length} ${plural(funnel.uids.length, "пользователь", "пользователя", "пользователей")}</span><a class="btn ghost sm" href="#/users">Сбросить</a></div>` : ""}
    <div class="filters">
      <div class="field q"><label>Поиск</label><input class="input" data-uf="q" value="${UF.q || ""}" placeholder="Имя, @username или Telegram ID" type="search"></div>
      ${sel("active", [["today", "Сегодня"], ["7d", "За 7 дней"], ["sleep7", "Не заходил 7+ дней"], ["sleep14", "Уснул 14+ дней"]], "Активность")}
      ${sel("tariff", [["free", "Бесплатный"], ["paid", "Платный"], ["gift", "Подарок"], ["sub", "Любая подписка"], ["expired", "Истёкшая"]], "Тариф")}
      ${sel("level", Object.entries(LEVELS), "Уровень")}
      <div class="field"><label>Специальность</label><input class="input" data-uf="profession" value="${UF.profession || ""}" placeholder="Любая" list="prof-list2"></div>
      <button class="btn ghost" id="more-f">${ic("filter", "sm")}<span>Ещё${moreCount ? ` · ${moreCount}` : ""}</span></button>
    </div>
    <datalist id="prof-list2">${["Онколог", "Терапевт", "Кардиолог", "Хирург", "Педиатр", "Невролог", "Психиатр", "Дерматолог", "Анестезиолог", "Скорая помощь"].map((x) => html`<option value="${x}">`)}</datalist>
    <div class="filters ${UF.more ? "" : "hidden"}" id="more-box">
      <div class="field"><label>Регистрация с</label><input type="date" class="input" data-uf="reg_from" value="${UF.reg_from || ""}"></div>
      <div class="field"><label>Регистрация по</label><input type="date" class="input" data-uf="reg_to" value="${UF.reg_to || ""}"></div>
      <div class="field"><label>Приёмов от</label><input type="number" min="0" class="input" data-uf="cons_min" value="${UF.cons_min || ""}"></div>
      <div class="field"><label>Приёмов до</label><input type="number" min="0" class="input" data-uf="cons_max" value="${UF.cons_max || ""}"></div>
      <div class="field"><label>Оценка от</label><input type="number" min="0" max="5" step="0.1" class="input" data-uf="rating_min" value="${UF.rating_min || ""}"></div>
      ${sel("source", [["bot", "Бот"], ["miniapp", "Мини-приложение"], ["web", "Сайт"]], "Где работает")}
      ${sel("onboarding", [["yes", "Заполнил"], ["no", "Не заполнил"]], "Анкета")}
      ${sel("feedback", [["yes", "Оставил"], ["no", "Не оставлял"]], "Отзыв")}
      ${sel("bot_blocked", [["yes", "Заблокировал бота"], ["no", "Бот доступен"]], "Бот")}
      ${sel("blocked", [["yes", "Заблокированы админом"]], "Блокировка")}
      <button class="btn ghost" id="reset-f">Сбросить фильтры</button>
    </div>
    <div class="row between mb">
      <span class="muted small">Найдено: <b>${fNum(data.total)}</b></span>
      <div class="row">
        <button class="btn ghost sm" id="sel-all">Выбрать всех найденных</button>
        <button class="btn ghost sm" id="csv">${ic("download", "sm")}<span>CSV</span></button>
      </div>
    </div>
    <div class="card pad-0">
      <div class="desk-only">${table({
        columns: [
          { key: "sel", label: raw('<label class="check"><input type="checkbox" id="sel-page"></label>'), render: (u) => html`<label class="check" data-stop><input type="checkbox" data-sel="${u.uid}" ${selected.has(u.uid) ? "checked" : ""}></label>` },
          { key: "name", label: "Пользователь", sort: true, render: (u) => html`<div class="row" style="min-width:180px">${avatar(u.name, u.uid)}<div style="min-width:0"><b class="ellipsis" style="display:block">${u.name || "—"}</b><span class="tiny muted">${u.username ? `@${u.username}` : u.uid}</span></div></div>` },
          { key: "registered_at", label: "Регистрация", sort: true, render: (u) => html`<span class="nowrap">${fDate(u.registered_at)}</span>` },
          { key: "last_active", label: "Активность", sort: true, render: (u) => html`<span class="nowrap">${fAgo(u.last_active)}</span>` },
          { key: "lvl", label: "Уровень", sort: true, render: (u) => html`<span class="nowrap">${u.lvl || 1} · <span class="muted">${fNum(u.xp)} XP</span></span>` },
          { key: "streak", label: "Стрик", sort: true, cls: "r", render: (u) => fNum(u.streak) },
          { key: "cons", label: "Приёмов", sort: true, cls: "r", render: (u) => fNum(u.cons) },
          { key: "avg_rating", label: "Оценка", sort: true, cls: "r", render: (u) => (u.ratings_count ? u.avg_rating : "—") },
          { key: "sub_until", label: "Тариф", sort: true, render: (u) => subBadge(u) },
          { key: "paid_total", label: "Оплачено", sort: true, cls: "r", render: (u) => (u.paid_total ? fRub(u.paid_total) : "—") },
          { key: "src", label: "Где", render: (u) => html`<span class="small muted">${SOURCES[u.last_source] || "—"}</span>${u.bot_blocked ? html` <span class="badge danger">бот заблокирован</span>` : ""}${u.blocked ? html` <span class="badge danger">заблокирован</span>` : ""}` },
        ],
        rows: data.rows, sort, rowAttrs: (u) => `class="click" data-open="${u.uid}"`, empty: "Никого не нашли — измените фильтры",
      })}</div>
      <div class="mlist">${data.rows.length ? data.rows.map((u) => html`<div class="mitem">
        <label class="check" style="padding-top:8px"><input type="checkbox" data-sel="${u.uid}" ${selected.has(u.uid) ? "checked" : ""}></label>
        <a href="#/users/${u.uid}" class="row grow top" style="color:inherit;text-decoration:none;min-width:0">${avatar(u.name, u.uid)}<div class="grow" style="min-width:0">
          <div class="row between"><b class="ellipsis">${u.name || "—"}</b><span class="tiny muted nowrap">${fAgo(u.last_active)}</span></div>
          <div class="tiny muted">${u.username ? `@${u.username} · ` : ""}приёмов ${u.cons || 0}${u.ratings_count ? ` · оценка ${u.avg_rating}` : ""} · ур. ${u.lvl || 1}</div>
          <div class="row wrap mt" style="gap:4px;margin-top:6px">${subBadge(u)}${u.bot_blocked ? html`<span class="badge danger">бот заблокирован</span>` : ""}</div>
        </div></a></div>`) : html`<div class="empty">Никого не нашли</div>`}</div>
      ${data.rows.length < data.total ? html`<div class="row" style="justify-content:center;padding:12px"><button class="btn ghost" id="load-more">Показать ещё (${fNum(data.total - data.rows.length)})</button></div>` : ""}
    </div>
    <div class="bulkbar ${selected.size ? "" : "hidden"}" id="bulk">
      <b id="sel-n">${selected.size}</b><span>выбрано</span><span class="grow"></span>
      <button class="btn sm" id="b-msg">${ic("send", "sm")}<span>Написать</span></button>
      <button class="btn sm" id="b-grant">${ic("gift", "sm")}<span>Выдать подписку</span></button>
      <button class="btn ghost sm" id="b-clear">Снять выбор</button>
    </div>`);

  const reload = debounce(() => { limit = 50; viewUsers(el, ctx); }, 350);
  $$("[data-uf]", el).forEach((i) => {
    const ev = i.tagName === "INPUT" && (i.type === "search" || i.type === "text" || !i.type || i.type === "number") ? "input" : "change";
    i.addEventListener(ev, () => { UF[i.dataset.uf] = i.value.trim(); saveUF(); reload(); });
    if (i.type === "date") i.addEventListener("change", () => { UF[i.dataset.uf] = i.value; saveUF(); reload(); });
  });
  const q0 = $('[data-uf="q"]', el);
  if (document.activeElement === document.body && UF.q) { q0.focus(); q0.setSelectionRange(q0.value.length, q0.value.length); }
  $("#more-f").onclick = () => { UF.more = !UF.more; saveUF(); $("#more-box").classList.toggle("hidden", !UF.more); };
  $("#reset-f").onclick = () => { UF = {}; saveUF(); viewUsers(el, ctx); };
  $$("[data-sort]", el).forEach((th) => (th.onclick = () => {
    const k = th.dataset.sort;
    sort = { key: k, dir: sort.key === k && sort.dir === "desc" ? "asc" : "desc" };
    viewUsers(el, ctx);
  }));
  $$("[data-open]", el).forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("[data-stop], a, input")) location.hash = `#/users/${tr.dataset.open}`; }));
  const upd = () => { $("#bulk").classList.toggle("hidden", !selected.size); $("#sel-n").textContent = selected.size; };
  $$("[data-sel]", el).forEach((c) => (c.onchange = () => { if (c.checked) selected.add(c.dataset.sel); else selected.delete(c.dataset.sel); $$(`[data-sel="${c.dataset.sel}"]`, el).forEach((x) => (x.checked = c.checked)); upd(); }));
  const sp = $("#sel-page");
  if (sp) sp.onchange = () => { data.rows.forEach((u) => (sp.checked ? selected.add(u.uid) : selected.delete(u.uid))); $$("[data-sel]", el).forEach((x) => (x.checked = sp.checked)); upd(); };
  $("#sel-all").onclick = (e) => withBusy(e.currentTarget, async () => {
    const all = await q("users", { filter, limit: 5000 });
    all.rows.forEach((u) => selected.add(u.uid));
    $$("[data-sel]", el).forEach((x) => (x.checked = true));
    upd();
    toast(`Выбрано ${selected.size}`);
  });
  $("#b-clear").onclick = () => { selected.clear(); $$("[data-sel]", el).forEach((x) => (x.checked = false)); upd(); };
  $("#b-msg").onclick = () => openComposer({ filter: { uids: [...selected] }, label: `${selected.size} выбранных` });
  $("#b-grant").onclick = () => grantModal({ uids: [...selected], onDone: () => viewUsers(el, ctx) });
  const lm = $("#load-more");
  if (lm) lm.onclick = () => withBusy(lm, async () => { limit += 100; await viewUsers(el, ctx); });
  $("#csv").onclick = (e) => withBusy(e.currentTarget, async () => {
    const all = await q("users", { filter, sort: sort.key, dir: sort.dir, limit: 5000 });
    downloadCsv("users", [
      { key: "uid", label: "Telegram ID" }, { key: "name", label: "Имя" }, { key: "username", label: "Username" },
      { label: "Регистрация", value: (u) => fDT(u.registered_at) }, { label: "Активность", value: (u) => fDT(u.last_active) },
      { key: "level", label: "Уровень подготовки", value: (u) => LEVELS[u.level] || u.level }, { key: "profession", label: "Специальность" },
      { key: "lvl", label: "Уровень" }, { key: "xp", label: "XP" }, { key: "streak", label: "Стрик" }, { key: "cons", label: "Приёмов" },
      { key: "avg_rating", label: "Средняя оценка" }, { key: "quizzes", label: "Тестов" }, { label: "Подписка до", value: (u) => (u.sub_until === -1 ? "навсегда" : u.sub_until ? fDT(u.sub_until) : "") },
      { key: "sub_plan", label: "Тариф" }, { key: "paid_total", label: "Оплачено, ₽" }, { key: "about", label: "Анкета: кто" }, { key: "expectations", label: "Анкета: ожидания" },
      { key: "ref", label: "Откуда пришёл" }, { key: "last_source", label: "Где работает" }, { key: "bot_blocked", label: "Бот заблокирован" },
    ], all.rows);
  });
}

// ---------- Карточка пользователя ----------
const TABS = [["overview", "Обзор"], ["patients", "Пациенты"], ["chat", "Переписка"], ["timeline", "Хронология"], ["quizzes", "Тесты"], ["payments", "Оплаты"]];

export async function viewUser(el, ctx) {
  const uid = S.route.params.uid;
  const tab = TABS.some(([k]) => k === S.route.q.tab) ? S.route.q.tab : "overview";
  const d = await api("GET", `/user/${uid}`);
  if (!ctx.isCurrent()) return;
  const u = d.user || {};
  const p = d.view?.profile || {};
  const name = p.name || u.name || uid;
  ctx.setTitle(name);
  const username = p.username || u.username;
  el.innerHTML = str(html`
    <div class="page-head"><a class="btn ghost sm" href="#/users">${ic("back", "sm")}<span>Все пользователи</span></a></div>
    <div class="card">
      <div class="row top wrap" style="gap:14px">
        ${avatar(name, uid, "lg")}
        <div class="grow" style="min-width:200px">
          <h1 style="font-size:20px">${name}</h1>
          <div class="small muted row wrap" style="gap:8px;margin-top:2px">
            ${username ? html`<a href="https://t.me/${username}" target="_blank" rel="noopener">@${username}</a>` : ""}
            <span>ID <span class="kbd" data-copy="${uid}" title="Скопировать">${uid}</span></span>
            <span>с ${fDate(u.registered_at || p.registered_at)}</span><span>активность ${fAgo(u.last_active || p.last_active)}</span>
          </div>
          <div class="row wrap" style="gap:6px;margin-top:8px">
            ${subBadge({ sub_until: p.sub_until ?? u.sub_until, sub_plan: p.sub_plan ?? u.sub_plan })}
            ${p.level ? html`<span class="badge accent">${LEVELS[p.level] || p.level}</span>` : ""}${p.profession ? html`<span class="badge">${p.profession}</span>` : ""}
            ${p.blocked ? html`<span class="badge danger">${ic("lock", "sm")} Заблокирован</span>` : ""}${u.bot_blocked ? html`<span class="badge danger">Заблокировал бота</span>` : ""}
            ${u.extra_today ? html`<span class="badge info">+${u.extra_today} пациентов сегодня</span>` : ""}
          </div>
        </div>
        <div class="row wrap" style="gap:6px">
          <button class="btn sm" id="a-msg">${ic("send", "sm")}<span>Написать</span></button>
          <button class="btn soft sm" id="a-sub">${ic("gift", "sm")}<span>Подписка</span></button>
          <button class="btn ghost sm" id="a-more">Ещё…</button>
        </div>
      </div>
      <div class="tiles compact mt">
        ${mini("Уровень", `${p.level_info?.level ?? u.lvl ?? 1}`, `${fNum(p.xp ?? u.xp)} XP`)}
        ${mini("Стрик", fNum(p.streak ?? u.streak), plural(p.streak ?? 0, "день", "дня", "дней"))}
        ${mini("Приёмов", fNum(p.stats?.consultations_total ?? u.cons), `пациентов ${fNum(p.stats?.patients_total ?? u.patients)}`)}
        ${mini("Средняя оценка", p.stats?.ratings_count ? p.stats.avg_rating : "—", `верных подряд ${p.stats?.correct_diagnoses_streak ?? 0}`)}
        ${mini("Тестов пройдено", fNum(p.stats?.quizzes_done ?? u.quizzes), "")}
        ${mini("Оплачено", fRub(u.paid_total || 0), `${(d.payments || []).filter((x) => x.status === "paid").length} оплат`)}
      </div>
    </div>
    <div class="tabs mt" id="u-tabs">${TABS.map(([k, l]) => html`<a href="#/users/${uid}?tab=${k}" class="${tab === k ? "on" : ""}">${l}${k === "chat" && d.chat_count ? html` <span class="badge">${d.chat_count}</span>` : ""}${k === "patients" ? html` <span class="badge">${d.view?.patients?.length || 0}</span>` : ""}</a>`)}</div>
    <div id="tab"></div>`);
  $$("[data-copy]", el).forEach((x) => (x.onclick = () => { navigator.clipboard?.writeText(x.dataset.copy); toast("Скопировано"); }));
  $("#a-msg").onclick = () => messageComposer(uid, name, () => { if (tab === "chat") viewUser(el, ctx); });
  $("#a-sub").onclick = () => subMenu(uid, name, p, () => viewUser(el, ctx));
  $("#a-more").onclick = () => moreMenu(uid, name, p, d, () => viewUser(el, ctx));
  await TAB_RENDER[tab]($("#tab"), d, uid, el, ctx);
  renderCharts(el);
  // На телефоне шапка карточки высокая — при открытии вкладки по ссылке прокручиваем к ней
  const tabs = $("#u-tabs");
  if (tab !== "overview" && tabs && tabs.getBoundingClientRect().top > innerHeight * 0.5) tabs.scrollIntoView({ block: "start" });
}

const mini = (label, value, sub) => html`<div class="tile" style="box-shadow:none"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

const TAB_RENDER = {
  async overview(box, d, uid, el, ctx) {
    const p = d.view?.profile || {};
    const u = d.user || {};
    box.innerHTML = str(html`<div class="sidecol">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>О пользователе</h2></div>
          <dl class="kv">
            <dt>Кто</dt><dd>${LEVELS[p.level] || p.level || "—"}</dd>
            <dt>Учёба / работа</dt><dd>${p.about || u.about || html`<span class="muted">не указал</span>`}</dd>
            <dt>Ожидания</dt><dd>${p.expectations || u.expectations || html`<span class="muted">не указал</span>`}</dd>
            <dt>Анкета</dt><dd>${p.onboarding_done === false ? html`<span class="badge warn">не пройдена</span>` : p.about || p.expectations ? "заполнена" : "пропущена"}</dd>
            <dt>Специальность</dt><dd>${p.profession || "—"}</dd>
            <dt>Разделы</dt><dd>${(p.specializations || u.specs || []).join(", ") || "—"}</dd>
            <dt>Откуда пришёл</dt><dd>${p.ref || u.ref ? html`<span class="kbd">${p.ref || u.ref}</span>` : html`<span class="muted">прямой заход</span>`}</dd>
            <dt>Где работает</dt><dd>${SOURCES[u.last_source] || "—"}</dd>
            <dt>Напоминания</dt><dd>${p.notifications === false ? "выключены" : "включены"}</dd>
            <dt>Задание дня</dt><dd>${p.daily_task ? html`${p.daily_task.desc} · ${p.daily_task.done ? "выполнено" : `${p.daily_task.progress || 0}/${p.daily_task.target}`}` : "—"}</dd>
            <dt>Сильные стороны</dt><dd>${(p.strengths || []).join("; ") || "—"}</dd>
            <dt>Что подтянуть</dt><dd>${(p.weaknesses || []).join("; ") || "—"}</dd>
            <dt>Сейчас в боте</dt><dd>${d.view?.state?.active_patient_id ? "идёт приём" : "—"}${d.view?.state?.bot_pending ? ` · ждёт ввод: ${d.view.state.bot_pending}` : ""}</dd>
          </dl>
        </div>
        <div class="card"><div class="card-head"><h2>Активность за 90 дней</h2><span class="small muted">${fNum(d.counts?.events || 0)} действий всего</span></div>${calendar(d.activity)}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Заметки команды</h2><span class="tiny muted">пользователь не видит</span></div>
          <div class="stack-sm" id="notes">${(d.notes || []).map((n) => html`<div class="note"><div class="row between tiny muted"><span>${adminName(n.admin)} · ${fDT(n.ts)}</span><button class="btn ghost sm icon" data-del-note="${n.id}" aria-label="Удалить">${ic("trash", "sm")}</button></div><div class="pre">${n.text}</div></div>`)}</div>
          <div class="stack-sm mt"><textarea class="input" id="note-text" placeholder="Заметка о пользователе" style="min-height:60px"></textarea><button class="btn sm" id="note-add">Добавить заметку</button></div>
        </div>
        <div class="card"><div class="card-head"><h2>Отзывы</h2></div>
          ${(d.feedback || []).length ? html`<div class="stack-sm">${d.feedback.map((f) => html`<div><div class="row between"><span class="stars">${f.rating ? "★".repeat(f.rating) + "☆".repeat(5 - f.rating) : ""}</span><span class="tiny muted">${fDT(f.ts)}</span></div>${f.text ? html`<div class="pre small">${f.text}</div>` : ""}</div>`)}</div>` : html`<p class="small muted">Отзывов нет</p>`}
        </div>
      </div>
    </div>`);
    $("#note-add").onclick = (e) => withBusy(e.currentTarget, async () => {
      const text = $("#note-text").value.trim();
      if (!text) return toast("Напишите заметку", "error");
      await q("notes_add", { uid, text });
      viewUser(el, ctx);
    });
    $$("[data-del-note]", box).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog("Удалить заметку?", "Заметку увидит только команда, но удалить её можно без следа в карточке."))) return;
      await q("notes_delete", { id: Number(b.dataset.delNote) });
      viewUser(el, ctx);
    }));
  },

  async patients(box, d, uid) {
    const pats = d.view?.patients || [];
    const ev = await q("events", { uid, type: "patient_reject", limit: 100 });
    box.innerHTML = str(html`<div class="card pad-0">${table({
      columns: [
        { key: "name", label: "Пациент", render: (p) => html`<b>${p.name}</b><div class="tiny muted">${p.age} · ${p.sex === "female" ? "ж" : p.sex === "male" ? "м" : ""} · ${p.specialization}</div>` },
        { key: "true_diagnosis", label: "Истинный диагноз", render: (p) => html`<span class="small">${p.true_diagnosis}</span>` },
        { key: "consultations", label: "Приёмов", cls: "r" },
        { key: "last_rating", label: "Оценка", cls: "r", render: (p) => (p.evaluating ? html`<span class="badge warn">разбор…</span>` : p.last_rating ?? "—") },
        { key: "messages_count", label: "Реплик", cls: "r" },
        { key: "status", label: "Статус", render: (p) => (p.in_consultation ? html`<span class="badge accent">на приёме</span>` : p.status === "closed" ? html`<span class="badge">завершён</span>` : html`<span class="badge info">ждёт приёма</span>`) },
        { key: "created_at", label: "Создан", render: (p) => html`<span class="nowrap small">${fDT(p.created_at)}</span>` },
      ],
      rows: pats, rowAttrs: (p) => `class="click" data-pat="${p.id}"`, empty: "Пациентов нет",
    })}</div>
    ${ev.rows.length ? html`<div class="card mt"><div class="card-head"><h2>Отказался от пациентов</h2><span class="small muted">данные пациента удалены, остались в истории</span></div>
      ${table({ columns: [{ key: "ts", label: "Когда", render: (r) => fDT(r.ts) }, { key: "n", label: "Пациент", render: (r) => r.meta.name || "—" }, { key: "dx", label: "Диагноз", render: (r) => r.meta.diagnosis || "—" }, { key: "c", label: "Жалоба", render: (r) => html`<span class="small">${r.meta.complaint || "—"}</span>` }], rows: ev.rows })}</div>` : ""}`);
    $$("[data-pat]", box).forEach((tr) => (tr.onclick = () => { location.hash = `#/users/${uid}/patient/${tr.dataset.pat}`; }));
  },

  async chat(box, d, uid, el, ctx) {
    const data = await q("chat", { uid, limit: 500 });
    let rows = data.rows;
    let more = data.more;
    const draw = () => {
      let lastDay = "";
      box.innerHTML = str(html`<div class="card">
        <div class="card-head"><h2>Переписка с ботом</h2><span class="small muted">все сообщения в обе стороны, нажатия кнопок и ответы команде</span></div>
        <div class="chat" id="chat-box">
          ${more ? html`<button class="btn ghost sm" id="chat-more" style="align-self:center">Загрузить ранние</button>` : ""}
          ${rows.length ? rows.map((m) => {
            const day = mskDay(m.ts);
            const sep = day !== lastDay ? html`<div class="day-sep">${fDate(m.ts)}</div>` : "";
            lastDay = day;
            const who = m.dir === "in" ? (m.kind === "reply" ? "ответ команде" : m.kind === "button" ? "кнопка" : m.kind === "command" ? "команда" : "") : m.kind === "admin" ? `от ${adminName(m.admin)}` : m.kind === "broadcast" ? `рассылка №${m.ref}` : m.kind === "system" ? "напоминание" : m.kind === "edit" ? "изменено" : "бот";
            return html`${sep}<div class="bubble ${m.dir} ${m.kind} ${m.ok === 0 ? "failed" : ""}">${m.text}${m.buttons ? html`<div class="kbd">⌨ ${m.buttons}</div>` : ""}
              <div class="meta">${who ? html`<span>${who}</span>` : ""}<span>${fTime(m.ts)}</span>${m.ok === 0 ? html`<span title="${m.err}">не доставлено</span>` : ""}</div></div>`;
          }) : html`<div class="empty">Переписки пока нет</div>`}
        </div>
        <div class="row mt" style="justify-content:flex-end"><button class="btn" id="chat-write">${ic("send", "sm")}<span>Написать от имени бота</span></button></div>
      </div>`);
      const cb = $("#chat-box");
      cb.scrollTop = cb.scrollHeight;
      $("#chat-write").onclick = () => messageComposer(uid, d.user?.name || uid, () => viewUser(el, ctx));
      const m = $("#chat-more");
      if (m) m.onclick = () => withBusy(m, async () => {
        const r = await q("chat", { uid, before: rows[0]?.id, limit: 500 });
        rows = [...r.rows, ...rows];
        more = r.more;
        draw();
        $("#chat-box").scrollTop = 0;
      });
    };
    draw();
  },

  async timeline(box, d, uid) {
    let type = "";
    let rows = [];
    let more = false;
    const load = async (append = false) => {
      const r = await q("events", { uid, type, before: append ? rows[rows.length - 1]?.id : null, limit: 300 });
      rows = append ? [...rows, ...r.rows] : r.rows;
      more = r.more;
      draw();
    };
    const types = [["", "Все действия"], ["message", "Вопросы пациентам"], ["test", "Обследования"], ["exam", "Осмотры"], ["finish", "Завершения приёмов"], ["evaluation", "Разборы"], ["quiz_done", "Тесты"], ["pay_click", "Нажатия «Оплатить»"], ["paid", "Оплаты"], ["reminder", "Напоминания"], ["feedback", "Отзывы"]];
    const draw = () => {
      let lastDay = "";
      box.innerHTML = str(html`<div class="card">
        <div class="card-head"><h2>Хронология</h2><select class="input" id="ev-type" style="width:auto">${types.map(([k, l]) => html`<option value="${k}" ${k === type ? "selected" : ""}>${l}</option>`)}</select></div>
        <div class="feed">${rows.length ? rows.map((e) => {
          const l = evLabel(e);
          const day = mskDay(e.ts);
          const sep = day !== lastDay ? html`<div class="day-sep" style="margin:10px 0 4px;align-self:flex-start">${fDate(e.ts)}</div>` : "";
          lastDay = day;
          return html`${sep}<div class="feed-item"><span class="t">${fTime(e.ts)}</span><span class="ev-ico">${ic(l.icon)}</span><div class="grow" style="min-width:0">${l.label}${l.extra ? html` <span class="muted">· ${l.extra}</span>` : ""}
            ${e.source && SOURCES[e.source] ? html` <span class="badge">${SOURCES[e.source]}</span>` : ""}${e.meta?.backfill ? html` <span class="badge" title="Восстановлено из профиля">из истории</span>` : ""}
            ${e.meta?.patient ? html` <a class="small" href="#/users/${uid}/patient/${e.meta.patient}">пациент →</a>` : ""}</div></div>`;
        }) : html`<div class="empty">Нет событий</div>`}</div>
        ${more ? html`<div class="row mt" style="justify-content:center"><button class="btn ghost" id="ev-more">Показать ранние</button></div>` : ""}
      </div>`);
      $("#ev-type").onchange = (e) => { type = e.target.value; load(); };
      const m = $("#ev-more");
      if (m) m.onclick = () => withBusy(m, () => load(true));
    };
    await load();
  },

  async quizzes(box, d) {
    const qs = d.view?.quizzes || [];
    box.innerHTML = str(qs.length ? html`<div class="stack">${qs.map((qz) => html`<details class="card"><summary class="row between" style="cursor:pointer;list-style:none">
      <div><b>${qz.pat_diagnosis || qz.pat_name}</b><div class="tiny muted">${qz.pat_name} · ${fDT(qz.created_at)}</div></div>
      <span class="badge ${qz.status === "done" ? (qz.score >= qz.total - 1 ? "ok" : "warn") : "accent"}">${qz.status === "done" ? `${qz.score} из ${qz.total}` : `${qz.answered}/${qz.total}`}</span></summary>
      <ol class="stack-sm mt" style="padding-left:18px">${qz.questions.map((qq) => html`<li><div><b>${qq.text}</b></div>
        <ul style="padding-left:16px;margin:4px 0">${qq.options.map((o, k) => html`<li class="small" style="${k === qq.correct ? "color:var(--ok);font-weight:600" : k === qq.chosen ? "color:var(--danger)" : ""}">${o}${k === qq.correct ? " ✓" : ""}${k === qq.chosen && k !== qq.correct ? " — выбрал" : ""}${k === qq.chosen && k === qq.correct ? " — выбрал" : ""}</li>`)}</ul>
        <div class="tiny muted">${qq.explanation || ""}</div></li>`)}</ol></details>`)}</div>` : html`<div class="card empty">Тестов нет</div>`);
  },

  async payments(box, d, uid, el, ctx) {
    const p = d.view?.profile || {};
    box.innerHTML = str(html`<div class="card mb"><div class="row wrap between"><div>${subBadge({ sub_until: p.sub_until, sub_plan: p.sub_plan })}
      <span class="small muted" style="margin-left:6px">${p.can_accept ? "может принять пациента сегодня" : "бесплатный лимит на сегодня исчерпан"}</span></div>
      <button class="btn soft sm" id="p-sub">${ic("gift", "sm")}<span>Управлять подпиской</span></button></div></div>
      <div class="card pad-0">${table({
        columns: [
          { key: "created_at", label: "Дата", render: (r) => html`<span class="nowrap">${fDT(r.created_at)}</span>` },
          { key: "plan", label: "Тариф", render: (r) => PLAN_LABELS[r.plan] || r.plan },
          { key: "amount", label: "Сумма", cls: "r", render: (r) => fRub(r.amount) },
          { key: "status", label: "Статус", render: (r) => payStatus(r.status) },
          { key: "note", label: "Комментарий", render: (r) => html`<span class="small">${r.note || r.error || ""}${r.admin ? html` · ${adminName(r.admin)}` : ""}</span>` },
          { key: "op", label: "Операция", render: (r) => html`<span class="tiny muted">${r.op}</span>` },
        ],
        rows: d.payments || [], empty: "Оплат и подарков не было",
      })}</div>`);
    $("#p-sub").onclick = () => subMenu(uid, p.name, p, () => viewUser(el, ctx));
  },
};

export function payStatus(s) {
  const m = { paid: ["ok", "оплачено"], link: ["", "ссылка создана"], error: ["danger", "ошибка банка"], gift: ["info", "подарок"], refunded: ["warn", "возврат"], expired: ["", "истекла"] };
  const [cls, l] = m[s] || ["", s];
  return html`<span class="badge ${cls}">${l}</span>`;
}

export function adminName(id) {
  return S.admins.find((a) => a.id === String(id))?.name || id || "—";
}

function subMenu(uid, name, p, done) {
  const active = p.sub_until === -1 || p.sub_until > Date.now();
  openModal({
    title: `Подписка · ${name}`,
    body: html`<div>${subBadge({ sub_until: p.sub_until, sub_plan: p.sub_plan })}</div>
      <div class="stack-sm">
        <button class="btn" data-a="grant">${ic("gift", "sm")}<span>${active ? "Продлить / подарить дни" : "Выдать подписку"}</span></button>
        <button class="btn soft" data-a="extra">${ic("plus", "sm")}<span>Дополнительные пациенты на сегодня</span></button>
        ${active && p.sub_until !== -1 ? html`<button class="btn ghost" data-a="until">${ic("clock", "sm")}<span>Изменить дату окончания</span></button>` : ""}
        ${active ? html`<button class="btn danger" data-a="cancel">${ic("x", "sm")}<span>Отменить подписку</span></button>` : ""}
      </div>`,
    bind: (el, close) => {
      $$("[data-a]", el).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.a;
        close(true);
        if (a === "grant") return grantModal({ uids: [uid], name, onDone: done });
        if (a === "extra") return extraModal(uid, name, done);
        if (a === "until") return untilModal(uid, name, p, done);
        if (a === "cancel") return cancelModal(uid, name, done);
      }));
    },
  });
}

function extraModal(uid, name, done) {
  openModal({
    title: `Доп. пациенты · ${name}`,
    body: html`<div class="field"><label>Сколько пациентов добавить на сегодня</label><input class="input" type="number" min="1" max="50" value="1" id="x-n"></div>
      <label class="check"><input type="checkbox" id="x-notify" checked> Сообщить пользователю в Telegram</label>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="x-go">Добавить</button>`,
    bind: (el, close) => {
      $("#x-go", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        await api("POST", `/user/${uid}/action`, { action: "extra", n: Number($("#x-n", el).value), notify: $("#x-notify", el).checked });
        close(true); toast("Готово", "ok"); done();
      });
    },
  });
}

function untilModal(uid, name, p, done) {
  openModal({
    title: `Окончание подписки · ${name}`,
    body: html`<div class="field"><label>Подписка действует до (включительно, МСК)</label><input class="input" type="date" id="u-date" value="${mskDay(p.sub_until - 1)}"></div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="u-go">Сохранить</button>`,
    bind: (el, close) => {
      $("#u-go", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        const v = $("#u-date", el).value;
        if (!v) return toast("Выберите дату", "error");
        await api("POST", `/user/${uid}/action`, { action: "set_until", until: mskDayStart(v) + 86400000 - 1 });
        close(true); toast("Сохранено", "ok"); done();
      });
    },
  });
}

function cancelModal(uid, name, done) {
  openModal({
    title: `Отменить подписку · ${name}`,
    body: html`<p>Подписка закончится сразу. Деньги этим не возвращаются — возврат делается в личном кабинете Точки, а платёж можно отметить «возврат» в разделе «Подписки и платежи».</p>
      <label class="check"><input type="checkbox" id="c-notify"> Сообщить пользователю</label>
      <textarea class="input hidden" id="c-text" placeholder="Текст сообщения пользователю"></textarea>`,
    foot: html`<button class="btn ghost" data-close>Не отменять</button><button class="btn danger" id="c-go">Отменить подписку</button>`,
    bind: (el, close) => {
      $("#c-notify", el).onchange = (e) => $("#c-text", el).classList.toggle("hidden", !e.target.checked);
      $("#c-go", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        await api("POST", `/user/${uid}/action`, { action: "cancel", notify: $("#c-notify", el).checked, text: $("#c-text", el).value.trim() });
        close(true); toast("Подписка отменена", "ok"); done();
      });
    },
  });
}

function moreMenu(uid, name, p, d, done) {
  openModal({
    title: name,
    body: html`<div class="stack-sm">
      <button class="btn ghost" data-m="task">${ic("tasks", "sm")}<span>Создать задачу про пользователя</span></button>
      <button class="btn ghost" data-m="streak">${ic("flame", "sm")}<span>Сбросить стрик</span></button>
      ${p.blocked ? html`<button class="btn soft" data-m="unblock">${ic("unlock", "sm")}<span>Разблокировать</span></button>` : html`<button class="btn danger" data-m="block">${ic("lock", "sm")}<span>Заблокировать доступ к тренажёру</span></button>`}
    </div>`,
    bind: (el, close) => {
      $$("[data-m]", el).forEach((b) => (b.onclick = async () => {
        const m = b.dataset.m;
        close(true);
        if (m === "task") return newTaskFrom({ title: `Пользователь ${name}`, type: "feature", links: [{ kind: "user", id: uid, label: name }] });
        const ask = {
          streak: ["Сбросить стрик?", `Стрик ${name} станет 0.`, "Сбросить"],
          block: ["Заблокировать?", "Пользователь не сможет принимать пациентов, отвечать на тесты и начинать приёмы. Переписка и данные сохранятся.", "Заблокировать"],
          unblock: ["Разблокировать?", "Доступ к тренажёру вернётся.", "Разблокировать"],
        }[m];
        if (!(await confirmDialog(ask[0], ask[1], ask[2], m === "block"))) return;
        try {
          await api("POST", `/user/${uid}/action`, { action: m === "streak" ? "reset_streak" : m });
          toast("Готово", "ok");
          done();
        } catch (e) { toast(e.message, "error"); }
      }));
    },
  });
}

// ---------- Пациент целиком ----------
export async function viewPatient(el, ctx) {
  const { uid, pid } = S.route.params;
  const { patient: p, quiz } = await api("GET", `/user/${uid}/patient/${pid}`);
  if (!ctx.isCurrent()) return;
  ctx.setTitle(`Пациент · ${p.name}`);
  const items = [];
  for (const m of p.conversation_history || []) items.push({ ts: m.ts, kind: "msg", m });
  for (const t of p.test_results || []) items.push({ ts: t.ordered_at, kind: "test", t });
  for (const x of p.exam_results || []) items.push({ ts: x.ts, kind: "exam", x });
  (p.consultations || []).forEach((c, i) => items.push({ ts: c.date + 1, kind: "end", c, n: i + 1 }));
  items.sort((a, b) => a.ts - b.ts);
  const f = p.findings || {};
  const sex = p.sex === "female" ? "женщина" : p.sex === "male" ? "мужчина" : p.sex || "";
  el.innerHTML = str(html`
    <div class="page-head"><a class="btn ghost sm" href="#/users/${uid}?tab=patients">${ic("back", "sm")}<span>К пользователю</span></a></div>
    <div class="sidecol">
      <div class="card">
        <div class="card-head"><h2>Диалог и приёмы целиком</h2><span class="small muted">${(p.conversation_history || []).length} реплик · ${(p.test_results || []).length} обследований · ${(p.exam_results || []).length} осмотров</span></div>
        <div class="dlg">${items.length ? items.map((it) => {
          if (it.kind === "msg") return html`<div class="m ${it.m.role}">${it.m.voice ? "🎙 " : ""}${it.m.text}<div class="meta">${it.m.role === "doctor" ? "Врач" : "Пациент"} · ${fDT(it.ts)}</div></div>`;
          if (it.kind === "test") return html`<div class="ev"><div class="title">${ic("flask", "sm")}${it.t.test} <span class="tiny muted">${fDT(it.ts)}</span></div><div class="pre small">${it.t.result}</div></div>`;
          if (it.kind === "exam") return html`<div class="ev"><div class="title">${ic("steth", "sm")}Осмотр: ${it.x.action} <span class="tiny muted">${fDT(it.ts)}</span></div><div class="small">${it.x.sensation}</div>${it.x.reaction ? html`<div class="small mt"><b>Пациент:</b> ${it.x.reaction}</div>` : ""}</div>`;
          return consultBlock(it.c, it.n);
        }) : html`<div class="empty">Приём ещё не начинали</div>`}</div>
      </div>
      <div class="stack">
        <div class="card"><div class="card-head"><h2>${p.name}</h2></div>
          <dl class="kv">
            <dt>Возраст, пол</dt><dd>${p.age} · ${sex}</dd><dt>Раздел</dt><dd>${p.specialization}</dd>
            <dt>Статус</dt><dd>${p.current ? "идёт приём" : p.status === "closed" ? "завершён" : "ждёт приёма"}</dd>
            <dt>Создан</dt><dd>${fDT(p.created_at)}</dd>
            <dt>Истинный диагноз</dt><dd><b>${p.true_diagnosis}</b></dd>
            <dt>Жалоба</dt><dd>${p.chief_complaint}</dd>
            <dt>Первая фраза</dt><dd>${p.opening_phrase}</dd>
            <dt>Характер</dt><dd>${p.personality}</dd>
            <dt>Динамика</dt><dd>${({ improving: "улучшается", stable: "стабильно", worsening: "ухудшается", critical: "критично" })[p.condition_trajectory] || p.condition_trajectory || "—"}</dd>
          </dl></div>
        <div class="card"><div class="card-head"><h2>Скрыто от врача</h2></div>
          <div class="stack-sm small"><div><b>Анамнез:</b> ${p.full_history}</div>
          ${p.findings ? html`${f.exam ? html`<div><b>Осмотр:</b> ${f.exam}</div>` : ""}${f.lab ? html`<div><b>Анализы:</b> ${f.lab}</div>` : ""}${f.imaging ? html`<div><b>Визуализация:</b> ${f.imaging}</div>` : ""}${f.ecg ? html`<div><b>ЭКГ:</b> ${f.ecg}</div>` : ""}${f.pathology ? html`<div><b>Гистология:</b> ${f.pathology}</div>` : ""}`
            : p.key_findings ? html`<div><b>Находки:</b> ${p.key_findings}</div>` : ""}
          ${p.summary?.text ? html`<div><b>Сжатое начало диалога:</b> ${p.summary.text}</div>` : ""}</div></div>
        ${quiz ? html`<div class="card"><div class="card-head"><h2>Тест «работа над ошибками»</h2><span class="badge">${quiz.status === "done" ? `${quiz.score} из ${quiz.questions.length}` : `${quiz.answers.length}/${quiz.questions.length}`}</span></div>
          <ol class="stack-sm" style="padding-left:18px;margin:0">${quiz.questions.map((qq, i) => html`<li class="small"><b>${qq.text}</b><div>Верно: ${qq.options[qq.correct]}${quiz.answers[i] ? html` · выбрал: <span style="color:${quiz.answers[i].is_correct ? "var(--ok)" : "var(--danger)"}">${qq.options[quiz.answers[i].chosen]}</span>` : ""}</div></li>`)}</ol></div>` : ""}
      </div>
    </div>`);
}

function consultBlock(c, n) {
  const f = c.feedback || {};
  const axes = f.axes || {};
  return html`<div class="endc">
    <div class="row between wrap"><b>${ic("flag", "sm")} Приём №${n} завершён</b><span class="tiny muted">${fDT(c.date)}${c.started_at ? ` · ${Math.max(1, Math.round((c.date - c.started_at) / 60000))} мин` : ""}</span></div>
    <dl class="kv mt">
      <dt>Итог</dt><dd>${c.discharged ? "отказ от пациента" : c.referrals?.length ? `направление: ${c.referrals.join(", ")}` : "диагноз"}</dd>
      <dt>Диагноз врача</dt><dd>${c.diagnosis || "—"}</dd><dt>Лечение</dt><dd>${c.treatment || "—"}</dd>
      <dt>Обследования</dt><dd>${(c.tests || []).join(", ") || "—"}</dd><dt>Осмотр</dt><dd>${(c.physicals || []).join(", ") || "—"}</dd>
      <dt>Вопросов</dt><dd>${c.doctor_messages ?? "—"}</dd>
    </dl>
    ${c.evaluating ? html`<div class="badge warn mt">Эксперт готовит разбор…</div>` : c.rating != null ? html`<div class="mt stack-sm">
      <div class="row wrap"><b style="font-size:20px">${Number(c.rating).toFixed(1)}</b><span class="stars">${"★".repeat(Math.round(c.rating))}${"☆".repeat(5 - Math.round(c.rating))}</span>
        <span class="small muted">диагностика ${axes.diagnosis ?? "—"} · общение ${axes.communication ?? "—"} · лечение ${axes.treatment ?? "—"}</span>
        ${f.diagnosis_correct ? html`<span class="badge ${f.diagnosis_correct === "yes" ? "ok" : f.diagnosis_correct === "partial" ? "warn" : "danger"}">${{ yes: "диагноз верный", partial: "частично верный", no: "неверный" }[f.diagnosis_correct]}</span>` : ""}
        ${c.xp ? html`<span class="badge accent">+${c.xp} XP</span>` : ""}</div>
      ${f.expert_text ? html`<div class="small">${f.expert_text}</div>` : ""}
      ${(f.dialog_moments || []).map((m) => html`<div class="small"><i>«${m.quote}»</i> — ${m.comment}</div>`)}
      ${f.strengths?.length ? html`<div class="small"><b>Сильные стороны:</b> ${f.strengths.join("; ")}</div>` : ""}
      ${f.weaknesses?.length ? html`<div class="small"><b>Что подтянуть:</b> ${f.weaknesses.join("; ")}</div>` : ""}
      ${f.recommendation ? html`<div class="small"><b>Совет:</b> ${f.recommendation}</div>` : ""}
      ${c.post_story ? html`<div class="small"><b>Что было дальше:</b> ${c.post_story}</div>` : ""}
    </div>` : ""}
  </div>`;
}
