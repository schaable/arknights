import { createReviewStore, exportReviews, REVIEW_KEY } from './review-data.mjs';

export function createReviewTools({ storage, t, onPause, onCompare }) {
  const $ = (id) => document.getElementById(id);
  const store = createReviewStore(storage);
  let current = null, editing = null, notes = [], available = true, language = 'es', version = 0;
  let statusKey = '', errorKey = '';
  const label = (button, text) => { button.title = text; button.setAttribute('aria-label', text); };
  const status = (key) => { statusKey = key; $('review-status').textContent = t(key); };
  const error = (key) => { errorKey = key; $('review-error').textContent = key ? t(key) : ''; };
  function render() {
    $('review-toolbar').setAttribute('aria-label', t('reviewTools'));
    $('review-controls').setAttribute('aria-label', t('reviewTools'));
    $('review-controls').hidden = !current;
    $('dialogue-panel').classList.toggle('has-review', !!current);
    const saved = available && notes.some((note) => note.id === current?.id);
    $('review-note').classList.toggle('has-note', saved);
    $('dialogue-panel').classList.toggle('has-note', saved);
    label($('review-note'), t(saved ? 'reviewEdit' : 'reviewAdd'));
    label($('review-toggle'), t(current?.english == null ? 'reviewOriginalUnavailable' : language === 'en' ? 'reviewShowSpanish' : 'reviewShowEnglish'));
    $('review-toggle').textContent = language === 'en' ? 'ES' : 'EN';
    $('review-toggle').setAttribute('aria-pressed', String(language === 'en'));
    $('review-toggle').disabled = current?.english == null;
    $('review-count').textContent = available ? String(notes.length) : '—';
    $('review-copy').disabled = $('review-clear').disabled = !available || !notes.length;
    label($('review-copy'), `${t('reviewCopy')} (${available ? notes.length : '—'})`);
    label($('review-clear'), t('reviewClearHelp'));
    if (statusKey) $('review-status').textContent = t(statusKey);
    if (errorKey) $('review-error').textContent = t(errorKey);
  }
  function refresh() {
    try {
      notes = store.read(); available = true;
      if (statusKey === 'reviewReadError') { statusKey = ''; $('review-status').textContent = ''; }
    } catch { notes = []; available = false; status('reviewReadError'); }
    render();
  }
  function cancel() {
    version++;
    editing = null;
    $('review-dialog').close();
    $('review-export-dialog').close();
  }
  $('review-toggle').addEventListener('click', () => { onPause(); onCompare(); });
  $('review-note').addEventListener('click', () => {
    if (!current) return;
    onPause(); refresh();
    const existing = notes.find((note) => note.id === current.id);
    // Editing a saved comment retains the source snapshots captured with it.
    editing = structuredClone(existing || current);
    $('review-location').textContent = `${editing.story.code || editing.story.name} · ${editing.speaker} · ${t('reviewLine')} ${editing.lines.join(', ')}`;
    $('review-spanish').textContent = editing.spanish;
    $('review-english').textContent = editing.english ?? t('reviewOriginalUnavailable');
    $('review-comment').value = existing?.comment || '';
    $('review-proposal').value = existing?.proposal || '';
    $('review-delete').hidden = !existing;
    error('');
    $('review-dialog').showModal();
    $('review-comment').focus();
  });
  $('review-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editing) return;
    const comment = $('review-comment').value.trim(), proposal = $('review-proposal').value.trim();
    if (!comment && !proposal) { error('reviewEmpty'); $('review-comment').focus(); return; }
    try {
      const missing = editing.english == null;
      store.save({ ...editing, comment, proposal });
      $('review-dialog').close(); refresh();
      status(missing ? 'reviewSavedWithoutEnglish' : 'reviewSaved');
    } catch { error('reviewSaveError'); }
  });
  $('review-delete').addEventListener('click', () => {
    if (!editing) return;
    try { store.remove(editing.id); $('review-dialog').close(); refresh(); status('reviewDeleted'); }
    catch { error('reviewDeleteError'); }
  });
  for (const id of ['review-cancel', 'review-close']) $(id).addEventListener('click', () => $('review-dialog').close());
  $('review-dialog').addEventListener('close', () => { editing = null; });
  $('review-export-close').addEventListener('click', () => $('review-export-dialog').close());
  $('review-copy').addEventListener('click', async () => {
    onPause();
    const token = version;
    let text;
    try {
      const saved = store.read();
      if (!saved.length) { refresh(); return; }
      text = exportReviews(saved);
    } catch { refresh(); return; }
    try {
      await navigator.clipboard.writeText(text);
      if (token === version) status('reviewCopied');
    } catch {
      if (token !== version) return;
      $('review-export-text').value = text;
      $('review-export-dialog').showModal();
      $('review-export-text').focus(); $('review-export-text').select();
    }
  });
  $('review-clear').addEventListener('click', () => {
    onPause();
    try { store.clear(); refresh(); status('reviewCleared'); }
    catch { status('reviewClearError'); }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === REVIEW_KEY || event.key === null) refresh();
  });
  refresh();
  return {
    setContext(context, displayedLanguage = 'es') { current = context; language = displayedLanguage; refresh(); },
    localize: render,
    reset() { cancel(); current = null; render(); },
  };
}
