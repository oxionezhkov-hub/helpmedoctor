// «Кто круче?» — битва двух врачей на одном пациенте. Хранится в SQLite HubDO.
// Создатель делится QR-кодом или ссылкой → соперник подключается → обоим выпадает 5 случайных профессий,
// по очереди вычёркивают (создатель, соперник, создатель, соперник) → по оставшейся профессии будет пациент;
// сложность выбирает тот, кто не вычёркивал последним → один пациент готовится в очереди создателя и копируется обоим →
// каждый принимает своего, после разбора результат приходит сюда → побеждает оценка выше, при равенстве — кто быстрее.
// Потом — реванш (то же двое, снова выбор профессии) или новая битва.
import { DIFFICULTIES, SPECIALIZATIONS } from "../config.js";
import { refBind, refCode } from "./partners.js";
import { UserError } from "./util.js";

const CODE_ABC = "abcdefghjkmnpqrstuvwxyz23456789";
const HOUR = 3600000;
const ACTIVE_TTL = 48 * HOUR; // идущая битва без результата одного из игроков — итог через 48 часов
const WAIT_TTL = 7 * 24 * HOUR; // никто не подключился за неделю — битва отменяется
const TIE_MS = 5000; // разница во времени меньше 5 секунд — ничья
const DRAFT_SIZE = 5; // столько профессий выпадает на выбор

/** Новый выбор: 5 случайных профессий, первым вычёркивает создатель */
export function newDraft() {
  const all = Object.keys(SPECIALIZATIONS);
  const options = [];
  while (options.length < Math.min(DRAFT_SIZE, all.length)) {
    const x = all[crypto.getRandomValues(new Uint32Array(1))[0] % all.length];
    if (!options.includes(x)) options.push(x);
  }
  return { options, banned: [], turn: "owner", pick: null, level_by: null, level: null };
}

/** Ход вычёркивания: возвращает новый драфт или бросает ошибку. Последняя оставшаяся — выбранная профессия */
export function draftBan(d, role, name) {
  if (d.pick) throw userErr("Профессия уже выбрана");
  if (d.turn !== role) throw userErr("Сейчас ход соперника");
  const left = d.options.filter((x) => !d.banned.some((b) => b.name === x));
  if (!left.includes(name)) throw userErr("Эту профессию уже вычеркнули");
  const banned = [...d.banned, { name, by: role }];
  const rest = left.filter((x) => x !== name);
  const other = role === "owner" ? "guest" : "owner";
  if (rest.length === 1) return { ...d, banned, turn: null, pick: rest[0], level_by: other };
  return { ...d, banned, turn: other };
}

export function initBattleTables(sql) {
  sql.exec(`
    CREATE TABLE IF NOT EXISTS battles (id TEXT PRIMARY KEY, owner TEXT, guest TEXT, invitee TEXT, status TEXT,
      created_at INTEGER, joined_at INTEGER, started_at INTEGER, finished_at INTEGER, rematch_of TEXT, next_id TEXT,
      patient TEXT, owner_pat TEXT, guest_pat TEXT, owner_res TEXT, guest_res TEXT, winner TEXT);
    CREATE INDEX IF NOT EXISTS battles_owner ON battles (owner, created_at);
    CREATE INDEX IF NOT EXISTS battles_guest ON battles (guest, created_at);
    CREATE INDEX IF NOT EXISTS battles_invitee ON battles (invitee, created_at);
  `);
}

const safeJson = (s) => { try { return JSON.parse(s || "null"); } catch { return null; } };
const userStub = (hub, uid) => hub.env.USER.get(hub.env.USER.idFromName(String(uid)));

function newCode(hub) {
  for (let i = 0; i < 20; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    const code = [...bytes].map((b) => CODE_ABC[b % CODE_ABC.length]).join("");
    if (!hub.one("SELECT 1 AS x FROM battles WHERE id = ?", code)) return code;
  }
  throw new Error("battle code");
}

function load(hub, id) {
  return hub.one("SELECT * FROM battles WHERE id = ?", String(id || "").toLowerCase());
}

function userName(hub, uid) {
  if (!uid) return null;
  const u = hub.one("SELECT name, username, avatar FROM users WHERE uid = ?", String(uid));
  return { uid: String(uid), name: u?.name || "Врач", username: u?.username || "", avatar: u?.avatar || null };
}

