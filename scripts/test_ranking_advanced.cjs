// Optional isolated, always-headless browser QA for the versioned ranking editor.
// Build first: node scripts/test_ranking_advanced.cjs [generated-site] [output]
// RANKING_REAL_HTTP=1 uses a temporary loopback server. Otherwise requests are
// fulfilled from those exact static files for network-restricted environments.
// PLAYWRIGHT_MODULE / CHROME_PATH override the optional external QA runtime.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const site = path.resolve(process.argv[2] || path.join(root, '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(root, '.local-checks', 'ranking-browser-advanced'));
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Provide the optional Playwright QA runtime through PLAYWRIGHT_MODULE.');
const chrome = process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : undefined);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };
const report = { startedAt: new Date().toISOString(), checks: [], screenshots: [], downloads: [], pageErrors: [], consoleErrors: [], externalRequests: [], notes: [] };
const defaultFoodKeys = ['sichuan-hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi', 'dongpo-pork', 'sea-intestine-rice', 'eight-treasure-tofu', 'zhejiang-dry-noodles', 'pea-mince-noodles', 'handmade-dumplings', 'burger', 'japanese-ramen', 'vietnamese-chicken-noodles', 'pad-krapow-rice', 'lamb-shumai', 'donkey-burger', 'smoked-pork-flatbread', 'chicken', 'houttuynia', 'frozen-dumplings', 'egg-noodles', 'barbecue', 'sushi', 'douzhi', 'bak-kut-teh', 'beijing-zhajiang-noodles', 'west-lake-vinegar-fish', 'pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake', 'egg-tart', 'bread', 'lanzhou-noodles'];
const sportKeys = ['walking', 'hiking', 'running', 'weight-training', 'swimming', 'badminton', 'cycling', 'football', 'tennis', 'table-tennis', 'combat-training', 'tree-climbing', 'skydiving', 'rock-climbing', 'diving', 'golf', 'gaming'];
const sportRows = [
  { name: '夯', color: '#f28b82', names: ['散步', '登山', '爬树', '打游戏'] }, { name: '顶级', color: '#f6b26b', names: ['跑步', '撸铁', '搏斗'] },
  { name: '人上人', color: '#f9d976', names: ['游泳', '羽毛球', '自行车'] }, { name: 'NPC', color: '#e8e5a0', names: ['乒乓球'] },
  { name: '拉完了', color: '#a8cf9a', names: ['足球', '网球', '跳伞', '攀岩', '潜水', '高尔夫'] }
];
const defaultRows = [
  { name: '夯', color: '#f28b82', names: ['四川火锅', '绵阳米粉', '嘉兴粽子', '东坡肉', '海肠捞饭', '八珍豆腐', '（浙江）干挑面'] },
  { name: '顶级', color: '#f6b26b', names: ['豌杂面', '手工水饺', '汉堡', '日本拉面', '越南鸡丝米粉', '打抛饭', '羊肉烧麦', '驴肉火烧', '熏肉大饼'] },
  { name: '人上人', color: '#f9d976', names: ['炸鸡', '折耳根', '速冻水饺', '鸡蛋挂面', '烧烤'] },
  { name: 'NPC', color: '#e8e5a0', names: ['寿司', '豆汁', '肉骨茶', '北京杂酱面', '西湖醋鱼'] },
  { name: '拉完了', color: '#a8cf9a', names: ['披萨', '蛋糕', '奶茶', '丝瓜面', '月饼', '蛋挞', '面包', '兰州拉面'] }
];
let sequence = 0;
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
  assert(fs.existsSync(path.join(site, 'game', 'ranking', 'index.html')), 'Build the generated site before browser QA.');
  const server = http.createServer((request, response) => {
    try { const item = resource(new URL(request.url, 'http://localhost').href); response.writeHead(item.status, { 'Content-Type': item.contentType || 'text/plain', 'Cache-Control': 'no-store' }); response.end(item.body); }
    catch { response.writeHead(404); response.end('Not found'); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
function actualArticleRoute() {
  const base = path.join(site, 'articles');
  function find(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['assets', 'images'].includes(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { const result = find(target); if (result) return result; }
      else if (entry.name.endsWith('.html') && entry.name !== 'index.html') {
        const html = fs.readFileSync(target, 'utf8');
        if (/<article\b[^>]*class=["'][^"']*reading-page/.test(html) && /id=["']article-content["']/.test(html) && !/http-equiv=["']refresh/i.test(html)) return target;
      }
    }
    return null;
  }
  const selected = find(base); assert(selected, 'A real generated article body is required for theme QA');
  return '/articles/' + path.relative(base, selected).split(path.sep).map(encodeURIComponent).join('/');
}
function fixture(image) {
  return { version: 3, templateId: 'food', title: '图片裁切与恢复验收', skin: 'classic', rows: [
    { id: 'test-a', name: '特选', color: '#b8cdb9', itemIds: ['crop-image', 'row-text'] },
    { id: 'test-b', name: '备选', color: '#d7cfae', itemIds: [] }
  ], pool: ['pool-a', 'pool-b'], items: {
    'crop-image': { id: 'crop-image', name: '红蓝原图', image, art: null, crop: null },
    'row-text': { id: 'row-text', name: '保留文字', image: null, art: null, crop: null },
    'pool-a': { id: 'pool-a', name: '待选甲', image: null, art: null, crop: null },
    'pool-b': { id: 'pool-b', name: '待选乙', image: null, art: null, crop: null }
  } };
}
function cropInBounds(crop, width = 400, height = 200) {
  assert(crop && Number.isFinite(crop.x) && Number.isFinite(crop.y) && Number.isFinite(crop.size));
  assert(crop.x >= 0 && crop.y >= 0 && crop.size > 0);
  assert(crop.x + crop.size <= width + 0.01 && crop.y + crop.size <= height + 0.01);
}

async function run() {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve(), origin = `http://127.0.0.1:${server.address().port}`;
  const articleRoute = actualArticleRoute(), themeRoutes = ['/', '/articles/', articleRoute, '/about/', '/projects/', '/game/', '/game/ranking/'];
  report.themeRoutes = themeRoutes; report.themeSamples = [];
  let browser;
  const contexts = [];
  async function check(name, action) {
    const started = Date.now();
    try { const detail = await action(); report.checks.push({ name, passed: true, ms: Date.now() - started, ...(detail ? { detail } : {}) }); console.log(`PASS ${name}`); }
    catch (error) {
      report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack || String(error) }); console.error(`FAIL ${name}: ${error.message}`);
      const active = contexts.flatMap(context => context.pages()).at(-1);
      if (active) try { await active.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); report.screenshots.push('failure.png'); } catch (_) {}
      throw error;
    }
  }
  async function context(options = {}) {
    const { themePreference = 'light', blockThemeStorage = false, matchMediaUnavailable = false, ...browserOptions } = options;
    const value = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true, ...browserOptions });
    contexts.push(value);
    if (themePreference) await value.addInitScript(preference => { try { localStorage.setItem('xieyuqing-blog-theme', preference); } catch (_) {} }, themePreference);
    if (blockThemeStorage) await value.addInitScript(() => { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('QA blocked storage', 'SecurityError'); } }); });
    if (matchMediaUnavailable) await value.addInitScript(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: undefined }); });
    await value.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/')) {
        if (process.env.RANKING_REAL_HTTP) return route.continue();
        try { return route.fulfill(resource(url)); } catch { return route.fulfill({ status: 404, body: 'Not found' }); }
      }
      if (/^(data|blob):/.test(url)) return route.continue();
      report.externalRequests.push(url); return route.abort();
    });
    value.on('page', page => {
      page.__qaAcceptDialog = true;
      page.__qaDialogAnswers = []; page.__qaDialogs = [];
      page.on('dialog', dialog => {
        page.__qaDialogs.push(dialog.message());
        const accept = page.__qaDialogAnswers.length ? page.__qaDialogAnswers.shift() : page.__qaAcceptDialog;
        return accept ? dialog.accept() : dialog.dismiss();
      });
      page.on('pageerror', error => report.pageErrors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    });
    return value;
  }
  async function ready(ctx) {
    const page = await ctx.newPage();
    await page.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' });
    await page.locator('#ranking-app').waitFor({ state: 'visible' });
    return page;
  }
  async function edit(page) {
    if (await page.locator('body').evaluate(body => body.classList.contains('presentation'))) await page.locator('#presentation-toggle').click();
  }
  async function shot(page, name, options = {}) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const modal = await page.locator('dialog[open]').count();
    await page.screenshot({ path: path.join(output, name), fullPage: modal === 0 && !options.viewportOnly, animations: 'disabled' });
    report.screenshots.push(name);
  }
  async function download(page, selector, name) {
    if (!(await page.locator(selector).isVisible())) {
      const details = page.locator(selector).locator('xpath=ancestor::details');
      if (await details.count()) await details.locator('summary').click();
    }
    const pending = page.waitForEvent('download'); await page.locator(selector).click(); const item = await pending;
    assert.equal(await item.failure(), null, 'Native browser download must complete');
    const destination = path.join(output, name); await item.saveAs(destination); report.downloads.push(name);
    return fs.readFileSync(destination);
  }
  async function state(page, label = 'state') {
    return JSON.parse((await download(page, '#json-export', `${String(++sequence).padStart(2, '0')}-${label}.json`)).toString('utf8'));
  }
  async function importState(page, data) {
    await edit(page);
    await page.locator('#json-file').setInputFiles({ name: 'advanced-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(expected => document.querySelector('#ranking-title').value === expected.title && document.querySelectorAll('.rank-card').length === Object.keys(expected.items).length, data);
    await page.waitForTimeout(80);
  }
  async function attemptImport(page, data, accept = true) {
    await edit(page); page.__qaAcceptDialog = accept;
    try {
      await page.locator('#json-file').setInputFiles({ name: 'cross-template-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await page.waitForFunction(() => document.querySelector('#json-file').value === '' && document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true');
    } finally { page.__qaAcceptDialog = true; }
  }
  async function openItem(page, id = 'crop-image', tap = false) {
    const button = page.locator(`.rank-card[data-item-id="${id}"] .card-main`); await button.scrollIntoViewIfNeeded();
    if (tap) await button.tap(); else await button.click();
    await page.locator('#item-dialog').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('#crop-preview').getAttribute('aria-busy') !== 'true' && !document.querySelector('#item-save').disabled);
  }
  async function zoom(page, value) {
    await page.locator('#crop-zoom').evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, value);
    assert.match(await page.locator('#crop-zoom-value').textContent(), new RegExp(Number(value).toFixed(2).replace('.', '\\.')));
  }
  async function pattern(page, left = '#fa0000', right = '#0000fa') {
    return page.evaluate(({ left, right }) => {
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = left; ctx.fillRect(0, 0, 200, 200); ctx.fillStyle = right; ctx.fillRect(200, 0, 200, 200);
      return canvas.toDataURL('image/png');
    }, { left, right });
  }
  async function pngPixels(page, buffer) {
    assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    return page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)); const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0, blue = 0;
      const palette = { classicRow: [243, 243, 243], classicInk: [23, 23, 23], classicBorder: [38, 38, 38], techRow: [255, 254, 249], techInk: [38, 59, 45], techBorder: [212, 217, 205] }, counts = Object.fromEntries(Object.keys(palette).map(key => [key, 0]));
      const paletteTargets = Object.entries(palette);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 220 && data[i + 1] < 40 && data[i + 2] < 40) red++; if (data[i + 2] > 220 && data[i] < 40 && data[i + 1] < 40) blue++;
        for (const [key, color] of paletteTargets) if (data[i] === color[0] && data[i + 1] === color[1] && data[i + 2] === color[2] && data[i + 3] === 255) counts[key]++;
      }
      const digest = await crypto.subtle.digest('SHA-256', data);
      return { width: image.width, height: image.height, red, blue, corner: Array.from(data.slice(0, 4)), palette: counts, pixelHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
    }, buffer.toString('base64'));
  }
  async function rawStore(page, key = 'current') {
    return page.evaluate(key => new Promise((resolve, reject) => {
      const opening = indexedDB.open('xieyuqing-ranking-v1', 1); opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => { const db = opening.result, transaction = db.transaction('rankings', 'readonly'), request = transaction.objectStore('rankings').get(key);
        request.onsuccess = () => { db.close(); resolve(request.result === undefined ? null : JSON.parse(request.result)); }; request.onerror = () => { db.close(); reject(request.error); }; };
    }), key);
  }
  async function waitSaved(page) { await page.waitForFunction(() => /已.*保存/.test(document.querySelector('#save-status').textContent) && document.querySelector('#save-status').dataset.failed !== 'true'); }
  async function chooseTemplate(page, id, accept = true) {
    const previous = await page.locator('#ranking-template').inputValue(); page.__qaAcceptDialog = accept;
    await page.locator('#ranking-template').selectOption(id); page.__qaAcceptDialog = true;
    await page.waitForFunction(expected => document.body.dataset.rankingTemplate === expected && document.querySelector('#ranking-template').value === expected && document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true', accept ? id : previous);
  }
  async function seedStore(page, snapshot, key = 'current') {
    await page.evaluate(({ snapshot, key }) => new Promise((resolve, reject) => {
      const opening = indexedDB.open('xieyuqing-ranking-v1', 1); opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('rankings')) opening.result.createObjectStore('rankings'); }; opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => { const db = opening.result, transaction = db.transaction('rankings', 'readwrite'); transaction.objectStore('rankings').put(JSON.stringify(snapshot), key); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => { db.close(); reject(transaction.error); }; };
    }), { snapshot, key });
  }
  async function themeSample(page, route, scenario) {
    const sample = await page.evaluate(() => {
      const bodyBackground = getComputedStyle(document.body).backgroundColor, htmlBackground = getComputedStyle(document.documentElement).backgroundColor;
      const rankingMain = document.querySelector('.ranking-main');
      return { theme: document.documentElement.dataset.theme, bodyBackground, htmlBackground, visibleBackground: /^(transparent|rgba\(0, 0, 0, 0\))$/.test(bodyBackground) ? htmlBackground : bodyBackground, ...(rankingMain ? { rankingMainBackground: getComputedStyle(rankingMain).backgroundColor, rankingSkin: document.body.dataset.rankingSkin } : {}) };
    });
    report.themeSamples.push({ route, scenario, ...sample }); return sample;
  }
  async function assertClassicTable(page) {
    const style = await page.evaluate(() => {
      const css = selector => getComputedStyle(document.querySelector(selector)), board = css('.ranking-board'), row = css('.tier-row'), label = css('.tier-label'), card = css('.rank-card');
      return { theme: document.documentElement.dataset.theme, presentation: document.body.classList.contains('presentation'), skin: document.body.dataset.rankingSkin,
        body: css('body').backgroundColor, main: css('.ranking-main').backgroundColor, board: board.backgroundColor, row: row.backgroundColor, titleInk: css('#ranking-title').color, cardInk: css('.card-name').color,
        boardRadius: board.borderRadius, boardBorder: board.borderTopWidth, boardBorderColor: board.borderTopColor, labelBorder: label.borderRightWidth, labelBorderColor: label.borderRightColor,
        cardRadius: card.borderRadius, cardMainRadius: css('.card-main').borderRadius, cardArtRadius: css('.card-art').borderRadius, cardShadow: card.boxShadow, cardBorder: card.borderTopWidth, cardBackground: card.backgroundColor };
    });
    assert.equal(style.skin, 'classic'); assert.equal(style.main, 'rgb(247, 245, 238)');
    if (style.presentation) assert.equal(style.body, 'rgb(247, 245, 238)');
    assert.equal(style.board, 'rgb(243, 243, 243)'); assert.equal(style.row, 'rgb(243, 243, 243)');
    assert.equal(style.titleInk, 'rgb(23, 23, 23)'); assert.equal(style.cardInk, 'rgb(23, 23, 23)');
    assert.equal(style.boardRadius, '0px'); assert.equal(style.boardBorder, '2px'); assert.equal(style.boardBorderColor, 'rgb(38, 38, 38)');
    assert.equal(style.labelBorder, '2px'); assert.equal(style.labelBorderColor, 'rgb(38, 38, 38)');
    assert.equal(style.cardRadius, '0px'); assert.equal(style.cardMainRadius, '0px'); assert.equal(style.cardArtRadius, '0px'); assert.equal(style.cardShadow, 'none'); assert.equal(style.cardBorder, '0px'); assert.equal(style.cardBackground, 'rgba(0, 0, 0, 0)');
    return style;
  }
  async function touchDrag(ctx, page, from, to) {
    const session = await ctx.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...from, id: 0 }] });
    for (let step = 1; step <= 16; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * step / 16, y: from.y + (to.y - from.y) * step / 16, id: 0 }] });
    await page.waitForTimeout(80); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100); await session.detach();
  }
  try {
    const nativeDownloads = path.join(output, 'native-downloads'); fs.mkdirSync(nativeDownloads, { recursive: true });
    browser = await playwright.chromium.launch({ headless: true, downloadsPath: nativeDownloads, ...(chrome ? { executablePath: chrome } : {}) });
    report.browserVersion = browser.version();
    report.notes.push(process.env.RANKING_REAL_HTTP ? 'Isolated headless Chromium used a temporary real loopback server and native downloads. No user browser or visible window was used.' : 'Static responses were fulfilled from generated local files. Native browser downloads were still required.');
    const desktopContext = await context(), page = await ready(desktopContext);
    await check('all default built-in food photos load locally and image edits remain a cancellable draft', async () => {
      await page.waitForFunction(count => { const images = Array.from(document.querySelectorAll('#ranking-board .rank-card img')); return images.length === count && images.every(image => image.complete && image.naturalWidth > 0); }, defaultFoodKeys.length);
      const sources = await page.locator('#ranking-board .rank-card img').evaluateAll(images => images.map(image => new URL(image.src).pathname));
      assert.deepEqual(new Set(sources), new Set(defaultFoodKeys.map(key => '/assets/foods/' + key + '.webp')));
      report.classicDefaultLight = await assertClassicTable(page); await shot(page, 'default-photos-presentation.png'); await shot(page, 'classic-default-light.png'); await edit(page); await page.locator('#export-scale').selectOption('2');
      const defaultPng = await pngPixels(page, await download(page, '#png-export', 'default-food-ranking-2x.png')); assert.equal(defaultPng.width, 2400); assert(defaultPng.height > 1000); report.defaultFoodPng = defaultPng;
      await page.locator('#theme-toggle').click(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      report.classicEditorDark = await assertClassicTable(page);
      const darkPng = await pngPixels(page, await download(page, '#png-export', 'default-food-ranking-2x-dark-theme.png')); assert.equal(darkPng.pixelHash, defaultPng.pixelHash, 'Classic export pixels must be independent of the site theme');
      await page.locator('#presentation-toggle').click(); report.classicDefaultDark = await assertClassicTable(page); await shot(page, 'classic-default-dark.png');
      await edit(page); await page.locator('#theme-toggle').click();
      await page.locator('#ranking-skin').selectOption('tech'); report.defaultFoodTechPng = await pngPixels(page, await download(page, '#png-export', 'default-food-ranking-tech-2x.png')); await page.locator('#ranking-skin').selectOption('classic');
      const before = await state(page, 'builtin-before');
      await openItem(page, 'food-sichuan-hotpot'); await zoom(page, 2); await page.locator('#item-cancel').click(); assert.deepEqual(await state(page, 'builtin-cancel'), before);
      await openItem(page, 'food-sichuan-hotpot'); await zoom(page, 2); await page.locator('#item-save').click(); const saved = await state(page, 'builtin-crop-saved');
      assert(saved.items['food-sichuan-hotpot'].image.startsWith('data:image/')); assert.equal(saved.items['food-sichuan-hotpot'].art, null); assert(saved.items['food-sichuan-hotpot'].crop);
      assert.equal(Object.values(saved.items).filter(item => item.art).length, defaultFoodKeys.length - 1);
    });
    await edit(page);
    await check('ranking has no fixed preference caption in its DOM or generated export source', async () => {
      assert.equal(await page.locator('.board-caption').count(), 0);
      assert.equal(await page.locator('body').evaluate(body => body.textContent.includes('个人偏好 · 随心排一排')), false);
      assert.equal(fs.readFileSync(path.join(site, 'assets', 'ranking-export.js'), 'utf8').includes('个人偏好 · 随心排一排'), false);
    });
    const original = await pattern(page), replacement = await pattern(page, '#00dc40', '#ffb000');
    const base = fixture(original);
    await importState(page, base);
    await check('template switching confirms, can undo, and preserves independent food and sport drafts', async () => {
      await page.locator('#ranking-skin').selectOption('tech'); await waitSaved(page); const food = await state(page, 'food-before-template-switch');
      await page.locator('#presentation-toggle').click(); assert(await page.locator('#ranking-template').isVisible()); await chooseTemplate(page, 'sport', false); await edit(page); assert.deepEqual(await state(page, 'template-switch-cancelled'), food);
      await chooseTemplate(page, 'sport'); await edit(page); const firstSport = await state(page, 'sport-first-default');
      assert.equal(firstSport.version, 3); assert.equal(firstSport.templateId, 'sport'); assert.equal(firstSport.title, '运动从夯到拉'); assert.equal(firstSport.skin, 'tech', 'A first-time target template inherits the current skin');
      assert.deepEqual(firstSport.rows.map(row => ({ name: row.name, color: row.color, names: row.itemIds.map(id => firstSport.items[id].name) })), sportRows); assert.deepEqual(firstSport.pool, []); assert.equal(Object.keys(firstSport.items).length, sportKeys.length);
      await page.waitForFunction(count => { const images = Array.from(document.querySelectorAll('#ranking-board .rank-card img')); return images.length === count && images.every(image => image.complete && image.naturalWidth > 0); }, sportKeys.length);
      assert.deepEqual(new Set(await page.locator('#ranking-board .rank-card img').evaluateAll(images => images.map(image => new URL(image.src).pathname))), new Set(sportKeys.map(key => '/assets/sports/' + key + '.webp')));
      await page.locator('#ranking-skin').selectOption('classic'); await waitSaved(page); assert.match(await page.locator('#undo-clear').textContent(), /撤销.*(切换|模板)/); await page.locator('#undo-clear').click();
      await page.waitForFunction(() => document.body.dataset.rankingTemplate === 'food' && document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true'); await edit(page); assert.deepEqual(await state(page, 'template-switch-undone'), food);
      await chooseTemplate(page, 'sport'); await edit(page); assert.equal(await page.locator('#ranking-skin').inputValue(), 'classic', 'An existing template restores its own saved skin');
      await assertClassicTable(page); report.sportClassicPng = await pngPixels(page, await download(page, '#png-export', 'default-sport-ranking-classic-2x.png')); await page.locator('#presentation-toggle').click(); await shot(page, 'sport-default-classic.png'); await edit(page);
      await page.locator('#ranking-skin').selectOption('tech'); report.sportTechPng = await pngPixels(page, await download(page, '#png-export', 'default-sport-ranking-tech-2x.png')); await shot(page, 'sport-default-tech.png');
      await page.locator('#ranking-skin').selectOption('classic'); await page.locator('#ranking-title').fill('独立保存的运动排行'); await page.locator('#ranking-title').blur();
      await openItem(page, 'sport-walking'); await page.locator('#item-name').fill('自定义散步图片'); await page.locator('#item-image-file').setInputFiles({ name: 'my-sport.png', mimeType: 'image/png', buffer: Buffer.from(original.split(',')[1], 'base64') });
      await page.waitForFunction(() => !document.querySelector('#item-save').disabled && document.querySelector('#crop-preview').getAttribute('aria-busy') !== 'true'); await page.locator('#item-save').click(); await waitSaved(page); const sport = await state(page, 'sport-custom-draft');
      assert(sport.items['sport-walking'].image.startsWith('data:image/')); assert.equal(sport.items['sport-walking'].art, null);
      await chooseTemplate(page, 'food'); await edit(page); assert.deepEqual(await state(page, 'food-draft-returned'), food);
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('#ranking-app').waitFor({ state: 'visible' }); await edit(page); assert.equal(await page.locator('#ranking-template').inputValue(), 'food'); assert.deepEqual(await state(page, 'food-draft-after-reload'), food);
      await chooseTemplate(page, 'sport'); await edit(page); assert.deepEqual(await state(page, 'sport-draft-returned'), sport);
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('#ranking-app').waitFor({ state: 'visible' }); await edit(page); assert.equal(await page.locator('#ranking-template').inputValue(), 'sport'); assert.deepEqual(await state(page, 'sport-draft-after-reload'), sport);
      assert.match(await page.locator('#reset-ranking').textContent(), /恢复默认运动排行/); const theme = await page.locator('html').getAttribute('data-theme'); await page.locator('#reset-ranking').click(); await edit(page); const reset = await state(page, 'sport-default-restored');
      assert.equal(reset.templateId, 'sport'); assert.equal(reset.title, '运动从夯到拉'); assert.equal(reset.skin, sport.skin); assert.equal(await page.locator('html').getAttribute('data-theme'), theme); assert.deepEqual(reset.rows.map(row => ({ name: row.name, color: row.color, names: row.itemIds.map(id => reset.items[id].name) })), sportRows);
      await page.locator('#undo-clear').click(); assert.deepEqual(await state(page, 'sport-default-restore-undone'), sport);
      await chooseTemplate(page, 'food'); await edit(page); assert.deepEqual(await state(page, 'food-draft-final'), food); await importState(page, base);
    });
    await check('clear confirmation and undo preserve title, tiers, item data, and current skin', async () => {
      const before = await state(page, 'before-clear');
      page.__qaAcceptDialog = false; await page.locator('#clear-items').click(); page.__qaAcceptDialog = true;
      assert.deepEqual(await state(page, 'clear-cancelled'), before);
      await page.locator('#clear-items').click();
      const empty = await state(page, 'cleared');
      assert.equal(Object.keys(empty.items).length, 0); assert.deepEqual(empty.pool, []);
      assert.equal(empty.title, before.title); assert.equal(empty.skin, before.skin);
      assert.deepEqual(empty.rows, before.rows.map(row => ({ ...row, itemIds: [] })));
      assert.equal(await page.locator('#undo-clear').isDisabled(), false);
      await page.locator('#ranking-skin').selectOption('tech');
      assert.equal(await page.locator('#undo-clear').isDisabled(), false);
      await page.locator('#undo-clear').click();
      const restored = await state(page, 'clear-undone');
      assert.deepEqual(restored, { ...before, skin: 'tech' });
      await page.locator('#clear-items').click();
      await page.locator('#text-name').fill('清空后的新项目'); await page.locator('#add-text-form').evaluate(form => form.requestSubmit());
      assert((await page.locator('#undo-clear').isDisabled()) || !(await page.locator('#undo-clear').isVisible()), 'New data edits must invalidate the old clear snapshot');
      assert.equal(Object.keys((await state(page, 'undo-invalidated')).items).length, 1);
      await importState(page, base);
    });
    await check('restore-default confirmation and undo preserve custom images, current skin, and site theme', async () => {
      await page.locator('#ranking-skin').selectOption('tech'); await page.locator('#theme-toggle').click(); const theme = await page.locator('html').getAttribute('data-theme');
      const before = await state(page, 'before-default-restore'); assert.match(await page.locator('#reset-ranking').textContent(), /恢复默认美食排行/);
      page.__qaAcceptDialog = false; await page.locator('#reset-ranking').click(); page.__qaAcceptDialog = true; assert.deepEqual(await state(page, 'default-restore-cancel'), before);
      await page.locator('#reset-ranking').click(); assert(await page.locator('body').evaluate(body => body.classList.contains('presentation'))); assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await edit(page); const restored = await state(page, 'default-restored'); assert.equal(restored.title, '美食从夯到拉'); assert.equal(restored.skin, 'tech'); assert.deepEqual(restored.pool, []);
      assert.deepEqual(restored.rows.map(row => ({ name: row.name, color: row.color, names: row.itemIds.map(id => restored.items[id].name) })), defaultRows);
      assert.equal(Object.keys(restored.items).length, defaultFoodKeys.length); assert.match(await page.locator('#undo-clear').textContent(), /撤销恢复默认/);
      await page.locator('#ranking-skin').selectOption('classic'); await page.locator('#undo-clear').click(); assert.deepEqual(await state(page, 'default-restore-undone'), { ...before, skin: 'classic' }); assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.locator('#theme-toggle').click(); await importState(page, base);
    });
    await check('external batch file drops import into pool and tier while cancelling browser navigation', async () => {
      const url = page.url();
      async function drop(selector, prefix) {
        return page.evaluate(({ selector, original, prefix }) => {
          const transfer = new DataTransfer(), binary = atob(original.split(',')[1]), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          for (let i = 1; i <= 2; i++) transfer.items.add(new File([bytes], `${prefix}-${i}.png`, { type: 'image/png' }));
          const target = document.querySelector(selector), over = new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }), event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true });
          target.dispatchEvent(over); target.dispatchEvent(event); return { overPrevented: over.defaultPrevented, dropPrevented: event.defaultPrevented };
        }, { selector, original, prefix });
      }
      const poolDrop = await drop('#candidate-pool', 'pool-drop');
      await page.waitForFunction(() => document.querySelectorAll('.rank-card').length === 6);
      assert(poolDrop.overPrevented && poolDrop.dropPrevented); assert.equal(page.url(), url);
      const rowDrop = await drop('.tier-row[data-row-id="test-b"]', 'row-drop');
      await page.waitForFunction(() => document.querySelectorAll('.rank-card').length === 8);
      assert(rowDrop.overPrevented && rowDrop.dropPrevented); assert.equal(page.url(), url);
      const outside = await page.evaluate(() => {
        const transfer = new DataTransfer(); transfer.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'unsupported.svg', { type: 'image/svg+xml' }));
        const event = new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }); document.body.dispatchEvent(event); return event.defaultPrevented;
      });
      assert(outside, 'Document-level file drops must be cancelled even outside valid targets'); assert.equal(page.url(), url);
      await page.waitForTimeout(100);
      const dropped = await state(page, 'external-drops');
      assert.deepEqual(dropped.pool.map(id => dropped.items[id].name), ['待选甲', '待选乙', 'pool-drop-1', 'pool-drop-2']);
      assert.deepEqual(dropped.rows[1].itemIds.map(id => dropped.items[id].name), ['row-drop-1', 'row-drop-2']);
      const newImages = Object.values(dropped.items).filter(item => /^(pool|row)-drop-/.test(item.name));
      assert.equal(newImages.length, 4); assert(newImages.every(item => item.crop && item.image.startsWith('data:image/')));
      report.notes.push('External file drops used browser-native DataTransfer/File objects dispatched to the actual drop handlers; operating-system file dragging was not automated.');
      await importState(page, base);
    });
    await check('item crop, name, grade, and replacement drafts are discarded by cancel and Escape', async () => {
      const before = await state(page, 'before-cancel');
      await openItem(page); await page.locator('#item-name').fill('取消时不应保存'); await page.locator('#item-target').selectOption('test-b'); await zoom(page, 2);
      await page.locator('#item-image-file').setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1], 'base64') });
      await page.waitForFunction(() => !document.querySelector('#item-save').disabled && document.querySelector('#crop-preview').getAttribute('aria-busy') !== 'true');
      await shot(page, 'desktop-crop-dialog.png'); await page.locator('#item-cancel').click();
      assert.deepEqual(await state(page, 'cancelled-draft'), before);
      await openItem(page); await zoom(page, 3); await page.keyboard.press('Escape');
      assert.deepEqual(await state(page, 'escaped-draft'), before);
      await openItem(page); await page.locator('#item-image-file').setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="window.__qaUnsafeSvg=1"/>') });
      await page.waitForFunction(() => /SVG|支持/.test(document.querySelector('#item-error').textContent)); assert.equal(await page.evaluate(() => Boolean(window.__qaUnsafeSvg)), false);
      await page.locator('#item-cancel').click(); assert.deepEqual(await state(page, 'invalid-replacement-cancel'), before);
      await openItem(page); assert.match(await page.locator('#crop-status').textContent(), /完整|尚未裁/); await page.locator('#item-cancel').click();
    });
    await check('rapidly cancelled asynchronous image opens cannot leak into the next item', async () => {
      const before = await state(page, 'before-rapid-open');
      await page.evaluate(() => {
        window.__qaOriginalDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = function () { const pending = window.__qaOriginalDecode.call(this); return new Promise(resolve => setTimeout(resolve, 300)).then(() => pending); };
      });
      try {
        await page.locator('.rank-card[data-item-id="crop-image"] .card-main').click();
        await page.locator('#item-dialog').waitFor({ state: 'visible' });
        await page.locator('#item-cancel').click();
        await openItem(page, 'row-text'); await page.waitForTimeout(400);
        assert.equal(await page.locator('#item-name').inputValue(), '保留文字');
        assert.match(await page.locator('#crop-status').textContent(), /暂无图片/);
        assert.equal(await page.locator('#crop-reset').isDisabled(), true);
        await page.locator('#item-cancel').click();
      } finally { await page.evaluate(() => { HTMLImageElement.prototype.decode = window.__qaOriginalDecode; }); }
      assert.deepEqual(await state(page, 'rapid-open-cancelled'), before);
    });
    await check('replacement and removal commit only on Save and keep item identity', async () => {
      await openItem(page); await page.locator('#crop-zoom').focus(); let fileInputReached = false;
      for (let index = 0; index < 6; index++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.id === 'item-image-file')) { fileInputReached = true; break; } }
      assert(fileInputReached, 'The visually hidden image input must remain reachable with Tab');
      const chooserPending = page.waitForEvent('filechooser'); await page.locator('label[for="item-image-file"]').click(); const chooser = await chooserPending;
      await chooser.setFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1], 'base64') });
      await page.waitForFunction(() => !document.querySelector('#item-save').disabled && document.querySelector('#crop-preview').getAttribute('aria-busy') !== 'true');
      await page.locator('#item-save').click();
      const changed = await state(page, 'replacement-saved');
      assert.notEqual(changed.items['crop-image'].image, original); assert.equal(changed.items['crop-image'].name, base.items['crop-image'].name); cropInBounds(changed.items['crop-image'].crop);
      await openItem(page); await page.locator('#item-image-remove').click(); assert.equal(await page.locator('#crop-reset').isDisabled(), true); await page.locator('#item-save').click();
      const removed = await state(page, 'image-removed');
      assert.equal(removed.items['crop-image'].image, null); assert.equal(removed.items['crop-image'].art, null); assert.equal(removed.items['crop-image'].crop, null);
      assert.deepEqual(removed.rows[0].itemIds, base.rows[0].itemIds);
      await importState(page, base);
    });
    let cropped;
    await check('square zoom, mouse drag, and keyboard crop retain the single original source', async () => {
      await openItem(page); await zoom(page, 2); await page.locator('#item-save').click();
      const zoomed = await state(page, 'zoomed'); cropInBounds(zoomed.items['crop-image'].crop);
      assert(Math.abs(zoomed.items['crop-image'].crop.size - 100) < 0.02);
      await openItem(page); const canvas = page.locator('#crop-preview'); await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 15, { steps: 10 }); await page.mouse.up();
      await page.locator('#item-save').click();
      const dragged = await state(page, 'mouse-crop'); cropInBounds(dragged.items['crop-image'].crop);
      assert.notDeepEqual(dragged.items['crop-image'].crop, zoomed.items['crop-image'].crop);
      await openItem(page); await page.locator('#crop-preview').focus();
      for (let index = 0; index < 80; index++) await page.keyboard.press('Shift+ArrowLeft');
      await page.locator('#item-save').click(); cropped = await state(page, 'keyboard-left-crop');
      cropInBounds(cropped.items['crop-image'].crop); assert.equal(cropped.items['crop-image'].crop.x, 0);
      assert(cropped.items['crop-image'].crop.x + cropped.items['crop-image'].crop.size <= 200);
      assert.equal(cropped.items['crop-image'].image, original, 'Cropping must preserve the original data URL rather than save another cropped raster');
    });
    await check('downloaded PNG contains the selected red source region and excludes the blue half', async () => {
      const pixels = await pngPixels(page, await download(page, '#png-export', 'crop-red-only.png'));
      assert(pixels.red > 10000); assert(pixels.blue < Math.max(30, pixels.red * 0.001));
      return pixels;
    });
    await check('center reset is reversible and produces the original centered square when saved', async () => {
      await openItem(page); await page.locator('#crop-reset').click(); await page.locator('#item-cancel').click(); assert.deepEqual(await state(page, 'reset-cancelled'), cropped);
      await openItem(page); await page.locator('#crop-reset').click(); await page.locator('#item-save').click();
      const reset = await state(page, 'center-reset'); assert.deepEqual(reset.items['crop-image'].crop, { x: 100, y: 0, size: 200 }); assert.equal(reset.items['crop-image'].image, original);
      const pixels = await pngPixels(page, await download(page, '#png-export', 'crop-centered-both-colors.png'));
      assert(pixels.red > 10000 && pixels.blue > 10000);
      assert(Math.abs(pixels.red - pixels.blue) < Math.max(pixels.red, pixels.blue) * 0.1);
      await importState(page, cropped); return pixels;
    });
    await check('JSON and IndexedDB preserve crop descriptors and original images on reload', async () => {
      assert.deepEqual(await state(page, 'json-crop-roundtrip'), cropped); await waitSaved(page);
      assert.deepEqual(await rawStore(page), cropped);
      await page.reload({ waitUntil: 'networkidle' }); await page.locator('#ranking-app').waitFor({ state: 'visible' }); await edit(page);
      assert.deepEqual(await state(page, 'idb-crop-restored'), cropped);
      const pixels = await pngPixels(page, await download(page, '#png-export', 'crop-restored-red-only.png')); assert(pixels.red > 10000 && pixels.blue < 30); return pixels;
    });
    await check('classic spreadsheet and tech skins persist with distinct PNG layout and theme-independent colors', async () => {
      await page.locator('#ranking-skin').selectOption('classic');
      await assertClassicTable(page);
      const classic = await pngPixels(page, await download(page, '#png-export', 'classic-skin.png'));
      await page.locator('#theme-toggle').click(); await assertClassicTable(page); await shot(page, 'classic-dark.png');
      const classicDark = await pngPixels(page, await download(page, '#png-export', 'classic-skin-dark-theme.png')); assert.equal(classicDark.pixelHash, classic.pixelHash);
      await page.locator('#theme-toggle').click();
      await page.locator('#ranking-skin').selectOption('tech'); assert.equal(await page.locator('body').getAttribute('data-ranking-skin'), 'tech');
      const techState = await state(page, 'tech-skin'); assert.equal(techState.skin, 'tech'); assert.deepEqual(techState.items, cropped.items);
      const tech = await pngPixels(page, await download(page, '#png-export', 'tech-skin.png'));
      assert.deepEqual(classic.corner, [247, 245, 238, 255]); assert.deepEqual(tech.corner, [247, 245, 238, 255]);
      assert(classic.palette.classicRow > 10000 && classic.palette.classicInk > 100 && classic.palette.classicBorder > 1000);
      assert(tech.palette.techRow > 10000 && tech.palette.techInk > 100 && tech.palette.techBorder > 1000);
      assert.notEqual(classic.pixelHash, tech.pixelHash); assert(classic.height < tech.height); assert.equal(tech.width, 2400); assert.equal(tech.height, 988);
      await shot(page, 'tech-light.png'); await page.locator('#theme-toggle').click(); await shot(page, 'tech-dark.png');
      await waitSaved(page); await page.reload({ waitUntil: 'networkidle' }); await page.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.equal(await page.locator('body').getAttribute('data-ranking-skin'), 'tech'); await edit(page); assert.deepEqual(await state(page, 'tech-restored'), techState);
      return { classic, classicDark, tech };
    });
    await check('quick card removal requires confirmation and cannot start a drag', async () => {
      const before = await state(page, 'before-quick-remove'); page.__qaAcceptDialog = false;
      await page.locator('.rank-card[data-item-id="pool-a"] .card-remove').click(); page.__qaAcceptDialog = true;
      assert.deepEqual(await state(page, 'quick-remove-cancel'), before);
      await page.locator('.rank-card[data-item-id="pool-a"] .card-remove').click(); const after = await state(page, 'quick-remove');
      assert.equal(Object.keys(after.items).length, Object.keys(before.items).length - 1); assert.equal(after.items['pool-a'], undefined);
      assert.equal(await page.locator('.drag-ghost').count(), 0); assert.equal(await page.locator('body').evaluate(body => body.classList.contains('dragging')), false);
    });
    await check('legacy v1 storage migrates in memory without an initialization overwrite', async () => {
      const legacyContext = await context(), legacyPage = await legacyContext.newPage(); await legacyPage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const legacy = { version: 1, title: '已有的旧版个人排行', rows: [{ id: 'legacy-row', name: '旧版自定义等级', color: '#c0c8b0', itemIds: ['legacy-image', 'legacy-photo'] }], pool: [], items: { 'legacy-image': { id: 'legacy-image', name: '旧图原貌', image: original, art: null }, 'legacy-photo': { id: 'legacy-photo', name: '旧版内置奶茶', image: null, art: 'tea' } } };
      await legacyPage.evaluate(legacy => new Promise((resolve, reject) => {
        const opening = indexedDB.open('xieyuqing-ranking-v1', 1); opening.onupgradeneeded = () => { if (!opening.result.objectStoreNames.contains('rankings')) opening.result.createObjectStore('rankings'); }; opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => { const db = opening.result, transaction = db.transaction('rankings', 'readwrite'); transaction.objectStore('rankings').put(JSON.stringify(legacy), 'current'); transaction.oncomplete = () => { db.close(); resolve(); }; transaction.onerror = () => { db.close(); reject(transaction.error); }; };
      }), legacy);
      await legacyPage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await legacyPage.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.equal(await legacyPage.locator('#ranking-title').inputValue(), legacy.title); assert.equal(await legacyPage.locator('.tier-row').count(), 1); assert.equal(await legacyPage.locator('body').getAttribute('data-ranking-skin'), 'classic');
      assert.equal(await legacyPage.locator('.rank-card[data-item-id="legacy-image"] img').getAttribute('src'), original); assert.equal(new URL(await legacyPage.locator('.rank-card[data-item-id="legacy-photo"] img').getAttribute('src'), origin).pathname, '/assets/foods/tea.webp');
      await legacyPage.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }); await legacyPage.waitForTimeout(500);
      assert.deepEqual(await rawStore(legacyPage), legacy, 'Loading and leaving a v1 ranking must not write defaults or silently replace its stored snapshot');
      await edit(legacyPage); const migrated = await state(legacyPage, 'legacy-v3-memory'); assert.equal(migrated.version, 3); assert.equal(migrated.templateId, 'food'); assert.equal(migrated.skin, 'classic'); assert.equal(migrated.items['legacy-image'].crop, null); assert.equal(migrated.items['legacy-image'].image, original);
      await legacyPage.locator('#ranking-title').fill('旧版编辑后保存为v3'); await legacyPage.locator('#ranking-title').blur(); await waitSaved(legacyPage); const saved = await rawStore(legacyPage); assert.equal(saved.version, 3); assert.equal(saved.title, '旧版编辑后保存为v3'); assert.equal(saved.items['legacy-image'].crop, null);
    });
    await check('legacy v2 storage keeps its crop, old food identity, and skin while migrating to the food template', async () => {
      const oldContext = await context(), oldPage = await oldContext.newPage(); await oldPage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const legacy = { version: 2, title: '旧二版自定义榜单', skin: 'tech', rows: [{ id: 'v2-row', name: '原有等级', color: '#c4d0ba', itemIds: ['v2-image', 'v2-noodles'] }, ...Array.from({ length: 5 }, (_, index) => ({ id: `v2-extra-${index}`, name: `保留旧自定义第${index + 2}档`, color: '#c4d0ba', itemIds: [] }))], pool: [], items: {
        'v2-image': { id: 'v2-image', name: '旧版保留的裁图', image: original, art: null, crop: { x: 0, y: 0, size: 200 } },
        'v2-noodles': { id: 'v2-noodles', name: '面条', image: null, art: 'noodles', crop: null }
      } };
      await seedStore(oldPage, legacy); await oldPage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await oldPage.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.equal(await oldPage.locator('#ranking-template').inputValue(), 'food'); assert.equal(await oldPage.locator('#ranking-title').inputValue(), legacy.title); assert.equal(await oldPage.locator('#ranking-skin').inputValue(), 'tech');
      assert.equal(await oldPage.locator('.tier-row').count(), 6, 'Existing custom six-tier rankings must not be reduced to the five-tier defaults');
      assert.equal(new URL(await oldPage.locator('.rank-card[data-item-id="v2-noodles"] img').getAttribute('src'), origin).pathname, '/assets/foods/noodles.webp');
      await oldPage.waitForTimeout(500); assert.deepEqual(await rawStore(oldPage), legacy); await edit(oldPage); const migrated = await state(oldPage, 'v2-migrated-v3');
      assert.deepEqual(migrated, { ...legacy, version: 3, templateId: 'food' }); assert.deepEqual(await rawStore(oldPage), legacy);
      await oldPage.locator('#ranking-title').fill('v2编辑后保存'); await oldPage.locator('#ranking-title').blur(); await waitSaved(oldPage); const saved = await rawStore(oldPage); assert.equal(saved.version, 3); assert.equal(saved.templateId, 'food'); assert.deepEqual(saved.items, legacy.items);
    });
    await check('cross-template JSON import archives an untouched legacy current and cancellation writes nothing', async () => {
      const archiveContext = await context(), archivePage = await archiveContext.newPage(); await archivePage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const legacy = { ...fixture(original), version: 2, title: '尚未归档的旧六档美食排行', skin: 'classic' }; delete legacy.templateId;
      legacy.rows.push(...Array.from({ length: 4 }, (_, index) => ({ id: `archive-${index}`, name: `额外自定义${index}`, color: '#c4d0ba', itemIds: [] })));
      const migrated = { ...legacy, version: 3, templateId: 'food' }, incoming = { ...fixture(original), templateId: 'sport', title: '导入的自定义运动排行', skin: 'tech' };
      await seedStore(archivePage, legacy); await archivePage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await archivePage.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.equal(await rawStore(archivePage, 'template:food'), null);
      await attemptImport(archivePage, incoming, false); assert.deepEqual(await state(archivePage, 'cancelled-cross-template-import'), migrated);
      assert.deepEqual(await rawStore(archivePage), legacy); assert.equal(await rawStore(archivePage, 'template:food'), null); assert.equal(await rawStore(archivePage, 'template:sport'), null);
      await attemptImport(archivePage, incoming); await waitSaved(archivePage); assert.deepEqual(await rawStore(archivePage, 'template:food'), migrated); assert.deepEqual(await state(archivePage, 'accepted-cross-template-import'), incoming);
      await archivePage.reload({ waitUntil: 'networkidle' }); await archivePage.locator('#ranking-app').waitFor({ state: 'visible' }); assert.equal(await archivePage.locator('#ranking-template').inputValue(), 'sport');
      await chooseTemplate(archivePage, 'food'); await edit(archivePage); assert.deepEqual(await state(archivePage, 'archived-legacy-food-after-refresh'), migrated);
    });
    await check('a failed legacy archive aborts cross-template import before changing current or draft keys', async () => {
      const quotaContext = await context(), quotaPage = await quotaContext.newPage(); await quotaPage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const legacy = { ...fixture(original), version: 2, title: '归档失败必须保留的美食' }; delete legacy.templateId;
      const incoming = { ...fixture(original), templateId: 'sport', title: '不得导入的运动排行' };
      await seedStore(quotaPage, legacy); await quotaPage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await quotaPage.locator('#ranking-app').waitFor({ state: 'visible' });
      await quotaPage.evaluate(() => { const originalPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(value, key) { if (key === 'template:food') throw new DOMException('Test archive quota', 'QuotaExceededError'); return originalPut.apply(this, arguments); }; });
      await attemptImport(quotaPage, incoming); assert.equal(await quotaPage.locator('#tool-message').getAttribute('data-error'), 'true');
      assert.deepEqual(await state(quotaPage, 'archive-quota-current'), { ...legacy, version: 3, templateId: 'food' }); assert.deepEqual(await rawStore(quotaPage), legacy);
      assert.equal(await rawStore(quotaPage, 'template:food'), null); assert.equal(await rawStore(quotaPage, 'template:sport'), null);
    });
    await check('damaged target templates require a second confirmation and rebuild only the selected target', async () => {
      const damageContext = await context(), damagePage = await ready(damageContext); await importState(damagePage, base); await waitSaved(damagePage);
      const before = await state(damagePage, 'damaged-target-food-before'), broken = { version: 999, title: '损坏的运动模板原件' }; await seedStore(damagePage, broken, 'template:sport');
      const dialogCount = damagePage.__qaDialogs.length; damagePage.__qaDialogAnswers = [true, false]; await damagePage.locator('#ranking-template').selectOption('sport');
      await damagePage.waitForFunction(() => document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true' && document.body.dataset.rankingTemplate === 'food');
      assert.equal(damagePage.__qaDialogs.length - dialogCount, 2); assert.deepEqual(await state(damagePage, 'damaged-target-cancelled'), before);
      assert.deepEqual(await rawStore(damagePage), before); assert.deepEqual(await rawStore(damagePage, 'template:sport'), broken);
      damagePage.__qaDialogAnswers = [true, true]; await damagePage.locator('#ranking-template').selectOption('sport');
      await damagePage.waitForFunction(() => document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true' && document.body.dataset.rankingTemplate === 'sport'); await waitSaved(damagePage);
      const rebuilt = await rawStore(damagePage, 'template:sport'); assert.equal(rebuilt.templateId, 'sport'); assert.equal(Object.keys(rebuilt.items).length, sportKeys.length);
      assert.deepEqual(rebuilt.rows.map(row => ({ name: row.name, color: row.color, names: row.itemIds.map(id => rebuilt.items[id].name) })), sportRows);
      assert.deepEqual(await rawStore(damagePage, 'template:food'), before); await chooseTemplate(damagePage, 'food'); await edit(damagePage); assert.deepEqual(await state(damagePage, 'damaged-target-food-preserved'), before);
    });
    await check('rebuilding a damaged target cannot overwrite a separately damaged protected current', async () => {
      const protectedContext = await context(), protectedPage = await protectedContext.newPage(); await protectedPage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const corrupt = { version: 999, title: '受保护的current原件' }, broken = { version: 999, title: '只可重建的sport原件' };
      await seedStore(protectedPage, corrupt); await seedStore(protectedPage, broken, 'template:sport'); await protectedPage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await protectedPage.locator('#ranking-app').waitFor({ state: 'visible' });
      protectedPage.__qaDialogAnswers = [true, true]; await protectedPage.locator('#ranking-template').selectOption('sport');
      await protectedPage.waitForFunction(() => document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true' && document.body.dataset.rankingTemplate === 'sport');
      await edit(protectedPage); await protectedPage.locator('#ranking-title').fill('保护中的临时运动草稿'); await protectedPage.locator('#ranking-title').blur();
      await protectedPage.waitForFunction(() => document.querySelector('#save-status').dataset.failed === 'true' && /受保护/.test(document.querySelector('#save-status').textContent));
      assert.deepEqual(await rawStore(protectedPage), corrupt); const recovered = await rawStore(protectedPage, 'template:sport'); assert.equal(recovered.templateId, 'sport'); assert.equal(recovered.title, '运动从夯到拉'); assert.equal(Object.keys(recovered.items).length, sportKeys.length);
    });
    await check('immediate template undo archives the departed skin and restores the source skin across reload', async () => {
      const undoContext = await context(), undoPage = await ready(undoContext); await importState(undoPage, base); await waitSaved(undoPage);
      await chooseTemplate(undoPage, 'sport'); await edit(undoPage); await undoPage.locator('#ranking-skin').selectOption('tech'); await undoPage.locator('#undo-clear').click();
      await undoPage.waitForFunction(() => document.querySelector('#ranking-app').getAttribute('aria-busy') !== 'true' && document.body.dataset.rankingTemplate === 'food'); await waitSaved(undoPage);
      assert.equal(await undoPage.locator('#ranking-skin').inputValue(), 'classic'); await undoPage.reload({ waitUntil: 'networkidle' }); await undoPage.locator('#ranking-app').waitFor({ state: 'visible' });
      await chooseTemplate(undoPage, 'sport'); assert.equal(await undoPage.locator('#ranking-skin').inputValue(), 'tech');
    });
    await check('a corrupt stored current remains protected across template switches and edits until confirmed reset', async () => {
      const protectedContext = await context(), protectedPage = await protectedContext.newPage(); await protectedPage.goto(origin + '/game/', { waitUntil: 'networkidle' });
      const corrupt = { version: 999, title: '原始损坏数据必须保留', unknown: ['original', 7] };
      await seedStore(protectedPage, corrupt); await protectedPage.goto(origin + '/game/ranking/', { waitUntil: 'networkidle' }); await protectedPage.locator('#ranking-app').waitFor({ state: 'visible' });
      assert.deepEqual(await rawStore(protectedPage), corrupt); assert.equal(await protectedPage.locator('#save-status').getAttribute('data-failed'), 'true');
      await chooseTemplate(protectedPage, 'sport'); await edit(protectedPage); await protectedPage.locator('#ranking-title').fill('受保护时的临时运动编辑'); await protectedPage.locator('#ranking-title').blur();
      await protectedPage.waitForFunction(() => document.querySelector('#save-status').dataset.failed === 'true' && /受保护/.test(document.querySelector('#save-status').textContent));
      await protectedPage.waitForTimeout(400); assert.deepEqual(await rawStore(protectedPage), corrupt, 'Switching and editing must not overwrite an unreadable current snapshot');
      await protectedPage.locator('#reset-ranking').click(); await waitSaved(protectedPage); const restored = await rawStore(protectedPage);
      assert.equal(restored.version, 3); assert.equal(restored.templateId, 'sport'); assert.equal(restored.title, '运动从夯到拉');
      assert.deepEqual(restored.rows.map(row => ({ name: row.name, color: row.color, names: row.itemIds.map(id => restored.items[id].name) })), sportRows);
    });
    const mobileContext = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), mobile = await ready(mobileContext);
    report.classicMobile = await assertClassicTable(mobile); await shot(mobile, 'classic-default-mobile.png');
    await chooseTemplate(mobile, 'sport');
    await mobile.waitForFunction(() => Array.from(document.querySelectorAll('#ranking-board .rank-card img')).every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await mobile.locator('.rank-card').count(), sportKeys.length);
    assert.deepEqual(new Set(await mobile.locator('#ranking-board .rank-card img').evaluateAll(images => images.map(image => new URL(image.src).pathname))), new Set(sportKeys.map(key => '/assets/sports/' + key + '.webp')));
    await assertClassicTable(mobile); await shot(mobile, 'sport-default-classic-mobile.png');
    await importState(mobile, base);
    await check('mobile touch crop changes only the saved draft and remains within the source', async () => {
      await openItem(mobile, 'crop-image', true); await zoom(mobile, 2); await mobile.locator('#item-save').tap(); const before = await state(mobile, 'mobile-zoom');
      await openItem(mobile, 'crop-image', true); await mobile.locator('#crop-preview').scrollIntoViewIfNeeded(); const box = await mobile.locator('#crop-preview').boundingBox();
      await touchDrag(mobileContext, mobile, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 36, y: box.y + box.height / 2 + 18 });
      await shot(mobile, 'mobile-crop-dialog.png'); await mobile.locator('#item-save').tap(); const after = await state(mobile, 'mobile-touch-crop'); cropInBounds(after.items['crop-image'].crop);
      assert.notDeepEqual(after.items['crop-image'].crop, before.items['crop-image'].crop); assert.equal(after.items['crop-image'].image, original);
      await openItem(mobile, 'crop-image', true); await zoom(mobile, 4); await mobile.locator('#item-cancel').tap(); assert.deepEqual(await state(mobile, 'mobile-crop-cancel'), after);
    });
    await check('mobile internal touch dragging still moves a card without losing items', async () => {
      // Presentation has no drag icon; touch dragging starts from the whole card.
      await mobile.locator('#presentation-toggle').tap(); const handle = mobile.locator('.rank-card[data-item-id="pool-a"] .card-main'); await handle.scrollIntoViewIfNeeded();
      const from = await handle.boundingBox(), target = await mobile.locator('.tier-row[data-row-id="test-b"] .item-list').boundingBox();
      await touchDrag(mobileContext, mobile, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: target.x + 40, y: Math.max(70, Math.min(760, target.y + 35)) });
      assert.equal(await mobile.locator('.tier-row[data-row-id="test-b"] .rank-card[data-item-id="pool-a"]').count(), 1); assert.equal(await mobile.locator('.rank-card').count(), 4);
      await shot(mobile, 'mobile-v2-presentation.png');
      report.notes.push('Crop panning and internal dragging used real Chromium mouse input and emulated CDP touch input; physical devices were not operated.');
    });
    await check('all routes follow a dark or light system without a preference and keep a light HTML fallback', async () => {
      const noPreferenceContext = await context({ themePreference: null, colorScheme: 'dark' }), clean = await noPreferenceContext.newPage();
      const darkSurfaces = new Map();
      for (const route of themeRoutes) {
        const html = resource(origin + route).body.toString('utf8');
        assert.match(html, /<html\b[^>]*data-theme=["']light["']/i, `${route} must start with a light root attribute before theme scripts run`);
        await clean.goto(origin + route, { waitUntil: 'networkidle' });
        assert.equal(await clean.locator('html').getAttribute('data-theme'), 'dark', `${route} must follow the dark system theme when no preference exists`);
        darkSurfaces.set(route, (await themeSample(clean, route, 'system-dark-no-preference')).visibleBackground);
        if (route === '/game/ranking/') await assertClassicTable(clean);
        if (route === '/' || route === articleRoute) await shot(clean, route === '/' ? 'theme-home-system-dark.png' : 'theme-article-system-dark.png', { viewportOnly: true });
      }
      await clean.emulateMedia({ colorScheme: 'light' }); await clean.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      await clean.emulateMedia({ colorScheme: 'dark' }); await clean.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await clean.emulateMedia({ colorScheme: 'light' }); await clean.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      for (const route of themeRoutes) {
        await clean.goto(origin + route, { waitUntil: 'networkidle' }); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'light', `${route} must follow the light system theme without a preference`);
        const sample = await themeSample(clean, route, 'system-light-no-preference');
        if (route === '/game/ranking/') { assert.equal(sample.rankingMainBackground, 'rgb(247, 245, 238)'); assert.equal(sample.visibleBackground, 'rgb(247, 245, 238)'); await assertClassicTable(clean); }
        else assert.notEqual(sample.visibleBackground, darkSurfaces.get(route), `${route} must visibly change its page background between dark and light`);
        if (route === '/' || route === articleRoute) await shot(clean, route === '/' ? 'theme-home-system-light.png' : 'theme-article-system-light.png', { viewportOnly: true });
      }
      await edit(clean); await clean.locator('#ranking-skin').selectOption('classic');
      const surface = await clean.evaluate(() => {
        let background = getComputedStyle(document.body).backgroundColor;
        if (background === 'rgba(0, 0, 0, 0)' || background === 'transparent') background = getComputedStyle(document.documentElement).backgroundColor;
        return background.match(/[\d.]+/g).slice(0, 3).map(Number);
      });
      assert(surface.reduce((sum, channel) => sum + channel, 0) / 3 > 180, 'Classic skin in the light site theme must retain a light outer page');
      await clean.locator('#theme-toggle').click(); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'dark');
      await clean.emulateMedia({ colorScheme: 'dark' }); await clean.emulateMedia({ colorScheme: 'light' }); await clean.waitForTimeout(80); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'dark', 'Explicit selection must override subsequent system changes');
      await clean.goto(origin + '/about/', { waitUntil: 'networkidle' }); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'dark');
      await clean.reload({ waitUntil: 'networkidle' }); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'dark');
      await clean.locator('#theme-toggle').click(); await clean.goto(origin + '/game/', { waitUntil: 'networkidle' }); assert.equal(await clean.locator('html').getAttribute('data-theme'), 'light');
    });
    await check('an explicit dark theme survives every site route independently of ranking skin', async () => {
      const explicitContext = await context({ themePreference: 'dark', colorScheme: 'light' }), explicit = await explicitContext.newPage();
      for (const route of themeRoutes) {
        await explicit.goto(origin + route, { waitUntil: 'networkidle' }); assert.equal(await explicit.locator('html').getAttribute('data-theme'), 'dark', `${route} must keep an explicit dark preference`);
        await themeSample(explicit, route, 'explicit-dark-system-light');
      }
      await explicit.emulateMedia({ colorScheme: 'dark' }); await explicit.emulateMedia({ colorScheme: 'light' }); await explicit.waitForTimeout(80); assert.equal(await explicit.locator('html').getAttribute('data-theme'), 'dark');
      await edit(explicit); await explicit.locator('#ranking-skin').selectOption('classic'); assert.equal(await explicit.locator('html').getAttribute('data-theme'), 'dark');
      await explicit.locator('#ranking-skin').selectOption('tech'); assert.equal(await explicit.locator('html').getAttribute('data-theme'), 'dark');
      await explicit.locator('#theme-toggle').click(); assert.equal(await explicit.locator('body').getAttribute('data-ranking-skin'), 'tech');
      const lightContext = await context({ themePreference: 'light', colorScheme: 'dark' }), explicitLight = await lightContext.newPage();
      for (const route of themeRoutes) {
        await explicitLight.goto(origin + route, { waitUntil: 'networkidle' }); assert.equal(await explicitLight.locator('html').getAttribute('data-theme'), 'light', `${route} must keep an explicit light preference over a dark system`);
        await themeSample(explicitLight, route, 'explicit-light-system-dark');
      }
      await explicitLight.emulateMedia({ colorScheme: 'light' }); await explicitLight.emulateMedia({ colorScheme: 'dark' }); await explicitLight.waitForTimeout(80); assert.equal(await explicitLight.locator('html').getAttribute('data-theme'), 'light');
    });
    await check('denied theme storage follows the system and permits an in-memory toggle', async () => {
      const deniedContext = await context({ themePreference: null, blockThemeStorage: true, colorScheme: 'dark' }), denied = await deniedContext.newPage();
      for (const route of themeRoutes) {
        await denied.goto(origin + route, { waitUntil: 'networkidle' }); assert.equal(await denied.locator('html').getAttribute('data-theme'), 'dark');
        await themeSample(denied, route, 'denied-storage-system-dark');
      }
      await denied.emulateMedia({ colorScheme: 'light' }); await denied.waitForFunction(() => document.documentElement.dataset.theme === 'light');
      await edit(denied); await denied.locator('#theme-toggle').click(); assert.equal(await denied.locator('html').getAttribute('data-theme'), 'dark');
      await denied.reload({ waitUntil: 'networkidle' }); assert.equal(await denied.locator('html').getAttribute('data-theme'), 'light');
    });
    await check('unavailable system-theme APIs safely fall back to light on every route', async () => {
      const fallbackContext = await context({ themePreference: null, matchMediaUnavailable: true, colorScheme: 'dark' }), fallback = await fallbackContext.newPage();
      for (const route of themeRoutes) {
        await fallback.goto(origin + route, { waitUntil: 'networkidle' }); assert.equal(await fallback.locator('html').getAttribute('data-theme'), 'light');
        await themeSample(fallback, route, 'unavailable-system-api');
      }
    });
    await check('advanced flows produce no script errors, console errors, or external requests', async () => {
      assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.consoleErrors, []); assert.deepEqual(report.externalRequests, []);
    });
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close(); await new Promise(resolve => server.close(resolve));
    report.finishedAt = new Date().toISOString(); report.passed = report.checks.length > 0 && report.checks.every(check => check.passed);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
run().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
