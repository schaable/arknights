// Chapter, event, and IS covers use the verified ArknightsAssets2 English snapshot.
// Local generated covers fill archive gaps. The arkdata mirror supplies
// vignette covers, operator portraits and module art.
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

export function createCover(cover, { lazy = true } = {}) {
  const frame = document.createElement('div');
  frame.className = 'collection-art';
  // The adjacent collection title labels this decorative artwork.
  frame.setAttribute('aria-hidden', 'true');
  const urls = coverURLs(cover);
  if (!urls.length) return frame;
  const img = document.createElement('img');
  img.alt = ''; img.decoding = 'async'; img.loading = lazy ? 'lazy' : 'eager';
  img.width = img.height = 512;
  let attempt = 0;
  img.onload = () => {
    // Optional square window in source pixels. Both axes use the same scale,
    // keeping the art's proportions while trimming excess transparent margins.
    const crop = cover.crop;
    if (crop && [crop.x, crop.y, crop.size].every(Number.isFinite) &&
        crop.x >= 0 && crop.y >= 0 && crop.size > 0 &&
        crop.x + crop.size <= img.naturalWidth && crop.y + crop.size <= img.naturalHeight) {
      img.style.width = `${100 * img.naturalWidth / crop.size}%`;
      img.style.height = `${100 * img.naturalHeight / crop.size}%`;
      img.style.inset = `${-100 * crop.y / crop.size}% auto auto ${-100 * crop.x / crop.size}%`;
    }
    frame.classList.add('has-art');
  };
  img.onerror = () => {
    if (++attempt < urls.length) img.src = urls[attempt];
    else { img.remove(); frame.classList.remove('has-art'); }
  };
  img.src = urls[0];
  frame.append(img);
  return frame;
}
