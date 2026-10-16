import { resolveRoute, routeFor } from './catalog.mjs';
import { createProgressStore } from './storage.mjs';
import { createPlayer } from './reader.mjs';
import { renderLibrary, element, link, storyTitle } from './library.mjs';
import { copy } from './i18n.mjs';
const $ = (id) => document.getElementById(id);
let catalog, store, player, preferences, route;
const t = (key) => copy[preferences?.language || 'es'][key] || key;
function localize() {
  document.documentElement.lang = preferences.language;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $('language').value = preferences.language;
  $('nickname').value = preferences.nickname;
  $('speed').value = preferences.speed;
  $('motion').checked = preferences.motion;
  document.querySelectorAll('.close').forEach((el) => el.setAttribute('aria-label', t('close')));
}
function chrome() {
  const { category, group, story } = route;
  const crumbs = $('breadcrumbs'); crumbs.replaceChildren(link(t('home'), '#/'));
  if (category) crumbs.append(element('span', '/'), link(category.name[preferences.language], routeFor(category)));
  if (group) crumbs.append(element('span', '/'), link(group.chapter === undefined ? group.title : `${t('chapter')} ${String(group.chapter).padStart(2, '0')}`, routeFor(category, group)));
  if (story) { const current = element('span', story.title); current.setAttribute('aria-current', 'page'); crumbs.append(element('span', '/'), current); }
  $('page-category').textContent = category ? category.name[preferences.language].toUpperCase() : 'VISUAL NOVEL';
  $('page-title').textContent = story ? storyTitle(story, t) : group?.title || category?.name[preferences.language] || t(route.kind === 'missing' ? 'missingTitle' : 'library');
  document.title = `${$('page-title').textContent} · Arknights`;
  if (route.kind !== 'story') return;
  const index = group.stories.indexOf(story);
  const previous = group.stories[index - 1], next = group.stories[index + 1];
  for (const [id, target, text] of [['previous-story', previous, 'previousStory'], ['next-story', next, 'nextStory']]) {
    $(id).hidden = !target;
    if (target) { $(id).href = routeFor(category, group, target); $(id).textContent = t(text); }
  }
  $('ending-collection').href = routeFor(category, group);
  $('ending-next').hidden = !next;
  if (next) {
    $('ending-next').href = next.vn ? routeFor(category, group, next) : '../' + next.classicHash;
    $('ending-next').textContent = `${t(next.vn ? 'nextStory' : 'nextClassic')} · ${next.title}`;
  }
  const select = $('story-select'); select.replaceChildren();
  for (const item of group.stories) {
    const option = element('option', `${storyTitle(item, t)}${item.vn ? '' : ' — ' + t('pending')}`);
    option.value = routeFor(category, group, item); option.selected = item === story; select.append(option);
  }
  $('cover-category').textContent = category.name[preferences.language];
  $('cover-description').textContent = [story.code, story.phase ? t(story.phase) : ''].filter(Boolean).join(' · ');
}
function renderLibraryView() {
  if (route.kind !== 'story') renderLibrary($('library'), route, { catalog, store, preferences, t });
}
function navigate() {
  player.dispose();
  store.snapshot();
  route = resolveRoute(location.hash, catalog);
  const reading = route.kind === 'story';
  document.body.classList.toggle('reading', reading);
  $('player').hidden = !reading;
  $('player').dataset.story = reading ? route.story.id : '';
  $('library').hidden = reading;
  $('status').textContent = '';
  chrome();
  if (reading) { player.load(route.group, route.story); chrome(); }
  else renderLibraryView();
  window.scrollTo(0, 0);
}
async function boot() {
  try {
    const response = await fetch('./data/catalog.json');
    if (!response.ok) throw new Error(`Catalog: ${response.status}`);
    catalog = await response.json();
    if (catalog.v !== 1 || !Array.isArray(catalog.groups) || !Array.isArray(catalog.categories)) throw new Error('Invalid catalog');
    let storage;
    try { storage = localStorage; } catch { /* Memory saves remain available. */ }
    store = createProgressStore(storage, catalog);
    preferences = { motion: matchMedia('(prefers-reduced-motion: reduce)').matches, ...store.snapshot().preferences };
    player = createPlayer({ preferences, t, store, onChange: chrome });
    localize();
    window.addEventListener('hashchange', navigate);
    window.addEventListener('storage', () => { store.snapshot(); renderLibraryView(); });
    $('story-select').addEventListener('change', () => { location.hash = $('story-select').value; });
    $('language').addEventListener('change', () => {
      preferences.language = $('language').value;
      store.preferences(preferences);
      localize();
      player.changeLanguage();
      chrome(); renderLibraryView();
    });
    $('settings').addEventListener('click', () => player.settings());
    for (const id of ['nickname', 'speed', 'motion']) $(id).addEventListener('change', () => {
      preferences[id] = id === 'speed' ? Number($(id).value) : id === 'motion' ? $(id).checked : $(id).value.trim();
      if (!store.preferences(preferences)) $('status').textContent = t('storageError');
      player.refresh();
    });
    navigate();
  } catch (error) {
    console.error(error);
    const retry = element('button', t('retry'));
    retry.addEventListener('click', boot, { once: true });
    $('library').replaceChildren(element('h2', t('catalogError')), retry);
  }
}
boot();
