import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { coverURLs } from '../covers.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));

test('every catalog collection has resolvable cover metadata, including inherited squad artwork', () => {
  for (const group of catalog.groups) {
    assert.ok(coverURLs(group.cover).length, `Missing cover: ${group.id}`);
    const topic = group.id.match(/^(rogue_\d+)_/);
    if (topic) {
      assert.deepEqual(group.cover, catalog.groups.find((g) => g.id === topic[1]).cover, group.id);
    }
  }
});

test('local legacy artwork matches its source provenance and is included in the catalog', async () => {
  const provenance = JSON.parse(await readFile(new URL('../assets/covers/sources.json', import.meta.url)));
  for (const [name, source] of Object.entries(provenance.images)) {
    const group = catalog.groups.find((g) => g.id === source.collection);
    assert.deepEqual(group.cover, { provider: 'local', path: name });
    const bytes = await readFile(new URL(coverURLs(group.cover)[0]));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), source.width);
    assert.equal(bytes.readUInt32BE(20), source.height);
  }
});
