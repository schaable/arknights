#!/usr/bin/env node
// Merge authored translations into the translation memory, with validation.
//
//   node tools/merge-tm.mjs <batch.json> <translations.json>
//
// <batch.json>        the file `translate.mjs --export` produced (masked keys).
// <translations.json> a positional JSON ARRAY of Spanish strings, index-aligned
//                     with Object.keys(batch) -- i.e. the same order as the
//                     readable file from to-readable.mjs.
//
// Why a positional array and not a { source: translation } map: the masked keys
// contain NUL bytes, so re-typing them invites silent corruption. Pairing by
// index sidesteps that, and because tokens are scattered unevenly through the
// text, the token-set check below also catches an off-by-one misalignment.
//
// Nothing is written unless every segment passes. On failure the TM is left
// untouched and the offending indices are printed.

import { readFile, writeFile } from "node:fs/promises";

const TM_PATH = "tools/tm.es.json";
const NUL = String.fromCharCode(0);
const NUL_TOKEN = new RegExp(NUL + "(\\d+)" + NUL, "g");
const BRACE_TOKEN = /\{TOK(\d+)\}/g;

// English (or wrong-Spanish) terms that must never survive into a translation.
// These are the lore words the glossary pins; "Lanzador" is a bad rendering of
// Caster that slipped in early on. Extend as new recurring mistakes show up.
const FORBIDDEN = /\bInfected\b|Oripathy|\bArts\b|\bCaster\b|Lanzador/;

const [, , batchPath, trPath] = process.argv;
if (!batchPath || !trPath) {
  console.error("usage: node tools/merge-tm.mjs <batch.json> <translations.json>");
  process.exit(1);
}

const batch = JSON.parse(await readFile(batchPath, "utf8"));
const tr = JSON.parse(await readFile(trPath, "utf8"));
const tm = JSON.parse(await readFile(TM_PATH, "utf8"));

if (!Array.isArray(tr)) {
  console.error("FAILED: <translations.json> must be a JSON array, positionally aligned with the batch.");
  process.exit(1);
}

const keys = Object.keys(batch);
const errs = [];
if (tr.length !== keys.length) {
  errs.push(`length mismatch: batch has ${keys.length}, translations has ${tr.length}`);
}

const tokenSet = (s, re) => {
  const set = new Set();
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(s))) set.add(m[1]);
  return [...set].sort().join(",");
};

const staged = [];
for (let i = 0; i < Math.min(tr.length, keys.length); i++) {
  const src = keys[i];
  const val = tr[i];
  const readable = () => JSON.stringify(src.replace(NUL_TOKEN, (_, x) => `{TOK${x}}`));

  if (typeof val !== "string" || val.trim() === "") {
    errs.push(`[${i}] empty translation :: ${readable()}`);
    continue;
  }
  // Placeholder integrity (also catches array misalignment).
  const a = tokenSet(src, NUL_TOKEN);
  const b = tokenSet(val, BRACE_TOKEN);
  if (a !== b) {
    errs.push(`[${i}] token-set {${a}} vs {${b}} :: ${readable()} => ${JSON.stringify(val)}`);
    continue;
  }
  // `options=` on [Decision] is ';'-separated and runs parallel to an untouched
  // `values=`; changing the ';' count desyncs choices from their branch ids.
  const srcSemis = (src.match(/;/g) || []).length;
  const trSemis = (val.match(/;/g) || []).length;
  if (srcSemis !== trSemis) {
    errs.push(`[${i}] ';' arity ${srcSemis} vs ${trSemis} :: ${JSON.stringify(val)}`);
    continue;
  }
  if (FORBIDDEN.test(val)) {
    errs.push(`[${i}] untranslated term :: ${JSON.stringify(val)}`);
    continue;
  }
  staged.push([src, val.replace(BRACE_TOKEN, (_, x) => NUL + x + NUL)]);
}

if (errs.length) {
  console.error(`FAILED (${errs.length} error(s)) -- TM not modified:`);
  errs.slice(0, 40).forEach((e) => console.error("  " + e));
  if (errs.length > 40) console.error(`  ... and ${errs.length - 40} more`);
  process.exit(1);
}

for (const [k, v] of staged) tm[k] = v;
await writeFile(TM_PATH, JSON.stringify(tm, null, 2) + "\n", "utf8");
console.log(`OK: merged ${staged.length} segments. ${TM_PATH} now has ${Object.keys(tm).length} entries.`);
