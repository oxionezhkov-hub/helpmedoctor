// Сборка статичных страниц сайта: главная, блог, 404, sitemap.xml.
// Запуск: node scripts/build-site.mjs   (результат — в public/, коммитится вместе с исходниками)
// Цены, специальности и лимиты берутся из src/config.js — на сайте всегда актуальные цифры.
import fs from "node:fs";
import path from "node:path";
import { FREE_DAILY_LIMIT, PLANS, SPECIALIZATIONS } from "../src/config.js";
import { ARTICLES } from "./site/articles.mjs";

const SITE = "https://helpmedoctor.ru";
const BOT = "https://t.me/helpmedoctor_aibot";
const NAME = "Help me, Doctor";
const OUT = path.resolve(process.env.SITE_OUT || "public");
const SITE_UPDATED = "2026-09-25"; // дата изменения главной — для sitemap

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rub = (p) => Number(p).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const ldjson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

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

const HEART = `<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 0 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1Z"/><path d="M2.5 12h5l2-3.5 3 7 2-3.5h7"/></svg>`;
const TG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.9 4.6 18.7 19.4c-.2 1-.9 1.3-1.7.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.9 8.9-8c.4-.3-.1-.5-.6-.2L6.5 13.2 1.8 11.7c-1-.3-1-1 .2-1.5L20.5 3.1c.9-.3 1.6.2 1.4 1.5Z"/></svg>`;
const ICONS = {
  patient: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  mic: `<svg viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>`,
  lab: `<svg viewBox="0 0 24 24"><path d="M9 2v6L4 18a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-10V2M8 2h8M7 14h10"/></svg>`,
  star: `<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z"/></svg>`,
  quiz: `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 12 2 2 4-4M9 3h6"/></svg>`,
  sync: `<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M18 2v4h-4M6 22v-4h4"/></svg>`,
};

function head({ title, description, canonical, type = "website", extra = "" }) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#0f766e">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="${NAME}">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/site.css">
${extra}
${METRIKA_HEAD}
</head>`;
}

const header = () => `<a class="skip" href="#main">Перейти к содержанию</a>
<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="brand-logo">${HEART}</span>${NAME}</a>
  <nav class="nav" aria-label="Основное меню">
    <a href="/#how">Как это работает</a><a href="/#features">Возможности</a><a href="/#pricing">Тарифы</a><a href="/blog/">Блог</a>
  </nav>
  <a class="btn btn-primary" href="${BOT}" rel="noopener">Начать</a>
</div></header>`;

const footer = () => `<footer><div class="wrap">
  <div>
    <a class="brand" href="/"><span class="brand-logo">${HEART}</span>${NAME}</a>
    <p style="margin-top:12px">Учебный тренажёр для студентов-медиков, ординаторов и врачей. Пациенты вымышлены, сервис не оказывает медицинских услуг и не заменяет консультацию врача.</p>
    <p>ИП Ежков Олег Михайлович · ИНН 780454134703 · ОГРНИП 325784700383480</p>
  </div>
  <div><b>Тренажёр</b><ul>
    <li><a href="${BOT}" rel="noopener">Telegram-бот</a></li>
    <li><a href="/app">Веб-версия</a></li>
    <li><a href="/#pricing">Тарифы</a></li>
    <li><a href="/#faq">Вопросы и ответы</a></li>
  </ul></div>
  <div><b>Блог</b><ul>
    ${ARTICLES.slice(0, 4).map((a) => `<li><a href="/blog/${a.slug}/">${esc(a.h1.split(":")[0])}</a></li>`).join("")}
    <li><a href="/blog/">Все статьи</a></li>
  </ul></div>
