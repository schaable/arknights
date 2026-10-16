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
  const path = kind === 'character'
    ? `avg/characters/${encodeURIComponent(characterId(name))}.png`
    : `torappu/dynamicassets/avg/${kind === 'image' ? 'images' : 'backgrounds'}/${name}.png`;
  return [primary + path.toLowerCase(), fallback + path.toLowerCase()];
}

export function loadImage(img, kind, name, onError) {
  const urls = imageURLs(kind, name);
  let index = 0;
  img.dataset.asset = name;
  img.onerror = () => {
    if (++index < urls.length) img.src = urls[index];
    else { img.hidden = true; onError(); }
  };
  img.src = urls[index];
}

export class Soundtrack {
  constructor(map, onError) {
    this.map = map;
    this.onError = onError;
    this.enabled = false;
    this.current = null;
    this.track = null;
    this.effects = new Set();
    this.timers = new Set();
    this.fades = new Map();
  }
  create(key, volume, loop = false) {
    const path = soundPath(this.map, key);
    if (!path) { this.onError(); return null; }
    const audio = new Audio();
    const urls = [primary + `torappu/dynamicassets/audio/${path}.mp3`.toLowerCase(),
      'https://raw.githubusercontent.com/Aceship/Arknight-voices/main/' + path.replace(/^Sound_Beta_2\//, '').toLowerCase() + '.wav'];
    let attempt = 0;
    audio.volume = Math.max(0, Math.min(1, Number(volume ?? 0.8))) * 0.55;
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
  }
  dispose(audio) {
    if (!audio) return;
    clearInterval(this.fades.get(audio));
    this.fades.delete(audio);
    audio.onended = audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  fade(audio, target, seconds, done = () => {}) {
    if (!audio) return;
    clearInterval(this.fades.get(audio));
    const initial = audio.volume, start = performance.now();
    const timer = setInterval(() => {
      const fraction = Math.min(1, (performance.now() - start) / (Number(seconds) * 1000));
      audio.volume = initial + (target - initial) * fraction;
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
      const target = audio.volume;
      audio.volume = 0;
      this.fade(audio, target, seconds);
    }
    if (hasIntro) audio.onended = () => {
      if (this.track === audio) this.music({ ...args, intro: null, delay: 0 });
    };
    this.later(() => { if (this.track === audio) this.play(audio); }, resume ? 0 : args.delay);
  }
  effect(args) {
    if (!this.enabled) return;
    const audio = this.create(args.key, args.volume);
    if (!audio) return;
    this.effects.add(audio);
    audio.onended = () => { this.effects.delete(audio); this.dispose(audio); };
    this.later(() => this.play(audio), args.delay);
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
  enable(enabled) {
    this.enabled = enabled;
    this.stopFades();
    this.stopEffects();
    this.music(this.current, true);
  }
  restore(args) {
    this.stopFades();
    this.stopEffects();
    this.music(args, true);
  }
}
