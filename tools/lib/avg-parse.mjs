// AVG script segmenter for the Arknights Story Reader translation pipeline.
//
// Mirrors the renderer's own per-line parse (js/story.js: /^(\[[^\]]+])?(.*)?$/gim):
// each line is an optional leading [Command(...)] tag followed by free dialogue text.
// We extract ONLY translatable spans and record each one's absolute [start, end)
// offset in the original file, so the driver can splice translations back in place
// and leave every byte outside those spans (tags, ids, refs, `values=`) untouched.
//
// Translatable spans (whitelist — nothing else is touched):
//   1. Free text  — the dialogue after the leading tag.
//   2. name=/name2= — ONLY on a bare [name=...] / [name2=...] speaker tag or a
//      [Character(...)] tag; NEVER on [characteraction(...)] (there name= is a
//      stage position). Skipped when the value is an id (char_/avg_/npc_ prefix,
//      or contains $ or #), a stage-position keyword, or a do-not-translate term.
//   3. text=      — ONLY on [Subtitle(...)] / [Sticker(...)].
//   4. options=   — ONLY on [Decision(...)]; the parallel values= is never touched.

const POSITION_KEYWORDS = new Set([
  "left",
  "right",
  "center",
  "centre",
  "mid",
  "middle",
  "none",
]);

// value looks like an internal id / reference rather than a display label
function isIdLike(v) {
  return /^(char_|avg_|npc_)/i.test(v) || v.includes("$") || v.includes("#");
}

function isTranslatableName(command, value, doNotTranslate) {
  const cmd = command.toLowerCase();
  // only speaker tags and Character carry a human-facing name
  if (cmd !== "name" && cmd !== "name2" && cmd !== "character") return false;
  const v = value.trim();
  if (!v) return false;
  if (isIdLike(v)) return false;
  if (POSITION_KEYWORDS.has(v.toLowerCase())) return false;
  if (doNotTranslate.has(v)) return false;
  return true;
}

// Returns { segments: [{start, end, value, kind, command, line}], warnings: [] }.
// kind is one of "free" | "name" | "text" | "options".
export function extractSegments(content, glossary = {}) {
  const doNotTranslate = new Set(glossary.doNotTranslate || []);
  const segments = [];
  const warnings = [];

  let offset = 0;
  const lines = content.split(/(?<=\n)/); // keep line terminators attached
  let lineNo = 0;
  for (const rawLine of lines) {
    lineNo += 1;
    const line = rawLine.replace(/\r?\n$/, "");
    const lineStart = offset;
    offset += rawLine.length;

    const m = /^(\[[^\]]+\])?([\s\S]*)$/.exec(line);
    if (!m) continue;
    const tag = m[1] || "";
    const free = m[2] || "";
    const freeStart = lineStart + tag.length;

    // Heuristic: an unbalanced attribute quote pushed into "free text" means a
    // literal ] inside a tag value broke the leading-tag match. Flag, don't guess.
    if (free.includes('="') && /\)\s*\]/.test(free)) {
      warnings.push(
        `line ${lineNo}: possible tag boundary inside value — left untranslated`,
      );
    } else if (free.trim()) {
      // free dialogue text: record the trimmed core, preserve surrounding space
      const lead = free.length - free.trimStart().length;
      const core = free.trim();
      segments.push({
        start: freeStart + lead,
        end: freeStart + lead + core.length,
        value: core,
        kind: "free",
        command: "",
        line: lineNo,
      });
    }

    if (tag) {
      const cmdMatch = /^\[\s*([A-Za-z_][\w]*)/.exec(tag);
      const command = cmdMatch ? cmdMatch[1] : "";
      const cmdLower = command.toLowerCase();
      // never translate stage-position attrs
      const attrAllowed = cmdLower !== "characteraction";
      const attrRe = /(name2|name|text|options)\s*=\s*"([^"]*)"/gi;
      let a;
      while ((a = attrRe.exec(tag)) !== null) {
        const key = a[1].toLowerCase();
        const value = a[2];
        // offset of the value (inside the quotes) within the file
        const valueStart = lineStart + a.index + a[0].indexOf('"') + 1;
        const seg = {
          start: valueStart,
          end: valueStart + value.length,
          value,
          command,
          line: lineNo,
        };
        if ((key === "name" || key === "name2") && attrAllowed) {
          if (isTranslatableName(command, value, doNotTranslate)) {
            segments.push({ ...seg, kind: "name" });
          }
        } else if (key === "text" && (cmdLower === "subtitle" || cmdLower === "sticker")) {
          if (value.trim()) segments.push({ ...seg, kind: "text" });
        } else if (key === "options" && cmdLower === "decision") {
          if (value.trim()) segments.push({ ...seg, kind: "options" });
        }
      }
    }
  }

  // splice right-to-left, so keep segments sorted by start ascending here and let
  // the caller reverse; also dedupe accidental overlaps defensively.
  segments.sort((x, y) => x.start - y.start);
  return { segments, warnings };
}

// Reassemble a file: apply { start, end, replacement } edits right-to-left so
// earlier offsets stay valid. Everything outside the edits is byte-identical.
export function applyEdits(content, edits) {
  const sorted = [...edits].sort((x, y) => y.start - x.start);
  let out = content;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
}
