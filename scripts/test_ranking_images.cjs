'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { File } = require('node:buffer');
const Images = require('../home/assets/ranking-images.js');

test('square crop centers landscape, portrait and one-pixel originals', () => {
  assert.deepEqual(Images.centeredCrop(1000, 600), { x: 200, y: 0, size: 600 });
  assert.deepEqual(Images.centeredCrop(600, 1000), { x: 0, y: 200, size: 600 });
  assert.deepEqual(Images.centeredCrop(1, 1), { x: 0, y: 0, size: 1 });
});

test('zoom preserves the selected center until the source boundary requires a clamp', () => {
  assert.deepEqual(Images.zoomCrop(1000, 600, { x: 200, y: 0, size: 600 }, 2), { x: 350, y: 150, size: 300 });
  assert.deepEqual(Images.zoomCrop(1000, 600, { x: 700, y: 300, size: 300 }, 1), { x: 400, y: 0, size: 600 });
  assert.deepEqual(Images.zoomCrop(1000, 600, null, 4), { x: 425, y: 225, size: 150 });
});

test('pan and zoom never reveal pixels beyond any side of the source', () => {
  for (const [width, height] of [[1024, 600], [150, 1024], [3, 2], [1, 1024], [1024, 1]]) {
    let crop = Images.centeredCrop(width, height);
    for (let index = 0; index < 120; index++) {
      crop = Images.zoomCrop(width, height, crop, 1 + index % 4);
      crop = Images.translatedCrop(width, height, crop, (index % 2 ? -1 : 1) * 500.75, (index % 3 ? -1 : 1) * 700.25);
      assert.ok(crop.size >= 1 && crop.size <= Math.min(width, height));
      assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.size <= width && crop.y + crop.size <= height);
      assert.ok(Object.values(crop).every(Number.isFinite));
    }
  }
});

test('panning retains source precision instead of rounding saved crop coordinates', () => {
  const crop = Images.translatedCrop(1000, 600, { x: 200, y: 100, size: 300 }, 0.125, 0.875);
  assert.deepEqual(crop, { x: 200.125, y: 100.875, size: 300 });
});

test('image preparation rejects unsupported and oversized uploads before reading or decoding', async () => {
  let reads = 0;
  const arrayBuffer = async () => { reads++; throw new Error('must not read'); };
  await assert.rejects(Images.prepareFile({ type: 'image/svg+xml', size: 50, arrayBuffer }), /SVG/);
  await assert.rejects(Images.prepareFile({ type: 'image/png', size: 10 * 1024 * 1024 + 1, arrayBuffer }), /10 MB/);
  await assert.rejects(Images.prepareFile({ type: 'image/png', size: 0, arrayBuffer }), /大于 0/);
  assert.equal(reads, 0);
});

test('raw image dimension preflight rejects a decompression bomb before browser decoding', async () => {
  const png = new Uint8Array(33);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(png.buffer).setUint32(8, 13);
  png.set([73, 72, 68, 82], 12);
  new DataView(png.buffer).setUint32(16, 12001);
  new DataView(png.buffer).setUint32(20, 1);
  await assert.rejects(Images.prepareFile({ type: 'image/png', size: png.length, arrayBuffer: async () => png.buffer }), /12000/);
  new DataView(png.buffer).setUint32(16, 6000);
  new DataView(png.buffer).setUint32(20, 6000);
  await assert.rejects(Images.prepareFile({ type: 'image/png', size: png.length, arrayBuffer: async () => png.buffer }), /3200 万/);
});

test('animated WebP is rejected during preflight rather than silently flattening it', async () => {
  const webp = new Uint8Array(30);
  webp.set(Buffer.from('RIFF'), 0); webp.set(Buffer.from('WEBP'), 8); webp.set(Buffer.from('VP8X'), 12);
  webp[20] = 2;
  await assert.rejects(Images.prepareFile({ type: 'image/webp', size: webp.length, arrayBuffer: async () => webp.buffer }), /动画 WebP/);
});

