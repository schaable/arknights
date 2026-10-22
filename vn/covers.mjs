// Chapter, event, and IS covers use the verified ArknightsAssets2 English snapshot.
// Local generated covers fill archive gaps. The arkdata mirror supplies
// vignette covers, operator portraits and module art.
import { createImageCache } from './assets.mjs';
const mirrors = {
  local: [new URL('./assets/covers/', import.meta.url).href],
  'archive-en': [
    'https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsAssets2@6df8f6877a03e16f6a1499172a8de10f0f6f773a/assets/',
    'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/6df8f6877a03e16f6a1499172a8de10f0f6f773a/assets/',
  ],
  arkdata: [
    'https://cdn.jsdelivr.net/gh/akgcc/arkdata@main/assets/',
    'https://raw.githubusercontent.com/akgcc/arkdata/main/assets/',
  ],
};

export function coverURLs(cover) {
  if (!cover?.path || !mirrors[cover.provider]) return [];
  const path = cover.path.split('/').map(encodeURIComponent).join('/');
  return mirrors[cover.provider].map((base) => base + path);
}

const cache = createImageCache(coverURLs, 24);
const pending = new WeakMap();
let observer;
const coverKey = (cover) => JSON.stringify([cover?.provider, cover?.path, cover?.crop]);

async function reveal(frame) {
  observer?.unobserve(frame);
  const request = pending.get(frame);
  if (!request) return;
  const current = () => frame.isConnected && pending.get(frame) === request;
  const prepared = await cache.prepare(request.cover);
  if (!prepared || !current()) return;
  const img = prepared.cloneNode();
  img.width = img.height = 512;
  // Apply the optional square crop before revealing any pixels. Both axes use
  // the same scale, preserving proportions while trimming transparent margins.
  const crop = request.cover.crop;
  if (crop && [crop.x, crop.y, crop.size].every(Number.isFinite) &&
      crop.x >= 0 && crop.y >= 0 && crop.size > 0 &&
      crop.x + crop.size <= prepared.naturalWidth && crop.y + crop.size <= prepared.naturalHeight) {
    img.style.width = `${100 * prepared.naturalWidth / crop.size}%`;
    img.style.height = `${100 * prepared.naturalHeight / crop.size}%`;
    img.style.inset = `${-100 * crop.y / crop.size}% auto auto ${-100 * crop.x / crop.size}%`;
  }
  try { await img.decode(); } catch { return; }
  if (!current()) return;
  frame.replaceChildren(img);
  frame.classList.add('has-art');
  pending.delete(frame);
}

export function createCover(cover, { lazy = true, frame = document.createElement('div') } = {}) {
  if (frame.classList.contains('has-art')) return frame;
  frame.className = 'collection-art';
  frame.dataset.cover = coverKey(cover);
  // The adjacent collection title labels this decorative artwork.
  frame.setAttribute('aria-hidden', 'true');
  const urls = coverURLs(cover);
  if (!urls.length) return frame;
  pending.set(frame, { cover });
  if (!lazy || cache.ready(cover)) reveal(frame);
  else {
    observer ||= new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) reveal(entry.target);
    }, { rootMargin: '200px 0px' });
    observer.observe(frame);
  }
  return frame;
}

// Capture the old view before it is rebuilt. Each placement gets its own frame,
// including pages that show a heading and several cards with the same artwork.
export function reuseCovers(root) {
  const frames = new Map();
  for (const frame of root.querySelectorAll('.collection-art')) {
    observer?.unobserve(frame); pending.delete(frame);
    const key = frame.dataset.cover;
    if (!frames.has(key)) frames.set(key, []);
    frames.get(key).push(frame);
  }
  return (cover, options = {}) => createCover(cover, { ...options, frame: frames.get(coverKey(cover))?.shift() });
}
