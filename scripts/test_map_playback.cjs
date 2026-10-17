"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const P = require("../home/assets/map-playback.js"), M = require("../home/assets/map-model.js");
const record = (id, start = "2020-01", lon = 116) => ({ id, start, end: "", lon, lat: 39, city: "City", country: "Country", region: "", title: id, description: "", album: "", certainty: "approximate" });
function setup(records = [record("one"), record("two", "2021")]) {
  let clock = 0, id = 0, recordEvents = [], pending = new Map();
  const controller = P.create({ now: () => clock, requestFrame: callback => { pending.set(++id, callback); return id; }, cancelFrame: key => pending.delete(key), onRecord: state => recordEvents.push(state.record && state.record.id) });
  controller.reset(records);
  return { controller, pending, recordEvents, tick(ms) { clock += ms; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(clock)); assert.ok(pending.size <= 1, "at most one scheduled frame"); }, advance(ms) { clock += ms; } };
}
test("empty playback stays idle without scheduling", () => { const { controller: p, pending } = setup([]); p.play(); p.replay(); assert.equal(p.getState().state, "idle"); assert.equal(p.getState().index, -1); assert.equal(pending.size, 0); });
test("play, pause, resume and speed changes preserve presentation position", () => {
  const t = setup(), p = t.controller; p.play(); p.play(); assert.equal(t.pending.size, 1); t.tick(500); p.pause(); assert.equal(p.getState().position, 500); assert.equal(t.pending.size, 0); t.tick(5000); assert.equal(p.getState().position, 500); p.setSpeed(2); p.play(); t.tick(300); assert.equal(p.getState().position, 1100);
  t.advance(200); p.setSpeed(4); assert.equal(p.getState().position, 1500); t.tick(100); assert.equal(p.getState().position, 1900); p.setSpeed(99); assert.equal(p.getState().speed, 4);
});
test("time-axis order is preserved including unknown dates and repeated cities", () => {
  const records = M.sorted([record("unknown", ""), record("return", "2022"), record("first", "2020")]), t = setup(records), p = t.controller;
  p.play(); t.tick(2600); assert.equal(p.getState().record.id, "first"); assert.equal(p.getState().next.id, "return"); assert.equal(p.getState().phase, "travel"); t.tick(1200); assert.equal(p.getState().record.id, "return"); t.tick(3800); assert.equal(p.getState().record.id, "unknown"); assert.equal(p.getState().count, 3);
});
test("replay cancels pending frame and resets first record", () => { const t = setup(), p = t.controller; p.play(); t.tick(4000); assert.equal(p.getState().index, 1); p.replay(); assert.equal(p.getState().index, 0); assert.equal(p.getState().position, 0); assert.equal(p.getState().state, "playing"); assert.equal(t.pending.size, 1); });
test("single record ends cleanly and restarts", () => { const t = setup([record("only")]), p = t.controller; p.play(); t.tick(2600); assert.equal(p.getState().state, "ended"); assert.equal(p.getState().index, 0); assert.equal(t.pending.size, 0); p.play(); assert.equal(p.getState().position, 0); assert.equal(t.pending.size, 1); });
test("reset/dispose cancel running work; 500 records use one frame", () => {
  const t = setup(Array.from({ length: 500 }, (_, i) => record("r" + i))), p = t.controller; p.play(); t.tick(10); assert.equal(t.pending.size, 1); assert.equal(t.recordEvents.length, 1, "does not rebuild details on every frame"); p.reset([record("new")]); assert.equal(p.getState().state, "idle"); assert.equal(t.pending.size, 0); p.play(); p.dispose(); assert.equal(t.pending.size, 0); p.play(); assert.equal(t.pending.size, 0);
});
test("duration respects precision, uncertainty and unknown end", () => {
  assert.equal(P.duration(record("x")), "停留时长未知");
  assert.equal(P.duration({ start: "2020-01", end: "2021-03", certainty: "approximate" }), "约 跨 14 个月（按月份差）");
  assert.equal(P.duration({ start: "2020", end: "2021-03", certainty: "confirmed" }), "日期精度不同，时长未计算");
  assert.equal(P.duration({ start: "2020-02-28", end: "2020-03-01", certainty: "confirmed" }), "3 天（含首尾日）");
  assert.equal(P.duration({ start: "0099-12-31", end: "0100-01-01", certainty: "confirmed" }), "2 天（含首尾日）");
});
test("interpolation is deterministic and same-city segments remain fixed", () => { assert.deepEqual(P.interpolate({ lon: 10, lat: 20 }, { lon: 30, lat: 40 }, .5), { lon: 20, lat: 30 }); assert.deepEqual(P.interpolate({ lon: 10, lat: 20 }, { lon: 10, lat: 20 }, .5), { lon: 10, lat: 20 }); });
test("viewport zoom preserves center, clamps factors and never mutates source", () => { const world = [-180, -90, 180, 90]; assert.deepEqual(P.viewport(world, 2), [-90, -45, 90, 45]); assert.deepEqual(P.viewport(world, .1), world); assert.deepEqual(P.viewport(world, 100), [-22.5, -11.25, 22.5, 11.25]); assert.deepEqual(world, [-180, -90, 180, 90]); const china = P.viewport([73, 15, 136, 55], 2); assert.equal((china[0] + china[2]) / 2, 104.5); assert.equal((china[1] + china[3]) / 2, 35); });
