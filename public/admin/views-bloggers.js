// Блогеры в партнёрке: воронка переговоров, план запуска, инструкция, шаблоны сообщений, итоги
import { S, $, $$, q, html, str, raw, ic, fDT, fDate, fRub, fNum, plural, toast, table, withBusy, openModal, confirmDialog, mskDay, mskDayStart, debounce } from "./core.js";
import { STAGES, STAGE_LABEL, PLATFORMS, SEGMENTS, OFFERS, CHECKLIST, PLAN, GUIDE, TEMPLATES } from "./bloggers-guide.js";
import { grantModal } from "./views-ops.js";

const TABS = [["board", "Воронка"], ["plan", "План запуска"], ["guide", "Инструкция"], ["templates", "Шаблоны"], ["results", "Итоги"]];
const DAY = 86400000;
const pct = (r) => `${Math.round(Number(r || 0) * 100)}%`;
const adminName = (id) => S.admins.find((a) => String(a.id) === String(id))?.name || "";
const checkDone = (b) => CHECKLIST.filter((c) => b.checklist?.[c.key]).length;
const overdue = (b) => b.next_at && b.next_at < Date.now() && b.stage !== "lost";
const dayInput = (ts) => (ts ? mskDay(ts) : "");
// Дата из поля → конец этого дня по Москве (шаг просрочен, только когда день прошёл)
const endOfDay = (day) => (day ? mskDayStart(day) + DAY - 1 : null);

function fillTpl(text, b) {
  const name = String(b?.name || "").split(" ")[0] || "";
  return text
    .replace(/\{имя\}/g, name || "{имя}")
    .replace(/\{канал\}/g, b?.handle || b?.name || "{канал}")
    .replace(/\{ссылка\}/g, b?.links?.site || "{ссылка}")
    .replace(/\{бот\}/g, b?.links?.bot || "{бот}")
    .replace(/\{erid\}/g, b?.erid || "{erid}");
}

function copy(text) {
  navigator.clipboard.writeText(text).then(() => toast("Скопировано", "ok"), () => toast("Не удалось скопировать — выделите текст вручную", "error"));
}

export async function viewBloggers(el, ctx) {
  const d = await q("bloggers");
  if (!ctx.isCurrent()) return;
  const tab = TABS.some(([k]) => k === S.route.q.tab) ? S.route.q.tab : "board";
  const rows = d.rows;
  const active = rows.filter((b) => b.stage !== "lost");
  const sum = (k) => rows.reduce((s, b) => s + (b.stats?.[k] || 0), 0);
  const late = rows.filter(overdue).length;
  const head = html`<div class="tabs">${TABS.map(([k, l]) => html`<a href="#/bloggers?tab=${k}" class="${tab === k ? "on" : ""}">${l}${k === "board" && late ? html` <span class="badge danger">${late}</span>` : ""}</a>`)}</div>`;
  const tiles = html`<div class="tiles compact mb">
    <div class="tile"><div class="label">В работе</div><div class="value">${fNum(active.length)}</div><div class="sub">всего карточек ${rows.length}</div></div>
    <div class="tile"><div class="label">Интеграций вышло</div><div class="value">${fNum(rows.filter((b) => b.stage === "published" || b.stage === "repeat").length)}</div></div>
    <div class="tile"><div class="label">Пришло по ссылкам</div><div class="value">${fNum(sum("invited"))}</div><div class="sub">начали принимать ${fNum(sum("active"))}</div></div>
    <div class="tile"><div class="label">Оплатили</div><div class="value">${fNum(sum("paying"))}</div></div>
    <div class="tile"><div class="label">Выручка</div><div class="value">${fRub(sum("revenue"))}</div><div class="sub">блогерам ${fRub(sum("earned"))}</div></div>
    <div class="tile"><div class="label">Просрочено шагов</div><div class="value" style="${late ? "color:var(--danger)" : ""}">${fNum(late)}</div></div>
  </div>`;
  const reload = () => viewBloggers(el, ctx);

  if (tab === "board") return renderBoard(el, d, head, html`${goalCard(d.goal)}${tiles}`, reload);
  if (tab === "plan") return renderPlan(el, d, head, reload);
  if (tab === "guide") return renderGuide(el, head);
  if (tab === "templates") return renderTemplates(el, d, head);
  return renderResults(el, d, head, tiles);
}

// ---------------------------------------------------------------- цель месяца
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

