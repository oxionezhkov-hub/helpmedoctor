// Точечная рассылка партнёрам: по одному личному письму каждому адресату из content/outreach/mailing/letters.json,
// через 6 рабочих дней — одно напоминание в той же переписке. Ответившим и несуществующим адресам больше не пишем.
// Отправка — через SMTP обычного почтового ящика (письма видны в «Отправленных», ответы приходят туда же),
// ответы и отказы доставки — по IMAP того же ящика. Состояние — JSON-файл (в GitHub Actions — ветка outreach-state).
//
//   node scripts/outreach-mail.mjs --dry                 что ушло бы сегодня (без SMTP/IMAP, состояние не меняется)
//   node scripts/outreach-mail.mjs --preview out.md      все письма одним файлом — чтобы прочитать перед запуском
//   node scripts/outreach-mail.mjs --test-to me@mail.ru  3 первых письма себе с пометкой [ТЕСТ] (состояние не меняется)
//   node scripts/outreach-mail.mjs                       боевой запуск (нужны enabled: true и SMTP_USER / SMTP_PASS)
//   node scripts/outreach-mail.mjs --inbox               только проверить почту: новые ответы — в Telegram, отказы доставки — в состояние
//   REPLY_TEXT="…" node scripts/outreach-mail.mjs --reply <id>   ответить адресату в ту же переписку (из Telegram через бота)
// Ключи: --state <файл> (по умолчанию .state/state.json), --limit <n> — не больше n писем за запуск.
// Секреты: SMTP_USER (адрес ящика), SMTP_PASS (пароль приложения). Необязательно: TELEGRAM_TOKEN + OUTREACH_TG_CHAT — сводка в Telegram.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { firstLetter, followUp } from "../content/outreach/mailing/templates.mjs";

const DIR = path.resolve("content/outreach/mailing");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes("--dry");
const PREVIEW = opt("--preview");
const TEST_TO = opt("--test-to");
const LIMIT = Number(opt("--limit")) || Infinity;
const STATE_FILE = path.resolve(opt("--state") || ".state/state.json");
const INBOX = args.includes("--inbox");
const REPLY = opt("--reply");
const REPLIES_DIR = path.join(path.dirname(STATE_FILE), "replies"); // наши ответы из Telegram — отдельными файлами, чтобы не конфликтовать с state.json

const cfg = JSON.parse(fs.readFileSync(path.join(DIR, "config.json"), "utf8"));
const recipients = JSON.parse(fs.readFileSync(path.join(DIR, "recipients.json"), "utf8"));
const letters = JSON.parse(fs.readFileSync(path.join(DIR, "letters.json"), "utf8"));
const recById = new Map(recipients.map((r) => [r.id, r]));
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { contacts: {}, days: [] };
const saveState = () => {
  if (DRY || TEST_TO || PREVIEW) return;
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + "\n");
};
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = ([a, b]) => Math.round((a + Math.random() * (b - a)) * 1000);

// --- календарь (по Москве) ---
const mskDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const isWorkday = (iso) => { const wd = new Date(`${iso}T12:00:00Z`).getUTCDay(); return wd !== 0 && wd !== 6 && !(cfg.skip_dates || []).includes(iso); };
/** Сколько рабочих дней прошло: (fromIso; toIso] */
function workdaysBetween(fromIso, toIso) {
  let n = 0;
  for (let t = Date.parse(`${fromIso}T12:00:00Z`) + 86400e3; t <= Date.parse(`${toIso}T12:00:00Z`); t += 86400e3) {
    if (isWorkday(new Date(t).toISOString().slice(0, 10))) n++;
  }
  return n;
}

