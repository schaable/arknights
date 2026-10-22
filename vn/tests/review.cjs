// Translation review integration, including interoperability with the classic UI.
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
  if (name === '/classic-review-fixture') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><meta charset="utf-8"><div id="ccselector"></div><div id="classic-box"></div><script src="/arknights/js/story-review.js"></script>');
    return;
  }
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
  const { reviewContext, reviewId, REVIEW_KEY, exportReviews } = await import(pathToFileURL(path.join(root, 'vn/review-data.mjs')));
  const group = catalog.groups.find((g) => g.id === 'main_0'), story = group.stories[0];
  const es = await fs.readFile(path.resolve(root, 'vn', story.source.languages.es), 'utf8');
  const en = await fs.readFile(path.resolve(root, 'vn', story.source.languages.en), 'utf8');
  const commands = parseScript(es), english = parseScript(en);
  const answers = Object.fromEntries(commands.filter((c) => c.command === 'decision').map((c) => [c.line, c.args.values.split(';')[0]]));
  const steps = buildTimeline(commands, answers), sample = steps.find((s) => s.kind === 'dialogue' && s.text.includes('{@nickname}'));
  const seed = { ...reviewContext({ story, step: sample, sources: { es, en }, sourceUrl: 'https://example.test/classic-original.txt' }), comment: 'Classic note', proposal: '' };
  const other = { ...seed, id: reviewId('other/story', 'free', [10]), story: { key: 'other/story', name: 'Other story' }, lines: [10], comment: 'Keep me' };
  const progressKey = 'arknights.vn.v2', groupKey = 'main:main_0';
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, ignoreHTTPSErrors: true });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(({ progressKey, reviewKey, seed, other, sample, answers, groupKey, story }) => {
      if (!localStorage.getItem(progressKey)) {
        localStorage.setItem(progressKey, JSON.stringify({ v: 2, preferences: { language: 'es', nickname: 'Test Doctor', speed: 0, motion: true },
          groups: { [groupKey]: { resume: story.id, stories: { [story.id]: { line: sample.line, answers, structure: story.source.structure } } } } }));
        localStorage.setItem(reviewKey, JSON.stringify([seed, other]));
      }
      const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
      window.__reviewStorageFailure = '';
      Storage.prototype.getItem = function (key) { if (key === reviewKey && window.__reviewStorageFailure === 'read') throw new Error('Storage denied'); return get.call(this, key); };
      Storage.prototype.setItem = function (key, value) { if (key === reviewKey && window.__reviewStorageFailure === 'write') throw new Error('Quota exceeded'); return set.call(this, key, value); };
      const NativeAudio = window.Audio;
      window.__vnAudio = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__vnAudio.push(audio); return audio; };
    }, { progressKey, reviewKey: REVIEW_KEY, seed, other, sample, answers, groupKey, story });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const base = origin + '/arknights/vn/', url = base + '#/main/chapter-0/prologue-1';
    const display = (text) => text.replace(/\{@nickname\}/gi, 'Test Doctor');
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), REVIEW_KEY);
    const progress = () => page.evaluate((key) => localStorage.getItem(key), progressKey);
    const line = () => page.locator('#stage').getAttribute('data-line');
    const open = async () => { await page.goto(url); await page.locator('#begin:not(:disabled)').click(); await page.locator('#review-controls:visible').waitFor(); };
    await open();
    assert.equal(await page.locator('#review-count').innerText(), '2');
    assert.equal(await line(), String(sample.line));
    assert.match(await page.locator('#review-note').getAttribute('class'), /has-note/);

    // Comparison changes only current text. It also pauses auto and never replays media.
    const before = await progress(), art = await page.locator('#scene').innerHTML();
    await page.locator('#auto').click();
    await page.locator('#review-toggle').click();
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#text').innerText(), display(english.find((c) => c.line === sample.line).text));
    assert.equal(await page.locator('#text').getAttribute('lang'), 'en');
    assert.equal(await page.locator('#language').inputValue(), 'es');
    assert.equal(await progress(), before); assert.equal(await line(), String(sample.line));
    assert.equal(await page.locator('#scene').innerHTML(), art);
    assert.equal(await page.evaluate(() => window.__vnAudio.length), 0);
    await page.locator('#review-toggle').press('Enter');
    assert.equal(await page.locator('#text').innerText(), display(sample.text));
    assert.equal(await page.locator('#text').getAttribute('lang'), 'es');

    // An existing classic note edits in place, preserving captured source snapshots.
    await page.locator('#review-note').click();
    assert.equal(await page.locator('#review-comment').inputValue(), seed.comment);
    assert.equal(await page.locator('#review-spanish').textContent(), seed.spanish);
    assert.equal(await page.locator('#review-english').textContent(), seed.english);
    await page.locator('#review-comment').fill(''); await page.locator('#review-save').click();
    assert.match(await page.locator('#review-error').innerText(), /Escribe/);
    await page.locator('#review-comment').fill('Edited in VN');
    await page.locator('#review-proposal').fill('Propuesta con {@nickname}.');
    await page.locator('#review-comment').press('ArrowRight');
    assert.equal(await line(), String(sample.line));
    await page.screenshot({ path: path.join(output, 'review-editor.png'), fullPage: true });
    await page.locator('#review-save').click();
    assert.equal((await stored()).length, 2);
    assert.deepEqual((await stored()).find((n) => n.id === seed.id), { ...seed, comment: 'Edited in VN', proposal: 'Propuesta con {@nickname}.' });
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.match(await page.locator('#review-note').getAttribute('class'), /has-note/);

    // Exercise the actual unchanged classic review UI on the same origin.
    const classic = await context.newPage();
    classic.on('pageerror', (error) => errors.push(error.message));
    await classic.goto(origin + '/arknights/classic-review-fixture');
    await classic.evaluate((note) => {
      createStoryReviewNotes().attach(document.getElementById('classic-box'), { ...note, getEnglish: async () => note.english });
    }, seed);
    assert.match(await classic.locator('.review-note-button').getAttribute('class'), /has-note/);
    await classic.locator('.review-note-button').click();
    assert.equal(await classic.locator('#review-comment').inputValue(), 'Edited in VN');
    await classic.locator('#review-comment').fill('Edited in classic');
    await classic.locator('.review-save').click(); await classic.locator('.review-dialog[open]').waitFor({ state: 'hidden' });
    await page.bringToFront();
    await page.locator('#review-note').click();
    assert.equal(await page.locator('#review-comment').inputValue(), 'Edited in classic');
    await page.locator('#review-cancel').click();

    // Comparing from global EN also leaves the global setting unchanged.
    await page.locator('#language').selectOption('en');
    await page.locator('#review-toggle').click();
    assert.equal(await page.locator('#text').innerText(), display(sample.text));
    assert.equal(await page.locator('#language').inputValue(), 'en');
    await page.locator('#language').selectOption('es');
    await page.locator('#next').click();
    await page.waitForFunction((previous) => document.querySelector('#stage').dataset.line !== previous && document.querySelector('#stage').getAttribute('aria-busy') === 'false', String(sample.line));
    assert.equal(await page.locator('#review-toggle').getAttribute('aria-pressed'), 'false');
    const nextLine = Number(await line());
    await page.locator('#review-note').click();
    await page.locator('#review-comment').fill('New note <img src=x onerror=alert(1)>');
    await page.locator('#review-save').click();
    const newNote = (await stored()).find((n) => n.lines[0] === nextLine && n.story.key === story.id);
    assert.equal(newNote.spanish, es.split(/\r?\n/)[nextLine - 1].replace(/^\[[^\]]+\]/, ''));
    assert.equal(newNote.english, en.split(/\r?\n/)[nextLine - 1].replace(/^\[[^\]]+\]/, ''));
    assert.ok(newNote.sourceUrl.endsWith('/vn/sources/en/' + story.id + '.txt'));
    assert.equal((await stored()).length, 3);

    // Choices compare as a group; notes use the options field and selection still works.
    const choice = steps.find((s) => s.kind === 'choice');
    await page.locator('#history').click();
    await page.locator('.history-line').nth(steps.indexOf(choice)).click();
    assert.equal(await line(), String(choice.line));
    const atChoice = await progress();
    await page.locator('#review-toggle').click();
    assert.deepEqual(await page.locator('#choices button').allTextContents(), english.find((c) => c.line === choice.line).args.options.split(';').map(display));
    assert.equal(await progress(), atChoice);
    await page.locator('#review-note').click();
    await page.locator('#review-comment').fill('Review these choices'); await page.locator('#review-save').click();
    const choiceNote = (await stored()).find((n) => n.field === 'options');
    assert.equal(choiceNote.spanish, commands.find((c) => c.line === choice.line).args.options);
    assert.equal(choiceNote.id, reviewId(story.id, 'options', [choice.line]));
    await page.locator('#choices button').last().click();
    await page.waitForFunction(() => document.querySelector('#stage').dataset.kind === 'dialogue' && document.querySelector('#stage').getAttribute('aria-busy') === 'false');
    const saved = JSON.parse(await progress()).groups[groupKey].stories[story.id];
    assert.equal(saved.answers[choice.line], choice.options.at(-1).value);
    assert.equal(await page.locator('#text').getAttribute('lang'), 'es');

    // Clipboard success uses the real browser API; blocked clipboard gives selected Markdown.
    async function copyWithoutLayoutShift(name) {
      await page.waitForFunction(() => !document.querySelector('#review-status').textContent);
      await page.locator('#review-copy').scrollIntoViewIfNeeded();
      const layout = () => page.evaluate(() => ({
        boxes: ['#breadcrumbs', '#stage', '.controls'].map((selector) => {
          const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
          return { x, y, width, height };
        }),
        scrollY, height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth,
      }));
      const before = await layout();
      await page.locator('#review-copy').click();
      await page.waitForFunction(() => document.querySelector('#review-status').textContent.includes('copiada'));
      assert.deepEqual(await layout(), before, `${name}: notification does not move or resize the reader`);
      const toast = await page.locator('#review-status').boundingBox(), viewport = page.viewportSize();
      assert.ok(toast.x >= 0 && toast.y >= 0 && toast.x + toast.width <= viewport.width && toast.y + toast.height <= viewport.height,
        `${name}: notification stays inside the viewport`);
      assert.equal(await page.locator('#review-status').getAttribute('role'), 'status');
      if (await page.locator('body').evaluate((el) => el.classList.contains('reader-fullscreen'))) {
        const controls = await page.locator('.controls').boundingBox();
        assert.ok(toast.y + toast.height <= controls.y, `${name}: notification stays above fullscreen controls`);
      }
      await page.screenshot({ path: path.join(output, `notification-${name}.png`), fullPage: true });
      await page.waitForFunction(() => !document.querySelector('#review-status').textContent);
      assert.deepEqual(await layout(), before, `${name}: dismissing the notification does not move the reader`);
    }
    await copyWithoutLayoutShift('desktop');
    const report = exportReviews(await stored());
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), report);
    await page.locator('#fullscreen').click();
    await copyWithoutLayoutShift('desktop-fullscreen');
    await page.locator('#fullscreen').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await copyWithoutLayoutShift('mobile');
    await page.locator('#fullscreen').click();
    await copyWithoutLayoutShift('mobile-fullscreen');
    await page.locator('#fullscreen').click();
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Denied'); } } }); });
    await page.locator('#review-copy').click();
    await page.locator('#review-export-dialog[open]').waitFor();
    assert.equal(await page.locator('#review-export-text').inputValue(), report);
    assert.equal(await page.locator('#review-export-text').evaluate((el) => el.selectionEnd - el.selectionStart), report.length);
    await page.locator('#review-export-close').click();

    // The review buttons and editor fit a phone without horizontal overflow.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#review-note').scrollIntoViewIfNeeded();
    const controls = await page.locator('#review-controls').boundingBox(), panel = await page.locator('#dialogue-panel').boundingBox();
    assert.ok(controls.x >= panel.x && controls.x + controls.width <= panel.x + panel.width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, 'review-mobile.png'), fullPage: true });
    await page.locator('#review-note').click();
    await page.screenshot({ path: path.join(output, 'review-editor-mobile.png'), fullPage: true });
    assert.equal(await page.locator('#review-dialog').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
    await page.locator('#review-cancel').click();
    await page.setViewportSize({ width: 1280, height: 960 });

    // Wipe the shared notes only; classic marks clear through the storage event.
    const beforeClear = await progress();
    await page.locator('#review-clear').click();
    assert.deepEqual(await stored(), []); assert.equal(await progress(), beforeClear);
    await classic.waitForFunction(() => !document.querySelector('.review-note-button').classList.contains('has-note'));
    assert.equal(await classic.locator('.review-copy').isDisabled(), true);
    await classic.close();
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await page.locator('#review-count').innerText(), '0');

    // Quota errors retain the unsaved draft; a later save and individual deletion recover.
    await page.locator('#review-note').click(); await page.locator('#review-comment').fill('Retain my draft');
    await page.evaluate(() => { window.__reviewStorageFailure = 'write'; });
    await page.locator('#review-save').click();
    assert.match(await page.locator('#review-error').innerText(), /No se pudo guardar/);
    assert.equal(await page.locator('#review-comment').inputValue(), 'Retain my draft');
    await page.evaluate(() => { window.__reviewStorageFailure = ''; });
    await page.locator('#review-save').click();
    await page.locator('#review-note').click(); await page.locator('#review-delete').click();
    assert.equal(await page.locator('#review-count').innerText(), '0');

    // Missing/mismatched English never produces a false comparison or an invented original.
    const englishURL = '**/sources/en/' + story.id + '.txt';
    await page.route(englishURL, (route) => route.fulfill({ status: 503, body: '' }));
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await page.locator('#review-toggle').isDisabled(), true);
    await page.locator('#review-note').click(); await page.locator('#review-comment').fill('English unavailable');
    await page.locator('#review-save').click();
    assert.equal((await stored())[0].english, null); assert.ok((await stored())[0].sourceError);
    await page.unroute(englishURL); await page.locator('#load-retry').click();
    await page.waitForFunction(() => !document.querySelector('#review-toggle').disabled);
    await page.locator('#review-toggle').click(); assert.equal(await page.locator('#text').getAttribute('lang'), 'en');
    await page.route(englishURL, (route) => route.fulfill({ body: '[Delay(time=0)]\n' + en }));
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await page.locator('#review-toggle').isDisabled(), true);
    await page.unroute(englishURL);
    await page.route('**/gamedata/es_ES/story/' + story.id + '.txt', (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await page.locator('#language').inputValue(), 'en');
    assert.equal(await page.locator('#review-controls').isVisible(), false);
    await page.unroute('**/gamedata/es_ES/story/' + story.id + '.txt');

    // Leaving a note editor cancels its draft; malformed saved notes remain untouched.
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    await page.locator('#review-note').click(); await page.locator('#review-comment').fill('Do not save');
    await page.evaluate(() => { location.hash = '#/'; }); await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#review-dialog').isVisible(), false);
    assert.notEqual((await stored())[0].comment, 'Do not save');
    await page.evaluate((key) => localStorage.setItem(key, '{broken'), REVIEW_KEY);
    await open();
    assert.equal(await page.locator('#review-copy').isDisabled(), true);
    assert.equal(await page.locator('#review-clear').isDisabled(), true);
    await page.locator('#review-note').click(); await page.locator('#review-comment').fill('Keep this text');
    await page.locator('#review-save').click();
    assert.equal(await page.locator('#review-dialog').isVisible(), true);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), REVIEW_KEY), '{broken');
    assert.deepEqual(errors, []);
    console.log('Review passed: per-line/choice comparison, shared classic notes, exact snapshots, edit/delete/clear, clipboard/fallback, notifications without layout shifts on desktop/mobile/fullscreen, missing/misaligned sources, quota/corrupt storage and navigation cleanup.');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