function goalCard(g) {
  if (!g) return "";
  const left = Math.max(0, g.target - g.done);
  const daysLeft = Math.max(1, Math.ceil((g.to - Date.now()) / DAY));
  const daysTotal = Math.round((g.to - g.from) / DAY);
  const expected = Math.round((g.target * (daysTotal - daysLeft + 1)) / daysTotal);
  const behind = g.done < expected && left > 0;
  const month = MONTHS[Number(g.month.slice(5, 7)) - 1];
  return html`<div class="card mb">
    <div class="row wrap"><b class="grow">Цель на ${month}: написать ${fNum(g.target)} ${plural(g.target, "блогеру", "блогерам", "блогерам")}</b>
      <span class="small"><b>${fNum(g.done)}</b> из ${fNum(g.target)}</span>
      <button class="btn ghost sm" id="bl-goal" title="Изменить цель месяца">${ic("edit", "sm")}</button></div>
    <div class="progress mt-sm"><i style="width:${Math.min(100, Math.round((g.done / g.target) * 100))}%"></i></div>
    <div class="tiny mt-sm ${behind ? "" : "muted"}" style="${behind ? "color:var(--warn)" : ""}">${left
      ? html`Осталось ${fNum(left)} за ${daysLeft} ${plural(daysLeft, "день", "дня", "дней")} — по ${fNum(Math.ceil(left / daysLeft))} в день. ${behind ? `По плану к сегодня было бы ${expected}.` : "Идём по плану."}`
      : "Цель месяца выполнена 🎉"} Считаются карточки, которым в этом месяце впервые написали (этап дальше «Найден» или отмечен пункт «первое сообщение»).</div>
  </div>`;
}

// ---------------------------------------------------------------- воронка
const boardState = { search: "", platform: "", mine: false, lost: false };

function renderBoard(el, d, head, tiles, reload) {
  const st = boardState;
  const match = (b) => {
    if (st.platform && b.platform !== st.platform) return false;
    if (st.mine && String(b.owner) !== String(S.me.id)) return false;
    if (st.search) {
      const s = st.search.toLowerCase();
      if (![b.name, b.handle, b.niche, b.contact, b.url].some((x) => String(x || "").toLowerCase().includes(s))) return false;
    }
    return true;
  };
  const stages = STAGES.filter((s) => st.lost || s.key !== "lost");
  const list = d.rows.filter(match);
  el.innerHTML = str(html`${head}${tiles}
    <div class="page-head">
      <input class="input" id="bl-search" placeholder="Поиск: имя, ник, ниша" value="${st.search}" style="max-width:240px">
      <select class="input" id="bl-platform" style="max-width:190px"><option value="">Все площадки</option>${Object.entries(PLATFORMS).map(([k, l]) => html`<option value="${k}" ${st.platform === k ? "selected" : ""}>${l}</option>`)}</select>
      <label class="check small"><input type="checkbox" id="bl-mine" ${st.mine ? "checked" : ""}> Мои</label>
      <label class="check small grow"><input type="checkbox" id="bl-lost" ${st.lost ? "checked" : ""}> Показать отказы</label>
      <button class="btn" id="bl-add">${ic("plus", "sm")}<span>Добавить блогера</span></button>
    </div>
    ${d.rows.length ? "" : html`<div class="callout mb">Начните с вкладки <a href="#/bloggers?tab=guide">«Инструкция»</a>, затем добавьте первых кандидатов: имя, ссылку, площадку и подписчиков. Перетаскивайте карточки между колонками, когда меняется этап.</div>`}
    <div class="board bl" style="grid-template-columns:repeat(${stages.length}, minmax(220px, 1fr))">
      ${stages.map((s) => {
        const items = list.filter((b) => b.stage === s.key);
        return html`<div class="col" data-stage="${s.key}">
          <div class="col-head" title="${s.hint}">${s.label}<span class="badge">${items.length}</span></div>
          ${items.map(card)}
          ${items.length ? "" : html`<div class="tiny muted" style="padding:4px">${s.hint}</div>`}
        </div>`;
      })}
    </div>`);
  $("#bl-search").oninput = debounce((e) => { st.search = e.target.value.trim(); renderBoard(el, d, head, tiles, reload); $("#bl-search")?.focus(); const i = $("#bl-search"); if (i) i.selectionStart = i.selectionEnd = i.value.length; }, 250);
  $("#bl-platform").onchange = (e) => { st.platform = e.target.value; renderBoard(el, d, head, tiles, reload); };
  $("#bl-mine").onchange = (e) => { st.mine = e.target.checked; renderBoard(el, d, head, tiles, reload); };
  $("#bl-lost").onchange = (e) => { st.lost = e.target.checked; renderBoard(el, d, head, tiles, reload); };
  $("#bl-add").onclick = () => bloggerModal(null, reload);
  const goalBtn = $("#bl-goal");
  if (goalBtn) goalBtn.onclick = async () => {
    const v = prompt("Сколько блогерам написать в этом месяце?", String(d.goal?.target || 100));
    if (v === null) return;
    try { await q("bloggers_goal", { target: Number(v) }); reload(); } catch (e) { toast(e.message, "error"); }
  };
  $$("[data-bid]", el).forEach((c) => {
    c.onclick = () => bloggerModal(d.rows.find((b) => String(b.id) === c.dataset.bid), reload);
    c.ondragstart = (e) => { e.dataTransfer.setData("text/plain", c.dataset.bid); c.classList.add("dragging"); };
    c.ondragend = () => c.classList.remove("dragging");
  });
  $$(".col[data-stage]", el).forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("drop"); };
    col.ondragleave = () => col.classList.remove("drop");
    col.ondrop = async (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      const id = e.dataTransfer.getData("text/plain");
      const b = d.rows.find((x) => String(x.id) === id);
      if (!b || b.stage === col.dataset.stage) return;
      const args = { id: b.id, stage: col.dataset.stage };
      if (args.stage === "lost") {
        const reason = prompt("Причина отказа (не ответил, нужен только фикс, аудитория не медики…)");
        if (reason === null) return;
        args.lost_reason = reason;
      }
      try {
        await q("blogger_save", args);
        toast(`${b.name || b.handle}: ${STAGE_LABEL[args.stage]}`, "ok");
        reload();
      } catch (err) { toast(err.message, "error"); }
    };
  });
}

