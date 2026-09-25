// Подписки и платежи, сообщения и рассылки, отзывы и анкеты, задачи, настройки
import {
  S, $, $$, api, q, html, str, raw, ic, fmt, fNum, fRub, fDT, fDate, fAgo, fTime, plural, toast, table, sortRows, downloadCsv, avatar, subBadge,
  LEVELS, SOURCES, PLAN_LABELS, withBusy, btnBusy, openModal, confirmDialog, debounce, periodPicker, bindPeriod, mskDay, mskDayStart,
} from "./core.js";
import { hbars, renderCharts } from "./charts.js";
import { payStatus, adminName } from "./views-users.js";

const tabsBar = (base, tabs, cur) => html`<div class="tabs">${tabs.map(([k, l, badge]) => html`<a href="#${base}?tab=${k}" class="${cur === k ? "on" : ""}">${l}${badge ? html` <span class="badge danger">${badge}</span>` : ""}</a>`)}</div>`;

// =====================================================
// Выдача подписки (один пользователь или выбранные)
// =====================================================
export function grantModal({ uids, name = "", onDone = () => {} }) {
  const many = uids.length > 1;
  let days = 7;
  openModal({
    title: many ? `Выдать подписку · ${uids.length} ${plural(uids.length, "пользователю", "пользователям", "пользователям")}` : `Выдать подписку${name ? ` · ${name}` : ""}`,
    body: html`
      <div class="field"><label>Срок (добавляется к текущей подписке)</label>
        <div class="seg" id="g-days">${[[1, "1 день"], [7, "Неделя"], [30, "Месяц"], [90, "3 месяца"], ["forever", "Навсегда"], ["custom", "Своё"]].map(([v, l]) => html`<button data-d="${v}" class="${v === 7 ? "on" : ""}">${l}</button>`)}</div>
        <input class="input hidden mt" type="number" min="1" max="3650" id="g-custom" placeholder="Сколько дней"></div>
      <div class="field"><label>Причина (видна только команде)</label>
        <div class="chips mb">${["Подарок", "Компенсация", "Тест", "Партнёр", "Конкурс"].map((r) => html`<button class="chip" data-r="${r}">${r}</button>`)}</div>
        <input class="input" id="g-reason" placeholder="Например: за подробный отзыв"></div>
      <label class="check"><input type="checkbox" id="g-notify" checked> Уведомить в Telegram</label>
      <div class="field" id="g-text-box"><label>Свой текст уведомления (необязательно)</label>
        <textarea class="input" id="g-text" placeholder="Пусто — стандартный текст: «🎁 Вам подарок — безлимитный доступ на {срок}!…»" style="min-height:70px"></textarea>
        <span class="hint">Подстановки: {имя}, {срок}, {до}. Разметка: **жирный**, _курсив_.</span></div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="g-go">${ic("gift", "sm")}<span>Выдать</span></button>`,
    bind: (el, close) => {
      $$("[data-d]", el).forEach((b) => (b.onclick = () => {
        $$("[data-d]", el).forEach((x) => x.classList.toggle("on", x === b));
        days = b.dataset.d === "forever" ? "forever" : b.dataset.d === "custom" ? "custom" : Number(b.dataset.d);
        $("#g-custom", el).classList.toggle("hidden", days !== "custom");
        if (days === "custom") $("#g-custom", el).focus();
      }));
      $$("[data-r]", el).forEach((b) => (b.onclick = () => { $("#g-reason", el).value = b.dataset.r; }));
      $("#g-notify", el).onchange = (e) => $("#g-text-box", el).classList.toggle("hidden", !e.target.checked);
      $("#g-go", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        const d = days === "custom" ? Number($("#g-custom", el).value) : days;
        if (d !== "forever" && !(d >= 1)) return toast("Укажите число дней", "error");
        const body = { action: "grant", days: d, reason: $("#g-reason", el).value.trim(), notify: $("#g-notify", el).checked, text: $("#g-text", el).value.trim() };
        if (many) {
          const r = await api("POST", "/bulk", { uids, ...body });
          toast(`Выдано: ${r.ok}${r.errors.length ? `, ошибок: ${r.errors.length}` : ""}`, r.errors.length ? "error" : "ok");
        } else {
          const r = await api("POST", `/user/${uids[0]}/action`, body);
          toast(r.until === "навсегда" ? "Подписка выдана навсегда" : `Подписка до ${r.until}`, "ok");
        }
        close(true);
        onDone();
      });
    },
  });
}

// =====================================================
// Редактор сообщения: текст, разметка, кнопки, предпросмотр
// =====================================================
const BTN_TYPES = [["new", "Принять пациента"], ["app", "Открыть приложение"], ["plans", "Тарифы"], ["url", "Своя ссылка"]];

function composerHtml({ text = "", buttons = [], allowImage = false, placeholders = false }) {
  return html`
    <div class="field"><label>Текст</label>
      <div class="toolbar">
        <button class="btn ghost sm" data-fmt="b" title="Жирный"><b>Ж</b></button>
        <button class="btn ghost sm" data-fmt="i" title="Курсив"><i>К</i></button>
        <button class="btn ghost sm" data-fmt="a" title="Ссылка">${ic("link", "sm")}</button>
        ${placeholders ? ["{имя}", "{стрик}", "{уровень}"].map((p) => html`<button class="chip" data-ph="${p}">${p}</button>`) : ""}
      </div>
      <textarea class="input" id="cm-text" style="min-height:130px" maxlength="${allowImage ? 4000 : 4000}" placeholder="Текст сообщения. **жирный**, _курсив_, [текст](https://ссылка)">${text}</textarea>
      <span class="hint" id="cm-count"></span></div>
    <div class="field"><label>Кнопки под сообщением</label><div class="stack-sm" id="cm-buttons"></div>
      <button class="btn ghost sm" id="cm-add-btn" style="align-self:flex-start">${ic("plus", "sm")}<span>Кнопка</span></button></div>
    ${allowImage ? html`<div class="field"><label>Картинка (необязательно)</label>
      <div class="row wrap"><label class="btn ghost sm" style="cursor:pointer">${ic("plus", "sm")}<span>Выбрать картинку</span><input type="file" accept="image/*" id="cm-image" hidden></label>
        <span class="small muted ellipsis" id="cm-image-name" style="max-width:220px">не выбрана</span>
        <button class="btn ghost sm icon hidden" id="cm-image-clear" aria-label="Убрать картинку">${ic("x", "sm")}</button></div>
      <span class="hint">С картинкой текст — до 1000 символов.</span></div>` : ""}
    <div class="field"><label>Так увидит пользователь</label><div class="tg-preview"><div class="msg" id="cm-preview"></div><div class="kb" id="cm-kb"></div></div></div>
    <script type="application/json" id="cm-init">${raw(JSON.stringify(buttons).replace(/</g, "\\u003c"))}</script>`;
}