/** Победитель по двум результатам: оценка выше; при равной — кто быстрее; иначе ничья */
export function decideWinner(a, b) {
  if (!a && !b) return "draw";
  if (!a) return "guest";
  if (!b) return "owner";
  const ra = Math.round(Number(a.rating || 0) * 10);
  const rb = Math.round(Number(b.rating || 0) * 10);
  if (ra !== rb) return ra > rb ? "owner" : "guest";
  const ta = Number(a.ms) || Infinity;
  const tb = Number(b.ms) || Infinity;
  if (Math.abs(ta - tb) < TIE_MS || ta === tb) return "draw";
  return ta < tb ? "owner" : "guest";
}

/** Битва глазами игрока: свой результат всегда, соперника — когда закончили оба */
export function battleView(hub, b, uid) {
  uid = String(uid || "");
  const role = b.owner === uid ? "owner" : b.guest === uid ? "guest" : b.invitee === uid ? "invitee" : null;
  const meKey = role === "guest" ? "guest" : "owner";
  const opKey = meKey === "owner" ? "guest" : "owner";
  const opUid = role === "owner" ? b.guest || b.invitee : b.owner;
  const res = { owner: safeJson(b.owner_res), guest: safeJson(b.guest_res) };
  const finished = b.status === "finished";
  const pat = safeJson(b.patient);
  const d = safeJson(b.draft);
  const meRole = role === "owner" || role === "guest" ? role : null;
  const base = String(hub.env.PUBLIC_URL || "https://helpmedoctor.ru").replace(/\/$/, "");
  return {
    id: b.id, status: b.status, role, created_at: b.created_at, joined_at: b.joined_at, started_at: b.started_at, finished_at: b.finished_at,
    rematch_of: b.rematch_of, next_id: b.next_id,
    // Реванш уже предложен: кем — от этого зависит кнопка («К реваншу» или «Принять реванш»)
    next_mine: b.next_id ? hub.one("SELECT owner FROM battles WHERE id = ?", b.next_id)?.owner === uid : null,
    me: { ...(userName(hub, role === "invitee" ? uid : b[meKey]) || {}), patient_id: role === "owner" || role === "guest" ? b[`${meKey}_pat`] : null, result: role && role !== "invitee" ? res[meKey] : null },
    opponent: opUid ? { ...userName(hub, opUid), done: !!(role === "owner" ? res.guest : res.owner), result: finished ? (role === "owner" ? res.guest : res.owner) : null } : null,
    winner: finished ? (b.winner === "draw" ? "draw" : b.winner === meKey ? "me" : "opponent") : null,
    patient: pat && b.started_at ? { name: pat.name, age: pat.age, sex: pat.sex, chief_complaint: pat.chief_complaint, specialty: pat.specialty, profession: pat.profession || d?.pick || null, true_diagnosis: finished ? pat.true_diagnosis : null } : null,
    owner_name: userName(hub, b.owner)?.name,
    // Выбор профессии и сложности: чей ход — «me» или «opponent»
    draft: d ? {
      options: d.options, banned: d.banned.map((x) => ({ name: x.name, by: x.by === meRole ? "me" : "opponent" })),
      turn: d.turn ? (d.turn === meRole ? "me" : "opponent") : null,
      pick: d.pick, level_by: d.level_by ? (d.level_by === meRole ? "me" : "opponent") : null, level: d.level,
    } : null,
    links: { site: `${base}/app?go=${encodeURIComponent(`/battle/${b.id}`)}`, bot: `https://t.me/${hub.env.BOT_USERNAME || "helpmedoctor_aibot"}?start=b_${b.id}` },
  };
}

async function notify(hub, uid, payload) {
  if (!uid) return;
  try {
    await userStub(hub, uid).battleNotify(payload);
  } catch (e) {
    console.error("battle notify", e);
  }
}

/** Ленивое истечение: давно идущие битвы подводим, давно ждущие — отменяем */
async function expire(hub, b) {
  const now = Date.now();
  if (b.status === "active" && b.started_at && now - b.started_at > ACTIVE_TTL) return finish(hub, b, { expired: true });
  // Битвы до выбора профессии (статус ready, «Старт») — сразу в выбор
  if (b.status === "ready") {
    hub.sql.exec("UPDATE battles SET status = 'draft', draft = ? WHERE id = ? AND status = 'ready'", JSON.stringify(newDraft()), b.id);
    b = load(hub, b.id);
  }
  if (["waiting", "draft"].includes(b.status) && now - b.created_at > WAIT_TTL) {
    hub.sql.exec("UPDATE battles SET status = 'cancelled', finished_at = ? WHERE id = ?", now, b.id);
    return load(hub, b.id);
  }
  return b;
}

