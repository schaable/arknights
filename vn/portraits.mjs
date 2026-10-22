import { createImageCache } from './assets.mjs';

// Warm recent history while reading; load older entries near the scroll viewport.
export function createPortraits(list) {
  const cache = createImageCache('portrait', 48);
  let version = 0;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target);
      reveal(entry.target);
    }
  }, { root: list, rootMargin: '160px 0px' });

  async function reveal(frame) {
    const token = version, image = frame.querySelector('img');
    const current = () => token === version && frame.isConnected && frame.querySelector('img') === image;
    const prepared = await cache.prepare(image.dataset.asset);
    if (!prepared || !current()) return;
    image.src = prepared.src;
    try {
      await image.decode();
      if (current()) image.hidden = false;
    } catch { /* Keep the initial when an optional portrait cannot be decoded. */ }
  }

  return {
    prefetch: cache.prefetch,
    reset() { version++; observer.disconnect(); },
    attach(frame, name, initial) {
      let image = frame.querySelector('img');
      if (image?.dataset.asset !== name) {
        image = new Image(56, 56);
        image.alt = ''; image.draggable = false; image.decoding = 'async';
        image.dataset.asset = name; image.hidden = true;
        frame.replaceChildren(document.createTextNode(initial), image);
      } else frame.firstChild.textContent = initial;
      if (!image.hidden) return;
      if (cache.ready(name)) reveal(frame);
      else observer.observe(frame);
    },
    clear() {
      version++; observer.disconnect(); cache.clear();
    },
  };
}
