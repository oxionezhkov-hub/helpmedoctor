// Индекс действующих клинических рекомендаций Минздрава России из официального рубрикатора (cr.minzdrav.gov.ru).
// Пишет src/data/kr-index.json: [id, название, возраст (a — взрослые, c — дети, ac — все), [коды МКБ-10]].
// Тексты рекомендаций воркер берёт из того же API при разборе приёма и кэширует в KV (см. src/lib/kr.js).
// Запуск: node scripts/fetch-kr.mjs — раз в месяц или когда в рубрикаторе вышли новые версии.
import { writeFileSync } from "node:fs";

const API = "https://apicr.minzdrav.gov.ru/api.ashx?op=GetJsonClinrecsFilterV2";
const body = {
  filters: [{ fieldName: "status", filterType: 1, filterValueType: 2, value1: 0, value2: "", values: [] }],
  sortOption: { fieldName: "publishdate", sortType: 2 },
  pageSize: 3000, currentPage: 1, useANDoperator: true, columns: [],
};
const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
if (!res.ok) throw new Error(`рубрикатор ответил ${res.status}`);
const { Data } = await res.json();
const age = (s = "") => (/взросл/i.test(s) && /дет/i.test(s) ? "ac" : /дет/i.test(s) ? "c" : "a");
const rows = Data
  .filter((d) => d.Status === 0 && d.CodeVersion)
  .map((d) => [d.CodeVersion, d.Name.replace(/\s+/g, " ").trim(), age(d.AgeCategoryStr), [...new Set((d.Mkbs || []).map((m) => m.MkbCode.trim()))]])
  .sort((a, b) => a[1].localeCompare(b[1], "ru"));
if (rows.length < 300) throw new Error(`подозрительно мало рекомендаций: ${rows.length}`);
writeFileSync(new URL("../src/data/kr-index.json", import.meta.url), JSON.stringify(rows).replace(/\],\[/g, "],\n["));
console.log(`Клинических рекомендаций: ${rows.length}`);
