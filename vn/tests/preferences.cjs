// Global controls work before reading and preferences survive stories/reloads.
const { createRequire } = require('node:module');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const playwright = process.env.VN_PLAYWRIGHT_MODULE ? require(process.env.VN_PLAYWRIGHT_MODULE)
  : createRequire(path.join(process.cwd(), 'package.json'))('playwright');
const root = path.resolve(__dirname, '../..');
const server = http.createServer(async (request, response) => {
  let name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (name.endsWith('/')) name += 'index.html';
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
  try {
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' })[path.extname(file)] || 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404); response.end(); }
});

// Real, locally fulfilled audio avoids relying on the remote asset mirrors.
const wav = Buffer.alloc(44 + 16000);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(16000, 40);

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext();
    await context.route('https://**', (route) => /\.(mp3|wav)$/.test(route.request().url())
      ? route.fulfill({ contentType: 'audio/wav', body: wav }) : route.abort());
    await context.addInitScript(() => {
      const NativeAudio = window.Audio;
      window.__vnAudio = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__vnAudio.push(audio); return audio; };
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/vn/`;
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')).preferences);
    const stopped = () => page.evaluate(() => window.__vnAudio.every((audio) => audio.paused && !audio.getAttribute('src')));
    const playing = () => page.waitForFunction(() => window.__vnAudio.some((audio) => !audio.paused && audio.readyState >= 2));
    const navigate = async (hash) => {
      await page.evaluate((hash) => { location.hash = hash; }, hash);
      if (hash === '#/') await page.locator('.category-card').first().waitFor();
      else await page.locator('#begin:not(:disabled)').waitFor();
    };

    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await page.locator('.global-controls > *').evaluateAll((nodes) => nodes.map((node) => node.id || node.className)), ['review-toolbar', 'sound', 'settings', 'language']);
    assert.deepEqual(await page.locator('#language option').allTextContents(), ['ES', 'EN']);
    await page.locator('#sound').click();
    assert.equal((await stored()).sound, true);
    assert.equal(await stopped(), true, 'enabling sound in the library does not start playback');
    await page.locator('#settings').click();
    assert.equal(await page.locator('#restart').isVisible(), false);
    await page.locator('#nickname').fill('Test Doctor');
    await page.locator('#nickname').press('Tab');
    await page.locator('#speed').selectOption('0');
    await page.locator('#motion').check();
    await page.locator('#settings-dialog .close').click();
    assert.deepEqual(await stored(), { language: 'es', sound: true, nickname: 'Test Doctor', speed: 0, motion: true });

    await navigate('#/main/chapter-0/prologue-1');
    assert.equal(await stopped(), true, 'the story cover is silent');
    await page.locator('#begin').click();
    await page.locator('#dialogue:visible').waitFor();
    await playing();
    await page.locator('#settings').click();
    assert.equal(await page.locator('#restart').isVisible(), true);
    assert.equal(await page.locator('#nickname').inputValue(), 'Test Doctor');
    await page.locator('#settings-dialog .close').click();

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await stopped(), true, 'backgrounding stops playback');
    assert.equal((await stored()).sound, true, 'backgrounding retains the preference');
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await playing();

    await navigate('#/');
    assert.equal(await stopped(), true, 'leaving a story stops all its audio');
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
    await navigate('#/main/chapter-0/prologue-2');
    assert.equal(await stopped(), true);
    await page.locator('#begin').click();
    // Prologue 2 starts with two silent lines before its music cue.
    await page.locator('#dialogue:visible').waitFor();
    await page.locator('#next').click();
    await page.locator('#next').click();
    await playing();
    await page.reload();
    await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'true');
    assert.equal(await stopped(), true);
    await page.locator('#begin').click();
    await playing();
    await page.locator('#sound').click();
    assert.equal(await stopped(), true, 'muting stops the current story');
    assert.equal((await stored()).sound, false);
    await navigate('#/');
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#settings').getAttribute('aria-label'), 'Settings');
    assert.equal(await page.locator('#sound').getAttribute('aria-label'), 'Sound');
    await page.reload();
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#sound svg').count(), 1, 'localization keeps the icon');
    assert.deepEqual(await stored(), { language: 'en', sound: false, nickname: 'Test Doctor', speed: 0, motion: true });
    assert.deepEqual(errors, []);
    console.log('Preferences passed: library controls, silent covers, audio across stories/reloads, mute, background suspension, and localized icons.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
