'use strict';
// Independent synthetic-only acceptance tests. No personal data or D: writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fileInfo, decodeVideo } = require('./map_video_probe.cjs');
const playwright = require(path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));
const site = path.resolve(process.argv[2] || path.join(__dirname, '..', '_site_unified'));
const output = path.resolve(process.argv[3] || path.join(__dirname, '..', '.local-checks', 'map-video-browser'));
const origin = 'http://127.0.0.1:48739';
const report = { startedAt: new Date().toISOString(), site, checks: [], downloads: [], requests: [], external: [], pageErrors: [], consoleErrors: [], screenshots: [], notes: ['Fresh Windows Chrome, synthetic publisher and visitor records only, all external requests blocked.', '390x844 touch checks emulate a phone; Safari/Firefox/physical device testing is outside this harness.', 'Actual generated video bytes are decoded and sought through a same-origin Blob; native download failures and Blob recovery are reported explicitly.', 'The 800ms video intro has no unlocked cities, route, avatar or caption. Cities and route progress persist after each arrival.', 'Natural Earth public-domain credit stays on the page; exported PNG/SVG omit framework fine print while preserving current user date and description.'] };
let browser;
const contexts = [];
const rec = (id, city, lat, lon, description, extra = {}) => ({ id, start: '2020-01', end: '2020-02', city, region: '', country: '中国', lat, lon, title: city, description, album: '', certainty: 'confirmed', ...extra });
const records = [rec('qa-birth', '绵阳', 31.4675, 104.6796, '第一幕：测试出生原文。', { start: '2000-10', end: '2000-10' }), rec('qa-school', '海盐', 30.5255, 120.9457, '第二幕：测试小学原文。', { start: '2001', end: '2013-06' }), rec('qa-study', '北京', 39.9042, 116.4074, '第三幕：测试大学原文。', { start: '2020-09', end: '2025-10' }), rec('qa-grad', '吉隆坡', 3.139, 101.6869, '第四幕：测试研究生原文。', { start: '2026-04-29', end: '', ongoing: true })];
const data = { version: 1, title: '合成足迹视频验收', records };
const mine = { version: 1, title: '合成站主足迹', records: [rec('qa-publisher', '上海', 31.2304, 121.4737, '仅用于验收的合成站主内容。')] };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function resource(url) {
  const relative = decodeURIComponent(new URL(url).pathname).replace(/^[/\\]+/, '');
  let file = path.resolve(site, relative), within = path.relative(site, file);
  assert(!within.startsWith('..') && !path.isAbsolute(within) && !within.split(/[\\/]/).some(part => part.startsWith('.')));
  if (relative === 'favicon.ico' && !fs.existsSync(file)) return { status: 204, body: '' };
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  let body = fs.readFileSync(file);
  if (relative === 'map/' || relative === 'map/index.html') body = Buffer.from(body.toString('utf8').replace(/(<script\b[^>]*\bid=["']footprints-data["'][^>]*>)[\s\S]*?(<\/script>)/, (_, open, close) => open + JSON.stringify(mine) + close));
  return { status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body };
}
async function check(name, action) { if (process.env.QA_FILTER && !name.includes(process.env.QA_FILTER)) return; const started = Date.now(); try { const detail = await action(); report.checks.push({ name, passed: true, ms: Date.now() - started, detail }); console.log('PASS ' + name); } catch (error) { report.checks.push({ name, passed: false, ms: Date.now() - started, error: error.stack }); console.error('FAIL ' + name + ': ' + error.message); } }
async function context(mobile = false, init) {
  const ctx = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, acceptDownloads: true }); contexts.push(ctx);
  await ctx.addInitScript(() => {
    try { localStorage.setItem('xieyuqing-blog-theme', 'light'); } catch (_) {} window.__qaTracks = []; window.__qaForbiddenCapture = 0; window.__qaCreatedUrls = []; window.__qaRevokedUrls = []; window.__qaTexts = [];
    const capture = HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream = function (...args) { const stream = capture.apply(this, args); __qaTracks.push(...stream.getTracks()); return stream; };
    if (navigator.mediaDevices) for (const name of ['getUserMedia', 'getDisplayMedia']) navigator.mediaDevices[name] = () => { __qaForbiddenCapture++; throw new Error('No capture permission allowed'); };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL); URL.createObjectURL = blob => { const url = create(blob); __qaCreatedUrls.push({ url, type: blob.type, size: blob.size }); return url; }; URL.revokeObjectURL = url => { __qaRevokedUrls.push(url); return revoke(url); };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) { if (this.canvas.id === 'video-canvas') { __qaTexts.push({ text: String(text), x, y, maxWidth, width: this.canvas.width, height: this.canvas.height, font: this.font }); if (__qaTexts.length > 100000) __qaTexts.splice(0, 10000); } return fillText.apply(this, arguments); };
  });
  if (init) await ctx.addInitScript(init);
  await ctx.route('**/*', async route => { const url = route.request().url(); if (/^(blob|data):/.test(url)) return route.continue(); report.requests.push({ method: route.request().method(), url }); if (!url.startsWith(origin + '/')) { report.external.push(url); return route.abort(); } try { return await route.fulfill(resource(url)); } catch (error) { return route.fulfill({ status: 404, body: 'Missing generated fixture resource' }); } });
  ctx.on('page', page => { page.on('pageerror', error => report.pageErrors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); }); page.on('dialog', dialog => dialog.dismiss()); });
  return ctx;
}
async function click(page, selector) { return page.qaMobile ? page.locator(selector).tap() : page.locator(selector).click(); }
async function visit(page) { await page.goto(origin + '/map/', { waitUntil: 'networkidle' }); await page.waitForFunction(() => !!window.FootprintsVideoUI); await page.waitForFunction(() => FootprintsMap.assetsReady()); }
async function importData(page, source = data) { await click(page, '#mode-visitor'); const panel = page.locator('.import-panel'); if (!(await panel.evaluate(node => node.open))) await panel.locator('summary').click(); await page.locator('#import-text').fill(typeof source === 'string' ? source : JSON.stringify(source)); await click(page, '#import-apply'); }
async function state(page) { return page.evaluate(() => ({ api: FootprintsVideoUI.getState(), progress: document.querySelector('#video-progress').value, status: document.querySelector('#playback-progress').textContent, current: document.querySelector('#playback-current').textContent, download: { hidden: document.querySelector('#video-download').hidden, href: document.querySelector('#video-download').href, name: document.querySelector('#video-download').download }, tracks: __qaTracks.map(track => ({ kind: track.kind, readyState: track.readyState })), forbiddenCapture: __qaForbiddenCapture })); }
async function plan(page) { return page.evaluate(() => FootprintsVideoUI.getPlan()); }
async function noOverflow(page) { const r = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth })); assert(r.html <= r.width + 2 && r.body <= r.width + 2, JSON.stringify(r)); return r; }
async function shot(page, name) { await page.screenshot({ path: path.join(output, name), fullPage: true, animations: 'disabled' }); report.screenshots.push(name); }
async function download(page, selector, file) {
  const [item] = await Promise.all([page.waitForEvent('download'), click(page, selector)]);
  let bytes, nativeFailure = await item.failure();
  if (!nativeFailure) bytes = fs.readFileSync(await item.path());
  else {
    // The independent minimal5byte Blob download is also cancelled by this
    // headless WindowsChrome build, for Documents and Temp and CDP allow.
    // Retain the exact Blob addressed by the actual download event for media
    // analysis; do not present this recovery as successful native disk download.
    const encoded = await page.evaluate(async url => { const blob = await (await fetch(url)).blob(), raw = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < raw.length; i += 8192) binary += String.fromCharCode(...raw.subarray(i, i + 8192)); return btoa(binary); }, item.url());
    bytes = Buffer.from(encoded, 'base64');
  }
  fs.writeFileSync(path.join(output, file || item.suggestedFilename()), bytes);
  report.downloads.push({ name: item.suggestedFilename(), localFile: file || item.suggestedFilename(), bytes: bytes.length, nativeFailure, blobRecoveredForAnalysis: !!nativeFailure });
  return { bytes, filename: item.suggestedFilename(), nativeFailure };
}
async function ready(page) { await page.waitForFunction(() => { const link = document.querySelector('#video-download'); return !link.hidden && link.getAttribute('href') && link.getAttribute('href').startsWith('blob:'); }, null, { timeout: 120000 }); }
async function waitIdle(page) { await page.waitForFunction(() => !document.querySelector('#video-generate').disabled, null, { timeout: 15000 }); }
async function generate(page) { await click(page, '#video-generate'); await ready(page); return state(page); }
async function saveJson(page) { return JSON.parse((await download(page, '#export-json', 'latest-footprints.json')).bytes.toString('utf8')); }

