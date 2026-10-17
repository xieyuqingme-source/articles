(function (root, factory) {
  "use strict";
  const video = factory();
  if (typeof module === "object" && module.exports) module.exports = video;
  else root.FootprintsVideo = video;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Capture only the supplied canvas. This module never asks for screen, camera,
  // microphone, network access, or an audio track. Recording runs in real time.
  const FORMATS = [
    { mimeType: "video/webm;codecs=vp9", extension: "webm" },
    { mimeType: "video/webm;codecs=vp8", extension: "webm" },
    { mimeType: "video/webm", extension: "webm" },
    { mimeType: "video/mp4;codecs=avc1.42E01E", extension: "mp4" },
    { mimeType: "video/mp4", extension: "mp4" }
  ];
  const MAX_DURATION = 30 * 60 * 1000, MAX_BYTES = 128 * 1024 * 1024;
  const activeCanvases = new WeakSet();
  function error(name, message) { const e = new Error(message); e.name = name; return e; }
  function environment(custom) {
    const root = typeof globalThis === "undefined" ? {} : globalThis, supplied = custom || {};
    return {
      MediaRecorder: supplied.MediaRecorder || root.MediaRecorder,
      HTMLCanvasElement: supplied.HTMLCanvasElement || root.HTMLCanvasElement,
      Blob: supplied.Blob || root.Blob,
      document: supplied.document === undefined ? root.document : supplied.document,
      window: supplied.window === undefined ? root.window : supplied.window,
      now: supplied.now || (() => root.performance.now()),
      requestFrame: supplied.requestFrame || (callback => root.requestAnimationFrame(callback)),
      cancelFrame: supplied.cancelFrame || (id => root.cancelAnimationFrame(id)),
      setTimeout: supplied.setTimeout || ((callback, ms) => root.setTimeout(callback, ms)),
      clearTimeout: supplied.clearTimeout || (id => root.clearTimeout(id)),
      canvas: supplied.canvas
    };
  }
  function capabilities(custom) {
    const e = environment(custom), Recorder = e.MediaRecorder;
    if (!Recorder || typeof Recorder.isTypeSupported !== "function") return { supported: false, mimeType: "", extension: "", reason: "当前浏览器没有可用的视频编码功能。可下载静态图片，或使用最新版 Windows Chrome 生成视频。" };
    const capture = e.canvas ? e.canvas.captureStream : e.HTMLCanvasElement && e.HTMLCanvasElement.prototype.captureStream;
    if (typeof capture !== "function") return { supported: false, mimeType: "", extension: "", reason: "当前浏览器不支持地图画布录像。可下载静态图片，或使用最新版 Windows Chrome 生成视频。" };
    for (const format of FORMATS) {
      try { if (Recorder.isTypeSupported(format.mimeType)) return { supported: true, mimeType: format.mimeType, extension: format.extension, reason: "" }; } catch (_) { /* Try the next explicit container/codec. */ }
    }
    return { supported: false, mimeType: "", extension: "", reason: "当前浏览器没有支持的 WebM 或 MP4 编码格式。请下载静态图片，或换用最新版 Windows Chrome。" };
  }
  function formatFor(type) {
    const container = String(type || "").split(";")[0].trim().toLowerCase();
    return container === "video/webm" ? "webm" : container === "video/mp4" ? "mp4" : "";
  }

  // Chrome MediaRecorder may omit WebM Duration. Add/replace only that Info
  // field, without re-encoding any frame. The result remains an actual WebM.
  function vint(bytes, at, identifier) {
    if (at >= bytes.length || !bytes[at]) return null;
    let mask = 128, length = 1;
    while (!(bytes[at] & mask)) { mask >>= 1; length++; }
    if (length > (identifier ? 4 : 8) || at + length > bytes.length) return null;
    let value = identifier ? bytes[at] : bytes[at] & (mask - 1), unknown = !identifier && value === mask - 1;
    for (let i = 1; i < length; i++) { value = value * 256 + bytes[at + i]; unknown = unknown && bytes[at + i] === 255; }
    return { length, value, unknown };
  }
  function element(bytes, at, end) {
    const id = vint(bytes, at, true); if (!id) return null;
    const size = vint(bytes, at + id.length, false); if (!size) return null;
    const data = at + id.length + size.length, stop = size.unknown ? end : data + size.value;
    if (stop > end || stop < data || (!size.unknown && !Number.isSafeInteger(size.value))) return null;
    return { id: id.value, start: at, sizeAt: at + id.length, size, data, end: stop };
  }
  function sizeBytes(value, preferred) {
    let length = preferred || 1;
    while (value >= Math.pow(2, length * 7) - 1) length++;
    if (length > 8 || !Number.isSafeInteger(value)) return null;
    const out = new Uint8Array(length); let n = value;
    for (let i = length - 1; i >= 0; i--) { out[i] = n % 256; n = Math.floor(n / 256); }
    out[0] |= 1 << (8 - length); return out;
  }
  function concat(parts) {
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; } return out;
  }
  async function withWebmDuration(blob, durationMs, BlobType) {
    if (formatFor(blob.type) !== "webm" || !blob.size || !Number.isFinite(durationMs) || durationMs <= 0) return blob;
    const bytes = new Uint8Array(await blob.arrayBuffer()); let segment = null, info = null;
    for (let at = 0; at < bytes.length;) {
      const node = element(bytes, at, bytes.length); if (!node) return blob;
      if (node.id === 0x18538067) { segment = node; break; } at = node.end;
    }
    if (!segment) return blob;
    for (let at = segment.data; at < segment.end;) {
      const node = element(bytes, at, segment.end); if (!node) return blob;
      if (node.id === 0x1549a966) { info = node; break; }
      if (node.size.unknown) return blob; at = node.end;
    }
    if (!info || info.size.unknown) return blob;
    let scale = 1000000, duration = null;
    for (let at = info.data; at < info.end;) {
      const node = element(bytes, at, info.end); if (!node || node.size.unknown) return blob;
      if (node.id === 0x2ad7b1) { scale = 0; for (let i = node.data; i < node.end; i++) scale = scale * 256 + bytes[i]; }
      if (node.id === 0x4489) duration = node;
      at = node.end;
    }
    if (!scale || !Number.isFinite(scale)) return blob;
    const value = new Uint8Array(8); new DataView(value.buffer).setFloat64(0, durationMs * 1000000 / scale, false);
    const field = concat([new Uint8Array([0x44, 0x89, 0x88]), value]);
    const content = duration ? concat([bytes.subarray(info.data, duration.start), field, bytes.subarray(duration.end, info.end)]) : concat([bytes.subarray(info.data, info.end), field]);
    const encodedSize = sizeBytes(content.length, info.size.length); if (!encodedSize) return blob;
    const newInfo = concat([bytes.subarray(info.start, info.sizeAt), encodedSize, content]);
    const difference = newInfo.length - (info.end - info.start);
    const segmentSize = segment.size.unknown ? bytes.subarray(segment.sizeAt, segment.data) : sizeBytes(segment.size.value + difference, segment.size.length);
    if (!segmentSize) return blob;
    const output = concat([bytes.subarray(0, segment.sizeAt), segmentSize, bytes.subarray(segment.data, info.start), newInfo, bytes.subarray(info.end)]);
    return new (BlobType || Blob)([output], { type: blob.type });
  }

  function record(options) {
    const o = options || {}, canvas = o.canvas, e = environment(Object.assign({}, o.environment, { canvas }));
    const cap = capabilities(Object.assign({}, o.environment, { canvas }));
    const durationMs = Number(o.durationMs), fps = o.fps === undefined ? 30 : Number(o.fps);
    if (!cap.supported) return Promise.reject(error("NotSupportedError", cap.reason));
    if (!canvas || !Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width <= 0 || canvas.height <= 0 || canvas.width > 4096 || canvas.height > 4096 || canvas.width * canvas.height > 9000000) return Promise.reject(error("ValidationError", "视频画幅无效，请重新生成。"));
    if (activeCanvases.has(canvas)) return Promise.reject(error("InvalidStateError", "这张地图正在生成视频，请先取消或等待完成。"));
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION) return Promise.reject(error("ValidationError", "视频须在 30 分钟以内，请减少经历或提高整体节奏后重试。"));
    if (!Number.isFinite(fps) || fps < 15 || fps > 60 || typeof o.renderFrame !== "function") return Promise.reject(error("ValidationError", "视频帧率或绘图设置无效。"));
    if (o.signal && o.signal.aborted) return Promise.reject(error("AbortError", "已取消生成视频。"));
    if (e.document && e.document.hidden) return Promise.reject(error("InterruptedError", "请保持本页面在前台，再生成视频。"));
    const width = canvas.width, height = canvas.height;
    activeCanvases.add(canvas);
    return new Promise((resolve, reject) => {
      let stream = null, recorder = null, frame = null, watchdog = null, stopTimer = null;
      let chunks = [], byteLength = 0, settled = false, finishing = false, started = false, anchor = 0, previous = 0, lastPaint = -Infinity, tickCount = 0;
      const removers = [];
      function listen(target, name, callback) {
        if (target && typeof target.addEventListener === "function") { target.addEventListener(name, callback); removers.push(() => target.removeEventListener(name, callback)); }
      }
      function stopFrames() { if (frame !== null) e.cancelFrame(frame); frame = null; }
      function cleanup() {
        stopFrames(); if (watchdog !== null) e.clearTimeout(watchdog); if (stopTimer !== null) e.clearTimeout(stopTimer);
        watchdog = stopTimer = null; for (const remove of removers.splice(0)) remove();
        if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (_) { /* Already stopped by the browser. */ } }
        if (stream) for (const track of stream.getTracks()) { try { track.stop(); } catch (_) { /* Track already ended. */ } }
        activeCanvases.delete(canvas); chunks = [];
      }
      function fail(problem) { if (settled) return; settled = true; cleanup(); reject(problem); }
      function notify(state, elapsedMs) {
        if (typeof o.onProgress !== "function") return;
        o.onProgress({ state, progress: Math.max(0, Math.min(1, elapsedMs / durationMs)), elapsedMs: Math.min(durationMs, elapsedMs), durationMs });
      }
      function paint(at) {
        if (canvas.width !== width || canvas.height !== height) throw error("InterruptedError", "视频画幅发生变化，已停止生成；请重试。" );
        const result = o.renderFrame(at);
        if (result && typeof result.then === "function") throw error("ValidationError", "视频画面尚未准备好，请等待地图和头像加载后重试。" );
      }
      function abort() { fail(error("AbortError", "已取消生成视频。")); }
      function interrupt() { fail(error("InterruptedError", "页面已离开前台，生成已停止。回到页面后可以重试。")); }
      function visibility() { if (e.document.hidden) interrupt(); }
      function tick(timestamp) {
        frame = null; if (settled || finishing) return;
        const current = e.now();
        // A window can be occluded and have its rendering throttled even when
        // document.hidden stays false. Discard that recording instead of
        // offering a choppy file with missing transition frames. The first
        // frame gets a small encoder-startup allowance; later stalls do not.
        if (current - previous > (tickCount === 0 ? 1500 : 750)) { fail(error("InterruptedError", "页面绘制被浏览器暂停或限速。请将 Chrome 窗口和本页保持前台，关闭遮挡后重试。")); return; }
        tickCount++;
        previous = current;
        const elapsed = Math.max(0, Math.min(durationMs, current - anchor));
        try {
          if (elapsed >= durationMs || current - lastPaint >= 1000 / fps - 1) { paint(elapsed); lastPaint = current; notify("recording", elapsed); }
          if (settled) return;
          if (elapsed >= durationMs) {
            finishing = true; notify("finalizing", durationMs);
            // Give the final canvas paint one capture interval before flushing.
            stopTimer = e.setTimeout(() => { stopTimer = null; if (settled) return; try { recorder.stop(); } catch (_) { fail(error("EncodingError", "浏览器未能结束编码，请重试。")); } }, Math.ceil(1000 / fps) + 20);
            if (watchdog !== null) e.clearTimeout(watchdog);
            watchdog = e.setTimeout(() => fail(error("EncodingError", "浏览器结束编码超时，请重试。")), 10000);
          } else frame = e.requestFrame(tick);
        } catch (problem) { fail(problem); }
      }
      async function completed() {
        if (settled) return;
        if (!finishing) { fail(error("EncodingError", "浏览器意外中断了视频生成，请重试。")); return; }
        if (!byteLength) { fail(error("EncodingError", "浏览器没有生成视频数据，请重试或下载静态图片。")); return; }
        const actualType = recorder.mimeType || cap.mimeType, extension = formatFor(actualType);
        if (!extension) { fail(error("EncodingError", "浏览器返回了无法确认的视频格式，未下载文件。")); return; }
        try {
          let blob = new e.Blob(chunks, { type: actualType });
          // Copying EBML metadata is bounded by the same 128 MiB output limit.
          blob = await withWebmDuration(blob, durationMs, e.Blob);
          if (settled) return;
          settled = true; cleanup(); resolve({ blob, mimeType: actualType, extension, durationMs, width, height, fps });
        } catch (problem) { fail(error("EncodingError", "视频封装失败，请重试或下载静态图片。")); }
      }
      try {
        // Paint before and after capture starts: a canvas stream needs a paint
        // after creation to emit its first frame, including for a single scene.
        paint(0);
        stream = canvas.captureStream(fps);
        const tracks = stream.getTracks(), videos = stream.getVideoTracks();
        if (videos.length !== 1 || tracks.length !== 1 || tracks[0].kind !== "video") throw error("EncodingError", "地图录像没有获得唯一的视频轨道，请重试。" );
        recorder = new e.MediaRecorder(stream, { mimeType: cap.mimeType, videoBitsPerSecond: 5000000 });
        listen(recorder, "dataavailable", event => {
          if (settled || !event.data || !event.data.size) return;
          byteLength += event.data.size;
          if (byteLength > MAX_BYTES) { fail(error("QuotaExceededError", "视频超过 128 MiB，已停止生成。请减少经历或提高整体节奏后重试。")); return; }
          chunks.push(event.data);
        });
        listen(recorder, "error", () => fail(error("EncodingError", "浏览器编码失败，可能是内存或编码器暂时不足。请关闭无关页面后重试。")));
        listen(recorder, "stop", completed);
        listen(recorder, "start", () => {
          if (settled || started) return; started = true;
          if (!finishing && watchdog !== null) { e.clearTimeout(watchdog); watchdog = null; }
        });
        listen(videos[0], "ended", () => { if (!finishing) fail(error("EncodingError", "地图视频轨道已中断，请重试。")); });
        listen(o.signal, "abort", abort); listen(e.document, "visibilitychange", visibility);
        listen(e.window, "pagehide", interrupt); listen(e.document, "freeze", interrupt);
        // Recheck after all cancellation listeners have been installed.
        if (o.signal && o.signal.aborted) { abort(); return; }
        if (e.document && e.document.hidden) { interrupt(); return; }
        watchdog = e.setTimeout(() => fail(error("EncodingError", "浏览器未能启动视频编码，请重试。")), 10000);
        // The stream clock begins at start(), while the asynchronous start event
        // may wait for encoder output. Waiting for that event would create an
        // initial frozen second and shift every scene relative to video time.
        anchor = previous = e.now(); lastPaint = anchor;
        recorder.start(1000);
        if (!settled) { paint(0); notify("recording", 0); if (!settled) frame = e.requestFrame(tick); }
      } catch (problem) {
        if (problem && problem.name === "SecurityError") fail(error("SecurityError", "地图或头像不允许被本地录制。请使用本站底图和本地上传的头像后重试。"));
        else fail(problem instanceof Error ? problem : error("EncodingError", "无法启动视频生成，请重试。"));
      }
    });
  }
  return Object.freeze({ capabilities, record, withWebmDuration, MAX_DURATION, MAX_BYTES });
});
