import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeFor, resolveRoute, groupKey, groupStats, isOperatorCategory, operatorsFor, topicsFor } from '../catalog.mjs';
import { createProgressStore, STORAGE_KEY, LEGACY_KEY, normalizeStore } from '../storage.mjs';
import { parseScript, buildTimeline, validateProgress } from '../script.mjs';
import { scriptSignature } from '../compatibility.mjs';
import { recentGroups, resumeStory } from '../library.mjs';
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
    for (const operator of operatorsFor(catalog, category)) {
      const url = routeFor(category, operator);
      assert.equal(routes.has(url), false, url); routes.add(url);
      const route = resolveRoute(url, catalog);
      assert.equal(route.kind, 'operator');
      assert.equal(route.operator.id, operator.id);
      assert.ok(route.operator.groups.every((g) => g.category === category.id && g.operatorId === operator.id));
      assert.equal(resolveRoute(url + '/unknown', catalog).kind, 'missing');
    }
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

test('IS topics contain each collection once, in topic/squad order, with existing story routes', () => {
  const topics = topicsFor(catalog);
  const groups = catalog.groups.filter((g) => g.category === 'integrated-strategies');
  assert.equal(topics.length, 6);
  assert.deepEqual(topics.map((topic) => topic.id), ['rogue_0', 'rogue_1', 'rogue_2', 'rogue_3', 'rogue_4', 'rogue_5']);
  assert.deepEqual(topics.flatMap((topic) => topic.groups.map((g) => g.id)).sort(), groups.map((g) => g.id).sort());
  assert.deepEqual(topicsFor(catalog, 'main'), []);
  for (const topic of topics) {
    const main = topic.groups[0];
    assert.equal(main.id, topic.id);
    assert.deepEqual(topic.cover, main.cover);
    assert.equal(resolveRoute(routeFor(main.category, topic), catalog).kind, 'topic');
    assert.deepEqual(topic.groups.slice(1).map((g) => g.id),
      topic.groups.slice(1).map((_, index) => `${topic.id}_month_team_${index + 1}`));
    for (const g of topic.groups) {
      assert.equal(g.topicId, topic.id);
      assert.equal(resolveRoute(routeFor(g.category, g), catalog).topic.id, topic.id);
      for (const story of g.stories) {
        const route = resolveRoute(routeFor(g.category, g, story), catalog);
        assert.equal(route.topic.id, topic.id);
        assert.equal(route.group.id, g.id);
        assert.equal(route.story.id, story.id);
      }
    }
  }
  const future = structuredClone(catalog);
  const squad = future.groups.find((g) => g.id === 'rogue_1_month_team_1');
  squad.stories[0].vn = true;
  const route = resolveRoute(routeFor(squad.category, squad, squad.stories[0]), future);
  assert.equal(route.kind, 'story');
  assert.equal(route.topic.id, 'rogue_1');
  assert.equal(resolveRoute('#/integrated-strategies/phantom-crimson-solitaire/unknown', catalog).kind, 'missing');
});

