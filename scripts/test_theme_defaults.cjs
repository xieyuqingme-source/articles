// Theme regression: explicit choice > live system preference > safe light fallback.
// Executes the actual head bootstrap and runtime scripts without a browser.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const themeKey = 'xieyuqing-blog-theme';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function harness(source, options = {}) {
  const { saved = null, systemDark = false, storageFails = false, mediaUnavailable = false, legacyMedia = false } = options;
  const stored = new Map(saved === null ? [] : [[themeKey, saved]]);
  const events = {};
  const label = { textContent: '' };
  const button = {
    hidden: true,
    attributes: {},
    querySelector: () => label,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { events[name] = callback; }
  };
  const document = {
    documentElement: { dataset: { theme: 'light' } },
    querySelector: (selector) => selector === '#theme-toggle' ? button : null
  };
  let listener;
  const media = { matches: systemDark };
  if (legacyMedia) media.addListener = (callback) => { listener = callback; };
  else media.addEventListener = (name, callback) => { assert.equal(name, 'change'); listener = callback; };
  const window = {};
  if (!mediaUnavailable) window.matchMedia = (query) => { assert.equal(query, '(prefers-color-scheme: dark)'); return media; };
  const localStorage = {
    getItem(key) { if (storageFails) throw new Error('Storage denied'); return stored.get(key) ?? null; },
    setItem(key, value) { if (storageFails) throw new Error('Storage denied'); stored.set(key, value); }
  };
  vm.runInNewContext(source, { document, window, localStorage }, { timeout: 1000 });
  return {
    document, button, label, stored,
    get theme() { return document.documentElement.dataset.theme; },
    click() { events.click(); },
    systemChange(dark) { media.matches = dark; if (listener) listener({ matches: dark }); }
  };
}

for (const file of ['home/assets/portal.js', 'blog/site.js']) {
  const source = read(file);
  test(`${file}: absent or invalid choice follows system; absent API falls back light`, () => {
    assert.equal(harness(source).theme, 'light');
    assert.equal(harness(source, { systemDark: true }).theme, 'dark');
    assert.equal(harness(source, { saved: 'invalid', systemDark: true }).theme, 'dark');
    assert.equal(harness(source, { mediaUnavailable: true }).theme, 'light');
  });
  test(`${file}: saved light and dark override system and remain unchanged`, () => {
    for (const saved of ['light', 'dark']) {
      const ui = harness(source, { saved, systemDark: saved !== 'dark' });
      assert.equal(ui.theme, saved);
      ui.systemChange(saved === 'light');
      assert.equal(ui.theme, saved);
      assert.equal(ui.stored.get(themeKey), saved);
    }
  });
  test(`${file}: no saved choice follows live system changes without writing a preference`, () => {
    const ui = harness(source);
    ui.systemChange(true); assert.equal(ui.theme, 'dark');
    ui.systemChange(false); assert.equal(ui.theme, 'light');
    assert.equal(ui.stored.has(themeKey), false);
    const legacy = harness(source, { legacyMedia: true });
    legacy.systemChange(true); assert.equal(legacy.theme, 'dark');
  });
  test(`${file}: manual choice persists and stops system changes`, () => {
    const ui = harness(source, { systemDark: true });
    assert.equal(ui.button.hidden, false);
    ui.click(); assert.equal(ui.theme, 'light');
    assert.equal(ui.stored.get(themeKey), 'light');
    ui.systemChange(true); assert.equal(ui.theme, 'light');
    ui.click(); assert.equal(ui.theme, 'dark');
    assert.equal(ui.stored.get(themeKey), 'dark');
    assert.equal(harness(source, { saved: ui.stored.get(themeKey) }).theme, 'dark');
  });
  test(`${file}: rejected storage still follows system until a manual session choice`, () => {
    const ui = harness(source, { storageFails: true, systemDark: true });
    assert.equal(ui.theme, 'dark');
    ui.systemChange(false); assert.equal(ui.theme, 'light');
    ui.click(); assert.equal(ui.theme, 'dark');
    ui.systemChange(false); assert.equal(ui.theme, 'dark');
    assert.equal(harness(source, { storageFails: true, mediaUnavailable: true }).theme, 'light');
  });
}

for (const file of [
  'home/index.template.html', 'home/about.template.html', 'home/projects.template.html',
  'home/game.template.html', 'home/ranking.template.html', 'scripts/build_blog.py'
]) {
  test(`${file}: light HTML plus early saved/system bootstrap before CSS`, () => {
    const html = read(file).replaceAll('{{', '{').replaceAll('}}', '}');
    assert.match(html, /<html[^>]*data-theme="light"/);
    const bootstrap = html.match(/<script>([^]*?)<\/script>/);
    assert(bootstrap, 'early inline script exists');
    assert(bootstrap.index < html.indexOf('<link rel="stylesheet"'), 'theme is selected before CSS');
    const source = bootstrap[1];
    assert.equal(harness(source).theme, 'light');
    assert.equal(harness(source, { systemDark: true }).theme, 'dark');
    assert.equal(harness(source, { saved: 'light', systemDark: true }).theme, 'light');
    assert.equal(harness(source, { saved: 'dark' }).theme, 'dark');
    assert.equal(harness(source, { saved: 'auto', systemDark: true }).theme, 'dark');
    assert.equal(harness(source, { storageFails: true, systemDark: true }).theme, 'dark');
    assert.equal(harness(source, { mediaUnavailable: true }).theme, 'light');
  });
}

for (const file of ['home/assets/portal.css', 'blog/style.css']) {
  test(`${file}: readable light CSS fallback and explicit dark palette`, () => {
    const css = read(file);
    const fallback = css.match(/^:root\s*\{([^]*?)\}/)[1];
    const dark = css.match(/:root\[data-theme="dark"\]\s*\{([^]*?)\}/)[1];
    assert.match(fallback, /color-scheme:\s*light/);
    assert.match(fallback, /--paper:\s*#f7f5ee/);
    assert.match(fallback, /--ink:\s*#243d32/);
    assert.match(dark, /color-scheme:\s*dark/);
    assert.match(dark, /--paper:\s*#090f19/);
    assert(!css.includes('prefers-color-scheme'), 'CSS cannot override an explicit saved choice');
  });
}
