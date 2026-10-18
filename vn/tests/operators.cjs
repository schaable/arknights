// Operator indexes, combined lists, and compatibility with existing per-collection saves.
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
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'vn/data/catalog.json')));
  const { routeFor, groupKey, operatorsFor } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const record = operatorsFor(catalog, 'operator-records').find((o) => o.name === 'Exusiai');
  const module = operatorsFor(catalog, 'operator-modules').find((o) => o.id === record.id);
  const records = [...record.groups].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  assert.ok(records.length > 1 && module.groups.length > 1);
  const key = 'arknights.vn.v2';
  const seed = { v: 2, preferences: { language: 'es', speed: 0, motion: true }, groups: {
    [groupKey(records[0])]: { resume: null, updated: 0, stories: { [records[0].stories[0].id]: { read: true } } },
    [groupKey(module.groups[0])]: { resume: null, updated: 0, stories: { [module.groups[0].stories[0].id]: { read: true } } },
  } };
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    await context.addInitScript(({ key, seed }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(seed));
    }, { key, seed });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const mark = (g) => page.locator(`.story-mark-read[data-group="${g.id}"][data-story="${g.stories[0].id}"]`);
    const heading = (text) => page.waitForFunction((text) => document.querySelector('.library-heading h2')?.textContent === text, text);
    const go = async (hash, title) => {
      await page.goto(base + hash);
      await heading(title);
    };
    const assertRead = async (g, read) => assert.equal(await mark(g).innerText(), read ? 'Marcar como no leída' : 'Marcar como leída');
    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    for (const id of ['operator-records', 'operator-modules']) {
      const count = operatorsFor(catalog, id).length;
      assert.match(await page.locator(`.category-card[href="${routeFor(id)}"] p`).innerText(), new RegExp(`^${count} operadores`));
    }

    for (const op of [record, module]) {
      const id = op.groups[0].category, category = catalog.categories.find((c) => c.id === id);
      await page.locator(`.category-card[href="${routeFor(id)}"]`).click();
      await heading(category.name.es);
      const index = operatorsFor(catalog, id);
      assert.equal(await page.locator('.collection-card').count(), index.length);
      assert.deepEqual(await page.locator('.collection-title').allTextContents(), index.map((o) => o.name));
      await page.locator('input[type="search"]').fill('exusiai');
      const card = page.locator('.collection-card').filter({ has: page.locator('.collection-title', { hasText: /^Exusiai$/ }) });
      assert.equal(await card.count(), 1);
      const total = op.groups.reduce((n, g) => n + g.stories.length, 0);
      assert.match(await card.locator('.collection-stats').innerText(), new RegExp(`^1/${total} `));
      await page.locator('.catalog-filters input[type="checkbox"]').check();
      assert.equal(await page.locator('.collection-card').count(), 0);
      await page.locator('.catalog-filters input[type="checkbox"]').uncheck();
      await page.locator('input[type="search"]').fill(op.groups[0].stories[0].title);
      assert.ok((await page.locator('.collection-title').allTextContents()).includes(op.name), 'search finds an operator by story title');
      await page.locator('input[type="search"]').fill(op.name);
      await card.locator('.collection-title').click();
      await heading(op.name);
      assert.equal(new URL(page.url()).hash, routeFor(id, op));
      assert.equal(await page.locator('.story-row').count(), total);
      assert.match(await page.locator('.library-heading p').innerText(), new RegExp(`^1/${total} `));
      assert.equal(await page.locator('.story-cover').count(), id === 'operator-modules' ? total : 0);
      const groups = id === 'operator-records' ? records : op.groups;
      assert.deepEqual(await page.locator('.story-title').allTextContents(), groups.flatMap((g) => g.stories.map((s) => s.title)));
      for (const g of groups) for (const s of g.stories) {
        const row = page.locator('.story-row').filter({ has: page.locator(`.story-title[href="${routeFor(id, g, s)}"]`) });
        assert.equal(await row.locator('.classic-link').getAttribute('href'), '../' + s.classicHash);
      }
      await assertRead(groups[0], true); await assertRead(groups[1], false);
      await page.reload(); await heading(op.name);
      await assertRead(groups[0], true);
      assert.deepEqual(await stored(), seed, 'browsing operator pages does not rewrite old saves');
      await page.locator('#breadcrumbs a').first().click();
      await page.locator('.category-card').first().waitFor();
    }

    // Toggling a record affects only its original group and survives old/new URLs.
    await go(routeFor('operator-records', record), record.name);
    await mark(records[1]).click();
    await assertRead(records[1], true);
    assert.equal(await mark(records[1]).evaluate((button) => button === document.activeElement), true);
    const changed = await stored();
    assert.deepEqual(changed.groups[groupKey(records[0])], seed.groups[groupKey(records[0])]);
    assert.deepEqual(changed.groups[groupKey(module.groups[0])], seed.groups[groupKey(module.groups[0])]);
    assert.deepEqual(changed.groups[groupKey(records[1])].stories[records[1].stories[0].id], { read: true });
    await page.reload(); await heading(record.name); await assertRead(records[1], true);
    await go(routeFor('operator-records', records[1]), records[1].title);
    await assertRead(records[1], true);
    await page.locator('#breadcrumbs a', { hasText: record.name }).first().click();
    await heading(record.name);
    const target = records[1].stories[0], targetURL = routeFor('operator-records', records[1], target);
    await page.locator(`.story-title[href="${targetURL}"]`).click();
    await heading(target.title);
    assert.deepEqual(await page.locator('#breadcrumbs a').allTextContents(), ['Inicio', 'Archivos de operador', record.name]);
    assert.equal(await page.locator('.back-link').getAttribute('href'), routeFor('operator-records', record));
    await page.reload(); await heading(target.title);
    await page.locator('.back-link').click(); await heading(record.name);
    await page.goBack(); await heading(target.title);
    await page.goForward(); await heading(record.name);
    await mark(records[1]).click(); await assertRead(records[1], false);
    await assertRead(records[0], true);

    // Module read state and artwork remain individual within the combined page.
    await go(routeFor('operator-modules', module), module.name);
    await assertRead(module.groups[0], true); await assertRead(module.groups[1], false);
    await mark(module.groups[1]).click(); await assertRead(module.groups[1], true);
    const afterModule = await stored();
    assert.deepEqual(afterModule.groups[groupKey(records[0])], seed.groups[groupKey(records[0])]);
    assert.equal(afterModule.groups[groupKey(records[1])]?.stories[records[1].stories[0].id]?.read ?? false, false);
    assert.ok(Object.keys(afterModule.groups).every((saved) => catalog.groups.some((g) => groupKey(g) === saved)), 'no synthetic operator save groups');
    await page.locator('#language').selectOption('en');
    assert.equal(await mark(module.groups[1]).innerText(), 'Mark as unread');
    assert.match(await page.locator('#breadcrumbs').innerText(), /Operator Modules/);
    await page.waitForFunction(() => [...document.querySelectorAll('.story-cover')].every((cover) => {
      const image = cover.querySelector('.has-art img');
      return image?.complete && image.naturalWidth > 0;
    }), undefined, { timeout: 30000 });
    await page.screenshot({ path: path.join(output, 'operator-modules.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'operator-modules-mobile.png'), fullPage: true });
    await page.locator('#language').selectOption('es');
    await mark(module.groups[1]).click(); await assertRead(module.groups[1], false);
    await go(routeFor('operator-records', record), record.name);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'operator-records-mobile.png'), fullPage: true });
    const amiya = operatorsFor(catalog, 'operator-modules').find((o) => o.name === 'Amiya');
    await go(routeFor('operator-modules', amiya), amiya.name);
    assert.equal(await page.locator('.story-row').count(), 3, 'all three Amiya classes share one operator page');
    assert.deepEqual(errors, []);
    console.log('Operator indexes, lists, search, old links/saves, independent read state, history, localization, and mobile layout passed.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
