(function (root, factory) {
  "use strict";
  const view = factory();
  if (typeof module === "object" && module.exports) module.exports = view;
  else root.FootprintsView = view;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const MAX_ZOOM = 64, DRAG_THRESHOLD = 6;
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function checked(value) {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(finite) || value[0] < -180 || value[2] > 180 || value[1] < -90 || value[3] > 90 || value[0] >= value[2] || value[1] >= value[3]) throw new Error("Invalid geographic bounds");
    return value;
  }
  // A preset is a starting camera, not a zoom boundary. At the widest view one
  // axis reaches Earth's edge; the other can still pan without wrapping.
  function minZoom(base) {
    checked(base);
    return Math.max(Number.MIN_VALUE, (base[2] - base[0]) / 360, (base[3] - base[1]) / 180);
  }
  function clampZoom(base, value) {
    const number = Number(value), minimum = minZoom(base);
    return clamp(Number.isNaN(number) ? 1 : number, minimum, MAX_ZOOM);
  }
  function zoom(value, base = [-180, -90, 180, 90]) { return clampZoom(base, value); }
  // Make the camera match its viewport before applying pan and zoom. Expand
  // normally; only a request larger than Earth needs a centered cover crop.
  // This changes the visible window, never the underlying geographic data.
  function aspectBounds(value, aspect = 1000 / 600) {
    const area = checked(value);
    if (!finite(aspect) || aspect <= 0) throw new Error("Invalid viewport aspect ratio");
    let width = area[2] - area[0], height = area[3] - area[1];
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
    if (!finite(width) || !finite(height)) throw new Error("Invalid viewport aspect ratio");
    const fit = Math.min(1, 360 / width, 180 / height); width *= fit; height *= fit;
    const lon = clamp((area[0] + area[2]) / 2, -180 + width / 2, 180 - width / 2);
    const lat = clamp((area[1] + area[3]) / 2, -90 + height / 2, 90 - height / 2);
    return checked([Math.max(-180, lon - width / 2), Math.max(-90, lat - height / 2), Math.min(180, lon + width / 2), Math.min(90, lat + height / 2)]);
  }
  // Pan is a geographic offset from the original bounds' center. No wrapping or
  // changing coastlines is involved, and the visible rectangle stays on Earth.
  function bounds(base, factor, pan) {
    checked(base); const z = clampZoom(base, factor), offset = pan || {};
    // Roundoff at the global minimum must not create a coordinate just beyond
    // +/-180 or +/-90, which the next projection correctly rejects.
    const halfWidth = Math.min(180, (base[2] - base[0]) / (2 * z)), halfHeight = Math.min(90, (base[3] - base[1]) / (2 * z));
    const lon = clamp((base[0] + base[2]) / 2 + (finite(offset.lon) ? offset.lon : 0), -180 + halfWidth, 180 - halfWidth);
    const lat = clamp((base[1] + base[3]) / 2 + (finite(offset.lat) ? offset.lat : 0), -90 + halfHeight, 90 - halfHeight);
    return [Math.max(-180, lon - halfWidth), Math.max(-90, lat - halfHeight), Math.min(180, lon + halfWidth), Math.min(90, lat + halfHeight)];
  }
  function anchoredPan(base, oldZoom, pan, newZoom, anchor) {
    const before = bounds(base, oldZoom, pan), after = bounds(base, newZoom, pan);
    if (!anchor || !finite(anchor.lon) || !finite(anchor.lat)) return { lon: (after[0] + after[2] - base[0] - base[2]) / 2, lat: (after[1] + after[3] - base[1] - base[3]) / 2 };
    const width = after[2] - after[0], height = after[3] - after[1];
    const desired = {
      lon: anchor.lon - (anchor.lon - before[0]) / (before[2] - before[0]) * width + width / 2 - (base[0] + base[2]) / 2,
      lat: anchor.lat - (anchor.lat - before[1]) / (before[3] - before[1]) * height + height / 2 - (base[1] + base[3]) / 2
    };
    const result = bounds(base, newZoom, desired);
    return { lon: (result[0] + result[2] - base[0] - base[2]) / 2, lat: (result[1] + result[3] - base[1] - base[3]) / 2 };
  }
  // Uniform geographic scale fills the entire SVG. Camera callers normalize
  // their base with aspectBounds too, keeping wheel anchors and clamps exact.
  function projection(value, viewport = { width: 1000, height: 600 }) {
    const { width, height } = viewport;
    if (!finite(width) || !finite(height) || width <= 0 || height <= 0) throw new Error("Invalid viewport size");
    const area = aspectBounds(value, width / height), scale = width / (area[2] - area[0]);
    const left = 0, top = 0;
    function point(lon, lat) { return [left + (lon - area[0]) * scale, top + (area[3] - lat) * scale]; }
    function contains(item) { return !!item && finite(item.lon) && finite(item.lat) && item.lon >= area[0] && item.lon <= area[2] && item.lat >= area[1] && item.lat <= area[3]; }
    function unproject(value, requireInside = true) {
      const x = Array.isArray(value) ? value[0] : value && value.x, y = Array.isArray(value) ? value[1] : value && value.y;
      if (!finite(x) || !finite(y) || (requireInside && (x < left || x > left + width || y < top || y > top + height))) return null;
      return { lon: area[0] + (x - left) / scale, lat: area[3] - (y - top) / scale };
    }
    return { bounds: area, scale, left, top, width, height, point, contains, unproject };
  }
  function localPoint(element, event) {
    if (!element || !event || !finite(event.clientX) || !finite(event.clientY)) return null;
    // The browser matrix accounts for CSS sizing, scroll, and SVG letterboxing.
    try {
      if (element.createSVGPoint && element.getScreenCTM) {
        const matrix = element.getScreenCTM();
        if (matrix) { const point = element.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const transformed = point.matrixTransform(matrix.inverse()); return finite(transformed.x) && finite(transformed.y) ? { x: transformed.x, y: transformed.y } : null; }
      }
    } catch (_) { /* A detached SVG can lack a usable screen matrix. */ }
    if (!element.getBoundingClientRect) return null;
    const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    const vb = element.viewBox && element.viewBox.baseVal || { x: 0, y: 0, width: 1000, height: 600 };
    const value = element.getAttribute && element.getAttribute("preserveAspectRatio") || "xMidYMid meet";
    const rawX = event.clientX - rect.left, rawY = event.clientY - rect.top;
    if (/\bnone\b/.test(value)) return { x: vb.x + rawX / rect.width * vb.width, y: vb.y + rawY / rect.height * vb.height };
    const scale = /\bslice\b/.test(value) ? Math.max(rect.width / vb.width, rect.height / vb.height) : Math.min(rect.width / vb.width, rect.height / vb.height);
    const alignX = /xMin/.test(value) ? 0 : /xMax/.test(value) ? 1 : .5, alignY = /YMin/.test(value) ? 0 : /YMax/.test(value) ? 1 : .5;
    return { x: vb.x + (rawX - (rect.width - vb.width * scale) * alignX) / scale, y: vb.y + (rawY - (rect.height - vb.height * scale) * alignY) / scale };
  }
  function installGestures(options) {
    const o = options || {}, element = o.element;
    if (!element || !element.addEventListener || typeof o.toMapPoint !== "function") throw new Error("Map gesture element and coordinate conversion are required");
    const surface = element.ownerDocument && element.ownerDocument.addEventListener ? element.ownerDocument : element;
    const enabled = () => !o.isEnabled || o.isEnabled();
    const marker = target => o.isMarker ? o.isMarker(target) : !!(target && target.closest && target.closest('[role="button"],button,a'));
    const points = new Map(), captures = new Set(), removers = [];
    let previous = null, start = null, dragged = false, pinching = false, suppressUntil = 0, pickSuppressUntil = 0, disposed = false;
    const oldTouchAction = element.style && element.style.touchAction;
    if (element.style) element.style.touchAction = "none";
    const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    const client = event => ({ clientX: event.clientX, clientY: event.clientY });
    const valid = point => point && finite(point.lon) && finite(point.lat);
    function capture(id) { try { if (element.setPointerCapture) { element.setPointerCapture(id); captures.add(id); } } catch (_) { /* Pointer may have ended. */ } }
    function release(id) { try { if (captures.has(id) && element.releasePointerCapture) element.releasePointerCapture(id); } catch (_) { /* Already released by the browser. */ } captures.delete(id); }
    function clear() { for (const id of captures) release(id); points.clear(); previous = start = null; dragged = pinching = false; }
    function midAndDistance() { const pair = Array.from(points.values()).slice(0, 2), a = pair[0], b = pair[1]; return { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2, distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) }; }
    function pan(from, to, event) {
      const a = o.toMapPoint(from), b = o.toMapPoint(to);
      if (valid(a) && valid(b) && o.onPan) o.onPan({ lon: a.lon - b.lon, lat: a.lat - b.lat }, event);
    }
    function down(event) {
      if (disposed || !enabled() || (event.button !== undefined && event.button !== 0) || !finite(event.clientX) || !finite(event.clientY)) return;
      if (!points.size) { suppressUntil = 0; start = previous = client(event); dragged = pinching = false; }
      points.set(event.pointerId, client(event));
      if (points.size >= 2) { pinching = dragged = true; previous = midAndDistance(); for (const id of points.keys()) capture(id); if (event.cancelable) event.preventDefault(); }
    }
    function move(event) {
      if (!points.has(event.pointerId) || disposed) return;
      if (!enabled()) { clear(); return; }
      points.set(event.pointerId, client(event));
      if (points.size >= 2) {
        const current = midAndDistance(); pan(previous, current, event);
        const anchor = o.toMapPoint(current), factor = previous.distance > 0 ? clamp(current.distance / previous.distance, .25, 4) : 1;
        if (valid(anchor) && o.onZoom && factor !== 1) o.onZoom(factor, anchor, event);
        previous = current; if (event.cancelable) event.preventDefault(); return;
      }
      const current = client(event);
      if (!dragged && Math.hypot(current.clientX - start.clientX, current.clientY - start.clientY) < (o.dragThreshold || DRAG_THRESHOLD)) return;
      if (!dragged) { dragged = true; capture(event.pointerId); }
      pan(previous, current, event); previous = current;
      if (event.cancelable) event.preventDefault();
    }
    function up(event) {
      if (!points.has(event.pointerId) || disposed) return;
      // The final move may be coalesced or omitted when a busy SVG redraws.
      // Judge the release coordinates as well, never turning that drag into a tap.
      if (!dragged && start && Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) >= (o.dragThreshold || DRAG_THRESHOLD)) dragged = true;
      if (dragged && !pinching && points.size === 1 && previous && enabled() && (previous.clientX !== event.clientX || previous.clientY !== event.clientY)) pan(previous, event, event);
      const wasDragged = dragged || pinching;
      points.delete(event.pointerId); release(event.pointerId);
      if (wasDragged) suppressUntil = pickSuppressUntil = now() + 700;
      if (points.size) { previous = start = Array.from(points.values())[0]; dragged = true; pinching = false; return; }
      clear();
    }
    function cancel() { if (points.size) suppressUntil = now() + 700; pickSuppressUntil = now() + 700; clear(); }
    function click(event) {
      // Keep keyboard activation accessible; only the click synthesized after a
      // drag/pinch is consumed, before a marker's ordinary click listener runs.
      if (event.detail !== 0 && now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }
    function doubleClick(event) {
      // A blank single click only ends a gesture. The browser's one dblclick
      // event is the sole add action, and cannot also start native zoom/select.
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      if (disposed || !enabled() || points.size || marker(event.target) || (event.button !== undefined && event.button !== 0) || now() < pickSuppressUntil) return;
      const point = o.toMapPoint(event);
      if (!valid(point)) return;
      // Keep the camera gesture guard separate from synthesized-click blocking:
      // a new pointerdown may allow city clicks, but must not turn a recent
      // drag, pinch, wheel, or dialog reset into a blank-map double click.
      pickSuppressUntil = now() + 350;
      if (o.onPick) o.onPick(point, event);
    }
    function wheel(event) {
      if (disposed || !enabled() || !finite(event.deltaY) || !event.deltaY) return;
      const anchor = o.toMapPoint(event); if (!valid(anchor)) return;
      if (event.cancelable) event.preventDefault();
      pickSuppressUntil = now() + 400;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, element.clientHeight || 400) : 1;
      if (o.onZoom) o.onZoom(Math.exp(-clamp(event.deltaY * unit, -240, 240) * .002), anchor, event);
    }
    function listen(target, name, callback, options) { target.addEventListener(name, callback, options); removers.push(() => target.removeEventListener(name, callback, options)); }
    listen(element, "pointerdown", down); listen(surface, "pointermove", move); listen(surface, "pointerup", up); listen(surface, "pointercancel", cancel);
    listen(element, "click", click, true); listen(element, "dblclick", doubleClick); listen(element, "wheel", wheel, { passive: false });
    return { reset: cancel, dispose() { if (disposed) return; cancel(); disposed = true; removers.forEach(remove => remove()); if (element.style) element.style.touchAction = oldTouchAction; } };
  }
  return { MAX_ZOOM, DRAG_THRESHOLD, zoom, minZoom, clampZoom, aspectBounds, bounds, anchoredPan, projection, localPoint, installGestures };
});
