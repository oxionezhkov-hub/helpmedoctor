// Дашборд и аналитика
import {
  S, $, $$, api, q, html, str, raw, ic, fNum, fRub, fUsd, fDT, fDate, fAgo, fTime, plural, toast, periodPicker, bindPeriod,
  table, sortRows, downloadCsv, LEVELS, SOURCES, PLAN_LABELS, withBusy, store, openModal,
} from "./core.js";
import { chart, hbars, heatmap, renderCharts, SERIES } from "./charts.js";
import { newTaskFrom } from "./views-ops.js";

// ---------- Подписи событий (лента и хронология) ----------
const EV = {
  signup: ["user", "Запустил бота"], onboarding: ["note", "Анкета"], profile_update: ["settings", "Изменил профиль"],
  patient_request: ["plus", "Запросил пациента"], patient_ready: ["user", "Получил пациента"], patient_failed: ["alert", "Ошибка генерации пациента"],
  patient_reject: ["x", "Отказался от пациента"], patient_reopen: ["refresh", "Повторный приём"], limit_hit: ["lock", "Упёрся в лимит"],
  consult_start: ["steth", "Начал приём"], pause: ["clock", "Пауза приёма"], message: ["chat", "Вопрос пациенту"], reply: ["chat", "Ответ пациента"],
  test: ["flask", "Обследование"], exam: ["steth", "Осмотр"], finish: ["flag", "Завершил приём"], evaluation: ["star", "Разбор эксперта"],
  quiz_ready: ["quiz", "Тест готов"], quiz_open: ["quiz", "Открыл тест"], quiz_answer: ["quiz", "Ответ в тесте"], quiz_done: ["quiz", "Прошёл тест"],
  level_up: ["zap", "Новый уровень"], task_done: ["check", "Задание дня"], streak_up: ["flame", "Стрик вырос"], streak_reset: ["flame", "Стрик сброшен"],
  plans_open: ["gem", "Открыл тарифы"], pay_click: ["gem", "Нажал «Оплатить»"], pay_link: ["gem", "Ссылка на оплату"], pay_error: ["alert", "Ошибка оплаты"],
  paid: ["gem", "Оплатил"], gift: ["gift", "Подарок подписки"], sub_cancel: ["x", "Подписка отменена"], sub_change: ["gem", "Подписка изменена"],
  sub_expired: ["clock", "Подписка закончилась"], extra_patients: ["gift", "Доп. пациенты"], reminder: ["send", "Напоминание"], bot_blocked: ["lock", "Заблокировал бота"],
  feedback: ["star", "Отзыв"], ai_error: ["alert", "Сбой ИИ"], stt_error: ["mic", "Не распознан голос"], app_open: ["eye", "Открыл приложение"],
  blocked: ["lock", "Заблокирован админом"], unblocked: ["unlock", "Разблокирован"],
};
const FINISH = { diagnosis: "диагноз", referral: "направление", discharge: "отказ" };

export function evLabel(e) {
  const [icon, label] = EV[e.type] || ["activity", e.type];
  const m = e.meta || {};
  let extra = "";
  if (e.type === "test" || e.type === "exam") extra = `${m.name || ""}${m.custom ? " (свой вариант)" : ""}${m.cached ? " · повтор" : ""}`;
  else if (e.type === "finish") extra = `${FINISH[m.type] || ""}${m.diagnosis ? `: ${m.diagnosis}` : ""}${m.referral ? ` → ${m.referral}` : ""}`;
  else if (e.type === "evaluation") extra = `${m.rating ?? e.val} из 5${m.correct === "yes" ? " · верный диагноз" : m.correct === "partial" ? " · частично верный" : m.correct === "no" ? " · неверный" : ""}`;
  else if (e.type === "patient_ready" || e.type === "patient_reject") extra = `${m.name || ""}${m.diagnosis ? ` · ${m.diagnosis}` : ""}`;
  else if (e.type === "consult_start") extra = `${m.name || ""}${m.n ? ` · приём №${m.n}` : ""}`;
  else if (e.type === "quiz_done") extra = `${m.score} из ${m.total}`;
  else if (e.type === "quiz_answer") extra = `${m.correct ? "верно" : "неверно"} · ${m.q || ""}`;
  else if (e.type === "paid") extra = `${PLAN_LABELS[m.plan] || m.plan} · ${fRub(e.val)}`;
  else if (e.type === "pay_click" || e.type === "pay_link") extra = PLAN_LABELS[m.plan] || m.plan || "";
  else if (e.type === "pay_error" || e.type === "ai_error" || e.type === "patient_failed" || e.type === "stt_error") extra = m.error || m.what || "";
  else if (e.type === "gift") extra = `${m.days >= 36500 ? "навсегда" : `${m.days} дн.`}${m.reason ? ` · ${m.reason}` : ""}`;
  else if (e.type === "level_up") extra = `${m.from} → ${m.to}`;
  else if (e.type === "task_done") extra = m.desc || "";
  else if (e.type === "streak_up" || e.type === "streak_reset") extra = `${m.streak ?? ""}`;
  else if (e.type === "feedback") extra = m.rating ? `${m.rating} ★` : "текст";
  else if (e.type === "reminder") extra = `${{ reminder: "стрик", lost: "стрик сгорел", warning: "стрик сгорит", review: "просьба об отзыве" }[m.kind] || m.kind}${m.delivered === false ? " · не доставлено" : ""}`;
  else if (e.type === "onboarding") extra = m.answered ? "заполнил" : "пропустил";
  else if (e.type === "message") extra = m.voice ? "голосом" : "";
  else if (e.type === "profile_update") extra = (m.fields || []).join(", ");
  else if (e.type === "extra_patients") extra = `+${m.n}`;
  return { icon, label, extra };
}

