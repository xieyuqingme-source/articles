(function (root, factory) {
  "use strict";
  const playback = factory();
  if (typeof module === "object" && module.exports) module.exports = playback;
  else root.FootprintsPlayback = playback;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SPEEDS = [0.5, 1, 2, 4];
  // All durations below are presentation time, never an estimate of travel time.
  function create(options) {
    const o = options || {}, now = o.now || (() => performance.now());
    const request = o.requestFrame || (callback => requestAnimationFrame(callback));
    const cancel = o.cancelFrame || (id => cancelAnimationFrame(id));
    const dwell = o.dwell || 2600, travel = o.travel || 1200, cycle = dwell + travel;
    let records = [], position = 0, state = "idle", speed = 1, last = null, frame = null, activeIndex = -1, disposed = false;
    function total() { return records.length ? (records.length - 1) * cycle + dwell : 0; }
    function snapshot() {
      const index = records.length ? Math.min(records.length - 1, Math.floor(position / cycle)) : -1;
      const offset = index < 0 ? 0 : position - index * cycle;
      const moving = index >= 0 && index < records.length - 1 && offset >= dwell;
      return { state, speed, index, record: records[index] || null, next: moving ? records[index + 1] : null, phase: moving ? "travel" : "stay", progress: moving ? Math.min(1, (offset - dwell) / travel) : 0, position, total: total(), count: records.length };
    }
    function emit() {
      const value = snapshot();
      if (value.index !== activeIndex) { activeIndex = value.index; if (o.onRecord) o.onRecord(value); }
      if (o.onFrame) o.onFrame(value);
    }
    function changed() { if (o.onState) o.onState(snapshot()); }
    function stopFrame() { if (frame !== null) cancel(frame); frame = null; last = null; }
    function advance(time) {
      if (last !== null) position = Math.min(total(), position + Math.max(0, time - last) * speed);
      last = time;
      if (records.length && position >= total()) { state = "ended"; stopFrame(); changed(); }
    }
    function queue() { if (!disposed && state === "playing" && frame === null) frame = request(tick); }
    function tick(time) { frame = null; if (disposed || state !== "playing") return; advance(time); emit(); queue(); }
    return {
      reset(next) { if (disposed) return; stopFrame(); records = next.slice(); position = 0; state = "idle"; activeIndex = -1; changed(); emit(); },
      play() {
        if (disposed || !records.length || state === "playing") return;
        if (state === "ended") { position = 0; activeIndex = -1; }
        state = "playing"; last = now(); changed(); emit(); queue();
      },
      pause() { if (disposed || state !== "playing") return; advance(now()); if (state === "playing") state = "paused"; stopFrame(); changed(); emit(); },
      replay() { if (disposed) return; stopFrame(); position = 0; state = "idle"; activeIndex = -1; this.play(); },
      setSpeed(value) { if (disposed || !SPEEDS.includes(Number(value))) return; if (state === "playing") advance(now()); speed = Number(value); changed(); emit(); queue(); },
      getState: snapshot,
      dispose() { stopFrame(); disposed = true; records = []; state = "idle"; }
    };
  }
  function duration(item) {
    const prefix = item.certainty === "approximate" ? "约 " : "";
    if (!item.start || !item.end) return "停留时长未知";
    const start = item.start.split("-").map(Number), end = item.end.split("-").map(Number);
    if (start.length !== end.length) return "日期精度不同，时长未计算";
    if (start.length === 1) return start[0] === end[0] ? `${prefix}同年内，月份未知` : `${prefix}跨 ${end[0] - start[0]} 年（按年份差）`;
    if (start.length === 2) { const months = (end[0] - start[0]) * 12 + end[1] - start[1]; return months === 0 ? `${prefix}同月内，日期未知` : `${prefix}跨 ${months} 个月（按月份差）`; }
    const utc = parts => { const value = new Date(0); value.setUTCFullYear(parts[0], parts[1] - 1, parts[2]); value.setUTCHours(0, 0, 0, 0); return value.getTime(); };
    return `${prefix}${Math.round((utc(end) - utc(start)) / 86400000) + 1} 天（含首尾日）`;
  }
  // Date-line jumps are handled by the view by switching only at arrival.
  function interpolate(from, to, progress) {
    return { lon: from.lon + (to.lon - from.lon) * progress, lat: from.lat + (to.lat - from.lat) * progress };
  }
  function viewport(bounds, factor) {
    const zoom = Math.min(8, Math.max(1, Number(factor) || 1)), centerLon = (bounds[0] + bounds[2]) / 2, centerLat = (bounds[1] + bounds[3]) / 2;
    const halfWidth = (bounds[2] - bounds[0]) / (2 * zoom), halfHeight = (bounds[3] - bounds[1]) / (2 * zoom);
    return [centerLon - halfWidth, centerLat - halfHeight, centerLon + halfWidth, centerLat + halfHeight];
  }
  return { SPEEDS, create, duration, interpolate, viewport };
});