</div></footer>`;

const postCard = (a) => `<a class="post-card" href="/blog/${a.slug}/"><h3>${esc(a.h1)}</h3><p>${esc(a.description)}</p><span class="meta">${a.minutes} мин чтения →</span></a>`;

// ---------------------------------------------------------------- главная
const FAQ = [
  ["Это медицинская консультация?", "Нет. «Help me, Doctor» — учебный тренажёр: все пациенты вымышлены и созданы искусственным интеллектом. Сервис не ставит диагнозы реальным людям и не заменяет обращение к врачу."],
  ["Кому подходит тренажёр?", "Студентам медицинских вузов, ординаторам и практикующим врачам. При первом входе вы выбираете роль, специальность, интересующие разделы и сложность — пациенты подбираются под вас."],
  ["Нужно ли что-то устанавливать?", "Нет. Тренажёр работает в Telegram-боте и в браузере на телефоне или компьютере. Прогресс общий: начали приём в боте — продолжайте на сайте."],
  ["Сколько это стоит?", `${FREE_DAILY_LIMIT === 1 ? "Один пациент" : `${FREE_DAILY_LIMIT} пациента`} в день — бесплатно. Безлимитный доступ — от ${rub(PLANS.day.price)} ₽ за день, ${rub(PLANS.month.price)} ₽ за месяц или ${rub(PLANS.forever.price)} ₽ навсегда. Оплата картой или через СБП.`],
  ["Можно ли общаться с пациентом голосом?", "Да. В Telegram и в веб-версии можно отправлять голосовые сообщения — они распознаются и превращаются в вопрос пациенту."],
  ["Можно ли доверять ответам ИИ?", "Случаи и разборы генерирует искусственный интеллект, он может ошибаться. Используйте тренажёр для отработки клинического мышления и коммуникации, а медицинские факты сверяйте с клиническими рекомендациями и учебниками."],
];

function landing() {
  const title = "Тренажёр врача с ИИ-пациентами — Help me, Doctor";
  const description = "Тренируйте клиническое мышление на виртуальных пациентах: расспрос текстом и голосом, осмотр, анализы, диагноз и разбор от эксперта. Для студентов-медиков, ординаторов и врачей. Бесплатно в Telegram и браузере.";
  const plans = [
    `<div class="plan"><span class="name">Бесплатно</span><div class="price">0 ₽</div><p>${FREE_DAILY_LIMIT} ${FREE_DAILY_LIMIT === 1 ? "пациент" : "пациента"} в день, все функции тренажёра</p></div>`,
    ...Object.entries(PLANS).map(([k, p]) => `<div class="plan${k === "month" ? " best" : ""}"><span class="name">${esc(p.label)}</span><div class="price">${rub(p.price)} <small>₽</small></div><p>${k === "forever" ? "Безлимит без срока, одним платежом" : "Безлимитные пациенты"}</p></div>`),
  ].join("");
  const offers = Object.entries(PLANS).map(([, p]) => ({ "@type": "Offer", name: `Безлимит — ${p.label}`, price: Number(p.price).toFixed(2), priceCurrency: "RUB" }));
  const schema = [
    { "@context": "https://schema.org", "@type": "Organization", name: NAME, url: SITE, logo: `${SITE}/apple-touch-icon.png`, sameAs: [BOT] },
    { "@context": "https://schema.org", "@type": "WebSite", name: NAME, url: SITE, inLanguage: "ru" },
    {
      "@context": "https://schema.org", "@type": "WebApplication", name: NAME, url: `${SITE}/app`,
      applicationCategory: "EducationalApplication", operatingSystem: "Web, Telegram", inLanguage: "ru", description,
      audience: { "@type": "EducationalAudience", educationalRole: "student" },
      offers: [{ "@type": "Offer", name: "Бесплатный доступ", price: "0", priceCurrency: "RUB" }, ...offers],
    },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return `${head({ title, description, canonical: `${SITE}/`, extra: schema.map(ldjson).join("\n") })}
