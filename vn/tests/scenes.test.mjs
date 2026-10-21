import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, buildTimeline, applyEvent, initialScene } from '../script.mjs';
import { inspectScript } from '../compatibility.mjs';
import { imageURLs, Soundtrack } from '../assets.mjs';

test('cut-ins have independent widget IDs, replacement, removal and immutable snapshots', () => {
  const timeline = buildTimeline(parseScript(`[Character(name="base")]
[CharacterCutin(widgetID="1",name="first",style="cutin",fadestyle="horiz_expand_center",offsetx=-300,width=200)]
First
[CharacterCutin(widgetID="2",name="second",offsetx=300)]
Both
[CharacterCutin(widgetID="1",name="replacement")]
Replacement
[CharacterCutin(widgetID="1")]
Second only
[CharacterCutin(widgetID="2")]
Neither`));
  const visible = timeline.filter((step) => step.kind === 'dialogue').map((step) => step.state.cutins.map((c) => c.name));
  assert.deepEqual(visible, [['first'], ['first', 'second'], ['replacement', 'second'], ['second'], []]);
  assert.deepEqual(timeline[0].state.characters, ['base']);
  assert.equal(timeline[0].state.cutins[0].x, -300);
  assert.equal(timeline[0].state.cutins[0].width, 200);
  timeline[1].state.cutins[0].name = 'changed snapshot';
  assert.equal(timeline[0].state.cutins[0].name, 'first');
});

test('background tween keeps the CG and sprites; missing endpoints retain their start values', () => {
  const [step] = buildTimeline(parseScript(`[Background(image="back",xScale=1.3)]
[Character(name="base")]
[Image(image="front",x=-30,y=-30)]
[BackgroundTween(xFrom=40,yFrom=0,yTo=-150,xScaleTo=1.1,duration=4,block=true)]
[ImageTween(xTo=-70,yTo=-70,xScaleTo=1.2,duration=15)]
Moved`));
  assert.deepEqual(step.state.background, { name: 'back', x: 40, y: -150, scale: 1.1 });
  assert.deepEqual(step.state.image, { name: 'front', x: -70, y: -70, scale: 1.2 });
  assert.deepEqual(step.state.characters, ['base']);
});

test('item overlays replace and hide independently of background and CG, including between dialogue', () => {
  const steps = buildTimeline(parseScript(`[Background(image="back")]
[Image(image="front")]
[ShowItem(image="photo")]
Photo
[ShowItem(image="second")]
Replacement
[HideItem(fadetime=1)]
Hidden
[ShowItem(image="brief")]
[Delay(time=1)]
[HideItem(fadetime=1)]
After`));
  assert.deepEqual(steps.slice(0, 4).map((s) => s.state.item?.name), ['photo', 'second', undefined, undefined]);
  assert.equal(steps[2].state.image.name, 'front');
  assert.equal(steps[2].state.background.name, 'back');
  assert.deepEqual(steps[3].events.map((e) => e.command), ['showitem', 'delay', 'hideitem']);
  assert.ok(imageURLs('item', 'item_act10_1').every((url) => url.endsWith('/avg/items/item_act10_1.png')));
});

test('branches gate new commands and saved scenes retain only active looping sound channels', () => {
  const commands = parseScript(`[PlaySound(key="heartbeat",channel="HB",loop=true)]
[PlaySound(key="rain",channel="weather",loop=true)]
[Decision(options="A;B",values="a;b")]
[Predicate(references="a")]
[StopSound(channel="HB",fadetime=1)]
[CharacterCutin(widgetID="1",name="one")]
[ShowItem(image="photo")]
[Predicate(references="a;b")]
Shared
[PlaySound(key="impact",channel="weather")]
After`);
  const selected = buildTimeline(commands, { 3: 'a' });
  assert.deepEqual(selected[1].state.sounds.map((s) => s.key), ['rain']);
  assert.deepEqual(selected[2].state.sounds, []);
  const other = buildTimeline(commands, { 3: 'b' })[1].state;
  assert.deepEqual(other.sounds.map((s) => s.key), ['heartbeat', 'rain']);
  assert.deepEqual(other.cutins, []); assert.equal(other.item, null);
  const state = initialScene();
  applyEvent(state, parseScript('[PlaySound(key="impact")]')[0]);
  assert.deepEqual(state.sounds, [], 'a one-shot cannot replay on seek');
});

test('new command families still reject unvalidated variants', () => {
  for (const tag of ['[CharacterCutin(name="one",style="other")]', '[CharacterCutin(name="one",fadestyle="vert_expand_center")]', '[ShowItem(image="module",is_module=true)]']) {
    assert.equal(inspectScript(tag + '\nText').issues[0].code, 'unsupported');
  }
});

function audioHarness(t) {
  let now = 0;
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.mock.method(performance, 'now', () => now);
  const previous = globalThis.Audio, audios = [];
  globalThis.Audio = class {
    constructor() { this.volume = 1; this.paused = true; this.plays = 0; audios.push(this); }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute() { this.src = ''; }
    load() {}
  };
  const soundtrack = new Soundtrack({ music: 'music', heartbeat: 'heartbeat', rain: 'rain', impact: 'impact' }, () => assert.fail('Missing audio'));
  soundtrack.enable(true);
  t.after(() => { soundtrack.enable(false); globalThis.Audio = previous; });
  return { soundtrack, audios, advance(ms) { now += ms; t.mock.timers.tick(ms); } };
}

