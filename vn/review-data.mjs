// Shared on-disk contract with the classic reader's js/story-review.js.
export const REVIEW_KEY = 'arknights.translationReviews.v1';
export const reviewId = (key, field, lines) => JSON.stringify([key, field, lines]);

export function createReviewStore(storage) {
  const read = () => {
    const notes = JSON.parse(storage.getItem(REVIEW_KEY) || '[]');
    if (!Array.isArray(notes) || notes.some((note) => !note || typeof note.id !== 'string'
      || typeof note.story?.key !== 'string' || !Array.isArray(note.lines) || !note.lines.length
      || note.lines.some((line) => !Number.isSafeInteger(line) || line < 1)
      || typeof note.spanish !== 'string' || typeof note.comment !== 'string'
      || typeof note.proposal !== 'string')) throw new Error('Invalid review notes');
    return notes;
  };
  return {
    read,
    save(note) {
      // Read again on every mutation so changes in another tab are retained.
      const notes = read().filter((entry) => entry.id !== note.id);
      notes.push(note);
      storage.setItem(REVIEW_KEY, JSON.stringify(notes));
    },
    remove(id) { storage.setItem(REVIEW_KEY, JSON.stringify(read().filter((note) => note.id !== id))); },
    clear() { read(); storage.removeItem(REVIEW_KEY); },
  };
}

function sourceField(source, line, field) {
  const raw = source.split(/\r?\n/)[line - 1];
  if (raw === undefined) throw new Error('Missing review source line');
  if (field === 'options') {
    const value = /options\s*=\s*"([^"]*)"/i.exec(raw)?.[1];
    if (value === undefined) throw new Error('Missing review choices');
    return value;
  }
  // Keep whitespace, markup and placeholders exactly as in the source, even
  // though the VN parser trims dialogue and substitutes the Doctor's name.
  return /^(?:\[[^\]]+\])?(.*)$/.exec(raw)[1];
}

export function reviewContext({ story, step, sources, sourceUrl,
  sourceError = 'No se pudo obtener un original compatible con esta traducción.' }) {
  if (!sources?.es || !['dialogue', 'choice'].includes(step?.kind)) return null;
  const field = step.kind === 'choice' ? 'options' : 'free', lines = [step.line];
  const spanishLine = sources.es.split(/\r?\n/)[step.line - 1];
  const speaker = step.kind === 'choice' ? 'Doctor' : /\[name\s*=\s*"([^"]*)"/i.exec(spanishLine)?.[1] || 'Narración';
  return { id: reviewId(story.id, field, lines), story: { key: story.id, name: story.title, code: story.code || '' },
    field, lines, speaker, spanish: sourceField(sources.es, step.line, field), sourceUrl,
    english: sources.en ? sourceField(sources.en, step.line, field) : null,
    sourceError: sources.en ? null : sourceError };
}

export function sceneLabel(story) {
  const phase = story.key.endsWith('_beg') ? 'Antes del combate' : story.key.endsWith('_end') ? 'Después del combate' : '';
  return [story.code || story.name, phase].filter(Boolean).join(' · ');
}

// Keep the classic report format so either reader's notes can be reviewed together.
export function exportReviews(notes) {
  const quote = (value) => String(value).split(/\r?\n/).map((line) => `> ${line}`).join('\n');
  return '# Revisión de traducción\n\n' + notes.slice()
    .sort((a, b) => a.story.key.localeCompare(b.story.key) || a.lines[0] - b.lines[0])
    .map((note) => [
      `## ${sceneLabel(note.story)} · ${note.speaker}`,
      `Archivo: gamedata/es_ES/story/${note.story.key}.txt`,
      `Líneas: ${note.lines.join(', ')} · Campo: ${note.field}`,
      `Fuente: ${note.sourceUrl}`,
      '### Inglés\n' + quote(note.english ?? `Original no disponible: ${note.sourceError}`),
      '### Español\n' + quote(note.spanish),
      ...(note.comment ? ['### Comentario\n' + quote(note.comment)] : []),
      ...(note.proposal ? ['### Propuesta\n' + quote(note.proposal)] : []),
    ].join('\n\n')).join('\n\n') + '\n';
}
