'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../home/assets/ranking-model.js');
const Storage = require('../home/assets/ranking-storage.js');
const Export = require('../home/assets/ranking-export.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const LEGACY_FOOD_18_ORDER = ['hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi', 'pea-mince-noodles', 'handmade-dumplings', 'burger', 'watermelon',
  'chicken', 'houttuynia', 'frozen-dumplings', 'sushi', 'douzhi', 'durian', 'pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake'];
const LEGACY_FOOD_32_ORDER = ['hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi', 'dongpo-pork', 'sea-intestine-rice', 'eight-treasure-tofu', 'zhejiang-dry-noodles',
  'pea-mince-noodles', 'handmade-dumplings', 'burger', 'japanese-ramen', 'vietnamese-chicken-noodles', 'pad-krapow-rice', 'lamb-shumai',
  'chicken', 'houttuynia', 'frozen-dumplings', 'egg-noodles', 'barbecue', 'sushi', 'douzhi', 'bak-kut-teh', 'beijing-zhajiang-noodles', 'west-lake-vinegar-fish',
  'pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake', 'egg-tart', 'bread', 'lanzhou-noodles'];
const DEFAULT_ART_ORDER = ['sichuan-hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi', 'dongpo-pork', 'sea-intestine-rice', 'eight-treasure-tofu', 'zhejiang-dry-noodles',
  'pea-mince-noodles', 'handmade-dumplings', 'burger', 'japanese-ramen', 'vietnamese-chicken-noodles', 'pad-krapow-rice', 'lamb-shumai', 'donkey-burger', 'smoked-pork-flatbread',
  'chicken', 'houttuynia', 'frozen-dumplings', 'egg-noodles', 'barbecue', 'sushi', 'douzhi', 'bak-kut-teh', 'beijing-zhajiang-noodles', 'west-lake-vinegar-fish',
  'pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake', 'egg-tart', 'bread', 'lanzhou-noodles'];
const SPORT_ART_ORDER = ['walking', 'hiking', 'tree-climbing', 'gaming', 'running', 'weight-training', 'combat-training',
  'swimming', 'badminton', 'cycling', 'table-tennis', 'football', 'tennis', 'skydiving', 'rock-climbing', 'diving', 'golf'];
const LEGACY_SPORT_ORDER = ['walking', 'hiking', 'running', 'weight-training', 'swimming', 'badminton', 'cycling', 'football'];
const clone = state => JSON.parse(JSON.stringify(state));
function asVersion1(state) {
  const value = clone(state);
  value.version = 1;
  delete value.templateId;
  delete value.skin;
  Object.values(value.items).forEach(item => { delete item.crop; });
  return value;
}
function asVersion2(state) {
  const value = clone(state);
  value.version = 2;
  delete value.templateId;
  return value;
}
function createOldTenFoodFixture() {
  const state = Model.createDefaultState('food');
  Model.clearItems(state);
  state.rows = state.rows.slice(0, 5);
  state.rows[4].name = '拉';
  const groups = [['hotpot'], ['noodles', 'dumpling', 'burger', 'watermelon'], ['chicken'], ['sushi'], ['pizza', 'cake', 'tea']];
  groups.forEach((keys, index) => keys.forEach(key => {
    const id = 'food-' + key;
    state.items[id] = { id, name: key === 'hotpot' ? '火锅' : Model.FOOD_ART[key].name, image: null, art: key, crop: null };
    state.rows[index].itemIds.push(id);
  }));
  return state;
}
function createOldEighteenFoodFixture() {
  const state = Model.createDefaultState('food');
  Model.clearItems(state);
  const groups = [
    ['hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi'], ['pea-mince-noodles', 'handmade-dumplings', 'burger', 'watermelon'],
    ['chicken', 'houttuynia', 'frozen-dumplings'], ['sushi', 'douzhi', 'durian'], ['pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake']
  ];
  groups.forEach((keys, index) => keys.forEach(key => {
    const id = 'food-' + key;
    state.items[id] = { id, name: key === 'hotpot' ? '火锅' : Model.FOOD_ART[key].name, image: null, art: key, crop: null };
    state.rows[index].itemIds.push(id);
  }));
  return state;
}
function createOldThirtyTwoFoodFixture() {
  const state = Model.createDefaultState('food');
  Model.removeItem(state, 'food-donkey-burger');
  Model.removeItem(state, 'food-smoked-pork-flatbread');
  delete state.items['food-sichuan-hotpot'];
  state.items['food-hotpot'] = { id: 'food-hotpot', name: '四川火锅', image: null, art: 'hotpot', crop: null };
  state.rows[0].itemIds[0] = 'food-hotpot';
  state.items['food-zhejiang-dry-noodles'].name = '（浙江）干挑面';
  return state;
}
function createOldEightSportFixture() {
  const state = Model.createDefaultState('sport');
  Model.clearItems(state);
  const groups = [['walking', 'hiking'], ['running', 'weight-training'], ['swimming', 'badminton', 'cycling'], [], ['football']];
  groups.forEach((keys, index) => keys.forEach(key => {
    const id = 'sport-' + key;
    state.items[id] = { id, name: Model.SPORT_ART[key].name, image: null, art: key, crop: null };
    state.rows[index].itemIds.push(id);
  }));
  return state;
}
function pngHeaderFixture(width, height) {
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return 'data:image/png;base64,' + bytes.toString('base64');
}
function tiffExifFixture(orientation, bigEndian = false, corrupt = false) {
  const tiff = Buffer.alloc(26);
  tiff.write(bigEndian ? 'MM' : 'II', 0);
  const short = (value, offset) => bigEndian ? tiff.writeUInt16BE(value, offset) : tiff.writeUInt16LE(value, offset);
  const long = (value, offset) => bigEndian ? tiff.writeUInt32BE(value, offset) : tiff.writeUInt32LE(value, offset);
  short(42, 2); long(corrupt ? 0xfffffff0 : 8, 4); short(1, 8);
  short(274, 10); short(3, 12); long(1, 14); short(orientation, 18);
  return tiff;
}
function jpegExifFixture(width, height, orientation, bigEndian = false, corrupt = false) {
  const tiff = tiffExifFixture(orientation, bigEndian, corrupt);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const app = Buffer.alloc(4); app[0] = 255; app[1] = 225; app.writeUInt16BE(payload.length + 2, 2);
  const sof = Buffer.from([255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 1]);
  return 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([255, 216]), app, payload, sof]).toString('base64');
}
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