<body>
${METRIKA_NOSCRIPT}
${header()}
<main id="main">
<section class="hero"><div class="wrap">
  <div>
    <span class="eyebrow">Для студентов-медиков, ординаторов и врачей</span>
    <h1>Тренажёр врача с ИИ-пациентами</h1>
    <p class="lead">Принимайте виртуальных пациентов в Telegram или в браузере: расспрос текстом и голосом, осмотр, анализы, диагноз и лечение — а затем подробный разбор приёма от эксперта.</p>
    <div class="cta">
      <a class="btn btn-primary" href="${BOT}" rel="noopener">${TG}Начать в Telegram</a>
      <a class="btn btn-ghost" href="/app">Открыть в браузере</a>
    </div>
    <p class="hero-note"><span>Первый пациент каждый день — бесплатно</span><span>Без установки</span><span>10 специальностей</span></p>
  </div>
  <div class="phone" role="img" aria-label="Пример приёма в тренажёре: пациент с болью в животе, результат ФГДС и оценка эксперта">
    <div class="screen">
      <div class="chat-head"><span class="avatar">МЛ</span><div><b>Мирон Лесков, 47 лет</b><small>Гастроэнтерология · средняя сложность</small></div></div>
      <div class="chat">
        <div class="msg pat">Доктор, жжёт под ложечкой уже третью неделю, сил нет.</div>
        <div class="msg doc">Боль больше натощак или после еды? Какие лекарства принимаете?</div>
        <div class="msg pat">Натощак хуже, после еды отпускает. От спины пью обезболивающие…</div>
        <div class="card-mini"><div class="t">Результат · ФГДС</div>Язвенный дефект 8 мм в луковице двенадцатиперстной кишки</div>
        <div class="score"><span>Разбор эксперта<br><small>Диагноз верный</small></span><b>★ 4,5</b></div>
      </div>
    </div>
  </div>
</div></section>

<section id="how" class="alt"><div class="wrap">
  <div class="section-head"><h2>Как проходит приём</h2><p>Всё как на настоящем приёме — только без риска для пациента и с обратной связью сразу после.</p></div>
  <div class="steps">
    <div class="step"><h3>Пациент приходит с жалобой</h3><p>ИИ создаёт уникальный случай по вашей специальности, выбранным разделам и уровню сложности.</p></div>
    <div class="step"><h3>Расспрос и осмотр</h3><p>Задавайте вопросы текстом или голосом. Пациент отвечает только на заданный вопрос и не выкладывает всё сразу.</p></div>
    <div class="step"><h3>Обследования</h3><p>Назначайте анализы, УЗИ, КТ, ЭКГ, эндоскопию — результаты соответствуют методу и скрытому диагнозу.</p></div>
    <div class="step"><h3>Диагноз и разбор</h3><p>Поставьте диагноз и лечение или направьте к специалисту — эксперт разберёт приём и расскажет, что стало с пациентом.</p></div>
  </div>
</div></section>

<section id="features"><div class="wrap">
  <div class="section-head"><h2>Что внутри тренажёра</h2><p>Инструменты, которые помогают не просто решать кейсы, а системно прокачивать клиническое мышление.</p></div>
  <div class="features">
    <div class="feature"><div class="ico">${ICONS.patient}</div><h3>Живые пациенты</h3><p>У каждого — свой характер и манера речи: кто-то тревожится, кто-то ворчит или не договаривает.</p></div>
    <div class="feature"><div class="ico">${ICONS.mic}</div><h3>Голосовой расспрос</h3><p>Говорите с пациентом голосом, как на реальном приёме, — речь распознаётся автоматически.</p></div>
    <div class="feature"><div class="ico">${ICONS.lab}</div><h3>Реалистичные обследования</h3><p>Анализы, визуализация, ЭКГ и эндоскопия показывают только то, что даёт конкретный метод.</p></div>
    <div class="feature"><div class="ico">${ICONS.star}</div><h3>Разбор эксперта</h3><p>Оценка по диагностике, коммуникации и лечению с цитатами из вашего диалога и советом на будущее.</p></div>
    <div class="feature"><div class="ico">${ICONS.quiz}</div><h3>Работа над ошибками</h3><p>После приёма — тест по пробелам, которые показал именно этот случай.</p></div>
    <div class="feature"><div class="ico">${ICONS.sync}</div><h3>Бот и сайт вместе</h3><p>Начните в Telegram, продолжите в браузере. Уровни, стрики и задания дня держат в ритме.</p></div>
  </div>
