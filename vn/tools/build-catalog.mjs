// node vn/tools/build-catalog.mjs /tmp/vn-catalog-source
// Large English source tables stay outside the site. See ../README.md.
import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storyOverrides } from '../story-overrides.mjs';
import { sourceMetadata } from './source-metadata.mjs';
import { soundPath } from '../assets.mjs';
const base = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Provide the directory containing the source JSON tables.');
const read = async (name) => JSON.parse(await readFile(resolve(source, name + '.json'), 'utf8'));
const [review, meta, table, operators, modules, rogue, variables] = await Promise.all([
  'story_review_table', 'story_review_meta_table', 'story_table', 'character_table',
  'uniequip_table', 'roguelike_topic_table', 'story_variables',
].map(read));
const categories = [
  ['main', 'main', 'Main Story', 'Historia principal'],
  ['side-stories', 'side', 'Side Stories', 'Historias secundarias'],
  ['vignettes', 'mini', 'Vignettes', 'Viñetas'],
  ['operator-records', 'record', 'Operator Records', 'Archivos de operador'],
  ['operator-modules', 'module', 'Operator Modules', 'Módulos de operador'],
  ['integrated-strategies', 'rogue', 'Integrated Strategies', 'Estrategias integradas'],
].map(([id, classic, en, es]) => ({ id, classic, name: { en, es } }));
let prior = { groups: [] };
try { prior = JSON.parse(await readFile(resolve(base, 'data/catalog.json'), 'utf8')); } catch { /* First build. */ }
const slugify = (value) => String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const names = Object.fromEntries(Object.entries(operators).map(([id, data]) => [id.split('_')[2], data.name || data.appellation]));
const groups = [];
async function add(id, classic, title, entries) {
  const category = categories.find((c) => c.classic === classic).id;
  const previous = prior.groups.find((g) => g.id === id && g.category === category);
  const chapter = classic === 'main' ? Number(id.split('_')[1]) : undefined;
  let slug = previous?.slug || (classic === 'main' ? `chapter-${chapter}` : slugify(title) || slugify(id));
  if (groups.some((g) => g.category === category && g.slug === slug)) slug += '-' + slugify(id);
  const stories = [];
  // Match the classic reader's stable sort, including intro/archive entries
  // without storySort. Its numeric fallback URLs depend on this ordering.
  entries.sort((a, b) => a.storySort - b.storySort);
  for (const [index, entry] of entries.entries()) {
    const key = entry.storyTxt;
    if (!key) throw new Error(`Missing storyTxt in ${id}`);
    const phase = /Before Operation/.test(entry.avgTag) ? 'before' : /After Operation/.test(entry.avgTag) ? 'after' : '';
    const name = entry.storyName || entry.storyCode || key.split('/').at(-1);
    let storySlug = previous?.stories.find((s) => s.id === key)?.slug || storyOverrides[key]?.slug ||
      slugify(entry.storyCode ? `${entry.storyCode}-${phase || name}` : name) || slugify(key.split('/').at(-1));
    if (stories.some((s) => s.slug === storySlug)) storySlug += `-${index + 1}`;
    let spanish = false;
    try { await access(resolve(base, '../gamedata/es_ES/story', key + '.txt')); spanish = true; } catch { /* Untranslated. */ }
    const source = spanish ? await sourceMetadata(key, variables) : null;
    stories.push({ id: key, slug: storySlug, title: name, code: entry.storyCode || '', phase,
      spanish, vn: !!source?.compatible.length, classicHash: `#${classic}&${id}&${index}`,
      ...(source ? { source } : {}),
    });
  }
  groups.push({ id, category, slug, title, ...(chapter !== undefined ? { chapter } : {}), stories });
}
for (const group of Object.values(review)) {
  const id = group.id;
  const entries = [...group.infoUnlockDatas];
  const extra = meta.actArchiveData?.components?.[id]?.avg?.avgs || {};
  for (const item of Object.values(extra).sort((a, b) => (a.avgSortId || 0) - (b.avgSortId || 0))) {
    const avg = meta.actArchiveResData.avgs[item.avgId];
    entries.push({ storyTxt: avg.contentPath, storyName: avg.desc, storyCode: avg.desc });
  }
  const main = id.startsWith('main_');
  const intro = entries[0]?.storyTxt.replace(/[^/]+$/, main ? `${id}_zone_enter` : `level_${id}_entry`);
  if (intro && table[intro]) entries.unshift({ storyTxt: intro, storyName: 'Introduction', storyCode: 'PV' });
  const type = main ? 'main' : id.startsWith('story_') ? 'record' : group.entryType.startsWith('MINI_') ? 'mini' : 'side';
  const title = type === 'record' ? `${names[id.split('_')[1]] || id.split('_')[1]} · ${group.name}` : group.name;
  await add(id, type, title, entries);
}
for (const id of Object.values(modules.charEquip).flatMap((ids) => ids.slice(1))) {
  const item = modules.equipDict[id], operator = operators[item.charId];
  if (!operator) continue;
  await add(id, 'module', `${operator.name || operator.appellation} · ${item.uniEquipName}`, [
    { storyName: item.uniEquipName, storyTxt: id },
  ]);
}
await add('rogue_0', 'rogue', "Ceobe's Fungimist", [
  { storyName: 'Entry', storyTxt: 'activities/act12d6/level_act12d6_entry' },
  ...['迷尘幻梦', '茫然行者', '归于荒野'].map((title, i) => ({ storyName: title, storyTxt: `activities/act12d6/level_act12d6_ending_${i + 1}` })),
]);
for (const [id, topic] of Object.entries(rogue.topics)) {
  const number = id.split('_')[1], detail = rogue.details[id];
  const entries = [{ storyName: 'Entry', storyTxt: `obt/roguelike/ro${number}/level_rogue${number}_entry` }];
  const endbook = detail.archiveComp.endbook.endbook;
  if (!Object.keys(endbook).length) {
    for (const [key, ending] of Object.entries(detail.endings)) entries.push({ storyName: ending.name,
      storyTxt: `obt/roguelike/ro${number}/level_rogue${number}_ending_${key.split('_').at(-1)}` });
  } else for (const ending of Object.values(endbook)) {
    entries.push({ storyName: ending.title, storyTxt: ending.avgId.toLowerCase() });
    for (const part of Object.values(ending.clientEndbookItemDatas)) entries.push({
      storyName: `${ending.title} - ${part.endbookName}`, storyTxt: part.textId.toLowerCase(),
    });
  }
  await add(id, 'rogue', topic.name, entries);
  for (const [index, [key, squad]] of Object.entries(detail.monthSquad).entries()) {
    const chat = detail.archiveComp.chat.chat[squad.chatId];
    const entries = Object.values(chat.clientChatItemData || chat.chatItemList).map((part) => ({
      storyName: `Floor ${part.chatFloor ?? part.floor}`, storyTxt: part.chatStoryId.toLowerCase(),
    }));
    await add(`${id}_${key}`, 'rogue', `${topic.name} · Squad ${index + 1} — ${squad.teamName}`, entries);
  }
}
groups.sort((a, b) => categories.findIndex((c) => c.id === a.category) - categories.findIndex((c) => c.id === b.category)
  || (a.category === 'main' ? a.chapter - b.chapter : a.title.localeCompare(b.title, 'en')));
const all = groups.flatMap((g) => g.stories);
for (const key of Object.keys(storyOverrides)) if (all.filter((s) => s.id === key && s.vn).length !== 1) throw new Error(`Existing playable story missing/unsupported: ${key}`);
const sounds = new Set(all.filter((s) => s.vn).flatMap((s) => s.source.sounds));
const audio = Object.fromEntries([...sounds].sort().map((key) => {
  if (!soundPath(variables, key)) throw new Error(`Unknown sound: ${key}`);
  return [key, soundPath(variables, key)];
}));
await mkdir(resolve(base, 'data'), { recursive: true });
await writeFile(resolve(base, 'data/catalog.json'), JSON.stringify({ v: 1, generated: new Date().toISOString().slice(0, 10),
  source: 'ArknightsAssets/ArknightsGamedata/en', categories, groups }) + '\n');
await writeFile(resolve(base, 'data/audio.json'), JSON.stringify(audio, null, 2) + '\n');
console.log(`${groups.length} collections, ${all.length} stories, ${all.filter((s) => s.spanish).length} Spanish, ${all.filter((s) => s.vn).length} VN, ${sounds.size} sounds.`);
