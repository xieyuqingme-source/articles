// Optional real-browser regression checks; no site runtime dependencies are added.
// Build first, then run: node scripts/test_ranking_browser.cjs
// Set PLAYWRIGHT_MODULE / CHROME_PATH when the defaults are unavailable.
// RANKING_REAL_HTTP=1 uses the loopback server for browser requests; without it,
// Playwright fulfills the exact same static files for network-restricted QA.
// This always launches a separate headless Chromium instance and never attaches
// to an existing browser, user profile, or visible window.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const site = path.resolve(process.argv[2] || path.join(root, '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(root, '.local-checks', 'ranking-browser'));
const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright',
  path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')].filter(Boolean);
let playwright;
for (const candidate of candidates) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Playwright is optional. Provide PLAYWRIGHT_MODULE or install it outside the site.');
const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8' };
const report = { startedAt: new Date().toISOString(), browser: 'isolated headless Chromium', checks: [], screenshots: [], downloads: [], consoleErrors: [], pageErrors: [], externalRequests: [], notes: [] };
// Independent acceptance fixture: the user-selected default arrangement.
const expectedDefault = {
  title: '美食从夯到拉',
  rows: [
    { name: '夯', color: '#f28b82', items: ['四川火锅', '绵阳米粉', '嘉兴粽子', '东坡肉', '海肠捞饭', '八珍豆腐', '浙江干挑面'] },
    { name: '顶级', color: '#f6b26b', items: ['豌杂面', '手工水饺', '汉堡', '日本拉面', '越南鸡丝米粉', '打抛饭', '羊肉烧麦', '驴肉火烧', '熏肉大饼'] },
    { name: '人上人', color: '#f9d976', items: ['炸鸡', '折耳根', '速冻水饺', '鸡蛋挂面', '烧烤'] },
    { name: 'NPC', color: '#e8e5a0', items: ['寿司', '豆汁', '肉骨茶', '北京杂酱面', '西湖醋鱼'] },
    { name: '拉完了', color: '#a8cf9a', items: ['披萨', '蛋糕', '奶茶', '丝瓜面', '月饼', '蛋挞', '面包', '兰州拉面'] }
  ],
  pool: []
};

function dimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Downloaded file must be PNG');
  assert.equal(buffer.subarray(12, 16).toString(), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
function resource(url) {
  const relative = decodeURIComponent(new URL(url).pathname).replace(/^[/\\]+/, '');
  let target = path.resolve(site, relative);
  const within = path.relative(site, target);
  if (within.startsWith('..') || path.isAbsolute(within) || within.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('Forbidden');
  if (relative === 'favicon.ico' && !fs.existsSync(target)) return { status: 204, body: Buffer.alloc(0) };
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!fs.statSync(target).isFile()) throw new Error('Missing');
  return { status: 200, contentType: mime[path.extname(target)] || 'application/octet-stream', body: fs.readFileSync(target) };
}
function serve() {
  assert(fs.existsSync(path.join(site, 'game', 'ranking', 'index.html')), 'Build the unified site before running browser checks.');
  const server = http.createServer((request, response) => {
    try {
      const result = resource(new URL(request.url, 'http://localhost').href);
      response.writeHead(result.status, { 'Content-Type': result.contentType || 'text/plain', 'Cache-Control': 'no-store' }); response.end(result.body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found');
    }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve();
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const contexts = [];
  async function check(name, action) {
    const started = Date.now();
    try { const detail = await action(); report.checks.push({ name, passed: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); }
    catch (error) { report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`); throw error; }
  }
  async function context(options = {}) {
    const value = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true, ...options });
    contexts.push(value);
    if (options.colorScheme === 'light') await value.addInitScript(() => { try { localStorage.setItem('xieyuqing-blog-theme', 'light'); } catch (_) {} });
    await value.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) {
        if (process.env.RANKING_REAL_HTTP) return route.continue();
        // Some managed environments deny browser sockets even to loopback.
        // Fulfilling from the same static files keeps the HTTP origin, native
        // browser APIs and downloads without requiring any network permission.
        try { return route.fulfill(resource(url)); }
        catch { return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }); }
      }
      if (/^(data|blob):/.test(url)) return route.continue();
      report.externalRequests.push(url); return route.abort();
    });
    value.on('page', page => {
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
      page.on('dialog', dialog => dialog.accept());
    });
    return value;
  }
  async function ready(ctx) {
    const page = await ctx.newPage();
    await page.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' });
    await page.locator('.tier-row').first().waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.rank-card').length > 0);
    return page;
  }
  async function shot(page, name) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' });
    report.screenshots.push(name);
  }
  async function download(page, selector, name) {
    if (!(await page.locator(selector).isVisible())) {
      const details = page.locator(selector).locator('xpath=ancestor::details');
      if (await details.count()) await details.locator('summary').click();
    }
    const promise = page.waitForEvent('download');
    await page.locator(selector).click();
    const file = await promise;
    assert.equal(await file.failure(), null);
    const destination = path.join(output, name || file.suggestedFilename());
    await file.saveAs(destination);
    report.downloads.push(path.basename(destination));
    return fs.readFileSync(destination);
  }
  async function importJson(page, data, name = 'test-ranking.json') {
    await page.locator('#json-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForTimeout(100);
  }
  async function itemDialog(page, itemId) {
    await page.locator(`.rank-card[data-item-id="${itemId}"] .card-main`).click();
    await page.locator('#item-dialog').waitFor({ state: 'visible' });
  }
  async function cardIds(page, zone) {
    return page.locator(`.item-list[data-zone="${zone}"] .rank-card`).evaluateAll(cards => cards.map(card => card.dataset.itemId));
  }
  async function cardCount(page) { return page.locator('.rank-card').count(); }
  async function firstId(page, zone = 'pool') { return page.locator(`.item-list[data-zone="${zone}"] .rank-card`).first().getAttribute('data-item-id'); }
  async function snapshot(page) {
    return page.evaluate(() => ({
      title: document.querySelector('#ranking-title').value,
      rows: Array.from(document.querySelectorAll('.tier-row'), row => ({
        name: row.querySelector('.tier-label strong').textContent,
        color: row.querySelector('.tier-label').style.getPropertyValue('--tier-color'),
        items: Array.from(row.querySelectorAll('.card-name'), item => item.textContent)
      })),
      pool: Array.from(document.querySelectorAll('#candidate-pool .card-name'), item => item.textContent)
    }));
  }
  async function assertDefault(page) {
    assert.deepEqual(await snapshot(page), expectedDefault);
    assert.equal(await cardCount(page), expectedDefault.rows.reduce((count, row) => count + row.items.length, 0));
    assert.equal(await page.locator('#pool-count').textContent(), '0');
  }
  async function assertPresentation(page) {
    assert(await page.locator('body').evaluate(body => body.classList.contains('presentation')));
    assert.equal(await page.locator('#presentation-toggle').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#presentation-toggle').textContent(), /编辑.*退出展示.*Esc/);
    assert.equal(await page.locator('.site-header').isVisible(), false);
    assert.equal(await page.locator('#text-name').isVisible(), false);
    assert.equal(await page.locator('#tool-message').isVisible(), false);
    assert.equal(await page.locator('iframe, ins.adsbygoogle, [data-ad-client], [data-ad-slot]').count(), 0);
  }
  async function enterEditor(page) {
    if (await page.locator('body').evaluate(body => body.classList.contains('presentation'))) await page.locator('#presentation-toggle').click();
    assert.equal(await page.locator('body').evaluate(body => body.classList.contains('presentation')), false);
    assert(await page.locator('#text-name').isVisible());
  }
  async function poolFixture(page) {
    // Keep motion tests independent of product defaults. Import a separate,
    // explicit all-pool fixture through the same confirmed JSON UI as users.
    const fixture = require(path.join(site, 'assets', 'ranking-model.js')).createDefaultState();
    fixture.pool = fixture.rows.flatMap(row => row.itemIds).concat(fixture.pool);
    fixture.rows.forEach(row => { row.itemIds = []; });
    await importJson(page, fixture, 'interaction-all-pool.json');
    assert.equal((await cardIds(page, 'pool')).length, Object.keys(fixture.items).length);
    for (const row of fixture.rows) assert.deepEqual(await cardIds(page, row.id), []);
  }
  try {
    const nativeDownloads = path.join(output, 'native-downloads'); fs.mkdirSync(nativeDownloads, { recursive: true });
    browser = await playwright.chromium.launch({ headless: true, downloadsPath: nativeDownloads, ...(chrome ? { executablePath: chrome } : {}) });
    const desktopContext = await context({ colorScheme: 'light' });
    const page = await ready(desktopContext);
    report.browserVersion = browser.version();
    report.notes.push(process.env.RANKING_REAL_HTTP ? 'Browser used a temporary loopback HTTP server serving the generated site. No external network or user browser was used.' : 'Browser HTTP responses were fulfilled from generated local static files because browser loopback sockets are denied in this sandbox. No external network or user browser was used.');
    await check('exact default food ranking opens in a clean presentation with an empty pool', async () => {
      await assertDefault(page);
      await assertPresentation(page);
      assert.equal(report.externalRequests.length, 0);
      const routes = process.env.RANKING_UI_ONLY ? ['/game/', '/game/ranking/'] : ['/', '/game/', '/game/ranking/', '/about/', '/articles/', '/projects/'];
      if (process.env.RANKING_UI_ONLY) report.notes.push('UI-only fixture run: full static route checks must also run against the unified build.');
      for (const route of routes) {
        const status = await page.evaluate(async route => (await fetch(route)).status, route); assert.equal(status, 200, `${route} must be a usable static route`);
      }
      await shot(page, 'desktop-default-presentation.png');
    });
    const defaultTitle = expectedDefault.title;
    const defaultCount = expectedDefault.rows.reduce((count, row) => count + row.items.length, 0);
    await check('explicit editing toggle and imported all-pool fixture support desktop editing layout', async () => {
      await enterEditor(page);
      await poolFixture(page);
      const desktopLayout = await page.evaluate(() => {
        const board = document.querySelector('.board-section').getBoundingClientRect(), panel = document.querySelector('.pool-panel').getBoundingClientRect();
        const pool = document.querySelector('#candidate-pool'), before = scrollY; pool.scrollTop = 100;
        const result = { boardRight: board.right, poolLeft: panel.left, overflowY: getComputedStyle(pool).overflowY, independentlyScrolled: pool.scrollTop > 0 && before === scrollY };
        pool.scrollTop = 0; return result;
      });
      assert(desktopLayout.poolLeft >= desktopLayout.boardRight); assert.equal(desktopLayout.overflowY, 'auto'); assert(desktopLayout.independentlyScrolled);
      await shot(page, 'desktop-light.png');
    });
    const firstRow = await page.locator('.tier-row').first().getAttribute('data-row-id');
    let preserved;
    await check('click and keyboard dialogs move, rename, and reorder items safely', async () => {
      const first = await firstId(page);
      await itemDialog(page, first);
      const literal = '<img src=x onerror=window.__ranking_xss=1>';
      await page.locator('#item-name').fill(literal);
      await page.locator('#item-target').selectOption(firstRow);
      await page.locator('#item-save').click();
      assert.deepEqual(await cardIds(page, firstRow), [first]);
      assert((await page.locator(`.rank-card[data-item-id="${first}"]`).textContent()).includes(literal));
      assert.equal(await page.evaluate(() => Boolean(window.__ranking_xss)), false);
      assert.equal(await page.locator('img[src="x"]').count(), 0);
      const second = await firstId(page);
      const button = page.locator(`.rank-card[data-item-id="${second}"] .card-main`);
      await button.focus(); await page.keyboard.press('Enter');
      await page.locator('#item-dialog').waitFor({ state: 'visible' });
      await page.locator('#item-target').selectOption(firstRow);
      await page.locator('#item-save').focus(); await page.keyboard.press('Enter');
      assert.deepEqual(await cardIds(page, firstRow), [first, second]);
      await itemDialog(page, second);
      await page.locator('#item-previous').click();
      await page.locator('#item-save').click();
      assert.deepEqual(await cardIds(page, firstRow), [second, first]);
      if (await page.locator('#item-dialog').isVisible()) await page.keyboard.press('Escape');
      assert.equal(await cardCount(page), defaultCount);
    });
    await check('row rename, color, add, reorder, and deletion preserve items', async () => {
      const row = page.locator(`.tier-row[data-row-id="${firstRow}"]`);
      await row.locator('.row-settings').click();
      await page.locator('#row-name').fill('夯中之夯');
      await page.locator('#row-color').evaluate(element => { element.value = '#8755a3'; element.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#row-save').click();
      assert((await row.textContent()).includes('夯中之夯'));
      await page.locator('#add-row').click();
      await page.locator('#row-name').fill('拉不出来');
      await page.locator('#row-color').evaluate(element => { element.value = '#5baa7a'; element.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.locator('#row-save').click();
      assert.equal(await page.locator('.tier-row').count(), expectedDefault.rows.length + 1);
      const last = page.locator('.tier-row').last();
      const addedId = await last.getAttribute('data-row-id');
      assert((await last.textContent()).includes('拉不出来'));
      await last.locator('.row-settings').click(); await page.locator('#row-up').click();
      assert.equal(await page.locator('.tier-row').nth(expectedDefault.rows.length - 1).getAttribute('data-row-id'), addedId);
      if (await page.locator('#row-dialog').isVisible()) await page.keyboard.press('Escape');
      const occupiedIds = await cardIds(page, firstRow);
      await row.locator('.row-settings').click(); await page.locator('#row-delete').click();
      assert.equal(await page.locator('.tier-row').count(), expectedDefault.rows.length);
      assert.equal(await cardCount(page), defaultCount);
      const pool = await cardIds(page, 'pool');
      for (const id of occupiedIds) assert(pool.includes(id), 'Deleting occupied row must return every item to the pool');
    });
    await check('existing local state takes priority over defaults and reloads in presentation', async () => {
      await page.locator('#text-name').fill('本地保存测试');
      await page.locator('#add-text-form').evaluate(form => form.requestSubmit());
      await page.locator('#ranking-title').fill('我的可恢复排行');
      await page.locator('#ranking-title').blur();
      await page.waitForFunction(() => /已.*保存|保存.*成功/.test(document.querySelector('#save-status').textContent));
      const beforeReload = await snapshot(page);
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#ranking-app').waitFor({ state: 'visible' });
      await assertPresentation(page);
      assert.deepEqual(await snapshot(page), beforeReload, 'Loading must restore custom rows, order, title, and pool rather than replacing them with the new defaults');
      assert.equal(await page.locator('#ranking-title').inputValue(), '我的可恢复排行');
      assert.equal(await cardCount(page), defaultCount + 1);
      assert((await page.locator('.item-list[data-zone="pool"]').textContent()).includes('本地保存测试'));
    });
    await check('visibility change during delayed restore cannot overwrite existing saved state', async () => {
      const append = `\n;(() => {
        const create = RankingStorage.createStore;
        RankingStorage.createStore = (...args) => {
          const storage = create(...args);
          return { ...storage,
            save(state) { if (!window.__qaRestoreComplete) window.__qaEarlySaves = (window.__qaEarlySaves || 0) + 1; return storage.save(state); },
            load() {
              window.__qaRestoreStarted = true;
              Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
              document.dispatchEvent(new Event('visibilitychange'));
              return new Promise(resolve => setTimeout(resolve, 600)).then(() => storage.load()).finally(() => {
                window.__qaRestoreComplete = true;
                Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
              });
            }
          };
        };
      })();`;
      const delayed = route => {
        const result = resource(route.request().url());
        return route.fulfill({ ...result, body: result.body.toString('utf8') + append });
      };
      await desktopContext.route('**/ranking-storage.js', delayed);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__qaRestoreStarted);
      assert.equal(await page.locator('#ranking-app').isVisible(), false);
      await page.waitForFunction(() => window.__qaRestoreComplete && !document.querySelector('#ranking-app').hidden);
      assert.equal(await page.evaluate(() => window.__qaEarlySaves || 0), 0);
      assert.equal(await page.locator('#ranking-title').inputValue(), '我的可恢复排行');
      const saved = await page.evaluate(() => new Promise((resolve, reject) => {
        const request = indexedDB.open('xieyuqing-ranking-v1', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => { const db = request.result, query = db.transaction('rankings', 'readonly').objectStore('rankings').get('current'); query.onsuccess = () => { db.close(); resolve(JSON.parse(query.result).title); }; query.onerror = () => { db.close(); reject(query.error); }; };
      }));
      assert.equal(saved, '我的可恢复排行');
      await desktopContext.unroute('**/ranking-storage.js', delayed);
      await assertPresentation(page);
      await enterEditor(page);
    });
    await check('batch image import scales images and rejects SVG and oversize input', async () => {
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1400; canvas.height = 900;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#178365'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff'; ctx.font = '100px sans-serif'; ctx.fillText('LOCAL IMAGE', 100, 400);
        return canvas.toDataURL('image/png').split(',')[1];
      });
      const before = await cardCount(page);
      await page.locator('#image-files').setInputFiles(['one', 'two'].map(name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })));
      await page.waitForFunction(count => document.querySelectorAll('.rank-card').length === count, before + 2);
      const json = JSON.parse((await download(page, '#json-export', 'images-roundtrip.json')).toString('utf8'));
      const images = Object.values(json.items).filter(item => item.image && ['one', 'two'].includes(item.name));
      assert.equal(images.length, 2);
      const sizes = await page.evaluate(async data => Promise.all(data.map(async item => {
        const image = await createImageBitmap(await (await fetch(item.image)).blob());
        return { width: image.width, height: image.height, bytes: Math.floor(item.image.length * 3 / 4) };
      })), images);
      for (const size of sizes) { assert(size.width <= 1024 && size.height <= 1024, 'Imported image must be resized'); assert(size.bytes < 1024 * 1024); }
      await page.locator('#image-files').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__ranking_svg=1"/>') });
      await page.waitForTimeout(100);
      assert.equal(await cardCount(page), before + 2);
      assert.equal(await page.evaluate(() => Boolean(window.__ranking_svg)), false);
      await page.locator('#image-files').setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(13 * 1024 * 1024) });
      await page.waitForTimeout(100);
      assert.equal(await cardCount(page), before + 2);
      assert.match(await page.locator('#tool-message').textContent(), /10 MB|过大/);
      const targetId = await page.locator('.tier-row').first().getAttribute('data-row-id');
      for (const image of images) {
        await itemDialog(page, image.id); await page.locator('#item-target').selectOption(targetId); await page.locator('#item-save').click();
      }
      const high = dimensions(await download(page, '#png-export', 'ranking-image-export-2x.png'));
      assert.equal(high.width, 2400);
      await page.locator('#export-scale').selectOption('1');
      const standard = dimensions(await download(page, '#png-export', 'ranking-image-export-1x.png'));
      assert.equal(standard.width, 1200); assert.equal(high.height, standard.height * 2);
      await page.locator('#export-scale').selectOption('2');
      return sizes;
    });
    await check('PNG decode failure is visible and export controls recover', async () => {
      await page.evaluate(() => {
        window.__rankingOriginalDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = () => Promise.reject(new Error('图片解码故障测试'));
      });
      let downloaded = false;
      const observe = () => { downloaded = true; }; page.on('download', observe);
      await page.locator('#png-export').click();
      await page.waitForFunction(() => /图片解码故障测试/.test(document.querySelector('#tool-message').textContent));
      await page.evaluate(() => { HTMLImageElement.prototype.decode = window.__rankingOriginalDecode; });
      page.off('download', observe);
      assert.equal(downloaded, false);
      assert.equal(await page.locator('#png-export').isDisabled(), false);
      report.notes.push('PNG failure recovery was checked with a deliberately rejected image.decode() promise.');
    });
    await check('JSON backup downloads, round-trips, and rejects invalid data atomically', async () => {
      preserved = JSON.parse((await download(page, '#json-export', 'ranking-backup.json')).toString('utf8'));
      assert.equal(preserved.version, 3); assert.equal(preserved.templateId, 'food');
      assert.equal(preserved.title, '我的可恢复排行');
      await page.locator('#ranking-title').fill('临时修改'); await page.locator('#ranking-title').blur();
      await importJson(page, preserved);
      assert.equal(await page.locator('#ranking-title').inputValue(), preserved.title);
      assert.equal(await cardCount(page), Object.keys(preserved.items).length);
      const bad = structuredClone(preserved); bad.pool.push('missing-item');
      await importJson(page, bad, 'invalid-ranking.json');
      assert.equal(await page.locator('#ranking-title').inputValue(), preserved.title);
      assert.equal(await cardCount(page), Object.keys(preserved.items).length);
      const external = structuredClone(preserved); Object.values(external.items)[0].image = 'https://example.invalid/image.png'; Object.values(external.items)[0].art = null;
      await importJson(page, external, 'external-image.json');
      assert.equal(await cardCount(page), Object.keys(preserved.items).length);
    });
    await check('reset confirmation can cancel and accept the exact default presentation', async () => {
      page.removeAllListeners('dialog');
      page.once('dialog', dialog => dialog.dismiss());
      await page.locator('#reset-ranking').click();
      assert.equal(await page.locator('#ranking-title').inputValue(), preserved.title);
      page.on('dialog', dialog => dialog.accept());
      await page.locator('#reset-ranking').click();
      assert.equal(await page.locator('#ranking-title').inputValue(), defaultTitle);
      assert.equal(await cardCount(page), defaultCount);
      await assertDefault(page);
      await assertPresentation(page);
    });
    await check('desktop pointer drag moves pool item to tier and reorders it', async () => {
      await enterEditor(page);
      await poolFixture(page);
      const itemId = await firstId(page);
      const handle = page.locator(`.rank-card[data-item-id="${itemId}"] .drag-handle`);
      const target = page.locator('.tier-row').first().locator('.item-list');
      await handle.scrollIntoViewIfNeeded();
      let from = await handle.boundingBox(), to = await target.boundingBox();
      assert(from && to);
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(to.x + Math.min(40, to.width / 2), to.y + Math.min(40, to.height / 2), { steps: 18 }); await page.waitForTimeout(70); await page.mouse.up();
      // The editor intentionally ignores card activation for 450ms after dragging.
      await page.waitForTimeout(500);
      const targetId = await page.locator('.tier-row').first().getAttribute('data-row-id');
      await page.waitForFunction(({ itemId, targetId }) => Boolean(document.querySelector(`.item-list[data-zone="${targetId}"] .rank-card[data-item-id="${itemId}"]`)), { itemId, targetId });
      const secondId = await firstId(page);
      await itemDialog(page, secondId); await page.locator('#item-target').selectOption(targetId); await page.locator('#item-save').click();
      const secondHandle = page.locator(`.rank-card[data-item-id="${secondId}"] .drag-handle`);
      from = await secondHandle.boundingBox();
      to = await page.locator(`.rank-card[data-item-id="${itemId}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(to.x + 2, to.y + to.height / 2, { steps: 18 }); await page.waitForTimeout(70); await page.mouse.up(); await page.waitForTimeout(100);
      assert.deepEqual(await cardIds(page, targetId), [secondId, itemId]);
      report.notes.push('Desktop drag checks used real Chromium mouse input events in headless mode.');
    });
    await check('presentation mode, keyboard Escape, theme, and desktop layout', async () => {
      await page.locator('#presentation-toggle').click();
      await shot(page, 'desktop-presentation.png');
      assert(await page.locator('.item-list[data-zone="pool"]').isVisible());
      assert.equal(await page.locator('#text-name').isVisible(), false);
      assert.equal(await page.locator('#tool-message').isVisible(), false);
      await page.setViewportSize({ width: 1440, height: 640 });
      assert((await page.locator('.pool-panel').boundingBox()).height <= 600);
      await shot(page, 'desktop-presentation-short.png');
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.keyboard.press('Escape');
      assert(await page.locator('#text-name').isVisible());
      await page.locator('#theme-toggle').click();
      await shot(page, 'desktop-dark.png');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, 'Desktop must not overflow horizontally');
    });
    await check('long Chinese title, all rows, long labels, and many items export a decoded PNG', async () => {
      const stress = require(path.join(site, 'assets', 'ranking-model.js')).createDefaultState();
      stress.title = '长标题自动换行验收：' + '美食排行与个人口味记录'.repeat(7);
      stress.items = {}; stress.pool = []; stress.rows = stress.rows.slice(0, 5);
      stress.rows.forEach((row, rowIndex) => {
        row.name = ['夯中之夯', '顶级', '人上人', 'NPC', '拉中之拉'][rowIndex]; row.itemIds = [];
        for (let index = 0; index < 25; index++) {
          const id = `stress-${rowIndex}-${index}`;
          stress.items[id] = { id, name: `${rowIndex + 1}-${index + 1} 中文名称自动换行 ${'长名称与Emoji🍜'.repeat(5)}`, art: index % 3 ? null : 'noodles', image: null, crop: null };
          row.itemIds.push(id);
        }
      });
      await importJson(page, stress, 'stress-ranking.json');
      assert.equal(await cardCount(page), 125);
      const png = await download(page, '#png-export', 'ranking-long-export.png');
      const size = dimensions(png);
      assert(size.width >= 1000); assert(size.height > size.width, 'Long board should export its full height');
      const exportLimits = require(path.join(site, 'assets', 'ranking-export.js'));
      assert(size.width * size.height <= exportLimits.MAX_PIXELS, 'Export must stay within the planned memory cap');
      assert(size.width <= exportLimits.MAX_SIDE && size.height <= exportLimits.MAX_SIDE);
      const decoded = await page.evaluate(async ({ base64, colors }) => {
        const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const targets = colors.map(hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]);
        const counts = targets.map(() => 0), extents = targets.map(() => [Infinity, -1]);
        // Inspect the clear left strip of each tier label: photo pixels elsewhere may coincidentally match a label color.
        for (let i = 0; i < data.length; i += 4) {
          const pixelX = (i / 4) % canvas.width;
          if (pixelX < canvas.width * 0.025 || pixelX > canvas.width * 0.04) continue;
          targets.forEach((color, at) => { if (data[i] === color[0] && data[i + 1] === color[1] && data[i + 2] === color[2] && data[i + 3] === 255) { counts[at]++; extents[at][0] = Math.min(extents[at][0], Math.floor(i / 4 / canvas.width)); extents[at][1] = Math.max(extents[at][1], Math.floor(i / 4 / canvas.width)); } });
        }
        return { width: image.width, height: image.height, counts, extents };
      }, { base64: png.toString('base64'), colors: stress.rows.map(row => row.color) });
      assert.equal(decoded.width, size.width); assert.equal(decoded.height, size.height);
      for (const count of decoded.counts) assert(count > 100, 'Every tier color must be present in the PNG');
      for (let index = 1; index < decoded.extents.length; index++) assert(decoded.extents[index][0] > decoded.extents[index - 1][1], 'All five tiers must be rendered in order');
      assert(decoded.extents.at(-1)[1] > size.height * 0.75, 'Last tier must survive long export');
      return { ...size, bytes: png.length, decodedTierExtents: decoded.extents };
    });
    await check('save quota failure is visible and editing remains available', async () => {
      await page.evaluate(() => {
        window.__rankingOriginalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function () { throw new DOMException('Test quota', 'QuotaExceededError'); };
      });
      await page.locator('#ranking-title').fill('存储空间不足测试'); await page.locator('#ranking-title').blur();
      await page.waitForFunction(() => document.querySelector('#save-status').dataset.failed === 'true');
      assert.match(await page.locator('#tool-message').textContent(), /不足|备份/);
      assert.equal(await page.locator('#ranking-title').isDisabled(), false);
      assert.equal(await page.locator('#json-export').isDisabled(), false);
      await page.evaluate(() => { IDBObjectStore.prototype.put = window.__rankingOriginalPut; });
    });
    const mobileContext = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const mobile = await ready(mobileContext);
    await check('mobile also opens the exact default in clean presentation', async () => {
      await assertDefault(mobile);
      await assertPresentation(mobile);
      assert((await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
      await shot(mobile, 'mobile-default-presentation.png');
      await enterEditor(mobile);
      await poolFixture(mobile);
    });
    await check('mobile touch click movement, light/dark layout, and no horizontal overflow', async () => {
      const item = await firstId(mobile);
      const targetId = await mobile.locator('.tier-row').first().getAttribute('data-row-id');
      await mobile.locator(`.rank-card[data-item-id="${item}"] .card-main`).tap();
      await mobile.locator('#item-target').selectOption(targetId); await mobile.locator('#item-save').tap();
      assert.deepEqual(await cardIds(mobile, targetId), [item]);
      assert((await mobile.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
      assert(await mobile.evaluate(() => document.querySelector('.pool-panel').getBoundingClientRect().top >= document.querySelector('.board-section').getBoundingClientRect().bottom));
      await mobile.evaluate(() => scrollTo(0, 0)); await shot(mobile, 'mobile-light.png');
      await mobile.locator('#theme-toggle').tap(); await shot(mobile, 'mobile-dark.png');
    });
    await check('mobile touch pointer drag in presentation view', async () => {
      await mobile.locator('#presentation-toggle').tap();
      // CDP sends touch input to this isolated test page; this does not operate a
      // user browser. Physical devices still need a manual feel/accessibility check.
      const id = await firstId(mobile);
      // Presentation hides the drag icon; the whole card remains draggable.
      const handle = mobile.locator(`.rank-card[data-item-id="${id}"] .card-main`);
      await handle.scrollIntoViewIfNeeded();
      const from = await handle.boundingBox();
      const target = mobile.locator('.tier-row').last().locator('.item-list');
      const targetBox = await target.boundingBox();
      const session = await mobileContext.newCDPSession(mobile);
      const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
      // Drag near viewport edge first so the board can auto-scroll while the pool
      // remains reachable; choose the visible tier after the initial movement.
      const destination = { x: Math.max(130, Math.min(300, targetBox.x + 40)), y: Math.max(70, Math.min(760, targetBox.y + 40)) };
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] });
      for (let step = 1; step <= 20; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (destination.x - start.x) * step / 20, y: start.y + (destination.y - start.y) * step / 20, id: 0 }] });
      }
      await mobile.waitForTimeout(100);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await mobile.waitForTimeout(100);
      const moved = !(await cardIds(mobile, 'pool')).includes(id);
      assert(moved, 'Touch drag must move the selected item out of the pool');
      await shot(mobile, 'mobile-presentation.png');
      await mobile.keyboard.press('Escape');
      report.notes.push('Mobile drag used emulated Chromium touch input. Physical touch devices were not operated.');
    });

    if (!process.env.RANKING_UI_ONLY) await check('home and game landing retain navigation and show the game entry', async () => {
      const preview = await desktopContext.newPage();
      await preview.goto(origin + '/', { waitUntil: 'networkidle' });
      for (const route of ['/game/', '/articles/', '/projects/', '/about/']) assert((await preview.locator(`.site-nav a[href="${route}"]`).count()) > 0);
      assert((await preview.locator('main a[href="/game/"]').count()) > 0, 'Home content must expose the new game entry');
      await shot(preview, 'home-light.png');
      await preview.goto(origin + '/game/', { waitUntil: 'networkidle' });
      assert((await preview.locator('main a[href="/game/ranking/"]').count()) > 0);
      assert((await preview.locator('main').textContent()).includes('从夯到拉'));
      await shot(preview, 'game-landing-light.png');
      await preview.close();
    });
    await check('no script errors or external dependencies', async () => {
      assert.deepEqual(report.pageErrors, []);
      assert.deepEqual(report.consoleErrors, []);
      assert.deepEqual(report.externalRequests, []);
    });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    report.finishedAt = new Date().toISOString();
    report.passed = report.checks.length > 0 && report.checks.every(item => item.passed);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
