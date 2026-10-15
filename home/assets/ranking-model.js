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
    hotpot: Object.freeze({ name: '火锅', emoji: '🍲', bg: '#f9e2d4', photo: '/assets/foods/hotpot.webp' }),
    dumpling: Object.freeze({ name: '饺子', emoji: '🥟', bg: '#f7eed8', photo: '/assets/foods/dumpling.webp' }),
    noodles: Object.freeze({ name: '面条', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/noodles.webp' }),
    sushi: Object.freeze({ name: '寿司', emoji: '🍣', bg: '#f5e3e3', photo: '/assets/foods/sushi.webp' }),
    burger: Object.freeze({ name: '汉堡', emoji: '🍔', bg: '#f6e6c7', photo: '/assets/foods/burger.webp' }),
    pizza: Object.freeze({ name: '披萨', emoji: '🍕', bg: '#f8e0c8', photo: '/assets/foods/pizza.webp' }),
    chicken: Object.freeze({ name: '炸鸡', emoji: '🍗', bg: '#f3ddc4', photo: '/assets/foods/chicken.webp' }),
    tea: Object.freeze({ name: '奶茶', emoji: '🧋', bg: '#e6ddcf', photo: '/assets/foods/tea.webp' }),
    watermelon: Object.freeze({ name: '西瓜', emoji: '🍉', bg: '#e4eed7', photo: '/assets/foods/watermelon.webp' }),
    cake: Object.freeze({ name: '蛋糕', emoji: '🍰', bg: '#f3dfdf', photo: '/assets/foods/cake.webp' }),
    'mianyang-rice-noodles': Object.freeze({ name: '绵阳米粉', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/mianyang-rice-noodles.webp' }),
    'jiaxing-zongzi': Object.freeze({ name: '嘉兴粽子', emoji: '🍙', bg: '#e5ecd7', photo: '/assets/foods/jiaxing-zongzi.webp' }),
    houttuynia: Object.freeze({ name: '折耳根', emoji: '🌿', bg: '#e5ecd7', photo: '/assets/foods/houttuynia.webp' }),
    'frozen-dumplings': Object.freeze({ name: '速冻水饺', emoji: '🥟', bg: '#f7eed8', photo: '/assets/foods/frozen-dumplings.webp' }),
    douzhi: Object.freeze({ name: '豆汁', emoji: '🥣', bg: '#e6ddcf', photo: '/assets/foods/douzhi.webp' }),
    durian: Object.freeze({ name: '榴莲', emoji: '🥭', bg: '#f7eed8', photo: '/assets/foods/durian.webp' }),
    'loofah-noodles': Object.freeze({ name: '丝瓜面', emoji: '🍜', bg: '#e5ecd7', photo: '/assets/foods/loofah-noodles.webp' }),
    mooncake: Object.freeze({ name: '月饼', emoji: '🥮', bg: '#f6e6c7', photo: '/assets/foods/mooncake.webp' }),
    'pea-mince-noodles': Object.freeze({ name: '豌杂面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/pea-mince-noodles.webp' }),
    'handmade-dumplings': Object.freeze({ name: '手工水饺', emoji: '🥟', bg: '#f7eed8', photo: '/assets/foods/handmade-dumplings.webp' }),
    'japanese-ramen': Object.freeze({ name: '日本拉面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/japanese-ramen.webp' }),
    'egg-noodles': Object.freeze({ name: '鸡蛋挂面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/egg-noodles.webp' }),
    'bak-kut-teh': Object.freeze({ name: '肉骨茶', emoji: '🍲', bg: '#f9e2d4', photo: '/assets/foods/bak-kut-teh.webp' }),
    'dongpo-pork': Object.freeze({ name: '东坡肉', emoji: '🍖', bg: '#f3ddc4', photo: '/assets/foods/dongpo-pork.webp' }),
    'sea-intestine-rice': Object.freeze({ name: '海肠捞饭', emoji: '🍚', bg: '#f7eed8', photo: '/assets/foods/sea-intestine-rice.webp' }),
    'eight-treasure-tofu': Object.freeze({ name: '八珍豆腐', emoji: '🥘', bg: '#f7eed8', photo: '/assets/foods/eight-treasure-tofu.webp' }),
    'vietnamese-chicken-noodles': Object.freeze({ name: '越南鸡丝米粉', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/vietnamese-chicken-noodles.webp' }),
    'pad-krapow-rice': Object.freeze({ name: '打抛饭', emoji: '🍛', bg: '#f7eed8', photo: '/assets/foods/pad-krapow-rice.webp' }),
    'egg-tart': Object.freeze({ name: '蛋挞', emoji: '🥧', bg: '#f6e6c7', photo: '/assets/foods/egg-tart.webp' }),
    barbecue: Object.freeze({ name: '烧烤', emoji: '🍢', bg: '#f3ddc4', photo: '/assets/foods/barbecue.webp' }),
    'lamb-shumai': Object.freeze({ name: '羊肉烧麦', emoji: '🥟', bg: '#f7eed8', photo: '/assets/foods/lamb-shumai.webp' }),
    'zhejiang-dry-noodles': Object.freeze({ name: '（浙江）干挑面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/zhejiang-dry-noodles.webp' }),
    bread: Object.freeze({ name: '面包', emoji: '🍞', bg: '#f6e6c7', photo: '/assets/foods/bread.webp' }),
    'lanzhou-noodles': Object.freeze({ name: '兰州拉面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/lanzhou-noodles.webp' }),
    'beijing-zhajiang-noodles': Object.freeze({ name: '北京杂酱面', emoji: '🍜', bg: '#f4e6cf', photo: '/assets/foods/beijing-zhajiang-noodles.webp' }),
    'west-lake-vinegar-fish': Object.freeze({ name: '西湖醋鱼', emoji: '🐟', bg: '#f9e2d4', photo: '/assets/foods/west-lake-vinegar-fish.webp' }),
    'donkey-burger': Object.freeze({ name: '驴肉火烧', emoji: '🥙', bg: '#f6e6c7', photo: '/assets/foods/donkey-burger.webp' }),
    'smoked-pork-flatbread': Object.freeze({ name: '熏肉大饼', emoji: '🥙', bg: '#f6e6c7', photo: '/assets/foods/smoked-pork-flatbread.webp' }),
    'sichuan-hotpot': Object.freeze({ name: '四川火锅', emoji: '🍲', bg: '#f9e2d4', photo: '/assets/foods/sichuan-hotpot.webp' })
  });
  const SPORT_ART = Object.freeze({
    walking: Object.freeze({ name: '散步', emoji: '🚶', bg: '#e5ecd7', photo: '/assets/sports/walking.webp' }),
    hiking: Object.freeze({ name: '登山', emoji: '🥾', bg: '#e5ecd7', photo: '/assets/sports/hiking.webp' }),
    running: Object.freeze({ name: '跑步', emoji: '🏃', bg: '#e5ecd7', photo: '/assets/sports/running.webp' }),
    'weight-training': Object.freeze({ name: '撸铁', emoji: '🏋️', bg: '#e5ecd7', photo: '/assets/sports/weight-training.webp' }),
    swimming: Object.freeze({ name: '游泳', emoji: '🏊', bg: '#dcebef', photo: '/assets/sports/swimming.webp' }),
    badminton: Object.freeze({ name: '羽毛球', emoji: '🏸', bg: '#e5ecd7', photo: '/assets/sports/badminton.webp' }),
    cycling: Object.freeze({ name: '自行车', emoji: '🚴', bg: '#e5ecd7', photo: '/assets/sports/cycling.webp' }),
    football: Object.freeze({ name: '足球', emoji: '⚽', bg: '#e5ecd7', photo: '/assets/sports/football.webp' }),
    tennis: Object.freeze({ name: '网球', emoji: '🎾', bg: '#e5ecd7', photo: '/assets/sports/tennis.webp' }),
    'table-tennis': Object.freeze({ name: '乒乓球', emoji: '🏓', bg: '#e5ecd7', photo: '/assets/sports/table-tennis.webp' }),
    'combat-training': Object.freeze({ name: '搏斗', emoji: '🥊', bg: '#e5ecd7', photo: '/assets/sports/combat-training.webp' }),
    'tree-climbing': Object.freeze({ name: '爬树', emoji: '🌳', bg: '#e5ecd7', photo: '/assets/sports/tree-climbing.webp' }),
    skydiving: Object.freeze({ name: '跳伞', emoji: '🪂', bg: '#dcebef', photo: '/assets/sports/skydiving.webp' }),
    'rock-climbing': Object.freeze({ name: '攀岩', emoji: '🧗', bg: '#e5ecd7', photo: '/assets/sports/rock-climbing.webp' }),
    diving: Object.freeze({ name: '潜水', emoji: '🤿', bg: '#dcebef', photo: '/assets/sports/diving.webp' }),
    golf: Object.freeze({ name: '高尔夫', emoji: '⛳', bg: '#e5ecd7', photo: '/assets/sports/golf.webp' }),
    gaming: Object.freeze({ name: '打游戏', emoji: '🎮', bg: '#e8e3f3', photo: '/assets/sports/gaming.webp' })
  });
  const BUILTIN_ART = Object.freeze(Object.assign({}, FOOD_ART, SPORT_ART));
  function defineTemplate(id, label, defaultTitle, itemPrefix, groups) {
    const levels = [['夯', '#f28b82'], ['顶级', '#f6b26b'], ['人上人', '#f9d976'], ['NPC', '#e8e5a0'], ['拉完了', '#a8cf9a']];
    return Object.freeze({ id, label, defaultTitle, itemPrefix, rows: Object.freeze(levels.map((level, index) => Object.freeze({
      id: 'row-' + index, name: level[0], color: level[1], artKeys: Object.freeze(groups[index].slice())
    }))) });
  }
  const TEMPLATES = Object.freeze({
    food: defineTemplate('food', '美食排行', '美食从夯到拉', 'food', [
      ['sichuan-hotpot', 'mianyang-rice-noodles', 'jiaxing-zongzi', 'dongpo-pork', 'sea-intestine-rice', 'eight-treasure-tofu', 'zhejiang-dry-noodles'],
      ['pea-mince-noodles', 'handmade-dumplings', 'burger', 'japanese-ramen', 'vietnamese-chicken-noodles', 'pad-krapow-rice', 'lamb-shumai', 'donkey-burger', 'smoked-pork-flatbread'],
      ['chicken', 'houttuynia', 'frozen-dumplings', 'egg-noodles', 'barbecue'],
      ['sushi', 'douzhi', 'bak-kut-teh', 'beijing-zhajiang-noodles', 'west-lake-vinegar-fish'],
      ['pizza', 'cake', 'tea', 'loofah-noodles', 'mooncake', 'egg-tart', 'bread', 'lanzhou-noodles']
    ]),
    sport: defineTemplate('sport', '运动排行', '运动从夯到拉', 'sport', [
      ['walking', 'hiking', 'tree-climbing', 'gaming'], ['running', 'weight-training', 'combat-training'],
      ['swimming', 'badminton', 'cycling'], ['table-tennis'], ['football', 'tennis', 'skydiving', 'rock-climbing', 'diving', 'golf']
    ])
  });
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  /* Weak keys let old image data be collected after an item is replaced or cleared. */
  const itemImages = new WeakMap();
  let counter = 0;
  function fail(message) { throw new Error(message); }
  function templateFor(templateId) {
    if (typeof templateId !== 'string' || !own(TEMPLATES, templateId)) fail('未知的排行模板，请选择美食排行或运动排行。');
    return TEMPLATES[templateId];
  }
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
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(encoded, 'base64'));
    if (typeof atob === 'function') {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      return bytes;
    }
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
  function tiffOrientation(bytes, start, length) {
    const end = start + length;
    if (length < 8 || start < 0 || end > bytes.length) return 1;
    const little = bytes[start] === 73 && bytes[start + 1] === 73;
    const big = bytes[start] === 77 && bytes[start + 1] === 77;
    if (!little && !big) return 1;
    const within = (offset, size) => Number.isInteger(offset) && offset >= start && offset <= end - size;
    const short = offset => within(offset, 2) ? (little ? bytes[offset] + bytes[offset + 1] * 256 : bytes[offset] * 256 + bytes[offset + 1]) : null;
    const long = offset => within(offset, 4) ? (little ?
      bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536 + bytes[offset + 3] * 16777216 : u32(bytes, offset)) : null;
    if (short(start + 2) !== 42) return 1;
    const relative = long(start + 4);
    if (relative === null || relative < 8) return 1;
    const directory = start + relative;
    const count = short(directory);
    if (count === null) return 1;
    for (let index = 0; index < count; index++) {
      const entry = directory + 2 + index * 12;
      if (!within(entry, 12)) break;
      if (short(entry) === 274 && short(entry + 2) === 3 && long(entry + 4) === 1) {
        const orientation = short(entry + 8);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    return 1;
  }
  function imageOrientation(bytes, mime) {
    const word = offset => String.fromCharCode(...bytes.slice(offset, offset + 4));
    const exif = (start, length) => {
      if (length >= 6 && String.fromCharCode(...bytes.slice(start, start + 6)) === 'Exif\0\0') return tiffOrientation(bytes, start + 6, length - 6);
      return tiffOrientation(bytes, start, length);
    };
    if (mime === 'jpeg') {
      let offset = 2;
      while (offset + 3 < bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (offset < bytes.length && bytes[offset] === 255) offset++;
        const marker = bytes[offset++];
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
        if (offset + 2 > bytes.length) break;
        const length = bytes[offset] * 256 + bytes[offset + 1];
        if (length < 2 || offset + length > bytes.length) break;
        if (marker === 225 && length >= 8 && String.fromCharCode(...bytes.slice(offset + 2, offset + 8)) === 'Exif\0\0')
          return exif(offset + 2, length - 2);
        offset += length;
      }
    } else if (mime === 'png') {
      let offset = 8;
      while (offset + 12 <= bytes.length) {
        const length = u32(bytes, offset);
        if (length > bytes.length - offset - 12) break;
        if (word(offset + 4) === 'eXIf') return exif(offset + 8, length);
        if (word(offset + 4) === 'IEND') break;
        offset += length + 12;
      }
    } else if (mime === 'webp') {
      let offset = 12;
      const declared = bytes[4] + bytes[5] * 256 + bytes[6] * 65536 + bytes[7] * 16777216 + 8;
      const end = Math.min(bytes.length, declared);
      while (offset + 8 <= end) {
        const length = bytes[offset + 4] + bytes[offset + 5] * 256 + bytes[offset + 6] * 65536 + bytes[offset + 7] * 16777216;
        if (length > end - offset - 8) break;
        if (word(offset) === 'EXIF') return exif(offset + 8, length);
        offset += 8 + length + (length % 2);
      }
    }
    return 1;
  }
  function readImage(value) {
    if (value === null || value === undefined) return { image: null, bytes: 0, width: 0, height: 0 };
    if (typeof value !== 'string' || value.length > Math.ceil(LIMITS.imageBytes / 3) * 4 + 50) fail('单张图片数据不能超过 1 MB，请先缩小图片。');
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) fail('仅接受本地 PNG、JPEG 或 WebP 图片数据，不能使用 SVG 或外链。');
    const bytes = bytesFromBase64(match[2]);
    if (bytes.length > LIMITS.imageBytes) fail('单张图片数据不能超过 1 MB，请先缩小图片。');
    const size = rasterSize(bytes, match[1]);
    if (!size[0] || !size[1] || size[0] > LIMITS.imageSide || size[1] > LIMITS.imageSide || size[0] * size[1] > LIMITS.imagePixels)
      fail('图片尺寸过大或无效，请缩小到 4096 × 4096 像素以内。');
    const orientation = imageOrientation(bytes, match[1]);
    return { image: value, bytes: bytes.length, width: orientation >= 5 ? size[1] : size[0], height: orientation >= 5 ? size[0] : size[1] };
  }
  function validateImage(value) { return readImage(value).image; }
  /* Display-oriented dimensions (EXIF included), matching Image.naturalWidth/Height. */
  function imageDimensions(value) {
    const info = readImage(value);
    if (!info.image) fail('读取尺寸需要一张有效图片。');
    return { width: info.width, height: info.height };
  }
  function centerCrop(value) {
    const info = readImage(value);
    if (!info.image) fail('裁切需要一张有效图片。');
    const { width, height } = info;
    const size = Math.min(width, height);
    return { x: (width - size) / 2, y: (height - size) / 2, size };
  }
  function normalizeCrop(value, info) {
    if (value === undefined || value === null) return null;
    if (!info.image) fail('没有图片的项目不能设置裁切范围。');
    record(value, '裁切范围', ['x', 'y', 'size']);
    const { x, y, size } = value;
    if (![x, y, size].every(Number.isFinite) || x < 0 || y < 0 || size < 1)
      fail('裁切坐标须为有限数值，起点不能为负，正方形边长至少为 1 像素。');
    const { width, height } = info;
    if (x + size > width || y + size > height) fail('裁切范围不能超出原图边界。');
    return { x, y, size };
  }
  function skinName(value) {
    if (value !== 'classic' && value !== 'tech') fail('不支持此排行皮肤，请选择经典或科技。');
    return value;
  }
  function checkImageBudget(items, replacement) {
    let bytes = 0;
    let pixels = 0;
    const add = entry => {
      let info = itemImages.get(entry);
      if (!info || info.image !== (entry.image == null ? null : entry.image)) { info = readImage(entry.image); itemImages.set(entry, info); }
      bytes += info.bytes;
      pixels += info.width * info.height;
    };
    if (replacement) add(replacement);
    Object.values(items).forEach(entry => { if (!replacement || entry.id !== replacement.id) add(entry); });
    if (bytes > LIMITS.totalImageBytes) fail('所有图片合计不能超过 20 MB，请减少或缩小图片。');
    if (pixels > LIMITS.totalImagePixels) fail('图片解码总量超过 6400 万像素，请缩小图片后导入，以免浏览器内存不足。');
  }
  function normalizeItem(value, itemId, legacy) {
    record(value, '项目', legacy ? ['id', 'name', 'image', 'art'] : ['id', 'name', 'image', 'art', 'crop']);
    if (id(value.id, '项目标识') !== itemId) fail('项目标识与索引不一致。');
    const art = value.art == null ? null : value.art;
    if (art !== null && (typeof art !== 'string' || !own(BUILTIN_ART, art))) fail('未知的示例插画。');
    let info = itemImages.get(value);
    if (!info || info.image !== (value.image == null ? null : value.image)) { info = readImage(value.image); itemImages.set(value, info); }
    const image = info.image;
    if (image && art) fail('项目不能同时含自定义图片和示例插画。');
    const crop = legacy ? null : normalizeCrop(value.crop, info);
    const normalized = { id: itemId, name: text(value.name, LIMITS.name, '项目名称'), image, art, crop };
    itemImages.set(normalized, info);
    return normalized;
  }
  function validateState(value) {
    record(value, '排行');
    if (![1, 2, 3].includes(value.version)) fail('不支持此备份版本。');
    const legacy = value.version === 1;
    record(value, '排行', legacy ? ['version', 'title', 'rows', 'pool', 'items'] :
      value.version === 2 ? ['version', 'title', 'skin', 'rows', 'pool', 'items'] : ['version', 'templateId', 'title', 'skin', 'rows', 'pool', 'items']);
    const templateId = value.version === 3 ? templateFor(value.templateId).id : 'food';
    const skin = legacy ? 'classic' : skinName(value.skin);
    if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > LIMITS.rows) fail('排行须含 1–' + LIMITS.rows + ' 个等级。');
    record(value.items, '项目索引');
    const itemKeys = Object.keys(value.items);
    if (itemKeys.length > LIMITS.items) fail('项目不能超过 ' + LIMITS.items + ' 个。');
    const items = {};
    itemKeys.forEach(key => {
      id(key, '项目标识');
      items[key] = normalizeItem(value.items[key], key, legacy);
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
    return { version: 3, templateId, title: text(value.title, LIMITS.title, '排行标题'), skin, rows, pool, items };
  }
  function serialize(state) { return JSON.stringify(validateState(state), null, 2); }
  function deserialize(json) {
    if (typeof json !== 'string' || json.length > LIMITS.jsonBytes) fail('备份文件过大，最多支持 30 MB。');
    let value;
    try { value = JSON.parse(json); } catch (_) { fail('备份不是有效的 JSON 文件。'); }
    return validateState(value);
  }
  function createDefaultState(templateId = 'food') {
    const template = templateFor(templateId);
    const state = { version: 3, templateId: template.id, title: template.defaultTitle, skin: 'classic', rows: template.rows.map(row => ({
      id: row.id, name: row.name, color: row.color, itemIds: row.artKeys.map(key => template.itemPrefix + '-' + key)
    })), pool: [], items: {} };
    template.rows.forEach(row => row.artKeys.forEach(key => {
      const itemId = template.itemPrefix + '-' + key;
      state.items[itemId] = { id: itemId, name: BUILTIN_ART[key].name, image: null, art: key, crop: null };
    }));
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
    record(options, '新项目', ['name', 'image', 'art', 'crop']);
    const itemId = makeId('item');
    const item = normalizeItem({ id: itemId, name: options.name, image: options.image, art: options.art, crop: options.crop }, itemId);
    checkImageBudget(state.items, item);
    const destination = listFor(state, target || 'pool');
    state.items[itemId] = item; destination.push(itemId);
    return itemId;
  }
  function updateItem(state, itemId, patch) {
    if (!own(state.items, itemId)) fail('项目不存在。');
    record(patch, '项目修改', ['name', 'image', 'art', 'crop']);
    if (own(patch, 'image') && patch.image !== state.items[itemId].image && (!own(patch, 'crop') || patch.crop === undefined))
      fail('替换图片时须明确指定裁切范围；保留整图请设置 crop 为 null。');
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
  function setSkin(state, value) { state.skin = skinName(value); return state; }
  function clearItems(state) {
    state.rows.forEach(row => { row.itemIds = []; });
    state.pool = [];
    state.items = {};
    return state;
  }
  return { LIMITS, FOOD_ART, SPORT_ART, BUILTIN_ART, TEMPLATES, createDefaultState, validateState, validateImage, inspectRaster, imageDimensions, centerCrop, serialize, deserialize,
    moveItem, locateItem, addRow, deleteRow, reorderRow, updateRow, addItem, updateItem, removeItem, setTitle, setSkin, clearItems };
}));
