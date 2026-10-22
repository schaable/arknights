// Slow expression loads, unchanged nodes, prefetch, fallback and cancelled character swaps.
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = process.env.VN_PLAYWRIGHT_MODULE ? require(process.env.VN_PLAYWRIGHT_MODULE)
  : createRequire(path.join(process.cwd(), 'package.json'))('playwright');
const root = path.resolve(__dirname, '../..');
const output = process.env.VN_SCREENSHOTS || '/tmp/arknights-vn';
const server = http.createServer(async (request, response) => {
  let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/arknights(?=\/)/, '');
  if (name.endsWith('/')) name += 'index.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});

(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const errors = [], requests = [], gates = new Map();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const sprite = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="600"><path fill="#80d4dd" d="M100 0h100l80 600H20Z"/></svg>';
    await context.route(/^https:\/\//, async (route) => {
      const url = decodeURIComponent(route.request().url());
      requests.push(url);
      if (url.includes('/avg/characters/')) {
        const gate = gates.get(url.split('/').at(-1));
        if (gate) await gate.promise;
        if (url.includes('missing') || (url.includes('mirror') && url.includes('cdn.jsdelivr.net'))) {
          return route.fulfill({ status: 404, body: '' });
        }
        if (url.includes('corrupt') && url.includes('cdn.jsdelivr.net')) {
          return route.fulfill({ contentType: 'image/png', body: 'invalid image' });
        }
        if (process.env.VN_REAL_ART && url.includes('/avg/characters/char_')) {
          return route.fulfill({ response: await route.fetch() });
        }
        await route.fulfill({ contentType: 'image/svg+xml', body: sprite });
      } else await route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) => errors.push(error.message));
    const id = 'obt/guide/beg/0_welcome_to_guide';
    await context.addInitScript((id) => {
      localStorage.setItem('arknights.vn.v2', JSON.stringify({ v: 2,
        preferences: { language: 'es', speed: 0, motion: true }, groups: {
          'main:main_0': { resume: id, stories: { [id]: { line: 99, answers: {}, updated: 1 } } },
        } }));
    }, id);
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const at = (line) => page.waitForFunction((line) => document.querySelector('#stage').dataset.line === String(line)
      && document.querySelector('#stage').getAttribute('aria-busy') === 'false', line);
    const decoded = () => page.waitForFunction(() => document.querySelectorAll('#characters img').length === 2
      && [...document.querySelectorAll('#characters img')].every((img) => img.complete && img.naturalWidth));
    await page.goto(base + '#/main/chapter-0/prologue-1');
    await page.locator('#begin:not(:disabled)').click(); await at(99); await decoded();
    await page.evaluate(() => {
      window.originalSprites = [...document.querySelector('#characters').children];
      window.characterMutations = [];
      new MutationObserver((records) => window.characterMutations.push(...records.map((r) => r.type)))
        .observe(document.querySelector('#characters'), { childList: true });
    });
    await page.locator('#next').click(); await at(101);
    assert.deepEqual(await page.evaluate(() => window.characterMutations), [], 'focus changes must not detach unchanged images');
    assert.equal(await page.evaluate(() => window.originalSprites.every((node, i) => node === document.querySelector('#characters').children[i])), true);
    assert.equal(await page.locator('#characters img').nth(1).evaluate((el) => el.classList.contains('dim')), true);

    let release;
    gates.set('char_002_amiya_1#1$1.png', { promise: new Promise((resolve) => { release = resolve; }) });
    await page.locator('#next').click(); await at(102);
    await page.locator('#next').click(); await at(104);
    await page.waitForTimeout(100);
    assert.ok(requests.some((url) => url.endsWith('char_002_amiya_1#1$1.png')), 'the upcoming expression loads ahead of the click');
    await page.locator('#next').click(); await at(106);
    await page.locator('#next').click(); await at(108);
    assert.equal(await page.locator('#characters img').nth(1).getAttribute('data-asset'), 'char_002_amiya_1#4', 'the previous expression stays visible while its replacement loads');
    await decoded();
    await page.locator('#back').click(); await at(106);
    release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#characters img').nth(1).getAttribute('data-asset'), 'char_002_amiya_1#4', 'a late expression cannot overwrite Back');
    await page.locator('#next').click(); await at(108);
    await page.waitForFunction(() => document.querySelector('#characters img:last-child')?.dataset.asset === 'char_002_amiya_1#1');
    await decoded();
    assert.equal(await page.evaluate(() => window.originalSprites[0] === document.querySelector('#characters img')), true, 'the other operator never gets replaced');
    await page.locator('#language').selectOption('en'); await at(108); await decoded();
    assert.equal(await page.evaluate(() => window.originalSprites[0] === document.querySelector('#characters img')), true);
    await page.screenshot({ path: path.join(output, 'characters-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'characters-mobile.png'), fullPage: true });

    // A fresh layer exercises failed mirrors, duplicate slots and cancellation
    // without changing a real story's source to manufacture those conditions.
    await page.evaluate(async () => {
      const { createCharacters } = await import('./characters.mjs');
      window.testLayer = document.createElement('div');
      document.body.append(window.testLayer);
      window.spriteErrors = 0;
      window.testCharacters = createCharacters(window.testLayer, () => window.spriteErrors++);
      await window.testCharacters.draw(['mirror#2', 'mirror#2'], 2);
    });
    assert.deepEqual(await page.evaluate(() => [...window.testLayer.children].map((img) => ({
      ready: img.complete && img.naturalWidth > 0, slot: img.dataset.slot, dim: img.classList.contains('dim'), src: img.src,
    }))), [
      { ready: true, slot: 'left', dim: true, src: 'https://raw.githubusercontent.com/akgcc/arkdata/main/assets/avg/characters/mirror%232%241.png' },
      { ready: true, slot: 'right', dim: false, src: 'https://raw.githubusercontent.com/akgcc/arkdata/main/assets/avg/characters/mirror%232%241.png' },
    ]);
    assert.equal(requests.filter((url) => url.includes('cdn.jsdelivr.net') && url.includes('/mirror#2')).length, 1, 'duplicate slots share one primary request');
    await page.evaluate(() => window.testCharacters.draw(['corrupt'], 1));
    assert.match(await page.evaluate(() => window.testLayer.firstChild.src), /raw.githubusercontent.com/);
    await page.evaluate(() => window.testCharacters.draw(['missing'], 1));
    assert.equal(await page.evaluate(() => window.spriteErrors), 1);
    assert.equal(await page.evaluate(() => window.testLayer.children.length), 0, 'failed downloads never insert broken images');

    // Decoding can also be slow after the network load has completed.
    await page.evaluate(async () => {
      await window.testCharacters.draw(['held#1'], 1);
      const original = HTMLImageElement.prototype.decode;
      window.decodeGate = new Promise((resolve) => { window.releaseDecode = resolve; });
      HTMLImageElement.prototype.decode = async function () {
        await original.call(this);
        if (this.dataset.asset === 'held#2') await window.decodeGate;
      };
      window.pendingDraw = window.testCharacters.draw(['held#2'], 1);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.testLayer.firstChild.dataset.asset), 'held#1', 'load alone must not replace a decoded sprite');
    await page.evaluate(async () => { window.releaseDecode(); await window.pendingDraw; });
    assert.equal(await page.evaluate(() => window.testLayer.firstChild.dataset.asset), 'held#2');
    await page.evaluate(() => {
      window.decodeGate = new Promise((resolve) => { window.releaseDecode = resolve; });
      window.pendingDraw = window.testCharacters.draw(['held#1', 'held#2'], 1);
      window.testCharacters.clear();
    });
    await page.evaluate(async () => { window.releaseDecode(); await window.pendingDraw; });
    assert.equal(await page.evaluate(() => window.testLayer.children.length), 0, 'clear cancels pending decoded replacements');
    assert.equal(await page.evaluate(() => window.spriteErrors), 1, 'cancelled loads do not report failures');

    // Cache eviction and data saving never retain a whole story's sprites.
    await page.evaluate(async () => {
      window.preparedSprites = 0;
      window.Image = new Proxy(window.Image, { construct(target, args) {
        window.preparedSprites++; return Reflect.construct(target, args);
      } });
      for (let i = 0; i < 14; i++) await window.testCharacters.draw([`cache_${i}`], 1);
    });
    await page.evaluate(() => window.testCharacters.draw(['cache_0'], 1));
    assert.equal(await page.evaluate(() => window.preparedSprites), 15, 'old decoded cache entries are evicted even when the browser keeps their HTTP responses');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'connection', { value: { saveData: true } });
      window.testCharacters.prefetch(['data_saver']);
    });
    await page.waitForTimeout(50);
    assert.equal(requests.some((url) => url.includes('/data_saver')), false);
    await page.evaluate(() => window.testCharacters.draw(['data_saver'], 1));
    assert.equal(await page.evaluate(() => window.testLayer.firstChild.dataset.asset), 'data_saver');

    await page.evaluate(() => { location.hash = '#/'; });
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#characters img').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Characters passed: stable nodes, network/decode delays, lookahead, focus, Back, language, fallback/failure, duplicate slots, cancellation, bounded cache, data saving and desktop/mobile layouts.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
