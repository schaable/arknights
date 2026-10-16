import { parseScript, buildTimeline, validateProgress, applyEvent, initialScene } from './script.mjs';
import { loadImage, imageURLs, Soundtrack } from './assets.mjs';
import { playable } from './chapters.mjs';

export function createPlayer({ preferences, t, store, onChange }) {
  const $ = (id) => document.getElementById(id);
  let story, group, loadController, loadVersion = 0;
  let scripts, commands, timeline = [], answers = {}, index = 0, started = false, ready = false;
  let soundtrack, state = initialScene(), busy = false, typing = false, auto = false;
  let run = 0, typeTimer, autoTimer, waitController = new AbortController();
  let fullText = '', statusKey = '', read = false;
  const animations = new Set();

  function notice(key) { statusKey = key; $('status').textContent = t(key); }
  function localize() {
    document.documentElement.lang = preferences.language;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('.close').forEach((el) => el.setAttribute('aria-label', t('close')));
    $('language').value = preferences.language;
    $('nickname').value = preferences.nickname;
    $('speed').value = preferences.speed;
    $('motion').checked = preferences.motion;
    $('progress').setAttribute('aria-label', t('progress'));
    $('choices').setAttribute('aria-label', t('choose'));
    $('dialogue').setAttribute('aria-label', t('continue'));
    if (ready) $('begin').textContent = t(index || read ? 'resume' : 'begin');
    if (statusKey) notice(statusKey);
    updateControls();
  }

  function persist() {
    if (!ready || !started || !story) return;
    if (!store.save(group, story, {
      line: timeline[index]?.line, answers, read, updated: Date.now(),
    })) notice('storageError');
  }

  function updateControls() {
    const step = timeline[index];
    $('back').disabled = !started || index === 0;
    $('history').disabled = !started;
    $('auto').disabled = !started || step?.kind === 'end';
    $('next').disabled = !started || (step?.kind !== 'dialogue' && !busy);
    $('restart').disabled = !ready;
    $('sound').disabled = !started || !soundtrack;
    $('auto').setAttribute('aria-pressed', auto);
    $('sound').setAttribute('aria-pressed', soundtrack?.enabled || false);
    $('sound').textContent = t(soundtrack?.enabled ? 'soundOn' : 'soundOff');
    const percent = step?.kind === 'end' ? 100 : Math.floor(((step?.line || 0) / (commands?.at(-1)?.line || 1)) * 100);
    $('progress').value = percent;
    $('position').textContent = String(percent).padStart(2, '0') + '%';
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

  function restoreScene(snapshot) {
    animations.forEach((a) => a.cancel());
    animations.clear();
    state = structuredClone(snapshot);
    drawArt('background', state.background);
    drawArt('image', state.image);
    drawCharacters();
    $('blocker').style.backgroundColor = state.blocker.color;
    $('blocker').style.opacity = state.blocker.alpha;
    $('camera').style.filter = `grayscale(${state.grayscale})`;
    soundtrack?.restore(state.music);
  }

  async function event(item) {
    const { command, args: a } = item;
    const previous = structuredClone(state);
    applyEvent(state, item);
    const duration = Number(a.fadetime ?? a.duration ?? 0);
    switch (command) {
      case 'background':
      case 'image':
        drawArt(command, state[command], duration);
        if (command === 'background') drawCharacters();
        break;
      case 'character': drawCharacters(); break;
      case 'imagetween': {
        const img = $('image').lastElementChild;
        if (img && previous.image) {
          const from = { ...previous.image, x: Number(a.xfrom ?? previous.image.x),
            y: Number(a.yfrom ?? previous.image.y), scale: Number(a.xscalefrom ?? previous.image.scale) };
          img.style.transform = transform(state.image);
          animate(img, [{ transform: transform(from) }, { transform: transform(state.image) }], duration, 'transform');
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
      case 'delay': await wait(a.time); return;
      case 'dialog': await wait(a.time); return;
    }
    if (a.block === 'true') await wait(duration);
  }

  const displayText = (text) => text.replaceAll('{@nickname}', preferences.nickname.trim() || 'Doctor');
  function stopAuto() { auto = false; clearTimeout(autoTimer); updateControls(); }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    if (auto && !typing && !busy && timeline[index]?.kind === 'dialogue' && !document.hidden) {
      autoTimer = setTimeout(next, 1600 + Array.from(fullText).length * 45);
    }
  }
  function finishText() {
    clearInterval(typeTimer);
    typing = false;
    $('text').textContent = fullText;
    $('tap-hint').textContent = t('continue');
    scheduleAuto();
  }
  function showText(instant = false) {
    const step = timeline[index];
    $('stage').dataset.story = story.id;
    $('stage').dataset.line = step.line;
    $('stage').dataset.kind = step.kind;
    $('dialogue').hidden = step.kind === 'end';
    $('ending').hidden = step.kind !== 'end';
    $('choices').replaceChildren();
    $('choices').hidden = step.kind !== 'choice';
    clearInterval(typeTimer);
    typing = false;
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
    $('speaker').textContent = displayText(step.kind === 'choice' ? 'Doctor' : step.speaker);
    fullText = step.kind === 'choice' ? t('choose') : displayText(step.text);
    $('text').textContent = '';
    $('tap-hint').textContent = t(step.kind === 'choice' ? 'choose' : 'reveal');
    if (step.kind === 'choice') {
      stopAuto();
      for (const option of step.options) {
        const button = document.createElement('button');
        button.textContent = displayText(option.text);
        button.addEventListener('click', () => choose(option.value));
        $('choices').append(button);
      }
      $('text').textContent = fullText;
      $('choices').firstElementChild.focus({ preventScroll: true });
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
    const token = run;
    const step = timeline[index];
    $('choices').hidden = true;
    $('ending').hidden = true;
    $('dialogue').hidden = true;
    busy = animateScene;
    updateControls();
    persist();
    if (animateScene) {
      busy = true;
      if (!statusKey || statusKey === 'transition') notice('transition');
      $('stage').setAttribute('aria-busy', 'true');
      for (const item of step.events) {
        if (token !== run) return;
        await event(item);
      }
      if (token !== run) return;
      busy = false;
    } else restoreScene(step.state);
    if (statusKey === 'transition') { statusKey = ''; $('status').textContent = ''; }
    $('stage').setAttribute('aria-busy', 'false');
    showText(!animateScene);
  }
  function next() {
    if (!started) return;
    if (busy) {
      cancelPending();
      restoreScene(timeline[index].state);
      if (statusKey === 'transition') { statusKey = ''; $('status').textContent = ''; }
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
    if (!started) return;
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
    persist();
    loadVersion++;
    loadController?.abort();
    cancelPending();
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    soundtrack?.enable(false);
    soundtrack = null;
    document.querySelectorAll('.scene img').forEach((img) => { img.onerror = null; });
    for (const id of ['background', 'image', 'characters', 'choices', 'history-list']) $(id).replaceChildren();
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    ready = started = auto = typing = false;
    story = group = null;
    timeline = []; answers = {}; index = 0; read = false;
    state = initialScene();
    $('blocker').style.opacity = 0;
    $('blocker').style.backgroundColor = 'black';
    $('camera').style.filter = 'none';
    statusKey = ''; $('status').textContent = '';
    $('stage').removeAttribute('data-line');
    $('stage').removeAttribute('data-kind');
    $('stage').removeAttribute('data-story');
    $('stage').setAttribute('aria-busy', 'false');
    $('dialogue').hidden = $('ending').hidden = $('choices').hidden = true;
    $('cover').hidden = false;
    $('text').textContent = '';
    updateControls();
  }
  async function load(nextGroup = group, nextStory = story) {
    dispose();
    group = nextGroup; story = nextStory;
    const token = ++loadVersion;
    loadController = new AbortController();
    const signal = loadController.signal;
    const config = playable[story.id];
    $('cover-title').textContent = $('ending-title').textContent = story.title;
    $('cover-subtitle').textContent = group.title;
    $('cover-number').textContent = group.chapter === undefined ? '◇' : String(group.chapter).padStart(2, '0');
    $('cover-category').textContent = t('story');
    $('cover-description').textContent = [story.code, story.phase ? t(story.phase) : ''].filter(Boolean).join(' · ');
    const url = imageURLs(...config.cover)[0];
    $('cover-art').style.backgroundImage = `linear-gradient(90deg, #09131bf5, #09131bb3 55%, #09131b4d), url("${url}")`;
    $('begin').disabled = true;
    $('begin').textContent = t('loading');
    try {
      const get = async (url, json = false) => {
        const response = await fetch(url, { signal });
        if (!response.ok) throw new Error(`${response.status}: ${url}`);
        return json ? response.json() : response.text();
      };
      const [es, en, audio] = await Promise.all([
        get(`../gamedata/es_ES/story/${story.id}.txt`), get(`./chapters/${config.english}`), get('./data/audio.json', true),
      ]);
      if (token !== loadVersion) return;
      scripts = { es: parseScript(es), en: parseScript(en) };
      const signature = (script) => JSON.stringify(script.map((item) => ({
        ...item, text: '', args: Object.fromEntries(Object.entries(item.args).filter(([key]) =>
          !(key === 'options' || (item.command === 'line' && key === 'name')))),
      })));
      if (signature(scripts.es) !== signature(scripts.en)) throw new Error('English/Spanish script structure differs');
      commands = scripts[preferences.language];
      const saved = store.group(group).stories[story.id];
      ({ answers, timeline, index } = validateProgress(commands, saved));
      read = saved?.read === true;
      soundtrack = new Soundtrack(audio, () => { if (token === loadVersion) notice('audioError'); });
      ready = true;
      $('begin').disabled = false;
      localize();
    } catch (error) {
      if (token !== loadVersion || signal.aborted) return;
      console.error(error);
      notice('loadError');
      $('begin').textContent = t('retry');
      $('begin').disabled = false;
    }
  }

  $('begin').addEventListener('click', () => {
    if (!ready) { load(); return; }
    started = true;
    $('cover').hidden = true;
    showStep(index === 0);
    $('next').focus({ preventScroll: true });
  });
  $('dialogue').addEventListener('click', next);
  $('stage').addEventListener('click', (event) => { if (event.target === $('stage')) next(); });
  $('next').addEventListener('click', next);
  $('back').addEventListener('click', back);
  $('history').addEventListener('click', openHistory);
  $('restart').addEventListener('click', restart);
  $('replay').addEventListener('click', restart);
  $('auto').addEventListener('click', () => { auto = !auto; updateControls(); scheduleAuto(); });
  $('sound').addEventListener('click', () => { soundtrack.enable(!soundtrack.enabled); updateControls(); });
  function changeLanguage() {
    stopAuto();
    const line = timeline[index]?.line;
    if (ready) {
      commands = scripts[preferences.language];
      timeline = buildTimeline(commands, answers);
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
  document.addEventListener('keydown', (event) => {
    if (!started || event.altKey || event.ctrlKey || event.metaKey || event.repeat || document.querySelector('dialog[open]')) return;
    if (event.target.closest('input, select, textarea') || (event.target.closest('button, a') && [' ', 'Enter'].includes(event.key))) return;
    if ([' ', 'ArrowRight', 'ArrowLeft', 'h', 'H'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'ArrowLeft') back();
      else if (event.key.toLowerCase() === 'h') openHistory();
      else next();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopAuto(); soundtrack?.enable(false); persist(); updateControls(); }
  });
  window.addEventListener('pagehide', () => { persist(); soundtrack?.enable(false); });
  return { load, dispose, persist, changeLanguage, settings, refresh() { localize(); if (started) showStep(); }, get ready() { return ready; } };
}
