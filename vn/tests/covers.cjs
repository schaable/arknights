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
    assert.deepEqual(errors, []);
    console.log('Covers passed: all categories, 17 recovered images, migrated IS topics/squads, raw fallback, local artwork under a subpath, mobile chapter/player covers, resume cards, missing artwork and both mirrors unavailable.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
