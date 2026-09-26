// Сквозной тест против локального `wrangler dev -c wrangler.test.jsonc` и scripts/mock-telegram.mjs.
// Запуск: node test/e2e.mjs  (не входит в `npm test`, т.к. требует запущенных серверов)
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE || "http://127.0.0.1:8787";
const TOKEN = "123:TEST";
const LOG = ".wrangler/tg-calls.jsonl";
let updateId = 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tgCalls = () => fs.readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sent = (chat) => tgCalls().filter((c) => c.method === "sendMessage" && String(c.chat_id) === String(chat));

async function waitFor(fn, what, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(200);
  }
  throw new Error(`timeout: ${what}`);
}

async function tgUpdate(uid, payload) {
  const r = await fetch(`${BASE}/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ update_id: updateId++, ...payload }) });
  assert.equal(r.status, 200);
}
const from = (uid) => ({ id: Number(uid), is_bot: false, first_name: "Тест", username: `u${uid}` });
const text = (uid, t) => tgUpdate(uid, { message: { message_id: updateId, from: from(uid), chat: { id: Number(uid), type: "private" }, date: 1, text: t } });
const press = (uid, data, mid = 1) => tgUpdate(uid, { callback_query: { id: String(updateId), from: from(uid), data, message: { message_id: mid, chat: { id: Number(uid), type: "private" } } } });

function initData(uid) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: Number(uid), first_name: "Тест", username: `u${uid}` }), query_id: "q1" });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", crypto.createHmac("sha256", secret).update(dcs).digest("hex"));
  return params.toString();
}

async function api(token, method, path, body) {
  const r = await fetch(`${BASE}/api${path}`, {
    method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
async function login(uid) {
  const r = await api(null, "POST", "/auth/telegram", { initData: initData(uid) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.token;
}

const step = (name) => console.log(`✔ ${name}`);

// ---------------------------------------------------------------- бот
const U = "777";
await text(U, "/start");
await waitFor(() => sent(U).some((m) => m.text.includes("Добро пожаловать") && m.text.includes("Кто вы")), "welcome");
step("бот: /start регистрирует нового пользователя и начинает анкету");

await press(U, "ob_lvl_студент");
await waitFor(() => sent(U).some((m) => m.text.includes("2/4") && m.text.includes("специальность")), "onboarding q2");
await press(U, "ob_pr_1"); // Терапевт
const q3 = await waitFor(() => sent(U).find((m) => m.text.includes("3/4") && m.text.includes("Терапевт")), "onboarding q3");
assert.ok(q3.reply_markup.inline_keyboard.flat().some((b) => b.text.includes("гастроэнтерология")));
await press(U, "ob_in_0", 55);
await text(U, "гастро");
await waitFor(() => sent(U).some((m) => m.text.includes("Отметьте разделы кнопками")), "interests hint");
await waitFor(() => tgCalls().some((c) => c.method === "editMessageReplyMarkup" && JSON.stringify(c.reply_markup || {}).includes("✅ гастроэнтерология")), "interest toggled");
await press(U, "ob_in_ok"); // отметка «гастроэнтерология» пережила текстовое сообщение
const q4 = await waitFor(() => sent(U).find((m) => m.text.includes("4/4") && m.text.includes("сложность")), "onboarding q4");
assert.ok(q4.reply_markup.inline_keyboard.flat().some((b) => b.text.includes("Лёгкая ⭐")), "для студента рекомендуем лёгкую");
await press(U, "ob_df_medium");
await waitFor(() => sent(U).some((m) => m.text.includes("Профиль готов") && m.text.includes("гастроэнтерология") && m.text.includes("средняя")), "onboarding done");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Анкета") && m.text.includes("Терапевт") && m.text.includes("Сложность: Средняя")), "admin onboarding");
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Анкета") && m.text.includes("гастроэнтерология")), "second admin onboarding");
await waitFor(() => sent(U).some((m) => m.text.includes("Пока пациент готовится")), "about ask");
await text(U, "4 курс, Сеченовский, хочу научиться ставить диагноз");
await waitFor(() => sent(U).some((m) => m.text.includes("Спасибо! Пациент уже на подходе")), "about saved");
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Анкета дополнена") && m.text.includes("4 курс")), "admin about");
step("бот: анкета (роль, специальность, разделы, сложность, о себе) → профиль, оба админа получают ответы");

// Первый пациент приходит сам — по выбранному профилю, без нажатия «Новый пациент»
const ready = await waitFor(() => sent(U).find((m) => m.text.includes("Новый пациент готов")), "new patient");
const patId = ready.reply_markup.inline_keyboard[0][0].callback_data.slice(3);
assert.match(patId, /^pat_777_/);
step("бот: первый пациент создаётся сразу после анкеты (очередь, alarm) и приходит сообщением");

await press(U, `sp_${patId}`);
await waitFor(() => sent(U).some((m) => m.text.includes("Мирон") && m.text.includes("живот крутит")), "opening phrase");
step("бот: приём начат, пациент говорит первую фразу");

// Одновременно открываем сайт — должен видеть тот же приём
const webToken = await login(U);
let me = (await api(webToken, "GET", "/me")).data;
assert.equal(me.profile.difficulty, "medium");
assert.equal(me.profile.complexity, "medium");
assert.deepEqual(me.profile.specializations, ["гастроэнтерология"]);
assert.equal(me.active_patient_id, patId);
assert.ok(me.patients.find((p) => p.id === patId).in_consultation);
step("сайт: видит тот же активный приём (синхронизация)");

// WebSocket: подписываемся и ждём событие при сообщении из бота
const ws = new WebSocket(`${BASE.replace("http", "ws")}/api/ws?token=${encodeURIComponent(webToken)}`);
const wsEvents = [];
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = (e) => wsEvents.push(JSON.parse(e.data));

await text(U, "Где болит и как давно?");
await waitFor(() => sent(U).some((m) => m.text.includes("Болит под ложечкой")), "patient reply");
await waitFor(() => wsEvents.some((e) => e.scope === "consultation"), "ws event");
step("бот: ответ пациента; сайт получил событие по WebSocket");

// Сообщение с сайта — бот продолжит того же пациента
let r = await api(webToken, "POST", `/patients/${patId}/message`, { text: "Курите? Принимаете обезболивающие?" });
assert.equal(r.status, 200);
assert.ok(r.data.reply);
const pv = (await api(webToken, "GET", `/patients/${patId}`)).data.patient;
assert.equal(pv.conversation_history.filter((m) => m.role === "doctor").length, 2);
assert.equal(pv.true_diagnosis, null, "диагноз скрыт до конца приёма");
assert.equal(pv.full_history, undefined, "история болезни не утекает на клиент");
step("сайт: сообщение пациенту, история общая с ботом, секреты скрыты");

await press(U, "t_0");
await waitFor(() => sent(U).some((m) => m.text.includes("Результат: КТ")), "test result");
await press(U, "px_2");
await waitFor(() => sent(U).some((m) => m.text.includes("Осмотр: Пальпация живота")), "exam");
const afterExam = (await api(webToken, "GET", `/patients/${patId}`)).data.patient;
assert.deepEqual(afterExam.current.physicals, ["Пальпация живота"], "осмотр отмечается как проведённый");
assert.equal(afterExam.findings, undefined, "находки по методам не утекают на клиент");
r = await api(webToken, "POST", `/patients/${patId}/test`, { name: "КТ" });
assert.equal(r.data.cached, true);
step("бот: обследование и осмотр; повторное КТ отдаётся из кэша без ИИ");

// Подсказки: с сайта и из бота, не больше трёх на пациента
r = await api(webToken, "POST", `/patients/${patId}/hint`);
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.hint.n, 1);
assert.equal(r.data.left, 2);
assert.ok(r.data.hint.text.length > 20);
await press(U, "act_hint");
await waitFor(() => sent(U).some((m) => m.text.includes("Осталось <b>2 из 3</b>")), "hint confirm in bot");
await press(U, "hint_ok");
await waitFor(() => tgCalls().some((c) => c.method === "editMessageText" && c.text?.includes("Подсказка 2 из 3")), "hint in bot");
r = await api(webToken, "POST", `/patients/${patId}/hint`);
assert.equal(r.data.left, 0);
r = await api(webToken, "POST", `/patients/${patId}/hint`);
assert.equal(r.status, 409);
assert.equal(r.data.code, "hints_out");
const withHints = (await api(webToken, "GET", `/patients/${patId}`)).data.patient;
assert.equal(withHints.hints.length, 3, "подсказки сохранены в ленте приёма");
assert.equal(withHints.kr, null, "название КР выдало бы диагноз — до конца приёма скрыто");
step("подсказки: сайт и бот, счётчик, четвёртая — отказ, КР скрыта до конца приёма");

await press(U, "end_dx");
await waitFor(() => sent(U).some((m) => m.text.includes("Введите диагноз")), "dx prompt");
await text(U, "Язвенная болезнь ДПК");
await waitFor(() => sent(U).some((m) => m.text.includes("Назначьте лечение")), "treatment prompt");
await text(U, "Омепразол 20 мг 2 раза, амоксициллин, кларитромицин 14 дней");
await waitFor(() => sent(U).some((m) => m.text.includes("ПРИЁМ ЗАВЕРШЁН")), "finish");
const evalMsg = await waitFor(() => sent(U).find((m) => m.text.includes("Разбор приёма")), "evaluation");
assert.ok(evalMsg.text.includes("3.4"), evalMsg.text.slice(0, 200));
assert.ok(evalMsg.text.includes("Подсказок взято: 3"), "в разборе видно, сколько подсказок взято");
await waitFor(() => sent(U).find((m) => m.text.includes("первый разобранный приём") && JSON.stringify(m.reply_markup || {}).includes("rv_")), "review after first patient");
step("бот: диагноз + лечение → завершение → разбор эксперта → сразу просьба оценить тренажёр");

me = (await api(webToken, "GET", "/me")).data;
const closed = me.patients.find((p) => p.id === patId);
assert.equal(closed.status, "closed");
assert.equal(closed.last_rating, 3.4, "мало вопросов — минус полбалла, три подсказки — ещё минус 0,6");
assert.ok(me.profile.xp > 0);
assert.equal(me.profile.stats.consultations_total, 1);
assert.equal(me.profile.streak, 1);
step("сайт: оценка, XP и стрик уже видны");

const g0 = (await api(webToken, "GET", `/patients/${patId}`)).data.patient;
assert.ok(g0.kr?.name.includes("Язвенная болезнь"), "после приёма КР видна");
assert.equal(g0.consultations[0].guide, undefined, "разбор по КР не строится сам — только по кнопке");
assert.ok(JSON.stringify(evalMsg.reply_markup).includes(`kr_${patId}`), "в разборе в боте — кнопка «Разбор по КР»");
r = await api(webToken, "POST", `/patients/${patId}/guide`);
assert.equal(r.status, 409);
assert.equal(r.data.code, "premium", "разбор по КР — в премиуме");
await press(U, `kr_${patId}`);
await waitFor(() => sent(U).some((m) => m.text.includes("Разбор по клиническим рекомендациям Минздрава — в премиуме")), "guide paywall in bot");
step("разбор по КР: по кнопке и только в премиуме (сайт и бот)");

// Лимит бесплатного тарифа
r = await api(webToken, "POST", "/patients/new");
assert.equal(r.status, 409);
assert.equal(r.data.code, "limit");
step("лимит: второй бесплатный пациент за день запрещён");

// ---------------------------------------------------------------- премиум: закрытые функции, пробный период за 1 ₽
assert.ok(JSON.stringify(evalMsg.reply_markup).includes("1 ₽"), "кнопка пробного периода");
assert.ok(evalMsg.text.includes("Совет:"), "совет эксперта виден без премиума");
let pv0 = (await api(webToken, "GET", `/patients/${patId}`)).data;
assert.ok(pv0.patient.consultations[0].feedback.dialog_moments.length, "цитаты из диалога открыты всем");
assert.ok(pv0.patient.post_story, "«что было дальше» открыто всем");
assert.ok(pv0.patient.consultations[0].feedback.expert_text, "вывод эксперта виден");
await waitFor(async () => (await api(webToken, "GET", `/patients/${patId}`)).data.quiz, "quiz generated");
r = await api(webToken, "GET", `/quiz/${patId}`);
assert.equal(r.status, 409);
assert.equal(r.data.code, "premium", "тест по ошибкам — в премиуме");
me = (await api(webToken, "GET", "/me")).data;
assert.equal(me.profile.trial_available, true);
assert.ok(me.profile.weaknesses.length > 0, "слабые места видны без премиума");
assert.ok(me.offer.early, "ранние цены до 31 октября");
assert.equal(me.offer.plans.month.price, "249.00");
assert.equal(me.offer.plans.month.regular, "390.00");
assert.ok(!me.offer.plans.forever && !me.offer.plans.day, "старые тарифы не продаются");
assert.equal((await api(webToken, "POST", "/pay", { plan: "trial" })).data.code, "consent", "без согласия на автосписания оплата не создаётся");
r = await api(webToken, "POST", "/pay", { plan: "trial", consent: true });
assert.equal(r.status, 200, JSON.stringify(r.data));
const trialOp = r.data.link.split("/").pop();
const subReq = tgCalls().find((c) => c.method === "tochka POST /uapi/acquiring/v1.0/subscriptions" && c.consumerId === U);
assert.equal(subReq.amount, "1.00");
assert.equal(subReq.recurring, true);
assert.equal(subReq.saveCard, true);
r = await fetch(`${BASE}/payment-callback`, { method: "POST", body: JSON.stringify({ operationId: trialOp }) });
assert.equal(r.status, 200);
me = (await api(webToken, "GET", "/me")).data;
assert.equal(me.profile.premium, true);
assert.equal(me.profile.trial_available, false);
assert.equal(me.profile.autopay.status, "active");
assert.equal(me.profile.autopay.price, 249, "после пробного — месяц по ранней цене");
assert.ok(Math.abs(me.profile.autopay.next_at - (Date.now() + 7 * 86400000)) < 120000, "первое списание через 7 дней");
await waitFor(() => sent(U).some((m) => m.text.includes("Премиум на 7 дней включён")), "trial message");
assert.equal((await api(webToken, "POST", "/pay", { plan: "trial", consent: true })).data.code, "trial_used");
assert.ok((await api(webToken, "GET", `/patients/${patId}`)).data.patient.consultations[0].feedback.dialog_moments.length, "после оплаты разбор открыт");
r = await api(webToken, "POST", `/patients/${patId}/guide`);
assert.equal(r.data.pending, true, "разбор по КР ставится в очередь");
const guide1 = await waitFor(async () => (await api(webToken, "GET", `/patients/${patId}`)).data.patient.consultations[0].guide, "guide ready");
assert.ok(guide1.must.length >= 3 && guide1.diagnosis_path.length, "чек-лист и как распознать");
assert.ok(guide1.treatment.length && guide1.treatment[0].dose, "препараты с дозами");
assert.ok(guide1.kr?.url.includes("cr.minzdrav.gov.ru/view-cr/"), "ссылка на рекомендацию в рубрикаторе");
r = await api(webToken, "POST", `/patients/${patId}/guide`);
assert.ok(r.data.guide, "повторный запрос — готовый разбор без ИИ");
await press(U, `kr_${patId}`);
const guideMsg = await waitFor(() => sent(U).find((m) => m.text.includes("Разбор по КР Минздрава")), "guide in bot");
assert.ok(guideMsg.text.includes("❌") && guideMsg.text.includes("✅"), "в боте: чек-лист сделано / пропущено");
step("премиум: разбор и тест закрыты, пробный период 7 дней за 1 ₽ с привязкой карты");

const quiz = await waitFor(async () => (await api(webToken, "GET", `/quiz/${patId}`)).data.quiz, "quiz");
assert.equal(quiz.total, 5);
assert.equal(quiz.questions[0].correct, undefined, "правильный ответ не раскрыт заранее");
assert.ok(quiz.kr?.url, "тест привязан к КР");
assert.equal(quiz.questions[0].topic, "treatment");
await press(U, `qa_${patId}_0_0`);
await waitFor(() => tgCalls().some((c) => c.method === "editMessageText" && c.text?.includes("Верно")), "quiz feedback");
r = await api(webToken, "POST", `/quiz/${patId}/answer`, { index: 1, chosen: 2 });
assert.equal(r.data.is_correct, false);
r = await api(webToken, "POST", `/quiz/${patId}/answer`, { index: 1, chosen: 0 });
assert.equal(r.data.stale, true, "повторный ответ на тот же вопрос игнорируется");
step("тест: вопросы в боте и на сайте — общий прогресс, без двойных ответов");

// ---------------------------------------------------------------- отзыв
await press(U, "fb");
await waitFor(() => sent(U).some((m) => m.text.includes("Отзыв о тренажёре")), "feedback ask");
await press(U, "rv_4");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Новый отзыв ★★★★☆")), "admin feedback");
await text(U, "Удобно, но хочется больше педиатрии");
await waitFor(() => sent(U).some((m) => m.text.includes("Спасибо за отзыв")), "feedback thanks");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Отзыв дополнен") && m.text.includes("педиатрии")), "admin feedback text");
r = await api(webToken, "POST", "/feedback", { rating: 5, text: "С сайта" });
assert.equal(r.status, 200);
assert.equal((await api(webToken, "POST", "/feedback", {})).status, 409);
me = (await api(webToken, "GET", "/me")).data;
assert.equal(me.profile.feedback.length, 2);
assert.equal(me.profile.review_asked, true);
step("отзыв: оценка и текст в боте и на сайте, админ получает уведомления");

// ---------------------------------------------------------------- разделы своей специальности
r = await api(webToken, "POST", "/sections/suggest", { profession: "Неонатолог" });
assert.ok(r.data.sections.length >= 2, JSON.stringify(r.data));
r = await api(webToken, "POST", "/sections/suggest", { profession: "педиатр" });
assert.deepEqual(r.data.sections, ["неонатология", "детская инфекция", "детская кардиология"]);
step("профиль: для своей специальности подбираются разделы");

// ---------------------------------------------------------------- миграция
const oldToken = await login("555");
const old = (await api(oldToken, "GET", "/me")).data;
assert.equal(old.profile.name, "Анна");
assert.equal(old.profile.has_sub, true);
assert.equal(old.patients.length, 2);
assert.equal(old.quizzes.length, 1);
const oldActive = (await api(oldToken, "GET", "/patients/pat_555_1")).data.patient;
assert.ok(oldActive.current, "незавершённый приём восстановлен");
assert.deepEqual(oldActive.current.tests, ["ЭКГ"]);
assert.ok(!oldActive.conversation_history.some((m) => m.role === "summary"));
r = await api(oldToken, "POST", "/patients/pat_555_1/start");
r = await api(oldToken, "POST", "/patients/pat_555_1/message", { text: "Как сейчас самочувствие?" });
assert.equal(r.status, 200);
r = await api(oldToken, "POST", "/patients/new");
assert.equal(r.status, 200, "у подписчика нет лимита");
assert.equal(old.profile.onboarding_done, true, "старым пользователям анкета не показывается");
step("миграция: старый профиль, пациенты, тест и подписка перенесены из KV");

// Направление: без диагноза нельзя, с диагнозом — диагноз засчитывается
r = await api(oldToken, "POST", "/patients/pat_555_1/finish", { type: "referral", value: "гастроэнтеролог" });
assert.equal(r.status, 409);
r = await api(oldToken, "POST", "/patients/pat_555_1/finish", { type: "referral", value: "гастроэнтеролог", diagnosis: "Язва ДПК", treatment: "Омепразол до консультации" });
assert.equal(r.status, 200, JSON.stringify(r.data));
const referred = (await api(oldToken, "GET", "/patients/pat_555_1")).data.patient;
const lastCons = referred.consultations[referred.consultations.length - 1];
assert.equal(lastCons.diagnosis, "Язва ДПК");
assert.deepEqual(lastCons.referrals, ["гастроэнтеролог"]);
step("направление к специалисту: диагноз направления обязателен и сохраняется");

// Отказ от нового пациента убирает его из очереди
const fresh555 = await waitFor(async () => {
  const x = (await api(oldToken, "GET", "/me")).data;
  return x.patients.find((p) => p.status !== "closed" && !p.consultations);
}, "new patient for 555");
r = await api(oldToken, "POST", `/patients/${fresh555.id}/reject`);
assert.equal(r.status, 200);
assert.ok(!(await api(oldToken, "GET", "/me")).data.patients.some((p) => p.id === fresh555.id));
step("отказ от пациента: пациент исчезает из очереди");

// ---------------------------------------------------------------- вход по ссылке
r = await api(null, "POST", "/auth/login");
const code = r.data.code;
assert.ok(r.data.url.includes(`start=login_${code}`));
assert.equal(r.data.tg, `tg://resolve?domain=helpmedoctor_aibot&start=login_${code}`, "ссылка сразу в приложение Telegram");
assert.equal((await api(null, "GET", `/auth/poll?code=${code}`)).data.status, "pending");
await text(U, `/start login_${code}`);
await waitFor(() => sent(U).some((m) => m.text.includes("Вход подтверждён")), "login confirm");
const polled = (await api(null, "GET", `/auth/poll?code=${code}`)).data;
assert.equal(polled.status, "ok");
assert.equal((await api(polled.token, "GET", "/me")).data.profile.uid, U);
assert.equal((await api(null, "GET", `/auth/poll?code=${code}`)).data.status, "expired", "код одноразовый");
step("вход на сайт через бота: код подтверждается и одноразовый");

// ---------------------------------------------------------------- безопасность
assert.equal((await api(null, "GET", "/me")).status, 401);
assert.equal((await api("forged.token", "GET", "/me")).status, 401);
assert.equal((await api(null, "POST", "/auth/telegram", { initData: initData(U).replace(/hash=\w+/, "hash=deadbeef") })).status, 401);
assert.equal((await api(webToken, "GET", "/patients/pat_555_1")).status, 409, "чужой пациент недоступен");
step("безопасность: без токена, с поддельным токеном и чужими данными — отказ");

// ---------------------------------------------------------------- подарок подписки и ошибка оплаты
await text("1326867567", "/grant @U777 7");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Подписка выдана") && m.text.includes("777")), "grant admin");
await waitFor(() => sent(U).some((m) => m.text.includes("Вам подарок") && m.text.includes("7 дней")), "grant user");
me = (await api(webToken, "GET", "/me")).data;
assert.equal(me.profile.has_sub, true);
assert.ok(me.profile.sub_until > Date.now() + 6.9 * 86400000);
await text("1326867567", "/grant @nobody_here 7");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("не найден")), "grant unknown");
await text(U, "/grant @U777 30");
await sleep(500);
assert.ok(!sent(U).some((m) => m.text.includes("Подписка выдана")), "не-админ не может выдавать подписку");
step("админ: /grant @username 7 — подписка выдана, пользователь уведомлён");

