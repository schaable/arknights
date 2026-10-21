import { buildTimeline, validateProgress, applyEvent, initialScene, tweenArt } from './script.mjs';
import { loadImage, Soundtrack } from './assets.mjs';
import { createCover } from './covers.mjs';
import { loadStory } from './loader.mjs';
import { reviewContext } from './review-data.mjs';
import { createFullscreen } from './fullscreen.mjs';

export function createPlayer({ preferences, t, store, review, onChange }) {
  const $ = (id) => document.getElementById(id);
  let story, group, loadController, loadVersion = 0;
  let storyLanguage = preferences.language, loadProblems = [], loadFailure = null, usedFallback = false;
  let sourceStructure;
  let scripts, sources = {}, commands, timeline = [], answers = {}, index = 0, started = false, ready = false;
  let comparedLanguage = null;
  let soundtrack, state = initialScene(), busy = false, typing = false, auto = false;
  let run = 0, typeTimer, autoTimer, waitController = new AbortController();
  let fullText = '', statusKey = '', read = false;
  const animations = new Set();
  const fullscreen = createFullscreen({ t, onError: () => notice('fullscreenError') });

  function notice(key) { statusKey = key; $('status').textContent = t(key); }
  function localize() {
    document.documentElement.lang = preferences.language;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('.close').forEach((el) => el.setAttribute('aria-label', t('close')));
    $('language').value = ready ? storyLanguage : preferences.language;
    for (const option of $('language').options) option.disabled = ready && !scripts[option.value];
    $('nickname').value = preferences.nickname;
    $('speed').value = preferences.speed;
    $('motion').checked = preferences.motion;
    $('progress').setAttribute('aria-label', t('progress'));
    $('choices').setAttribute('aria-label', t('choose'));
    $('dialogue').setAttribute('aria-label', t('continue'));
    if (!ready && loadFailure) $('begin').textContent = t(loadFailure.retryable ? 'retry' : 'storyUnavailable');
    if (statusKey) notice(statusKey);
    renderLoadNotice();
    review.localize();
    updateControls();
  }

  function renderLoadNotice() {
    const messages = [];
    if (loadFailure) messages.push(t('load_' + (loadFailure.code || 'invalid')));
    if (usedFallback) messages.push(t('fallback_' + storyLanguage));
    for (const problem of loadProblems) {
      const label = problem.language === 'audio' ? '' : t('language_' + problem.language) + ': ';
      messages.push(label + t('load_' + (problem.error.code || 'invalid')));
    }
    $('load-notice').hidden = !messages.length;
    $('load-message').textContent = messages.join(' ');
    $('load-retry').hidden = !(loadFailure?.retryable || loadProblems.some((p) => p.error.retryable));
    if (story) $('load-classic').href = '../' + story.classicHash;
  }

  function persist() {
    if (!ready || !started || !story) return;
    if (timeline[index]?.completionOnly) return;
    if (!store.save(group, story, {
      line: timeline[index]?.line, answers, read, updated: Date.now(), structure: sourceStructure,
    })) notice('storageError');
  }

  function updateControls() {
    fullscreen.refresh();
    const step = timeline[index];
    $('begin').hidden = ready && (read || step?.kind === 'end');
    if (ready) $('begin').textContent = t(index && !read ? 'resume' : 'begin');
    $('back').disabled = !started || index === 0;
    $('history').disabled = !started || step?.completionOnly;
    $('auto').disabled = !started || step?.kind === 'end';
    $('next').disabled = !started || (step?.kind !== 'dialogue' && !busy);
    $('restart').disabled = !ready;
    $('story-settings').hidden = !ready;
    $('sound').disabled = false;
    $('auto').setAttribute('aria-pressed', auto);
    $('auto-speed').value = preferences.autoSpeed;
    $('auto-speed').title = t('autoSpeed');
    $('sound').setAttribute('aria-pressed', preferences.sound);
    $('sound').setAttribute('aria-label', t('sound'));
    $('sound').title = t(preferences.sound ? 'soundOn' : 'soundOff');
    $('volume').value = preferences.volume;
    $('volume').setAttribute('aria-valuetext', `${preferences.volume}%`);
    $('volume-value').textContent = `${preferences.volume}%`;
    $('settings').setAttribute('aria-label', t('settings'));
    $('settings').title = t('settings');
    const percent = step?.kind === 'end' ? 100 : Math.floor(((step?.line || 0) / (commands?.at(-1)?.line || 1)) * 100);
    $('progress').value = percent;
    $('position').textContent = String(percent).padStart(2, '0') + '%';
  }

  function syncSound() {
    // The saved preference survives navigation; playback belongs to the visible story.
    const enabled = preferences.sound && started && !document.hidden;
    if (soundtrack && soundtrack.enabled !== enabled) soundtrack.enable(enabled, state.sounds);
  }

  function animate(element, frames, seconds, property) {
    element.getAnimations().filter((animation) => animation.vnProperty === property).forEach((animation) => animation.cancel());
    if (preferences.motion || !seconds) return;
    const animation = element.animate(frames, { duration: Number(seconds) * 1000, easing: 'linear' });
    animation.vnProperty = property;
    animations.add(animation);
    animation.finished.catch(() => {}).finally(() => animations.delete(animation));
    return animation;
  }
  function wait(seconds) {
    if (preferences.motion || !Number(seconds)) return Promise.resolve();
    const signal = waitController.signal;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, Number(seconds) * 1000);
      signal.addEventListener('abort', done, { once: true });
    });
  }
  function transform(art) {
    return `translate(${art.x / 12.8}%, ${-art.y / 7.2}%) scale(${art.scale})`;
  }
  function drawArt(kind, art, duration = 0) {
    const layer = $(kind);
    const oldImages = [...layer.children];
    if (!art) {
      if (duration && !preferences.motion) {
        // A prior crossfade may still have both images attached. Clear every
        // layer, including one whose fade-in completion was just cancelled.
        for (const old of oldImages) {
          const opacity = getComputedStyle(old).opacity;
          old.style.opacity = 0;
          const fade = animate(old, [{ opacity }, { opacity: 0 }], duration, 'opacity');
          fade?.finished.then(() => old.remove()).catch(() => {});
        }
      } else layer.replaceChildren();
      return;
    }
    const img = document.createElement('img');
    img.alt = '';
    img.style.transform = transform(art);
    const token = loadVersion;
    loadImage(img, kind, art.name, () => { if (token === loadVersion) notice('assetError'); });
    layer.append(img);
    if (duration && !preferences.motion) {
      const fade = animate(img, [{ opacity: 0 }, { opacity: 1 }], duration, 'opacity');
      fade?.finished.then(() => oldImages.forEach((el) => el.remove())).catch(() => {});
    } else layer.replaceChildren(img);
  }
  function drawCharacters() {
    const existing = [...$('characters').children];
    const nodes = state.characters.map((name, i) => {
      const img = existing[i] || document.createElement('img');
      img.alt = '';
      if (img.dataset.asset !== name || img.hidden) {
        img.hidden = false;
        const token = loadVersion;
        loadImage(img, 'character', name, () => { if (token === loadVersion) notice('assetError'); });
      }
      img.dataset.slot = state.characters.length === 1 ? 'center' : ['left', 'right', 'center'][i];
      img.classList.toggle('dim', state.focus !== i + 1 && state.focus !== 0);
      return img;
    });
    $('characters').replaceChildren(...nodes);
  }

  function loadOverlay(img, kind, name, ready) {
    const token = loadVersion;
    const failed = () => { if (token === loadVersion) notice('assetError'); };
    if (!ready) { loadImage(img, kind, name, failed); return; }
    // A one-second photograph must be visible for that second even on its
    // first request. Next/Back/navigation can still cancel this bounded wait.
    return new Promise((resolve) => {
      const signal = waitController.signal;
      const finish = (loaded) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        img.onload = img.onerror = null;
        resolve(loaded);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => { img.hidden = true; failed(); finish(false); }, 15000);
      signal.addEventListener('abort', abort, { once: true });
      loadImage(img, kind, name, () => { failed(); finish(false); }, () => finish(true));
    });
  }

  function drawCutin(id, duration = 0, ready = false) {
    const previous = [...$('cutins').children].find((node) => node.dataset.widget === id);
    const cutin = state.cutins.find((value) => value.id === id);
    if (!cutin) {
      if (!previous) return;
      const frames = previous.dataset.fade === 'horiz_expand_center'
        ? [{ clipPath: getComputedStyle(previous).clipPath }, { clipPath: 'inset(0 50%)' }]
        : [{ opacity: getComputedStyle(previous).opacity }, { opacity: 0 }];
      const fade = animate(previous, frames, duration, 'cutin');
      if (fade) {
        if (previous.dataset.fade === 'horiz_expand_center') previous.style.clipPath = 'inset(0 50%)';
        else previous.style.opacity = 0;
        fade.finished.then(() => previous.remove()).catch(() => {});
      } else previous.remove();
      return;
    }
    previous?.remove();
    const panel = document.createElement('div');
    panel.className = 'cutin';
    panel.dataset.widget = id;
    panel.dataset.fade = cutin.fade;
    panel.style.left = `${50 + cutin.x / 12.8}%`;
    panel.style.top = `${-cutin.y / 7.2}%`;
    panel.style.width = `${cutin.width / 12.8}%`;
    panel.style.height = `${cutin.height / 7.2}%`;
    const img = document.createElement('img');
    img.alt = '';
    panel.append(img);
    $('cutins').append(panel);
    const reveal = () => {
      panel.style.visibility = '';
      animate(panel, cutin.fade === 'horiz_expand_center'
        ? [{ clipPath: 'inset(0 50%)' }, { clipPath: 'inset(0 0%)' }]
        : [{ opacity: 0 }, { opacity: 1 }], duration, 'cutin');
    };
    const loaded = loadOverlay(img, 'character', cutin.name, ready);
    if (loaded) {
      panel.style.visibility = 'hidden';
      return loaded.then((okay) => { if (okay) reveal(); });
    }
    reveal();
  }

  function drawItem(duration = 0, ready = false) {
    const layer = $('item');
    const old = [...layer.children];
    if (state.item) {
      const img = document.createElement('img');
      img.alt = '';
      layer.replaceChildren(img);
      const reveal = () => { img.style.visibility = ''; animate(img, [{ opacity: 0 }, { opacity: 1 }], duration, 'opacity'); };
      const loaded = loadOverlay(img, 'item', state.item.name, ready);
      if (loaded) {
        img.style.visibility = 'hidden';
        return loaded.then((okay) => { if (okay) reveal(); });
      }
      reveal();
    } else for (const img of old) {
      const opacity = getComputedStyle(img).opacity;
      img.style.opacity = 0;
      const fade = animate(img, [{ opacity }, { opacity: 0 }], duration, 'opacity');
      if (fade) fade.finished.then(() => img.remove()).catch(() => {});
      else img.remove();
    }
  }

  function restoreScene(snapshot) {
    animations.forEach((a) => a.cancel());
    animations.clear();
    state = structuredClone(snapshot);
    drawArt('background', state.background);
    drawArt('image', state.image);
    drawCharacters();
    $('cutins').replaceChildren();
    state.cutins.forEach((cutin) => drawCutin(cutin.id));
    drawItem();
    $('blocker').style.backgroundColor = state.blocker.color;
    $('blocker').style.opacity = state.blocker.alpha;
    $('camera').style.filter = `grayscale(${state.grayscale})`;
    soundtrack?.restore(state.music, state.sounds);
  }

  async function event(item) {
    const { command, args: a } = item;
    const token = run;
    const previous = structuredClone(state);
    applyEvent(state, item);
    const duration = Number(a.fadetime ?? a.duration ?? (command === 'charactercutin' ? 0.3 : 0));
    switch (command) {
      case 'background':
      case 'image':
        drawArt(command, state[command], duration);
        if (command === 'background') drawCharacters();
        break;
      case 'character': drawCharacters(); break;
      case 'charactercutin': await drawCutin(a.widgetid || '0', duration, true); break;
      case 'showitem':
      case 'hideitem': await drawItem(duration, true); break;
      case 'imagetween':
      case 'backgroundtween': {
        const layer = command === 'imagetween' ? 'image' : 'background';
        const img = $(layer).lastElementChild;
        if (img && previous[layer]) {
          const from = tweenArt(previous[layer], a, 'from');
          img.style.transform = transform(state[layer]);
          animate(img, [{ transform: transform(from) }, { transform: transform(state[layer]) }], duration, 'transform');
        }
        break;
      }
      case 'blocker':
        $('blocker').style.backgroundColor = state.blocker.color;
        $('blocker').style.opacity = state.blocker.alpha;
        animate($('blocker'), [
          { opacity: Number(a.afrom ?? previous.blocker.alpha), backgroundColor: previous.blocker.color },
          { opacity: state.blocker.alpha, backgroundColor: state.blocker.color },
        ], duration, 'blocker');
        break;
      case 'cameraeffect':
        $('camera').style.filter = `grayscale(${state.grayscale})`;
        animate($('camera'), [{ filter: `grayscale(${a.initamount ?? previous.grayscale})` },
          { filter: `grayscale(${state.grayscale})` }], duration, 'filter');
        break;
      case 'camerashake': {
        const x = Number(a.xstrength || 3), y = Number(a.ystrength || 3);
        const frames = Array.from({ length: Math.max(3, Math.round(duration * Number(a.vibrato || 15))) }, (_, i) => ({
          transform: `translate(${i % 2 ? x : -x}px, ${i % 3 ? y : -y}px)`,
        }));
        frames.push({ transform: 'translate(0, 0)' });
        animate($('camera'), frames, duration, 'shake');
        break;
      }
      case 'playmusic': soundtrack?.music(a); break;
      case 'stopmusic': soundtrack?.music(null, false, a.fadetime); break;
      case 'playsound': soundtrack?.effect(a); break;
      case 'stopsound': soundtrack?.stopEffect(a); break;
      case 'delay': await wait(a.time); return;
      case 'dialog': await wait(a.time); return;
    }
    if (token === run && a.block === 'true') await wait(duration);
  }

  const displayText = (text) => text.replace(/\{@nickname\}/gi, () => preferences.nickname.trim() || 'Doctor');
  function stopAuto() { auto = false; clearTimeout(autoTimer); updateControls(); }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (auto && !typing && !busy && timeline[index]?.kind === 'dialogue' && !document.hidden) {
      autoTimer = setTimeout(next, (1600 + Array.from(fullText).length * 45) / preferences.autoSpeed);
    }
  }
  function finishText() {
    clearInterval(typeTimer);
    typing = false;
    $('text').textContent = fullText;
    scheduleAuto();
  }
  function showText(instant = false) {
    const step = timeline[index];
    const language = comparedLanguage || storyLanguage;
    const line = scripts[language]?.find((command) => command.line === step.line);
    $('stage').dataset.story = story.id;
    $('stage').dataset.line = step.line;
    $('stage').dataset.kind = step.kind;
    $('dialogue-panel').hidden = $('dialogue').hidden = step.kind === 'end';
    $('ending').hidden = step.kind !== 'end';
    $('choices').replaceChildren();
    $('choices').hidden = step.kind !== 'choice';
    clearInterval(typeTimer);
    typing = false;
    review.setContext(reviewContext({ story, step, sources,
      sourceUrl: story.source.languages.en ? new URL(story.source.languages.en, location.href).href : '',
      sourceError: t('reviewSourceError') }), language);
    if (step.kind === 'end') {
      read = true;
      stopAuto();
      soundtrack?.enable(false);
      persist();
      updateControls();
      onChange();
      $('replay').focus({ preventScroll: true });
      return;
    }
    $('speaker').textContent = displayText(step.kind === 'choice' ? 'Doctor' : line?.args.name || '');
    $('speaker').lang = $('text').lang = $('choices').lang = language;
    fullText = step.kind === 'choice' ? t('choose') : displayText(line?.text ?? step.text);
    $('text').textContent = '';
    if (step.kind === 'choice') {
      stopAuto();
      const texts = line.args.options.split(';');
      for (const [i, option] of step.options.entries()) {
        const button = document.createElement('button');
        button.textContent = displayText(texts[i]);
        button.addEventListener('click', () => choose(option.value));
        $('choices').append(button);
      }
      $('text').textContent = fullText;
      if (!comparedLanguage) $('choices').firstElementChild.focus({ preventScroll: true });
    } else if (!instant && preferences.speed && !preferences.motion) {
      const letters = Array.from(fullText);
      let count = 0;
      typing = true;
      typeTimer = setInterval(() => {
        $('text').textContent = letters.slice(0, ++count).join('');
        if (count >= letters.length) finishText();
      }, 1000 / preferences.speed);
    } else finishText();
    updateControls();
  }

  function cancelPending() {
    run++;
    waitController.abort();
    waitController = new AbortController();
    clearInterval(typeTimer);
    clearTimeout(autoTimer);
    typing = false;
    busy = false;
  }
  async function showStep(animateScene = false) {
    cancelPending();
    syncSound();
    comparedLanguage = null;
    review.setContext(null);
    const token = run;
    const step = timeline[index];
    if (step.kind !== 'end') read = false;
    $('choices').hidden = true;
    $('ending').hidden = true;
    $('dialogue-panel').hidden = $('dialogue').hidden = true;
    busy = animateScene;
    updateControls();
    persist();
    if (animateScene) {
      busy = true;
      $('stage').setAttribute('aria-busy', 'true');
      for (const item of step.events) {
        if (token !== run) return;
        await event(item);
      }
      if (token !== run) return;
      busy = false;
    } else restoreScene(step.state);
    $('stage').setAttribute('aria-busy', 'false');
    showText(!animateScene);
  }
  function next() {
    if (!started) return;
    if (busy) {
      cancelPending();
      restoreScene(timeline[index].state);
      $('stage').setAttribute('aria-busy', 'false');
      showText(true);
    } else if (typing) finishText();
    else if (timeline[index].kind === 'dialogue' && index < timeline.length - 1) {
      index++;
      showStep(true);
    }
  }
  function choose(value) {
    const step = timeline[index];
    // Returning to an earlier decision intentionally drops downstream decisions.
    answers = Object.fromEntries(Object.entries(answers).filter(([line]) => Number(line) < step.line));
    answers[step.line] = value;
    timeline = buildTimeline(commands, answers);
    index = timeline.findIndex((item) => item.line === step.line) + 1;
    showStep(true);
    $('dialogue').focus({ preventScroll: true });
  }
  function back() {
    if (!started || index === 0) return;
    stopAuto();
    index--;
    showStep();
  }
  function restart() {
    $('settings-dialog').close();
    answers = {};
    timeline = buildTimeline(commands);
    index = 0;
    read = false;
    started = true;
    $('cover').hidden = true;
    stopAuto();
    restoreScene(initialScene());
    showStep(true);
  }
  function openHistory() {
    if (!started || timeline[index]?.completionOnly) return;
    stopAuto();
    if (busy) next();
    if (typing) finishText();
    $('history-list').replaceChildren();
    for (const [i, step] of timeline.slice(0, index + 1).entries()) {
      if (step.kind === 'end') continue;
      const button = document.createElement('button');
      button.className = 'history-line';
      const name = document.createElement('strong');
      name.textContent = step.kind === 'choice' ? 'Doctor' : step.speaker || t('narration');
      const text = step.kind === 'choice' ? step.options.find((o) => o.value === step.answer)?.text || t('choose') : step.text;
      button.append(name, document.createTextNode(displayText(text)));
      button.addEventListener('click', () => { index = i; $('history-dialog').close(); showStep(); });
      $('history-list').append(button);
    }
    $('history-dialog').showModal();
  }

  function dispose() {
    fullscreen.exit({ restoreFocus: false });
    persist();
    loadVersion++;
    loadController?.abort();
    cancelPending();
    review.reset();
    sources = {}; comparedLanguage = null;
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    soundtrack?.enable(false);
    soundtrack = null;
    document.querySelectorAll('.scene img').forEach((img) => { img.onload = img.onerror = null; });
    for (const id of ['background', 'image', 'characters', 'cutins', 'item', 'choices', 'history-list']) $(id).replaceChildren();
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    ready = started = auto = typing = false;
    story = group = null;
    timeline = []; answers = {}; index = 0; read = false; scripts = {}; commands = null;
    loadProblems = []; loadFailure = null; usedFallback = false;
    $('load-notice').hidden = true;
    for (const option of $('language').options) option.disabled = false;
    $('language').value = preferences.language;
    state = initialScene();
    $('blocker').style.opacity = 0;
    $('blocker').style.backgroundColor = 'black';
    $('camera').style.filter = 'none';
    statusKey = ''; $('status').textContent = '';
    $('stage').removeAttribute('data-line');
    $('stage').removeAttribute('data-kind');
    $('stage').removeAttribute('data-story');
    $('stage').setAttribute('aria-busy', 'false');
    $('dialogue-panel').hidden = $('dialogue').hidden = $('ending').hidden = $('choices').hidden = true;
    $('cover').hidden = false;
    $('text').textContent = '';
    updateControls();
  }
  async function load(nextGroup = group, nextStory = story, resumePlayback = false) {
    dispose();
    group = nextGroup; story = nextStory;
    const token = ++loadVersion;
    loadController = new AbortController();
    const signal = loadController.signal;
    const source = story.source;
    $('cover-title').textContent = $('ending-title').textContent = story.title;
    $('cover-subtitle').textContent = group.title;
    $('cover-number').textContent = group.chapter === undefined ? '◇' : String(group.chapter).padStart(2, '0');
    $('cover-category').textContent = t('story');
    $('cover-description').textContent = [story.code, story.phase ? t(story.phase) : ''].filter(Boolean).join(' · ');
    $('cover-art').replaceChildren(createCover(group.cover, { lazy: false }));
    $('begin').disabled = true;
    $('begin').textContent = t('loading');
    try {
      const loaded = await loadStory(source, { language: preferences.language, signal });
      if (token !== loadVersion) return;
      scripts = loaded.scripts;
      sources = loaded.sources;
      storyLanguage = scripts[preferences.language] ? preferences.language : loaded.language;
      loadProblems = loaded.problems;
      usedFallback = storyLanguage !== preferences.language;
      commands = scripts[storyLanguage];
      sourceStructure = loaded.structure;
      store.snapshot();
      let saved = store.group(group).stories[story.id];
      if (saved?.structure && saved.structure !== sourceStructure) {
        if (saved.read) saved = { read: true };
        else { saved = null; notice('progressReset'); }
      }
      ({ answers, timeline, index } = validateProgress(commands, saved));
      read = saved?.read === true;
      soundtrack = new Soundtrack(loaded.audio, () => { if (token === loadVersion) notice('audioError'); }, preferences.volume / 100);
      ready = true;
      $('begin').disabled = false;
      localize();
      if (resumePlayback || read) { started = true; $('cover').hidden = true; showStep(); }
      onChange();
    } catch (error) {
      if (token !== loadVersion || signal.aborted) return;
      console.error(error);
      loadFailure = error;
      renderLoadNotice();
      $('begin').textContent = t(error.retryable ? 'retry' : 'storyUnavailable');
      $('begin').disabled = !error.retryable;
    }
  }

  function begin() {
    if (!ready) { load(); return; }
    started = true;
    $('cover').hidden = true;
    showStep(index === 0);
    $('next').focus({ preventScroll: true });
  }
  $('begin').addEventListener('click', begin);
  $('load-retry').addEventListener('click', () => load(group, story, started));
  $('dialogue').addEventListener('click', next);
  $('stage').addEventListener('click', (event) => { if (event.target === $('stage')) next(); });
  $('next').addEventListener('click', next);
  $('back').addEventListener('click', back);
  $('history').addEventListener('click', openHistory);
  $('restart').addEventListener('click', restart);
  $('replay').addEventListener('click', restart);
  $('auto').addEventListener('click', () => { auto = !auto; updateControls(); scheduleAuto(); });
  $('auto-speed').addEventListener('change', () => {
    preferences.autoSpeed = Number($('auto-speed').value);
    if (!store.preferences(preferences)) notice('storageError');
    scheduleAuto();
    updateControls();
  });
  $('sound').addEventListener('click', () => {
    preferences.sound = !preferences.sound;
    if (!store.preferences(preferences)) notice('storageError');
    syncSound();
    updateControls();
  });
  $('volume').addEventListener('input', () => {
    preferences.volume = Number($('volume').value);
    soundtrack?.setVolume(preferences.volume / 100);
    if (!store.preferences(preferences)) notice('storageError');
    updateControls();
  });
  function changeLanguage() {
    stopAuto();
    const line = timeline[index]?.line;
    if (ready) {
      storyLanguage = scripts[preferences.language] ? preferences.language : storyLanguage;
      usedFallback = storyLanguage !== preferences.language;
      commands = scripts[storyLanguage];
      timeline = timeline[index]?.completionOnly ? validateProgress(commands, { read: true }).timeline : buildTimeline(commands, answers);
      index = Math.max(0, timeline.findIndex((step) => step.line === line));
    }
    localize();
    if (started) showStep();
  }
  function settings() {
    stopAuto();
    if (busy) next();
    $('settings-dialog').showModal();
  }
  function pause() {
    stopAuto();
    if (typing) finishText();
  }
  function syncReadStatus() {
    if (!ready) return;
    const saved = store.group(group).stories[story.id];
    // Manual resets must also replace a position still open in another tab.
    const reset = !saved?.line && (saved?.read ? !timeline[index]?.completionOnly
      : read || index !== 0 || Object.keys(answers).length > 0);
    read = saved?.read === true;
    if (reset) {
      stopAuto();
      review.reset();
      $('history-dialog').close();
      ({ answers, timeline, index } = validateProgress(commands, saved));
      if (started || read) { started = true; $('cover').hidden = true; showStep(); }
    }
    localize();
  }
  function compare() {
    if (!started || busy || !scripts.es || !scripts.en || timeline[index]?.kind === 'end') return;
    pause();
    comparedLanguage = (comparedLanguage || storyLanguage) === 'es' ? 'en' : 'es';
    // Text only: keep choice values/progress and do not replay scene/audio events.
    showText(true);
    $('review-toggle').focus({ preventScroll: true });
  }
  document.addEventListener('keydown', (event) => {
    if (!ready || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (event.target.closest('input:not([type="range"]), textarea, [contenteditable]:not([contenteditable="false"])')) return;
    if (event.key === ' ') {
      // Cancel native button/select activation, including repeated keydowns.
      // Focus can stay on the control that opened a now-closed dialog.
      event.preventDefault();
      if (!event.repeat) { if (started) next(); else begin(); }
      return;
    }
    if (!started || event.repeat || event.target.closest('input, select')) return;
    if (['ArrowRight', 'ArrowLeft', 'h', 'H'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') back();
      else if (event.key.toLowerCase() === 'h') openHistory();
      else next();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopAuto(); persist(); }
    syncSound();
  });
  window.addEventListener('pagehide', () => { persist(); soundtrack?.enable(false); });
  return { load, dispose, persist, changeLanguage, settings, pause, compare, syncReadStatus, refresh() { localize(); if (started) showStep(); }, get ready() { return ready; } };
}