// ---------- Дашборд ----------
let liveTimer = null;

export async function viewDashboard(el, ctx) {
  clearInterval(liveTimer);
  const p = S.period;
  const d = await q("dashboard", { from: p.from, to: p.to });
  if (!ctx.isCurrent()) return;
  const t = d.tiles, pv = d.prev;
  const delta = (a, b, invert = false) => {
    if (a == null || b == null) return "";
    if (!b) return a ? html`<span class="delta up">новое</span>` : "";
    const pct = Math.round(((a - b) / b) * 100);
    const good = invert ? pct < 0 : pct > 0;
    return html`<span class="delta ${pct === 0 ? "flat" : good ? "up" : "down"}">${pct > 0 ? "↑" : pct < 0 ? "↓" : "→"} ${Math.abs(pct)}%</span>`;
  };
  const tile = (label, value, sub, dl, icon, href) => html`<${raw(href ? `a href="${href}" style="color:inherit;text-decoration:none"` : "div")} class="tile">
    <div class="label">${ic(icon, "sm")}${label}</div><div class="value">${value}</div><div class="sub row" style="gap:6px">${dl || ""}<span>${sub || ""}</span></div></${raw(href ? "a" : "div")}>`;
  const s = d.series;
  const finishSeries = [["diagnosis", "Диагноз"], ["referral", "Направление"], ["discharge", "Отказ"]].map(([k, name]) => ({ name, values: s.finish.map((x) => x[k] || 0) }));
  const revSeries = ["day", "week", "month", "forever"].map((k) => ({ name: PLAN_LABELS[k], values: s.revenue.map((x) => x[k] || 0) }));
  const srcSeries = ["bot", "miniapp", "web"].map((k) => ({ name: SOURCES[k], values: s.sources.map((x) => x[k] || 0) }));
  const f = d.funnel;
  let worst = -1, worstDrop = 0;
  f.steps.forEach((st, i) => {
    if (!i) return;
    const prev = f.steps[i - 1].count;
    const drop = prev ? 1 - st.count / prev : 0;
    if (drop > worstDrop) { worstDrop = drop; worst = i; }
  });

  el.innerHTML = str(html`
    <div class="page-head"><div class="grow">${periodPicker()}</div><button class="btn ghost sm" id="refresh">${ic("refresh")}<span>Обновить</span></button></div>
    ${d.events_since ? html`<div class="callout mb small">События в реальном времени пишутся с ${fDT(d.events_since)}. Более ранние данные восстановлены из профилей: регистрации, пациенты, приёмы, оценки, тесты, оплаты${d.backfill && !d.backfill.done ? ` (идёт восстановление: ${d.backfill.processed} из ${d.backfill.total})` : ""}.</div>` : ""}
    <div class="tiles">
      ${tile("Новые пользователи", fNum(t.new_users), "за период", delta(t.new_users, pv.new_users), "user", "#/users")}
      ${tile("Активные", fNum(t.active), `DAU ${d.dau} · WAU ${d.wau} · MAU ${d.mau}`, delta(t.active, pv.active), "users")}
      ${tile("Липкость", d.stickiness != null ? `${d.stickiness}%` : "—", "DAU ÷ MAU", "", "activity")}
      ${tile("Пациенты создано", fNum(t.patients), "", delta(t.patients, pv.patients), "user")}
      ${tile("Приёмов завершено", fNum(t.finished), "", delta(t.finished, pv.finished), "flag", "#/analytics?r=consultations")}
      ${tile("Средняя оценка", t.avg_rating ?? "—", "из 5, по разборам", delta(t.avg_rating, pv.avg_rating), "star", "#/analytics?r=quality")}
      ${tile("Выручка", fRub(t.revenue), `${t.first_paid} ${plural(t.first_paid, "первая оплата", "первые оплаты", "первых оплат")}`, delta(t.revenue, pv.revenue), "gem", "#/analytics?r=money")}
      ${tile("Подписки сейчас", fNum(d.subs_paid + d.subs_gift), `платных ${d.subs_paid} · подарочных ${d.subs_gift}`, "", "card", "#/subs")}
      ${tile("Конверсия в оплату", t.conversion != null ? `${t.conversion}%` : "—", "первая оплата ÷ новые", "", "zap")}
      ${tile("ИИ за период", `${fNum(t.neurons)}`, `нейронов · ${fNum(t.ai_requests)} запросов`, delta(t.neurons, pv.neurons, true), "cpu", "#/analytics?r=ai")}
      ${tile("ИИ сегодня (UTC)", `${fNum(d.ai_today.neurons)}`, `из ${fNum(d.ai_today.free)} бесплатно · осталось ${fNum(d.ai_today.left)}`, "", "cpu", "#/analytics?r=ai")}
      ${tile("Ошибки", fNum(t.errors), "ИИ, оплата, Telegram", delta(t.errors, pv.errors, true), "alert", "#/analytics?r=errors")}
    </div>
    <div class="grid c2 mt">
      <div class="card"><div class="card-head"><h2>Новые и активные пользователи</h2></div>
        ${chart({ type: "line", labels: s.days, series: [{ name: "Новые", values: s.new_users }, { name: "Активные", values: s.active }] })}</div>
      <div class="card"><div class="card-head"><h2>Приёмы по способу завершения</h2></div>
        ${chart({ type: "stack", labels: s.days, series: finishSeries })}</div>
      <div class="card"><div class="card-head"><h2>Выручка по тарифам, ₽</h2></div>
        ${chart({ type: "stack", labels: s.days, series: revSeries, yFmt: (v) => fNum(v) })}</div>
      <div class="card"><div class="card-head"><h2>Расход ИИ по дням (UTC), нейроны</h2><a class="small" href="#/analytics?r=ai">Подробно</a></div>
        ${chart({ type: "bars", labels: s.ai_days, series: [{ name: "Нейроны", values: s.ai }], ref: { value: 10000, label: "Бесплатно 10 000/сутки" } })}</div>
      <div class="card"><div class="card-head"><h2>Откуда работают: активные пользователи</h2></div>
        ${chart({ type: "stack", labels: s.days, series: srcSeries })}</div>
      <div class="card"><div class="card-head"><h2>Воронка нового пользователя</h2><span class="small muted">${f.total} ${plural(f.total, "регистрация", "регистрации", "регистраций")} за период</span></div>
        ${f.total ? html`<div class="funnel">${f.steps.map((st, i) => {
          const pctFirst = f.total ? Math.round((st.count / f.total) * 100) : 0;
          const prev = i ? f.steps[i - 1].count : st.count;
          const pctPrev = prev ? Math.round((st.count / prev) * 100) : 0;
          return html`<div class="fstep ${i === worst ? "worst" : ""}" data-step="${i}" data-tip="${st.label}: ${st.count} (${pctFirst}% от всех${i && pctPrev <= 100 ? `, ${pctPrev}% от прошлого шага` : ""})\nНажмите — список пользователей">
            <span class="small ellipsis">${st.label}</span><span class="bar"><i style="width:${Math.max(0.5, pctFirst)}%"></i></span>
            <span class="nums"><b>${st.count}</b> · ${pctFirst}%${i && pctPrev <= 100 ? html` <span class="muted">(${pctPrev}%)</span>` : ""}</span></div>`;
        })}</div>
        ${worst > 0 ? html`<p class="small muted mt">Больше всего теряем на шаге «${f.steps[worst].label}»: −${Math.round(worstDrop * 100)}%. Нажмите на шаг — список тех, кто дошёл или не дошёл до него.</p>` : ""}` : html`<div class="empty">Нет регистраций за период</div>`}
      </div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Сейчас</h2><span class="small muted">последние действия, обновляется само</span></div><div class="feed" id="live"></div></div>
  `);
  bindPeriod(el, () => viewDashboard(el, ctx).then(() => renderCharts(el)));
  $("#refresh").onclick = (e) => withBusy(e.currentTarget, () => viewDashboard(el, ctx).then(() => renderCharts(el)));
  $$("[data-step]", el).forEach((row) => (row.onclick = () => {
    const i = Number(row.dataset.step);
    const st = f.steps[i];
    const reached = new Set(st.uids);
    const missed = f.steps[0].uids.filter((u) => !reached.has(u));
    const go = (label, uids) => {
      sessionStorage.setItem("adm_uids", JSON.stringify({ label, uids }));
      location.hash = "#/users?uids=1";
    };
    if (!i) return go("Все регистрации за период", st.uids);
    openModal({
      title: st.label,
      body: html`<p class="muted small">Шаги воронки независимы: пользователь мог, например, получить пациента, не заполнив анкету.</p>
        <div class="stack-sm">
          <button class="btn" data-g="1">${ic("users", "sm")}<span>Дошли до шага · ${st.count}</span></button>
          <button class="btn soft" data-g="0">${ic("alert", "sm")}<span>Не дошли · ${f.total - st.count}</span></button>
        </div>`,
      bind: (m, close) => $$("[data-g]", m).forEach((b) => (b.onclick = () => {
        close(true);
        if (b.dataset.g === "1") go(`Дошли до шага «${st.label}»`, st.uids);
        else go(`Не дошли до шага «${st.label}»`, missed);
      })),
    });
  }));
  await loadLive();
  liveTimer = setInterval(() => { if (S.route.name === "dashboard" && !document.hidden) loadLive(); else clearInterval(liveTimer); }, 15000);
}