test('built-in image paths only allow known fixed local WebP assets', () => {
  assert.equal(Images.builtinPhotoPath('hotpot', { hotpot: { photo: '/assets/foods/hotpot.webp' } }), '/assets/foods/hotpot.webp');
  assert.equal(Images.builtinPhotoPath('walking', { walking: { photo: '/assets/sports/walking.webp' } }), '/assets/sports/walking.webp');
  assert.equal(Images.builtinPhotoPath('weight-training', { 'weight-training': { photo: '/assets/sports/weight-training.webp' } }), '/assets/sports/weight-training.webp');
  assert.equal(Images.builtinPhotoPath('unknown', { hotpot: { photo: '/assets/foods/hotpot.webp' } }), null);
  assert.equal(Images.builtinPhotoPath('hotpot', Object.create({ hotpot: { photo: '/assets/foods/hotpot.webp' } })), null);
  for (const photo of ['https://example.com/photo.webp', '//example.com/photo.webp', '/assets/foods/../secret.webp', '/assets/sports/walking.webp', '/assets/sports/hotpot.svg', 'data:image/webp;base64,AA=='])
    assert.throws(() => Images.builtinPhotoPath('hotpot', { hotpot: { photo } }), /路径无效/);
  assert.throws(() => Images.builtinPhotoPath('../hotpot', { '../hotpot': { photo: '/assets/foods/../hotpot.webp' } }), /路径无效/);
});

test('aborted image preparation never reads the file', async () => {
  const controller = new AbortController(); controller.abort(); let reads = 0;
  await assert.rejects(Images.prepareFile({ type: 'image/webp', size: 1, arrayBuffer: async () => { reads++; } }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 0);
});

// These mocks exercise the asynchronous editor contract without fetching assets or opening a browser.
// Pixel decode/crop/export accuracy is checked by the separate headless browser acceptance suite.
function mockedEditor(fetchAsset) {
  const data = 'data:image/webp;base64,bm9ybWFsaXplZA==';
  const drawnText = [];
  const context = { clearRect() {}, fillRect() {}, drawImage() {}, fillText(value) { drawnText.push(value); } };
  function element() {
    const entry = new EventTarget();
    Object.assign(entry, { style: {}, dataset: {}, setAttribute() {}, getContext: () => context,
      toDataURL: () => data, hasPointerCapture: () => false, focus() {} });
    return entry;
  }
  class FakeImage {
    set src(value) {
      this.source = value;
      this.naturalWidth = value.startsWith('blob:') ? 1600 : value ? 1024 : 0;
      this.naturalHeight = value.startsWith('blob:') ? 800 : value ? 512 : 0;
      queueMicrotask(() => { if (this.source === value && this.onload) this.onload(); });
    }
    async decode() {}
  }
  const allocation = { created: 0, released: 0 };
  const foodArt = { hotpot: { photo: '/assets/foods/hotpot.webp', emoji: '食', bg: '#fff' } };
  const model = { LIMITS: { imageBytes: 1024 * 1024 }, FOOD_ART: foodArt,
    BUILTIN_ART: { ...foodArt, walking: { photo: '/assets/sports/walking.webp', emoji: '走', bg: '#eee' } },
    inspectRaster: () => ({ width: 1600, height: 800 }), validateImage: value => value };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../home/assets/ranking-images.js'), 'utf8'), {
    module, require: () => model, Image: FakeImage, document: { createElement: element },
    URL: { createObjectURL: () => 'blob:' + ++allocation.created, revokeObjectURL: () => allocation.released++ },
    fetch: fetchAsset, File, Blob, Uint8Array, AbortController, setTimeout, clearTimeout, queueMicrotask
  });
  const failures = [];
  const controls = { canvas: element(), zoomInput: element(), zoomValue: element(), status: element(),
    resetButton: element(), replaceInput: element(), removeButton: element() };
  const editor = module.exports.createEditor({ ...controls, onError: error => failures.push(error.message) });
  return { editor, data, allocation, failures, drawnText, controls };
}

test('opening a built-in photo creates only a normalized independent draft', async () => {
  const requests = [];
  const mocked = mockedEditor(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, headers: { get: () => '4' }, blob: async () => new Blob(['webp'], { type: 'image/webp' }) };
  });
  const item = { name: '默认美食', image: null, crop: null, art: 'hotpot' }, before = JSON.stringify(item);
  assert.equal(await mocked.editor.open(item), true);
  const value = JSON.parse(JSON.stringify(mocked.editor.getValue()));
  assert.deepEqual(value, { image: mocked.data, crop: { x: 256, y: 0, size: 512 }, art: null });
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/assets/foods/hotpot.webp');
  assert.equal(requests[0].options.mode, 'same-origin'); assert.equal(requests[0].options.redirect, 'error');
  assert.ok(mocked.drawnText.includes('正在读取照片'), 'Loading the default photo uses a text placeholder');
  assert.ok(!mocked.drawnText.includes('食'), 'The old emoji fallback must never be painted');
  mocked.editor.close();
  assert.equal(JSON.stringify(item), before, 'Cancelling must preserve the original art item');
  assert.equal(mocked.allocation.created, mocked.allocation.released);
});

