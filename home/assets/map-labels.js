(function (root, factory) {
  "use strict";
  const labels = factory();
  if (typeof module === "object" && module.exports) module.exports = labels;
  else root.FootprintsLabels = labels;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  function number(value, fallback, minimum) {
    const result = value === undefined ? fallback : value;
    if (!finite(result) || result < minimum) throw new RangeError("Invalid label layout size");
    return result;
  }
  // This estimate only determines placement when a renderer has no text metrics.
  // Array.from counts Unicode code points rather than UTF-16 halves.
  function estimate(text, size) {
    return Array.from(text).reduce((width, character) => width + (/\p{Mark}/u.test(character) ? 0 : /\s/u.test(character) ? .35 : /[\u0020-\u007e]/u.test(character) ? .6 : 1), 0) * size;
  }
  function overlaps(a, b, gap) {
    return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
  }
  function layout(cities, options = {}) {
    if (!Array.isArray(cities)) throw new TypeError("Label candidates must be an array");
    const width = number(options.width, 1000, Number.EPSILON), height = number(options.height, 600, Number.EPSILON);
    const fontSize = number(options.fontSize, 14, Number.EPSILON), lineHeight = number(options.lineHeight, 18, Number.EPSILON);
    const margin = number(options.margin, 4, 0), gap = number(options.gap, 3, 0), radius = number(options.markerRadius, 4, 0), padding = number(options.padding, 3, 0);
    if (options.visibleSet != null && typeof options.visibleSet.has !== "function") throw new TypeError("visibleSet must provide has(key)");
    const byKey = new Map();
    cities.forEach((city, index) => {
      if (!city || typeof city.key !== "string" || !city.key || !finite(city.x) || !finite(city.y) || city.x < 0 || city.x > width || city.y < 0 || city.y > height || options.visibleSet != null && !options.visibleSet.has(city.key)) return;
      const text = typeof city.name === "string" ? city.name : city.city;
      if (typeof text !== "string" || !text.trim()) return;
      const priority = finite(city.priority) ? city.priority : 0, existing = byKey.get(city.key);
      const markerRadius = finite(city.markerRadius) && city.markerRadius >= 0 ? city.markerRadius : radius;
      if (!existing || priority > existing.priority) byKey.set(city.key, { key: city.key, text, x: city.x, y: city.y, markerRadius, priority, index: existing ? existing.index : index });
    });
    const candidates = Array.from(byKey.values()).sort((a, b) => b.priority - a.priority || a.index - b.index);
    const dots = candidates.map(city => ({ x: city.x - city.markerRadius, y: city.y - city.markerRadius, width: city.markerRadius * 2, height: city.markerRadius * 2 }));
    const reserved = Array.isArray(options.reserved) ? options.reserved.filter(rect => rect && finite(rect.x) && finite(rect.y) && finite(rect.width) && finite(rect.height) && rect.width >= 0 && rect.height >= 0) : [];
    const result = [], boxes = [];
    for (const city of candidates) {
      let measured;
      if (typeof options.measure === "function") {
        try { const value = options.measure(city.text, fontSize); measured = finite(value) ? value : value && value.width; } catch (_) { /* A missing renderer metric uses the same deterministic fallback. */ }
      }
      const textWidth = finite(measured) && measured >= 0 ? measured : estimate(city.text, fontSize);
      const boxWidth = Math.ceil(textWidth) + padding * 2, boxHeight = Math.max(lineHeight, fontSize) + padding * 2;
      const right = city.x + city.markerRadius + gap, left = city.x - city.markerRadius - gap - boxWidth;
      const above = city.y - city.markerRadius - gap - boxHeight, below = city.y + city.markerRadius + gap;
      const positions = [[right, above], [left, above], [right, below], [left, below]];
      for (const [x, y] of positions) {
        const box = { x, y, width: boxWidth, height: boxHeight };
        if (x < margin || y < margin || x + boxWidth > width - margin || y + boxHeight > height - margin || boxes.some(other => overlaps(box, other, gap)) || reserved.some(other => overlaps(box, other, gap)) || dots.some(dot => overlaps(box, dot, 0))) continue;
        // Baseline sits centrally within the requested line, with a small
        // descender allowance. Both SVG and Canvas use this exact placement.
        result.push({ key: city.key, text: city.text, x: x + padding, y: y + padding + (boxHeight - padding * 2 - fontSize) / 2 + fontSize * .8, width: boxWidth, height: boxHeight, box, anchor: "start" });
        boxes.push(box);
        break;
      }
    }
    return result;
  }
  return Object.freeze({ layout });
});