async function loadLive() {
  const box = $("#live");
  if (!box) return;
  const rows = await q("live", { limit: 50 }).catch(() => []);
  box.innerHTML = rows.length ? str(rows.map((e) => {
    const l = evLabel(e);
    return html`<div class="feed-item"><span class="t">${fTime(e.ts)}<br><span class="tiny">${fAgo(e.ts)}</span></span><span class="ev-ico">${ic(l.icon)}</span>
      <div class="grow" style="min-width:0"><a href="#/users/${e.uid}"><b>${e.name || e.uid}</b></a> — ${l.label}${l.extra ? html` <span class="muted">· ${l.extra}</span>` : ""}
      ${e.source && SOURCES[e.source] ? html` <span class="badge">${SOURCES[e.source]}</span>` : ""}</div></div>`;
  })) : '<div class="empty">Пока нет событий</div>';
}

// ---------- Аналитика ----------
const REPORTS = [
  ["retention", "Удержание"], ["consultations", "Приёмы"], ["quality", "Качество"], ["procedures", "Обследования и осмотры"],
  ["specialties", "Специальности"], ["quizzes", "Тесты"], ["gamification", "Геймификация"], ["money", "Деньги"], ["ai", "Расход ИИ"],
  ["channels", "Каналы"], ["heatmap", "Активность по часам"], ["errors", "Ошибки"],
];
const AF = { source: "", level: "", profession: "", tariff: "" };

