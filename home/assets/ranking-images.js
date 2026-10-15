/* Original, dependency-free local image preparation and non-destructive square crop editor. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ranking-model.js'));
  else root.RankingImages = factory(root.RankingModel);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const SOURCE_BYTES = 10 * 1024 * 1024, SOURCE_PIXELS = 32000000, SOURCE_SIDE = 12000;
  const SAVED_SIDE = 1024, LOAD_TIMEOUT = 12000;
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const copyCrop = crop => crop ? { x: crop.x, y: crop.y, size: crop.size } : null;
  function builtinPhotoPath(art, builtinArt = M && (M.BUILTIN_ART || M.FOOD_ART)) {
    const entry = builtinArt && Object.prototype.hasOwnProperty.call(builtinArt, art) && builtinArt[art];
    if (!entry || !entry.photo) return null;
    // This allowlist is independent of the item and cannot turn imported data into a URL fetch.
    const validName = /^[a-z][a-z0-9-]*$/.test(art);
    const allowed = validName ? ['/assets/foods/' + art + '.webp', '/assets/sports/' + art + '.webp'] : [];
    if (!allowed.includes(entry.photo)) throw new Error('内置图片路径无效，请刷新页面或选择本地图片。');
    return entry.photo;
  }
  function cancelled(signal) {
    if (signal && signal.aborted) {
      const error = new Error('图片读取已取消。'); error.name = 'AbortError'; throw error;
    }
  }
  async function builtinPhotoFile(path, signal) {
    cancelled(signal);
    const response = await fetch(path, { mode: 'same-origin', credentials: 'same-origin', redirect: 'error', cache: 'force-cache', signal });
    if (!response.ok) throw new Error('内置图片读取失败（HTTP ' + response.status + '），请刷新页面重试或选择本地图片。');
    if (Number(response.headers.get('content-length')) > SOURCE_BYTES) throw new Error('内置图片超过 10 MB，无法编辑。');
    const blob = await response.blob(); cancelled(signal);
    if (!blob.size || blob.size > SOURCE_BYTES) throw new Error('内置图片为空或超过 10 MB，无法编辑。');
    // The asset extension is fixed, while inspectRaster still verifies the actual WebP bytes.
    return new File([blob], path.slice(path.lastIndexOf('/') + 1), { type: 'image/webp' });
  }
  function centeredCrop(width, height) {
    const size = Math.min(width, height);
    return { x: (width - size) / 2, y: (height - size) / 2, size };
  }
  function boundedCrop(width, height, crop) {
    const size = clamp(crop.size, 1, Math.min(width, height));
    return { x: clamp(crop.x, 0, width - size), y: clamp(crop.y, 0, height - size), size };
  }
  function zoomCrop(width, height, crop, zoom) {
    const current = crop || centeredCrop(width, height);
    const size = clamp(Math.min(width, height) / clamp(zoom, 1, 4), 1, Math.min(width, height));
    return boundedCrop(width, height, { x: current.x + (current.size - size) / 2, y: current.y + (current.size - size) / 2, size });
  }
  function translatedCrop(width, height, crop, dx, dy) {
    return boundedCrop(width, height, { x: crop.x + dx, y: crop.y + dy, size: crop.size });
  }
  function imageResource(source, signal) {
    const image = new Image();
    let timer, settled = false, disposed = false, rejectLoad;
    const ready = new Promise((resolve, reject) => {
      rejectLoad = reject;
      const finish = error => {
        if (settled || disposed) return;
        settled = true; clearTimeout(timer); image.onload = null; image.onerror = null;
        if (error) reject(error); else resolve(image);
      };
      timer = setTimeout(() => finish(new Error('图片读取超时，请换一张图片。')), LOAD_TIMEOUT);
      image.onerror = () => finish(new Error('图片损坏或浏览器无法读取，请使用 PNG、JPEG 或静态 WebP。'));
      image.onload = async () => {
        try {
          if (typeof image.decode === 'function') await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。');
          finish();
        } catch (_) { finish(new Error('图片解码失败，请换一张图片。')); }
      };
      image.decoding = 'async'; image.src = source;
    });
    function dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer); image.onload = null; image.onerror = null;
      if (signal) signal.removeEventListener('abort', dispose);
      if (!settled) { settled = true; rejectLoad(new Error('图片读取已取消。')); }
      image.src = '';
    }
    if (signal) {
      if (signal.aborted) dispose();
      else signal.addEventListener('abort', dispose, { once: true });
    }
    return { image, ready, dispose };
  }
  async function prepareFile(file, options = {}) {
    const signal = options.signal;
    cancelled(signal);
    if (!M) throw new Error('图片校验模块未加载，请刷新页面。');
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw new Error('只支持 PNG、JPG、静态 WebP，不接收 SVG 或其他文件。');
    if (!file.size || file.size > SOURCE_BYTES) throw new Error('图片须大于 0 且不超过 10 MB，请先缩小原图。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    cancelled(signal);
    const header = M.inspectRaster(bytes, file.type);
    if (header.width > SOURCE_SIDE || header.height > SOURCE_SIDE || header.width * header.height > SOURCE_PIXELS)
      throw new Error('原图尺寸过大，请缩小到 3200 万像素以内，且单边不超过 12000 像素。');
    const url = URL.createObjectURL(file), resource = imageResource(url, signal);
    const canvas = document.createElement('canvas');
    try {
      cancelled(signal);
      const image = await resource.ready;
      cancelled(signal);
      if (image.naturalWidth > SOURCE_SIDE || image.naturalHeight > SOURCE_SIDE || image.naturalWidth * image.naturalHeight > SOURCE_PIXELS)
        throw new Error('解码后的图片尺寸过大，请先缩小原图。');
      const factor = Math.min(1, SAVED_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('浏览器无法处理图片，请换一个浏览器重试。');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let data;
      for (const quality of [.88, .78, .66]) {
        data = canvas.toDataURL('image/webp', quality);
        if (!data.startsWith('data:image/webp;')) {
          // Keep alpha when a browser has no WebP encoder; flatten only if its PNG is too large.
          data = canvas.toDataURL('image/png');
          if (data.length > Math.ceil(M.LIMITS.imageBytes / 3) * 4 + 50) {
            context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL('image/jpeg', quality);
          }
        }
        try {
          M.validateImage(data);
          return { image: data, crop: centeredCrop(canvas.width, canvas.height) };
        } catch (error) {
          if (quality === .66) throw new Error('压缩后的图片仍超过 1 MB，请先缩小或简化原图。');
        }
      }
      throw new Error('图片处理失败，请换一张图片。');
    } finally {
      resource.dispose(); URL.revokeObjectURL(url); canvas.width = 1; canvas.height = 1;
    }
  }
  function createEditor(options) {
    const { canvas, zoomInput, zoomValue, status, resetButton, replaceInput, removeButton } = options;
    if (!canvas || !zoomInput || !status || !resetButton || !replaceInput || !removeButton)
      throw new Error('图片编辑器缺少必要控件。');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法打开图片编辑器。');
    let active = false, busy = false, session = 0, resource = null, pendingResource = null, loadController = null, width = 0, height = 0, pointer = null;
    let draft = { image: null, crop: null, art: null }, itemName = '';
    const call = (name, value) => { if (typeof options[name] === 'function') options[name](value); };
    canvas.width = 640; canvas.height = 640; canvas.style.touchAction = 'none'; canvas.tabIndex = 0;
    canvas.setAttribute('aria-label', '图片裁切预览：拖动图片定位，方向键微调，Shift 加速；使用缩放滑块放大。');
    zoomInput.min = '1'; zoomInput.max = '4'; zoomInput.step = '0.01'; zoomInput.value = '1';
    replaceInput.accept = 'image/png,image/jpeg,image/webp';
    function controls() {
      zoomInput.disabled = !active || busy || !resource;
      resetButton.disabled = !active || busy || !resource;
      removeButton.disabled = !active || busy || (!draft.image && !draft.art);
      replaceInput.disabled = !active || busy;
      canvas.setAttribute('aria-busy', String(busy));
    }
    function setBusy(value) { busy = value; call('onBusy', value); controls(); }
    function statusText(text, error) { status.textContent = text; status.dataset.error = String(!!error); }
    function report(error) { statusText(error.message || '图片处理失败，请重试。', true); call('onError', error); }
    function release() { if (resource) resource.dispose(); resource = null; width = 0; height = 0; }
    function cancelPointer() {
      if (pointer) {
        try { if (canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id); } catch (_) { /* A removed canvas may have lost capture. */ }
      }
      pointer = null;
    }
    function draw() {
      const side = canvas.width;
      context.clearRect(0, 0, side, side);
      context.fillStyle = '#e8eae7'; context.fillRect(0, 0, side, side);
      context.fillStyle = '#f8f9f7';
      for (let y = 0; y < side; y += 32) for (let x = 0; x < side; x += 32) if ((x / 32 + y / 32) % 2 === 0) context.fillRect(x, y, 32, 32);
      if (resource && resource.image.naturalWidth) {
        const crop = draft.crop;
        context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
        if (crop) context.drawImage(resource.image, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
        else {
          const scale = side / Math.max(width, height), w = width * scale, h = height * scale;
          context.drawImage(resource.image, (side - w) / 2, (side - h) / 2, w, h);
        }
      } else {
        const art = draft.art && (M.BUILTIN_ART || M.FOOD_ART)[draft.art];
        context.fillStyle = art ? art.bg : '#e4ebe2'; context.fillRect(0, 0, side, side);
        context.textAlign = 'center'; context.textBaseline = 'middle';
        const placeholder = busy && art && art.photo ? '正在读取照片' : (Array.from(itemName).slice(0, 2).join('') || '图片');
        context.fillStyle = '#2d4434'; context.font = 'bold ' + (Array.from(placeholder).length > 2 ? '78px' : '130px') + ' system-ui, sans-serif';
        context.fillText(placeholder, side / 2, side / 2);
      }
    }
    function describe() {
      const zoom = draft.crop && width ? Math.min(width, height) / draft.crop.size : 1;
      zoomInput.value = String(clamp(zoom, 1, 4));
      if (zoomValue) zoomValue.textContent = zoom.toFixed(2) + '×';
      if (!draft.image) statusText(draft.art ? '示例插画；可选择本地图片替换。' : '暂无图片；选择本地图片后可拖动定位和缩放。');
      else if (!draft.crop) statusText('当前完整显示，尚未裁切。拖动、缩放或重置后应用正方形裁切。');
      else statusText('正方形裁切 · 拖动定位，方向键微调，Shift 加速。保存后应用，取消不改原项目。');
      controls(); draw();
    }
    function dirty() { describe(); call('onDirty', getValue()); }
    function beginCrop() { if (!draft.crop) draft.crop = centeredCrop(width, height); }
    async function open(item) {
      close(); active = true; const token = ++session;
      itemName = item.name || ''; draft = { image: item.image || null, crop: copyCrop(item.crop), art: item.art || null };
      let photo;
      try { photo = draft.image ? null : builtinPhotoPath(draft.art); }
      catch (error) { report(error); controls(); draw(); return false; }
      if (!draft.image && !photo) { describe(); return true; }
      setBusy(true); statusText('正在读取图片…'); draw();
      let next, controller, timer, timedOut = false;
      try {
        let prepared;
        if (photo) {
          controller = new AbortController(); loadController = controller;
          timer = setTimeout(() => { timedOut = true; controller.abort(); }, LOAD_TIMEOUT);
          prepared = await prepareFile(await builtinPhotoFile(photo, controller.signal), { signal: controller.signal });
          if (!active || token !== session) return false;
        }
        const data = prepared ? prepared.image : draft.image;
        M.validateImage(data); next = imageResource(data, controller && controller.signal); pendingResource = next;
        const image = await next.ready;
        if (controller) cancelled(controller.signal);
        if (pendingResource === next) pendingResource = null;
        if (!active || token !== session) { next.dispose(); return false; }
        if (prepared) draft = { image: prepared.image, crop: prepared.crop, art: null };
        resource = next; width = image.naturalWidth; height = image.naturalHeight;
        if (draft.crop) draft.crop = boundedCrop(width, height, draft.crop);
        setBusy(false); describe(); return true;
      } catch (error) {
        if (pendingResource === next) pendingResource = null;
        if (next) next.dispose();
        if (active && token === session) {
          setBusy(false); report(timedOut ? new Error('内置图片读取超时，请刷新重试或选择本地图片。') : error); draw();
        }
        return false;
      } finally { clearTimeout(timer); if (loadController === controller) loadController = null; }
    }
    function isReady() { return active && !busy && (!draft.image || !!resource); }
    function getValue() {
      if (!isReady()) throw new Error('图片仍在读取或读取失败，请稍后保存，或替换、移除图片。');
      return { image: draft.image, crop: copyCrop(draft.crop), art: draft.art };
    }
    function close() {
      ++session; active = false; cancelPointer();
      if (loadController) loadController.abort();
      loadController = null;
      if (pendingResource) pendingResource.dispose();
      pendingResource = null; release(); setBusy(false);
    }
    replaceInput.addEventListener('change', async () => {
      const file = replaceInput.files && replaceInput.files[0]; replaceInput.value = '';
      if (!active || busy || !file) return;
      const token = ++session; cancelPointer(); setBusy(true); statusText('正在处理本地图片…');
      const controller = new AbortController(); loadController = controller;
      let next, timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, LOAD_TIMEOUT);
      try {
        const prepared = await prepareFile(file, { signal: controller.signal });
        if (!active || token !== session) return;
        next = imageResource(prepared.image, controller.signal); pendingResource = next;
        const image = await next.ready;
        cancelled(controller.signal);
        if (pendingResource === next) pendingResource = null;
        if (!active || token !== session) { next.dispose(); return; }
        release(); resource = next; width = image.naturalWidth; height = image.naturalHeight;
        draft = { image: prepared.image, crop: prepared.crop, art: null };
        setBusy(false); dirty();
      } catch (error) {
        if (pendingResource === next) pendingResource = null;
        if (next) next.dispose();
        if (active && token === session) {
          setBusy(false); report(timedOut ? new Error('图片处理超时，请先缩小原图后重试。') : error); controls();
        }
      } finally { clearTimeout(timer); if (loadController === controller) loadController = null; }
    });
    removeButton.addEventListener('click', () => {
      if (!active || busy) return;
      cancelPointer(); release(); draft = { image: null, crop: null, art: null }; dirty();
    });
    resetButton.addEventListener('click', () => {
      if (!active || busy || !resource) return;
      cancelPointer(); draft.crop = centeredCrop(width, height); dirty();
    });
    zoomInput.addEventListener('input', () => {
      if (!active || busy || !resource) return;
      cancelPointer(); draft.crop = zoomCrop(width, height, draft.crop, Number(zoomInput.value) || 1); dirty();
    });
    canvas.addEventListener('pointerdown', event => {
      if (!active || busy || !resource || pointer || event.button !== 0) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, crop: copyCrop(draft.crop) || centeredCrop(width, height) };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault(); const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;
      if (!draft.crop && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 1) return;
      draft.crop = translatedCrop(width, height, pointer.crop,
        -(event.clientX - pointer.x) * pointer.crop.size / box.width,
        -(event.clientY - pointer.y) * pointer.crop.size / box.height);
      dirty();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => canvas.addEventListener(type, event => {
      if (pointer && pointer.id === event.pointerId) cancelPointer();
    }));
    canvas.addEventListener('keydown', event => {
      if (!active || busy || !resource || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); beginCrop(); const step = Math.max(1, draft.crop.size / 100) * (event.shiftKey ? 5 : 1);
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      draft.crop = translatedCrop(width, height, draft.crop, dx, dy); dirty();
    });
    controls(); draw();
    return { open, getValue, close, isReady };
  }
  return { prepareFile, createEditor, builtinPhotoPath, centeredCrop, boundedCrop, zoomCrop, translatedCrop };
}));
