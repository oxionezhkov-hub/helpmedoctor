// Публикация постов в Telegram-канал от имени бота (Bot API).
// Посты лежат в content/telegram-channel/queue/*.json: массив сообщений по порядку.
// Сообщение: { text } — текст (HTML), { document, caption } — файл из репозитория с подписью,
// { quiz: { question, options, correct, explanation } } — викторина; у любого можно buttons: [[{ text, url }]] и pin: true.
// Запуск: TELEGRAM_TOKEN=… node scripts/tg-channel.mjs <файл.json> [--dry]
// В GitHub Actions — workflow «Telegram-канал» при пуше ветки tg/** (токен из секретов репозитория).
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [file, flag] = process.argv.slice(2);
const dry = flag === "--dry";
const token = process.env.TELEGRAM_TOKEN;
const chat = process.env.TG_CHANNEL || "@i_am_doctorrr";
if (!file) throw new Error("укажите файл с постами");
if (!token && !dry) throw new Error("нет TELEGRAM_TOKEN");
const posts = JSON.parse(readFileSync(file, "utf8"));

const ALLOWED = /^\/?(b|i|u|s|a|code|pre|blockquote|tg-spoiler)$/;
function check(p, i) {
  const text = p.text ?? p.caption ?? "";
  for (const [, tag] of text.matchAll(/<\s*(\/?[a-z-]+)[^>]*>/gi)) if (!ALLOWED.test(tag)) throw new Error(`пост ${i + 1}: тег <${tag}> Telegram не поддерживает`);
  const plain = text.replace(/<[^>]+>/g, "");
  if (p.text && plain.length > 4096) throw new Error(`пост ${i + 1}: ${plain.length} символов, лимит 4096`);
  if (p.caption && plain.length > 1024) throw new Error(`пост ${i + 1}: подпись ${plain.length} символов, лимит 1024`);
  if (p.quiz && (p.quiz.question.length > 300 || (p.quiz.explanation || "").length > 200 || p.quiz.options.some((o) => o.length > 100))) throw new Error(`пост ${i + 1}: викторина длиннее лимитов`);
}
posts.forEach(check);

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
const markup = (p) => (p.buttons ? { reply_markup: { inline_keyboard: p.buttons } } : {});

for (const [i, p] of posts.entries()) {
  const kind = p.quiz ? "викторина" : p.document ? `файл ${basename(p.document)}` : "текст";
  if (dry) { console.log(`${i + 1}. ${kind}${p.pin ? " + закреп" : ""}: ${(p.text || p.caption || p.quiz.question).replace(/<[^>]+>/g, "").slice(0, 70)}…`); continue; }
  let msg;
  if (p.quiz) {
    msg = await call("sendPoll", { chat_id: chat, type: "quiz", question: p.quiz.question, options: p.quiz.options.map((text) => ({ text })), correct_option_id: p.quiz.correct, explanation: p.quiz.explanation, is_anonymous: true, ...markup(p) });
  } else if (p.document) {
    const fd = new FormData();
    fd.set("chat_id", chat);
    fd.set("caption", p.caption || "");
    fd.set("parse_mode", "HTML");
    if (p.buttons) fd.set("reply_markup", JSON.stringify({ inline_keyboard: p.buttons }));
    fd.set("document", new Blob([readFileSync(p.document)], { type: "application/pdf" }), p.filename || basename(p.document));
    msg = await call("sendDocument", fd);
  } else {
    msg = await call("sendMessage", { chat_id: chat, text: p.text, parse_mode: "HTML", link_preview_options: { is_disabled: !p.preview }, ...markup(p) });
  }
  if (p.pin) await call("pinChatMessage", { chat_id: chat, message_id: msg.message_id, disable_notification: true });
  console.log(`${i + 1}. ${kind}: опубликовано, message_id ${msg.message_id}${p.pin ? ", закреплено" : ""}`);
  await new Promise((r) => setTimeout(r, 1500));
}
