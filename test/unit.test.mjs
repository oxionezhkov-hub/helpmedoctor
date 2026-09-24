// Юнит-тесты чистых функций: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose } from "../src/lib/ai.js";
import * as G from "../src/lib/game.js";
import { daysBetween, mskDate, UserError, userError } from "../src/lib/util.js";
import { webhookOperationId, planFromPurpose } from "../src/lib/tochka.js";

test("parseJsonLoose достаёт JSON из болтовни модели", () => {
  assert.deepEqual(parseJsonLoose('Вот:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('{"b":[1,2]}'), { b: [1, 2] });
  assert.throws(() => parseJsonLoose("нет json"));
});

test("уровни и XP", () => {
  assert.equal(G.levelInfo(0).level, 1);
  assert.equal(G.levelInfo(100).level, 2);
  assert.equal(G.levelInfo(99).level, 1);
  assert.equal(G.streakBonus(14), 0.2);
  assert.equal(G.streakBonus(100), 0.5);
});

test("стрик по московским дням", () => {
  const p = G.newProfile("1");
  const day = Date.parse("2026-09-20T10:00:00Z");
  G.applyStreak(p, day);
  assert.equal(p.streak, 1);
  G.applyStreak(p, day + 3600e3);
  assert.equal(p.streak, 1, "в тот же день не растёт");
  G.applyStreak(p, day + 86400e3);
  assert.equal(p.streak, 2);
  G.applyStreak(p, day + 4 * 86400e3);
  assert.equal(p.streak, 1);
  assert.equal(p.streak_before_break, 2);
});

test("лимит бесплатных пациентов и подписка", () => {
  const p = G.newProfile("1");
  assert.equal(G.canAcceptPatient(p), true);
  p.daily_patients = [Date.now()];
  assert.equal(G.canAcceptPatient(p), false);
  p.sub_until = -1;
  assert.equal(G.canAcceptPatient(p), true);
  p.sub_until = Date.now() - 1;
  assert.equal(G.canAcceptPatient(p), false);
});

test("задание дня засчитывается", () => {
  const p = G.newProfile("1");
  G.ensureDailyTask(p);
  p.daily_task = { ...p.daily_task, type: "tests_per_consult", target: 2, xp: 30, progress: 0, done: false };
  const facts = { tests: ["КТ", "МРТ"], physicals: [], diagnosis: null, treatment: null, referrals: [], doctorMessages: [], isAlien: false };
  assert.equal(G.applyDailyTask(p, facts, 3), true);
  assert.equal(p.xp, 30);
  assert.equal(G.applyDailyTask(p, facts, 3), false, "повторно не даёт XP");
});

test("даты по Москве", () => {
  assert.equal(mskDate(Date.parse("2026-09-24T21:30:00Z")), "2026-09-25");
  assert.equal(daysBetween("2026-09-24", "2026-09-25"), 1);
  assert.equal(daysBetween(null, "2026-09-25"), Infinity);
});

test("UserError переживает RPC (только message)", () => {
  const e = new Error(new UserError("Лимит", "limit").message);
  assert.deepEqual(userError(e), { code: "limit", message: "Лимит" });
  assert.equal(userError(new Error("boom")), null);
});

test("вебхук Точки: operationId из JWT и JSON", () => {
  const jwt = ["x", Buffer.from(JSON.stringify({ operationId: "op1" })).toString("base64url"), "y"].join(".");
  assert.equal(webhookOperationId(jwt), "op1");
  assert.equal(webhookOperationId('{"operationId":"op2"}'), "op2");
  assert.equal(planFromPurpose("HelpMeDoctor uid1: 1 неделя"), "week");
  assert.equal(planFromPurpose("… Навсегда"), "forever");
});

test("анкета: новым — показываем, старым из KV — нет", () => {
  assert.equal(G.newProfile("1").onboarding_done, false);
  assert.equal(G.normalizeProfile({ uid: "2", name: "Анна" }).onboarding_done, true);
});

test("просьба об отзыве: через 2 дня, один раз и только активным", () => {
  const now = Date.parse("2026-09-24T07:00:00Z");
  const p = G.newProfile("1");
  p.registered_at = now - 1 * 86400000;
  p.last_active = now;
  assert.equal(G.shouldAskReview(p, now), false, "рано");
  p.registered_at = now - 2 * 86400000;
  assert.equal(G.shouldAskReview(p, now), true);
  p.last_active = now - 30 * 86400000;
  assert.equal(G.shouldAskReview(p, now), false, "давно не заходил");
  p.last_active = now;
  p.review_asked = true;
  assert.equal(G.shouldAskReview(p, now), false, "уже спрашивали");
});

test("обследования: метод определяет, какие данные можно показывать", async () => {
  const { methodKind } = await import("../src/lib/prompts.js");
  assert.equal(methodKind("УЗИ").kind, "imaging");
  assert.equal(methodKind("Эхо-КГ").kind, "imaging");
  assert.equal(methodKind("рентген кисти").kind, "imaging");
  assert.equal(methodKind("Анализ крови").kind, "lab");
  assert.equal(methodKind("Онкомаркеры").kind, "lab");
  assert.equal(methodKind("ЭКГ").kind, "ecg");
  assert.equal(methodKind("Биопсия").kind, "pathology");
});

test("из ответа ИИ убираются иероглифы", async () => {
  const { cleanText } = await import("../src/lib/ai.js");
  assert.equal(cleanText("как мы можем一起 работать."), "как мы можем работать.");
  assert.equal(cleanText("Норма: 3,3–5,5 ммоль/л"), "Норма: 3,3–5,5 ммоль/л");
});