async function finish(hub, b, { expired = false } = {}) {
  const winner = decideWinner(safeJson(b.owner_res), safeJson(b.guest_res));
  const now = Date.now();
  hub.sql.exec("UPDATE battles SET status = 'finished', winner = ?, finished_at = ? WHERE id = ? AND status = 'active'", winner, now, b.id);
  const fresh = load(hub, b.id);
  if (fresh.status !== "finished" || fresh.finished_at !== now) return fresh; // подвёл кто-то другой
  for (const role of ["owner", "guest"]) {
    const v = battleView(hub, fresh, fresh[role]);
    const me = v.me.result;
    const op = v.opponent?.result;
    const score = `${me ? rate(me.rating) : "—"} : ${op ? rate(op.rating) : "—"}`;
    const head = v.winner === "me" ? "🏆 <b>Победа!</b>" : v.winner === "draw" ? "🤝 <b>Ничья</b>" : "😤 <b>Поражение</b>";
    await notify(hub, fresh[role], {
      kind: "finished", battle_id: fresh.id,
      text: `${head} ${score}${expired ? " · время вышло" : ""}`,
      button: { text: "⚔️ Итог", path: `/battle/${fresh.id}` },
      push: { title: v.winner === "me" ? "🏆 Вы победили в битве" : v.winner === "draw" ? "🤝 Ничья в битве" : "⚔️ Битва окончена", body: `Вы ${me ? `${me.rating}/5` : "—"} · соперник ${op ? `${op.rating}/5` : "—"}` },
    });
  }
  return fresh;
}

const rate = (r) => String(Math.round(Number(r || 0) * 10) / 10).replace(".", ",");

function fmtMs(ms) {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (!s) return "—";
  const m = Math.floor(s / 60);
  return m ? `${m} мин ${String(s % 60).padStart(2, "0")} с` : `${s} с`;
}

// ---------------------------------------------------
// Операции (вызываются из API через HubDO)
// ---------------------------------------------------

export async function battleCreate(hub, uid, { rematch_of = null } = {}) {
  uid = String(uid);
  const now = Date.now();
  if (rematch_of) {
    const old = load(hub, rematch_of);
    if (!old || (old.owner !== uid && old.guest !== uid)) throw userErr("Битва не найдена");
    const other = old.owner === uid ? old.guest : old.owner;
    if (!other) throw userErr("В той битве не было соперника");
    // Соперник уже предложил реванш — подключаемся к его битве
    if (old.next_id) {
      const next = load(hub, old.next_id);
      if (next && !["cancelled", "finished"].includes(next.status)) {
        if (next.owner === uid) return battleView(hub, next, uid);
        return battleJoin(hub, next.id, uid);
      }
    }
    const id = newCode(hub);
    hub.sql.exec("INSERT INTO battles (id, owner, invitee, status, created_at, rematch_of) VALUES (?, ?, ?, 'waiting', ?, ?)", id, uid, other, now, old.id);
    hub.sql.exec("UPDATE battles SET next_id = ? WHERE id = ?", id, old.id);
    const b = load(hub, id);
    const me = userName(hub, uid);
    await notify(hub, other, {
      kind: "rematch", battle_id: id, rematch_of: old.id,
      text: `⚔️ ${me.name} зовёт на реванш`,
      button: { text: "⚔️ Принять", path: `/battle/${id}` },
      push: { title: "⚔️ Вам бросили вызов", body: `${me.name} требует реванша в «Кто круче?»` },
    });
    return battleView(hub, b, uid);
  }
  // Своя ещё не начатая битва без приглашённого — показываем её же, а не плодим новые
  const open = hub.one("SELECT * FROM battles WHERE owner = ? AND status = 'waiting' AND invitee IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 1", uid, now - WAIT_TTL);
  if (open) return battleView(hub, open, uid);
  const id = newCode(hub);
  hub.sql.exec("INSERT INTO battles (id, owner, status, created_at) VALUES (?, ?, 'waiting', ?)", id, uid, now);
  return battleView(hub, load(hub, id), uid);
}

export async function battleGet(hub, id, uid) {
  let b = load(hub, id);
  if (!b) throw userErr("Битва не найдена — попросите соперника прислать новую ссылку");
  b = await expire(hub, b);
  return battleView(hub, b, uid);
}

