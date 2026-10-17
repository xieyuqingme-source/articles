(() => {
  "use strict";
  const M = window.FootprintsModel, P = window.FootprintsPlayback, V = window.FootprintsView, L = window.FootprintsLabels, $ = id => document.getElementById(id);
  if (!M) return;
  const NS = "http://www.w3.org/2000/svg", STORAGE_KEY = "xieyuqing-footprints-v1";
  const cities = [
    ["北京", "北京", "中国", 39.9042, 116.4074], ["上海", "上海", "中国", 31.2304, 121.4737], ["广州", "广东", "中国", 23.1291, 113.2644],
    ["深圳", "广东", "中国", 22.5431, 114.0579], ["杭州", "浙江", "中国", 30.2741, 120.1551], ["南京", "江苏", "中国", 32.0603, 118.7969],
    ["武汉", "湖北", "中国", 30.5928, 114.3055], ["成都", "四川", "中国", 30.5728, 104.0668], ["重庆", "重庆", "中国", 29.5630, 106.5516],
    ["西安", "陕西", "中国", 34.3416, 108.9398], ["郑州", "河南", "中国", 34.7466, 113.6254], ["洛阳", "河南", "中国", 34.6197, 112.4540],
    ["开封", "河南", "中国", 34.7973, 114.3076], ["安阳", "河南", "中国", 36.0971, 114.3931], ["新乡", "河南", "中国", 35.3030, 113.9268],
    ["长沙", "湖南", "中国", 28.2282, 112.9388], ["济南", "山东", "中国", 36.6512, 117.1201], ["青岛", "山东", "中国", 36.0671, 120.3826],
    ["天津", "天津", "中国", 39.0842, 117.2009], ["苏州", "江苏", "中国", 31.2989, 120.5853], ["厦门", "福建", "中国", 24.4798, 118.0894],
    ["福州", "福建", "中国", 26.0745, 119.2965], ["昆明", "云南", "中国", 25.0389, 102.7183], ["贵阳", "贵州", "中国", 26.6470, 106.6302],
    ["香港", "香港", "中国", 22.3193, 114.1694], ["澳门", "澳门", "中国", 22.1987, 113.5439], ["台北", "台湾", "中国", 25.0330, 121.5654],
    ["吉隆坡", "吉隆坡联邦直辖区", "马来西亚", 3.1390, 101.6869], ["乔治市", "槟城", "马来西亚", 5.4141, 100.3288],
    ["新山", "柔佛", "马来西亚", 1.4927, 103.7414], ["马六甲市", "马六甲", "马来西亚", 2.1896, 102.2501],
    ["怡保", "霹雳", "马来西亚", 4.5975, 101.0901], ["亚庇", "沙巴", "马来西亚", 5.9804, 116.0735],
    ["新加坡", "", "新加坡", 1.3521, 103.8198], ["曼谷", "", "泰国", 13.7563, 100.5018], ["东京", "东京都", "日本", 35.6762, 139.6503],
    ["大阪", "大阪府", "日本", 34.6937, 135.5023], ["首尔", "", "韩国", 37.5665, 126.9780], ["伦敦", "英格兰", "英国", 51.5074, -0.1278],
    ["巴黎", "法兰西岛", "法国", 48.8566, 2.3522], ["纽约", "纽约州", "美国", 40.7128, -74.0060], ["旧金山", "加利福尼亚州", "美国", 37.7749, -122.4194],
    ["悉尼", "新南威尔士州", "澳大利亚", -33.8688, 151.2093], ["墨尔本", "维多利亚州", "澳大利亚", -37.8136, 144.9631]
  ];
  const blank = () => ({ version: 1, title: "我的足迹地图", records: [] });
  let mine = blank(), guest = blank(), mode = "mine", land = null, selectedCity = null, detailId = null, landFailed = false;
  let avatar = null, avatarBusy = true, activeTimeline = null, activeMarker = null, frameLabel = "", playbackProjection = null, renderedAvatarSource = null, zoom = 1, expanded = false, previousBodyOverflow = "";
  let pan = { lon: 0, lat: 0 }, terrainData = "", terrainPromise = null, gestures = null, editContext = null, pickedPoint = null, resizeObserver = null, resizeFrame = null, pendingResize = false;
  const labelMeasure = document.createElement("canvas").getContext("2d");
  let labelSignature = "";
  const undoStack = [];
  const timelineNodes = new Map(), markerNodes = new Map(), reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let videoFrame = { state: "idle", count: 0, index: 0 }, recording = false;
  const player = { getState: () => videoFrame, pause() {}, reset(items) { videoFrame = { state: "idle", count: items.length, index: 0 }; showPlaybackState(videoFrame); drawPlaybackFrame(videoFrame); } };
  function status(message, error) { $("map-status").textContent = message; $("map-status").dataset.error = error ? "true" : "false"; }
  function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function svg(tag, attributes, text) { const node = document.createElementNS(NS, tag); for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value)); if (text !== undefined) node.textContent = text; return node; }
  function current() { return mode === "mine" ? mine : guest; }
  function updateDraftTools() {
    $("undo-data").disabled = recording || !undoStack.length;
    $("undo-data").title = undoStack.length ? `撤销${undoStack.at(-1).label}` : "暂无可撤销的更改";
    $("clear-data").disabled = recording || !guest.records.length;
  }
  function commitGuest(next, label) {
    const valid = M.validate(next), before = M.json(guest);
    if (before === M.json(valid)) return false;
    undoStack.push({ document: before, label }); if (undoStack.length > 50) undoStack.shift();
    guest = valid; updateDraftTools(); return true;
  }
  function playbackItems() { const records = selectedCity ? current().records.filter(item => M.cityKey(item) === selectedCity) : current().records; return M.sorted(records); }
  function resetPlayback() { player.reset(playbackItems()); window.dispatchEvent(new Event("footprints:reset")); }
  function pausePlayback() { const preview = $("video-preview"); if (preview) preview.pause(); }
  function renderSummary() {
    const all = groups(current().records), visible = all.filter(group => projection().contains(group.item)).length;
    $("map-summary").textContent = `${all.length} 座城市 · ${current().records.length} 段经历${visible < all.length ? ` · 当前视野 ${visible} 座城市` : ""}`;
  }
  function updateZoomTools() {
    if (recording) return;
    const minimum = V.minZoom(baseBounds());
    $("map-zoom-level").textContent = `${Number(zoom.toPrecision(3))}×`;
    $("map-zoom-in").disabled = zoom >= V.MAX_ZOOM - 1e-8; $("map-zoom-out").disabled = zoom <= minimum + 1e-8;
    $("map-zoom-reset").disabled = Math.abs(zoom - 1) < 1e-8 && Math.abs(pan.lon) < 1e-8 && Math.abs(pan.lat) < 1e-8;
  }
  function redrawViewport() {
    pausePlayback(); frameLabel = ""; renderMap(); renderSummary(); updateZoomTools();
  }
  function expandMap(value) {
    if (recording && value) return; pausePlayback(); if (gestures) gestures.reset(); expanded = value;
    const panel = document.querySelector(".map-canvas-panel"); panel.classList.toggle("is-expanded", value);
    $("map-expand").setAttribute("aria-expanded", String(value)); $("map-expanded-close").hidden = !value;
    if (value) { previousBodyOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "足迹地图大图；按 Escape 退出"); $("map-expanded-close").focus({ preventScroll: true }); panel.scrollTop = 0; }
    else { document.body.style.overflow = previousBodyOverflow; panel.removeAttribute("role"); panel.removeAttribute("aria-modal"); panel.removeAttribute("aria-label"); $("map-expand").focus({ preventScroll: true }); }
    renderMap();
  }
  function showPlaybackState(value) {
    const panel = $("playback-panel"); panel.dataset.state = value.state;
    if (value.state === "idle") {
      panel.dataset.recordId = ""; panel.dataset.phase = "stay";
      $("playback-current").replaceChildren();
      if (activeTimeline) { activeTimeline.classList.remove("is-playing"); activeTimeline.removeAttribute("aria-current"); activeTimeline = null; }
      if (activeMarker) { activeMarker.classList.remove("is-playing"); activeMarker = null; }
    } else if (value.phase === "intro") {
      panel.dataset.recordId = ""; panel.dataset.phase = "intro";
      $("playback-current").replaceChildren();
    } else if (value.record && panel.dataset.recordId !== value.record.id) showPlaybackRecord(value);
  }
  function showPlaybackRecord(value) {
    if (value.state === "idle" || !value.record) return;
    const item = value.record, card = $("playback-current");
    card.replaceChildren(element("p", `${value.index + 1} / ${value.count} · ${item.city} · ${item.country}`, "playback-meta"), element("h3", item.derived ? item.frameworkLabel : item.title), element("p", item.derived ? item.dateLabel : `${item.certainty === "approximate" ? "≈ 约略 · " : ""}${M.range(item)}`, "playback-meta"), element("p", item.description || ""));
    if (item.album) { const link = element("a", "查看关联相册 →"); link.href = item.album; card.append(link); }
    if (activeTimeline) { activeTimeline.classList.remove("is-playing"); activeTimeline.removeAttribute("aria-current"); }
    activeTimeline = timelineNodes.get(item.id) || null;
    if (activeTimeline) { activeTimeline.classList.add("is-playing"); activeTimeline.setAttribute("aria-current", "step"); }
    if (activeMarker) activeMarker.classList.remove("is-playing"); activeMarker = markerNodes.get(M.cityKey(item)) || null;
    if (activeMarker) activeMarker.classList.add("is-playing");
    $("playback-panel").dataset.recordId = item.id;
  }
  function drawPlaybackFrame(value) {
    const arrived = value.state === "idle" ? null : value.unlocked instanceof Set ? value.unlocked : new Set();
    for (const [key, node] of markerNodes) { const visible = !arrived || arrived.has(key); node.setAttribute("display", visible ? "inline" : "none"); node.setAttribute("tabindex", visible ? "0" : "-1"); }
    $("footprints-map").dataset.unlockedCount = String(arrived ? arrived.size : groups(current().records).length);
    renderCityLabels(arrived, value.record ? M.cityKey(value.record) : null);
    const pathNode = $("journey-route"), pathPoints = value.cumulativePath || [];
    if (pathNode) {
      const project = playbackProjection || projection(); let d = "", previous = null;
      for (const item of pathPoints) { if (!item || !Number.isFinite(item.lon) || !Number.isFinite(item.lat)) continue; const point = project.point(item.lon, item.lat); d += `${!previous || Math.abs(item.lon - previous.lon) > 180 ? "M" : "L"}${point[0].toFixed(2)},${point[1].toFixed(2)}`; previous = item; }
      pathNode.setAttribute("d", d); pathNode.setAttribute("display", $("map-route").checked ? "inline" : "none");
    }
    const marker = $("playback-avatar"); if (!marker) return;
    const shown = value.state !== "idle" && value.record;
    marker.setAttribute("display", shown ? "inline" : "none"); if (!shown) return;
    let point = value.point || value.record;
    if (!value.point && value.next && !reducedMotion.matches && Math.abs(value.next.lon - point.lon) <= 180) point = P.interpolate(point, value.next, value.progress * value.progress * (3 - 2 * value.progress));
    const project = playbackProjection || projection(), [x, y] = project.point(point.lon, point.lat);
    marker.setAttribute("transform", `translate(${x.toFixed(2)},${y.toFixed(2)})`);
    // Do not repaint the basemap or rebuild the timeline during animation.
    const source = avatar && avatar.getDataUrl(), image = $("playback-avatar-image");
    if (source !== renderedAvatarSource) {
      renderedAvatarSource = source;
      if (source && /^data:image\/png;base64,/.test(source)) { image.setAttribute("href", source); image.setAttribute("display", "inline"); }
      else { image.removeAttribute("href"); image.setAttribute("display", "none"); }
    }
    if (!project.contains(point)) marker.setAttribute("display", "none");
    const label = `${value.state}:${value.index}:${value.phase}:${value.speed}`;
    if (label !== frameLabel) {
      frameLabel = label; $("playback-panel").dataset.phase = value.phase;
      const phase = value.state === "ended" ? "视频生成完成" : value.next ? "移动到下一站" : "当前停留";
      $("playback-progress").textContent = `${value.index + 1} / ${value.count} · ${phase} · ${value.speed}×${project.contains(point) ? "" : " · 地点在当前视野外"}`;
    }
  }
  function groups(records) {
    const result = new Map();
    for (const item of M.sorted(records)) { const key = M.cityKey(item); if (!result.has(key)) result.set(key, { key, item, records: [] }); result.get(key).records.push(item); }
    return Array.from(result.values());
  }
  function mapViewport() {
    const rect = $("map-canvas").getBoundingClientRect();
    return { width: 1000, height: rect.width > 0 && rect.height > 0 ? 1000 * rect.height / rect.width : 600 };
  }
  function baseBounds() {
    let bounds = $("map-view").value === "china" ? [73, 15, 136, 55] : $("map-view").value === "asia" ? [45, -15, 155, 65] : [-180, -90, 180, 90];
    if ($("map-view").value === "fit" && current().records.length) {
      const records = current().records, longitudes = records.map(item => item.lon), latitudes = records.map(item => item.lat);
      const west = Math.min(...longitudes), east = Math.max(...longitudes), south = Math.min(...latitudes), north = Math.max(...latitudes);
      // A wide date-line crossing falls back to the full world instead of guessing a wrap.
      if (east - west <= 180) {
        const padLon = Math.max(2.5, (east - west) * .16), padLat = Math.max(2.5, (north - south) * .16);
        bounds = [Math.max(-180, west - padLon), Math.max(-90, south - padLat), Math.min(180, east + padLon), Math.min(90, north + padLat)];
      }
    }
    const viewport = mapViewport(); return V.aspectBounds(bounds, viewport.width / viewport.height);
  }
  function projection() { return V.projection(V.bounds(baseBounds(), zoom, pan), mapViewport()); }
  function moveCamera(next) {
    const base = baseBounds(), bounds = V.bounds(base, zoom, next);
    pan = { lon: (bounds[0] + bounds[2] - base[0] - base[2]) / 2, lat: (bounds[1] + bounds[3] - base[1] - base[3]) / 2 };
    redrawViewport();
  }
  function zoomCamera(factor, anchor) {
    if (recording) return;
    const next = V.clampZoom(baseBounds(), zoom * factor);
    const adjustment = V.anchoredPan(baseBounds(), zoom, pan, next, anchor || { lon: (projection().bounds[0] + projection().bounds[2]) / 2, lat: (projection().bounds[1] + projection().bounds[3]) / 2 });
    zoom = next; moveCamera(adjustment);
  }
  function geometries(value) {
    if (!value) return [];
    if (value.type === "FeatureCollection") return value.features.flatMap(geometries);
    if (value.type === "Feature") return geometries(value.geometry);
    if (value.type === "GeometryCollection") return value.geometries.flatMap(geometries);
    if (value.type === "Polygon") return [value.coordinates];
    if (value.type === "MultiPolygon") return value.coordinates;
    return [];
  }
  function ringPath(ring, project) {
    let path = "", started = false;
    // The bundled Natural Earth GeoJSON already cuts land at the date line.
    // Preserve its closed rings, including Antarctica's 180 -> -180 edge at
    // latitude -90. Splitting that legitimate polar edge makes SVG implicitly
    // close the fragments with diagonals and cuts triangles out of Antarctica.
    for (const pair of ring) {
      if (!Array.isArray(pair) || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1])) continue;
      const point = project.point(pair[0], pair[1]);
      path += `${started ? "L" : "M"}${point[0].toFixed(2)},${point[1].toFixed(2)}`;
      started = true;
    }
    return path + (started ? "Z" : "");
  }
  function screenScale() {
    const map = $("footprints-map"), matrix = map.getScreenCTM();
    const scale = matrix && Math.hypot(matrix.a, matrix.b);
    return scale > 0 ? scale : Math.max(.12, map.getBoundingClientRect().width / 1000);
  }
  function cityLabelStyle() { const fontSize = Math.max(4, Math.min(48, 13 / screenScale())); return { fontSize, lineHeight: fontSize * 1.28 }; }
  function renderCityLabels(allowed, activeKey) {
    const layer = $("map-label-layer"); if (!layer) return;
    const keys = allowed ? [...allowed] : null, signature = JSON.stringify([$("map-labels").checked, keys, activeKey]);
    if (signature === labelSignature) return; labelSignature = signature;
    layer.replaceChildren(); layer.dataset.count = "0";
    if (!$("map-labels").checked || !L || !labelMeasure) return;
    const project = playbackProjection || projection(), labelStyle = cityLabelStyle(); labelMeasure.font = `${labelStyle.fontSize}px sans-serif`;
    const candidates = groups(current().records).filter(group => project.contains(group.item)).map(group => { const point = project.point(group.item.lon, group.item.lat); return { key: group.key, name: group.item.city, x: point[0], y: point[1], priority: group.key === activeKey ? 1 : 0, markerRadius: group.key === activeKey ? 22 : 4 }; });
    const labels = L.layout(candidates, { width: project.width, height: project.height, visibleSet: allowed || undefined, ...labelStyle, measure: text => labelMeasure.measureText(text).width });
    for (const label of labels) {
      const group = svg("g", { class: "map-city-label", "data-city-key": label.key });
      group.append(svg("text", { x: label.x, y: label.y, style: `font:${labelStyle.fontSize}px sans-serif` }, label.text));
      layer.append(group);
    }
    layer.dataset.count = String(labels.length);
  }
  function renderMap() {
    zoom = V.clampZoom(baseBounds(), zoom); labelSignature = "";
    const map = $("footprints-map"), doc = current(), project = projection(), allGroups = groups(doc.records);
    map.setAttribute("viewBox", `0 0 ${project.width} ${project.height}`);
    playbackProjection = project; markerNodes.clear(); activeMarker = null; renderedAvatarSource = null; frameLabel = "";
    map.replaceChildren(svg("title", { id: "map-svg-title" }, `${doc.title} · 城市足迹示意图`), svg("desc", { id: "map-svg-description" }, "城市中心与各段停留。点击城市或通过 Tab 和回车查看经历。陆地底图无行政边界，非导航地图。"));
    const defs = svg("defs"), clip = svg("clipPath", { id: "footprints-clip" });
    clip.append(svg("rect", { x: project.left, y: project.top, width: project.width, height: project.height })); defs.append(clip);
    const avatarClip = svg("clipPath", { id: "playback-avatar-clip", clipPathUnits: "userSpaceOnUse" }); avatarClip.append(svg("circle", { r: 19 })); defs.append(avatarClip); map.append(defs);
    map.append(svg("rect", { class: "map-water", x: 0, y: 0, width: project.width, height: project.height, fill: "var(--soft)" }));
    const art = svg("g", { "clip-path": "url(#footprints-clip)" });
    let grid = "";
    for (let lon = -180; lon <= 180; lon += 30) { const a = project.point(lon, -90), b = project.point(lon, 90); grid += `M${a}L${b}`; }
    for (let lat = -90; lat <= 90; lat += 30) { const a = project.point(-180, lat), b = project.point(180, lat); grid += `M${a}L${b}`; }
    if ($("map-layer").value === "terrain" && terrainData) {
      const upper = project.point(-180, 90);
      art.append(svg("image", { id: "map-terrain-image", href: terrainData, x: upper[0], y: upper[1], width: 360 * project.scale, height: 180 * project.scale, preserveAspectRatio: "none" }));
    } else {
      art.append(svg("path", { class: "map-graticule", d: grid }));
      if (land) for (const polygon of geometries(land)) art.append(svg("path", { class: "map-land", d: polygon.map(ring => ringPath(ring, project)).join(""), "fill-rule": "evenodd" }));
    }
    art.append(svg("path", { id: "journey-route", class: "map-order", d: "" }));
    map.append(art);
    const visibleCities = allGroups.filter(group => project.contains(group.item));
    const hitRadius = 22 / screenScale();
    for (const city of visibleCities) {
      const item = city.item, point = project.point(item.lon, item.lat), approximate = city.records.some(record => record.certainty === "approximate");
      const marker = svg("g", { class: "map-marker", "data-city-key": city.key, transform: `translate(${point})`, tabindex: "0", role: "button", "aria-label": `${item.city}，${item.country}，${city.records.length} 段经历，查看说明` });
      marker.append(svg("title", {}, `${item.city} · ${item.country}`), svg("circle", { class: "map-hit", r: hitRadius }), svg("circle", { class: "map-dot", r: 3.2 }));
      const onRight = point[0] > project.left + project.width - 160;
      marker.append(svg("text", { class: "map-hover-label", x: onRight ? -10 : 10, y: -10, "text-anchor": onRight ? "end" : "start" }, item.city + (approximate ? " ≈" : "")));
      markerNodes.set(city.key, marker);
      marker.addEventListener("click", event => { if (recording || event.defaultPrevented) return; event.stopPropagation(); chooseNearby(event, city.key); });
      marker.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (!recording) openCityDetails(city.key); } });
      map.append(marker);
    }
    map.append(svg("g", { id: "map-label-layer", "aria-hidden": "true" }));
    const avatarMarker = svg("g", { id: "playback-avatar", class: "map-playback-avatar", display: "none", "aria-hidden": "true" });
    avatarMarker.append(svg("circle", { class: "avatar-ring", r: 22 }), svg("circle", { class: "avatar-fallback", r: 7 }), svg("image", { id: "playback-avatar-image", x: -19, y: -19, width: 38, height: 38, "clip-path": "url(#playback-avatar-clip)", display: "none" })); map.append(avatarMarker);
    if (player) { const value = player.getState(); drawPlaybackFrame(value); if (value.state !== "idle" && value.record) { activeMarker = markerNodes.get(M.cityKey(value.record)); if (activeMarker) activeMarker.classList.add("is-playing"); } }
    updateZoomTools();
  }
  function chooseCity(key) {
    if (recording) return; selectedCity = selectedCity === key ? null : key; render(); $(expanded ? "video-generate" : "timeline-title").focus({ preventScroll: true });
  }
  function renderCities(all) {
    const panel = $("city-filters"); panel.replaceChildren(); panel.hidden = !all.length;
    if (!all.length) return;
    const makeButton = (label, key, accessible) => {
      const button = element("button", label, "city-filter"); button.type = "button";
      button.setAttribute("aria-pressed", String(selectedCity === key)); if (accessible) button.setAttribute("aria-label", accessible);
      button.addEventListener("click", () => chooseCity(key)); panel.append(button);
    };
    makeButton("全部城市", null);
    for (const city of all) {
      const approximate = city.records.some(item => item.certainty === "approximate");
      makeButton(`${city.item.city} · ${city.records.length} 段${approximate ? " ≈" : ""}`, city.key, `${[city.item.city, city.item.region, city.item.country].filter(Boolean).join("，")}，${city.records.length} 段经历${approximate ? "，含约略记录" : ""}`);
    }
  }
  function renderTimeline() {
    const doc = current(), allGroups = groups(doc.records), chosen = selectedCity && allGroups.find(group => group.key === selectedCity);
    if (!chosen) selectedCity = null;
    const items = chosen ? chosen.records : M.sorted(doc.records);
    $("timeline-title").textContent = chosen ? `${chosen.item.city} · ${items.length} 段经历` : "停留时间轴";
    $("timeline-title").tabIndex = -1; $("clear-city").hidden = !chosen;
    const list = $("timeline-list"); list.replaceChildren(); timelineNodes.clear(); activeTimeline = null;
    for (const item of items) {
      const li = element("li"); li.dataset.recordId = item.id;
      timelineNodes.set(item.id, li);
      li.append(element("p", M.range(item), "timeline-date"), element("span", `${item.city} · ${item.country}`, "timeline-place"));
      if (item.certainty === "approximate") li.append(element("span", "约略", "certainty-badge"));
      const heading = element("h3"), open = element("button", item.title, "timeline-open"); open.type = "button"; open.addEventListener("click", () => openDetail(item.id)); heading.append(open); li.append(heading);
      const description = item.description.length > 100 ? item.description.slice(0, 100) + "…" : item.description;
      if (description) li.append(element("p", description, "timeline-description"));
      list.append(li);
    }
    $("empty-state").hidden = items.length > 0;
    $("empty-state").textContent = mode === "visitor" ? "还没有可显示的经历。添加一段停留，或导入自己的足迹文档。" : "尚无已允许展示的经历；待本人核对后再加入。你可以切换到“制作你的地图”记录自己的故事。";
  }
  function render() {
    $("mode-mine").setAttribute("aria-pressed", String(mode === "mine")); $("mode-visitor").setAttribute("aria-pressed", String(mode === "visitor"));
    $("visitor-tools").hidden = mode !== "visitor"; $("map-title").textContent = current().title;
    const all = groups(current().records);
    if (selectedCity && !all.some(city => city.key === selectedCity)) selectedCity = null;
    renderSummary();
    renderCities(all); renderMap(); renderTimeline();
    resetPlayback(); updateDraftTools();
  }
  function openDetail(id) {
    const item = current().records.find(record => record.id === id); if (!item) return;
    pausePlayback();
    detailId = id; $("detail-title").textContent = item.title;
    $("detail-meta").textContent = `${M.range(item)}${item.certainty === "approximate" ? " · 约略" : " · 已证实"}\n${[item.city, item.region, item.country].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ")}`;
    $("detail-description").textContent = item.description || "这段经历尚未填写说明。";
    $("detail-album").hidden = !item.album; if (item.album) $("detail-album").setAttribute("href", item.album); else $("detail-album").removeAttribute("href");
    $("detail-edit-tools").hidden = mode !== "visitor"; $("detail-dialog").showModal();
  }
  function knownCity() {
    const key = $("city-choice").value; if (key === "") return false;
    const city = cities[Number(key)];
    return city && $("record-city").value.trim() === city[0] && $("record-region").value.trim() === city[1] && $("record-country").value.trim() === city[2] && Number($("record-lat").value) === city[3] && Number($("record-lon").value) === city[4];
  }
  function editRecord(id, point) {
    pausePlayback(); if (gestures) gestures.reset(); editContext = { base: guest };
    const item = id && guest.records.find(record => record.id === id);
    $("record-form").reset(); $("record-error").textContent = ""; $("record-dialog-title").textContent = item ? "编辑经历" : mode === "mine" ? "添加到访客草稿" : "添加经历";
    $("record-id").value = item ? item.id : ""; $("record-stay-type").value = item && item.stayType || "visit"; $("record-ongoing").checked = !!(item && item.ongoing);
    for (const key of ["start", "end", "city", "region", "country", "lat", "lon", "title", "description", "album", "certainty"]) $("record-" + key).value = item ? item[key] : key === "certainty" ? "confirmed" : "";
    if (item) {
      const index = cities.findIndex(city => city[0] === item.city && city[1] === item.region && city[2] === item.country && city[3] === item.lat && city[4] === item.lon);
      $("city-choice").value = index < 0 ? "" : String(index); $("coordinate-confirm").checked = index < 0;
    }
    if (point) { $("record-lat").value = point.lat.toFixed(4); $("record-lon").value = point.lon.toFixed(4); $("record-certainty").value = "approximate"; $("coordinate-confirm").checked = false; }
    $("record-dialog").showModal(); $(point ? "record-city" : "record-title").focus();
  }
  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return "stay-" + window.crypto.randomUUID();
    let id; do { id = "stay-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10); } while (guest.records.some(item => item.id === id)); return id;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = element("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function exportSvg(options) {
    const copy = $("footprints-map").cloneNode(true), style = getComputedStyle(document.documentElement), backgroundOnly = options && options.backgroundOnly, mapHeight = projection().height;
    const colors = Object.fromEntries(["paper", "surface", "ink", "muted", "accent", "line", "soft"].map(key => [key, style.getPropertyValue("--" + key).trim()]));
    copy.setAttribute("xmlns", NS); copy.setAttribute("width", "1600"); copy.setAttribute("height", String(Math.round(mapHeight * 1.6)));
    copy.querySelectorAll("[tabindex], [role='button']").forEach(node => { node.removeAttribute("tabindex"); node.removeAttribute("role"); });
    copy.querySelectorAll(".map-svg-note, .map-svg-label, .map-hover-label").forEach(node => node.remove());
    if (backgroundOnly) copy.querySelectorAll(".map-marker, #map-label-layer, #playback-avatar, #journey-route").forEach(node => node.remove());
    copy.querySelectorAll("image").forEach(node => { const href = node.getAttribute("href") || ""; if (!/^data:image\/png;base64,/.test(href) && !(node.id === "map-terrain-image" && /^data:image\/jpeg;base64,/.test(href))) node.remove(); });
    const sheet = svg("style", {}, `.map-water{fill:${colors.soft}}.map-land{fill:${colors.line};stroke:${colors.surface};stroke-width:.6}.map-graticule{fill:none;stroke:${colors.muted};stroke-opacity:.17;stroke-width:.7}.map-order{fill:none;stroke:${colors.accent};stroke-width:1.6;stroke-dasharray:5 5;opacity:.7}.map-marker .map-dot{fill:${colors.accent};stroke:${colors.surface};stroke-width:1.5}.map-marker .map-hit{fill:transparent;stroke:none}.map-playback-avatar .avatar-ring{fill:${colors.surface};stroke:${colors.accent};stroke-width:2.5}.map-playback-avatar .avatar-fallback{fill:${colors.accent}}.map-city-label{pointer-events:none;user-select:none;-webkit-user-select:none}.map-city-label text{fill:${colors.ink};font:14px sans-serif;paint-order:stroke fill;stroke:${colors.surface};stroke-opacity:.82;stroke-width:1.5;stroke-linejoin:round;pointer-events:none}.export-caption{fill:${colors.ink};font:20px sans-serif}.export-caption-date{fill:${colors.accent};font:20px sans-serif}.export-caption-city{fill:${colors.ink};font:bold 26px sans-serif}`);
    copy.insertBefore(sheet, copy.firstChild);
    const item = videoFrame.state !== "idle" ? videoFrame.record : current().records.find(record => record.id === detailId);
    if (!backgroundOnly && item) {
      const lines = []; for (const paragraph of (item.description || "").split("\n")) { const chars = Array.from(paragraph); if (!chars.length) lines.push(""); for (let offset = 0; offset < chars.length; offset += 44) lines.push(chars.slice(offset, offset + 44).join("")); }
      const height = mapHeight + 55 + lines.length * 30;
      copy.setAttribute("viewBox", `0 0 1000 ${height}`); copy.setAttribute("height", String(Math.round(height * 1.6)));
      copy.insertBefore(svg("rect", { x: 0, y: mapHeight, width: 1000, height: height - mapHeight, fill: colors.surface }), copy.lastChild.nextSibling);
      copy.append(svg("text", { class: "export-caption-date", x: 28, y: mapHeight + 28 }, item.derived ? item.dateLabel : M.range(item)));
      copy.append(svg("text", { class: "export-caption-city", x: 28, y: mapHeight + 65 }, item.derived ? `${item.city} · ${item.frameworkLabel}` : item.city));
      lines.forEach((line, index) => copy.append(svg("text", { class: "export-caption", x: 28, y: mapHeight + 104 + index * 30 }, line)));
      const actualHeight = Math.max(height, mapHeight + 130 + lines.length * 30); copy.setAttribute("viewBox", `0 0 1000 ${actualHeight}`); copy.setAttribute("height", String(Math.round(actualHeight * 1.6)));
      // Extend the caption background to the full original-text height.
      const backgrounds = [...copy.children].filter(node => node.tagName === "rect"); backgrounds.at(-1).setAttribute("height", String(actualHeight - mapHeight));
    }
    return new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" });
  }
  async function imageExport(kind) {
    try {
      const source = exportSvg();
      if (kind === "svg") { download(source, "footprints.svg"); status("已导出 SVG 图片，包含当前视野与当前经历原文，底图来源见页面说明。"); return; }
      const url = URL.createObjectURL(source);
      try {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = Math.round(1600 * image.naturalHeight / image.naturalWidth); if (canvas.height > 16384 || canvas.width * canvas.height > 32000000) throw new Error("当前说明太长，请使用 SVG 完整保留原文，或缩短说明后生成 PNG。"); const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器未提供图片画布。"); context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high"; context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png")); if (!blob) throw new Error("浏览器未能生成 PNG。");
        download(blob, "footprints.png"); status("已导出 PNG 图片，包含当前视野与当前经历原文，底图来源见页面说明。");
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { status(`图片导出失败：${error.message} 请尝试 SVG，或使用浏览器截图。`, true); }
  }
  function openCityDetails(key) {
    if (recording) return; pausePlayback(); if (gestures) gestures.reset();
    const city = groups(current().records).find(group => group.key === key); if (!city) return;
    if (city.records.length === 1) { $("city-dialog").close(); openDetail(city.records[0].id); return; }
    $("city-dialog-title").textContent = `${city.item.city} · ${city.records.length} 段经历`;
    const panel = $("city-options"); panel.replaceChildren();
    for (const item of city.records) { const section = element("section"), button = element("button", `${M.range(item)} · ${item.title}`); button.type = "button"; button.addEventListener("click", () => { $("city-dialog").close(); openDetail(item.id); }); section.append(button, element("p", item.description.length > 240 ? item.description.slice(0, 240) + "…" : item.description)); panel.append(section); }
    $("city-dialog").showModal();
  }
  function chooseNearby(event, fallback) {
    const point = V.localPoint($("footprints-map"), event); if (!point) { openCityDetails(fallback); return; }
    const ratio = screenScale(), project = projection();
    const nearby = groups(current().records).map(group => { const p = project.point(group.item.lon, group.item.lat); return { group, distance: Math.hypot(point.x - p[0], point.y - p[1]) * ratio }; }).filter(entry => entry.distance <= 22 && markerNodes.has(entry.group.key) && markerNodes.get(entry.group.key).getAttribute("display") !== "none").sort((a, b) => a.distance - b.distance);
    if (nearby.length < 2) { openCityDetails(nearby[0] ? nearby[0].group.key : fallback); return; }
    $("city-dialog-title").textContent = "这里有多个地点，选择一个查看"; const panel = $("city-options"); panel.replaceChildren();
    for (const entry of nearby) { const button = element("button", `${entry.group.item.city} · ${entry.group.records.length} 段经历`); button.type = "button"; button.addEventListener("click", () => { $("city-dialog").close(); openCityDetails(entry.group.key); }); panel.append(button); }
    $("city-dialog").showModal();
  }
  function pickPlace(point) {
    if (recording || !point || !projection().contains(point)) return;
    pausePlayback(); if (gestures) gestures.reset(); pickedPoint = point;
    editRecord(null, point);
  }
  async function loadTerrain() {
    if (terrainData) return; if (terrainPromise) return terrainPromise;
    terrainPromise = (async () => {
      const response = await fetch("/assets/map-terrain.jpg", { credentials: "same-origin" }); if (!response.ok) throw new Error("本地地形资源无法读取。");
      const blob = await response.blob(); if (blob.size > 8 * 1024 * 1024) throw new Error("地形资源过大。");
      const bytes = new Uint8Array(await blob.arrayBuffer()); if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("地形资源不是有效 JPEG。");
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("无法读取地形图像。")); reader.readAsDataURL(new Blob([bytes], { type: "image/jpeg" })); });
      const image = new Image(); image.src = data; await image.decode(); terrainData = data;
    })().finally(() => { terrainPromise = null; }); return terrainPromise;
  }
  try {
    const raw = JSON.parse($("footprints-data").textContent); mine = M.validate(raw, true);
    if (raw.preview === true || (typeof raw.notice === "string" && raw.notice)) { $("preview-notice").hidden = false; $("preview-notice").textContent = typeof raw.notice === "string" && raw.notice ? raw.notice : "本地预览：经历尚待本人核对，未发布。"; }
  } catch (error) { mine = { version: 1, title: "我的足迹", records: [] }; status(`站点足迹数据暂不可用：${error.message}`, true); }
  cities.forEach((city, index) => { const option = element("option", [city[0], city[1] === city[0] ? "" : city[1], city[2]].filter(Boolean).join(" · ")); option.value = String(index); $("city-choice").append(option); });
  $("mode-mine").addEventListener("click", () => { mode = "mine"; selectedCity = null; status(""); render(); });
  $("mode-visitor").addEventListener("click", () => { mode = "visitor"; selectedCity = null; status(""); render(); });
  $("visitor-title").addEventListener("change", () => { const title = $("visitor-title").value.trim(); if (!title) { $("visitor-title").value = guest.title; status("地图名称不能为空。", true); return; } commitGuest({ ...guest, title }, "地图改名"); render(); });
  $("map-view").addEventListener("change", () => { zoom = 1; pan = { lon: 0, lat: 0 }; redrawViewport(); }); $("map-route").addEventListener("change", renderMap); $("clear-city").addEventListener("click", () => { selectedCity = null; render(); });
  $("map-zoom-in").addEventListener("click", () => zoomCamera(2));
  $("map-zoom-out").addEventListener("click", () => zoomCamera(.5));
  $("map-zoom-reset").addEventListener("click", () => { zoom = 1; pan = { lon: 0, lat: 0 }; redrawViewport(); });
  $("map-expand").addEventListener("click", () => expandMap(true)); $("map-expanded-close").addEventListener("click", () => expandMap(false));
  $("map-download-image").addEventListener("click", () => imageExport("png"));
  document.addEventListener("keydown", event => {
    if (!expanded || document.querySelector("dialog[open]")) return;
    if (event.key === "Escape") { event.preventDefault(); expandMap(false); return; }
    if (event.key !== "Tab") return;
    const panel = document.querySelector(".map-canvas-panel"), nodes = Array.from(panel.querySelectorAll("button:not(:disabled), select, input:not(:disabled), a[href], summary, [tabindex='0']")).filter(node => node.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  function resizeMap() {
    if (recording) { pendingResize = true; return; }
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; renderMap(); renderSummary(); });
  }
  if (window.ResizeObserver) { resizeObserver = new ResizeObserver(resizeMap); resizeObserver.observe($("map-canvas")); }
  else window.addEventListener("resize", resizeMap);
  $("add-record").addEventListener("click", () => editRecord());
  $("undo-data").addEventListener("click", () => {
    if (recording || !undoStack.length) return; pausePlayback();
    const previous = undoStack.pop(); guest = M.parse(previous.document);
    $("visitor-title").value = guest.title; selectedCity = null; render(); status(`已撤销${previous.label}。`);
  });
  $("clear-data").addEventListener("click", () => {
    if (recording || !guest.records.length) return; pausePlayback();
    commitGuest({ ...guest, records: [] }, "清空"); selectedCity = null; render(); status("已清空访客草稿，可撤销。");
  });
  $("city-choice").addEventListener("change", () => {
    const value = $("city-choice").value; $("coordinate-confirm").checked = false; if (value === "") return;
    const city = cities[Number(value)]; ["city", "region", "country", "lat", "lon"].forEach((key, index) => { $("record-" + key).value = city[index]; });
  });
  for (const key of ["city", "region", "country", "lat", "lon"]) $("record-" + key).addEventListener("input", () => { $("city-choice").value = ""; $("coordinate-confirm").checked = false; });
  $("record-close").addEventListener("click", () => $("record-dialog").close()); $("record-cancel").addEventListener("click", () => $("record-dialog").close());
  $("record-form").addEventListener("submit", event => {
    event.preventDefault(); $("record-error").textContent = "";
    try {
      if (!knownCity() && !$("coordinate-confirm").checked) throw new Error("手动地点需要先核对城市、国家 / 区域与城市中心坐标，再勾选确认；不会自动猜测重名城市。");
      const previous = guest.records.find(record => record.id === $("record-id").value);
      const item = { ...(previous || {}), id: $("record-id").value || newId(), stayType: $("record-stay-type").value, ongoing: $("record-ongoing").checked };
      if (item.stayType !== "base") delete item.baseReturn;
      if (item.stayType !== "visit") delete item.returnAfter;
      for (const key of ["start", "end", "city", "region", "country", "title", "description", "album", "certainty"]) item[key] = $("record-" + key).value;
      for (const key of ["lat", "lon"]) { if (!$("record-" + key).value.trim()) throw new Error("请填写城市中心经纬度。"); item[key] = Number($("record-" + key).value); }
      if (!item.title.trim()) item.title = item.city.trim();
      const base = editContext ? editContext.base : guest;
      const records = base.records.slice(), index = records.findIndex(record => record.id === item.id); if (index < 0) records.push(item); else records[index] = item;
      commitGuest({ version: 1, title: base.title, records }, index < 0 ? "添加经历" : "编辑经历"); mode = "visitor"; $("visitor-title").value = guest.title; $("record-dialog").close(); selectedCity = null; render(); status(index < 0 ? "已添加经历。需要保留时，请主动保存或导出。" : "已保存修改。需要保留时，请主动保存或导出。");
    } catch (error) { $("record-error").textContent = error.message; }
  });
  $("detail-close").addEventListener("click", () => $("detail-dialog").close());
  $("detail-edit").addEventListener("click", () => { if (mode !== "visitor") return; $("detail-dialog").close(); editRecord(detailId); });
  $("detail-delete").addEventListener("click", () => { if (mode !== "visitor" || recording) return; commitGuest({ ...guest, records: guest.records.filter(item => item.id !== detailId) }, "移除经历"); $("detail-dialog").close(); render(); status("已移除经历，可撤销。"); });
  $("import-file").addEventListener("change", async () => {
    pausePlayback();
    const file = $("import-file").files[0]; if (!file) return;
    if (file.size > M.MAX_BYTES) { status("文档超过 1 MB，未读取。", true); $("import-file").value = ""; return; }
    try { $("import-text").value = await file.text(); status("文件已载入输入框；点击“验证并合并导入”后才会更改地图。"); } catch (_) { status("无法读取该文件，请重新选择或粘贴文档。", true); }
    $("import-file").value = "";
  });
  $("import-apply").addEventListener("click", () => {
    pausePlayback();
    try { const incoming = M.parse($("import-text").value), result = M.merge(guest, incoming); commitGuest(result.document, "导入"); $("visitor-title").value = guest.title; selectedCity = null; render(); status(`导入完成：新增 ${result.added} 条，跳过相同记录 ${result.skipped} 条。坐标来自文档，请自行核对。`); }
    catch (error) { status(`未导入：${error.message}`, true); }
  });
  $("save-local").addEventListener("click", () => { try { localStorage.setItem(STORAGE_KEY, M.json(guest)); status("已保存到此浏览器。此设备的其他使用者可能读取它；不会自动同步之后的修改。"); } catch (_) { status("本机保存失败，浏览器可能禁用了存储或空间不足。请导出 JSON 或 Markdown 保留草稿。", true); } });
  $("restore-local").addEventListener("click", () => {
    pausePlayback();
    try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) { status("此浏览器尚无保存的足迹。"); return; } const restored = M.parse(raw); commitGuest(restored, "恢复保存的草稿"); $("visitor-title").value = guest.title; selectedCity = null; render(); status("已恢复此浏览器保存的足迹。"); }
    catch (error) { status(`无法恢复本机保存：${error.message} 现有草稿未更改。`, true); }
  });
  $("delete-local").addEventListener("click", () => { try { localStorage.removeItem(STORAGE_KEY); status("已删除此浏览器保存的足迹。当前页面草稿仍在；关闭或刷新后不会自动恢复。"); } catch (_) { status("浏览器未允许删除本机保存，请通过浏览器的网站数据设置清除。", true); } });
  $("export-json").addEventListener("click", () => { download(new Blob([M.json(current())], { type: "application/json;charset=utf-8" }), "footprints.json"); status("已导出恢复用 JSON。文件含你的城市、日期与说明，请自行保管。"); });
  $("export-markdown").addEventListener("click", () => { download(new Blob([M.markdown(current())], { type: "text/markdown;charset=utf-8" }), "footprints.md"); status("已导出 Markdown 足迹文档，可再次导入恢复。"); });
  $("export-svg").addEventListener("click", () => imageExport("svg")); $("export-png").addEventListener("click", () => imageExport("png"));
  document.addEventListener("visibilitychange", () => { if (document.hidden) pausePlayback(); });
  window.addEventListener("pagehide", event => { pausePlayback(); if (!event.persisted) { if (avatar) avatar.dispose(); if (gestures) gestures.dispose(); if (resizeObserver) resizeObserver.disconnect(); if (resizeFrame !== null) cancelAnimationFrame(resizeFrame); } });
  if (window.FootprintsAvatar) {
    avatar = window.FootprintsAvatar.createController({
      defaultUrl: "/assets/map-avatar-default.png",
      onChange(source, state) {
        $("avatar-preview").src = source; $("avatar-preview").hidden = !source;
        $("avatar-status").textContent = state.custom ? "自定义头像" : "雨聊猫";
        $("avatar-status").dataset.error = "false"; $("avatar-download").disabled = !source;
        if (player) drawPlaybackFrame(player.getState());
        window.dispatchEvent(new Event("footprints:avatar"));
      },
      onError(message) { $("avatar-status").textContent = message; $("avatar-status").dataset.error = "true"; },
      onBusy(busy) { avatarBusy = busy; $("avatar-preview").setAttribute("aria-busy", String(busy)); $("avatar-download").disabled = busy || !avatar || !avatar.getDataUrl(); window.dispatchEvent(new Event("footprints:assets")); }
    });
    $("avatar-file").addEventListener("change", async () => { const file = $("avatar-file").files[0]; $("avatar-file").value = ""; if (file) await avatar.loadFile(file); });
    $("avatar-reset").addEventListener("click", () => avatar.reset());
    $("avatar-download").addEventListener("click", () => avatar.download());
  } else { $("avatar-status").textContent = "头像工具未能加载，视频会使用圆点。请刷新页面后重试。"; $("avatar-file").disabled = true; $("avatar-reset").disabled = true; $("avatar-download").disabled = true; }
  $("city-close").addEventListener("click", () => $("city-dialog").close());
  $("record-dialog").addEventListener("close", () => { editContext = null; if (gestures) gestures.reset(); });
  $("map-add-here").addEventListener("click", () => { const b = projection().bounds; pickPlace({ lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 }); });
  $("map-labels").addEventListener("change", () => {
    if (recording) return; pausePlayback();
    try { localStorage.setItem("xieyuqing-footprints-labels-v1", String($("map-labels").checked)); } catch (_) {}
    renderMap(); window.dispatchEvent(new Event("footprints:labels"));
  });
  $("map-layer").addEventListener("change", async () => { pausePlayback(); try { localStorage.setItem("xieyuqing-footprints-layer-v1", $("map-layer").value); } catch (_) {} try { if ($("map-layer").value === "terrain") { status("正在读取本地自然地形图…"); window.dispatchEvent(new Event("footprints:assets")); await loadTerrain(); } redrawViewport(); status(""); } catch (error) { $("map-layer").value = "simple"; redrawViewport(); status(error.message + " 已保留简洁底图，可重试。", true); } finally { window.dispatchEvent(new Event("footprints:assets")); } });
  gestures = V.installGestures({ element: $("footprints-map"), toMapPoint: event => projection().unproject(V.localPoint($("footprints-map"), event), false), onPan: delta => moveCamera({ lon: pan.lon + delta.lon, lat: pan.lat + delta.lat }), onZoom: (factor, anchor) => zoomCamera(factor, anchor), onPick: pickPlace, isMarker: target => !!target.closest(".map-marker"), isEnabled: () => !recording && !document.querySelector("dialog[open]") });
  $("footprints-map").setAttribute("tabindex", "0");
  $("footprints-map").addEventListener("keydown", event => {
    if (recording || event.target !== $("footprints-map")) return;
    const b = projection().bounds, stepLon = (b[2] - b[0]) * .08, stepLat = (b[3] - b[1]) * .08;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) { event.preventDefault(); moveCamera({ lon: pan.lon + (event.key === "ArrowLeft" ? -stepLon : event.key === "ArrowRight" ? stepLon : 0), lat: pan.lat + (event.key === "ArrowUp" ? stepLat : event.key === "ArrowDown" ? -stepLat : 0) }); }
    else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomCamera(2); } else if (event.key === "-") { event.preventDefault(); zoomCamera(.5); }
  });
  window.FootprintsMap = {
    records: playbackItems, document: current, projection, exportSvg, status, labelStyle: cityLabelStyle,
    setFrame(value) { videoFrame = { ...value, speed: 1, state: value.state || "paused" }; showPlaybackState(videoFrame); drawPlaybackFrame(videoFrame); },
    setRecording(value) { recording = value; $("main").dataset.recording = String(value); updateDraftTools(); if (!value && pendingResize) { pendingResize = false; resizeMap(); } },
    avatarSource: () => avatar && avatar.getDataUrl(),
    assetsReady: () => !avatarBusy && !!(avatar && avatar.getDataUrl()) && ($("map-layer").value === "terrain" ? !!terrainData : !!land),
    camera: () => ({ zoom, pan: { ...pan }, bounds: projection().bounds }),
    resetFrame() { player.reset(playbackItems()); }
  };
  try { const preferredLayer = localStorage.getItem("xieyuqing-footprints-layer-v1"); $("map-layer").value = ["simple", "terrain"].includes(preferredLayer) ? preferredLayer : "terrain"; } catch (_) { $("map-layer").value = "terrain"; }
  try { $("map-labels").checked = localStorage.getItem("xieyuqing-footprints-labels-v1") === "true"; } catch (_) {}
  render(); redrawViewport();
  if ($("map-layer").value === "terrain") loadTerrain().then(() => { if ($("map-layer").value === "terrain") renderMap(); window.dispatchEvent(new Event("footprints:assets")); }).catch(error => { $("map-layer").value = "simple"; renderMap(); status(error.message + " 已显示简洁底图，可重试。", true); window.dispatchEvent(new Event("footprints:assets")); });
  fetch("/assets/map-land.json", { credentials: "same-origin" }).then(response => { if (!response.ok) throw new Error("底图读取失败"); return response.json(); }).then(value => { if (!geometries(value).length) throw new Error("底图格式不可用"); land = value; renderMap(); window.dispatchEvent(new Event("footprints:assets")); }).catch(() => { landFailed = true; if ($("map-layer").value === "simple") { renderMap(); status("陆地轮廓暂未加载；城市点和时间轴仍可使用。请通过本地 HTTP 预览打开页面。", true); } });
})();
