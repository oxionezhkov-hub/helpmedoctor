// helpmedoctor.ru — демо-приём и элементы сайта: меню, полоса с ценами, липкая кнопка, окно при уходе, живые цифры.
// Без зависимостей. Все переходы ведут в веб-версию /app с меткой from=<место> для аналитики.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const goal = (name, params) => { try { window.ym && window.ym(113057442, "reachGoal", name, params); } catch {} };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c; };
  const page = document.body.dataset.page || "page";

  // Клики по кнопкам «в приложение» — цель в Метрике
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href^='/app']");
    if (a) goal("cta_app", { from: new URL(a.href, location.href).searchParams.get("from") || page });
  });

  // ---------- Меню на телефоне ----------
  const burger = $(".burger");
  if (burger) burger.addEventListener("click", () => {
    const nav = $(".nav");
    const open = nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
  });
  // Выпадающие меню закрываются кликом мимо
  document.addEventListener("click", (e) => { $$(".nav details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });

  // ---------- Полоса с ранними ценами и обратный отсчёт ----------
  const promo = $(".promo");
  const until = Number(document.body.dataset.earlyUntil || 0);
  const left = until - Date.now();
  if (promo) {
    if (left <= 0 || ls.get("hmd_promo_x") === String(until)) promo.hidden = true;
    else promo.hidden = false;
    $(".promo-x", promo)?.addEventListener("click", () => { promo.hidden = true; ls.set("hmd_promo_x", String(until)); });
  }
  $$("[data-countdown]").forEach((el) => {
    if (left <= 0) return;
    const d = Math.floor(left / 86400000);
    const h = Math.floor((left % 86400000) / 3600000);
    el.textContent = d > 0 ? `До конца ранних цен: ${d} ${plural(d, "день", "дня", "дней")} ${h} ч` : `Ранние цены заканчиваются через ${h} ${plural(h, "час", "часа", "часов")}`;
    el.hidden = false;
  });
  if (left <= 0) $$("[data-early]").forEach((el) => el.remove());

  // ---------- Живые цифры (только агрегаты) ----------
  const live = $$("[data-live]");
  if (live.length) {
    fetch("/api/public-stats").then((r) => (r.ok ? r.json() : null)).then((s) => {
      if (!s) return;
      let text = "";
      if (s.consultations_week >= 30) text = `${s.consultations_week.toLocaleString("ru-RU")} ${plural(s.consultations_week, "приём", "приёма", "приёмов")} за последние 7 дней`;
      else if (s.consultations_total >= 100) text = `${s.consultations_total.toLocaleString("ru-RU")} ${plural(s.consultations_total, "приём проведён", "приёма проведено", "приёмов проведено")} в тренажёре`;
      if (s.users >= 100) text = `${s.users.toLocaleString("ru-RU")} ${plural(s.users, "врач и студент", "врача и студента", "врачей и студентов")} уже тренируются${text ? ` · ${text}` : ""}`;
      if (s.rating) text += ` · средняя оценка ${String(s.rating).replace(".", ",")} из 5`;
      if (!text) return;
      live.forEach((el) => { el.querySelector("span").textContent = text; el.hidden = false; });
    }).catch(() => {});
  }

  // ---------- Липкая кнопка внизу: после первого экрана, скрыта у финального призыва ----------
  const sticky = $(".sticky-cta");
  if (sticky) {
    const hero = $("[data-hero]") || $("main > :first-child");
    const final = $(".final") || $("footer");
    let heroOut = false, finalIn = false;
    const upd = () => sticky.classList.toggle("show", heroOut && !finalIn);
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.target === hero) heroOut = !e.isIntersecting && e.boundingClientRect.top < 0;
      if (e.target === final) finalIn = e.isIntersecting;
      upd();
    }));
    if (hero) io.observe(hero);
    if (final) io.observe(final);
  }

  // ---------- Прогресс чтения статьи ----------
  const bar = $(".progress");
  const art = $(".article");
  if (bar && art) {
    const onScroll = () => {
      const r = art.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
      bar.style.width = `${(p * 100).toFixed(1)}%`;
    };
    addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- Окно при уходе: раз в 3 дня, не раньше 20 секунд на странице ----------
  const dlg = $("dialog.pop");
  if (dlg && typeof dlg.showModal === "function") {
    const KEY = "hmd_pop_at";
    const t0 = Date.now();
    const allowed = () => Date.now() - Number(ls.get(KEY) || 0) > 3 * 86400000 && Date.now() - t0 > 20000 && !document.querySelector("dialog[open]");
    const show = (why) => {
      if (!allowed()) return;
      ls.set(KEY, String(Date.now()));
      dlg.showModal();
      goal("popup_show", { why, page });
    };
    document.addEventListener("mouseout", (e) => { if (!e.relatedTarget && e.clientY <= 0) show("exit"); });
    // На телефоне «ухода мышью» нет: показываем после быстрой прокрутки вверх ближе к концу страницы
    let lastY = scrollY, lastT = Date.now();
    addEventListener("scroll", () => {
      const now = Date.now();
      const v = (lastY - scrollY) / Math.max(1, now - lastT);
      if (v > 2.5 && scrollY > innerHeight * 1.5 && matchMedia("(pointer: coarse)").matches) show("scroll_up");
      lastY = scrollY; lastT = now;
    }, { passive: true });
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
  }

  // ---------- Демо-приём ----------
  const demo = $("[data-demo]");
  if (demo) initDemo(demo);

  function initDemo(root) {
    const D = {
      qs: [
        { id: "food", q: "Когда болит — натощак или после еды?", a: "Натощак и ночью хуже. Поем — вроде отпускает.", key: true },
        { id: "meds", q: "Какие лекарства вы принимаете?", a: "От спины пью обезболивающие — ибупрофен, по две таблетки в день. Уже месяц.", key: true },
        { id: "blood", q: "Был ли чёрный стул или рвота «кофейной гущей»?", a: "Рвоты не было. А стул… пару раз был тёмный, я думал — от еды.", key: true },
        { id: "smoke", q: "Курите? Алкоголь?", a: "Курю, пачку в день. Выпиваю по праздникам." },
        { id: "load", q: "Боль отдаёт куда-нибудь? Бывает при нагрузке?", a: "Никуда не отдаёт. По лестнице хожу нормально, одышки нет." },
        { id: "sleep", q: "Как вы спите?", a: "Плохо. Часа в три ночи просыпаюсь от этой боли." },
      ],
      tests: [
        { id: "egd", n: "ФГДС", r: "Язвенный дефект 8 мм на передней стенке луковицы двенадцатиперстной кишки, дно покрыто фибрином. Признаков продолжающегося кровотечения нет. Уреазный тест на H. pylori — отрицательный.", key: true },
        { id: "cbc", n: "Общий анализ крови", r: "Гемоглобин 118 г/л ↓, MCV 82 фл, лейкоциты 7,1×10⁹/л, тромбоциты 290×10⁹/л." },
        { id: "fobt", n: "Кал на скрытую кровь", r: "Положительный." },
        { id: "ecg", n: "ЭКГ", r: "Синусовый ритм, 76 в минуту. Острых ишемических изменений нет." },
        { id: "us", n: "УЗИ брюшной полости", r: "Печень, желчный пузырь, поджелудочная железа — без особенностей." },
        { id: "amy", n: "Амилаза крови", r: "52 Ед/л — в пределах нормы." },
      ],
      dx: [
        { id: "gerd", n: "ГЭРБ", s: 2 },
        { id: "pud", n: "Язва луковицы ДПК на фоне приёма НПВП, скрытое кровотечение", s: 5 },
        { id: "panc", n: "Острый панкреатит", s: 1 },
        { id: "angina", n: "Нестабильная стенокардия", s: 1 },
        { id: "fd", n: "Функциональная диспепсия", s: 2 },
      ],
    };
    const S = { step: 0, asked: new Set(), tests: new Set(), dx: null };
    const log = $(".demo-log", root);
    const act = $(".demo-act", root);
    const steps = $$(".demo-steps li", root);
    let started = false;

    const say = (cls, text, delay = 0) => new Promise((res) => setTimeout(() => {
      const b = document.createElement("div");
      b.className = `bubble ${cls}`;
      b.innerHTML = text;
      log.appendChild(b);
      log.scrollTop = log.scrollHeight;
      res();
    }, delay));
    const typing = async (ms = 700) => {
      const t = document.createElement("div");
      t.className = "bubble pat typing";
      t.textContent = "Пациент отвечает…";
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
      await new Promise((r) => setTimeout(r, ms));
      t.remove();
    };
    const setStep = (n) => { S.step = n; steps.forEach((li, i) => { li.classList.toggle("on", i === n); li.classList.toggle("done", i < n); }); };

    function renderAsk() {
      setStep(0);
      const left = D.qs.filter((q) => !S.asked.has(q.id));
      act.innerHTML = `<div class="lbl"><span>Выберите вопрос пациенту</span><span>${S.asked.size} из ${D.qs.length}</span></div>
        <div class="opts">${left.map((q) => `<button class="opt" type="button" data-q="${q.id}">${esc(q.q)}</button>`).join("")}</div>
        ${S.asked.size >= 2 ? `<div class="demo-next"><button class="btn btn-primary" type="button" data-to-tests>К обследованию <span class="arr">→</span></button></div>` : ""}`;
    }
    async function ask(id) {
      if (!started) { started = true; goal("demo_start", { page }); }
      const q = D.qs.find((x) => x.id === id);
      S.asked.add(id);
      act.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await say("doc", esc(q.q));
      await typing();
      await say("pat", esc(q.a));
      if (S.asked.size === D.qs.length) return renderTests();
      renderAsk();
    }
    function renderTests() {
      setStep(1);
      act.innerHTML = `<div class="lbl"><span>Назначьте обследования</span><span>выбрано: ${S.tests.size}</span></div>
        <div class="opts">${D.tests.map((t) => `<button class="opt${S.tests.has(t.id) ? " pick" : ""}" type="button" data-t="${t.id}" ${S.tests.has(t.id) ? "disabled" : ""}>${esc(t.n)}</button>`).join("")}</div>
        ${S.tests.size ? `<div class="demo-next"><button class="btn btn-primary" type="button" data-to-dx>Поставить диагноз <span class="arr">→</span></button></div>` : ""}`;
    }
    async function order(id) {
      const t = D.tests.find((x) => x.id === id);
      S.tests.add(id);
      act.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await say("res", `<b>${esc(t.n)}</b>${esc(t.r)}`, 350);
      renderTests();
    }
    function renderDx() {
      setStep(2);
      act.innerHTML = `<div class="lbl"><span>Ваш диагноз</span></div>
        <div class="opts">${D.dx.map((d) => `<button class="opt" type="button" data-d="${d.id}">${esc(d.n)}</button>`).join("")}</div>`;
    }
    async function diagnose(id) {
      S.dx = D.dx.find((x) => x.id === id);
      act.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await say("doc", `Диагноз: ${esc(S.dx.n)}`);
      await say("res", "<b>Эксперт</b>Изучаю ваш приём…", 300);
      setTimeout(renderResult, 900);
    }
    function renderResult() {
      setStep(3);
      steps.forEach((li) => li.classList.add("done"));
      const keys = D.qs.filter((q) => q.key);
      const keyAsked = keys.filter((q) => S.asked.has(q.id));
      const aScore = Math.round((keyAsked.length / keys.length) * 5 * 2) / 2;
      let tScore = (S.tests.has("egd") ? 3 : 0) + (S.tests.has("cbc") ? 1 : 0) + (S.tests.has("fobt") || S.tests.has("ecg") ? 1 : 0);
      if (S.tests.size > 4) tScore -= 1;
      tScore = Math.max(0, Math.min(5, tScore));
      const dScore = S.dx.s;
      const total = Math.round((aScore * 0.35 + tScore * 0.25 + dScore * 0.4) * 2) / 2;
      const good = [], miss = [];
      if (S.asked.has("meds")) good.push("Спросили о лекарствах — месячный приём ибупрофена и есть главная причина язвы.");
      else miss.push("Не спросили о лекарствах. Пациент месяц пьёт ибупрофен — ключ к диагнозу и лечению.");
      if (S.asked.has("blood")) good.push("Уточнили признаки кровотечения — тёмный стул меняет срочность.");
      else miss.push("Не спросили о чёрном стуле и рвоте «кофейной гущей» — «красных флагах» кровотечения.");
      if (S.asked.has("food")) good.push("Связь боли с едой уточнена: «голодные» и ночные боли типичны для язвы двенадцатиперстной кишки.");
      else miss.push("Не уточнили связь боли с приёмом пищи.");
      if (S.tests.has("egd")) good.push("ФГДС назначена — это главный метод при подозрении на язву.");
      else miss.push("Без ФГДС язву не подтвердить: это ключевое обследование.");
      if (S.tests.size > 4) miss.push("Назначено много лишнего — в реальной практике это время и деньги пациента.");
      if (S.dx.id !== "pud") miss.push("Диагноз не совпал. Верный: язва луковицы ДПК на фоне приёма НПВП со скрытым кровотечением.");
      const bar = (label, v) => `<div><span>${label}</span><i style="--w:${(v / 5) * 100}%"></i><span>${String(v).replace(".", ",")}</span></div>`;
      $(".demo-main", root).innerHTML = `<div class="result">
        <div class="review">
          <div class="review-h"><b>Разбор приёма</b><span>${String(total).replace(".", ",")} / 5</span></div>
          <div class="scores">${bar("Расспрос", aScore)}${bar("Обследование", tScore)}${bar("Диагноз", dScore)}</div>
          ${good.length ? `<p><strong>Что получилось</strong></p><ul>${good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          ${miss.length ? `<p style="margin-top:12px"><strong>Что упустили</strong></p><ul>${miss.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          <p class="outcome"><strong>Что было дальше.</strong> Ибупрофен отменили, назначили ингибитор протонной помпы на 8 недель и подобрали обезболивание для спины без НПВП. Через два месяца на контрольной ФГДС язва зарубцевалась.</p>
        </div>
        <p style="margin:20px 0 0;font-size:16px">Это демо с готовым сценарием. В тренажёре пациенты каждый раз новые, отвечают на любые вопросы — текстом или голосом, — а эксперт разбирает именно ваш диалог.</p>
        <div class="cta"><a class="btn btn-primary btn-lg" href="/app?from=demo_result">Принять настоящего пациента — бесплатно <span class="arr">→</span></a><button class="btn btn-ghost" type="button" data-restart>Пройти демо ещё раз</button></div>
      </div>`;
      goal("demo_done", { score: total, page });
    }

    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || b.disabled) return;
      if (b.dataset.q) ask(b.dataset.q);
      else if ("toTests" in b.dataset) renderTests();
      else if (b.dataset.t) order(b.dataset.t);
      else if ("toDx" in b.dataset) renderDx();
      else if (b.dataset.d) diagnose(b.dataset.d);
      else if ("restart" in b.dataset) location.reload();
    });
    root.classList.add("ready");
    log.innerHTML = "";
    say("pat", "Доктор, жжёт под ложечкой уже третью неделю. Сил нет.");
    renderAsk();
  }
})();
