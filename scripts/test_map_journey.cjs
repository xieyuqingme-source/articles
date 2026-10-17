"use strict";
const assert = require("node:assert/strict"), test = require("node:test");
const J = require("../home/assets/map-journey.js");
function record(id, start, end = start, options = {}) {
  return Object.assign({ id, start, end, city: id, region: "", country: "中国", lat: 30, lon: 110, title: id, description: `用户原文：${id}`, album: "", certainty: "confirmed", groupId: id, stayType: "visit" }, options);
}
const base = (id = "base", start = "2020-01", end = "2022-12", options = {}) => record(id, start, end, Object.assign({ stayType: "base" }, options));
const derived = result => result.scenes.filter(item => item.derived);

test("birth and first base use source text and do not acquire a synthetic earlier base", () => {
  const items = [record("birth", "2000-10", "2000-10", { description: "在秀水镇出生", sequence: 0 }), base("school", "2001", "2013-06", { description: "童年和小学在嘉兴海盐度过", sequence: 1 })];
  const before = JSON.stringify(items), result = J.build(items);
  assert.deepEqual(result.scenes.map(item => item.description), items.map(item => item.description));
  assert.equal(derived(result).length, 0); assert.equal(JSON.stringify(items), before);
});

test("one multi-stop table row returns once after its final city with no fabricated date or description", () => {
  const items = [base(), record("a", "2021-07", "2021-08", { groupId: "tour", sequence: 1 }), record("b", "2021-07", "2021-08", { groupId: "tour", sequence: 2, lon: 120 })]; items[0].sequence = 0;
  const result = J.build(items), returns = derived(result);
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "a", "b", "base"]);
  assert.equal(returns.length, 1); assert.equal(returns[0].start, ""); assert.equal(returns[0].end, "");
  assert.equal(returns[0].description, ""); assert.equal(returns[0].dateLabel, "返回日期未指定");
  assert.equal(returns[0].frameworkLabel, "返回长期居住地（演示）"); assert.equal(returns[0].baseGroupId, "base");
  assert.equal(items.length, 3); assert.equal(items[0].description, "用户原文：base");
});

test("separate outings each return but adjacent exact-date rows remain one continuous outing", () => {
  const result = J.build([base(), record("jan", "2021-01-04", "2021-01-09"), record("beijing", "2021-01-10", "2021-01-16"), record("march", "2021-03-01", "2021-03-03")]);
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "jan", "beijing", "base", "march", "base"]);
});

test("overlapping month-precision rows do not imply an intervening return", () => {
  const result = J.build([base(), record("beihai", "2021-01"), record("wenling", "2021-01", "2021-03")]);
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "beihai", "wenling", "base"]);
});

test("confirmed continuous groups join the specified rows across a gap without changing source dates", () => {
  const items = [base(), record("wuhan", "2021-02-11", "2021-02-12"), record("newyear", "2021-02-13", "2021-02-25"), record("chongqing", "2021-02-27", "2021-03-03")];
  assert.equal(J.build(items).warnings[0].code, "short-gap");
  const result = J.build(items, { continuousGroups: [["wuhan", "newyear", "chongqing"]] });
  assert.equal(derived(result).length, 1); assert.equal(result.scenes[3].start, "2021-02-27");
  assert.equal(result.warnings.length, 0);
});

test("a one-day unrecorded gap suppresses a speculative return without merging source rows", () => {
  const items = [base(), record("first", "2021-02-13", "2021-02-25"), record("second", "2021-02-27", "2021-03-03")];
  const result = J.build(items);
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "first", "second", "base"]);
  assert.equal(result.scenes[1].groupId, "first"); assert.equal(result.scenes[2].groupId, "second");
  assert.deepEqual(result.warnings.map(item => item.code), ["short-gap"]);
  assert.equal(items[1].end, "2021-02-25"); assert.equal(items[2].start, "2021-02-27");
  const longerGap = J.build([base(), items[1], record("later", "2021-02-28", "2021-03-03")]);
  assert.equal(derived(longerGap).length, 2); assert.equal(longerGap.warnings.length, 0);
});

test("explicit returnAfter splits adjacent rows and overrides continuous-group and short-gap inference", () => {
  const items = [base(), record("sichuan-jan", "2021-01-04", "2021-01-09", { returnAfter: true }), record("beijing", "2021-01-10", "2021-01-16"), record("wuhan", "2021-02-11", "2021-02-12", { returnAfter: true }), record("sichuan-feb", "2021-02-13", "2021-02-25", { returnAfter: true }), record("chongqing", "2021-02-27", "2021-03-03")];
  const result = J.build(items, { continuousGroups: [["sichuan-jan", "beijing"], ["wuhan", "sichuan-feb", "chongqing"]] });
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "sichuan-jan", "base", "beijing", "base", "wuhan", "base", "sichuan-feb", "base", "chongqing", "base"]);
  assert.equal(result.warnings.length, 0);
  assert.ok(derived(result).every(item => item.start === "" && item.end === "" && item.dateLabel === "返回日期未指定" && item.description === ""));
});