test('StopSound fades only the named channel, keeping music and other sounds playing', (t) => {
  const { soundtrack: s, audios, advance } = audioHarness(t);
  s.music({ key: 'music' });
  s.effect({ key: 'heartbeat', channel: 'HB', loop: 'true' });
  s.effect({ key: 'rain', channel: 'weather', loop: 'true' });
  advance(10);
  const [music, heartbeat, rain] = audios;
  assert.equal(heartbeat.loop, true);
  s.stopEffect({ channel: 'HB', fadetime: 0.08 });
  advance(50);
  assert.ok(heartbeat.volume < rain.volume && heartbeat.volume > 0);
  advance(60);
  assert.equal(heartbeat.src, ''); assert.equal(heartbeat.paused, true);
  assert.equal(music.paused, false); assert.equal(rain.paused, false);
});

test('master volume scales music, loops, one-shots and delayed sounds without restarting them', (t) => {
  const { soundtrack: s, audios, advance } = audioHarness(t);
  s.music({ key: 'music', volume: 0.8 });
  s.effect({ key: 'rain', volume: 0.4, loop: 'true' });
  s.effect({ key: 'impact', volume: 1 });
  s.effect({ key: 'heartbeat', volume: 0.6, delay: 1 });
  advance(10);
  const plays = audios.map((a) => a.plays);
  s.setVolume(0.25);
  assert.deepEqual(audios.map((a) => a.volume), [0.2, 0.1, 0.25, 0.15]);
  assert.deepEqual(audios.map((a) => a.plays), plays);
  s.setVolume(0);
  assert.ok(audios.every((a) => a.volume === 0));
  advance(1000);
  assert.equal(audios[3].plays, 1);
  assert.equal(audios[3].volume, 0);
  s.setVolume(1);
  assert.deepEqual(audios.map((a) => a.volume), [0.8, 0.4, 1, 0.6]);
  s.enable(false);
  assert.equal(s.levels.size, 0);
  s.setVolume(0.5);
  assert.ok(audios.every((a) => a.paused));
  s.enable(true);
  advance(10);
  assert.equal(audios.at(-1).volume, 0.4, 'new playback retains master volume');
});

test('volume changes during crossfades and sound fades preserve the script envelope even at zero', (t) => {
  const { soundtrack: s, audios, advance } = audioHarness(t);
  s.setVolume(1);
  s.music({ key: 'music', volume: 0.8 });
  advance(10);
  s.music({ key: 'music', volume: 0.4, crossfade: 1 });
  s.effect({ key: 'rain', volume: 0.6, channel: 'weather', loop: 'true' });
  advance(200);
  const [old, current, rain] = audios;
  s.stopEffect({ channel: 'weather', fadetime: 0.8 });
  s.setVolume(0.5);
  assert.ok(Math.abs(old.volume - 0.32) < 1e-9);
  assert.ok(Math.abs(current.volume - 0.04) < 1e-9);
  advance(200);
  assert.ok(Math.abs(old.volume - 0.24) < 1e-9);
  assert.ok(Math.abs(current.volume - 0.08) < 1e-9);
  assert.ok(Math.abs(rain.volume - 0.225) < 1e-9);
  s.setVolume(0);
  advance(200);
  assert.ok(audios.every((a) => a.volume === 0));
  s.setVolume(1);
  assert.ok(Math.abs(old.volume - 0.32) < 1e-9);
  assert.ok(Math.abs(current.volume - 0.24) < 1e-9);
  assert.ok(Math.abs(rain.volume - 0.3) < 1e-9);
  advance(400);
  assert.equal(current.volume, 0.4);
  assert.equal(old.src, ''); assert.equal(rain.src, '');
  assert.equal(s.levels.size, 1);
});

test('stopping or replacing a channel cancels delayed starts, including after a requested fade', (t) => {
  const { soundtrack: s, audios, advance } = audioHarness(t);
  s.effect({ key: 'heartbeat', channel: 'HB', delay: 0.03, loop: 'true' });
  s.stopEffect({ channel: 'HB', fadetime: 1 });
  s.effect({ key: 'rain', channel: 'weather', delay: 0.03 });
  s.effect({ key: 'impact', channel: 'weather' });
  advance(60);
  assert.deepEqual(audios.map((audio) => audio.plays), [0, 0, 1]);
  assert.equal(s.effects.size, 1);
  assert.equal(s.pendingEffects.size, 0);
});

test('restore and mute dispose all playback; enabling restores loops without replaying one-shots', (t) => {
  const { soundtrack: s, audios, advance } = audioHarness(t);
  s.effect({ key: 'impact', delay: 0.03 });
  const loops = [{ key: 'heartbeat', channel: 'HB', loop: 'true', delay: 2 }];
  s.restore({ key: 'music' }, loops);
  advance(10);
  assert.equal(audios[0].src, '');
  assert.equal(audios.at(-1).loop, true); assert.equal(audios.at(-1).plays, 1);
  s.enable(false);
  assert.ok(audios.every((audio) => audio.paused && !audio.src));
  assert.equal(s.effects.size, 0); assert.equal(s.timers.size, 0); assert.equal(s.fades.size, 0);
  s.enable(true, loops);
  advance(50);
  assert.equal(audios[0].plays, 0);
  assert.equal(s.effects.size, 1);
  assert.equal(audios.at(-1).loop, true);
  s.restore(null, []);
  assert.ok(audios.every((audio) => audio.paused && !audio.src));
});
