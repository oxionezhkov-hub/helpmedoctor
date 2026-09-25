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
await waitFor(() => sent("1062804986").some((m) => m.text.includes("Анкета") && m.text.includes("4 курс")), "second admin onboarding");
step("бот: анкета (кто вы, где учитесь, ожидания) сохраняется, оба админа получают ответы");

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
step("админка: вход только для Олега и Саши, внутренние операции закрыты");

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
step("админка: задачи — создание, назначение с уведомлением, комментарии, история, /idea из бота");

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
