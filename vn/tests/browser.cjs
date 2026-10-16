// Optional browser QA: see ../README.md for the Playwright setup.
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
    const data = await fs.readFile(file);
    response.setHeader('Content-Type', ({ '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain' })[path.extname(file)] || 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
});

(async () => {
  const { parseScript, buildTimeline } = await import(pathToFileURL(path.join(root, 'vn/script.mjs')));
  const es = parseScript(await fs.readFile(path.join(root, 'gamedata/es_ES/story/obt/guide/beg/0_welcome_to_guide.txt'), 'utf8'));
  const en = parseScript(await fs.readFile(path.join(root, 'vn/sources/en/obt/guide/beg/0_welcome_to_guide.txt'), 'utf8'));
  const decisions = es.filter((step) => step.command === 'decision');
  const answers = Object.fromEntries(decisions.map((step) => [step.line, step.args.values.includes(';') ? '3' : '1']));
  const expected = buildTimeline(es, answers);
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({
      ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}),
      args: ['--no-sandbox'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    await page.goto(base + '#/main/chapter-0/prologue-1');
    await page.waitForFunction(() => !document.getElementById('begin').disabled);
    assert.match(await page.locator('#begin').innerText(), /Comenzar/);
    await page.screenshot({ path: path.join(output, 'cover.png') });
    await page.locator('#begin').click();
    await page.waitForFunction(() => document.querySelector('#stage').dataset.line === '3');
    await page.locator('#dialogue').click();
    assert.equal(await page.locator('#text').innerText(), 'Ah, eres tú.');
    await page.locator('#settings').click();
    await page.locator('#speed').selectOption('0');
    await page.locator('#motion').check();
    await page.locator('#settings-dialog .close').click();

    const seek = async (line) => {
      for (let n = 0; n < 150; n++) {
        const current = Number(await page.locator('#stage').getAttribute('data-line'));
        if (current === line) return;
        const choices = page.locator('#choices button');
        if (await choices.count()) await choices.last().click();
        else await page.locator('#next').click();
        await page.waitForFunction((old) => Number(document.querySelector('#stage').dataset.line) !== old, current);
      }
      throw new Error('Could not reach line ' + line);
    };
    // Compare every dialogue and choice on one complete path with the source.
    let count = 0;
    for (const step of expected) {
      await seek(step.line);
      if (step.kind === 'dialogue') {
        assert.equal(await page.locator('#text').innerText(), step.text.replaceAll('{@nickname}', 'Doctor'));
        count++;
      } else if (step.kind === 'choice') {
        assert.deepEqual(await page.locator('#choices button').allTextContents(), step.options.map((o) => o.text));
      }
      if (step.text.startsWith('Siempre te pones')) {
        await page.waitForFunction(() => [...document.querySelectorAll('#characters img')].every((img) => img.complete && img.naturalWidth > 0));
        assert.equal(await page.locator('#characters img.dim').count(), 1);
        await page.screenshot({ path: path.join(output, 'dialogue.png') });
      }
      if (step.line === decisions[2].line) {
        await page.screenshot({ path: path.join(output, 'choices.png') });
        // Switch languages while choices are pending; the same values stay usable.
        await page.locator('#language').selectOption('en');
        assert.deepEqual(await page.locator('#choices button').allTextContents(), en.find((item) => item.line === step.line).args.options.split(';'));
        await page.locator('#language').selectOption('es');
      }
      if (step.text === 'Ah, em, hola.') {
        await page.locator('#language').selectOption('en');
        assert.equal(await page.locator('#text').innerText(), en.find((item) => item.line === step.line).text);
        await page.reload();
        await page.waitForFunction(() => !document.getElementById('begin').disabled);
        assert.match(await page.locator('#begin').innerText(), /Continue/);
        await page.locator('#begin').click();
        assert.equal(Number(await page.locator('#stage').getAttribute('data-line')), step.line);
        await page.locator('#language').selectOption('es');
        assert.equal(await page.locator('#text').innerText(), step.text);
        await page.locator('#back').click();
        assert.equal(await page.locator('#choices button').count(), 3);
        await page.locator('#choices button').last().click();
      }
    }
    assert.equal(await page.locator('#ending').isVisible(), true);
    assert.equal(await page.locator('#progress').getAttribute('value'), '100');
    await page.locator('#history').click();
    assert.equal(await page.locator('#history-list button').count(), expected.length - 1);
    await page.locator('#history-list button').nth(1).click();
    assert.equal(await page.locator('#text').innerText(), expected[1].text);
    await page.locator('#settings').click();
    await page.locator('#restart').click();
    assert.equal(await page.locator('#text').innerText(), 'Ah, eres tú.');

    // Phone layout at a GitHub Pages subpath, with saved-state restoration.
    const mobile = await context.newPage();
    mobile.on('pageerror', (error) => errors.push(error.message));
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.goto(base + '#/main/chapter-0/prologue-1');
    await mobile.locator('#begin:not(:disabled)').click();
    for (let i = 0; i < 35; i++) await mobile.locator('#next').click();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
    const box = await mobile.locator('#dialogue').boundingBox();
    assert.ok(box.width <= 390 && box.x >= 0);

    // Exercise actual waits, fades, audio decoding, and every sprite/CG, with
    // motion enabled. This is separate from the fast text/branch comparison.
    const animatedContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
    await animatedContext.addInitScript(() => {
      localStorage.setItem('arknights.vn.v1', JSON.stringify({ v: 1, stories: {}, preferences: { speed: 0, motion: false } }));
      const NativeAudio = window.Audio;
      window.__vnAudio = [];
      window.Audio = function (...args) {
        const audio = new NativeAudio(...args);
        audio.addEventListener('canplay', () => { audio.dataset.decoded = 'true'; });
        window.__vnAudio.push(audio);
        return audio;
      };
    });
    const animated = await animatedContext.newPage();
    animated.on('pageerror', (error) => errors.push(error.message));
    await animated.goto(base + '#/main/chapter-0/prologue-1');
    await animated.locator('#begin:not(:disabled)').click();
    await animated.locator('#sound').click();
    await animated.waitForFunction(() => window.__vnAudio.some((audio) => audio.readyState >= 2 && !audio.paused), null, { timeout: 30000 });
    await animated.locator('#auto').click();
    await animated.waitForFunction(() => document.querySelector('#stage').dataset.line === '8');
    await animated.locator('#auto').click();
    await animated.locator('#back').click();
    const checkedAssets = new Set();
    for (const step of expected) {
      await animated.waitForFunction((line) => Number(document.querySelector('#stage').dataset.line) === line, step.line);
      assert.deepEqual(await animated.locator('#characters img').evaluateAll((imgs) => imgs.map((img) => img.dataset.asset)), step.state.characters);
      assert.equal(await animated.locator('#blocker').evaluate((el) => Number(el.style.opacity)), step.state.blocker.alpha);
      for (const name of [step.state.background?.name, step.state.image?.name, ...step.state.characters].filter(Boolean)) {
          if (checkedAssets.has(name)) continue;
          const image = animated.locator(`.scene img[data-asset="${name}"]`).last();
          await image.evaluate((img) => new Promise((resolve, reject) => {
            if (img.complete && img.naturalWidth) return resolve();
            const timeout = setTimeout(() => reject(new Error('Image failed: ' + img.dataset.asset)), 25000);
            img.addEventListener('load', () => { clearTimeout(timeout); resolve(); }, { once: true });
          }));
          checkedAssets.add(name);
      }
      if (step.text === 'Sé que nos llevarás a la victoria.') {
        assert.equal(await animated.locator('#image img').count(), 0, 'intro CGs must not cover later flashbacks');
        await animated.screenshot({ path: path.join(output, 'flashback.png') });
      }
      if (step.kind === 'choice') {
        assert.equal(await animated.locator('#auto').getAttribute('aria-pressed'), 'false');
        await animated.locator('#choices button').last().click();
      } else if (step.kind !== 'end') await animated.locator('#next').click();
    }
    assert.ok(checkedAssets.size >= 16, 'all chapter artwork was decoded');
    assert.ok(await animated.evaluate(() => window.__vnAudio.some((audio) => audio.dataset.decoded === 'true')));
    assert.equal(await animated.locator('#status').innerText(), '');
    console.log(`Animated playback passed: ${checkedAssets.size} distinct images, timed transitions, decoded audio, and autoplay.`);
    await animatedContext.close();

    // A failed script request is visible and the retry button can recover.
    const failure = await context.newPage();
    await failure.route('**/sources/en/obt/guide/beg/0_welcome_to_guide.txt', (route) => route.fulfill({ status: 503, body: '' }));
    await failure.goto(base + '#/main/chapter-0/prologue-1');
    await failure.locator('#load-notice:visible').waitFor();
    assert.equal(await failure.locator('#language option[value="en"]').evaluate((o) => o.disabled), true);
    assert.equal(await failure.locator('#begin').isEnabled(), true);
    await failure.unroute('**/sources/en/obt/guide/beg/0_welcome_to_guide.txt');
    await failure.locator('#load-retry').click();
    await failure.waitForFunction(() => document.getElementById('begin').textContent !== 'Cargando…' && !document.getElementById('begin').disabled);
    assert.match(await failure.locator('#begin').innerText(), /lectura/);
    assert.equal(await failure.locator('#language option[value="en"]').evaluate((o) => !o.disabled), true);
    assert.deepEqual(errors, []);
    console.log(`Browser passed: ${count} dialogue lines, six choices, language/branch preservation, resume, history, restart, mobile, subpath, and retry. Screenshots: ${output}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