test('an existing uploaded image has priority and performs no built-in fetch', async () => {
  let requests = 0; const mocked = mockedEditor(async () => { requests++; throw new Error('must not fetch'); });
  assert.equal(await mocked.editor.open({ name: '自定义图片', image: mocked.data, crop: null, art: 'hotpot' }), true);
  assert.equal(mocked.editor.getValue().image, mocked.data); assert.equal(requests, 0);
  mocked.editor.close();
});

test('a sport photo is resolved through the combined registry and remains a cancellable local draft', async () => {
  const requests = [];
  const mocked = mockedEditor(async url => {
    requests.push(url); return { ok: true, headers: { get: () => '4' }, blob: async () => new Blob(['webp'], { type: 'image/webp' }) };
  });
  const item = { name: '散步', image: null, crop: null, art: 'walking' }, before = JSON.stringify(item);
  assert.equal(await mocked.editor.open(item), true);
  assert.deepEqual(requests, ['/assets/sports/walking.webp']);
  assert.deepEqual(JSON.parse(JSON.stringify(mocked.editor.getValue())), { image: mocked.data, crop: { x: 256, y: 0, size: 512 }, art: null });
  assert.ok(mocked.drawnText.includes('正在读取照片')); assert.ok(!mocked.drawnText.includes('走'));
  mocked.editor.close(); assert.equal(JSON.stringify(item), before);
});

test('closing or switching while a built-in photo is loading aborts it without leaking into the next item', async () => {
  let aborts = 0;
  const mocked = mockedEditor((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborts++; const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
  }));
  const first = mocked.editor.open({ name: '美食', image: null, crop: null, art: 'hotpot' });
  const second = mocked.editor.open({ name: '文字', image: null, crop: null, art: null });
  assert.deepEqual(await Promise.all([first, second]), [false, true]);
  assert.equal(aborts, 1); assert.deepEqual(mocked.failures, []);
  assert.deepEqual(JSON.parse(JSON.stringify(mocked.editor.getValue())), { image: null, crop: null, art: null });
  mocked.editor.close(); assert.equal(mocked.editor.isReady(), false);
});

test('a missing built-in asset reports its HTTP status and retains the original draft', async () => {
  const mocked = mockedEditor(async () => ({ ok: false, status: 404 }));
  assert.equal(await mocked.editor.open({ name: '美食', image: null, crop: null, art: 'hotpot' }), false);
  assert.match(mocked.failures[0], /HTTP 404/);
  assert.ok(mocked.drawnText.includes('美食'));
  assert.ok(!mocked.drawnText.includes('食'), 'A failed photo uses the item name instead of emoji');
  assert.deepEqual(JSON.parse(JSON.stringify(mocked.editor.getValue())), { image: null, crop: null, art: 'hotpot' });
  mocked.editor.close();
});

test('cancelling a local replacement before its read finishes stops decode and preserves the next item', async () => {
  const mocked = mockedEditor(async () => { throw new Error('No built-in fetch expected'); });
  await mocked.editor.open({ name: '文字', image: null, crop: null, art: null });
  let finishRead;
  const file = { type: 'image/webp', size: 4, arrayBuffer: () => new Promise(resolve => { finishRead = resolve; }) };
  mocked.controls.replaceInput.files = [file]; mocked.controls.replaceInput.dispatchEvent(new Event('change'));
  assert.equal(mocked.editor.isReady(), false);
  await mocked.editor.open({ name: '下一项', image: null, crop: null, art: null });
  finishRead(new Uint8Array(4).buffer); await new Promise(resolve => setImmediate(resolve));
  assert.equal(mocked.allocation.created, 0, 'Cancelled replacement must not allocate a decoded image or canvas bitmap');
  assert.deepEqual(JSON.parse(JSON.stringify(mocked.editor.getValue())), { image: null, crop: null, art: null });
  assert.deepEqual(mocked.failures, []); mocked.editor.close();
});