export async function viewAnalytics(el, ctx) {
  const r = REPORTS.some(([k]) => k === S.route.q.r) ? S.route.q.r : "retention";
  const p = S.period;
  const noFilters = ["specialties", "retention", "money", "ai", "errors"].includes(r);
  el.innerHTML = str(html`
    <div class="page-head"><div class="grow">${periodPicker()}</div></div>
    <div class="report-layout">
      <nav class="card report-nav" style="padding:8px">${REPORTS.map(([k, l]) => html`<a class="nav-link ${k === r ? "on" : ""}" href="#/analytics?r=${k}">${l}</a>`)}</nav>
      <div class="stack" style="min-width:0">
        <div class="filters" style="margin:0">
          <div class="field mob-only" style="max-width:none;flex-basis:100%"><label>Отчёт</label><select class="input" id="rsel">${REPORTS.map(([k, l]) => html`<option value="${k}" ${k === r ? "selected" : ""}>${l}</option>`)}</select></div>
          ${noFilters ? "" : html`
          <div class="field"><label>Источник</label><select class="input" data-af="source"><option value="">Все</option>${["bot", "miniapp", "web"].map((k) => html`<option value="${k}" ${AF.source === k ? "selected" : ""}>${SOURCES[k]}</option>`)}</select></div>
          <div class="field"><label>Уровень</label><select class="input" data-af="level"><option value="">Все</option>${Object.entries(LEVELS).map(([k, l]) => html`<option value="${k}" ${AF.level === k ? "selected" : ""}>${l}</option>`)}</select></div>
          <div class="field"><label>Специальность</label><input class="input" data-af="profession" value="${AF.profession}" placeholder="Любая" list="prof-list"></div>
          <div class="field"><label>Тариф</label><select class="input" data-af="tariff"><option value="">Все</option>${[["free", "Бесплатный"], ["paid", "Платный"], ["gift", "Подарок"]].map(([k, l]) => html`<option value="${k}" ${AF.tariff === k ? "selected" : ""}>${l}</option>`)}</select></div>`}
        </div>
        <datalist id="prof-list">${["Онколог", "Терапевт", "Кардиолог", "Хирург", "Педиатр", "Невролог", "Психиатр", "Дерматолог", "Анестезиолог", "Скорая помощь"].map((x) => html`<option value="${x}">`)}</datalist>
        <div id="report"><div class="sk" style="min-height:300px"></div></div>
      </div>
    </div>`);
  bindPeriod(el, () => viewAnalytics(el, ctx).then(() => renderCharts(el)));
  $("#rsel").onchange = (e) => { location.hash = `#/analytics?r=${e.target.value}`; };
  $$("[data-af]", el).forEach((i) => (i.onchange = () => { AF[i.dataset.af] = i.value.trim(); viewAnalytics(el, ctx).then(() => renderCharts(el)); }));
  const data = await q("report", { name: r, from: p.from, to: p.to, ...(noFilters ? {} : AF) });
  if (!ctx.isCurrent()) return;
  const box = $("#report");
  box.innerHTML = str(RENDER[r](data));
  BIND[r]?.(box, data, el, ctx);
  renderCharts(box);
}

const csvBtn = (id, label = "CSV") => html`<button class="btn ghost sm" data-csv="${id}">${ic("download", "sm")}<span>${label}</span></button>`;
function bindCsv(box, map) {
  $$("[data-csv]", box).forEach((b) => (b.onclick = () => { const [name, cols, rows] = map[b.dataset.csv](); downloadCsv(name, cols, rows); }));
}
const pct = (v) => (v == null ? "—" : `${v}%`);
const stat = (label, value, sub = "") => html`<div class="tile"><div class="label">${label}</div><div class="value">${value}</div>${sub ? html`<div class="sub">${sub}</div>` : ""}</div>`;