export async function battleJoin(hub, id, uid) {
  uid = String(uid);
  let b = load(hub, id);
  if (!b) throw userErr("Битва не найдена — попросите соперника прислать новую ссылку");
  b = await expire(hub, b);
  if (b.owner === uid || b.guest === uid) return battleView(hub, b, uid);
  if (b.status !== "waiting") throw userErr(b.status === "cancelled" ? "Эту битву отменили — попросите новую ссылку" : "В этой битве уже два врача");
  if (b.invitee && b.invitee !== uid) throw userErr("Этот реванш предложили другому врачу");
  const now = Date.now();
  hub.sql.exec("UPDATE battles SET guest = ?, status = 'draft', draft = ?, joined_at = ? WHERE id = ? AND status = 'waiting'", uid, JSON.stringify(newDraft()), now, b.id);
  b = load(hub, b.id);
  if (b.guest !== uid) throw userErr("В этой битве уже два врача");
  // Новичок пришёл по вызову — закрепляем за пригласившим, как по личной ссылке
  const u = hub.one("SELECT registered_at FROM users WHERE uid = ?", uid);
  if (u?.registered_at && now - u.registered_at < 24 * HOUR) {
    try { refBind(hub, uid, refCode(hub, b.owner)); } catch (e) { console.error("battle ref", e); }
  }
  const guest = userName(hub, uid);
  await notify(hub, b.owner, {
    kind: "joined", battle_id: b.id,
    text: `⚔️ ${guest.name} в битве — ваш ход`,
    button: { text: "⚔️ Выбрать профессию", path: `/battle/${b.id}` },
    push: { title: "⚔️ Соперник в битве", body: "Ваш ход: вычеркните профессию" },
  });
  return battleView(hub, b, uid);
}

/** Старый «Старт» (до выбора профессии): переводит готовую битву в выбор */
export async function battleStart(hub, id, uid) {
  return battleGet(hub, id, uid);
}

function draftRole(b, uid) {
  return b.owner === uid ? "owner" : b.guest === uid ? "guest" : null;
}

/** Ход: вычеркнуть профессию. Когда остаётся одна — выбор сложности за тем, кто не вычёркивал последним */
export async function battleBan(hub, id, uid, name) {
  uid = String(uid);
  let b = load(hub, id);
  if (!b) throw userErr("Битва не найдена");
  b = await expire(hub, b);
  const role = draftRole(b, uid);
  if (!role) throw userErr("Вы не участник этой битвы");
  if (b.status !== "draft") throw userErr("Выбор профессии уже закончился");
  const next = draftBan(safeJson(b.draft), role, String(name || ""));
  hub.sql.exec("UPDATE battles SET draft = ? WHERE id = ? AND draft = ?", JSON.stringify(next), b.id, b.draft);
  const fresh = load(hub, b.id);
  for (const r of ["owner", "guest"]) await notify(hub, fresh[r], { kind: "draft", battle_id: b.id, silent: true });
  return battleView(hub, fresh, uid);
}

/** Выбор сложности — и пациент готовится в очереди создателя */
export async function battleLevel(hub, id, uid, level) {
  uid = String(uid);
  let b = load(hub, id);
  if (!b) throw userErr("Битва не найдена");
  b = await expire(hub, b);
  const role = draftRole(b, uid);
  const d = safeJson(b.draft);
  if (!role || b.status !== "draft" || !d?.pick) throw userErr("Сначала выберите профессию");
  if (d.level_by !== role) throw userErr("Сложность выбирает соперник");
  if (!DIFFICULTIES.some((x) => x.key === level)) throw userErr("Нет такой сложности");
  const next = { ...d, level };
  hub.sql.exec("UPDATE battles SET status = 'preparing', draft = ? WHERE id = ? AND status = 'draft'", JSON.stringify(next), b.id);
  const fresh = load(hub, b.id);
  if (fresh.status !== "preparing") return battleView(hub, fresh, uid);
  await userStub(hub, b.owner).battleGenerate(b.id, { profession: d.pick, complexity: level });
  for (const r of ["owner", "guest"]) await notify(hub, fresh[r], { kind: "preparing", battle_id: b.id, silent: true });
  return battleView(hub, fresh, uid);
}

