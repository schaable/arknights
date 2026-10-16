import { groupKey } from './catalog.mjs';
export const STORAGE_KEY = 'arknights.vn.v2';
export const LEGACY_KEY = 'arknights.vn.v1';
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const integer = (v) => Number.isSafeInteger(v) && v >= 0 ? v : 0;
export function cleanPreferences(value = {}) {
  return { language: value?.language === 'en' ? 'en' : 'es',
    nickname: typeof value?.nickname === 'string' ? value.nickname.slice(0, 32) : '',
    speed: [0, 25, 45].includes(value?.speed) ? value.speed : 45,
    ...(typeof value?.motion === 'boolean' ? { motion: value.motion } : {}) };
}
function cleanStory(value) {
  if (!object(value) || !Number.isSafeInteger(value.line) || value.line < 1) return null;
  const answers = Object.fromEntries(Object.entries(object(value.answers) ? value.answers : {})
    .filter(([line, answer]) => /^\d+$/.test(line) && typeof answer === 'string' && answer.length < 100));
  return { line: value.line, answers, read: value.read === true, updated: integer(value.updated) };
}
export function normalizeStore(value, catalog) {
  const result = { v: 2, preferences: cleanPreferences(value?.preferences), groups: {} };
  if (value?.v !== 2 || !object(value.groups)) return result;
  for (const group of catalog.groups) {
    const saved = value.groups[groupKey(group)];
    if (!object(saved) || !object(saved.stories)) continue;
    const stories = {};
    for (const story of group.stories) {
      const clean = cleanStory(saved.stories[story.id]);
      if (clean) stories[story.id] = clean;
    }
    if (Object.keys(stories).length) result.groups[groupKey(group)] = {
      resume: Object.hasOwn(stories, saved.resume) ? saved.resume : Object.keys(stories).sort((a, b) => stories[b].updated - stories[a].updated)[0],
      stories, updated: integer(saved.updated),
    };
  }
  return result;
}
export function migrateLegacy(legacy, catalog) {
  const candidate = { v: 2, preferences: legacy?.preferences, groups: {} };
  if (legacy?.v === 1 && object(legacy.stories)) for (const group of catalog.groups) {
    const stories = Object.fromEntries(group.stories.filter((s) => Object.hasOwn(legacy.stories, s.id)).map((s) => [s.id, legacy.stories[s.id]]));
    if (Object.keys(stories).length) candidate.groups[groupKey(group)] = { stories };
  }
  return normalizeStore(candidate, catalog);
}
function read(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}
// Memory state remains usable for the current tab if storage is denied/full.
// Writes merge the latest persisted groups, preserving other tabs' collections.
export function createProgressStore(storage, catalog) {
  const current = read(storage, STORAGE_KEY);
  let data = current?.v === 2 ? normalizeStore(current, catalog) : migrateLegacy(read(storage, LEGACY_KEY), catalog);
  let writable = true;
  const write = () => {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(data)); writable = true; }
    catch { writable = false; }
    return writable;
  };
  if (current?.v !== 2 && read(storage, LEGACY_KEY)?.v === 1) write();
  const refresh = () => {
    const latest = read(storage, STORAGE_KEY);
    if (writable && latest?.v === 2) data = normalizeStore(latest, catalog);
  };
  return {
    snapshot() { refresh(); return structuredClone(data); },
    group(group) { return structuredClone(data.groups[groupKey(group)] || { stories: {}, resume: null }); },
    save(group, story, progress) {
      refresh();
      if (!group.stories.some((s) => s.id === story.id)) return false;
      const clean = cleanStory(progress);
      if (!clean) return false;
      const key = groupKey(group);
      const saved = data.groups[key] ||= { stories: {} };
      saved.stories[story.id] = clean;
      saved.resume = story.id;
      saved.updated = clean.updated;
      return write();
    },
    preferences(preferences) { refresh(); data.preferences = cleanPreferences(preferences); return write(); },
  };
}
