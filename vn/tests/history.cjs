// Real history portraits, mirror fallback, stable scrolling and line selection.
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
  const { parseScript, buildTimeline } = await import('../script.mjs');
  const id = 'activities/act10d5/level_act10d5_st01';
  const steps = buildTimeline(parseScript(await fs.readFile(path.join(root, `gamedata/es_ES/story/${id}.txt`), 'utf8')));
  const current = steps.findIndex((step) => step.line === 335);
  const recent = steps.slice(0, current + 1);
  const saved = { v: 2, preferences: { language: 'es', speed: 0, motion: true }, groups: {
    'vignettes:act10d5': { resume: id, updated: 1, stories: { [id]: { line: recent.at(-1).line, answers: {}, updated: 1 } } },
  } };
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const errors = [];
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const makePage = async (options, missingPortraits = false, slowPortrait = false) => {
      const portraitRequests = [];
      let releasePortrait;
      const pendingPortrait = slowPortrait ? new Promise((resolve) => { releasePortrait = resolve; }) : null;
      const context = await browser.newContext({ ignoreHTTPSErrors: true, ...options });
      await context.route(/^https:\/\//, async (route) => {
        const url = route.request().url();
        if (!url.includes('/thumbs/')) return route.abort();
        portraitRequests.push(url);
        if (url.includes('char_260_durnar')) await pendingPortrait;
        // Verify that the raw mirror recovers a failed primary portrait.
        if (url.includes('char_260_durnar') && (missingPortraits || url.includes('cdn.jsdelivr.net'))) return route.fulfill({ status: 404, body: '' });
        return route.continue();
      });
      await context.addInitScript((saved) => {
        localStorage.setItem('arknights.vn.v2', JSON.stringify(saved));
        Object.defineProperty(document, 'fullscreenEnabled', { value: false });
      }, saved);
      const page = await context.newPage();
      page.portraitRequests = portraitRequests;
      page.releasePortrait = releasePortrait;
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(base + '#/vignettes/children-of-ursus/habits');
      await page.locator('#begin:not(:disabled)').click();
      await page.locator('#dialogue:visible').waitFor();
      return page;
    };
    const atEnd = (page) => page.locator('#history-list').evaluate((list) => Math.abs(list.scrollHeight - list.scrollTop - list.clientHeight) <= 1);
    const decoded = (img) => img.evaluate((el) => el.decode());
    const openHistory = async (page) => {
      await page.locator('#history').click();
      await page.waitForFunction(() => {
        const img = document.querySelector('#history-list .history-line:last-child img');
        return img?.complete && img.naturalWidth > 0 && !img.hidden;
      }, null, { timeout: 30000 });
      await decoded(page.locator('.history-line').last().locator('img'));
      await page.waitForFunction(() => {
        const list = document.querySelector('#history-list').getBoundingClientRect();
        return [...document.querySelectorAll('#history-list img')].every((img) => {
          const box = img.getBoundingClientRect();
          return box.bottom <= list.top || box.top >= list.bottom || img.complete;
        });
      }, null, { timeout: 30000 });
      assert.equal(await atEnd(page), true, 'loading portraits preserves the latest entry');
      assert.equal(await page.locator('#history-dialog .close').evaluate((button) => {
        const box = button.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === button;
      }), true, 'close remains visible');
    };

    const page = await makePage({ viewport: { width: 1440, height: 900 } });
    const before = await page.evaluate(() => localStorage.getItem('arknights.vn.v2'));
    await page.waitForTimeout(100);
    assert.ok(page.portraitRequests.some((url) => url.includes('char_260_durnar')), 'recent portraits start loading before history opens');
    await openHistory(page);
    assert.equal(await page.locator('.history-line').count(), recent.length);
    assert.deepEqual(await page.locator('.history-line').evaluateAll((rows) => rows.map((row) => row.querySelector('img')?.dataset.asset || null)),
      recent.map((step) => step.speaker && step.state.focus > 0 ? step.state.characters[step.state.focus - 1] || null : null));
    const last = page.locator('.history-line').last();
    assert.equal(await last.locator('img').getAttribute('data-asset'), 'char_260_durnar_1');
    assert.match(await last.locator('img').getAttribute('src'), /^https:\/\/raw\.githubusercontent\.com\/akgcc\/arkdata\/main\/thumbs\//);
    assert.equal(await last.locator('img').getAttribute('alt'), '');
    assert.equal(await last.locator('.history-portrait').getAttribute('aria-hidden'), 'true');
    assert.equal(await last.locator('img').evaluate((img) => getComputedStyle(img).objectFit), 'contain');
    assert.equal(await page.getByRole('button', { name: `${recent.at(-1).speaker} ${recent.at(-1).text}`, exact: true }).count(), 1, 'portrait does not repeat the accessible name');
    await page.screenshot({ path: path.join(output, 'history-portraits-desktop.png') });
    await page.evaluate(() => {
      window.lastHistoryImage = document.querySelector('.history-line:last-child img');
      window.historyChanges = [];
      new MutationObserver((records) => window.historyChanges.push(...records))
        .observe(document.querySelector('#history-list'), { childList: true });
    });
    await page.locator('#history-dialog .close').click();
    assert.equal(await page.evaluate(() => localStorage.getItem('arknights.vn.v2')), before);
    const requestsBefore = page.portraitRequests.filter((url) => url.includes('char_260_durnar')).length;
    await openHistory(page);
    assert.equal(await page.evaluate(() => window.lastHistoryImage === document.querySelector('.history-line:last-child img')), true, 'reopening reuses the decoded image');
    assert.equal(await page.evaluate(() => window.historyChanges.length), 0, 'reopening does not detach the rows');
    assert.equal(page.portraitRequests.filter((url) => url.includes('char_260_durnar')).length, requestsBefore, 'reopening does not retry the failed primary mirror');
    await page.locator('#history-dialog .close').click();
    await page.locator('#language').selectOption('en');
    await openHistory(page);
    assert.equal(await last.locator('img').getAttribute('data-asset'), 'char_260_durnar_1');
    assert.equal(await page.evaluate(() => window.lastHistoryImage === document.querySelector('.history-line:last-child img')), true, 'language changes update text while preserving portraits');
    await page.keyboard.press('Escape');

    const mobile = await makePage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const width of [390, 320, 280]) {
      await mobile.setViewportSize({ width, height: 844 });
      await openHistory(mobile);
      assert.equal(await mobile.locator('#history-list').evaluate((list) => list.scrollWidth <= list.clientWidth), true, 'portraits and text fit the list');
      await mobile.screenshot({ path: path.join(output, `history-portraits-mobile-${width}.png`) });
      await mobile.locator('#history-dialog .close').tap();
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#fullscreen').tap();
    await openHistory(mobile);
    await mobile.screenshot({ path: path.join(output, 'history-portraits-fullscreen.png') });
    const previous = mobile.locator('.history-line').nth(recent.length - 2);
    assert.equal(await previous.locator('img').getAttribute('data-asset'), 'char_196_sunbr_1#3', 'second character and exact expression are used');
    await previous.locator('.history-portrait').tap();
    await mobile.locator('#history-dialog').waitFor({ state: 'hidden' });
    assert.equal(await mobile.locator('#stage').getAttribute('data-line'), String(recent.at(-2).line), 'tapping the portrait restores that line');
    await openHistory(mobile);
    assert.equal(await mobile.locator('.history-line').count(), recent.length - 1, 'seeking trims later history entries');
    await mobile.locator('#history-dialog .close').tap();

    // A cold portrait stays hidden through both download and decoding. The
    // initial, scroll position and close button remain available throughout.
    const slow = await makePage({ viewport: { width: 390, height: 844 } }, false, true);
    await slow.evaluate(() => {
      const decode = HTMLImageElement.prototype.decode;
      const gate = new Promise((resolve) => { window.releaseDecode = resolve; });
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this);
        if (this.src.includes('/thumbs/char_260_durnar')) {
          window.decodeStarted = true;
          await gate;
        }
        this.dataset.testDecoded = 'true';
      };
    });
    await slow.locator('#history').click();
    const slowLast = slow.locator('.history-line').last();
    const initialBox = await slowLast.locator('.history-portrait').boundingBox();
    assert.equal(await slowLast.locator('img').isHidden(), true);
    assert.equal(await slowLast.locator('img').getAttribute('src'), null, 'an undecoded portrait is not assigned to the visible row');
    assert.equal(await slowLast.locator('.history-portrait').textContent(), 'D');
    await slow.locator('#history-dialog .close').click();
    await slow.locator('#history').click();
    slow.releasePortrait();
    await slow.waitForFunction(() => window.decodeStarted);
    assert.equal(await slowLast.locator('img').isHidden(), true, 'network completion alone does not reveal the portrait');
    assert.equal(await atEnd(slow), true);
    await slow.evaluate(() => window.releaseDecode());
    await slowLast.locator('img').waitFor({ state: 'visible' });
    assert.equal(await slowLast.locator('img').getAttribute('data-test-decoded'), 'true');
    assert.deepEqual(await slowLast.locator('.history-portrait').boundingBox(), initialBox, 'loading does not move the entry');
    await slow.locator('#history-dialog .close').click();

    const leaving = await makePage({ viewport: { width: 390, height: 844 } }, false, true);
    await leaving.locator('#history').click();
    await leaving.evaluate(() => { window.oldPortrait = document.querySelector('.history-line:last-child img'); location.hash = '#/'; });
    await leaving.locator('.category-card').first().waitFor();
    leaving.releasePortrait();
    await leaving.waitForTimeout(150);
    assert.equal(await leaving.evaluate(() => window.oldPortrait.hidden), true, 'late requests cannot reveal removed portraits');
    assert.equal(await leaving.locator('#history-list img').count(), 0);
    assert.equal(await leaving.locator('#status').textContent(), '');

    // A fresh context avoids already decoded portraits bypassing the failures.
    const failed = await makePage({ viewport: { width: 390, height: 844 } }, true);
    await failed.waitForLoadState('networkidle');
    const status = await failed.locator('#status').textContent();
    await failed.locator('#history').click();
    const missing = failed.locator('.history-line').last();
    await missing.locator('img').waitFor({ state: 'hidden' });
    assert.equal(await missing.locator('.history-portrait').textContent(), 'D');
    assert.equal(await atEnd(failed), true, 'missing portraits do not shift the list');
    assert.equal(await failed.locator('#status').textContent(), status, 'missing optional portraits do not interrupt reading');
    await failed.locator('#history-dialog .close').click();
    assert.deepEqual(errors, []);
    console.log('History portraits passed: preloading, decoded reveal, reused rows/images, slow download/decode, cancellation, real thumbnails, focused expressions, mirror/missing fallback, scrolling, localization, accessible labels and desktop/mobile/fullscreen selection.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
