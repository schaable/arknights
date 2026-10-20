// Real translated-scene timing, overlay restoration, audio channels and teardown.
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
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' })[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});

(async () => {
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'vn/data/catalog.json')));
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const { routeFor } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const { copy } = await import(pathToFileURL(path.join(root, 'vn/i18n.mjs')));
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, ignoreHTTPSErrors: true });
    await context.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.__vnAudio = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__vnAudio.push(audio); return audio; };
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    await page.goto(base); await page.locator('.category-card').first().waitFor();

    let checkpoint = 0;
    async function openAt(id, line, motion = false) {
      const group = catalog.groups.find((g) => g.stories.some((s) => s.id === id));
      const story = group.stories.find((s) => s.id === id);
      assert.equal(story.vn, true, id);
      const commands = parseScript(await fs.readFile(path.resolve(root, 'vn', story.source.languages.es), 'utf8'));
      const answers = Object.fromEntries(commands.filter((c) => c.command === 'decision' && c.line < line).map((c) => [c.line, c.args.values.split(';')[0]]));
      const steps = buildTimeline(commands, answers);
      assert.ok(steps.some((s) => s.line === line), `Checkpoint ${id}:${line}`);
      await page.goto(base); // Dispose before replacing the saved checkpoint.
      await page.locator('.category-card').first().waitFor();
      await page.evaluate(({ key, id, line, answers, structure, motion }) => {
        localStorage.setItem('arknights.vn.v2', JSON.stringify({ v: 2,
          preferences: { language: 'es', speed: 0, motion, nickname: 'Test' },
          groups: { [key]: { resume: id, updated: 1, stories: { [id]: { line, answers, structure, updated: 1 } } } },
        }));
      }, { key: `${group.category}:${group.id}`, id, line, answers, structure: story.source.structure, motion });
      await page.goto(base + '?checkpoint=' + (++checkpoint) + routeFor(group.category, group, story));
      await page.locator('#begin:not(:disabled)').click();
      await page.waitForFunction((line) => document.querySelector('#stage').dataset.line === String(line)
        && document.querySelector('#stage').getAttribute('aria-busy') === 'false', line);
      return steps;
    }
    const done = () => page.waitForFunction(() => document.querySelector('#stage').getAttribute('aria-busy') === 'false');
    const decoded = (selector) => page.locator(selector).evaluate((img) => img.decode());

    // A real cut-in expands from the center and remains separate from base sprites.
    await openAt('obt/main/level_main_02-02_beg', 68);
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#cutins .cutin')?.getAnimations().length > 0);
    assert.equal(await page.locator('#stage').getAttribute('aria-busy'), 'true');
    await done();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '71');
    await decoded('#cutins img');
    assert.equal(await page.locator('#cutins img').getAttribute('data-asset'), 'char_2005_weiyw_1');
    assert.equal(await page.locator('#characters img').count(), 2);
    await page.screenshot({ path: path.join(output, 'cutin.png'), fullPage: true });
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '71');
    assert.equal(await page.locator('#cutins .cutin').count(), 1);
    await page.locator('#back').click(); assert.equal(await page.locator('#cutins .cutin').count(), 0);
    await page.locator('#next').click(); await done();
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '71');
    assert.equal(await page.locator('#cutins .cutin').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 }); await decoded('#cutins img');
    await page.screenshot({ path: path.join(output, 'cutin-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 960 });
    await openAt('obt/main/level_main_02-02_beg', 77);
    await page.locator('#next').click(); await done();
    await page.locator('#cutins .cutin').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#cutins .cutin').count(), 0, 'cut-in removal completes');
    // Skipping midway through the disappearance reaches the same clean snapshot.
    await page.locator('#back').click();
    await page.locator('#next').click(); await page.locator('#next').click();
    assert.equal(await page.locator('#cutins .cutin').count(), 0);

    // The photograph appears and disappears entirely between two dialogue boxes.
    await openAt('activities/act10d5/level_act10d5_st02', 51);
    // A slow first request must not consume its one-second display time.
    await page.route('**/avg/items/item_act10_1.png', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1300)); await route.continue();
    });
    await page.locator('#next').click();
    await page.locator('#item img').waitFor(); await decoded('#item img');
    assert.equal(await page.locator('#dialogue').isVisible(), false);
    await page.screenshot({ path: path.join(output, 'ursus-photo.png'), fullPage: true });
    await page.waitForFunction(() => document.querySelector('#item img')?.getAnimations().length > 0);
    await done();
    await page.locator('#item img').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#item img').count(), 0);
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '58');
    await page.unroute('**/avg/items/item_act10_1.png');

    // Skip a pending image request: no late image/error can reappear after restore.
    await openAt('activities/act10d5/level_act10d5_st02', 51);
    let release, finished, intercepted;
    const pending = new Promise((resolve) => { release = resolve; });
    const completed = new Promise((resolve) => { finished = resolve; });
    const requested = new Promise((resolve) => { intercepted = resolve; });
    await page.route('**/avg/items/item_act10_1.png', async (route) => {
      intercepted();
      await pending;
      try { await route.fulfill({ status: 404, body: '' }); finished(null); }
      catch (error) { finished(error); }
    });
    await page.locator('#next').click();
    await page.locator('#item img').waitFor({ state: 'attached' });
    await requested;
    await page.locator('#next').click();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '58');
    assert.equal(await page.locator('#item img').count(), 0);
    release();
    const cancelled = await completed;
    if (cancelled) assert.match(cancelled.message, /Route is already handled|Target.*closed/);
    await page.unroute('**/avg/items/item_act10_1.png');
    assert.equal(await page.locator('#status').innerText(), '');

    // Both asset hosts failing shows a notice but does not trap the reader.
    await openAt('activities/act10d5/level_act10d5_st02', 51);
    let failedImages = 0;
    await page.route('**/avg/items/item_act10_1.png', (route) => {
      failedImages++; return route.fulfill({ status: 404, body: '' });
    });
    await page.locator('#next').click(); await done();
    assert.equal(failedImages, 2);
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '58');
    assert.equal(await page.locator('#status').innerText(), copy.es.assetError);
    await page.unroute('**/avg/items/item_act10_1.png');

    // Simultaneous background and foreground tweens keep independent transforms.
    await openAt('obt/main/level_main_05-06_end', 67);
    await page.locator('#next').click();
    await page.waitForFunction(() => document.querySelector('#background img')?.getAnimations().some((a) => a.vnProperty === 'transform'), null, { timeout: 15000 });
    assert.ok(await page.locator('#image img').evaluate((img) => img.getAnimations().some((a) => a.vnProperty === 'transform')));
    await decoded('#background img'); await decoded('#image img');
    await done(); // Nonblocking tweens continue after dialogue starts.
    assert.ok(await page.locator('#background img').evaluate((img) => img.getAnimations().length > 0));
    await page.screenshot({ path: path.join(output, 'background-tween.png'), fullPage: true });
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#background img').evaluate((img) => img.style.transform), 'translate(0%, 0%) scale(1.1)');
    assert.match(await page.locator('#image img').evaluate((img) => img.style.transform), /scale\(1.2\)/);
    assert.equal(await page.evaluate(() => document.querySelector('#scene').getAnimations({ subtree: true }).length), 0);

    // Both real StopSound commands stop restored loops. Skipping visual waits
    // doesn't skip audio fades; other effects/music remain owned by the player.
    for (const [id, line, sound] of [['obt/main/level_main_02-02_beg', 122, 'slideshow'], ['obt/main/level_main_03-04_end', 105, 'heartbeat']]) {
      await openAt(id, line, sound !== 'slideshow');
      await page.locator('#sound').click();
      await page.waitForFunction((key) => window.__vnAudio.some((a) => a.src.includes(key) && a.loop && !a.paused && a.readyState >= 2), sound, { timeout: 30000 });
      await page.locator('#next').click();
      if (sound === 'slideshow') await page.waitForFunction(() => window.__vnAudio.some((a) => a.src.includes('slideshow') && a.volume > 0 && a.volume < 0.1));
      await done();
      await page.waitForFunction((key) => !window.__vnAudio.some((a) => a.getAttribute('src')?.includes(key)), sound);
      assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true', 'scene commands preserve the global sound preference');
      await page.evaluate(() => { location.hash = '#/'; }); await page.locator('.category-card').first().waitFor();
      assert.equal(await page.evaluate(() => window.__vnAudio.every((a) => a.paused && !a.getAttribute('src'))), true);
    }
    // Route changes during an active cut-in animation leave no overlays/timers behind.
    await openAt('obt/main/level_main_02-02_beg', 68);
    await page.locator('#next').click();
    await page.evaluate(() => { location.hash = '#/'; });
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#cutins > *, #item > *').count(), 0);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    assert.deepEqual(errors, []);
    console.log('Scene commands passed: timed cut-ins/items/tweens, mobile, restoration, both real sound stops and route teardown.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
