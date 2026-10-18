export function routeFor(category, group, story) {
  return '#/' + [category?.id || category, group?.slug, story?.slug].filter(Boolean).map(encodeURIComponent).join('/');
}
export const isOperatorCategory = (category) => ['operator-records', 'operator-modules'].includes(category?.id || category);
export function operatorsFor(catalog, category) {
  if (!isOperatorCategory(category)) return [];
  const groupsByOperator = new Map();
  for (const group of catalog.groups) {
    if (group.category !== (category?.id || category) || !group.operatorId) continue;
    if (!groupsByOperator.has(group.operatorId)) groupsByOperator.set(group.operatorId, []);
    groupsByOperator.get(group.operatorId).push(group);
  }
  return (catalog.operators || []).filter((operator) => groupsByOperator.has(operator.id))
    .map((operator) => ({ ...operator, groups: groupsByOperator.get(operator.id) }));
}
export function topicsFor(catalog, category = 'integrated-strategies') {
  if ((category?.id || category) !== 'integrated-strategies') return [];
  const groups = catalog.groups.filter((g) => g.category === 'integrated-strategies');
  return groups.filter((g) => g.id === g.topicId).map((topic) => ({
    id: topic.id, name: topic.title, slug: topic.slug, cover: topic.cover,
    groups: groups.filter((g) => g.topicId === topic.id)
      .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })),
  })).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}
export function resolveRoute(hash, catalog) {
  if (!hash || hash === '#' || hash === '#/') return { kind: 'home' };
  let parts;
  try { parts = hash.replace(/^#\//, '').split('/').map(decodeURIComponent); } catch { return { kind: 'missing' }; }
  if (!hash.startsWith('#/') || parts.length > 3 || parts.some((p) => !p)) return { kind: 'missing' };
  const category = catalog.categories.find((c) => c.id === parts[0]);
  if (!category) return { kind: 'missing' };
  if (parts.length === 1) return { kind: 'category', category };
  const group = catalog.groups.find((g) => g.category === category.id && g.slug === parts[1]);
  if (!group) {
    const operator = parts.length === 2 && operatorsFor(catalog, category).find((o) => o.slug === parts[1]);
    return operator ? { kind: 'operator', category, operator } : { kind: 'missing', category };
  }
  const operator = catalog.operators?.find((o) => o.id === group.operatorId);
  const topic = group.topicId && topicsFor(catalog, category).find((t) => t.id === group.topicId);
  const collection = { category, group, ...(operator ? { operator } : {}), ...(topic ? { topic } : {}) };
  // The existing entry/endings URL also opens the complete topic. Story and
  // squad URLs retain their original groups and independent progress keys.
  if (parts.length === 2) return { kind: topic?.id === group.id ? 'topic' : 'group', ...collection };
  const story = group.stories.find((s) => s.slug === parts[2]);
  if (!story) return { kind: 'missing', ...collection };
  return { kind: story.vn ? 'story' : 'unavailable', ...collection, story };
}
export const groupKey = (group) => `${group.category}:${group.id}`;
export function groupStats(group, state) {
  return { total: group.stories.length, ready: group.stories.filter((s) => s.vn).length,
    spanish: group.stories.filter((s) => s.spanish).length,
    read: group.stories.filter((s) => state?.stories?.[s.id]?.read).length };
}
