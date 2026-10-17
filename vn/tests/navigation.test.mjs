import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeFor, resolveRoute, groupKey, groupStats } from '../catalog.mjs';
import { createProgressStore, STORAGE_KEY, LEGACY_KEY, normalizeStore } from '../storage.mjs';
import { parseScript, buildTimeline, validateProgress } from '../script.mjs';
import { scriptSignature } from '../compatibility.mjs';
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
