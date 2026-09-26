#!/usr/bin/env node
// Verify translated Spanish story files against their English source.
//
//   node tools/verify-es.mjs --scope=main_04
//   node tools/verify-es.mjs --keys=activities/act10d5/level_act10d5_st01,...
//
// Run this after every `translate.mjs --apply`. It checks the four things that
// have actually gone wrong in this project:
//
//   1. Tag drift   -- every [Command(...)] prefix, id and `values=` must be
//                     byte-identical to the source; only free text and the
//                     whitelisted name=/text=/options= values may differ.
//   2. Placeholders -- no stray {TOKn} (un-converted) and no leftover NUL bytes.
//   3. Decision arity -- `options=` must keep the same ';' count as its parallel
//                     `values=`, or choices desync from their branch ids.
//   4. Terms       -- no untranslated lore words left in the Spanish.
//
// Note on (1): some lines carry free text AFTER the closing ']' -- stage titles
// on [HEADER(...)] do this. That text is translatable, so the comparison marks
// it <TITLE> rather than treating the difference as drift. Without this the
// check reports false drift on essentially every file.

import { readFile } from "node:fs/promises";

const EN_BASE =
  "https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/en";
const NUL = String.fromCharCode(0);
const FORBIDDEN = /\bInfected\b|Oripathy|\bArts\b|\bCaster\b|Lanzador/;

function arg(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
}

async function targetKeys() {
  const explicit = arg("keys");
  if (explicit) return explicit.split(",").map((s) => s.trim()).filter(Boolean);
  const scope = arg("scope");
  if (!scope) {
    console.error("usage: node tools/verify-es.mjs --scope=main_NN | --keys=k1,k2");
    process.exit(1);
  }
  const table = await (await fetch(`${EN_BASE}/gamedata/excel/story_table.json`)).json();
  const stories = table.stories || table;
  // NOTE: matches `level_<scope>-` (hyphen). Side-story keys use an underscore
  // (level_act10d5_st01), so those need --keys=.
  const re = new RegExp(`/level_${scope}-`);
  return Object.keys(stories).filter((k) => re.test(k)).sort();
}

// Reduce a file to its structural skeleton: tag text with whitelisted attribute
// values blanked, free dialogue collapsed to <FREE>, trailing post-']' text to
// <TITLE>. Two files with the same skeleton differ only where they are allowed to.
const skeleton = (s) =>
  s
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t.startsWith("[")) return t === "" ? "" : "<FREE>";
      const close = line.lastIndexOf("]");
      const tag = line
        .slice(0, close + 1)
        .replace(/(name2?=)"(?:[^"\\]|\\.)*"/g, '$1""')
        .replace(/(text=)"(?:[^"\\]|\\.)*"/g, '$1""')
        .replace(/(options=)"(?:[^"\\]|\\.)*"/g, '$1""');
      return tag + (line.slice(close + 1).trim() ? " <TITLE>" : "");
    })
    .join("\n");

const keys = await targetKeys();
let drift = 0, strayTok = 0, strayNul = 0, decisions = 0, decisionBad = 0, terms = 0;

for (const key of keys) {
  const res = await fetch(`${EN_BASE}/gamedata/story/${key}.txt`);
  if (!res.ok) {
    console.log(`SKIP ${key} (EN source ${res.status})`);
    continue;
  }
  const en = await res.text();
  let es;
  try {
    es = await readFile(`gamedata/es_ES/story/${key}.txt`, "utf8");
  } catch {
    console.log(`MISSING ${key} (no Spanish file)`);
    drift++;
    continue;
  }

  const a = skeleton(en).split("\n");
  const b = skeleton(es).split("\n");
  if (a.join("\n") !== b.join("\n")) {
    drift++;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.log(`DRIFT ${key} line ${i}`);
        console.log(`   EN ${JSON.stringify(a[i])}`);
        console.log(`   ES ${JSON.stringify(b[i])}`);
        break;
      }
    }
  }
  if (/\{TOK\d+\}/.test(es)) { strayTok++; console.log(`STRAY {TOKn} in ${key}`); }
  if (es.includes(NUL))      { strayNul++; console.log(`NUL bytes in ${key}`); }

  for (const line of es.split(/\r?\n/)) {
    const o = line.match(/options="([^"]*)"/);
    const v = line.match(/values="([^"]*)"/);
    if (!o || !v) continue;
    decisions++;
    if (o[1].split(";").length !== v[1].split(";").length) {
      decisionBad++;
      console.log(`DECISION ARITY ${key}: ${line.slice(0, 100)}`);
    }
  }
  if (FORBIDDEN.test(es)) {
    terms++;
    const hit = es.split(/\r?\n/).find((l) => FORBIDDEN.test(l));
    console.log(`UNTRANSLATED TERM ${key}: ${hit.slice(0, 100)}`);
  }
}

const ok = !drift && !strayTok && !strayNul && !decisionBad && !terms;
console.log(
  `\nfiles: ${keys.length} | tag drift: ${drift} | stray {TOKn}: ${strayTok} | ` +
    `NUL: ${strayNul} | untranslated terms: ${terms}`,
);
console.log(`Decision lines: ${decisions} | option/value arity mismatches: ${decisionBad}`);
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
