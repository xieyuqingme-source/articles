// Targeted, independent headless regression for ranking zoom, board-only and fullscreen.
// node scripts/test_ranking_view_browser.cjs [generated-site] [evidence-directory]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const site = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(__dirname, '..', '.local-checks', 'ranking-view-browser'));
const origin = 'http://127.0.0.1:48732';
const testPattern = process.env.VIEW_TEST_MATCH ? new RegExp(process.env.VIEW_TEST_MATCH) : null;
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Existing Playwright runtime required; set PLAYWRIGHT_MODULE.');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const report = { startedAt: new Date().toISOString(), site, checks: [], screenshots: [], downloads: [], pageErrors: [], consoleErrors: [], externalRequests: [], notes: ['Independent headless Chrome and fresh nonpersistent contexts; no user browser/profile or existing preview server is controlled.', 'All HTTP responses come from the specified local generated files through request interception.', 'Touch gestures use CDP emulation; fullscreen success is checked both natively where available and with an explicit instrumented standard API.'] };
const contexts = [];
let browser;

function resource(url) {
  const relative = decodeURIComponent(new URL(url).pathname).replace(/^[/\\]+/, '');
  let target = path.resolve(site, relative);
  const within = path.relative(site, target);
  if (within.startsWith('..') || path.isAbsolute(within) || within.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('Forbidden');
  if (relative === 'favicon.ico' && !fs.existsSync(target)) return { status: 204, body: Buffer.alloc(0) };
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  return { status: 200, contentType: mime[path.extname(target)] || 'application/octet-stream', body: fs.readFileSync(target) };
}
async function check(name, action) {
  if (testPattern && !testPattern.test(name)) return;
  const started = Date.now();
  try { const detail = await action(); report.checks.push({ name, passed: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack || String(error) }); console.error('FAIL ' + name + ': ' + error.message); throw error; }
}
async function context(options = {}) {
  const { theme = 'light', fullscreenMode, ...browserOptions } = options;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, acceptDownloads: true, ...browserOptions }); contexts.push(ctx);
  await ctx.addInitScript(theme => { try { localStorage.setItem('xieyuqing-blog-theme', theme); } catch (_) {} }, theme);
  if (fullscreenMode) await ctx.addInitScript(mode => {
    let active = null;
    window.__viewQaFullscreenCalls = [];
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => active });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => mode !== 'unavailable' });
    const notify = () => document.dispatchEvent(new Event('fullscreenchange'));
    Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, writable: true, value: mode === 'unavailable' ? undefined : function() {
      window.__viewQaFullscreenCalls.push({ documentElement: this === document.documentElement, userActivation: navigator.userActivation.isActive });
      if (mode === 'reject') return Promise.reject(new DOMException('Deliberate headless acceptance rejection', 'NotAllowedError'));
      active = this; notify(); return Promise.resolve();
    } });
    document.exitFullscreen = function() { active = null; notify(); return Promise.resolve(); };
  }, fullscreenMode);
  await ctx.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) { try { return route.fulfill(resource(url)); } catch { return route.fulfill({ status: 404, body: 'Missing local asset: ' + new URL(url).pathname }); } }
    if (/^(data|blob):/.test(url)) return route.continue(); report.externalRequests.push(url); return route.abort();
  });
  ctx.on('page', page => {
    page.on('dialog', dialog => dialog.accept()); page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error') report.consoleErrors.push(entry.text()); });
  });
  return ctx;
}
async function ready(ctx) {
  const page = await ctx.newPage(); await page.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await page.locator('#ranking-app').waitFor({ state: 'visible' });
  await page.locator('.board-viewport').waitFor(); await page.locator('#ranking-canvas').waitFor(); return page;
}
async function frame(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function shot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, image => image.decode().catch(() => {}))); });
  await page.screenshot({ path: path.join(output, name), fullPage: !(await page.locator('dialog[open]').count()), animations: 'disabled' }); report.screenshots.push(name);
}
async function presentation(page, enabled) { if ((await page.locator('body').evaluate(body => body.classList.contains('presentation'))) !== enabled) await page.locator('#presentation-toggle').click(); }
async function zoomValue(page) { return parseFloat(await page.locator('#view-zoom-value').textContent()); }
async function setZoom(page, value) {
  await page.locator('#view-zoom-reset').click();
  for (let attempt = 0; attempt < 12; attempt++) {
    const current = await zoomValue(page); if (current === value) { await frame(page); return; }
    await page.locator(current < value ? '#view-zoom-in' : '#view-zoom-out').click();
  }
  assert.equal(await zoomValue(page), value);
}
async function storedState(page) { return page.evaluate(async () => await window.RankingStorage.createStore().load()); }
async function canvasMetrics(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.board-viewport'), canvas = document.querySelector('#ranking-canvas'), vp = viewport.getBoundingClientRect(), box = canvas.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(canvas).transform);
    return { zoom: parseFloat(document.querySelector('#view-zoom-value').textContent), scale: matrix.a, overflowX: getComputedStyle(viewport).overflowX, overflowY: getComputedStyle(viewport).overflowY,
      clientWidth: viewport.clientWidth, clientHeight: viewport.clientHeight, scrollWidth: viewport.scrollWidth, scrollHeight: viewport.scrollHeight, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop,
      canvasWidth: box.width, canvasHeight: box.height, offsetWidth: canvas.offsetWidth, canvasRightInScroll: box.right - vp.left - viewport.clientLeft + viewport.scrollLeft, canvasBottomInScroll: box.bottom - vp.top - viewport.clientTop + viewport.scrollTop,
      containsTitle: canvas.contains(document.querySelector('#display-title')), containsAllRows: [...document.querySelectorAll('.tier-row')].every(row => canvas.contains(row)), rows: document.querySelectorAll('.tier-row').length };
  });
}
async function reachCanvasEdges(page) {
  await page.locator('.board-viewport').scrollIntoViewIfNeeded();
  await page.evaluate(() => { const e = document.querySelector('.board-viewport'); e.scrollTop = 0; e.scrollLeft = 0; }); await frame(page);
  const initial = await canvasMetrics(page); assert(initial.containsTitle && initial.containsAllRows); assert.equal(initial.rows, 5);
  assert(['auto', 'scroll'].includes(initial.overflowX)); assert(['auto', 'scroll'].includes(initial.overflowY));
  assert(initial.canvasRightInScroll <= initial.scrollWidth + 4, 'Scaled content right edge must fit its scroll range.'); assert(initial.canvasBottomInScroll <= initial.scrollHeight + 4, 'Scaled content bottom edge must fit its scroll range.');
  const title = await page.evaluate(() => { const vp = document.querySelector('.board-viewport').getBoundingClientRect(), title = document.querySelector('#display-title').getBoundingClientRect(); return { viewportTop: vp.top, titleTop: title.top, titleBottom: title.bottom, viewportBottom: vp.bottom }; });
  assert(title.titleTop >= title.viewportTop - 3); assert(title.titleBottom <= title.viewportBottom + 3);
  await page.evaluate(() => { const e = document.querySelector('.board-viewport'); e.scrollTop = e.scrollHeight; e.scrollLeft = e.scrollWidth; }); await frame(page);
  const last = await page.evaluate(() => { const vp = document.querySelector('.board-viewport').getBoundingClientRect(), row = [...document.querySelectorAll('.tier-row')].at(-1).getBoundingClientRect(); return { viewportTop: vp.top, viewportBottom: vp.bottom, viewportLeft: vp.left, viewportRight: vp.right, rowBottom: row.bottom, rowRight: row.right }; });
  assert(last.rowBottom <= last.viewportBottom + 3 && last.rowBottom > last.viewportTop, 'Last row bottom must be reachable.'); assert(last.rowRight <= last.viewportRight + 3 && last.rowRight > last.viewportLeft, 'Last row right edge must be reachable.');
  return { initial, last, final: await canvasMetrics(page) };
}
async function downloadPng(page, filename) {
  await presentation(page, false);
  await page.evaluate(() => { window.__viewQaTextColors = []; window.__viewQaOriginalFillText = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__viewQaTextColors.push({ text: String(text), color: this.fillStyle }); return window.__viewQaOriginalFillText.call(this, text, ...args); }; });
  const pending = page.waitForEvent('download'); await page.locator('#png-export').click(); const item = await pending; assert.equal(await item.failure(), null); const destination = path.join(output, filename); await item.saveAs(destination); report.downloads.push(filename);
  const colors = await page.evaluate(() => { CanvasRenderingContext2D.prototype.fillText = window.__viewQaOriginalFillText; return window.__viewQaTextColors; });
  const png = fs.readFileSync(destination), pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data, digest = await crypto.subtle.digest('SHA-256', data);
    return { width: canvas.width, height: canvas.height, pixelHash: [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''), corner: Array.from(data.slice(0, 4)) };
  }, png.toString('base64'));
  return { ...pixels, textColors: [...new Set(colors.map(entry => entry.color))] };
}
async function noDialog(page) { assert.equal(await page.locator('dialog[open]').count(), 0); }
async function useFixture(page, data) {
  await presentation(page, false); await page.locator('#json-file').setInputFiles({ name: 'view-acceptance-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.waitForFunction(title => document.querySelector('#ranking-title').value === title, data.title); await presentation(page, true);
}
function fixture() {
  return { version: 3, templateId: 'food', title: '缩放拖拽坐标验收', skin: 'classic', rows: [{ id: 'view-a', name: '夯', color: '#f28b82', itemIds: ['view-one', 'view-two'] }, { id: 'view-b', name: '顶级', color: '#f6b26b', itemIds: [] }], pool: [], items: Object.fromEntries([['view-one', '缩放一'], ['view-two', '缩放二']].map(([id, name]) => [id, { id, name, image: null, crop: null, art: null }])) };
}
async function dragAtZoom(page, zoom, ctx) {
  await setZoom(page, zoom); await page.evaluate(() => { const e = document.querySelector('.board-viewport'); e.scrollTop = 0; e.scrollLeft = 0; }); await frame(page);
  const card = page.locator('[data-item-id="view-one"] .card-main'), target = page.locator('[data-row-id="view-b"] .item-list');
  const from = await card.boundingBox(), to = await target.boundingBox(), vp = await page.locator('.board-viewport').boundingBox(); assert(from && to && vp);
  const start = { x: from.x + from.width / 2, y: from.y + Math.min(from.height / 2, 24 * zoom / 100) }, end = { x: Math.min(vp.x + vp.width - 24, to.x + 40 * zoom / 100), y: to.y + 24 * zoom / 100 };
  assert(end.y < vp.y + vp.height - 4, 'The direct cross-row target must be visible for this coordinate test.');
  if (ctx) {
    const session = await ctx.newCDPSession(page);
    try {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] });
      for (let i = 1; i <= 18; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 18, y: start.y + (end.y - start.y) * i / 18, id: 0 }] });
      await page.waitForTimeout(60); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally { await session.detach(); }
  } else { await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 18 }); await page.waitForTimeout(60); await page.mouse.up(); }
  await page.waitForFunction(() => document.querySelector('[data-row-id="view-b"] [data-item-id="view-one"]')); await noDialog(page); assert.equal(await page.locator('.rank-card').count(), 2);
  await page.waitForTimeout(500);
  if (ctx) {
    const box = await card.boundingBox(), point = { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 24 * zoom / 100) }, session = await ctx.newCDPSession(page);
    try { for (let tap = 0; tap < 2; tap++) { await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 0 }] }); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); if (!tap) await page.waitForTimeout(75); } }
    finally { await session.detach(); }
  } else await card.dblclick();
  await page.locator('#item-dialog[open]').waitFor(); assert.equal(await page.locator('#item-name').inputValue(), '缩放一'); await page.locator('#item-cancel').click();
  return { zoom, start, end };
}
async function controlsAccessible(page) {
  // The module schedules its size and scroll update through requestAnimationFrame.
  await frame(page);
  const detail = await page.evaluate(() => {
    const rect = selector => { const element = document.querySelector(selector), box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom, right: box.right, display: getComputedStyle(element).display }; };
    return { scrollX, scrollY, innerWidth, innerHeight, htmlScrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, bodyClass: document.body.className,
      fullscreen: rect('#view-fullscreen'), presentation: rect('#presentation-toggle'), boardViewport: rect('.board-viewport') };
  });
  report.controlGeometry ||= []; report.controlGeometry.push(detail);
  for (const [selector, box] of [['#view-fullscreen', detail.fullscreen], ['#presentation-toggle', detail.presentation]]) {
    assert(box.display !== 'none' && box.width > 0 && box.height > 0); assert(box.x >= -2 && box.y >= -2 && box.right <= detail.innerWidth + 2 && box.bottom <= detail.innerHeight + 2, selector + ' must remain within the screen: ' + JSON.stringify(detail));
  }
}
async function run() {
  fs.mkdirSync(output, { recursive: true }); const html = fs.readFileSync(path.join(site, 'game', 'ranking', 'index.html'), 'utf8'); assert(html.includes('view-zoom-in'), 'Build the view controls before this test.');
  report.fileHashes = {}; for (const file of ['game/ranking/index.html', 'assets/ranking.js', 'assets/ranking-view.js', 'assets/game.css', 'assets/ranking-skins.css', 'assets/ranking-export.js', 'assets/ranking-model.js']) report.fileHashes[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex');
  if (testPattern && process.env.VIEW_RESUME_REPORT === '1') {
    const previous = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8')); assert.deepEqual(previous.fileHashes, report.fileHashes, 'Resume requires the same exact generated product files.');
    report.startedAt = previous.startedAt; report.resumedAt = new Date().toISOString(); report.checks = previous.checks.filter(item => item.passed && !testPattern.test(item.name)); report.screenshots = previous.screenshots; report.downloads = previous.downloads; report.controlGeometry = previous.controlGeometry || []; report.notes.push('Successful earlier checks were retained only after verifying identical generated-file SHA256 hashes; resumed filter: ' + process.env.VIEW_TEST_MATCH);
  }
  try {
    browser = await playwright.chromium.launch({ headless: true, executablePath: chrome }); report.browserVersion = browser.version();
    const lightContext = await context(), page = await ready(lightContext);
    await check('new defaults use 浙江干挑面 without changing the built-in asset identity', async () => { assert.equal(await page.locator('[data-item-id="food-zhejiang-dry-noodles"] .card-name').textContent(), '浙江干挑面'); assert.equal(await page.locator('.tier-row').count(), 5); assert.equal(await page.locator('.rank-card').count(), 34); });
    await check('zoom clamps to 75–200%, and 150/200% keep the title and final row fully reachable', async () => {
      await setZoom(page, 75); await page.locator('#view-zoom-out').evaluate(button => button.click()); assert.equal(await zoomValue(page), 75);
      const detail = {}; for (const zoom of [150, 200]) { await setZoom(page, zoom); detail[zoom] = await reachCanvasEdges(page); assert(Math.abs(detail[zoom].initial.scale - zoom / 100) < 0.001); await shot(page, `desktop-${zoom}-last-row.png`); }
      await page.locator('#view-zoom-in').evaluate(button => button.click()); assert.equal(await zoomValue(page), 200); return detail;
    });
    await check('fit width is bounded and reset restores exactly 100%', async () => {
      await page.locator('#view-fit-width').click(); await frame(page); const fit = await canvasMetrics(page); assert(fit.zoom >= 75 && fit.zoom <= 200); assert(fit.canvasWidth <= fit.clientWidth + 3 || fit.zoom === 75, 'Fit width must fit unless the 75% minimum limits it.');
      await page.locator('#view-zoom-reset').click(); await frame(page); const reset = await canvasMetrics(page); assert.equal(reset.zoom, 100); assert(Math.abs(reset.scale - 1) < 0.001); return { fit, reset };
    });
    await check('board-only mode keeps a nonempty pool intact, warns that it can be restored, and restores it', async () => {
      await presentation(page, false); await page.locator('#text-name').fill('仅看榜单验收待选项'); await page.locator('#add-text-form button').click(); await page.waitForFunction(() => /已自动保存/.test(document.querySelector('#save-status').textContent));
      const before = await storedState(page), count = await page.locator('#candidate-pool .rank-card').count(); assert(count > 0); await presentation(page, true);
      await page.locator('#view-board-only').click(); assert.equal(await page.locator('#view-board-only').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('.pool-panel').isVisible(), false); assert.equal(await page.locator('#candidate-pool .rank-card').count(), count);
      assert.match(await page.locator('body').innerText(), /待选[^\n]*(?:隐藏|保留|恢复)|(?:隐藏|保留|恢复)[^\n]*待选/); assert.deepEqual(await storedState(page), before); await shot(page, 'desktop-board-only-with-preserved-pool.png');
      await page.locator('#view-board-only').click(); assert.equal(await page.locator('#view-board-only').getAttribute('aria-pressed'), 'false'); assert(await page.locator('.pool-panel').isVisible()); assert.equal(await page.locator('#candidate-pool .rank-card').count(), count); assert.deepEqual(await storedState(page), before);
      return { poolCount: count, storedItems: Object.keys(before.items).length };
    });
    await check('light classic PNG pixels are identical at 100% and 200% zoom after toggling board-only view', async () => {
      await setZoom(page, 100); const at100 = await downloadPng(page, 'classic-light-100.png'); await setZoom(page, 200); await page.locator('#view-board-only').click(); const at200 = await downloadPng(page, 'classic-light-200-board-only.png');
      assert.deepEqual(at100, at200); assert.deepEqual(at100.corner, [247, 245, 238, 255]); assert(at100.textColors.includes('#171717')); await presentation(page, true); await shot(page, 'classic-light-200.png'); await page.locator('#view-board-only').click(); return at100;
    });
    await check('mouse dragging and double-click editing preserve viewport coordinates at 150% and 200%', async () => { const detail = []; for (const zoom of [150, 200]) { await useFixture(page, fixture()); detail.push(await dragAtZoom(page, zoom)); } await shot(page, 'desktop-200-after-drag.png'); return detail; });
    const darkContext = await context({ theme: 'dark' }), dark = await ready(darkContext);
    await check('classic dark screen uses black background, dark gray rows and readable light names', async () => {
      const colors = await dark.evaluate(() => { const css = selector => getComputedStyle(document.querySelector(selector)); return { rootTheme: document.documentElement.dataset.theme, body: css('body').backgroundColor, main: css('.ranking-main').backgroundColor, row: css('.tier-row').backgroundColor, name: css('.card-name').color, border: css('.ranking-board').borderTopColor }; });
      assert.equal(colors.rootTheme, 'dark'); assert.equal(colors.body, 'rgb(0, 0, 0)'); assert.equal(colors.main, 'rgb(0, 0, 0)'); assert.equal(colors.row, 'rgb(32, 32, 32)'); assert.equal(colors.name, 'rgb(241, 241, 241)'); assert.equal(colors.border, 'rgb(136, 136, 136)'); await shot(dark, 'classic-dark-default.png'); return colors;
    });
    await check('dark classic PNG keeps black background and light text, independently of view zoom', async () => {
      await setZoom(dark, 100); const at100 = await downloadPng(dark, 'classic-dark-100.png'); await setZoom(dark, 200); const at200 = await downloadPng(dark, 'classic-dark-200.png'); assert.deepEqual(at100, at200); assert.deepEqual(at100.corner, [0, 0, 0, 255]); assert(at100.textColors.includes('#f1f1f1')); return at100;
    });
    await check('standard fullscreen API is called by user activation on documentElement and exits by button or Escape', async () => {
      const fsContext = await context({ fullscreenMode: 'success' }), fsPage = await ready(fsContext); await fsPage.locator('#view-fullscreen').click();
      await fsPage.waitForFunction(() => document.fullscreenElement === document.documentElement); assert.equal(await fsPage.locator('body').evaluate(body => body.classList.contains('view-fallback')), false); await controlsAccessible(fsPage);
      const calls = await fsPage.evaluate(() => window.__viewQaFullscreenCalls); assert(calls[0].documentElement && calls[0].userActivation);
      await fsPage.locator('#view-fullscreen').click(); await fsPage.waitForFunction(() => !document.fullscreenElement); await fsPage.locator('#view-fullscreen').click(); await fsPage.waitForFunction(() => !!document.fullscreenElement); await fsPage.keyboard.press('Escape'); await fsPage.waitForFunction(() => !document.fullscreenElement); await controlsAccessible(fsPage); return calls;
    });
    for (const mode of ['reject', 'unavailable']) await check(`fullscreen ${mode} uses reversible in-page fallback and keeps the exit controls available`, async () => {
      const fallbackContext = await context({ fullscreenMode: mode }), fallback = await ready(fallbackContext); await fallback.locator('#view-fullscreen').click(); await fallback.waitForFunction(() => document.body.classList.contains('view-fallback')); assert.equal(await fallback.evaluate(() => document.fullscreenElement), null); await controlsAccessible(fallback);
      await shot(fallback, `fullscreen-${mode}-fallback.png`); await fallback.locator('#view-fullscreen').click(); await fallback.waitForFunction(() => !document.body.classList.contains('view-fallback')); await fallback.locator('#view-fullscreen').click(); await fallback.waitForFunction(() => document.body.classList.contains('view-fallback')); await fallback.keyboard.press('Escape'); await fallback.waitForFunction(() => !document.body.classList.contains('view-fallback')); await controlsAccessible(fallback);
    });
    await check('headless native fullscreen click succeeds or cleanly falls back, and always exits', async () => {
      const nativeContext = await context(), native = await ready(nativeContext); await native.locator('#view-fullscreen').click(); await native.waitForFunction(() => document.fullscreenElement === document.documentElement || document.body.classList.contains('view-fallback'));
      const mode = await native.evaluate(() => document.fullscreenElement ? 'native-standard-api' : 'in-page-fallback'); await native.locator('#view-fullscreen').click(); await native.waitForFunction(() => !document.fullscreenElement && !document.body.classList.contains('view-fallback')); return { mode };
    });
    const mobileContext = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, fullscreenMode: 'unavailable' }), mobile = await ready(mobileContext);
    await check('mobile 200% zoom confines horizontal scrolling to the board and reaches title and last row', async () => {
      await setZoom(mobile, 200); const detail = await reachCanvasEdges(mobile); assert(detail.final.scrollWidth > detail.final.clientWidth); assert(detail.final.scrollLeft > 0);
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true); await shot(mobile, 'mobile-200-last-row-right-edge.png'); return detail;
    });
    await check('mobile fullscreen fallback retains visible exits and returns to editing', async () => {
      await mobile.locator('#view-fullscreen').tap(); await mobile.waitForFunction(() => document.body.classList.contains('view-fallback')); await controlsAccessible(mobile); await mobile.waitForTimeout(200); await controlsAccessible(mobile); await mobile.locator('#view-fullscreen').tap(); await mobile.waitForFunction(() => !document.body.classList.contains('view-fallback'));
      await presentation(mobile, true); await mobile.locator('#presentation-toggle').tap(); assert.equal(await mobile.locator('body').evaluate(body => body.classList.contains('presentation')), false); assert(await mobile.locator('#ranking-title').isVisible());
    });
    await check('mobile whole-card touch drag and double-tap editing remain aligned at 200%', async () => { await useFixture(mobile, fixture()); const detail = await dragAtZoom(mobile, 200, mobileContext); await shot(mobile, 'mobile-200-after-touch-drag.png'); return detail; });
    await check('known old built-in name canonicalizes safely while custom names, images and six rows restore intact', async () => {
      const legacyContext = await context(), legacy = await ready(legacyContext), saved = fixture(); saved.title = '旧名与自定义档保留验收'; saved.items['view-one'].name = '（浙江）干挑面'; saved.items['view-one'].art = 'zhejiang-dry-noodles'; saved.items['view-two'].name = '旧用户自定义项目';
      saved.rows.push(...Array.from({ length: 4 }, (_, index) => ({ id: 'legacy-extra-' + index, name: '旧自定义档' + index, color: '#cccccc', itemIds: [] })));
      const customImage = await legacy.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 4; canvas.getContext('2d').fillRect(0, 0, 4, 4); return canvas.toDataURL('image/png'); });
      saved.items['legacy-custom-name'] = { id: 'legacy-custom-name', name: '（浙江）干挑面', image: null, art: null, crop: null };
      saved.items['legacy-custom-image'] = { id: 'legacy-custom-image', name: '（浙江）干挑面', image: customImage, art: null, crop: { x: 1, y: 1, size: 2 } };
      saved.pool.push('legacy-custom-name', 'legacy-custom-image');
      // Seed the raw old record directly so a normalizing save cannot conceal a read-time regression.
      await legacy.evaluate(saved => new Promise((resolve, reject) => { const request = indexedDB.open('xieyuqing-ranking-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('rankings', 'readwrite'); tx.objectStore('rankings').put(JSON.stringify(saved), 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }; }), saved);
      await legacy.reload({ waitUntil: 'networkidle' }); await legacy.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.equal(await legacy.locator('[data-item-id="view-one"] .card-name').textContent(), '浙江干挑面'); assert.equal(await legacy.locator('[data-item-id="view-two"] .card-name').textContent(), '旧用户自定义项目');
      for (const id of ['legacy-custom-name', 'legacy-custom-image']) assert.equal(await legacy.locator(`[data-item-id="${id}"] .card-name`).textContent(), '（浙江）干挑面');
      assert.equal(await legacy.locator('.tier-row').count(), 6); const expected = JSON.parse(JSON.stringify(saved)); expected.items['view-one'].name = '浙江干挑面'; assert.deepEqual(await storedState(legacy), expected);
      const raw = await legacy.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('xieyuqing-ranking-v1'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result, tx = db.transaction('rankings', 'readonly'), get = tx.objectStore('rankings').get('current'); get.onsuccess = () => { resolve(get.result); }; tx.oncomplete = () => db.close(); }; }));
      assert.equal(raw, JSON.stringify(saved), 'Reading must not rewrite the stored original.'); return { rows: expected.rows.length, items: Object.keys(expected.items).length, rawStoredRecordUnchanged: true };
    });
    await check('targeted view flows produce no script errors, console errors or external requests', async () => { assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []); });
  } catch (error) {
    const active = contexts.flatMap(ctx => ctx.pages()).at(-1); if (active) await active.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {}); if (browser) await browser.close(); report.finishedAt = new Date().toISOString(); report.passed = report.checks.length > 0 && report.checks.every(item => item.passed); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
