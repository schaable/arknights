import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadStory } from '../loader.mjs';
import { inspectScript } from '../compatibility.mjs';
import { soundPath } from '../assets.mjs';
const es = '[name="Amiya"]Hola\n[Decision(options="Sí;No",values="1;2")]\n[Predicate(references="1")]\nBien.\n[Predicate(references="2")]\nVale.\n[Predicate(references="1;2")]\nFin.';
const en = es.replace('Hola', 'Hello').replace('Sí;No', 'Yes;No').replace('Bien.', 'Good.').replace('Vale.', 'Okay.').replace('Fin.', 'End.');
const source = { format: 'avg', languages: { es: '/es.txt', en: '/en.txt' } };
const fakeFetch = (overrides = {}) => async (url, { signal } = {}) => {
  signal?.throwIfAborted();
  const value = Object.hasOwn(overrides, url) ? overrides[url] : ({ '/es.txt': es, '/en.txt': en, './data/audio.json': '{"test":"Sound_Beta_2/test"}' })[url];
  if (value instanceof Error) throw value;
  return new Response(typeof value === 'number' ? '' : value, { status: typeof value === 'number' ? value : 200 });
};

test('loads both aligned languages and audio independently', async () => {
  const result = await loadStory(source, { fetcher: fakeFetch() });
  assert.equal(result.language, 'es'); assert.deepEqual(result.problems, []);
  assert.deepEqual(Object.keys(result.scripts), ['es', 'en']); assert.equal(result.fallback, false);
});

test('missing/failed translation falls back without preventing reading', async () => {
  for (const failure of [404, 503, new TypeError('offline')]) {
    const result = await loadStory(source, { fetcher: fakeFetch({ '/es.txt': failure }) });
    assert.equal(result.language, 'en'); assert.equal(result.fallback, true);
    assert.deepEqual(Object.keys(result.scripts), ['en']);
    assert.equal(result.problems[0].error.code, failure === 404 ? 'missing' : 'network');
    assert.equal(result.problems[0].error.retryable, failure !== 404);
  }
  const single = await loadStory({ format: 'avg', languages: { en: '/en.txt' } }, { fetcher: fakeFetch() });
  assert.equal(single.fallback, true);
});

test('structural mismatch retains canonical Spanish and disables unsafe switching', async () => {
  const result = await loadStory(source, { language: 'en', fetcher: fakeFetch({ '/en.txt': '[Delay(time=0)]\n' + en }) });
  assert.equal(result.language, 'es'); assert.equal(result.fallback, true);
  assert.deepEqual(Object.keys(result.scripts), ['es']);
  assert.equal(result.problems[0].error.code, 'alignment');
});

test('bad audio can be retried while dialogue remains usable', async () => {
  for (const audio of [503, 'not json', '[]', '{}']) {
    const result = await loadStory(source, { fetcher: fakeFetch({ './data/audio.json': audio }) });
    assert.equal(result.language, 'es'); assert.deepEqual(result.audio, {});
    assert.equal(result.problems[0].error.code, 'audio'); assert.equal(result.problems[0].error.retryable, true);
  }
});

test('reports permanent source/format failures separately from retryable network errors', async () => {
  for (const [text, code] of [['[BadCommand()]', 'unsupported'], ['', 'invalid'], ['[Decision(options="A;B",values="1")]', 'invalid']]) {
    await assert.rejects(loadStory(source, { fetcher: fakeFetch({ '/es.txt': text, '/en.txt': text }) }), (e) => e.code === code && !e.retryable);
  }
  await assert.rejects(loadStory({ format: 'module' }), (e) => e.code === 'format');
  await assert.rejects(loadStory(source, { fetcher: fakeFetch({ '/es.txt': 503, '/en.txt': 404 }) }), (e) => e.code === 'network' && e.retryable);
});

test('aborted loads do not return partial success, and a fresh request can retry', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadStory(source, { signal: controller.signal, fetcher: fakeFetch() }), (e) => e.name === 'AbortError');
  const result = await loadStory(source, { fetcher: fakeFetch() });
  assert.equal(result.problems.length, 0);
});

test('compatibility rejects unimplemented variants and finds cover/audio automatically', () => {
  assert.equal(inspectScript('[Image(image="cg",xscale=2,yscale=1)]\nHello').issues[0].code, 'unsupported');
  assert.equal(inspectScript('[CameraEffect(effect="Blur")]\nHello').issues[0].code, 'unsupported');
  assert.equal(inspectScript('[GotoPage(dest="other")]').issues[0].code, 'unsupported');
  const inspected = inspectScript('[Background(image="bg_black")]\n[Image(image="cg")]\n[PlayMusic(key="$music")]\nHello');
  assert.deepEqual(inspected.cover, ['image', 'cg']); assert.deepEqual(inspected.soundKeys, ['music']);
  assert.equal(inspected.issues.length, 0);
  assert.equal(soundPath({}, 'Sound_Beta_2/Enemy/e_skill/test'), 'Sound_Beta_2/Enemy/e_skill/test');
  assert.equal(soundPath({}, 'https://example.com/file'), null);
});

test('every translation is discovered, enabled sources align, pinned originals match provenance', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
  const provenance = JSON.parse(await readFile(new URL('../sources/provenance.json', import.meta.url)));
  const translated = catalog.groups.flatMap((g) => g.stories).filter((s) => s.spanish);
  assert.equal(translated.length, 113);
  assert.equal(translated.filter((s) => s.vn).length, 113);
  assert.equal(translated.filter((s) => !s.vn).length, 0);
  for (const story of translated) {
    assert.ok(story.source.languages.es && story.source.languages.en);
    const english = await readFile(new URL('../' + story.source.languages.en, import.meta.url));
    assert.equal(createHash('sha256').update(english).digest('hex'), provenance.files[story.id]);
    assert.equal(story.vn, story.source.compatible.length > 0);
    if (story.vn) assert.equal(story.source.aligned, true);
    else assert.ok(story.source.issues.some((i) => i.code === 'unsupported'));
  }
});

test('a stalled optional language times out without blocking the other language', async () => {
  const ordinary = fakeFetch();
  // Keep the event loop alive while testing AbortSignal.timeout's unref'ed timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const result = await loadStory(source, { timeoutMs: 10, fetcher: (url, options) => url === '/en.txt'
      ? new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
      : ordinary(url, options) });
    assert.equal(result.language, 'es');
    assert.equal(result.problems[0].error.code, 'network'); assert.equal(result.problems[0].error.retryable, true);
  } finally { clearTimeout(keepAlive); }
});

test('the catalog fingerprint rejects a changed source even when its counterpart is missing', async () => {
  const { structureHash } = await import('../loader.mjs');
  const fingerprint = await structureHash(inspectScript(es).commands);
  const pinned = { ...source, structure: fingerprint };
  const okay = await loadStory(pinned, { fetcher: fakeFetch() });
  assert.equal(okay.structure, fingerprint);
  await assert.rejects(loadStory(pinned, { language: 'en', fetcher: fakeFetch({ '/es.txt': 404, '/en.txt': '[Delay(time=0)]\n' + en }) }), (e) => e.code === 'alignment');
});
