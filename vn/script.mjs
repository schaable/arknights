// The same line/tag and case-insensitive argument conventions as js/story.js,
// with a deliberately bounded directive set. Generation checks every source.
const supported = new Set([
  'header', 'dialog', 'image', 'background', 'imagetween', 'character',
  'decision', 'predicate', 'delay', 'blocker', 'cameraeffect', 'camerashake',
  'playmusic', 'stopmusic', 'playsound', 'skiptothis', 'startbattle', 'tutorial', 'gotopage',
]);

export class ScriptError extends Error {
  constructor(code, message, line, command) {
    super(message); this.code = code; this.line = line; this.command = command;
  }
}

export function parseScript(source) {
  return source.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    const match = /^(\[[^\]]+\])?(.*)$/.exec(line.trim());
    const tag = match[1]?.slice(1, -1) || '';
    const args = Object.fromEntries([...tag.matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^,)]+))/g)]
      .map((m) => [m[1].toLowerCase(), m[2] ?? m[3].trim()]));
    let command = /^([\w]+)(?:\s*\(|$)/.exec(tag)?.[1].toLowerCase();
    if (!command && 'delay' in args) {
      command = 'delay';
      args.time = args.delay;
    }
    if (!command && (!tag || 'name' in args)) command = 'line';
    if (command !== 'line' && !supported.has(command)) {
      throw new ScriptError('unsupported', `Unsupported directive at line ${index + 1}: ${tag}`, index + 1, command || tag);
    }
    if (command === 'decision') {
      if (!args.options || !args.values || args.options.split(';').length !== args.values.split(';').length) {
        throw new ScriptError('invalid', `Invalid decision at line ${index + 1}`, index + 1, command);
      }
    }
    return [{ command, args, text: match[2].trim(), line: index + 1 }];
  });
}

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function initialScene() {
  return { background: null, image: null, characters: [], focus: 1,
    blocker: { color: 'rgb(0, 0, 0)', alpha: 0 }, grayscale: 0, music: null };
}

export function applyEvent(state, { command, args: a }) {
  switch (command) {
    case 'background':
    case 'image': {
      state[command] = a.image ? { name: a.image, x: number(a.x), y: number(a.y),
        scale: number(a.xscale, 1) } : null;
      if (command === 'background') state.characters = [];
      break;
    }
    case 'imagetween':
      if (state.image) {
        state.image.x = number(a.xto, state.image.x);
        state.image.y = number(a.yto, state.image.y);
        state.image.scale = number(a.xscaleto, state.image.scale);
      }
      break;
    case 'character':
      state.characters = [a.name, a.name2, a.name3].filter(Boolean).map((name) => name.trim());
      state.focus = number(a.focus, 1);
      break;
    case 'blocker': {
      const rgb = [number(a.r), number(a.g), number(a.b)];
      // AVG uses both normalized RGB and byte RGB, sometimes in the same scene.
      const scale = rgb.every((n) => n <= 1) ? 255 : 1;
      state.blocker = { color: `rgb(${rgb.map((n) => Math.round(n * scale)).join(', ')})`,
        alpha: number(a.a, 1) };
      break;
    }
    case 'cameraeffect':
      if (a.effect?.toLowerCase() === 'grayscale') state.grayscale = number(a.amount);
      else throw new Error(`Unsupported camera effect: ${a.effect}`);
      break;
    case 'playmusic': state.music = { ...a }; break;
    case 'stopmusic': state.music = null; break;
  }
  return state;
}

// Compile only the reachable path. State snapshots make back/restore deterministic;
// events preserve the timing between clicks. Predicates gate visuals AND dialogue.
export function buildTimeline(commands, answers = {}) {
  const state = initialScene();
  const steps = [];
  let events = [], active = true, answer;
  const append = (kind, item, extra = {}) => {
    steps.push({ kind, line: item.line, text: item.text, speaker: item.args.name || '',
      state: structuredClone(state), events, ...extra });
    events = [];
  };
  for (const item of commands) {
    const { command, args } = item;
    if (command === 'predicate') {
      active = !args.references || args.references.split(';').includes(answer);
      continue;
    }
    if (command === 'decision') {
      active = true;
      const values = args.values.split(';');
      const options = args.options.split(';').map((text, i) => ({ text, value: values[i] }));
      answer = answers[item.line];
      append('choice', item, { options, answer });
      if (!values.includes(answer)) return steps;
      continue;
    }
    if (!active) continue;
    if (command === 'line') {
      append('dialogue', item);
    } else if (command === 'startbattle' || command === 'gotopage') {
      append('end', item);
      return steps;
    } else if (!['header', 'skiptothis', 'tutorial'].includes(command)) {
      applyEvent(state, item);
      events.push(item);
    }
  }
  append('end', { line: (commands.at(-1)?.line || 0) + 1, text: '', args: {} });
  return steps;
}

// Validate saved answers against the actual script, keeping only reachable choices.
export function validateProgress(commands, saved) {
  const answers = {};
  for (const item of commands.filter((c) => c.command === 'decision')) {
    const value = saved?.answers?.[item.line];
    if (!item.args.values.split(';').includes(value)) break;
    answers[item.line] = value;
  }
  const timeline = buildTimeline(commands, answers);
  const index = timeline.findIndex((step) => step.line === saved?.line);
  return { answers, index: index < 0 ? 0 : index, timeline };
}
