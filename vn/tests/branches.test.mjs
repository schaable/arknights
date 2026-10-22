import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScript, buildTimeline, choiceReviewRanges } from '../script.mjs';

test('review ranges end after every conditional block, including shared passages between them', () => {
  const commands = parseScript(`[Decision(options="A;B;C",values="a;b;c")]
[Predicate(references="a;b")]
[name="One"] First two
[Predicate(references="c")]
[name="Two"] Third
[Predicate]
[name="One"] Shared interlude
[Predicate(references="a")]
[name="One"] A again
[Predicate(references="b;c")]
[Character(name="two")]
[name="Two"] Others again
[Predicate(references="a;b;c")]
[name="One"] Rejoined
[Decision(options="Yes",values="1")]
[name="One"] After`);
  assert.deepEqual([...choiceReviewRanges(commands)], [[1, { divergent: true, joinLine: 13 }]]);
  for (const answer of ['a', 'b', 'c']) {
    const timeline = buildTimeline(commands, { 1: answer });
    const join = timeline.findIndex((step) => step.line >= 13);
    assert.equal(timeline[join].text, 'Rejoined');
    assert.notEqual(timeline[join - 1].text, 'Shared interlude');
  }
});

test('identical, empty and terminal alternatives have deterministic boundaries', () => {
  const commands = parseScript(`[Decision(options="A;B",values="1;2")]
[Predicate(references="1;2")]
Same
[Decision(options="C;D",values="1;2")]
[Predicate(references="1")]
Only C
[Character]
`);
  assert.deepEqual([...choiceReviewRanges(commands)], [
    [1, { divergent: false, joinLine: 2 }],
    [4, { divergent: true, joinLine: 8 }],
  ]);
  assert.equal(buildTimeline(commands, { 1: '1', 4: '1' }).at(-2).text, 'Only C');
  assert.equal(buildTimeline(commands, { 1: '1', 4: '2' }).at(-1).kind, 'end');
});

test('all enabled bilingual stories agree on review boundaries without changing timelines', async () => {
  const catalog = JSON.parse(await readFile(new URL('../data/catalog.json', import.meta.url)));
  let choices = 0, divergent = 0;
  for (const group of catalog.groups) for (const story of group.stories.filter((story) => story.vn)) {
    const es = parseScript(await readFile(new URL(story.source.languages.es, new URL('../', import.meta.url)), 'utf8'));
    const en = parseScript(await readFile(new URL(story.source.languages.en, new URL('../', import.meta.url)), 'utf8'));
    const answers = Object.fromEntries(es.filter((item) => item.command === 'decision').map((item) => [item.line, item.args.values.split(';')[0]]));
    const before = buildTimeline(es, answers);
    const ranges = choiceReviewRanges(es);
    assert.deepEqual(ranges, choiceReviewRanges(en), story.id);
    assert.deepEqual(buildTimeline(es, answers), before, 'review analysis cannot mutate the reading');
    choices += ranges.size;
    divergent += [...ranges.values()].filter((range) => range.divergent).length;
    if (story.id === 'obt/guide/beg/0_welcome_to_guide') assert.deepEqual(ranges.get(164), { divergent: true, joinLine: 183 });
    if (story.id === 'obt/main/level_main_04-01_beg') assert.equal(ranges.get(166).joinLine, es.at(-1).line + 1);
  }
  assert.equal(choices, 46);
  assert.equal(divergent, 24);
});
