// IS topic navigation, combined stories, and independent collection saves.
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
  const { routeFor, groupKey, topicsFor } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const category = catalog.categories.find((c) => c.id === 'integrated-strategies');
  const topics = topicsFor(catalog), topic = topics.find((t) => t.id === 'rogue_1');
  const [main, squad, otherSquad] = topic.groups;
  const anotherTopic = topics.find((t) => t.id === 'rogue_2').groups[0];
  const total = topic.groups.reduce((n, g) => n + g.stories.length, 0);
  const key = 'arknights.vn.v2';
  const seed = { v: 2, preferences: { language: 'es', speed: 0, motion: true }, groups: {
    [groupKey(main)]: { resume: null, updated: 0, stories: { [main.stories[0].id]: { read: true } } },
    [groupKey(squad)]: { resume: null, updated: 0, stories: { [squad.stories[0].id]: { read: true } } },
    [groupKey(anotherTopic)]: { resume: null, updated: 0, stories: { [anotherTopic.stories[0].id]: { read: true } } },
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
    const go = async (hash, title) => { await page.goto(base + hash); await heading(title); };
    const assertRead = async (g, read) => assert.equal(await mark(g).innerText(), read ? 'Marcar como no leída' : 'Marcar como leída');

    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    const categoryCard = page.locator(`.category-card[href="${routeFor(category)}"]`);
    assert.match(await categoryCard.locator('p').innerText(), /^6 temas/);
    await categoryCard.click(); await heading(category.name.es);
    assert.deepEqual(await page.locator('.collection-title').allTextContents(), topics.map((t) => t.name));
    const card = page.locator('.collection-card').filter({ has: page.locator(`.collection-title[href="${routeFor(category, topic)}"]`) });
    assert.match(await card.locator('.collection-stats').innerText(), new RegExp(`^2/${total} `));
    assert.equal(await card.locator('progress').getAttribute('value'), '2');
    await page.locator('input[type="search"]').fill('fellowship of the sarkaz');
    assert.deepEqual(await page.locator('.collection-title').allTextContents(), [topic.name]);
    await page.locator('input[type="search"]').fill(main.stories[1].title);
    assert.ok((await page.locator('.collection-title').allTextContents()).includes(topic.name));
    await page.locator('input[type="search"]').fill('no such topic');
    assert.equal(await page.locator('.collection-card').count(), 0);
    await page.locator('input[type="search"]').fill('');
    await page.locator('.catalog-filters input[type="checkbox"]').check();
    assert.equal(await page.locator('.collection-card').count(), 0, 'no IS stories are currently enabled in VN');
    await page.locator('.catalog-filters input[type="checkbox"]').uncheck();
    await page.locator('.collection-card').first().locator('.collection-art.has-art img').waitFor();
    await page.screenshot({ path: path.join(output, 'is-topics.png') });
    await card.locator('.collection-title').click(); await heading(topic.name);
    assert.equal(await page.locator('.story-row').count(), total);
    assert.deepEqual(await page.locator('.story-section-heading').evaluateAll((headings) => headings.map((h) => h.dataset.group)), topic.groups.map((g) => g.id));
    assert.equal(await page.locator('.story-section-heading').first().innerText(), 'Inicio y finales');
    assert.deepEqual(await page.locator('.story-title').allTextContents(), topic.groups.flatMap((g) => g.stories.map((s) => s.title)));
    assert.deepEqual(await page.locator('#breadcrumbs a').allTextContents(), ['Inicio', category.name.es, topic.name]);
    for (const g of topic.groups) for (const s of g.stories) {
      const row = page.locator('.story-row').filter({ has: page.locator(`.story-title[href="${routeFor(category, g, s)}"]`) });
      assert.equal(await row.locator('.classic-link').getAttribute('href'), '../' + s.classicHash);
    }
    await assertRead(main, true); await assertRead(squad, true); await assertRead(otherSquad, false);
    assert.deepEqual(await stored(), seed, 'browsing topics does not rewrite existing saves');

    await mark(otherSquad).click(); await assertRead(otherSquad, true);
    assert.equal(await mark(otherSquad).evaluate((button) => document.activeElement === button), true);
    assert.match(await page.locator('.library-heading p').innerText(), new RegExp(`^3/${total} `));
    const saved = await stored();
    for (const g of [main, squad, anotherTopic]) assert.deepEqual(saved.groups[groupKey(g)], seed.groups[groupKey(g)]);
    assert.deepEqual(saved.groups[groupKey(otherSquad)].stories[otherSquad.stories[0].id], { read: true });
    assert.deepEqual(Object.keys(saved.groups).sort(), [...Object.keys(seed.groups), groupKey(otherSquad)].sort());
    await page.reload(); await heading(topic.name); await assertRead(otherSquad, true);
    await page.locator(`.story-section-heading[data-group="${otherSquad.id}"] a`).click();
    await heading(otherSquad.title);
    assert.equal(await page.locator('.story-row').count(), otherSquad.stories.length);
    await assertRead(otherSquad, true);
    await page.locator(`#breadcrumbs a[href="${routeFor(category, topic)}"]`).click(); await heading(topic.name);

    const story = otherSquad.stories[0], target = routeFor(category, otherSquad, story);
    await page.locator(`.story-title[href="${target}"]`).click(); await heading(story.title);
    assert.deepEqual(await page.locator('#breadcrumbs a').allTextContents(), ['Inicio', category.name.es, topic.name, otherSquad.title]);
    assert.equal(await page.locator('.back-link').getAttribute('href'), routeFor(category, topic));
    await page.reload(); await heading(story.title);
    await page.locator('.back-link').click(); await heading(topic.name);
    await page.goBack(); await heading(story.title);
    await page.goForward(); await heading(topic.name);
    await mark(otherSquad).click(); await assertRead(otherSquad, false);
    await assertRead(squad, true); await assertRead(main, true);

    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('.story-section-heading').first().innerText(), 'Entry & endings');
    assert.equal(await mark(otherSquad).innerText(), 'Mark as read');
    await page.locator('.library-heading .collection-art.has-art img').waitFor({ timeout: 30000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(output, 'is-topic-stories.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'is-topic-stories-mobile.png') });
    await go(routeFor(category), category.name.en);
    assert.equal(await page.locator('.collection-card').count(), topics.length);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('.collection-card').first().locator('.collection-art.has-art img').waitFor();
    await page.screenshot({ path: path.join(output, 'is-topics-mobile.png') });
    await go(routeFor(category, topics[0]), topics[0].name);
    assert.equal(await page.locator('.story-row').count(), topics[0].groups[0].stories.length, 'Ceobe has no squads');

    // An existing translated script stands in for a future playable IS scene.
    // This exercises aggregated availability/resume and the player's return link.
    const playable = structuredClone(catalog);
    const futureStory = playable.groups.find((g) => g.id === otherSquad.id).stories[0];
    Object.assign(futureStory, { vn: true, spanish: true, source: catalog.groups.find((g) => g.id === 'main_0').stories[0].source });
    await page.route('**/data/catalog.json', (route) => route.fulfill({ json: playable }));
    await page.goto(base + routeFor(category)); await page.reload(); await heading(category.name.en);
    await page.locator('.catalog-filters input[type="checkbox"]').check();
    assert.deepEqual(await page.locator('.collection-title').allTextContents(), [topic.name]);
    await card.locator('.collection-title').click(); await heading(topic.name);
    await mark(otherSquad).click();
    await page.locator(`.story-title[href="${target}"]`).click();
    await page.locator('#ending:visible').waitFor();
    assert.equal(await page.locator('#ending-collection').getAttribute('href'), routeFor(category, topic));
    assert.equal(await page.locator('#ending-collection').innerText(), 'Back to topic');
    await page.locator('#ending-collection').click(); await heading(topic.name);
    await mark(otherSquad).click();
    await page.locator(`.story-title[href="${target}"]`).click();
    await page.locator('#begin:not(:disabled)').click(); await page.locator('#dialogue:visible').waitFor();
    await page.locator('#next').click();
    await go(routeFor(category, topic), topic.name);
    assert.equal(await page.locator('.collection-resume').getAttribute('href'), target);
    await go('#/', 'Find your next story.');
    assert.equal(await page.locator('.resume-link').getAttribute('href'), target);
    assert.deepEqual(errors, []);
    console.log('IS topics passed: counts, search, grouped story order, old links/saves, independent read state, history, localization, mobile, and future VN resume/return links.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });

