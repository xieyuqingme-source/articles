"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const L = require("../home/assets/map-labels.js");
const candidate = (key, x, y, name = key, priority = 0) => ({ key, name, x, y, priority });
const overlaps = (a, b, gap = 0) => a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
test("layout produces deterministic shared SVG/Canvas baseline and box geometry", () => {
  const input = [candidate("a", 100, 100, "北京")], options = { width: 300, height: 200, measure: text => ({ width: text.length * 14 }) };
  const output = L.layout(input, options);
  assert.deepEqual(output, L.layout(input, options)); assert.equal(output.length, 1);
  const label = output[0]; assert.deepEqual(label.box, { x: 107, y: 69, width: 34, height: 24 });
  assert.equal(label.x, 110); assert.equal(label.y, 85.2); assert.equal(label.anchor, "start");
  assert.equal(label.width, label.box.width); assert.equal(label.height, label.box.height);
});
test("dense candidate labels never overlap and leave every dot unobscured", () => {
  const input = Array.from({ length: 30 }, (_, index) => candidate(String(index), 130 + index % 6 * 12, 80 + Math.floor(index / 6) * 12, "城市"));
  const output = L.layout(input, { width: 320, height: 200 }); assert.ok(output.length > 0 && output.length < input.length);
  for (const a of output) {
    for (const b of output) if (a !== b) assert.equal(overlaps(a.box, b.box, 3), false);
    for (const city of input) assert.equal(overlaps(a.box, { x: city.x - 4, y: city.y - 4, width: 8, height: 8 }), false);
  }
  assert.equal(input.length, 30);
});
test("four deterministic offsets keep labels inside each edge", () => {
  for (const [x, y] of [[10, 10], [290, 10], [10, 190], [290, 190]]) {
    const output = L.layout([candidate("edge", x, y, "边界")], { width: 300, height: 200 }); assert.equal(output.length, 1);
    const box = output[0].box; assert.ok(box.x >= 4 && box.y >= 4 && box.x + box.width <= 296 && box.y + box.height <= 196);
  }
  assert.deepEqual(L.layout([candidate("too-wide", 10, 10, "无法放下的完整城市名称")], { width: 25, height: 25 }), []);
});
test("selected current city takes priority while equal priority preserves source order", () => {
  const output = L.layout([candidate("first", 100, 100, "先到"), candidate("current", 100, 100, "当前", 10), candidate("last", 100, 100, "后来")], { width: 220, height: 180 });
  assert.equal(output[0].key, "current"); assert.deepEqual(output.map(item => item.key), ["current", "first", "last"]);
});
test("repeated city keys create one label and retain the highest priority occurrence", () => {
  const output = L.layout([candidate("same", 90, 90, "第一次"), candidate("other", 220, 120), candidate("same", 100, 100, "优先", 8)], { width: 400, height: 240 });
  assert.equal(output.filter(item => item.key === "same").length, 1); assert.equal(output[0].text, "优先"); assert.equal(output[0].box.x, 107);
});
test("future cities neither render nor affect already unlocked city placement", () => {
  const unlocked = candidate("arrived", 100, 100, "已到达"), future = candidate("future", 115, 83, "未来城市", 100);
  const options = { width: 300, height: 200, visibleSet: new Set(["arrived"]) };
  assert.deepEqual(L.layout([unlocked, future], options), L.layout([unlocked], options));
  assert.deepEqual(L.layout([unlocked, future], { ...options, visibleSet: new Set() }), []);
});
test("avatar and other reserved geometry is respected without moving markers", () => {
  const reserved = [{ x: 100, y: 60, width: 70, height: 45 }];
  const output = L.layout([candidate("a", 100, 100, "避让")], { width: 300, height: 200, reserved });
  assert.equal(output.length, 1); assert.equal(overlaps(output[0].box, reserved[0], 3), false);
  assert.equal(output[0].box.x, 59); assert.equal(output[0].box.y, 69);
});
test("current city's larger radius clears its avatar without enlarging ordinary dot offsets", () => {
  const input = [{ ...candidate("current", 100, 100, "当前", 10), markerRadius: 22 }, candidate("ordinary", 240, 100, "普通")];
  const avatar = { x: 78, y: 78, width: 44, height: 44 };
  const output = L.layout(input, { width: 400, height: 240, reserved: [avatar] });
  assert.equal(output.length, 2); assert.equal(output[0].key, "current"); assert.equal(output[0].box.x, 125);
  assert.equal(overlaps(output[0].box, avatar, 3), false);
  assert.equal(output[1].key, "ordinary"); assert.equal(output[1].box.x, 247);
  assert.deepEqual(L.layout(input, { width: 400, height: 240 }), output);
  const nearby = L.layout([{ ...candidate("avatar", 130, 100), markerRadius: 22 }, candidate("small", 100, 100)], { width: 400, height: 240 });
  const small = nearby.find(item => item.key === "small"); assert.ok(small);
  assert.equal(overlaps(small.box, { x: 108, y: 78, width: 44, height: 44 }), false);
});
test("layout is pure with frozen input, options and Unicode labels", () => {
  const input = Object.freeze([Object.freeze(candidate("unicode", 100, 100, "重庆 🌏")), Object.freeze({ key: "fallback", city: "吉隆坡", x: 250, y: 100 })]);
  const options = Object.freeze({ width: 500, height: 240 });
  const first = L.layout(input, options); assert.deepEqual(first, L.layout(input, options));
  assert.deepEqual(first.map(item => item.text), ["重庆 🌏", "吉隆坡"]);
  assert.ok(first[0].width > 40 && first[0].width < 70); first[0].box.x = 900;
  assert.notEqual(L.layout(input, options)[0].box.x, 900);
});
test("invalid candidates are skipped and unsafe text stays literal for text renderers", () => {
  const text = "<img onerror=evil()>";
  const output = L.layout([null, candidate("bad", NaN, 30), candidate("offscreen", -1, 30), candidate("empty", 30, 30, "  "), candidate("safe", 200, 100, text)], { width: 600, height: 300 });
  assert.equal(output.length, 1); assert.equal(output[0].text, text);
});
test("real renderer metrics drive geometry and invalid metrics fall back safely", () => {
  const input = [candidate("a", 100, 100, "a")];
  assert.equal(L.layout(input, { measure: () => 80 })[0].width, 86);
  assert.equal(L.layout(input, { measure: () => ({ width: 70.2 }) })[0].width, 77);
  const fallback = L.layout(input); assert.deepEqual(L.layout(input, { measure: () => NaN }), fallback);
  assert.deepEqual(L.layout(input, { measure: () => { throw new Error("detached canvas"); } }), fallback);
});
test("invalid viewport/options fail explicitly instead of returning corrupt coordinates", () => {
  assert.throws(() => L.layout(null), TypeError); assert.throws(() => L.layout([], { width: 0 }), RangeError);
  assert.throws(() => L.layout([], { height: Infinity }), RangeError); assert.throws(() => L.layout([], { gap: -1 }), RangeError);
  assert.throws(() => L.layout([], { visibleSet: ["a"] }), TypeError);
});
