// Independent local browser acceptance checks; no user browser or remote server.
// node scripts/test_photos_browser.cjs [generated-site] [evidence-directory]
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const site = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(__dirname, '..', '.local-checks', 'photos-browser'));
const origin = 'http://127.0.0.1:48734';
const testPattern = process.env.PHOTO_TEST_MATCH ? new RegExp(process.env.PHOTO_TEST_MATCH) : null;
const touchTrace = process.env.PHOTO_TOUCH_TRACE === '1';
const expectedAlbums = new Map();
const expectedPhotoAssets = new Set();
let totalExpectedPhotos = 0;
let maximumCaptionLength = 0;
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Use the existing Playwright runtime; set PLAYWRIGHT_MODULE if needed.');
const chrome = process.env.CHROME_PATH || path.join(process.env.ProgramFiles || process.env.PROGRAMFILES || path.join(path.parse(os.homedir()).root, 'Program Files'), 'Google', 'Chrome', 'Application', 'chrome.exe');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' };
const report = {
  startedAt: new Date().toISOString(), site, checks: [], screenshots: [], missingLocalResources: [], pageErrors: [], consoleErrors: [], blockedExternalOrigins: [],
  notes: ['Fresh headless Chrome with nonpersistent contexts; no user browser profile is opened.', 'Every HTTP response is intercepted from the specified local generated directory. External requests, including Waline, are aborted.', 'Mobile taps and swipes share one Chrome DevTools session until the check finishes, without synthetic DOM pointer events: taps last 60 ms; swipes use 14 moves at 12 ms intervals and a 350 ms pause before a separate tap. Initial zero-delay moves and per-gesture session detach disturbed Chrome compatibility clicks; the final harness uses one realistic native input pipeline.', 'Screenshots and the report remain local; no source photo or private note metadata is copied by this test.']
};
const contexts = [];
const touchSessions = new Map();
const blockedExternalOrigins = new Set();
const photoAssets = new Set();
const themeBackgrounds = {};
let browser;