</div></section>

<section class="alt"><div class="wrap">
  <div class="section-head"><h2>Для кого</h2></div>
  <div class="audience">
    <div class="aud"><div class="emoji" aria-hidden="true">🎓</div><h3>Студентам</h3><ul><li>отработка схемы расспроса и осмотра</li><li>подготовка к экзаменам и аккредитации</li><li>клинические случаи до выхода в клинику</li></ul></div>
    <div class="aud"><div class="emoji" aria-hidden="true">🩺</div><h3>Ординаторам</h3><ul><li>кейсы по своей специальности</li><li>дифференциальная диагностика</li><li>тактика: лечение или направление</li></ul></div>
    <div class="aud"><div class="emoji" aria-hidden="true">👩‍⚕️</div><h3>Врачам</h3><ul><li>сложные и редкие случаи</li><li>смежные специальности</li><li>короткая тренировка в любое время</li></ul></div>
  </div>
</div></section>

<section><div class="wrap">
  <div class="section-head"><h2>Специальности</h2><p>Выберите свою или напишите любую другую — разделы для неё подберёт ИИ.</p></div>
  <div class="chips">${Object.keys(SPECIALIZATIONS).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}<span class="chip">и любая своя</span></div>
</div></section>

<section id="pricing" class="alt"><div class="wrap">
  <div class="section-head"><h2>Тарифы</h2><p>Начните бесплатно. Если хочется больше практики — безлимит на удобный срок.</p></div>
  <div class="plans">${plans}</div>
  <p class="pay-note">Оплата картой или через СБП. Подписка не продлевается автоматически.</p>
</div></section>

<section id="blog"><div class="wrap">
  <div class="section-head"><h2>Статьи для студентов</h2><p>Коротко и по делу о навыках, которые пригодятся на практике и на аккредитации.</p></div>
  <div class="posts">${ARTICLES.slice(0, 3).map(postCard).join("")}</div>
  <p style="margin-top:20px"><a href="/blog/"><b>Все статьи →</b></a></p>
</div></section>