const RENDER = {
  retention: (d) => {
    const cell = (n, size) => {
      if (!size) return html`<td>—</td>`;
      const v = Math.round((n / size) * 100);
      const stp = v <= 0 ? 0 : Math.min(7, 1 + Math.floor(v / 14.3));
      return html`<td style="background:var(--seq-${stp});color:${stp >= 4 ? "#fff" : "inherit"}" data-tip="${n} из ${size} (${v}%)">${v}%</td>`;
    };
    return html`<div class="card"><div class="card-head"><h2>Удержание по неделям регистрации</h2>${csvBtn("ret")}</div>
      <p class="small muted mb">Доля пользователей, которые хоть что-то сделали на N-й неделе после регистрации. D1/D7/D14/D30 — вернулись через 1, 7, 14, 30 дней и позже.</p>
      ${d.cohorts.length ? html`<div class="table-wrap"><table class="t cohort"><thead><tr><th>Неделя</th><th class="r">Людей</th>${Array.from({ length: 9 }, (_, k) => html`<th class="c">Н${k}</th>`)}<th class="c">D1</th><th class="c">D7</th><th class="c">D14</th><th class="c">D30</th></tr></thead>
      <tbody>${d.cohorts.map((c) => html`<tr><td class="nowrap" style="text-align:left">${fDate(Date.parse(c.week))}</td><td class="r">${c.size}</td>${c.weeks.map((n) => cell(n, c.size))}${cell(c.d1, c.size)}${cell(c.d7, c.size)}${cell(c.d14, c.size)}${cell(c.d30, c.size)}</tr>`)}</tbody></table></div>` : html`<div class="empty">Нет регистраций за период</div>`}</div>`;
  },
  consultations: (d) => html`<div class="tiles">
      ${stat("Начато приёмов", fNum(d.starts))}${stat("Завершено", fNum(d.finishes))}${stat("Брошено", fNum(d.abandoned), "начаты, но не завершены")}
      ${stat("С назначенным лечением", fNum(d.with_treatment))}${stat("Длительность", d.avg_minutes != null ? `${d.avg_minutes} мин` : "—", "в среднем")}
      ${stat("Вопросов за приём", d.avg_questions ?? "—")}${stat("Обследований за приём", d.avg_tests ?? "—")}${stat("Осмотров за приём", d.avg_exams ?? "—")}
      ${stat("Доля голосовых", pct(d.voice_share), `${fNum(d.messages)} вопросов всего`)}${stat("Ответ пациента", d.reply_ms != null ? `${(d.reply_ms / 1000).toFixed(1)} с` : "—", "среднее время ИИ")}
    </div>
    <div class="card mt"><div class="card-head"><h2>Как завершают приём</h2></div>${hbars([["diagnosis", "Диагноз"], ["referral", "Направление к специалисту"], ["discharge", "Отказ от пациента"]].map(([k, l], i) => ({ label: l, value: d.by_type[k] || 0, color: SERIES[i] })))}</div>`,
  quality: (d) => {
    const cols = [
      { key: "key", label: "Группа", sort: true }, { key: "count", label: "Приёмов", cls: "r", sort: true }, { key: "avg", label: "Оценка", cls: "r", sort: true },
      { key: "correct_pct", label: "Верный диагноз", cls: "r", render: (r) => pct(r.correct_pct) }, { key: "diagnosis", label: "Диагностика", cls: "r" },
      { key: "communication", label: "Общение", cls: "r" }, { key: "treatment", label: "Лечение", cls: "r" },
    ];
    return html`<div class="tiles">${stat("Разборов", fNum(d.total))}${stat("Средняя оценка", d.avg ?? "—", "из 5")}</div>
      <div class="card mt"><div class="card-head"><h2>По разделам (откуда пациент)</h2>${csvBtn("sec")}</div>${table({ columns: cols, rows: d.by_section })}</div>
      <div class="grid c2 mt">
        <div class="card"><div class="card-head"><h2>По специальности врача</h2>${csvBtn("prof")}</div>${table({ columns: cols.slice(0, 4), rows: d.by_profession })}</div>
        <div class="card"><div class="card-head"><h2>По уровню подготовки</h2>${csvBtn("lvl")}</div>${table({ columns: cols.slice(0, 4), rows: d.by_level })}</div>
      </div>
      <div class="card mt"><div class="card-head"><h2>Самые частые «слабые места» из разборов</h2></div>${hbars(d.weaknesses.map((w) => ({ label: w.name, value: w.count })))}</div>`;
  },
  procedures: (d) => {
    const cols = [
      { key: "name", label: "Название", render: (r) => html`${r.name}${r.custom ? html` <span class="badge warn">свой</span>` : ""}` },
      { key: "count", label: "Раз", cls: "r" }, { key: "avg_rating", label: "Оценка приёмов", cls: "r", render: (r) => r.avg_rating ?? "—" },
      { key: "avg_ms", label: "Время ответа", cls: "r", render: (r) => (r.avg_ms ? `${(r.avg_ms / 1000).toFixed(1)} с` : "—") },
    ];
    const custom = [...d.tests, ...d.exams].filter((x) => x.custom).sort((a, b) => b.count - a.count).slice(0, 10);
    return html`<div class="grid c2">
      <div class="card"><div class="card-head"><h2>Обследования</h2>${csvBtn("tests")}</div>${table({ columns: cols, rows: d.tests, empty: "Обследований не назначали" })}</div>
      <div class="card"><div class="card-head"><h2>Физикальный осмотр</h2>${csvBtn("exams")}</div>${table({ columns: cols, rows: d.exams, empty: "Осмотров не проводили" })}</div>
    </div>
    ${custom.length ? html`<div class="card mt"><div class="card-head"><h2>Свои варианты — кандидаты в основной список</h2></div>${hbars(custom.map((x) => ({ label: x.name, value: x.count })))}</div>` : ""}`;
  },
  specialties: (d) => html`<div class="grid c2">
    <div class="card"><div class="card-head"><h2>Специальности врачей</h2>${csvBtn("profs")}</div>${table({ columns: [
      { key: "name", label: "Специальность", render: (r) => html`${r.name}${r.custom ? html` <span class="badge warn">своя</span>` : ""}` },
      { key: "users", label: "Врачей", cls: "r" }, { key: "cons", label: "Приёмов", cls: "r" }, { key: "rating", label: "Оценка", cls: "r", render: (r) => r.rating ?? "—" },
    ], rows: d.professions })}</div>
    <div class="card"><div class="card-head"><h2>Разделы, из которых приходят пациенты</h2>${csvBtn("secs")}</div>${hbars(d.sections.slice(0, 40).map((x) => ({ label: x.name, value: x.users, sub: x.custom ? "свой" : "" })))}</div>
  </div>`,
  quizzes: (d) => html`<div class="tiles">${stat("Тестов создано", fNum(d.ready))}${stat("Открыли", fNum(d.opened))}${stat("Прошли до конца", fNum(d.done))}${stat("Средний балл", d.avg_score ?? "—", "из 5")}${stat("Сдали на 4–5", pct(d.pass_pct))}</div>
    <div class="card mt"><div class="card-head"><h2>Вопросы с наибольшей долей ошибок</h2>${csvBtn("hard")}</div>${table({ columns: [
      { key: "question", label: "Вопрос", render: (r) => html`<span class="small">${r.question}</span>` }, { key: "answers", label: "Ответов", cls: "r" }, { key: "wrong_pct", label: "Ошибок", cls: "r", render: (r) => pct(r.wrong_pct) },
    ], rows: d.hardest, empty: "Пока нет ответов" })}</div>`,
  gamification: (d) => html`<div class="tiles">${stat("Повышений уровня", fNum(d.level_ups), "за период")}${stat("Сгоревших стриков", fNum(d.streaks_lost), "за период")}</div>
    <div class="grid c2 mt">
      <div class="card"><div class="card-head"><h2>Пользователи по уровням</h2></div>${chart({ type: "bars", labels: d.levels.map((x) => x.label), series: [{ name: "Пользователей", values: d.levels.map((x) => x.n) }] })}</div>
      <div class="card"><div class="card-head"><h2>Стрики сейчас</h2></div>${hbars(d.streaks.map((x) => ({ label: `${x.label} ${plural(Number(x.label) || 5, "день", "дня", "дней")}`, value: x.n })))}</div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Выполненные задания дня</h2></div>${hbars(d.daily_tasks.map((x) => ({ label: x.name, value: x.n })))}</div>`,
  money: (d) => html`<div class="tiles">
      ${stat("Выручка", fRub(d.total), `${d.payments} ${plural(d.payments, "оплата", "оплаты", "оплат")}`)}${stat("Средний чек", fRub(d.avg_check))}
      ${stat("Платили когда-либо", fNum(d.payers), `повторно — ${d.repeat_payers}`)}${stat("Нажали «Оплатить» и не заплатили", fNum(d.clicked_not_paid), `из ${d.clicked} нажавших`)}
      ${stat("Дней до первой оплаты", d.avg_days_to_first ?? "—", "в среднем")}${stat("Подарков выдано", fNum(d.gifts))}${stat("Ошибок оплаты", fNum(d.errors))}
    </div>
    <div class="card mt"><div class="card-head"><h2>По тарифам</h2>${csvBtn("plans")}</div>${table({ columns: [
      { key: "label", label: "Тариф" }, { key: "count", label: "Оплат", cls: "r" }, { key: "sum", label: "Сумма", cls: "r", render: (r) => fRub(r.sum) },
    ], rows: d.by_plan, empty: "Оплат за период нет" })}</div>`,
  ai: (d) => {
    const cf = d.cloudflare;
    return html`<div class="card mb" id="ai-setup">${aiSetup(d.setup)}</div>
      <div class="callout mb small">Цена Workers AI в нейронах за 1 млн токенов (вход / выход): Qwen3 30B — 4 625 / 30 475, Llama 3.3 70B — 26 668 / 204 805; Whisper — 46,63 за минуту аудио. Запасные провайдеры (Cerebras, Groq) бесплатны и нейронов не тратят. Бесплатно 10 000 нейронов в сутки (UTC), сверх — $0.011 за 1000. Наш подсчёт — по токенам из каждого ответа модели${d.kinds.some((k) => k.estimated) ? " (часть запросов — по оценке длины текста)" : ""}.</div>
      <div class="tiles">${stat("Нейронов за период", fNum(d.total_neurons))}${stat("Запросов к ИИ", fNum(d.total_requests))}${stat("Оплата сверх бесплатного", fUsd(d.usd_over_free), "по нашему подсчёту")}${stat("На одного пользователя", fNum(d.per_user, 1), "нейронов за период")}</div>
      <div class="card mt"><div class="card-head"><h2>Точные данные Cloudflare</h2><button class="btn soft sm" id="cf-load">${ic("refresh", "sm")}<span>Загрузить из Cloudflare</span></button></div>
        <div id="cf">${cfBlock(cf)}</div></div>
      <div class="card mt"><div class="card-head"><h2>Нейроны по дням (UTC)</h2></div>
        ${chart({ type: "bars", labels: d.per_day.map((x) => x.day), series: [{ name: "Нейроны", values: d.per_day.map((x) => x.neurons) }], ref: { value: d.free_per_day, label: "Бесплатный лимит" } })}</div>
      <div class="card mt"><div class="card-head"><h2>По типу запроса</h2>${csvBtn("kinds")}</div>${table({ columns: [
        { key: "kind", label: "Тип", render: (r) => AI_KIND[r.kind] || r.kind }, { key: "requests", label: "Запросов", cls: "r" }, { key: "error_pct", label: "Ошибок", cls: "r", render: (r) => pct(r.error_pct) },
        { key: "ms", label: "Время", cls: "r", render: (r) => `${(r.ms / 1000).toFixed(1)} с` }, { key: "tin", label: "Токенов вход", cls: "r", render: (r) => fNum(r.tin) },
        { key: "tout", label: "Токенов выход", cls: "r", render: (r) => fNum(r.tout) }, { key: "neurons", label: "Нейроны", cls: "r", render: (r) => fNum(r.neurons, 1) }, { key: "usd", label: "≈ $", cls: "r", render: (r) => fUsd(r.usd) },
      ], rows: d.kinds, empty: "Запросов к ИИ не было" })}</div>
      <div class="card mt"><div class="card-head"><h2>По моделям</h2></div>${table({ columns: [
        { key: "model", label: "Модель", render: (r) => modelLabel(r.model) }, { key: "requests", label: "Запросов", cls: "r" },
        { key: "error_pct", label: "Ошибок", cls: "r", render: (r) => pct(r.error_pct) }, { key: "ms", label: "Время", cls: "r", render: (r) => `${(r.ms / 1000).toFixed(1)} с` },
        { key: "neurons", label: "Нейроны", cls: "r", render: (r) => fNum(r.neurons, 1) },
      ], rows: d.models || [], empty: "Запросов к ИИ не было" })}</div>
      <div class="card mt"><div class="card-head"><h2>Кто больше всех расходует</h2></div>${table({ columns: [
        { key: "name", label: "Пользователь", render: (r) => html`<a href="#/users/${r.uid}">${r.name || r.uid}</a>` }, { key: "requests", label: "Запросов", cls: "r" }, { key: "neurons", label: "Нейроны", cls: "r", render: (r) => fNum(r.neurons, 1) },
      ], rows: d.users })}</div>`;
  },
  channels: (d) => html`<div class="card"><div class="card-head"><h2>Бот, мини-приложение, сайт</h2></div>${table({ columns: [
    { key: "source", label: "Канал", render: (r) => SOURCES[r.source] || (r.source === "—" ? "До запуска аналитики" : r.source) }, { key: "users", label: "Пользователей", cls: "r" },
    { key: "events", label: "Действий", cls: "r" }, { key: "finished", label: "Приёмов", cls: "r" }, { key: "rating", label: "Оценка", cls: "r", render: (r) => r.rating ?? "—" },
  ], rows: d.channels })}</div>`,
  heatmap: (d) => html`<div class="card"><div class="card-head"><h2>Когда пользователи активны (МСК)</h2></div><p class="small muted mb">Лучшее время для напоминаний и рассылок — самые тёмные клетки.</p>${heatmap(d.grid)}</div>`,
  errors: (d) => html`<div class="card"><div class="card-head"><h2>Ошибки по типам</h2></div>${hbars(d.groups.map((g) => ({ label: ERR[g.type] || g.type, value: g.n, color: "var(--s8)" })))}</div>
    <div class="card mt pad-0"><div class="card-head" style="padding:14px 16px 0"><h2>Все ошибки</h2>${csvBtn("errs")}</div>${table({ columns: [
      { key: "ts", label: "Когда", render: (r) => html`<span class="nowrap">${fDT(r.ts)}</span>` }, { key: "type", label: "Тип", render: (r) => html`<span class="badge danger">${ERR[r.type] || r.type}</span>` },
      { key: "name", label: "Пользователь", render: (r) => (r.uid ? html`<a href="#/users/${r.uid}">${r.name || r.uid}</a>` : "—") },
      { key: "text", label: "Текст", render: (r) => html`<span class="small">${r.text || "—"}</span>` },
      { key: "a", label: "", render: (r) => html`<button class="btn ghost sm" data-err-task="${r.id}">В задачу</button>` },
    ], rows: d.list, empty: "Ошибок нет" })}</div>`,
};