function resource(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  const relative = pathname.replace(/^[/\\]+/, '');
  let target = path.resolve(site, relative);
  const within = path.relative(site, target);
  if (within.startsWith('..') || path.isAbsolute(within) || within.split(/[\\/]/).some(part => part.startsWith('.'))) throw new Error('Forbidden local path');
  if (relative === 'favicon.ico' && !fs.existsSync(target)) return { status: 204, body: Buffer.alloc(0) };
  if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  return { status: 200, contentType: mime[path.extname(target)] || 'application/octet-stream', body: fs.readFileSync(target) };
}
async function check(name, action, required = false) {
  if (testPattern && !required && !testPattern.test(name)) return;
  const started = Date.now();
  try {
    const detail = await action();
    report.checks.push({ name, passed: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
    console.log('PASS ' + name);
  } catch (error) {
    report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack || String(error) });
    console.error('FAIL ' + name + ': ' + (error.stack || error.message));
  }
}
async function context({ theme = 'light', ...options } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: theme, ...options });
  contexts.push(ctx);
  await ctx.addInitScript(theme => { try { if (localStorage.getItem('xieyuqing-blog-theme') === null) localStorage.setItem('xieyuqing-blog-theme', theme); } catch (_) {} }, theme);
  await ctx.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) {
      try { return await route.fulfill(resource(url)); }
      catch { const pathname = new URL(url).pathname; report.missingLocalResources.push(pathname); return route.fulfill({ status: 404, body: 'Missing local generated resource' }); }
    }
    if (/^(data|blob):/.test(url)) return route.continue();
    try { blockedExternalOrigins.add(new URL(url).origin); } catch { blockedExternalOrigins.add('unrecognized-request'); }
    return route.abort();
  });
  ctx.on('page', page => {
    page.on('pageerror', error => report.pageErrors.push(error.message));
    page.on('console', entry => {
      if (entry.type() === 'error') report.consoleErrors.push(entry.text());
      if (entry.text().startsWith('__PHOTO_QA_TOUCH__')) { report.touchEvents ||= []; report.touchEvents.push(JSON.parse(entry.text().slice('__PHOTO_QA_TOUCH__'.length))); }
    });
  });
  return ctx;
}
async function visit(page, route) {
  const response = await page.goto(origin + route, { waitUntil: 'networkidle' });
  assert(response && response.status() === 200, 'Generated route must return 200: ' + route);
  await page.locator('main').waitFor({ state: 'visible' });
}
async function imagesLoaded(page) {
  const images = page.locator('main img:not(.photo-large)');
  for (let i = 0; i < await images.count(); i++) {
    const image = images.nth(i);
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(async image => { await image.decode(); });
    assert(await image.evaluate(image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0), 'Photo must decode');
  }
  await page.evaluate(() => scrollTo(0, 0));
  return images.count();
}
async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(size.html <= size.width + 2 && size.body <= size.width + 2, 'Horizontal document overflow: ' + JSON.stringify(size));
  return size;
}
async function shot(page, name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.screenshot({ path: path.join(output, name), fullPage: !(await page.locator('#photo-viewer[open]').count()), animations: 'disabled' });
  report.screenshots.push(name);
}
async function discoverAlbums(page) {
  await visit(page, '/photos/');
  const albums = await page.locator('.album-card').evaluateAll(cards => cards.map(card => ({ title: card.querySelector('h2').childNodes[0].textContent.trim(), href: card.querySelector('a').getAttribute('href') })));
  assert.equal(albums.length, expectedAlbums.size, 'Exactly the public catalog albums must be shown');
  for (const album of albums) {
    assert(/^\/photos\/[^/?#]+\/$/.test(album.href), 'Album has a local directory route');
    assert.notEqual(album.href, '/photos/');
    assert(expectedAlbums.has(album.href), 'Unexpected album route');
    assert.equal(album.title, expectedAlbums.get(album.href).title, 'Album title must match the public catalog');
  }
  assert.equal(new Set(albums.map(album => album.href)).size, albums.length);
  return albums;
}
async function openPhoto(page, index = 0, tap = false) {
  const trigger = page.locator(`[data-photo-open][data-photo-index="${index}"]`);
  await trigger.scrollIntoViewIfNeeded();
  if (tap) await nativeTouchTap(page, `[data-photo-open][data-photo-index="${index}"]`); else await trigger.click();
  await page.locator('#photo-viewer[open]').waitFor();
  await page.locator('.photo-large').evaluate(async image => { await image.decode(); });
  assert(await page.locator('.photo-large').evaluate(image => image.complete && image.naturalWidth > 0));
  return trigger;
}
async function expectPosition(page, index, count) {
  await page.waitForFunction(({ index, count }) => document.querySelector('.photo-position').textContent.trim() === `${index + 1} / ${count}`, { index, count }, { timeout: Number(process.env.PHOTO_EXPECT_TIMEOUT_MS || 30000) });
  await page.locator('.photo-large').evaluate(async image => { await image.decode(); });
}
async function closedAndFocused(page, index) {
  await page.locator('#photo-viewer').waitFor({ state: 'hidden' });
  await page.waitForFunction(index => document.activeElement === document.querySelector(`[data-photo-index="${index}"]`) && document.documentElement.style.overflow !== 'hidden' && document.body.style.overflow !== 'hidden', index);
  await page.waitForFunction(() => !history.state || !history.state.photoLightbox);
}
async function viewerGeometry(page) {
  const detail = await page.evaluate(() => {
    const box = selector => { const element = document.querySelector(selector), b = element.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height, hidden: element.hidden }; };
    return { viewport: { width: innerWidth, height: innerHeight }, dialog: box('#photo-viewer'), close: box('.photo-close'), previous: box('.photo-previous'), next: box('.photo-next'), image: box('.photo-large') };
  });
  for (const [name, box] of Object.entries(detail).filter(([name]) => name !== 'viewport')) {
    if ((name === 'previous' || name === 'next') && box.hidden) continue;
    assert(box.width > 0 && box.height > 0, name + ' must be visible');
    assert(box.x >= -2 && box.right <= detail.viewport.width + 2, name + ' must fit screen width');
    if (name !== 'dialog') assert(box.y >= -2 && box.bottom <= detail.viewport.height + 2, name + ' must remain on screen');
  }
  return detail;
}
async function nativeTouchTap(page, selector) {
  const element = page.locator(selector);
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox(); assert(box && box.width > 0 && box.height > 0);
  let session = touchSessions.get(page);
  if (!session) { session = await page.context().newCDPSession(page); touchSessions.set(page, session); }
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(60);
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function swipe(ctx, page, direction) {
  const box = await page.locator('.photo-large').boundingBox();
  assert(box && box.width > 180 && box.height > 100);
  const startX = box.x + box.width * (direction === 'left' ? .78 : .22);
  const endX = box.x + box.width * (direction === 'left' ? .22 : .78);
  const y = box.y + box.height * .35;
  let session = touchSessions.get(page);
  if (!session) { session = await ctx.newCDPSession(page); touchSessions.set(page, session); }
  const geometry = await page.evaluate(({ startX, endX, y }) => ({ start: { x: startX, y, hit: document.elementFromPoint(startX, y)?.className }, end: { x: endX, y, hit: document.elementFromPoint(endX, y)?.className }, viewportScale: visualViewport?.scale, deviceScaleFactor: devicePixelRatio }), { startX, endX, y });
  const gesture = { direction, box, nominalDurationMs: 168, ...geometry };
  report.touchGestures ||= []; report.touchGestures.push(gesture);
  const gestureStarted = Date.now();
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y, id: 0 }] });
    for (let step = 1; step <= 14; step++) {
      await page.waitForTimeout(12);
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 14, y, id: 0 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { gesture.elapsedMs = Date.now() - gestureStarted; }
  return { direction, travel: Math.round(Math.abs(endX - startX)) };
}
async function verifyAlbum(page, album) {
  await visit(page, album.href);
  const count = expectedAlbums.get(album.href).count;
  assert.equal(await page.locator('.photo-grid figure.photo-item').count(), count);
  assert.equal(await page.locator('[data-photo-open]').count(), count);
  assert.equal(await imagesLoaded(page), count);
  const data = JSON.parse(await page.locator('#photo-data').textContent());
  assert.equal(data.length, count);
  assert.deepEqual(data, expectedAlbums.get(album.href).photos, 'Every viewer field must preserve the public catalog values');
  for (const photo of data) { assert(/^\/.*\.webp$/.test(photo.src), 'Viewer opens a generated local WebP'); photoAssets.add(photo.src); }
  await verifyGridStories(page, album);
  await noOverflow(page);
  return count;
}
async function storyLayout(locator) {
  return locator.evaluate(element => {
    const css = getComputedStyle(element);
    return { whiteSpace: css.whiteSpace, lineClamp: css.webkitLineClamp, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  });
}
function assertStoryLayout(detail) {
  assert(['pre-line', 'pre-wrap', 'break-spaces'].includes(detail.whiteSpace), 'Explicit story line breaks must render');
  assert(!detail.lineClamp || detail.lineClamp === 'none' || detail.lineClamp === '0', 'Story must not have a line clamp');
  assert(detail.scrollWidth <= detail.clientWidth + 2, 'Story must wrap within its container');
  assert(detail.scrollHeight <= detail.clientHeight + 2, 'Story text must not be clipped inside its paragraph');
}
async function verifyGridStories(page, album) {
  const photos = expectedAlbums.get(album.href).photos;
  for (let i = 0; i < photos.length; i++) {
    const story = page.locator('.photo-item').nth(i).locator('.photo-caption');
    if (photos[i].caption) {
      assert.equal(await story.textContent(), photos[i].caption, 'Grid story must preserve every character and line break');
      assert((await story.textContent()).trim().length > 0);
      assertStoryLayout(await storyLayout(story));
    } else assert.equal(await story.count(), 0, 'No story is invented for a photo without a caption');
  }
}
async function verifyViewerStories(ctx, page, album, mobile) {
  await visit(page, album.href);
  const photos = expectedAlbums.get(album.href).photos;
  await openPhoto(page, 0, mobile);
  let stories = 0, explicitLineBreaks = 0;
  for (let i = 0; i < photos.length; i++) {
    await expectPosition(page, i, photos.length);
    const story = page.locator('#photo-viewer-caption');
    assert.equal(await story.textContent(), photos[i].caption, 'Viewer story must exactly preserve the public catalog caption');
    if (photos[i].caption) {
      stories++;
      assert((await story.textContent()).trim().length > 0);
      explicitLineBreaks += (photos[i].caption.match(/\n/g) || []).length;
      assertStoryLayout(await storyLayout(story));
    }
    if (photos[i].caption.length === maximumCaptionLength && maximumCaptionLength > 0) {
      await page.locator('#photo-viewer').evaluate(dialog => { dialog.scrollTop = 0; });
      await shot(page, `${mobile ? 'mobile' : 'desktop'}-longest-story-viewer-top.png`);
      const reach = await page.locator('#photo-viewer').evaluate(dialog => {
        dialog.scrollTop = dialog.scrollHeight;
        const story = dialog.querySelector('#photo-viewer-caption'), text = story.lastChild, range = document.createRange();
        range.setStart(text, Math.max(0, text.length - 1)); range.setEnd(text, text.length);
        const end = range.getBoundingClientRect(), box = dialog.getBoundingClientRect();
        return { dialogTop: box.top, dialogBottom: box.bottom, endTop: end.top, endBottom: end.bottom, endLeft: end.left, endRight: end.right, width: innerWidth, height: innerHeight, scrollTop: dialog.scrollTop, scrollHeight: dialog.scrollHeight, clientHeight: dialog.clientHeight };
      });
      assert(reach.endTop >= Math.max(0, reach.dialogTop) - 2 && reach.endBottom <= Math.min(reach.height, reach.dialogBottom) + 2, 'The final story character must be reachable by scrolling the viewer');
      assert(reach.endLeft >= -2 && reach.endRight <= reach.width + 2, 'The end of the long story must fit the screen');
      await shot(page, `${mobile ? 'mobile' : 'desktop'}-longest-story-viewer-bottom.png`);
      report.longStoryReach ||= []; report.longStoryReach.push({ viewport: mobile ? 'mobile' : 'desktop', ...reach });
    }
    if (i < photos.length - 1) {
      await page.locator('#photo-viewer').evaluate(dialog => { dialog.scrollTop = 0; });
      if (mobile) await nativeTouchTap(page, '.photo-next'); else await page.keyboard.press('ArrowRight');
    }
  }
  await page.locator('.photo-close').click(); await closedAndFocused(page, 0);
  return { photos: photos.length, nonemptyStories: stories, exactCaptionMatches: photos.length, preservedExplicitLineBreaks: explicitLineBreaks };
}
async function interactions(ctx, page, album, mobile) {
  await visit(page, '/photos/');
  await page.locator(`.album-card > a[href="${album.href}"]`).click();
  await page.waitForURL(origin + album.href);
  if (mobile && touchTrace) await page.evaluate(() => {
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'touchcancel', 'click']) document.addEventListener(type, event => {
      const touch = event.changedTouches?.[0];
      console.debug('__PHOTO_QA_TOUCH__' + JSON.stringify({ step: window.__photoQaStep || 'open', type, target: event.target.tagName + '.' + event.target.className, x: event.clientX ?? touch?.clientX, y: event.clientY ?? touch?.clientY, pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary, position: document.querySelector('.photo-position')?.textContent }));
    }, { capture: true, passive: true });
  });
  const count = expectedAlbums.get(album.href).count, triggerIndex = count > 1 ? 1 : 0;
  const initialOverflow = await page.evaluate(() => ({ root: document.documentElement.style.overflow, body: document.body.style.overflow }));
  await openPhoto(page, triggerIndex, mobile);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('photo-close')), true);
  await expectPosition(page, triggerIndex, count);
  const geometry = await viewerGeometry(page);
  if (mobile && count > 1) {
    await page.evaluate(() => { window.__photoQaStep = 'swipe-left'; });
    await swipe(ctx, page, 'left'); await expectPosition(page, (triggerIndex + 1) % count, count);
    await page.evaluate(() => { window.__photoQaStep = 'swipe-right'; });
    await swipe(ctx, page, 'right'); await expectPosition(page, triggerIndex, count);
    // Let Chrome finish the touch gesture sequence before starting a separate tap.
    await page.waitForTimeout(350);
    await page.evaluate(() => { window.__photoQaStep = 'tap-next'; });
    const tapMetric = await page.locator('.photo-next').evaluate(button => { const b = button.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2; return { x, y, box: { x: b.x, y: b.y, width: b.width, height: b.height }, hit: document.elementFromPoint(x, y)?.className, before: document.querySelector('.photo-position').textContent }; });
    await nativeTouchTap(page, '.photo-next');
    tapMetric.after = await page.locator('.photo-position').textContent(); tapMetric.viewportScaleAfter = await page.evaluate(() => visualViewport.scale); report.touchButtonTaps ||= []; report.touchButtonTaps.push(tapMetric);
    await expectPosition(page, (triggerIndex + 1) % count, count);
    await page.evaluate(() => { window.__photoQaStep = 'tap-previous'; });
    await nativeTouchTap(page, '.photo-previous'); await expectPosition(page, triggerIndex, count);
  } else if (!mobile && count > 1) {
    await page.keyboard.press('ArrowRight'); await expectPosition(page, (triggerIndex + 1) % count, count);
    await page.keyboard.press('ArrowLeft'); await expectPosition(page, triggerIndex, count);
    await page.locator('.photo-next').click(); await expectPosition(page, (triggerIndex + 1) % count, count);
    await page.locator('.photo-previous').click(); await expectPosition(page, triggerIndex, count);
  } else {
    assert.equal(await page.locator('.photo-previous').isVisible(), false);
    assert.equal(await page.locator('.photo-next').isVisible(), false);
  }
  if (!mobile) {
    await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('#photo-viewer').contains(document.activeElement)), 'Focus stays in the native modal');
  }
  await shot(page, `${mobile ? 'mobile' : 'desktop'}-${encodeURIComponent(album.title)}-viewer.png`);
  if (mobile) await nativeTouchTap(page, '.photo-close'); else await page.locator('.photo-close').click();
  await closedAndFocused(page, triggerIndex);
  assert.deepEqual(await page.evaluate(() => ({ root: document.documentElement.style.overflow, body: document.body.style.overflow })), initialOverflow);
  await openPhoto(page, 0, mobile);
  await page.keyboard.press('ArrowLeft'); await expectPosition(page, count - 1, count);
  await page.keyboard.press('ArrowRight'); await expectPosition(page, 0, count);
  await page.keyboard.press('Escape'); await closedAndFocused(page, 0);
  await openPhoto(page, 0, mobile);
  await page.goBack(); await closedAndFocused(page, 0);
  assert.equal(page.url(), origin + album.href, 'First browser Back closes the viewer on the album');
  await page.goBack(); await page.waitForURL(origin + '/photos/');
  assert.equal(await page.locator('.album-card').count(), expectedAlbums.size, 'Second browser Back returns to the album list');
  return { count, geometry, touchInput: mobile && count > 1 ? 'CDP touchStart/touchMove/touchEnd' : undefined, ...(count < 2 ? { navigationSkipped: 'One-photo album: next/previous and touch swipe checks do not apply.' } : {}) };
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  if (testPattern) report.filteredPattern = testPattern.source;
  assert(fs.existsSync(path.join(site, 'photos', 'index.html')), 'Build the photography routes first');
  const catalog = JSON.parse(fs.readFileSync(path.resolve(site, '..', 'photos', 'catalog.json'), 'utf8'));
  assert(Array.isArray(catalog.albums) && catalog.albums.length > 0, 'The public catalog needs at least one album for this acceptance test');
  for (const album of catalog.albums) {
    assert(Array.isArray(album.photos) && album.photos.length > 0, 'The public catalog needs at least one photo per tested album');
    expectedAlbums.set(`/photos/${album.id}/`, { title: album.title, count: album.photos.length, photos: album.photos });
    totalExpectedPhotos += album.photos.length;
    for (const photo of album.photos) { expectedPhotoAssets.add(photo.src); maximumCaptionLength = Math.max(maximumCaptionLength, photo.caption.length); }
  }
  report.fileHashes = {};
  for (const relative of ['photos/index.html', 'assets/photos.js', 'assets/photos.css', 'assets/portal.css', 'assets/portal.js']) report.fileHashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(site, relative))).digest('hex');
  browser = await playwright.chromium.launch({ headless: true, executablePath: chrome });
  report.browserVersion = browser.version();
  const desktopContext = await context(), desktop = await desktopContext.newPage();
  let albums;
  await check('explicitly selected public catalog albums are discoverable at /photos/', async () => {
    albums = await discoverAlbums(desktop);
    report.albums = albums.map(album => ({ ...album, count: expectedAlbums.get(album.href).count }));
    for (const album of albums) { const relative = path.posix.join(album.href, 'index.html').replace(/^\//, ''); report.fileHashes[relative] = crypto.createHash('sha256').update(fs.readFileSync(path.join(site, relative))).digest('hex'); }
    return report.albums;
  }, true);
  assert(albums, 'Album discovery is required to continue');
  for (const viewport of ['desktop', 'mobile']) {
    for (const theme of ['light', 'dark']) {
      const ctx = viewport === 'desktop' && theme === 'light' ? desktopContext : await context({ theme, ...(viewport === 'mobile' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}) });
      const page = ctx === desktopContext ? desktop : await ctx.newPage();
      await check(`${viewport} ${theme} album index and all albums load without missing photos or overflow`, async () => {
        await visit(page, '/photos/');
        assert.equal(await imagesLoaded(page), expectedAlbums.size);
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        const indexSize = await noOverflow(page);
        await shot(page, `${viewport}-${theme}-photos-index.png`);
        const background = await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor);
        themeBackgrounds[`${viewport}-${theme}`] = background;
        if (theme === 'dark') assert.notEqual(background, themeBackgrounds[`${viewport}-light`], 'Dark mode must change the rendered page background');
        for (let i = 0; i < albums.length; i++) {
          await verifyAlbum(page, albums[i]);
          assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
          await shot(page, `${viewport}-${theme}-album-${i + 1}.png`);
        }
        return { routes: albums.length + 1, photoEntries: totalExpectedPhotos, uniqueAlbumPhotos: expectedPhotoAssets.size, indexSize, background };
      });
      if (theme === 'light') {
        await check(`${viewport} shared theme button updates and persists across photography navigation`, async () => {
          await visit(page, '/photos/'); await page.locator('#theme-toggle').click();
          assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
          assert.equal(await page.evaluate(() => localStorage.getItem('xieyuqing-blog-theme')), 'dark');
          await page.locator(`.album-card > a[href="${albums[0].href}"]`).click(); await page.waitForURL(origin + albums[0].href);
          assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
          await page.locator('#theme-toggle').click();
          assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
        });
        for (const album of albums) await check(`${viewport} ${album.title}: buttons, keyboard, focus, history${viewport === 'mobile' ? ', real touch swipes' : ''}`, () => interactions(ctx, page, album, viewport === 'mobile'));
        for (const album of albums) await check(`${viewport} ${album.title}: every complete photo story matches the catalog and wraps without clipping`, () => verifyViewerStories(ctx, page, album, viewport === 'mobile'));
      }
    }
  }
  await check('without JavaScript, all albums show all photos and links open compressed images', async () => {
    const ctx = await context({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await visit(page, '/photos/'); assert.equal(await page.locator('.album-card').count(), expectedAlbums.size); await imagesLoaded(page); await noOverflow(page);
    for (let i = 0; i < albums.length; i++) {
      const album = albums[i]; await visit(page, album.href);
      assert.equal(await page.locator('.photo-item').count(), expectedAlbums.get(album.href).count); await imagesLoaded(page); await noOverflow(page);
      await verifyGridStories(page, album);
      await shot(page, `mobile-no-js-album-${i + 1}.png`);
      const link = page.locator('[data-photo-open]').first(), href = await link.getAttribute('href');
      assert(/^\/.*\.webp$/.test(href));
      const [response] = await Promise.all([page.waitForNavigation(), link.click()]);
      assert.equal(page.url(), origin + href); assert(response && response.status() === 200); assert.match(response.headers()['content-type'], /^image\/webp/);
      await page.goBack(); await page.waitForURL(origin + album.href);
    }
  });
  await check('all selected viewer images are generated WebP and browser resources have no failures', async () => {
    assert.deepEqual([...photoAssets].sort(), [...expectedPhotoAssets].sort());
    assert.deepEqual([...new Set(report.missingLocalResources)], []);
    assert.deepEqual([...new Set(report.pageErrors)], []);
    assert.deepEqual([...new Set(report.consoleErrors)], []);
    return { photoEntries: totalExpectedPhotos, uniquePhotoCount: photoAssets.size, missingLocalResources: 0, pageErrors: 0, consoleErrors: 0 };
  });
}
(async () => {
  try { await run(); }
  catch (error) { report.fatalError = error.stack || String(error); console.error(error.stack || String(error)); }
  finally {
    for (const session of touchSessions.values()) await session.detach().catch(() => {});
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    report.blockedExternalOrigins = [...blockedExternalOrigins].sort();
    report.finishedAt = new Date().toISOString(); report.passed = !report.fatalError && report.checks.every(check => check.passed);
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(check => !check.passed).length, screenshots: report.screenshots.length, report: path.join(output, 'report.json') }));
    if (!report.passed) process.exitCode = 1;
  }
})();
