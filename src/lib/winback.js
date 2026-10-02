// Письма «вернись» в стиле Duolingo: короткие, личные, с лёгкой самоиронией и одной кнопкой.
// Серия по дням без активности: 1 (только если горит стрик) → 3 → 7 → 14 → 30, дальше молчим.
// В каждом письме — то, что человек теряет или получит прямо сейчас: стрик, ждущие пациенты, бесплатные приёмы, уровень, слабое место.
import { FREE_DAILY_LIMIT } from "../config.js";
import * as G from "./game.js";
import { declDays } from "./util.js";

export const WINBACK_STAGES = [1, 3, 7, 14, 30];
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
};

/** Какой этап серии отправить сегодня (или null). days — полных дней без активности */
export function winbackStage(prof, days) {
  if (days < 1 || days > 45) return null;
  const sent = prof.winback?.since === prof.last_active ? prof.winback.stage || 0 : 0;
  const due = WINBACK_STAGES.filter((s) => s <= days && s > sent && (s !== 1 || (prof.streak || 0) >= 2));
  return due.length ? due[due.length - 1] : null;
}

/** Письмо этапа: { subject, title, paragraphs, button: { text, go }, hero, stats } */
export function winbackEmail(prof, stage) {
  const m = winbackText(prof, stage);
  const lvl = G.levelInfo(prof.xp || 0).level;
  const waiting = (prof.active_patient_ids || []).length;
  const stats = [["🔥", `${prof.streak || 0} ${declDays(prof.streak || 0)}`], ["⭐", `уровень ${lvl}`], ["🩺", waiting ? `${waiting} в очереди` : "очередь пуста"]];
  return { ...m, hero: `s${stage}`, stats };
}

function winbackText(prof, stage) {
  const name = String(prof.name || "").split(/\s+/)[0] || "доктор";
  const streak = prof.streak || 0;
  const waiting = (prof.active_patient_ids || []).length;
  const premium = G.hasActiveSub(prof);
  const free = premium ? "сколько угодно пациентов" : `${FREE_DAILY_LIMIT} ${plural(FREE_DAILY_LIMIT, "пациент", "пациента", "пациентов")} бесплатно`;
  const lvl = G.levelInfo(prof.xp || 0);
  const toNext = lvl.to ? lvl.to - (prof.xp || 0) : 0;
  const weak = (prof.weaknesses || [])[0];
  const waitLine = waiting ? `${waiting} ${plural(waiting, "пациент ждёт", "пациента ждут", "пациентов ждут")} вас в очереди и, кажется, начинают нервничать.` : "";
  const go = { text: waiting ? "К пациентам" : "Принять пациента", go: waiting ? "/patients" : "/" };

  if (stage === 1) return {
    subject: `🔥 ${name}, стрик ${streak} ${declDays(streak)} сгорит в полночь`,
    title: `Стрик ${streak} ${declDays(streak)} ещё жив. Пока.`,
    paragraphs: [
      "Одного пациента хватит, чтобы серия не прервалась. Это минут пять — меньше, чем очередь в столовой.",
      waitLine || `Сегодня у вас ${free}.`,
    ].filter(Boolean),
    button: { text: "Спасти стрик", go: go.go },
  };
  if (stage === 3) return {
    subject: `${name}, пациент спрашивал про вас 👀`,
    title: "Три дня без приёма",
    paragraphs: [
      waitLine || "Ничего страшного, бывает: пары, дежурства, жизнь. Но навык расспроса без практики остывает быстрее, чем чай в ординаторской.",
      `Сегодня у вас ${free} — разминка займёт 10 минут.`,
    ],
    button: go,
  };
  if (stage === 7) return {
    subject: weak ? `Неделя без практики. А «${weak.toLowerCase()}» само не подтянется` : `${name}, неделя без пациентов`,
    title: "Неделя тишины",
    paragraphs: [
      weak ? `В последних разборах ИИ отмечал пробел: «${weak}». Лучший способ его закрыть — ещё один приём, пока тема свежая.` : "За неделю без практики забывается порядок расспроса — а на ОСКЭ его спрашивают первым.",
      toNext > 0 ? `До уровня ${lvl.level + 1} осталось ${toNext} XP — это примерно один-два приёма.` : `Сегодня у вас ${free}.`,
    ],
    button: go,
  };
  if (stage === 14) return {
    subject: `Мы не грустим. Ну, может, совсем чуть-чуть 😢`,
    title: `${name}, две недели без вас`,
    paragraphs: [
      "Профессор уже начал разбирать приёмы сам с собой. Выглядит странно.",
      "Возвращайтесь на один случай: пациент, расспрос, диагноз и честный ИИ-разбор — что получилось, а что нет.",
      `Сегодня у вас ${free}.`,
    ],
    button: { text: "Вернуться на приём", go: go.go },
  };
  return {
    subject: `${name}, это последнее письмо — обещаем`,
    title: "Больше не будем писать",
    paragraphs: [
      "Месяц без приёмов — мы поняли намёк и замолкаем. Прогресс, уровень и история пациентов никуда не делись: всё ждёт вас ровно там, где вы остановились.",
      "Если захочется размяться перед практикой, экзаменом или аккредитацией — один клик, и вы снова на приёме.",
    ],
    button: { text: "Открыть тренажёр", go: "/" },
  };
}