const AI_KIND = { patient: "Новый пациент", reply: "Ответ пациента", test: "Обследование", exam: "Осмотр", farewell: "Прощание", evaluation: "Разбор эксперта", quiz: "Тест", voice: "Голос (Whisper)", sections: "Разделы специальности", summarize: "Сжатие диалога", admin_summary: "Сводка отзывов", other: "Прочее" };
const ERR = { ai_error: "Сбой ИИ у пользователя", patient_failed: "Пациент не создан", pay_error: "Ошибка оплаты", stt_error: "Голос не распознан", bot_blocked: "Бот заблокирован", telegram: "Telegram не доставил" };

const MODEL_NAMES = {
  "@cf/qwen/qwen3-30b-a3b-fp8": "Qwen3 30B (Cloudflare)", "@cf/meta/llama-3.3-70b-instruct-fp8-fast": "Llama 3.3 70B (Cloudflare)",
  "@cf/openai/whisper-large-v3-turbo": "Whisper (Cloudflare)", "cerebras:gpt-oss-120b": "GPT-OSS 120B (Cerebras, запасной)", "groq:openai/gpt-oss-120b": "GPT-OSS 120B (Groq, запасной)",
};
const modelLabel = (m) => MODEL_NAMES[m] || m;

/** Модели по шагам приёма + порог перехода на запасной ИИ */
function aiSetup(st) {
  if (!st) return "";
  const opts = (sel) => Object.entries(st.models).map(([k, m]) => html`<option value="${k}" ${sel === k ? "selected" : ""}>${m.label}</option>`);
  return html`<div class="card-head"><h2>Модели по шагам</h2>
      ${st.cf_blocked ? html`<span class="badge warn dot">Сегодня работает запасной ИИ</span>` : html`<span class="badge ok dot">Cloudflare · ${fNum(st.used_today)} нейронов сегодня</span>`}</div>
    <p class="small muted mb">${Object.values(st.models).map((m) => `${m.label} — ${m.note}`).join(" · ")}. Изменения применяются в течение минуты.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px">
      ${Object.entries(st.steps).map(([k, label]) => html`<label class="small"><span class="muted">${label}</span>
        <select class="input" data-ai-step="${k}">${opts(st.routing[k])}</select></label>`)}
    </div>
    <div class="mt small" style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
      <label><span class="muted">Порог нейронов в сутки для перехода на запасной ИИ (0 — не переходить)</span>
        <input class="input" type="number" min="0" max="100000" step="100" id="ai-cap" value="${st.cap}" style="width:140px"></label>
      <button class="btn sm" id="ai-save">Сохранить</button>
      <button class="btn soft sm" id="ai-all" data-model="llama70">Всё на Llama 70B</button>
      <button class="btn ghost sm" id="ai-reset">По умолчанию</button>
    </div>
    <div class="mt small">Запасной ИИ: ${st.fallbacks.map((f) => html`<span class="badge ${f.configured ? "ok" : ""}">${f.label} — ${f.configured ? "подключён" : html`нет ключа <span class="kbd">${f.secret}</span>`}</span> `)}</div>`;
}