// --- очередь ---
const order = { A: 0, B: 1, C: 2 };
function queue() {
  const usedTo = new Set(Object.values(state.contacts).map((c) => c.to.toLowerCase()));
  const excluded = new Set((cfg.exclude || []).map((x) => x.toLowerCase()));
  const fresh = [];
  for (const l of letters) {
    const rec = recById.get(l.id);
    if (!rec || l.skip || state.contacts[l.id]) continue;
    const to = String(l.to || "").trim().toLowerCase();
    const domain = to.split("@")[1];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || usedTo.has(to) || excluded.has(to) || excluded.has(domain)) continue;
    usedTo.add(to); // один адрес — одно письмо, даже если за ним несколько записей
    fresh.push({ ...l, to, rec });
  }
  // Сначала приоритет A, внутри — чередуем сегменты, чтобы за день не уходили 30 писем одного типа
  fresh.sort((a, b) => order[a.rec.priority] - order[b.rec.priority]);
  const buckets = new Map();
  for (const l of fresh) {
    const k = `${l.rec.priority}|${l.rec.segment}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(l);
  }
  const out = [];
  for (const p of ["A", "B", "C"]) {
    const bs = [...buckets.entries()].filter(([k]) => k.startsWith(p)).map(([, v]) => v);
    while (bs.some((b) => b.length)) for (const b of bs) if (b.length) out.push(b.shift());
  }
  return out;
}
function dueFollowUps(today) {
  return Object.entries(state.contacts)
    .filter(([, c]) => c.status === "sent" && !c.followup_at && workdaysBetween(mskDate(new Date(c.sent_at)), today) >= cfg.followup_after_workdays)
    .map(([id, c]) => ({ id, c, letter: letters.find((l) => l.id === id) }))
    .filter((x) => x.letter);
}
/** Сколько ещё можно отправить сегодня: дневной лимит минус уже ушедшее (второй запуск за день не удваивает объём) */
function capToday(today) {
  const days = state.days.length + (state.days.includes(today) ? 0 : 1);
  const limit = (cfg.ramp.find(([d]) => days <= d) || cfg.ramp.at(-1))[1];
  const sentToday = Object.values(state.contacts).filter((c) => [c.sent_at, c.followup_at].some((t) => t && mskDate(new Date(t)) === today)).length;
  return Math.max(0, limit - sentToday);
}

// --- зависимости для почты (в Actions ставятся в .mail-deps, локально — как обычные пакеты) ---
function dep(name) {
  for (const base of [path.resolve(".mail-deps/node_modules/"), path.resolve("node_modules/")]) {
    try { return createRequire(base + "/")(name); } catch {}
  }
  throw new Error(`Нет пакета ${name}: npm i --prefix .mail-deps nodemailer imapflow`);
}

// --- ответы и отказы по IMAP ---
/** Наши ответы из Telegram: { id → [{ message_id }] } */
function ourReplies() {
  const out = {};
  if (!fs.existsSync(REPLIES_DIR)) return out;
  for (const f of fs.readdirSync(REPLIES_DIR)) {
    try { const r = JSON.parse(fs.readFileSync(path.join(REPLIES_DIR, f), "utf8")); (out[r.id] ||= []).push(r); } catch {}
  }
  return out;
}

/** Текст письма без цитаты нашего письма ниже */
function cleanBody(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const cut = lines.findIndex((l) => /^>/.test(l) || /(пишет|wrote|написал[аи]?)\s*:\s*$/i.test(l.trim()) || /^-{2,}\s*(Original|Исходное)/i.test(l.trim()));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Новые входящие от адресатов рассылки и отказы доставки. Смотрим письма с последней проверки (с запасом в 2 дня),
 * сверяем отправителя и In-Reply-To с нашими письмами. Возвращает { news: строки для сводки, replies: новые ответы }.
 */
async function syncInbox() {
  const { ImapFlow } = dep("imapflow");
  const { simpleParser } = dep("mailparser");
  const client = new ImapFlow({ host: cfg.imap.host, port: cfg.imap.port, secure: true, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }, logger: false });
  await client.connect();
  const news = [], replies = [];
  const contacts = Object.entries(state.contacts);
  const byAddr = new Map(contacts.map(([id, c]) => [c.to.toLowerCase(), id]));
  const ours = ourReplies();
  const byMsgId = new Map();
  for (const [id, c] of contacts) for (const m of [c.message_id, c.followup_message_id, ...(ours[id] || []).map((r) => r.message_id)]) if (m) byMsgId.set(m, id);
  const oldest = contacts.reduce((m, [, c]) => Math.min(m, Date.parse(c.sent_at)), Date.now());
  const since = new Date(Math.max(oldest, Date.parse(state.inbox_checked_at || 0) - 2 * 86400e3));
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      const hits = [];
      if (uids.length) for await (const m of client.fetch(uids, { envelope: true }, { uid: true })) {
        const env = m.envelope || {};
        const fromAddr = (env.from?.[0]?.address || "").toLowerCase();
        if (/mailer-daemon|postmaster/.test(fromAddr)) { hits.push({ uid: m.uid, bounce: true }); continue; }
        const id = byAddr.get(fromAddr) || byMsgId.get(env.inReplyTo);
        if (id) hits.push({ uid: m.uid, id, env, fromAddr });
      }
      for (const h of hits) {
        const msg = await client.fetchOne(String(h.uid), { source: true }, { uid: true });
        if (h.bounce) {
          const body = msg.source.toString("utf8").toLowerCase();
          for (const [id, c] of contacts) {
            if ((c.status === "sent" || c.status === "followed") && body.includes(c.to.toLowerCase())) {
              c.status = "bounced";
              news.push(`⚠️ Адрес не существует: ${recById.get(id)?.name || c.to} <${c.to}>`);
            }
          }
          continue;
        }
        const c = state.contacts[h.id];
        const msgId = h.env.messageId || `uid-${h.uid}`;
        c.seen ||= [];
        if (c.seen.includes(msgId)) continue;
        c.seen = [...c.seen, msgId].slice(-30);
        const parsed = await simpleParser(msg.source);
        const text = cleanBody(parsed.text || "") || "(пустое письмо или только вложения)";
        Object.assign(c, { last_in_msgid: h.env.messageId || c.last_in_msgid, last_in_subject: h.env.subject || c.subject, last_in_from: h.fromAddr, last_in_at: new Date().toISOString() });
        if (c.status === "sent" || c.status === "followed") { c.status = "replied"; c.reply_at = new Date().toISOString(); }
        replies.push({ id: h.id, c, from: h.env.from?.[0], subject: h.env.subject || "", text });
        news.push(`✉️ Ответ: ${recById.get(h.id)?.name || c.to} <${h.fromAddr}>`);
      }
    } finally { lock.release(); }
  } finally { await client.logout(); }
  state.inbox_checked_at = new Date().toISOString();
  return { news, replies };
}

/** Уведомление об ответе: ответ на это сообщение в Telegram бот отправит письмом в ту же переписку (#em_<id>) */
function replyCard(r) {
  const who = [r.from?.name, `<${r.from?.address || r.c.to}>`].filter(Boolean).join(" ");
  const body = r.text.length > 2500 ? r.text.slice(0, 2500) + "…" : r.text;
  return [
    "✉️ Ответ на рассылку",
    `От: ${who}`,
    `Кто это: ${recById.get(r.id)?.name || "—"}`,
    `Тема: ${r.subject}`,
    "",
    body,
    "",
    `Чтобы ответить от имени ${cfg.sender_name}, ответьте на это сообщение (свайп → «Ответить») — письмо уйдёт в ту же переписку.`,
    `#em_${r.id}`,
  ].join("\n");
}

