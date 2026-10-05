// Промокоды: создание (код, название, срок действия, бонус — дни премиума), отключение, счётчик и список активаций
import { $, $$, q, html, str, ic, fDT, fDate, plural, toast, table, avatar, withBusy, openModal } from "./core.js";

const SITE = "https://helpmedoctor.ru";
const link = (code) => `${SITE}/app?promo=${encodeURIComponent(code)}`;

export async function viewPromos(el, ctx) {
  const d = await q("promos");
  if (!ctx.isCurrent()) return;
  const total = d.rows.reduce((s, p) => s + (p.uses || 0), 0);
  el.innerHTML = str(html`
    <div class="page-head"><span class="muted small grow">${d.rows.length} ${plural(d.rows.length, "промокод", "промокода", "промокодов")} · ${total} ${plural(total, "активация", "активации", "активаций")}</span>
      <button class="btn" id="promo-new">${ic("plus", "sm")}<span>Новый промокод</span></button></div>
    <div class="callout mb small">Пользователь вводит код в «Тарифах» или приходит по ссылке <span class="kbd">${SITE}/app?promo=КОД</span> — код применится сам после входа или регистрации. Один код — один раз на человека.</div>
    <div class="card pad-0">${table({
      columns: [
        { key: "code", label: "Код", render: (p) => html`<b>${p.code}</b><div class="tiny muted">${p.title}</div>` },
        { key: "days", label: "Бонус", render: (p) => html`<span class="nowrap">+${p.days} дн. премиума</span>` },
        { key: "until", label: "Действует до", render: (p) => html`<span class="nowrap ${p.expired ? "muted" : ""}">${p.until ? fDate(p.until) : "бессрочно"}</span>` },
        { key: "uses", label: "Активаций", cls: "r", render: (p) => html`<a href="#" data-uses="${p.code}">${p.uses || 0}</a>` },
        { key: "active", label: "Статус", render: (p) => html`<span class="badge ${!p.active ? "" : p.expired ? "warn" : "ok"}">${!p.active ? "отключён" : p.expired ? "истёк" : "работает"}</span>` },
        { key: "act", label: "", render: (p) => html`<span class="row nowrap" style="gap:6px"><button class="btn sm ghost" data-copy="${link(p.code)}" title="Скопировать ссылку">${ic("copy", "sm")}</button><button class="btn sm ghost" data-toggle="${p.code}" data-on="${p.active ? 0 : 1}">${p.active ? "Отключить" : "Включить"}</button></span>` },
      ],
      rows: d.rows,
      empty: "Промокодов пока нет",
    })}</div>`);
  const reload = () => viewPromos(el, ctx);
  $("#promo-new").onclick = () => createModal(reload);
  $$("[data-toggle]", el).forEach((b) => (b.onclick = () => withBusy(b, async () => { await q("promo_toggle", { code: b.dataset.toggle, active: b.dataset.on === "1" }); reload(); })));
  $$("[data-copy]", el).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Ссылка скопирована", "ok"); } catch { toast(b.dataset.copy); } }));
  $$("[data-uses]", el).forEach((a) => (a.onclick = async (e) => { e.preventDefault(); usesModal(a.dataset.uses); }));
}

function createModal(onDone) {
  openModal({
    title: "Новый промокод",
    body: html`<div class="stack">
      <label class="field"><span>Код (его вводит пользователь)</span><input class="input" id="pr-code" placeholder="Например: SOBOL" maxlength="32" style="text-transform:uppercase"></label>
      <label class="field"><span>Название (для себя)</span><input class="input" id="pr-title" placeholder="ВК «Белый соболь», октябрь" maxlength="120"></label>
      <div class="grid-2">
        <label class="field"><span>Бонус: дней премиума</span><input class="input" id="pr-days" type="number" min="1" max="365" value="7"></label>
        <label class="field"><span>Действует до (включительно)</span><input class="input" id="pr-until" type="date"></label>
      </div>
      <p class="small muted">Без даты — бессрочно. Дни премиума добавляются к текущей подписке.</p>
    </div>`,
    foot: html`<button class="btn ghost" data-close>Отмена</button><button class="btn" id="pr-ok">Создать</button>`,
    bind: (m, close) => {
      $("#pr-ok", m).onclick = (e) => withBusy(e.currentTarget, async () => {
        await q("promo_create", { code: $("#pr-code", m).value, title: $("#pr-title", m).value, days: Number($("#pr-days", m).value), until: $("#pr-until", m).value || null });
        toast("Промокод создан", "ok");
        close(true);
        onDone();
      });
    },
  });
}

async function usesModal(code) {
  const d = await q("promo_uses", { code });
  openModal({
    title: `Активации ${code}`,
    body: d.rows.length ? html`<div class="stack-sm">${d.rows.map((r) => html`<a href="#/users/${r.uid}" class="row" style="color:inherit" data-close>${avatar(r.name, r.uid)}<span class="grow"><b>${r.name || r.uid}</b><div class="tiny muted">${r.username ? `@${r.username}` : r.uid}</div></span><span class="tiny muted nowrap">${fDT(r.ts)}</span></a>`)}</div>`
      : html`<div class="empty">Пока никто не активировал</div>`,
    foot: html`<button class="btn ghost" data-close>Закрыть</button>`,
  });
}