test('operator pages cover every archive/module exactly once using playable operator identities', () => {
  const ids = new Set(catalog.operators.map((o) => o.id));
  assert.equal(ids.size, catalog.operators.length);
  for (const category of catalog.categories) {
    const operators = operatorsFor(catalog, category);
    if (!isOperatorCategory(category)) { assert.deepEqual(operators, []); continue; }
    const groups = catalog.groups.filter((g) => g.category === category.id);
    assert.deepEqual(operators.flatMap((o) => o.groups.map((g) => g.id)).sort(), groups.map((g) => g.id).sort());
    for (const operator of operators) {
      assert.ok(operator.id.startsWith('char_'));
      assert.ok(operator.cover?.path.includes(operator.id));
      assert.ok(operator.groups.length);
      for (const g of operator.groups) {
        assert.ok(g.title.startsWith(operator.name + ' · '));
        assert.equal(resolveRoute(routeFor(category, g), catalog).operator.id, operator.id);
        for (const story of g.stories) assert.equal(resolveRoute(routeFor(category, g, story), catalog).operator.id, operator.id);
      }
    }
  }
  const ami = operatorsFor(catalog, 'operator-modules').find((o) => o.name === 'Amiya');
  assert.deepEqual(ami.groups.map((g) => g.id).sort(), ['uniequip_002_amiya', 'uniequip_002_amiya2', 'uniequip_002_amiya3']);
  assert.equal(resolveRoute('#/operator-records/magallan', catalog).operator.id, 'char_248_mgllan');
  assert.equal(resolveRoute('#/operator-records/soaring-dragon-a-cycle-of-life/cycle-of-life', catalog).story.id, 'obt/memory/story_mgllan_1_1');
  assert.equal(resolveRoute('#/operator-records/blazing-sun-starting-point', catalog).operator.name, 'Nearl the Radiant Knight');
  assert.equal(resolveRoute('#/main/magallan', catalog).kind, 'missing');
  for (const category of ['operator-records', 'operator-modules']) {
    const available = new Set(operatorsFor(catalog, category).map((o) => o.id));
    const absent = catalog.operators.find((o) => !available.has(o.id));
    assert.equal(resolveRoute(routeFor(category, absent), catalog).kind, 'missing');
  }
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

test('continue reading keeps only the latest active collection per category without reviving older bookmarks', () => {
  const sample = { categories: catalog.categories, groups: catalog.categories.flatMap((category, index) => [0, 1].map((number) => ({
    category: category.id, id: `${index}-${number}`, stories: [{ id: `${index}-${number}`, vn: true }],
  }))) };
  const storage = memory(), store = createProgressStore(storage, sample);
  sample.groups.forEach((g, index) => store.save(g, g.stories[0], progress(index + 1)));
  const expected = sample.groups.filter((_, index) => index % 2 === 1).reverse();
  assert.deepEqual(recentGroups(sample, store), expected);
  store.setRead(sample.groups[0], sample.groups[0].stories[0], true);
  assert.deepEqual(recentGroups(sample, store), expected.filter((g) => g.category !== sample.groups[0].category), 'completing the latest collection hides that section');
  const unavailable = sample.groups.at(-1);
  unavailable.stories[0].vn = false;
  assert.deepEqual(recentGroups(sample, store), expected.filter((g) => ![sample.groups[0].category, unavailable.category].includes(g.category)), 'an unavailable position does not revive an older collection');
  assert.equal(Object.keys(store.snapshot().groups).length, sample.groups.length, 'older bookmarks remain saved');
});

test('manual completion survives reload and continues to the next story without inventing its progress', () => {
  const storage = memory(), store = createProgressStore(storage, catalog), g = group('main_0');
  assert.equal(store.setRead(g, prologue, true), true);
  const restored = createProgressStore(storage, catalog);
  assert.deepEqual(restored.group(g).stories[prologue.id], { read: true });
  assert.equal(restored.group(g).resume, prologue.id);
  assert.equal(resumeStory(g, restored.group(g)), g.stories[1]);
  assert.equal(restored.group(g).stories[g.stories[1].id], undefined);
  assert.equal(groupStats(g, restored.group(g)).read, 1);
  assert.deepEqual(recentGroups(catalog, restored), [g]);
  restored.setRead(g, prologue, false);
  assert.deepEqual(createProgressStore(storage, catalog).snapshot().groups, {});
  assert.equal(restored.save(g, prologue, { read: true }), false, 'position saves still require a valid line');
});

test('continuation advances after completion and stops at the chapter boundary', () => {
  const storage = memory(), store = createProgressStore(storage, catalog);
  const first = group('main_0'), latest = group('main_1'), story = latest.stories[0];
  store.save(first, prologue, progress(10));
  store.save(latest, story, progress(20));
  assert.deepEqual(recentGroups(catalog, store), [latest]);
  assert.equal(resumeStory(latest, store.group(latest)), story);

  store.setRead(latest, story, true);
  assert.equal(resumeStory(latest, store.group(latest)), latest.stories[1]);
  assert.deepEqual(recentGroups(catalog, store), [latest]);
  store.setRead(latest, story, false);
  assert.equal(resumeStory(latest, store.group(latest)), undefined, 'a reset has no position to continue');
  assert.deepEqual(recentGroups(catalog, store), [], 'a reset must not revive an older chapter');

  store.save(latest, story, progress(30, true));
  const restored = createProgressStore(storage, catalog);
  assert.equal(resumeStory(latest, restored.group(latest)), latest.stories[1], 'normal completion with a saved position also advances');
  assert.deepEqual(recentGroups(catalog, restored), [latest]);
  restored.setRead(latest, latest.stories.at(-1), true);
  assert.equal(resumeStory(latest, restored.group(latest)), undefined, 'the last story has no successor even if earlier stories are unread');
  assert.deepEqual(recentGroups(catalog, restored), []);
  restored.save(latest, story, progress(40));
  assert.deepEqual(recentGroups(catalog, restored), [latest], 'rereading restores the resume link');
  assert.equal(resumeStory(latest, restored.group(latest)), story);
});

test('continuation handles existing manual marks, skips read successors, and preserves unsupported story order', () => {
  const g = group('main_0');
  const saved = { resume: null, stories: { [prologue.id]: { read: true } } };
  const before = structuredClone(saved);
  assert.equal(resumeStory(g, saved), g.stories[1], 'old manual marks need no migration');
  assert.deepEqual(saved, before, 'resolving continuation never writes progress');
  saved.resume = prologue.id;
  saved.stories[g.stories[1].id] = { read: true };
  assert.equal(resumeStory(g, saved), g.stories[2]);
  const future = structuredClone(g);
  future.stories[2].vn = false;
  assert.equal(resumeStory(future, saved), future.stories[2], 'do not skip the next story just because it needs the classic reader');
  for (const story of g.stories) saved.stories[story.id] = { read: true };
  assert.equal(resumeStory(g, saved), undefined, 'a completed chapter has no continuation');
});

test('undoing a new completion restores the same existing bookmark immediately and after reload', () => {
  const storage = memory(), store = createProgressStore(storage, catalog), g = group('main_0');
  store.save(g, prologue, progress(10));
  store.setRead(g, g.stories[2], true);
  assert.equal(resumeStory(g, store.group(g)), g.stories[3]);
  store.setRead(g, g.stories[2], false);
  assert.equal(resumeStory(g, store.group(g)), prologue);
  assert.deepEqual(store.group(g), createProgressStore(storage, catalog).group(g));
});

test('read toggles update the continuation point and reset only this story position and branches', () => {
  const storage = memory(), a = createProgressStore(storage, catalog), b = createProgressStore(storage, catalog);
  const g = group('main_0'), sibling = g.stories[1], other = group('main_1');
  const saved = { ...progress(157), answers: { 143: '2' }, structure: 'a'.repeat(64) };
  a.save(g, prologue, saved); a.save(g, sibling, progress(200));
  b.save(other, other.stories[0], progress(300));
  a.setRead(g, prologue, true);
  assert.deepEqual(a.group(g).stories[prologue.id], { read: true, updated: saved.updated });
  assert.equal(a.group(g).resume, prologue.id);
  assert.equal(resumeStory(g, a.group(g)), sibling);
  assert.ok(a.group(g).updated > 200000);
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
  assert.equal(resumeStory(g, store.group(g)), g.stories[g.stories.indexOf(story) + 1]);
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