function bindAiSetup(box, st) {
  const el = $("#ai-setup", box);
  if (!el || !st) return;
  const save = (btn, routing, cap) => withBusy(btn, async () => {
    const r = await q("ai_models_set", { routing, cap });
    el.innerHTML = str(aiSetup(r));
    bindAiSetup(box, r);
    toast("Модели сохранены");
  });
  const current = () => Object.fromEntries($$("[data-ai-step]", el).map((s) => [s.dataset.aiStep, s.value]));
  $("#ai-save", el).onclick = (e) => save(e.currentTarget, current(), $("#ai-cap", el).value);
  $("#ai-all", el).onclick = (e) => save(e.currentTarget, Object.fromEntries(Object.keys(st.steps).map((k) => [k, e.currentTarget.dataset.model])), $("#ai-cap", el).value);
  $("#ai-reset", el).onclick = (e) => save(e.currentTarget, st.defaults, st.cap_default);
}

function cfBlock(cf) {
  if (!S.info.cf_configured) {
    return html`<div class="callout warn small">Доступ к API Cloudflare не настроен. Нужен токен Cloudflare с правом <b>Account Analytics: Read</b>. По умолчанию используется деплойный <span class="kbd">CLOUDFLARE_API_TOKEN</span> — проверьте, что у него есть это право, и перезапустите деплой.</div>`;
  }
  if (!cf) return html`<p class="small muted">Нажмите «Загрузить из Cloudflare», чтобы получить точный расход за выбранный период.</p>`;
  if (cf.error) return html`<div class="callout warn small">${cf.error}</div>`;
  return html`<div class="tiles">${stat("Нейронов (Cloudflare)", fNum(cf.total_neurons))}${stat("Сверх бесплатного", fUsd(cf.usd_over_free))}${stat("Обновлено", fAgo(cf.fetched_at))}</div>
    ${cf.days?.length ? html`<div class="mt">${table({ columns: [
      { key: "day", label: "Сутки (UTC)" }, { key: "requests", label: "Запросов", cls: "r" }, { key: "neurons", label: "Нейроны", cls: "r", render: (r) => fNum(r.neurons) },
      { key: "over", label: "Сверх лимита", cls: "r", render: (r) => fNum(r.over) }, { key: "usd", label: "$", cls: "r", render: (r) => fUsd(r.usd) },
    ], rows: [...cf.days].reverse() })}</div>` : html`<p class="small muted mt">За период расхода нет.</p>`}`;
}