/** Пациент для битвы готов (из очереди создателя): копируем обоим и запускаем */
export async function battlePatientReady(hub, id, data) {
  const b = load(hub, id);
  if (!b || b.status !== "preparing") return { ok: false };
  const ownerPat = await userStub(hub, b.owner).battleAddPatient({ id: b.id, opponent: b.guest }, data);
  const guestPat = await userStub(hub, b.guest).battleAddPatient({ id: b.id, opponent: b.owner }, data);
  const now = Date.now();
  hub.sql.exec("UPDATE battles SET status = 'active', started_at = ?, patient = ?, owner_pat = ?, guest_pat = ? WHERE id = ?",
    now, JSON.stringify(data), ownerPat, guestPat, b.id);
  for (const [uid, pat, other] of [[b.owner, ownerPat, b.guest], [b.guest, guestPat, b.owner]]) {
    await notify(hub, uid, {
      kind: "started", battle_id: b.id, patient_id: pat,
      text: "⚔️ Пациент готов — битва началась",
      button: { text: "🩺 К битве", path: `/battle/${b.id}` },
      push: { title: "⚔️ Битва началась", body: "Пациент готов — начинайте приём" },
    });
  }
  return { ok: true };
}

export async function battlePatientFailed(hub, id) {
  const b = load(hub, id);
  if (!b || b.status !== "preparing") return { ok: false };
  // Профессия остаётся, сложность — выбрать заново (та же кнопка повторит создание пациента)
  const d = safeJson(b.draft);
  hub.sql.exec("UPDATE battles SET status = 'draft', draft = ? WHERE id = ?", JSON.stringify(d ? { ...d, level: null } : newDraft()), b.id);
  for (const uid of [b.owner, b.guest]) {
    await notify(hub, uid, { kind: "failed", battle_id: b.id, text: "😔 Пациент не создался — выберите сложность ещё раз", button: { text: "⚔️ К битве", path: `/battle/${b.id}` } });
  }
  return { ok: true };
}

/** Результат приёма в битве (после разбора эксперта) */
export async function battleResult(hub, id, uid, result) {
  uid = String(uid);
  const b = load(hub, id);
  if (!b || b.status !== "active") return { ok: false };
  const role = b.owner === uid ? "owner" : b.guest === uid ? "guest" : null;
  if (!role || b[`${role}_res`]) return { ok: false };
  const clean = {
    rating: Number(result.rating) || 0, axes: result.axes || null, correct: result.correct || null, diagnosis: String(result.diagnosis || "").slice(0, 200),
    ms: Number(result.ms) || 0, questions: Number(result.questions) || 0, tests: Number(result.tests) || 0, hints: Number(result.hints) || 0, xp: Number(result.xp) || 0,
  };
  hub.sql.exec(`UPDATE battles SET ${role}_res = ? WHERE id = ?`, JSON.stringify(clean), b.id);
  const fresh = load(hub, b.id);
  if (fresh.owner_res && fresh.guest_res) return { ok: true, finished: (await finish(hub, fresh)).status === "finished" };
  const other = role === "owner" ? b.guest : b.owner;
  const me = userName(hub, uid);
  await notify(hub, other, {
    kind: "opponent_done", battle_id: b.id,
    text: `⏱ ${me.name} закончил приём — ждём вас`,
    button: { text: "🩺 К битве", path: `/battle/${b.id}` },
    push: { title: "⏱ Соперник закончил приём", body: "Итог откроется, когда закончите вы" },
  });
  await notify(hub, uid, { kind: "waiting_result", battle_id: b.id, silent: true });
  return { ok: true, finished: false };
}

export async function battleCancel(hub, id, uid) {
  const b = load(hub, id);
  if (!b || b.owner !== String(uid)) throw userErr("Отменить может только создатель");
  if (!["waiting", "ready", "draft"].includes(b.status)) throw userErr("Битва уже началась");
  hub.sql.exec("UPDATE battles SET status = 'cancelled', finished_at = ? WHERE id = ?", Date.now(), b.id);
  if (b.guest || b.invitee) await notify(hub, b.guest || b.invitee, { kind: "cancelled", battle_id: b.id, silent: true });
  return battleView(hub, load(hub, b.id), uid);
}

/** Раздел «Кто круче?»: последние битвы и счёт */
export async function battleList(hub, uid) {
  uid = String(uid);
  const rows = hub.all(
    "SELECT * FROM battles WHERE (owner = ? OR guest = ? OR invitee = ?) AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 30", uid, uid, uid);
  const list = [];
  for (const r of rows) list.push(battleView(hub, await expire(hub, r), uid));
  const done = list.filter((v) => v.status === "finished" && (v.role === "owner" || v.role === "guest"));
  return {
    battles: list,
    score: { wins: done.filter((v) => v.winner === "me").length, losses: done.filter((v) => v.winner === "opponent").length, draws: done.filter((v) => v.winner === "draw").length },
  };
}

const userErr = (message) => new UserError(message, "battle");
