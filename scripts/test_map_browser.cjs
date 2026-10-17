// Local map acceptance checks. Only synthetic visitor records are created.
// node scripts/test_map_browser.cjs [generated-site] [evidence-directory]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const site = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(__dirname, '..', '.local-checks', 'map-browser'));
const origin = 'http://127.0.0.1:48735';
const storageKey = 'xieyuqing-footprints-v1';
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Use the existing Playwright runtime; set PLAYWRIGHT_MODULE if needed.');
const chrome = process.env.CHROME_PATH || path.join(process.env.ProgramFiles || process.env.PROGRAMFILES || path.join(path.parse(os.homedir()).root, 'Program Files'), 'Google', 'Chrome', 'Application', 'chrome.exe');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const report = { startedAt: new Date().toISOString(), site, checks: [], screenshots: [], exports: [], requests: [], missingLocalResources: [], consoleErrors: [], pageErrors: [], externalOrigins: [], notes: [
  'Fresh headless Chrome, nonpersistent contexts, no user browser profile.',
  'All HTTP requests are served from the selected generated directory. External requests are recorded and blocked.',
  'Visitor tests use synthetic records only. Screenshots are taken in visitor mode and stay local.',
  'The inline publisher map payload is replaced with a synthetic payload before serving it to the test browser; original personal records never enter the browser harness.',
  'Mobile map points, timeline entries and export controls use native Playwright touchscreen taps in a 390x844 touch context.',
  'PNG validity is checked by its signature, dimensions and browser decoding. Natural Earth credit remains on the page; framework fine print is absent from exported images.',
  'If this Windows headless environment cancels a native download, the exact same still-live browser Blob is recovered for byte-level export checks; recoveries are recorded separately.'
] };
const contexts = [], externalOrigins = new Set();
let browser;
const longStory = 'Synthetic complete description, first line.\n' + 'Long explanatory text must remain accessible, wrap, and preserve every character. '.repeat(24) + '\nFinal line: END-OF-FULL-DESCRIPTION.';
const injection = '<script>window.__footprintXss = 1</script><img src=x onerror="window.__footprintXss = 2"> & "quoted" <svg onload="window.__footprintXss = 3"></svg>';
const record = (overrides = {}) => ({ id: 'qa-london-first', start: '2017-03', end: '2018-04', city: 'London', region: 'England', country: 'United Kingdom', lat: 51.5074, lon: -0.1278, title: 'Synthetic first London stay', description: longStory, album: '', certainty: 'confirmed', ...overrides });
const dataset = records => ({ version: 1, title: 'Synthetic visitor footprints', records });
const seed = dataset([record(), record({ id: 'qa-london-return', start: '2021-09', end: '2022-01', title: 'Synthetic return to London', description: 'A separate synthetic stay in the same city.', certainty: 'approximate' }), record({ id: 'qa-singapore', start: '2023', end: '2024', city: 'Singapore', region: '', country: 'Singapore', lat: 1.3521, lon: 103.8198, title: 'Synthetic Singapore stay', description: 'A distinct synthetic city.', album: '/photos/synthetic-album/' })]);
const mineSeed = { version: 1, title: 'Synthetic publisher footprints', records: [record({ id: 'qa-publisher', city: 'Helsinki', region: '', country: 'Finland', lat: 60.1699, lon: 24.9384, title: 'Synthetic publisher stay', description: 'Synthetic data replaces the publisher payload only inside this test.' })] };
const canonical = data => JSON.stringify({ version: data.version, title: data.title, records: [...data.records].sort((a, b) => a.id.localeCompare(b.id)) });
function resource(url) {
  const pathname = decodeURIComponent(new URL(url).pathname), relative = pathname.replace(/^[/\\]+/, '');
  let target = path.resolve(site, relative);
  const within = path.relative(site, target);
  if (within.startsWith('..') || path.isAbsolute(within) || within.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('Forbidden local path');
  if (relative === 'favicon.ico' && !fs.existsSync(target)) return { status: 204, body: Buffer.alloc(0) };
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  let body = fs.readFileSync(target);
  if (path.relative(site, target).replace(/\\/g, '/') === 'map/index.html') {
    const source = body.toString('utf8'), pattern = /(<script\b[^>]*\bid=["']footprints-data["'][^>]*>)[\s\S]*?(<\/script>)/;
    assert(pattern.test(source), 'The map contains the expected inline data element');
    body = Buffer.from(source.replace(pattern, (_, open, close) => open + JSON.stringify(mineSeed) + close));
  }
  return { status: 200, contentType: mime[path.extname(target)] || 'application/octet-stream', body };
}
async function check(name, action) {
  const started = Date.now();
  try { const detail = await action(); report.checks.push({ name, passed: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
  catch (error) { report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack || String(error) }); console.error('FAIL ' + name + ': ' + (error.stack || error.message)); }
}
async function context({ theme = 'light', storageDisabled = false, ...options } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, acceptDownloads: true, ...options });
  contexts.push(ctx);
  await ctx.addInitScript(({ theme, storageDisabled }) => {
    if (storageDisabled) {
      for (const method of ['getItem', 'setItem', 'removeItem']) Object.defineProperty(Storage.prototype, method, { configurable: true, value() { throw new DOMException('Synthetic disabled storage', 'SecurityError'); } });
    } else { try { if (localStorage.getItem('xieyuqing-blog-theme') === null) localStorage.setItem('xieyuqing-blog-theme', theme); } catch (_) {} }
    window.__footprintXss = 0;
  }, { theme, storageDisabled });
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (/^(data|blob):/.test(url)) return route.continue();
    try { const parsed = new URL(url); report.requests.push({ origin: parsed.origin, path: parsed.pathname, method: route.request().method() }); } catch (_) {}
    if (url.startsWith(origin + '/')) {
      try { return await route.fulfill(resource(url)); }
      catch (_) { report.missingLocalResources.push(new URL(url).pathname); return route.fulfill({ status: 404, body: 'Missing local generated resource' }); }
    }
    try { externalOrigins.add(new URL(url).origin); } catch (_) { externalOrigins.add('unrecognized-request'); }
    return route.abort();
  });
  ctx.on('page', page => {
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error') report.consoleErrors.push(entry.text()); });
    page.on('dialog', dialog => page.qaAcceptConfirm && dialog.type() === 'confirm' ? dialog.accept() : dialog.dismiss());
  });
  return ctx;
}
async function visit(page) {
  const response = await page.goto(origin + '/map/', { waitUntil: 'networkidle' });
  assert(response && response.status() === 200, '/map/ returns 200');
  await page.locator('#mode-visitor').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.FootprintsMap && FootprintsMap.assetsReady());
}
async function press(page, locator) { if (page.qaMobile) await locator.tap(); else await locator.click(); }
async function visitor(page) { await press(page, page.locator('#mode-visitor')); }
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(size.html <= size.width + 2 && size.body <= size.width + 2, 'Horizontal document overflow: ' + JSON.stringify(size));
  return size;
}
async function shot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' }); report.screenshots.push(name);
}
async function download(page, selector, expectedName, savedName) {
  const [item] = await Promise.all([page.waitForEvent('download'), press(page, page.locator(selector))]);
  assert.equal(item.suggestedFilename(), expectedName);
  let bytes;
  try { const location = await item.path(); assert(location, 'A download must be recoverable'); bytes = fs.readFileSync(location); }
  catch (error) {
    assert(item.url().startsWith('blob:'), 'Only the actual locally generated download Blob can be recovered');
    const encoded = await page.evaluate(async url => { const response = await fetch(url); if (!response.ok) throw new Error('Cannot recover local export Blob'); const buffer = new Uint8Array(await response.arrayBuffer()); let binary = ''; for (let start = 0; start < buffer.length; start += 32768) binary += String.fromCharCode(...buffer.subarray(start, start + 32768)); return btoa(binary); }, item.url());
    bytes = Buffer.from(encoded, 'base64');
    (report.blobRecoveries ||= []).push({ filename: expectedName, bytes: bytes.length, nativeFailure: await item.failure() || error.message });
  }
  if (savedName) { fs.writeFileSync(path.join(output, savedName), bytes); report.exports.push({ file: savedName, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }); }
  return bytes;
}
async function exported(page) { return JSON.parse((await download(page, '#export-json', 'footprints.json')).toString('utf8')); }
async function openImport(page) { const panel = page.locator('.import-panel'); if (!(await panel.evaluate(element => element.open))) await panel.locator('summary').click(); }
async function importText(page, text) { await openImport(page); await page.locator('#import-text').fill(text); await page.locator('#import-apply').click(); }
async function importFile(page, text, name = 'synthetic.json') {
  await openImport(page);
  await page.locator('#import-file').setInputFiles({ name, mimeType: name.endsWith('.md') ? 'text/markdown' : 'application/json', buffer: Buffer.from(text) });
  await page.waitForFunction(text => document.querySelector('#import-text').value === text, text);
  await page.locator('#import-apply').click();
}
async function importSeed(page) { await visitor(page); await importText(page, JSON.stringify(seed)); assert.equal((await exported(page)).records.length, seed.records.length); }

