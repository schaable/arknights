import { characterId, createImageCache } from './assets.mjs';

const key = (name) => characterId(name).toLowerCase();
const operator = (name) => key(name).split('#')[0];

// Keep a small per-story window of decoded sprites, including upcoming faces.
// Visible nodes are independent of the cache and survive focus-only changes.
export function createCharacters(layer, onError) {
  const cache = createImageCache('character');
  let version = 0;

  function position(image, i, count, focus) {
    image.dataset.slot = count === 1 ? 'center' : ['left', 'right', 'center'][i];
    image.classList.toggle('dim', focus !== i + 1 && focus !== 0);
  }

  async function draw(names, focus) {
    const token = ++version;
    const available = [...layer.children];
    // Remove departing operators immediately, but retain the previous face of
    // an operator still on stage until its replacement is decoded.
    for (const image of available) {
      const i = names.findIndex((name) => operator(name) === operator(image.dataset.asset));
      if (i < 0) image.remove();
      else position(image, i, names.length, focus);
    }
    const images = await Promise.all(names.map(async (name) => {
      const i = available.findIndex((image) => key(image.dataset.asset) === key(name));
      if (i >= 0) return available.splice(i, 1)[0];
      const prepared = await cache.prepare(name);
      if (!prepared || token !== version) return null;
      // Each slot needs its own node, even if a script repeats the same sprite.
      const image = prepared.cloneNode();
      image.dataset.asset = name;
      try { await image.decode(); return image; }
      catch { return null; }
    }));
    if (token !== version) return;
    if (images.some((image) => !image)) onError();
    images.forEach((image, i) => { if (image) position(image, i, names.length, focus); });
    const visible = images.filter(Boolean);
    // Do not detach/reinsert sprites which are already in the right order.
    for (const image of [...layer.children]) if (!visible.includes(image)) image.remove();
    visible.forEach((image, i) => {
      if (layer.children[i] !== image) layer.insertBefore(image, layer.children[i] || null);
    });
  }

  return {
    draw,
    prefetch: cache.prefetch,
    clear() {
      version++;
      cache.clear();
      layer.replaceChildren();
    },
  };
}
