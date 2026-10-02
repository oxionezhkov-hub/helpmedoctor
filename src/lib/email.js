// Письма пользователям через Resend (https://resend.com). Ключ — секрет RESEND_API_KEY, отправитель — EMAIL_FROM
// (домен должен быть подтверждён в Resend). Без ключа письма просто не отправляются — остальные каналы работают как раньше.
import { esc } from "./util.js";

const DEFAULT_FROM = "Help me, Doctor <noreply@helpmedoctor.ru>";

/**
 * Письмо в фирменной обёртке: логотип, картинка-сцена с персонажами, цифры (стрик, уровень, очередь), заголовок, текст, кнопка.
 * hero — имя картинки из public/email/ (s1, s3, s7, s14, s30, ok); stats — [[эмодзи, подпись], …]
 */
export function emailHtml({ title, paragraphs = [], button = null, site = "https://helpmedoctor.ru", unsub = "", hero = "", stats = [] }) {
  const img = (n) => `${site.replace(/\/$/, "")}/email/${n}.png`;
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#191c1b">${esc(t)}</p>`).join("");
  const b = button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="border-radius:14px;background:#0d5c55"><a href="${esc(button.url)}" style="display:inline-block;padding:14px 26px;color:#fbfaf6;text-decoration:none;font-weight:700;font-size:16px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">${esc(button.text)}</a></td></tr></table>` : "";
  const st = stats.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px"><tr>${stats.map(([e, t]) => `<td align="center" style="padding:10px 4px;background:#f6f4ee;border-radius:12px;font-size:14px;color:#191c1b;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif"><div style="font-size:22px;line-height:1.2">${esc(e)}</div>${esc(t)}</td>`).join('<td width="8"></td>')}</tr></table>` : "";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:24px 12px;background:#f6f4ee;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto">
<div style="padding:0 4px 14px"><a href="${esc(site)}"><img src="${img("logo")}" width="180" alt="Help me, Doctor" style="display:block;border:0;height:auto"></a></div>
<div style="background:#fffdf8;border:1px solid #e6e1d4;border-radius:18px;overflow:hidden">
${hero ? `<img src="${img(hero)}" width="560" alt="" style="display:block;width:100%;height:auto;border:0;border-bottom:1px solid #e6e1d4">` : ""}
<div style="padding:26px 26px 22px">
<h1 style="margin:0 0 16px;font:700 24px/1.25 Georgia,'Times New Roman',serif;color:#191c1b">${esc(title)}</h1>${st}${p}${b}
</div></div>
<p style="margin:16px 4px 0;font-size:12px;line-height:1.5;color:#8a908c;text-align:center">Вы получили письмо, потому что вошли в тренажёр <a href="${esc(site)}" style="color:#8a908c">helpmedoctor.ru</a> через этот адрес.${unsub ? ` <a href="${esc(unsub)}" style="color:#8a908c">Не присылать напоминания</a>` : ""}</p>
</div></body></html>`;
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
