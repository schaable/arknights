// Space advances the reader regardless of control focus; dialogs keep native input.
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = process.env.VN_PLAYWRIGHT_MODULE ? require(process.env.VN_PLAYWRIGHT_MODULE)
  : createRequire(path.join(process.cwd(), 'package.json'))('playwright');
const root = path.resolve(__dirname, '../..');
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
  const commands = parseScript(await fs.readFile(path.join(root, 'gamedata/es_ES/story/obt/guide/beg/0_welcome_to_guide.txt'), 'utf8'));
  const steps = buildTimeline(commands);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext();
    // Keyboard behavior needs local scripts only, not remote artwork/audio.
    await context.route('https://**', (route) => route.abort());
    await context.addInitScript(() => localStorage.setItem('arknights.vn.v2', JSON.stringify({
      v: 2, groups: {}, preferences: { language: 'es', speed: 0, motion: true },
    })));
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    await page.goto(base + '#/main/chapter-0/prologue-1');
    await page.locator('#begin:not(:disabled)').waitFor();
    await page.locator('#settings').click();
    await page.locator('#settings-dialog .close').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings');
    await page.keyboard.press('Space');
    await page.locator('#dialogue:visible').waitFor();
    assert.equal(await page.locator('#cover').isVisible(), false, 'Space begins a loaded story even with Settings focused');
    let index = 0;
    const at = async (step) => {
      await page.waitForFunction((line) => document.querySelector('#stage').dataset.line === String(line)
        && document.querySelector('#stage').getAttribute('aria-busy') === 'false', step.line);
      assert.equal(Number(await page.locator('#stage').getAttribute('data-line')), step.line);
    };
    const space = async () => {
      await page.keyboard.press('Space');
      await at(steps[++index]);
      assert.equal(await page.locator('dialog[open]').count(), 0);
    };
    await at(steps[index]);

    // A focused control must not receive its native Space click or selection.
    for (const selector of ['#settings', '#history', '#auto', '#sound', '#back', '#next',
      '#dialogue', '#review-toggle', '#review-note', '#next-story', '#language', '#story-select']) {
      const control = page.locator(selector);
      const url = page.url();
      await control.evaluate((node) => { node.dataset.clicks = '0'; node.addEventListener('click', () => node.dataset.clicks = String(Number(node.dataset.clicks) + 1)); });
      await control.focus();
      await space();
      assert.equal(await control.getAttribute('data-clicks'), '0', selector);
      assert.equal(page.url(), url, selector);
      assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'false');
      assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    }

    // Enter still activates controls. Closing a dialog restores the opener's
    // focus, and the following Space must advance rather than reopen it.
    for (const [button, dialog, close] of [
      ['#settings', '#settings-dialog', '#settings-dialog .close'],
      ['#history', '#history-dialog', '#history-dialog .close'],
      ['#review-note', '#review-dialog', '#review-close'],
    ]) {
      await page.locator(button).focus(); await page.keyboard.press('Enter');
      await page.locator(dialog + '[open]').waitFor();
      if (button === '#settings' || button === '#review-note') {
        const input = page.locator(button === '#settings' ? '#nickname' : '#review-comment');
        await input.fill('A'); await input.press('Space');
        assert.equal(await input.inputValue(), 'A ');
        await at(steps[index]);
      }
      await page.locator(close).focus(); await page.keyboard.press('Space');
      await page.locator(dialog).waitFor({ state: 'hidden' });
      await at(steps[index]);
      assert.equal(await page.evaluate(() => document.activeElement.id), button.slice(1));
      await space();
    }

    await page.locator('#settings').focus();
    await page.keyboard.down('Space'); await at(steps[++index]);
    await page.keyboard.down('Space'); await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await at(steps[index]);
    assert.equal(await page.locator('dialog[open]').count(), 0, 'held Space cannot activate the focused button');

    // Decisions require an explicit selection; Space must not pick a focused
    // answer by accident, while Enter remains available for choosing it.
    while (steps[index].kind !== 'choice') await space();
    const choice = page.locator('#choices button').first();
    await choice.focus(); await page.keyboard.press('Space');
    await at(steps[index]);
    await page.keyboard.press('Enter');
    await page.waitForFunction((line) => Number(document.querySelector('#stage').dataset.line) !== line, steps[index].line);
    assert.equal(await page.locator('#dialogue').isVisible(), true);

    // Leaving the reader restores normal keyboard activation in the library.
    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    await page.locator('.category-card[href="#/main"]').click();
    const filter = page.locator('.catalog-filters input[type="checkbox"]');
    await filter.focus(); await page.keyboard.press('Space');
    assert.equal(await filter.isChecked(), true);
    assert.deepEqual(errors, []);
    console.log('Keyboard passed: Space overrides focused controls, advances exactly once, works after dialogs, starts covers, preserves modal input/Enter choices, and leaves the library unchanged.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });

