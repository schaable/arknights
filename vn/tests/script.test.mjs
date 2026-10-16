import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseScript, buildTimeline, validateProgress } from '../script.mjs';
import { characterId, imageURLs } from '../assets.mjs';

const es = parseScript(await readFile(new URL('../../gamedata/es_ES/story/obt/guide/beg/0_welcome_to_guide.txt', import.meta.url), 'utf8'));
const en = parseScript(await readFile(new URL('../sources/en/obt/guide/beg/0_welcome_to_guide.txt', import.meta.url), 'utf8'));
const decisions = es.filter((item) => item.command === 'decision');
const answersFor = (value) => Object.fromEntries(decisions.map((item) => [item.line, item.args.values.includes(';') ? value : '1']));

test('the complete bilingual prologue is aligned and every directive is recognized', () => {
  for (const script of [es, en]) {
    assert.equal(script.filter((item) => item.command === 'line').length, 124);
    assert.equal(script.filter((item) => item.command === 'decision').length, 6);
    assert.equal(script.at(-1).command, 'tutorial');
  }
  const structure = (script) => script.map(({ command, line, args }) => ({ command, line, values: args.values, references: args.references }));
  assert.deepEqual(structure(es), structure(en));
  assert.equal(es.filter((item) => item.command === 'delay').length, 20);
});

test('each branching answer selects only its own dialogue and reaches the shared ending', () => {
  const branchLines = [
    es.find((item) => item.text.startsWith('Entiendo. Sé que')).line,
    es.find((item) => item.text.includes('¿de verdad no me recuerdas')).line,
    es.find((item) => item.text === 'Ah, em, hola.').line,
  ];
  for (const value of ['1', '2', '3']) {
    const timeline = buildTimeline(es, answersFor(value));
    branchLines.forEach((line, i) => assert.equal(timeline.some((item) => item.line === line), i + 1 === Number(value)));
    assert.equal(timeline.at(-1).kind, 'end');
    assert.equal(timeline.at(-2).text, '¡Por favor, toma el mando... de Rhodes Island!');
    assert.equal(timeline.at(-2).state.image.name, 'avg_0_3');
    assert.deepEqual(timeline.at(-2).state.characters, []);
  }
});

test('unanswered and invalid decisions stop playback instead of leaking a branch', () => {
  assert.equal(buildTimeline(es).at(-1).kind, 'choice');
  const answers = answersFor('1');
  answers[decisions[2].line] = 'invalid';
  const timeline = buildTimeline(es, answers);
  assert.equal(timeline.at(-1).line, decisions[2].line);
  assert.equal(timeline.filter((item) => item.kind === 'choice').length, 3);
});

test('skipped branch visuals never change the selected branch; snapshots are independent', () => {
  const script = parseScript('[Decision(options="A;B",values="a;b")]\n[Predicate(references="a")]\n[Character(name="one")]\n[name="A"] A\n[Predicate(references="b")]\n[Character(name="two")]\n[name="B"] B\n[Predicate(references="a;b")]\n[name="C"] Shared');
  const timeline = buildTimeline(script, { 1: 'a' });
  assert.deepEqual(timeline.find((item) => item.text === 'Shared').state.characters, ['one']);
  timeline[1].state.characters.push('changed');
  assert.deepEqual(timeline[2].state.characters, ['one']);
});

test('restore and language switching preserve physical line, choices, and stage state', () => {
  const answers = answersFor('3');
  const timeline = buildTimeline(es, answers);
  const flashback = timeline.find((item) => item.text === 'Sé que nos llevarás a la victoria.');
  assert.equal(flashback.state.background.name, 'bg_wild_a');
  assert.equal(flashback.state.grayscale, 0.8);
  const restored = validateProgress(en, { line: flashback.line, answers });
  assert.equal(restored.timeline[restored.index].line, flashback.line);
  assert.deepEqual(restored.timeline[restored.index].state, flashback.state);
  assert.deepEqual(restored.answers, answers);
  const corrupt = validateProgress(es, { line: -20, answers: { 999: '<script>', [decisions[1].line]: '1' } });
  assert.equal(corrupt.index, 0);
  assert.deepEqual(corrupt.answers, {});
});

test('asset URLs encode sprite expressions and unknown commands fail explicitly', () => {
  assert.equal(characterId('char_002_amiya_1#4'), 'char_002_amiya_1#4$1');
  assert.equal(characterId('char_016_medic'), 'char_016_medic#1$1');
  assert.ok(imageURLs('character', 'char_002_amiya_1#4')[0].includes('%234%241.png'));
  assert.throws(() => parseScript('[Unsupported(key="x")]'), /Unsupported directive/);
  assert.throws(() => parseScript('[Decision(options="A;B",values="1")]'), /Invalid decision/);
});
