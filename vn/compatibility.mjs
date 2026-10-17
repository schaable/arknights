import { parseScript, buildTimeline } from './script.mjs';

// Keep source line numbers: saves and language switching use physical AVG lines.
export function scriptSignature(commands) {
  return JSON.stringify(commands.map(({ text, args, ...item }) => ({ ...item,
    args: Object.fromEntries(Object.entries(args).filter(([key]) =>
      key !== 'options' && !(item.command === 'line' && key === 'name'))),
  })));
}

export function inspectScript(source) {
  let commands;
  try { commands = parseScript(source); }
  catch (error) { return { issues: [{ code: error.code || 'invalid', line: error.line, command: error.command, detail: error.message }] }; }
  const issues = [];
  const soundKeys = new Set();
  let values = [], conditional = false;
  for (const item of commands) {
    const { command, args: a, line } = item;
    if (command === 'predicate') conditional = !!a.references && values.some((value) => !a.references.split(';').includes(value));
    if (command === 'decision') {
      if (conditional) issues.push({ code: 'unsupported', command, line, detail: 'Conditional or nested decisions' });
      values = a.values.split(';'); conditional = false;
    }
    // These variants need additional rendering work even when the tag is known.
    if ((a.yscale && a.xscale && a.yscale !== a.xscale)
      || (a.yscaleto && a.xscaleto && a.yscaleto !== a.xscaleto)
      || (a.yscalefrom && a.xscalefrom && a.yscalefrom !== a.xscalefrom)) {
      issues.push({ code: 'unsupported', command, line, detail: 'Nonuniform image scaling' });
    }
    if (command === 'cameraeffect' && a.effect?.toLowerCase() !== 'grayscale') {
      issues.push({ code: 'unsupported', command, line, detail: `Camera effect: ${a.effect}` });
    }
    if (command === 'gotopage' && a.dest?.toLowerCase() !== 'home') {
      issues.push({ code: 'unsupported', command, line, detail: `Page destination: ${a.dest}` });
    }
    if (command === 'charactercutin' && ((a.style && a.style !== 'cutin')
      || (a.fadestyle && !['alpha', 'horiz_expand_center'].includes(a.fadestyle)))) {
      issues.push({ code: 'unsupported', command, line, detail: 'Unvalidated cut-in style' });
    }
    if (command === 'showitem' && a.is_module === 'true') {
      issues.push({ code: 'unsupported', command, line, detail: 'Module item artwork' });
    }
    if (command === 'playmusic' || command === 'playsound') {
      for (const value of [a.key, a.intro].filter(Boolean)) soundKeys.add(value.replace(/^\$/, ''));
    }
  }
  // Exercise every answer at each decision, without exponential combinations.
  // AVG predicates here depend only on the most recent decision.
  if (!issues.length) try {
    const choices = commands.filter((c) => c.command === 'decision');
    const answers = Object.fromEntries(choices.map((c) => [c.line, c.args.values.split(';')[0]]));
    const paths = [answers, ...choices.flatMap((c) => c.args.values.split(';').slice(1).map((v) => ({ ...answers, [c.line]: v })))];
    for (const path of paths) {
      const timeline = buildTimeline(commands, path);
      if (!timeline.some((s) => s.kind === 'dialogue') || timeline.at(-1).kind !== 'end') throw new Error('Incomplete story path');
    }
  } catch (error) { issues.push({ code: error.code || 'invalid', detail: error.message }); }
  const cover = commands.find((c) => ['background', 'image'].includes(c.command) && c.args.image && !/^(bg_)?(black|white)$/i.test(c.args.image));
  return { commands, issues, soundKeys: [...soundKeys].sort(), cover: cover ? [cover.command, cover.args.image] : null };
}
