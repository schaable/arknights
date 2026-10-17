// Archive textures are pinned to the verified asset snapshot. The existing
// arkdata mirror supplies vignette covers, operator portraits and module art.
const mirrors = {
  local: [new URL('./assets/covers/', import.meta.url).href],
  'archive-en': [
    'https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsAssets2@6df8f6877a03e16f6a1499172a8de10f0f6f773a/assets/',
    'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets2/6df8f6877a03e16f6a1499172a8de10f0f6f773a/assets/',
  ],
  archive: [
    'https://cdn.jsdelivr.net/gh/ArknightsAssets/ArknightsAssets@c0be4e4428f79c7e87c6889067a6906361ae979b/assets/',
    'https://raw.githubusercontent.com/ArknightsAssets/ArknightsAssets/c0be4e4428f79c7e87c6889067a6906361ae979b/assets/',
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
  img.onload = () => frame.classList.add('has-art');
  img.onerror = () => {
    if (++attempt < urls.length) img.src = urls[attempt];
    else { img.remove(); frame.classList.remove('has-art'); }
  };
  img.src = urls[0];
  frame.append(img);
  return frame;
}
