// Публикация постов в Telegram-канал от имени бота (Bot API).
// Посты лежат в content/telegram-channel/queue/*.json: массив шагов по порядку.
// Шаги: { text } — текст (HTML); { photo, caption } — картинка из репозитория; { album: [файлы], caption } — карусель до 10 картинок;
// { document, caption } — файл; { quiz: { question, options, correct, explanation } } — викторина;
// { delete: [id…] } — удалить сообщения; { channel: { photo, description, title } } — оформить канал;
// { edit: id, photo?, caption?, buttons? } — заменить картинку и/или подпись уже опубликованного поста.
// У текста и картинки можно buttons: [[{ text, url }]] и pin: true (закреп; служебное «закреплено» удаляется).
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
  if (p.edit && !p.photo && !p.caption) throw new Error(`пост ${i + 1}: в правке нужна картинка или подпись`);
  for (const [, tag] of text.matchAll(/<\s*(\/?[a-z-]+)[^>]*>/gi)) if (!ALLOWED.test(tag)) throw new Error(`пост ${i + 1}: тег <${tag}> Telegram не поддерживает`);
  const plain = text.replace(/<[^>]+>/g, "");
  if (p.text && plain.length > 4096) throw new Error(`пост ${i + 1}: ${plain.length} символов, лимит 4096`);
  if (p.album && (p.album.length < 2 || p.album.length > 10)) throw new Error(`пост ${i + 1}: в карусели 2–10 картинок`);
  for (const f of [p.photo, p.document, ...(p.album || []), p.channel?.photo].filter(Boolean)) readFileSync(f);
  if (p.channel?.description && p.channel.description.length > 255) throw new Error(`пост ${i + 1}: описание канала длиннее 255 символов`);
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

const blob = (path, type = "image/jpeg") => new Blob([readFileSync(path)], { type });
const form = (fields) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v); return fd; };
const soft = async (what, fn) => { try { return await fn(); } catch (e) { console.warn(`⚠️ ${what}: ${e.message}`); return null; } };

for (const [i, p] of posts.entries()) {
  const kind = p.edit ? `правка ${p.edit}` : p.delete ? `удаление ${p.delete.length}` : p.channel ? "оформление канала" : p.quiz ? "викторина" : p.album ? `карусель ${p.album.length}` : p.photo ? "картинка" : p.document ? `файл ${basename(p.document)}` : "текст";
  if (dry) { console.log(`${i + 1}. ${kind}${p.pin ? " + закреп" : ""}${p.buttons ? ` + кнопок ${p.buttons.flat().length}` : ""}: ${String(p.text || p.caption || p.quiz?.question || "").replace(/<[^>]+>/g, "").slice(0, 60)}`); continue; }
  if (p.delete) {
    for (const id of p.delete) await soft(`удалить ${id}`, () => call("deleteMessage", { chat_id: chat, message_id: id }));
    console.log(`${i + 1}. удалены сообщения ${p.delete.join(", ")}`);
    continue;
  }
  if (p.channel) {
    if (p.channel.photo) await soft("фото канала", () => call("setChatPhoto", form({ chat_id: chat, photo: blob(p.channel.photo) })));
    if (p.channel.description) await soft("описание канала", () => call("setChatDescription", { chat_id: chat, description: p.channel.description }));
    if (p.channel.title) await soft("название канала", () => call("setChatTitle", { chat_id: chat, title: p.channel.title }));
    console.log(`${i + 1}. канал оформлен`);
    continue;
  }
  const kb = p.buttons ? JSON.stringify({ inline_keyboard: p.buttons }) : undefined;
  if (p.edit) {
    if (p.photo) {
      const fd = form({ chat_id: chat, message_id: String(p.edit), reply_markup: kb });
      fd.set("media", JSON.stringify({ type: "photo", media: "attach://p", ...(p.caption ? { caption: p.caption, parse_mode: "HTML" } : {}) }));
      fd.set("p", blob(p.photo), basename(p.photo));
      await soft(`картинка поста ${p.edit}`, () => call("editMessageMedia", fd));
    } else if (p.caption) {
      await soft(`подпись поста ${p.edit}`, () => call("editMessageCaption", { chat_id: chat, message_id: p.edit, caption: p.caption, parse_mode: "HTML", ...(kb ? { reply_markup: JSON.parse(kb) } : {}) }));
    }
    console.log(`${i + 1}. пост ${p.edit} исправлен`);
    await new Promise((r) => setTimeout(r, 1200));
    continue;
  }
  let msg;
  if (p.quiz) {
    msg = await call("sendPoll", { chat_id: chat, type: "quiz", question: p.quiz.question, options: p.quiz.options.map((text) => ({ text })), correct_option_id: p.quiz.correct, explanation: p.quiz.explanation, is_anonymous: true });
  } else if (p.album) {
    const fd = form({ chat_id: chat });
    fd.set("media", JSON.stringify(p.album.map((_, k) => ({ type: "photo", media: `attach://p${k}`, ...(k === 0 && p.caption ? { caption: p.caption, parse_mode: "HTML" } : {}) }))));
    p.album.forEach((f, k) => fd.set(`p${k}`, blob(f), basename(f)));
    msg = (await call("sendMediaGroup", fd))[0];
  } else if (p.photo) {
    msg = await call("sendPhoto", form({ chat_id: chat, photo: blob(p.photo), caption: p.caption || "", parse_mode: "HTML", reply_markup: kb }));
  } else if (p.document) {
    const fd = form({ chat_id: chat, caption: p.caption || "", parse_mode: "HTML", reply_markup: kb });
    fd.set("document", blob(p.document, "application/pdf"), p.filename || basename(p.document));
    msg = await call("sendDocument", fd);
  } else {
    msg = await call("sendMessage", { chat_id: chat, text: p.text, parse_mode: "HTML", link_preview_options: { is_disabled: !p.preview }, ...(kb ? { reply_markup: JSON.parse(kb) } : {}) });
  }
  if (p.pin) {
    await soft("снять старые закрепы", () => call("unpinAllChatMessages", { chat_id: chat }));
    await call("pinChatMessage", { chat_id: chat, message_id: msg.message_id, disable_notification: true });
    // Служебное «… закрепил сообщение» — следующее за постом
    await new Promise((r) => setTimeout(r, 1500));
    await soft("убрать уведомление о закрепе", () => call("deleteMessage", { chat_id: chat, message_id: msg.message_id + 1 }));
  }
  console.log(`${i + 1}. ${kind}: опубликовано, message_id ${msg.message_id}${p.pin ? ", закреплено" : ""}`);
  await new Promise((r) => setTimeout(r, p.album ? 4000 : 1500));
}
