// Подбор ключей для блога по поисковым подсказкам: что люди реально набирают.
// Для каждого «семени» берём подсказки Google и Яндекса, а также подсказки к «семя + а…я» — так видны хвосты запросов.
// Подсказки показывают, ЧТО ищут, но не сколько: частотность проверяйте в Яндекс Вордстате (wordstat.yandex.ru), если есть доступ.
// Запуск: node scripts/keywords.mjs "практика помощник врача" "оскэ станции" [--deep]
const seeds = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const deep = process.argv.includes("--deep");
if (!seeds.length) {
  console.error('Укажите запросы: node scripts/keywords.mjs "аккредитация 6 курс" --deep');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function google(q) {
  try {
    const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&gl=ru&q=${encodeURIComponent(q)}`);
    return (await r.json())[1] || [];
  } catch { return []; }
}
async function yandex(q) {
  try {
    const r = await fetch(`https://suggest.yandex.ru/suggest-ff.cgi?uil=ru&part=${encodeURIComponent(q)}`);
    return (await r.json())[1] || [];
  } catch { return []; }
}
const LETTERS = "абвгдежзиклмнопрстуфхцчшэюя".split("");
for (const seed of seeds) {
  const found = new Map();
  const add = (list, src) => list.forEach((s) => { const k = s.trim().toLowerCase(); if (k && k !== seed.toLowerCase()) found.set(k, (found.get(k) || "") + src); });
  add(await google(seed), "G");
  add(await yandex(seed), "Я");
  if (deep) {
    for (const l of LETTERS) {
      add(await google(`${seed} ${l}`), "g");
      await sleep(120);
    }
  }
  console.log(`\n## ${seed} — ${found.size}`);
  for (const [k, src] of [...found].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) console.log(`- ${k}  [${[...new Set(src)].join("")}]`);
}