async function notify(text, chatId) {
  const { TELEGRAM_TOKEN: t, OUTREACH_TG_CHAT } = process.env;
  const chat = chatId || OUTREACH_TG_CHAT;
  if (!t || !chat || !text) return;
  await fetch(`https://api.telegram.org/bot${t}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }) }).catch(() => {});
}

function summary(extra = []) {
  const by = {};
  for (const c of Object.values(state.contacts)) by[c.status] = (by[c.status] || 0) + 1;
  const left = queue().length;
  const lines = [
    `Рассылка партнёрам: отправлено ${Object.keys(state.contacts).length}, осталось ${left}`,
    `ответили ${by.replied || 0} · ждём ответа ${(by.sent || 0) + (by.followed || 0)} · адрес не существует ${by.bounced || 0} · ошибки ${by.failed || 0}`,
    ...extra,
  ];
  return lines.join("\n");
}

function writeStatusCsv() {
  if (DRY || TEST_TO || PREVIEW) return;
  const rows = [["id", "Название", "Email", "Статус", "Отправлено", "Напоминание", "Ответ", "Тема"]];
  const label = { sent: "Написали", followed: "Напомнили", replied: "Ответили", bounced: "Нет адреса", failed: "Ошибка" };
  for (const [id, c] of Object.entries(state.contacts)) rows.push([id, recById.get(id)?.name || "", c.to, label[c.status] || c.status, c.sent_at?.slice(0, 10) || "", c.followup_at?.slice(0, 10) || "", c.reply_at?.slice(0, 10) || "", c.subject || ""]);
  const csv = rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n");
  fs.writeFileSync(path.join(path.dirname(STATE_FILE), "status.csv"), "﻿" + csv + "\n");
}

// --- запуск ---
function checkConfig() {
  const miss = ["from_name", "sender_name", "sender_about"].filter((k) => !String(cfg[k] || "").trim());
  if (miss.length) throw new Error(`Заполните в content/outreach/mailing/config.json: ${miss.join(", ")}`);
  const ids = new Set(letters.map((l) => l.id));
  const unknown = [...ids].filter((id) => !recById.has(id));
  if (unknown.length) log(`! письма без адресата в recipients.json: ${unknown.length}`);
  for (const l of letters) {
    if (l.skip) continue;
    const rec = recById.get(l.id);
    if (rec && !rec.emails.map((e) => e.toLowerCase()).includes(String(l.to).toLowerCase())) throw new Error(`Адрес ${l.to} не из базы контактов (${rec.name})`);
  }
}

if (PREVIEW) {
  const preview = { ...cfg, sender_name: cfg.sender_name || "[Имя Фамилия]", from_name: cfg.from_name || "[Имя Фамилия]", sender_about: cfg.sender_about || "[студент N курса … вуза]" };
  const q = queue();
  const md = [`# Письма рассылки — ${q.length} шт. (в порядке отправки)\n`];
  q.forEach((l, i) => {
    const m = firstLetter(l, preview);
    md.push(`---\n\n### ${i + 1}. ${l.rec.name}\n\n**Кому:** ${l.to} · ${l.rec.segment} · приоритет ${l.rec.priority}\n**Тема:** ${m.subject}\n\n${m.text.replace(/\n/g, "  \n")}\n`);
  });
  fs.writeFileSync(PREVIEW, md.join("\n"));
  log(`✓ ${PREVIEW}: ${q.length} писем; пропущено ${letters.filter((l) => l.skip).length}`);
  process.exit(0);
}

checkConfig();
const today = mskDate();
const needMail = () => { if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("Нет SMTP_USER / SMTP_PASS"); };
const mailer = () => dep("nodemailer").createTransport({ host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
const sendReplyCards = async (replies) => { for (const r of replies) await notify(replyCard(r)); };

// Только проверить почту: новые ответы — карточками в Telegram (на них можно ответить), состояние — в файл
if (INBOX) {
  needMail();
  const { news, replies } = await syncInbox();
  saveState();
  writeStatusCsv();
  await sendReplyCards(replies);
  const bounces = news.filter((n) => n.startsWith("⚠️"));
  if (bounces.length) await notify(bounces.join("\n"));
  log(`Почта проверена: новых ответов ${replies.length}, отказов доставки ${bounces.length}`);
  process.exit(0);
}

// Ответ адресату из Telegram: текст — REPLY_TEXT, письмо — в ту же переписку, подтверждение — тому, кто ответил (REPLY_CHAT)
if (REPLY) {
  needMail();
  const chat = process.env.REPLY_CHAT;
  const c = state.contacts[REPLY];
  const body = String(process.env.REPLY_TEXT || "").trim();
  if (!c || !body) {
    await notify(`⚠️ Не отправлено: ${!c ? `адресат #em_${REPLY} не найден в рассылке` : "пустой текст"}`, chat);
    throw new Error(!c ? `Нет адресата ${REPLY}` : "Пустой REPLY_TEXT");
  }
  const subj = c.last_in_subject || c.subject;
  const text = body.includes(cfg.sender_name) ? body : `${body}\n\n${[cfg.sender_name, ...(cfg.signature || [])].join("\n")}`;
  const refs = [c.message_id, c.followup_message_id, c.last_in_msgid].filter(Boolean);
  const to = c.last_in_from || c.to;
  try {
    const info = await mailer().sendMail({ from: { name: cfg.from_name, address: process.env.SMTP_USER }, to, subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`, text, inReplyTo: c.last_in_msgid || c.message_id, references: refs });
    fs.mkdirSync(REPLIES_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPLIES_DIR, `${Date.now()}-${REPLY}.json`), JSON.stringify({ id: REPLY, to, at: new Date().toISOString(), message_id: info.messageId }) + "\n");
    await notify(`✅ Ответ отправлен: ${recById.get(REPLY)?.name || to} <${to}>`, chat);
    log(`✓ ответ → ${to}`);
  } catch (e) {
    await notify(`⚠️ Ответ не отправлен (${to}): ${e.message}`, chat);
    throw e;
  }
  process.exit(0);
}

if (!TEST_TO && !DRY) {
  if (!cfg.enabled) { log("Рассылка выключена (config.json → enabled: false)"); process.exit(0); }
  if (!isWorkday(today)) { log(`${today} — выходной, не отправляем`); process.exit(0); }
  needMail();
}

const { news, replies } = !DRY && !TEST_TO ? await syncInbox() : { news: [], replies: [] };
const cap = Math.min(capToday(today), LIMIT);
const followups = dueFollowUps(today);
const fresh = queue();
const plan = [
  ...followups.map((f) => ({ kind: "followup", id: f.id, to: f.c.to, letter: f.letter, c: f.c })),
  ...fresh.map((l) => ({ kind: "first", id: l.id, to: l.to, letter: l })),
].slice(0, TEST_TO ? 3 : cap);
log(`${today}: лимит ${cap}, напоминаний к отправке ${followups.length}, новых в очереди ${fresh.length}, план ${plan.length}`);

let transport;
if (!DRY) {
  transport = mailer();
  await transport.verify();
}
const from = () => ({ name: cfg.from_name, address: process.env.SMTP_USER });

let sent = 0;
for (const [i, p] of plan.entries()) {
  const m = p.kind === "first" ? firstLetter(p.letter, cfg) : followUp(p.letter, cfg, p.c.sent_at);
  const to = TEST_TO || p.to;
  const subject = TEST_TO ? `[ТЕСТ → ${p.to}] ${m.subject}` : m.subject;
  if (DRY) { log(`\n=== ${p.kind === "first" ? "письмо" : "напоминание"} → ${p.to}\nТема: ${subject}\n\n${m.text}`); continue; }
  const mail = { from: from(), to, subject, text: m.text };
  if (p.kind === "followup" && p.c.message_id && !TEST_TO) Object.assign(mail, { inReplyTo: p.c.message_id, references: [p.c.message_id] });
  try {
    const info = await transport.sendMail(mail);
    sent++;
    log(`✓ ${p.kind === "first" ? "письмо" : "напоминание"} → ${to}`);
    if (!TEST_TO) {
      const now = new Date().toISOString();
      if (p.kind === "first") state.contacts[p.id] = { to: p.to, status: "sent", sent_at: now, message_id: info.messageId, subject };
      else Object.assign(state.contacts[p.id], { status: "followed", followup_at: now, followup_message_id: info.messageId });
      if (!state.days.includes(today)) state.days.push(today);
      saveState();
    }
  } catch (e) {
    log(`✗ ${to}: ${e.message}`);
    if (e.responseCode === 535 || e.code === "EAUTH") throw e; // неверный пароль — дальше нет смысла
    if (!TEST_TO && e.responseCode >= 500 && e.responseCode < 600) {
      state.contacts[p.id] = { ...(state.contacts[p.id] || { to: p.to, sent_at: new Date().toISOString(), subject }), status: "bounced", note: e.message.slice(0, 200) };
      saveState();
    }
  }
  if (i < plan.length - 1) await sleep(rnd(cfg.delay_sec));
}
saveState();
writeStatusCsv();
const text = summary([`Сегодня: ${sent} писем`, ...news]);
log("\n" + text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text.replace(/\n/g, "  \n") + "\n");
if (!DRY && !TEST_TO) {
  await sendReplyCards(replies);
  if (sent || news.length) await notify(text);
}
