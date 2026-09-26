// Клинические рекомендации Минздрава России (официальный рубрикатор cr.minzdrav.gov.ru).
// Индекс действующих КР лежит в src/data/kr-index.json (обновление — node scripts/fetch-kr.mjs).
// По диагнозу и коду МКБ-10 находим рекомендацию, берём из неё тезисы по диагностике и лечению
// и отдаём ИИ как опору для разбора, подсказок и тестов. Тексты кэшируем в KV на 30 дней.
import INDEX from "../data/kr-index.json" with { type: "json" };

const API = "https://apicr.minzdrav.gov.ru/api.ashx";
const VIEW = "https://cr.minzdrav.gov.ru/view-cr/";
const CACHE_TTL = 30 * 86400;
const CACHE_VER = "kr:v1:";

// Кириллица, похожая на латиницу: модель иногда пишет «К26.3» русской буквой
const LOOKALIKE = { А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y" };

/** Коды МКБ-10 из строки: «K26.3», «J18.9 / J15» → ["K26.3", "J18.9", "J15"] */
export function mkbCodes(s) {
  const up = String(s || "").toUpperCase().replace(/[А-ЯЁ]/g, (c) => LOOKALIKE[c] || c);
  return [...new Set(up.match(/[A-Z]\d{2}(\.\d{1,2})?/g) || [])];
}

// Основы слов (первые 5 букв) для сравнения названий: «пневмония» и «пневмонии» совпадут
const STOP = new Set(["остры", "хрони", "другие", "други", "неуто", "уточн", "форма", "стади", "течен", "обост", "легко", "средн", "тяжел", "степе", "взрос", "детей", "дети", "синдр"]);
function stems(s) {
  return new Set((String(s || "").toLowerCase().replace(/ё/g, "е").match(/[а-я]{4,}/g) || []).map((w) => w.slice(0, 5)).filter((w) => !STOP.has(w)));
}

/**
 * Какая КР подходит к диагнозу. Сначала код МКБ (точный — лучше, по рубрике — хуже), потом совпадение слов названия.
 * @returns {{id: string, name: string, url: string} | null}
 */
export function matchKr({ diagnosis = "", mkb = "", pediatric = false } = {}, index = INDEX) {
  const codes = mkbCodes(mkb);
  const words = stems(diagnosis);
  let best = null;
  for (const [id, name, age, krCodes] of index) {
    let score = 0;
    for (const c of codes) {
      if (krCodes.includes(c)) score = Math.max(score, 100);
      else if (krCodes.some((k) => k.split(".")[0] === c.split(".")[0])) score = Math.max(score, 60);
    }
    const nameWords = stems(name);
    let overlap = 0;
    for (const w of words) if (nameWords.has(w)) overlap++;
    // Без кода — только если совпали хотя бы два слова (или одно, но название КР из одного значимого слова)
    if (!score && !(overlap >= 2 || (overlap === 1 && nameWords.size === 1))) continue;
    score += overlap * 12 - Math.max(0, nameWords.size - overlap) * 2;
    if (pediatric && age === "a") score -= 45;
    if (!pediatric && age === "c") score -= 45;
    if (!best || score > best.score) best = { id, name, score };
  }
  if (!best || best.score < 10) return null;
  return { id: best.id, name: best.name, url: VIEW + best.id };
}

const DOSE_RE = /\d[\d,.]*\s*(мг|мкг|г|ЕД|МЕ|мл|ммоль|mg)\b|\/кг|раз[а]? в (сут|день)/i;
const NOISE_RE = /уровень (убедительности|достоверности)|уровень достверности/i;

/** HTML раздела КР → блоки текста: заголовки, тезисы «рекомендуется», комментарии с дозами */
export function krBlocks(html) {
  const blocks = [];
  const re = /<(h[1-4]|li|p|td)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const tag = m[1].toLowerCase();
    const text = cleanHtml(m[2]);
    if (!text || NOISE_RE.test(text)) continue;
    const prev = blocks[blocks.length - 1];
    // Тезис, разорванный вёрсткой рубрикатора посередине фразы («…не позднее» + «8 ч с момента…»)
    if (!tag.startsWith("h") && prev?.kind === "thesis" && !/[.;:!?)]$/.test(prev.text)) { prev.text += ` ${text}`; continue; }
    if (tag.startsWith("h")) blocks.push({ kind: "h", text });
    else blocks.push({ kind: /рекомендуется|не рекомендуется|рекомендовано/i.test(text) ? "thesis" : DOSE_RE.test(text) ? "dose" : "text", text });
  }
  return blocks;
}

function cleanHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&ndash;|&mdash;/g, "—")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#\d+;/g, " ")
    .replace(/\[\d[\d,\s–-]*\]/g, "") // ссылки на литературу [1, 3, 33]
    .replace(/\s+/g, " ")
    .trim();
}

/** Сжатый текст раздела: тезисы и дозы, а описательную часть — только если осталось место */
export function krDigest(html, limit) {
  const blocks = krBlocks(html);
  const keep = blocks.filter((b) => b.kind === "h" || b.kind === "thesis" || b.kind === "dose");
  const pick = keep.some((b) => b.kind !== "h") ? keep : blocks;
  let out = "";
  for (const b of pick) {
    const t = b.kind === "h" ? `\n## ${b.text}` : `- ${b.kind === "dose" ? b.text.slice(0, 500) : b.text}`;
    if (out.length + t.length + 1 > limit) break;
    out += `${t}\n`;
  }
  // Заголовок без содержимого в конце не нужен
  return out.replace(/(\n## [^\n]*\n)+$/, "\n").trim();
}

/** Из полного документа — диагностика, лечение и критерии качества */
export function krSections(doc) {
  const sections = doc?.obj?.sections || [];
  const html = (re) => sections.filter((s) => re.test(s.id)).map((s) => `<h2>${s.title}</h2>${s.content || ""}`).join("");
  return {
    diagnostics: krDigest(html(/^doc_diag_2(_\d+)?$/), 6000),
    treatment: krDigest(html(/^doc_3(_\d+)?$/), 11000),
    criteria: krDigest(html(/^doc_criteria$/), 2500),
  };
}

// Для локальных тестов (AI_MOCK=1): без сети, короткий текст
const MOCK = {
  diagnostics: "## 2.1 Жалобы и анамнез\n- Всем пациентам рекомендуется сбор жалоб и анамнеза: боль в эпигастрии, связь с приёмом пищи, приём НПВС.\n## 2.4 Инструментальные исследования\n- Рекомендуется ЭГДС с биопсией для подтверждения диагноза.",
  treatment: "## 3.1 Консервативное лечение\n- Рекомендуется эрадикационная терапия первой линии: ингибитор протонной помпы в стандартной дозе 2 раза в сутки, кларитромицин 500 мг 2 раза в сутки, амоксициллин 1000 мг 2 раза в сутки — 14 дней.",
  criteria: "- Выполнена ЭГДС\n- Проведена эрадикационная терапия при выявлении H. pylori",
};

/**
 * Текст КР по id (например, «654_2»): из кэша KV или из API рубрикатора.
 * @returns {Promise<{diagnostics: string, treatment: string, criteria: string} | null>}
 */
export async function krText(env, id) {
  if (!id) return null;
  if (env.AI_MOCK === "1") return MOCK;
  const key = CACHE_VER + id;
  const kv = env.HELPMEDOCTOR;
  try {
    const hit = kv && (await kv.get(key, "json"));
    if (hit) return hit;
  } catch {}
  try {
    const res = await fetch(`${API}?op=GetClinrec2&id=${encodeURIComponent(id)}&ssid=`, { signal: AbortSignal.timeout(15000), cf: { cacheTtl: 86400 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = krSections(await res.json());
    if (!text.diagnostics && !text.treatment) throw new Error("пустая рекомендация");
    if (kv) await kv.put(key, JSON.stringify(text), { expirationTtl: CACHE_TTL }).catch(() => {});
    return text;
  } catch (e) {
    console.warn(`КР ${id} недоступна: ${e.message}`);
    return null;
  }
}

/** КР для пациента: найти по диагнозу и коду МКБ, подтянуть текст. Никогда не бросает. */
export async function krForPatient(env, pat, mkb = "") {
  const kr = matchKr({ diagnosis: pat.true_diagnosis, mkb: mkb || pat.mkb10 || "", pediatric: Number(pat.age) < 18 && !pat.is_alien });
  if (!kr) return { kr: null, text: null };
  return { kr, text: await krText(env, kr.id) };
}
