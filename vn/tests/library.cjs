// Library resume selection and manual read status, including existing bookmarks.
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
  const { routeFor, groupKey } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const main = catalog.groups.find((g) => g.id === 'main_0'), story = main.stories[0];
  const commands = parseScript(await fs.readFile(path.resolve(root, 'vn', story.source.languages.es), 'utf8'));
  const answers = Object.fromEntries(commands.filter((command) => command.command === 'decision').map((command) => [command.line, command.args.values.split(';')[0]]));
  const dialogue = buildTimeline(commands, answers).filter((step) => step.kind === 'dialogue');
  const halfway = dialogue[Math.floor(dialogue.length / 2)].line;
  const chapter1 = catalog.groups.find((g) => g.id === 'main_1');
  const vignettes = catalog.groups.filter((g) => g.category === 'vignettes' && g.stories.some((s) => s.vn));
  const classicGroup = catalog.groups.find((g) => g.stories.every((s) => !s.vn)), classicStory = classicGroup.stories[0];
  const key = 'arknights.vn.v2';
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    await context.addInitScript((key) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ v: 2, groups: {}, preferences: { language: 'es', speed: 0, motion: true } }));
    }, key);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const mark = (target = story, tab = page) => tab.locator(`.story-mark-read[data-story="${target.id}"]`);
    const go = async (hash) => {
      await page.evaluate((hash) => { location.hash = hash; }, hash);
      await page.waitForFunction((hash) => location.hash === hash && !document.querySelector('#library').hidden, hash);
    };
    const collection = async (group) => {
      await go(routeFor(group.category, group));
      await page.locator(`.story-mark-read[data-story="${group.stories[0].id}"]`).waitFor();
    };
    const noResume = async () => {
      await collection(main);
      assert.equal(await page.locator('.collection-resume').count(), 0);
      await go(routeFor(main.category)); await page.locator('.catalog-filters').waitFor();
      const card = page.locator('.collection-card').filter({ has: page.locator(`.collection-title[href="${routeFor(main.category, main)}"]`) });
      assert.equal(await card.locator('.resume-link').count(), 0);
      await go('#/'); await page.locator('.category-card').first().waitFor();
      assert.equal(await page.locator('.resume-grid').count(), 0);
      await collection(main);
    };
    const start = async (kind = 'dialogue') => {
      await page.evaluate((hash) => { location.hash = hash; }, routeFor(main.category, main, story));
      if (kind !== 'end') await page.locator('#begin:not(:disabled)').click();
      await page.locator(kind === 'end' ? '#ending:visible' : '#dialogue:visible').waitFor();
    };
    const advance = async () => {
      const line = await page.locator('#stage').getAttribute('data-line');
      if (await page.locator('#choices button').count()) await page.locator('#choices button').first().click();
      else await page.locator('#next').click();
      await page.waitForFunction((line) => document.querySelector('#stage').dataset.line !== line && document.querySelector('#stage').getAttribute('aria-busy') === 'false', line);
    };
    await page.goto(base + routeFor(main.category, main));
    await mark().waitFor();
    assert.equal(await page.locator('.story-mark-read').count(), main.stories.length);
    assert.equal(await mark().innerText(), 'Marcar como leída');
    await mark().click();
    assert.equal(await mark().innerText(), 'Marcar como no leída');
    assert.equal(await mark().evaluate((button) => document.activeElement === button), true);
    assert.match(await page.locator('.library-heading p').innerText(), /^1\/14/);
    assert.deepEqual((await stored()).groups[groupKey(main)].stories[story.id], { read: true });
    assert.equal((await stored()).groups[groupKey(main)].resume, null);
    await page.reload(); await mark().waitFor();
    assert.equal(await mark().innerText(), 'Marcar como no leída');
    await go('#/'); await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('.resume-link').count(), 0, 'marking read must not create a bookmark');

    // A marked story opens its ending, including reload/language switches, without fabricated choices.
    await collection(main); await page.locator('.story-title').first().click();
    await page.locator('#ending:visible').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#cover').isVisible(), false);
    assert.equal(await page.locator('#begin').evaluate((button) => button.hidden), true);
    assert.equal(await page.locator('#begin').isVisible(), false);
    assert.equal(await page.locator('#ending [data-i18n="endText"]').innerText(), 'Llegaste al final de esta historia.');
    assert.equal(await page.locator('#progress').getAttribute('value'), '100');
    assert.equal(await page.locator('#history').isDisabled(), true);
    await page.keyboard.press('h');
    assert.equal(await page.locator('#history-dialog').isVisible(), false);
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#ending').isVisible(), true);
    await page.locator('#language').selectOption('es');
    await page.reload(); await page.locator('#ending:visible').waitFor();
    assert.deepEqual((await stored()).groups[groupKey(main)].stories[story.id], { read: true });
    await page.locator('#replay').click(); await page.locator('#dialogue:visible').waitFor();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '3');
    await advance();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, false);

    // Reproduce halfway -> mark read -> ending -> mark unread -> beginning.
    for (let count = 0; Number(await page.locator('#stage').getAttribute('data-line')) !== halfway; count++) {
      assert.ok(count < dialogue.length, 'could not reach the middle of the story');
      await advance();
    }
    await collection(main);
    const before = (await stored()).groups[groupKey(main)];
    assert.ok(Object.keys(before.stories[story.id].answers).length > 0);
    const timestamp = before.stories[story.id].updated;
    assert.equal(await page.locator('.collection-resume').getAttribute('href'), routeFor(main.category, main, story));
    await mark().click();
    assert.deepEqual((await stored()).groups[groupKey(main)], { ...before, stories: { ...before.stories, [story.id]: { read: true, updated: timestamp } } });
    assert.equal(await page.locator('.collection-resume').count(), 0, 'manual completion removes the link immediately');
    await noResume();
    await start('end');
    assert.equal(await page.locator('#begin').evaluate((button) => button.hidden), true);
    assert.equal(await page.locator('#progress').getAttribute('value'), '100');
    assert.deepEqual((await stored()).groups[groupKey(main)].stories[story.id], { read: true, updated: timestamp });
    await collection(main); await mark().click();
    assert.deepEqual((await stored()).groups[groupKey(main)].stories[story.id], { read: false, updated: timestamp });
    assert.match(await page.locator('.story-row').first().innerText(), /Sin empezar/);
    await noResume();
    await page.locator('.story-title').first().click();
    await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#begin').innerText(), 'Comenzar lectura →');
    await collection(main);
    await mark(main.stories[1]).click();
    assert.equal((await stored()).groups[groupKey(main)].resume, story.id);
    await mark(main.stories[1]).click();
    assert.equal((await stored()).groups[groupKey(main)].stories[main.stories[1].id], undefined);
    await page.screenshot({ path: path.join(output, 'story-read-actions.png'), fullPage: true });

    // A reader open in another tab must not overwrite manual completion changes.
    await start();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '3');
    assert.deepEqual((await stored()).groups[groupKey(main)].stories[story.id].answers, {});
    await advance();
    await page.evaluate(() => { window.__statusEvents = 0; addEventListener('storage', () => window.__statusEvents++); });
    const other = await context.newPage();
    other.on('pageerror', (error) => errors.push(error.message));
    await other.goto(base + routeFor(main.category, main));
    await mark(story, other).click();
    await page.waitForFunction(() => window.__statusEvents > 0);
    await page.locator('#ending:visible').waitFor();
    assert.equal(await page.locator('#begin').evaluate((button) => button.hidden), true);
    await page.bringToFront();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, true);
    await page.evaluate(() => { window.__statusEvents = 0; });
    await other.bringToFront(); await mark(story, other).click();
    await page.waitForFunction(() => window.__statusEvents > 0);
    await page.locator('#dialogue:visible').waitFor();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), '3');
    await page.bringToFront(); await advance();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, false);
    await other.close();

    // Older saves could contain "read" and a first/middle position. Completion
    // must win on entry, including after the source structure has changed.
    for (const structure of [story.source.structure, '0'.repeat(64)]) {
      await collection(main);
      await page.evaluate(({ key, groupKey, storyId, structure }) => {
        const data = JSON.parse(localStorage.getItem(key));
        data.groups[groupKey].stories[storyId] = { line: 3, answers: {}, read: true, structure, updated: 100 };
        localStorage.setItem(key, JSON.stringify(data));
      }, { key, groupKey: groupKey(main), storyId: story.id, structure });
      await page.locator('.story-title').first().click(); await page.locator('#ending:visible').waitFor();
      assert.equal(await page.locator('#cover').isVisible(), false);
      await page.reload(); await page.locator('#ending:visible').waitFor();
      assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, true);
    }

    // A complete branch keeps its history. Re-entering dialogue, advancing or
    // choosing a history line must remove completion until the ending is reached again.
    await collection(main);
    await page.evaluate(({ key, groupKey, storyId, answers, line, structure }) => {
      const data = JSON.parse(localStorage.getItem(key));
      data.groups[groupKey].stories[storyId] = { line, answers, read: true, structure, updated: 100 };
      localStorage.setItem(key, JSON.stringify(data));
    }, { key, groupKey: groupKey(main), storyId: story.id, answers, line: halfway, structure: story.source.structure });
    await page.locator('.story-title').first().click(); await page.locator('#ending:visible').waitFor();
    await page.locator('#back').click(); await page.locator('#back').click(); await advance();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, false);
    const rereadingLine = await page.locator('#stage').getAttribute('data-line');
    await collection(main);
    assert.equal(await mark().innerText(), 'Marcar como leída');
    assert.match(await page.locator('.story-row').first().innerText(), /En curso/);
    assert.equal(await page.locator('.collection-resume').getAttribute('href'), routeFor(main.category, main, story));
    await start();
    assert.equal(await page.locator('#stage').getAttribute('data-line'), rereadingLine);
    await advance(); await page.locator('#ending:visible').waitFor();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, true);
    assert.equal(await page.locator('#begin').evaluate((button) => button.hidden), true);
    await noResume();
    await page.reload(); await mark().waitFor();
    assert.equal(await page.locator('.collection-resume').count(), 0, 'natural completion stays excluded after reload');
    await start('end');
    await page.locator('#history').click(); await page.locator('.history-line').first().click(); await advance();
    assert.equal((await stored()).groups[groupKey(main)].stories[story.id].read, false);

    // Classic-only stories have the same action, including a keyboard undo on mobile.
    await collection(classicGroup); await mark(classicStory).click();
    await page.reload(); await mark(classicStory).waitFor();
    assert.equal((await stored()).groups[groupKey(classicGroup)].stories[classicStory.id].read, true);
    assert.equal((await stored()).groups[groupKey(classicGroup)].resume, null);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok((await mark(classicStory).boundingBox()).height >= 44);
    await page.screenshot({ path: path.join(output, 'story-read-actions-mobile.png'), fullPage: true });
    await mark(classicStory).press('Enter');
    assert.equal((await stored()).groups[groupKey(classicGroup)], undefined);
    await page.locator('#language').selectOption('en');
    assert.equal(await mark(classicStory).innerText(), 'Mark as read');
    await page.locator('#language').selectOption('es');

    // Four saved collections produce two cards, retaining every independent save.
    const groups = [main, chapter1, ...vignettes.slice(0, 2)];
    const timestamps = [100, 300, 200, 400];
    const fixtures = Object.fromEntries(groups.map((g, i) => [groupKey(g), {
      resume: g.stories[0].id, updated: timestamps[i], stories: { [g.stories[0].id]: { line: 3, answers: {}, read: false, updated: timestamps[i] } },
    }]));
    await page.evaluate(({ key, groups }) => {
      const saved = JSON.parse(localStorage.getItem(key)); saved.groups = groups; localStorage.setItem(key, JSON.stringify(saved));
    }, { key, groups: fixtures });
    await go('#/'); await page.locator('.category-card').first().waitFor();
    const latestLinks = [groups[3], chapter1].map((g) => routeFor(g.category, g, g.stories[0]));
    const resumes = () => page.locator('.resume-grid .resume-link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    assert.deepEqual(await resumes(), latestLinks);
    assert.deepEqual(await page.locator('.resume-grid .eyebrow').allTextContents(), ['Viñetas', 'Historia principal']);
    await page.screenshot({ path: path.join(output, 'recent-sections-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(output, 'recent-sections.png'), fullPage: true });
    await collection(main); await mark(main.stories[1]).click();
    await go('#/'); await page.locator('.category-card').first().waitFor();
    assert.deepEqual(await resumes(), latestLinks);
    assert.equal(Object.keys((await stored()).groups).length, 4);

    await collection(chapter1); await mark(chapter1.stories[0]).click();
    assert.equal(await page.locator('.collection-resume').count(), 0);
    await go('#/'); await page.locator('.category-card').first().waitFor();
    assert.deepEqual(await resumes(), [latestLinks[0], routeFor(main.category, main, story)], 'show the last unfinished chapter instead of the completed one');

    // A denied write is visible and retains the action in memory for this tab.
    await collection(main);
    const bytes = await stored();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Quota'); }; });
    await mark().click();
    assert.match(await page.locator('.library-status').innerText(), /No se pudo guardar/);
    assert.equal(await mark().innerText(), 'Marcar como no leída');
    assert.deepEqual(await stored(), bytes);
    assert.deepEqual(errors, []);
    console.log('Library passed: completed/reset stories have no resume links/buttons, direct ending entry, legacy read saves, rereading, read/unread resets, reload, cross-tab resets, latest unfinished resume per section, mobile/keyboard actions and storage errors.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