async function run() {
  fs.mkdirSync(output, { recursive: true }); assert(fs.existsSync(path.join(site, 'assets', 'map-video-ui.js')), 'Integrated map-video-ui.js must be built before this harness');
  report.hashes = {}; for (const name of ['map/index.html', 'assets/map.js', 'assets/map-video.js', 'assets/map-video-ui.js', 'assets/map-journey.js']) report.hashes[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(site, name))).digest('hex');
  const downloadsPath = path.join(os.tmpdir(), 'footprints-video-native-downloads'); fs.mkdirSync(downloadsPath, { recursive: true });
  browser = await playwright.chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', downloadsPath }); report.browserVersion = browser.version();
  const ctx = await context(), page = await ctx.newPage(); page.setDefaultTimeout(12000);
  await check('desktop: import, exact descriptions, new video controls and preserved static map controls', async () => { await visit(page); await importData(page); assert.equal(await page.locator('#timeline-list li').count(), 4); assert.equal(await page.locator('#playback-play').count(), 0); assert.equal(await page.locator('.map-intro h1').textContent(), '地图与足迹'); assert.equal(await page.locator('.site-footer > p').textContent(), '如有问题和反馈请联系作者公众号 谢雨聊。'); assert.equal(await page.locator('#map-layer').inputValue(), 'terrain'); assert.equal(await page.locator('#journey-options').isHidden(), true); assert.equal(await page.locator('#journey-options select').count(), 0); assert.deepEqual(await page.locator('#video-pace option').evaluateAll(nodes => nodes.map(node => node.value)), ['normal', 'brisk', 'relaxed']); await page.locator('#map-view').selectOption('china'); await page.locator('#map-zoom-in').click(); await page.locator('#map-zoom-out').click(); assert(await page.locator('#map-zoom-reset').isDisabled()); await page.locator('#map-zoom-in').click(); await page.locator('#map-zoom-reset').click(); await page.locator('#map-route').setChecked(true); await noOverflow(page); const p = await plan(page); assert.equal(p.scenes.length, 4); assert.deepEqual(p.scenes.map(scene => scene.description), records.map(record => record.description)); await shot(page, 'desktop-ready.png'); return { plan: p }; });
  let generatedPlan;
  await check('desktop: generate actual four-scene video, progress, scene text, exact download extension and playback', async () => {
    await page.locator('#video-pace').selectOption('brisk'); generatedPlan = await plan(page); const started = Date.now(); await click(page, '#video-generate');
    assert.equal(generatedPlan.introMs, 800); assert.equal(generatedPlan.segments[0].phase, 'intro'); assert.equal(generatedPlan.segments[0].durationMs, 800);
    await page.waitForFunction(() => document.querySelector('#video-progress').value > 0 && document.querySelector('#playback-panel').dataset.phase === 'intro');
    const intro = await page.evaluate(() => ({ phase: document.querySelector('#playback-panel').dataset.phase, visibleMarkers: [...document.querySelectorAll('.map-marker')].filter(node => node.getAttribute('display') !== 'none').length, unlocked: Number(document.querySelector('#footprints-map').dataset.unlockedCount), route: document.querySelector('#journey-route').getAttribute('d'), avatar: document.querySelector('#playback-avatar').getAttribute('display'), caption: document.querySelector('#playback-current').textContent, drawnText: __qaTexts.map(row => row.text) }));
    assert.deepEqual(intro, { phase: 'intro', visibleMarkers: 0, unlocked: 0, route: '', avatar: 'none', caption: '', drawnText: [] }); report.introFrame = intro;
    assert(await page.locator('#video-generate').isDisabled()); assert(!(await page.locator('#video-cancel').isDisabled()));
    for (const id of ['mode-mine', 'mode-visitor', 'map-view', 'map-route', 'video-pace', 'avatar-file']) assert(await page.locator('#' + id).isDisabled(), id + ' is locked during capture');
    await shot(page, 'desktop-generating.png'); await ready(page); const finished = await state(page); assert.equal(finished.progress, 1); assert.equal(finished.forbiddenCapture, 0); assert(finished.tracks.every(track => track.readyState === 'ended' && track.kind === 'video'));
    const result = await download(page, '#video-download', 'synthetic-four-scenes.webm'); report.mainVideo = { ...fileInfo(result.bytes, result.filename), elapsedMs: Date.now() - started, planDurationMs: generatedPlan.durationMs };
    const samples = generatedPlan.segments.map(segment => (segment.startMs + segment.durationMs * 0.5) / 1000);
    report.mainVideo.decoded = await decodeVideo(ctx, origin + '/__qa-video/' + result.filename, result.bytes, output, result.filename, samples);
    assert.equal(report.mainVideo.decoded.width, 1280); assert.equal(report.mainVideo.decoded.height, 960); assert(Math.abs(report.mainVideo.decoded.measuredDuration - generatedPlan.durationMs / 1000) < 0.25);
    const texts = await page.evaluate(() => __qaTexts); for (const record of records) assert(texts.some(row => row.text.includes(record.description)), 'Canvas shows actual description: ' + record.description);
    for (const row of texts) assert(row.x >= 0 && row.y >= 0 && row.x <= row.width && row.y <= row.height, 'Canvas text anchor fits frame');
    assert(texts.every(row => !/Natural Earth|Public Domain|时间顺序示意|非导航地图/.test(row.text)), 'No framework fine print is drawn into video captions');
    const finalSegment = generatedPlan.segments.at(-1); await page.locator('#video-preview').evaluate(async (video, time) => { const sought = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true })); video.currentTime = time; await sought; video.pause(); }, (finalSegment.startMs + finalSegment.durationMs / 2) / 1000);
    assert.equal(await page.locator('#footprints-map').getAttribute('data-unlocked-count'), '4', 'All four unique arrived cities remain unlocked at the final frame');
    return { finished, recording: report.mainVideo };
  });
  await check('desktop: video seeking synchronizes current map, cumulative path endpoint and avatar; static exports match current frame', async () => {
    const travel = generatedPlan.segments.find(segment => segment.phase === 'travel'), time = (travel.startMs + travel.durationMs / 2) / 1000;
    await page.locator('#video-preview').evaluate(async (video, time) => { const sought = new Promise(resolve => video.addEventListener('seeked', resolve, { once: true })); video.currentTime = time; await sought; video.pause(); }, time);
    const frame = await page.evaluate(time => {
      const expected = FootprintsJourney.frameAt(FootprintsVideoUI.getPlan(), time * 1000), project = FootprintsMap.projection(), path = document.querySelector('#journey-route'), avatar = document.querySelector('#playback-avatar');
      return { currentTime: document.querySelector('#video-preview').currentTime, expectedIndex: expected.index, phase: document.querySelector('#playback-panel').dataset.phase, route: path.getAttribute('d'), display: path.getAttribute('display'), avatar: avatar.getAttribute('transform'), expectedPoint: project.point(expected.point.lon, expected.point.lat), pointCount: expected.cumulativePath.length, unlocked: Number(document.querySelector('#footprints-map').dataset.unlockedCount), expectedUnlocked: FootprintsJourney.unlocked(FootprintsVideoUI.getPlan().scenes, expected).size, visibleMarkers: [...document.querySelectorAll('.map-marker')].filter(node => node.getAttribute('display') !== 'none').length };
    }, time);
    assert.equal(frame.phase, 'travel'); assert.equal(frame.pointCount, 2); assert.equal((frame.route.match(/[ML]/g) || []).length, 2); assert.equal(frame.unlocked, 1); assert.equal(frame.unlocked, frame.expectedUnlocked); assert.equal(frame.visibleMarkers, 1, 'The next city is not unlocked during travel');
    const endpoint = frame.route.match(/L(-?[\d.]+),(-?[\d.]+)$/), avatar = frame.avatar.match(/translate\((-?[\d.]+),(-?[\d.]+)\)/);
    assert(endpoint && avatar); for (let i = 0; i < 2; i++) { assert(Math.abs(Number(endpoint[i + 1]) - Number(avatar[i + 1])) < 0.02); assert(Math.abs(Number(avatar[i + 1]) - frame.expectedPoint[i]) < 0.02); }
    const source = await download(page, '#export-svg', 'travel-current-frame.svg');
    const svgInfo = await page.evaluate(text => { const doc = new DOMParser().parseFromString(text, 'image/svg+xml'); return { route: doc.querySelector('#journey-route').getAttribute('d'), avatar: doc.querySelector('#playback-avatar').getAttribute('transform'), image: doc.querySelector('#playback-avatar-image').getAttribute('href') }; }, source.bytes.toString('utf8'));
    assert.equal(svgInfo.route, frame.route); assert.equal(svgInfo.avatar, frame.avatar); assert(svgInfo.image.startsWith('data:image/png;base64,'));
    await page.locator('#map-route').setChecked(false); assert.equal(await page.locator('#journey-route').getAttribute('display'), 'none'); await page.locator('#map-route').setChecked(true); assert.equal(await page.locator('#journey-route').getAttribute('display'), 'inline');
    await shot(page, 'desktop-travel-current-frame.png'); return frame;
  });
  await check('desktop: cancel active generation, preserve data, retry, revoke superseded video URL', async () => { const before = await saveJson(page), previous = await state(page); await click(page, '#video-generate'); await page.waitForTimeout(500); await click(page, '#video-cancel'); await waitIdle(page); assert.deepEqual(await saveJson(page), before); const stopped = await state(page); assert(stopped.tracks.every(track => track.readyState === 'ended')); assert(stopped.download.hidden || !stopped.download.href.startsWith('blob:')); await generate(page); const after = await state(page); assert.equal(after.progress, 1); if (previous.download.href.startsWith('blob:')) assert(await page.evaluate(url => __qaRevokedUrls.includes(url), previous.download.href)); return after; });
  await check('desktop: invalid and duplicate imports are atomic, cancelled edit and safe description text', async () => { const before = await saveJson(page); await importData(page, '{broken'); assert.deepEqual(await saveJson(page), before); await importData(page, data); assert.deepEqual(await saveJson(page), before); await click(page, '#timeline-list li:first-child .timeline-open'); await click(page, '#detail-edit'); await page.locator('#record-description').fill('Discarded edit'); await click(page, '#record-cancel'); assert.deepEqual(await saveJson(page), before); const payload = rec('qa-injection', '成都', 30.5728, 104.0668, '<img src=x onerror="window.__xss=1"> & "literal"', { start: '2027', end: '2027' }); await importData(page, { version: 1, title: data.title, records: [payload] }); await page.locator('#timeline-list li[data-record-id="qa-injection"] .timeline-open').click(); assert.equal(await page.locator('#detail-description').textContent(), payload.description); assert.equal(await page.locator('#detail-description img').count(), 0); assert.equal(await page.evaluate(() => window.__xss || 0), 0); await click(page, '#detail-close'); });
  await check('desktop: long text is losslessly paginated, actually encoded through the final page, and visibly bounded', async () => {
    await visit(page); const description = '这是完整的长描述，必须保留所有文字和换行。'.repeat(28) + '\n' + 'UnbrokenLongToken'.repeat(40) + '\nEND-LONG-DESCRIPTION';
    await importData(page, { version: 1, title: data.title, records: [rec('qa-long', '北京', 39.9042, 116.4074, description)] }); await page.locator('#video-pace').selectOption('brisk');
    const p = await plan(page), stays = p.segments.filter(segment => segment.phase === 'stay'); assert(stays.length > 1); assert.equal(stays.map(segment => segment.pageText).join(''), description); assert(p.durationMs >= stays.length * 1500); assert(p.durationMs < 30 * 60 * 1000);
    await page.evaluate(() => { __qaTexts = []; }); await generate(page);
    const all = await page.evaluate(() => __qaTexts), texts = new Set(all.map(line => line.text)); assert(texts.has('END-LONG-DESCRIPTION'));
    const missing = await page.evaluate(({ pages, drawn }) => {
      const context = document.createElement('canvas').getContext('2d'); context.font = '32px sans-serif'; const missing = [];
      for (const text of pages) { const lines = []; let line = ''; for (const char of Array.from(text)) { if (char === '\n') { lines.push(line); line = ''; continue; } if (line && context.measureText(line + char).width > 1152) { lines.push(line); line = char; } else line += char; } lines.push(line); for (const line of lines) if (!drawn.includes(line)) missing.push(line); } return missing;
    }, { pages: stays.map(segment => segment.pageText), drawn: [...texts] });
    assert.deepEqual(missing, []); for (const row of all) assert(row.y <= 948 && row.x >= 0 && row.x <= 1280);
    const result = await download(page, '#video-download', 'synthetic-long-description.webm'); const last = stays.at(-1), middle = stays[Math.floor(stays.length / 2)];
    const decoded = await decodeVideo(ctx, origin + '/__qa-video/long-' + result.filename, result.bytes, output, 'long-' + result.filename, [0.5, (middle.startMs + middle.durationMs / 2) / 1000, (last.startMs + last.durationMs / 2) / 1000]);
    assert(Math.abs(decoded.measuredDuration - p.durationMs / 1000) < 0.25);
    const svg = await download(page, '#export-svg', 'long-description-current.svg');
    const fullCaption = await page.evaluate(text => { const doc = new DOMParser().parseFromString(text, 'image/svg+xml'); return [...doc.querySelectorAll('.export-caption')].map(node => node.textContent).join(''); }, svg.bytes.toString('utf8'));
    assert.equal(fullCaption, description.replace(/\n/g, ''), 'A static image retains the entire original description across all video pages');
    await shot(page, 'desktop-long-description-ready.png'); return { pages: stays.length, durationMs: p.durationMs, pageLengths: stays.map(segment => segment.pageText.length), decoded, staticDescriptionCharacters: fullCaption.length };
  });
  await check('desktop: custom avatar stays local and persists into video render without leaking into data export', async () => { await visit(page); await importData(page, { version: 1, title: data.title, records: [records[0]] }); const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#ff00e1'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#001cff'; x.fillRect(0, 0, 32, 64); return c.toDataURL('image/png').split(',')[1]; }); const avatarPanel = page.locator('.avatar-options'); if (!(await avatarPanel.evaluate(node => node.open))) await avatarPanel.locator('summary').click(); await page.locator('#avatar-file').setInputFiles({ name: 'qa-avatar.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }); await page.waitForFunction(() => document.querySelector('#avatar-status').textContent.includes('自定义')); const localAvatar = await page.locator('#avatar-preview').getAttribute('src'); await generate(page); const exported = await saveJson(page); assert(!JSON.stringify(exported).includes('data:image')); assert.equal(await page.locator('#avatar-preview').getAttribute('src'), localAvatar); await shot(page, 'desktop-custom-avatar-video.png'); });
  await check('desktop: static SVG/PNG retain current user date, full story, path and avatar; page retains attribution', async () => {
    const svg = await download(page, '#export-svg', 'static-current.svg'), text = svg.bytes.toString('utf8');
    const info = await page.evaluate(text => { const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement; return { parseError: !!doc.querySelector('parsererror'), width: Number(root.getAttribute('width')), height: Number(root.getAttribute('height')), mapHeight: FootprintsMap.projection().height, viewBox: root.getAttribute('viewBox').split(/\s+/).map(Number), date: doc.querySelector('.export-caption-date')?.textContent, story: [...doc.querySelectorAll('.export-caption')].map(node => node.textContent).join(''), expectedDate: FootprintsModel.range(FootprintsMap.document().records[0]), expectedStory: FootprintsMap.document().records[0].description.replace(/\n/g, ''), route: doc.querySelector('#journey-route')?.getAttribute('d'), avatar: doc.querySelector('#playback-avatar-image')?.getAttribute('href'), noteCount: doc.querySelectorAll('.map-svg-note,.map-svg-label,.map-hover-label').length, executable: !!doc.querySelector('script,foreignObject'), handlers: [...doc.querySelectorAll('*')].some(node => [...node.attributes].some(attribute => /^on/i.test(attribute.name))), references: [...doc.querySelectorAll('[href],[src]')].map(node => node.getAttribute('href') || node.getAttribute('src')) }; }, text);
    assert.equal(info.parseError, false); assert.equal(info.width, 1600); assert(info.height > info.mapHeight * 1.6 && info.viewBox[2] === 1000 && info.viewBox[3] > info.mapHeight, 'Caption expands the image below its actual responsive map height'); assert.equal(info.date, info.expectedDate); assert.equal(info.story, info.expectedStory); assert(info.route && /^M/.test(info.route)); assert(info.avatar.startsWith('data:image/png;base64,')); assert.equal(info.noteCount, 0); assert.equal(info.executable, false); assert.equal(info.handlers, false); assert(info.references.every(href => href.startsWith('#') || /^data:image\/(png|jpeg);base64,/.test(href))); assert(!text.includes('Natural Earth')); assert.match(await page.locator('.map-attribution').textContent(), /Natural Earth.*Public Domain/);
    const png = await download(page, '#map-download-image', 'static-current.png'); assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]); assert.equal(png.bytes.readUInt32BE(16), 1600); assert.equal(png.bytes.readUInt32BE(20), info.height);
    const decoded = await page.evaluate(async encoded => { const image = new Image(); image.src = 'data:image/png;base64,' + encoded; await image.decode(); return { width: image.naturalWidth, height: image.naturalHeight }; }, png.bytes.toString('base64')); assert.deepEqual(decoded, { width: 1600, height: info.height }); return { width: info.width, height: info.height, date: info.date, story: info.story, avatarEmbedded: true, imageFinePrint: false, pageCredit: true };
  });
  const mobile = await context(true), phone = await mobile.newPage(); phone.qaMobile = true; phone.setDefaultTimeout(12000);
  await check('390px touch: controls, no horizontal overflow, dark theme, expanded map and Esc return', async () => { await visit(phone); await importData(phone, { version: 1, title: data.title, records: [records[0], records[1]] }); await noOverflow(phone); await click(phone, '#theme-toggle'); assert.equal(await phone.locator('html').getAttribute('data-theme'), 'dark'); await noOverflow(phone); await shot(phone, 'mobile-dark-ready.png'); await click(phone, '#map-expand'); await noOverflow(phone); await click(phone, '#map-expanded-close'); await noOverflow(phone); });
  await check('390px touch: generation and actual video playback complete with controls restored', async () => { await phone.locator('#video-pace').selectOption('brisk'); const result = await generate(phone); assert.equal(result.progress, 1); await noOverflow(phone); await shot(phone, 'mobile-video-ready.png'); const metadata = await phone.locator('#video-preview').evaluate(async video => { await video.play(); await new Promise(resolve => setTimeout(resolve, 200)); video.pause(); return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, currentTime: video.currentTime, error: video.error && video.error.message }; }); assert.equal(metadata.width, 1280); assert.equal(metadata.height, 960); assert(metadata.duration > 3 && metadata.currentTime > 0 && !metadata.error); assert(!(await phone.locator('#map-view').isDisabled())); return metadata; });
  await check('unsupported encoder: clear fallback keeps static export usable', async () => { const unsupported = await context(false, () => { Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: undefined }); }); const p = await unsupported.newPage(); await visit(p); await importData(p, { version: 1, title: data.title, records: [records[0]] }); assert(await p.locator('#video-generate').isDisabled()); const text = await p.locator('#playback-panel').textContent(); assert(/Chrome|静态|图片/.test(text)); assert(!(await p.locator('#map-download-image').isDisabled())); await shot(p, 'unsupported-encoder-fallback.png'); });
  await check('asset readiness: delayed selected terrain or land and delayed avatar disable video until actual decode', async () => {
    for (const { file, layer } of [{ file: 'map-terrain.jpg', layer: 'terrain' }, { file: 'map-land.json', layer: 'simple' }, { file: 'map-avatar-default.png', layer: 'terrain' }]) {
      const delayed = await context(); let release; const gate = new Promise(resolve => { release = resolve; });
      await delayed.route(origin + '/assets/' + file, async route => { await gate; await route.fulfill(resource(route.request().url())); });
      const p = await delayed.newPage(); await p.goto(origin + '/map/', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => !!window.FootprintsVideoUI); await importData(p, { version: 1, title: data.title, records: [records[0]] });
      if (layer === 'simple') await p.locator('#map-layer').selectOption('simple');
      assert(await p.locator('#video-generate').isDisabled()); assert.equal((await state(p)).api.busy, false); release(); await p.waitForFunction(() => !document.querySelector('#video-generate').disabled); assert(await p.evaluate(() => FootprintsMap.assetsReady()));
    }
  });
  await check('avatar change after completion invalidates and revokes stale video before a fresh generation', async () => {
    await visit(page); await importData(page, { version: 1, title: data.title, records: [records[0]] }); await generate(page); const previous = await state(page);
    const encoded = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#00ffd2'; ctx.fillRect(0, 0, 64, 64); return canvas.toDataURL('image/png').split(',')[1]; });
    await page.locator('#avatar-file').setInputFiles({ name: 'replacement-avatar.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
    await page.waitForFunction(() => document.querySelector('#avatar-status').textContent.includes('自定义')); await page.waitForFunction(() => !FootprintsVideoUI.getState().ready);
    assert(await page.locator('#video-download').isHidden()); assert(await page.locator('#video-preview').isHidden()); assert(await page.evaluate(url => __qaRevokedUrls.includes(url), previous.download.href));
    await generate(page); assert((await state(page)).api.ready); return { priorRevoked: true, freshReady: true };
  });
  await check('privacy and runtime: no camera/microphone/display capture, external requests or page errors', async () => { assert.deepEqual(report.external, []); assert.deepEqual(report.pageErrors, []); assert(report.requests.every(request => request.method === 'GET')); assert.equal((await state(page)).forbiddenCapture, 0); return { requests: report.requests.length, external: report.external.length, pageErrors: report.pageErrors.length, consoleErrors: report.consoleErrors }; });
}
run().catch(error => { report.fatal = error.stack; process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); report.finishedAt = new Date().toISOString(); report.passed = !report.fatal && report.checks.every(check => check.passed); if (!report.passed) process.exitCode = 1; fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failed: report.checks.filter(check => !check.passed).map(check => check.name), fatal: report.fatal, output }, null, 2)); });