test("returnAfter on a multi-city group produces one return after its final city", () => {
  const result = J.build([base(), record("sichuan-one", "2021-01-04", "2021-01-09", { groupId: "sichuan", sequence: 1, returnAfter: true }), record("sichuan-two", "2021-01-04", "2021-01-09", { groupId: "sichuan", sequence: 2, returnAfter: true }), record("beijing", "2021-01-10", "2021-01-16", { sequence: 3 })].map((item, index) => Object.assign({ sequence: index }, item)));
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["base", "sichuan-one", "sichuan-two", "base", "beijing", "base"]);
});

test("multi-city base requires an explicit record ID and never silently guesses a return city", () => {
  const items = [base("dongguan", "2020-01", "2022-12", { groupId: "bay", sequence: 0 }), base("shenzhen", "2020-01", "2022-12", { groupId: "bay", sequence: 1 }), record("trip", "2021-01", "2021-02", { sequence: 2, lon: 120 })];
  const unresolved = J.build(items); assert.equal(derived(unresolved).length, 0); assert.equal(unresolved.warnings[0].code, "base-city-required");
  const resolved = J.build(items, { baseChoices: { bay: "shenzhen" } }); assert.equal(derived(resolved)[0].sourceId, "shenzhen");
  assert.equal(derived(J.build(items, { baseChoices: { bay: "missing" } })).length, 0);
});

test("one explicit baseReturn designates its city; options take precedence and conflicting flags never guess", () => {
  const items = [base("dongguan", "2020-01", "2022-12", { groupId: "bay", sequence: 0, baseReturn: true }), base("shenzhen", "2020-01", "2022-12", { groupId: "bay", sequence: 1 }), record("trip", "2021-01", "2021-02", { sequence: 2, lon: 120 })];
  assert.equal(derived(J.build(items))[0].sourceId, "dongguan");
  assert.equal(derived(J.build(items, { baseChoices: { bay: "shenzhen" } }))[0].sourceId, "shenzhen");
  const invalid = J.build(items, { baseChoices: { bay: "missing" } }); assert.equal(derived(invalid).length, 0); assert.equal(invalid.warnings[0].code, "invalid-base-choice");
  const conflicting = items.map(item => Object.assign({}, item, item.id === "shenzhen" ? { baseReturn: true } : {}));
  const ambiguous = J.build(conflicting); assert.equal(derived(ambiguous).length, 0); assert.equal(ambiguous.warnings[0].code, "ambiguous-base-return");
  assert.equal(derived(J.build(conflicting, { baseChoices: { bay: "dongguan" } }))[0].sourceId, "dongguan");
});

test("return is omitted when the outing ends at its base city, preserving the original stay", () => {
  const home = base("home"), outing = record("home-visit", "2021-01", "2021-02", { city: home.city });
  assert.equal(derived(J.build([home, outing])).length, 0);
  assert.equal(J.build([home, outing]).scenes[1].description, "用户原文：home-visit");
});

test("an outing crossing a base end is not returned to the former base", () => {
  const result = J.build([base("old", "2020-01", "2021-12"), record("trip", "2021-11", "2022-02"), base("new", "2022-01", "2023-12")]);
  assert.equal(derived(result).length, 0); assert.equal(result.warnings[0].code, "uncertain-base-span");
});

test("a move immediately after an outing does not create a return to the old base", () => {
  const result = J.build([base("old", "2020-01-01", "2022-12-31"), record("trip", "2021-01-04", "2021-01-09"), base("new", "2021-01-10", "2023-12")]);
  assert.equal(derived(result).length, 0); assert.equal(result.warnings[0].code, "base-change");
});

test("overlapping bases are ambiguous and do not acquire an arbitrary return", () => {
  const result = J.build([base("one"), base("two", "2021-01", "2023-12"), record("trip", "2021-05", "2021-06")]);
  assert.equal(derived(result).length, 0); assert.equal(result.warnings[0].code, "ambiguous-base");
});

test("unknown ends and month-boundary ambiguity do not become precise return claims", () => {
  assert.equal(derived(J.build([base(), record("unknown", "2021-02", "")])).length, 0);
  const uncertain = J.build([base("home", "2020-09", "2021-10"), record("edge", "2021-10-10", "2021-10-12")]);
  assert.equal(derived(uncertain).length, 0); assert.equal(uncertain.warnings[0].code, "uncertain-base-span");
  const valid = J.build([base("home", "2020-09", "2021-10"), record("inside", "2021-06", "2021-07")]); assert.equal(derived(valid).length, 1);
});

