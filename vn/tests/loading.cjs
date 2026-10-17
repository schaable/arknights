// Generated-source playback and loading failure integration.
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = process.env.VN_PLAYWRIGHT_MODULE
  ? require(process.env.VN_PLAYWRIGHT_MODULE)
  : createRequire(path.join(process.cwd(), 'package.json'))('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.VN_SCREENSHOTS || '/tmp/arknights-vn';
const server = http.createServer(async (request, response) => {
  let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/arknights(?=\/)/, '');
  if (name.endsWith('/')) name += 'index.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' })[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
(async () => {
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'vn/data/catalog.json')));
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const { routeFor } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const { imageURLs } = await import(pathToFileURL(path.join(root, 'vn/assets.mjs')));
  const scenes = [];
  const artwork = new Map();
  for (const group of catalog.groups) for (const story of group.stories.filter((s) => s.vn)) {
    const source = await fs.readFile(path.resolve(root, 'vn', story.source.languages.es), 'utf8');
    const commands = parseScript(source);
    const answers = Object.fromEntries(commands.filter((c) => c.command === 'decision').map((c) => [c.line, c.args.values.split(';')[0]]));
    const steps = buildTimeline(commands, answers);
    // Include transient artwork between clicks and artwork in alternate branches.
    for (const { command, args } of commands) {
      const assets = ['background', 'image'].includes(command) ? [[command, args.image]]
        : command === 'showitem' ? [['item', args.image]]
        : command === 'charactercutin' ? [['character', args.name]]
        : command === 'character' ? [args.name, args.name2, args.name3].map((name) => ['character', name?.trim()]) : [];
      for (const [kind, name] of assets) {
        if (name) artwork.set(kind + ':' + name, { kind, name, urls: imageURLs(kind, name) });
      }
    }
    scenes.push({ group, story, route: routeFor(group.category, group, story), steps });
  }
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, ignoreHTTPSErrors: true });
    await context.addInitScript(() => {
      if (!localStorage.getItem('arknights.vn.v2')) localStorage.setItem('arknights.vn.v2', JSON.stringify({ v: 2, groups: {}, preferences: { language: 'es', speed: 0, motion: true, nickname: 'Test' } }));
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    if (!process.env.VN_FAILURES_ONLY) {
    let lines = 0;
    for (const [index, scene] of scenes.entries()) {
      await page.evaluate((hash) => { location.hash = hash; }, scene.route);
      await page.waitForFunction((id) => document.querySelector('#player').dataset.story === id && !document.querySelector('#begin').disabled, scene.story.id);
      assert.equal(await page.locator('#load-notice').isVisible(), false, scene.story.id);
      await page.locator('#begin').click();
      await page.evaluate(async ({ id, steps }) => {
        const stage = document.querySelector('#stage');
        const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
        const display = (value) => value.replace(/\{@nickname\}/gi, 'Test');
        for (const [index, step] of steps.entries()) {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline && (Number(stage.dataset.line) !== step.line || stage.dataset.kind !== step.kind || stage.getAttribute('aria-busy') === 'true')) await pause();
          if (Number(stage.dataset.line) !== step.line || stage.dataset.kind !== step.kind) throw new Error(`${id}:${step.line} — wrong step ${stage.dataset.line}/${stage.dataset.kind}`);
          if (step.kind === 'dialogue' && document.querySelector('#text').textContent !== display(step.text)) throw new Error(`${id}:${step.line} — text differs`);
          const cutins = [...document.querySelectorAll('#cutins .cutin')].map((el) => ({ id: el.dataset.widget, name: el.querySelector('img').dataset.asset }));
          if (JSON.stringify(cutins) !== JSON.stringify(step.cutins)) throw new Error(`${id}:${step.line} — cut-ins differ`);
          if ((document.querySelector('#item img')?.dataset.asset || null) !== step.item) throw new Error(`${id}:${step.line} — item differs`);
          if (step.kind === 'choice') {
            const choices = [...document.querySelectorAll('#choices button')];
            if (JSON.stringify(choices.map((c) => c.textContent)) !== JSON.stringify(step.options.map((o) => display(o.text)))) throw new Error(`${id}:${step.line} — choices differ`);
          }
          if (index === Math.floor(steps.length / 2)) {
            const select = document.querySelector('#language');
            select.value = 'en'; select.dispatchEvent(new Event('change'));
            if (stage.dataset.line !== String(step.line)) throw new Error('Language switch lost position');
            select.value = 'es'; select.dispatchEvent(new Event('change'));
          }
          if (step.kind === 'choice') document.querySelector('#choices button').click();
          else if (step.kind !== 'end') document.querySelector('#next').click();
          await pause();
        }
      }, { id: scene.story.id, steps: scene.steps.map(({ kind, line, text, options, state }) => ({ kind, line, text, options,
        cutins: state.cutins.map(({ id, name }) => ({ id, name })), item: state.item?.name || null })) });
      assert.equal(await page.locator('#ending').isVisible(), true);
      const state = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem('arknights.vn.v2')).groups[key].stories[id], { key: `${scene.group.category}:${scene.group.id}`, id: scene.story.id });
      assert.equal(state.read, true); assert.equal(state.line, scene.steps.at(-1).line);
      lines += scene.steps.filter((s) => s.kind === 'dialogue').length;
      if ((index + 1) % 10 === 0) console.log(`Full playback: ${index + 1}/${scenes.length} stories.`);
    }
    console.log(`Completed ${scenes.length} stories / ${lines} dialogue lines, with choices, language switching and completion saves.`);
    // Decode each distinct image using the same primary/fallback URLs as the player.
    const broken = await page.evaluate(async (assets) => {
      const failures = [];
      let next = 0;
      async function decode(url) {
        return new Promise((resolve) => {
          const img = new Image();
          const timer = setTimeout(() => { img.src = ''; resolve(false); }, 15000);
          img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
          img.onerror = () => { clearTimeout(timer); resolve(false); };
          img.src = url;
        });
      }
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < assets.length) {
          const asset = assets[next++];
          let okay = false;
          for (const url of asset.urls) if (await decode(url)) { okay = true; break; }
          if (!okay) failures.push(asset.kind + ':' + asset.name);
        }
      }));
      return failures;
    }, [...artwork.values()]);
    assert.deepEqual(broken, [], 'Unavailable story artwork');
    console.log(`Decoded ${artwork.size} unique story images.`);
    // Visual samples from each migrated collection, including long vignette text.
    const sampled = new Set();
    for (const scene of scenes) {
      if (sampled.has(scene.group.id)) continue;
      sampled.add(scene.group.id);
      const sample = scene.steps.find((s) => s.kind === 'dialogue' && s.state.characters.length >= 2) || scene.steps.find((s) => s.kind === 'dialogue');
      await page.evaluate(({ key, id, line }) => {
        const state = JSON.parse(localStorage.getItem('arknights.vn.v2'));
        state.groups[key].stories[id].line = line;
        localStorage.setItem('arknights.vn.v2', JSON.stringify(state));
      }, { key: `${scene.group.category}:${scene.group.id}`, id: scene.story.id, line: sample.line });
      await page.goto(base + scene.route); await page.locator('#begin:not(:disabled)').click();
      await page.waitForFunction(() => [...document.querySelectorAll('.scene img')].every((img) => img.complete && img.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, 'batch-' + scene.group.id + '.png'), fullPage: true });
    }
    }
    // Partial failures and retry during reading preserve the selected branch/line.
    const scene = scenes[0];
    const english = '**/sources/en/' + scene.story.id + '.txt';
    const spanish = '**/gamedata/es_ES/story/' + scene.story.id + '.txt';
    await page.route(english, (route) => route.fulfill({ status: 503, body: '' }));
    await page.goto(base + scene.route);
    await page.locator('#load-notice:visible').waitFor();
    assert.match(await page.locator('#load-message').innerText(), /Inglés.*conectar/);
    assert.equal(await page.locator('#language option[value=en]').evaluate((o) => o.disabled), true);
    await page.locator('#begin').click();
    const before = await page.locator('#stage').getAttribute('data-line');
    await page.unroute(english); await page.locator('#load-retry').click();
    await page.waitForFunction((line) => document.querySelector('#stage').dataset.line === line && !document.querySelector('#dialogue').hidden, before);
    assert.equal(await page.locator('#load-notice').isVisible(), false);
    assert.equal(await page.locator('#language option[value=en]').evaluate((o) => o.disabled), false);
    await page.route(spanish, (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload(); await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.match(await page.locator('#load-message').innerText(), /mostrando en inglés.*no se encontró/i);
    await page.unroute(spanish);
    const englishText = await fs.readFile(path.resolve(root, 'vn', scene.story.source.languages.en), 'utf8');
    await page.route(english, (route) => route.fulfill({ body: '[Delay(time=0)]\n' + englishText }));
    await page.reload(); await page.locator('#begin:not(:disabled)').waitFor();
    assert.match(await page.locator('#load-message').innerText(), /no coincide con la edición/);
    assert.equal(await page.locator('#language option[value=en]').evaluate((o) => o.disabled), true);
    await page.unroute(english);
    await page.route('**/data/audio.json', (route) => route.fulfill({ status: 503, body: '' }));
    await page.reload(); await page.locator('#begin:not(:disabled)').waitFor();
    assert.match(await page.locator('#load-message').innerText(), /audio no está disponible/);
    await page.locator('#begin').click();
    assert.equal(await page.locator('#dialogue').isVisible(), true);
    await page.unroute('**/data/audio.json');
    await page.route(english, (route) => route.fulfill({ status: 503, body: '' }));
    await page.route(spanish, (route) => route.fulfill({ status: 503, body: '' }));
    await page.reload(); await page.locator('#load-notice:visible').waitFor();
    assert.equal(await page.locator('#begin').innerText(), 'Reintentar');
    await page.unroute(english); await page.unroute(spanish); await page.locator('#begin').click();
    await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#load-notice').isVisible(), false);
    await page.route(english, (route) => route.fulfill({ body: '[UnknownCommand()]' }));
    await page.route(spanish, (route) => route.fulfill({ body: '[UnknownCommand()]' }));
    await page.reload(); await page.locator('#load-notice:visible').waitFor();
    assert.equal(await page.locator('#begin').isDisabled(), true);
    assert.match(await page.locator('#load-message').innerText(), /efectos/);
    assert.equal(await page.locator('#load-classic').getAttribute('href'), '../' + scene.story.classicHash);
    await page.unroute(english); await page.unroute(spanish);
    await page.evaluate(({ key, id, line }) => {
      const saved = JSON.parse(localStorage.getItem('arknights.vn.v2'));
      saved.groups[key] ||= { resume: id, stories: {} };
      saved.groups[key].stories[id] = { line, answers: {}, read: false, updated: 1, structure: '0'.repeat(64) };
      localStorage.setItem('arknights.vn.v2', JSON.stringify(saved));
    }, { key: `${scene.group.category}:${scene.group.id}`, id: scene.story.id, line: scene.steps[10].line });
    await page.reload(); await page.locator('#begin:not(:disabled)').waitFor();
    assert.match(await page.locator('#status').innerText(), /historia ha cambiado/);
    await page.locator('#begin').click();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), String(scene.steps[0].line));
    assert.deepEqual(errors, []);
    console.log('Loading failures passed: independent languages, mismatch, audio, missing files, unsupported scripts, retry during reading.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
