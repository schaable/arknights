#!/usr/bin/env node
// Seed tools/glossary.es.json for the Spanish translation pipeline.
//
//   node tools/seed-glossary.mjs           # write glossary.es.json (merges, keeps
//                                          # any hand-added terms/overrides already there)
//
// Policy (confirmed): keep operator/faction proper nouns in English; translate
// common nouns and role/class words. So:
//   - every operator/npc `name` + `appellation` from character_table -> doNotTranslate
//   - curated story-NPC codenames + faction names             -> doNotTranslate
//   - class labels (from js/util.js CLASS_MAPPING) + role phrases + lore -> terms
//
// Re-running is safe: existing `terms` and `overrides` in the file are preserved;
// the auto-derived doNotTranslate set is regenerated and merged with the curated one.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "glossary.es.json");
const EN_BASE =
  "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/en";

// Story-only NPCs / factions / proper nouns not in the playable character_table.
// Kept verbatim in Spanish (the "keep English codenames" decision).
const CURATED_DNT = [
  // Prologue + Chapter 1 speaking NPCs
  "Ace", "Mephisto", "Talulah", "FrostNova", "Frostnova", "Skullshatterer",
  "Kal'tsit", "Closure", "Doctor", "Faust",
  // factions / orgs / places
  "Reunion", "Rhodes Island", "Ursus", "Lungmen", "Victoria",
  // "Children of Ursus" (act10d5) speaking NPCs — story-only, so they are not in
  // character_table and would be dropped by a re-seed if they lived only in the JSON
  "Natalya", "Rosalind", "Sonya", "Valery", "Anna", "Pavel", "Lada", "Nikola",
  "Tatyana", "Anton", "Andrey", "Viktor", "Compass",
  // lore proper nouns (Originium/Sarkaz stay verbatim; Oripathy/Infected are
  // translated — see CURATED_TERMS)
  "Originium", "Sarkaz",
  // placeholder / unknown speaker
  "???",
];

// EN class name (from CLASS_MAPPING in js/util.js) -> Spanish, plus role/common-noun
// labels the story uses as speaker names, plus lore common nouns.
const CURATED_TERMS = {
  // classes
  Guard: "Guardia",
  Supporter: "Soporte",
  Caster: "Hechicero",
  Sniper: "Francotirador",
  Defender: "Defensor",
  Vanguard: "Vanguardia",
  Specialist: "Especialista",
  Medic: "Médico",
  // generic speaker labels seen in the corpus
  Female: "Mujer",
  Male: "Hombre",
  Civilian: "Civil",
  Soldier: "Soldado",
  "Reunion Member": "Miembro de Reunion",
  "Reunion Member A": "Miembro de Reunion A",
  "Reunion Member B": "Miembro de Reunion B",
  "Ursus Captain": "Capitán de Ursus",
  "Ursus Guard": "Guardia de Ursus",
  "TV Host": "Presentador de TV",
  Child: "Niño",
  // lore common nouns (translate; the faction/place proper nouns stay in DNT)
  Catastrophe: "Catástrofe",
  Infected: "Infectado", // gender/number agreement is applied per-line by hand
  Oripathy: "Oripatía",
  Arts: "Artes",
  Originium: "Originium", // stays verbatim, but pin it so MT never drifts
};

async function main() {
  const res = await fetch(`${EN_BASE}/gamedata/excel/character_table.json`);
  const table = await res.json();
  const names = new Set();
  for (const v of Object.values(table)) {
    if (v?.name?.trim()) names.add(v.name.trim());
    if (v?.appellation?.trim()) names.add(v.appellation.trim());
  }
  for (const n of CURATED_DNT) names.add(n);

  // preserve hand-added terms/overrides from an existing glossary
  let existing = { terms: {}, overrides: {} };
  if (existsSync(OUT)) existing = JSON.parse(await readFile(OUT, "utf8"));

  const glossary = {
    _note:
      "Auto-seeded by tools/seed-glossary.mjs. doNotTranslate = proper nouns kept " +
      "verbatim; terms = fixed EN->ES translations. Edit `terms`/`overrides` and " +
      "re-run seed (they are preserved). `overrides` key: '<file>::<segId>'.",
    doNotTranslate: [...names].sort((a, b) => a.localeCompare(b)),
    terms: { ...CURATED_TERMS, ...(existing.terms || {}) },
    overrides: existing.overrides || {},
  };

  await writeFile(OUT, JSON.stringify(glossary, null, 2) + "\n", "utf8");
  console.log(
    `Wrote ${OUT}\n  doNotTranslate: ${glossary.doNotTranslate.length}\n` +
      `  terms: ${Object.keys(glossary.terms).length}`,
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