test("explicit ongoing base accepts completed visits; ongoing visits never get a future return", () => {
  const home = base("home", "2020-01", "", { ongoing: true });
  assert.equal(derived(J.build([home, record("trip", "2022-01", "2022-02")])).length, 1);
  assert.equal(derived(J.build([home, record("ongoing", "2022-01", "", { ongoing: true })])).length, 0);
  assert.equal(J.dateLabel(home), "2020-01 — 至今"); assert.equal(J.dateLabel(record("unknown", "2020-01", "")), "2020-01 — 结束未知");
});

test("authoritative table sequence and multi-city group order survive equal/overlapping dates", () => {
  const result = J.build([record("second-city", "2021-01", "2021-03", { groupId: "row", sequence: 2 }), base("home", "2020-01", "2022-12", { sequence: 0 }), record("first-city", "2021-01", "2021-03", { groupId: "row", sequence: 1 })]);
  assert.deepEqual(result.scenes.map(item => item.sourceId), ["home", "first-city", "second-city", "home"]);
});

test("legacy records remain chronological and have no invented residence semantics", () => {
  const items = [record("later", "2022"), record("earlier", "2021")].map(({ stayType, groupId, ...item }) => item);
  assert.deepEqual(J.build(items).scenes.map(item => item.sourceId), ["earlier", "later"]); assert.equal(derived(J.build(items)).length, 0);
});

test("date precision bounds cover leap years, low years and invalid dates", () => {
  assert.equal(J.dateBounds("2020-02").max - J.dateBounds("2020-02").min, 28 * 86400000);
  assert.equal(J.dateBounds("0099-12-31").min + 86400000, J.dateBounds("0100-01-01").min);
  assert.equal(J.dateBounds("2021-02-29"), null); assert.equal(J.dateBounds(""), null);
});

test("normal video dwells two seconds for short original descriptions and travels for 0.8 seconds", () => {
  const p = J.plan([record("a", "2020", "2020", { lon: 100 }), record("b", "2021", "2021", { lon: 120 })], { introMs: 0 });
  assert.equal(p.durationMs, 4800); assert.deepEqual(p.segments.map(segment => segment.durationMs), [2000, 800, 2000]);
  const start = J.frameAt(p, 0); assert.equal(start.record.id, "a"); assert.equal(start.pageText, "用户原文：a"); assert.equal(start.cumulativePath.length, 1);
  const moving = J.frameAt(p, 2200); assert.equal(moving.phase, "travel"); assert.equal(moving.rawProgress, 0.25); assert.equal(moving.progress, 0.15625); assert.equal(moving.point.lon, 103.125);
  assert.equal(J.frameAt(p, 2800).record.id, "b"); assert.equal(J.frameAt(p, p.durationMs).ended, true);
});

test("cumulative route never draws a future segment and matches the eased avatar position", () => {
  const records = [record("a", "2020", "2020", { lon: 100 }), record("b", "2021", "2021", { lon: 120 }), record("c", "2022", "2022", { lon: 140 })], p = J.plan(records, { introMs: 0 });
  assert.deepEqual(J.frameAt(p, 1999).cumulativePath.map(point => point.lon), [100]);
  const moving = J.frameAt(p, 2400); assert.deepEqual(moving.cumulativePath.map(point => point.lon), [100, 110]); assert.deepEqual(moving.cumulativePath.at(-1), moving.point);
  assert.deepEqual(J.frameAt(p, 3000).cumulativePath.map(point => point.lon), [100, 120]);
  assert.deepEqual(J.frameAt(p, p.durationMs).cumulativePath.map(point => point.lon), [100, 120, 140]);
});

test("long original text is paginated completely and dwell time scales with reading length", () => {
  const text = "用户自己的长描述。".repeat(65) + " 👩🏽‍💻\n结尾 <script>alert(1)</script>", pages = J.paginate(text, 120);
  assert.ok(pages.length > 1); assert.equal(pages.join(""), text); assert.ok(pages.every(page => !page.endsWith("\ud83d")));
  const p = J.plan([record("long", "2020", "2020", { description: text })], { maxPageChars: 120 });
  assert.equal(p.segments.map(segment => segment.pageText).join(""), text); assert.ok(p.durationMs > 10000);
  for (const segment of p.segments) assert.equal(J.frameAt(p, segment.startMs).pageText, segment.pageText);
});

