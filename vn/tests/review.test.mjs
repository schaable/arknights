import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewStore, exportReviews, REVIEW_KEY, reviewContext, reviewId } from '../review-data.mjs';
import { loadStory } from '../loader.mjs';
import { parseScript, buildTimeline } from '../script.mjs';

const story = { id: 'obt/main/level_main_00-01_beg', title: 'Example', code: '0-1' };
const es = '[Header]\r\n\r\n[name="Amiya"]   Hola, {@nickname}.  \r\n[Decision(options="Sí;No",values="a;b")]\r\nFin.';
const en = es.replace('Hola', 'Hello').replace('Sí;No', 'Yes;No').replace('Fin.', 'End.');
const step = buildTimeline(parseScript(es))[0];
const context = reviewContext({ story, step, sources: { es, en }, sourceUrl: 'https://example.test/pinned.txt' });
const note = { ...context, comment: 'Revisar esta frase.', proposal: 'Hola.' };
function memory() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

test('review identities match the classic reader and snapshots retain exact source whitespace/placeholders', () => {
  assert.equal(context.id, JSON.stringify([story.id, 'free', [3]]));
  assert.deepEqual(context.story, { key: story.id, name: 'Example', code: '0-1' });
  assert.deepEqual(context.lines, [3]); assert.equal(context.speaker, 'Amiya');
  assert.equal(context.spanish, '   Hola, {@nickname}.  ');
  assert.equal(context.english, '   Hello, {@nickname}.  ');
  assert.equal(context.sourceError, null);
});

test('choice notes preserve the complete options field and do not include choice IDs in translated text', () => {
  const choice = buildTimeline(parseScript(es)).at(-1);
  const review = reviewContext({ story, step: choice, sources: { es, en }, sourceUrl: '/en.txt' });
  assert.equal(review.id, reviewId(story.id, 'options', [4]));
  assert.equal(review.field, 'options'); assert.equal(review.speaker, 'Doctor');
  assert.equal(review.spanish, 'Sí;No'); assert.equal(review.english, 'Yes;No');
});

test('missing English stays explicit; English-only stories and ending screens cannot create Spanish notes', () => {
  const review = reviewContext({ story, step, sources: { es }, sourceUrl: '/en.txt' });
  assert.equal(review.english, null); assert.ok(review.sourceError);
  assert.equal(reviewContext({ story, step, sources: { en } }), null);
  assert.equal(reviewContext({ story, step: { kind: 'end' }, sources: { es, en } }), null);
});

test('classic notes and other tabs survive edits and scoped deletes; clear does not touch progress', () => {
  const storage = memory(), a = createReviewStore(storage), b = createReviewStore(storage);
  const legacy = { ...note, id: reviewId('another/story', 'text', [20, 21]), story: { key: 'another/story', name: 'Legacy' },
    field: 'text', lines: [20, 21], legacyExtra: 'preserve' };
  storage.setItem(REVIEW_KEY, JSON.stringify([legacy]));
  storage.setItem('arknights.vn.v2', 'progress');
  a.save(note);
  b.save({ ...legacy, comment: 'Edited elsewhere' });
  a.save({ ...note, proposal: 'Updated proposal' });
  assert.equal(a.read().length, 2);
  assert.deepEqual(a.read().find((n) => n.id === legacy.id), { ...legacy, comment: 'Edited elsewhere' });
  b.remove(note.id); assert.deepEqual(a.read(), [{ ...legacy, comment: 'Edited elsewhere' }]);
  a.clear(); assert.equal(storage.getItem(REVIEW_KEY), null);
  assert.equal(storage.getItem('arknights.vn.v2'), 'progress');
});

test('malformed or denied storage is never silently replaced', () => {
  for (const bytes of ['not JSON', '{}', '[{}]', JSON.stringify([{ ...note, lines: [-1] }])]) {
    const storage = memory(); storage.setItem(REVIEW_KEY, bytes);
    const store = createReviewStore(storage);
    for (const action of [() => store.read(), () => store.save(note), () => store.remove(note.id), () => store.clear()]) assert.throws(action);
    assert.equal(storage.getItem(REVIEW_KEY), bytes);
  }
  const denied = createReviewStore({ getItem() { throw new Error('Blocked'); } });
  assert.throws(() => denied.save(note), /Blocked/);
  const storage = memory(); storage.setItem(REVIEW_KEY, JSON.stringify([note]));
  storage.setItem = () => { throw new Error('Quota'); };
  assert.throws(() => createReviewStore(storage).save({ ...note, comment: 'Changed' }), /Quota/);
  assert.deepEqual(createReviewStore(storage).read(), [note]);
});

test('Markdown export retains the classic format, sort order, multiline quoting and missing-source details', () => {
  const other = { ...note, id: 'later', lines: [9], english: null, sourceError: 'Unavailable', comment: 'First\nSecond', proposal: '' };
  const result = exportReviews([other, note]);
  assert.ok(result.startsWith('# Revisión de traducción\n\n## 0-1 · Antes del combate · Amiya\n\n'));
  assert.ok(result.indexOf('Líneas: 3') < result.indexOf('Líneas: 9'));
  assert.ok(result.includes('Fuente: https://example.test/pinned.txt'));
  assert.ok(result.includes('### Inglés\n>    Hello, {@nickname}.  '));
  assert.ok(result.includes('### Español\n>    Hola, {@nickname}.  '));
  assert.ok(result.includes('Original no disponible: Unavailable'));
  assert.ok(result.includes('### Comentario\n> First\n> Second'));
});

test('the loader exposes only structurally compatible raw sources for review', async () => {
  const source = { format: 'avg', languages: { es: '/es.txt', en: '/en.txt' } };
  const fetcher = (english) => async (url) => new Response(url === '/es.txt' ? es : url === '/en.txt' ? english : '{"test":"test"}');
  const loaded = await loadStory(source, { fetcher: fetcher(en) });
  assert.deepEqual(loaded.sources, { es, en });
  const mismatch = await loadStory(source, { fetcher: fetcher('[Delay(time=0)]\n' + en) });
  assert.deepEqual(mismatch.sources, { es });
  assert.equal(mismatch.problems[0].error.code, 'alignment');
});
