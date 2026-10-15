// Run the actual archive script against generated-page metadata in a DOM harness.
// This verifies JavaScript behavior, not real browser layout or native clipboard.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const root = path.resolve(__dirname, '..');
const work = process.argv[2] || path.join(root, '.local-checks');
const generated = JSON.parse(fs.readFileSync(path.join(work, 'archive-test-data.json'), 'utf8'));
const script = fs.readFileSync(path.join(root, 'blog/site.js'), 'utf8');
class Node {
  constructor() { this.hidden = true; this.disabled = false; this.value = ''; this.textContent = ''; this.dataset = {}; this.events = {}; this.attributes = {}; this.classes = new Set(); this.classList = { toggle: (name, on) => { if (on) this.classes.add(name); else this.classes.delete(name); } }; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() { this.focused = true; }
  removeAttribute(name) { delete this.attributes[name]; }
  emit(name, event = {}) { this.events[name](event); }
}
function setup(name, query = '') {
  const data = generated[name], controls = new Node(), search = new Node(), year = new Node(), status = new Node(), empty = new Node(), pager = new Node(), previous = new Node(), next = new Node(), position = new Node(), reset = new Node(), theme = new Node(), themeLabel = new Node(), jumpForm = new Node(), jumpInput = new Node(), jumpButton = new Node(), jumpMessage = new Node();
  year.options = data.years.map(value => ({ value }));
  const cards = data.cards.map(item => { const node = new Node(), card = new Node(); node.dataset = { topic: item.topic, year: item.year, search: item.text }; node.closest = () => card; return { node, card }; });
  const filters = data.filters.map(value => { const node = new Node(); node.dataset.filter = value; return node; });
  jumpForm.querySelector = () => jumpButton;
  pager.querySelector = selector => ({ '[data-page="prev"]': previous, '[data-page="next"]': next, '.pagination-position': position, '.page-jump': jumpForm, '#article-page': jumpInput, '#page-jump-message': jumpMessage })[selector];
  const lookup = { '.archive-controls': controls, '#article-search': search, '#article-year': year, '.search-status': status, '.search-empty': empty, '.archive-pagination': pager, '.reset-search': reset };
  const archive = new Node();
  archive.querySelector = selector => lookup[selector];
  archive.querySelectorAll = selector => selector === '[data-filter]' ? filters : selector === '.article-card-content' ? cards.map(x => x.node) : [];
  archive.scrollIntoView = () => { archive.scrolled = true; };
  theme.querySelector = () => themeLabel;
  const document = { documentElement: { dataset: {} }, events: {}, querySelector: selector => ({ '.archive': archive, '#theme-toggle': theme })[selector] || null, addEventListener(name, fn) { this.events[name] = fn; } };
  const window = { location: new URL(`http://127.0.0.1:8767/articles/${name}${query}`), events: {}, addEventListener(name, fn) { this.events[name] = fn; } };
  window.history = { replaceState: (_state, _title, url) => { window.location = new URL(url); } };
  const stored = new Map(), localStorage = { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) };
  vm.runInNewContext(script, { document, window, localStorage, URL, URLSearchParams, console });
  return { jumpForm, jumpInput, jumpButton, jumpMessage, data, search, year, status, empty, pager, previous, next, position, reset, cards, filters, theme, document, window, visible: () => cards.filter(x => !x.card.hidden).map(x => x.node.dataset) };
}
const checks = [];
for (const name of Object.keys(generated)) {
  const ui = setup(name);
  assert.equal(ui.visible().length, Math.min(12, ui.cards.length));
  assert.equal(ui.previous.disabled, true);
  assert.equal(ui.pager.hidden, ui.cards.length <= 12);
  checks.push(`${name}: default page count and navigation`);
  let shown = ui.visible().map(x => x.search);
  while (!ui.next.disabled) { ui.next.emit('click'); shown.push(...ui.visible().map(x => x.search)); }
  assert.deepEqual(shown, ui.cards.map(x => x.node.dataset.search));
  checks.push(`${name}: all pages preserve order without omission or duplication`);
  ui.reset.emit('click');
  ui.search.value = 'no-result-8a03cdf1'; ui.search.emit('input');
  assert.equal(ui.visible().length, 0); assert.equal(ui.empty.hidden, false); assert.equal(ui.pager.hidden, true);
  ui.reset.emit('click'); assert.equal(ui.visible().length, Math.min(12, ui.cards.length));
  checks.push(`${name}: empty state and clear reset`);
  assert.equal(ui.document.documentElement.dataset.theme, 'light');
  ui.theme.emit('click'); assert.equal(ui.document.documentElement.dataset.theme, 'dark');
  ui.theme.emit('click'); assert.equal(ui.document.documentElement.dataset.theme, 'light');
  checks.push(`${name}: dark/light toggle`);
  if (ui.year.options.some(x => x.value === '2024')) {
    ui.year.value = '2024'; ui.year.emit('change');
    assert(ui.visible().every(x => x.year === '2024')); assert.equal(ui.position.textContent.startsWith('1 /'), true);
    ui.search.value = '资本论'; ui.search.emit('input');
    assert(ui.visible().every(x => x.year === '2024' && x.search.includes('资本论')));
    const expected = ui.cards.filter(x => x.node.dataset.year === '2024' && x.node.dataset.search.includes('资本论')).length;
    assert.equal(ui.visible().length, Math.min(12, expected));
    checks.push(`${name}: combined original-year and search filters reset page`);
  }
  const economic = ui.filters.find(x => x.dataset.filter === '经济与社会');
  if (economic) {
    ui.reset.emit('click'); economic.emit('click');
    assert(ui.visible().every(x => x.topic === '经济与社会')); assert.equal(economic.attributes['aria-pressed'], 'true');
    checks.push(`${name}: topic filter and accessible state`);
  }
}
const restored = setup('index.html', '?year=2024&page=2');
assert.equal(restored.search.value, ''); assert.equal(restored.year.value, '2024');
assert(restored.visible().every(x => x.year === '2024'));
assert.equal(restored.position.textContent.startsWith('2 /'), true);
assert.equal(restored.window.location.search.includes('page=2'), true);
checks.push('index.html: saved year/page restored from URL');
const savedSearch = setup('index.html', '?q=资本论&year=2024&page=999');
assert.equal(savedSearch.search.value, '资本论');
assert(savedSearch.visible().length > 0);
assert(savedSearch.visible().every(x => x.year === '2024' && x.search.includes('资本论')));
assert.equal(savedSearch.next.disabled, true);
checks.push('index.html: saved search restored and out-of-range page clamped');
restored.window.location = new URL('http://127.0.0.1:8767/articles/index.html?year=2025');
restored.window.events.popstate(); assert(restored.visible().every(x => x.year === '2025')); assert.equal(restored.search.value, '');
checks.push('index.html: history state restores filters');