test("explicit newline pages are bounded and a measured text paginator preserves every character", () => {
  const text = Array.from({ length: 30 }, (_, index) => `第${index + 1}行\n`).join(""), pages = J.paginate(text, 100, 4);
  assert.equal(pages.join(""), text); assert.ok(pages.every(page => page.replace(/\n$/, "").split("\n").length <= 4));
  const item = record("lines", "2020", "2020", { description: text });
  const p = J.plan([item], { textPaginator: () => pages }); assert.deepEqual(p.segments.filter(segment => segment.phase === "stay").map(segment => segment.pageText), pages);
  assert.throws(() => J.plan([item], { textPaginator: () => ["遗漏了原文"] }), /完整保留/);
});

test("pace applies consistently to pauses and movement; empty plans and endpoints are stable", () => {
  const items = [record("a", "2020"), record("b", "2021")];
  assert.equal(J.plan(items, { pace: "brisk", introMs: 0 }).durationMs, 3600); assert.equal(J.plan(items, { pace: "relaxed", introMs: 0 }).durationMs, 6240);
  assert.equal(J.plan(items, { pace: "unknown" }).pace, "normal");
  assert.equal(J.frameAt(J.plan([]), 100).index, -1); assert.equal(J.frameAt(J.plan(items), -100).elapsed, 0);
  assert.equal(J.frameAt(J.plan(items), Infinity).elapsed, 5600); assert.equal(J.frameAt(J.plan(items), 99999).record.id, "b");
});

test("default intro contains no city, avatar point or route and does not change the number of scenes", () => {
  const items = [record("birth", "2000-10"), record("school", "2001")], p = J.plan(items);
  assert.equal(p.introMs, 800); assert.equal(p.scenes.length, 2); assert.equal(p.durationMs, 5600);
  for (const time of [0, 1, 400, 799.99]) {
    const frame = J.frameAt(p, time);
    assert.equal(frame.phase, "intro"); assert.equal(frame.index, -1); assert.equal(frame.record, null); assert.equal(frame.next, null);
    assert.equal(frame.point, null); assert.deepEqual(frame.cumulativePath, []); assert.equal(J.unlocked(p.scenes, frame).size, 0);
  }
  const arrived = J.frameAt(p, 800); assert.equal(arrived.record.id, "birth"); assert.deepEqual([...J.unlocked(p.scenes, arrived)], [J.cityKey(items[0])]);
  assert.equal(J.plan(items, { introMs: 0 }).introMs, 0); assert.equal(J.plan([]).durationMs, 0);
});

test("cities unlock only upon arrival; future destinations remain hidden during travel", () => {
  const items = [record("first", "2020", "2020", { lon: 100 }), record("second", "2021", "2021", { lon: 120 }), record("third", "2022", "2022", { lon: 140 })], p = J.plan(items);
  for (const time of [800, 2799, 2800, 3200, 3599.99]) assert.deepEqual([...J.unlocked(p.scenes, J.frameAt(p, time))], [J.cityKey(items[0])]);
  assert.deepEqual([...J.unlocked(p.scenes, J.frameAt(p, 3600))], [J.cityKey(items[0]), J.cityKey(items[1])]);
  assert.equal(J.unlocked(p.scenes, J.frameAt(p, p.durationMs)).size, 3);
});

test("repeat visits and derived base returns do not increase the number of unlocked cities", () => {
  const first = record("first", "2020", "2020", { city: "同城", lon: 100 }), second = record("second", "2021", "2021", { lon: 120 });
  const items = [first, second, Object.assign({}, first, { id: "return", derived: true }), Object.assign({}, first, { id: "visit-again" })], p = J.plan(items);
  assert.equal(J.unlocked(p.scenes, J.frameAt(p, 3600)).size, 2);
  assert.equal(J.unlocked(p.scenes, J.frameAt(p, 6400)).size, 2);
  assert.equal(J.unlocked(p.scenes, J.frameAt(p, p.durationMs)).size, 2);
  const M = require("../home/assets/map-model.js"); assert.equal(J.cityKey(first), M.cityKey(first));
  assert.equal(J.unlocked(items, { index: 0, phase: "stay", elapsed: 0 }).size, 0);
});

test("same-city movement stays fixed and dateline interpolation takes the shorter geographic segment", () => {
  assert.deepEqual(J.interpolate({ lon: 10, lat: 20 }, { lon: 10, lat: 20 }, 0.5), { lon: 10, lat: 20 });
  assert.equal(J.interpolate({ lon: 179, lat: 0 }, { lon: -179, lat: 0 }, 0.25).lon, 179.5);
  assert.equal(J.interpolate({ lon: 179, lat: 0 }, { lon: -179, lat: 0 }, 0.75).lon, -179.5);
});
