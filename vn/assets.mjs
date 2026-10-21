const primary = 'https://cdn.jsdelivr.net/gh/akgcc/arkdata@main/assets/';
const fallback = 'https://raw.githubusercontent.com/akgcc/arkdata/main/assets/';

export function soundPath(map, key) {
  const name = key.replace(/^\$/, '');
  return map[name] || (/^Sound_Beta_2\/[a-z0-9_/-]+$/i.test(name) ? name : null);
}

export function characterId(name) {
  const [, id, face = '1', body = '1'] = /^(.*?)(?:#(\d+))?(?:\$(\d+))?$/.exec(name.trim());
  return `${id}#${face}$${body}`;
}

export function imageURLs(kind, name) {
  if (kind === 'portrait') {
    const path = `../thumbs/${encodeURIComponent(characterId(name))}.webp`.toLowerCase();
    return [primary, fallback].map((base) => new URL(path, base).href);
  }
  const path = kind === 'character'
    ? `avg/characters/${encodeURIComponent(characterId(name))}.png`
    : `torappu/dynamicassets/avg/${({ image: 'images', background: 'backgrounds', item: 'items' })[kind]}/${name}.png`;
  return [primary + path.toLowerCase(), fallback + path.toLowerCase()];
}

export function loadImage(img, kind, name, onError, onLoad = null) {
  const urls = imageURLs(kind, name);
  let index = 0;
  img.draggable = false;
  img.dataset.asset = name;
  img.onload = onLoad;
  img.onerror = () => {
    if (++index < urls.length) img.src = urls[index];
    else { img.hidden = true; onError(); }
  };
  img.src = urls[index];
}

export class Soundtrack {
  constructor(map, onError, volume = 0.55) {
    this.map = map;
    this.onError = onError;
    this.enabled = false;
    this.current = null;
    this.track = null;
    this.effects = new Set();
    this.effectChannels = new Map();
    this.pendingEffects = new Map();
    this.timers = new Set();
    this.fades = new Map();
    // Script levels (including fades) stay independent of the user's volume.
    this.levels = new Map();
    this.volume = volume;
  }
  setLevel(audio, level) {
    this.levels.set(audio, level);
    audio.volume = level * this.volume;
  }
  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    for (const [audio, level] of this.levels) audio.volume = level * this.volume;
  }
  create(key, volume, loop = false) {
    const path = soundPath(this.map, key);
    if (!path) { this.onError(); return null; }
    const audio = new Audio();
    const urls = [primary + `torappu/dynamicassets/audio/${path}.mp3`.toLowerCase(),
      'https://raw.githubusercontent.com/Aceship/Arknight-voices/main/' + path.replace(/^Sound_Beta_2\//, '').toLowerCase() + '.wav'];
    let attempt = 0;
    this.setLevel(audio, Math.max(0, Math.min(1, Number(volume ?? 0.8))));
    audio.loop = loop;
    audio.onerror = () => {
      if (++attempt < urls.length) { audio.src = urls[attempt]; this.play(audio); }
      else this.onError();
    };
    audio.src = urls[0];
    return audio;
  }
  play(audio) {
    if (audio && this.enabled) audio.play().catch(() => { /* User may mute before decoding finishes. */ });
  }
  later(callback, seconds = 0) {
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, Number(seconds) * 1000);
    this.timers.add(timer);
    return timer;
  }
  dispose(audio) {
    if (!audio) return;
    const pending = this.pendingEffects.get(audio);
    clearTimeout(pending);
    this.timers.delete(pending);
    this.pendingEffects.delete(audio);
    this.effects.delete(audio);
    this.effectChannels.delete(audio);
    clearInterval(this.fades.get(audio));
    this.fades.delete(audio);
    this.levels.delete(audio);
    audio.onended = audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  fade(audio, target, seconds, done = () => {}) {
    if (!audio) return;
    clearInterval(this.fades.get(audio));
    if (!(Number(seconds) > 0)) { this.fades.delete(audio); this.setLevel(audio, target); done(); return; }
    const initial = this.levels.get(audio), start = performance.now();
    const timer = setInterval(() => {
      const fraction = Math.min(1, (performance.now() - start) / (Number(seconds) * 1000));
      this.setLevel(audio, initial + (target - initial) * fraction);
      if (fraction === 1) { clearInterval(timer); this.fades.delete(audio); done(); }
    }, 40);
    this.fades.set(audio, timer);
  }
  music(args, resume = false, fadeOut = 0) {
    this.current = args;
    const old = this.track;
    const seconds = Number(fadeOut || args?.crossfade || 0);
    if (old && this.enabled && !resume && seconds > 0) this.fade(old, 0, seconds, () => this.dispose(old));
    else this.dispose(old);
    this.track = null;
    if (!this.enabled || !args) return;
    const hasIntro = !resume && args.intro && args.intro !== args.key;
    const audio = this.create(hasIntro ? args.intro : args.key, args.volume, !hasIntro);
    if (!audio) return;
    this.track = audio;
    if (seconds > 0 && !resume) {
      const target = this.levels.get(audio);
      this.setLevel(audio, 0);
      this.fade(audio, target, seconds);
    }
    if (hasIntro) audio.onended = () => {
      if (this.track === audio) this.music({ ...this.current, intro: null, delay: 0 });
    };
    this.later(() => { if (this.track === audio) this.play(audio); }, resume ? 0 : args.delay);
  }
  effect(args) {
    if (!this.enabled) return;
    // Named channels have a single owner, including sounds waiting on a delay.
    // Unnamed one-shots can overlap (the scripts use this for layered impacts).
    if (args.channel != null) this.stopEffect({ channel: args.channel });
    const audio = this.create(args.key, args.volume, args.loop === 'true');
    if (!audio) return;
    this.effects.add(audio);
    this.effectChannels.set(audio, args.channel);
    audio.onended = () => this.dispose(audio);
    const timer = this.later(() => {
      this.pendingEffects.delete(audio);
      if (this.effects.has(audio)) this.play(audio);
    }, args.delay);
    this.pendingEffects.set(audio, timer);
  }
  stopEffect(args) {
    for (const audio of this.effects) {
      if (!this.effectChannels.has(audio) || this.effectChannels.get(audio) !== args.channel) continue;
      // Cancel scheduled starts even when a fade-out was requested.
      const pending = this.pendingEffects.get(audio);
      if (pending != null || !this.enabled || !(Number(args.fadetime) > 0)) this.dispose(audio);
      else {
        this.effectChannels.delete(audio);
        this.fade(audio, 0, args.fadetime, () => this.dispose(audio));
      }
    }
  }
  stopEffects() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.effects.forEach((audio) => this.dispose(audio));
    this.effects.clear();
  }
  stopFades() {
    for (const [audio, timer] of this.fades) {
      clearInterval(timer);
      if (audio !== this.track) this.dispose(audio);
    }
    this.fades.clear();
  }
  enable(enabled, sounds = []) {
    this.enabled = enabled;
    this.stopFades();
    this.stopEffects();
    this.music(this.current, true);
    if (enabled) for (const sound of sounds) this.effect({ ...sound, delay: 0 });
  }
  restore(args, sounds = []) {
    const sameMusic = this.enabled && this.track && args && this.current
      && soundPath(this.map, args.key) === soundPath(this.map, this.current.key);
    this.stopFades();
    this.stopEffects();
    if (sameMusic) {
      // Seeking settles the snapshot's volume without rewinding its music or intro.
      this.current = args;
      this.setLevel(this.track, Math.max(0, Math.min(1, Number(args.volume ?? 0.8))));
      // stopEffects also cancels pending music starts; resume one immediately.
      if (this.track.paused) this.play(this.track);
    } else this.music(args, true);
    for (const sound of sounds) this.effect({ ...sound, delay: 0 });
  }
}
