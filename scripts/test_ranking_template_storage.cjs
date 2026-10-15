'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../home/assets/ranking-model.js');
const Storage = require('../home/assets/ranking-storage.js');
const copy = value => JSON.parse(JSON.stringify(value));

// Commit once per transaction and stage writes in isolation so failures can prove atomicity.
function atomicIndexedDB() {
  const values = new Map(), transactions = [], writes = [];
  const driver = { values, transactions, writes, created: false, delay: 0, failNextWriteAt: 0, throwNextWriteAt: 0, abortNextTransaction: false, opens: [] };
  const quota = () => Object.assign(new Error('test storage quota'), { name: 'QuotaExceededError' });
  const database = {
    objectStoreNames: { contains: () => driver.created },
    createObjectStore(name) { assert.equal(name, 'rankings'); driver.created = true; },
    close() {},
    transaction(name, mode) {
      assert.equal(name, 'rankings');
      const operations = [], log = { mode, keys: [], committed: false, aborted: false };
      transactions.push(log);
      let finished = false, timer, putCount = 0;
      const transaction = {
        error: null,
        abort() {
          if (finished) return;
          finished = true; clearTimeout(timer); log.aborted = true;
          transaction.error = transaction.error || Object.assign(new Error('aborted'), { name: 'AbortError' });
          queueMicrotask(() => { if (transaction.onabort) transaction.onabort(); });
        },
        objectStore() {
          return Object.fromEntries(['get', 'put', 'delete'].map(method => [method, (...args) => {
            assert.ok(!finished, 'Cannot enqueue a request after transaction completion');
            const writeIndex = method === 'put' ? ++putCount : 0;
            if (writeIndex && driver.throwNextWriteAt === writeIndex) { driver.throwNextWriteAt = 0; throw quota(); }
            const request = { result: undefined, error: null }, key = method === 'put' ? args[1] : args[0];
            log.keys.push(key); operations.push({ method, args, request, writeIndex });
            if (!timer) timer = setTimeout(() => {
              if (finished) return;
              if (driver.abortNextTransaction) {
                driver.abortNextTransaction = false; transaction.error = Object.assign(new Error('spontaneous abort'), { name: 'AbortError' });
                transaction.abort(); return;
              }
              const staged = new Map(values), stagedWrites = [];
              for (const operation of operations) {
                const { method, args, request, writeIndex } = operation;
                if (writeIndex && driver.failNextWriteAt === writeIndex) {
                  driver.failNextWriteAt = 0; request.error = quota(); transaction.error = request.error;
                  finished = true; log.aborted = true;
                  if (request.onerror) request.onerror();
                  if (transaction.onerror) transaction.onerror();
                  if (transaction.onabort) transaction.onabort();
                  return;
                }
                if (method === 'get') request.result = staged.get(args[0]);
                if (method === 'put') { staged.set(args[1], args[0]); stagedWrites.push({ key: args[1], value: args[0] }); request.result = args[1]; }
                if (method === 'delete') staged.delete(args[0]);
                if (request.onsuccess) request.onsuccess();
              }
              if (mode === 'readwrite') { values.clear(); staged.forEach((value, key) => values.set(key, value)); writes.push(...stagedWrites); }
              finished = true; log.committed = true;
              if (transaction.oncomplete) transaction.oncomplete();
            }, driver.delay);
            return request;
          }]));
        }
      };
      return transaction;
    }
  };
  driver.open = (name, version) => {
    driver.opens.push({ name, version });
    const request = { result: database };
    queueMicrotask(() => { if (!driver.created && request.onupgradeneeded) request.onupgradeneeded(); request.onsuccess(); });
    return request;
  };
  return driver;
}

