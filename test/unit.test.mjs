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

test("из ответов ИИ убираются иероглифы и другие чужие письменности", async () => {
  const { stripForeignScripts: f } = await import("../src/lib/util.js");
  assert.equal(f("можем一起 работать"), "можем работать");
  assert.equal(f("Да，конечно。").trim(), "Да, конечно.");
  assert.equal(f("Пациент จะ жалуется"), "Пациент жалуется");
  assert.equal(f("β-блокатор, HbA1c 7%, t° 38,5 👋"), "β-блокатор, HbA1c 7%, t° 38,5 👋");
});

test("обследование: эндоскопия отдельно от КТ/УЗИ, находки не переносятся на другой орган", async () => {
  const { methodKind, testResultPrompt } = await import("../src/lib/prompts.js");
  assert.equal(methodKind("Фгдс").kind, "endoscopy");
  assert.equal(methodKind("Колоноскопия").kind, "endoscopy");
  assert.equal(methodKind("КТ").kind, "imaging");
  const pat = { name: "А", age: 40, sex: "female", chief_complaint: "", true_diagnosis: "Узловой зоб", findings: { imaging: "УЗИ щитовидной железы: узел 12 мм", endoscopy: "" } };
  const p = testResultPrompt(pat, "ФГДС").prompt;
  assert.ok(!p.includes("узел 12 мм"), "находки щитовидки не попадают в ФГДС");
  assert.ok(p.includes("НОРМУ именно этой области"));
  const old = { ...pat, true_diagnosis: "Язва ДПК", findings: { imaging: "ФГДС: язва 8 мм" } };
  assert.ok(testResultPrompt(old, "ФГДС").prompt.includes("язва 8 мм"), "старые пациенты: эндоскопия из визуализации");
});

test("сложность пациентов: выбранная или по роли", () => {
  assert.equal(G.complexityFor({ level: "студент", difficulty: "" }), "easy");
  assert.equal(G.complexityFor({ level: "студент", difficulty: "hard" }), "hard");
  assert.equal(G.complexityFor({ level: "врач", difficulty: "нет такой" }), "medium_hard");
});

test("страницы сайта пересобраны после изменений (node scripts/build-site.mjs)", async () => {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-"));
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { env: { ...process.env, SITE_OUT: dir } });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dir)) {
    const rel = path.relative(dir, f);
    assert.equal(fs.readFileSync(path.join("public", rel), "utf8"), fs.readFileSync(f, "utf8"), `public/${rel} устарел — запустите node scripts/build-site.mjs`);
  }
  fs.rmSync(dir, { recursive: true });
});

test("ИИ: модель по шагу — умолчания и настройка админки", async () => {
  const { modelFor } = await import("../src/lib/ai.js");
  assert.equal(modelFor("reply").key, "qwen3");
  assert.equal(modelFor("evaluation").key, "llama70");
  assert.equal(modelFor("reply", { reply: "llama70" }).key, "llama70");
  assert.equal(modelFor("reply", { reply: "нет такой" }).key, "qwen3", "неизвестная модель — умолчание");
});

test("ИИ: ответ в формате OpenAI и блок <think> у Qwen3", async () => {
  const { responseToText } = await import("../src/lib/ai.js");
  assert.equal(responseToText({ choices: [{ message: { content: "<think>\n\n</think>\n\nБолит справа." } }] }), "Болит справа.");
  assert.equal(responseToText({ response: "Просто текст" }), "Просто текст");
});

test("ИИ: лимит Cloudflare → запасной провайдер, затем сразу запасной", async () => {
  const { aiText, resetAiRoute } = await import("../src/lib/ai.js");
  resetAiRoute();
  const calls = { cf: 0, ext: [], blocked: 0, inputs: [] };
  const hubState = { cf_blocked: false };
  const hub = {
    aiRoute: async () => ({ routing: {}, cf_blocked: hubState.cf_blocked }),
    aiCfBlocked: async () => { calls.blocked++; hubState.cf_blocked = true; },
    logAi: async () => {},
  };
  const env = {
    AI: { run: async (model, input) => { calls.cf++; calls.inputs.push(input); throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons"); } },
    HUB: { idFromName: () => "hub", get: () => hub },
    CEREBRAS_API_KEY: "test-key",
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.ext.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: "«Болит второй день»" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  };
  try {
    assert.equal(await aiText(env, { prompt: "Где болит?", kind: "reply" }), "Болит второй день");
    assert.equal(calls.cf, 1, "при лимите Cloudflare не повторяем");
    assert.match(calls.inputs[0].messages.at(-1).content, /\/no_think$/, "Qwen3 без рассуждений");
    assert.equal(calls.blocked, 1);
    assert.equal(calls.ext[0].url, "https://api.cerebras.ai/v1/chat/completions");
    assert.equal(calls.ext[0].body.model, "gpt-oss-120b");
    await aiText(env, { prompt: "Ещё вопрос", kind: "reply" });
    assert.equal(calls.cf, 1, "до конца суток Cloudflare пропускаем");
    assert.equal(calls.ext.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    resetAiRoute();
  }
});

test("ИИ: без ключей запасного — ошибка Cloudflare пробрасывается", async () => {
  const { aiText, resetAiRoute } = await import("../src/lib/ai.js");
  resetAiRoute();
  const env = { AI: { run: async () => { throw new Error("4006: daily free allocation"); } } };
  await assert.rejects(aiText(env, { prompt: "x", kind: "reply" }), /4006/);
});
