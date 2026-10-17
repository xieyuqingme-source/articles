(function (root, factory) {
  "use strict";
  const journey = factory();
  if (typeof module === "object" && module.exports) module.exports = journey;
  else root.FootprintsJourney = journey;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DAY = 86400000;
  const PACES = Object.freeze({ brisk: 0.75, normal: 1, relaxed: 1.3 });

  // These bounds describe date precision; they are never synthetic travel dates.
  function dateBounds(value) {
    if (typeof value !== "string" || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return null;
    const parts = value.split("-").map(Number), year = parts[0], month = parts[1], day = parts[2];
    if (year < 1 || month !== undefined && (month < 1 || month > 12)) return null;
    const utc = (y, m, d) => { const result = new Date(0); result.setUTCFullYear(y, m - 1, d); result.setUTCHours(0, 0, 0, 0); return result.getTime(); };
    const lastDay = new Date(utc(year, (month || 12) + 1, 1) - DAY).getUTCDate();
    if (day !== undefined && (day < 1 || day > lastDay)) return null;
    return { min: utc(year, month || 1, day || 1), max: utc(year, month || 12, day || lastDay), exact: parts.length === 3 };
  }
  function dateLabel(record) {
    if (record.derived) return record.dateLabel || "返回日期未指定";
    if (!record.start && !record.end) return "日期待确认";
    if (record.ongoing) return `${record.start || "开始未知"} — 至今`;
    if (record.start === record.end) return record.start;
    return `${record.start || "开始未知"} — ${record.end || "结束未知"}`;
  }
  function interval(group) {
    const sample = group.records[0];
    if (!group.records.every(item => item.start === sample.start && item.end === sample.end && !!item.ongoing === !!sample.ongoing)) return null;
    const start = dateBounds(sample.start), end = sample.ongoing ? { min: Infinity, max: Infinity, exact: false } : dateBounds(sample.end);
    return start && end ? { start, end } : null;
  }
  function cityEqual(a, b) { return a.city === b.city && a.country === b.country && a.region === b.region && Math.abs(a.lon - b.lon) < 0.0001 && Math.abs(a.lat - b.lat) < 0.0001; }
  function sourceGroups(records) {
    const grouped = new Map();
    records.forEach((item, index) => {
      const key = item.groupId || item.id;
      if (!grouped.has(key)) grouped.set(key, { id: key, first: index, records: [], order: Number.isInteger(item.sequence) ? item.sequence : Infinity });
      const group = grouped.get(key); group.records.push(item);
      if (Number.isInteger(item.sequence)) group.order = Math.min(group.order, item.sequence);
    });
    const groups = [...grouped.values()];
    groups.forEach(group => {
      group.records.sort((a, b) => (Number.isInteger(a.sequence) ? a.sequence : Infinity) - (Number.isInteger(b.sequence) ? b.sequence : Infinity));
      group.type = group.records.every(item => item.stayType === "base") ? "base" : "visit";
      group.interval = interval(group);
    });
    const explicitOrder = groups.every(group => Number.isFinite(group.order));
    return groups.sort((a, b) => explicitOrder ? a.order - b.order || a.first - b.first : (dateBounds(a.records[0].start)?.min ?? Infinity) - (dateBounds(b.records[0].start)?.min ?? Infinity) || a.first - b.first);
  }
  function extent(groups) {
    if (!groups.every(group => group.interval)) return null;
    return {
      start: { min: Math.min(...groups.map(group => group.interval.start.min)), max: Math.min(...groups.map(group => group.interval.start.max)) },
      end: { min: Math.max(...groups.map(group => group.interval.end.min)), max: Math.max(...groups.map(group => group.interval.end.max)) }
    };
  }
  function contains(base, visit) { return base && visit && Number.isFinite(visit.end.max) && base.start.max <= visit.start.min && visit.end.max <= base.end.min; }
  function overlaps(a, b) { return a && b && a.start.min <= b.end.max && b.start.min <= a.end.max; }
  function explicitJoined(a, b, continuousGroups) { return continuousGroups.some(ids => Array.isArray(ids) && ids.includes(a.id) && ids.includes(b.id)); }
  function returnAfter(group) { return group.records.some(item => item.returnAfter === true); }
  function autoJoined(groups, next) {
    const before = extent(groups), after = next.interval;
    if (!before || !after) return false;
    // Coarse/overlapping ranges are kept together to avoid asserting an unrecorded return.
    if (after.start.min <= before.end.max) return true;
    return groups[groups.length - 1].interval.end.exact && after.start.exact && after.start.min <= before.end.max + DAY;
  }

  function build(records, options) {
    if (!Array.isArray(records)) throw new TypeError("经历记录必须是数组。");
    const o = options || {}, baseChoices = o.baseChoices || {}, continuousGroups = Array.isArray(o.continuousGroups) ? o.continuousGroups : [];
    const groups = sourceGroups(records), scenes = [], warnings = [];
    function warning(code, ids, message) { warnings.push({ code, groupIds: ids, message }); }
    function original(item) { scenes.push(Object.assign({}, item, { derived: false, sourceId: item.id, dateLabel: dateLabel(item) })); }
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if (group.type === "base") { group.records.forEach(original); continue; }
      const outings = [group];
      while (!returnAfter(outings[outings.length - 1]) && index + 1 < groups.length && groups[index + 1].type === "visit" && (explicitJoined(outings[outings.length - 1], groups[index + 1], continuousGroups) || autoJoined(outings, groups[index + 1]))) outings.push(groups[++index]);
      outings.forEach(item => item.records.forEach(original));
      const trip = extent(outings), earlierBases = groups.slice(0, groups.indexOf(outings[0])).filter(item => item.type === "base");
      const candidates = earlierBases.filter(item => contains(item.interval, trip));
      if (candidates.length !== 1) {
        if (candidates.length > 1) warning("ambiguous-base", outings.map(item => item.id), "这段外出同时落在多个长期居住范围内，未自动补入返回地点。");
        else if (earlierBases.some(item => overlaps(item.interval, trip)) || earlierBases.length && !trip) warning("uncertain-base-span", outings.map(item => item.id), "这段外出与长期居住范围交叠或日期不完整，未自动补入返回地点。");
        continue;
      }
      const base = candidates[0], next = groups[index + 1];
      // A single unrecorded day between outings is not evidence of a home visit.
      // Keep the source rows separate instead of asserting either a return or one continuous trip.
      if (!returnAfter(outings[outings.length - 1]) && next && next.type === "visit" && next.interval && next.interval.start.exact && trip.end.min === trip.end.max) {
        const gap = next.interval.start.min - trip.end.max;
        if (gap > DAY && gap <= 2 * DAY) {
          warning("short-gap", outings.map(item => item.id).concat(next.id), "相邻外出之间只有一天未记录，未假定期间返回基地；原经历仍分别保留。"); continue;
        }
      }
      // A new base at the end of an outing is a move, not evidence of a return to the old base.
      if (next && next.type === "base" && next.interval && next.interval.start.min <= trip.end.max + DAY) {
        warning("base-change", outings.map(item => item.id), "外出结束处衔接新的长期居住地，未补入返回原基地的节点。"); continue;
      }
      let destination;
      if (Object.hasOwn(baseChoices, base.id)) {
        destination = base.records.find(item => item.id === baseChoices[base.id]);
        if (!destination) { warning("invalid-base-choice", [base.id].concat(outings.map(item => item.id)), "指定的返回城市不在这段长期居住记录中，未自动选择其他城市。"); continue; }
      } else {
        const designated = base.records.filter(item => item.baseReturn === true);
        if (designated.length > 1) { warning("ambiguous-base-return", [base.id].concat(outings.map(item => item.id)), "这段长期居住记录指定了多个返回城市，未自动选择其中一座。"); continue; }
        destination = designated[0] || (base.records.length === 1 ? base.records[0] : null);
        if (!destination) { warning("base-city-required", [base.id].concat(outings.map(item => item.id)), "长期居住地包含多座城市，请先确认返回城市；当前没有自动选择其中一座。"); continue; }
      }
      const last = outings[outings.length - 1].records.at(-1);
      if (cityEqual(destination, last)) continue;
      scenes.push(Object.assign({}, destination, {
        id: `return-${last.id}-${destination.id}`, sourceId: destination.id, baseGroupId: base.id,
        afterGroupId: outings[outings.length - 1].id, derived: true, kind: "base-return",
        start: "", end: "", ongoing: false, certainty: "approximate", description: "", album: "",
        dateLabel: "返回日期未指定", frameworkLabel: "返回长期居住地（演示）"
      }));
    }
    return { scenes, warnings };
  }

  function graphemes(text) {
    const value = typeof text === "string" ? text : "";
    if (typeof Intl !== "undefined" && Intl.Segmenter) return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(item => item.segment);
    return Array.from(value);
  }
  function paginate(text, maxChars, maxLines) {
    const units = graphemes(text), limit = Math.max(24, Math.min(500, Math.floor(Number(maxChars) || 160))), lineLimit = Math.max(1, Math.min(12, Math.floor(Number(maxLines) || 4))), pages = [];
    for (let offset = 0; offset < units.length;) {
      let end = Math.min(units.length, offset + limit);
      let explicitLines = 0, lineBreak = false;
      for (let index = offset; index < end; index++) if (units[index].includes("\n") && ++explicitLines >= lineLimit) { end = index + 1; lineBreak = true; break; }
      if (end < units.length && !lineBreak) {
        for (let index = end - 1; index >= offset + Math.floor(limit * 0.6); index--) if (/[。！？；\n.!?;\s]/u.test(units[index])) { end = index + 1; break; }
      }
      pages.push(units.slice(offset, end).join("")); offset = end;
    }
    return pages.length ? pages : [""];
  }
  function readingDuration(text) {
    const units = graphemes(text).reduce((sum, character) => sum + (/\s/u.test(character) ? 0 : /^[\x00-\x7F]+$/.test(character) ? 0.45 : 1), 0);
    return Math.max(2000, Math.ceil(units * 55));
  }
  function plan(records, options) {
    const o = options || {}, pace = Object.hasOwn(PACES, o.pace) ? o.pace : "normal", factor = PACES[pace];
    const scenes = (Array.isArray(records) ? records : []).map(item => Object.assign({}, item)), segments = [];
    const requestedIntro = Number(o.introMs), introMs = scenes.length ? Math.max(0, Number.isFinite(requestedIntro) ? Math.round(requestedIntro) : 800) : 0;
    let durationMs = introMs;
    if (introMs) segments.push({ startMs: 0, endMs: introMs, durationMs: introMs, index: -1, phase: "intro", pageText: "", pageIndex: 0, pageCount: 0 });
    scenes.forEach((record, index) => {
      const pages = typeof o.textPaginator === "function" ? o.textPaginator(record.description || "", record) : paginate(record.description, o.maxPageChars, o.maxPageLines);
      if (!Array.isArray(pages) || !pages.length || pages.some(text => typeof text !== "string") || pages.join("") !== (record.description || "")) throw new TypeError("视频文字分页必须完整保留原始描述。");
      pages.forEach((text, pageIndex) => {
        const duration = Math.round(readingDuration(text) * factor);
        segments.push({ startMs: durationMs, endMs: durationMs + duration, durationMs: duration, index, phase: "stay", pageText: text, pageIndex, pageCount: pages.length }); durationMs += duration;
      });
      if (index < scenes.length - 1) {
        const duration = Math.round(800 * factor);
        segments.push({ startMs: durationMs, endMs: durationMs + duration, durationMs: duration, index, phase: "travel", pageText: pages.at(-1), pageIndex: pages.length - 1, pageCount: pages.length }); durationMs += duration;
      }
    });
    return { scenes, segments, durationMs, introMs, pace, movementMs: Math.round(800 * factor) };
  }
  function ease(progress) { const value = Math.min(1, Math.max(0, Number(progress) || 0)); return value * value * (3 - 2 * value); }
  function interpolate(from, to, progress) {
    const value = Math.min(1, Math.max(0, Number(progress) || 0));
    let delta = to.lon - from.lon; if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
    let lon = from.lon + delta * value; if (lon > 180) lon -= 360; if (lon < -180) lon += 360;
    return { lon, lat: from.lat + (to.lat - from.lat) * value };
  }
  function cumulativePoints(scenes, index, progress) {
    if (!Array.isArray(scenes) || index < 0 || !scenes.length) return [];
    const current = Math.min(scenes.length - 1, index), points = scenes.slice(0, current + 1).map(item => ({ lon: item.lon, lat: item.lat }));
    if (current < scenes.length - 1 && progress > 0) points.push(interpolate(scenes[current], scenes[current + 1], progress));
    return points;
  }
  function cityKey(item) { return JSON.stringify([item.country, item.region, item.city, item.lat.toFixed(4), item.lon.toFixed(4)]); }
  function unlocked(scenes, frame) {
    const cities = new Set();
    if (!Array.isArray(scenes) || !frame || frame.phase === "intro" || frame.index < 0 || frame.elapsed === 0) return cities;
    const last = Math.min(scenes.length - 1, frame.index);
    for (let index = 0; index <= last; index++) if (!scenes[index].derived) cities.add(cityKey(scenes[index]));
    return cities;
  }
  function frameAt(videoPlan, timeMs) {
    const p = videoPlan || { scenes: [], segments: [], durationMs: 0 }, scenes = p.scenes || [], segments = p.segments || [];
    const elapsed = Math.max(0, Math.min(p.durationMs, Number(timeMs) || 0));
    if (!scenes.length || !segments.length) return { index: -1, record: null, next: null, phase: "stay", progress: 0, rawProgress: 0, elapsed, total: p.durationMs || 0, count: 0, pageText: "", pageIndex: 0, pageCount: 0, point: null, cumulativePath: [], ended: true };
    let low = 0, high = segments.length - 1;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (segments[middle].endMs <= elapsed) low = middle + 1; else high = middle; }
    const segment = segments[low], index = segment.index;
    if (segment.phase === "intro") return { index: -1, record: null, next: null, phase: "intro", progress: ease(elapsed / segment.durationMs), rawProgress: elapsed / segment.durationMs, elapsed, total: p.durationMs, count: scenes.length, pageText: "", pageIndex: 0, pageCount: 0, point: null, cumulativePath: [], ended: false };
    const record = scenes[index], next = segment.phase === "travel" ? scenes[index + 1] : null;
    const rawProgress = next ? Math.min(1, Math.max(0, (elapsed - segment.startMs) / segment.durationMs)) : 0, progress = ease(rawProgress);
    return {
      index, record, next, phase: segment.phase, progress, rawProgress, elapsed, total: p.durationMs, count: scenes.length,
      pageText: segment.pageText, pageIndex: segment.pageIndex, pageCount: segment.pageCount,
      point: next ? interpolate(record, next, progress) : { lon: record.lon, lat: record.lat },
      cumulativePath: cumulativePoints(scenes, index, next ? progress : 0), ended: elapsed >= p.durationMs
    };
  }
  return { PACES, dateBounds, dateLabel, build, paginate, plan, ease, interpolate, cumulativePoints, cityKey, unlocked, frameAt };
});
