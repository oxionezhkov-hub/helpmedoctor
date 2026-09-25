// Графики на SVG: линии, столбцы (в т.ч. с накоплением), горизонтальные полосы, тепловая карта.
// Тонкие линии 2px, скруглённые концы столбцов, зазор 2px между сегментами, подсказка при наведении.
import { html, raw, str, fmt, fNum, $$ } from "./core.js";

const specs = new Map();
let seq = 0;
export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)", "var(--s7)", "var(--s8)"];

/**
 * Место под график: реальная отрисовка — после вставки в DOM (нужна ширина контейнера).
 * spec: {type: "line"|"stack"|"bars", labels: string[], series: [{name, values, color?}], height?, yFmt?, ref?: {value, label}, tipLabels?}
 */
export function chart(spec) {
  const id = `c${++seq}`;
  specs.set(id, spec);
  const legend = spec.series.length > 1 ? html`<div class="legend">${spec.series.map((s, i) => html`<span><i style="background:${s.color || SERIES[i]}"></i>${s.name}</span>`)}${spec.ref ? html`<span><i style="background:none;border-top:2px dashed var(--ref);height:0;border-radius:0"></i>${spec.ref.label}</span>` : ""}</div>`
    : spec.ref ? html`<div class="legend"><span><i style="background:${spec.series[0]?.color || SERIES[0]}"></i>${spec.series[0]?.name}</span><span><i style="background:none;border-top:2px dashed var(--ref);height:0;border-radius:0"></i>${spec.ref.label}</span></div>` : "";
  return html`${legend}<div class="chart" data-chart="${id}" style="height:${spec.height || 200}px" role="img" aria-label="${spec.aria || spec.series.map((s) => s.name).join(", ")}"></div>`;
}

export function renderCharts(root = document) {
  for (const el of $$("[data-chart]", root)) {
    const spec = specs.get(el.dataset.chart);
    if (!spec) continue;
    const w = Math.max(240, el.clientWidth);
    el.innerHTML = draw(spec, w, spec.height || 200);
  }
}

let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => renderCharts(), 150);
});

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function shortLabel(l) {
  // YYYY-MM-DD → «24 сен»
  if (/^\d{4}-\d{2}-\d{2}$/.test(l)) {
    const [, m, d] = l.split("-");
    return `${Number(d)} ${["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"][Number(m) - 1]}`;
  }
  return l;
}