function card(b) {
  const done = checkDone(b);
  const s = b.stats;
  return html`<div class="tcard" draggable="true" data-bid="${b.id}">
    <div class="ttl">${b.name || b.handle}</div>
    <div class="tiny muted">${[b.handle && b.name ? b.handle : "", PLATFORMS[b.platform] || "", b.audience ? `${fNum(b.audience)} подп.` : ""].filter(Boolean).join(" · ")}</div>
    ${b.next_action || b.next_at ? html`<div class="tiny mt-sm" style="${overdue(b) ? "color:var(--danger);font-weight:600" : ""}">${ic("clock", "sm")} ${b.next_at ? fDate(b.next_at) : ""}${b.next_action ? ` — ${b.next_action}` : ""}</div>` : ""}
    ${b.stage === "lost" && b.lost_reason ? html`<div class="tiny muted mt-sm">${b.lost_reason}</div>` : ""}
    <div class="row mt-sm" style="gap:6px"><div class="progress grow"><i style="width:${Math.round((done / CHECKLIST.length) * 100)}%"></i></div><span class="tiny muted">${done}/${CHECKLIST.length}</span></div>
    ${s ? html`<div class="tiny mt-sm row wrap" style="gap:8px"><span title="Пришли по ссылке">${ic("users", "sm")} ${fNum(s.invited)}</span><span title="Оплатили">${ic("card", "sm")} ${fNum(s.paying)}</span><span title="Выручка">${fRub(s.revenue)}</span>${s.partner?.status === "active" ? html`<span class="badge ok">партнёр</span>` : html`<span class="badge warn">не партнёр</span>`}</div>` : ""}
    ${b.owner ? html`<div class="tiny muted mt-sm">${adminName(b.owner)}</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- карточка блогера
function bloggerModal(b, onDone) {
  const isNew = !b;
  b = b || { stage: "found", platform: "telegram", segment: "students", offer: "revshare", rate: 0.5, owner: S.me.id, checklist: {} };
  let checklist = { ...(b.checklist || {}) };
  const opt = (map, cur) => Object.entries(map).map(([k, l]) => html`<option value="${k}" ${cur === k ? "selected" : ""}>${l}</option>`);
  const s = b.stats;
  const partnerBlock = !isNew && b.uid ? html`<div class="card flat stack-sm">
      <div class="row wrap"><b class="grow">Партнёр: <a href="#/users/${b.uid}" data-close-link>${s?.user?.name || b.uid}</a>${s?.user?.username ? html` <span class="muted">@${s.user.username}</span>` : ""}</b>
        ${s?.partner?.status === "active" ? html`<span class="badge ok">партнёр · ${pct(s.partner.rate)}</span>` : s?.partner?.status === "applied" ? html`<span class="badge warn">заявка подана</span>` : html`<span class="badge">не партнёр</span>`}</div>
      <div class="tiles compact" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">
        <div class="tile"><div class="label">Пришло</div><div class="value">${fNum(s?.invited)}</div>${b.post_at ? html`<div class="sub">после поста ${fNum(s?.after_post)}</div>` : ""}</div>
        <div class="tile"><div class="label">Начали принимать</div><div class="value">${fNum(s?.active)}</div></div>
        <div class="tile"><div class="label">Оплатили</div><div class="value">${fNum(s?.paying)}</div></div>
        <div class="tile"><div class="label">Выручка</div><div class="value">${fRub(s?.revenue)}</div><div class="sub">блогеру ${fRub(s?.earned)}</div></div>
      </div>
      ${b.links ? html`<div class="stack-sm small">
        <div class="row"><span class="muted" style="min-width:110px">Ссылка для поста</span><code class="grow ellipsis">${b.links.site}</code><button class="btn ghost sm" data-copy="${b.links.site}">${ic("copy", "sm")}</button></div>
        <div class="row"><span class="muted" style="min-width:110px">Ссылка на бота</span><code class="grow ellipsis">${b.links.bot}</code><button class="btn ghost sm" data-copy="${b.links.bot}">${ic("copy", "sm")}</button></div>
      </div>` : ""}
      <div class="row wrap" style="gap:6px">
        ${s?.partner?.status !== "active" ? html`<button class="btn sm" id="bl-approve">${ic("handshake", "sm")}<span>Одобрить партнёром</span></button>` : ""}
        <button class="btn ghost sm" id="bl-grant">${ic("gift", "sm")}<span>Выдать премиум на тест</span></button>
        ${s?.last_at ? html`<span class="tiny muted">последний приглашённый ${fDate(s.last_at)}</span>` : ""}
      </div>
    </div>` : html`<p class="small muted">Когда автор зайдёт в бота или приложение, впишите его @username или uid в поле «Пользователь» — появятся ссылка для поста, статистика и одобрение партнёром.</p>`;

  const { el: m, close } = openModal({
    title: isNew ? "Новый блогер" : b.name || b.handle,
    wide: true,
    body: html`<div class="stack">
      <div class="grid c2">
        <label class="field"><span>Имя</span><input class="input" id="f-name" value="${b.name || ""}" placeholder="Анна Смирнова"></label>
        <label class="field"><span>Ник или название канала</span><input class="input" id="f-handle" value="${b.handle || ""}" placeholder="@medstudent_notes"></label>
        <label class="field"><span>Площадка</span><select class="input" id="f-platform">${opt(PLATFORMS, b.platform)}</select></label>
        <label class="field"><span>Ссылка на канал</span><input class="input" id="f-url" value="${b.url || ""}" placeholder="https://t.me/…"></label>
        <label class="field"><span>Подписчики</span><input class="input" id="f-audience" type="number" min="0" value="${b.audience || ""}"></label>
        <label class="field"><span>Средний охват поста</span><input class="input" id="f-reach" type="number" min="0" value="${b.reach || ""}"></label>
        <label class="field"><span>Аудитория</span><select class="input" id="f-segment">${opt(SEGMENTS, b.segment)}</select></label>
        <label class="field"><span>Контакт для связи</span><input class="input" id="f-contact" value="${b.contact || ""}" placeholder="@username, почта, менеджер"></label>
      </div>
      <label class="field"><span>Ниша и почему подходит</span><input class="input" id="f-niche" value="${b.niche || ""}" placeholder="Подготовка к аккредитации, 4–6 курс, живые комментарии"></label>
      <div class="grid c3">
        <label class="field"><span>Этап</span><select class="input" id="f-stage">${STAGES.map((x) => html`<option value="${x.key}" ${b.stage === x.key ? "selected" : ""}>${x.label}</option>`)}</select></label>
        <label class="field"><span>Ответственный</span><select class="input" id="f-owner"><option value="">—</option>${S.admins.map((a) => html`<option value="${a.id}" ${String(b.owner) === String(a.id) ? "selected" : ""}>${a.name}</option>`)}</select></label>
        <label class="field"><span>Оффер</span><select class="input" id="f-offer">${opt(OFFERS, b.offer)}</select></label>
      </div>
      <div class="grid c3">
        <label class="field" style="grid-column:span 2"><span>Следующий шаг</span><input class="input" id="f-next" value="${b.next_action || ""}" placeholder="Напомнить, если не ответит"></label>
        <label class="field"><span>Срок</span><input class="input" id="f-next-at" type="date" value="${dayInput(b.next_at)}"></label>
      </div>
      <div class="grid c3">
        <label class="field"><span>Фикс за пост, ₽</span><input class="input" id="f-fee" type="number" min="0" value="${b.fee || ""}"></label>
        <label class="field"><span>Ставка партнёра, %</span><input class="input" id="f-rate" type="number" min="0" max="90" value="${b.rate != null ? Math.round(b.rate * 100) : 50}"></label>
        <label class="field"><span>ERID</span><input class="input" id="f-erid" value="${b.erid || ""}" placeholder="2Vtzq…"></label>
        <label class="field" style="grid-column:span 2"><span>Ссылка на публикацию</span><input class="input" id="f-post-url" value="${b.post_url || ""}"></label>
        <label class="field"><span>Дата публикации</span><input class="input" id="f-post-at" type="date" value="${dayInput(b.post_at)}"></label>
      </div>
      <label class="field ${b.stage === "lost" ? "" : "hidden"}" id="f-lost-wrap"><span>Причина отказа</span><input class="input" id="f-lost" value="${b.lost_reason || ""}" placeholder="Не ответил / нужен только фикс / аудитория не медики"></label>
      <label class="field"><span>Пользователь (@username или uid)</span><input class="input" id="f-uid" value="${b.uid || ""}" placeholder="Появится после того, как автор зайдёт в бота"></label>
      ${partnerBlock}
      <div class="field"><span class="label">Чек-лист <span id="f-check-n" class="muted"></span></span><div class="stack-sm" id="f-check"></div></div>
      <label class="field"><span>Заметки</span><textarea class="input" id="f-notes" rows="3" placeholder="Условия, договорённости, что важно автору">${b.notes || ""}</textarea></label>
      ${isNew ? "" : html`<div class="field"><span class="label">История</span>
        <div class="row"><input class="input grow" id="f-note-new" placeholder="Что произошло: написал, ответил, созвонились…"><button class="btn ghost" id="f-note-add">Добавить</button></div>
        <div class="stack-sm small" id="f-log"><span class="muted tiny">Загружаем…</span></div></div>`}
    </div>`,
    foot: html`${isNew ? "" : html`<button class="btn ghost danger" id="f-del">${ic("trash", "sm")}<span>Удалить</span></button>`}<span class="grow"></span><button class="btn ghost" data-close>Отмена</button><button class="btn" id="f-save">${isNew ? "Добавить" : "Сохранить"}</button>`,
  });

  const drawCheck = () => {
    $("#f-check", m).innerHTML = str(CHECKLIST.map((c) => html`<label class="check small"><input type="checkbox" data-ck="${c.key}" ${checklist[c.key] ? "checked" : ""}> <span style="${checklist[c.key] ? "text-decoration:line-through;opacity:.6" : ""}">${c.text}</span></label>`));
    $("#f-check-n", m).textContent = `${CHECKLIST.filter((c) => checklist[c.key]).length} из ${CHECKLIST.length}`;
    $$("[data-ck]", m).forEach((c) => (c.onchange = () => { checklist[c.dataset.ck] = c.checked; drawCheck(); }));
  };
  drawCheck();
  $("#f-stage", m).onchange = (e) => $("#f-lost-wrap", m).classList.toggle("hidden", e.target.value !== "lost");
  $$("[data-copy]", m).forEach((x) => (x.onclick = () => copy(x.dataset.copy)));
  $$("[data-close-link]", m).forEach((a) => a.addEventListener("click", () => close(true)));

  const collect = () => {
    const v = (id) => $(`#${id}`, m).value.trim();
    return {
      ...(isNew ? {} : { id: b.id }),
      name: v("f-name"), handle: v("f-handle"), platform: v("f-platform"), url: v("f-url"),
      audience: v("f-audience"), reach: v("f-reach"), segment: v("f-segment"), contact: v("f-contact"), niche: v("f-niche"),
      stage: v("f-stage"), owner: v("f-owner"), offer: v("f-offer"), next_action: v("f-next"), next_at: endOfDay(v("f-next-at")),
      fee: v("f-fee"), rate: v("f-rate") === "" ? "" : Number(v("f-rate")) / 100, erid: v("f-erid"), post_url: v("f-post-url"),
      post_at: v("f-post-at") ? mskDayStart(v("f-post-at")) : null, lost_reason: v("f-lost"), uid: v("f-uid"), notes: v("f-notes"), checklist,
    };
  };
  $("#f-save", m).onclick = (e) => withBusy(e.currentTarget, async () => {
    const args = collect();
    if (!args.name && !args.handle) return toast("Укажите имя или ник", "error");
    if (args.stage === "lost" && !args.lost_reason) return toast("Укажите причину отказа — она пригодится для выводов", "error");
    await q("blogger_save", args);
    toast(isNew ? "Блогер добавлен" : "Сохранено", "ok");
    close(true);
    onDone();
  });
  if (isNew) return;

  $("#f-del", m).onclick = async () => {
    if (!(await confirmDialog("Удалить карточку?", `«${b.name || b.handle}» и её история удалятся. Статистика партнёра и начисления останутся.`, "Удалить", true))) return;
    await q("blogger_delete", { id: b.id });
    close(true);
    onDone();
  };
  const loadLog = async () => {
    const log = await q("blogger_log", { id: b.id });
    const box = $("#f-log", m);
    if (!box) return;
    box.innerHTML = str(log.length ? log.map((r) => html`<div class="row top"><span class="tiny muted nowrap" style="min-width:110px">${fDT(r.ts)}</span><span class="grow">${r.kind === "stage" ? html`<b>Этап:</b> ${r.text.replace(/\b(found|contacted|talks|agreed|onboarded|published|repeat|lost)\b/g, (k) => STAGE_LABEL[k] || k)}` : r.text}<span class="tiny muted"> · ${adminName(r.admin) || r.admin}</span></span></div>`) : html`<span class="muted tiny">Пока пусто</span>`);
  };
  loadLog();
  $("#f-note-add", m).onclick = (e) => withBusy(e.currentTarget, async () => {
    const text = $("#f-note-new", m).value.trim();
    if (!text) return;
    await q("blogger_note", { id: b.id, text });
    $("#f-note-new", m).value = "";
    loadLog();
  });
  const approve = $("#bl-approve", m);
  if (approve) approve.onclick = (e) => withBusy(e.currentTarget, async () => {
    const rate = Number($("#f-rate", m).value || 50) / 100;
    if (!(await confirmDialog("Сделать партнёром?", `${s?.user?.name || b.uid} получит ${pct(rate)} с каждой оплаты приглашённых, бессрочный премиум и приветственное сообщение в Telegram.`, "Одобрить"))) return;
    await q("partner_decide", { uid: b.uid, status: "active", rate });
    await q("blogger_note", { id: b.id, text: `Одобрен партнёром, ставка ${pct(rate)}` });
    toast("Партнёр одобрен", "ok");
    close(true);
    onDone();
  });
  const grant = $("#bl-grant", m);
  if (grant) grant.onclick = () => grantModal({ uids: [b.uid], name: s?.user?.name || b.name, onDone: () => q("blogger_note", { id: b.id, text: "Выдан премиум на тест" }).then(loadLog) });
}

// ---------------------------------------------------------------- план запуска
function renderPlan(el, d, head, reload) {
  const plan = d.plan || {};
  const all = PLAN.flatMap((p) => p.items);
  const done = all.filter((i) => plan[i.key]).length;
  el.innerHTML = str(html`${head}
    <div class="card mb"><div class="row"><b class="grow">Прогресс запуска</b><span class="muted small">${done} из ${all.length}</span></div>
      <div class="progress mt-sm"><i style="width:${Math.round((done / all.length) * 100)}%"></i></div>
      <p class="small muted mt-sm">Отметки общие для всех админов. Подробности по каждому шагу — во вкладке <a href="#/bloggers?tab=guide">«Инструкция»</a>.</p></div>
    <div class="grid c3">${PLAN.map((p) => {
      const n = p.items.filter((i) => plan[i.key]).length;
      return html`<div class="card"><div class="card-head"><h2>${p.phase}</h2><span class="badge ${n === p.items.length ? "ok" : ""}">${n}/${p.items.length}</span></div>
        <div class="stack-sm">${p.items.map((i) => html`<label class="check small top" style="align-items:flex-start"><input type="checkbox" data-plan="${i.key}" ${plan[i.key] ? "checked" : ""}>
          <span><span style="${plan[i.key] ? "text-decoration:line-through;opacity:.6" : ""}">${i.text}</span>${plan[i.key] ? html`<div class="tiny muted">${adminName(plan[i.key].by) || plan[i.key].by}, ${fDate(plan[i.key].at)}</div>` : ""}</span></label>`)}</div></div>`;
    })}</div>`);
  $$("[data-plan]", el).forEach((c) => (c.onchange = async () => {
    try {
      await q("bloggers_plan", { key: c.dataset.plan, done: c.checked });
      reload();
    } catch (e) { toast(e.message, "error"); c.checked = !c.checked; }
  }));
}

// ---------------------------------------------------------------- инструкция
function renderGuide(el, head) {
  el.innerHTML = str(html`${head}
    <div class="guide-layout">
      <nav class="card guide-toc stack-sm small">${GUIDE.map((g, i) => html`<a href="#" data-goto="${g.id}">${i + 1}. ${g.title}</a>`)}</nav>
      <div class="stack">${GUIDE.map((g, i) => html`<section class="card guide" id="g-${g.id}"><h2>${i + 1}. ${g.title}</h2>${g.body}</section>`)}</div>
    </div>`);
  $$("[data-goto]", el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); $(`#g-${a.dataset.goto}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }));
}

// ---------------------------------------------------------------- шаблоны
const tplState = { blogger: "" };

function renderTemplates(el, d, head) {
  const b = d.rows.find((x) => String(x.id) === tplState.blogger) || null;
  el.innerHTML = str(html`${head}
    <div class="page-head">
      <label class="field" style="min-width:260px"><span>Подставить данные блогера</span>
        <select class="input" id="tpl-b"><option value="">— без подстановки —</option>${d.rows.filter((x) => x.stage !== "lost").map((x) => html`<option value="${x.id}" ${tplState.blogger === String(x.id) ? "selected" : ""}>${x.name || x.handle}${x.handle && x.name ? ` (${x.handle})` : ""}</option>`)}</select></label>
      <p class="small muted grow">Подставляются имя, канал, ссылка для поста, ссылка на бота и ERID из карточки. То, что в [квадратных скобках], впишите сами.</p>
    </div>
    <div class="grid c2">${TEMPLATES.map((t) => {
      const text = fillTpl(t.text, b);
      return html`<div class="card stack-sm"><div class="row"><b class="grow">${t.title}</b><button class="btn ghost sm" data-tpl="${t.key}">${ic("copy", "sm")}<span>Копировать</span></button></div>
        <div class="tiny muted">${t.when}</div><div class="pre small tpl">${text}</div></div>`;
    })}</div>`);
  $("#tpl-b").onchange = (e) => { tplState.blogger = e.target.value; renderTemplates(el, d, head); };
  $$("[data-tpl]", el).forEach((x) => (x.onclick = () => copy(fillTpl(TEMPLATES.find((t) => t.key === x.dataset.tpl).text, b))));
}

// ---------------------------------------------------------------- итоги
// Фикс — расход только когда пост вышел (до публикации он ещё не заплачен)
const posted = (b) => b.stage === "published" || b.stage === "repeat" || !!b.post_at;
const costOf = (b) => (b.stats?.earned || 0) + (posted(b) ? Number(b.fee) || 0 : 0);
function renderResults(el, d, head, tiles) {
  const rows = d.rows;
  const order = STAGES.filter((s) => s.key !== "lost").map((s) => s.key);
  // Сколько карточек дошло хотя бы до этапа (по текущему этапу; отказы — отдельно)
  const reached = order.map((k, i) => ({ k, n: rows.filter((b) => b.stage !== "lost" && order.indexOf(b.stage) >= i).length }));
  const lostReasons = Object.entries(rows.filter((b) => b.stage === "lost").reduce((m, b) => { const r = b.lost_reason || "без причины"; m[r] = (m[r] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const byPlatform = Object.entries(rows.reduce((m, b) => {
    const k = b.platform || "other";
    m[k] ||= { n: 0, pub: 0, invited: 0, paying: 0, revenue: 0, cost: 0 };
    m[k].n++;
    if (b.stage === "published" || b.stage === "repeat") m[k].pub++;
    m[k].invited += b.stats?.invited || 0;
    m[k].paying += b.stats?.paying || 0;
    m[k].revenue += b.stats?.revenue || 0;
    m[k].cost += costOf(b);
    return m;
  }, {})).sort((a, b) => b[1].revenue - a[1].revenue);
  const withStats = rows.filter((b) => b.uid || posted(b)).map((b) => {
    const cost = costOf(b);
    const profit = (b.stats?.revenue || 0) - cost;
    return { ...b, cost, profit, romi: cost ? profit / cost : null, revenue: b.stats?.revenue || 0 };
  }).sort((a, b) => b.revenue - a.revenue);
  const max = reached[0]?.n || 1;
  el.innerHTML = str(html`${head}${tiles}
    <div class="grid c2 mb">
      <div class="card"><div class="card-head"><h2>Воронка</h2><span class="tiny muted">по текущим этапам, без отказов</span></div>
        <div class="stack-sm">${reached.map((r, i) => html`<div><div class="row small"><span class="grow">${STAGE_LABEL[r.k]}</span><b>${fNum(r.n)}</b>${i ? html`<span class="tiny muted" style="min-width:52px;text-align:right">${reached[i - 1].n ? pct(r.n / reached[i - 1].n) : "—"}</span>` : html`<span style="min-width:52px"></span>`}</div>
          <div class="progress"><i style="width:${Math.round((r.n / max) * 100)}%"></i></div></div>`)}</div></div>
      <div class="card"><div class="card-head"><h2>Причины отказов</h2><span class="badge">${rows.filter((b) => b.stage === "lost").length}</span></div>
        ${lostReasons.length ? html`<div class="stack-sm small">${lostReasons.map(([r, n]) => html`<div class="row"><span class="grow">${r}</span><b>${n}</b></div>`)}</div>` : html`<div class="empty">${ic("inbox")}Отказов пока нет</div>`}</div>
    </div>
    <div class="card pad-0 mb"><div class="card-head" style="padding:14px 16px 0"><h2>По площадкам</h2></div>${table({
      columns: [
        { key: "k", label: "Площадка", render: ([k]) => PLATFORMS[k] || k },
        { key: "n", label: "Карточек", cls: "r", render: ([, v]) => fNum(v.n) },
        { key: "pub", label: "Интеграций", cls: "r", render: ([, v]) => fNum(v.pub) },
        { key: "invited", label: "Пришло", cls: "r", render: ([, v]) => fNum(v.invited) },
        { key: "paying", label: "Оплатили", cls: "r", render: ([, v]) => fNum(v.paying) },
        { key: "revenue", label: "Выручка", cls: "r", render: ([, v]) => fRub(v.revenue) },
        { key: "cost", label: "Расходы", cls: "r", render: ([, v]) => fRub(v.cost) },
      ],
      rows: byPlatform, empty: "Добавьте блогеров на вкладке «Воронка»",
    })}</div>
    <div class="card pad-0"><div class="card-head" style="padding:14px 16px 0"><h2>Окупаемость по блогерам</h2><span class="tiny muted">расходы = начисления блогеру + фикс за вышедший пост; окупаемость = (выручка − расходы) / расходы</span></div>${table({
      columns: [
        { key: "name", label: "Блогер", render: (b) => html`<b>${b.name || b.handle}</b><div class="tiny muted">${PLATFORMS[b.platform] || ""}${b.audience ? ` · ${fNum(b.audience)} подп.` : ""}</div>` },
        { key: "stage", label: "Этап", render: (b) => html`<span class="badge">${STAGE_LABEL[b.stage]}</span>` },
        { key: "post_at", label: "Пост", render: (b) => (b.post_at ? html`${b.post_url ? html`<a href="${b.post_url}" target="_blank" rel="noopener">${fDate(b.post_at)}</a>` : fDate(b.post_at)}` : "—") },
        { key: "invited", label: "Пришло", cls: "r", render: (b) => html`${fNum(b.stats?.invited)}${b.post_at && b.stats ? html`<div class="tiny muted">после поста ${fNum(b.stats.after_post)}</div>` : ""}` },
        { key: "paying", label: "Оплатили", cls: "r", render: (b) => fNum(b.stats?.paying) },
        { key: "revenue", label: "Выручка", cls: "r", render: (b) => fRub(b.revenue) },
        { key: "cost", label: "Расходы", cls: "r", render: (b) => html`${fRub(b.cost)}${b.fee ? html`<div class="tiny muted">фикс ${fRub(b.fee)}${posted(b) ? "" : " — после поста"}</div>` : ""}` },
        { key: "romi", label: "Окупаемость", cls: "r", render: (b) => (b.romi == null ? html`<span class="muted">—</span>` : html`<b style="color:${b.romi >= 0 ? "var(--ok)" : "var(--danger)"}">${pct(b.romi)}</b>`) },
      ],
      rows: withStats, empty: "Статистика появится, когда свяжете карточки с аккаунтами блогеров",
    })}</div>`);
}