test('defaults match requested title, five tier colors and exact 34-food order with an empty pool', () => {
  const state = Model.createDefaultState();
  assert.equal(state.version, 3);
  assert.equal(state.templateId, 'food');
  assert.equal(state.skin, 'classic');
  assert.deepEqual(state.rows.map(row => row.name), ['夯', '顶级', '人上人', 'NPC', '拉完了']);
  assert.equal(state.title, '美食从夯到拉');
  assert.deepEqual(state.rows.map(row => row.color), ['#f28b82', '#f6b26b', '#f9d976', '#e8e5a0', '#a8cf9a']);
  assert.deepEqual(state.rows.map(row => row.itemIds), [
    ['food-sichuan-hotpot', 'food-mianyang-rice-noodles', 'food-jiaxing-zongzi', 'food-dongpo-pork', 'food-sea-intestine-rice', 'food-eight-treasure-tofu', 'food-zhejiang-dry-noodles'],
    ['food-pea-mince-noodles', 'food-handmade-dumplings', 'food-burger', 'food-japanese-ramen', 'food-vietnamese-chicken-noodles', 'food-pad-krapow-rice', 'food-lamb-shumai', 'food-donkey-burger', 'food-smoked-pork-flatbread'],
    ['food-chicken', 'food-houttuynia', 'food-frozen-dumplings', 'food-egg-noodles', 'food-barbecue'],
    ['food-sushi', 'food-douzhi', 'food-bak-kut-teh', 'food-beijing-zhajiang-noodles', 'food-west-lake-vinegar-fish'],
    ['food-pizza', 'food-cake', 'food-tea', 'food-loofah-noodles', 'food-mooncake', 'food-egg-tart', 'food-bread', 'food-lanzhou-noodles']
  ]);
  assert.deepEqual(state.rows.map(row => row.itemIds.map(id => state.items[id].name)), [
    ['四川火锅', '绵阳米粉', '嘉兴粽子', '东坡肉', '海肠捞饭', '八珍豆腐', '浙江干挑面'],
    ['豌杂面', '手工水饺', '汉堡', '日本拉面', '越南鸡丝米粉', '打抛饭', '羊肉烧麦', '驴肉火烧', '熏肉大饼'],
    ['炸鸡', '折耳根', '速冻水饺', '鸡蛋挂面', '烧烤'],
    ['寿司', '豆汁', '肉骨茶', '北京杂酱面', '西湖醋鱼'],
    ['披萨', '蛋糕', '奶茶', '丝瓜面', '月饼', '蛋挞', '面包', '兰州拉面']
  ]);
  assert.deepEqual(state.pool, []);
  Object.values(state.items).forEach(item => { assert.ok(Model.FOOD_ART[item.art]); assert.equal(item.crop, null); });
  assert.equal(state.rows[4].id, 'row-4');
  assert.ok(!state.rows.some(row => row.id === 'row-lawanle'));
  assert.equal(Export.planLayout(state).rows.flatMap(row => row.cards).length, 34);
  assert.equal(Object.keys(state.items).length, 34);
  assert.ok(!state.items['food-hotpot']);
  assert.ok(!state.items['food-watermelon'] && !state.items['food-durian']);
  assert.deepEqual(state.rows.flatMap(row => row.itemIds).map(id => state.items[id].art), DEFAULT_ART_ORDER);
  assertConserved(state, Object.keys(state.items));
});

test('saved food18 and food32 backups keep old hotpot keys, names, fruit and user images without new defaults', () => {
  const cases = [
    { original: createOldEighteenFoodFixture(), order: LEGACY_FOOD_18_ORDER, hotpotName: '火锅' },
    { original: createOldThirtyTwoFoodFixture(), order: LEGACY_FOOD_32_ORDER, hotpotName: '四川火锅' }
  ];
  for (const { original, order, hotpotName } of cases) {
    Model.setTitle(original, '我的旧版美食');
    Model.updateRow(original, original.rows[0].id, { name: '我的偏好', color: '#567856' });
    Model.updateItem(original, 'food-cake', { name: '我的蛋糕照片', image: PNG, art: null, crop: null });
    assert.equal(Object.keys(original.items).length, order.length);
    for (const fixture of [asVersion1(original), asVersion2(original), clone(original)]) {
      const before = JSON.stringify(fixture);
      const validated = Model.validateState(fixture);
      const restored = Model.deserialize(before);
      assert.equal(JSON.stringify(fixture), before);
      const expected = clone(original);
      if (expected.items['food-zhejiang-dry-noodles']) expected.items['food-zhejiang-dry-noodles'].name = '浙江干挑面';
      assert.deepEqual(validated, expected);
      assert.deepEqual(restored, expected);
      assert.equal(Object.keys(restored.items).length, order.length);
      assert.equal(restored.items['food-hotpot'].name, hotpotName, 'metadata updates never rename saved items');
      assert.equal(restored.items['food-hotpot'].art, 'hotpot', 'dedicated new hotpot art never replaces saved art');
      if (order.includes('watermelon')) assert.equal(restored.items['food-watermelon'].name, '西瓜');
      if (order.includes('durian')) assert.equal(restored.items['food-durian'].name, '榴莲');
      assert.equal(restored.items['food-cake'].image, PNG);
      DEFAULT_ART_ORDER.filter(key => !order.includes(key)).forEach(key => {
        assert.equal(Object.prototype.hasOwnProperty.call(restored.items, 'food-' + key), false);
      });
      assertConserved(restored, order.map(key => 'food-' + key));
    }
  }
});

test('the exact old Zhejiang built-in label migrates on read without rewriting saves or changing custom ranking data', async () => {
  const original = Model.createDefaultState();
  const itemId = 'food-zhejiang-dry-noodles';
  original.items[itemId].name = '（浙江）干挑面';
  Model.setTitle(original, '我的旧版榜单');
  Model.setSkin(original, 'tech');
  const rowId = Model.addRow(original, { name: '保留的自定义等级', color: '#345678' });
  Model.moveItem(original, itemId, rowId);
  const photoId = Model.addItem(original, { name: '我的裁切照片', image: pngHeaderFixture(12, 8), crop: { x: 2.5, y: 0.5, size: 7 } }, rowId);
  for (const fixture of [asVersion1(original), asVersion2(original), clone(original)]) {
    const before = JSON.stringify(fixture);
    const expected = clone(original);
    expected.items[itemId].name = '浙江干挑面';
    if (fixture.version === 1) {
      expected.skin = 'classic';
      Object.values(expected.items).forEach(item => { item.crop = null; });
    }
    assert.deepEqual(Model.validateState(fixture), expected);
    assert.deepEqual(Model.deserialize(before), expected);
    assert.equal(JSON.stringify(fixture), before, 'reading does not modify the source object');
    assert.deepEqual(Model.deserialize(Model.serialize(expected)), expected, 'normalized names are stable through roundtrips');
    const fake = fakeIndexedDB();
    fake.values.set('current', before);
    const store = Storage.createStore({ indexedDB: fake });
    assert.deepEqual(await store.load(), expected);
    assert.equal(fake.values.get('current'), before, 'reading does not rewrite the stored JSON');
    assert.equal(fake.writes.length, 0);
    assert.equal(expected.items[photoId].image, original.items[photoId].image);
    assert.deepEqual(expected.rows, original.rows, 'all six rows and item positions survive unchanged');
  }
});

test('Zhejiang label compatibility preserves custom names, uploaded photos, crops and unrelated matching text', () => {
  const original = Model.createDefaultState();
  const itemId = 'food-zhejiang-dry-noodles';
  Model.updateItem(original, itemId, { name: '我最喜欢的（浙江）干挑面' });
  const image = pngHeaderFixture(12, 8);
  const crop = { x: 2.5, y: 0.5, size: 7 };
  const photoId = Model.addItem(original, { name: '（浙江）干挑面', image, crop }, original.rows[0].id);
  const textId = Model.addItem(original, { name: '（浙江）干挑面', art: null });
  Model.updateItem(original, 'food-handmade-dumplings', { name: '（浙江）干挑面' });
  const before = JSON.stringify(original);
  const restored = Model.deserialize(before);
  assert.deepEqual(restored, original);
  assert.equal(restored.items[itemId].name, '我最喜欢的（浙江）干挑面');
  assert.equal(restored.items[photoId].name, '（浙江）干挑面');
  assert.equal(restored.items[photoId].image, image);
  assert.deepEqual(restored.items[photoId].crop, crop);
  assert.equal(restored.items[textId].name, '（浙江）干挑面');
  assert.equal(restored.items['food-handmade-dumplings'].name, '（浙江）干挑面');
  assert.equal(JSON.stringify(original), before);
});

