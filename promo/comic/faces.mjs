// Лица персонажей серии: DiceBear «Open Peeps» (CC0), как в приложении (src/lib/face.js).
// node faces.mjs series/<id> — по episode.json пишет faces/<кто>-<эмоция>.svg для всех эмоций из сценария.
import fs from "node:fs";
import { Avatar, Style } from "@dicebear/core";
const style = new Style(JSON.parse(fs.readFileSync(new URL("../../node_modules/@dicebear/styles/src/open-peeps.json", import.meta.url))));
const dir = process.argv[2];
const ep = JSON.parse(fs.readFileSync(`${dir}/episode.json`, "utf8"));
fs.mkdirSync(`${dir}/faces`, { recursive: true });
const need = {};
for (const [who, c] of Object.entries(ep.cast)) if (c.seed) need[who] = new Set([c.face0]);
let cur = {};
for (const l of ep.lines) if (need[l.who] && l.face) need[l.who].add(l.face);
for (const [who, faces] of Object.entries(need)) {
  const c = ep.cast[who];
  for (const f of faces) {
    const svg = new Avatar(style, {
      seed: c.seed, skinColor: [c.skin || "ffdbb4"], headContrastColor: [c.hair || "2c1b18"], headVariant: [c.head],
      expressionVariant: [f], accessoriesVariant: c.acc ? [c.acc] : ["glasses"], accessoriesProbability: c.acc ? 100 : 0,
      facialHairVariant: c.beard ? [c.beard] : ["chin"], facialHairProbability: c.beard ? 100 : 0, maskProbability: 0,
    }).toString();
    fs.writeFileSync(`${dir}/faces/${who}-${f}.svg`, svg);
  }
  console.log(who, [...faces].join(" "));
}
