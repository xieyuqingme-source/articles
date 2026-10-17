(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FootprintsAvatar = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Only the bundled default image is fetched. User files stay in this page and
  // are redrawn into a small PNG, removing EXIF/text chunks and active formats.
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_DIMENSION = 8192;
  const MAX_PIXELS = 32000000;
  const OUTPUT_SIZE = 256;
  const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

  function invalid(message) { throw new Error(message); }
  function checkDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      invalid('图片尺寸无效，请换一张 PNG、JPEG 或 WebP 图片。');
    }
    if (width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
      invalid('图片尺寸过大：最长边须不超过 8192 像素，总像素不超过 3200 万。');
    }
    return { width, height };
  }
  function validateFile(file) {
    if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
      invalid('请选择一张有效的图片。');
    }
    if (file.size > MAX_BYTES) invalid('头像图片须不超过 5 MiB。');
    const type = String(file.type || '').toLowerCase();
    if (type && !MIME_TYPES.has(type)) invalid('仅支持 PNG、JPEG、WebP 图片，不支持 SVG、HTML 或 GIF。');
  }
  function ascii(bytes, offset, count) {
    return String.fromCharCode.apply(null, bytes.subarray(offset, offset + count));
  }
  function inspectImage(input, declaredType) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length || bytes.length > MAX_BYTES) invalid('头像图片无效或超过 5 MiB。');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let mime = '', width = 0, height = 0;
    if (bytes.length >= 24 && bytes[0] === 137 && ascii(bytes, 1, 3) === 'PNG' &&
        bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10 &&
        view.getUint32(8) === 13 && ascii(bytes, 12, 4) === 'IHDR') {
      mime = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
    } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
      let offset = 2;
      while (offset < bytes.length) {
        if (bytes[offset++] !== 255) break;
        while (offset < bytes.length && bytes[offset] === 255) offset++;
        if (offset >= bytes.length) break;
        const marker = bytes[offset++];
        if (marker === 0xd9 || marker === 0xda || marker === 0x00) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > bytes.length) break;
        const size = view.getUint16(offset);
        if (size < 2 || offset + size > bytes.length) break;
        if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
          if (size < 8) break;
          height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
          mime = 'image/jpeg'; break;
        }
        offset += size;
      }
    } else if (bytes.length >= 20 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' &&
        view.getUint32(4, true) + 8 <= bytes.length) {
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const chunk = ascii(bytes, offset, 4), size = view.getUint32(offset + 4, true), start = offset + 8;
        if (start + size > bytes.length) break;
        if (chunk === 'VP8X' && size >= 10) {
          if (bytes[start] & 2) invalid('暂不支持动态 WebP，请选择静态图片。');
          width = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
          height = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
          mime = 'image/webp'; break;
        }
        if (chunk === 'VP8L' && size >= 5 && bytes[start] === 0x2f) {
          width = 1 + bytes[start + 1] + ((bytes[start + 2] & 0x3f) << 8);
          height = 1 + (bytes[start + 2] >> 6) + (bytes[start + 3] << 2) + ((bytes[start + 4] & 15) << 10);
          mime = 'image/webp'; break;
        }
        if (chunk === 'VP8 ' && size >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 1 && bytes[start + 5] === 0x2a) {
          width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
          mime = 'image/webp'; break;
        }
        offset = start + size + (size % 2);
      }
    }
    if (!mime) invalid('图片内容无法识别，请使用有效的 PNG、JPEG 或 WebP，不能只修改扩展名。');
    const type = String(declaredType || '').toLowerCase();
    if (type && type !== mime) invalid('图片格式与文件类型不符，请重新导出为 PNG、JPEG 或 WebP。');
    return Object.assign({ mime }, checkDimensions(width, height));
  }

  function cancelled(signal) {
    if (signal && signal.aborted) {
      const error = new Error('头像选择已取消。'); error.name = 'AbortError'; throw error;
    }
  }
  function decodeBlob(blob, environment, signal) {
    return new Promise(function (resolve, reject) {
      try { cancelled(signal); } catch (error) { reject(error); return; }
      const image = new environment.Image();
      const url = environment.URL.createObjectURL(blob);
      const timeout = environment.setTimeout(function () { finish(new Error('图片加载超时，请换一张图片。')); }, 15000);
      let finished = false;
      function finish(error) {
        if (finished) return;
        finished = true;
        environment.clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', onAbort);
        image.onload = null; image.onerror = null;
        environment.URL.revokeObjectURL(url);
        if (error) { image.src = ''; reject(error); }
        else resolve(image);
      }
      image.onload = function () {
        try { checkDimensions(image.naturalWidth, image.naturalHeight); finish(); }
        catch (error) { finish(error); }
      };
      image.onerror = function () { finish(new Error('图片无法解码，请换一张 PNG、JPEG 或 WebP 图片。')); };
      function onAbort() { const error = new Error('头像选择已取消。'); error.name = 'AbortError'; finish(error); }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      image.src = url;
    });
  }
  async function sanitizeImage(file, environment, signal) {
    validateFile(file);
    const bytes = await file.arrayBuffer();
    cancelled(signal);
    inspectImage(bytes, file.type);
    const image = await decodeBlob(file, environment, signal);
    cancelled(signal);
    const canvas = environment.document.createElement('canvas');
    canvas.width = OUTPUT_SIZE; canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext('2d');
    if (!context) invalid('浏览器无法处理这张图片，请尝试重新选择。');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const scale = Math.min(OUTPUT_SIZE / image.naturalWidth, OUTPUT_SIZE / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (OUTPUT_SIZE - width) / 2, (OUTPUT_SIZE - height) / 2, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 1; canvas.height = 1;
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)) invalid('头像转换失败，请换一张图片。');
    return dataUrl;
  }

  function createController(options) {
    options = options || {};
    const environment = options.environment || globalThis;
    let version = 0, disposed = false, dataUrl = '', custom = false, cachedDefault = '', abort = null;
    function emit(name, value, extra) {
      if (!disposed && typeof options[name] === 'function') options[name](value, extra);
    }
    function state() { return { custom, label: custom ? '自定义头像（仅本次页面）' : '雨聊猫经典头像' }; }
    function begin() {
      version++;
      if (abort) { abort.abort(); abort = null; }
      abort = new environment.AbortController();
      emit('onBusy', true);
      return version;
    }
    function current(token) { return !disposed && token === version; }
    function commit(value, isCustom, token) {
      if (!current(token)) return false;
      dataUrl = value; custom = isCustom;
      emit('onChange', dataUrl, state());
      return true;
    }
    async function loadFile(file) {
      if (disposed) return false;
      const token = begin();
      try {
        const value = await sanitizeImage(file, environment, abort.signal);
        return commit(value, true, token);
      } catch (error) {
        if (current(token)) emit('onError', error.message || '头像处理失败，请重新选择。');
        return false;
      } finally { if (current(token)) { abort = null; emit('onBusy', false); } }
    }
    async function reset() {
      if (disposed) return false;
      const token = begin();
      try {
        if (!cachedDefault) {
          const url = new environment.URL(options.defaultUrl || '/assets/map-avatar-default.png', environment.document.baseURI);
          if (!['http:', 'https:'].includes(url.protocol) || url.origin !== environment.location.origin) {
            invalid('默认头像地址无效。');
          }
          const response = await environment.fetch(url.href, { credentials: 'same-origin', cache: 'force-cache', signal: abort.signal });
          if (!current(token)) return false;
          if (!response.ok) invalid('默认头像暂时无法加载，可以重试或选择自己的图片。');
          const size = Number(response.headers.get('content-length'));
          if (size > MAX_BYTES) invalid('默认头像文件过大，请稍后重试。');
          const file = await response.blob();
          if (!current(token)) return false;
          const value = await sanitizeImage(file, environment, abort.signal);
          if (!current(token)) return false;
          cachedDefault = value;
        }
        return commit(cachedDefault, false, token);
      } catch (error) {
        if (current(token)) emit('onError', error.name === 'AbortError' ? '默认头像加载已取消。' : (error.message || '默认头像暂时无法加载。'));
        return false;
      } finally { if (current(token)) { abort = null; emit('onBusy', false); } }
    }
    function download() {
      if (disposed || !dataUrl) { emit('onError', '头像尚未准备好，请稍后重试。'); return false; }
      const link = environment.document.createElement('a');
      link.href = dataUrl; link.download = custom ? '足迹地图-自定义头像.png' : '足迹地图-雨聊猫头像.png';
      environment.document.body.appendChild(link); link.click(); link.remove();
      return true;
    }
    function dispose() {
      if (disposed) return;
      disposed = true; version++;
      if (abort) abort.abort();
      abort = null; dataUrl = ''; cachedDefault = '';
    }
    const controller = { getDataUrl: function () { return dataUrl; }, getState: state, loadFile, reset, download, dispose };
    controller.ready = reset();
    return controller;
  }
  return { createController, inspectImage, validateFile, checkDimensions, MAX_BYTES, MAX_DIMENSION, MAX_PIXELS, OUTPUT_SIZE };
});
