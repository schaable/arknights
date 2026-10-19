const $ = (id) => document.getElementById(id);
const fetchText = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);
  return response.text();
};

function svgNode(mark, size) {
  const svg = new DOMParser().parseFromString(mark, 'image/svg+xml').documentElement;
  if (svg.nodeName !== 'svg') throw new Error('Invalid logo SVG');
  svg.removeAttribute('aria-labelledby');
  svg.removeAttribute('role');
  svg.setAttribute('aria-hidden', 'true');
  svg.querySelector('title')?.remove();
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  return document.importNode(svg, true);
}

function span(className, text) {
  const node = document.createElement('span');
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

try {
  const options = JSON.parse(await fetchText('./options.json'));
  const marks = await Promise.all(options.map((option) => fetchText('./' + option.file)));
  const cards = [];
  const select = (index) => {
    cards.forEach(({ card, button }, i) => {
      card.classList.toggle('selected', i === index);
      button.setAttribute('aria-pressed', String(i === index));
    });
    $('selected-logo').replaceChildren(svgNode(marks[index]));
    $('selection').textContent = `Previewing ${options[index].id} · ${options[index].name}`;
  };
  options.forEach((option, index) => {
    const card = document.createElement('article'); card.className = 'option';
    const button = document.createElement('button'); button.className = 'pick'; button.type = 'button';
    button.setAttribute('aria-label', `Preview ${option.id}: ${option.name}`);
    const meta = span('option-meta');
    const designation = option.status === 'active' ? ' · In use' : option.status === 'saved' ? ' · Saved' : '';
    meta.append(span('number', option.id), span('family', option.family + designation));
    const mark = span('mark'); mark.append(svgNode(marks[index]));
    button.append(meta, mark, span('name', option.name), span('description', option.description));
    button.addEventListener('click', () => select(index));
    const footer = document.createElement('div'); footer.className = 'option-footer';
    const sizes = span('sizes'); sizes.setAttribute('aria-label', 'Small-size previews');
    [24, 32, 40].forEach((size) => sizes.append(svgNode(marks[index], size)));
    const download = document.createElement('a'); download.className = 'download'; download.href = './' + option.file;
    download.download = option.file; download.textContent = 'SVG ↓';
    download.setAttribute('aria-label', `Download ${option.id}: ${option.name}`);
    footer.append(sizes, download); card.append(button, footer); $('options').append(card);
    cards.push({ card, button });
  });
  select(Math.max(0, options.findIndex(option => option.status === 'active')));
  $('light').addEventListener('click', () => {
    const active = $('light').getAttribute('aria-pressed') !== 'true';
    $('light').setAttribute('aria-pressed', String(active));
    document.documentElement.dataset.theme = active ? 'light' : 'dark';
  });
  $('mono').addEventListener('click', () => {
    const active = $('mono').getAttribute('aria-pressed') !== 'true';
    $('mono').setAttribute('aria-pressed', String(active));
    document.documentElement.dataset.mono = String(active);
  });
} catch (error) {
  $('error').hidden = false;
  $('error').textContent = error.message + '. Open this preview through the local HTTP server.';
}
