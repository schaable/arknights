import { routeFor, groupStats } from './catalog.mjs';
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function link(text, href, className) {
  const node = element('a', text, className); node.href = href; return node;
}
export const storyTitle = (story, t) => [story.code, story.title, story.phase ? t(story.phase) : ''].filter(Boolean).join(' · ');
export function recentGroups(catalog, store) {
  const latest = new Map();
  for (const group of catalog.groups) {
    const saved = store.group(group);
    if (!group.stories.some((story) => story.vn && story.id === saved.resume)) continue;
    const previous = latest.get(group.category);
    if (!previous || (saved.updated || 0) > previous.updated) latest.set(group.category, { group, updated: saved.updated || 0 });
  }
  return [...latest.values()].sort((a, b) => b.updated - a.updated).map(({ group }) => group);
}
export function renderLibrary(root, route, { catalog, store, preferences, t }) {
  root.replaceChildren();
  const { category, group, story } = route;
  const heading = (title, description) => {
    const header = element('header', undefined, 'library-heading');
    header.append(element('span', 'ARKNIGHTS / ARCHIVE', 'eyebrow'), element('h2', title));
    if (description) header.append(element('p', description));
    root.append(header);
  };
  const statsText = (g) => {
    const stats = groupStats(g, store.group(g));
    return `${stats.read}/${stats.total} ${t('read').toLowerCase()} · ${stats.ready} ${t('playable').toLowerCase()}`;
  };
  const groupCard = (g, resumeOnly = false) => {
    const saved = store.group(g), stats = groupStats(g, saved);
    const card = element('article', undefined, 'collection-card');
    const title = g.chapter === undefined ? g.title : `${t('chapter')} ${String(g.chapter).padStart(2, '0')} · ${g.title}`;
    const target = routeFor(g.category, g);
    card.append(element('span', resumeOnly ? catalog.categories.find((cat) => cat.id === g.category).name[preferences.language]
      : g.chapter === undefined ? t('stories') : `${t('chapter')} ${String(g.chapter).padStart(2, '0')}`, 'eyebrow'),
      link(title, target, 'collection-title'), element('p', statsText(g), 'collection-stats'));
    const meter = element('progress'); meter.max = stats.total; meter.value = stats.read; meter.setAttribute('aria-label', t('collectionProgress')); card.append(meter);
    const badges = element('div', undefined, 'badges');
    badges.append(element('span', `${stats.spanish}/${stats.total} ES`, 'badge'));
    if (stats.ready) badges.append(element('span', `${stats.ready} VN`, 'badge available'));
    card.append(badges);
    const resume = g.stories.find((s) => s.id === saved.resume && s.vn);
    if (resume) card.append(link(`${t('continueReading')} → ${resume.title}`, routeFor(g.category, g, resume), 'resume-link'));
    else if (!resumeOnly) card.append(link(t('browse') + ' →', target, 'browse-link'));
    return card;
  };
  if (route.kind === 'home') {
    heading(t('explore'), t('intro'));
    const resumes = recentGroups(catalog, store);
    if (resumes.length) {
      root.append(element('h3', t('continueReading')));
      const row = element('div', undefined, 'collection-grid resume-grid');
      resumes.forEach((g) => row.append(groupCard(g, true)));
      root.append(row);
    }
    root.append(element('h3', t('categories')));
    const grid = element('div', undefined, 'category-grid');
    catalog.categories.forEach((cat, index) => {
      const groups = catalog.groups.filter((g) => g.category === cat.id);
      const ready = groups.reduce((sum, g) => sum + g.stories.filter((s) => s.vn).length, 0);
      const card = link('', routeFor(cat), 'category-card');
      card.append(element('span', String(index + 1).padStart(2, '0'), 'category-number'), element('h3', cat.name[preferences.language]),
        element('p', `${groups.length} ${t(cat.id === 'main' ? 'chapters' : 'collections')} · ${ready} VN`), element('span', '↗', 'card-arrow'));
      grid.append(card);
    });
    root.append(grid);
  } else if (route.kind === 'category') {
    const groups = catalog.groups.filter((g) => g.category === category.id);
    heading(category.name[preferences.language], `${groups.length} ${t(category.id === 'main' ? 'chapters' : 'collections')}`);
    const filters = element('div', undefined, 'catalog-filters');
    const search = element('input'); search.type = 'search'; search.placeholder = t('search'); search.setAttribute('aria-label', t('search'));
    const label = element('label'); const checkbox = element('input'); checkbox.type = 'checkbox'; label.append(checkbox, document.createTextNode(t('readyOnly')));
    filters.append(search, label); root.append(filters);
    const grid = element('div', undefined, 'collection-grid'); root.append(grid);
    const render = () => {
      grid.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const matches = groups.filter((g) => `${g.title} ${g.chapter ?? ''}`.toLocaleLowerCase().includes(query) && (!checkbox.checked || g.stories.some((s) => s.vn)));
      matches.forEach((g) => grid.append(groupCard(g)));
      if (!matches.length) grid.append(element('p', t('noResults')));
    };
    search.addEventListener('input', render); checkbox.addEventListener('change', render); render();
  } else if (route.kind === 'group') {
    heading(group.chapter === undefined ? group.title : `${t('chapter')} ${String(group.chapter).padStart(2, '0')} · ${group.title}`, statsText(group));
    const message = element('p', undefined, 'library-status'); message.setAttribute('role', 'status'); root.append(message);
    const saved = store.group(group);
    const resume = group.stories.find((s) => s.id === saved.resume && s.vn);
    if (resume) root.append(link(`${t('continueReading')} → ${resume.title}`, routeFor(category, group, resume), 'primary collection-resume'));
    const list = element('ol', undefined, 'story-list');
    group.stories.forEach((s, index) => {
      const progress = saved.stories[s.id];
      const item = element('li', undefined, 'story-row');
      const title = link(storyTitle(s, t), routeFor(category, group, s), 'story-title');
      const info = element('div', undefined, 'story-info');
      info.append(title);
      const badges = element('div', undefined, 'badges');
      badges.append(element('span', t(s.vn ? 'available' : 'pending'), s.vn ? 'badge available' : 'badge'));
      badges.append(element('span', t(s.spanish ? 'translated' : 'untranslated'), 'badge'));
      badges.append(element('span', t(progress?.read ? 'completed' : progress?.line ? 'inProgress' : 'unread'), progress?.read || progress?.line ? 'badge read-status' : 'badge'));
      info.append(badges);
      item.append(element('span', String(index + 1).padStart(2, '0'), 'story-number'), info);
      const actions = element('div', undefined, 'story-actions');
      const mark = element('button', t(progress?.read ? 'markUnread' : 'markRead'), 'story-mark-read');
      mark.type = 'button'; mark.dataset.story = s.id;
      mark.setAttribute('aria-label', `${mark.textContent}: ${storyTitle(s, t)}`);
      mark.addEventListener('click', () => {
        const success = store.setRead(group, s, !store.group(group).stories[s.id]?.read);
        renderLibrary(root, route, { catalog, store, preferences, t });
        root.querySelectorAll('.story-mark-read')[index].focus({ preventScroll: true });
        if (!success) root.querySelector('.library-status').textContent = t('readStatusError');
      });
      actions.append(mark);
      if (!s.vn) actions.append(link(t('classic'), '../' + s.classicHash, 'classic-link'));
      else actions.append(link('→', routeFor(category, group, s), 'story-open'));
      item.append(actions);
      list.append(item);
    });
    root.append(list);
  } else {
    heading(story ? storyTitle(story, t) : t('missingTitle'), t(story ? 'unavailableTitle' : 'missingText'));
    if (story) {
      root.append(element('p', t('unavailableText')),
        element('p', t(story.spanish ? 'translated' : 'untranslated'), 'muted'),
        link(t('classic'), '../' + story.classicHash, 'primary collection-resume'));
    }
    root.append(link(t(group ? 'backCollection' : 'home'), group ? routeFor(category, group) : '#/', 'back-link'));
  }
}