<section id="faq" class="alt"><div class="wrap">
  <div class="section-head"><h2>Вопросы и ответы</h2></div>
  <div class="faq">${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
</div></section>

<section class="final"><div class="wrap"><div class="box">
  <h2>Примите первого пациента сегодня</h2>
  <p>Ответьте на четыре вопроса о себе — и тренажёр сразу подберёт пациента под вашу специальность и уровень.</p>
  <div class="cta"><a class="btn btn-primary" href="${BOT}" rel="noopener">${TG}Открыть в Telegram</a><a class="btn btn-ghost" href="/app">Веб-версия</a></div>
</div></div></section>
</main>
${footer()}
</body>
</html>
`;
}

// ---------------------------------------------------------------- блог
function blogIndex() {
  const title = "Блог для студентов-медиков — Help me, Doctor";
  const description = "Статьи для студентов-медиков и ординаторов: сбор анамнеза, дифференциальный диагноз, общий анализ крови, подготовка к аккредитации, общение с пациентом.";
  const schema = [
    { "@context": "https://schema.org", "@type": "Blog", name: "Блог Help me, Doctor", url: `${SITE}/blog/`, inLanguage: "ru",
      blogPost: ARTICLES.map((a) => ({ "@type": "BlogPosting", headline: a.h1, url: `${SITE}/blog/${a.slug}/`, datePublished: a.date })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Блог", item: `${SITE}/blog/` }] },
  ];
  return `${head({ title, description, canonical: `${SITE}/blog/`, extra: schema.map(ldjson).join("\n") })}
<body>
${METRIKA_NOSCRIPT}
${header()}
<main id="main">
<div class="page-head"><div class="wrap">
  <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / Блог</nav>
  <h1>Блог для студентов-медиков</h1>
  <p class="muted" style="font-size:19px;max-width:40em">Навыки, которые нужны на практике и на аккредитации: расспрос, клиническое мышление, анализы и общение с пациентом.</p>
</div></div>
<section style="padding-top:12px"><div class="wrap"><div class="posts">${ARTICLES.map(postCard).join("")}</div></div></section>
</main>
${footer()}
</body>
</html>
`;
}

function articlePage(a) {
  const url = `${SITE}/blog/${a.slug}/`;
  const others = ARTICLES.filter((x) => x.slug !== a.slug).slice(0, 2);
  const schema = [
    { "@context": "https://schema.org", "@type": "BlogPosting", headline: a.h1, description: a.description, url, mainEntityOfPage: url,
      datePublished: a.date, dateModified: a.updated || a.date, inLanguage: "ru", keywords: a.tags.join(", "), image: `${SITE}/og.png`,
      author: { "@type": "Organization", name: NAME, url: SITE }, publisher: { "@type": "Organization", name: NAME, logo: { "@type": "ImageObject", url: `${SITE}/apple-touch-icon.png` } } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Блог", item: `${SITE}/blog/` },
      { "@type": "ListItem", position: 3, name: a.h1, item: url }] },
  ];
  return `${head({ title: `${a.title} — ${NAME}`, description: a.description, canonical: url, type: "article",
    extra: `<meta property="article:published_time" content="${a.date}">\n${schema.map(ldjson).join("\n")}` })}
<body>
${METRIKA_NOSCRIPT}
${header()}
<main id="main">
<article class="article">
  <nav class="crumbs page-head" style="padding-bottom:0" aria-label="Навигация"><a href="/">Главная</a> / <a href="/blog/">Блог</a></nav>
  <h1>${esc(a.h1)}</h1>
  <div class="meta"><time datetime="${a.date}">${fmtDate(a.date)}</time><span>${a.minutes} мин чтения</span></div>
  ${a.body.trim()}
  <ul class="tags" aria-label="Темы">${a.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
  <aside class="cta-box">
    <h2>Потренируйтесь на виртуальном пациенте</h2>
    <p>Расспрос, осмотр, анализы и диагноз — а затем разбор эксперта с оценкой и тестом по вашим ошибкам. Первый пациент каждый день бесплатно.</p>
    <div class="cta" style="margin:0"><a class="btn btn-primary" href="${BOT}" rel="noopener">${TG}Начать в Telegram</a><a class="btn btn-ghost" href="/app">В браузере</a></div>
  </aside>
</article>
<div class="related"><h2 style="font-size:24px">Читайте также</h2><div class="posts">${others.map(postCard).join("")}</div></div>
</main>
${footer()}
</body>
</html>
`;
}

function notFound() {
  return `${head({ title: `Страница не найдена — ${NAME}`, description: "Такой страницы нет.", canonical: `${SITE}/` }).replace('content="index, follow, max-image-preview:large"', 'content="noindex"')}
<body>
${METRIKA_NOSCRIPT}
${header()}
<main id="main" class="notfound"><h1>Страница не найдена</h1><p class="muted">Возможно, ссылка устарела. Начните с главной или загляните в блог.</p>
<div class="cta" style="justify-content:center"><a class="btn btn-primary" href="/">На главную</a><a class="btn btn-ghost" href="/blog/">Блог</a></div></main>
${footer()}
</body>
</html>
`;
}

function sitemap() {
  const urls = [
    { loc: `${SITE}/`, lastmod: SITE_UPDATED, pr: "1.0" },
    { loc: `${SITE}/blog/`, lastmod: ARTICLES.map((a) => a.updated || a.date).sort().pop(), pr: "0.8" },
    ...ARTICLES.map((a) => ({ loc: `${SITE}/blog/${a.slug}/`, lastmod: a.updated || a.date, pr: "0.7" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.pr}</priority></url>`).join("\n")}
</urlset>
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
write("blog/index.html", blogIndex());
for (const a of ARTICLES) write(`blog/${a.slug}/index.html`, articlePage(a));
write("404.html", notFound());
write("sitemap.xml", sitemap());
