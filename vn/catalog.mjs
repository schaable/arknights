export function routeFor(category, group, story) {
  return '#/' + [category?.id || category, group?.slug, story?.slug].filter(Boolean).map(encodeURIComponent).join('/');
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
  if (!group) return { kind: 'missing', category };
  if (parts.length === 2) return { kind: 'group', category, group };
  const story = group.stories.find((s) => s.slug === parts[2]);
  if (!story) return { kind: 'missing', category, group };
  return { kind: story.vn ? 'story' : 'unavailable', category, group, story };
}
export const groupKey = (group) => `${group.category}:${group.id}`;
export function groupStats(group, state) {
  return { total: group.stories.length, ready: group.stories.filter((s) => s.vn).length,
    spanish: group.stories.filter((s) => s.spanish).length,
    read: group.stories.filter((s) => state?.stories?.[s.id]?.read).length };
}
