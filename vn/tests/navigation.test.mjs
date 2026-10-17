import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeFor, resolveRoute, groupKey, groupStats } from '../catalog.mjs';
import { createProgressStore, STORAGE_KEY, LEGACY_KEY, normalizeStore } from '../storage.mjs';
import { parseScript, buildTimeline, validateProgress } from '../script.mjs';
import { scriptSignature } from '../compatibility.mjs';
import { recentGroups } from '../library.mjs';
const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
const audio = JSON.parse(await readFile(new URL('../data/audio.json', import.meta.url)));
const group = (id) => catalog.groups.find((g) => g.id === id);
const prologue = group('main_0').stories[0];
const memory = () => {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
const progress = (line, read = false) => ({ line, read, answers: {}, updated: line * 1000 });

test('catalog routes round-trip uniquely for all categories, collections and stories', () => {
  const routes = new Set();
  for (const category of catalog.categories) {
    assert.equal(resolveRoute(routeFor(category), catalog).kind, 'category');
    assert.ok(catalog.groups.some((g) => g.category === category.id));
  }
  for (const g of catalog.groups) {
    const url = routeFor(g.category, g);
    assert.equal(routes.has(url), false); routes.add(url);
    assert.equal(resolveRoute(url, catalog).group.id, g.id);
    for (const story of g.stories) {
      const path = routeFor(g.category, g, story);
      assert.equal(routes.has(path), false, path); routes.add(path);
      const route = resolveRoute(path, catalog);
      assert.equal(route.story.id, story.id);
      assert.equal(route.kind, story.vn ? 'story' : 'unavailable');
    }
  }
  for (const url of ['#/unknown', '#/%E0%A4%A', '#/main/invalid', '#/main/chapter-0/invalid', '#/main/chapter-0/prologue-1/extra', '#main&main_0&0']) {
    assert.equal(resolveRoute(url, catalog).kind, 'missing', url);
  }
  assert.equal(resolveRoute('', catalog).kind, 'home');
  assert.equal(resolveRoute('#/', catalog).kind, 'home');
  assert.equal(resolveRoute('#/vignettes/children-of-ursus/habits', catalog).story.id, 'activities/act10d5/level_act10d5_st01');
});

test('all chapters are ordered; translation and VN availability remain independent', () => {
  const chapters = catalog.groups.filter((g) => g.category === 'main');
  assert.ok(chapters.length >= 18);
  assert.deepEqual(chapters.map((g) => g.chapter), [...chapters.map((g) => g.chapter)].sort((a, b) => a - b));
  assert.equal(catalog.groups.flatMap((g) => g.stories).filter((s) => s.vn).length, 113);
  assert.equal(catalog.groups.flatMap((g) => g.stories).filter((s) => s.spanish).length, 113);
  assert.equal(group('main_0').stories[1].slug, 'prologue-2');
  assert.equal(group('main_1').stories[0].slug, '1-1-before');
  assert.equal(group('main_0').stories[1].classicHash, '#main&main_0&1');
});

test('legacy progress migrates once, keeps preferences, and never destroys the v1 backup', () => {
  const storage = memory();
  const legacy = { v: 1, preferences: { language: 'en', speed: 0, nickname: 'Test', motion: true },
    stories: { [prologue.id]: { ...progress(157), answers: { 151: '1' } } } };
  storage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  const store = createProgressStore(storage, catalog);
  assert.equal(store.group(group('main_0')).resume, prologue.id);
  assert.equal(store.group(group('main_0')).stories[prologue.id].line, 157);
  assert.equal(store.snapshot().preferences.language, 'en');
  assert.equal(storage.getItem(LEGACY_KEY), JSON.stringify(legacy));
  store.save(group('main_0'), prologue, progress(160));
  assert.equal(createProgressStore(storage, catalog).group(group('main_0')).stories[prologue.id].line, 160);
});

test('chapter and event saves are independent, browsing is read-only, restart is local', () => {
  const storage = memory(), store = createProgressStore(storage, catalog);
  const groups = ['main_0', 'main_1', 'act10d5', 'story_rope_set_1', 'story_12fce_set_1'].map(group);
  groups.forEach((g, i) => store.save(g, g.stories[0], progress(i + 10, true)));
  const first = groups[0], second = first.stories[1];
  store.save(first, second, progress(42));
  assert.equal(store.group(first).resume, second.id);
  assert.equal(store.group(first).stories[prologue.id].line, 10);
  const bytes = storage.getItem(STORAGE_KEY);
  groups.forEach((g) => store.group(g)); store.snapshot();
  assert.equal(storage.getItem(STORAGE_KEY), bytes, 'browsing must not change saves');
  store.save(first, second, progress(1));
  assert.equal(store.group(first).stories[prologue.id].read, true);
  groups.slice(1).forEach((g, i) => assert.equal(store.group(g).stories[g.stories[0].id].line, i + 11));
  const stats = groupStats(first, store.group(first));
  assert.equal(stats.read, 1); assert.equal(stats.total, 14); assert.equal(stats.ready, 14);
  const reloaded = createProgressStore(storage, catalog);
  assert.equal(reloaded.group(first).stories[second.id].line, 1);
});

test('saves merge other tabs; malformed/blocked storage stays usable', () => {
  const storage = memory(), a = createProgressStore(storage, catalog), b = createProgressStore(storage, catalog);
  a.save(group('main_0'), prologue, progress(10));
  b.save(group('main_1'), group('main_1').stories[0], progress(20));
  assert.equal(a.snapshot().groups[groupKey(group('main_1'))].stories[group('main_1').stories[0].id].line, 20);
  storage.setItem(STORAGE_KEY, '{oops');
  assert.deepEqual(createProgressStore(storage, catalog).snapshot().groups, {});
  const blocked = createProgressStore(undefined, catalog);
  assert.equal(blocked.save(group('main_0'), prologue, progress(10)), false);
  assert.equal(blocked.group(group('main_0')).stories[prologue.id].line, 10);
  const dirty = normalizeStore({ v: 2, preferences: { speed: -1 }, groups: { [groupKey(group('main_0'))]: {
    resume: 'nonexistent', stories: { [prologue.id]: { line: -5 }, invalid: progress(5) },
  } } }, catalog);
  assert.deepEqual(dirty.groups, {}); assert.equal(dirty.preferences.speed, 45);
});

test('continue reading keeps only the latest playable bookmark per category, in recency order', () => {
  const sample = { categories: catalog.categories, groups: catalog.categories.flatMap((category, index) => [0, 1].map((number) => ({
    category: category.id, id: `${index}-${number}`, stories: [{ id: `${index}-${number}`, vn: true }],
  }))) };
  const storage = memory(), store = createProgressStore(storage, sample);
  sample.groups.forEach((g, index) => store.save(g, g.stories[0], progress(index + 1)));
  const expected = sample.groups.filter((_, index) => index % 2 === 1).reverse();
  assert.deepEqual(recentGroups(sample, store), expected);
  store.setRead(sample.groups[0], sample.groups[0].stories[0], true);
  assert.deepEqual(recentGroups(sample, store), expected, 'marking read must not change recency');
  const unavailable = sample.groups.at(-1);
  unavailable.stories[0].vn = false;
  assert.equal(recentGroups(sample, store)[0], sample.groups.at(-2), 'skip unavailable resume targets');
  assert.equal(Object.keys(store.snapshot().groups).length, sample.groups.length, 'older bookmarks remain saved');
});

test('manual completion survives reload without inventing a position or resume target', () => {
  const storage = memory(), store = createProgressStore(storage, catalog), g = group('main_0');
  assert.equal(store.setRead(g, prologue, true), true);
  const restored = createProgressStore(storage, catalog);
  assert.deepEqual(restored.group(g).stories[prologue.id], { read: true });
  assert.equal(restored.group(g).resume, null);
  assert.equal(groupStats(g, restored.group(g)).read, 1);
  assert.deepEqual(recentGroups(catalog, restored), []);
  restored.setRead(g, prologue, false);
  assert.deepEqual(createProgressStore(storage, catalog).snapshot().groups, {});
  assert.equal(restored.save(g, prologue, { read: true }), false, 'position saves still require a valid line');
});

test('read toggles reset only this story position and branches, preserving resume order and other tabs', () => {
  const storage = memory(), a = createProgressStore(storage, catalog), b = createProgressStore(storage, catalog);
  const g = group('main_0'), sibling = g.stories[1], other = group('main_1');
  const saved = { ...progress(157), answers: { 143: '2' }, structure: 'a'.repeat(64) };
  a.save(g, prologue, saved); a.save(g, sibling, progress(200));
  b.save(other, other.stories[0], progress(300));
  a.setRead(g, prologue, true);
  assert.deepEqual(a.group(g).stories[prologue.id], { read: true, updated: saved.updated });
  assert.equal(a.group(g).resume, sibling.id); assert.equal(a.group(g).updated, 200000);
  assert.equal(a.group(other).stories[other.stories[0].id].line, 300);
  b.setRead(g, prologue, false); a.snapshot();
  assert.deepEqual(a.group(g).stories[prologue.id], { read: false, updated: saved.updated });
  assert.equal(a.group(g).stories[sibling.id].line, 200);
  assert.equal(a.setRead(other, prologue, true), false);
});

test('manual read opens the ending without invented choices; unread opens the beginning', async () => {
  const commands = parseScript(await readFile(new URL(`../../gamedata/es_ES/story/${prologue.id}.txt`, import.meta.url), 'utf8'));
  const store = createProgressStore(memory(), catalog), g = group('main_0');
  store.save(g, prologue, { ...progress(157), answers: { 143: '2' } });
  store.setRead(g, prologue, true);
  const completed = validateProgress(commands, store.group(g).stories[prologue.id]);
  assert.equal(completed.timeline[completed.index].kind, 'end');
  assert.deepEqual(completed.answers, {});
  assert.equal(completed.timeline.filter((step) => step.kind === 'choice').length, 0);
  assert.equal(store.snapshot().groups[groupKey(g)].resume, prologue.id);
  store.setRead(g, prologue, false);
  const reset = validateProgress(commands, store.group(g).stories[prologue.id]);
  assert.equal(reset.index, 0);
  assert.equal(reset.timeline[0].line, buildTimeline(commands)[0].line);
  assert.deepEqual(reset.answers, {});
});

test('classic-only stories can be marked read; denied storage retains the mark for this tab', () => {
  const g = catalog.groups.find((g) => g.stories.some((s) => !s.vn)), story = g.stories.find((s) => !s.vn);
  const storage = memory(), store = createProgressStore(storage, catalog);
  assert.equal(store.setRead(g, story, true), true);
  assert.equal(createProgressStore(storage, catalog).group(g).stories[story.id].read, true);
  assert.deepEqual(recentGroups(catalog, store), []);
  const blocked = createProgressStore(undefined, catalog);
  assert.equal(blocked.setRead(g, story, true), false);
  assert.equal(blocked.snapshot().groups[groupKey(g)].stories[story.id].read, true);
  assert.equal(blocked.setRead(g, story, false), false);
  assert.deepEqual(blocked.snapshot().groups, {});
});

for (const story of catalog.groups.flatMap((g) => g.stories).filter((s) => s.vn)) test(`bilingual full playback and audio coverage: ${story.id}`, async () => {
  const key = story.id;
  const [es, en] = await Promise.all([
    readFile(new URL(`../../gamedata/es_ES/story/${key}.txt`, import.meta.url), 'utf8'),
    readFile(new URL('../' + story.source.languages.en, import.meta.url), 'utf8'),
  ]);
  const scripts = [es, en].map(parseScript);
  assert.equal(scriptSignature(scripts[0]), scriptSignature(scripts[1]));
  const answers = Object.fromEntries(scripts[0].filter((s) => s.command === 'decision').map((s) => [s.line, s.args.values.split(';')[0]]));
  const timelines = scripts.map((script) => buildTimeline(script, answers));
  assert.equal(timelines[0].at(-1).kind, 'end');
  assert.deepEqual(timelines[0].map((s) => s.state), timelines[1].map((s) => s.state));
  const sample = timelines[0][Math.floor(timelines[0].length / 2)];
  const saved = validateProgress(scripts[1], { line: sample.line, answers });
  assert.equal(saved.timeline[saved.index].line, sample.line);
  for (const match of es.matchAll(/(?:key|intro)="\$([^"]+)"/g)) assert.ok(audio[match[1]], match[1]);
  for (const step of timelines[0]) for (const name of step.state.characters) assert.equal(name, name.trim());
});
