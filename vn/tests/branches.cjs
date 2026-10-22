// Branch-end markers and highlighted choices support manual review through history.
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
  const { parseScript, buildTimeline, choiceReviewRanges } = await import('../script.mjs');
  const id = 'obt/guide/beg/0_welcome_to_guide';
  const source = await fs.readFile(path.join(root, `gamedata/es_ES/story/${id}.txt`), 'utf8');
  const english = await fs.readFile(path.join(root, `vn/sources/en/${id}.txt`), 'utf8');
  const commands = parseScript(source);
  const answers = Object.fromEntries(commands.filter((c) => c.command === 'decision').map((c) => [c.line, c.args.values.split(';')[0]]));
  const choice = commands.find((c) => c.command === 'decision' && c.args.values === '1;2;3');
  const joinLine = choiceReviewRanges(commands).get(choice.line).joinLine;
  const paths = ['1', '2', '3'].map((answer) => buildTimeline(commands, { ...answers, [choice.line]: answer })
    .filter((step) => step.line > choice.line && step.line < joinLine));
  const seed = (line = choice.line) => ({ v: 2,
    preferences: { language: 'es', speed: 0, motion: true, autoSpeed: 3 }, groups: {
      'main:main_0': { resume: id, updated: 1, stories: { [id]: { line, answers, read: false, updated: 1 } } },
      'main:main_1': { resume: 'obt/main/level_main_01-01_beg', updated: 2,
        stories: { 'obt/main/level_main_01-01_beg': { line: 10, answers: {}, read: false, updated: 2 } } },
    } });
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await playwright.chromium.launch({ ...(process.env.VN_BROWSER_PATH ? { executablePath: process.env.VN_BROWSER_PATH } : {}), args: ['--no-sandbox'] });
    const errors = [], base = `http://127.0.0.1:${server.address().port}/arknights/vn/`;
    const route = '#/main/chapter-0/prologue-1';
    const makePage = async (saved, options = {}) => {
      const context = await browser.newContext(options);
      await context.route(/^https:\/\//, (route) => route.abort());
      await context.addInitScript((saved) => {
        if (!localStorage.getItem('arknights.vn.v2')) localStorage.setItem('arknights.vn.v2', JSON.stringify(saved));
        Object.defineProperty(document, 'fullscreenEnabled', { value: false });
      }, saved);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(error.message));
      return page;
    };
    const at = (page, line) => page.waitForFunction((line) => document.querySelector('#stage').dataset.line === String(line)
      && document.querySelector('#stage').getAttribute('aria-busy') === 'false', line);
    const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('arknights.vn.v2')));
    const notes = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('arknights.translationReviews.v1') || '[]'));
    const open = async (page, url = route) => {
      await page.goto(base + url);
      await page.locator('#begin:not(:disabled)').click();
      await page.locator('#dialogue:visible').waitFor();
    };
    const saveNote = async (page, step) => {
      await page.locator('#review-note').click();
      assert.equal(await page.locator('#review-spanish').textContent(), source.split(/\r?\n/)[step.line - 1].replace(/^\[[^\]]+\]/, ''));
      assert.equal(await page.locator('#review-english').textContent(), english.split(/\r?\n/)[step.line - 1].replace(/^\[[^\]]+\]/, ''));
      await page.locator('#review-comment').fill(`Review alternative at ${step.line}`);
      await page.locator('#review-save').click();
      assert.ok((await notes(page)).some((note) => note.lines[0] === step.line));
    };

    const marked = (page) => page.locator('#dialogue-panel').evaluate((el) => el.classList.contains('branch-end'));
    const returnToChoice = async (page) => {
      await page.locator('#history').click();
      await page.locator('.history-choice').last().click();
      await at(page, choice.line);
      assert.equal(await marked(page), false, 'returning to the choice clears the branch-end marker');
    };
    const page = await makePage(seed(), { viewport: { width: 1440, height: 900 } });
    await page.clock.install({ time: 0 });
    await open(page); await at(page, choice.line);
    await page.clock.pauseAt(100000);
    assert.equal(await page.locator('#reviewBranches, #branch-review').count(), 0, 'there is no branch setting or panel');
    await page.locator('#choices button').first().click(); await at(page, paths[0][0].line);
    assert.equal(await marked(page), false);
    for (const step of paths[0].slice(1)) { await page.locator('#next').click(); await at(page, step.line); }
    assert.equal(await marked(page), true);
    assert.equal(await page.locator('#dialogue').getAttribute('title'), 'Fin de la rama');
    assert.equal(await page.locator('#dialogue').getAttribute('aria-describedby'), 'branch-end-description');
    const purple = 'rgb(196, 167, 255)', amber = 'rgb(255, 210, 134)';
    assert.equal(await page.locator('#dialogue').evaluate((el) => getComputedStyle(el).borderLeftColor), purple);
    await page.screenshot({ path: path.join(output, 'branch-marker-desktop.png'), fullPage: true });
    await saveNote(page, paths[0].at(-1));
    assert.equal(await marked(page), true, 'saving a note preserves the branch marker');
    assert.deepEqual(await page.locator('#dialogue').evaluate((el) => {
      const style = getComputedStyle(el); return [style.borderLeftColor, style.borderRightColor];
    }), [amber, purple], 'notes and branches both remain visible');
    await page.screenshot({ path: path.join(output, 'branch-marker-with-note.png'), fullPage: true });

    const beforeHistory = (await saved(page)).groups;
    await page.locator('#history').click();
    assert.equal(await page.locator('.history-choice').count(), commands.filter((c) => c.command === 'decision' && c.line <= choice.line).length);
    const doctor = page.locator('.history-choice').last();
    assert.match(await doctor.getAttribute('aria-label'), /^Volver a esta decisión: Doctor/);
    assert.equal(await doctor.locator('strong').evaluate((el) => getComputedStyle(el).color), purple);
    assert.equal(await page.locator('#history-list').evaluate((list) => Math.abs(list.scrollHeight - list.scrollTop - list.clientHeight) < 1), true);
    await page.screenshot({ path: path.join(output, 'branch-history-desktop.png') });
    await page.locator('#history-dialog .close').click();
    assert.deepEqual((await saved(page)).groups, beforeHistory, 'opening history does not change progress');

    // Auto advances normally across the marked line and keeps the selected answer.
    const answersBefore = (await saved(page)).groups['main:main_0'].stories[id].answers;
    const delay = (1600 + Array.from(await page.locator('#text').textContent()).length * 45) / 3;
    await page.locator('#auto').click(); await page.clock.runFor(Math.ceil(delay) + 1);
    assert.ok(Number(await page.locator('#stage').getAttribute('data-line')) >= joinLine);
    assert.equal(await marked(page), false);
    assert.equal(await page.locator('#auto').getAttribute('aria-pressed'), 'true', 'branch markers never pause Auto');
    await page.locator('#auto').click();
    assert.deepEqual((await saved(page)).groups['main:main_0'].stories[id].answers, answersBefore);
    assert.equal(await page.locator('#dialogue').getAttribute('aria-describedby'), null);

    const other = (await saved(page)).groups['main:main_1'];
    await returnToChoice(page);
    await page.locator('#choices button').nth(1).click(); await at(page, paths[1][0].line);
    const switched = (await saved(page)).groups['main:main_0'].stories[id];
    assert.equal(switched.answers[choice.line], '2');
    assert.equal(switched.answers[146], '1');
    assert.equal(switched.answers[188], undefined);
    assert.deepEqual((await saved(page)).groups['main:main_1'], other);
    await saveNote(page, paths[1][0]);
    assert.equal((await notes(page)).length, 2, 'alternative notes retain distinct physical source lines');
    for (const step of paths[1].slice(1)) { await page.locator('#next').click(); await at(page, step.line); }
    assert.equal(await marked(page), true, 'the second branch also has an end marker');
    await page.locator('#language').selectOption('en');
    assert.equal(await page.locator('#dialogue').getAttribute('title'), 'End of branch');
    assert.equal(await page.locator('#branch-end-description').textContent(), 'End of branch');
    await page.locator('#review-toggle').click();
    assert.equal(await marked(page), true, 'comparing a translation preserves the marker');
    await returnToChoice(page);
    await page.locator('#choices button').nth(2).click(); await at(page, paths[2][0].line);
    for (const step of paths[2].slice(1)) { await page.locator('#next').click(); await at(page, step.line); }
    assert.equal(await marked(page), true, 'the third branch also has an end marker');
    await page.reload(); await page.locator('#begin:not(:disabled)').click();
    assert.equal(await marked(page), true, 'the marker is derived again when resuming');
    assert.equal((await notes(page)).length, 2);
    await page.locator('#history').click();
    const englishChoice = page.getByRole('button', { name: /^Return to this choice: Doctor/ }).last();
    await englishChoice.focus(); await page.keyboard.press('Enter'); await at(page, choice.line);
    await page.locator('#choices button').nth(2).click();
    for (const step of paths[2].slice(1)) { await page.locator('#next').click(); await at(page, step.line); }
    await page.locator('#history').focus(); await page.keyboard.press('Space');
    assert.equal(await page.locator('#history-dialog').isVisible(), false, 'Space still advances with a control focused');
    assert.equal(await marked(page), false);

    const mobile = await makePage(seed(paths[0].at(-1).line), { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await open(mobile);
    assert.equal(await marked(mobile), true);
    await mobile.screenshot({ path: path.join(output, 'branch-marker-mobile.png'), fullPage: true });
    for (const width of [390, 280]) {
      await mobile.setViewportSize({ width, height: 844 });
      await mobile.locator('#history').tap();
      assert.equal(await mobile.locator('#history-list').evaluate((el) => el.scrollWidth <= el.clientWidth), true);
      await mobile.screenshot({ path: path.join(output, `branch-history-mobile-${width}.png`) });
      await mobile.locator('#history-dialog .close').tap();
    }
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.locator('#fullscreen').tap();
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await mobile.setViewportSize(viewport);
      assert.equal(await marked(mobile), true);
      await mobile.screenshot({ path: path.join(output, `branch-marker-fullscreen-${viewport.width}.png`) });
    }
    await mobile.locator('#history').tap(); await mobile.locator('.history-choice').last().tap();
    await at(mobile, choice.line);
    await mobile.evaluate(() => { location.hash = '#/'; });
    await mobile.locator('.category-card').first().waitFor();
    assert.equal(await marked(mobile), false);

    const shared = await makePage(seed(313));
    await open(shared); await shared.locator('#choices button').first().click();
    assert.equal(await marked(shared), false, 'identical continuations have no branch-end marker');
    await shared.locator('#history').click();
    assert.equal(await shared.locator('.history-choice').last().isVisible(), true, 'the Doctor choice is still highlighted');

    const terminalId = 'obt/main/level_main_04-01_beg';
    const terminalSource = parseScript(await fs.readFile(path.join(root, `gamedata/es_ES/story/${terminalId}.txt`), 'utf8'));
    const terminalAnswers = Object.fromEntries(terminalSource.filter((c) => c.command === 'decision').map((c) => [c.line, c.args.values.split(';')[0]]));
    const terminalLine = buildTimeline(terminalSource, terminalAnswers).at(-2).line;
    const terminalSeed = { v: 2, preferences: { language: 'es', speed: 0, motion: true }, groups: {
      'main:main_4': { resume: terminalId, stories: { [terminalId]: { line: terminalLine, answers: terminalAnswers, read: false } } },
    } };
    const terminal = await makePage(terminalSeed);
    await open(terminal, '#/main/chapter-4/4-1-before');
    assert.equal(await marked(terminal), true, 'a branch that reaches the ending marks its last dialogue');
    await terminal.locator('#next').click(); await terminal.locator('#ending:visible').waitFor();
    assert.equal((await saved(terminal)).groups['main:main_4'].stories[terminalId].read, true);
    assert.deepEqual(errors, []);
    console.log('Branch markers passed: all alternatives, noted lines, Doctor choices in history, manual return, unchanged Auto, source notes, localization, keyboard, progress isolation and desktop/mobile/fullscreen layouts.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
