// Browser integration for catalog routes, grouped saves, and the three new stories.
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
  const { storyOverrides } = await import(pathToFileURL(path.join(root, 'vn/story-overrides.mjs')));
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const { routeFor, groupKey } = await import(pathToFileURL(path.join(root, 'vn/catalog.mjs')));
  const scenes = [];
  for (const [id, config] of Object.entries(storyOverrides)) {
    const group = catalog.groups.find((g) => g.stories.some((s) => s.id === id));
    const story = group.stories.find((s) => s.id === id);
    const es = parseScript(await fs.readFile(path.join(root, `gamedata/es_ES/story/${id}.txt`), 'utf8'));
    const en = parseScript(await fs.readFile(path.resolve(root, 'vn', story.source.languages.en), 'utf8'));
    const answers = Object.fromEntries(es.filter((s) => s.command === 'decision').map((s) => [s.line, s.args.values.split(';')[0]]));
    scenes.push({ group, story, config, route: routeFor(group.category, group, story), es, en, answers, steps: buildTimeline(es, answers) });
  }
  const [first, second, chapter1, ursus] = scenes;
  const legacy = { v: 1, preferences: { language: 'es', speed: 0, motion: true, nickname: 'Test' }, stories: {
    [first.story.id]: { line: first.steps[10].line, answers: first.answers, read: false, updated: 1000 },
  } };
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    await context.addInitScript((old) => {
      if (!localStorage.getItem('arknights.vn.v1')) localStorage.setItem('arknights.vn.v1', JSON.stringify(old));
      const NativeAudio = window.Audio;
      window.__vnAudio = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__vnAudio.push(audio); return audio; };
    }, legacy);
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')));
    const go = async (hash) => {
      await page.evaluate((next) => { location.hash = next; }, hash);
      await page.waitForFunction((next) => location.hash === next, hash);
    };
    const cover = async (scene) => {
      await go(scene.route);
      await page.waitForFunction((id) => document.querySelector('#player').dataset.story === id && !document.querySelector('#begin').disabled, scene.story.id);
    };
    const start = async (scene) => {
      await cover(scene); await page.locator('#begin').click();
      await page.waitForFunction((id) => document.querySelector('#stage').dataset.story === id, scene.story.id);
    };
    const advance = async () => {
      const line = await page.locator('#stage').getAttribute('data-line');
      if (await page.locator('#choices button').count()) await page.locator('#choices button').first().click();
      else await page.locator('#next').click();
      await page.waitForFunction((previous) => document.querySelector('#stage').dataset.line !== previous, line);
    };
    const library = async (hash) => {
      await go(hash); await page.locator('#library:visible').waitFor();
      await page.waitForFunction(() => document.querySelector('#player').dataset.story === '');
    };
    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('.category-card').count(), 6);
    assert.equal(await page.locator('.resume-link').count(), 1);
    assert.equal((await saved()).groups[groupKey(first.group)].stories[first.story.id].line, first.steps[10].line);
    await page.screenshot({ path: path.join(output, 'library.png'), fullPage: true });
    const migrated = JSON.stringify(await saved());
    for (const category of catalog.categories) {
      await page.locator(`.category-card[href="${routeFor(category)}"]`).click();
      await page.locator('.catalog-filters').waitFor();
      assert.equal(await page.locator('.collection-card').count(), catalog.groups.filter((g) => g.category === category.id).length);
      if (category.id === 'main') {
        await page.screenshot({ path: path.join(output, 'chapters.png'), fullPage: true });
        await page.locator('.catalog-filters input[type="checkbox"]').check();
        assert.equal(await page.locator('.collection-card').count(), catalog.groups.filter((g) => g.category === 'main' && g.stories.some((s) => s.vn)).length);
        await page.locator('.catalog-filters input[type="checkbox"]').uncheck();
      }
      if (category.id === 'vignettes') {
        await page.locator('input[type="search"]').fill('children of ursus');
        assert.equal(await page.locator('.collection-card').count(), 1);
      }
      await library('#/'); await page.locator('.category-card').first().waitFor();
    }
    // Browsing collections or opening a cover never steals the chapter's resume.
    await library(routeFor(first.group.category, first.group));
    await page.locator('.story-row').first().waitFor();
    assert.equal(await page.locator('.story-row').count(), first.group.stories.length);
    assert.equal(await page.locator('.story-open').count(), first.group.stories.filter((s) => s.vn).length);
    assert.match(await page.locator('.library-heading p').innerText(), /0\/14/);
    await page.screenshot({ path: path.join(output, 'chapter-stories.png'), fullPage: true });
    await cover(second);
    await library('#/');
    assert.equal(JSON.stringify(await saved()), migrated);
    await start(first);
    assert.equal(Number(await page.locator('#stage').getAttribute('data-line')), first.steps[10].line);
    await advance();
    const firstPosition = Number(await page.locator('#stage').getAttribute('data-line'));
    // Actual selector navigation, sibling links, and one independent position per group.
    await page.locator('#story-select').selectOption(second.route);
    await page.waitForFunction((id) => document.querySelector('#player').dataset.story === id && !document.querySelector('#begin').disabled, second.story.id);
    assert.equal(await page.locator('#previous-story').getAttribute('href'), first.route);
    await page.locator('#begin').click();
    for (let i = 0; i < 8; i++) await advance();
    const secondPosition = Number(await page.locator('#stage').getAttribute('data-line'));
    await start(chapter1);
    for (let i = 0; i < 5; i++) await advance();
    const chapterPosition = Number(await page.locator('#stage').getAttribute('data-line'));
    await start(ursus);
    for (let i = 0; i < 12; i++) await advance();
    const ursusPosition = Number(await page.locator('#stage').getAttribute('data-line'));
    await page.reload();
    await page.locator('#begin:not(:disabled)').click();
    assert.equal(Number(await page.locator('#stage').getAttribute('data-line')), ursusPosition);
    await library('#/'); await page.locator('.resume-link').first().waitFor();
    assert.equal(await page.locator('.resume-link').count(), 3);
    const independent = await saved();
    assert.equal(independent.groups[groupKey(first.group)].resume, second.story.id);
    for (const [scene, position] of [[first, firstPosition], [second, secondPosition], [chapter1, chapterPosition], [ursus, ursusPosition]]) {
      assert.equal(independent.groups[groupKey(scene.group)].stories[scene.story.id].line, position);
    }
    await page.goBack();
    await page.locator('#begin:not(:disabled)').click();
    assert.equal(Number(await page.locator('#stage').getAttribute('data-line')), ursusPosition);
    await page.goForward(); await page.locator('.category-card').first().waitFor();
    // Complete each newly migrated script. Compare every displayed line and choice.
    const images = new Set();
    let lines = 0;
    for (const scene of scenes.slice(1)) {
      await start(scene);
      await page.locator('#settings').click(); await page.locator('#restart').click();
      let switched = false, screenshot = false;
      for (const step of scene.steps) {
        await page.waitForFunction((line) => Number(document.querySelector('#stage').dataset.line) === line, step.line);
        if (step.kind === 'dialogue') {
          assert.equal(await page.locator('#text').innerText(), step.text.replaceAll('{@nickname}', 'Test'), `${scene.config.slug}:${step.line}`);
          lines++;
        } else if (step.kind === 'choice') assert.deepEqual(await page.locator('#choices button').allTextContents(), step.options.map((o) => o.text.replaceAll('{@nickname}', 'Test')));
        if (!switched && step.kind === 'dialogue' && step.line > scene.steps[5].line) {
          await page.locator('#language').selectOption('en');
          assert.equal(await page.locator('#text').innerText(), scene.en.find((s) => s.line === step.line).text.replaceAll('{@nickname}', 'Test'));
          await page.locator('#language').selectOption('es'); switched = true;
        }
        const newImages = await page.locator('.scene img').evaluateAll((nodes) => nodes.map((img) => img.src));
        if (newImages.some((url) => !images.has(url))) {
          await page.waitForFunction(() => [...document.querySelectorAll('.scene img')].every((img) => img.complete && img.naturalWidth > 0 && !img.hidden), null, { timeout: 45000 });
          (await page.locator('.scene img').evaluateAll((nodes) => nodes.map((img) => img.src))).forEach((url) => images.add(url));
        }
        if (!screenshot && step.state.characters.length >= 2 && step.kind === 'dialogue') {
          await page.screenshot({ path: path.join(output, scene.config.slug + '.png') }); screenshot = true;
        }
        if (step.kind !== 'end') await advance();
      }
      assert.equal(await page.locator('#ending').isVisible(), true);
      assert.equal((await saved()).groups[groupKey(scene.group)].stories[scene.story.id].read, true);
      const following = scene.group.stories[scene.group.stories.indexOf(scene.story) + 1];
      assert.equal(await page.locator('#ending-next').getAttribute('href'), following.vn ? routeFor(scene.group.category, scene.group, following) : '../' + following.classicHash);
      console.log(`Completed ${scene.config.slug}: ${scene.steps.filter((s) => s.kind === 'dialogue').length} dialogue lines.`);
    }
    // Restart affects only this story; it does not clear other chapters or siblings.
    await page.locator('#replay').click();
    const restarted = await saved();
    assert.equal(restarted.groups[groupKey(ursus.group)].stories[ursus.story.id].read, false);
    assert.equal(restarted.groups[groupKey(first.group)].stories[second.story.id].read, true);
    assert.equal(restarted.groups[groupKey(first.group)].stories[first.story.id].line, firstPosition);
    assert.equal(restarted.groups[groupKey(chapter1.group)].stories[chapter1.story.id].read, true);
    // Aborted loads cannot replace the route selected while their response is pending.
    await library('#/');
    let release, seen;
    const held = new Promise((resolve) => { release = resolve; });
    const requested = new Promise((resolve) => { seen = resolve; });
    const pattern = '**/sources/en/obt/guide/beg/2_guide_to_home.txt';
    await page.route(pattern, async (request) => { seen(); await held; await request.continue().catch(() => {}); });
    await go(second.route); await requested;
    await start(chapter1); release(); await page.unroute(pattern);
    assert.equal(await page.locator('#stage').getAttribute('data-story'), chapter1.story.id);
    // Leaving an animated scene also stops sound, auto mode, and all running effects.
    await page.locator('#settings').click(); await page.locator('#motion').uncheck();
    await page.locator('#restart').click(); await page.locator('#next').click();
    await page.locator('#sound').click(); await page.locator('#auto').click();
    const unavailable = chapter1.group.stories.find((s) => !s.vn);
    await library(routeFor(chapter1.group.category, chapter1.group, unavailable));
    await page.locator('.back-link').waitFor();
    assert.equal(await page.locator('#player').isVisible(), false);
    assert.equal(await page.locator('.collection-resume').getAttribute('href'), '../' + unavailable.classicHash);
    assert.equal(await page.evaluate(() => window.__vnAudio.every((a) => a.paused && !a.getAttribute('src'))), true);
    assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
    await library('#/main/not-a-chapter'); await page.locator('.back-link').waitFor();
    assert.match(await page.locator('.library-heading h2').innerText(), /No encontramos/);
    // A phone can browse the catalog and read the longest translated line without clipping.
    await page.setViewportSize({ width: 390, height: 844 });
    await library('#/'); await page.locator('.category-card').first().waitFor();
    await page.screenshot({ path: path.join(output, 'mobile-library.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const longest = ursus.steps.filter((s) => s.kind === 'dialogue').sort((a, b) => b.text.length - a.text.length)[0];
    await page.evaluate(({ key, id, line }) => {
      const data = JSON.parse(localStorage.getItem('arknights.vn.v2'));
      data.preferences.motion = true;
      data.groups[key].stories[id].line = line;
      localStorage.setItem('arknights.vn.v2', JSON.stringify(data));
    }, { key: groupKey(ursus.group), id: ursus.story.id, line: longest.line });
    await page.goto(base + ursus.route); await page.locator('#begin:not(:disabled)').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.scene img')].every((img) => img.complete && img.naturalWidth > 0));
    await page.screenshot({ path: path.join(output, 'mobile-ursus.png'), fullPage: true });
    assert.equal(await page.locator('#text').innerText(), longest.text.replaceAll('{@nickname}', 'Test'));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const text = await page.locator('#text').boundingBox(), stage = await page.locator('#stage').boundingBox();
    assert.ok(text.y >= stage.y && text.y + text.height <= stage.y + stage.height);
    assert.equal(await page.evaluate(() => localStorage.getItem('arknights.vn.v1')), JSON.stringify(legacy));
    assert.deepEqual(errors, []);
    console.log(`Navigation passed: six catalogs, all chapter lists, grouped resume/migration, back/forward, cancellation, mobile, ${lines} new dialogue lines and ${images.size} images.`);
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