export function mdToHtml(s) {
  return fmt(s)
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(«"])_([^_\n]+)_(?=[\s).,!?:;»"]|$)/gm, "$1<i>$2</i>")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, "<br>");
}
export function htmlToMd(s) {
  return String(s || "").replace(/<b>([\s\S]*?)<\/b>/g, "**$1**").replace(/<i>([\s\S]*?)<\/i>/g, "_$1_")
    .replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, "[$2]($1)").replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function bindComposer(el, { sample = {} } = {}) {
  const ta = $("#cm-text", el);
  let buttons = [];
  try { buttons = JSON.parse($("#cm-init", el)?.textContent || "[]"); } catch {}
  const drawButtons = () => {
    $("#cm-buttons", el).innerHTML = str(buttons.map((b, i) => html`<div class="row wrap" data-bi="${i}">
      <select class="input" data-bt style="width:auto">${BTN_TYPES.map(([k, l]) => html`<option value="${k}" ${b.type === k ? "selected" : ""}>${l}</option>`)}</select>
      <input class="input grow" data-btext value="${b.text || ""}" placeholder="Текст кнопки" maxlength="60" style="min-width:140px">
      ${b.type === "url" ? html`<input class="input grow" data-burl value="${b.url || ""}" placeholder="https://…" style="min-width:160px">` : ""}
      <button class="btn ghost sm icon" data-bdel aria-label="Удалить кнопку">${ic("x", "sm")}</button></div>`));
    $$("[data-bi]", el).forEach((row) => {
      const i = Number(row.dataset.bi);
      $("[data-bt]", row).onchange = (e) => { buttons[i].type = e.target.value; if (!buttons[i].text || BTN_TYPES.some(([, l]) => l === buttons[i].text)) buttons[i].text = BTN_TYPES.find(([k]) => k === e.target.value)[1]; drawButtons(); preview(); };
      $("[data-btext]", row).oninput = (e) => { buttons[i].text = e.target.value; preview(); };
      const u = $("[data-burl]", row);
      if (u) u.oninput = (e) => { buttons[i].url = e.target.value.trim(); };
      $("[data-bdel]", row).onclick = () => { buttons.splice(i, 1); drawButtons(); preview(); };
    });
    $("#cm-add-btn", el).classList.toggle("hidden", buttons.length >= 4);
  };
  const preview = () => {
    let t = ta.value;
    for (const [k, v] of Object.entries({ "{имя}": "Мария", "{стрик}": "5", "{уровень}": "7", "{срок}": "7 дней", "{до}": "2 октября", ...sample })) t = t.split(k).join(v);
    $("#cm-preview", el).innerHTML = t.trim() ? mdToHtml(t) : '<span style="opacity:.5">Текст сообщения…</span>';
    $("#cm-kb", el).innerHTML = str(buttons.filter((b) => b.text).map((b) => html`<span>${b.text}</span>`));
    const n = ta.value.length;
    const img = $("#cm-image", el)?.files?.[0];
    const max = img ? 1000 : 4000;
    $("#cm-count", el).textContent = `${n} / ${max}`;
    $("#cm-count", el).style.color = n > max ? "var(--danger)" : "";
  };
  const wrap = (a, b, ph) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || ph;
    ta.setRangeText(a + sel + b, s, e, "select");
    ta.focus();
    preview();
  };
  $$("[data-fmt]", el).forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    if (b.dataset.fmt === "b") wrap("**", "**", "жирный");
    if (b.dataset.fmt === "i") wrap("_", "_", "курсив");
    if (b.dataset.fmt === "a") {
      const url = prompt("Ссылка (https://…)", "https://");
      if (url && /^https?:\/\//.test(url)) wrap("[", `](${url})`, "текст ссылки");
    }
  }));
  $$("[data-ph]", el).forEach((b) => (b.onclick = (e) => { e.preventDefault(); ta.setRangeText(b.dataset.ph, ta.selectionStart, ta.selectionEnd, "end"); ta.focus(); preview(); }));
  $("#cm-add-btn", el).onclick = (e) => { e.preventDefault(); buttons.push({ type: "new", text: "Принять пациента" }); drawButtons(); preview(); };
  ta.oninput = preview;
  const img = $("#cm-image", el);
  if (img) {
    const clearBtn = $("#cm-image-clear", el);
    img.onchange = () => {
      const f = img.files?.[0];
      if (f && f.size > 8 * 1024 * 1024) { toast("Картинка больше 8 МБ", "error"); img.value = ""; }
      const cur = img.files?.[0];
      $("#cm-image-name", el).textContent = cur ? cur.name : "не выбрана";
      clearBtn.classList.toggle("hidden", !cur);
      preview();
    };
    clearBtn.onclick = (e) => { e.preventDefault(); img.value = ""; img.onchange(); };
  }
  drawButtons();
  preview();
  return {
    get: () => ({ text: ta.value.trim(), buttons: buttons.filter((b) => b.text && (b.type !== "url" || /^https?:\/\//.test(b.url || ""))), image: $("#cm-image", el)?.files?.[0] || null }),
    set: ({ text, buttons: bs }) => { ta.value = text || ""; buttons = bs || []; drawButtons(); preview(); },
  };
}

/** Личное сообщение пользователю от имени бота */
export async function messageComposer(uid, name, onSent = () => {}, { after } = {}) {
  const tpl = await q("templates").catch(() => ({ rows: [] }));
  openModal({
    title: `Сообщение · ${name}`,
    wide: true,
    body: html`${tpl.rows.length ? html`<div class="field"><label>Шаблон</label><select class="input" id="cm-tpl"><option value="">Без шаблона</option>${tpl.rows.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select></div>` : ""}
      ${composerHtml({ allowImage: true, placeholders: false })}
      <div class="callout small">Сообщение придёт от бота. Если пользователь ответит через «Ответить», ответ появится в переписке, и вам придёт уведомление.</div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="cm-send">${ic("send", "sm")}<span>Отправить</span></button>`,
    bind: (el, close) => {
      const c = bindComposer(el, { sample: { "{имя}": String(name).split(" ")[0] } });
      const sel = $("#cm-tpl", el);
      if (sel) sel.onchange = () => {
        const t = tpl.rows.find((x) => String(x.id) === sel.value);
        if (t) c.set({ text: t.text.replace(/\{имя\}/g, String(name).split(" ")[0]), buttons: t.buttons });
      };
      $("#cm-send", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        const m = c.get();
        if (!m.text && !m.image) return toast("Напишите текст", "error");
        let r;
        if (m.image) {
          const fd = new FormData();
          fd.append("text", m.text);
          fd.append("buttons", JSON.stringify(m.buttons));
          fd.append("image", m.image);
          r = await api("POST", `/user/${uid}/message`, fd);
        } else {
          r = await api("POST", `/user/${uid}/message`, { text: m.text, buttons: m.buttons });
        }
        if (!r.ok) return toast(`Telegram не доставил: ${r.error}`, "error");
        close(true);
        toast("Отправлено", "ok");
        if (after) await after();
        onSent();
      });
    },
  });
}

/** Открыть конструктор рассылки с готовым сегментом */
export function openComposer({ filter = {}, label = "" } = {}) {
  sessionStorage.setItem("adm_bc_preset", JSON.stringify({ filter, label }));
  location.hash = "#/messages?tab=new";
}

// =====================================================
// Подписки и платежи
// =====================================================
export async function viewSubs(el, ctx) {
  const tab = ["active", "payments", "errors"].includes(S.route.q.tab) ? S.route.q.tab : "active";
  const head = tabsBar("/subs", [["active", "Активные подписки"], ["payments", "Все платежи"], ["errors", "Ошибки оплаты"]], tab);
  if (tab === "active") {
    const expiring = S.route.q.exp === "1";
    const d = await q("subscriptions", { expiring });
    if (!ctx.isCurrent()) return;
    el.innerHTML = str(html`${head}
      <div class="page-head"><div class="seg grow" style="flex:0 1 auto"><button data-exp="0" class="${expiring ? "" : "on"}">Все</button><button data-exp="1" class="${expiring ? "on" : ""}">Заканчиваются за 3 дня</button></div>
        <span class="muted small grow">${d.rows.length} ${plural(d.rows.length, "подписка", "подписки", "подписок")}</span>
        <button class="btn" id="grant-new">${ic("gift", "sm")}<span>Выдать подписку</span></button></div>
      <div class="card pad-0">${table({
        columns: [
          { key: "name", label: "Пользователь", render: (u) => html`<a href="#/users/${u.uid}" class="row" style="color:inherit">${avatar(u.name, u.uid)}<span><b>${u.name || u.uid}</b><div class="tiny muted">${u.username ? `@${u.username}` : u.uid}</div></span></a>` },
          { key: "sub_plan", label: "Тариф", render: (u) => subBadge(u) },
          { key: "sub_until", label: "До", render: (u) => (u.sub_until === -1 ? "навсегда" : html`<span class="nowrap">${fDate(u.sub_until)}</span> <span class="tiny muted">(${Math.max(0, Math.ceil((u.sub_until - Date.now()) / 86400000))} дн.)</span>`) },
          { key: "paid_total", label: "Оплачено", cls: "r", render: (u) => (u.paid_total ? fRub(u.paid_total) : "—") },
          { key: "last_active", label: "Активность", render: (u) => fAgo(u.last_active) },
          { key: "a", label: "", render: (u) => html`<button class="btn soft sm" data-ext="${u.uid}" data-name="${u.name || u.uid}">Продлить</button>` },
        ],
        rows: d.rows, empty: expiring ? "Ни у кого подписка не заканчивается в ближайшие 3 дня" : "Активных подписок нет",
      })}</div>`);
    $$("[data-exp]", el).forEach((b) => (b.onclick = () => { location.hash = `#/subs?tab=active&exp=${b.dataset.exp}`; }));
    $$("[data-ext]", el).forEach((b) => (b.onclick = () => grantModal({ uids: [b.dataset.ext], name: b.dataset.name, onDone: () => viewSubs(el, ctx) })));
    $("#grant-new").onclick = () => pickUser((u) => grantModal({ uids: [u.uid], name: u.name, onDone: () => viewSubs(el, ctx) }));
    return;
  }
  const p = S.period;
  const d = await q("payments", { status: tab === "errors" ? "error" : S.route.q.st || "", from: p.from, to: p.to });
  if (!ctx.isCurrent()) return;
  const t = d.totals || {};
  el.innerHTML = str(html`${head}
    <div class="page-head"><div class="grow">${periodPicker()}</div>
      ${tab === "payments" ? html`<select class="input" id="st" style="width:auto">${[["", "Все статусы"], ["paid", "Оплачено"], ["link", "Ссылка создана"], ["error", "Ошибка банка"], ["gift", "Подарок"], ["refunded", "Возврат"]].map(([k, l]) => html`<option value="${k}" ${(S.route.q.st || "") === k ? "selected" : ""}>${l}</option>`)}</select>` : ""}
      <button class="btn ghost sm" id="csv">${ic("download", "sm")}<span>CSV</span></button></div>
    ${tab === "payments" ? html`<div class="tiles mb">
      <div class="tile"><div class="label">Выручка</div><div class="value">${fRub(t.revenue || 0)}</div><div class="sub">${t.paid || 0} оплат</div></div>
      <div class="tile"><div class="label">Ссылок без оплаты</div><div class="value">${fNum(t.links || 0)}</div></div>
      <div class="tile"><div class="label">Ошибок банка</div><div class="value">${fNum(t.errors || 0)}</div></div>
      <div class="tile"><div class="label">Подарков</div><div class="value">${fNum(t.gifts || 0)}</div></div>
      <div class="tile"><div class="label">Возвратов</div><div class="value">${fNum(t.refunded || 0)}</div></div></div>` : html`<div class="callout mb small">Полный ответ банка — в колонке «Ошибка». Частые причины: <b>401</b> — токен Точки недействителен или истёк, <b>403</b> — у токена нет прав на эквайринг, <b>400</b> — банку не понравились данные запроса.</div>`}
    <div class="card pad-0">${table({
      columns: [
        { key: "created_at", label: "Дата", render: (r) => html`<span class="nowrap">${fDT(r.created_at)}</span>` },
        { key: "name", label: "Пользователь", render: (r) => html`<a href="#/users/${r.uid}">${r.name || r.uid}</a>` },
        { key: "plan", label: "Тариф", render: (r) => PLAN_LABELS[r.plan] || r.plan },
        { key: "amount", label: "Сумма", cls: "r", render: (r) => fRub(r.amount) },
        { key: "status", label: "Статус", render: (r) => payStatus(r.status) },
        { key: "note", label: tab === "errors" ? "Ошибка" : "Комментарий", render: (r) => html`<span class="small pre">${r.error || r.note || ""}${r.admin ? ` · ${adminName(r.admin)}` : ""}</span>` },
        { key: "a", label: "", render: (r) => (/^(err_|gift_)/.test(r.op) ? "" : html`<div class="row" style="gap:4px">
          ${r.status !== "paid" ? html`<button class="btn ghost sm" data-check="${r.op}" title="Проверить статус в Точке и включить подписку, если деньги пришли">Проверить</button>` : ""}
          ${r.status === "paid" ? html`<button class="btn ghost sm" data-refund="${r.op}" data-uid="${r.uid}">Возврат</button>` : ""}</div>`) },
      ],
      rows: d.rows, empty: tab === "errors" ? "Ошибок оплаты за период нет" : "Платежей за период нет",
    })}</div>`);
  bindPeriod(el, () => viewSubs(el, ctx));
  const st = $("#st");
  if (st) st.onchange = () => { location.hash = `#/subs?tab=payments&st=${st.value}`; };
  $("#csv").onclick = () => downloadCsv("payments", [
    { label: "Дата", value: (r) => fDT(r.created_at) }, { key: "uid", label: "uid" }, { key: "name", label: "Имя" }, { key: "plan", label: "Тариф" },
    { key: "amount", label: "Сумма" }, { key: "status", label: "Статус" }, { key: "op", label: "Операция" }, { label: "Комментарий", value: (r) => r.error || r.note || "" },
  ], d.rows);
  $$("[data-check]", el).forEach((b) => (b.onclick = () => withBusy(b, async () => {
    const r = await api("POST", "/payments/check", { op: b.dataset.check });
    toast(r.activated ? "Оплата подтверждена — подписка включена" : `Статус в Точке: ${r.status || "неизвестен"}`, r.activated ? "ok" : "");
    viewSubs(el, ctx);
  })));
  $$("[data-refund]", el).forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog("Отметить возврат?", "Сами деньги возвращаются в личном кабинете Точки. Здесь платёж пометится как «возврат», и подписка пользователя отменится.", "Отметить возврат", true))) return;
    await q("payment_status", { op: b.dataset.refund, status: "refunded", note: "возврат" });
    await api("POST", `/user/${b.dataset.uid}/action`, { action: "cancel" });
    toast("Отмечено", "ok");
    viewSubs(el, ctx);
  }));
}

