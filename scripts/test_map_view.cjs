"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const V = require("../home/assets/map-view.js");
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
const base = [73, 15, 136, 55];
function element() {
  const handlers = new Map();
  return {
    handlers, style: { touchAction: "auto" }, captures: new Set(),
    addEventListener(name, handler) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); },
    removeEventListener(name, handler) { handlers.set(name, (handlers.get(name) || []).filter(value => value !== handler)); },
    setPointerCapture(id) { this.captures.add(id); }, releasePointerCapture(id) { this.captures.delete(id); },
    fire(name, values = {}) {
      const event = Object.assign({ pointerId: 1, clientX: 100, clientY: 100, target: { marker: false }, button: 0, detail: 1, cancelable: true, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } }, values);
      for (const handler of handlers.get(name) || []) { handler(event); if (event.stopped) break; } return event;
    }
  };
}
function gesture() {
  const node = element(), log = [], document = element(); node.ownerDocument = document;
  let active = true;
  const handle = V.installGestures({ element: node, toMapPoint: event => ({ lon: event.clientX / 10, lat: -event.clientY / 10 }), isEnabled: () => active, isMarker: target => target.marker, onPan: value => log.push(["pan", value]), onZoom: (factor, anchor) => log.push(["zoom", factor, anchor]), onPick: point => log.push(["pick", point]) });
  return { node, document, handle, log, disable() { active = false; } };
}
test("geographic camera clamps without wrapping and preserves source bounds", () => {
  assert.deepEqual(V.bounds([-180, -90, 180, 90], 1, { lon: 80, lat: 50 }), [-180, -90, 180, 90]);
  assert.deepEqual(V.bounds([-180, -90, 180, 90], 2, { lon: 500, lat: -500 }), [0, -90, 180, 0]);
  const b = V.bounds(base, 4, { lon: 2, lat: 3 }); assert.deepEqual(b, [98.625, 33, 114.375, 43]); assert.deepEqual(base, [73, 15, 136, 55]);
  assert.equal(V.zoom(100), V.MAX_ZOOM); assert.equal(V.zoom(.5), 1); assert.throws(() => V.bounds([136, 15, 73, 55], 1));
});
test("inverse projection remains exact after pan/zoom, including edge coordinates", () => {
  const p = V.projection(V.bounds(V.aspectBounds(base), 8, { lon: 8, lat: -3 }));
  for (const point of [{ lon: 112.5, lat: 32 }, { lon: p.bounds[0], lat: p.bounds[3] }, { lon: p.bounds[2], lat: p.bounds[1] }]) {
    const inverse = p.unproject(p.point(point.lon, point.lat)); near(inverse.lon, point.lon); near(inverse.lat, point.lat);
  }
  assert.ok(p.unproject([500, 599])); assert.equal(p.unproject([500, 601]), null); assert.ok(p.unproject([500, 601], false));
});
test("anchored wheel zoom preserves geographic point's SVG location", () => {
  const normalized = V.aspectBounds(base), pan = { lon: 4, lat: -3 }, anchor = { lon: 110, lat: 33 }, p = V.projection(V.bounds(normalized, 2, pan));
  const next = V.anchoredPan(normalized, 2, pan, 4, anchor), q = V.projection(V.bounds(normalized, 4, next));
  const a = p.point(anchor.lon, anchor.lat), b = q.point(anchor.lon, anchor.lat); near(a[0], b[0]); near(a[1], b[1]);
  const edge = V.bounds(base, 16, V.anchoredPan(base, 2, { lon: 1000, lat: 1000 }, 16, { lon: 180, lat: 90 })); assert.ok(edge[2] <= 180 && edge[3] <= 90);
});
test("normal aspect matching expands geographic bounds and leaves the source intact", () => {
  const normalized = V.aspectBounds(base), ratio = (normalized[2] - normalized[0]) / (normalized[3] - normalized[1]);
  near(ratio, 5 / 3); assert.ok(normalized[0] <= base[0] && normalized[2] >= base[2]); assert.ok(normalized[1] <= base[1] && normalized[3] >= base[3]);
  assert.deepEqual(base, [73, 15, 136, 55]);
  for (const edge of [[170, 70, 179, 89], [-179, -89, -170, -70], [-180, -2, -179, 2]]) {
    const fitted = V.aspectBounds(edge); assert.ok(fitted[0] >= -180 && fitted[2] <= 180 && fitted[1] >= -90 && fitted[3] <= 90);
    assert.ok(fitted[0] <= edge[0] && fitted[2] >= edge[2] && fitted[1] <= edge[1] && fitted[3] >= edge[3]);
    near((fitted[2] - fitted[0]) / (fitted[3] - fitted[1]), 5 / 3);
  }
  assert.throws(() => V.aspectBounds(base, 0)); assert.throws(() => V.aspectBounds(base, Infinity));
});
test("global cover remains on Earth and can pan to either edge without wrapping", () => {
  const global = V.aspectBounds([-180, -90, 180, 90]); assert.deepEqual(global, [-150, -90, 150, 90]);
  assert.deepEqual(V.bounds(global, 1, { lon: 1000 }), [-120, -90, 180, 90]);
  assert.deepEqual(V.bounds(global, 1, { lon: -1000 }), [-180, -90, 120, 90]);
  assert.deepEqual(V.aspectBounds([-180, -90, 180, 90], 2), [-180, -90, 180, 90]);
});
test("China is only an initial view and zooms continuously out to a global cover", () => {
  const normalized = V.aspectBounds(base), minimum = V.minZoom(normalized);
  near(minimum, 40 / 180); assert.ok(minimum < 1);
  const initial = V.bounds(normalized, 1), wider = V.bounds(normalized, .5), global = V.bounds(normalized, 0);
  near(wider[2] - wider[0], (initial[2] - initial[0]) * 2);
  near(global[3] - global[1], 180); near(global[2] - global[0], 300);
  assert.ok(global[0] >= -180 && global[2] <= 180); near(global[1], -90); near(global[3], 90);
  V.bounds(normalized, minimum, { lon: -1000, lat: 1000 }).forEach((value, i) => near(value, [-180, -90, 120, 90][i]));
  V.bounds(normalized, minimum, { lon: 1000, lat: -1000 }).forEach((value, i) => near(value, [-120, -90, 180, 90][i]));
});
test("zoom limits remain finite for unusual inputs and preserve viewport aspect", () => {
  for (const aspect of [5 / 3, 390 / 600, 3, 2]) {
    const normalized = V.aspectBounds(base, aspect), minimum = V.minZoom(normalized);
    for (const factor of [undefined, NaN, Infinity, -Infinity, 0, -1, .01, .5, 1, 64, 500]) {
      const z = V.clampZoom(normalized, factor), area = V.bounds(normalized, factor, { lon: NaN, lat: Infinity });
      assert.ok(Number.isFinite(z) && z >= minimum && z <= V.MAX_ZOOM);
      assert.ok(area.every(Number.isFinite)); assert.ok(area[0] >= -180 && area[2] <= 180 && area[1] >= -90 && area[3] <= 90);
      near((area[2] - area[0]) / (area[3] - area[1]), aspect);
    }
  }
  near(V.zoom(.5, V.aspectBounds(base)), .5); assert.equal(V.MAX_ZOOM, 64);
  assert.throws(() => V.minZoom([0, 0, Infinity, 1]));
});
test("repeated anchored zoom across the initial preset scale keeps the cursor fixed", () => {
  const normalized = V.aspectBounds(base), viewport = { width: 1000, height: 600 };
  let factor = 1, pan = { lon: -40, lat: -25 };
  const cursor = [670, 240];
  for (const multiplier of [.8, .8, .8, .8, 1.2, 1.2, 1.2, 1.2]) {
    const before = V.projection(V.bounds(normalized, factor, pan), viewport), anchor = before.unproject(cursor), next = V.clampZoom(normalized, factor * multiplier);
    pan = V.anchoredPan(normalized, factor, pan, next, anchor); factor = next;
    const after = V.projection(V.bounds(normalized, factor, pan), viewport), point = after.point(anchor.lon, anchor.lat);
    near(point[0], cursor[0]); near(point[1], cursor[1]);
  }
  assert.ok(factor < 1);
});
test("anchored zoom uses actual clamped factors at both zoom limits", () => {
  const normalized = V.aspectBounds(base), minimum = V.minZoom(normalized);
  const pan = { lon: -40, lat: -25 }, anchor = { lon: 60, lat: 10 };
  const maximum = V.anchoredPan(normalized, 4, pan, Infinity, anchor);
  assert.deepEqual(maximum, V.anchoredPan(normalized, 4, pan, V.MAX_ZOOM, anchor));
  const global = V.anchoredPan(normalized, .5, pan, 0, anchor);
  assert.deepEqual(global, V.anchoredPan(normalized, .5, pan, minimum, anchor));
  const edge = V.bounds(normalized, 0, global); assert.ok(edge.every(Number.isFinite)); assert.ok(edge[0] >= -180 && edge[2] <= 180 && edge[1] >= -90 && edge[3] <= 90);
});
test("minimum zoom at arbitrary viewport aspects never exceeds Earth's numeric edges", () => {
  for (const aspect of [2.652167944015387, 1.2148278594812492, .6824115300794575, .3, 4.3]) {
    const normalized = V.aspectBounds(base, aspect), minimum = V.minZoom(normalized);
    for (const lon of [-1000, -20.605015109716685, 0, 1000]) for (const lat of [-1000, 0, 1000]) {
      const area = V.bounds(normalized, minimum, { lon, lat });
      assert.ok(area[0] >= -180 && area[2] <= 180 && area[1] >= -90 && area[3] <= 90);
      const p = V.projection(area, { width: 1000, height: 1000 / aspect });
      assert.ok(Number.isFinite(p.scale)); near((p.bounds[2] - p.bounds[0]) / (p.bounds[3] - p.bounds[1]), aspect);
    }
  }
});
test("full-bleed projection maps all four viewport corners with one uniform scale", () => {
  for (const viewport of [{ width: 1000, height: 600 }, { width: 1000, height: 1450 }, { width: 1000, height: 320 }]) {
    const fitted = V.aspectBounds(base, viewport.width / viewport.height), p = V.projection(V.bounds(fitted, 4, { lon: 2, lat: -1 }), viewport);
    assert.equal(p.left, 0); assert.equal(p.top, 0); assert.equal(p.width, viewport.width); assert.equal(p.height, viewport.height);
    const corners = [[0, 0, p.bounds[0], p.bounds[3]], [viewport.width, 0, p.bounds[2], p.bounds[3]], [0, viewport.height, p.bounds[0], p.bounds[1]], [viewport.width, viewport.height, p.bounds[2], p.bounds[1]]];
    for (const [x, y, lon, lat] of corners) { const actual = p.point(lon, lat), inverse = p.unproject([x, y]); near(actual[0], x); near(actual[1], y); near(inverse.lon, lon); near(inverse.lat, lat); }
    const origin = p.point(110, 30), east = p.point(111, 30), north = p.point(110, 31); near(east[0] - origin[0], origin[1] - north[1]);
    assert.equal(p.unproject([-1, 0]), null); assert.equal(p.unproject([0, viewport.height + 1]), null);
  }
  assert.throws(() => V.projection(base, { width: 0, height: 600 }));
});
test("resizing then panning and anchored zooming keeps pointer coordinates and export geometry aligned", () => {
  let pan = { lon: 4, lat: -3 }, zoom = 2;
  for (const rect of [{ left: 12, top: 60, width: 960, height: 510 }, { left: 8, top: 80, width: 374, height: 390 }, { left: 20, top: 12, width: 1320, height: 690 }]) {
    const viewport = { width: 1000, height: 1000 * rect.height / rect.width }, normalized = V.aspectBounds(base, viewport.width / viewport.height);
    const node = { getBoundingClientRect: () => rect, viewBox: { baseVal: { x: 0, y: 0, ...viewport } }, getAttribute: () => "xMidYMid meet" };
    const client = { clientX: rect.left + rect.width * .62, clientY: rect.top + rect.height * .4 }, point = V.localPoint(node, client), before = V.projection(V.bounds(normalized, zoom, pan), viewport), anchor = before.unproject(point);
    near(point.x, 620); near(point.y, viewport.height * .4); assert.ok(before.contains(anchor));
    const next = V.anchoredPan(normalized, zoom, pan, zoom + .5, anchor), after = V.projection(V.bounds(normalized, zoom + .5, next), viewport), projected = after.point(anchor.lon, anchor.lat);
    near(projected[0], point.x); near(projected[1], point.y); const inverse = after.unproject(projected); near(inverse.lon, anchor.lon); near(inverse.lat, anchor.lat);
    pan = { lon: next.lon + 1, lat: next.lat - 1 }; zoom += .5;
    const moved = V.projection(V.bounds(normalized, zoom, pan), viewport), moveInverse = moved.unproject(moved.point(anchor.lon, anchor.lat), false); near(moveInverse.lon, anchor.lon); near(moveInverse.lat, anchor.lat);
  }
});
test("responsive SVG fallback respects xMidYMid letterboxing and CSS scroll offset", () => {
  const node = { getBoundingClientRect: () => ({ left: 20, top: 40, width: 390, height: 400 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 600 } }, getAttribute: () => "xMidYMid meet" };
  const center = V.localPoint(node, { clientX: 215, clientY: 240 }); near(center.x, 500); near(center.y, 300);
  const top = V.localPoint(node, { clientX: 20, clientY: 123 }); near(top.x, 0); near(top.y, 0);
  node.getAttribute = () => "none"; const stretched = V.localPoint(node, { clientX: 215, clientY: 140 }); near(stretched.x, 500); near(stretched.y, 150);
});
test("browser SVG matrix conversion takes precedence over rectangle fallback", () => {
  const matrix = {}, node = { getScreenCTM: () => ({ inverse: () => matrix }), createSVGPoint: () => ({ matrixTransform(value) { assert.equal(value, matrix); return { x: 123, y: 456 }; } }) };
  assert.deepEqual(V.localPoint(node, { clientX: 10, clientY: 20 }), { x: 123, y: 456 });
});
test("blank single clicks do nothing; one double click picks exactly once without zoom", () => {
  const t = gesture();
  for (let i = 0; i < 2; i++) { t.node.fire("pointerdown"); t.document.fire("pointerup"); assert.equal(t.node.fire("click", { detail: i + 1 }).stopped, undefined); }
  assert.equal(t.log.length, 0);
  const event = t.node.fire("dblclick", { detail: 2 });
  assert.deepEqual(t.log, [["pick", { lon: 10, lat: -10 }]]); assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 1, "a duplicate immediate double-click event cannot add again");
});
test("marker single clicks remain available to details and marker double clicks never add", () => {
  const t = gesture(), target = { marker: true };
  t.node.fire("pointerdown", { target }); t.document.fire("pointerup", { target });
  assert.equal(t.node.fire("click", { target }).stopped, undefined); assert.equal(t.node.fire("click", { target, detail: 0 }).stopped, undefined);
  const double = t.node.fire("dblclick", { target, detail: 2 }); assert.equal(double.prevented, true); assert.equal(double.stopped, true); assert.equal(t.log.length, 0);
});
test("subthreshold jitter does not add; drag pans and suppresses a trailing double click", () => {
  const t = gesture(); t.node.fire("pointerdown"); t.document.fire("pointermove", { clientX: 103 }); t.document.fire("pointerup", { clientX: 103 }); assert.equal(t.log.length, 0);
  t.log.length = 0; t.node.fire("pointerdown"); t.document.fire("pointermove", { clientX: 120, clientY: 110 }); t.document.fire("pointermove", { clientX: 140, clientY: 110 }); t.document.fire("pointerup", { clientX: 140, clientY: 110 });
  assert.deepEqual(t.log, [["pan", { lon: -2, lat: 1 }], ["pan", { lon: -2, lat: 0 }]]); assert.equal(t.node.captures.size, 0); assert.equal(t.node.fire("click").stopped, true); assert.equal(t.node.fire("click", { detail: 0 }).stopped, undefined);
  t.node.fire("pointerdown"); t.document.fire("pointerup"); assert.equal(t.node.fire("click").stopped, undefined, "a new deliberate tap allows a city's ordinary click");
  assert.equal(t.node.fire("dblclick", { detail: 2 }).prevented, true); assert.ok(!t.log.some(item => item[0] === "pick"), "a fresh pointerdown cannot clear the recent-drag add guard");
});
test("marker-origin drag consumes its click before marker detail handlers", () => {
  const t = gesture(); t.node.fire("pointerdown", { target: { marker: true } }); t.document.fire("pointermove", { clientX: 130 }); t.document.fire("pointerup", { clientX: 130 });
  assert.equal(t.log.length, 1); assert.equal(t.log[0][0], "pan"); const click = t.node.fire("click", { target: { marker: true } }); assert.equal(click.stopped, true); assert.equal(click.prevented, true);
});
test("a coalesced final pointer move cannot become an empty-map add", () => {
  const t = gesture(); t.node.fire("pointerdown"); t.document.fire("pointerup", { clientX: 130 }); assert.deepEqual(t.log, [["pan", { lon: -3, lat: 0 }]]); assert.equal(t.node.fire("click").stopped, true);
  t.node.fire("dblclick", { detail: 2, clientX: 130 }); assert.equal(t.log.length, 1);
});
test("wheel zoom supplies actual cursor world anchor and obeys disabled state", () => {
  const t = gesture(); const event = t.node.fire("wheel", { deltaY: -100 }); assert.equal(event.prevented, true); assert.ok(t.log[0][1] > 1); assert.deepEqual(t.log[0][2], { lon: 10, lat: -10 });
  t.node.fire("pointerdown"); t.document.fire("pointerup"); t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 1, "a wheel followed by a trailing double click does not add");
  t.disable(); t.node.fire("wheel", { deltaY: 100 }); t.node.fire("pointerdown"); t.document.fire("pointerup"); assert.equal(t.log.length, 1);
  t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 1);
});
test("wheel line and page units normalize consistently with bounded per-event zoom", () => {
  const t = gesture(); t.node.clientHeight = 600;
  t.node.fire("wheel", { deltaY: -3, deltaMode: 1 }); t.node.fire("wheel", { deltaY: -48, deltaMode: 0 });
  near(t.log[0][1], t.log[1][1]);
  t.node.fire("wheel", { deltaY: -1, deltaMode: 2 }); t.node.fire("wheel", { deltaY: -1e10 });
  near(t.log[2][1], Math.exp(.48)); near(t.log[3][1], Math.exp(.48));
  const zero = t.node.fire("wheel", { deltaY: 0 }), invalid = t.node.fire("wheel", { deltaY: NaN });
  assert.equal(zero.prevented, undefined); assert.equal(invalid.prevented, undefined); assert.equal(t.log.length, 4);
});
test("wheel listeners stay on the map and leave page scrolling untouched", () => {
  const t = gesture(); assert.equal(t.document.handlers.has("wheel"), false);
  const outside = t.document.fire("wheel", { deltaY: 100 }); assert.equal(outside.prevented, undefined); assert.equal(t.log.length, 0);
  const inside = t.node.fire("wheel", { deltaY: 100 }); assert.equal(inside.prevented, true); assert.equal(t.log.length, 1);
  t.disable(); const disabled = t.node.fire("wheel", { deltaY: 100 }); assert.equal(disabled.prevented, undefined);
});
test("touch pinch pans and zooms without adding a location or leaving pointer captures", () => {
  const t = gesture(); t.node.fire("pointerdown", { pointerId: 1, clientX: 100 }); t.node.fire("pointerdown", { pointerId: 2, clientX: 200 });
  t.document.fire("pointermove", { pointerId: 2, clientX: 240 }); t.document.fire("pointerup", { pointerId: 2, clientX: 240 }); t.document.fire("pointerup", { pointerId: 1 });
  assert.ok(t.log.some(item => item[0] === "zoom" && item[1] === 1.4)); assert.ok(!t.log.some(item => item[0] === "pick")); assert.equal(t.node.captures.size, 0); assert.equal(t.node.fire("click").stopped, true);
  t.node.fire("dblclick", { detail: 2 }); assert.ok(!t.log.some(item => item[0] === "pick"));
});
test("double click guards expire after gestures, while reset rejects stale events", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance"); let clock = 100;
  Object.defineProperty(globalThis, "performance", { configurable: true, value: { now: () => clock } });
  try {
    const t = gesture(); t.node.fire("wheel", { deltaY: 100 });
    clock = 499; t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 1);
    clock = 501; t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log[1][0], "pick");
    clock = 900; t.handle.reset(); t.node.fire("pointerdown"); t.document.fire("pointerup");
    t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 2);
    clock = 1601; t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 3);
    t.handle.dispose();
  } finally { Object.defineProperty(globalThis, "performance", descriptor); }
});
test("pointer cancellation, nonprimary buttons and invalid coordinates do not add", () => {
  const t = gesture(); t.node.fire("pointerdown"); t.document.fire("pointercancel"); t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 0);
  const other = gesture(); other.node.fire("dblclick", { detail: 2, button: 2 }); other.node.fire("dblclick", { detail: 2, clientX: NaN }); assert.equal(other.log.length, 0);
});
test("closing, cancelling and disposal keep gestures inert without leaked listeners", () => {
  const t = gesture(); t.node.fire("pointerdown"); t.document.fire("pointermove", { clientX: 120 }); t.handle.reset(); t.document.fire("pointerup"); assert.equal(t.log.length, 1); assert.equal(t.node.captures.size, 0);
  t.handle.dispose(); t.handle.dispose(); t.node.fire("wheel", { deltaY: 100 }); t.node.fire("pointerdown"); t.document.fire("pointerup"); t.node.fire("dblclick", { detail: 2 }); assert.equal(t.log.length, 1); assert.equal(t.node.style.touchAction, "auto"); assert.ok([...t.node.handlers.values(), ...t.document.handlers.values()].every(items => items.length === 0));
});
