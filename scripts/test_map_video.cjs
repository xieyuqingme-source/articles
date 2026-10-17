"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const V = require("../home/assets/map-video.js");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); }
  removeEventListener(name, listener) { if (this.listeners.has(name)) this.listeners.get(name).delete(listener); }
  emit(name, value = {}) { for (const listener of [...(this.listeners.get(name) || [])]) listener(value); }
  count() { return [...this.listeners.values()].reduce((n, values) => n + values.size, 0); }
}
function harness(options = {}) {
  let time = 0, id = 0, timerId = 0; const pending = new Map(), timers = new Map(), instances = [], paints = [], progress = [], tracks = [];
  class Recorder extends Events {
    static isTypeSupported(type) { return (options.formats || ["video/webm;codecs=vp9"]).includes(type); }
    constructor(stream, config) { super(); if (options.constructorError) throw options.constructorError; this.stream = stream; this.mimeType = options.actualType || config.mimeType; this.state = "inactive"; instances.push(this); }
    start(timeslice) { this.timeslice = timeslice; this.state = "recording"; if (!options.noStartEvent) this.emit("start"); }
    stop() { this.state = "inactive"; if (options.noStopEvent) return; this.emit("dataavailable", { data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }) }); this.emit("stop"); }
  }
  const document = new Events(); document.hidden = false; const window = new Events();
  const canvas = { width: 1280, height: 900, captureStream(fps) {
    if (options.captureError) throw options.captureError;
    const track = new Events(); track.kind = "video"; track.stopped = false; track.stop = () => { track.stopped = true; track.emit("ended"); }; tracks.push(track);
    const all = options.extraTrack ? [track, { kind: "audio", stop() {} }] : [track];
    return { fps, getTracks: () => all, getVideoTracks: () => [track] };
  } };
  const environment = { MediaRecorder: Recorder, Blob, document, window, now: () => time, requestFrame(callback) { pending.set(++id, callback); return id; }, cancelFrame(key) { pending.delete(key); }, setTimeout(callback, delay) { timers.set(++timerId, { at: time + delay, callback }); return timerId; }, clearTimeout(key) { timers.delete(key); } };
  const config = { canvas, environment, durationMs: 200, renderFrame: at => paints.push(at), onProgress: p => progress.push(p) };
  return {
    config, canvas, environment, document, window, instances, pending, timers, paints, progress, tracks,
    tick(ms) { time += ms; const callbacks = [...pending.values()]; pending.clear(); for (const callback of callbacks) callback(time); assert.ok(pending.size <= 1, "one pending animation frame"); this.runTimers(); },
    runTimers() { for (const [key, item] of [...timers]) if (item.at <= time) { timers.delete(key); item.callback(); } },
    advance(ms) { time += ms; this.runTimers(); },
    assertClean() { assert.equal(pending.size, 0); assert.equal(timers.size, 0); assert.equal(document.count(), 0); assert.equal(window.count(), 0); for (const recorder of instances) assert.equal(recorder.count(), 0); for (const track of tracks) { assert.equal(track.stopped, true); assert.equal(track.count(), 0); } }
  };
}
test("capabilities select exact supported MIME and never relabel WebM as MP4", () => {
  const h = harness(); assert.deepEqual(V.capabilities({ ...h.environment, canvas: h.canvas }), { supported: true, mimeType: "video/webm;codecs=vp9", extension: "webm", reason: "" });
  const mp4 = harness({ formats: ["video/mp4"] }); assert.equal(V.capabilities({ ...mp4.environment, canvas: mp4.canvas }).extension, "mp4");
  const unsupported = harness({ formats: [] }); assert.equal(V.capabilities({ ...unsupported.environment, canvas: unsupported.canvas }).supported, false);
  assert.equal(V.capabilities({ MediaRecorder: class {} }).supported, false);
});
test("a real-time recording emits first/final frames and returns nonempty typed Blob", async () => {
  const h = harness(), promise = V.record(h.config); h.tick(100); h.tick(100); assert.equal(h.progress.at(-1).state, "finalizing"); h.advance(60);
  const result = await promise; assert.equal(result.blob.size, 3); assert.equal(result.extension, "webm"); assert.equal(result.mimeType, "video/webm;codecs=vp9"); assert.equal(result.durationMs, 200); assert.equal(result.width, 1280); assert.equal(result.height, 900);
  assert.deepEqual(h.paints, [0, 0, 100, 200]); assert.equal(h.progress[0].progress, 0); assert.equal(h.progress.at(-1).progress, 1); h.assertClean();
});
test("abort discards partial output, cleans resources, and permits retry", async () => {
  const h = harness(), controller = new AbortController(); const promise = V.record({ ...h.config, signal: controller.signal });
  h.tick(80); controller.abort(); await assert.rejects(promise, { name: "AbortError" }); h.assertClean();
  const retry = V.record(h.config); h.tick(200); h.advance(60); assert.ok((await retry).blob.size); h.assertClean();
});
test("pre-aborted recording creates no stream and no scheduled work", async () => {
  const h = harness(), controller = new AbortController(); controller.abort(); await assert.rejects(V.record({ ...h.config, signal: controller.signal }), { name: "AbortError" }); assert.equal(h.tracks.length, 0); h.assertClean();
});
test("same canvas cannot be recorded twice at once", async () => {
  const h = harness(), c = new AbortController(), first = V.record({ ...h.config, signal: c.signal }); await assert.rejects(V.record(h.config), { name: "InvalidStateError" }); c.abort(); await assert.rejects(first, { name: "AbortError" }); h.assertClean();
});
test("hidden, frozen, and pagehide interruptions discard output with retry guidance", async () => {
  for (const event of ["visibilitychange", "freeze", "pagehide"]) {
    const h = harness(), promise = V.record(h.config); if (event === "visibilitychange") h.document.hidden = true;
    (event === "pagehide" ? h.window : h.document).emit(event); await assert.rejects(promise, { name: "InterruptedError" }); h.assertClean();
  }
});
test("initially hidden tab and invalid dimensions/duration are rejected", async () => {
  const h = harness(); h.document.hidden = true; await assert.rejects(V.record(h.config), { name: "InterruptedError" }); h.document.hidden = false;
  for (const durationMs of [0, NaN, Infinity, V.MAX_DURATION + 1]) await assert.rejects(V.record({ ...h.config, durationMs }), { name: "ValidationError" });
  h.canvas.width = 0; await assert.rejects(V.record(h.config), { name: "ValidationError" }); assert.equal(h.tracks.length, 0);
});
test("canvas size mutation and long scheduler suspension cannot produce a broken download", async () => {
  let h = harness(), promise = V.record(h.config); h.canvas.width++; h.tick(50); await assert.rejects(promise, { name: "InterruptedError" }); h.assertClean();
  h = harness(); promise = V.record({ ...h.config, durationMs: 5000 }); h.tick(3001); await assert.rejects(promise, { name: "InterruptedError" }); h.assertClean();
});
test("occluded-window rendering throttle aborts partial output, cleans up, and allows retry", async () => {
  const h = harness(), promise = V.record({ ...h.config, durationMs: 5000 });
  h.tick(1100); assert.equal(h.paints.at(-1), 1100, "first frame tolerates encoder initialization");
  h.tick(1000); await assert.rejects(promise, error => error.name === "InterruptedError" && error.message.includes("限速")); h.assertClean();
  const retry = V.record(h.config); h.tick(100); h.tick(100); h.advance(60); assert.ok((await retry).blob.size); h.assertClean();
});
test("render errors, accidental asynchronous renderer, encoder errors, track loss clean up", async () => {
  let h = harness(), promise = V.record({ ...h.config, renderFrame() { throw new Error("draw failed"); } }); await assert.rejects(promise, /draw failed/); h.assertClean();
  h = harness(); promise = V.record({ ...h.config, renderFrame: () => Promise.resolve() }); await assert.rejects(promise, { name: "ValidationError" }); h.assertClean();
  for (const event of ["error", "ended", "stop"]) {
    h = harness(); promise = V.record(h.config); (event === "ended" ? h.tracks[0] : h.instances[0]).emit(event); await assert.rejects(promise, { name: "EncodingError" }); h.assertClean();
  }
});
test("output size and recorder start/finalization timeouts are bounded", async () => {
  let h = harness(), promise = V.record(h.config); h.instances[0].emit("dataavailable", { data: { size: V.MAX_BYTES + 1 } }); await assert.rejects(promise, { name: "QuotaExceededError" }); h.assertClean();
  h = harness({ noStartEvent: true }); promise = V.record({ ...h.config, durationMs: 20000 }); h.advance(10000); await assert.rejects(promise, { name: "EncodingError" }); h.assertClean();
  h = harness({ noStopEvent: true }); promise = V.record(h.config); h.tick(200); h.advance(10000); await assert.rejects(promise, { name: "EncodingError" }); h.assertClean();
});
test("delayed native start event does not delay or reset the video scene clock", async () => {
  const h = harness({ noStartEvent: true }), promise = V.record({ ...h.config, durationMs: 1500 });
  h.tick(500); h.tick(500); assert.equal(h.paints.at(-1), 1000); h.instances[0].emit("start");
  h.tick(500); assert.equal(h.paints.at(-1), 1500); h.advance(60); assert.equal((await promise).durationMs, 1500); h.assertClean();
});
test("capture security error and accidental extra audio track are rejected", async () => {
  let e = new Error(); e.name = "SecurityError"; let h = harness({ captureError: e }); await assert.rejects(V.record(h.config), { name: "SecurityError" }); h.assertClean();
  h = harness({ extraTrack: true }); await assert.rejects(V.record(h.config), { name: "EncodingError" }); h.assertClean();
});
test("actual recorder MIME determines file extension; unknown container is rejected", async () => {
  let h = harness({ actualType: "video/mp4" }), promise = V.record(h.config); h.tick(200); h.advance(60); assert.equal((await promise).extension, "mp4"); h.assertClean();
  h = harness({ actualType: "video/unknown" }); promise = V.record(h.config); h.tick(200); h.advance(60); await assert.rejects(promise, { name: "EncodingError" }); h.assertClean();
});
function join(parts) { return Uint8Array.from(parts.flatMap(part => [...part])); }
function infoSegment(content, known = false) {
  const info = join([[0x15, 0x49, 0xa9, 0x66, 0x80 + content.length], content]);
  return join([[0x1a, 0x45, 0xdf, 0xa3, 0x80], [0x18, 0x53, 0x80, 0x67], known ? [0x80 + info.length] : [0x01, 255, 255, 255, 255, 255, 255, 255], info]);
}
test("WebM Duration metadata is inserted using segment TimecodeScale with exact content preserved", async () => {
  for (const known of [false, true]) {
    const bytes = infoSegment([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40], known), blob = new Blob([bytes], { type: "video/webm;codecs=vp9" });
    const out = await V.withWebmDuration(blob, 2345); const data = new Uint8Array(await out.arrayBuffer()); const at = data.findIndex((v, i) => v === 0x44 && data[i + 1] === 0x89);
    assert.equal(out.type, blob.type); assert.equal(out.size, blob.size + 11); assert.equal(new DataView(data.buffer).getFloat64(at + 3, false), 2345);
    const again = await V.withWebmDuration(out, 4567); assert.equal(again.size, out.size); const twice = new Uint8Array(await again.arrayBuffer()); assert.equal(new DataView(twice.buffer).getFloat64(at + 3, false), 4567);
  }
});
test("malformed or non-WebM media is returned intact by duration helper", async () => {
  const empty = new Blob([], { type: "video/webm" }), invalid = new Blob([new Uint8Array([0, 1, 2, 3])], { type: "video/webm" }), mp4 = new Blob(["mp4"], { type: "video/mp4" });
  assert.equal(await V.withWebmDuration(empty, 100), empty); assert.equal(await V.withWebmDuration(invalid, 100), invalid); assert.equal(await V.withWebmDuration(mp4, 100), mp4);
});