/** Выбор пользователя поиском */
function pickUser(onPick) {
  openModal({
    title: "Выберите пользователя",
    body: html`<input class="input" id="pu-q" placeholder="Имя, @username или Telegram ID" type="search"><div id="pu-list" class="stack-sm"></div>`,
    bind: (el, close) => {
      const run = debounce(async () => {
        const v = $("#pu-q", el).value.trim();
        if (!v) { $("#pu-list", el).innerHTML = ""; return; }
        const r = await q("users", { filter: { q: v }, limit: 10 });
        $("#pu-list", el).innerHTML = str(r.rows.length ? r.rows.map((u) => html`<button class="btn ghost" style="justify-content:flex-start" data-pick="${u.uid}">${avatar(u.name, u.uid)}<span class="ellipsis">${u.name || u.uid} <span class="muted small">${u.username ? `@${u.username}` : u.uid}</span></span></button>`) : html`<p class="muted small">Никого не нашли</p>`);
        $$("[data-pick]", el).forEach((b) => (b.onclick = () => { close(true); onPick(r.rows.find((u) => u.uid === b.dataset.pick)); }));
      }, 250);
      $("#pu-q", el).oninput = run;
    },
  });
}

// =====================================================
// Сообщения: входящие, рассылки, новая рассылка, шаблоны, тексты бота
// =====================================================
export async function viewMessages(el, ctx) {
  const tab = ["inbox", "broadcasts", "new", "templates", "texts"].includes(S.route.q.tab) ? S.route.q.tab : "inbox";
  const counts = await q("counts").catch(() => ({}));
  const head = tabsBar("/messages", [["inbox", "Входящие", counts.unanswered], ["broadcasts", "Рассылки"], ["new", "Новая рассылка"], ["templates", "Шаблоны"], ["texts", "Тексты бота"]], tab);
  await MSG[tab](el, ctx, head);
}

