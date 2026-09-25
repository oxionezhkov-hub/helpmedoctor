// Сборка статичных страниц сайта: главная, демо, посадочные страницы (аудитории, запросы, специальности),
// материалы, блог, документы, 404, sitemap.xml, llms.txt.
// Запуск: node scripts/build-site.mjs   (результат — в public/, коммитится вместе с исходниками)
// Цены, специальности и лимиты берутся из src/config.js — на сайте всегда актуальные цифры.
// Все кнопки ведут в веб-версию /app с меткой from=<место> (для аналитики и Метрики).
import fs from "node:fs";
import path from "node:path";
import { EARLY_UNTIL, FREE_DAILY_LIMIT, PACKS, PLANS, SPECIALIZATIONS, TRIAL } from "../src/config.js";
import { ARTICLES } from "./site/articles.mjs";
import { withFigures } from "./site/figures.mjs";
import { AUDIENCES, INTENTS, SPECIALTIES } from "./site/landings.mjs";
import { LEGAL_UPDATED, OFFER, PRIVACY, SELLER } from "./site/legal.mjs";

const SITE = "https://helpmedoctor.ru";
const BOT = "https://t.me/helpmedoctor_aibot";
const NAME = "Help me, Doctor";
const OUT = path.resolve(process.env.SITE_OUT || "public");
const SITE_UPDATED = "2026-09-25"; // дата изменения главной и посадочных — для sitemap
const CHECKLIST = { href: "/files/chek-list-sbor-anamneza.pdf", title: "Чек-лист: сбор анамнеза за 10 минут", pages: 2 };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rub = (p) => Number(p).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const ldjson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const app = (from) => `/app?from=${from}`;
const stripTags = (s) => String(s).replace(/<[^>]+>/g, "");

// Яндекс Метрика (счётчик 113057442) — на всех страницах сайта и в приложении, но не в админке
const METRIKA_HEAD = `<!-- Yandex.Metrika counter -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=113057442', 'ym');

    ym(113057442, 'init', {ssr:true, webvisor:true, clickmap:true, ecommerce:"dataLayer", referrer: document.referrer, url: location.href, accurateTrackBounce:true, trackLinks:true});
</script>
<!-- /Yandex.Metrika counter -->`;
const METRIKA_NOSCRIPT = `<noscript><div><img src="https://mc.yandex.ru/watch/113057442" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`;

const LOGO = `<svg viewBox="0 0 32 32" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="4" stroke="currentColor" style="stroke:var(--ink)" stroke-width="1.6"/><path d="M6.5 17h5l2.2-5 3.6 10 2.4-5h5.8"/></svg>`;
const BURGER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
const ARR = `<span class="arr" aria-hidden="true">→</span>`;

