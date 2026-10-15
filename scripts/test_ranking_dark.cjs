'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const Model = require('../home/assets/ranking-model.js');
const Export = require('../home/assets/ranking-export.js');

function fixture(skin = 'classic') {
  return { version: 3, templateId: 'food', title: '经典明暗导出', skin,
    rows: [
      { id: 'light-label', name: '浅色标签', color: '#f28b82', itemIds: ['plain-item'] },
      { id: 'dark-label', name: '深色标签', color: '#101010', itemIds: [] }
    ], pool: [], items: { 'plain-item': { id: 'plain-item', name: '浙江干挑面', image: null, art: null, crop: null } } };
}
async function draw(state, options, documentTheme) {
  const original = global.document;
  const fills = [], text = [], strokes = [];
  const context = {
    scale() {}, beginPath() {}, rect() {}, roundRect() {}, fill() {}, moveTo() {}, lineTo() {},
    fillRect(...bounds) { fills.push({ color: this.fillStyle, bounds }); },
    fillText(value, ...point) { text.push({ value, color: this.fillStyle, point }); },
    strokeRect(...bounds) { strokes.push({ color: this.strokeStyle, width: this.lineWidth, bounds }); },
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth }); },
    measureText(value) { return { width: Array.from(value).length * 16 }; }
  };
  const canvas = { width: 0, height: 0, getContext: () => context,
    toBlob(callback) { callback(new Blob(['canvas fixture'], { type: 'image/png' })); } };
  global.document = { documentElement: { dataset: { theme: documentTheme } }, createElement: () => canvas };
  try { return { result: await Export.exportRanking(state, options), fills, text, strokes }; }
  finally { if (original === undefined) delete global.document; else global.document = original; }
}
function contrast(first, second) {
  const luminance = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('classic dark draws a black canvas, dark grey rows and readable light title and names', async () => {
  const rendered = await draw(fixture(), { theme: 'dark', scale: 2 }, 'light');
  assert.equal(rendered.fills[0].color, '#000000');
  assert.equal(rendered.fills.filter(fill => fill.color === '#202020').length, 2);
  assert.equal(rendered.text.find(entry => entry.value === '经典明暗导出').color, '#f1f1f1');
  assert.equal(rendered.text.find(entry => entry.value === '浙江干挑面').color, '#f1f1f1');
  assert(rendered.strokes.every(stroke => stroke.color === '#888888' && stroke.width === 2));
  assert(contrast('#f1f1f1', '#202020') >= 7);
  assert(contrast('#888888', '#202020') >= 3);
});

test('classic tier label ink stays independent from light card ink in dark mode', async () => {
  const rendered = await draw(fixture(), { theme: 'dark' }, 'dark');
  assert.equal(rendered.text.find(entry => entry.value === '浅色标签').color, '#171717');
  assert.equal(rendered.text.find(entry => entry.value === '深色标签').color, '#ffffff');
  assert(contrast('#171717', '#f28b82') >= 4.5);
  assert(contrast('#ffffff', '#101010') >= 4.5);
});

test('explicit light export preserves the classic spreadsheet palette on a dark page', async () => {
  const rendered = await draw(fixture(), { theme: 'light' }, 'dark');
  assert.equal(rendered.fills[0].color, '#f7f5ee');
  assert.equal(rendered.fills.filter(fill => fill.color === '#f3f3f3').length, 2);
  assert.equal(rendered.text.find(entry => entry.value === '浙江干挑面').color, '#171717');
  assert(rendered.strokes.every(stroke => stroke.color === '#262626'));
});

test('default export follows the active page theme with a light fallback', async () => {
  assert.equal((await draw(fixture(), {}, 'dark')).fills[0].color, '#000000');
  assert.equal((await draw(fixture(), {}, undefined)).fills[0].color, '#f7f5ee');
});

test('theme changes colors without changing saved data, row layout or export resolution', async () => {
  const state = Model.validateState(fixture());
  const before = JSON.stringify(state);
  const light = await draw(state, { theme: 'light', scale: 2 }, 'light');
  const dark = await draw(state, { theme: 'dark', scale: 2 }, 'dark');
  const dimensions = value => ({ width: value.result.width, height: value.result.height, scale: value.result.scale });
  assert.deepEqual(dimensions(light), dimensions(dark));
  assert.deepEqual(light.fills.map(fill => fill.bounds), dark.fills.map(fill => fill.bounds));
  assert.deepEqual(light.text.map(entry => entry.point), dark.text.map(entry => entry.point));
  assert.equal(JSON.stringify(state), before);
});

test('tech export retains its existing colors in both themes', async () => {
  const light = await draw(fixture('tech'), { theme: 'light' }, 'light');
  const dark = await draw(fixture('tech'), { theme: 'dark' }, 'dark');
  assert.deepEqual(light.fills, dark.fills);
  assert.deepEqual(light.text, dark.text);
  assert.deepEqual(light.strokes, dark.strokes);
});