const BIND = {
  retention: (box, d) => bindCsv(box, { ret: () => ["retention", [{ key: "week", label: "Неделя" }, { key: "size", label: "Людей" }, ...Array.from({ length: 9 }, (_, k) => ({ label: `Н${k}`, value: (r) => r.weeks[k] })), { key: "d1", label: "D1" }, { key: "d7", label: "D7" }, { key: "d14", label: "D14" }, { key: "d30", label: "D30" }], d.cohorts] }),
  quality: (box, d) => {
    const cols = [{ key: "key", label: "Группа" }, { key: "count", label: "Приёмов" }, { key: "avg", label: "Оценка" }, { key: "correct_pct", label: "Верный диагноз, %" }, { key: "diagnosis", label: "Диагностика" }, { key: "communication", label: "Общение" }, { key: "treatment", label: "Лечение" }];
    bindCsv(box, { sec: () => ["quality-sections", cols, d.by_section], prof: () => ["quality-professions", cols, d.by_profession], lvl: () => ["quality-levels", cols, d.by_level] });
  },
  procedures: (box, d) => {
    const cols = [{ key: "name", label: "Название" }, { key: "custom", label: "Свой", value: (r) => (r.custom ? "да" : "") }, { key: "count", label: "Раз" }, { key: "avg_rating", label: "Оценка" }, { key: "avg_ms", label: "Мс" }];
    bindCsv(box, { tests: () => ["tests", cols, d.tests], exams: () => ["exams", cols, d.exams] });
  },
  specialties: (box, d) => bindCsv(box, {
    profs: () => ["professions", [{ key: "name", label: "Специальность" }, { key: "users", label: "Врачей" }, { key: "cons", label: "Приёмов" }, { key: "rating", label: "Оценка" }], d.professions],
    secs: () => ["sections", [{ key: "name", label: "Раздел" }, { key: "users", label: "Врачей" }, { key: "custom", label: "Свой", value: (r) => (r.custom ? "да" : "") }], d.sections],
  }),
  quizzes: (box, d) => bindCsv(box, { hard: () => ["quiz-questions", [{ key: "question", label: "Вопрос" }, { key: "answers", label: "Ответов" }, { key: "wrong_pct", label: "Ошибок, %" }], d.hardest] }),
  money: (box, d) => bindCsv(box, { plans: () => ["revenue", [{ key: "label", label: "Тариф" }, { key: "count", label: "Оплат" }, { key: "sum", label: "Сумма" }], d.by_plan] }),
  ai: (box, d) => {
    bindCsv(box, { kinds: () => ["ai-kinds", [{ key: "kind", label: "Тип", value: (r) => AI_KIND[r.kind] || r.kind }, { key: "requests", label: "Запросов" }, { key: "errors", label: "Ошибок" }, { key: "ms", label: "Мс" }, { key: "tin", label: "Токенов вход" }, { key: "tout", label: "Токенов выход" }, { key: "neurons", label: "Нейроны" }, { key: "usd", label: "$" }], d.kinds] });
    bindAiSetup(box, d.setup);
    const b = $("#cf-load", box);
    if (b) b.onclick = () => withBusy(b, async () => {
      const r = await api("POST", "/ai/cloudflare", { from: S.period.from, to: S.period.to });
      $("#cf", box).innerHTML = str(cfBlock(r));
    });
  },
  errors: (box, d) => {
    bindCsv(box, { errs: () => ["errors", [{ key: "ts", label: "Когда", value: (r) => fDT(r.ts) }, { key: "type", label: "Тип", value: (r) => ERR[r.type] || r.type }, { key: "uid", label: "uid" }, { key: "name", label: "Имя" }, { key: "text", label: "Текст" }], d.list] });
    $$("[data-err-task]", box).forEach((b) => (b.onclick = () => {
      const e = d.list.find((x) => x.id === b.dataset.errTask);
      newTaskFrom({ title: `Ошибка: ${ERR[e.type] || e.type}`, descr: `${fDT(e.ts)} · ${e.name || e.uid || ""}\n${e.text}`, type: "bug", links: e.uid ? [{ kind: "user", id: e.uid, label: e.name || e.uid }] : [] });
    }));
  },
};

export { store };