const ORG_SCHEMA = {
  "@context": "https://schema.org", "@type": "Organization", name: NAME, url: SITE, logo: `${SITE}/apple-touch-icon.png`, sameAs: [BOT],
  legalName: SELLER.name, email: SELLER.email,
  contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SELLER.email, availableLanguage: "ru" },
};
const SPEC_LIST = Object.entries(SPECIALTIES).map(([key, s]) => ({ key, ...s, sections: SPECIALIZATIONS[key] || [] }));
const EARLY_DATE = new Date(EARLY_UNTIL - 1).toLocaleDateString("ru", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const MONTH = PLANS.month;

// ---------------------------------------------------------------- каркас
const withBrand = (t) => (t.includes(NAME) || `${t} — ${NAME}`.length > 70 ? t : `${t} — ${NAME}`);

function head({ title, description, canonical, type = "website", extra = "", image = `${SITE}/og.png`, noindex = false }) {
  title = withBrand(title);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? "" : `<link rel="canonical" href="${canonical}">\n`}<meta name="robots" content="${noindex ? "noindex" : "index, follow, max-image-preview:large"}">
<meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121514" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/fonts/literata-700.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/site.css">
<script src="/site.js" defer></script>
${extra}
${METRIKA_HEAD}
</head>`;
}

const bodyOpen = (page) => `<body data-page="${page}" data-early-until="${EARLY_UNTIL}"${page.startsWith("blog_") ? ' data-popup="read"' : ""}>
${METRIKA_NOSCRIPT}`;

const promo = () => `<div class="promo" data-early hidden><div class="wrap"><span class="long">Ранние цены до ${EARLY_DATE}: премиум — <b>${rub(MONTH.early)} ₽</b> в месяц вместо ${rub(MONTH.price)} ₽, первые 7 дней — ${rub(TRIAL.price)} ₽.</span><span class="short">Премиум <b>7 дней за ${rub(TRIAL.price)} ₽</b>, потом ${rub(MONTH.early)} ₽/мес</span> <a href="${app("promo")}">Попробовать</a><button class="promo-x" type="button" aria-label="Скрыть">×</button></div></div>`;

const header = () => `<a class="skip" href="#main">Перейти к содержанию</a>
${promo()}
<header class="top"><div class="wrap">
  <a class="brand" href="/" aria-label="${NAME} — на главную">${LOGO}${NAME}</a>
  <nav class="nav" aria-label="Основное меню">
    <a href="/#how">Как это работает</a>
    <a href="/demo/">Демо</a>
    <details><summary>Для кого</summary><div class="menu">
      ${AUDIENCES.map((a) => `<a href="/${a.slug}/">${esc(a.nav)}<small>${esc(a.navHint)}</small></a>`).join("")}
      ${INTENTS.map((i) => `<a href="/${i.slug}/">${esc(i.nav)}<small>${esc(i.navHint)}</small></a>`).join("")}
    </div></details>
    <details><summary>Специальности</summary><div class="menu">
      ${SPEC_LIST.map((s) => `<a href="/specialnosti/${s.slug}/">${esc(s.name)}</a>`).join("")}
      <a href="/specialnosti/"><b>Все специальности</b></a>
    </div></details>
    <a href="/#pricing">Тарифы</a>
    <a href="/blog/">Блог</a>
  </nav>
  <button class="burger" type="button" aria-label="Меню" aria-expanded="false">${BURGER}</button>
  <a class="btn btn-primary" href="${app("header")}">Открыть тренажёр</a>
</div></header>`;

const footer = () => `<footer><div class="wrap">
  <div class="cols">
    <div>
      <a class="brand" href="/">${LOGO}${NAME}</a>
      <p style="margin-top:14px">Тренажёр клинического мышления для студентов-медиков, ординаторов и врачей. Пациенты вымышлены; сервис не оказывает медицинских услуг и не заменяет консультацию врача.</p>
    </div>
    <div><b>Тренажёр</b><ul>
      <li><a href="${app("footer")}">Веб-версия</a></li>
      <li><a href="/demo/">Демо-приём</a></li>
      <li><a href="/#pricing">Тарифы</a></li>
      <li><a href="/materialy/">Материалы</a></li>
      <li><a href="/o-proekte/">О проекте и контакты</a></li>
      <li><a href="/#faq">Вопросы и ответы</a></li>
      <li><a href="${BOT}" rel="noopener">Бот в Telegram</a></li>
    </ul></div>
    <div><b>Для кого</b><ul>
      ${[...AUDIENCES, ...INTENTS].map((a) => `<li><a href="/${a.slug}/">${esc(a.nav)}</a></li>`).join("")}
    </ul></div>
    <div><b>Специальности</b><ul>
      ${SPEC_LIST.map((s) => `<li><a href="/specialnosti/${s.slug}/">${esc(s.name)}</a></li>`).join("")}
    </ul></div>
    <div><b>Блог</b><ul>
      ${ARTICLES.slice(0, 6).map((a) => `<li><a href="/blog/${a.slug}/">${esc(a.h1.split(":")[0])}</a></li>`).join("")}
      <li><a href="/blog/">Все статьи</a></li>
    </ul></div>
  </div>
  <div class="legal-line">
    <span>ИП Ежков Олег Михайлович · ИНН 780454134703 · ОГРНИП 325784700383480</span>
    <span><a href="/oferta/">Публичная оферта</a> · <a href="/privacy/">Политика конфиденциальности</a></span>
  </div>
</div></footer>`;

const stickyCta = (from, text = "Первый пациент каждый день — бесплатно, без карты") =>
  `<div class="sticky-cta" role="complementary" aria-label="Быстрый старт"><p data-sticky-text>${esc(text)}</p><a class="btn btn-primary" href="${app(`sticky_${from}`.slice(0, 40))}" data-sticky-btn>Принять пациента ${ARR}</a></div>`;

/** Окно при уходе со страницы: чек-лист в PDF и бесплатный пациент */
const exitPopup = (from) => `<dialog class="pop" aria-labelledby="pop-t"><div class="pop-in">
  <button class="pop-x" type="button" data-close aria-label="Закрыть">×</button>
  <p class="mono">Бесплатно · PDF · 2 страницы</p>
  <h2 id="pop-t">Чек-лист сбора анамнеза</h2>
  <p>Две страницы, которые удобно держать в телефоне на практике и перед аккредитацией:</p>
  <ul><li>порядок расспроса по разделам</li><li>OPQRST для боли и «красные флаги»</li><li>фразы для начала и резюме приёма</li></ul>
  <a class="btn btn-primary" href="${CHECKLIST.href}" download data-close autofocus>Скачать чек-лист (PDF)</a>
  <a class="btn btn-ghost" href="${app(`popup_${from}`)}">Или сразу потренироваться на пациенте ${ARR}</a>
</div></dialog>`;

function layout({ page, headOpts, main, sticky = true, popup = true, progress = false, stickyText }) {
  return `${head(headOpts)}
${bodyOpen(page)}
${progress ? '<div class="progress" aria-hidden="true"></div>' : ""}
${header()}
<main id="main">
${main}
</main>
${footer()}
${sticky ? stickyCta(page, stickyText) : ""}
${popup ? exitPopup(page) : ""}
</body>
</html>
`;
}

const crumbs = (items) => {
  const html = `<nav class="crumbs" aria-label="Навигация"><ol>${items.map(([n, u], i) => `<li>${u && i < items.length - 1 ? `<a href="${u}">${esc(n)}</a>` : esc(n)}</li>`).join("")}</ol></nav>`;
  const schema = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map(([n, u], i) => ({ "@type": "ListItem", position: i + 1, name: n, item: `${SITE}${u}` })) };
  return { html, schema };
};
const faqSchema = (faq) => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: stripTags(a) } })) });
const faqBlock = (faq) => `<div class="faq">${faq.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${a}</p></details>`).join("")}</div>`;

const postCard = (a) => `<a class="post-card" href="/blog/${a.slug}/">${a.cover ? `<img class="post-cover" src="/blog/${a.slug}/cover.jpg" alt="" width="1200" height="630" loading="lazy" decoding="async">` : ""}<div class="post-body"><h3>${esc(a.h1)}</h3><p>${esc(a.description)}</p><span class="meta">${a.minutes} мин чтения</span></div></a>`;

const inlineCta = (title, text, from, label = "Попробовать бесплатно") =>
  `<aside class="inline-cta"><div><b>${esc(title)}</b><p>${esc(text)}</p></div><a class="btn btn-primary" href="${app(from)}">${esc(label)} ${ARR}</a></aside>`;

// ---------------------------------------------------------------- общие блоки
function heroChart() {
  return `<figure class="chart" role="img" aria-label="Пример карты приёма в тренажёре: жалобы пациента, вопросы врача, результат ФГДС, диагноз и оценка приёма 4,5 из 5">
  <div class="chart-h"><span>Пример приёма · карта № 0147</span><span>Гастроэнтерология · средняя</span></div>
  <dl>
    <dt>Пациент</dt><dd>Мирон Л., 47 лет, водитель</dd>
    <dt>Жалобы</dt><dd><q>Жжёт под ложечкой третью неделю</q></dd>
    <dt>Вы спросили</dt><dd class="hand">натощак или после еды? лекарства?</dd>
    <dt>Ответ</dt><dd><q>От спины пью ибупрофен…</q></dd>
    <dt>ФГДС</dt><dd>язва луковицы ДПК, 8 мм</dd>
    <dt>Диагноз</dt><dd class="hand">язва ДПК на фоне НПВП</dd>
  </dl>
  <div class="stamp">Ваш разбор<b>4,5</b>из 5</div>
</figure>`;
}

function demoBlock() {
  return `<div class="demo" data-demo>
  <aside class="demo-side">
    <div class="demo-pat"><img src="/api/face?v=3&amp;s=demo-miron&amp;g=m&amp;a=47" alt="" width="56" height="56" loading="lazy"><div><b>Мирон Лесков, <span class="nw">47 лет</span></b><span>водитель · жалобы на боль в животе</span></div></div>
    <ol class="demo-steps"><li class="on">Расспрос</li><li>Обследование</li><li>Диагноз</li><li>Разбор</li></ol>
    <p class="small">Демо с готовым сценарием, без регистрации. В тренажёре пациент отвечает на любые ваши вопросы — текстом или голосом.</p>
  </aside>
  <div class="demo-main">
    <div class="demo-log" aria-live="polite">
      <div class="bubble pat">Доктор, жжёт под ложечкой уже третью неделю. Сил нет.</div>
      <div class="bubble doc">Когда болит — натощак или после еды? Какие лекарства принимаете?</div>
      <div class="bubble pat">Натощак хуже, поем — отпускает. От спины пью ибупрофен, месяц уже.</div>
      <div class="bubble res"><b>ФГДС</b>Язвенный дефект 8 мм в луковице двенадцатиперстной кишки.</div>
    </div>
    <div class="demo-act"><noscript><p>Включите JavaScript, чтобы пройти демо, или сразу <a href="${app("demo_nojs")}">откройте тренажёр</a>.</p></noscript></div>
  </div>
</div>`;
}

function sampleReview() {
  return `<div class="review" role="img" aria-label="Пример разбора приёма: оценки по разделам, цитата из диалога, пропущенные вопросы и исход">
  <div class="review-h"><b>Разбор приёма</b><span>4,5 / 5</span></div>
  <div class="scores">
    <div><span>Диагностика</span><i style="--w:90%"></i><span>4,5</span></div>
    <div><span>Коммуникация</span><i style="--w:100%"></i><span>5</span></div>
    <div><span>Лечение</span><i style="--w:80%"></i><span>4</span></div>
  </div>
  <blockquote>«Боль больше натощак или после еды?» — точный вопрос: «голодные» боли сразу сузили круг.</blockquote>
  <ul>
    <li>Не спросили о чёрном стуле — признак кровотечения меняет срочность.</li>
    <li>Хорошо: уточнили лекарства и нашли причину — ибупрофен.</li>
    <li>Совет: отменяя НПВП, предложите пациенту, чем обезболить спину.</li>
  </ul>
  <p class="outcome"><strong>Что было дальше:</strong> ИПП 8 недель, ибупрофен отменён — через два месяца язва зарубцевалась.</p>
</div>`;
}

function magnetBlock(from) {
  return `<div class="magnet">
  <div class="magnet-doc" aria-hidden="true"><b>Сбор анамнеза за 10 минут</b><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div>
    <p class="mono muted" style="margin:0 0 8px">Бесплатно · PDF · ${CHECKLIST.pages} страницы</p>
    <p class="magnet-h">${esc(CHECKLIST.title)}</p>
    <p>Порядок расспроса, OPQRST для боли, «красные флаги» по системам и готовые фразы для начала и конца приёма. Удобно открыть с телефона на практике или перед станцией аккредитации.</p>
    <div class="cta" style="margin-bottom:0"><a class="btn btn-primary" href="${CHECKLIST.href}" download>Скачать чек-лист</a><a class="btn btn-ghost" href="${app(from)}">Отработать на пациенте ${ARR}</a></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------- главная
const FAQ = [
  ["Сколько это стоит и что будет после 1 ₽?", `${FREE_DAILY_LIMIT === 1 ? "Один пациент" : `${FREE_DAILY_LIMIT} пациента`} в день — бесплатно и без карты. Премиум — безлимит пациентов, полный ИИ-разбор, тесты по ошибкам и «Очень сложные» случаи: первые 7 дней за ${rub(TRIAL.price)} ₽, затем ${rub(MONTH.early)} ₽ в месяц для ранних пользователей (до ${EARLY_DATE}, потом ${rub(MONTH.price)} ₽; ранняя цена сохраняется, пока подписка активна). За сутки до конца пробного периода напомним в приложении и в Telegram. Есть тарифы на неделю, 3 месяца и год одним платежом. Оплата картой или через СБП.`],
  ["Как отменить подписку и вернуть деньги?", "Автопродление отключается в профиле → «Подписка» одной кнопкой; до конца пробного периода — без оплаты, премиум остаётся до конца оплаченного срока. Если списание прошло ошибочно или вы не пользовались премиумом после него, в течение 14 дней можно запросить возврат — условия в оферте."],
  ["Кто пишет разбор приёма?", "Разбор генерирует искусственный интеллект: он сравнивает ваш диалог и назначения со скрытой историей случая и оценивает диагностику, коммуникацию и лечение. ИИ может ошибаться — используйте разбор для самопроверки, а медицинские факты сверяйте с клиническими рекомендациями и учебниками."],
  ["Чем это лучше, чем попросить чат-бота сыграть пациента?", "У пациента в тренажёре есть скрытый диагноз и история болезни, которые не меняются по ходу разговора; анализы и исследования дают результаты под этот диагноз; после приёма — разбор по разделам и тест по вашим ошибкам. Плюс уровни сложности под вашу роль, специальности, прогресс и статистика."],
  ["Это медицинская консультация?", "Нет. «Help me, Doctor» — учебный тренажёр: все пациенты вымышлены. Сервис не ставит диагнозы реальным людям и не заменяет обращение к врачу."],
  ["Кому подходит тренажёр?", "Студентам медицинских вузов, ординаторам и практикующим врачам. При первом входе вы выбираете роль, специальность, разделы и сложность — пациенты подбираются под вас."],
  ["Поможет ли подготовиться к аккредитации?", "Тренажёр отрабатывает то, что проверяют на станции сбора жалоб и анамнеза и в ситуационных задачах: полный расспрос и клиническое рассуждение. Банк тестов и паспорта станций публикует Методический центр аккредитации — используйте их параллельно."],
  ["Как войти?", "Откройте веб-версию и войдите через Яндекс ID, Google или Telegram — это занимает несколько секунд. Если начали без Telegram, привязать его можно позже в профиле: прогресс объединится."],
  ["Можно ли общаться с пациентом голосом?", "Да. В веб-версии и в Telegram можно отправлять голосовые сообщения — они распознаются и превращаются в вопрос пациенту."],
  ["Какие данные вы храните?", "Имя и идентификатор аккаунта, через который вы вошли (Telegram, Яндекс или Google, для последних — ещё почту), анкету и историю приёмов. Данные карты мы не получаем. Подробно — в политике обработки персональных данных; удалить аккаунт можно по запросу."],
  ["Даёт ли тренажёр баллы НМО?", "Нет. Это инструмент самостоятельной практики, а не образовательная программа в системе непрерывного медицинского образования."],
];

function pricingBlock(from) {
  const visible = Object.entries(PLANS).filter(([, p]) => !p.hidden);
  const perMonth = (p) => Math.round((Number(p.early || p.price) / p.days) * 30);
  const cheapest = visible.reduce((a, b) => (perMonth(b[1]) < perMonth(a[1]) ? b : a))[0];
  const rows = visible.map(([k, p]) => {
    const price = Number(p.early || p.price);
    const best = k === cheapest;
    return `<tr${best ? ' class="best"' : ""}><td>${esc(p.label)}${best ? '<span class="tag">дешевле всего</span>' : ""}<div class="per">${k === "month" ? "автопродление, отключается в любой момент" : k === "week" ? "одним платежом, без подписки" : "одним платежом"} · ≈ ${rub(perMonth(p))} ₽/мес</div></td>
      <td class="price">${rub(price)} ₽${p.early ? `<s data-early>${rub(p.price)} ₽</s>` : ""}</td><td><a href="${app(`${from}_${k}`)}">Выбрать</a></td></tr>`;
  }).join("");
  return `<div class="pricing">
  <div class="trial">
    <span class="mono">Премиум на пробу</span>
    <h3>7 дней за ${rub(TRIAL.price)} ₽</h3>
    <ul><li>безлимит пациентов</li><li>полный ИИ-разбор</li><li>тесты «работа над ошибками»</li><li>«Очень сложные» случаи</li></ul>
    <p>Дальше — ${rub(MONTH.early)} ₽ в месяц${MONTH.early ? ` вместо ${rub(MONTH.price)} ₽, и эта цена остаётся за вами, пока подписка активна` : ""}. Напомним за сутки до списания; отключить продление — одна кнопка в профиле.</p>
    <a class="btn btn-primary btn-lg" href="${app(`${from}_trial`)}">Попробовать за ${rub(TRIAL.price)} ₽ ${ARR}</a>
    <p class="countdown" data-countdown hidden></p>
  </div>
  <div>
    <table class="plans-t">
      <thead><tr><th>Срок</th><th>Цена</th><th></th></tr></thead>
      <tbody>
        <tr><td>Бесплатно<div class="per">${FREE_DAILY_LIMIT} ${FREE_DAILY_LIMIT === 1 ? "пациент" : "пациента"} в день, оценка и краткий ИИ-разбор</div></td><td class="price">0 ₽</td><td><a href="${app(`${from}_free`)}">Начать</a></td></tr>
        ${rows}
      </tbody>
    </table>
    <p class="pay-note">Цены для ранних пользователей действуют до ${EARLY_DATE}. Разово: ${esc(PACKS.patients3.label)} — ${rub(PACKS.patients3.price)} ₽, ${esc(PACKS.freeze.label.toLowerCase())} — ${rub(PACKS.freeze.price)} ₽. Оплата картой или через СБП; подробности — в <a href="/oferta/">оферте</a>.</p>
  </div>
</div>`;
}

function landing() {
  const title = "Тренажёр врача с виртуальными пациентами — Help me, Doctor";
  const description = "Тренажёр для студентов-медиков, ординаторов и врачей: расспрос ИИ-пациента, обследования, диагноз и ИИ-разбор приёма. Один пациент в день бесплатно.";
  const validUntil = new Date(EARLY_UNTIL - 1).toISOString().slice(0, 10);
  const offers = [
    { "@type": "Offer", name: `Премиум — ${TRIAL.label.toLowerCase()}`, price: Number(TRIAL.price).toFixed(2), priceCurrency: "RUB" },
    ...Object.entries(PLANS).filter(([, p]) => !p.hidden).map(([, p]) => ({ "@type": "Offer", name: `Премиум — ${p.label}`, price: Number(p.early || p.price).toFixed(2), priceCurrency: "RUB", ...(p.early ? { priceValidUntil: validUntil } : {}) })),
  ];
  const schema = [
    ORG_SCHEMA,
    { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE, inLanguage: "ru" },
    {
      "@context": "https://schema.org", "@type": "WebApplication", name: NAME, url: `${SITE}/`,
      applicationCategory: "EducationalApplication", operatingSystem: "Web, Telegram", inLanguage: "ru", description,
      audience: { "@type": "EducationalAudience", educationalRole: ["student", "professional"] },
      offers: [{ "@type": "Offer", name: "Бесплатный доступ", price: "0", priceCurrency: "RUB" }, ...offers],
    },
    faqSchema(FAQ),
  ];
  const main = `
<section class="hero" data-hero><div class="wrap">
  <div>
    <p class="kicker"><span>Тренажёр клинического мышления</span><span>студентам, ординаторам, врачам</span></p>
    <h1>Тренажёр врача с виртуальными пациентами</h1>
    <p class="lead">Приём от жалобы до диагноза за 10 минут: расспрашиваете пациента текстом или голосом, назначаете анализы, ставите диагноз — и сразу видите разбор: что спросили точно, что упустили и чем всё закончилось.</p>
    <div class="cta">
      <a class="btn btn-primary btn-lg" href="${app("hero")}">Принять пациента бесплатно ${ARR}</a>
      <a class="btn btn-ghost btn-lg" href="#demo">Демо за минуту</a>
    </div>
    <ul class="cta-note"><li>без карты и установки</li><li>вход через Яндекс, Google или Telegram</li><li>${Object.keys(SPECIALIZATIONS).length} специальностей</li></ul>
    <p class="live" data-live hidden><i></i><span></span></p>
  </div>
  ${heroChart()}
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="sec-no">Зачем</div><div><h2>Знать болезнь и&nbsp;узнать её у&nbsp;пациента — разные навыки</h2><p>На экзамене и в клинике спросят не «что такое язва», а «что с этим пациентом». Второму учит только практика с обратной связью.</p></div></div>
  <div class="versus">
    <div class="bad"><h3>Как обычно учатся</h3><ul>
      <li>ситуационные задачи, где все данные уже собраны за вас</li>
      <li>на обходе — два-три вопроса пациенту, остальное слушаете</li>
      <li>ошибку в расспросе никто не показывает — она всплывает на экзамене</li>
      <li>учебник читается подряд, а не по вашим пробелам</li>
    </ul></div>
    <div class="good"><h3>Как в тренажёре</h3><ul>
      <li>пациент говорит только то, о чём спросили, — данные собираете сами</li>
      <li>полный приём от жалобы до лечения за 10–15 минут</li>
      <li>разбор сразу: цитаты из вашего диалога и пропущенные вопросы</li>
      <li>тест по ошибкам именно этого приёма</li>
    </ul></div>
  </div>
</div></section>

<section id="how" class="tint"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Как это работает</div><div><h2>Приём от жалобы до разбора</h2><p>Как на настоящем приёме — только без риска для пациента и с обратной связью сразу после.</p></div></div>
  <ol class="steps">
    <li><span class="n">1</span><h3>Пациент с жалобой</h3><p>ИИ создаёт новый случай по вашей специальности, разделам и уровню сложности. У пациента свой характер и манера речи.</p></li>
    <li><span class="n">2</span><h3>Расспрос и осмотр</h3><p>Вопросы текстом или голосом. Пациент отвечает только на заданное и может что-то забыть или скрыть.</p></li>
    <li><span class="n">3</span><h3>Обследования</h3><p>Анализы, УЗИ, КТ, ЭКГ, эндоскопия — результаты соответствуют методу и скрытому диагнозу.</p></li>
    <li><span class="n">4</span><h3>Диагноз и разбор</h3><p>Лечение или направление к специалисту — ИИ разберёт решение и расскажет, что стало с пациентом.</p></li>
  </ol>
</div></section>

<section id="demo" class="airy"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Демо</div><div><h2>Попробуйте прямо здесь</h2><p>Короткий приём с готовым сценарием: задайте вопросы, назначьте обследования и поставьте диагноз. Регистрация не нужна.</p></div></div>
  ${demoBlock()}
</div></section>

<section class="tint"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Разбор</div><div><h2>После каждого приёма — подробный ИИ-разбор</h2><p>Не просто «верно / неверно»: оценка по разделам, ваши же формулировки и конкретный совет на следующий раз.</p></div></div>
  <div class="review-wrap">
    ${sampleReview()}
    <ul class="feat">
      <li><span class="k">01</span><div><b>Живые пациенты</b><span>Тревожные, ворчливые, немногословные — у каждого свой характер и манера речи.</span></div></li>
      <li><span class="k">02</span><div><b>Голосовой расспрос</b><span>Говорите с пациентом, как на приёме: речь распознаётся автоматически.</span></div></li>
      <li><span class="k">03</span><div><b>Честные обследования</b><span>Каждый метод показывает только то, что может показать. Лишние назначения разбор тоже отметит.</span></div></li>
      <li><span class="k">04</span><div><b>Работа над ошибками</b><span>Короткий тест по пробелам конкретного приёма — повторение там, где оно нужно.</span></div></li>
      <li><span class="k">05</span><div><b>Сайт и Telegram вместе</b><span>Начните в браузере, продолжите в боте. Уровни, стрики и задания дня держат в ритме.</span></div></li>
    </ul>
  </div>
</div></section>

<section id="for"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Для кого</div><div><h2>Сложность подстраивается под вас</h2><p>При первом входе вы указываете роль, специальность и разделы — пациенты подбираются под этот профиль.</p></div></div>
  <div class="who">
    ${AUDIENCES.map((a) => `<a href="/${a.slug}/"><span class="role">${esc(a.navHint)}</span><h3>${esc(a.nav)}</h3><ul>${a.points.slice(0, 3).map((p) => `<li>${esc(p)}</li>`).join("")}</ul><span class="more">Подробнее ${ARR}</span></a>`).join("")}
  </div>
</div></section>

<section class="tint"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Специальности</div><div><h2>Случаи по ${Object.keys(SPECIALIZATIONS).length} специальностям</h2><p>Выберите свою или впишите любую другую — разделы для неё подберёт ИИ.</p></div></div>
  <div class="specs">${SPEC_LIST.map((s) => `<a href="/specialnosti/${s.slug}/"><b>${esc(s.name)}</b><span>${esc(s.sections.join(", "))}</span></a>`).join("")}</div>
</div></section>

<section><div class="wrap">
  <div class="sec-head"><div class="sec-no">Сравнение</div><div><h2>Чем тренажёр отличается от задачника</h2><p>Каждый формат полезен по-своему. Тренажёр закрывает то, чего не дают остальные: свободный расспрос с быстрой обратной связью.</p></div></div>
  <div class="table-wrap"><table class="cmp">
    <thead><tr><th>Что нужно для навыка</th><th class="us">Тренажёр</th><th>Ситуационные задачи</th><th>Учебник</th><th>Практика в клинике</th></tr></thead>
    <tbody>
      <tr><td>Самому собирать анамнез</td><td class="us yes">да</td><td class="no">нет</td><td class="no">нет</td><td class="part">иногда</td></tr>
      <tr><td>Разбор ошибок сразу после</td><td class="us yes">да</td><td class="part">эталон ответа</td><td class="no">нет</td><td class="part">если повезёт</td></tr>
      <tr><td>Новые случаи каждый день</td><td class="us yes">да</td><td class="no">сборник кончается</td><td class="no">нет</td><td class="yes">да</td></tr>
      <tr><td>Без риска для пациента</td><td class="us yes">да</td><td class="yes">да</td><td class="yes">да</td><td class="no">нет</td></tr>
      <tr><td>В любое время, с телефона</td><td class="us yes">да</td><td class="yes">да</td><td class="yes">да</td><td class="no">нет</td></tr>
      <tr><td>Осмотр руками, манипуляции</td><td class="us no">нет</td><td class="no">нет</td><td class="no">нет</td><td class="yes">да</td></tr>
    </tbody>
  </table></div>
</div></section>

<section id="pricing" class="tint"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Тарифы</div><div><h2>Начните бесплатно</h2><p>Один пациент в день — без оплаты. Если хочется больше практики — безлимит на удобный срок.</p></div></div>
  ${pricingBlock("pricing")}
</div></section>

<section id="materials" class="tight"><div class="wrap">${magnetBlock("magnet_home")}</div></section>

<section id="blog" class="tint"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Блог</div><div><h2>Статьи для студентов и ординаторов</h2><p>Коротко и по делу о навыках, которые нужны на практике и на аккредитации.</p></div></div>
  <div class="posts">${ARTICLES.slice(0, 3).map(postCard).join("")}</div>
  <p style="margin-top:24px"><a href="/blog/"><b>Все статьи →</b></a></p>
</div></section>

<section id="faq"><div class="wrap">
  <div class="sec-head"><div class="sec-no">Вопросы</div><div><h2>Вопросы и ответы</h2></div></div>
  ${faqBlock(FAQ)}
</div></section>

<section class="final"><div class="wrap">
  <div><p class="final-h">Первый пациент уже ждёт</p><p>Ответьте на четыре вопроса о себе — и тренажёр подберёт случай под вашу специальность и уровень. Это бесплатно.</p></div>
  <div class="cta"><a class="btn btn-primary btn-lg" href="${app("final")}">Открыть тренажёр ${ARR}</a></div>
</div></section>`;
  return layout({ page: "home", headOpts: { title, description, canonical: `${SITE}/`, extra: schema.map(ldjson).join("\n") }, main });
}

// ---------------------------------------------------------------- посадочные страницы
function sideCta(from, title = "Первый пациент — бесплатно", points = ["без установки, в браузере", "вход через Яндекс, Google или Telegram", "ИИ-разбор после приёма"]) {
  return `<aside class="aside-sticky"><div class="side-cta">
  <p class="side-h">${esc(title)}</p>
  <ul>${points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
  <a class="btn btn-primary" href="${app(from)}">Открыть тренажёр ${ARR}</a>
  <p style="margin:12px 0 0;font-size:14px"><a href="/demo/">или пройти демо за минуту</a></p>
</div></aside>`;
}

function landingPage({ slug, page, crumbsItems, title, description, kicker, h1, lead, points, body, faq = [], extraSchema = [], afterBody = "", stickyText }) {
  const url = `${SITE}/${slug}/`;
  const c = crumbs(crumbsItems);
  const schema = [c.schema, { "@context": "https://schema.org", "@type": "WebPage", name: h1, url, description, inLanguage: "ru", isPartOf: { "@type": "WebSite", name: NAME, url: SITE } }, ...(faq.length ? [faqSchema(faq)] : []), ...extraSchema];
  const main = `
<section class="page-hero" data-hero style="border-bottom:1px solid var(--rule)"><div class="wrap">
  <div>
    ${c.html}
    ${kicker ? `<p class="kicker"><span>${esc(kicker)}</span></p>` : ""}
    <h1>${esc(h1)}</h1>
    <p class="lead">${esc(lead)}</p>
    <div class="cta"><a class="btn btn-primary btn-lg" href="${app(`${page}_hero`)}">Принять пациента бесплатно ${ARR}</a><a class="btn btn-ghost btn-lg" href="/demo/">Демо</a></div>
  </div>
  ${points?.length ? `<ul class="feat" style="align-self:center">${points.map((p, i) => `<li><span class="k">0${i + 1}</span><div><b>${esc(p.charAt(0).toUpperCase() + p.slice(1))}</b></div></li>`).join("")}</ul>` : ""}
</div></section>
<section style="padding-top:56px"><div class="wrap two">
  <div class="prose">
    ${body.trim()}
    ${inlineCta("Проверьте себя на пациенте", "Расспрос, обследования и диагноз — а затем ИИ-разбор. Один пациент в день бесплатно.", `${page}_inline`)}
    ${faq.length ? `<h2>Частые вопросы</h2>${faqBlock(faq)}` : ""}
    ${afterBody}
  </div>
  ${sideCta(`${page}_side`)}
</div></section>
<section class="final"><div class="wrap">
  <div><p class="final-h">Практика, а не ещё один конспект</p><p>10 минут на пациента, разбор сразу после. Начните с бесплатного приёма.</p></div>
  <div class="cta"><a class="btn btn-primary btn-lg" href="${app(`${page}_final`)}">Открыть тренажёр ${ARR}</a></div>
</div></section>`;
  return layout({ page, stickyText, headOpts: { title, description, canonical: url, extra: schema.map(ldjson).join("\n") }, main });
}

const relatedLinks = (items) => `<h2>Смотрите также</h2><ul class="links-list">${items.map(([t, u]) => `<li><a href="${u}">${esc(t)}</a></li>`).join("")}</ul>`;

function audiencePage(a) {
  const others = [...AUDIENCES.filter((x) => x.slug !== a.slug).map((x) => [x.h1, `/${x.slug}/`]), [INTENTS[0].h1, `/${INTENTS[0].slug}/`], ["Все специальности", "/specialnosti/"]];
  return landingPage({ slug: a.slug, page: a.slug, crumbsItems: [["Главная", "/"], [a.nav, `/${a.slug}/`]], title: a.title, description: a.description, kicker: a.role, h1: a.h1, lead: a.lead, points: a.points, body: a.body, faq: a.faq, afterBody: relatedLinks(others) });
}

function intentPage(i) {
  const others = [...INTENTS.filter((x) => x.slug !== i.slug).map((x) => [x.h1, `/${x.slug}/`]), ...AUDIENCES.slice(0, 2).map((x) => [x.h1, `/${x.slug}/`])];
  return landingPage({ slug: i.slug, page: i.slug, crumbsItems: [["Главная", "/"], [i.nav, `/${i.slug}/`]], title: i.title, description: i.description, kicker: i.navHint, h1: i.h1, lead: i.lead, points: i.points, body: i.body, faq: i.faq, afterBody: relatedLinks(others) });
}

function caseHtml(s) {
  const c = s.case;
  return `<div class="case">
  <div class="case-h"><span>Учебный случай</span><span>${esc(s.name)} · ${esc(c.level)} сложность</span></div>
  <div class="case-b"><dl>
    <dt>Пациент</dt><dd>${esc(c.who)}</dd>
    <dt>Жалобы</dt><dd>${esc(c.complaint)}</dd>
    <dt>Из расспроса</dt><dd><ul>${c.found.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></dd>
  </dl></div>
  <details><summary>Какие вопросы важно задать</summary><ul>${c.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></details>
  <details><summary>Диагноз и тактика</summary><p><strong>${esc(c.answer)}</strong></p><p>${esc(c.tactics)}</p></details>
  <details><summary>Типичная ошибка</summary><p>${esc(c.pitfall)}</p></details>
</div>`;
}

function specialtyPage(s) {
  const slug = `specialnosti/${s.slug}`;
  const faq = [
    [`Какие разделы ${s.gen} есть в тренажёре?`, `Сейчас: ${s.sections.join(", ")}. Разделы можно отметить при первом входе или в настройках — пациенты будут подбираться по ним. Можно выбрать несколько специальностей и сложность от лёгкой до очень сложной.`],
    [`Подойдут ли случаи по ${s.gen} студенту?`, "Да. На лёгком уровне картина болезни типичная, и разбор объясняет, какие вопросы и обследования были ключевыми. Ординаторам и врачам подойдут средний и сложный уровни с отвлекающими симптомами."],
  ];
  const body = `
<h2>Пример случая: ${esc(s.case.complaint.split(/[,:—]/)[0].toLowerCase())}</h2>
<p>Так выглядит случай, собранный целиком. В тренажёре вы получите только жалобу — остальное нужно выяснить самому.</p>
${caseHtml(s)}
<p class="note">Учебный пример. Тактика лечения зависит от клинической ситуации — ориентируйтесь на действующие клинические рекомендации Минздрава РФ.</p>
<h2>Разделы специальности в тренажёре</h2>
<p>При выборе специальности «${esc(s.key)}» пациенты подбираются по разделам: <strong>${esc(s.sections.join(", "))}</strong>. Можно отметить часть из них, добавить смежные специальности или вписать свои разделы.</p>`;
  const others = SPEC_LIST.filter((x) => x.slug !== s.slug).map((x) => [`Клинические случаи: ${x.name.toLowerCase()}`, `/specialnosti/${x.slug}/`]);
  return landingPage({
    slug, page: `spec_${s.slug}`, crumbsItems: [["Главная", "/"], ["Специальности", "/specialnosti/"], [s.name, `/${slug}/`]],
    title: `Клинические случаи по ${s.gen} онлайн`, description: s.description, kicker: s.sections.join(" · "), h1: `Клинические случаи по ${s.gen}`, lead: s.intro,
    points: s.skills, body, faq, stickyText: `Случай по ${s.gen} — бесплатно`, afterBody: relatedLinks([...others, ["Все специальности", "/specialnosti/"]]),
  });
}

function specialtiesIndex() {
  const url = `${SITE}/specialnosti/`;
  const c = crumbs([["Главная", "/"], ["Специальности", "/specialnosti/"]]);
  const schema = [c.schema, { "@context": "https://schema.org", "@type": "ItemList", itemListElement: SPEC_LIST.map((s, i) => ({ "@type": "ListItem", position: i + 1, name: s.name, url: `${SITE}/specialnosti/${s.slug}/` })) }];
  const main = `
<section class="page-hero solo" data-hero><div class="wrap">
  ${c.html}
  <h1>Клинические случаи по специальностям</h1>
  <p class="lead">Выберите специальность, чтобы посмотреть пример случая и разделы. В тренажёре можно отметить несколько специальностей или вписать свою.</p>
</div></section>
<section><div class="wrap">
  <div class="specs">${SPEC_LIST.map((s) => `<a href="/specialnosti/${s.slug}/"><b>${esc(s.name)}</b><span>Пример: ${esc(s.case.complaint.split(/[,:—]/)[0].toLowerCase())} · ${esc(s.sections.join(", "))}</span></a>`).join("")}</div>
  ${inlineCta("Не нашли свою специальность?", "Впишите её при первом входе — разделы и пациентов подберёт ИИ.", "specs_index", "Открыть тренажёр")}
</div></section>`;
  return layout({ page: "specialnosti", headOpts: { title: "Клинические случаи по специальностям", description: `Клинические случаи онлайн по ${SPEC_LIST.length} специальностям — от терапии и кардиологии до неотложной помощи. Пример случая и разделы для каждой.`, canonical: url, extra: schema.map(ldjson).join("\n") }, main });
}

function demoPage() {
  const url = `${SITE}/demo/`;
  const c = crumbs([["Главная", "/"], ["Демо", "/demo/"]]);
  const main = `
<section class="page-hero solo" data-hero style="padding-bottom:32px"><div class="wrap" style="max-width:var(--maxw)">
  ${c.html}
  <h1>Демо-приём: виртуальный пациент за минуту</h1>
  <p class="lead">Пациент с болью в животе. Задайте вопросы, назначьте обследования, поставьте диагноз — и посмотрите, как выглядит ИИ-разбор. Без регистрации.</p>
</div></section>
<section style="padding-top:8px"><div class="wrap">
  ${demoBlock()}
  <div class="prose" style="margin-top:48px">
    <h2>Чем демо отличается от настоящего приёма</h2>
    <p>В демо вопросы и обследования выбираются из списка, а сценарий заранее написан. В тренажёре пациента играет языковая модель: вы задаёте любые вопросы своими словами — текстом или голосом, — назначаете любые обследования, а ИИ разбирает именно ваш диалог. Каждый случай новый и подобран под вашу специальность и уровень.</p>
    ${inlineCta("Готовы к настоящему пациенту?", "Первый приём — бесплатно. Вход через Яндекс, Google или Telegram.", "demo_page")}
  </div>
</div></section>`;
  return layout({ page: "demo", headOpts: { title: "Демо: виртуальный пациент онлайн без регистрации", description: "Пройдите демо-приём виртуального пациента без регистрации: расспрос, обследования, диагноз и ИИ-разбор. Посмотрите, как работает тренажёр врача.", canonical: url, extra: ldjson(c.schema) }, main });
}

function materialsPage() {
  const url = `${SITE}/materialy/`;
  const c = crumbs([["Главная", "/"], ["Материалы", "/materialy/"]]);
  const links = [
    ["Рубрикатор клинических рекомендаций Минздрава РФ", "https://cr.minzdrav.gov.ru/", "официальные клинические рекомендации — первоисточник для тактики и доз"],
    ["Методический центр аккредитации: практические навыки «Лечебное дело»", "https://fmza.ru/fund_assessment_means/lechebnoe-delo/perechen-prakticheskikh-navykov-umeniy/", "паспорта и чек-листы станций ОСКЭ"],
    ["Государственный реестр лекарственных средств", "https://grls.rosminzdrav.ru/", "инструкции к зарегистрированным препаратам"],
    ["Справочник MSD для специалистов (на русском)", "https://www.msdmanuals.com/ru-ru/professional", "бесплатный справочник по заболеваниям и нормам анализов"],
    ["ВОЗ: книга по антибиотикам AWaRe", "https://www.who.int/publications/i/item/9789240062382", "выбор антибиотика первой линии при частых инфекциях (англ.)"],
  ];
  const schema = [c.schema, { "@context": "https://schema.org", "@type": "CollectionPage", name: "Бесплатные материалы для студентов-медиков", url, inLanguage: "ru" }];
  const main = `
<section class="page-hero solo" data-hero><div class="wrap">
  ${c.html}
  <h1>Бесплатные материалы для студентов-медиков</h1>
  <p class="lead">Чек-листы и шпаргалки, которые мы делаем сами, и проверенные первоисточники: клинические рекомендации, материалы аккредитации, справочники.</p>
</div></section>
<section style="padding-top:48px"><div class="wrap">
  ${magnetBlock("materials")}
  <div class="prose" style="margin-top:56px">
    <h2>Что в чек-листе</h2>
    <ul>
      <li>шесть разделов расспроса по порядку — от знакомства до резюме;</li>
      <li>детализация боли по OPQRST;</li>
      <li>вопросы, которые чаще всего забывают: аллергия, лекарства, БАДы, эпиданамнез;</li>
      <li>«красные флаги» по системам органов — когда нужно действовать срочно;</li>
      <li>готовые фразы для начала приёма и резюмирования.</li>
    </ul>
    <p>Чек-лист основан на статье «<a href="/blog/sbor-anamneza/">Как собрать анамнез: пошаговая схема</a>». Распространяйте свободно со ссылкой на helpmedoctor.ru.</p>
    <h2>Проверенные первоисточники</h2>
    <ul class="links-list">${links.map(([t, u, d]) => `<li><a href="${u}" rel="noopener" target="_blank"><span><b>${esc(t)}</b><br><span class="muted" style="font-size:15px">${esc(d)}</span></span></a></li>`).join("")}</ul>
  </div>
</div></section>`;
  return layout({ page: "materialy", headOpts: { title: "Чек-лист сбора анамнеза в PDF и материалы для студентов", description: "Бесплатный чек-лист сбора анамнеза в PDF и подборка первоисточников: клинические рекомендации, материалы аккредитации, справочники для студентов-медиков и ординаторов.", canonical: url, extra: schema.map(ldjson).join("\n") }, main });
}

// ---------------------------------------------------------------- блог
// Контекстный призыв по темам статьи
function articleCta(a) {
  const t = a.tags.join(" ").toLowerCase();
  if (/анамнез|коммуникац|общени/.test(t)) return ["Отработайте расспрос на пациенте, который не выкладывает всё сразу", "Виртуальный пациент отвечает только на заданный вопрос. После приёма ИИ-разбор покажет, что вы упустили."];
  if (/аккредит|оскэ|экзамен/.test(t)) return ["Потренируйте станцию анамнеза без стандартизированного пациента", "Полный приём за 10 минут и разбор: какие обязательные вопросы вы пропустили."];
  if (/анализ|лаборатор/.test(t)) return ["Интерпретируйте анализы на живом случае", "Назначьте обследования виртуальному пациенту и сопоставьте результаты с клинической картиной."];
  return ["Проверьте клиническое мышление на новом случае", "Расспрос, обследования, диагноз — и ИИ-разбор с вашими же формулировками."];
}

/** id для заголовков h2 (оглавление) */
function withHeadingIds(html) {
  const used = new Set();
  const toc = [];
  const out = html.replace(/<h2>(.*?)<\/h2>/g, (_, inner) => {
    const text = stripTags(inner);
    let id = text.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "razdel";
    while (used.has(id)) id += "-2";
    used.add(id);
    toc.push([id, text.replace(/^\d+\.\s*/, "")]);
    return `<h2 id="${id}">${inner}</h2>`;
  });
  return { html: out, toc };
}

/** Призыв в середине статьи — перед третьим разделом */
function insertMidCta(html, cta) {
  let n = 0;
  return html.replace(/<h2 id=/g, (m) => (++n === 3 ? `${cta}\n${m}` : m));
}

/** Контекстные ссылки из статьи на посадочные страницы по её темам */
function topicLinks(a) {
  const t = `${a.tags.join(" ")} ${a.h1}`.toLowerCase();
  const links = [];
  if (/анамнез|коммуникац|общени|пропедевт/.test(t)) links.push(["Тренажёр к аккредитации: станция сбора анамнеза", "/akkreditaciya/"], ["Тренажёр для студентов-медиков", "/dlya-studentov/"]);
  if (/аккредит|оскэ|экзамен/.test(t)) links.push(["Тренажёр к аккредитации: сбор анамнеза и клиническое мышление", "/akkreditaciya/"], ["Клинические задачи онлайн с ответами", "/klinicheskie-zadachi/"]);
  if (/диагноз|мышлени/.test(t)) links.push(["Клинические задачи онлайн с ответами", "/klinicheskie-zadachi/"], ["Клинические случаи по кардиологии", "/specialnosti/kardiologiya/"], ["Сложные клинические случаи для врачей", "/dlya-vrachej/"]);
  if (/анализ|лаборатор/.test(t)) links.push(["Клинические случаи по терапии", "/specialnosti/terapiya/"], ["Клинические задачи онлайн с ответами", "/klinicheskie-zadachi/"]);
  links.push(["Виртуальный пациент: что это и как на нём учиться", "/virtualnyj-pacient/"]);
  const uniq = [...new Map(links.map((l) => [l[1], l])).values()].slice(0, 4);
  return `<nav class="topic-links" aria-label="По теме"><b>По теме</b><ul>${uniq.map(([n, u]) => `<li><a href="${u}">${esc(n)}</a></li>`).join("")}</ul></nav>`;
}

function blogIndex() {
  const title = "Блог для студентов-медиков и ординаторов";
  const description = "Статьи для студентов-медиков и ординаторов: сбор анамнеза, дифференциальный диагноз, общий анализ крови, подготовка к аккредитации, общение с пациентом.";
  const c = crumbs([["Главная", "/"], ["Блог", "/blog/"]]);
  const schema = [
    { "@context": "https://schema.org", "@type": "Blog", name: `Блог ${NAME}`, url: `${SITE}/blog/`, inLanguage: "ru",
      blogPost: ARTICLES.map((a) => ({ "@type": "BlogPosting", headline: a.h1, url: `${SITE}/blog/${a.slug}/`, datePublished: a.date })) },
    c.schema,
  ];
  const main = `
<section class="page-hero solo" data-hero><div class="wrap">
  ${c.html}
  <h1>Блог для студентов-медиков</h1>
  <p class="lead">Навыки, которые нужны на практике и на аккредитации: расспрос, клиническое мышление, анализы и общение с пациентом.</p>
</div></section>
<section style="padding-top:48px"><div class="wrap">
  <div class="posts">${ARTICLES.map(postCard).join("")}</div>
  <div style="margin-top:56px">${magnetBlock("magnet_blog")}</div>
</div></section>`;
  return layout({ page: "blog", headOpts: { title, description, canonical: `${SITE}/blog/`, extra: schema.map(ldjson).join("\n") }, main });
}

function articlePage(a) {
  const url = `${SITE}/blog/${a.slug}/`;
  // «Читайте также»: сначала статьи с общими темами, затем свежие
  const shared = (x) => x.tags.filter((t) => a.tags.includes(t)).length;
  const others = ARTICLES.filter((x) => x.slug !== a.slug).map((x, i) => ({ x, k: shared(x) * 100 - i })).sort((p, q) => q.k - p.k).slice(0, 3).map((o) => o.x);
  const c = crumbs([["Главная", "/"], ["Блог", "/blog/"], [a.h1, `/blog/${a.slug}/`]]);
  const schema = [
    { "@context": "https://schema.org", "@type": "BlogPosting", headline: a.h1, description: a.description, url, mainEntityOfPage: url,
      datePublished: a.date, dateModified: a.updated || a.date, inLanguage: "ru", keywords: a.tags.join(", "), image: a.cover ? `${SITE}/blog/${a.slug}/og.jpg` : `${SITE}/og.png`,
      author: { "@type": "Organization", name: NAME, url: SITE }, publisher: { "@type": "Organization", name: NAME, logo: { "@type": "ImageObject", url: `${SITE}/apple-touch-icon.png` } } },
    c.schema,
    ...(a.faq?.length ? [faqSchema(a.faq)] : []),
  ];
  const [ctaTitle, ctaText] = articleCta(a);
  const from = `b_${a.slug}`.slice(0, 34);
  const { html: bodyHtml, toc } = withHeadingIds(withFigures(a.body.trim()));
  let body = insertMidCta(bodyHtml, inlineCta(ctaTitle, ctaText, `${from}_mid`));
  // Оглавление — после вводного абзаца
  const tocHtml = toc.length >= 4 ? `<nav class="toc" aria-label="Содержание"><b>Содержание</b><ol>${toc.map(([id, t]) => `<li><a href="#${id}">${esc(t)}</a></li>`).join("")}</ol></nav>` : "";
  const leadEnd = body.startsWith('<p class="lead">') ? body.indexOf("</p>") + 4 : 0;
  body = body.slice(0, leadEnd) + tocHtml + body.slice(leadEnd);
  const main = `
<article class="article">
  <div class="page-head" style="padding-bottom:0">${c.html}</div>
  <h1>${esc(a.h1)}</h1>
  <div class="meta"><time datetime="${a.date}">${fmtDate(a.date)}</time>${a.updated && a.updated !== a.date ? `<span>обновлено ${fmtDate(a.updated)}</span>` : ""}<span>${a.minutes} мин чтения</span></div>
  ${a.cover ? `<img class="article-cover" src="/blog/${a.slug}/cover.jpg" alt="${esc(`${a.cover.says[0]} — ${a.cover.says[1]}`)}" width="1200" height="630" fetchpriority="high">` : ""}
  ${a.summary?.length ? `<aside class="tldr" aria-label="Коротко"><b>Коротко</b><ul>${a.summary.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></aside>` : ""}
  ${body}
  ${a.faq?.length ? `<h2 id="faq">Частые вопросы</h2><div class="faq article-faq">${a.faq.map(([q, ans]) => `<details><summary>${esc(q)}</summary><p>${esc(ans)}</p></details>`).join("")}</div>` : ""}
  ${a.sources?.length ? `<h2 id="istochniki">Источники</h2><ol class="sources">${a.sources.map(([t, u]) => `<li>${u ? `<a href="${esc(u)}" rel="noopener nofollow" target="_blank">${esc(t)}</a>` : esc(t)}</li>`).join("")}</ol>` : ""}
  ${topicLinks(a)}
  <ul class="tags" aria-label="Темы">${a.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
  <aside class="cta-box">
    <p class="cta-h">Потренируйтесь на виртуальном пациенте</p>
    <ul><li>расспрос текстом или голосом — пациент отвечает только на заданное</li><li>анализы, УЗИ, ЭКГ, эндоскопия — результаты под скрытый диагноз</li><li>ИИ-разбор и тест по вашим ошибкам</li></ul>
    <p>Первый пациент каждый день — бесплатно. Вход через Яндекс, Google или Telegram.</p>
    <div class="cta" style="margin:0"><a class="btn btn-primary btn-lg" href="${app(`${from}_end`)}">Принять пациента ${ARR}</a><a class="btn btn-ghost btn-lg" href="/demo/">Демо за минуту</a></div>
  </aside>
</article>
<div class="related"><h2 style="font-size:26px">Читайте также</h2><div class="posts">${others.map(postCard).join("")}</div></div>`;
  return layout({
    page: from, progress: true,
    headOpts: { title: a.title, description: a.description, canonical: url, type: "article", image: a.cover ? `${SITE}/blog/${a.slug}/og.jpg` : undefined,
      extra: `<meta property="article:published_time" content="${a.date}">\n${schema.map(ldjson).join("\n")}` },
    main,
  });
}

/** Оферта и политика: простая текстовая страница */
function legalPage(doc) {
  const url = `${SITE}/${doc.slug}/`;
  const c = crumbs([["Главная", "/"], [doc.title, `/${doc.slug}/`]]);
  const main = `
<article class="article legal">
  <div class="page-head" style="padding-bottom:0">${c.html}</div>
  <h1>${esc(doc.title)}</h1>
  <div class="meta"><span>Редакция от ${fmtDate(LEGAL_UPDATED)}</span></div>
  ${doc.body.trim()}
</article>`;
  return layout({ page: doc.slug, sticky: false, popup: false, headOpts: { title: doc.title, description: doc.description, canonical: url }, main });
}

function aboutPage() {
  const url = `${SITE}/o-proekte/`;
  const c = crumbs([["Главная", "/"], ["О проекте", "/o-proekte/"]]);
  const schema = [c.schema, ORG_SCHEMA, { "@context": "https://schema.org", "@type": "AboutPage", name: "О проекте Help me, Doctor", url, inLanguage: "ru" }];
  const main = `
<section class="page-hero solo" data-hero><div class="wrap">
  ${c.html}
  <h1>О проекте</h1>
  <p class="lead">«Help me, Doctor» — учебный тренажёр клинического мышления для студентов-медиков, ординаторов и врачей. Здесь можно спокойно провести десятки приёмов от жалобы до диагноза и после каждого увидеть, что получилось, а что стоит подтянуть.</p>
</div></section>
<section style="padding-top:48px"><div class="wrap"><div class="prose">
  <h2>Как устроены пациенты</h2>
  <p>Каждый случай создаёт языковая модель под профиль пользователя: специальность, разделы и сложность. У пациента есть скрытая история болезни, диагноз, характер и находки, которые проявятся при осмотре и обследованиях. Пациент отвечает только на заданный вопрос и не знает медицинских терминов. Результаты анализов и исследований генерируются под скрытый диагноз и показывают только то, что может показать конкретный метод.</p>
  <h2>Кто пишет разбор</h2>
  <p>Разбор приёма тоже генерирует ИИ: он сравнивает диалог и назначения со скрытой историей случая и оценивает три блока — диагностику, коммуникацию и лечение, — приводит цитаты из диалога, называет пропущенные вопросы и описывает, что стало с пациентом при выбранной тактике. По пробелам формируется короткий тест.</p>
  <p class="note">ИИ может ошибаться. Тренажёр развивает навык расспроса и клинического рассуждения; медицинские факты, дозы и тактику сверяйте с действующими клиническими рекомендациями Минздрава РФ и учебниками. Пациенты вымышлены, сервис не консультирует реальных людей и не начисляет баллы НМО.</p>
  <h2>Материалы сайта</h2>
  <p>Статьи блога и учебные случаи на страницах специальностей опираются на клинические рекомендации Минздрава РФ и международные руководства; источники указаны в статьях. Если вы нашли неточность — напишите нам, исправим. Если вы врач-преподаватель и готовы рецензировать материалы — тоже напишите: мы ищем рецензентов.</p>
  <h2>Контакты</h2>
  <ul>
    <li>Почта: <a href="mailto:${SELLER.email}">${SELLER.email}</a></li>
    <li>Telegram-бот: <a href="${BOT}" rel="noopener">@${BOT.split("/").pop()}</a> — можно написать в поддержку прямо в чате</li>
    <li>${esc(SELLER.name)} · ИНН ${SELLER.inn} · ОГРНИП ${SELLER.ogrnip}</li>
  </ul>
  <p><a href="/oferta/">Публичная оферта</a> · <a href="/privacy/">Политика обработки персональных данных</a></p>
</div></div></section>`;
  return layout({ page: "about", headOpts: { title: "О проекте: как устроен тренажёр и кто его делает", description: "Как устроены ИИ-пациенты и разбор приёма в «Help me, Doctor», ограничения ИИ, источники материалов, контакты и реквизиты.", canonical: url, extra: schema.map(ldjson).join("\n") }, main });
}

function notFound() {
  const main = `<div class="notfound"><p class="mono muted">Ошибка 404</p><h1>Страница не найдена</h1><p class="muted">Возможно, ссылка устарела. Начните с главной, пройдите демо или загляните в блог.</p>
<div class="cta" style="justify-content:center"><a class="btn btn-primary" href="/">На главную</a><a class="btn btn-ghost" href="/demo/">Демо</a><a class="btn btn-ghost" href="/blog/">Блог</a></div></div>`;
  return layout({ page: "404", sticky: false, popup: false, headOpts: { title: "Страница не найдена", description: "Такой страницы нет.", canonical: `${SITE}/`, noindex: true }, main });
}

// ---------------------------------------------------------------- sitemap и llms.txt
const PAGES = [
  { loc: "/demo/", pr: "0.8" },
  ...AUDIENCES.map((a) => ({ loc: `/${a.slug}/`, pr: "0.8" })),
  ...INTENTS.map((i) => ({ loc: `/${i.slug}/`, pr: "0.8" })),
  { loc: "/specialnosti/", pr: "0.7" },
  ...SPEC_LIST.map((s) => ({ loc: `/specialnosti/${s.slug}/`, pr: "0.7" })),
  { loc: "/materialy/", pr: "0.6" },
  { loc: "/o-proekte/", pr: "0.5" },
];

function sitemap() {
  const urls = [
    { loc: `${SITE}/`, lastmod: SITE_UPDATED, pr: "1.0" },
    ...PAGES.map((p) => ({ loc: `${SITE}${p.loc}`, lastmod: SITE_UPDATED, pr: p.pr })),
    { loc: `${SITE}/blog/`, lastmod: ARTICLES.map((a) => a.updated || a.date).sort().pop(), pr: "0.8" },
    ...ARTICLES.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: a.updated || a.date, pr: "0.7" })),
    ...[OFFER, PRIVACY].map((d) => ({ loc: `${SITE}/${d.slug}/`, lastmod: LEGAL_UPDATED, pr: "0.2" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.pr}</priority></url>`).join("\n")}
</urlset>
`;
}

/** llms.txt — краткая карта сайта для ИИ-поисковиков и ассистентов (GEO) */
function llmsTxt() {
  return `# ${NAME}

> Тренажёр клинического мышления для студентов-медиков, ординаторов и врачей: ИИ-пациенты с жалобами и характером, расспрос текстом и голосом, осмотр, анализы, диагноз и лечение, затем разбор приёма (его генерирует ИИ, сверяясь со скрытой историей случая) с оценкой и тестом по ошибкам. Работает в браузере и в Telegram, вход через Яндекс ID, Google или Telegram. Первый пациент каждый день бесплатно; премиум — 7 дней за ${rub(TRIAL.price)} ₽, затем от ${rub(MONTH.early)} ₽ в месяц.

## Продукт
- [Главная](${SITE}/): как работает тренажёр, цены, вопросы и ответы
- [Демо-приём](${SITE}/demo/): интерактивный пример приёма без регистрации
- [Веб-приложение](${SITE}/app): тренажёр в браузере
- [Материалы](${SITE}/materialy/): бесплатный чек-лист сбора анамнеза (PDF) и первоисточники
- [О проекте](${SITE}/o-proekte/): как устроены ИИ-пациенты и ИИ-разбор, ограничения, контакты
- [Публичная оферта](${SITE}/oferta/)
- [Политика обработки данных](${SITE}/privacy/)

## Для кого
${[...AUDIENCES, ...INTENTS].map((a) => `- [${a.h1}](${SITE}/${a.slug}/): ${a.description}`).join("\n")}

## Специальности
${SPEC_LIST.map((s) => `- [Клинические случаи по ${s.gen}](${SITE}/specialnosti/${s.slug}/): ${s.description}`).join("\n")}

## Блог
${ARTICLES.map((a) => `- [${a.h1}](${SITE}/blog/${a.slug}/): ${a.description}`).join("\n")}
`;
}

// ---------------------------------------------------------------- запись
const write = (rel, content) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  if (!process.env.SITE_OUT) console.log("✓", rel);
};
write("index.html", landing());
write("demo/index.html", demoPage());
for (const a of AUDIENCES) write(`${a.slug}/index.html`, audiencePage(a));
for (const i of INTENTS) write(`${i.slug}/index.html`, intentPage(i));
write("specialnosti/index.html", specialtiesIndex());
for (const s of SPEC_LIST) write(`specialnosti/${s.slug}/index.html`, specialtyPage(s));
write("materialy/index.html", materialsPage());
write("o-proekte/index.html", aboutPage());
write("blog/index.html", blogIndex());
for (const a of ARTICLES) write(`blog/${a.slug}/index.html`, articlePage(a));
for (const d of [OFFER, PRIVACY]) write(`${d.slug}/index.html`, legalPage(d));
write("404.html", notFound());
write("sitemap.xml", sitemap());
write("llms.txt", llmsTxt());