async function openDetail(page, title) {
  const row = page.locator('#timeline-list li').filter({ hasText: title });
  assert.equal(await row.count(), 1, 'A stay remains a distinct timeline row: ' + title);
  await press(page, row.locator('.timeline-open'));
  await page.locator('#detail-dialog[open]').waitFor();
  assert.equal(await page.locator('#detail-title').textContent(), title);
}
async function closed(page, selector) { await page.locator(selector).waitFor({ state: 'hidden' }); }
async function fillRecord(page, item, confirm = true) {
  await page.locator('#city-choice').selectOption('');
  for (const key of ['title', 'start', 'end', 'city', 'region', 'country', 'lat', 'lon', 'description', 'album']) await page.locator('#record-' + key).fill(String(item[key]));
  await page.locator('#record-certainty').selectOption(item.certainty);
  await page.locator('#coordinate-confirm').setChecked(confirm);
}
async function noSilentChanges(page, baseline) { assert.equal(canonical(await exported(page)), canonical(baseline), 'Rejected/cancelled actions preserve every prior record'); }
async function dialogFits(page, selector, closeSelector) {
  const detail = await page.evaluate(({ selector, closeSelector }) => {
    const box = element => { const b = element.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: box(document.querySelector(selector)), close: box(document.querySelector(closeSelector)) };
  }, { selector, closeSelector });
  for (const [name, box] of Object.entries(detail).filter(([name]) => name !== 'viewport')) {
    assert(box.width > 0 && box.height > 0, name + ' is visible');
    assert(box.x >= -2 && box.right <= detail.viewport.width + 2, name + ' fits screen width');
    assert(box.y >= -2 && box.bottom <= detail.viewport.height + 2, name + ' fits screen height');
  }
  return detail;
}
async function verifyCompleteDescription(page, expected) {
  assert.equal(await page.locator('#detail-description').textContent(), expected, 'Every character and explicit line break is retained');
  const style = await page.locator('#detail-description').evaluate(element => { const css = getComputedStyle(element); return { whiteSpace: css.whiteSpace, clamp: css.webkitLineClamp, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }; });
  assert(['pre-line', 'pre-wrap', 'break-spaces'].includes(style.whiteSpace));
  assert(!style.clamp || style.clamp === 'none' || style.clamp === '0', 'Full description is not line-clamped');
  assert(style.scrollWidth <= style.clientWidth + 2, 'Description wraps');
  assert(style.scrollHeight <= style.clientHeight + 2, 'The paragraph is not clipped');
  return style;
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  assert(fs.existsSync(path.join(site, 'map', 'index.html')), 'Build /map/ before running the browser checks');
  report.fileHashes = {};
  for (const relative of ['map/index.html', 'assets/map-model.js', 'assets/map.js', 'assets/map.css', 'assets/map-view.js', 'assets/map-land.json', 'assets/map-terrain.jpg']) report.fileHashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(site, relative))).digest('hex');
  const downloadsPath = path.join(output, 'downloads'); fs.mkdirSync(downloadsPath, { recursive: true });
  browser = await playwright.chromium.launch({ headless: true, executablePath: chrome, downloadsPath }); report.browserVersion = browser.version();
  const backgrounds = {};
  for (const viewport of ['desktop', 'mobile']) for (const theme of ['light', 'dark']) {
    const ctx = await context({ theme, ...(viewport === 'mobile' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
    const page = await ctx.newPage(); page.qaMobile = viewport === 'mobile'; page.setDefaultTimeout(10000);
    await check(`${viewport} ${theme}: synthetic map, local land, timeline and responsive layout`, async () => {
      await visit(page); assert.equal(await page.locator('html').getAttribute('data-theme'), theme); await importSeed(page);
      assert.equal(await page.locator('#timeline-list li').count(), 3); assert.equal(await page.locator('.map-marker').count(), 2, 'One London marker groups two distinct stays');
      assert.equal(await page.locator('#map-layer').inputValue(), 'terrain', 'Fresh maps default to natural terrain');
      assert((await page.locator('#map-terrain-image').getAttribute('href')).startsWith('data:image/jpeg;base64,'), 'Bundled terrain is embedded locally');
      await page.locator('#map-layer').selectOption('simple'); assert(await page.locator('#footprints-map .map-land').count() > 100, 'The alternate simple physical-land layer is usable'); await page.locator('#map-layer').selectOption('terrain'); await page.waitForFunction(() => FootprintsMap.assetsReady() && !!document.querySelector('#map-terrain-image'));
      assert.match(await page.locator('.map-attribution').textContent(), /Natural Earth.*Public Domain/);
      assert.equal(await page.locator('.map-svg-note,.map-svg-label').count(), 0);
      assert.equal(await page.locator('.map-intro h1').textContent(), '地图与足迹');
      assert.equal(await page.locator('.map-intro p').textContent(), '三十功名尘与土，八千里路云和月。');
      assert.equal(await page.locator('.site-footer > p').textContent(), '如有问题和反馈请联系作者公众号 谢雨聊。');
      assert.equal(await page.locator('#journey-options').isHidden(), true); assert.equal(await page.locator('#journey-options select').count(), 0);
      assert.equal(await page.locator('#copy-mine').count(), 0);
      assert.equal(await page.locator('#city-filter-disclosure').evaluate(element => element.open), false, 'City chips are initially collapsed');
      const size = await noOverflow(page), background = await page.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
      const layout = await page.evaluate(() => { const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; }, p = FootprintsMap.projection(); return { canvas: box('#map-canvas'), svg: box('#footprints-map'), tools: box('.map-below-tools'), mode: box('.map-mode'), timeline: box('.timeline-panel'), projection: { left: p.left, top: p.top, width: p.width, height: p.height, scale: p.scale, bounds: p.bounds } }; });
      assert(Math.abs(layout.canvas.width - layout.svg.width) < 1 && Math.abs(layout.canvas.height - layout.svg.height) < 1, 'SVG fills the entire map canvas'); assert.equal(layout.projection.left, 0); assert.equal(layout.projection.top, 0); assert(Math.abs(layout.projection.width / layout.projection.height - layout.canvas.width / layout.canvas.height) < 0.001, 'Geographic projection follows the responsive map aspect'); assert(layout.tools.y >= layout.canvas.bottom - 1 && layout.mode.y >= layout.canvas.bottom - 1, 'All editing and map tools follow the canvas');
      if (viewport === 'mobile') assert(layout.timeline.y >= layout.canvas.bottom, 'Mobile timeline follows the map'); else { assert(layout.timeline.x >= layout.canvas.right, 'Desktop timeline is beside the map'); assert(layout.timeline.width <= 221, 'Desktop timeline is compact'); }
      backgrounds[`${viewport}-${theme}`] = background; if (theme === 'dark') assert.notEqual(background, backgrounds[`${viewport}-light`]);
      await shot(page, `${viewport}-${theme}-synthetic-map.png`); return { timelineRows: 3, cityMarkers: 2, background, size, layout };
    });
    await check(`${viewport} ${theme}: map mode, view, city filter and optional chronological line switches`, async () => {
      const before = await exported(page);
      await page.locator('#mode-mine').click(); assert.equal(await page.locator('#mode-mine').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#visitor-tools').isVisible(), false);
      assert.equal(await page.locator('#timeline-list li').count(), 1, 'Synthetic publisher map is independent');
      await visitor(page); await noSilentChanges(page, before);
      await page.locator('#map-view').selectOption('asia'); assert.equal(await page.locator('#timeline-list li').count(), 3); assert.equal(await page.locator('.map-marker').count(), 1); await noOverflow(page);
      await page.locator('#map-view').selectOption('world'); await page.locator('#map-route').check(); assert.equal(await page.locator('.map-order').count(), 1); assert.equal(await page.locator('.map-order').getAttribute('d'), '', 'Unplayed video must not reveal future route segments'); assert.equal(await page.locator('.map-order').getAttribute('display'), 'inline');
      assert.match(await page.locator('.route-option').textContent(), /时间顺序/); assert.match(await page.locator('.map-help').textContent(), /仅表示时间顺序/);
      await page.locator('#map-route').uncheck(); assert.equal(await page.locator('.map-order').getAttribute('display'), 'none'); await noSilentChanges(page, before);
      const london = page.locator('.map-marker[aria-label*="London"]'); assert.equal(await london.count(), 1); assert.match(await london.textContent(), /≈/);
      await press(page, london.locator('.map-hit')); await page.locator('#city-dialog[open]').waitFor(); assert.equal(await page.locator('#city-options section').count(), 2); assert.equal(await page.locator('#timeline-list li').count(), 3, 'A city click opens its stays without filtering the timeline');
      await press(page, page.locator('#city-options button').first()); await page.locator('#detail-dialog[open]').waitFor(); assert.equal(await page.locator('#detail-title').textContent(), seed.records[0].title); await page.locator('#detail-close').click();
      await london.focus(); await page.keyboard.press('Enter'); await page.locator('#city-dialog[open]').waitFor(); assert.equal(await page.locator('#city-options section').count(), 2); await page.locator('#city-close').click();
      assert.equal(await page.locator('#city-filters .city-filter').count(), 3); await page.locator('#city-filter-disclosure summary').click(); const londonChip = page.locator('#city-filters .city-filter[aria-label*="London"]'); assert.match(await londonChip.textContent(), /≈/);
      await press(page, londonChip); assert.equal(await page.locator('#timeline-list li').count(), 2); await press(page, page.locator('#city-filters .city-filter').first()); assert.equal(await page.locator('#timeline-list li').count(), 3);
      await page.locator('#map-view').selectOption('fit'); assert.equal(await page.locator('.map-marker').count(), 2); await noSilentChanges(page, before);
    });
    if (theme !== 'light') continue;
    await check(`${viewport}: shared theme button switches and persists`, async () => {
      await page.locator('#theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark'); assert.equal(await page.evaluate(() => localStorage.getItem('xieyuqing-blog-theme')), 'dark');
      await page.locator('#theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    });
    await check(`${viewport}: complete multiline description and associated-album link`, async () => {
      await openDetail(page, seed.records[0].title); const style = await verifyCompleteDescription(page, longStory), geometry = await dialogFits(page, '#detail-dialog', '#detail-close'); await shot(page, `${viewport}-complete-description.png`);
      await page.locator('#detail-close').click(); await closed(page, '#detail-dialog'); await openDetail(page, seed.records[2].title); assert.equal(await page.locator('#detail-album').getAttribute('href'), seed.records[2].album); await page.keyboard.press('Escape'); await closed(page, '#detail-dialog');
      return { descriptionCharacters: longStory.length, style, geometry };
    });
    await check(`${viewport}: edit/add Cancel, close and Escape discard unsaved changes`, async () => {
      const before = await exported(page);
      for (const editing of [true, false]) for (const close of ['#record-cancel', '#record-close', 'Escape']) {
        if (editing) { await openDetail(page, seed.records[0].title); await page.locator('#detail-edit').click(); } else await page.locator('#add-record').click();
        await page.locator('#record-dialog[open]').waitFor(); await page.locator('#record-title').fill('UNSAVED synthetic ' + close); await dialogFits(page, '#record-dialog', '#record-close');
        if (close === 'Escape') await page.keyboard.press('Escape'); else await page.locator(close).click();
        await closed(page, '#record-dialog'); await noSilentChanges(page, before);
      }
      return { cancelledEdits: 3, cancelledAdditions: 3 };
    });
  }
  const ctx = await context(), page = await ctx.newPage(); page.setDefaultTimeout(10000);
  await check('manual city confirmation, adding repeat stays and saving an edit', async () => {
    await visit(page); await visitor(page); await page.locator('#add-record').click(); const first = record({ title: 'Form-created London first stay', description: 'Synthetic form entry.' });
    await fillRecord(page, first, false); await page.locator('#record-save').click(); assert(await page.locator('#record-dialog').isVisible()); assert((await page.locator('#record-error').textContent()).trim());
    await page.locator('#coordinate-confirm').check(); await page.locator('#record-save').click(); await closed(page, '#record-dialog');
    await page.locator('#add-record').click(); await fillRecord(page, record({ start: '2020', end: '2021', title: 'Form-created London return', description: 'A separate stay in the same city.' })); await page.locator('#record-save').click(); await closed(page, '#record-dialog');
    const before = await exported(page); assert.equal(before.records.length, 2); assert.equal(new Set(before.records.map(item => item.id)).size, 2); assert.equal(await page.locator('.map-marker').count(), 1); assert.equal(await page.locator('#timeline-list li').count(), 2);
    await openDetail(page, first.title); await page.locator('#detail-edit').click(); await page.locator('#record-title').fill('Form-created London first stay, edited'); await page.locator('#record-save').click(); await closed(page, '#record-dialog');
    const after = await exported(page); assert.equal(after.records.length, 2); assert.deepEqual(after.records.map(item => item.id).sort(), before.records.map(item => item.id).sort()); assert(after.records.some(item => item.title.endsWith(', edited')));
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null, 'Drafts are not saved automatically');
  });
  await check('JSON file and fenced Markdown import/export recover data; duplicate imports skip identical IDs', async () => {
    await visit(page); await visitor(page); await importFile(page, JSON.stringify(seed)); assert.equal(canonical(await exported(page)), canonical(seed));
    await importText(page, JSON.stringify(seed)); assert.equal(canonical(await exported(page)), canonical(seed));
    const markdown = (await download(page, '#export-markdown', 'footprints.md', 'synthetic-footprints.md')).toString('utf8'); assert.match(markdown, /^```footprints\s*$/m);
    const json = await download(page, '#export-json', 'footprints.json', 'synthetic-footprints.json'); assert.equal(canonical(JSON.parse(json.toString('utf8'))), canonical(seed));
    await visit(page); await visitor(page); assert.equal((await exported(page)).records.length, 0, 'Reload does not restore unsaved data');
    await importFile(page, markdown, 'synthetic.md'); assert.equal(canonical(await exported(page)), canonical(seed)); await importText(page, markdown); assert.equal((await exported(page)).records.length, seed.records.length);
  });
  await check('invalid JSON, dates, coordinates and conflicting IDs reject the whole import', async () => {
    const before = await exported(page), good = record({ id: 'qa-good-before-invalid', title: 'Must never partially import' });
    const invalid = [
      ['malformed JSON', '{"version":1,"records":['],
      ['impossible date', JSON.stringify(dataset([good, record({ id: 'qa-bad-date', start: '2023-02-29' })]))],
      ['reversed dates', JSON.stringify(dataset([good, record({ id: 'qa-reversed', start: '2024-09', end: '2024-08' })]))],
      ['latitude range', JSON.stringify(dataset([good, record({ id: 'qa-lat', lat: 91 })]))],
      ['longitude range', JSON.stringify(dataset([good, record({ id: 'qa-lon', lon: 181 })]))],
      ['non-numeric coordinates', JSON.stringify(dataset([good, record({ id: 'qa-null', lat: null })]))],
      ['existing ID conflict', JSON.stringify(dataset([good, record({ description: 'Conflicting replacement must not apply' })]))],
      ['duplicate ID inside document', JSON.stringify(dataset([good, good]))],
      ['external album URL', JSON.stringify(dataset([good, record({ id: 'qa-url', album: 'https://example.invalid/private' })]))],
      ['multiple fenced documents', '# Synthetic\n```footprints\n' + JSON.stringify(seed) + '\n```\n```footprints\n' + JSON.stringify(seed) + '\n```\n'],
      ['oversized text', 'x'.repeat(1048577)],
      ['record limit', JSON.stringify(dataset(Array.from({ length: 501 }, (_, i) => record({ id: 'qa-limit-' + i, description: '' }))))]
    ];
    for (const [name, text] of invalid) { await importText(page, text); assert.equal(await page.locator('#map-status').getAttribute('data-error'), 'true', name + ' reports an error'); await noSilentChanges(page, before); }
    await openImport(page); await page.locator('#import-file').setInputFiles({ name: 'synthetic-too-large.json', mimeType: 'application/json', buffer: Buffer.alloc(1048577, 120) });
    await page.waitForFunction(() => document.querySelector('#map-status').dataset.error === 'true'); await noSilentChanges(page, before); return { atomicInvalidCases: invalid.length + 1 };
  });
  await check('local source metadata and approval fields never enter recoverable exports; pending records are skipped', async () => {
    await visit(page); await visitor(page);
    const unapproved = record({ approved: false, source_path: 'PRIVATE_SYNTHETIC_NOTE.md', private_notes: 'PRIVATE_SYNTHETIC_METADATA' });
    const local = { ...dataset([unapproved, record({ id: 'qa-pending', certainty: 'pending' })]), private_index: 'PRIVATE_SYNTHETIC_INDEX' };
    await importText(page, JSON.stringify(local)); const clean = await exported(page); assert.equal(clean.records.length, 1); assert.equal(canonical(clean), canonical(dataset([record()])));
    for (const value of ['PRIVATE_SYNTHETIC', 'approved', 'pending', 'source_path', 'private_notes', 'private_index']) assert(!JSON.stringify(clean).includes(value));
    const md = (await download(page, '#export-markdown', 'footprints.md')).toString('utf8'); assert(!md.includes('PRIVATE_SYNTHETIC'));
  });
  await check('year-only and unknown dates retain their precision and never imply an ongoing stay', async () => {
    await visit(page); await visitor(page); const partial = dataset([record({ id: 'qa-year', start: '2020', end: '', title: 'Synthetic year-only date' }), record({ id: 'qa-unknown-start', start: '', end: '2019-04', title: 'Synthetic unknown start' }), record({ id: 'qa-unknown', start: '', end: '', title: 'Synthetic unknown dates' })]);
    await importText(page, JSON.stringify(partial)); assert.equal(canonical(await exported(page)), canonical(partial));
    const dates = await page.locator('#timeline-list .timeline-date').allTextContents(); assert(dates.some(text => text.includes('2020'))); assert(dates.every(text => !/2020-01|至今|现在|present|ongoing/i.test(text)));
    assert.equal(await page.locator('#timeline-list li').first().getAttribute('data-record-id'), 'qa-year');
  });
  await check('description/title markup is escaped as text with no executable nodes', async () => {
    await visit(page); await visitor(page); const unsafe = record({ id: 'qa-xss', title: 'Synthetic <img src=x onerror="window.__footprintXss=4">', city: 'City <img src=x onerror="window.__footprintXss=6">', description: injection });
    await importText(page, JSON.stringify({ ...dataset([unsafe]), title: 'Synthetic <script>window.__footprintXss=5</script>' })); assert.equal((await exported(page)).records.length, 1); await openDetail(page, unsafe.title);
    assert.equal(await page.locator('#detail-description').textContent(), injection); assert.equal(await page.locator('#detail-dialog script,#detail-dialog img,#detail-dialog svg').count(), 0); assert.equal(await page.evaluate(() => window.__footprintXss), 0);
    await page.locator('#detail-close').click(); assert.equal(await page.locator('#timeline-list script,#timeline-list img,#timeline-list svg').count(), 0);
    const svg = (await download(page, '#export-svg', 'footprints.svg')).toString('utf8');
    const info = await page.evaluate(source => { const doc = new DOMParser().parseFromString(source, 'image/svg+xml'); return { error: !!doc.querySelector('parsererror'), executable: !!doc.querySelector('script,foreignObject'), unsafeImages: [...doc.querySelectorAll('image')].some(node => !/^data:image\/(png|jpeg);base64,/.test(node.getAttribute('href') || '')), handlers: [...doc.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name))), description: [...doc.querySelectorAll('.export-caption')].map(node => node.textContent).join('') }; }, svg);
    assert.deepEqual({ error: info.error, executable: info.executable, unsafeImages: info.unsafeImages, handlers: info.handlers }, { error: false, executable: false, unsafeImages: false, handlers: false }); assert.equal(info.description, injection); assert.equal(await page.evaluate(() => window.__footprintXss), 0);
  });
  await check('standalone SVG and PNG exports decode and preserve view; fine print stays on the page', async () => {
    await visit(page); await importSeed(page); await page.locator('#map-view').selectOption('world'); await page.locator('#map-route').check();
    const svg = await download(page, '#export-svg', 'footprints.svg', 'synthetic-footprints.svg');
    const svgInfo = await page.evaluate(source => { const doc = new DOMParser().parseFromString(source, 'image/svg+xml'), root = doc.documentElement; return { error: !!doc.querySelector('parsererror'), name: root.localName, width: root.getAttribute('width'), height: root.getAttribute('height'), attribution: [...doc.querySelectorAll('.map-svg-note')].map(node => node.textContent).join(' '), styles: doc.querySelectorAll('style').length, externalResources: [...doc.querySelectorAll('[href],[src]')].map(node => node.getAttribute('href') || node.getAttribute('src')).filter(href => href && !href.startsWith('#')) }; }, svg.toString('utf8'));
    assert.equal(svgInfo.error, false); assert.equal(svgInfo.name, 'svg'); assert.equal(svgInfo.attribution, ''); assert(svgInfo.styles > 0); assert(svgInfo.externalResources.every(href => /^data:image\/(png|jpeg);base64,/.test(href))); assert.match(await page.locator('.map-attribution').textContent(), /Natural Earth.*Public Domain/); assert(!svg.toString('utf8').includes('Natural Earth'));
    const png = await download(page, '#export-png', 'footprints.png', 'synthetic-footprints.png'); assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20); assert(width >= 1000 && height >= 600);
    const decoded = await page.evaluate(async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }, png.toString('base64')); assert.deepEqual(decoded, { width, height });
    await shot(page, 'desktop-synthetic-export-state.png'); return { svg: { ...svgInfo, externalResources: svgInfo.externalResources.map(href => href.slice(0, 32) + '...') }, png: { bytes: png.length, width, height }, attribution: 'Natural Earth public-domain credit is on the page; no mandatory attribution is required inside the image.' };
  });
  await check('explicit save/restore/removal and undo of restore preserve recoverable drafts', async () => {
    const before = await exported(page); await page.locator('#save-local').click(); assert.equal(canonical(JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey))), canonical(before));
    await page.locator('#visitor-title').fill('Unsaved synthetic draft title'); await page.locator('#visitor-title').press('Tab'); const unsaved = await exported(page); await page.locator('#restore-local').click(); await noSilentChanges(page, before); await page.locator('#undo-data').click(); await noSilentChanges(page, unsaved);
    await page.locator('#restore-local').click(); await noSilentChanges(page, before);
    await visit(page); await visitor(page); await page.locator('#restore-local').click(); await noSilentChanges(page, before); await page.locator('#delete-local').click(); assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), null); await noSilentChanges(page, before);
    await page.evaluate(key => localStorage.setItem(key, '{invalid synthetic cache'), storageKey); await page.locator('#restore-local').click(); assert.equal(await page.locator('#map-status').getAttribute('data-error'), 'true'); await noSilentChanges(page, before); await page.locator('#delete-local').click();
  });
  await check('publisher map stays read-only and adding from it opens only the independent visitor draft', async () => {
    await visit(page); await importSeed(page); const before = await exported(page); assert.equal(await page.locator('#copy-mine').count(), 0);
    await page.locator('#mode-mine').click(); assert.equal(canonical(await exported(page)), canonical(mineSeed)); await openDetail(page, mineSeed.records[0].title); assert.equal(await page.locator('#detail-edit-tools').isVisible(), false); await page.locator('#detail-close').click();
    await page.locator('#map-add-here').click(); await page.locator('#record-dialog[open]').waitFor(); await page.locator('#record-city').fill('UNSAVED city'); await page.locator('#record-cancel').click(); await closed(page, '#record-dialog'); assert.equal(canonical(await exported(page)), canonical(mineSeed));
    await visitor(page); await noSilentChanges(page, before);
    await openDetail(page, seed.records[0].title); await page.locator('#detail-delete').click(); await closed(page, '#detail-dialog'); assert.equal((await exported(page)).records.length, 2); await page.locator('#undo-data').click(); await noSilentChanges(page, before);
    await page.locator('#mode-mine').click(); assert.equal(canonical(await exported(page)), canonical(mineSeed));
  });
  await check('undo reverses add, edit, remove, import, rename and one-click clear without touching saved data', async () => {
    await visit(page); await visitor(page); const snapshots = [await exported(page)];
    assert.equal(await page.locator('#undo-data').isDisabled(), true); assert.equal(await page.locator('#clear-data').isDisabled(), true);
    await importText(page, JSON.stringify(seed)); snapshots.push(await exported(page)); await page.locator('#save-local').click();
    const saved = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await page.locator('#visitor-title').fill('Renamed synthetic map'); await page.locator('#visitor-title').press('Tab'); snapshots.push(await exported(page));
    await page.locator('#add-record').click(); await fillRecord(page, record({ title: 'Undo-only added stay', start: '2025', end: '2025', description: 'Added and undone.' })); await page.locator('#record-save').click(); await closed(page, '#record-dialog'); snapshots.push(await exported(page));
    await openDetail(page, seed.records[0].title); await page.locator('#detail-edit').click(); await page.locator('#record-description').fill('Edited and undone.'); await page.locator('#record-save').click(); await closed(page, '#record-dialog'); snapshots.push(await exported(page));
    await openDetail(page, seed.records[1].title); await page.locator('#detail-delete').click(); await closed(page, '#detail-dialog'); snapshots.push(await exported(page));
    await page.locator('#clear-data').click(); assert.equal((await exported(page)).records.length, 0); assert.equal(await page.locator('#clear-data').isDisabled(), true); assert.equal(await page.locator('#undo-data').isDisabled(), false);
    for (let index = snapshots.length - 1; index >= 0; index--) { await page.locator('#undo-data').click(); await noSilentChanges(page, snapshots[index]); }
    assert.equal(await page.locator('#undo-data').isDisabled(), true); assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), saved, 'Draft clearing and undo leave the explicit browser save intact');
    await importText(page, JSON.stringify(seed)); await importText(page, JSON.stringify(seed)); await page.locator('#undo-data').click(); await noSilentChanges(page, snapshots[0]); assert.equal(await page.locator('#undo-data').isDisabled(), true, 'An identical import creates no spurious undo step');
    await page.locator('#mode-mine').click(); assert.equal(canonical(await exported(page)), canonical(mineSeed)); return { undoKinds: ['add', 'edit', 'remove', 'import', 'rename', 'clear'], savedDataUnchanged: true, duplicateImportUndoSteps: 0 };
  });
  await check('disabled storage permits import, editing and export and explains cache errors', async () => {
    const disabledContext = await context({ storageDisabled: true }), disabled = await disabledContext.newPage(); disabled.setDefaultTimeout(10000); await visit(disabled); await importSeed(disabled); const before = await exported(disabled);
    await openDetail(disabled, seed.records[0].title); await disabled.locator('#detail-edit').click(); await disabled.locator('#record-description').fill('Synthetic description with storage disabled.'); await disabled.locator('#record-save').click(); await closed(disabled, '#record-dialog'); const after = await exported(disabled); assert.equal(after.records.length, before.records.length); assert(after.records.some(item => item.description === 'Synthetic description with storage disabled.'));
    for (const selector of ['#save-local', '#restore-local', '#delete-local']) { await disabled.locator(selector).click(); assert.equal(await disabled.locator('#map-status').getAttribute('data-error'), 'true'); await noSilentChanges(disabled, after); }
    await shot(disabled, 'desktop-storage-disabled.png');
  });
  await check('all map requests stay local and read-only, without missing resources or console/page errors', async () => {
    assert.deepEqual([...externalOrigins], []); assert.deepEqual([...new Set(report.missingLocalResources)], []); assert.deepEqual([...new Set(report.pageErrors)], []); assert.deepEqual([...new Set(report.consoleErrors)], []); assert(report.requests.every(request => request.origin === origin && request.method === 'GET'));
    return { requests: report.requests.length, externalOrigins: 0, uploads: 0, missingLocalResources: 0, pageErrors: 0, consoleErrors: 0 };
  });
}
(async () => {
  try { await run(); } catch (error) { report.fatalError = error.stack || String(error); console.error(error.stack || String(error)); }
  finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    report.externalOrigins = [...externalOrigins].sort(); report.finishedAt = new Date().toISOString(); report.passed = !report.fatalError && report.checks.every(check => check.passed);
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(check => !check.passed).length, screenshots: report.screenshots.length, report: path.join(output, 'report.json') }));
    if (!report.passed) process.exitCode = 1;
  }
})();
