// Test the shipped TOC script in a minimal DOM harness. This does not claim browser layout QA.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'blog/site.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'blog/style.css'), 'utf8');
const preferenceKey = 'xieyuqing-toc-position';
const checks = [];
function check(name, callback) { callback(); checks.push(name); }
class Element {
  constructor() { this.events = {}; this.attributes = {}; this.hidden = false; this.dataset = {}; this.style = {}; this.focusCount = 0; }
  addEventListener(name, fn, options = {}) { (this.events[name] ||= []).push({ fn, once: options.once }); }
  emit(name, event = {}) {
    for (const handler of [...(this.events[name] || [])]) {
      handler.fn(event);
      if (handler.once) this.events[name] = this.events[name].filter(item => item !== handler);
    }
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  focus(options) { this.focusCount += 1; this.focusOptions = options; }
}
function setup({ narrow = false, stored = new Map(), storageGetThrows = false, storageSetThrows = false,
  hasToc = true, count = 2, hasContent = true, legacyMedia = false } = {}) {
  const headings = Array.from({ length: count }, (_, i) => {
    const heading = new Element(); heading.id = i ? 'section-two' : '第一章'; heading.top = i ? 250 : 60;
    heading.getBoundingClientRect = () => ({ top: heading.top }); return heading;
  });
  const links = headings.map(heading => { const link = new Element(); link.hash = `#${encodeURIComponent(heading.id)}`; return link; });
  const summary = new Element(); summary.setAttribute('aria-controls', 'article-toc-links');
  const details = new Element(); details.open = true; details.querySelector = selector => selector === 'summary' ? summary : null;
  const toc = new Element(); toc.querySelector = selector => selector === 'details' ? details : null;
  toc.querySelectorAll = selector => selector === 'nav a' ? links : [];
  const layout = new Element(); layout.dataset.tocPosition = 'right';
  const controls = new Element(); controls.hidden = true;
  const buttons = ['left', 'right', 'hidden'].map(position => { const button = new Element(); button.dataset.tocPosition = position; return button; });
  controls.querySelectorAll = selector => selector === '[data-toc-position]' ? buttons : [];
  const table = new Element(), content = new Element(), progress = new Element();
  content.querySelectorAll = selector => selector.startsWith('h2') ? headings : selector === 'table' ? [table] : [];
  content.offsetHeight = 1200; content.getBoundingClientRect = () => ({ top: 0 });
  const document = { documentElement: { dataset: {} },
    querySelector(selector) { return ({ '#article-content': hasContent ? content : null, '.article-toc': hasToc ? toc : null,
      '.reading-layout': layout, '.toc-controls': hasToc ? controls : null, '.reading-progress span': progress })[selector] || null; } };
  const media = new Element(); media.matches = narrow;
  if (legacyMedia) { media.addListener = fn => Element.prototype.addEventListener.call(media, 'change', fn); media.addEventListener = undefined; }
  const window = new Element(); window.scrollY = 0; window.innerHeight = 800;
  window.matchMedia = query => { assert.equal(query, '(max-width: 760px)'); return media; };
  window.requestAnimationFrame = fn => fn();
  window.location = new URL('https://xieyuqing.me/articles/posts/example.html');
  let historyCalls = 0;
  window.history = { replaceState() { historyCalls += 1; }, pushState() { historyCalls += 1; } };
  const localStorage = { getItem(key) { if (storageGetThrows) throw new Error('blocked storage'); return stored.get(key); },
    setItem(key, value) { if (storageSetThrows) throw new Error('quota'); stored.set(key, value); } };
  vm.runInNewContext(script, { document, window, localStorage, URL, URLSearchParams });
  return { headings, links, summary, details, toc, layout, controls, buttons, table, progress, window, stored,
    historyCalls: () => historyCalls,
    select(position) { buttons.find(button => button.dataset.tocPosition === position).emit('click'); },
    resize(isNarrow) { media.matches = isNarrow; media.emit('change'); window.emit('resize'); } };
}
check('desktop starts right with an expanded native TOC and controls', () => {
  const ui = setup(); assert.equal(ui.layout.dataset.tocPosition, 'right'); assert.equal(ui.details.open, true);
  assert.equal(ui.summary.getAttribute('aria-expanded'), 'true'); assert.equal(ui.summary.getAttribute('aria-controls'), 'article-toc-links');
  assert.equal(ui.controls.hidden, false); assert.equal(ui.buttons[1].getAttribute('aria-pressed'), 'true');
});
for (const position of ['left', 'right', 'hidden']) check(`desktop ${position} changes layout and persists the preference`, () => {
  const ui = setup(); ui.select(position); assert.equal(ui.layout.dataset.tocPosition, position);
  assert.equal(ui.stored.get(preferenceKey), position); assert.equal(ui.buttons.find(button => button.dataset.tocPosition === position).getAttribute('aria-pressed'), 'true');
  assert.equal(ui.buttons.filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
});
for (const position of ['left', 'right', 'hidden']) check(`saved ${position} is restored on another page load`, () => {
  const stored = new Map(); setup({ stored }).select(position); assert.equal(setup({ stored }).layout.dataset.tocPosition, position);
});
check('invalid stored preference falls back to right', () => {
  assert.equal(setup({ stored: new Map([[preferenceKey, 'overlay']]) }).layout.dataset.tocPosition, 'right');
});
check('blocked storage reads do not prevent layout controls or reading progress', () => {
  const ui = setup({ storageGetThrows: true }); ui.select('left'); assert.equal(ui.layout.dataset.tocPosition, 'left'); assert(ui.progress.style.width);
});
check('storage writes can fail while all three controls remain usable', () => {
  const ui = setup({ storageSetThrows: true }); for (const position of ['hidden', 'left', 'right']) { ui.select(position); assert.equal(ui.layout.dataset.tocPosition, position); }
});
check('hidden can be restored by controls outside the TOC', () => {
  const ui = setup(); ui.select('hidden'); assert.equal(ui.controls.hidden, false); ui.select('right'); assert.equal(ui.layout.dataset.tocPosition, 'right');
});
check('mobile hidden desktop preference still gives a collapsed, reachable summary', () => {
  const ui = setup({ narrow: true, stored: new Map([[preferenceKey, 'hidden']]) });
  assert.equal(ui.layout.dataset.tocPosition, 'right'); assert.equal(ui.details.open, false); assert.equal(ui.summary.getAttribute('aria-expanded'), 'false');
});
check('native summary toggle keeps aria-expanded synchronized', () => {
  const ui = setup({ narrow: true }); ui.details.open = true; ui.details.emit('toggle'); assert.equal(ui.summary.getAttribute('aria-expanded'), 'true');
  ui.details.open = false; ui.details.emit('toggle'); assert.equal(ui.summary.getAttribute('aria-expanded'), 'false');
});
check('mobile section selection collapses and transfers focus without canceling native hash navigation', () => {
  const ui = setup({ narrow: true }); ui.details.open = true; ui.details.emit('toggle');
  let prevented = false; ui.links[0].emit('click', { button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, false); assert.equal(ui.details.open, false); assert.equal(ui.summary.getAttribute('aria-expanded'), 'false');
  assert.equal(ui.headings[0].focusCount, 1); assert.equal(ui.headings[0].focusOptions.preventScroll, true);
  assert.equal(ui.headings[0].getAttribute('tabindex'), '-1'); assert.equal(ui.historyCalls(), 0);
});
check('temporary heading tabindex is removed on blur', () => {
  const ui = setup({ narrow: true }); ui.links[0].emit('click'); ui.headings[0].emit('blur'); assert.equal(ui.headings[0].hasAttribute('tabindex'), false);
});
check('existing heading tabindex is preserved', () => {
  const ui = setup({ narrow: true }); ui.headings[0].setAttribute('tabindex', '0'); ui.links[0].emit('click'); ui.headings[0].emit('blur');
  assert.equal(ui.headings[0].getAttribute('tabindex'), '0');
});
check('modified clicks do not unexpectedly collapse or move focus', () => {
  const ui = setup({ narrow: true }); ui.details.open = true; ui.links[0].emit('click', { ctrlKey: true });
  assert.equal(ui.details.open, true); assert.equal(ui.headings[0].focusCount, 0);
});
check('desktop section links retain the native expanded TOC and history', () => {
  const ui = setup(); ui.links[0].emit('click'); assert.equal(ui.details.open, true); assert.equal(ui.headings[0].focusCount, 0); assert.equal(ui.historyCalls(), 0);
});
check('viewport changes restore the desktop preference without writing mobile state', () => {
  const ui = setup(); ui.select('hidden'); ui.resize(true); assert.equal(ui.layout.dataset.tocPosition, 'right'); assert.equal(ui.details.open, false);
  ui.select('left'); assert.equal(ui.stored.get(preferenceKey), 'hidden'); ui.resize(false);
  assert.equal(ui.layout.dataset.tocPosition, 'hidden'); assert.equal(ui.details.open, true); assert.equal(ui.stored.get(preferenceKey), 'hidden');
});
check('legacy matchMedia change listeners remain usable', () => {
  const ui = setup({ legacyMedia: true }); ui.select('left'); ui.resize(true); assert.equal(ui.details.open, false); ui.resize(false); assert.equal(ui.layout.dataset.tocPosition, 'left');
});
check('articles without headings never reveal an empty TOC toolbar', () => {
  const ui = setup({ count: 0 }); assert.equal(ui.controls.hidden, true); assert(ui.progress.style.width);
});
check('articles without a TOC still enhance accessible tables and progress', () => {
  const ui = setup({ hasToc: false }); assert.equal(ui.table.tabIndex, 0); assert(ui.table.getAttribute('aria-label')); assert(ui.progress.style.width);
});
check('archive and other non-reading pages need no matchMedia or TOC APIs', () => {
  assert.doesNotThrow(() => setup({ hasContent: false, hasToc: false }));
});
check('current-section hint updates on scrolling, including Chinese encoded anchors', () => {
  const ui = setup(); assert.equal(ui.links[0].getAttribute('aria-current'), 'location'); assert.equal(ui.links[1].hasAttribute('aria-current'), false);
  ui.headings[0].top = -150; ui.headings[1].top = 80; ui.window.emit('scroll');
  assert.equal(ui.links[1].getAttribute('aria-current'), 'location'); assert.equal(ui.links[0].hasAttribute('aria-current'), false);
});
check('malformed fragment does not break scrolling or close the mobile TOC', () => {
  const ui = setup({ narrow: true }); ui.links[0].hash = '#%broken'; ui.details.open = true;
  assert.doesNotThrow(() => { ui.links[0].emit('click'); ui.window.emit('scroll'); }); assert.equal(ui.details.open, true);
});
check('CSS supplies mobile, left, hidden, no-TOC and reduced-motion fallbacks', () => {
  assert(css.includes('.reading-layout[data-toc-position="left"]'));
  assert(css.includes('.reading-layout[data-toc-position="hidden"] .article-toc { display: none; }'));
  assert(css.includes('.reading-layout-no-toc')); assert(css.includes('@media (max-width: 760px)'));
  assert(css.includes('.toc-controls { display: none; }')); assert(css.includes('minmax(0, 1fr)')); assert(css.includes('prefers-reduced-motion'));
  assert(!/wechat/i.test(css));
});
console.log(`PASS ${checks.length} TOC interaction and CSS checks; VM DOM simulation, real browser and phone layout untested`);