test('old 10-food five-tier backups retain old names and uploaded images in both schema versions', () => {
  const original = createOldTenFoodFixture();
  const additions = ['mianyang-rice-noodles', 'jiaxing-zongzi', 'houttuynia', 'frozen-dumplings', 'douzhi', 'durian', 'loofah-noodles', 'mooncake'];
  Model.updateItem(original, 'food-noodles', { name: '面条' });
  Model.updateItem(original, 'food-dumpling', { name: '饺子' });
  Model.updateItem(original, 'food-hotpot', { name: '我的火锅照片', image: PNG, art: null, crop: null });
  Model.setTitle(original, '我的旧版排行');
  assert.equal(original.rows.length, 5);
  assert.equal(Object.keys(original.items).length, 10);
  for (const fixture of [asVersion1(original), asVersion2(original)]) {
    const before = JSON.stringify(fixture);
    const validated = Model.validateState(fixture);
    const restored = Model.deserialize(before);
    assert.equal(JSON.stringify(fixture), before, 'reading does not modify the source backup');
    assert.deepEqual(validated, original);
    assert.deepEqual(restored, original);
    assert.equal(restored.rows.length, 5, 'new sixth tier is not inserted');
    assert.equal(Object.keys(restored.items).length, 10, 'new foods are not inserted');
    assert.equal(restored.items['food-noodles'].name, '面条');
    assert.equal(restored.items['food-dumpling'].name, '饺子');
    assert.equal(restored.items['food-hotpot'].image, PNG, 'user image stays byte-for-byte intact');
    assert.equal(restored.items['food-hotpot'].art, null, 'user image is not replaced with a built-in photo');
    additions.forEach(key => assert.equal(Object.prototype.hasOwnProperty.call(restored.items, 'food-' + key), false));
    assert.ok(!restored.rows.some(row => row.id === 'row-lawanle'));
  }
});

test('built-in foods use immutable local photo paths without copying photos into saved state', () => {
  const keys = DEFAULT_ART_ORDER.concat(['hotpot', 'noodles', 'dumpling', 'watermelon', 'durian']);
  assert.equal(Object.keys(Model.FOOD_ART).length, 39);
  assert.ok(Object.isFrozen(Model.FOOD_ART));
  keys.forEach(key => {
    assert.equal(Model.FOOD_ART[key].photo, '/assets/foods/' + key + '.webp');
    assert.ok(Object.isFrozen(Model.FOOD_ART[key]));
    assert.ok(Model.FOOD_ART[key].emoji, 'legacy emoji metadata is retained');
    assert.throws(() => { Model.FOOD_ART[key].photo = 'https://example.com/remote.webp'; }, TypeError);
  });
  const state = Model.createDefaultState();
  Object.values(state.items).forEach(item => {
    assert.equal(item.image, null);
    assert.equal(item.crop, null);
    assert.ok(keys.includes(item.art));
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'photo'), false);
  });
  assert.equal(Model.serialize(state).includes('/assets/foods/'), false, 'backups save built-in keys only');
  state.items[state.rows[0].itemIds[0]].photo = 'https://example.com/remote.webp';
  assert.throws(() => Model.validateState(state), /字段/, 'backups cannot supply arbitrary image URLs');
});

test('sport template has the exact 17 activities, five tiers, stable IDs and fixed local photos', () => {
  const state = Model.createDefaultState('sport');
  assert.equal(state.version, 3);
  assert.equal(state.templateId, 'sport');
  assert.equal(state.title, '运动从夯到拉');
  assert.equal(state.skin, 'classic');
  assert.deepEqual(state.pool, []);
  assert.deepEqual(state.rows.map(row => row.name), ['夯', '顶级', '人上人', 'NPC', '拉完了']);
  assert.deepEqual(state.rows.map(row => row.color), Model.createDefaultState('food').rows.map(row => row.color));
  assert.deepEqual(state.rows.map(row => row.itemIds), [
    ['sport-walking', 'sport-hiking', 'sport-tree-climbing', 'sport-gaming'],
    ['sport-running', 'sport-weight-training', 'sport-combat-training'],
    ['sport-swimming', 'sport-badminton', 'sport-cycling'], ['sport-table-tennis'],
    ['sport-football', 'sport-tennis', 'sport-skydiving', 'sport-rock-climbing', 'sport-diving', 'sport-golf']
  ]);
  assert.deepEqual(state.rows.map(row => row.itemIds.map(id => state.items[id].name)), [
    ['散步', '登山', '爬树', '打游戏'], ['跑步', '撸铁', '搏斗'], ['游泳', '羽毛球', '自行车'], ['乒乓球'],
    ['足球', '网球', '跳伞', '攀岩', '潜水', '高尔夫']
  ]);
  assert.deepEqual(Object.keys(Model.SPORT_ART).sort(), SPORT_ART_ORDER.slice().sort());
  assert.equal(Object.keys(state.items).length, 17);
  assert.deepEqual(state.rows.flatMap(row => row.itemIds).map(id => state.items[id].art), SPORT_ART_ORDER);
  SPORT_ART_ORDER.forEach(key => {
    assert.equal(Model.SPORT_ART[key].photo, '/assets/sports/' + key + '.webp');
    assert.equal(state.items['sport-' + key].image, null);
    assert.equal(state.items['sport-' + key].crop, null);
  });
  assertConserved(state, SPORT_ART_ORDER.map(key => 'sport-' + key));
});

test('saved eight-activity sport rankings retain all edits and optional sixth row without adding new defaults', () => {
  const original = createOldEightSportFixture();
  Model.setTitle(original, '我的八项旧运动排行');
  Model.setSkin(original, 'tech');
  Model.updateRow(original, original.rows[1].id, { name: '自定义等级', color: '#445566' });
  Model.updateItem(original, 'sport-walking', { name: '我自己的散步照片', image: PNG, art: null, crop: null });
  const sixRows = clone(original);
  sixRows.rows[4].name = '拉';
  sixRows.rows[4].itemIds = [];
  sixRows.rows.push({ id: 'row-lawanle', name: '拉完了', color: '#ffffff', itemIds: ['sport-football'] });
  for (const fixture of [original, sixRows]) {
    const snapshot = JSON.stringify(fixture);
    const validated = Model.validateState(fixture);
    const restored = Model.deserialize(snapshot);
    assert.equal(JSON.stringify(fixture), snapshot);
    assert.deepEqual(validated, fixture);
    assert.deepEqual(restored, fixture);
    assert.equal(restored.templateId, 'sport');
    assert.equal(restored.rows.length, fixture.rows.length);
    assert.equal(Object.keys(restored.items).length, 8);
    assert.equal(restored.items['sport-walking'].image, PNG);
    SPORT_ART_ORDER.filter(key => !LEGACY_SPORT_ORDER.includes(key)).forEach(key => {
      assert.equal(Object.prototype.hasOwnProperty.call(restored.items, 'sport-' + key), false);
    });
    assertConserved(restored, LEGACY_SPORT_ORDER.map(key => 'sport-' + key));
  }
});