function jump(ui, value, enter = false) {
  ui.jumpInput.value = value;
  let prevented = false;
  const event = { key: 'Enter', isComposing: false, preventDefault() { prevented = true; } };
  (enter ? ui.jumpInput : ui.jumpForm).emit(enter ? 'keydown' : 'submit', event);
  assert(prevented, 'Submission must not reload the page.');
}
const direct = setup('index.html');
const total = Math.ceil(direct.cards.length / 12);
assert.equal(total, 10);
jump(direct, '6');
assert.deepEqual(direct.visible().map(x => x.search), direct.cards.slice(60,72).map(x => x.node.dataset.search));
assert.equal(direct.window.location.search, '?page=6');
checks.push('direct submit jumps to page 6 with exact cards and saved URL');
jump(direct, '7', true);
assert.deepEqual(direct.visible().map(x => x.search), direct.cards.slice(72,84).map(x => x.node.dataset.search));
assert.equal(direct.jumpInput.value, '7');
assert.equal(direct.window.location.search, '?page=7');
checks.push('Enter jumps to page 7 and updates page input and URL');
direct.previous.emit('click'); assert.equal(direct.jumpInput.value, '6');
direct.next.emit('click'); assert.equal(direct.jumpInput.value, '7');
checks.push('previous and next remain usable after a direct jump');
for (const invalid of ['', ' ', '0', '-1', '1.5', 'abc', '2x', '1e1', 'Infinity', '999999999999999999999', String(total + 1)]) {
  const before = direct.visible().map(x => x.search), url = direct.window.location.href;
  jump(direct, invalid);
  assert.deepEqual(direct.visible().map(x => x.search), before);
  assert.equal(direct.window.location.href, url);
  assert.equal(direct.jumpInput.attributes['aria-invalid'], 'true');
  assert.equal(direct.jumpMessage.hidden, false);
  assert.equal(direct.jumpMessage.textContent, `请输入 1–${total} 的整数页码。`);
  checks.push(`invalid page ${JSON.stringify(invalid)} is rejected without moving`);
}
direct.jumpInput.emit('input'); assert.equal(direct.jumpMessage.hidden, true);
assert.equal(direct.jumpInput.attributes['aria-invalid'], undefined);
jump(direct, ' 06 '); assert.equal(direct.jumpInput.value, '6');
checks.push('editing clears the error; whitespace and leading zeros are accepted');
const beforeComposing = direct.window.location.href;
direct.jumpInput.value = '7';
direct.jumpInput.emit('keydown', { key:'Enter', isComposing:true, preventDefault() { assert.fail('Do not interrupt IME composition.'); } });
assert.equal(direct.window.location.href, beforeComposing);
checks.push('IME confirmation does not trigger a premature jump');
for (const name of Object.keys(generated)) {
  const ui = setup(name), pages = Math.ceil(ui.cards.length / 12);
  jump(ui, String(pages)); assert.equal(ui.next.disabled, true);
  assert.equal(ui.jumpInput.value, String(pages));
  jump(ui, '1', true); assert.equal(ui.previous.disabled, true);
  checks.push(`${name}: first and last direct jumps preserve boundary buttons`);
  for (const option of ui.year.options.filter(x => x.value !== 'all')) {
    ui.year.value = option.value; ui.year.emit('change');
    const matches = ui.cards.filter(x => (x.node.dataset.year || 'unknown') === option.value);
    const count = Math.ceil(matches.length / 12);
    assert.equal(ui.jumpInput.value, matches.length ? '1' : '');
    if (count) {
      jump(ui, String(count), true);
      assert.deepEqual(ui.visible().map(x => x.search), matches.slice((count-1)*12,count*12).map(x => x.node.dataset.search));
      jump(ui, String(count+1)); assert.equal(ui.jumpMessage.textContent, `请输入 1–${count} 的整数页码。`);
    }
  }
  checks.push(`${name}: every year recomputes page limits and rejects overflow`);
  ui.reset.emit('click');
  const chosen = ui.filters.find(x => x.dataset.filter !== 'all');
  if (chosen) {
    chosen.emit('click');
    const count = Math.ceil(ui.cards.filter(x => x.node.dataset.topic === chosen.dataset.filter).length/12);
    jump(ui, String(count), true);
    assert.equal(ui.window.location.search.includes('topic='), true);
    assert(ui.visible().every(x => x.topic === chosen.dataset.filter));
    checks.push(`${name}: topic selection survives a direct jump`);
  }
  ui.reset.emit('click'); ui.search.value = 'no-result-8a03cdf1'; ui.search.emit('input');
  assert.equal(ui.jumpInput.disabled, true); assert.equal(ui.jumpButton.disabled, true);
  assert.equal(ui.pager.hidden, true); assert.equal(ui.jumpInput.value, '');
  const zeroURL = ui.window.location.href; jump(ui, '6', true);
  assert.equal(ui.window.location.href, zeroURL); assert.equal(ui.visible().length, 0);
  ui.reset.emit('click'); assert.equal(ui.jumpInput.disabled, false); assert.equal(ui.jumpInput.value, '1');
  checks.push(`${name}: zero results disable jumps and clearing recovers them`);
}
const combination = setup('index.html'); combination.year.value='2024'; combination.year.emit('change');
combination.search.value='资本论'; combination.search.emit('input');
const filtered = combination.cards.filter(x => x.node.dataset.year==='2024' && x.node.dataset.search.includes('资本论'));
const filteredPages = Math.ceil(filtered.length / 12);
jump(combination, String(filteredPages), true);
assert.deepEqual(combination.visible().map(x => x.search), filtered.slice((filteredPages-1)*12,filteredPages*12).map(x => x.node.dataset.search));
assert.equal(combination.window.location.search.includes('year=2024'), true);
assert.equal(new URLSearchParams(combination.window.location.search).get('q'), '资本论');
checks.push('combined search and year persist on the last filtered page');

fs.writeFileSync(path.join(work, '归档交互逻辑校验.json'), JSON.stringify({ success: true, checks, check_count: checks.length, execution: 'Node.js vm + DOM harness; actual generated metadata and actual blog/site.js', real_browser_layout_test: false, native_clipboard_test: false }, null, 2));
console.log(`PASS ${checks.length} archive interaction checks; browser layout and native clipboard are not claimed`);
