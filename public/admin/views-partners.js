// Партнёрская программа: заявки и партнёры, все приглашающие, запросы выплат, начисления
import { S, $, $$, q, html, str, ic, fDT, fDate, fRub, fNum, plural, toast, table, avatar, withBusy, openModal, confirmDialog } from "./core.js";

const tabsBar = (tabs, cur) => html`<div class="tabs">${tabs.map(([k, l, badge]) => html`<a href="#/partners?tab=${k}" class="${cur === k ? "on" : ""}">${l}${badge ? html` <span class="badge danger">${badge}</span>` : ""}</a>`)}</div>`;
const STATUS = { applied: ["Заявка", "warn"], active: ["Партнёр", "ok"], rejected: ["Отклонён", ""], excluded: ["Исключён", "danger"] };
const KIND = { first: "первая оплата", next: "повторная", partner: "партнёр" };
const pct = (r) => `${Math.round(Number(r) * 100)}%`;
const who = (r, name = r.name, uid = r.uid) => html`<a href="#/users/${uid}" class="row" style="color:inherit">${avatar(name, uid)}<span><b>${name || uid}</b><div class="tiny muted">${r.username ? `@${r.username}` : uid}</div></span></a>`;

export async function viewPartners(el, ctx) {
  const d = await q("partners");
  if (!ctx.isCurrent()) return;
  const applied = d.partners.filter((p) => p.status === "applied").length;
  const requested = d.payouts.filter((p) => p.status === "requested");
  const tab = ["partners", "referrers", "payouts", "earnings"].includes(S.route.q.tab) ? S.route.q.tab : "partners";
  const head = tabsBar([["partners", "Партнёры и заявки", applied], ["payouts", "Выплаты", requested.length], ["referrers", "Все приглашающие"], ["earnings", "Начисления"]], tab);
  const c = d.config;
  const totals = {
    revenue: d.referrers.reduce((s, r) => s + r.revenue, 0),
    earned: d.referrers.reduce((s, r) => s + r.earned, 0),
    toPay: requested.reduce((s, p) => s + p.amount, 0),
    paid: d.payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0),
  };
  const tiles = html`<div class="tiles mb">
    <div class="tile"><div class="label">Выручка от приглашённых</div><div class="value">${fRub(totals.revenue)}</div></div>
    <div class="tile"><div class="label">Начислено партнёрам</div><div class="value">${fRub(totals.earned)}</div></div>
    <div class="tile"><div class="label">Ждут выплаты</div><div class="value">${fRub(totals.toPay)}</div><div class="sub">${requested.length} ${plural(requested.length, "запрос", "запроса", "запросов")}</div></div>
    <div class="tile"><div class="label">Выплачено</div><div class="value">${fRub(totals.paid)}</div></div>
  </div>
  <div class="callout mb small">Условия: обычный пользователь — ${pct(c.first)} с первой оплаты приглашённого и ${pct(c.next)} со всех следующих; партнёр — ${pct(c.partner)} с любой оплаты и бессрочный доступ. Холд ${c.hold_days} дней, вывод от ${fRub(c.min_payout)}. Пробный период за 1 ₽ не считается.</div>`;

  if (tab === "partners") {
    el.innerHTML = str(html`${head}${tiles}
      <div class="page-head"><span class="muted small grow">${d.partners.length} ${plural(d.partners.length, "запись", "записи", "записей")}</span><button class="btn" id="make-partner">${ic("plus", "sm")}<span>Сделать партнёром по uid</span></button></div>
      <div class="card pad-0">${table({
        columns: [
          { key: "name", label: "Пользователь", render: (p) => who(p) },
          { key: "status", label: "Статус", render: (p) => html`<span class="badge ${STATUS[p.status]?.[1] || ""}">${STATUS[p.status]?.[0] || p.status}</span>${p.status === "active" ? html` <span class="tiny muted">${pct(p.rate)}</span>` : ""}` },
          { key: "info", label: "Заявка", render: (p) => (p.info ? html`<div class="small" style="max-width:360px">${[p.info.university, p.info.course, p.info.city].filter(Boolean).join(" · ")}<div class="tiny muted pre">${p.info.channels || ""}${p.info.links ? `\n${p.info.links}` : ""}</div></div>` : html`<span class="tiny muted">назначен вручную</span>`) },
          { key: "applied_at", label: "Дата", render: (p) => html`<span class="nowrap">${fDate(p.applied_at)}</span>` },
          { key: "balance", label: "Баланс", cls: "r", render: (p) => html`${fRub(p.balance.earned)}<div class="tiny muted">к выводу ${fRub(p.balance.available)}</div>` },
          { key: "a", label: "", render: (p) => html`<div class="row" style="gap:4px;flex-wrap:wrap">
            ${p.status !== "active" ? html`<button class="btn sm" data-act="active" data-uid="${p.uid}" data-name="${p.name || p.uid}">Одобрить</button>` : html`<button class="btn ghost sm" data-act="rate" data-uid="${p.uid}" data-name="${p.name || p.uid}" data-rate="${p.rate}">Ставка</button>`}
            ${p.status === "applied" ? html`<button class="btn ghost sm" data-act="rejected" data-uid="${p.uid}" data-name="${p.name || p.uid}">Отклонить</button>` : ""}
            ${p.status === "active" ? html`<button class="btn ghost sm danger" data-act="excluded" data-uid="${p.uid}" data-name="${p.name || p.uid}">Исключить</button>` : ""}
          </div>` },
        ],
        rows: d.partners, empty: "Заявок пока нет. Страница для партнёров: /partneram/",
      })}</div>`);
    $$("[data-act]", el).forEach((b) => (b.onclick = () => decideModal(b.dataset, () => viewPartners(el, ctx))));
    $("#make-partner").onclick = () => {
      const uid = prompt("uid пользователя (Telegram ID или w…):");
      if (uid) decideModal({ act: "active", uid: uid.trim(), name: uid.trim() }, () => viewPartners(el, ctx));
    };
    return;
  }

  if (tab === "payouts") {
    el.innerHTML = str(html`${head}${tiles}
      <div class="card pad-0">${table({
        columns: [
          { key: "created_at", label: "Запрос", render: (p) => html`<span class="nowrap">${fDT(p.created_at)}</span>` },
          { key: "name", label: "Кому", render: (p) => who(p) },
          { key: "amount", label: "Сумма", cls: "r", render: (p) => html`<b>${fRub(p.amount)}</b>` },
          { key: "details", label: "Реквизиты", render: (p) => html`<div class="small">${p.method === "sbp" ? html`СБП: <b>${p.details?.phone}</b> · ${p.details?.bank}` : html`Карта: <b>${String(p.details?.card || "").replace(/(\d{4})(?=\d)/g, "$1 ")}</b>`}<div class="tiny muted">${p.details?.name || ""}</div></div>
            ${p.status === "requested" ? html`<button class="btn ghost sm" data-copy="${p.method === "sbp" ? p.details?.phone : p.details?.card}">${ic("copy", "sm")}<span>Копировать</span></button>` : ""}` },
          { key: "status", label: "Статус", render: (p) => html`<span class="badge ${p.status === "paid" ? "ok" : p.status === "rejected" ? "danger" : "warn"}">${p.status === "paid" ? "Выплачено" : p.status === "rejected" ? "Отклонено" : "Ждёт"}</span>${p.decided_at ? html`<div class="tiny muted">${fDT(p.decided_at)}${p.note ? ` · ${p.note}` : ""}</div>` : ""}` },
          { key: "a", label: "", render: (p) => (p.status === "requested" ? html`<div class="row" style="gap:4px"><button class="btn sm" data-pay="${p.id}" data-amount="${p.amount}">Выплачено</button><button class="btn ghost sm" data-reject="${p.id}">Отклонить</button></div>` : "") },
        ],
        rows: d.payouts, empty: "Запросов выплат нет",
      })}</div>`);
    $$("[data-copy]", el).forEach((b) => (b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast("Скопировано", "ok"))));
    $$("[data-pay]", el).forEach((b) => (b.onclick = async () => {
      if (!(await confirmDialog("Выплата отправлена?", `Отметить выплату ${fRub(b.dataset.amount)} как проведённую. Пользователь получит сообщение в Telegram.`, "Выплачено"))) return;
      await withBusy(b, () => q("payout_decide", { id: b.dataset.pay, status: "paid" }));
      viewPartners(el, ctx);
    }));
    $$("[data-reject]", el).forEach((b) => (b.onclick = async () => {
      const note = prompt("Причина (увидит пользователь), например: неверный номер карты");
      if (note === null) return;
      await withBusy(b, () => q("payout_decide", { id: b.dataset.reject, status: "rejected", note }));
      viewPartners(el, ctx);
    }));
    return;
  }

  if (tab === "referrers") {
    el.innerHTML = str(html`${head}${tiles}
      <div class="card pad-0">${table({
        columns: [
          { key: "name", label: "Приглашает", render: (r) => who(r) },
          { key: "invited", label: "Приглашено", cls: "r", render: (r) => fNum(r.invited) },
          { key: "paying", label: "Оплатили", cls: "r", render: (r) => fNum(r.paying) },
          { key: "revenue", label: "Выручка", cls: "r", render: (r) => fRub(r.revenue) },
          { key: "earned", label: "Начислено", cls: "r", render: (r) => fRub(r.earned) },
          { key: "balance", label: "К выводу", cls: "r", render: (r) => fRub(r.balance.available) },
        ],
        rows: d.referrers, empty: "По личным ссылкам пока никто не пришёл",
      })}</div>`);
    return;
  }

  el.innerHTML = str(html`${head}${tiles}
    <div class="card pad-0">${table({
      columns: [
        { key: "at", label: "Дата", render: (e) => html`<span class="nowrap">${fDT(e.at)}</span>` },
        { key: "referrer_name", label: "Кому", render: (e) => html`<a href="#/users/${e.referrer}">${e.referrer_name || e.referrer}</a>` },
        { key: "user_name", label: "За кого", render: (e) => html`<a href="#/users/${e.uid}">${e.user_name || e.uid}</a>` },
        { key: "amount", label: "Оплата", cls: "r", render: (e) => fRub(e.amount) },
        { key: "reward", label: "Начисление", cls: "r", render: (e) => html`<b>${fRub(e.reward)}</b><div class="tiny muted">${pct(e.rate)} · ${KIND[e.kind] || e.kind}</div>` },
        { key: "status", label: "", render: (e) => (e.status === "ok" ? html`<button class="btn ghost sm" data-cancel="${e.op}">Аннулировать</button>` : html`<span class="badge danger">Аннулировано</span> <button class="btn ghost sm" data-restore="${e.op}">Вернуть</button>`) },
      ],
      rows: d.earnings, empty: "Начислений пока нет",
    })}</div>`);
  $$("[data-cancel]", el).forEach((b) => (b.onclick = async () => {
    const note = prompt("Причина аннулирования (накрутка, возврат оплаты…)");
    if (note === null) return;
    await withBusy(b, () => q("earning_cancel", { op: b.dataset.cancel, note }));
    viewPartners(el, ctx);
  }));
  $$("[data-restore]", el).forEach((b) => (b.onclick = async () => {
    await withBusy(b, () => q("earning_cancel", { op: b.dataset.restore, restore: true }));
    viewPartners(el, ctx);
  }));
}

