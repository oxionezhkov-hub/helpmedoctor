// Минимальный клиент Telegram Bot API.
// Каждое отправленное сообщение записывается в переписку пользователя (для админки),
// кроме служебных уведомлений админам — их HubDO отправляет с log: false.

export function tg(env, { log = true, kind = "bot", admin = null, ref = null } = {}) {
  // TG_API_BASE — только для локальных тестов (подмена API Telegram)
  const api = env.TG_API_BASE || "https://api.telegram.org";
  const base = `${api}/bot${env.TELEGRAM_TOKEN}`;
  let last = { ok: true, code: 0, description: "" };

  async function call(method, body) {
    let d;
    try {
      const r = await fetch(`${base}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      d = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
    } catch (e) {
      d = { ok: false, description: String(e?.message || e) };
    }
    last = { ok: !!d.ok, code: d.error_code || 0, description: d.description || "" };
    if (!d.ok) console.warn(`TG ${method} failed:`, d.description);
    return d.result;
  }

  async function record(chatId, text, extra = {}) {
    if (!log || !env.HUB) return;
    try {
      await env.HUB.get(env.HUB.idFromName("hub")).logChat({
        uid: String(chatId), dir: "out", kind, text: String(text || "").slice(0, 4000), admin, ref,
        ok: last.ok ? 1 : 0, err: last.ok ? "" : last.description, ...extra,
      });
    } catch (e) {
      console.error("logChat", e);
    }
  }

  return {
    call,
    /** Результат последнего вызова: ok, code (403 — бот заблокирован пользователем), description */
    get last() {
      return last;
    },
    async send(chatId, text, keyboard, extra = {}) {
      const body = { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra };
      if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
      const res = await call("sendMessage", body);
      await record(chatId, stripHtml(text), { tg_mid: res?.message_id || 0, buttons: keyboard ? buttonsText(keyboard) : "" });
      return res?.message_id || 0;
    },
    async sendPhoto(chatId, blob, caption, keyboard) {
      const fd = new FormData();
      fd.append("chat_id", String(chatId));
      fd.append("photo", blob, "image.jpg");
      if (caption) {
        fd.append("caption", caption);
        fd.append("parse_mode", "HTML");
      }
      if (keyboard) fd.append("reply_markup", JSON.stringify({ inline_keyboard: keyboard }));
      let d;
      try {
        const r = await fetch(`${base}/sendPhoto`, { method: "POST", body: fd });
        d = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
      } catch (e) {
        d = { ok: false, description: String(e?.message || e) };
      }
      last = { ok: !!d.ok, code: d.error_code || 0, description: d.description || "" };
      await record(chatId, `🖼 ${stripHtml(caption || "")}`, { tg_mid: d.result?.message_id || 0, buttons: keyboard ? buttonsText(keyboard) : "" });
      return d.result?.message_id || 0;
    },
    async edit(chatId, messageId, text, keyboard) {
      if (!messageId) return;
      const body = { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } };
      body.reply_markup = { inline_keyboard: keyboard || [] };
      await call("editMessageText", body);
      await record(chatId, stripHtml(text), { tg_mid: messageId, kind: "edit" });
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

export function stripHtml(s) {
  return String(s || "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function buttonsText(kb) {
  return kb.flat().map((b) => b.text).join(" · ");
}

export const btn = (text, data) => ({ text, callback_data: data });
export const urlBtn = (text, url) => ({ text, url });
export const appBtn = (text, url) => ({ text, web_app: { url } });
