import { routeFor, groupStats, isOperatorCategory, operatorsFor, topicsFor } from './catalog.mjs';
import { reuseCovers } from './covers.mjs';
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
export function resumeStory(group, saved) {
  const stories = saved.stories || {};
  let index = group.stories.findIndex((story) => story.id === saved.resume);
  // Older manual read marks did not record a continuation point.
  if (index < 0) index = group.stories.findLastIndex((story) => stories[story.id]?.read);
  if (index < 0) return;
  const current = group.stories[index], progress = stories[current.id];
  if (progress?.read) return group.stories.slice(index + 1).find((story) => !stories[story.id]?.read);
  if (progress?.line && current.vn) return current;
}
export function recentGroups(catalog, store) {
  const latest = new Map();
  for (const group of catalog.groups) {
    const saved = store.group(group);
    if (!Object.keys(saved.stories || {}).length) continue;
    const previous = latest.get(group.category);
    if (!previous || (saved.updated || 0) > previous.updated) latest.set(group.category, { group, updated: saved.updated || 0 });
  }
  return [...latest.values()].sort((a, b) => b.updated - a.updated).map(({ group }) => group)
    .filter((group) => resumeStory(group, store.group(group)));
}
export function renderLibrary(root, route, { catalog, store, preferences, t }) {
  let createCover = reuseCovers(root);
  root.replaceChildren();
  const { category, group, story, operator, topic } = route;
  const heading = (title, description, collection) => {
    const header = element('header', undefined, 'library-heading');
    const text = element('div');
    text.append(element('span', 'ARKNIGHTS / ARCHIVE', 'eyebrow'), element('h2', title));
    if (description) text.append(element('p', description));
    if (collection) {
      header.classList.add('illustrated-heading');
      header.append(createCover(collection.cover, { lazy: false }));
    }
    header.append(text);
    root.append(header);
  };
  const statsText = (stats) => `${stats.read}/${stats.total} ${t('read').toLowerCase()} · ${stats.ready} ${t('playable').toLowerCase()}`;
  const combinedStats = (entry) => entry.groups.reduce((total, g) => {
    const stats = groupStats(g, store.group(g));
    for (const key of Object.keys(total)) total[key] += stats[key];
    return total;
  }, { total: 0, read: 0, ready: 0, spanish: 0 });
  const collectionCard = (title, cover, target, eyebrow, stats) => {
    const card = element('article', undefined, 'collection-card');
    const artwork = link('', target, 'collection-cover-link');
    artwork.setAttribute('aria-label', title);
    artwork.append(createCover(cover));
    card.append(artwork);
    card.append(element('span', eyebrow, 'eyebrow'),
      link(title, target, 'collection-title'), element('p', statsText(stats), 'collection-stats'));
    const meter = element('progress'); meter.max = stats.total; meter.value = stats.read; meter.setAttribute('aria-label', t('collectionProgress')); card.append(meter);
    const badges = element('div', undefined, 'badges');
    badges.append(element('span', `${stats.spanish}/${stats.total} ES`, 'badge'));
    if (stats.ready) badges.append(element('span', `${stats.ready} VN`, 'badge available'));
    card.append(badges);
    return card;
  };
  const groupCard = (g, resumeOnly = false) => {
    const saved = store.group(g), stats = groupStats(g, saved);
    const target = routeFor(g.category, g);
    const title = g.chapter === undefined ? g.title : `${t('chapter')} ${String(g.chapter).padStart(2, '0')} · ${g.title}`;
    const eyebrow = resumeOnly ? catalog.categories.find((cat) => cat.id === g.category).name[preferences.language]
      : g.chapter === undefined ? t('stories') : `${t('chapter')} ${String(g.chapter).padStart(2, '0')}`;
    const card = collectionCard(title, g.cover, target, eyebrow, stats);
    const resume = resumeStory(g, saved);
    if (resume) card.append(link(`${t('continueReading')} → ${resume.title}`, routeFor(g.category, g, resume), 'resume-link'));
    else if (!resumeOnly) card.append(link(t('browse') + ' →', target, 'browse-link'));
    return card;
  };
  const parentCard = (entry) => {
    const stats = combinedStats(entry), target = routeFor(category, entry);
    const byTopic = category.id === 'integrated-strategies';
    const kind = byTopic ? 'collections' : category.id === 'operator-modules' ? 'modules' : 'records';
    const card = collectionCard(entry.name, entry.cover, target, `${byTopic ? entry.groups.length : stats.total} ${t(kind)}`, stats);
    card.append(link(t('browse') + ' →', target, 'browse-link'));
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
      const count = isOperatorCategory(cat) ? operatorsFor(catalog, cat).length
        : cat.id === 'integrated-strategies' ? topicsFor(catalog).length : groups.length;
      const unit = isOperatorCategory(cat) ? 'operators' : cat.id === 'integrated-strategies' ? 'topics' : cat.id === 'main' ? 'chapters' : 'collections';
      const card = link('', routeFor(cat), 'category-card');
      card.append(element('span', String(index + 1).padStart(2, '0'), 'category-number'), element('h3', cat.name[preferences.language]),
        element('p', `${count} ${t(unit)} · ${ready} VN`), element('span', '↗', 'card-arrow'));
      grid.append(card);
    });
    root.append(grid);
  } else if (route.kind === 'category') {
    const groups = catalog.groups.filter((g) => g.category === category.id);
    const byOperator = isOperatorCategory(category);
    const byTopic = category.id === 'integrated-strategies';
    const grouped = byOperator || byTopic;
    const entries = byOperator ? operatorsFor(catalog, category) : byTopic ? topicsFor(catalog) : groups;
    heading(category.name[preferences.language], `${entries.length} ${t(byOperator ? 'operators' : byTopic ? 'topics' : category.id === 'main' ? 'chapters' : 'collections')}`);
    const filters = element('div', undefined, 'catalog-filters');
    const search = element('input'); search.type = 'search'; search.placeholder = t('search'); search.setAttribute('aria-label', t('search'));
    const label = element('label'); const checkbox = element('input'); checkbox.type = 'checkbox'; label.append(checkbox, document.createTextNode(t('readyOnly')));
    filters.append(search, label); root.append(filters);
    const grid = element('div', undefined, 'collection-grid'); root.append(grid);
    const render = () => {
      if (grid.children.length) createCover = reuseCovers(grid);
      grid.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const matches = entries.filter((entry) => {
        const collections = grouped ? entry.groups : [entry];
        const name = grouped ? `${entry.name} ${collections.map((g) => `${g.title} ${g.stories.map((s) => s.title).join(' ')}`).join(' ')}` : `${entry.title} ${entry.chapter ?? ''}`;
        return name.toLocaleLowerCase().includes(query) && (!checkbox.checked || collections.some((g) => g.stories.some((s) => s.vn)));
      });
      matches.forEach((entry) => grid.append(grouped ? parentCard(entry) : groupCard(entry)));
      if (!matches.length) grid.append(element('p', t('noResults')));
    };
    search.addEventListener('input', render); checkbox.addEventListener('change', render); render();
  } else if (['group', 'operator', 'topic'].includes(route.kind)) {
    const parent = route.kind === 'operator' ? operator : route.kind === 'topic' ? topic : null;
    const groups = parent ? [...parent.groups] : [group];
    if (route.kind === 'operator' && category.id === 'operator-records') groups.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    const stats = parent ? combinedStats(parent) : groupStats(group, store.group(group));
    const title = parent ? parent.name
      : group.chapter === undefined ? group.title : `${t('chapter')} ${String(group.chapter).padStart(2, '0')} · ${group.title}`;
    heading(title, statsText(stats), parent || group);
    const message = element('p', undefined, 'library-status'); message.setAttribute('role', 'status'); root.append(message);
    const recent = recentGroups({ groups }, store)[0];
    const resume = recent && resumeStory(recent, store.group(recent));
    if (resume) root.append(link(`${t('continueReading')} → ${resume.title}`, routeFor(category, recent, resume), 'primary collection-resume'));
    let list, previousGroup;
    groups.flatMap((g) => g.stories.map((s) => ({ g, s }))).forEach(({ g, s }, index) => {
      if (!list || (route.kind === 'topic' && previousGroup !== g)) {
        if (route.kind === 'topic') {
          const section = element('h3', undefined, 'story-section-heading');
          section.dataset.group = g.id;
          if (g.id === topic.id) section.textContent = t('entryEndings');
          else section.append(link(g.title.replace(topic.name + ' · ', ''), routeFor(category, g)));
          root.append(section);
        }
        list = element('ol', undefined, 'story-list');
        list.start = index + 1;
        root.append(list); previousGroup = g;
      }
      const progress = store.group(g).stories[s.id];
      const item = element('li', undefined, 'story-row');
      const title = link(storyTitle(s, t), routeFor(category, g, s), 'story-title');
      const info = element('div', undefined, 'story-info');
      info.append(title);
      const badges = element('div', undefined, 'badges');
      badges.append(element('span', t(s.vn ? 'available' : 'pending'), s.vn ? 'badge available' : 'badge'));
      badges.append(element('span', t(s.spanish ? 'translated' : 'untranslated'), 'badge'));
      badges.append(element('span', t(progress?.read ? 'completed' : progress?.line ? 'inProgress' : 'unread'), progress?.read || progress?.line ? 'badge read-status' : 'badge'));
      info.append(badges);
      item.append(element('span', String(index + 1).padStart(2, '0'), 'story-number'));
      if (route.kind === 'operator' && category.id === 'operator-modules') {
        const artwork = link('', routeFor(category, g, s), 'story-cover');
        artwork.setAttribute('aria-label', storyTitle(s, t));
        artwork.append(createCover(g.cover)); item.append(artwork);
      }
      item.append(info);
      const actions = element('div', undefined, 'story-actions');
      const mark = element('button', t(progress?.read ? 'markUnread' : 'markRead'), 'story-mark-read');
      mark.type = 'button'; mark.dataset.story = s.id; mark.dataset.group = g.id;
      mark.setAttribute('aria-label', `${mark.textContent}: ${storyTitle(s, t)}`);
      mark.addEventListener('click', () => {
        const success = store.setRead(g, s, !store.group(g).stories[s.id]?.read);
        renderLibrary(root, route, { catalog, store, preferences, t });
        root.querySelectorAll('.story-mark-read')[index].focus({ preventScroll: true });
        if (!success) root.querySelector('.library-status').textContent = t('readStatusError');
      });
      actions.append(mark);
      if (!s.vn) actions.append(link(t('classic'), '../' + s.classicHash, 'classic-link'));
      else actions.append(link('→', routeFor(category, g, s), 'story-open'));
      item.append(actions);
      list.append(item);
    });
  } else {
    heading(story ? storyTitle(story, t) : t('missingTitle'), t(story ? 'unavailableTitle' : 'missingText'), group);
    if (story) {
      root.append(element('p', t('unavailableText')),
        element('p', t(story.spanish ? 'translated' : 'untranslated'), 'muted'),
        link(t('classic'), '../' + story.classicHash, 'primary collection-resume'));
    }
    root.append(link(t(operator ? 'backOperator' : topic ? 'backTopic' : group ? 'backCollection' : 'home'), group ? routeFor(category, operator || topic || group) : '#/', 'back-link'));
  }
}
