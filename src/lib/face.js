// Лица пациентов: DiceBear «Open Peeps» (Pablo Stanley, CC0 1.0).
// Лицо детерминировано: одинаковые seed/пол/возраст/настроение → одинаковая картинка,
// поэтому SVG отдаётся по публичному адресу и кэшируется навсегда.
import { Avatar, Style } from "@dicebear/core";
import openPeeps from "@dicebear/styles/open-peeps.json" with { type: "json" };

let style = null;

// Набор из редактора DiceBear (выбор Олега): светлая кожа, причёски, очки, маски, выражения
const SKIN = ["ffdbb4", "edb98a"];
// Обычные очки чаще тёмных: пациент всё-таки на приёме
const ACCESSORIES = { glasses: 3, glasses2: 3, glasses3: 3, glasses4: 3, glasses5: 3, sunglasses: 0.5, sunglasses2: 0.5 };
// Естественные цвета волос (без розовых и рыжих оттенков из палитры стиля); седина — у пожилых
const HAIR = ["2c1b18", "4a312c", "724133", "a55728", "b58143", "d6b370"];
const HAIR_OLD = ["e8e1e1", "ecdcbf"];
const MASK_PROBABILITY = 13;

const HEAD_FEMALE = ["bangs", "bangs2", "bantuKnots", "bun", "bun2", "buns", "hijab", "long", "longBangs", "medium1", "medium2", "medium3",
  "mediumBangs", "mediumBangs2", "mediumBangs3", "mediumStraight", "twists", "twists2", "afro"];
const HEAD_MALE = ["short1", "short2", "short3", "short4", "short5", "shaved1", "shaved2", "shaved3", "noHair1", "noHair2", "noHair3",
  "flatTop", "pomp", "hatBeanie"];
const HEAD_OLD_FEMALE = ["grayBun", "grayMedium", "hijab"];
const HEAD_OLD_MALE = ["grayShort", "grayMedium", "noHair1", "noHair2", "noHair3"];
const HEAD_CHILD = ["bangs", "bangs2", "buns", "short1", "short2", "short3", "medium1", "mediumBangs", "twists", "afro", "bear"];

// Пациенты чаще встревожены и устали; остальные выражения — изредка, для разнообразия
const EXPRESSION = {
  concerned: 6, concernedFear: 4, tired: 6, solemn: 4, serious: 4, calm: 4, blank: 3, fear: 2, eyesClosed: 2, hectic: 2,
  explaining: 2, awe: 1, suspicious: 1, smile: 1, cute: 1, driven: 1, contempt: 1, cheeky: 1, smileTeethGap: 1,
  angryWithFang: 0.5, rage: 0.5, veryAngry: 0.5, eatingHappy: 0.5,
};
const EXPRESSION_OLD = { ...EXPRESSION, old: 8 };
const EXPRESSION_GOOD = { smile: 6, calm: 4, cute: 2, explaining: 1 };
const EXPRESSION_BAD = { tired: 6, concernedFear: 4, fear: 3, eyesClosed: 3, concerned: 3, hectic: 2 };

/** Параметры лица по пациенту: s — seed, g — пол (m/f), a — возраст, m — состояние (good/bad); clean — без маски и тёмных очков (обложки) */
export function faceOptions({ s = "", g = "", a = 0, m = "", clean = false } = {}) {
  const age = Number(a) || 35;
  const female = g === "f";
  const child = age < 14;
  const old = age >= 60;
  const head = child ? HEAD_CHILD : old ? (female ? HEAD_OLD_FEMALE : HEAD_OLD_MALE) : female ? HEAD_FEMALE : HEAD_MALE;
  return {
    seed: String(s).slice(0, 80) || "patient",
    skinColor: SKIN,
    headContrastColor: old ? HAIR_OLD : HAIR,
    headVariant: head,
    expressionVariant: m === "good" ? EXPRESSION_GOOD : m === "bad" ? EXPRESSION_BAD : old ? EXPRESSION_OLD : EXPRESSION,
    accessoriesVariant: ACCESSORIES,
    accessoriesProbability: child ? 5 : old ? 45 : 20,
    facialHairProbability: female || child ? 0 : old ? 30 : 35,
    maskVariant: ["medicalMask"],
    maskProbability: child || clean ? 0 : MASK_PROBABILITY,
    ...(clean ? { accessoriesVariant: ["glasses", "glasses2", "glasses3", "glasses4", "glasses5"] } : {}),
  };
}

/** SVG-строка лица пациента */
export function faceSvg(params) {
  style ??= new Style(openPeeps);
  return new Avatar(style, faceOptions(params)).toString();
}
