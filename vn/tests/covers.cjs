// Real artwork, CDN fallback, absent covers, and responsive library/player views.
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
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' })[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});

(async () => {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Exercise the raw mirror with actual PNGs, without relying on CDN caches.
    await page.route('https://cdn.jsdelivr.net/**', (route) => route.abort());
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const go = async (hash) => {
      await page.goto(base + hash);
      // A hash-only goto reuses the old document/catalog. Reload so injected
      // catalog responses and artwork assertions refer to the requested page.
      await page.reload();
      await page.locator('#library:not([hidden]) .library-heading').waitFor();
    };
    const art = async (selector) => {
      const img = page.locator(selector + ' .collection-art.has-art img').first();
      await img.waitFor({ timeout: 30000 });
      assert.ok(await img.evaluate((img) => img.complete && img.naturalWidth > 0));
      assert.equal(await img.evaluate((img) => getComputedStyle(img).objectFit), 'contain');
      const src = await img.getAttribute('src');
      assert.ok(src.startsWith('https://raw.githubusercontent.com/') || src.startsWith(base + 'assets/covers/'), src);
      return src;
    };
    await go('#/main');
    await art('.collection-card');
    assert.equal(await page.locator('.collection-card').count(), 18);
    await page.screenshot({ path: path.join(output, 'chapter-covers.png'), fullPage: true });
    await page.evaluate(() => { window.firstCover = document.querySelector('.collection-card .collection-art img'); });
    await page.locator('#language').selectOption('en');
    assert.equal(await page.evaluate(() => window.firstCover === document.querySelector('.collection-card .collection-art img')), true, 'language updates preserve decoded covers');
    await page.locator('.catalog-filters input[type="search"]').fill('0');
    assert.equal(await page.evaluate(() => window.firstCover === document.querySelector('.collection-card .collection-art img')), true, 'filtering retains covers still in the grid');
    await page.locator('.catalog-filters input[type="search"]').fill('');
    await page.locator('.collection-cover-link').first().click();
    await art('.library-heading');
    assert.equal(await page.evaluate(() => window.firstCover === document.querySelector('.library-heading .collection-art img')), true, 'the collection heading reuses its card artwork');
    await page.locator('.story-mark-read').first().click();
    assert.equal(await page.evaluate(() => window.firstCover === document.querySelector('.library-heading .collection-art img')), true, 'progress updates do not reload the heading');
    await page.locator('.story-mark-read').first().click();

    for (const hash of ['#/main/chapter-0', '#/side-stories/code-of-brawl', '#/vignettes/children-of-ursus']) {
      await go(hash); await art('.library-heading');
      assert.ok(await page.locator('.story-title').count());
      if (hash.includes('code-of-brawl')) await page.screenshot({ path: path.join(output, 'assets2-event-cover.png') });
    }
    const catalog = JSON.parse(await fs.readFile(path.join(root, 'vn/data/catalog.json')));
    for (const category of ['operator-records', 'operator-modules', 'integrated-strategies']) {
      const group = catalog.groups.find((g) => g.category === category && g.cover);
      await go(`#/${category}/${group.slug}`); await art('.library-heading');
    }

    const recovered = ['main_15', 'main_16', 'main_17', 'act24side', 'act36side', 'act42side', 'act43side',
      'act44side', 'act45side', 'act46side', 'act47side', 'act48side', 'act49side', 'act51side', 'act13mini', 'rogue_0', 'rogue_5'];
    for (const id of recovered) {
      const group = catalog.groups.find((g) => g.id === id);
      await go(`#/${group.category}/${group.slug}`); await art('.library-heading');
      if (['main_15', 'act13mini', 'act24side', 'act36side', 'rogue_0', 'rogue_5'].includes(id)) {
        await page.screenshot({ path: path.join(output, `recovered-cover-${id}.png`) });
      }
    }

    // Migrated topic artwork must also reach the independently saved squad pages.
    for (const id of ['rogue_1', 'rogue_2', 'rogue_3', 'rogue_4']) {
      const topic = catalog.groups.find((g) => g.id === id);
      await go(`#/${topic.category}/${topic.slug}`);
      const source = await art('.library-heading');
      assert.ok(source.includes('/ArknightsAssets/ArknightsAssets2/'), source);
      const squad = catalog.groups.find((g) => g.id.startsWith(id + '_'));
      await go(`#/${squad.category}/${squad.slug}`);
      assert.equal(await art('.library-heading'), source);
      assert.ok(await page.locator('.story-title').count());
      if (id === 'rogue_2') await page.screenshot({ path: path.join(output, 'assets2-squad-cover.png') });
    }

    await page.goto(base + '#/main/chapter-0/prologue-1');
    await page.locator('#begin:not(:disabled)').waitFor(); await art('#cover');
    await page.screenshot({ path: path.join(output, 'story-collection-cover.png') });
    await page.evaluate(() => { window.playerCover = document.querySelector('#cover-art img'); });
    const nextStory = await page.locator('#story-select option').nth(1).getAttribute('value');
    await page.locator('#story-select').selectOption(nextStory);
    await page.locator('#begin:not(:disabled)').waitFor(); await art('#cover');
    assert.equal(await page.evaluate(() => window.playerCover === document.querySelector('#cover-art img')), true, 'stories in the same collection keep the cover image');
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'story-collection-cover-mobile.png'), fullPage: true });
    await page.locator('#begin').click(); await page.locator('#dialogue:visible').waitFor();
    await page.locator('#next').click();
    await page.evaluate(() => { location.hash = '#/'; });
    await page.locator('.resume-grid').waitFor(); await art('.resume-grid');
    await go('#/main/chapter-0'); await art('.library-heading');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'assets2-chapter-cover-mobile.png') });

    // Unknown artwork has a stable placeholder and still exposes every story.
    // Inject an unmapped future collection instead of depending on a catalog gap.
    const withoutArt = structuredClone(catalog);
    delete withoutArt.groups.find((g) => g.id === 'main_15').cover;
    await page.route('**/data/catalog.json', (route) => route.fulfill({ json: withoutArt }));
    await go('#/main/chapter-15');
    assert.equal(await page.locator('.library-heading .collection-art img').count(), 0);
    assert.ok(await page.locator('.story-title').count());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.unroute('**/data/catalog.json');

    // Failure of both mirrors leaves no broken image or blocked navigation.
    // A fresh context avoids previously decoded images bypassing interception.
    const offline = await browser.newPage({ viewport: { width: 375, height: 812 } });
    offline.on('pageerror', (error) => errors.push(error.message));
    await offline.route(/^https:\/\/(cdn\.jsdelivr\.net|raw\.githubusercontent\.com)\//, (route) => route.abort());
    await offline.goto(base + '#/main/chapter-1');
    await offline.locator('.library-heading .collection-art').waitFor();
    await offline.waitForFunction(() => !document.querySelector('.library-heading .collection-art img'));
    await offline.locator('.story-title').first().click();
    await offline.locator('#begin:not(:disabled)').waitFor();

    // Control cold download and decoding separately, with a real browser decoder.
    const slow = await browser.newPage({ viewport: { width: 600, height: 800 } });
    slow.on('pageerror', (error) => errors.push(error.message));
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const attempts = [];
    await slow.route(/^https:\/\//, async (route) => {
      const url = route.request().url();
      if (!url.includes('cover-check') && !url.includes('lazy-cover')) return route.abort();
      attempts.push(url);
      if (url.includes('cdn.jsdelivr.net')) return route.abort();
      if (url.includes('cover-check')) await gate;
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#80d4dd"/></svg>' });
    });
    await slow.goto(base); await slow.locator('.category-card').first().waitFor();
    await slow.evaluate(async () => {
      const { createCover, reuseCovers } = await import('./covers.mjs');
      window.makeCover = createCover; window.reuseCovers = reuseCovers;
      const decode = HTMLImageElement.prototype.decode;
      window.decodeGate = new Promise((resolve) => { window.releaseDecode = resolve; });
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (this.src.includes('cover-check')) { window.decodeStarted = true; await window.decodeGate; }
      };
      window.coverSpec = { provider: 'arkdata', path: 'cover-check.png', crop: { x: 20, y: 10, size: 100 } };
      window.coverHost = document.createElement('div'); window.coverHost.id = 'cover-test';
      window.coverHost.style.cssText = 'position:fixed;top:10px;left:10px;width:200px;z-index:100';
      document.body.append(window.coverHost);
      window.coverHost.append(createCover(window.coverSpec, { lazy: false }));
    });
    const box = await slow.locator('#cover-test .collection-art').boundingBox();
    assert.equal(await slow.locator('#cover-test img').count(), 0);
    release(); await slow.waitForFunction(() => window.decodeStarted);
    assert.equal(await slow.locator('#cover-test .has-art').count(), 0, 'load completion does not reveal an undecoded cover');
    await slow.evaluate(() => window.releaseDecode());
    await slow.locator('#cover-test .has-art img').waitFor();
    assert.deepEqual(await slow.locator('#cover-test .collection-art').boundingBox(), box, 'decoding does not shift the cover');
    assert.deepEqual(await slow.locator('#cover-test img').evaluate((img) => [img.style.width, img.style.height, img.style.inset]), ['200%', '150%', '-10% auto auto -20%']);
    await slow.evaluate(() => {
      window.savedCoverImage = window.coverHost.querySelector('img');
      const reuse = window.reuseCovers(window.coverHost);
      window.coverHost.replaceChildren(reuse(window.coverSpec));
    });
    assert.equal(await slow.evaluate(() => window.savedCoverImage === window.coverHost.querySelector('img')), true);
    await slow.evaluate(() => window.coverHost.append(window.makeCover({ ...window.coverSpec, crop: { x: 0, y: 0, size: 150 } }, { lazy: false })));
    await slow.locator('#cover-test .collection-art:nth-child(2).has-art img').waitFor();
    assert.equal(await slow.locator('#cover-test img').count(), 2, 'the same artwork supports simultaneous independent placements');
    assert.equal(await slow.locator('#cover-test img').first().evaluate((img) => img.style.width), '200%');
    assert.equal(await slow.locator('#cover-test img').last().evaluate((img) => img.style.height), '100%');
    assert.equal(attempts.filter((url) => url.includes('cover-check') && url.includes('cdn.jsdelivr.net')).length, 1, 'the working mirror is reused across placements');

    await slow.evaluate(() => {
      window.lazyHost = document.createElement('div');
      window.lazyHost.style.cssText = 'position:absolute;top:10000px;width:200px';
      window.lazyHost.append(window.makeCover({ provider: 'arkdata', path: 'lazy-cover.png' }));
      document.body.append(window.lazyHost);
    });
    await slow.waitForTimeout(100);
    assert.equal(attempts.some((url) => url.includes('lazy-cover')), false, 'distant grid artwork still loads lazily');
    await slow.evaluate(() => { window.lazyHost.style.top = '0'; });
    await slow.waitForFunction(() => window.lazyHost.querySelector('.has-art'));
    await slow.evaluate(() => {
      window.decodeGate = new Promise((resolve) => { window.releaseDecode = resolve; });
      window.detachedCover = window.makeCover(window.coverSpec, { lazy: false });
      window.coverHost.replaceChildren(window.detachedCover);
    });
    await slow.evaluate(() => { window.coverHost.replaceChildren(); window.releaseDecode(); });
    await slow.waitForTimeout(100);
    assert.equal(await slow.evaluate(() => window.detachedCover.classList.contains('has-art')), false, 'late decoding cannot reveal a removed cover');
    assert.deepEqual(errors, []);
    console.log('Covers passed: decoded reveal, node reuse on filters/language/progress, lazy loading, mirror cache, independent crops, late cleanup, all categories, real/local artwork, mobile/player/resume views and missing artwork.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