test('existing six-tier and custom-row rankings survive every supported version without losing rows or items', () => {
  for (const templateId of ['food', 'sport']) {
    const original = Model.createDefaultState(templateId);
    const oldSixthIds = templateId === 'food' ? ['food-loofah-noodles', 'food-mooncake'] : ['sport-football'];
    original.rows[4].name = '拉';
    original.rows[4].itemIds = original.rows[4].itemIds.filter(id => !oldSixthIds.includes(id));
    original.rows.push({ id: 'row-lawanle', name: '拉完了', color: '#ffffff', itemIds: oldSixthIds });
    const firstId = original.rows[0].itemIds[0];
    Model.updateItem(original, firstId, { name: '我的已存图片', image: PNG, art: null, crop: null });
    Model.updateRow(original, original.rows[1].id, { name: '用户自定义等级', color: '#123456' });
    Model.setSkin(original, 'tech');
    const itemIds = Object.keys(original.items);
    assert.equal(original.rows.length, 6);
    for (const fixture of [asVersion1(original), asVersion2(original), clone(original)]) {
      const before = JSON.stringify(fixture);
      const expected = { ...original, templateId: fixture.version < 3 ? 'food' : templateId, skin: fixture.version === 1 ? 'classic' : 'tech' };
      const validated = Model.validateState(fixture);
      const restored = Model.deserialize(before);
      assert.equal(JSON.stringify(fixture), before, 'reading never modifies the source six-tier backup');
      assert.deepEqual(validated, expected);
      assert.deepEqual(restored, expected);
      assert.deepEqual(restored.rows, original.rows, 'old white sixth row and custom row remain exactly intact');
      assert.deepEqual(restored.items, original.items, 'all old items, names and user images remain exactly intact');
      assertConserved(restored, itemIds);
    }
    assert.equal(Model.createDefaultState(templateId).rows.length, 5, 'restoring a backup never changes new default definitions');
  }
});

test('template and art registries are deeply frozen and fresh states remain independently editable', () => {
  const assertFrozen = value => {
    if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(assertFrozen); }
  };
  assertFrozen(Model.TEMPLATES);
  assertFrozen(Model.BUILTIN_ART);
  assertFrozen(Model.SPORT_ART);
  assert.equal(Object.keys(Model.BUILTIN_ART).length, 56);
  assert.equal(Model.TEMPLATES.food.label, '美食排行');
  assert.equal(Model.TEMPLATES.sport.label, '运动排行');
  Object.keys(Model.FOOD_ART).forEach(key => assert.equal(Model.BUILTIN_ART[key], Model.FOOD_ART[key]));
  Object.keys(Model.SPORT_ART).forEach(key => assert.equal(Model.BUILTIN_ART[key], Model.SPORT_ART[key]));
  assert.throws(() => Model.TEMPLATES.sport.rows[0].artKeys.push('football'), TypeError);
  assert.throws(() => { Model.TEMPLATES.food.rows[0].name = '修改'; }, TypeError);
  assert.equal(Model.FOOD_ART.noodles.name, '面条');
  assert.equal(Model.FOOD_ART.dumpling.name, '饺子');
  assert.equal(Model.FOOD_ART.noodles.photo, '/assets/foods/noodles.webp');
  assert.equal(Model.FOOD_ART.dumpling.photo, '/assets/foods/dumpling.webp');
  assert.equal(Model.FOOD_ART.hotpot.name, '火锅');
  assert.equal(Model.FOOD_ART.hotpot.photo, '/assets/foods/hotpot.webp');
  assert.equal(Model.FOOD_ART['sichuan-hotpot'].name, '四川火锅');
  assert.equal(Model.FOOD_ART['sichuan-hotpot'].photo, '/assets/foods/sichuan-hotpot.webp');
  const first = Model.createDefaultState('sport');
  const second = Model.createDefaultState('sport');
  const snapshot = Model.serialize(second);
  Model.setTitle(first, '我的运动');
  Model.updateRow(first, first.rows[0].id, { name: '新等级' });
  Model.moveItem(first, 'sport-walking', 'pool');
  Model.updateItem(first, 'sport-hiking', { name: '我的登山' });
  assert.equal(Model.serialize(second), snapshot);
  assert.equal(Model.serialize(Model.createDefaultState('sport')), snapshot);
});