const MSG = {
  async inbox(el, ctx, head) {
    const d = await q("inbox");
    if (!ctx.isCurrent()) return;
    el.innerHTML = str(html`${head}
      <p class="small muted mb">Переписки, где команда писала пользователю или пользователь ответил на наше сообщение. Неотвеченные — сверху. Полная переписка с ботом — в карточке пользователя.</p>
      <div class="card pad-0">${d.rows.length ? html`<div class="feed" style="padding:0 16px">${d.rows.map((r) => html`<a class="feed-item" href="#/users/${r.uid}?tab=chat" style="color:inherit;text-decoration:none">
        ${avatar(r.name, r.uid)}<div class="grow" style="min-width:0"><div class="row between"><b class="ellipsis">${r.name || r.uid}</b><span class="tiny muted nowrap">${fAgo(r.last_ts)}</span></div>
        <div class="small ellipsis ${r.unanswered ? "" : "muted"}">${r.last_dir === "in" ? "" : "Вы: "}${r.last_text || ""}</div></div>
        ${r.unanswered ? html`<span class="badge danger">ждёт ответа</span>` : ""}</a>`)}</div>` : html`<div class="empty">${ic("inbox")}Пока пусто. Написать пользователю можно из его карточки.</div>`}</div>`);
  },

  async broadcasts(el, ctx, head) {
    const d = await q("broadcasts");
    if (!ctx.isCurrent()) return;
    const st = { sending: ["accent", "отправляется"], scheduled: ["info", "запланирована"], done: ["ok", "отправлена"], stopped: ["warn", "остановлена"] };
    el.innerHTML = str(html`${head}
      <div class="page-head"><span class="grow"></span><a class="btn" href="#/messages?tab=new">${ic("plus", "sm")}<span>Новая рассылка</span></a></div>
      <div class="card pad-0">${table({
        columns: [
          { key: "id", label: "№", render: (b) => html`<b>${b.id}</b>` },
          { key: "text", label: "Текст", render: (b) => html`<span class="small">${htmlToMd(b.text).slice(0, 90)}${b.text.length > 90 ? "…" : ""}</span>` },
          { key: "status", label: "Статус", render: (b) => html`<span class="badge ${st[b.status]?.[0] || ""}">${st[b.status]?.[1] || b.status}</span>${b.status === "scheduled" ? html`<div class="tiny muted">${fDT(b.scheduled_at)}</div>` : ""}` },
          { key: "total", label: "Кому", cls: "r" },
          { key: "sent", label: "Доставлено", cls: "r", render: (b) => html`${b.sent}${b.failed ? html` <span class="tiny muted">(не доставлено ${b.failed})</span>` : ""}` },
          { key: "created_at", label: "Создана", render: (b) => html`<span class="nowrap small">${fDT(b.created_at)} · ${adminName(b.admin)}</span>` },
        ],
        rows: d.rows, rowAttrs: (b) => `class="click" data-bc="${b.id}"`, empty: "Рассылок ещё не было",
      })}</div>`);
    $$("[data-bc]", el).forEach((tr) => (tr.onclick = () => { location.hash = `#/messages/broadcast/${tr.dataset.bc}`; }));
  },

  async new(el, ctx, head) {
    let preset = null;
    try { preset = JSON.parse(sessionStorage.getItem("adm_bc_preset") || "null"); } catch {}
    const tpl = await q("templates");
    if (!ctx.isCurrent()) return;
    const f = { ...(preset?.filter || {}) };
    const sel = (k, opts, label) => html`<div class="field"><label>${label}</label><select class="input" data-sf="${k}"><option value="">Все</option>${opts.map(([v, l]) => html`<option value="${v}" ${f[k] === v ? "selected" : ""}>${l}</option>`)}</select></div>`;
    el.innerHTML = str(html`${head}
      <div class="split">
        <div class="stack">
          <div class="card"><div class="card-head"><h2>1. Кому</h2><span class="badge accent" id="seg-n">…</span></div>
            ${preset?.filter?.uids ? html`<div class="callout row"><span class="grow">Выбранные пользователи: ${preset.label || preset.filter.uids.length}</span><button class="btn ghost sm" id="seg-clear">Сбросить</button></div>` : html`
            <div class="filters" style="margin:0">
              ${sel("active", [["today", "Сегодня"], ["7d", "За 7 дней"], ["sleep7", "Не заходил 7+ дней"], ["sleep14", "Уснул 14+ дней"]], "Активность")}
              ${sel("tariff", [["free", "Бесплатный"], ["paid", "Платный"], ["gift", "Подарок"], ["sub", "Любая подписка"], ["expired", "Истёкшая"]], "Тариф")}
              ${sel("level", Object.entries(LEVELS), "Уровень")}
              <div class="field"><label>Специальность</label><input class="input" data-sf="profession" value="${f.profession || ""}" placeholder="Любая"></div>
              <div class="field"><label>Приёмов от</label><input class="input" type="number" min="0" data-sf="cons_min" value="${f.cons_min || ""}"></div>
              <div class="field"><label>Приёмов до</label><input class="input" type="number" min="0" data-sf="cons_max" value="${f.cons_max || ""}"></div>
              ${sel("onboarding", [["yes", "Заполнил"], ["no", "Не заполнил"]], "Анкета")}
              ${sel("feedback", [["yes", "Оставил"], ["no", "Не оставлял"]], "Отзыв")}
              ${sel("source", [["bot", "Бот"], ["miniapp", "Мини-приложение"], ["web", "Сайт"]], "Где работает")}
            </div>`}
            <p class="tiny muted mt">Заблокировавших бота и заблокированных админом рассылка пропускает автоматически.</p>
          </div>
          <div class="card"><div class="card-head"><h2>2. Сообщение</h2>${tpl.rows.length ? html`<select class="input" id="bc-tpl" style="width:auto"><option value="">Шаблон…</option>${tpl.rows.map((t) => html`<option value="${t.id}">${t.name}</option>`)}</select>` : ""}</div>
            <div class="stack">${composerHtml({ placeholders: true })}</div>
            <div class="row wrap mt"><button class="btn ghost sm" id="bc-save-tpl">${ic("note", "sm")}<span>Сохранить как шаблон</span></button><button class="btn ghost sm" id="bc-test">${ic("send", "sm")}<span>Отправить себе</span></button></div>
          </div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><h2>3. Когда</h2></div>
            <div class="seg"><button data-when="now" class="on">Сейчас</button><button data-when="later">Запланировать</button></div>
            <div class="field mt hidden" id="when-box"><label>Дата и время (по времени вашего устройства)</label><input type="datetime-local" class="input" id="bc-at"></div>
            <div class="callout small mt">Отправка идёт порциями ~25 сообщений в секунду (ограничение Telegram). Ход рассылки и статистика — на её странице; остановить можно в любой момент.</div>
            <button class="btn mt" id="bc-go" style="width:100%">${ic("send", "sm")}<span>Отправить</span></button>
          </div>
        </div>
      </div>`);
    const c = bindComposer(el);
    let when = "now";
    const count = debounce(async () => {
      const r = await q("segment_count", { filter: cleanF() }).catch(() => ({ count: "?" }));
      const n = $("#seg-n", el);
      if (n) n.textContent = `${r.count} ${plural(Number(r.count) || 0, "получатель", "получателя", "получателей")}`;
    }, 300);
    const cleanF = () => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v != null));
    $$("[data-sf]", el).forEach((i) => i.addEventListener(i.tagName === "SELECT" ? "change" : "input", () => { f[i.dataset.sf] = i.value.trim(); count(); }));
    count();
    const clr = $("#seg-clear", el);
    if (clr) clr.onclick = () => { sessionStorage.removeItem("adm_bc_preset"); viewMessages(el, ctx); };
    const ts = $("#bc-tpl", el);
    if (ts) ts.onchange = () => { const t = tpl.rows.find((x) => String(x.id) === ts.value); if (t) c.set(t); };
    $$("[data-when]", el).forEach((b) => (b.onclick = () => {
      when = b.dataset.when;
      $$("[data-when]", el).forEach((x) => x.classList.toggle("on", x === b));
      $("#when-box", el).classList.toggle("hidden", when !== "later");
      $("#bc-go", el).querySelector("span").textContent = when === "later" ? "Запланировать" : "Отправить";
    }));
    $("#bc-test", el).onclick = (e) => withBusy(e.currentTarget, async () => {
      const m = c.get();
      if (!m.text) return toast("Напишите текст", "error");
      const r = await q("broadcast_test", { text: m.text, buttons: m.buttons });
      toast(r.ok ? "Отправлено вам в Telegram" : `Не доставлено: ${r.error}`, r.ok ? "ok" : "error");
    });
    $("#bc-save-tpl", el).onclick = () => {
      const m = c.get();
      if (!m.text) return toast("Напишите текст", "error");
      const name = prompt("Название шаблона", m.text.slice(0, 30));
      if (!name) return;
      q("template_save", { name, text: m.text, buttons: m.buttons }).then(() => toast("Шаблон сохранён", "ok")).catch((e) => toast(e.message, "error"));
    };
    $("#bc-go", el).onclick = async (e) => {
      const m = c.get();
      if (!m.text) return toast("Напишите текст", "error");
      if (m.text.length > 4000) return toast("Текст длиннее 4000 символов", "error");
      let at = null;
      if (when === "later") {
        const v = $("#bc-at", el).value;
        if (!v) return toast("Укажите дату и время", "error");
        at = new Date(v).getTime();
        if (!(at > Date.now() + 60000)) return toast("Время должно быть в будущем", "error");
      }
      const n = (await q("segment_count", { filter: cleanF() })).count;
      if (!n) return toast("Получателей нет — измените фильтры", "error");
      if (!(await confirmDialog(at ? "Запланировать рассылку?" : "Отправить рассылку?", `${n} ${plural(n, "получатель", "получателя", "получателей")}${at ? `, ${fDT(at)}` : ", сразу"}. Отменить отправленное нельзя.`, at ? "Запланировать" : "Отправить"))) return;
      await withBusy(e.currentTarget, async () => {
        const r = await q("broadcast_create", { text: m.text, buttons: m.buttons, filter: cleanF(), scheduled_at: at });
        sessionStorage.removeItem("adm_bc_preset");
        toast(at ? "Рассылка запланирована" : "Рассылка началась", "ok");
        location.hash = `#/messages/broadcast/${r.id}`;
      });
    };
  },

  async templates(el, ctx, head) {
    const d = await q("templates");
    if (!ctx.isCurrent()) return;
    el.innerHTML = str(html`${head}
      <div class="page-head"><span class="grow small muted">Готовые тексты для личных сообщений и рассылок.</span><button class="btn" id="tpl-new">${ic("plus", "sm")}<span>Шаблон</span></button></div>
      ${d.rows.length ? html`<div class="grid c2">${d.rows.map((t) => html`<div class="card"><div class="card-head"><h2>${t.name}</h2>
        <button class="btn ghost sm" data-edit="${t.id}">${ic("edit", "sm")}</button><button class="btn ghost sm" data-del="${t.id}">${ic("trash", "sm")}</button></div>
        <div class="tg-preview"><div class="msg">${raw(mdToHtml(t.text))}</div>${t.buttons?.length ? html`<div class="kb">${t.buttons.map((b) => html`<span>${b.text}</span>`)}</div>` : ""}</div></div>`)}</div>` : html`<div class="card empty">Шаблонов пока нет</div>`}`);
    const edit = (t = {}) => openModal({
      title: t.id ? "Шаблон" : "Новый шаблон", wide: true,
      body: html`<div class="field"><label>Название</label><input class="input" id="tp-name" value="${t.name || ""}" maxlength="100"></div>${composerHtml({ text: t.text || "", buttons: t.buttons || [], placeholders: true })}`,
      foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="tp-save">Сохранить</button>`,
      bind: (m, close) => {
        const c = bindComposer(m);
        $("#tp-save", m).onclick = (e) => withBusy(e.currentTarget, async () => {
          const v = c.get();
          if (!v.text) return toast("Напишите текст", "error");
          await q("template_save", { id: t.id, name: $("#tp-name", m).value.trim(), text: v.text, buttons: v.buttons });
          close(true);
          viewMessages(el, ctx);
        });
      },
    });
    $("#tpl-new").onclick = () => edit();
    $$("[data-edit]", el).forEach((b) => (b.onclick = () => edit(d.rows.find((t) => String(t.id) === b.dataset.edit))));
    $$("[data-del]", el).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog("Удалить шаблон?", "Его нельзя будет восстановить.", "Удалить", true))) return;
      await q("template_delete", { id: Number(b.dataset.del) });
      viewMessages(el, ctx);
    }));
  },

  async texts(el, ctx, head) {
    const d = await q("texts");
    if (!ctx.isCurrent()) return;
    el.innerHTML = str(html`${head}
      <p class="small muted mb">Автоматические сообщения бота. Пустое поле — стандартный текст. Подстановки: {имя}, {стрик}, {дней}, {срок}, {до}. Разметка: **жирный**, _курсив_.</p>
      <div class="stack">${d.rows.map((t) => html`<div class="card"><div class="card-head"><h2>${t.label}</h2>${t.value ? html`<span class="badge accent">изменён</span>` : html`<span class="badge">стандартный</span>`}</div>
        <textarea class="input" data-text="${t.key}" placeholder="${htmlToMd(t.def)}" style="min-height:100px">${t.value ? htmlToMd(t.value) : ""}</textarea>
        <div class="row mt"><button class="btn ghost sm" data-fill="${t.key}">Взять стандартный текст для правки</button></div></div>`)}</div>
      <div class="row mt" style="justify-content:flex-end"><button class="btn" id="texts-save">Сохранить тексты</button></div>`);
    $$("[data-fill]", el).forEach((b) => (b.onclick = () => { const t = d.rows.find((x) => x.key === b.dataset.fill); $(`[data-text="${t.key}"]`, el).value = htmlToMd(t.def); }));
    $("#texts-save").onclick = (e) => withBusy(e.currentTarget, async () => {
      const texts = Object.fromEntries($$("[data-text]", el).map((t) => [t.dataset.text, t.value]));
      await q("texts_save", { texts });
      toast("Сохранено", "ok");
      viewMessages(el, ctx);
    });
  },
};

export async function viewBroadcast(el, ctx) {
  const b = await q("broadcast", { id: S.route.params.id });
  if (!ctx.isCurrent()) return;
  if (!b) { el.innerHTML = '<div class="card empty">Рассылка не найдена</div>'; return; }
  ctx.setTitle(`Рассылка №${b.id}`);
  const s = b.stats;
  const doneN = s.sent + s.failed;
  const pctOf = (n) => (s.sent ? `${Math.round((n / s.sent) * 100)}%` : "—");
  el.innerHTML = str(html`
    <div class="page-head"><a class="btn ghost sm" href="#/messages?tab=broadcasts">${ic("back", "sm")}<span>Все рассылки</span></a><span class="grow"></span>
      ${["sending", "scheduled"].includes(b.status) ? html`<button class="btn danger sm" id="bc-stop">Остановить</button>` : ""}<button class="btn ghost sm" id="bc-refresh">${ic("refresh", "sm")}</button></div>
    <div class="split">
      <div class="stack">
        <div class="card"><div class="card-head"><h2>Статус</h2><span class="badge">${{ sending: "отправляется", scheduled: `запланирована на ${fDT(b.scheduled_at)}`, done: "отправлена", stopped: "остановлена" }[b.status] || b.status}</span></div>
          <div class="progress"><i style="width:${s.total ? (doneN / s.total) * 100 : 0}%"></i></div>
          <p class="small muted mt">${doneN} из ${s.total} обработано · автор ${adminName(b.admin)} · ${fDT(b.created_at)}</p></div>
        <div class="tiles">
          <div class="tile"><div class="label">Доставлено</div><div class="value">${s.sent}</div><div class="sub">не доставлено ${s.failed}</div></div>
          <div class="tile"><div class="label">Нажали кнопку</div><div class="value">${s.clicked}</div><div class="sub">${pctOf(s.clicked)} · только «Принять пациента»</div></div>
          <div class="tile"><div class="label">Вернулись за 48 ч</div><div class="value">${s.returned48}</div><div class="sub">${pctOf(s.returned48)}</div></div>
          <div class="tile"><div class="label">Провели приём за 48 ч</div><div class="value">${s.consult48}</div><div class="sub">${pctOf(s.consult48)}</div></div>
          <div class="tile"><div class="label">Оплатили за 7 дней</div><div class="value">${s.paid7}</div><div class="sub">${pctOf(s.paid7)}</div></div>
        </div>
      </div>
      <div class="card"><div class="card-head"><h2>Сообщение</h2></div><div class="tg-preview"><div class="msg">${raw(b.text.replace(/\n/g, "<br>"))}</div>${b.buttons?.length ? html`<div class="kb">${b.buttons.map((x) => html`<span>${x.text}</span>`)}</div>` : ""}</div></div>
    </div>
    <div class="card pad-0 mt"><div class="card-head" style="padding:14px 16px 0"><h2>Получатели</h2></div>${table({
      columns: [
        { key: "name", label: "Пользователь", render: (t) => html`<a href="#/users/${t.uid}">${t.name || t.uid}</a>` },
        { key: "status", label: "Статус", render: (t) => html`<span class="badge ${t.status === "sent" ? "ok" : t.status === "failed" ? "danger" : ""}">${{ sent: "доставлено", failed: "не доставлено", pending: "в очереди" }[t.status]}</span>` },
        { key: "clicked", label: "Кнопка", render: (t) => (t.clicked ? "нажал" : "") },
        { key: "ts", label: "Когда", render: (t) => (t.ts ? fDT(t.ts) : "—") },
        { key: "err", label: "Ошибка", render: (t) => html`<span class="small muted">${t.err || ""}</span>` },
      ],
      rows: b.targets,
    })}</div>`);
  const stop = $("#bc-stop");
  if (stop) stop.onclick = async () => {
    if (!(await confirmDialog("Остановить рассылку?", "Уже отправленные сообщения останутся у пользователей.", "Остановить", true))) return;
    await q("broadcast_stop", { id: b.id });
    viewBroadcast(el, ctx);
  };
  $("#bc-refresh").onclick = () => viewBroadcast(el, ctx);
  if (b.status === "sending") setTimeout(() => { if (ctx.isCurrent()) viewBroadcast(el, ctx); }, 3000);
}

// =====================================================
// Отзывы и анкеты
// =====================================================
const FF = { rating: "", has_text: "", source: "", status: "" };

export async function viewFeedback(el, ctx) {
  const tab = S.route.q.tab === "surveys" ? "surveys" : "reviews";
  const head = tabsBar("/feedback", [["reviews", "Отзывы"], ["surveys", "Анкеты"]], tab);
  if (tab === "surveys") return surveys(el, ctx, head);
  const d = await q("feedback", FF);
  if (!ctx.isCurrent()) return;
  const sel = (k, opts, label) => html`<div class="field"><label>${label}</label><select class="input" data-ff="${k}"><option value="">Все</option>${opts.map(([v, l]) => html`<option value="${v}" ${FF[k] === v ? "selected" : ""}>${l}</option>`)}</select></div>`;
  el.innerHTML = str(html`${head}
    <div class="grid c2 mb">
      <div class="card"><div class="card-head"><h2>Оценка тренажёра</h2><span class="small muted">${d.total} ${plural(d.total, "отзыв", "отзыва", "отзывов")}</span></div>
        <div class="row" style="gap:16px;align-items:flex-start"><div><div style="font-size:34px;font-weight:700">${d.avg ?? "—"}</div><div class="stars">${d.avg ? "★".repeat(Math.round(d.avg)) + "☆".repeat(5 - Math.round(d.avg)) : ""}</div></div>
        <div class="grow">${hbars([5, 4, 3, 2, 1].map((s) => ({ label: `${s} ★`, value: d.dist[s - 1], color: s <= 2 ? "var(--s8)" : "var(--s4)" })))}</div></div></div>
      <div class="card"><div class="card-head"><h2>ИИ-сводка отзывов и ожиданий</h2><button class="btn soft sm" id="ai-sum">${ic("refresh", "sm")}<span>${d.summary ? "Обновить" : "Составить"}</span></button></div>
        <div id="sum">${d.summary ? html`<div class="small pre">${d.summary.text}</div><p class="tiny muted mt">${fAgo(d.summary.ts)} · по ${d.summary.count} текстам</p>` : html`<p class="small muted">ИИ сгруппирует отзывы и ответы анкеты по темам и подсветит главное. Один запрос — несколько сотен нейронов.</p>`}</div></div>
    </div>
    <div class="filters">
      ${sel("rating", [["5", "5 ★"], ["4", "4 ★"], ["3", "3 ★"], ["2", "2 ★"], ["1", "1 ★"]], "Оценка")}
      ${sel("has_text", [["yes", "С текстом"], ["no", "Только оценка"]], "Текст")}
      ${sel("source", [["bot", "Бот"], ["web", "Сайт"]], "Откуда")}
      ${sel("status", [["new", "Новые"], ["read", "Прочитаны"], ["replied", "Отвечено"]], "Статус")}
    </div>
    <div class="stack">${d.rows.length ? d.rows.map((f) => html`<div class="card">
      <div class="row top wrap" style="gap:10px">${avatar(f.name, f.uid)}<div class="grow" style="min-width:200px">
        <div class="row wrap"><a href="#/users/${f.uid}"><b>${f.name || f.uid}</b></a>${f.rating ? html`<span class="stars">${"★".repeat(f.rating)}${"☆".repeat(5 - f.rating)}</span>` : ""}
          <span class="tiny muted">${fDT(f.ts)} · ${f.source === "bot" ? "бот" : "сайт"} · ${f.origin === "request" ? "после просьбы через 2 дня" : "по кнопке"}</span></div>
        ${f.text ? html`<div class="pre mt" style="margin-top:6px">${f.text}</div>` : html`<div class="small muted mt" style="margin-top:6px">без текста</div>`}
        <div class="tiny muted" style="margin-top:6px">У автора ${f.cons || 0} ${plural(f.cons || 0, "приём", "приёма", "приёмов")}${f.avg_rating ? ` · средняя оценка ${f.avg_rating}` : ""} · ${f.sub_active ? "с подпиской" : "бесплатный тариф"}</div></div>
        <div class="row wrap" style="gap:6px"><select class="input" data-fst="${f.uid}|${f.ts}" style="width:auto">${[["new", "Новый"], ["read", "Прочитан"], ["replied", "Отвечено"]].map(([k, l]) => html`<option value="${k}" ${(f.status || "new") === k ? "selected" : ""}>${l}</option>`)}</select>
          <button class="btn sm" data-reply="${f.uid}|${f.ts}" data-name="${f.name || f.uid}">Ответить</button><button class="btn ghost sm" data-ftask="${f.uid}|${f.ts}">В задачу</button></div></div></div>`) : html`<div class="card empty">Отзывов нет</div>`}</div>`);
  $$("[data-ff]", el).forEach((s) => (s.onchange = () => { FF[s.dataset.ff] = s.value; viewFeedback(el, ctx); }));
  $$("[data-fst]", el).forEach((s) => (s.onchange = async () => { const [uid, ts] = s.dataset.fst.split("|"); await q("feedback_status", { uid, ts: Number(ts), status: s.value }); toast("Сохранено"); }));
  $$("[data-reply]", el).forEach((b) => (b.onclick = () => {
    const [uid, ts] = b.dataset.reply.split("|");
    messageComposer(uid, b.dataset.name, () => viewFeedback(el, ctx), { after: () => q("feedback_status", { uid, ts: Number(ts), status: "replied" }) });
  }));
  $$("[data-ftask]", el).forEach((b) => (b.onclick = () => {
    const [uid, ts] = b.dataset.ftask.split("|");
    const f = d.rows.find((x) => x.uid === uid && String(x.ts) === ts);
    newTaskFrom({ title: `Отзыв: ${(f.text || `${f.rating} ★`).slice(0, 80)}`, descr: `${f.rating ? `${f.rating} ★\n` : ""}${f.text || ""}`, type: "feature", links: [{ kind: "user", id: uid, label: f.name || uid }, { kind: "feedback", id: `${uid}|${ts}`, label: "Отзыв" }] });
  }));
  $("#ai-sum").onclick = (e) => withBusy(e.currentTarget, async () => {
    const r = await api("POST", "/feedback/summary");
    $("#sum").innerHTML = str(html`<div class="small pre">${r.text}</div><p class="tiny muted mt">только что · по ${r.count} текстам</p>`);
  });
}

async function surveys(el, ctx, head) {
  const d = await q("onboarding");
  if (!ctx.isCurrent()) return;
  el.innerHTML = str(html`${head}
    <div class="tiles mb">
      <div class="tile"><div class="label">Новых пользователей с анкетой</div><div class="value">${d.total_new}</div></div>
      <div class="tile"><div class="label">Ответили</div><div class="value">${d.answered}</div></div>
      <div class="tile"><div class="label">Пропустили</div><div class="value">${d.skipped}</div><div class="sub">${d.total_new ? Math.round((d.skipped / d.total_new) * 100) : 0}%</div></div>
    </div>
    <div class="grid c2 mb"><div class="card"><div class="card-head"><h2>Кто пользуется</h2></div>${hbars(d.levels.map((l) => ({ label: l.label, value: l.n })))}</div>
      <div class="card"><div class="card-head"><h2>Сводка ожиданий</h2></div><p class="small muted">ИИ-сводка по темам — на вкладке «Отзывы» (кнопка «Составить»): она учитывает и отзывы, и ожидания из анкет.</p></div></div>
    <div class="card pad-0"><div class="card-head" style="padding:14px 16px 0"><h2>Ответы</h2><button class="btn ghost sm" id="csv">${ic("download", "sm")}<span>CSV</span></button></div>${table({
      columns: [
        { key: "name", label: "Пользователь", render: (r) => html`<a href="#/users/${r.uid}">${r.name || r.uid}</a><div class="tiny muted">${fDate(r.registered_at)}</div>` },
        { key: "level", label: "Кто", render: (r) => LEVELS[r.level] || r.level || "—" },
        { key: "about", label: "Учёба / работа", render: (r) => html`<span class="small">${r.about || "—"}</span>` },
        { key: "expectations", label: "Ожидания", render: (r) => html`<span class="small">${r.expectations || "—"}</span>` },
      ],
      rows: d.rows, empty: "Анкет пока нет",
    })}</div>`);
  $("#csv").onclick = () => downloadCsv("surveys", [{ key: "uid", label: "uid" }, { key: "name", label: "Имя" }, { key: "username", label: "Username" }, { label: "Кто", value: (r) => LEVELS[r.level] || r.level }, { key: "about", label: "Учёба / работа" }, { key: "expectations", label: "Ожидания" }, { label: "Регистрация", value: (r) => fDT(r.registered_at) }], d.rows);
}

// =====================================================
// Задачи
// =====================================================
const STATUSES = [["idea", "Идея"], ["backlog", "Бэклог"], ["doing", "В работе"], ["review", "На проверке"], ["done", "Готово"], ["rejected", "Отклонено"]];
const TYPES = [["idea", "Идея"], ["feature", "Фича"], ["bug", "Баг"], ["marketing", "Маркетинг"], ["content", "Контент"]];
const PRIOS = [["urgent", "Срочно"], ["high", "Высокий"], ["medium", "Средний"], ["low", "Низкий"]];
const TF = { view: "board", assignee: "", type: "", q: "" };
const label = (list, k) => list.find(([v]) => v === k)?.[1] || k || "—";

export async function viewTasks(el, ctx) {
  try { Object.assign(TF, JSON.parse(localStorage.getItem("adm_tasks_view") || "{}")); } catch {}
  const d = await q("tasks", { assignee: TF.assignee === "me" ? S.me.id : TF.assignee, type: TF.type, q: TF.q });
  if (!ctx.isCurrent()) return;
  const rows = d.rows;
  const card = (t) => html`<div class="tcard" draggable="true" data-task="${t.id}">
    <div class="ttl">${t.title}</div>
    <div class="row wrap tiny" style="gap:6px;margin-top:6px">
      <span class="badge">${label(TYPES, t.type)}</span>
      ${t.priority && t.priority !== "medium" ? html`<span class="badge ${t.priority === "urgent" ? "danger" : t.priority === "high" ? "warn" : ""}">${label(PRIOS, t.priority)}</span>` : ""}
      ${t.due ? html`<span class="badge ${t.due < mskDay(Date.now()) && !["done", "rejected"].includes(t.status) ? "danger" : ""}">${ic("clock", "sm")} ${fDate(Date.parse(t.due))}</span>` : ""}
      ${t.comments ? html`<span class="muted">${ic("chat", "sm")} ${t.comments}</span>` : ""}
      ${t.checklist?.length ? html`<span class="muted">${ic("check", "sm")} ${t.checklist.filter((c) => c.done).length}/${t.checklist.length}</span>` : ""}
      <span class="grow"></span>${t.assignee ? html`<span class="badge accent">${adminName(t.assignee)}</span>` : ""}
    </div></div>`;
  el.innerHTML = str(html`
    <div class="page-head">
      <div class="seg"><button data-view="board" class="${TF.view === "board" ? "on" : ""}">Доска</button><button data-view="list" class="${TF.view === "list" ? "on" : ""}">Список</button></div>
      <select class="input" data-tf="assignee" style="width:auto"><option value="">Все исполнители</option><option value="me" ${TF.assignee === "me" ? "selected" : ""}>Мои</option>${S.admins.map((a) => html`<option value="${a.id}" ${TF.assignee === a.id ? "selected" : ""}>${a.name}</option>`)}<option value="none" ${TF.assignee === "none" ? "selected" : ""}>Без исполнителя</option></select>
      <select class="input" data-tf="type" style="width:auto"><option value="">Все типы</option>${TYPES.map(([k, l]) => html`<option value="${k}" ${TF.type === k ? "selected" : ""}>${l}</option>`)}</select>
      <input class="input" data-tf="q" value="${TF.q}" placeholder="Поиск" type="search" style="width:auto;min-width:140px;flex:1 1 140px;max-width:260px">
      <span class="grow"></span>
      <button class="btn" id="t-new">${ic("plus", "sm")}<span>Задача</span></button>
    </div>
    ${TF.view === "board" ? html`<div class="board">${STATUSES.map(([k, l]) => {
      const list = rows.filter((t) => t.status === k);
      return html`<div class="col" data-col="${k}"><div class="col-head">${l} <span class="badge">${list.length}</span></div>${list.map(card)}
        ${k === "idea" || k === "backlog" ? html`<button class="btn ghost sm" data-add="${k}" style="width:100%">${ic("plus", "sm")}<span>Добавить</span></button>` : ""}</div>`;
    })}</div>` : html`<div class="card pad-0">${table({
      columns: [
        { key: "title", label: "Задача", render: (t) => html`<b>${t.title}</b><div class="tiny muted">${label(TYPES, t.type)} · №${t.id}</div>` },
        { key: "status", label: "Статус", render: (t) => html`<span class="badge">${label(STATUSES, t.status)}</span>` },
        { key: "priority", label: "Приоритет", render: (t) => label(PRIOS, t.priority) },
        { key: "assignee", label: "Исполнитель", render: (t) => (t.assignee ? adminName(t.assignee) : "—") },
        { key: "due", label: "Срок", render: (t) => (t.due ? fDate(Date.parse(t.due)) : "—") },
        { key: "score", label: "Влияние / трудоёмкость", cls: "r", render: (t) => (t.impact || t.effort ? `${t.impact || "—"} / ${t.effort || "—"}` : "—") },
        { key: "updated_at", label: "Изменена", render: (t) => fAgo(t.updated_at) },
      ],
      rows: sortRows(rows.map((t) => ({ ...t, prioN: { urgent: 0, high: 1, medium: 2, low: 3 }[t.priority] ?? 2 })), "prioN", "asc"),
      rowAttrs: (t) => `class="click" data-task="${t.id}"`, empty: "Задач нет",
    })}</div>`}`);
  const save = () => localStorage.setItem("adm_tasks_view", JSON.stringify(TF));
  $$("[data-view]", el).forEach((b) => (b.onclick = () => { TF.view = b.dataset.view; save(); viewTasks(el, ctx); }));
  const reload = debounce(() => viewTasks(el, ctx), 300);
  $$("[data-tf]", el).forEach((i) => i.addEventListener(i.tagName === "SELECT" ? "change" : "input", () => { TF[i.dataset.tf] = i.value; save(); reload(); }));
  $$("[data-task]", el).forEach((c) => c.addEventListener("click", () => openTask(c.dataset.task, () => viewTasks(el, ctx))));
  $("#t-new").onclick = () => newTaskFrom({}, () => viewTasks(el, ctx));
  $$("[data-add]", el).forEach((b) => (b.onclick = () => newTaskFrom({ status: b.dataset.add }, () => viewTasks(el, ctx))));
  // Перетаскивание между колонками (десктоп)
  let dragId = null;
  $$(".tcard", el).forEach((c) => {
    c.addEventListener("dragstart", (e) => { dragId = c.dataset.task; c.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
  });
  $$("[data-col]", el).forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drop");
      if (!dragId) return;
      const t = rows.find((x) => String(x.id) === dragId);
      dragId = null;
      if (!t || t.status === col.dataset.col) return;
      await q("task_update", { id: t.id, patch: { status: col.dataset.col } });
      viewTasks(el, ctx);
    });
  });
}

/** Новая задача (с заготовкой: из отзыва, пользователя, ошибки) */
export function newTaskFrom(preset = {}, onDone) {
  taskModal({ status: "backlog", type: "feature", priority: "medium", labels: [], links: [], checklist: [], ...preset }, onDone);
}

/** Быстрая идея из любого места */
export function quickIdea() {
  openModal({
    title: "Идея",
    body: html`<div class="field"><label>Коротко</label><input class="input" id="qi-title" maxlength="300" placeholder="Например: добавить педиатрические случаи с родителями"></div>
      <div class="field"><label>Подробнее (необязательно)</label><textarea class="input" id="qi-descr" style="min-height:80px"></textarea></div>
      <p class="tiny muted">Попадёт в колонку «Идея». Из бота то же самое — командой /idea текст.</p>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="qi-go">Сохранить идею</button>`,
    bind: (el, close) => {
      const go = (e) => withBusy($("#qi-go", el), async () => {
        const title = $("#qi-title", el).value.trim();
        if (!title) return toast("Напишите идею", "error");
        const t = await q("task_create", { title, descr: $("#qi-descr", el).value.trim(), type: "idea", status: "idea" });
        close(true);
        toast(`Идея №${t.id} записана`, "ok");
        if (S.route.name === "tasks") location.hash = "#/tasks";
      });
      $("#qi-go", el).onclick = go;
      $("#qi-title", el).onkeydown = (e) => { if (e.key === "Enter") go(); };
    },
  });
}

export async function openTask(id, onDone) {
  try {
    const t = await q("task", { id: Number(id) });
    if (!t) return toast("Задача не найдена", "error");
    taskModal(t, onDone);
  } catch (e) { toast(e.message, "error"); }
}

function taskModal(t, onDone = () => {}) {
  const isNew = !t.id;
  let checklist = [...(t.checklist || [])];
  let links = [...(t.links || [])];
  const opt = (list, cur) => list.map(([k, l]) => html`<option value="${k}" ${cur === k ? "selected" : ""}>${l}</option>`);
  const linkHtml = (l) => {
    if (l.kind === "user") return html`<a href="#/users/${l.id}">${ic("user", "sm")} ${l.label || l.id}</a>`;
    if (l.kind === "feedback") return html`<a href="#/feedback">${ic("star", "sm")} ${l.label || "Отзыв"}</a>`;
    return html`<a href="${/^https?:\/\//.test(l.url || "") ? l.url : "#"}" target="_blank" rel="noopener">${ic("link", "sm")} ${l.label || l.url}</a>`;
  };
  const m = openModal({
    title: isNew ? "Новая задача" : `Задача №${t.id}`,
    wide: true,
    body: html`
      <div class="field"><label>Название</label><input class="input" id="t-title" value="${t.title || ""}" maxlength="300"></div>
      <div class="grid c4" style="gap:10px">
        <div class="field"><label>Статус</label><select class="input" id="t-status">${opt(STATUSES, t.status)}</select></div>
        <div class="field"><label>Тип</label><select class="input" id="t-type">${opt(TYPES, t.type)}</select></div>
        <div class="field"><label>Приоритет</label><select class="input" id="t-prio">${opt(PRIOS, t.priority)}</select></div>
        <div class="field"><label>Исполнитель</label><select class="input" id="t-assignee"><option value="">Никто</option>${S.admins.map((a) => html`<option value="${a.id}" ${t.assignee === a.id ? "selected" : ""}>${a.name}</option>`)}</select></div>
        <div class="field"><label>Срок</label><input type="date" class="input" id="t-due" value="${t.due || ""}"></div>
        <div class="field"><label>Влияние 1–5</label><input type="number" min="1" max="5" class="input" id="t-impact" value="${t.impact ?? ""}"></div>
        <div class="field"><label>Трудоёмкость 1–5</label><input type="number" min="1" max="5" class="input" id="t-effort" value="${t.effort ?? ""}"></div>
        <div class="field"><label>Метки</label><input class="input" id="t-labels" value="${(t.labels || []).join(", ")}" placeholder="бот, ИИ, оплата"></div>
      </div>
      <div class="field"><label>Описание</label><textarea class="input" id="t-descr" style="min-height:120px">${t.descr || ""}</textarea></div>
      <div class="field"><label>Чек-лист</label><div class="stack-sm" id="t-check"></div>
        <div class="row"><input class="input grow" id="t-check-new" placeholder="Подзадача"><button class="btn ghost sm" id="t-check-add">${ic("plus", "sm")}</button></div></div>
      <div class="field"><label>Связи</label><div class="stack-sm" id="t-links"></div>
        <div class="row wrap"><input class="input grow" id="t-link-new" placeholder="Ссылка на PR, документ или Telegram ID пользователя" style="min-width:200px"><button class="btn ghost sm" id="t-link-add">Добавить</button></div></div>
      ${isNew ? "" : html`<div class="field"><label>Комментарии</label>
        <div class="stack-sm">${(t.comments_list || []).map((c) => html`<div class="note"><div class="tiny muted">${adminName(c.admin)} · ${fDT(c.ts)}</div><div class="pre">${c.text}</div></div>`)}</div>
        <div class="row top"><textarea class="input grow" id="t-comment" placeholder="Комментарий" style="min-height:44px"></textarea><button class="btn ghost" id="t-comment-add">Отправить</button></div></div>
      <details><summary class="small muted" style="cursor:pointer">История изменений (${(t.history || []).length})</summary>
        <div class="stack-sm mt small">${(t.history || []).map((h) => html`<div><span class="muted">${fDT(h.ts)} · ${adminName(h.admin)}:</span> ${h.field} «${h.old || "—"}» → «${h.new || "—"}»</div>`)}</div></details>
      <p class="tiny muted">Создал ${adminName(t.created_by)} ${fDT(t.created_at)}</p>`}`,
    foot: html`${isNew ? "" : html`<button class="btn danger" id="t-del" style="margin-right:auto">${ic("trash", "sm")}</button>`}<button class="btn ghost" data-close>Закрыть</button><button class="btn" id="t-save">${isNew ? "Создать" : "Сохранить"}</button>`,
    onClose: () => { if (location.hash.startsWith("#/tasks/")) history.replaceState(null, "", "#/tasks"); },
    bind: (el, close) => {
      const drawCheck = () => {
        $("#t-check", el).innerHTML = str(checklist.map((c, i) => html`<div class="row"><label class="check grow"><input type="checkbox" data-ci="${i}" ${c.done ? "checked" : ""}> <span style="${c.done ? "text-decoration:line-through;opacity:.6" : ""}">${c.text}</span></label><button class="btn ghost sm icon" data-cdel="${i}">${ic("x", "sm")}</button></div>`));
        $$("[data-ci]", el).forEach((c) => (c.onchange = () => { checklist[Number(c.dataset.ci)].done = c.checked; drawCheck(); }));
        $$("[data-cdel]", el).forEach((b) => (b.onclick = () => { checklist.splice(Number(b.dataset.cdel), 1); drawCheck(); }));
      };
      const drawLinks = () => {
        $("#t-links", el).innerHTML = str(links.length ? links.map((l, i) => html`<div class="row">${linkHtml(l)}<span class="grow"></span><button class="btn ghost sm icon" data-ldel="${i}">${ic("x", "sm")}</button></div>`) : html`<span class="tiny muted">Нет связей</span>`);
        $$("[data-ldel]", el).forEach((b) => (b.onclick = () => { links.splice(Number(b.dataset.ldel), 1); drawLinks(); }));
        $$("#t-links a[href^='#/']", el).forEach((a) => a.addEventListener("click", () => close(true)));
      };
      drawCheck();
      drawLinks();
      const addCheck = () => { const v = $("#t-check-new", el).value.trim(); if (!v) return; checklist.push({ text: v, done: false }); $("#t-check-new", el).value = ""; drawCheck(); };
      $("#t-check-add", el).onclick = addCheck;
      $("#t-check-new", el).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addCheck(); } };
      $("#t-link-add", el).onclick = () => {
        const v = $("#t-link-new", el).value.trim();
        if (!v) return;
        if (/^\d{5,}$/.test(v)) links.push({ kind: "user", id: v, label: v });
        else if (/^https?:\/\//.test(v)) links.push({ kind: "url", url: v, label: v.replace(/^https?:\/\//, "").slice(0, 60) });
        else return toast("Ссылка должна начинаться с https:// или быть Telegram ID", "error");
        $("#t-link-new", el).value = "";
        drawLinks();
      };
      const collect = () => ({
        title: $("#t-title", el).value.trim(), status: $("#t-status", el).value, type: $("#t-type", el).value, priority: $("#t-prio", el).value,
        assignee: $("#t-assignee", el).value || null, due: $("#t-due", el).value || null, impact: $("#t-impact", el).value, effort: $("#t-effort", el).value,
        labels: $("#t-labels", el).value.split(",").map((x) => x.trim()).filter(Boolean), descr: $("#t-descr", el).value, checklist, links,
      });
      $("#t-save", el).onclick = (e) => withBusy(e.currentTarget, async () => {
        const v = collect();
        if (!v.title) return toast("Напишите название", "error");
        if (isNew) await q("task_create", v);
        else await q("task_update", { id: t.id, patch: v });
        close(true);
        toast("Сохранено", "ok");
        onDone();
        if (S.route.name === "tasks" && !onDone.name) location.hash = "#/tasks";
      });
      const cadd = $("#t-comment-add", el);
      if (cadd) cadd.onclick = (e) => withBusy(e.currentTarget, async () => {
        const text = $("#t-comment", el).value.trim();
        if (!text) return;
        await q("task_update", { id: t.id, patch: collect() });
        const fresh = await q("task_comment", { id: t.id, text });
        close(true);
        taskModal(fresh, onDone);
      });
      const del = $("#t-del", el);
      if (del) del.onclick = async () => {
        if (!(await confirmDialog("Удалить задачу?", "Вместе с комментариями. Восстановить нельзя.", "Удалить", true))) return;
        await q("task_delete", { id: t.id });
        close(true);
        onDone();
        if (S.route.name === "tasks") location.hash = "#/tasks";
      };
    },
  });
  return m;
}

