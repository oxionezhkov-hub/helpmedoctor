import { adminIds } from "../config.js";
import { transcribe } from "./ai.js";
import { arrayBufferToBase64 } from "./util.js";

export const FOUNDER_CRON = "*/5 * * * *";
export const FOUNDER_INBOX = "in/";
export const FOUNDER_OUTBOX = "out/";
export const FOUNDER_EVENT_ID = /^(?:brief-\d{4}-\d{2}-\d{2}|reply-\d+-\d+)$/;

export function founderOwner(env) {
  return env.FOUNDER_MAILBOX && (env.SESSION_SECRET || env.WEBHOOK_SECRET) ? adminIds(env)[0] : null;
}

export async function founderReply(env, bot, hub, uid, msg) {
  const mid = msg?.reply_to_message?.message_id;
  if (!mid || msg.chat?.type !== "private" || String(msg.chat.id) !== uid || founderOwner(env) !== uid) return false;
  const target = await hub.founderTarget(uid, mid);
  if (!target) return false;

  const id = `reply-${uid}-${msg.message_id}`;
  if (await hub.founderRecorded(id)) return true;
  const reply = { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } };
  let text = (msg.text || msg.caption || "").trim();
  const voice = msg.voice || msg.audio;
  if (voice) {
    if (voice.duration > 240 || voice.file_size > 6 * 1024 * 1024) {
      await bot.send(uid, "Запиши голосовое до четырёх минут или пришли решение текстом.", undefined, reply);
      return true;
    }
    try {
      const audio = await bot.downloadFile(voice.file_id);
      if (audio.byteLength > 6 * 1024 * 1024) throw new Error("Голосовое слишком большое");
      text = (await transcribe(env, arrayBufferToBase64(audio))).trim();
    } catch {
      await bot.send(uid, "Не получилось распознать голосовое. Попробуй ещё раз или ответь текстом.", undefined, reply);
      return true;
    }
  }
  if (!text) {
    await bot.send(uid, "Ответь текстом или голосовым, чтобы передать решение.", undefined, reply);
    return true;
  }
  const accepted = await hub.founderRecord(id, { kind: "reply", target, text: text.slice(0, 12000), messageId: msg.message_id });
  if (accepted) {
    const ack = voice ? `Принял голосовое. Распознал так:\n\n${text.slice(0, 3500)}` : "Принял ответ. После проверки пришлю результат сюда.";
    const ackId = await bot.send(uid, ack, undefined, { ...reply, parse_mode: undefined });
    if (ackId) await hub.founderRemember(uid, ackId, target);
  }
  return true;
}