test('unknown template IDs are rejected without changing existing state or registries', () => {
  const state = Model.createDefaultState();
  const before = Model.serialize(state);
  for (const templateId of ['sports', '', '__proto__', 'constructor', null, {}, 1]) {
    assert.throws(() => Model.createDefaultState(templateId), /模板/);
    assert.throws(() => Model.validateState({ ...state, templateId }), /模板/);
  }
  const missing = clone(state);
  delete missing.templateId;
  assert.throws(() => Model.validateState(missing), /模板/);
  assert.equal(Model.serialize(state), before);
  assert.deepEqual(Model.createDefaultState(), Model.createDefaultState('food'));
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
    value => { value.version = 4; },
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
      const operations = [];
      let finished = false;
      let timer;
      const transaction = { error: null, abort() {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        queueMicrotask(() => { if (transaction.onabort) transaction.onabort(); });
      } };
      transaction.objectStore = () => Object.fromEntries(['get', 'put', 'delete'].map(method => [method, (...args) => {
        const request = { result: undefined, error: null };
        operations.push({ method, args, request });
        if (!timer) timer = setTimeout(() => {
          if (finished) return;
          const staged = new Map(values);
          const stagedWrites = [];
          for (const { method, args, request } of operations) {
            if (method === 'put' && fake.failNextPut) {
              fake.failNextPut = false;
              request.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
              transaction.error = request.error;
              finished = true;
              if (request.onerror) request.onerror();
              if (transaction.onabort) transaction.onabort();
              return;
            }
            if (method === 'get') request.result = staged.get(args[0]);
            if (method === 'put') { staged.set(args[1], args[0]); stagedWrites.push(args[0]); request.result = args[1]; }
            if (method === 'delete') staged.delete(args[0]);
            if (request.onsuccess) request.onsuccess();
          }
          values.clear(); staged.forEach((value, key) => values.set(key, value));
          writes.push(...stagedWrites);
          finished = true;
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
  const legacy = createOldTenFoodFixture();
  Object.keys(legacy.items).forEach(id => Model.moveItem(legacy, id, 'pool'));
  legacy.items['food-noodles'].name = '面条';
  legacy.items['food-dumpling'].name = '饺子';
  Model.updateItem(legacy, 'food-hotpot', { image: PNG, art: null, crop: null });
  legacy.title = '我的原有排行';
  Model.updateRow(legacy, legacy.rows[0].id, { name: '原有等级', color: '#123456' });
  Model.moveItem(legacy, 'food-cake', legacy.rows[0].id);
  Model.moveItem(legacy, 'food-hotpot', legacy.rows[0].id);
  const original = asVersion1(legacy);
  const snapshot = JSON.stringify(original);
  assert.equal(original.version, 1);
  assert.deepEqual(Model.deserialize(snapshot), legacy);
  const fake = fakeIndexedDB();
  fake.values.set('current', snapshot);
  const store = Storage.createStore({ indexedDB: fake });
  assert.deepEqual(await store.load(), legacy);
  assert.equal((await store.load()).items['food-noodles'].name, '面条', 'new default names never rename saved items');
  assert.equal((await store.load()).rows.length, 5, 'new sixth tier is never injected into saved rankings');
  assert.equal(fake.values.get('current'), snapshot, 'loading never rewrites a previous save');
  assert.equal(fake.writes.length, 0, 'loading never automatically applies new defaults');
});

test('version-1 migration adds food template, classic skin and null crops without mutating saved content', () => {
  const original = createPoolFixture();
  original.title = '旧存档与图片';
  Model.updateRow(original, original.rows[1].id, { name: '旧等级', color: '#334455' });
  const imageId = Model.addItem(original, { name: '完整原图', image: PNG });
  Model.moveItem(original, imageId, original.rows[1].id);
  const legacy = asVersion1(original);
  const snapshot = JSON.stringify(legacy);
  const migrated = Model.validateState(legacy);
  assert.equal(JSON.stringify(legacy), snapshot, 'validation does not mutate the legacy object');
  assert.equal(migrated.version, 3);
  assert.equal(migrated.templateId, 'food');
  assert.equal(migrated.skin, 'classic');
  assert.equal(migrated.items[imageId].image, PNG);
  assert.deepEqual(asVersion1(migrated), legacy, 'every original title, row, item, image and ordering survives');
  Object.values(migrated.items).forEach(item => assert.equal(item.crop, null));
  assert.deepEqual(Model.deserialize(snapshot), migrated);
  assert.deepEqual(Model.deserialize(Model.serialize(migrated)), migrated);
});

test('version-2 migration adds only food identity while preserving skin, crop, images, rows and ordering', () => {
  const source = createOldTenFoodFixture();
  Model.setSkin(source, 'tech');
  Model.setTitle(source, '旧科技皮肤与裁切图');
  Model.updateRow(source, source.rows[0].id, { name: '原有分组', color: '#113355' });
  const image = pngHeaderFixture(12, 8);
  Model.updateItem(source, 'food-hotpot', { name: '我上传的原图', image, art: null, crop: { x: 2.5, y: 0.5, size: 7 } });
  Model.moveItem(source, 'food-cake', 'pool');
  const fixture = asVersion2(source);
  const before = JSON.stringify(fixture);
  const validated = Model.validateState(fixture);
  const restored = Model.deserialize(before);
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(validated, source);
  assert.deepEqual(restored, source);
  assert.equal(restored.version, 3);
  assert.equal(restored.templateId, 'food');
  assert.deepEqual(asVersion2(restored), fixture, 'migration preserves every version-2 data field');
  assert.equal(restored.items['food-hotpot'].image, image);
  assert.deepEqual(restored.items['food-hotpot'].crop, { x: 2.5, y: 0.5, size: 7 });
});

test('all three schema versions remain strict and modern versions default only an omitted item crop', () => {
  const state = Model.createDefaultState();
  const legacy = asVersion1(state);
  assert.throws(() => Model.validateState({ ...legacy, skin: 'tech' }), /字段/);
  legacy.items[state.rows[0].itemIds[0]].crop = null;
  assert.throws(() => Model.validateState(legacy), /字段/);
  assert.throws(() => Model.validateState({ ...asVersion2(state), templateId: 'sport' }), /字段/);
  const optionalCrop = clone(state);
  const firstId = state.rows[0].itemIds[0];
  delete optionalCrop.items[firstId].crop;
  assert.equal(Model.validateState(optionalCrop).items[firstId].crop, null);
  assert.equal(Object.prototype.hasOwnProperty.call(optionalCrop.items[firstId], 'crop'), false);
  assert.equal(Model.validateState(asVersion2(optionalCrop)).items[firstId].crop, null);
  for (const skin of [undefined, null, 'dark', '', {}, '<script>']) assert.throws(() => Model.validateState({ ...state, skin }), /皮肤/);
  assert.throws(() => Model.validateState({ ...state, renderedImages: {} }), /字段/);
});

test('skin changes validate atomically and clearItems preserves all ranking settings', () => {
  const state = Model.createDefaultState();
  Model.setTitle(state, '保留我的标题');
  Model.updateRow(state, state.rows[0].id, { name: '保留等级', color: '#112233' });
  Model.addRow(state, { name: '额外等级', color: '#123456' });
  Model.addItem(state, { name: '上传图片', image: PNG });
  assert.equal(Model.setSkin(state, 'tech'), state);
  const settings = { title: state.title, skin: state.skin, rows: state.rows.map(({ id, name, color }) => ({ id, name, color })) };
  assert.throws(() => Model.setSkin(state, 'unknown'), /皮肤/);
  assert.equal(state.skin, 'tech');
  assert.equal(Model.clearItems(state), state);
  assert.deepEqual(state.items, {});
  assert.deepEqual(state.pool, []);
  assert.ok(state.rows.every(row => row.itemIds.length === 0));
  assert.deepEqual({ title: state.title, skin: state.skin, rows: state.rows.map(({ id, name, color }) => ({ id, name, color })) }, settings);
  Model.validateState(state);
  Model.clearItems(state);
  const id = Model.addItem(state, { name: '重新添加' }, state.rows[0].id);
  assert.deepEqual(state.rows[0].itemIds, [id]);
});

test('centerCrop uses image header dimensions and covers horizontal, vertical and square images', () => {
  assert.deepEqual(Model.centerCrop(pngHeaderFixture(12, 8)), { x: 2, y: 0, size: 8 });
  assert.deepEqual(Model.centerCrop(pngHeaderFixture(8, 13)), { x: 0, y: 2.5, size: 8 });
  assert.deepEqual(Model.centerCrop(PNG), { x: 0, y: 0, size: 1 });
  assert.throws(() => Model.centerCrop(null), /图片/);
  assert.throws(() => Model.centerCrop('https://example.com/image.png'));
});

test('display dimensions and square crops follow EXIF orientation without changing raw preflight dimensions', () => {
  for (const bigEndian of [false, true]) {
    for (let orientation = 1; orientation <= 8; orientation++) {
      const image = jpegExifFixture(12, 8, orientation, bigEndian);
      const display = orientation >= 5 ? { width: 8, height: 12 } : { width: 12, height: 8 };
      assert.deepEqual(Model.imageDimensions(image), display);
      const bytes = Uint8Array.from(Buffer.from(image.split(',')[1], 'base64'));
      assert.deepEqual(Model.inspectRaster(bytes, 'jpeg'), { width: 12, height: 8, mime: 'image/jpeg' });
      assert.deepEqual(Model.centerCrop(image), orientation >= 5 ? { x: 0, y: 2, size: 8 } : { x: 2, y: 0, size: 8 });
      const state = Model.createDefaultState();
      const id = Model.addItem(state, { name: '带方向图片', image, crop: orientation >= 5 ? { x: 0, y: 4, size: 8 } : { x: 4, y: 0, size: 8 } });
      assert.deepEqual(Model.deserialize(Model.serialize(state)).items[id], state.items[id]);
    }
    const corrupt = jpegExifFixture(12, 8, 6, bigEndian, true);
    assert.deepEqual(Model.imageDimensions(corrupt), { width: 12, height: 8 }, 'out-of-bounds EXIF offset is ignored');
    assert.deepEqual(Model.imageDimensions(jpegExifFixture(12, 8, 100, bigEndian)), { width: 12, height: 8 }, 'unknown orientation is ignored');
  }
  assert.throws(() => Model.imageDimensions(null), /有效图片/);
});

test('PNG and WebP EXIF are bounded by their containers and ignore malformed metadata', () => {
  for (const corrupt of [false, true]) {
    const tiff = tiffExifFixture(6, false, corrupt);
    const png = Buffer.from(pngHeaderFixture(12, 8).split(',')[1], 'base64');
    const pngChunk = Buffer.alloc(tiff.length + 12);
    pngChunk.writeUInt32BE(tiff.length, 0); pngChunk.write('eXIf', 4); tiff.copy(pngChunk, 8);
    const pngImage = 'data:image/png;base64,' + Buffer.concat([png.subarray(0, 33), pngChunk, png.subarray(33)]).toString('base64');
    assert.deepEqual(Model.imageDimensions(pngImage), corrupt ? { width: 12, height: 8 } : { width: 8, height: 12 });
    const webpHeader = Buffer.alloc(30);
    webpHeader.write('RIFF', 0); webpHeader.write('WEBP', 8); webpHeader.write('VP8X', 12);
    webpHeader.writeUInt32LE(10, 16); webpHeader[20] = 8; webpHeader[24] = 11; webpHeader[27] = 7;
    const webpChunk = Buffer.alloc(tiff.length + 8);
    webpChunk.write('EXIF', 0); webpChunk.writeUInt32LE(tiff.length, 4); tiff.copy(webpChunk, 8);
    const webp = Buffer.concat([webpHeader, webpChunk]);
    webp.writeUInt32LE(webp.length - 8, 4);
    const webpImage = 'data:image/webp;base64,' + webp.toString('base64');
    assert.deepEqual(Model.imageDimensions(webpImage), corrupt ? { width: 12, height: 8 } : { width: 8, height: 12 });
    webp.writeUInt32LE(webpHeader.length - 8, 4);
    assert.deepEqual(Model.imageDimensions('data:image/webp;base64,' + webp.toString('base64')), { width: 12, height: 8 }, 'EXIF outside declared RIFF is ignored');
    pngChunk.writeUInt32BE(0xffffffff, 0);
    assert.deepEqual(Model.imageDimensions('data:image/png;base64,' + Buffer.concat([png.subarray(0, 33), pngChunk]).toString('base64')),
      { width: 12, height: 8 }, 'oversized PNG chunk is ignored without reading past the buffer');
  }
});

test('square crop coordinates permit floats and exact edges while rejecting unsafe bounds atomically', () => {
  const state = Model.createDefaultState();
  const image = pngHeaderFixture(12, 8);
  const crop = { x: 3.5, y: 0.5, size: 7.5 };
  const id = Model.addItem(state, { name: '浮点裁切', image, crop });
  crop.x = 0;
  assert.deepEqual(state.items[id].crop, { x: 3.5, y: 0.5, size: 7.5 }, 'crop object is copied');
  Model.updateItem(state, id, { crop: { x: 11, y: 7, size: 1 } });
  const before = Model.serialize(state);
  for (const value of [
    { x: -0.1, y: 0, size: 1 }, { x: 0, y: -1, size: 1 }, { x: 0, y: 0, size: 0.99 },
    { x: 11.1, y: 7, size: 1 }, { x: 0, y: 7.1, size: 1 }, { x: 0, y: 0, size: 9 },
    { x: NaN, y: 0, size: 1 }, { x: 0, y: Infinity, size: 1 }, { x: 0, y: 0, size: -Infinity },
    { x: '0', y: 0, size: 1 }, { x: 0, y: 0 }, { x: 0, y: 0, size: 1, rotate: 90 }, [], 'crop'
  ]) assert.throws(() => Model.updateItem(state, id, { crop: value }));
  assert.equal(Model.serialize(state), before);
  assert.throws(() => Model.updateItem(state, state.rows[0].itemIds[0], { crop: { x: 0, y: 0, size: 1 } }), /没有图片/);
  const malicious = clone(state);
  malicious.items[id].crop.x = 100;
  assert.throws(() => Model.validateState(malicious), /边界/);
});

test('replacing or clearing an image requires an explicit valid crop choice', () => {
  const state = Model.createDefaultState();
  const image = pngHeaderFixture(12, 8);
  const id = Model.addItem(state, { name: '原图', image, crop: Model.centerCrop(image) });
  const before = Model.serialize(state);
  assert.throws(() => Model.updateItem(state, id, { image: PNG }), /明确指定/);
  assert.throws(() => Model.updateItem(state, id, { image: PNG, crop: undefined }), /明确指定/);
  assert.throws(() => Model.updateItem(state, id, { image: PNG, crop: state.items[id].crop }), /边界/);
  assert.equal(Model.serialize(state), before);
  Model.updateItem(state, id, { image, name: '同图重命名' });
  assert.deepEqual(state.items[id].crop, { x: 2, y: 0, size: 8 });
  Model.updateItem(state, id, { image: PNG, crop: null });
  assert.equal(state.items[id].image, PNG);
  assert.equal(state.items[id].crop, null);
  Model.updateItem(state, id, { image: null, crop: null, art: 'sushi' });
  assert.equal(state.items[id].image, null);
  assert.equal(state.items[id].art, 'sushi');
});

test('v3 backup keeps template ID, one source image, explicit crops and selected skin through roundtrip', () => {
  const state = Model.createDefaultState();
  Model.setSkin(state, 'tech');
  const image = pngHeaderFixture(12, 8);
  const id = Model.addItem(state, { name: '可再次编辑的原图', image, crop: { x: 2.5, y: 1.5, size: 6 } }, state.rows[0].id);
  const json = Model.serialize(state);
  const value = JSON.parse(json);
  assert.equal(value.version, 3);
  assert.equal(value.templateId, 'food');
  assert.equal(value.skin, 'tech');
  assert.equal(json.split(image).length - 1, 1, 'only one image bitmap is saved per item');
  assert.deepEqual(value.items[id].crop, { x: 2.5, y: 1.5, size: 6 });
  Object.values(value.items).forEach(item => assert.ok(Object.prototype.hasOwnProperty.call(item, 'crop')));
  assert.deepEqual(Model.deserialize(json), state);
});

test('sport JSON roundtrip and clearing preserve template identity, settings and custom work', () => {
  const state = Model.createDefaultState('sport');
  Model.setSkin(state, 'tech');
  Model.setTitle(state, '我的运动偏好');
  Model.moveItem(state, 'sport-football', 'pool');
  Model.updateItem(state, 'sport-walking', { name: '晚饭后散步' });
  const imageId = Model.addItem(state, { name: '自选运动图', image: PNG, crop: { x: 0, y: 0, size: 1 } }, state.rows[0].id);
  const json = Model.serialize(state);
  assert.equal(JSON.parse(json).templateId, 'sport');
  assert.deepEqual(Model.deserialize(json), state);
  assert.equal(Model.deserialize(json).items[imageId].image, PNG);
  const settings = { title: state.title, skin: state.skin, templateId: state.templateId, rows: state.rows.map(({ id, name, color }) => ({ id, name, color })) };
  Model.clearItems(state);
  assert.deepEqual({ title: state.title, skin: state.skin, templateId: state.templateId, rows: state.rows.map(({ id, name, color }) => ({ id, name, color })) }, settings);
  assert.deepEqual(state.items, {});
  assert.deepEqual(Model.deserialize(Model.serialize(state)), state);
});

test('image validation metadata is reused without retaining stale image data', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  let decodes = 0;
  const sandbox = { atob(value) { decodes++; return Buffer.from(value, 'base64').toString('binary'); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../home/assets/ranking-model.js'), 'utf8'), sandbox);
  sandbox.source = PNG;
  vm.runInContext('state = RankingModel.createDefaultState(); itemId = RankingModel.addItem(state, {name:"image", image:source, crop:{x:0,y:0,size:1}});', sandbox);
  const afterAdding = decodes;
  assert.equal(afterAdding, 1, 'validation, crop and budget share one decode');
  vm.runInContext('RankingModel.serialize(state); RankingModel.serialize(state);', sandbox);
  assert.equal(decodes, afterAdding, 'unchanged saved items reuse weakly held metadata');
  sandbox.changed = pngHeaderFixture(2, 2);
  vm.runInContext('state.items[itemId].image = changed; RankingModel.serialize(state);', sandbox);
  assert.equal(decodes, afterAdding + 1, 'changing an item image invalidates previous metadata');
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
  assert.equal(Export.planLayout(state, { includePool: true }).rows.at(-1).cards.length, 34);
});

test('title and tier label wrapping measure the same bold weight used in rendering', () => {
  const state = Model.createDefaultState();
  state.rows[0].name = 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM';
  for (const skin of ['classic', 'tech']) {
    Model.setSkin(state, skin);
    const calls = [];
    const layout = Export.planLayout(state, { measureText: (value, size, weight) => {
      calls.push({ value, size, weight });
      return value.length * size * (weight === '700' ? 1 : 0.5);
    } });
    const labels = calls.filter(call => call.size === layout.rows[0].labelSize);
    assert.ok(labels.length > 0);
    assert.ok(labels.every(call => call.weight === '700'));
    assert.ok(layout.rows[0].labelLines.length > 1);
  }
});

test('long titles, tier labels and 200 long names wrap without clipping or loss', () => {
  const state = Model.createDefaultState();
  state.title = '测试很长的排行标题'.repeat(10);
  state.rows[0].name = '夯中之夯'.repeat(6);
  Object.keys(state.items).forEach(id => Model.removeItem(state, id));
  const name = '中文项目名称不应被截断'.repeat(7);
  for (let index = 0; index < 200; index++) Model.addItem(state, { name }, state.rows[index % 5].id);
  const measureText = (text, size) => Array.from(text).length * size;
  for (const skin of ['classic', 'tech']) for (const width of [640, 1200, 2000]) {
    Model.setSkin(state, skin);
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

test('classic is a compact light table while tech retains its original palette and geometry', () => {
  const state = Model.createDefaultState();
  const classic = Export.planLayout(state);
  Model.setSkin(state, 'tech');
  const tech = Export.planLayout(state);
  assert.equal(classic.skin, 'classic');
  assert.equal(tech.skin, 'tech');
  assert.ok(classic.height < tech.height);
  assert.ok(classic.columns > tech.columns);
  assert.equal(classic.margin, 24);
  assert.equal(classic.rows[0].labelWidth, 112);
  assert.equal(classic.rows[0].cards[0].imageSize, 100);
  assert.equal(classic.rows[0].cards[0].fontSize, 16);
  assert.equal(classic.rows[0].cards[0].nameY - classic.rows[0].cards[0].y - classic.rows[0].cards[0].imageSize, 6);
  assert.equal(tech.margin, 32);
  assert.equal(tech.columns, 7);
  assert.equal(tech.rows[0].labelWidth, 152);
  assert.deepEqual({ x: tech.rows[0].cards[0].x, y: tech.rows[0].cards[0].y, imageSize: tech.rows[0].cards[0].imageSize,
    fontSize: tech.rows[0].cards[0].fontSize, lineHeight: tech.rows[0].cards[0].lineHeight, nameY: tech.rows[0].cards[0].nameY },
  { x: 204, y: 136, imageSize: 112, fontSize: 18, lineHeight: 26, nameY: 260 });
  assert.equal(Export.SKINS.classic.background, '#f7f5ee');
  assert.equal(Export.SKINS.classic.row, '#f3f3f3');
  assert.equal(Export.SKINS.classic.ink, '#171717');
  assert.equal(Export.SKINS.classic.title, '#171717');
  assert.equal(Export.SKINS.classic.border, '#262626');
  assert.deepEqual(Export.SKINS.tech, { background: '#f7f5ee', row: '#fffef9', ink: '#263b2d', title: '#244333', border: '#d4d9cd', card: '#e8ede3' });
  for (const width of [640, 899, 900, 1200, 2000]) {
    const layout = Export.planLayout(state, { width });
    assert.equal(layout.rows[0].labelWidth, width < 900 ? 124 : 152);
    assert.equal(layout.columns, Math.floor((width - 64 - layout.rows[0].labelWidth - 40 + 16) / 128));
    assert.equal(layout.rows[0].cards[0].imageSize, 112);
  }
});

test('Canvas export uses selected palette, exact square source crop and contain fallback', async () => {
  const savedDocument = global.document;
  const savedImage = global.Image;
  const draws = [];
  const fills = [];
  const texts = [];
  const sources = [];
  const context = {
    measureText(value) { const size = Number((this.font || '').match(/(\d+)px/)[1]); return Array.from(value).length * size * 0.6; },
    scale() {}, beginPath() {}, roundRect() {}, fill() {}, strokeRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(...args) { fills.push({ color: this.fillStyle, args }); },
    fillText(value) { texts.push({ value, color: this.fillStyle }); },
    drawImage(...args) { draws.push(args); }
  };
  global.document = { fonts: { ready: Promise.resolve() }, createElement() {
    return { width: 0, height: 0, getContext: () => context, toBlob(callback, type) { callback(new Blob(['mock encoding'], { type })); } };
  } };
  global.Image = class {
    constructor() { this.naturalWidth = 12; this.naturalHeight = 8; }
    set src(value) { if (value) { sources.push(value); queueMicrotask(() => this.onload && this.onload()); } }
    async decode() {}
  };
  try {
    const state = Model.createDefaultState();
    Model.clearItems(state);
    const crop = { x: 2.5, y: 1.5, size: 6 };
    const id = Model.addItem(state, { name: '裁切图片', image: pngHeaderFixture(12, 8), crop }, state.rows[0].id);
    const output = await Export.exportRanking(state, { scale: 2 });
    assert.equal(output.blob.type, 'image/png');
    assert.equal(fills[0].color, Export.SKINS.classic.background);
    assert.equal(fills[1].color, Export.SKINS.classic.row);
    assert.equal(texts.find(entry => entry.value === '裁切图片').color, Export.SKINS.classic.ink);
    assert.equal(draws[0].length, 9);
    assert.deepEqual(draws[0].slice(1, 5), [crop.x, crop.y, crop.size, crop.size]);
    assert.deepEqual(draws[0].slice(-2), [100, 100]);
    assert.deepEqual(sources, [state.items[id].image], 'custom image export never substitutes a built-in photo');
    draws.length = fills.length = texts.length = 0;
    Model.setSkin(state, 'tech');
    Model.updateItem(state, id, { crop: null });
    await Export.exportRanking(state, { scale: 1 });
    assert.equal(fills[0].color, Export.SKINS.tech.background);
    assert.equal(fills[1].color, Export.SKINS.tech.row);
    assert.equal(texts.find(entry => entry.value === '裁切图片').color, Export.SKINS.tech.ink);
    assert.equal(draws[0].length, 5);
    assert.equal(draws[0][3], 112);
    assert.ok(Math.abs(draws[0][4] - 112 * 8 / 12) < 0.0001);
  } finally {
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
    if (savedImage === undefined) delete global.Image; else global.Image = savedImage;
  }
});

test('classic Canvas draws a two-pixel square table grid and tech keeps thin row frames and card corners', async () => {
  const savedDocument = global.document;
  const frames = [];
  const lines = [];
  const corners = [];
  const text = [];
  let path = [];
  const context = {
    measureText(value) { const size = Number((this.font || '').match(/(\d+)px/)[1]); return Array.from(value).length * size * 0.6; },
    scale() {}, fill() {}, fillRect() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push(['move', x, y]); },
    lineTo(x, y) { path.push(['line', x, y]); },
    stroke() { lines.push({ color: this.strokeStyle, width: this.lineWidth, path: path.slice() }); },
    strokeRect(...args) { frames.push({ color: this.strokeStyle, width: this.lineWidth, join: this.lineJoin, args }); },
    roundRect(...args) { corners.push(args); },
    fillText(value) { text.push({ value, color: this.fillStyle }); }
  };
  global.document = { fonts: { ready: Promise.resolve() }, createElement() {
    return { getContext: () => context, toBlob(callback, type) { callback(new Blob(['mock encoding'], { type })); } };
  } };
  try {
    const state = Model.createDefaultState();
    Model.clearItems(state);
    Model.addItem(state, { name: '表格文字项目' }, state.rows[0].id);
    const colors = state.rows.map(row => row.color);
    await Export.exportRanking(state, { scale: 1 });
    const layout = Export.planLayout(state);
    const top = layout.rows[0].y;
    const bottom = layout.rows.at(-1).y + layout.rows.at(-1).height;
    assert.equal(corners.length, 0, 'classic has no independent rounded cards');
    assert.deepEqual(frames, [{ color: '#262626', width: 2, join: 'miter', args: [24, top, layout.width - 48, bottom - top] }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].color, '#262626');
    assert.equal(lines[0].width, 2);
    assert.deepEqual(lines[0].path.slice(0, 2), [['move', 136, top], ['line', 136, bottom]], 'label-column divider spans the full table');
    assert.deepEqual(lines[0].path.slice(2), layout.rows.slice(1).flatMap(row => [
      ['move', row.x, row.y], ['line', row.x + row.width, row.y]
    ]), 'every tier boundary has a full-width horizontal line');
    assert.equal(text.find(entry => entry.value === state.title).color, '#171717');
    assert.deepEqual(state.rows.map(row => row.color), colors, 'export never changes colored labels');
    frames.length = lines.length = corners.length = 0;
    Model.setSkin(state, 'tech');
    await Export.exportRanking(state, { scale: 1 });
    assert.equal(frames.length, state.rows.length, 'tech retains one thin frame per row');
    assert.ok(frames.every(frame => frame.width === 1 && frame.color === '#d4d9cd'));
    assert.equal(lines.length, 0, 'classic grid is not added to tech');
    assert.deepEqual(corners.map(args => args.slice(2)), [[112, 112, 10]], 'tech retains its 112-pixel rounded card');
  } finally {
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
  }
});

test('Canvas exports food, sport and legacy photos using only fixed local paths and centered square cover', async () => {
  const savedDocument = global.document;
  const savedImage = global.Image;
  const sources = [];
  const draws = [];
  const texts = [];
  const context = {
    measureText(value) { const size = Number((this.font || '').match(/(\d+)px/)[1]); return Array.from(value).length * size * 0.6; },
    scale() {}, beginPath() {}, roundRect() {}, fill() {}, strokeRect() {}, fillRect() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillText(value) { texts.push(value); },
    drawImage(image, ...args) { draws.push({ source: image.source, crossOrigin: image.crossOrigin, width: image.naturalWidth, height: image.naturalHeight, args }); }
  };
  global.document = { fonts: { ready: Promise.resolve() }, createElement() {
    return { getContext: () => context, toBlob(callback, type) { callback(new Blob(['mock encoding'], { type })); } };
  } };
  global.Image = class {
    set src(value) {
      if (!value) return;
      this.source = value;
      sources.push(value);
      const portrait = value.endsWith('/dumpling.webp') || value.endsWith('/handmade-dumplings.webp') || value.endsWith('/tea.webp') || value.endsWith('/walking.webp');
      this.naturalWidth = portrait ? 8 : 12;
      this.naturalHeight = portrait ? 12 : 8;
      queueMicrotask(() => this.onload && this.onload());
    }
    async decode() {}
  };
  try {
    const cases = [
      { state: Model.createDefaultState('food'), keys: DEFAULT_ART_ORDER, folder: 'foods' },
      { state: Model.createDefaultState('sport'), keys: SPORT_ART_ORDER, folder: 'sports' },
      { state: createOldEighteenFoodFixture(), keys: LEGACY_FOOD_18_ORDER, folder: 'foods' },
      { state: createOldThirtyTwoFoodFixture(), keys: LEGACY_FOOD_32_ORDER, folder: 'foods' },
      { state: createOldTenFoodFixture(), keys: ['hotpot', 'noodles', 'dumpling', 'burger', 'watermelon', 'chicken', 'sushi', 'pizza', 'cake', 'tea'], folder: 'foods' }
    ];
    for (const { state, keys, folder } of cases) {
      sources.length = draws.length = texts.length = 0;
      const before = Model.serialize(state);
      await Export.exportRanking(state, { scale: 1 });
      assert.deepEqual(sources, keys.map(key => '/assets/' + folder + '/' + key + '.webp'));
      assert.equal(draws.length, keys.length);
      draws.forEach(draw => {
        assert.equal(draw.crossOrigin, 'anonymous');
        assert.equal(draw.args.length, 8, 'cover uses the nine-argument drawImage overload');
        assert.deepEqual(draw.args.slice(0, 4), draw.width > draw.height ? [2, 0, 8, 8] : [0, 2, 8, 8]);
        assert.deepEqual(draw.args.slice(-2), [100, 100]);
      });
      Object.values(Model.BUILTIN_ART).forEach(art => assert.ok(!texts.includes(art.emoji), 'photos replace emoji rendering'));
      assert.equal(Model.serialize(state), before, 'export never embeds photos or mutates the ranking');
    }
    global.Image = class {
      set src(value) { if (value) queueMicrotask(() => this.onerror && this.onerror()); }
    };
    await assert.rejects(Export.exportRanking(cases[0].state), /内置照片无法读取.*本地资源/, 'missing built-in assets report an actionable error');
  } finally {
    if (savedDocument === undefined) delete global.document; else global.document = savedDocument;
    if (savedImage === undefined) delete global.Image; else global.Image = savedImage;
  }
});

test('PNG sizing rejects unsupported scales or impossibly long content', async () => {
  assert.throws(() => Export.outputSize({ width: 1200, height: 800 }, 0));
  assert.throws(() => Export.outputSize({ width: 1200, height: 50000 }, 2), /过长/);
  assert.throws(() => Export.planLayout(Model.createDefaultState(), { width: 320 }));
  await assert.rejects(Export.exportRanking(Model.createDefaultState()), /Canvas/);
});
