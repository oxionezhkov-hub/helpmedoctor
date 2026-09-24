// Минимальный клиент Telegram Bot API

export function tg(env) {
  // TG_API_BASE — только для локальных тестов (подмена API Telegram)
  const api = env.TG_API_BASE || "https://api.telegram.org";
  const base = `${api}/bot${env.TELEGRAM_TOKEN}`;

  async function call(method, body) {
    const r = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!d.ok) console.warn(`TG ${method} failed:`, d.description || r.status);
    return d.result;
  }

  return {
    call,
    async send(chatId, text, keyboard, extra = {}) {
      const body = { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra };
      if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
      const res = await call("sendMessage", body);
      return res?.message_id || 0;
    },
    async edit(chatId, messageId, text, keyboard) {
      if (!messageId) return;
      const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
      body.reply_markup = { inline_keyboard: keyboard || [] };
      await call("editMessageText", body);
    },
    async editKeyboard(chatId, messageId, keyboard) {
      if (!messageId) return;
      await call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard || [] } });
    },
    async del(chatId, messageId) {
      if (messageId) await call("deleteMessage", { chat_id: chatId, message_id: messageId });
    },
    async answerCb(id, text) {
      await call("answerCallbackQuery", text ? { callback_query_id: id, text } : { callback_query_id: id });
    },
    async typing(chatId) {
      await call("sendChatAction", { chat_id: chatId, action: "typing" });
    },
    async downloadFile(fileId) {
      const info = await call("getFile", { file_id: fileId });
      if (!info?.file_path) throw new Error("no file path");
      const r = await fetch(`${api}/file/bot${env.TELEGRAM_TOKEN}/${info.file_path}`);
      if (!r.ok) throw new Error(`file download ${r.status}`);
      return r.arrayBuffer();
    },
  };
}

export const btn = (text, data) => ({ text, callback_data: data });
export const urlBtn = (text, url) => ({ text, url });
export const appBtn = (text, url) => ({ text, web_app: { url } });