function decideModal({ act, uid, name, rate }, onDone) {
  const titles = { active: "Сделать партнёром", rate: "Ставка партнёра", rejected: "Отклонить заявку", excluded: "Исключить из партнёров" };
  const status = act === "rate" ? "active" : act;
  openModal({
    title: `${titles[act]}: ${name}`,
    body: html`<div class="stack">
      ${status === "active" ? html`<label class="field"><span>Доля с каждой оплаты, %</span><input class="input" id="pd-rate" type="number" min="1" max="90" value="${Math.round(Number(rate || S.partnerRate || 0.5) * 100)}"></label>
        ${act === "active" ? html`<p class="small muted">Пользователь получит бессрочный доступ (автопродление карты отключится) и приветственное сообщение с первыми шагами.</p>` : ""}`
        : html`<label class="field"><span>Причина (увидит пользователь, можно пусто)</span><textarea class="input" id="pd-note" rows="3"></textarea></label>
        ${status === "excluded" ? html`<p class="small muted">Бессрочный доступ, выданный как партнёру, отключится. Начисления прекратятся; уже начисленное можно аннулировать во вкладке «Начисления».</p>` : ""}`}
    </div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn ${status === "active" ? "" : "danger"}" id="pd-ok">${act === "rate" ? "Сохранить" : titles[act]}</button>`,
    bind: (m, close) => {
      $("#pd-ok", m).onclick = (e) => withBusy(e.currentTarget, async () => {
        const args = { uid, status };
        if (status === "active") args.rate = Number($("#pd-rate", m).value) / 100;
        else args.note = $("#pd-note", m).value;
        await q("partner_decide", args);
        toast("Готово", "ok");
        close(true);
        onDone();
      });
    },
  });
}