r = await api(webToken, "POST", "/pay", { plan: "week", consent: true });
assert.equal(r.status, 502);
assert.equal(r.data.code, "payment");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Оплата не создана")), "admin payment error");
step("оплата: ошибка банка — понятный ответ пользователю, подробности админу");


// ---------------------------------------------------------------- веб-админка /admin
async function adm(token, method, path, body) {
  const r = await fetch(`${BASE}/api/admin${path}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() };
}
assert.equal((await adm(null, "POST", "/auth/telegram", { initData: initData(U) })).status, 403, "не-админ не входит в админку");
assert.equal((await adm(webToken, "GET", "/me")).status, 401, "токен пользователя не подходит для админки");
const admTok = (await adm(null, "POST", "/auth/telegram", { initData: initData("1326867567") })).data.token;
const admTok2 = (await adm(null, "POST", "/auth/telegram", { initData: initData("1062804986") })).data.token;
assert.ok(admTok && admTok2);
const aq = async (op, args = {}, tok = admTok) => {
  const r = await adm(tok, "POST", "/q", { op, args });
  assert.equal(r.status, 200, `${op}: ${JSON.stringify(r.data)}`);
  return r.data;
};
assert.equal((await adm(admTok, "POST", "/q", { op: "set_setting", args: { k: "x", v: 1 } })).status, 400, "внутренние операции закрыты");
const meAdm = (await adm(admTok, "GET", "/me")).data;
assert.equal(meAdm.me.name, "Олег");
assert.equal(meAdm.admins.length, 2);
const al = await adm(null, "POST", "/auth/login");
assert.ok(al.data.code.startsWith("adm-") && al.data.tg.startsWith("tg://resolve?domain="));
await text(U, `/start login_${al.data.code}`);
await waitFor(() => sent(U).filter((m) => m.text.includes("Вход подтверждён")).length >= 2, "admin login confirm by non-admin");
assert.equal((await adm(null, "GET", `/auth/poll?code=${al.data.code}`)).status, 403, "не-админ не входит в админку через бота");
const al2 = await adm(null, "POST", "/auth/login");
await text("1062804986", `/start login_${al2.data.code}`);
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Вход подтверждён")), "admin login confirm");
const ap = await adm(null, "GET", `/auth/poll?code=${al2.data.code}`);
assert.equal(ap.data.status, "ok");
assert.equal((await adm(ap.data.token, "GET", "/me")).data.me.name, "Саша");
step("админка: вход только для Олега и Саши, внутренние операции закрыты");

// ---------------------------------------------------------------- автопродление, отмена, разовые покупки
const beforeRenew = (await api(webToken, "GET", "/me")).data.profile;
const run = await aq("autopay_run", { now: beforeRenew.autopay.next_at + 1000 });
assert.ok(run.charged >= 1, JSON.stringify(run));
const charge = tgCalls().filter((c) => c.method === `tochka POST /uapi/acquiring/v1.0/subscriptions/${trialOp}/charge`);
assert.equal(charge.length, 1);
assert.equal(charge[0].amount, 249);
let afterRenew = (await api(webToken, "GET", "/me")).data.profile;
assert.ok(afterRenew.sub_until >= beforeRenew.autopay.next_at + 29 * 86400000, "продлено на месяц");
assert.equal(afterRenew.autopay.trial, false);
await waitFor(() => sent(U).some((m) => m.text.includes("Подписка продлена")), "renew message");
assert.equal((await aq("autopay_run", { now: beforeRenew.autopay.next_at + 2000 })).charged, 0, "повторно не списываем");
r = await api(webToken, "POST", "/autopay/cancel");
assert.equal(r.data.profile.autopay.status, "cancelled");
assert.ok(tgCalls().some((c) => c.method === `tochka POST /uapi/acquiring/v1.0/subscriptions/${trialOp}/status` && c.status === "Cancelled"), "подписка отключена в Точке");
assert.equal((await aq("autopay_run", { now: afterRenew.sub_until + 1000 })).charged, 0, "после отмены не списываем");
step("автопродление: списание по сохранённой карте, продление на месяц, отмена пользователем");

const P2 = "902";
const t2 = await login(P2);
await api(t2, "PATCH", "/profile", { level: "student", profession: "Терапевт", specializations: ["гастроэнтерология"], onboarding_done: true });
await api(t2, "POST", "/patients/new");
await waitFor(async () => (await api(t2, "GET", "/me")).data.patients.length === 1, "p2 first patient");
assert.equal((await api(t2, "GET", "/me")).data.profile.can_accept, false);
r = await api(t2, "POST", "/pay", { plan: "patients3", consent: true });
const packOp = r.data.link.split("/").pop();
assert.equal(tgCalls().find((c) => c.method === "tochka POST /uapi/acquiring/v1.0/payments" && c.consumerId === P2).amount, "39.00");
await fetch(`${BASE}/payment-callback`, { method: "POST", body: JSON.stringify({ operationId: packOp }) });
let p2 = (await api(t2, "GET", "/me")).data.profile;
assert.equal(p2.patient_credits, 3);
assert.equal(p2.can_accept, true);
assert.equal(p2.premium, false, "покупка пациентов не даёт премиум");
await api(t2, "POST", "/patients/new");
await waitFor(async () => (await api(t2, "GET", "/me")).data.patients.length === 2, "p2 second patient");
assert.equal((await api(t2, "GET", "/me")).data.profile.patient_credits, 2);
r = await api(t2, "POST", "/pay", { plan: "freeze", consent: true });
await fetch(`${BASE}/payment-callback`, { method: "POST", body: JSON.stringify({ operationId: r.data.link.split("/").pop() }) });
assert.equal((await api(t2, "GET", "/me")).data.profile.streak_freezes, 1);
step("разовые покупки: +3 пациента сверх лимита (39 ₽), заморозка стрика");

const nowTs = Date.now(), per = { from: nowTs - 30 * 86400000, to: nowTs + 60000 };
const dash = await aq("dashboard", per);
assert.ok(dash.tiles && dash.funnel?.steps?.length >= 3, JSON.stringify(dash).slice(0, 300));
for (const name of ["retention", "consultations", "quality", "procedures", "specialties", "quizzes", "gamification", "money", "ai", "channels", "heatmap", "errors"]) {
  await aq("report", { name, ...per });
}
const aiRep = await aq("report", { name: "ai", ...per });
assert.ok(JSON.stringify(aiRep).includes("neurons"), "расход ИИ в нейронах");
const list = await aq("users", { filter: { q: "777" }, sort: "last_active", limit: 10 });
assert.ok(list.rows.some((u) => String(u.uid) === U));
assert.ok((await aq("users", { filter: { q: "анна" } })).rows.some((u) => String(u.uid) === "555"), "поиск по кириллице без учёта регистра");
step("админка: дашборд, 12 отчётов (включая расход ИИ), поиск пользователей");

const card = await adm(admTok, "GET", `/user/${U}`);
assert.equal(card.status, 200);
let chat = (await aq("chat", { uid: U, limit: 2000 })).rows;
assert.ok(chat.some((c) => c.dir === "in" && c.kind === "command" && c.text === "/start"), "входящая команда в переписке");
assert.ok(chat.some((c) => c.dir === "in" && c.kind === "button"), "нажатия кнопок в переписке");
assert.ok(chat.some((c) => c.dir === "out" && c.text.includes("Добро пожаловать")), "ответы бота в переписке");
const pidAdm = card.data.view.patients[0].id;
const patAdm = await adm(admTok, "GET", `/user/${U}/patient/${pidAdm}`);
assert.equal(patAdm.status, 200);
assert.ok(patAdm.data.patient.true_diagnosis, "админ видит скрытый диагноз");
step("админка: карточка пользователя, полная переписка с ботом, полный приём пациента");

let act = await adm(admTok, "POST", `/user/${U}/action`, { action: "cancel" });
assert.equal(act.status, 200, JSON.stringify(act.data));
assert.equal((await api(webToken, "GET", "/me")).data.profile.has_sub, false);
act = await adm(admTok, "POST", `/user/${U}/action`, { action: "grant", days: 30, reason: "тест", text: "Держите **месяц**" });
assert.equal(act.status, 200, JSON.stringify(act.data));
await waitFor(() => sent(U).some((m) => m.text.includes("<b>месяц</b>")), "grant text");
await waitFor(() => sent("1062804986").some((m) => m.text.includes("выдал(а) подписку")), "other admin notified");
me = (await api(webToken, "GET", "/me")).data;
assert.ok(me.profile.has_sub && me.profile.sub_until > Date.now() + 29 * 86400000);
act = await adm(admTok, "POST", `/user/${U}/action`, { action: "extra", n: 2 });
assert.equal(act.status, 200, JSON.stringify(act.data));
act = await adm(admTok, "POST", `/user/${U}/action`, { action: "block" });
assert.equal(act.status, 200);
assert.equal((await api(webToken, "POST", "/patients/request")).status >= 400, true, "заблокированный не берёт пациентов");
act = await adm(admTok, "POST", `/user/${U}/action`, { action: "unblock" });
assert.equal(act.status, 200);
step("админка: подписка кнопкой (выдать/отменить), доп. пациенты, блокировка");

const msgR = await adm(admTok, "POST", `/user/${U}/message`, { text: "Привет от **команды**", buttons: [{ type: "url", text: "Сайт", url: "https://example.com" }] });
assert.equal(msgR.status, 200, JSON.stringify(msgR.data));
assert.equal(msgR.data.ok, true);
await waitFor(() => sent(U).some((m) => m.text.includes("Привет от <b>команды</b>")), "admin message");
chat = (await aq("chat", { uid: U, limit: 2000 })).rows;
const outAdm = chat.find((c) => c.kind === "admin" && c.text.includes("Привет от"));
assert.ok(outAdm && outAdm.admin === "1326867567", "сообщение админа в переписке с автором");
await tgUpdate(U, { message: { message_id: updateId, from: from(U), chat: { id: Number(U), type: "private" }, date: 1, text: "Спасибо, всё супер", reply_to_message: { message_id: outAdm.tg_mid } } });
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Ответ пользователя") && m.text.includes("всё супер")), "reply routed");
await waitFor(() => sent(U).some((m) => m.text.includes("Передали команде")), "reply ack");
chat = (await aq("chat", { uid: U, limit: 2000 })).rows;
assert.ok(chat.some((c) => c.dir === "in" && c.kind === "reply" && c.text.includes("всё супер")));
const inbox = await aq("inbox");
assert.ok(inbox.rows.some((r) => String(r.uid) === U));
step("админка: сообщение от имени бота, ответ пользователя уходит админам, а не пациенту");

const segCount = await aq("segment_count", { filter: { uids: [U] } });
assert.equal(segCount.count, 1);
const bc = await aq("broadcast_create", { title: "Тест", text: "Новый **кейс** для {имя}", filter: { uids: [U] }, buttons: [{ type: "new", text: "Взять пациента" }] });
const bcDone = await waitFor(async () => { const b = await aq("broadcast", { id: bc.id }); return b?.status === "done" && b; }, "broadcast done", 20000);
assert.equal(bcDone.stats.sent, 1, JSON.stringify(bcDone.stats));
const bcMsg = await waitFor(() => sent(U).find((m) => m.text.includes("Новый <b>кейс</b>")), "broadcast delivered");
assert.ok(!bcMsg.text.includes("{имя}"), "подстановка имени");
await press(U, `bc:${bc.id}:new`);
await waitFor(async () => (await aq("broadcast", { id: bc.id })).stats?.clicked === 1, "broadcast click");
step("админка: рассылка по сегменту, подстановки, клики по кнопке считаются");

const t = await aq("task_create", { title: "Проверить отчёты", assignee: "1062804986", priority: "high" });
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Проверить отчёты")), "task assignee notified");
await aq("task_update", { id: t.id, patch: { status: "doing" } }, admTok2);
const tfull = await aq("task_comment", { id: t.id, text: "Взял" }, admTok2);
assert.equal(tfull.status, "doing");
assert.equal(tfull.comments_list.length, 1);
assert.ok(tfull.history.length >= 1);
await text("1062804986", "/idea Добавить тёмную тему в тест");
await waitFor(() => sent("1062804986").some((m) => m.text.includes("записана в бэклог")), "idea");
const tasksAll = await aq("tasks", {});
const imported = tasksAll.rows.filter((x) => x.labels.includes("созвон 24.09"));
assert.equal(imported.length, 19, "задачи созвона 24.09 импортированы");
assert.ok(imported.some((x) => x.assignee === "1062804986" && x.title.includes("паспортные данные")));
assert.equal((await aq("tasks", {})).rows.filter((x) => x.labels.includes("созвон 24.09")).length, 19, "импорт не дублируется");
assert.ok(tasksAll.rows.some((x) => x.title.includes("тёмную тему") && x.status === "idea"));
await aq("task_delete", { id: t.id });
const upd = tasksAll.rows.filter((x) => x.labels.includes("обновление 25.09"));
assert.equal(upd.length, 6, "сделанное 25.09 добавлено в трекер");
assert.equal(tasksAll.rows.find((x) => x.title.startsWith("Предлагать оставить отзыв")).status, "done", "выполненные задачи закрыты");
step("админка: задачи — создание, назначение с уведомлением, комментарии, история, /idea из бота, закрытие сделанного");

const np = await aq("notify_save", { prefs: { new_user: false } }, admTok2);
assert.equal(np.prefs.new_user, false);
const before2 = sent("1062804986").length;
await text("888", "/start");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("888")), "new user to oleg", 20000);
await sleep(500);
assert.ok(!sent("1062804986").slice(before2).some((m) => m.text.includes("888") && m.text.includes("Новый")), "Саша отключил уведомления о новых");
const audit = await aq("audit_log");
for (const a of ["grant", "cancel", "extra", "block", "message"]) assert.ok(audit.rows.some((r) => r.action === a), `audit ${a}`);
step("админка: личные настройки уведомлений, журнал действий админов");

// ---------------------------------------------------------------- аватар, переход из мини-приложения, удаление
const tgAv = await waitFor(async () => (await api(webToken, "GET", "/me")).data.profile.avatar, "avatar from telegram");
assert.equal(tgAv.src, "tg");
let av = await fetch(`${BASE}/api/avatar/${tgAv.id}`);
assert.equal(av.status, 200);
assert.ok((await av.arrayBuffer()).byteLength > 0);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
av = await fetch(`${BASE}/api/avatar`, { method: "POST", headers: { Authorization: `Bearer ${webToken}`, "Content-Type": "image/jpeg" }, body: jpeg });
const avUp = await av.json();
assert.equal(avUp.profile.avatar.src, "custom", JSON.stringify(avUp));
assert.equal((await fetch(`${BASE}/api/avatar/${tgAv.id}`)).status, 404, "старое фото удалено");
assert.equal((await fetch(`${BASE}/api/avatar`, { method: "POST", headers: { Authorization: `Bearer ${webToken}`, "Content-Type": "text/plain" }, body: "x" })).status, 409);
r = await api(webToken, "DELETE", "/avatar");
assert.equal(r.data.profile.avatar, null);
assert.equal(r.data.profile.avatar_off, true);
r = await api(webToken, "POST", "/avatar/telegram");
assert.equal(r.data.profile.avatar.src, "tg");
step("аватар: фото из Telegram, своё фото, удаление, снова из Telegram");

r = await api(webToken, "POST", "/auth/handoff");
const hoCode = new URL(r.data.url).searchParams.get("login");
assert.ok(hoCode);
const ho = (await api(null, "GET", `/auth/poll?code=${hoCode}`)).data;
assert.equal(ho.status, "ok");
assert.equal((await api(ho.token, "GET", "/me")).data.profile.uid, U, "вход на сайт тем же пользователем");
assert.notEqual((await api(null, "GET", `/auth/poll?code=${hoCode}`)).data.status, "ok", "код одноразовый");
step("мини-приложение → сайт: вход по одноразовому коду");

r = await api(webToken, "DELETE", `/quiz/${patId}`);
assert.equal(r.status, 200);
me = (await api(webToken, "GET", "/me")).data;
assert.ok(!me.quizzes.some((q) => q.pat_id === patId), "тест удалён");
assert.equal((await api(webToken, "GET", `/quiz/${patId}`)).status, 409);
const xpBefore = me.profile.xp;
r = await api(webToken, "DELETE", `/patients/${patId}`);
assert.equal(r.status, 200);
me = (await api(webToken, "GET", "/me")).data;
assert.ok(!me.patients.some((x) => x.id === patId), "пациент удалён");
assert.equal(me.profile.xp, xpBefore, "опыт сохранён");
assert.equal((await api(webToken, "DELETE", `/patients/${patId}`)).status, 409);
assert.equal((await api(oldToken, "DELETE", `/patients/${patId}`)).status, 409, "чужого пациента не удалить");
step("удаление: тест и пациент удаляются, опыт остаётся, чужое не удалить");


// ---------------------------------------------------------------- Google / Яндекс и привязка Telegram
const CN = "e2ebrowsernonce";
async function oauth(provider, { mode = "login", token = null, code = null, cookie: withCookie = true } = {}) {
  const r = await fetch(`${BASE}/api/auth/oauth/start`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ provider, mode, from: "e2e", cn: CN }),
  });
  assert.equal(r.status, 200, await r.clone().text());
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^hmd_oa=/);
  const u = new URL((await r.json()).url);
  if (code) u.searchParams.set("code", code);
  const cb = await fetch(`${BASE}${u.pathname}${u.search}`, { headers: withCookie ? { Cookie: cookie } : {}, redirect: "manual" });
  assert.equal(cb.status, 302);
  return new URL(cb.headers.get("location"), BASE);
}
async function oauthLogin(provider, code) {
  const loc = await oauth(provider, { code });
  const lc = loc.searchParams.get("login");
  assert.ok(lc, loc.toString());
  // Код после Google/Яндекса привязан к браузеру: без его nonce (чужая ссылка ?login=) — не отдаётся
  assert.equal((await api(null, "GET", `/auth/poll?code=${lc}`)).data.status, "expired");
  assert.equal((await api(null, "GET", `/auth/poll?code=${lc}&cn=other`)).data.status, "expired");
  const p = (await api(null, "GET", `/auth/poll?code=${lc}&cn=${CN}`)).data;
  assert.equal(p.status, "ok");
  return p.token;
}

assert.deepEqual((await api(null, "GET", "/config")).data.providers, ["google", "yandex"]);
assert.equal((await oauth("google", { cookie: false })).searchParams.get("auth_error"), "state", "без cookie — отказ (CSRF)");
const g1 = await oauthLogin("google", "test:g-anna:anna@example.com:Анна");
let gme = (await api(g1, "GET", "/me")).data;
assert.match(gme.profile.uid, /^w\d{12}$/);
assert.equal(gme.profile.name, "Анна");
const W1 = gme.profile.uid;
assert.equal((await api(await oauthLogin("google", "test:g-anna:anna@example.com:Анна"), "GET", "/me")).data.profile.uid, W1, "повторный вход — тот же аккаунт");
let acc = (await api(g1, "GET", "/accounts")).data;
assert.equal(acc.telegram, false);
assert.deepEqual(acc.identities.map((i) => [i.provider, i.email]), [["google", "anna@example.com"]]);
assert.equal((await api(g1, "DELETE", "/accounts/google")).status, 409, "единственный способ входа не отвязать");
assert.equal((await oauth("yandex", { mode: "link", token: g1, code: "test:y-anna:anna@yandex.ru:Анна" })).searchParams.get("linked"), "yandex");
acc = (await api(g1, "GET", "/accounts")).data;
assert.deepEqual(acc.identities.map((i) => i.provider).sort(), ["google", "yandex"]);
const g2 = await oauthLogin("google", "test:g-boris:boris@example.com:Борис");
const W2 = (await api(g2, "GET", "/me")).data.profile.uid;
assert.notEqual(W2, W1);
assert.equal((await oauth("google", { mode: "link", token: g1, code: "test:g-boris:boris@example.com:Борис" })).searchParams.get("link_error"), "taken", "чужой Google не привязать");
const g1b = await oauthLogin("google", "test:g-anna:anna@example.com:Анна");
assert.equal((await api(g1b, "DELETE", "/accounts/yandex")).status, 200, "два способа — один можно отвязать");
assert.equal((await api(g1b, "DELETE", "/accounts/google")).status, 409, "последний — нельзя");
assert.equal((await oauth("yandex", { mode: "link", token: g1b, code: "test:y-anna:anna@yandex.ru:Анна" })).searchParams.get("linked"), "yandex");
step("вход через Google и Яндекс: новый веб-аккаунт, повторный вход, привязка и отвязка, защита от CSRF, подмены ссылки входа и чужих аккаунтов");

// Веб-аккаунт с прогрессом привязывает новый Telegram — всё переезжает
await api(g1, "PATCH", "/profile", { level: "student", profession: "Терапевт", specializations: ["гастроэнтерология"], onboarding_done: true });
await api(g1, "POST", "/patients/new");
await waitFor(async () => (await api(g1, "GET", "/me")).data.patients.length === 1, "web patient");
const webPat = (await api(g1, "GET", "/me")).data.patients[0].id;
assert.ok(!sent(W1).length, "аккаунту без Telegram бот не пишет");
r = await api(g1, "POST", "/auth/link-telegram");
const linkCode = r.data.code;
assert.ok(r.data.url.includes(`start=link_${linkCode}`));
assert.equal((await api(g2, "GET", `/auth/link-telegram/poll?code=${linkCode}`)).data.status, "expired", "чужой код привязки не забрать");
assert.equal((await api(null, "GET", `/auth/poll?code=${linkCode}`)).data.status, "expired", "код привязки не годится для входа");
const TG1 = "4401";
await text(TG1, `/start link_${linkCode}`);
const ask = await waitFor(() => sent(TG1).find((m) => m.text.includes("Привязать этот Telegram")), "link ask");
assert.ok(ask.text.includes("anna@example.com"), "бот показывает, к какому аккаунту привязка");
assert.equal((await api(g1, "GET", `/auth/link-telegram/poll?code=${linkCode}`)).data.status, "pending", "без подтверждения в боте — ждём");
await press(TG1, `lk_${linkCode}`);
await waitFor(() => sent(TG1).some((m) => m.text.includes("Telegram привязан")), "link confirmed");
r = (await api(g1, "GET", `/auth/link-telegram/poll?code=${linkCode}`)).data;
assert.equal(r.status, "ok");
gme = (await api(r.token, "GET", "/me")).data;
assert.equal(gme.profile.uid, TG1);
assert.equal(gme.profile.name, "Анна", "профиль сайта заменил пустой профиль бота");
assert.ok(gme.patients.some((x) => x.id === webPat), "пациент переехал");
assert.equal((await api(g1, "GET", "/me")).data.profile.uid, TG1, "старая сессия ведёт в объединённый аккаунт");
assert.equal((await api(r.token, "GET", `/auth/link-telegram/poll?code=${linkCode}`)).data.status, "expired", "код привязки удалён после склейки");
assert.equal((await api(await oauthLogin("yandex", "test:y-anna:anna@yandex.ru:Анна"), "GET", "/me")).data.profile.uid, TG1, "вход через Яндекс — в объединённый аккаунт");
acc = (await api(r.token, "GET", "/accounts")).data;
assert.equal(acc.telegram, true);
assert.equal(acc.identities.length, 2);
assert.equal((await api(r.token, "POST", "/auth/link-telegram")).status, 409);
assert.equal((await api(r.token, "DELETE", "/accounts/google")).status, 200, "с Telegram можно отвязать Google");
step("привязка Telegram: подтверждение в боте, перенос пациентов, старые сессии и Яндекс ведут в объединённый аккаунт");

// Веб-аккаунт привязывает Telegram, где уже есть прогресс — прогресс складывается
const before777 = (await api(webToken, "GET", "/me")).data;
await api(g2, "PATCH", "/profile", { onboarding_done: true });
r = await api(g2, "POST", "/auth/link-telegram");
await text(U, `/start link_${r.data.code}`);
await waitFor(() => sent(U).some((m) => m.text.includes("boris@example.com")), "link ask 777");
await press(U, `lk_${r.data.code}`);
await waitFor(async () => (await api(g2, "GET", `/auth/link-telegram/poll?code=${r.data.code}`)).data.status === "ok", "merge 777");
const after777 = (await api(webToken, "GET", "/me")).data;
assert.equal(after777.profile.name, before777.profile.name, "имя Telegram-профиля осталось");
assert.equal(after777.profile.stats.consultations_total, before777.profile.stats.consultations_total);
assert.equal(after777.patients.length, before777.patients.length);
assert.equal((await api(g2, "GET", "/me")).data.profile.uid, U);
step("привязка к Telegram с прогрессом: данные складываются, ничего не теряется");

// ---------------------------------------------------------------- админка и cron
await text("1326867567", "/admin");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("дашборд")), "admin");
await text("1062804986", "/admin");
await waitFor(() => sent("1062804986").some((m) => m.text.includes("дашборд")), "second admin");
const cron = await fetch(`${BASE}/__scheduled?cron=0+17+*+*+*`);
assert.equal(cron.status, 200);
assert.equal((await fetch(`${BASE}/__scheduled?cron=0+7+*+*+*`)).status, 200);
step("админка и cron отвечают");

ws.close();
console.log("\nВсе проверки пройдены ✅");
