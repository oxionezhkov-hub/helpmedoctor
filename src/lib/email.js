// Письма пользователям через Resend (https://resend.com). Ключ — секрет RESEND_API_KEY, отправитель — EMAIL_FROM
// (домен должен быть подтверждён в Resend). Без ключа письма просто не отправляются — остальные каналы работают как раньше.
import { esc } from "./util.js";

const DEFAULT_FROM = "Help me, Doctor <noreply@helpmedoctor.ru>";

/** Письмо в фирменной обёртке: заголовок, абзацы текста, кнопка */
export function emailHtml({ title, paragraphs = [], button = null, site = "https://helpmedoctor.ru" }) {
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#1f2421">${esc(t)}</p>`).join("");
  const b = button ? `<p style="margin:22px 0 6px"><a href="${esc(button.url)}" style="display:inline-block;padding:12px 22px;border-radius:12px;background:#0f766e;color:#fff;text-decoration:none;font-weight:600;font-size:16px">${esc(button.text)}</a></p>` : "";
  return `<!doctype html><html lang="ru"><body style="margin:0;padding:24px;background:#f4f3ee;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px">
<div style="font-size:13px;color:#5f6662;margin-bottom:14px">Help me, Doctor</div>
<h1 style="margin:0 0 16px;font-size:22px;color:#1f2421">${esc(title)}</h1>${p}${b}
</div>
<p style="max-width:520px;margin:14px auto 0;font-size:12px;color:#8a908c;text-align:center">Вы получили письмо, потому что вошли в тренажёр <a href="${esc(site)}" style="color:#8a908c">helpmedoctor.ru</a> через этот адрес.</p>
</body></html>`;
}

/**
 * Отправить письмо. Возвращает true, если Resend принял письмо. Сбой не бросает исключение: письмо — дополнительный канал.
 * @param {{to: string|string[], subject: string, html: string, text?: string}} m
 */
export async function sendEmail(env, { to, subject, html, text }) {
  const list = [...new Set([].concat(to || []).map((x) => String(x || "").trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))];
  if (!env.RESEND_API_KEY || !list.length) return false;
  try {
    const r = await fetch(env.RESEND_URL || "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM || DEFAULT_FROM, to: list, subject, html, ...(text ? { text } : {}) }),
    });
    if (!r.ok) console.warn("resend", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.warn("resend", e?.message || e);
    return false;
  }
}