test('each template retains an independent snapshot while current follows the last save', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const food = Model.createDefaultState('food'), sport = Model.createDefaultState('sport');
  Model.setTitle(food, '我的美食'); Model.setTitle(sport, '我的运动');
  await store.save(food); await store.save(sport);
  assert.deepEqual(await store.loadTemplate('food'), food);
  assert.deepEqual(await store.loadTemplate('sport'), sport);
  assert.deepEqual(await store.load(), sport);
  assert.equal(driver.values.get('current'), driver.values.get('template:sport'));
  assert.equal(typeof driver.values.get('template:food'), 'string');
  assert.equal(JSON.parse(driver.values.get('current')).version, 3, 'Save remains plain model JSON without a storage envelope');
  assert.deepEqual(driver.transactions.filter(entry => entry.mode === 'readwrite').map(entry => entry.keys),
    [['current', 'template:food'], ['current', 'template:sport']]);
  assert.deepEqual(driver.opens, [{ name: 'xieyuqing-ranking-v1', version: 1 }], 'Existing database/schema identity is unchanged');
  const reopened = Storage.createStore({ indexedDB: driver });
  assert.deepEqual(await reopened.load(), sport, 'A new store restores the last selected template');
  assert.deepEqual(await reopened.loadTemplate('food'), food);
});

test('loadTemplate is ordered with pending saves and each save snapshots immediately', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver }); driver.delay = 10;
  const food = Model.createDefaultState('food'); Model.setTitle(food, '第一版');
  const first = store.save(food), firstRead = store.loadTemplate('food');
  Model.setTitle(food, '第二版'); const second = store.save(food), secondRead = store.loadTemplate('food');
  Model.setTitle(food, '尚未保存');
  await first; assert.equal((await firstRead).title, '第一版');
  await second; assert.equal((await secondRead).title, '第二版');
  assert.equal((await store.load()).title, '第二版');
  assert.deepEqual(driver.transactions.map(entry => entry.mode), ['readwrite', 'readonly', 'readwrite', 'readonly', 'readonly']);
});

test('saveTemplate snapshots only its target while preserving a corrupt current and all other templates', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const current = '{preserve damaged original', food = Model.serialize(Model.createDefaultState('food'));
  driver.values.set('current', current); driver.values.set('template:food', food);
  const sport = Model.createDefaultState('sport'); Model.setTitle(sport, '明确重建的运动模板');
  const archived = store.saveTemplate(sport); Model.setTitle(sport, '调用后的未保存修改');
  await archived;
  assert.equal(driver.values.get('current'), current, 'Template repair must never replace the current recovery record');
  assert.equal(driver.values.get('template:food'), food);
  assert.equal((await store.loadTemplate('sport')).title, '明确重建的运动模板');
  assert.deepEqual(driver.transactions[0].keys, ['template:sport']);
  await assert.rejects(store.load(), error => error.code === 'corrupt');
  assert.equal(driver.values.get('current'), current);
});

test('saveTemplate respects queue order and preserves both current and prior archive on quota failure', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver }); driver.delay = 5;
  const food = Model.createDefaultState('food'), sport = Model.createDefaultState('sport'); await store.save(food);
  const originalCurrent = driver.values.get('current');
  Model.setTitle(sport, '第一份运动归档');
  const first = store.saveTemplate(sport), firstRead = store.loadTemplate('sport');
  Model.setTitle(sport, '第二份运动归档');
  const second = store.saveTemplate(sport), secondRead = store.loadTemplate('sport');
  await first; assert.equal((await firstRead).title, '第一份运动归档');
  await second; assert.equal((await secondRead).title, '第二份运动归档');
  const previousArchive = driver.values.get('template:sport');
  Model.setTitle(sport, '空间不足的归档'); driver.failNextWriteAt = 1;
  const failed = assert.rejects(store.saveTemplate(sport), error => error.code === 'quota' && /JSON/.test(error.message));
  const afterFailure = store.loadTemplate('sport');
  await failed; assert.equal((await afterFailure).title, '第二份运动归档');
  assert.equal(driver.values.get('template:sport'), previousArchive);
  assert.equal(driver.values.get('current'), originalCurrent);
  await store.saveTemplate(sport); assert.equal((await store.loadTemplate('sport')).title, sport.title);
  assert.equal(driver.values.get('current'), originalCurrent);
  assert.ok(driver.transactions.filter(entry => entry.mode === 'readwrite').slice(1).every(entry => entry.keys.length === 1 && entry.keys[0] === 'template:sport'));
});