// =====================================================
// Настройки
// =====================================================
export async function viewSettings(el, ctx) {
  const [n, log, bf] = await Promise.all([q("notify_get"), q("audit_log", { limit: 200 }), q("backfill_status")]);
  if (!ctx.isCurrent()) return;
  const ACT = { login: "Вход в админку", grant: "Выдал подписку", cancel: "Отменил подписку", set_until: "Изменил дату подписки", extra: "Доп. пациенты", block: "Заблокировал", unblock: "Разблокировал", reset_streak: "Сбросил стрик", message: "Написал пользователю", broadcast_create: "Создал рассылку", broadcast_stop: "Остановил рассылку", template_save: "Сохранил шаблон", template_delete: "Удалил шаблон", texts_save: "Изменил тексты бота", feedback_status: "Статус отзыва", note_add: "Добавил заметку", note_delete: "Удалил заметку", task_create: "Создал задачу", task_delete: "Удалил задачу", payment_status: "Статус платежа", payment_check: "Проверил платёж", notify_save: "Настроил уведомления", bulk_grant: "Выдал подписку списку" };
  el.innerHTML = str(html`<div class="grid c2">
    <div class="card"><div class="card-head"><h2>Администраторы</h2></div>
      <div class="stack-sm">${S.admins.map((a) => html`<div class="row">${avatar(a.name, a.id)}<div class="grow"><b>${a.name}</b><div class="tiny muted">Telegram ID ${a.id}</div></div>${a.id === S.me.id ? html`<span class="badge accent">это вы</span>` : ""}</div>`)}</div>
      <p class="tiny muted mt">Полный доступ у обоих. Список задаётся переменной ADMIN_ID в wrangler.jsonc (ID через запятую). Сессия в админке — 12 часов.</p></div>
    <div class="card"><div class="card-head"><h2>Мои уведомления в Telegram</h2></div>
      <div class="stack-sm">${Object.entries(n.kinds).map(([k, l]) => html`<label class="switch"><input type="checkbox" data-nk="${k}" ${n.prefs[k] !== false ? "checked" : ""}><span class="track"></span><span>${l}</span></label>`)}</div>
      <button class="btn mt" id="n-save">Сохранить</button></div>
    <div class="card"><div class="card-head"><h2>Расход ИИ из Cloudflare</h2><span class="badge ${S.info.cf_configured ? "ok" : "warn"}">${S.info.cf_configured ? "подключено" : "не настроено"}</span></div>
      <p class="small">${S.info.cf_configured ? "Точные цифры подтягиваются в «Аналитика → Расход ИИ» кнопкой «Загрузить из Cloudflare»." : html`Нужен токен с правом <b>Account Analytics: Read</b>: Cloudflare → My Profile → API Tokens → Create Token. Добавьте его в GitHub → Settings → Secrets and variables → Actions как <span class="kbd">CF_ANALYTICS_TOKEN</span> и перезапустите деплой. Без токена админка считает расход сама по токенам каждого ответа модели.`}</p></div>
    <div class="card"><div class="card-head"><h2>История данных</h2></div>
      <p class="small">События в реальном времени пишутся с момента запуска админки. Прошлое восстановлено из профилей пользователей: регистрации, пациенты, вопросы, обследования, приёмы, оценки, тесты, оплаты.</p>
      <p class="small muted mt">${bf ? (bf.done ? `Восстановлено: ${bf.processed} пользователей, ${fDT(bf.finished_at)}` : `Идёт восстановление: ${bf.processed} из ${bf.total}`) : "Ещё не запускалось"}</p>
      <button class="btn ghost sm mt" id="bf">${ic("refresh", "sm")}<span>Пересобрать сводку пользователей</span></button></div>
  </div>
  <div class="card pad-0 mt"><div class="card-head" style="padding:14px 16px 0"><h2>Журнал действий админов</h2></div>${table({
    columns: [
      { key: "ts", label: "Когда", render: (r) => html`<span class="nowrap">${fDT(r.ts)}</span>` },
      { key: "admin", label: "Кто", render: (r) => adminName(r.admin) },
      { key: "action", label: "Действие", render: (r) => ACT[r.action] || r.action },
      { key: "target", label: "Кому / что", render: (r) => (/^\d{5,}$/.test(r.target) ? html`<a href="#/users/${r.target}">${r.target}</a>` : r.target || "—") },
      { key: "details", label: "Подробности", render: (r) => html`<span class="tiny muted">${r.details ? Object.entries(JSON.parse(r.details)).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") : ""}</span>` },
    ],
    rows: log.rows, empty: "Пока пусто",
  })}</div>`);
  $("#n-save").onclick = (e) => withBusy(e.currentTarget, async () => {
    const prefs = Object.fromEntries($$("[data-nk]", el).map((c) => [c.dataset.nk, c.checked]));
    await q("notify_save", { prefs });
    toast("Сохранено", "ok");
  });
  $("#bf").onclick = (e) => withBusy(e.currentTarget, async () => {
    await api("POST", "/backfill");
    toast("Запущено — займёт до минуты", "ok");
  });
}
