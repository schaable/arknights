// Native fullscreen, mobile fallback, dialogs, layout and asynchronous teardown.
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
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
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'vn/data/catalog.json')));
  const group = catalog.groups.find((g) => g.id === 'act10d5');
  const story = group.stories.find((s) => s.slug === 'habits');
  const script = parseScript(await fs.readFile(path.join(root, `gamedata/es_ES/story/${story.id}.txt`), 'utf8'));
  const answers = Object.fromEntries(script.filter((s) => s.command === 'decision').map((s) => [s.line, s.args.values.split(';')[0]]));
  const longest = buildTimeline(script, answers).filter((s) => s.kind === 'dialogue').sort((a, b) => b.text.length - a.text.length)[0];
  const saved = { v: 2, preferences: { language: 'es', speed: 0, motion: true, volume: 35 }, groups: {
    [`${group.category}:${group.id}`]: { resume: story.id, updated: 1, stories: { [story.id]: { line: longest.line, answers, read: false, updated: 1 } } },
  } };
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const errors = [];
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const makePage = async (options = {}) => {
      const context = await browser.newContext(options);
      // Fullscreen/layout checks do not depend on remote artwork or audio.
      await context.route('https://**', (route) => route.abort());
      await context.addInitScript((saved) => {
        if (!localStorage.getItem('arknights.vn.v2')) localStorage.setItem('arknights.vn.v2', JSON.stringify(saved));
      }, saved);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      return page;
    };
    const open = async (page, route = '#/main/chapter-0/prologue-1') => {
      await page.goto(base + route);
      await page.locator('#begin:not(:disabled)').waitFor();
    };
    const expanded = (page, value = true) => page.waitForFunction((value) =>
      document.body.classList.contains('reader-fullscreen') === value && !document.getElementById('fullscreen').disabled, value);
    const state = (page) => page.evaluate(() => ({
      saved: localStorage.getItem('arknights.vn.v2'), line: document.getElementById('stage').dataset.line,
    }));
    const layout = async (page) => {
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      for (const selector of ['#stage', '#fullscreen', '#next', '#volume', '#settings', '#history', '#review-note']) {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1
          && box.y + box.height <= viewport.height + 1, `${selector} fits ${viewport.width}×${viewport.height}`);
      }
      const scene = await page.locator('#scene').boundingBox(), stage = await page.locator('#stage').boundingBox();
      assert.ok(Math.abs(scene.width / scene.height - 16 / 9) < 0.01, 'scene retains its proportions');
      assert.ok(scene.width <= stage.width && scene.height <= stage.height, 'scene fits without cropping');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    };

    const page = await makePage({ viewport: { width: 1440, height: 900 } });
    await open(page);
    const before = await state(page);
    await page.getByRole('button', { name: 'Pantalla completa', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expanded(page);
    assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true);
    assert.deepEqual(await state(page), before, 'entering fullscreen does not start or save a story');
    await page.locator('#begin').click();
    await page.locator('#dialogue:visible').waitFor();
    const firstLine = await page.locator('#stage').getAttribute('data-line');
    await page.locator('#fullscreen').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction((line) => document.getElementById('stage').dataset.line !== line, firstLine);
    await expanded(page);
    await layout(page);
    await page.screenshot({ path: path.join(output, 'fullscreen-desktop.png') });
    const reading = await state(page);
    await page.locator('#settings').click();
    await page.locator('#nickname').fill('A');
    await page.locator('#nickname').press('Space');
    assert.equal(await page.locator('#nickname').inputValue(), 'A ');
    assert.equal((await state(page)).line, reading.line);
    await page.locator('#settings-dialog .close').click();
    await page.locator('#history').click();
    await page.locator('#history-dialog[open]').waitFor();
    await page.locator('#history-dialog .close').click();
    await page.locator('#review-note').click();
    await page.locator('#review-dialog[open]').waitFor();
    await page.locator('#review-comment').fill('A');
    await page.locator('#review-comment').press('Space');
    assert.equal(await page.locator('#review-comment').inputValue(), 'A ');
    await page.screenshot({ path: path.join(output, 'fullscreen-review.png') });
    await page.locator('#review-close').click();
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#fullscreen').getAttribute('aria-label'), 'Exit fullscreen');
    const unchanged = await state(page);
    await page.keyboard.press('Escape');
    await expanded(page, false);
    assert.deepEqual(await state(page), unchanged, 'exiting preserves reading and settings');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fullscreen');
    await page.locator('#fullscreen').click();
    await expanded(page);
    await page.evaluate(() => document.exitFullscreen());
    await expanded(page, false);
    assert.equal(await page.locator('#fullscreen').getAttribute('aria-label'), 'Fullscreen');
    await page.locator('#fullscreen').click();
    await expanded(page);
    await page.evaluate(() => { location.hash = '#/'; });
    await page.locator('.category-card').first().waitFor();
    await expanded(page, false);
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);

    const mobile = await makePage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.addInitScript(() => Object.defineProperty(document, 'fullscreenEnabled', { value: false }));
    await open(mobile, '#/vignettes/children-of-ursus/habits');
    await mobile.locator('#fullscreen').tap();
    await expanded(mobile);
    assert.equal(await mobile.evaluate(() => document.fullscreenElement), null, 'unsupported browsers use full-window mode');
    await mobile.locator('#begin').tap();
    await mobile.locator('#dialogue:visible').waitFor();
    assert.equal(await mobile.locator('#stage').getAttribute('data-line'), String(longest.line));
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 280, height: 653 }]) {
      await mobile.setViewportSize(viewport);
      await layout(mobile);
      await mobile.screenshot({ path: path.join(output, `fullscreen-mobile-${viewport.width}.png`) });
    }
    await mobile.locator('#settings').tap();
    await mobile.keyboard.press('Escape');
    await mobile.locator('#settings-dialog').waitFor({ state: 'hidden' });
    await expanded(mobile);
    await mobile.locator('#fullscreen').tap();
    await expanded(mobile, false);
    await mobile.locator('#fullscreen').tap();
    await expanded(mobile);
    await mobile.keyboard.press('Escape');
    await expanded(mobile, false);

    const denied = await makePage();
    await denied.addInitScript(() => {
      Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('Blocked by host'));
    });
    await open(denied);
    await denied.locator('#fullscreen').click();
    await expanded(denied);
    assert.equal(await denied.evaluate(() => document.fullscreenElement), null);
    await denied.keyboard.press('Escape');
    await expanded(denied, false);
    // A late native response must not expand the library after route cleanup.
    await denied.evaluate(() => {
      document.documentElement.requestFullscreen = () => new Promise((resolve) => {
        window.finishFullscreen = () => {
          Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
          document.dispatchEvent(new Event('fullscreenchange')); resolve();
        };
      });
      document.exitFullscreen = async () => {
        delete document.fullscreenElement; document.dispatchEvent(new Event('fullscreenchange'));
      };
    });
    await denied.locator('#fullscreen').click();
    await denied.evaluate(() => { location.hash = '#/'; });
    await denied.locator('.category-card').first().waitFor();
    await denied.evaluate(() => window.finishFullscreen());
    await expanded(denied, false);
    assert.equal(await denied.evaluate(() => document.fullscreenElement), null);
    assert.deepEqual(errors, []);
    console.log('Fullscreen passed: native entry/exit, Escape, focus, unchanged progress, dialogs/review, Space, localized labels, mobile fallback, proportions, rotation and late-request cleanup.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