for (const version of [1, 2]) test('version-' + version + ' recovery is read only and never invents a sport identity', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const legacy = copy(Model.createDefaultState('food')); legacy.version = version; delete legacy.templateId;
  Model.setTitle(legacy, '旧版自定义标题');
  if (version === 1) { delete legacy.skin; Object.values(legacy.items).forEach(item => { delete item.crop; }); }
  const snapshot = JSON.stringify(legacy); driver.values.set('current', snapshot); driver.values.set('template:food', snapshot);
  const current = await store.load(), food = await store.loadTemplate('food');
  assert.equal(current.version, 3); assert.equal(current.templateId, 'food'); assert.equal(food.title, '旧版自定义标题');
  assert.equal(driver.values.get('current'), snapshot); assert.equal(driver.values.get('template:food'), snapshot);
  assert.equal(driver.writes.length, 0); assert.ok(driver.transactions.every(entry => entry.mode === 'readonly'));
  assert.equal(await store.loadTemplate('sport'), null);
});

test('quota failure on the second put rolls back current and template together, then later saves work', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const food = Model.createDefaultState('food'), sport = Model.createDefaultState('sport');
  await store.save(food); await store.save(sport); const before = new Map(driver.values);
  Model.setTitle(food, '空间不足时的修改'); driver.failNextWriteAt = 2;
  const failed = assert.rejects(store.save(food), error => error.code === 'quota' && /JSON/.test(error.message));
  const queuedRead = store.loadTemplate('food');
  await failed; assert.deepEqual(driver.values, before); assert.notEqual((await queuedRead).title, food.title);
  assert.equal((await store.load()).templateId, 'sport', 'Failed write does not change the last selected template');
  await store.save(food); assert.equal((await store.loadTemplate('food')).title, food.title);
  assert.equal((await store.load()).templateId, 'food');
});

test('a synchronous second-put error explicitly aborts the transaction before the first put commits', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const food = Model.createDefaultState('food'); await store.save(food); const before = new Map(driver.values);
  Model.setTitle(food, '第二次写入同步失败'); driver.throwNextWriteAt = 2;
  await assert.rejects(store.save(food), error => error.code === 'quota');
  assert.deepEqual(driver.values, before); assert.ok(driver.transactions.at(-1).aborted);
  assert.notEqual((await store.loadTemplate('food')).title, food.title);
});

test('a transaction abort without a request error preserves both records and the queue recovers', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  const food = Model.createDefaultState('food'); await store.save(food); const before = new Map(driver.values);
  Model.setTitle(food, '事务中止时的修改'); driver.abortNextTransaction = true;
  await assert.rejects(store.save(food), error => error.code === 'failed' && error.cause.name === 'AbortError');
  assert.deepEqual(driver.values, before); assert.notEqual((await store.loadTemplate('food')).title, food.title);
  await store.save(food); assert.equal((await store.load()).title, food.title);
});

test('corrupt and mismatched template records are protected and never overwritten by reads', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  driver.values.set('current', '{broken'); driver.values.set('template:food', '{broken');
  driver.values.set('template:sport', Model.serialize(Model.createDefaultState('food')));
  const before = new Map(driver.values);
  await assert.rejects(store.load(), error => error.code === 'corrupt' && /原记录仍保留/.test(error.message));
  await assert.rejects(store.loadTemplate('food'), error => error.code === 'corrupt' && /未自动覆盖/.test(error.message));
  await assert.rejects(store.loadTemplate('sport'), error => error.code === 'corrupt' && /标识/.test(error.message));
  assert.deepEqual(driver.values, before); assert.equal(driver.writes.length, 0);
  const transactionCount = driver.transactions.length;
  for (const id of ['unknown', '__proto__', '../sport', '', null]) await assert.rejects(store.loadTemplate(id), error => error.code === 'template');
  assert.equal(driver.transactions.length, transactionCount, 'Invalid ids perform no IndexedDB access');
});

test('clear deletes current and every registry template atomically and retains unrelated records', async () => {
  const driver = atomicIndexedDB(), store = Storage.createStore({ indexedDB: driver });
  for (const id of Object.keys(Model.TEMPLATES)) await store.save(Model.createDefaultState(id));
  driver.values.set('unrelated', 'preserve'); await store.clear();
  assert.deepEqual([...driver.values], [['unrelated', 'preserve']]);
  assert.deepEqual(driver.transactions.at(-1).keys, ['current', ...Object.keys(Model.TEMPLATES).map(id => 'template:' + id)]);
  assert.equal(await store.load(), null);
  for (const id of Object.keys(Model.TEMPLATES)) assert.equal(await store.loadTemplate(id), null);
});
