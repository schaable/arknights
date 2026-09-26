#!/usr/bin/env node
// Turn an exported batch into an authorable, "readable" batch.
//
//   node tools/to-readable.mjs <batch.json> <readable.json>
//
// `translate.mjs --export` writes { "<masked source>": "" }. Inside those keys,
// in-text markup ({@nickname}, <color=..>, \n, ...) has been replaced by
// placeholders that are delimited by literal NUL (U+0000) bytes. NULs are
// invisible in most editors and cannot be hand-typed reliably, so this rewrites
// each one as {TOK0}, {TOK1}, ... Author against the readable file; then
// `merge-tm.mjs` converts {TOKn} back to NUL when writing the TM.
//
// Placeholders must survive translation verbatim -- a dropped or renumbered one
// corrupts the markup when it is unmasked.

import { readFile, writeFile } from "node:fs/promises";

const NUL = String.fromCharCode(0);
const NUL_TOKEN = new RegExp(NUL + "(\\d+)" + NUL, "g");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node tools/to-readable.mjs <batch.json> <readable.json>");
  process.exit(1);
}

const batch = JSON.parse(await readFile(inPath, "utf8"));
const readable = {};
const collisions = [];

for (const masked of Object.keys(batch)) {
  const key = masked.replace(NUL_TOKEN, (_, n) => `{TOK${n}}`);
  if (key in readable) collisions.push(key);
  readable[key] = "";
}

const stillNul = Object.keys(readable).filter((k) => k.includes(NUL));

await writeFile(outPath, JSON.stringify(readable, null, 2) + "\n", "utf8");

console.log(`wrote ${outPath}`);
console.log(`  segments:        ${Object.keys(readable).length}`);
console.log(`  with {TOKn}:     ${Object.keys(readable).filter((k) => /\{TOK\d+\}/.test(k)).length}`);
console.log(`  readable dupes:  ${collisions.length}`);
console.log(`  NUL left over:   ${stillNul.length}`);

// A collision or a leftover NUL means the positional array authored against this
// file will not line up 1:1 with the batch -- stop rather than translate blind.
if (collisions.length || stillNul.length) {
  console.error("\nFAILED: readable form is not 1:1 with the batch.");
  collisions.slice(0, 5).forEach((c) => console.error("  dupe: " + JSON.stringify(c)));
  process.exit(1);
}
