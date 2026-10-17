(function (root, factory) {
  "use strict";
  const model = factory();
  if (typeof module === "object" && module.exports) module.exports = model;
  else root.FootprintsModel = model;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const RECORD_KEYS = ["id", "start", "end", "city", "region", "country", "lat", "lon", "title", "description", "album", "certainty"];
  const MAX_RECORDS = 500, MAX_BYTES = 1048576;
  function fail(message) { throw new Error(message); }
  function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function field(object, key, max, required) {
    const value = object[key];
    if (typeof value !== "string") fail(`${key} 必须是文字。`);
    if (value.length > max) fail(`${key} 超过 ${max} 字限制。`);
    if (required && !value.trim()) fail(`${key} 不能为空。`);
    return value.trim();
  }
  function dateBounds(value) {
    if (value === "") return null;
    if (!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) fail("日期请使用 YYYY、YYYY-MM 或 YYYY-MM-DD；未知请留空。");
    const parts = value.split("-").map(Number), year = parts[0], month = parts[1], day = parts[2];
    if (year < 1 || year > 9999 || (month !== undefined && (month < 1 || month > 12))) fail(`日期无效：${value}`);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day !== undefined && (day < 1 || day > days[month - 1])) fail(`日期无效：${value}`);
    return { min: year * 10000 + (month || 1) * 100 + (day || 1), max: year * 10000 + (month || 12) * 100 + (day || (month ? days[month - 1] : 31)) };
  }
  function record(value, index) {
    if (!plain(value)) fail(`第 ${index + 1} 条经历必须是对象。`);
    // Maintenance flags and private notes never enter the returned public fields.
    if (Object.prototype.hasOwnProperty.call(value, "approved") && typeof value.approved !== "boolean") fail("approved 必须为 true 或 false。");
    const output = {
      id: field(value, "id", 80, true), start: field(value, "start", 10), end: field(value, "end", 10),
      city: field(value, "city", 160, true), region: field(value, "region", 200), country: field(value, "country", 160, true),
      lat: value.lat, lon: value.lon, title: field(value, "title", 160, true),
      description: field(value, "description", 12000), album: field(value, "album", 200), certainty: value.certainty
    };
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(output.id)) fail("id 只能包含英文字母、数字、下划线和短横线，并以字母或数字开始。");
    const start = dateBounds(output.start), end = dateBounds(output.end);
    if (start && end && end.max < start.min) fail(`“${output.title}”的结束日期早于开始日期。`);
    if (typeof output.lat !== "number" || !Number.isFinite(output.lat) || output.lat < -90 || output.lat > 90 || typeof output.lon !== "number" || !Number.isFinite(output.lon) || output.lon < -180 || output.lon > 180) fail(`“${output.title}”需要有效城市中心坐标（纬度 -90～90，经度 -180～180）。`);
    if (output.album && !/^\/photos\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/$/.test(output.album)) fail("相册只允许本站 /photos/相册标识/ 链接，或留空。");
    if (!["confirmed", "approximate"].includes(output.certainty)) fail("certainty 只能是 confirmed 或 approximate。");
    // Optional journey semantics are public data; their absence preserves legacy files.
    if (Object.prototype.hasOwnProperty.call(value, "stayType")) {
      if (!["base", "visit"].includes(value.stayType)) fail("stayType 只能是 base 或 visit。");
      output.stayType = value.stayType;
    }
    if (Object.prototype.hasOwnProperty.call(value, "groupId")) {
      const groupId = field(value, "groupId", 80, true);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(groupId)) fail("groupId 只能包含英文字母、数字、下划线和短横线，并以字母或数字开始。");
      output.groupId = groupId;
    }
    if (Object.prototype.hasOwnProperty.call(value, "sequence")) {
      if (!Number.isInteger(value.sequence) || value.sequence < 0 || value.sequence >= MAX_RECORDS) fail(`sequence 必须是 0 到 ${MAX_RECORDS - 1} 的整数。`);
      output.sequence = value.sequence;
    }
    if (Object.prototype.hasOwnProperty.call(value, "ongoing")) {
      if (typeof value.ongoing !== "boolean") fail("ongoing 必须为 true 或 false。");
      if (value.ongoing && (!output.start || output.end)) fail("ongoing 为 true 时必须填写开始日期，并将结束日期留空。");
      output.ongoing = value.ongoing;
    }
    for (const [key, requiredStayType] of [["baseReturn", "base"], ["returnAfter", "visit"]]) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      if (typeof value[key] !== "boolean") fail(`${key} 必须为 true 或 false。`);
      if (value[key] && output.stayType !== requiredStayType) fail(`${key} 为 true 时 stayType 必须为 ${requiredStayType}。`);
      output[key] = value[key];
    }
    return output;
  }
  function validate(value, internal) {
    if (!plain(value) || value.version !== 1 || !Array.isArray(value.records)) fail("需要 version 为 1 且含 records 数组的足迹文档。");
    if (value.records.length > MAX_RECORDS) fail(`每份地图最多 ${MAX_RECORDS} 条经历。`);
    const title = field(value, "title", 120, true), ids = new Set(), records = [];
    value.records.forEach((item, index) => {
      if (plain(item) && item.certainty === "pending") {
        if (item.approved === true) fail("待确认经历不能标记为已批准。请先核对并修改确定程度。");
        return;
      }
      const next = record(item, index); if (ids.has(next.id)) fail(`文档内 id 重复：${next.id}`); ids.add(next.id); records.push(next);
    });
    return { version: 1, title, records };
  }
  function hasTimelineTable(text) {
    let fence = null;
    for (const line of text.split(/\r?\n/)) {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (fence) {
        if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
        continue;
      }
      if (marker) { fence = { character: marker[1][0], length: marker[1].length }; continue; }
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(cell => cell.trim());
      if (cells.length === 4 && cells.join("|") === "时间|城市层级地点|描述|备注") return true;
    }
    return false;
  }
  function parse(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES) fail("导入内容过大，请使用不超过 1 MiB 的足迹文档。");
    let source = text.trim().replace(/^\uFEFF/, "");
    if (!source.startsWith("{")) {
      if (hasTimelineTable(source)) fail("这是以时间表为准的表格文档。请先用本地更新器转换为足迹 JSON，或逐条填写并确认城市；不会读取文档内可能过时的 JSON 代码块。");
      const matches = [...source.matchAll(/^```footprints\s*\r?\n([\s\S]*?)^```\s*$/gm)];
      if (matches.length !== 1) fail("Markdown 需要恰好一个以 ```footprints 开头的 JSON 代码块。");
      source = matches[0][1];
    }
    let value;
    try { value = JSON.parse(source); } catch (_) { fail("JSON 格式有误，请检查双引号、逗号与括号。"); }
    return validate(value);
  }
  function merge(current, incoming) {
    const before = validate(current), next = validate(incoming), ids = new Map(before.records.map(item => [item.id, item]));
    let skipped = 0; const additions = [];
    for (const item of next.records) {
      if (ids.has(item.id)) {
        if (JSON.stringify(ids.get(item.id)) !== JSON.stringify(item)) fail(`id “${item.id}”与现有经历冲突。本次未导入任何记录；请先修改 id 或编辑原记录。`);
        skipped++;
      } else additions.push(item);
    }
    if (before.records.length + additions.length > MAX_RECORDS) fail(`合并后超过 ${MAX_RECORDS} 条，未更改现有地图。`);
    return { document: { version: 1, title: before.records.length ? before.title : next.title, records: before.records.concat(additions) }, added: additions.length, skipped };
  }
  function sorted(records) {
    return records.slice().sort((a, b) => (a.start ? dateBounds(a.start).min : Infinity) - (b.start ? dateBounds(b.start).min : Infinity) ||
      (Number.isSafeInteger(a.sequence) && Number.isSafeInteger(b.sequence) ? a.sequence - b.sequence : 0) || a.id.localeCompare(b.id));
  }
  function range(item) {
    if (item.ongoing === true) return `${item.start || "起始未知"} — 至今`;
    if (!item.start && !item.end) return "日期待确认";
    if (item.start && item.start === item.end) return item.start;
    return `${item.start || "起始未知"} — ${item.end || "结束未知"}`;
  }
  function cityKey(item) { return JSON.stringify([item.country, item.region, item.city, item.lat.toFixed(4), item.lon.toFixed(4)]); }
  function json(document) { return JSON.stringify(validate(document), null, 2); }
  function markdown(document) { return `# ${validate(document).title.replace(/[\r\n]/g, " ")}\n\n日期可用 YYYY、YYYY-MM、YYYY-MM-DD；空白表示未知，不能据此推断“至今”。坐标仅用于城市中心示意。\n\n\`\`\`footprints\n${json(document)}\n\`\`\`\n`; }
  return { MAX_BYTES, MAX_RECORDS, validate, parse, merge, sorted, range, cityKey, json, markdown, dateBounds };
});
