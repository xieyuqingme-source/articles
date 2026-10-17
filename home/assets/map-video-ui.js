(() => {
  "use strict";
  const A = window.FootprintsMap, J = window.FootprintsJourney, V = window.FootprintsVideo, M = window.FootprintsModel, L = window.FootprintsLabels;
  const $ = id => document.getElementById(id);
  if (!A || !J || !V) return;
  const canvas = $("video-canvas"), context = canvas.getContext("2d"), preview = $("video-preview");
  let plan = null, controller = null, busy = false, resultUrl = null, previewPlan = null, callbackId = null, lock = [], lastProgress = "";
  const cap = V.capabilities();
  $("video-capability").textContent = cap.supported ? "" : `${cap.reason || "此浏览器不能生成视频。"} 可继续下载 PNG / SVG 图片；建议使用新版 Chrome 或 Edge。`;
  function seconds(ms) { const value = Math.ceil(ms / 1000); return `${Math.floor(value / 60)} 分 ${String(value % 60).padStart(2, "0")} 秒`; }
  function wrapped(text, width, font) {
    context.font = font; const lines = []; let line = "";
    for (const char of Array.from(text)) {
      if (char === "\n") { lines.push(line); line = ""; continue; }
      if (line && context.measureText(line + char).width > width) { lines.push(line); line = char; } else line += char;
    }
    lines.push(line); return lines;
  }
  function textPages(text) {
    context.font = "32px sans-serif";
    const pages = []; let page = "", line = "", lines = 1;
    for (const char of Array.from(text)) {
      if (char === "\n") {
        page += char; line = "";
        if (lines === 4) { pages.push(page); page = ""; lines = 1; } else lines++;
      } else {
        if (line && context.measureText(line + char).width > 1152) {
          line = "";
          if (lines === 4) { pages.push(page); page = ""; lines = 1; } else lines++;
        }
        page += char; line += char;
      }
    }
    if (page || !pages.length) pages.push(page);
    return pages;
  }
  function rebuild() {
    if (busy) return;
    const records = A.records();
    // Confirmed baseReturn metadata remains authoritative. Visitor data is never
    // given the author's city and unconfirmed multi-city bases stay unresolved.
    const panel = $("journey-options"); panel.replaceChildren(); panel.hidden = true;
    const journey = J.build(records);
    plan = J.plan(journey.scenes, { pace: $("video-pace").value, maxPageChars: 100, textPaginator: textPages });
    $("journey-warnings").textContent = [...new Set(journey.warnings.map(value => typeof value === "string" ? value : value.message || "").filter(Boolean))].join("；");
    $("video-estimate").textContent = `预计 ${seconds(plan.durationMs)}`;
    $("video-generate").disabled = !cap.supported || !context || !plan.scenes.length || !A.assetsReady();
    $("video-generate").title = !A.assetsReady() ? "请等待本地底图与头像加载；加载失败时请重选头像或刷新。" : "";
  }
  function clearResult() {
    preview.pause(); stopPreviewFrames(); preview.removeAttribute("src"); preview.load(); preview.hidden = true; previewPlan = null;
    if (resultUrl) URL.revokeObjectURL(resultUrl); resultUrl = null;
    $("video-download").hidden = true; $("video-download").removeAttribute("href"); $("video-download").removeAttribute("download");
  }
  function setBusy(value) {
    busy = value; $("video-cancel").hidden = !value; $("video-progress").hidden = !value;
    if (value) {
      lock = Array.from(document.querySelectorAll(".map-main button, .map-main input, .map-main select, .map-main textarea, #theme-toggle")).filter(node => !["video-cancel", "map-expanded-close"].includes(node.id)).map(node => [node, node.disabled]);
      for (const [node] of lock) node.disabled = true;
      $("video-cancel").focus({ preventScroll: true });
    } else { for (const [node, disabled] of lock) node.disabled = disabled; lock = []; }
    // Snapshot ordinary draft controls before the map applies its recording
    // state, then let that state refresh undo/clear after the snapshot restores.
    A.setRecording(value);
    if (!value) rebuild();
  }
  function palette() { const style = getComputedStyle(document.documentElement); return Object.fromEntries(["paper", "surface", "ink", "muted", "accent", "line", "soft"].map(key => [key, style.getPropertyValue("--" + key).trim()])); }
  async function imageFrom(blob) { const url = URL.createObjectURL(blob); try { const image = new Image(); image.src = url; await image.decode(); return image; } finally { URL.revokeObjectURL(url); } }
  function routePoints(frame) { return frame.cumulativePath || []; }
  function sceneFrame(videoPlan, time) {
    const frame = J.frameAt(videoPlan, time);
    return { ...frame, unlocked: J.unlocked(videoPlan.scenes, frame) };
  }
  async function makeRenderer(frozenPlan) {
    if (!A.assetsReady()) throw new Error("底图或头像尚未准备好，请等待加载完成后重试。");
    await document.fonts.ready;
    const colors = palette(), project = A.projection(), showRoute = $("map-route").checked, showLabels = $("map-labels").checked, labelStyle = A.labelStyle ? A.labelStyle() : { fontSize: 14, lineHeight: 18 };
    const backgroundSvg = await A.exportSvg({ backgroundOnly: true }).text(), documentSvg = new DOMParser().parseFromString(backgroundSvg, "image/svg+xml");
    // The raster background must never retain a future city's marker or name.
    // Keep this defensive removal for older saved previews, too.
    documentSvg.querySelectorAll("#journey-route, #playback-avatar, #map-label-layer, .map-marker, .map-city, .map-city-label, .map-svg-label, .map-svg-note").forEach(node => node.remove());
    documentSvg.querySelectorAll(".is-playing").forEach(node => node.classList.remove("is-playing"));
    const background = await imageFrom(new Blob([new XMLSerializer().serializeToString(documentSvg)], { type: "image/svg+xml" }));
    const source = A.avatarSource(), avatar = source ? await imageFrom(await (await fetch(source)).blob()) : null;
    const mapTop = 0, mapBottom = 660;
    const viewBox = documentSvg.documentElement.viewBox.baseVal;
    const mapWidth = viewBox.width || 1000, mapHeight = viewBox.height || 600;
    const scale = Math.min(1280 / mapWidth, mapBottom / mapHeight), mapLeft = (1280 - mapWidth * scale) / 2;
    const markers = Array.from(new Map(frozenPlan.scenes.filter(item => !item.derived).map(item => [M.cityKey(item), item])).entries());
    let unlockedIndex = null, unlockedCities = new Set(), labelFrame = "", placedLabels = [];
    return time => {
      const frame = J.frameAt(frozenPlan, time), item = frame.record;
      // Index changes only on arrival. Return scenes reuse an existing city key.
      const unlockIndex = `${frame.index}:${frame.phase === "intro" || frame.elapsed === 0}`;
      if (unlockedIndex !== unlockIndex) { unlockedCities = J.unlocked(frozenPlan.scenes, frame); unlockedIndex = unlockIndex; }
      context.fillStyle = colors.surface; context.fillRect(0, 0, 1280, 960);
      context.save(); context.beginPath(); context.rect(0, mapTop, 1280, mapBottom); context.clip();
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
      context.drawImage(background, mapLeft, mapTop, mapWidth * scale, mapHeight * scale);
      context.translate(mapLeft, mapTop); context.scale(scale, scale);
      context.save(); context.beginPath(); context.rect(project.left, project.top, project.width, project.height); context.clip();
      if (showRoute) {
        context.strokeStyle = colors.accent; context.lineWidth = 2.2; context.setLineDash([5, 5]); context.beginPath(); let previous = null;
        for (const point of routePoints(frame)) { const [x, y] = project.point(point.lon, point.lat); if (!previous || Math.abs(point.lon - previous.lon) > 180) context.moveTo(x, y); else context.lineTo(x, y); previous = point; }
        context.stroke(); context.setLineDash([]);
      }
      for (const [key, city] of markers) {
        if (!unlockedCities.has(key) || !project.contains(city)) continue;
        const [x, y] = project.point(city.lon, city.lat);
        context.fillStyle = colors.accent; context.strokeStyle = colors.surface; context.lineWidth = 1.1;
        context.beginPath(); context.arc(x, y, 3.2, 0, Math.PI * 2); context.fill(); context.stroke();
      }
      if (showLabels && L) {
        const currentKey = item ? M.cityKey(item) : null, key = `${unlockedIndex}:${currentKey}`;
        context.font = `${labelStyle.fontSize}px sans-serif`;
        if (labelFrame !== key) {
          labelFrame = key;
          const candidates = markers.filter(([cityKey, city]) => unlockedCities.has(cityKey) && project.contains(city)).map(([cityKey, city]) => { const p = project.point(city.lon, city.lat); return { key: cityKey, name: city.city, x: p[0], y: p[1], priority: cityKey === currentKey ? 1 : 0, markerRadius: cityKey === currentKey ? 22 : 4 }; });
          placedLabels = L.layout(candidates, { width: project.width, height: project.height, visibleSet: unlockedCities, ...labelStyle, measure: text => context.measureText(text).width });
        }
        context.textAlign = "start"; context.textBaseline = "alphabetic";
        for (const label of placedLabels) {
          context.save(); context.globalAlpha = .82; context.strokeStyle = colors.surface; context.lineWidth = 1.5; context.lineJoin = "round"; context.strokeText(label.text, label.x, label.y); context.restore();
          context.fillStyle = colors.ink; context.fillText(label.text, label.x, label.y);
        }
      }
      const point = frame.point || item;
      if (point && project.contains(point)) {
        const [x, y] = project.point(point.lon, point.lat); context.fillStyle = colors.surface; context.strokeStyle = colors.accent; context.lineWidth = 2.5;
        context.beginPath(); context.arc(x, y, 22, 0, Math.PI * 2); context.fill(); context.stroke();
        context.save(); context.beginPath(); context.arc(x, y, 19, 0, Math.PI * 2); context.clip();
        if (avatar) context.drawImage(avatar, x - 19, y - 19, 38, 38); else { context.fillStyle = colors.accent; context.fillRect(x - 19, y - 19, 38, 38); } context.restore();
      }
      context.restore(); context.restore();
      context.fillStyle = colors.surface; context.fillRect(0, mapBottom, 1280, 300); context.fillStyle = colors.line; context.fillRect(0, mapBottom, 1280, 2);
      if (item) {
        context.fillStyle = colors.accent; context.font = "24px sans-serif";
        context.fillText(`${frame.index + 1} / ${frame.count} · ${J.dateLabel(item)}${frame.pageCount > 1 ? ` · ${frame.pageIndex + 1}/${frame.pageCount} 页` : ""}`, 64, 700);
        context.fillStyle = colors.ink; context.font = "bold 34px sans-serif";
        const place = item.derived ? `${item.city} · ${item.frameworkLabel}` : item.city;
        const heading = wrapped(place, 1152, "bold 34px sans-serif");
        // Long place names are rare; shrink the heading to keep all characters.
        if (heading.length > 1) { let size = 34; while (size > 10 && context.measureText(place).width > 1152) context.font = `bold ${--size}px sans-serif`; }
        context.fillText(place, 64, 748);
        context.fillStyle = colors.ink; context.font = "32px sans-serif";
        const lines = wrapped(frame.pageText || "", 1152, "32px sans-serif");
        lines.forEach((line, index) => context.fillText(line, 64, 795 + index * 40));
        if (point && !project.contains(point)) { context.fillStyle = colors.muted; context.font = "18px sans-serif"; context.fillText("本幕地点在当前视野外", 64, 644); }
      }
      // The site map and image exports share this exact scene/progress.
      A.setFrame({ ...frame, unlocked: unlockedCities, state: time >= frozenPlan.durationMs ? "ended" : "paused" });
    };
  }
  async function generate() {
    if (busy || $("video-generate").disabled || !plan) return;
    clearResult(); const frozenPlan = plan; controller = new AbortController(); setBusy(true); $("video-canvas").hidden = false; $("video-progress").value = 0; lastProgress = "";
    try {
      $("playback-progress").textContent = "正在准备本地地图画面…";
      const renderFrame = await makeRenderer(frozenPlan);
      if (controller.signal.aborted) throw new DOMException("已取消生成。", "AbortError");
      const result = await V.record({ canvas, durationMs: frozenPlan.durationMs, renderFrame, signal: controller.signal, fps: 30, onProgress(value) {
        $("video-progress").value = value.progress;
        const label = value.state === "finalizing" ? "正在封装视频…" : `生成中 ${Math.floor(value.progress * 100)}% · ${seconds(value.elapsedMs)} / ${seconds(value.durationMs)}`;
        if (label !== lastProgress) { lastProgress = label; $("playback-progress").textContent = label; }
      } });
      resultUrl = URL.createObjectURL(result.blob); previewPlan = frozenPlan; preview.src = resultUrl; preview.hidden = false;
      const link = $("video-download"); link.href = resultUrl; link.download = `footprints.${result.extension}`; link.textContent = `↓ 下载 ${result.extension.toUpperCase()} 视频（${(result.blob.size / 1048576).toFixed(1)} MB）`; link.hidden = false;
      $("playback-progress").textContent = `已生成 ${result.extension.toUpperCase()} · ${seconds(result.durationMs)}。可预览、定位并下载。`;
      A.status("视频已在本机生成。点击下载保存；视频文件不会自动保存到浏览器草稿。");
    } catch (error) {
      $("playback-progress").textContent = error.name === "AbortError" ? "已取消生成，未保留半成品。可重新生成。" : `${error.message || "视频生成失败"} 可重试，或下载 PNG / SVG 图片。`;
      if (error.name !== "AbortError") A.status($("playback-progress").textContent, true);
      // A canceled or failed movie must not leave future cities hidden in the
      // editable map. Successful movies retain their last frame and preview sync.
      A.resetFrame();
    } finally { controller = null; setBusy(false); $("video-canvas").hidden = true; $("video-generate").focus({ preventScroll: true }); }
  }
  function cancel() { if (controller) controller.abort(); }
  function syncPreview() { if (previewPlan) A.setFrame({ ...sceneFrame(previewPlan, Math.min(previewPlan.durationMs, preview.currentTime * 1000)), state: "paused" }); }
  function stopPreviewFrames() { if (callbackId !== null && preview.cancelVideoFrameCallback) preview.cancelVideoFrameCallback(callbackId); callbackId = null; }
  function previewFrame() { syncPreview(); if (!preview.paused && preview.requestVideoFrameCallback) callbackId = preview.requestVideoFrameCallback(previewFrame); }
  preview.addEventListener("play", () => { stopPreviewFrames(); previewFrame(); });
  for (const event of ["timeupdate", "seeked", "pause", "ended"]) preview.addEventListener(event, () => { syncPreview(); if (preview.paused) stopPreviewFrames(); });
  $("video-generate").addEventListener("click", generate); $("video-cancel").addEventListener("click", cancel);
  $("video-pace").addEventListener("change", () => { clearResult(); rebuild(); A.resetFrame(); });
  window.addEventListener("footprints:reset", () => { if (!busy) { clearResult(); rebuild(); } });
  window.addEventListener("footprints:assets", rebuild);
  window.addEventListener("footprints:labels", () => { if (!busy) { clearResult(); rebuild(); A.resetFrame(); } });
  window.addEventListener("footprints:avatar", () => { if (!busy) { clearResult(); rebuild(); A.resetFrame(); } });
  window.addEventListener("pagehide", () => { cancel(); clearResult(); });
  window.FootprintsVideoUI = { generate, cancel, getPlan: () => plan, getState: () => ({ busy, ready: !!resultUrl, mimeType: cap.mimeType, extension: cap.extension }) };
  rebuild();
})();
