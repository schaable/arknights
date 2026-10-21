// Verify Auto timing with a controlled browser clock, plus persistence and layout.
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
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const id = 'obt/guide/beg/0_welcome_to_guide';
  const script = parseScript(await fs.readFile(path.join(root, `gamedata/es_ES/story/${id}.txt`), 'utf8'));
  const answers = Object.fromEntries(script.filter((s) => s.command === 'decision').map((s) => [s.line, s.args.values.split(';')[0]]));
  const steps = buildTimeline(script, answers);
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route('https://**', (route) => route.abort());
    await context.addInitScript(() => {
      if (!localStorage.getItem('arknights.vn.v2')) localStorage.setItem('arknights.vn.v2', JSON.stringify({
        v: 2, groups: {}, preferences: { language: 'es', speed: 0, motion: true },
      }));
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install({ time: 0 });
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const storyURL = base + '#/main/chapter-0/prologue-1';
    const line = () => page.locator('#stage').getAttribute('data-line');
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')));
    const rate = (value) => page.locator('#auto-speed').selectOption(String(value));
    const auto = () => page.locator('#auto').click();
    await page.goto(storyURL);
    await page.locator('#begin:not(:disabled)').click();
    await page.locator('#dialogue:visible').waitFor();
    await page.clock.pauseAt(100000);
    assert.equal(await page.getByRole('combobox', { name: 'Velocidad de lectura automática' }).inputValue(), '1');

    // Measure the same real line at each rate; all retain the original 1× pace.
    const measure = async (value) => {
      if (await line() !== String(steps[0].line)) await page.locator('#back').click();
      await rate(value);
      await auto();
      let elapsed = 0;
      while (await line() === String(steps[0].line) && elapsed < 10000) {
        await page.clock.runFor(100); elapsed += 100;
      }
      assert.equal(await line(), String(steps[1].line));
      await auto();
      return elapsed;
    };
    const baseline = await measure(1);
    assert.ok(baseline >= 2000 && baseline < 2500, '1× preserves the original opening-line delay');
    for (const value of [0.5, 1.5, 2, 3]) {
      const elapsed = await measure(value);
      assert.ok(Math.abs(elapsed - baseline / value) <= 200, `${value}× scales the delay`);
    }

    await page.locator('#back').click();
    await rate(1); await auto();
    await page.clock.runFor(1000);
    const before = await saved();
    await rate(0.5);
    assert.deepEqual((await saved()).groups, before.groups, 'speed changes do not rewrite progress');
    await page.clock.runFor(baseline);
    assert.equal(await line(), String(steps[0].line), 'slowing down cancels the old timer');
    await rate(3);
    await page.clock.runFor(Math.ceil(baseline / 3) + 100);
    assert.equal(await line(), String(steps[1].line), 'speeding up replaces the pending delay');
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'true');
    await auto();
    const pausedLine = await line();
    await rate(2); await page.clock.runFor(20000);
    assert.equal(await line(), pausedLine, 'changing speed while paused does not start Auto');

    await page.locator('#language').selectOption('en');
    assert.equal(await page.getByRole('combobox', { name: 'Auto playback speed' }).inputValue(), '2');
    await page.evaluate(() => { location.hash = '#/main/chapter-0/prologue-2'; });
    await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#auto-speed').inputValue(), '2');
    await page.reload();
    await page.locator('#begin:not(:disabled)').waitFor();
    assert.equal(await page.locator('#auto-speed').inputValue(), '2');

    const openAt = async (step, selectedAnswers = {}) => {
      // Leave the current reading before replacing its save for the next case.
      await page.goto(base);
      await page.locator('.category-card').first().waitFor();
      await page.evaluate(({ id, step, selectedAnswers }) => {
        const data = JSON.parse(localStorage.getItem('arknights.vn.v2'));
        data.preferences.language = 'es';
        data.groups['main:main_0'].stories[id] = { line: step.line, answers: selectedAnswers, read: false, updated: Date.now() };
        localStorage.setItem('arknights.vn.v2', JSON.stringify(data));
      }, { id, step, selectedAnswers });
      await page.goto(storyURL);
      await page.locator('#begin:not(:disabled)').click();
      await page.locator('#dialogue:visible').waitFor();
    };
    const choiceIndex = steps.findIndex((s) => s.kind === 'choice');
    await openAt(steps[choiceIndex - 1]);
    await rate(3); await auto(); await page.clock.runFor(30000);
    assert.equal(await page.locator('#stage').getAttribute('data-kind'), 'choice');
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'false');
    const choiceSave = (await saved()).groups;
    await rate(0.5); await page.clock.runFor(30000);
    assert.deepEqual((await saved()).groups, choiceSave, 'choices are never selected automatically');
    await openAt(steps.filter((s) => s.kind === 'dialogue').at(-1), answers);
    await rate(3); await auto(); await page.clock.runFor(30000);
    assert.equal(await page.locator('#ending').isVisible(), true);
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'false');
    assert.equal((await saved()).groups['main:main_0'].stories[id].read, true);

    await openAt(steps[0]);
    await rate(1.5); await auto();
    await page.locator('#auto-speed').blur();
    await page.screenshot({ path: path.join(output, 'auto-speed-desktop.png'), fullPage: true });
    await page.locator('#settings').click();
    await page.clock.runFor(20000);
    assert.equal(await line(), String(steps[0].line), 'dialogs pause Auto');
    await page.locator('#settings-dialog .close').click();
    await auto();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.runFor(20000);
    assert.equal(await line(), String(steps[0].line), 'backgrounding stops Auto');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await auto();
    await page.evaluate(() => { location.hash = '#/'; });
    await page.locator('.category-card').first().waitFor();
    const navigated = (await saved()).groups;
    await page.clock.runFor(20000);
    assert.deepEqual((await saved()).groups, navigated, 'navigation cancels the pending advance');

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await mobile.route('https://**', (route) => route.abort());
    await mobile.addInitScript((data) => localStorage.setItem('arknights.vn.v2', JSON.stringify(data)), await saved());
    const touch = await mobile.newPage();
    touch.on('pageerror', (error) => errors.push(error.message));
    await touch.goto(storyURL);
    await touch.locator('#begin:not(:disabled)').tap();
    await touch.locator('#auto-speed').selectOption('0.5');
    assert.equal(await touch.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')).preferences.autoSpeed), 0.5);
    for (const width of [390, 320, 280]) {
      await touch.setViewportSize({ width, height: 844 });
      assert.equal(await touch.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no overflow at ${width}px`);
      const box = await touch.locator('#auto-speed').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.height >= 36);
      await touch.screenshot({ path: path.join(output, `auto-speed-mobile-${width}.png`), fullPage: true });
    }
    await touch.setViewportSize({ width: 390, height: 844 });
    await touch.locator('#fullscreen').tap();
    await touch.waitForFunction(() => document.body.classList.contains('reader-fullscreen'));
    await touch.locator('#auto-speed').selectOption('3');
    await touch.screenshot({ path: path.join(output, 'auto-speed-fullscreen.png') });
    const fullBox = await touch.locator('#auto-speed').boundingBox();
    assert.ok(fullBox.y >= 0 && fullBox.y + fullBox.height <= 844, 'speed control remains accessible in fullscreen');
    assert.deepEqual(errors, []);
    console.log('Auto speed passed: all rates, live timer changes, paused/choice/ending behavior, global persistence, localization, teardown and desktop/mobile/fullscreen layouts.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
