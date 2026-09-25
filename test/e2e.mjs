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
await waitFor(() => sent(U).some((m) => m.text.includes("На каком вы курсе")), "onboarding q2");
await text(U, "4 курс, Сеченовский");
await waitFor(() => sent(U).some((m) => m.text.includes("Чего вы ждёте")), "onboarding q3");
await text(U, "Хочу научиться ставить диагноз");
await waitFor(() => sent(U).some((m) => m.text.includes("Спасибо!") && m.text.includes("Студент")), "onboarding done");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Анкета") && m.text.includes("4 курс")), "admin onboarding");
step("бот: анкета (кто вы, где учитесь, ожидания) сохраняется, админ получает ответы");

await press(U, "new");
const ready = await waitFor(() => sent(U).find((m) => m.text.includes("Новый пациент готов")), "new patient");
const patId = ready.reply_markup.inline_keyboard[0][0].callback_data.slice(3);
assert.match(patId, /^pat_777_/);
step("бот: пациент создаётся через очередь (alarm) и приходит сообщением");

await press(U, `sp_${patId}`);
await waitFor(() => sent(U).some((m) => m.text.includes("Мирон") && m.text.includes("живот крутит")), "opening phrase");
step("бот: приём начат, пациент говорит первую фразу");

// Одновременно открываем сайт — должен видеть тот же приём
const webToken = await login(U);
let me = (await api(webToken, "GET", "/me")).data;
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

await press(U, "end_dx");
await waitFor(() => sent(U).some((m) => m.text.includes("Введите диагноз")), "dx prompt");
await text(U, "Язвенная болезнь ДПК");
await waitFor(() => sent(U).some((m) => m.text.includes("Назначьте лечение")), "treatment prompt");
await text(U, "Омепразол 20 мг 2 раза, амоксициллин, кларитромицин 14 дней");
await waitFor(() => sent(U).some((m) => m.text.includes("ПРИЁМ ЗАВЕРШЁН")), "finish");
const evalMsg = await waitFor(() => sent(U).find((m) => m.text.includes("Разбор приёма")), "evaluation");
assert.ok(evalMsg.text.includes("4.2"));
step("бот: диагноз + лечение → завершение → разбор эксперта");

me = (await api(webToken, "GET", "/me")).data;
const closed = me.patients.find((p) => p.id === patId);
assert.equal(closed.status, "closed");
assert.equal(closed.last_rating, 4.2);
assert.ok(me.profile.xp > 0);
assert.equal(me.profile.stats.consultations_total, 1);
assert.equal(me.profile.streak, 1);
step("сайт: оценка, XP и стрик уже видны");

const quiz = await waitFor(async () => (await api(webToken, "GET", `/quiz/${patId}`)).data.quiz, "quiz");
assert.equal(quiz.total, 5);
assert.equal(quiz.questions[0].correct, undefined, "правильный ответ не раскрыт заранее");
await press(U, `qa_${patId}_0_0`);
await waitFor(() => tgCalls().some((c) => c.method === "editMessageText" && c.text?.includes("Верно")), "quiz feedback");
r = await api(webToken, "POST", `/quiz/${patId}/answer`, { index: 1, chosen: 2 });
assert.equal(r.data.is_correct, false);
r = await api(webToken, "POST", `/quiz/${patId}/answer`, { index: 1, chosen: 0 });
assert.equal(r.data.stale, true, "повторный ответ на тот же вопрос игнорируется");
step("тест: вопросы в боте и на сайте — общий прогресс, без двойных ответов");

// Лимит бесплатного тарифа
r = await api(webToken, "POST", "/patients/new");
assert.equal(r.status, 409);
assert.equal(r.data.code, "limit");
step("лимит: второй бесплатный пациент за день запрещён");

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

r = await api(webToken, "POST", "/pay", { plan: "week" });
assert.equal(r.status, 502);
assert.equal(r.data.code, "payment");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("Оплата не создана")), "admin payment error");
step("оплата: ошибка банка — понятный ответ пользователю, подробности админу");

// ---------------------------------------------------------------- админка и cron
await text("1326867567", "/admin");
await waitFor(() => sent("1326867567").some((m) => m.text.includes("дашборд")), "admin");
const cron = await fetch(`${BASE}/__scheduled?cron=0+17+*+*+*`);
assert.equal(cron.status, 200);
assert.equal((await fetch(`${BASE}/__scheduled?cron=0+7+*+*+*`)).status, 200);
step("админка и cron отвечают");

ws.close();
console.log("\nВсе проверки пройдены ✅");