function draw(spec, W, H) {
  const { labels, series } = spec;
  const yFmt = spec.yFmt || ((v) => fNum(v));
  const n = labels.length;
  const padL = 44, padR = 12, padT = 10, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB;
  let maxV = 0;
  if (spec.type === "stack") {
    for (let i = 0; i < n; i++) maxV = Math.max(maxV, series.reduce((a, s) => a + (Number(s.values[i]) || 0), 0));
  } else {
    for (const s of series) for (const v of s.values) maxV = Math.max(maxV, Number(v) || 0);
  }
  if (spec.ref) maxV = Math.max(maxV, spec.ref.value * 1.08);
  const top = niceMax(maxV);
  const y = (v) => padT + ih - (v / top) * ih;
  const step = n > 0 ? iw / n : iw;
  const xc = (i) => padL + step * (i + 0.5);
  let out = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
  // Сетка и ось Y
  out += '<g class="axis">';
  for (let k = 0; k <= 4; k++) {
    const v = (top / 4) * k;
    const yy = y(v);
    out += `<line class="${k === 0 ? "baseline" : "gridline"}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    out += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end">${fmt(yFmt(v))}</text>`;
  }
  // Подписи X — не больше ~8
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
  for (let i = 0; i < n; i += every) out += `<text x="${xc(i)}" y="${H - 6}" text-anchor="middle">${fmt(shortLabel(labels[i]))}</text>`;
  out += "</g>";

  if (spec.type === "line") {
    series.forEach((s, si) => {
      const color = s.color || SERIES[si];
      const pts = s.values.map((v, i) => `${xc(i).toFixed(1)},${y(Number(v) || 0).toFixed(1)}`);
      out += `<polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      if (n <= 31) s.values.forEach((v, i) => { out += `<circle cx="${xc(i)}" cy="${y(Number(v) || 0)}" r="${n <= 14 ? 3.5 : 2.5}" fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>`; });
    });
  } else {
    const bw = Math.max(2, Math.min(36, step * 0.66));
    for (let i = 0; i < n; i++) {
      let acc = 0;
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        if (v <= 0) return;
        const color = s.color || SERIES[si];
        const y0 = y(acc), y1 = y(acc + v);
        // 2px зазор между сегментами — цветом поверхности
        const hgt = Math.max(1, y0 - y1 - (acc > 0 ? 2 : 0));
        const isTop = spec.type !== "stack" || series.slice(si + 1).every((s2) => !(Number(s2.values[i]) > 0));
        const r = isTop ? Math.min(4, bw / 2, hgt) : 0;
        out += roundedTopRect(xc(i) - bw / 2, y1, bw, hgt, r, color);
        acc += v;
      });
    }
  }
  if (spec.ref) {
    const yy = y(spec.ref.value);
    out += `<line class="refline" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="reflabel" x="${W - padR}" y="${yy - 5}" text-anchor="end">${fmt(spec.ref.label)}</text>`;
  }
  // Зоны наведения: вся колонка шире метки, подсказка со всеми рядами
  for (let i = 0; i < n; i++) {
    const lines = [shortLabel(spec.tipLabels?.[i] || labels[i])];
    let total = 0;
    series.forEach((s) => { const v = Number(s.values[i]) || 0; total += v; lines.push(`${s.name}: ${yFmt(v)}`); });
    if (spec.type === "stack" && series.length > 1) lines.push(`Всего: ${yFmt(total)}`);
    out += `<g class="col"><rect class="hit" x="${padL + step * i}" y="${padT}" width="${step}" height="${ih}" data-tip="${fmt(lines.join("\n"))}"/>`;
    out += `<line class="cross" x1="${xc(i)}" x2="${xc(i)}" y1="${padT}" y2="${padT + ih}"/></g>`;
  }
  return `${out}</svg>`;
}

function roundedTopRect(x, yTop, w, h, r, fill) {
  if (r <= 0) return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`;
  const b = yTop + h;
  return `<path d="M${x},${b} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + w - r} Q${x + w},${yTop} ${x + w},${yTop + r} V${b} Z" fill="${fill}"/>`;
}

/** Горизонтальные полосы (рейтинги): [{label, value, sub?, tip?}] */
export function hbars(items, { fmtV = (v) => fNum(v), color = "var(--s1)", max = null } = {}) {
  if (!items.length) return html`<div class="empty">Нет данных</div>`;
  const m = max || Math.max(...items.map((x) => Number(x.value) || 0), 1);
  return html`<div class="hbars">${items.map((x) => html`<div class="hbar" data-tip="${x.tip || `${x.label}: ${fmtV(x.value)}`}">
    <span class="lbl" title="${x.label}">${x.label}${x.sub ? html` <span class="muted tiny">${x.sub}</span>` : ""}</span>
    <span class="bar"><i style="width:${Math.max(0.5, ((Number(x.value) || 0) / m) * 100)}%;background:${x.color || color}"></i></span>
    <span class="val">${fmtV(x.value)}</span></div>`)}</div>`;
}

/** Тепловая карта «день недели × час» (одна гамма синего от светлого к тёмному) */
export function heatmap(grid) {
  const max = Math.max(1, ...grid.flat());
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const step = (v) => (v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999)));
  return html`<div class="heat">
    <span></span>${Array.from({ length: 24 }, (_, h) => html`<span class="h">${h % 3 === 0 ? h : ""}</span>`)}
    ${grid.map((row, d) => html`<span>${days[d]}</span>${row.map((v, h) => html`<span class="cell" style="background:var(--seq-${step(v)})" data-tip="${days[d]}, ${h}:00–${h}:59 МСК\n${v} ${v === 1 ? "действие" : "действий"}"></span>`)}`)}
  </div>
  <div class="row small muted mt" style="gap:4px">Меньше ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => html`<i style="width:14px;height:10px;border-radius:2px;background:var(--seq-${i});display:inline-block"></i>`)} Больше</div>`;
}

/** Календарь активности за 90 дней (как на GitHub) */
export function calendar(activity) {
  const map = Object.fromEntries((activity || []).map((a) => [a.day, a.n]));
  const max = Math.max(1, ...Object.values(map));
  const cells = [];
  const today = Date.now();
  const start = today - 90 * 86400000;
  // Выравниваем начало на понедельник
  const d0 = new Date(start + 3 * 3600000);
  const offset = (d0.getUTCDay() + 6) % 7;
  for (let i = 0; i < offset; i++) cells.push(raw('<i style="visibility:hidden"></i>'));
  for (let t = start; t <= today; t += 86400000) {
    const day = new Date(t + 3 * 3600000).toISOString().slice(0, 10);
    const v = map[day] || 0;
    const stp = v <= 0 ? 0 : Math.min(7, 1 + Math.floor((v / max) * 6.999));
    cells.push(html`<i style="background:var(--seq-${stp})" data-tip="${day}: ${v} ${v === 1 ? "действие" : "действий"}"></i>`);
  }
  return html`<div class="cal">${cells}</div>`;
}

export { str };
