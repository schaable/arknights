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
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
    const setVolume = (value) => page.locator('#volume').evaluate((input, value) => {
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    const screenshots = process.env.VN_SCREENSHOTS || '/tmp/arknights-vn';
    await fs.mkdir(screenshots, { recursive: true });
    const navigate = async (hash) => {
      await page.evaluate((hash) => { location.hash = hash; }, hash);
      if (hash === '#/') await page.locator('.category-card').first().waitFor();
      else await page.locator('#begin:not(:disabled)').waitFor();
    };

    await page.goto(base);
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await page.locator('.global-controls > *').evaluateAll((nodes) => nodes.map((node) => node.id || node.className)), ['review-toolbar', 'volume-control', 'settings', 'language']);
    assert.deepEqual(await page.locator('#language option').allTextContents(), ['ES', 'EN']);
    assert.equal(await page.getByRole('slider', { name: 'Volumen', exact: true }).inputValue(), '55');
    await setVolume(35);
    assert.equal((await stored()).sound, false, 'adjusting volume preserves mute');
    assert.equal(await stopped(), true);
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
    assert.deepEqual(await stored(), { language: 'es', sound: true, volume: 35, nickname: 'Test Doctor', speed: 0, motion: true });

    await navigate('#/main/chapter-0/prologue-1');
    assert.equal(await stopped(), true, 'the story cover is silent');
    await page.locator('#begin').click();
    await page.locator('#dialogue:visible').waitFor();
    await playing();
    const line = await page.locator('#stage').getAttribute('data-line');
    const groups = await page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')).groups);
    await page.locator('#volume').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await stored()).volume, 36);
    await page.keyboard.press('ArrowLeft');
    assert.equal((await stored()).volume, 35);
    assert.equal(await page.locator('#stage').getAttribute('data-line'), line, 'slider arrows do not navigate');
    await page.evaluate(() => {
      window.__volumeAudio = window.__vnAudio.find((audio) => !audio.paused && audio.readyState >= 2);
      window.__volumeBefore = window.__volumeAudio.volume;
      window.__audioCount = window.__vnAudio.length;
    });
    await setVolume(70);
    assert.equal(await page.evaluate(() => Math.abs(window.__volumeAudio.volume - window.__volumeBefore * 2) < 1e-9), true);
    assert.equal(await page.evaluate(() => window.__vnAudio.length === window.__audioCount && !window.__volumeAudio.paused), true, 'volume does not restart playback');
    await setVolume(0);
    assert.equal(await page.evaluate(() => window.__volumeAudio.volume), 0);
    assert.equal((await stored()).sound, true, 'zero volume preserves the sound toggle');
    await setVolume(70);
    assert.equal(await page.locator('#volume').getAttribute('aria-valuetext'), '70%');
    assert.equal(await page.locator('#volume-value').textContent(), '70%');
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')).groups), groups);
    await page.locator('#volume').blur();
    await page.screenshot({ path: path.join(screenshots, 'volume-desktop.png'), fullPage: true });
    for (const viewport of [{ width: 1280, height: 600 }, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.screenshot({ path: path.join(screenshots, `volume-desktop-${viewport.width}.png`), fullPage: true });
      const heading = await page.locator('.chapter-label').boundingBox();
      assert.ok(heading.width >= 120 && heading.height < 100, 'compact desktop keeps the story title readable');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
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
    assert.equal(await page.locator('#volume').inputValue(), '70', 'volume survives background suspension');

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
    assert.equal(await page.locator('#volume').inputValue(), '70', 'volume survives stories and reloads');
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
    assert.equal(await page.getByRole('slider', { name: 'Volume', exact: true }).count(), 1);
    await page.reload();
    await page.locator('.category-card').first().waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#sound svg').count(), 1, 'localization keeps the icon');
    assert.deepEqual(await stored(), { language: 'en', sound: false, volume: 70, nickname: 'Test Doctor', speed: 0, motion: true });

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.route('https://**', (route) => route.abort());
    await mobile.addInitScript((saved) => {
      if (!localStorage.getItem('arknights.vn.v2')) localStorage.setItem('arknights.vn.v2', saved);
    }, await page.evaluate(() => localStorage.getItem('arknights.vn.v2')));
    const touch = await mobile.newPage();
    touch.on('pageerror', (error) => errors.push(error.message));
    await touch.goto(base);
    await touch.locator('.category-card').first().waitFor();
    const slider = await touch.locator('#volume').boundingBox();
    await touch.touchscreen.tap(slider.x + slider.width * 0.25, slider.y + slider.height / 2);
    const touchVolume = Number(await touch.locator('#volume').inputValue());
    assert.ok(touchVolume > 0 && touchVolume < 50, 'touch adjusts the native slider');
    assert.equal(await touch.locator('#sound').getAttribute('aria-pressed'), 'false');
    await touch.screenshot({ path: path.join(screenshots, 'volume-mobile-library.png'), fullPage: true });
    await touch.goto(base + '#/main/chapter-0/prologue-1');
    await touch.locator('#begin:not(:disabled)').waitFor();
    assert.equal(Number(await touch.locator('#volume').inputValue()), touchVolume);
    await touch.locator('#begin').tap();
    await touch.locator('#dialogue:visible').waitFor();
    await touch.screenshot({ path: path.join(screenshots, 'volume-mobile-reader.png'), fullPage: true });
    for (const width of [390, 320, 280]) {
      await touch.setViewportSize({ width, height: 844 });
      assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}px`);
      for (const selector of ['#sound', '#volume', '#settings', '#language']) {
        const box = await touch.locator(selector).boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width, `${selector} fits at ${width}px`);
      }
    }
    await touch.screenshot({ path: path.join(screenshots, 'volume-mobile-narrow.png'), fullPage: true });
    await mobile.close();
    assert.deepEqual(errors, []);
    console.log('Preferences passed: live volume, saved settings, silent covers, mute, background suspension, keyboard/touch controls, localization, and desktop/mobile layouts.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
