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
  // Уже вошёл в тренажёр (токен веб-версии в этом браузере) — не продаём, а зовём продолжить
  const loggedIn = !!ls.get("hmd_token");

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
  // ---------- Светлая / тёмная тема: выбор запоминается в браузере ----------
  // Ранний скрипт в <head> ставит data-theme до отрисовки, здесь — только переключение
  const root = document.documentElement;
  const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  $$("[data-theme-toggle]").forEach((b) => b.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    root.dataset.theme = next;
    ls.set("hmd_theme", next);
    $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", next === "dark" ? "#121514" : "#f6f4ee"));
    goal("theme", { to: next });
  }));
  if (root.dataset.theme) $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", root.dataset.theme === "dark" ? "#121514" : "#f6f4ee"));

  // Выпадающие меню закрываются кликом мимо
  document.addEventListener("click", (e) => { $$(".nav details[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; }); });

  // ---------- Полоса с ранними ценами и обратный отсчёт ----------
  const promo = $(".promo");
  const until = Number(document.body.dataset.earlyUntil || 0);
  const left = until - Date.now();
  if (promo) {
    if (left <= 0 || ls.get("hmd_promo_x") === String(until)) promo.hidden = true;
    else promo.hidden = false;
    if (loggedIn) promo.hidden = true;
    $(".promo-x", promo)?.addEventListener("click", () => { promo.hidden = true; ls.set("hmd_promo_x", String(until)); goal("promo_close"); });
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
  if (sticky && loggedIn) {
    const t = $("[data-sticky-text]", sticky);
    const b = $("[data-sticky-btn]", sticky);
    if (t) t.textContent = "Пациенты ждут в очереди";
    if (b) b.innerHTML = 'Продолжить тренировку <span class="arr">→</span>';
  }
  if (sticky) {
    const hero = $("[data-hero]") || $("main > :first-child");
    const final = $(".final") || $("footer");
    const demoEl = $("[data-demo]");
    let heroOut = false, finalIn = false, demoIn = false;
    // Пока на экране демо — своя кнопка у демо, липкая не нужна (и не закрывает варианты ответа)
    const upd = () => sticky.classList.toggle("show", heroOut && !finalIn && !demoIn);
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.target === hero) heroOut = !e.isIntersecting && e.boundingClientRect.top < 0;
      if (e.target === final) finalIn = e.isIntersecting;
      if (e.target === demoEl) demoIn = e.isIntersecting;
      upd();
    }));
    if (hero) io.observe(hero);
    if (final) io.observe(final);
    if (demoEl) io.observe(demoEl);
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

  // ---------- Окно при уходе: раз в 3 дня, не раньше 20 секунд, не тем, кто уже вошёл ----------
  // На компьютере — при уводе курсора к вкладкам. На телефоне — только в статьях, после 60% прочтения и резкой прокрутки вверх.
  const dlg = $("dialog.pop");
  if (dlg && typeof dlg.showModal === "function" && !loggedIn) {
    const KEY = "hmd_pop_at";
    const t0 = Date.now();
    const readMode = document.body.dataset.popup === "read";
    const readShare = () => { const a = $(".article"); if (!a) return 1; const r = a.getBoundingClientRect(); return Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight))); };
    const allowed = () => Date.now() - Number(ls.get(KEY) || 0) > 3 * 86400000 && Date.now() - t0 > 20000 && !document.querySelector("dialog[open]") && (!readMode || readShare() > 0.6);
    const show = (why) => {
      if (!allowed()) return;
      ls.set(KEY, String(Date.now()));
      dlg.showModal();
      goal("popup_show", { why, page });
    };
    document.addEventListener("mouseout", (e) => { if (!e.relatedTarget && e.clientY <= 0) show("exit"); });
    if (readMode && matchMedia("(pointer: coarse)").matches) {
      let lastY = scrollY, lastT = Date.now();
      addEventListener("scroll", () => {
        const now = Date.now();
        const v = (lastY - scrollY) / Math.max(1, now - lastT);
        if (v > 4 && scrollY > innerHeight * 2) show("scroll_up");
        lastY = scrollY; lastT = now;
      }, { passive: true });
    }
    dlg.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a) goal("popup_click", { to: a.getAttribute("href"), page });
      if (e.target === dlg || e.target.closest("[data-close]")) dlg.close();
    });
  }

  // ---------- Пациент в углу: живой клинический случай ----------
  // Появляется после прокрутки на любой странице — пока посетитель с ним не разобрался (состояние в localStorage).
  // Клик — карточка: жалоба, анамнез, показатели, таймер 2 минуты. «Собрать анамнез» и «Назначить обследование»
  // ведут в тренажёр; отказ или истёкшее время — пациент уходит без помощи и грустит в углу, больше не кликается.
  const PATIENTS = [
    { n: "Аркадий Н.", g: "m", a: 58, bub: "Давит за грудиной второй час",
      q: "Давит за грудиной второй час, отдаёт в левую руку. Нитроглицерин не помог.",
      hx: "Курит 30 лет, гипертония — таблетки пьёт «когда вспомнит».", v: ["АД 165/95", "ЧСС 104", "SpO₂ 95%", "t 36,8 °C"], data: "ЭКГ ещё не снимали",
      out: "Через 40 минут его увезла скорая." },
    { n: "Зинаида П.", g: "f", a: 71, bub: "Не могу подобрать слова",
      q: "С утра не могу подобрать слова, а правая рука как чужая.",
      hx: "Фибрилляция предсердий, антикоагулянт бросила месяц назад.", v: ["АД 185/100", "ЧСС 96, неритмичный", "глюкоза 6,1"], data: "Симптомы начались 2 часа назад",
      out: "Время на тромболизис упущено." },
    { n: "Виталий С.", g: "m", a: 19, bub: "Температура под сорок третий день",
      q: "Третий день температура под сорок, голова раскалывается, свет режет глаза.",
      hx: "Живёт в общежитии, у соседа по комнате неделю назад была «простуда».", v: ["t 39,4 °C", "ЧСС 118", "АД 100/60"], data: "На голенях мелкая сыпь, не бледнеет при надавливании",
      out: "Вечером его привезли в реанимацию." },
    { n: "Ольга К.", g: "f", a: 34, bub: "Живот болит справа внизу",
      q: "Живот болит с утра: сначала вокруг пупка, теперь справа внизу. Тошнит.",
      hx: "Последние месячные — 6 недель назад.", v: ["t 37,8 °C", "ЧСС 102", "АД 110/70"], data: "Лейкоциты 14,2 × 10⁹/л",
      out: "Ночью — экстренная операция." },
    { n: "Геннадий Р.", g: "m", a: 45, bub: "Пью по пять литров в день",
      q: "Пью по пять литров в день, всё время бегаю в туалет. За месяц минус семь килограммов.",
      hx: "Последнюю неделю — слабость и сонливость, сегодня дважды рвало.", v: ["ЧДД 24", "ЧСС 110", "АД 105/65"], data: "Глюкоза 21 ммоль/л, запах ацетона изо рта",
      out: "Через сутки — реанимация." },
    { n: "Елизавета М.", g: "f", a: 27, bub: "Задыхаюсь на втором этаже",
      q: "Задыхаюсь на втором этаже, сердце колотится. Вчера прилетела из Новосибирска.",
      hx: "Принимает оральные контрацептивы, курит.", v: ["ЧСС 112", "SpO₂ 91%", "АД 105/70"], data: "Левая голень отёчнее правой на 2 см",
      out: "Утром её доставили в реанимацию." },
  ];
  const PKEY = "hmd_patient";
  const WAIT_MS = 120000;
  const readP = () => { try { return JSON.parse(ls.get(PKEY) || "null"); } catch { return null; } };
  const saveP = (v) => ls.set(PKEY, JSON.stringify(v));
  // c=1 — без медицинской маски и тёмных очков: эмоция должна читаться
  const face = (p, m) => `/api/face?${new URLSearchParams({ v: "3", s: `case-${p.n}`, g: p.g, a: String(p.a), m, c: "1" })}`;
  const years = (a) => `${a} ${plural(a, "год", "года", "лет")}`;
  const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  function mountPatient(p, mode) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `patient${mode === "sad" ? " sad" : ""}`;
    el.innerHTML = mode === "sad"
      ? `<img src="${face(p, "sad")}" alt="" width="76" height="76"><span class="bubble"><b>${esc(p.n)} ${p.g === "f" ? "ушла" : "ушёл"} без помощи</b>${esc(p.out)}</span>`
      : `<img src="${face(p, "bad")}" alt="" width="76" height="76"><span class="bubble"><b>Пациент ждёт · ${esc(p.n)}, ${years(p.a)}</b><span data-bub>«${esc(p.bub)}»</span></span>`;
    el.setAttribute("aria-label", mode === "sad" ? `${p.n} ${p.g === "f" ? "ушла" : "ушёл"} без помощи` : `Пациент ${p.n} ждёт приёма — открыть карточку`);
    if (mode === "sad") { el.tabIndex = -1; el.setAttribute("aria-hidden", "true"); }
    document.body.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));
    return el;
  }
  let pst = readP();
  if (!pst || !PATIENTS[pst.i]) { pst = { st: "wait", i: Math.floor(Math.random() * PATIENTS.length) }; saveP(pst); }
  // Открыли и ушли со страницы, а время вышло — пациент ушёл
  if (pst.st === "open" && !(pst.until > Date.now())) { pst = { st: "refused", i: pst.i }; saveP(pst); }
  const P0 = PATIENTS[pst.i];
  if (pst.st === "refused") mountPatient(P0, "sad").classList.add("quiet");
  else if ((pst.st === "wait" || pst.st === "open") && typeof HTMLDialogElement === "function") {
    let el = null, dlgP = null, tick = 0, done = false;
    const refuse = (why) => {
      if (done) return;
      done = true;
      clearInterval(tick);
      if (dlgP?.open) dlgP.close();
      saveP({ st: "refused", i: pst.i });
      el?.remove();
      const sadEl = mountPatient(P0, "sad");
      setTimeout(() => sadEl.classList.add("quiet"), 8000);
      goal("patient_refuse", { why, page });
    };
    const render = () => {
      const left = pst.until - Date.now();
      const t = dlgP && $(".pt-timer", dlgP);
      if (t) { $("b", t).textContent = mmss(left); $("i", t).style.setProperty("--left", String(Math.max(0, left) / WAIT_MS)); }
      const bub = el && $("[data-bub]", el);
      if (bub) bub.textContent = `Ждёт ещё ${mmss(left)}`;
      if (left <= 0) refuse("timeout");
    };
    const startTimer = () => { if (!tick) tick = setInterval(render, 1000); render(); };
    const open = () => {
      if (done) return;
      if (pst.st !== "open") { pst = { st: "open", i: pst.i, until: Date.now() + WAIT_MS }; saveP(pst); }
      if (!dlgP) {
        dlgP = document.createElement("dialog");
        dlgP.className = "pop pt";
        dlgP.setAttribute("aria-label", `Пациент ${P0.n}`);
        dlgP.innerHTML = `<div class="pt-in">
          <button class="pop-x" type="button" data-close aria-label="Свернуть">×</button>
          <div class="pt-head"><img src="${face(P0, "bad")}" alt="" width="72" height="72"><div><span class="mono">без записи · ждёт в коридоре</span><h2>${esc(P0.n)}, ${years(P0.a)}</h2></div></div>
          <p class="pt-quote">«${esc(P0.q)}»</p>
          <dl class="pt-facts">
            <dt>Анамнез</dt><dd>${esc(P0.hx)}</dd>
            <dt>При поступлении</dt><dd class="pt-vitals">${P0.v.map((x) => `<span>${esc(x)}</span>`).join("")}</dd>
            <dt>Уже известно</dt><dd>${esc(P0.data)}</dd>
          </dl>
          <div class="pt-timer"><span>Решение нужно через</span><b>2:00</b><i></i></div>
          <p class="pt-ask">С чего начнёте?</p>
          <div class="pt-btns">
            <a class="btn btn-primary" href="/app?from=patient_ask" data-act="ask">Собрать анамнез</a>
            <a class="btn btn-ghost" href="/app?from=patient_exam" data-act="exam">Назначить обследование</a>
            <button class="pt-no" type="button" data-act="refuse">Отказаться от пациента</button>
          </div>
          <p class="pt-note">Случай учебный. В тренажёре — такие же пациенты: расспрос, осмотр, анализы и разбор по клиническим рекомендациям Минздрава.</p>
        </div>`;
        document.body.append(dlgP);
        dlgP.addEventListener("click", (e) => {
          const a = e.target.closest("[data-act]");
          if (a?.dataset.act === "refuse") return refuse("button");
          if (a) { done = true; clearInterval(tick); saveP({ st: a.dataset.act, i: pst.i }); goal(`patient_${a.dataset.act}`, { page }); return; }
          if (e.target === dlgP || e.target.closest("[data-close]")) dlgP.close();
        });
      }
      startTimer();
      if (!done && !dlgP.open) { dlgP.showModal(); goal("patient_open", { page }); }
    };
    const show = () => {
      el = mountPatient(P0, "wait");
      el.addEventListener("click", open);
      if (pst.st === "open") startTimer();
      else goal("patient_show", { page });
    };
    // Уже открывали — пациент сразу на месте и ждёт; иначе появляется после прокрутки
    if (pst.st === "open") show();
    else {
      const onScrollP = () => {
        if (scrollY < innerHeight * 0.8 || document.querySelector("dialog[open]")) return;
        removeEventListener("scroll", onScrollP);
        show();
      };
      addEventListener("scroll", onScrollP, { passive: true });
    }
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
        { id: "egd", n: "ФГДС", r: "Язвенный дефект 8 мм на передней стенке луковицы двенадцатиперстной кишки, дно покрыто фибрином (Forrest III). Признаков продолжающегося кровотечения нет. Быстрый уреазный тест на H. pylori — отрицательный.", key: true },
        { id: "cbc", n: "Общий анализ крови", r: "Гемоглобин 118 г/л ↓, MCV 82 фл, лейкоциты 7,1×10⁹/л, тромбоциты 290×10⁹/л." },
        { id: "fobt", n: "Кал на скрытую кровь", r: "Положительный." },
        { id: "ecg", n: "ЭКГ", r: "Синусовый ритм, 76 в минуту. Острых ишемических изменений нет." },
        { id: "us", n: "УЗИ брюшной полости", r: "Печень, желчный пузырь, поджелудочная железа — без особенностей." },
        { id: "amy", n: "Амилаза крови", r: "52 Ед/л — в пределах нормы." },
      ],
      dx: [
        { id: "gerd", n: "ГЭРБ", s: 2 },
        { id: "pud", n: "Язва луковицы ДПК на фоне приёма НПВП, осложнённая кровотечением", s: 5 },
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
      if (S.asked.size === D.qs.length) renderTests();
      else renderAsk();
      focusFirst();
    }
    function focusFirst() {
      const b = act.querySelector(".opt:not([disabled])") || act.querySelector(".btn");
      if (b && root.contains(document.activeElement)) b.focus({ preventScroll: true });
    }
    function renderTests() {
      if (S.step !== 1) goal("demo_tests", { page });
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
      focusFirst();
    }
    function renderDx() {
      goal("demo_dx", { page });
      setStep(2);
      act.innerHTML = `<div class="lbl"><span>Ваш диагноз</span></div>
        <div class="opts">${D.dx.map((d) => `<button class="opt" type="button" data-d="${d.id}">${esc(d.n)}</button>`).join("")}</div>`;
    }
    async function diagnose(id) {
      S.dx = D.dx.find((x) => x.id === id);
      act.querySelectorAll("button").forEach((b) => (b.disabled = true));
      await say("doc", `Диагноз: ${esc(S.dx.n)}`);
      await say("res", "<b>ИИ-разбор</b>Сравниваю ваш приём с историей случая…", 300);
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
      if (S.dx.id !== "pud") miss.push("Диагноз не совпал. Верный: язва луковицы ДПК на фоне приёма НПВП, осложнённая кровотечением (тёмный стул, снижение гемоглобина).");
      const bar = (label, v) => `<div><span>${label}</span><i style="--w:${(v / 5) * 100}%"></i><span>${String(v).replace(".", ",")}</span></div>`;
      const missed = miss.length;
      $(".demo-main", root).innerHTML = `<div class="result">
        <div class="result-top"><p><strong>${missed ? `Упущено: ${missed}. ` : "Чистый приём. "}</strong>Проверьте себя на новом пациенте — каждый раз другой случай.</p><a class="btn btn-primary" href="/app?from=demo_top">Принять пациента бесплатно <span class="arr">→</span></a></div>
        <div class="review">
          <div class="review-h"><b>Разбор приёма</b><span>${String(total).replace(".", ",")} / 5</span></div>
          <div class="scores">${bar("Расспрос", aScore)}${bar("Обследование", tScore)}${bar("Диагноз", dScore)}</div>
          ${good.length ? `<p><strong>Что получилось</strong></p><ul>${good.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          ${miss.length ? `<p style="margin-top:12px"><strong>Что упустили</strong></p><ul>${miss.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
          <p class="outcome"><strong>Что было дальше.</strong> Из-за тёмного стула и снижения гемоглобина пациента госпитализировали под наблюдение. Ибупрофен отменили, назначили ингибитор протонной помпы, спину стали лечить без НПВП. Уреазный тест при кровотечении бывает ложноотрицательным, поэтому H. pylori перепроверили дыхательным тестом — отрицательно. Через два месяца язва зарубцевалась.</p><p class="small muted" style="margin:10px 0 0">Учебный сценарий. Тактика у реального пациента — по клиническим рекомендациям и решению врача.</p>
        </div>
        <p style="margin:20px 0 0;font-size:16px">Это демо с готовым сценарием. В тренажёре пациенты каждый раз новые, отвечают на любые вопросы — текстом или голосом, — а ИИ разбирает именно ваш диалог.</p>
        <div class="cta"><a class="btn btn-primary btn-lg" href="/app?from=demo_result">Принять настоящего пациента <span class="arr">→</span></a><button class="btn btn-ghost" type="button" data-restart>Пройти демо ещё раз</button></div>
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
      else if ("restart" in b.dataset) { location.hash = "demo"; location.reload(); }
    });
    root.classList.add("ready");
    log.innerHTML = "";
    say("pat", "Доктор, жжёт под ложечкой уже третью неделю. Сил нет.");
    renderAsk();
  }
})();
