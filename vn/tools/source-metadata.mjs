import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectScript, scriptSignature } from '../compatibility.mjs';
import { storyOverrides } from '../story-overrides.mjs';
import { soundPath } from '../assets.mjs';

export async function sourceMetadata(key, variables) {
  const locations = {
    es: `../gamedata/es_ES/story/${key}.txt`,
    en: `./sources/en/${key}.txt`,
  };
  const languages = {}, inspections = {}, issues = [], hashes = {}, sounds = new Set();
  for (const [language, url] of Object.entries(locations)) {
    let text;
    try { text = await readFile(new URL('../' + url, import.meta.url), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    languages[language] = url;
    hashes[language] = createHash('sha256').update(text).digest('hex');
    const inspection = inspectScript(text);
    inspections[language] = inspection;
    for (const issue of inspection.issues) issues.push({ language, ...issue });
    for (const sound of inspection.soundKeys || []) {
      if (soundPath(variables, sound)) sounds.add(sound);
      else issues.push({ language, code: 'audio', detail: `Missing sound: ${sound}` });
    }
  }
  // Untranslated catalog entries remain in the classic reader for this rollout.
  if (!languages.es) return null;
  const compatible = Object.entries(inspections).filter(([language, result]) =>
    !result.issues.length && !issues.some((i) => i.language === language && i.code === 'audio')).map(([language]) => language);
  const aligned = compatible.length === 2 && scriptSignature(inspections.es.commands) === scriptSignature(inspections.en.commands);
  if (compatible.length === 2 && !aligned) issues.push({ code: 'alignment', detail: 'Language scripts have different command structures' });
  const cover = storyOverrides[key]?.cover || inspections.es.cover || inspections.en?.cover || null;
  const canonical = compatible.includes('es') ? inspections.es.commands
    : compatible.includes('en') ? inspections.en.commands : null;
  const structure = canonical ? createHash('sha256').update(scriptSignature(canonical)).digest('hex') : null;
  return { format: 'avg', languages, hashes, structure, compatible, aligned, cover, sounds: [...sounds].sort(), issues };
}
