'use strict';
const assert = require('node:assert/strict');
const A = require('../home/assets/map-avatar.js');
const tests = [];
const test = (name, action) => tests.push([name, action]);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function png(width = 64, height = 64) {
  const b = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20); return b;
}
function jpeg() {
  const b = Buffer.from([255,216,255,224,0,4,0,0,255,192,0,8,8,0,64,0,80,3]); return b;
}
function webp(kind = 'VP8X') {
  const b = Buffer.alloc(kind === 'VP8L' ? 26 : 30); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8);
  b.write(kind, 12); b.writeUInt32LE(kind === 'VP8L' ? 5 : 10, 16);
  if (kind === 'VP8X') { b[24] = 63; b[27] = 79; }
  else if (kind === 'VP8L') { b[20] = 0x2f; b[21] = 63; b[22] = 0xc0; b[23] = 19; }
  else { b[23] = 0x9d; b[24] = 1; b[25] = 0x2a; b.writeUInt16LE(64, 26); b.writeUInt16LE(80, 28); }
  return b;
}
function file(bytes = png(), overrides = {}) {
  return { size: bytes.length, type: 'image/png', marker: 'custom', width: 64, height: 64,
    async arrayBuffer() { if (this.readDelay) await wait(this.readDelay); return bytes; }, ...overrides };
}
function fixture(options = {}) {
  const urls = new Map(), changes = [], errors = [], busy = [], downloads = [], draws = [];
  let next = 0, fetches = 0;
  const defaultFile = file(png(), { marker: 'default', ...options.defaultFile });
  class TestURL extends URL {
    static createObjectURL(blob) { const url = 'blob:test/' + (++next); urls.set(url, blob); return url; }
    static revokeObjectURL(url) { urls.delete(url); }
  }
  class TestImage {
    set src(value) {
      clearTimeout(this.timer); if (!value) return;
      const blob = urls.get(value); this.marker = blob.marker;
      this.timer = setTimeout(() => {
        if (blob.fail) { if (this.onerror) this.onerror(); return; }
        this.naturalWidth = blob.width; this.naturalHeight = blob.height;
        if (this.onload) this.onload();
      }, blob.delay || 1);
    }
  }
  const environment = {
    Image: TestImage, URL: TestURL, AbortController, setTimeout, clearTimeout,
    location: { origin: 'http://localhost:8768' },
    document: {
      baseURI: 'http://localhost:8768/map/', body: { appendChild() {} },
      createElement(type) {
        if (type === 'a') return { click() { downloads.push({ href: this.href, name: this.download }); }, remove() {} };
        let marker;
        return { width: 0, height: 0, getContext() { return {
          fillRect() {}, drawImage(image, ...rect) { marker = image.marker; draws.push({ marker, rect }); }
        }; }, toDataURL() { return 'data:image/png;base64,' + Buffer.from('sanitized:' + marker).toString('base64'); } };
      }
    },
    async fetch(url, request) {
      fetches++; assert.equal(new URL(url).origin, environment.location.origin);
      assert.equal(request.credentials, 'same-origin');
      if (options.fetchDelay) await wait(options.fetchDelay);
      if (options.fetchFail) throw new Error('默认头像暂时无法加载。');
      return { ok: true, headers: { get: () => String(defaultFile.size) }, blob: async () => defaultFile };
    }
  };
  const controller = A.createController({ environment, defaultUrl: options.defaultUrl,
    onChange: (src, state) => changes.push({ src, state }), onError: error => errors.push(error), onBusy: value => busy.push(value) });
  return { controller, environment, changes, errors, busy, downloads, draws, urls, get fetches() { return fetches; } };
}
test('header checks accept PNG, JPEG, and all three static WebP layouts', () => {
  assert.deepEqual(A.inspectImage(png(792,936), 'image/png'), { mime: 'image/png', width: 792, height: 936 });
  assert.deepEqual(A.inspectImage(jpeg(), 'image/jpeg'), { mime: 'image/jpeg', width: 80, height: 64 });
  for (const kind of ['VP8X', 'VP8L', 'VP8 ']) assert.deepEqual(A.inspectImage(webp(kind), 'image/webp'), { mime: 'image/webp', width: 64, height: 80 });
});
test('reject active/unsupported formats, MIME mismatch, animation, corrupt headers', () => {
  for (const bytes of [Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('<html>'), Buffer.from('GIF89a'), Buffer.from([255,216,255,192,255,255])]) {
    assert.throws(() => A.inspectImage(bytes), /无法识别/);
  }
  assert.throws(() => A.inspectImage(png(), 'image/jpeg'), /格式与文件类型不符/);
  const animated = webp(); animated[20] = 2; assert.throws(() => A.inspectImage(animated), /动态 WebP/);
  for (const type of ['image/svg+xml','text/html','image/gif','application/octet-stream']) assert.throws(() => A.validateFile(file(png(), { type })), /仅支持/);
});
test('file and dimension limits are enforced before image decoding', () => {
  for (const size of [0, NaN]) assert.throws(() => A.validateFile(file(png(), { size })), /有效/);
  assert.throws(() => A.validateFile(file(png(), { size: A.MAX_BYTES + 1 })), /5 MiB/);
  assert.throws(() => A.inspectImage(png(8193,1)), /尺寸过大/);
  assert.throws(() => A.inspectImage(png(6000,6000)), /尺寸过大/);
  assert.throws(() => A.inspectImage(png(0,64)), /尺寸无效/);
  assert.deepEqual(A.checkDimensions(8000,4000), { width: 8000, height: 4000 });
});
test('default is sanitized to data PNG and custom image has no extra network/storage request', async () => {
  const f = fixture(); assert.equal(await f.controller.ready, true); assert.equal(f.fetches, 1);
  assert.match(f.controller.getDataUrl(), /^data:image\/png;base64,/);
  assert.equal(f.controller.getState().custom, false);
  assert.equal(await f.controller.loadFile(file(png(), { width: 128, height: 64 })), true);
  assert.equal(f.fetches, 1); assert.deepEqual(f.controller.getState(), { custom: true, label: '自定义头像（仅本次页面）' });
  assert.deepEqual(f.draws.at(-1).rect, [0,64,256,128]); assert.equal(f.urls.size, 0);
  assert.deepEqual(Object.keys(f.controller.getState()), ['custom','label']);
  assert.equal(f.controller.download(), true); assert.match(f.downloads[0].name, /自定义头像\.png$/);
  assert.equal(await f.controller.reset(), true); assert.equal(f.fetches, 1); assert.equal(f.controller.getState().custom, false);
  f.controller.dispose();
});
test('bad file, failed decoder and decoded oversize retain the last valid avatar', async () => {
  const f = fixture(); await f.controller.ready; const old = f.controller.getDataUrl();
  for (const candidate of [file(Buffer.from('<svg/>')), file(png(), { fail: true }), file(png(), { width: 20000 }), file(png(), { type: 'image/jpeg' }), file(png(), { size: A.MAX_BYTES + 1 })]) {
    assert.equal(await f.controller.loadFile(candidate), false); assert.equal(f.controller.getDataUrl(), old);
  }
  assert.equal(f.errors.length, 5); assert.equal(f.urls.size, 0); assert.equal(f.busy.at(-1), false); f.controller.dispose();
});
test('rapid reselection cancels old decode; late file reads cannot overwrite the new choice', async () => {
  const f = fixture(); await f.controller.ready;
  const slow = f.controller.loadFile(file(png(), { marker: 'slow', delay: 35 })); await wait(2);
  const fast = f.controller.loadFile(file(png(), { marker: 'fast' }));
  assert.equal(await fast, true); assert.equal(await slow, false);
  assert.equal(Buffer.from(f.controller.getDataUrl().split(',')[1], 'base64').toString(), 'sanitized:fast');
  const delayed = f.controller.loadFile(file(png(), { marker: 'old', readDelay: 25 }));
  assert.equal(await f.controller.loadFile(file(png(), { marker: 'last' })), true); assert.equal(await delayed, false);
  assert.equal(Buffer.from(f.controller.getDataUrl().split(',')[1], 'base64').toString(), 'sanitized:last');
  assert.equal(f.errors.length, 0); assert.equal(f.urls.size, 0); f.controller.dispose();
});
test('reset wins over pending uploads; pending default cannot overwrite an upload', async () => {
  const f = fixture(); await f.controller.ready;
  const pending = f.controller.loadFile(file(png(), { delay: 30 })); await wait(2);
  assert.equal(await f.controller.reset(), true); assert.equal(await pending, false); assert.equal(f.controller.getState().custom, false);
  f.controller.dispose();
  const other = fixture({ fetchDelay: 25 });
  assert.equal(await other.controller.loadFile(file(png(), { marker: 'winner' })), true); assert.equal(await other.controller.ready, false);
  assert.equal(other.controller.getState().custom, true); assert.equal(other.errors.length, 0); other.controller.dispose();
});
test('disposal aborts pending work, clears image data and makes no later callbacks', async () => {
  const f = fixture(); await f.controller.ready;
  const pending = f.controller.loadFile(file(png(), { delay: 25 })); await wait(2); f.controller.dispose();
  const count = f.changes.length; assert.equal(await pending, false);
  assert.equal(f.controller.getDataUrl(), ''); assert.equal(await f.controller.loadFile(file()), false);
  assert.equal(await f.controller.reset(), false); assert.equal(f.controller.download(), false);
  assert.equal(f.changes.length, count); assert.equal(f.errors.length, 0); assert.equal(f.urls.size, 0);
});
test('missing default is recoverable and foreign default URLs are never fetched', async () => {
  const failed = fixture({ fetchFail: true }); assert.equal(await failed.controller.ready, false); assert.equal(failed.errors.length, 1);
  assert.equal(await failed.controller.loadFile(file()), true); failed.controller.dispose();
  for (const defaultUrl of ['https://third-party.invalid/avatar.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)']) {
    const f = fixture({ defaultUrl }); assert.equal(await f.controller.ready, false); assert.equal(f.fetches, 0); assert.equal(f.errors.length, 1); f.controller.dispose();
  }
});
(async () => {
  for (const [name, action] of tests) { await action(); console.log('PASS ' + name); }
  console.log(`${tests.length} avatar tests passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
