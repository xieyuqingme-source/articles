/* Clean PNG renderer from validated state, without DOM screenshots or remote assets. */
(function (root, factory) {
  'use strict';
  const model = typeof module === 'object' && module.exports ? require('./ranking-model.js') : root.RankingModel;
  const api = factory(model);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RankingExport = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Model) {
  'use strict';
  const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  const MAX_PIXELS = 16000000;
  const MAX_SIDE = 16000;
  const SKINS = Object.freeze({
    classic: Object.freeze({ background: '#f7f5ee', row: '#f3f3f3', ink: '#171717', title: '#171717', border: '#262626', card: '#eeeeee' }),
    tech: Object.freeze({ background: '#f7f5ee', row: '#fffef9', ink: '#263b2d', title: '#244333', border: '#d4d9cd', card: '#e8ede3' })
  });
  const CLASSIC_DARK = Object.freeze({ background: '#000000', row: '#202020', ink: '#f1f1f1', title: '#f1f1f1', border: '#888888', card: '#303030' });
  function paletteFor(skin, theme) { return skin === 'classic' && theme === 'dark' ? CLASSIC_DARK : SKINS[skin]; }
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'grapheme' }) : null;
  function characters(text) { return segmenter ? Array.from(segmenter.segment(text), entry => entry.segment) : Array.from(text); }
  function approximation(text, size) { return characters(text).reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? size * 0.6 : size), 0); }
  function wrapText(text, maxWidth, size, measureText) {
    const measure = measureText || approximation;
    const lines = [];
    String(text).split('\n').forEach(paragraph => {
      let line = '';
      characters(paragraph).forEach(char => {
        if (line && measure(line + char, size) > maxWidth) { lines.push(line); line = char; }
        else line += char;
      });
      lines.push(line);
    });
    return lines;
  }
  /* measureText(text,fontSize,weight) must return a numeric width in logical pixels. */
  function planLayout(input, options) {
    options = options || {};
    const state = Model.validateState(input);
    const width = options.width === undefined ? 1200 : options.width;
    if (!Number.isFinite(width) || width < 640 || width > 2000) throw new Error('导出布局宽度须在 640–2000 像素之间。');
    const classic = state.skin === 'classic';
    const margin = classic ? 24 : 32;
    const boardWidth = width - margin * 2;
    const labelWidth = classic ? (width < 900 ? 96 : 112) : (width < 900 ? 124 : 152);
    const padding = classic ? 10 : 20;
    const gap = classic ? 10 : 16;
    const imageSize = classic ? 100 : 112;
    const cardWidth = imageSize;
    const nameSize = classic ? 16 : 18;
    const nameLineHeight = classic ? 22 : 26;
    const nameGap = classic ? 6 : 12;
    const minRowHeight = classic ? 144 : 156;
    const titleSize = classic ? 34 : 40;
    const titleLineHeight = classic ? 48 : 56;
    const titleLines = wrapText(state.title, boardWidth, titleSize, (text, size) =>
      (options.measureText || approximation)(text, size, '700'));
    const measure = (text, size) => (options.measureText || approximation)(text, size, '400');
    const title = { x: margin, y: margin, fontSize: titleSize, lineHeight: titleLineHeight, lines: titleLines };
    let cursorY = margin + titleLines.length * titleLineHeight + (classic ? 20 : 28);
    const contentWidth = boardWidth - labelWidth - padding * 2;
    const columns = Math.max(1, Math.floor((contentWidth + gap) / (cardWidth + gap)));
    const sourceRows = state.rows.slice();
    if (options.includePool && state.pool.length) sourceRows.push({ id: 'pool', name: '待选区', color: '#dce5d6', itemIds: state.pool });
    const rows = sourceRows.map(row => {
      const labelSize = classic ? 24 : 26;
      const labelLineHeight = classic ? 32 : 36;
      const labelLines = wrapText(row.name, labelWidth - (classic ? 20 : 28), labelSize, (text, size) =>
        (options.measureText || approximation)(text, size, '700'));
      const cards = [];
      let groupY = cursorY + padding;
      for (let first = 0; first < row.itemIds.length; first += columns) {
        const group = row.itemIds.slice(first, first + columns).map((itemId, index) => {
          const item = state.items[itemId];
          const lines = wrapText(item.name, cardWidth - 4, nameSize, measure);
          const height = imageSize + nameGap + lines.length * nameLineHeight;
          return { id: itemId, x: margin + labelWidth + padding + index * (cardWidth + gap), y: groupY,
            width: cardWidth, imageSize, height, lines, fontSize: nameSize, lineHeight: nameLineHeight, nameY: groupY + imageSize + nameGap };
        });
        const groupHeight = Math.max(...group.map(card => card.height));
        cards.push(...group);
        groupY += groupHeight + gap;
      }
      const contentHeight = cards.length ? groupY - gap - cursorY + padding : minRowHeight;
      const height = Math.ceil(Math.max(contentHeight, labelLines.length * labelLineHeight + padding * 2, minRowHeight));
      const layout = { id: row.id, name: row.name, color: row.color, x: margin, y: cursorY, width: boardWidth, height,
        labelWidth, labelLines, labelSize, labelLineHeight, cards };
      cursorY += height;
      return layout;
    });
    return { width, height: Math.ceil(cursorY + margin), margin, title, rows, columns, skin: state.skin };
  }
  function outputSize(layout, requestedScale) {
    const requested = requestedScale === undefined ? 2 : Number(requestedScale);
    if (!Number.isFinite(requested) || requested < 0.5 || requested > 4) throw new Error('导出清晰度须在 0.5–4 倍之间。');
    const scale = Math.min(requested, MAX_SIDE / layout.width, MAX_SIDE / layout.height,
      Math.sqrt(MAX_PIXELS / (layout.width * layout.height)));
    if (scale < 0.5) throw new Error('排行过长，无法在安全内存范围内导出清晰图片。请缩短名称或减少项目后重试。');
    return { width: Math.floor(layout.width * scale), height: Math.floor(layout.height * scale), scale,
      requestedScale: requested, adjusted: scale < requested - 0.001 };
  }
  function timeout(promise, milliseconds, message) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })])
      .finally(() => clearTimeout(timer));
  }
  async function loadImage(source, name, builtin) {
    const image = new Image();
    if (builtin) image.crossOrigin = 'anonymous';
    try {
      await timeout(new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error(builtin ? '“' + name + '”的内置照片无法读取，请刷新页面或检查本地资源后重试。' : '“' + name + '”的图片无法读取，请重新导入该图片。'));
        image.src = source;
      }), 10000, '“' + name + '”的图片读取超时，请重新导入后再试。');
      if (typeof image.decode === 'function') await timeout(image.decode(), 10000, '“' + name + '”的图片解码超时。');
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > Model.LIMITS.imageSide || image.naturalHeight > Model.LIMITS.imageSide)
        throw new Error('“' + name + '”的图片尺寸无效。');
      return image;
    } catch (error) {
      image.src = '';
      if (error && error.name === 'EncodingError') throw new Error('“' + name + '”的图片解码失败，请重新导入该图片。');
      throw error;
    }
    finally { image.onload = null; image.onerror = null; }
  }
  function roundedRect(context, x, y, width, height, radius, fill) {
    context.fillStyle = fill;
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(x, y, width, height, radius);
    else context.rect(x, y, width, height);
    context.fill();
  }
  function inkFor(hex) {
    const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const luminance = rgb.reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance > 0.57 ? '#26342c' : '#ffffff';
  }
  function drawLines(context, lines, x, y, size, lineHeight, color, alignment, weight) {
    context.font = (weight || '400') + ' ' + size + 'px ' + FONT;
    context.fillStyle = color;
    context.textAlign = alignment || 'left';
    context.textBaseline = 'top';
    lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  }
  async function exportRanking(input, options) {
    options = options || {};
    if (typeof document === 'undefined') throw new Error('PNG 导出需要支持 Canvas 的浏览器。');
    const state = Model.validateState(input);
    const classic = state.skin === 'classic';
    // Theme changes colour only. The data layout and resolution never depend on
    // screen zoom, fullscreen or viewport dimensions. Explicit theme wins.
    const theme = options.theme === 'dark' || options.theme === 'light' ? options.theme :
      document.documentElement && document.documentElement.dataset && document.documentElement.dataset.theme;
    const palette = paletteFor(state.skin, theme);
    if (document.fonts && document.fonts.ready)
      await timeout(document.fonts.ready, 10000, '等待字体超时，请稍后重试 PNG 导出。');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('此浏览器无法创建图片画布，请尝试更新浏览器或导出 JSON 备份。');
    try {
      const layout = planLayout(state, { includePool: !!options.includePool, measureText: (text, size, weight) => {
        context.font = weight + ' ' + size + 'px ' + FONT;
        return context.measureText(text).width;
      } });
      const dimensions = outputSize(layout, options.scale);
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.scale(dimensions.scale, dimensions.scale);
      context.fillStyle = palette.background;
      context.fillRect(0, 0, layout.width, layout.height);
      drawLines(context, layout.title.lines, layout.title.x, layout.title.y, layout.title.fontSize,
        layout.title.lineHeight, palette.title, 'left', '700');
      for (const row of layout.rows) {
        context.fillStyle = palette.row; context.fillRect(row.x, row.y, row.width, row.height);
        context.fillStyle = row.color; context.fillRect(row.x, row.y, row.labelWidth, row.height);
        drawLines(context, row.labelLines, row.x + row.labelWidth / 2,
          row.y + (row.height - row.labelLines.length * row.labelLineHeight) / 2,
          row.labelSize, row.labelLineHeight, classic && inkFor(row.color) !== '#ffffff' ? SKINS.classic.ink : inkFor(row.color), 'center', '700');
        for (const card of row.cards) {
          const item = state.items[card.id];
          const art = item.art ? (Model.BUILTIN_ART || Model.FOOD_ART)[item.art] : null;
          if (!classic) roundedRect(context, card.x, card.y, card.imageSize, card.imageSize, 10, art ? art.bg : palette.card);
          if (item.image) {
            const image = await loadImage(item.image, item.name);
            try {
              if (item.crop) {
                const { x, y, size } = item.crop;
                context.drawImage(image, x, y, size, size, card.x, card.y, card.imageSize, card.imageSize);
              } else {
                const factor = Math.min(card.imageSize / image.naturalWidth, card.imageSize / image.naturalHeight);
                const width = image.naturalWidth * factor;
                const height = image.naturalHeight * factor;
                context.drawImage(image, card.x + (card.imageSize - width) / 2, card.y + (card.imageSize - height) / 2, width, height);
              }
            } finally { image.src = ''; }
          } else if (art && art.photo) {
            /* Only the model's deeply frozen local map can provide this path. */
            const image = await loadImage(art.photo, item.name, true);
            try {
              const size = Math.min(image.naturalWidth, image.naturalHeight);
              context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2,
                size, size, card.x, card.y, card.imageSize, card.imageSize);
            } finally { image.src = ''; }
          } else if (art) {
            context.font = '64px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
            context.fillStyle = '#26342c'; context.textAlign = 'center'; context.textBaseline = 'middle';
            context.fillText(art.emoji, card.x + card.imageSize / 2, card.y + card.imageSize / 2 + 2);
          } else {
            drawLines(context, [characters(item.name).slice(0, 2).join('')], card.x + card.imageSize / 2,
              card.y + card.imageSize / 2 - 20, 32, 40, state.skin === 'classic' ? palette.ink : '#45634e', 'center', '700');
          }
          drawLines(context, card.lines, card.x + card.width / 2, card.nameY, card.fontSize, card.lineHeight, palette.ink, 'center');
        }
        if (!classic) {
          context.strokeStyle = palette.border; context.lineWidth = 1;
          context.strokeRect(row.x, row.y, row.width, row.height);
        }
      }
      if (classic) {
        const first = layout.rows[0];
        const last = layout.rows[layout.rows.length - 1];
        const bottom = last.y + last.height;
        context.strokeStyle = palette.border;
        context.lineWidth = 2;
        context.lineJoin = 'miter';
        context.strokeRect(first.x, first.y, first.width, bottom - first.y);
        context.beginPath();
        context.moveTo(first.x + first.labelWidth, first.y);
        context.lineTo(first.x + first.labelWidth, bottom);
        layout.rows.slice(1).forEach(row => {
          context.moveTo(row.x, row.y);
          context.lineTo(row.x + row.width, row.y);
        });
        context.stroke();
      }
      const blob = await timeout(new Promise((resolve, reject) => {
        try { canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG 编码失败，请降低清晰度后重试。')), 'image/png'); }
        catch (_) { reject(new Error('PNG 导出失败，图片可能无法被浏览器读取。请重新导入图片或导出 JSON 备份。')); }
      }), 15000, 'PNG 编码超时，请降低清晰度或减少项目后重试。');
      return Object.assign({ blob }, dimensions);
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  return { planLayout, outputSize, wrapText, exportRanking, MAX_PIXELS, MAX_SIDE, SKINS, CLASSIC_DARK, paletteFor };
}));
