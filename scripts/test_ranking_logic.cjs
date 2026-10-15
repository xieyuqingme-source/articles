'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../home/assets/ranking-model.js');
const Storage = require('../home/assets/ranking-storage.js');
const Export = require('../home/assets/ranking-export.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const clone = state => JSON.parse(JSON.stringify(state));
function createPoolFixture() {
  const state = Model.createDefaultState();
  Object.keys(state.items).forEach(id => Model.moveItem(state, id, 'pool'));
  return state;
}
function assertConserved(state, expected) {
  const actual = state.rows.flatMap(row => row.itemIds).concat(state.pool);
  assert.equal(new Set(actual).size, actual.length, 'each item occurs once');
  assert.deepEqual(actual.slice().sort(), expected.slice().sort(), 'no item lost');
  assert.deepEqual(Object.keys(state.items).sort(), expected.slice().sort());
  Model.validateState(state);
}

test('defaults match requested title, five tier colors and exact food order with an empty pool', () => {
  const state = Model.createDefaultState();
  assert.deepEqual(state.rows.map(row => row.name), ['夯', '顶级', '人上人', 'NPC', '拉']);
  assert.equal(state.title, '美食从夯到拉');
  assert.deepEqual(state.rows.map(row => row.color), ['#f28b82', '#f6b26b', '#f9d976', '#e8e5a0', '#a8cf9a']);
  assert.deepEqual(state.rows.map(row => row.itemIds), [
    ['food-hotpot'],
    ['food-noodles', 'food-dumpling', 'food-burger', 'food-watermelon'],
    ['food-chicken'],
    ['food-sushi'],
    ['food-pizza', 'food-cake', 'food-tea']
  ]);
  assert.deepEqual(state.rows.map(row => row.itemIds.map(id => state.items[id].name)), [
    ['火锅'], ['面条', '饺子', '汉堡', '西瓜'], ['炸鸡'], ['寿司'], ['披萨', '蛋糕', '奶茶']
  ]);
  assert.deepEqual(state.pool, []);
  Object.values(state.items).forEach(item => assert.ok(Model.FOOD_ART[item.art]));
  assert.equal(Export.planLayout(state).rows.flatMap(row => row.cards).length, 10);
  assertConserved(state, Object.keys(state.items));
});

test('cross-list moves and same-list final-index reorder conserve items', () => {
  const state = createPoolFixture();
  const initial = Object.keys(state.items);
  const [first, second, third] = state.pool;
  const row = state.rows[0].id;
  Model.moveItem(state, first, row, 0);
  Model.moveItem(state, second, row, 0);
  Model.moveItem(state, third, row, 2);
  assert.deepEqual(state.rows[0].itemIds, [second, first, third]);
  Model.moveItem(state, third, row, 0);
  assert.deepEqual(state.rows[0].itemIds, [third, second, first]);
  Model.moveItem(state, third, row, 2);
  assert.deepEqual(state.rows[0].itemIds, [second, first, third]);
  Model.moveItem(state, second, 'pool', 0);
  assert.equal(state.pool[0], second);
  assertConserved(state, initial);
});

test('invalid moves fail atomically; deletion returns ranked items to pool', () => {
  const state = createPoolFixture();
  const ids = Object.keys(state.items);
  Model.moveItem(state, ids[0], state.rows[0].id);
  const before = Model.serialize(state);
  for (const args of [[ids[0], 'unknown', 0], [ids[0], 'pool', -1], [ids[0], 'pool', 500], ['missing', 'pool', 0]])
    assert.throws(() => Model.moveItem(state, ...args));
  assert.equal(Model.serialize(state), before);
  Model.deleteRow(state, state.rows[0].id);
  assert.ok(state.pool.includes(ids[0]));
  while (state.rows.length > 1) Model.deleteRow(state, state.rows[0].id);
  assert.throws(() => Model.deleteRow(state, state.rows[0].id), /至少/);
  assertConserved(state, ids);
});

test('many moves, custom row edits and row reorder preserve exact membership', () => {
  const state = Model.createDefaultState();
  const ids = Object.keys(state.items);
  const custom = Model.addRow(state, { name: '拉不出来', color: '#123456' }, 0);
  Model.updateRow(state, custom, { name: '夯中之夯', color: '#aabbcc' });
  Model.reorderRow(state, custom, state.rows.length - 1);
  assert.equal(state.rows.at(-1).id, custom);
  for (let step = 0; step < 400; step++) {
    const item = ids[(step * 7) % ids.length];
    const target = step % 3 ? state.rows[step % state.rows.length].id : 'pool';
    Model.moveItem(state, item, target);
    assertConserved(state, ids);
  }
  Model.deleteRow(state, custom);
  assertConserved(state, ids);
});

test('item edits, safe text and JSON roundtrip preserve Unicode and literal markup', () => {
  const state = Model.createDefaultState();
  const name = '<img src=x onerror=alert(1)> 🍕 茶\n第二行';
  const added = Model.addItem(state, { name, image: PNG });
  Model.setTitle(state, '我的排行 🍵\n个人演示');
  Model.updateItem(state, added, { name: name + '！' });
  assert.equal(state.items[added].art, null);
  const roundtrip = Model.deserialize(Model.serialize(state));
  assert.deepEqual(roundtrip, state);
  assert.equal(roundtrip.items[added].name, name + '！');
  Model.removeItem(state, added);
  assert.ok(!Object.prototype.hasOwnProperty.call(state.items, added));
  assertConserved(state, Object.keys(state.items));
});

test('strict backups reject unknown versions, duplicate/missing references and unsafe keys', () => {
  const state = createPoolFixture();
  const mutations = [
    value => { value.version = 2; },
    value => { value.rows[0].itemIds.push(value.pool[0]); },
    value => { value.pool.pop(); },
    value => { value.pool.push('missing'); },
    value => { value.rows[1].id = value.rows[0].id; },
    value => { value.items[value.pool[0]].id = 'different'; },
    value => { value.rows[0].color = 'url(javascript:alert(1))'; },
    value => { value.items[value.pool[0]].art = '__proto__'; },
    value => { value.extra = '<script>'; },
    value => { value.title = 'x'.repeat(101); }
  ];
  mutations.forEach(mutate => { const value = clone(state); mutate(value); assert.throws(() => Model.deserialize(JSON.stringify(value))); });
  assert.throws(() => Model.deserialize('{"version":1,"title":"a","rows":[{"id":"a","name":"b","color":"#ffffff","itemIds":[]}],"pool":[],"items":{"__proto__":{"id":"__proto__","name":"x"}}}'));
  assert.throws(() => Model.deserialize('{bad json'), /JSON/);
  assert.throws(() => Model.deserialize(' '.repeat(Model.LIMITS.jsonBytes + 1)), /30 MB/);
});

test('limits reject additions and edits before changing state', () => {
  const state = Model.createDefaultState();
  while (state.rows.length < Model.LIMITS.rows) Model.addRow(state, { name: '拉中之拉', color: '#eeeeee' });
  while (Object.keys(state.items).length < Model.LIMITS.items) Model.addItem(state, { name: '额外项目' });
  const before = Model.serialize(state);
  assert.throws(() => Model.addRow(state, { name: '超限', color: '#ffffff' }), /20/);
  assert.throws(() => Model.addItem(state, { name: '超限' }), /200/);
  assert.throws(() => Model.updateRow(state, state.rows[0].id, { name: '啊'.repeat(31) }), /30/);
  assert.throws(() => Model.updateItem(state, state.pool[0], { name: '啊'.repeat(81) }), /80/);
  assert.throws(() => Model.reorderRow(state, state.rows[0].id, -1));
  assert.equal(Model.serialize(state), before);
});

test('raster validation rejects SVG, external, mismatched signatures and huge dimensions', () => {
  assert.equal(Model.validateImage(PNG), PNG);
  const bytes = Uint8Array.from(Buffer.from(PNG.split(',')[1], 'base64'));
  assert.deepEqual(Model.inspectRaster(bytes, 'image/png'), { width: 1, height: 1, mime: 'image/png' });
  for (const image of ['https://example.com/photo.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', PNG.replace('image/png', 'image/jpeg'), 'data:image/png;base64,AAAA'])
    assert.throws(() => Model.validateImage(image));
  const huge = Buffer.from(bytes);
  huge.writeUInt32BE(100000, 16);
  assert.equal(Model.inspectRaster(new Uint8Array(huge), 'png').width, 100000, 'preflight exposes dimensions before decode');
  assert.throws(() => Model.validateImage('data:image/png;base64,' + huge.toString('base64')), /尺寸/);
  const animatedWebP = Buffer.alloc(30);
  animatedWebP.write('RIFF', 0); animatedWebP.write('WEBP', 8); animatedWebP.write('VP8X', 12); animatedWebP[20] = 2;
  assert.throws(() => Model.inspectRaster(new Uint8Array(animatedWebP), 'webp'), /动画/);
});

test('compressed images cannot bypass cumulative decoded-pixel memory budget', () => {
  const state = Model.createDefaultState();
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  bytes.writeUInt32BE(4096, 16); bytes.writeUInt32BE(4096, 20);
  const image = 'data:image/png;base64,' + bytes.toString('base64');
  for (let index = 0; index < 3; index++) Model.addItem(state, { name: '大尺寸图片 ' + index, image });
  const before = Model.serialize(state);
  assert.throws(() => Model.addItem(state, { name: '超出内存限额', image }), /像素/);
  assert.equal(Model.serialize(state), before);
  const imported = clone(state);
  imported.items.extra = { id: 'extra', name: '额外图片', image, art: null };
  imported.pool.push('extra');
  assert.throws(() => Model.validateState(imported), /像素/);
});

function fakeIndexedDB() {
  const values = new Map();
  const writes = [];
  const fake = { values, writes, failNextPut: false, failNextOpen: false, created: false };
  const database = {
    objectStoreNames: { contains: () => fake.created },
    createObjectStore() { fake.created = true; },
    close() {},
    transaction() {
      const transaction = { error: null };
      transaction.objectStore = () => Object.fromEntries(['get', 'put', 'delete'].map(method => [method, (...args) => {
        const request = { result: undefined, error: null };
        setTimeout(() => {
          if (method === 'put' && fake.failNextPut) {
            fake.failNextPut = false;
            request.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
            transaction.error = request.error;
            if (request.onerror) request.onerror();
            if (transaction.onabort) transaction.onabort();
            return;
          }
          if (method === 'get') request.result = values.get(args[0]);
          if (method === 'put') { values.set(args[1], args[0]); writes.push(args[0]); request.result = args[1]; }
          if (method === 'delete') values.delete(args[0]);
          if (request.onsuccess) request.onsuccess();
          if (transaction.oncomplete) transaction.oncomplete();
        }, 0);
        return request;
      }]));
      return transaction;
    }
  };
  fake.open = () => {
    const request = { result: database };
    queueMicrotask(() => {
      if (fake.failNextOpen) { fake.failNextOpen = false; request.error = new Error('cannot open'); request.onerror(); return; }
      if (!fake.created) request.onupgradeneeded();
      request.onsuccess();
    });
    return request;
  };
  return fake;
}

test('IndexedDB saves snapshots in order, restores a valid state and clears', async () => {
  const fake = fakeIndexedDB();
  const store = Storage.createStore({ indexedDB: fake });
  assert.equal(await store.load(), null);
  const state = Model.createDefaultState();
  const first = store.save(state);
  Model.setTitle(state, '第二次修改');
  const second = store.save(state);
  Model.setTitle(state, '尚未保存的修改');
  await Promise.all([first, second]);
  assert.equal(Model.deserialize(fake.writes[0]).title, '美食从夯到拉', 'first call snapshots immediately');
  assert.equal((await store.load()).title, '第二次修改', 'latest committed snapshot wins');
  await store.clear();
  assert.equal(await store.load(), null);
});

test('quota errors are actionable and do not break later saves', async () => {
  const fake = fakeIndexedDB();
  const store = Storage.createStore({ indexedDB: fake });
  const state = Model.createDefaultState();
  await store.save(state);
  Model.setTitle(state, '空间不足时的修改');
  fake.failNextPut = true;
  await assert.rejects(store.save(state), error => error.code === 'quota' && /JSON/.test(error.message));
  assert.equal((await store.load()).title, '美食从夯到拉', 'failed transaction leaves previous snapshot');
  await store.save(state);
  assert.equal((await store.load()).title, state.title);
});

test('unavailable/corrupt local storage gives explicit errors and preserves corrupt record', async () => {
  const absent = Storage.createStore({ indexedDB: null });
  await assert.rejects(absent.load(), error => error.code === 'unavailable');
  const fake = fakeIndexedDB();
  const store = Storage.createStore({ indexedDB: fake });
  fake.values.set('current', '{broken');
  await assert.rejects(store.load(), error => error.code === 'corrupt' && /原记录仍保留/.test(error.message));
  assert.equal(fake.values.get('current'), '{broken');
  await store.save(Model.createDefaultState());
  assert.deepEqual(await store.load(), Model.createDefaultState());
});

test('existing version-1 JSON and local saves preserve custom ranking instead of applying new defaults', async () => {
  const legacy = createPoolFixture();
  legacy.title = '我的原有排行';
  Model.updateRow(legacy, legacy.rows[0].id, { name: '原有等级', color: '#123456' });
  Model.moveItem(legacy, 'food-cake', legacy.rows[0].id);
  Model.moveItem(legacy, 'food-hotpot', legacy.rows[0].id);
  const snapshot = Model.serialize(legacy);
  assert.equal(legacy.version, 1);
  assert.deepEqual(Model.deserialize(snapshot), legacy);
  const fake = fakeIndexedDB();
  fake.values.set('current', snapshot);
  const store = Storage.createStore({ indexedDB: fake });
  assert.deepEqual(await store.load(), legacy);
  assert.equal(fake.values.get('current'), snapshot, 'loading never rewrites a previous save');
  assert.equal(fake.writes.length, 0, 'loading never automatically applies new defaults');
});

test('a synchronous IndexedDB open failure is retryable', async () => {
  const fake = fakeIndexedDB();
  const originalOpen = fake.open;
  let attempts = 0;
  fake.open = () => { if (++attempts === 1) throw new Error('temporary failure'); return originalOpen(); };
  const store = Storage.createStore({ indexedDB: fake });
  await assert.rejects(store.load(), error => error.code === 'failed');
  assert.equal(await store.load(), null);
  assert.equal(attempts, 2);
});

test('layout excludes pool by default and includes all empty tiers', () => {
  const state = createPoolFixture();
  const layout = Export.planLayout(state);
  assert.equal(layout.rows.length, 5);
  assert.equal(layout.rows.flatMap(row => row.cards).length, 0);
  assert.equal(Export.planLayout(state, { includePool: true }).rows.at(-1).cards.length, 10);
});

test('title and tier label wrapping measure the same bold weight used in rendering', () => {
  const state = Model.createDefaultState();
  state.rows[0].name = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
  const calls = [];
  const layout = Export.planLayout(state, { measureText: (value, size, weight) => {
    calls.push({ value, size, weight });
    return value.length * size * (weight === '700' ? 1 : 0.5);
  } });
  assert.ok(calls.filter(call => call.size === 26).every(call => call.weight === '700'));
  assert.ok(layout.rows[0].labelLines.length > 1);
});

test('long titles, tier labels and 200 long names wrap without clipping or loss', () => {
  const state = Model.createDefaultState();
  state.title = '测试很长的排行标题'.repeat(10);
  state.rows[0].name = '夯中之夯'.repeat(6);
  Object.keys(state.items).forEach(id => Model.removeItem(state, id));
  const name = '中文项目名称不应被截断'.repeat(7);
  for (let index = 0; index < 200; index++) Model.addItem(state, { name }, state.rows[index % 5].id);
  const measureText = (text, size) => Array.from(text).length * size;
  for (const width of [640, 1200, 2000]) {
    const layout = Export.planLayout(state, { width, measureText });
    assert.ok(layout.title.lines.length > 1);
    assert.equal(layout.title.lines.join(''), state.title);
    assert.equal(layout.rows.flatMap(row => row.cards).length, 200);
    let lastBottom = 0;
    layout.rows.forEach(row => {
      assert.ok(row.y >= lastBottom);
      assert.equal(row.labelLines.join(''), state.rows.find(entry => entry.id === row.id).name);
      row.cards.forEach(card => {
        assert.equal(card.lines.join(''), name);
        assert.ok(card.x + card.width <= row.x + row.width, 'card fits horizontally');
        assert.ok(card.nameY + card.lines.length * card.lineHeight <= row.y + row.height, 'full name fits vertically');
        card.lines.forEach(line => assert.ok(measureText(line, card.fontSize) <= card.width));
      });
      lastBottom = row.y + row.height;
    });
    assert.ok(lastBottom <= layout.height);
    if (width === 1200) {
      const output = Export.outputSize(layout, 4);
      assert.ok(output.adjusted);
      assert.ok(output.width * output.height <= Export.MAX_PIXELS);
      assert.ok(output.width <= Export.MAX_SIDE && output.height <= Export.MAX_SIDE);
      assert.ok(output.scale >= 0.5);
    }
  }
});

test('PNG sizing rejects unsupported scales or impossibly long content', async () => {
  assert.throws(() => Export.outputSize({ width: 1200, height: 800 }, 0));
  assert.throws(() => Export.outputSize({ width: 1200, height: 50000 }, 2), /过长/);
  assert.throws(() => Export.planLayout(Model.createDefaultState(), { width: 320 }));
  await assert.rejects(Export.exportRanking(Model.createDefaultState()), /Canvas/);
});
