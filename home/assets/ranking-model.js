/* Original, dependency-free ranking data model. Browser: RankingModel; Node: require(). */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankingModel = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIMITS = Object.freeze({ rows: 20, items: 200, title: 100, name: 80, rowName: 30,
    imageBytes: 1024 * 1024, totalImageBytes: 20 * 1024 * 1024, jsonBytes: 30 * 1024 * 1024,
    imageSide: 4096, imagePixels: 16 * 1024 * 1024, totalImagePixels: 64000000 });
  const FOOD_ART = Object.freeze({
    hotpot: { name: '火锅', emoji: '🍲', bg: '#f9e2d4' },
    dumpling: { name: '饺子', emoji: '🥟', bg: '#f7eed8' },
    noodles: { name: '面条', emoji: '🍜', bg: '#f4e6cf' },
    sushi: { name: '寿司', emoji: '🍣', bg: '#f5e3e3' },
    burger: { name: '汉堡', emoji: '🍔', bg: '#f6e6c7' },
    pizza: { name: '披萨', emoji: '🍕', bg: '#f8e0c8' },
    chicken: { name: '炸鸡', emoji: '🍗', bg: '#f3ddc4' },
    tea: { name: '奶茶', emoji: '🧋', bg: '#e6ddcf' },
    watermelon: { name: '西瓜', emoji: '🍉', bg: '#e4eed7' },
    cake: { name: '蛋糕', emoji: '🍰', bg: '#f3dfdf' }
  });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  let counter = 0;
  function fail(message) { throw new Error(message); }
  function record(value, label, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail(label + '格式不正确。');
    if (keys && Object.keys(value).some(key => !keys.includes(key))) fail(label + '包含不支持的字段。');
  }
  function text(value, max, label) {
    if (typeof value !== 'string') fail(label + '必须是文字。');
    const normalized = value.replace(/\r\n?/g, '\n').trim();
    if (!normalized || Array.from(normalized).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized))
      fail(label + '须为 1–' + max + ' 个字符，且不能含控制字符。');
    return normalized;
  }
  function id(value, label) {
    if (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/i.test(value) || ['constructor', 'prototype', '__proto__', 'pool'].includes(value))
      fail((label || '标识') + '不合法。');
    return value;
  }
  function makeId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + (++counter).toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('等级颜色须为六位十六进制颜色。');
    return value.toLowerCase();
  }
  function bytesFromBase64(encoded) {
    if (typeof atob === 'function') {
      const binary = atob(encoded);
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(encoded, 'base64'));
    fail('此浏览器无法读取图片数据。');
  }
  const u32 = (bytes, offset) => ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  const le24 = (bytes, offset) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
  function rasterSize(bytes, mime) {
    if (mime === 'png') {
      if (bytes.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) ||
        u32(bytes, 8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') fail('PNG 图片头无效。');
      return [u32(bytes, 16), u32(bytes, 20)];
    }
    if (mime === 'jpeg') {
      if (bytes[0] !== 255 || bytes[1] !== 216) fail('JPEG 图片头无效。');
      let offset = 2;
      while (offset + 3 < bytes.length) {
        if (bytes[offset++] !== 255) fail('JPEG 图片结构无效。');
        while (bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        const length = bytes[offset] * 256 + bytes[offset + 1];
        if (length < 2 || offset + length > bytes.length) fail('JPEG 图片结构无效。');
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
          if (length < 8) fail('JPEG 图片尺寸无效。');
          return [bytes[offset + 5] * 256 + bytes[offset + 6], bytes[offset + 3] * 256 + bytes[offset + 4]];
        }
        offset += length;
      }
      fail('JPEG 图片缺少尺寸信息。');
    }
    if (mime === 'webp') {
      const word = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
      if (bytes.length < 25 || word(0) !== 'RIFF' || word(8) !== 'WEBP') fail('WebP 图片头无效。');
      const kind = word(12);
      if (kind === 'VP8X' && bytes.length >= 30) {
        if (bytes[20] & 2) fail('请将动画 WebP 转换为静态图片后导入。');
        return [le24(bytes, 24) + 1, le24(bytes, 27) + 1];
      }
      if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42)
        return [(bytes[26] + (bytes[27] << 8)) & 0x3fff, (bytes[28] + (bytes[29] << 8)) & 0x3fff];
      if (kind === 'VP8L' && bytes[20] === 47)
        return [1 + bytes[21] + ((bytes[22] & 63) << 8), 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10)];
      fail('不支持的 WebP 图片结构。');
    }
    fail('不支持此图片格式。');
  }
  /* Preflight a raw upload before browser decoding. Returns dimensions, but applies no side limit. */
  function inspectRaster(bytes, mime) {
    if (!(bytes instanceof Uint8Array)) fail('图片字节格式不正确。');
    const type = String(mime || '').replace(/^image\//, '').toLowerCase();
    if (!['png', 'jpeg', 'webp'].includes(type)) fail('仅支持 PNG、JPEG 或 WebP 图片。');
    const size = rasterSize(bytes, type);
    if (!size[0] || !size[1]) fail('图片尺寸无效。');
    return { width: size[0], height: size[1], mime: 'image/' + type };
  }
  function validateImage(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.imageBytes / 3) * 4 + 50) fail('单张图片数据不能超过 1 MB，请先缩小图片。');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) fail('仅接受本地 PNG、JPEG 或 WebP 图片数据，不能使用 SVG 或外链。');
    const bytes = bytesFromBase64(match[2]);
    if (bytes.length > LIMITS.imageBytes) fail('单张图片数据不能超过 1 MB，请先缩小图片。');
    const size = rasterSize(bytes, match[1]);
    if (!size[0] || !size[1] || size[0] > LIMITS.imageSide || size[1] > LIMITS.imageSide || size[0] * size[1] > LIMITS.imagePixels)
      fail('图片尺寸过大或无效，请缩小到 4096 × 4096 像素以内。');
    return value;
  }
  function imageBytes(value) {
    if (!value) return 0;
    const encoded = value.slice(value.indexOf(',') + 1);
    return encoded.length * 3 / 4 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  }
  function imagePixels(value) {
    if (!value) return 0;
    const comma = value.indexOf(',');
    const mime = value.slice(11, value.indexOf(';'));
    const size = rasterSize(bytesFromBase64(value.slice(comma + 1)), mime);
    return size[0] * size[1];
  }
  function checkImageBudget(items, replacement) {
    let bytes = replacement ? imageBytes(replacement.image) : 0;
    let pixels = replacement ? imagePixels(replacement.image) : 0;
    Object.values(items).forEach(entry => {
      if (!replacement || entry.id !== replacement.id) { bytes += imageBytes(entry.image); pixels += imagePixels(entry.image); }
    });
    if (bytes > LIMITS.totalImageBytes) fail('所有图片合计不能超过 20 MB，请减少或缩小图片。');
    if (pixels > LIMITS.totalImagePixels) fail('图片解码总量超过 6400 万像素，请缩小图片后导入，以免浏览器内存不足。');
  }
  function normalizeItem(value, itemId) {
    record(value, '项目', ['id', 'name', 'image', 'art']);
    if (id(value.id, '项目标识') !== itemId) fail('项目标识与索引不一致。');
    const art = value.art == null ? null : value.art;
    if (art !== null && (typeof art !== 'string' || !own(FOOD_ART, art))) fail('未知的示例插画。');
    const image = validateImage(value.image);
    if (image && art) fail('项目不能同时含自定义图片和示例插画。');
    return { id: itemId, name: text(value.name, LIMITS.name, '项目名称'), image, art };
  }
  function validateState(value) {
    record(value, '排行', ['version', 'title', 'rows', 'pool', 'items']);
    if (value.version !== 1) fail('不支持此备份版本。');
    if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > LIMITS.rows) fail('排行须含 1–' + LIMITS.rows + ' 个等级。');
    record(value.items, '项目索引');
    const itemKeys = Object.keys(value.items);
    if (itemKeys.length > LIMITS.items) fail('项目不能超过 ' + LIMITS.items + ' 个。');
    const items = {};
    itemKeys.forEach(key => {
      id(key, '项目标识');
      items[key] = normalizeItem(value.items[key], key);
    });
    checkImageBudget(items);
    const rowIds = new Set();
    const referenced = new Set();
    function references(list) {
      if (!Array.isArray(list) || list.length > LIMITS.items) fail('项目列表格式不正确。');
      return list.map(key => {
        if (typeof key !== 'string' || !own(items, key)) fail('等级中引用了不存在的项目。');
        if (referenced.has(key)) fail('同一项目不能重复出现在多个位置。');
        referenced.add(key);
        return key;
      });
    }
    const rows = value.rows.map(row => {
      record(row, '等级', ['id', 'name', 'color', 'itemIds']);
      const rowId = id(row.id, '等级标识');
      if (rowIds.has(rowId)) fail('等级标识不能重复。');
      rowIds.add(rowId);
      return { id: rowId, name: text(row.name, LIMITS.rowName, '等级名称'), color: color(row.color), itemIds: references(row.itemIds) };
    });
    const pool = references(value.pool);
    if (referenced.size !== itemKeys.length) fail('有项目没有归入等级或待选区，备份已拒绝以免丢失内容。');
    return { version: 1, title: text(value.title, LIMITS.title, '排行标题'), rows, pool, items };
  }
  function serialize(state) { return JSON.stringify(validateState(state), null, 2); }
  function deserialize(json) {
    if (typeof json !== 'string' || json.length > LIMITS.jsonBytes) fail('备份文件过大，最多支持 30 MB。');
    let value;
    try { value = JSON.parse(json); } catch (_) { fail('备份不是有效的 JSON 文件。'); }
    return validateState(value);
  }
  function createDefaultState() {
    const state = { version: 1, title: '美食从夯到拉', rows: [
      ['夯', '#f28b82', ['hotpot']],
      ['顶级', '#f6b26b', ['noodles', 'dumpling', 'burger', 'watermelon']],
      ['人上人', '#f9d976', ['chicken']],
      ['NPC', '#e8e5a0', ['sushi']],
      ['拉', '#a8cf9a', ['pizza', 'cake', 'tea']]
    ].map((entry, index) => ({ id: 'row-' + index, name: entry[0], color: entry[1], itemIds: entry[2].map(key => 'food-' + key) })), pool: [], items: {} };
    Object.keys(FOOD_ART).forEach(key => {
      const itemId = 'food-' + key;
      state.items[itemId] = { id: itemId, name: FOOD_ART[key].name, image: null, art: key };
    });
    return state;
  }
  function listFor(state, target) {
    if (target === 'pool') return state.pool;
    const row = state.rows.find(entry => entry.id === target);
    if (!row) fail('目标等级不存在。');
    return row.itemIds;
  }
  function locateItem(state, itemId) {
    if (!own(state.items, itemId)) fail('项目不存在。');
    if (state.pool.includes(itemId)) return { target: 'pool', index: state.pool.indexOf(itemId) };
    const row = state.rows.find(entry => entry.itemIds.includes(itemId));
    if (!row) fail('项目位置无效。');
    return { target: row.id, index: row.itemIds.indexOf(itemId) };
  }
  function position(index, length) {
    if (index === undefined || index === null) return length;
    if (!Number.isInteger(index) || index < 0 || index > length) fail('目标位置超出范围。');
    return index;
  }
  function moveItem(state, itemId, target, index) {
    const source = locateItem(state, itemId);
    const list = listFor(state, target);
    const at = position(index, list.length - (source.target === target ? 1 : 0));
    listFor(state, source.target).splice(source.index, 1);
    list.splice(at, 0, itemId);
    return state;
  }
  function addRow(state, options, index) {
    if (state.rows.length >= LIMITS.rows) fail('最多支持 ' + LIMITS.rows + ' 个等级。');
    const row = { id: makeId('row'), name: text(options.name, LIMITS.rowName, '等级名称'), color: color(options.color || '#c7d7bd'), itemIds: [] };
    state.rows.splice(position(index, state.rows.length), 0, row);
    return row.id;
  }
  function deleteRow(state, rowId) {
    const index = state.rows.findIndex(row => row.id === rowId);
    if (index < 0) fail('等级不存在。');
    if (state.rows.length <= 1) fail('至少保留一个等级。');
    state.pool.push(...state.rows[index].itemIds);
    state.rows.splice(index, 1);
    return state;
  }
  function reorderRow(state, rowId, index) {
    const from = state.rows.findIndex(row => row.id === rowId);
    if (from < 0) fail('等级不存在。');
    const at = position(index, state.rows.length - 1);
    state.rows.splice(at, 0, state.rows.splice(from, 1)[0]);
    return state;
  }
  function updateRow(state, rowId, patch) {
    const row = state.rows.find(entry => entry.id === rowId);
    if (!row) fail('等级不存在。');
    record(patch, '等级修改', ['name', 'color']);
    const nextName = own(patch, 'name') ? text(patch.name, LIMITS.rowName, '等级名称') : row.name;
    const nextColor = own(patch, 'color') ? color(patch.color) : row.color;
    row.name = nextName; row.color = nextColor;
    return state;
  }
  function addItem(state, options, target) {
    if (Object.keys(state.items).length >= LIMITS.items) fail('最多支持 ' + LIMITS.items + ' 个项目。');
    record(options, '新项目', ['name', 'image', 'art']);
    const itemId = makeId('item');
    const item = normalizeItem({ id: itemId, name: options.name, image: options.image, art: options.art }, itemId);
    checkImageBudget(state.items, item);
    const destination = listFor(state, target || 'pool');
    state.items[itemId] = item; destination.push(itemId);
    return itemId;
  }
  function updateItem(state, itemId, patch) {
    if (!own(state.items, itemId)) fail('项目不存在。');
    record(patch, '项目修改', ['name', 'image', 'art']);
    const item = normalizeItem(Object.assign({}, state.items[itemId], patch), itemId);
    checkImageBudget(state.items, item);
    state.items[itemId] = item;
    return state;
  }
  function removeItem(state, itemId) {
    const source = locateItem(state, itemId);
    listFor(state, source.target).splice(source.index, 1);
    delete state.items[itemId];
    return state;
  }
  function setTitle(state, value) { state.title = text(value, LIMITS.title, '排行标题'); return state; }
  return { LIMITS, FOOD_ART, createDefaultState, validateState, validateImage, inspectRaster, serialize, deserialize,
    moveItem, locateItem, addRow, deleteRow, reorderRow, updateRow, addItem, updateItem, removeItem, setTitle };
}));
