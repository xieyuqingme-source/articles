// Local mocks only: no backend or real browser is contacted.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'blog/waline-integration.js'), 'utf8');
const { startWaline, stablePath } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const checks = [];
function node() { return { hidden: true, textContent: '', dataset: {}, querySelector() {} }; }
function stat(raw) {
  const out = node(); out.dataset.statsPath = raw; out.counters = {};
  for (const kind of ['views', 'comments']) {
    const counter = node(), value = node(); counter.querySelector = () => value;
    counter.value = value; out.counters[kind] = counter;
  }
  out.querySelector = selector => out.counters[selector.includes('views') ? 'views' : 'comments'];
  return out;
}
async function setup(options = {}) {
  const raw = options.path || '/articles/%E4%B8%AD%E6%96%87/test.html';
  const stats = (options.paths || [raw]).map(stat);
  const section = options.list ? null : node();
  if (section) section.dataset.articlePath = raw;
  const calls = [], init = [], loads = [];
  const settings = { enabled: true, serverURL: 'https://comments.test', backendVerified: true,
    hostingProvider: 'Selected host', databaseProvider: 'Selected database', siteOrigin: 'https://site.test',
    clientJS: '/articles/assets/waline/waline.js', clientCSS: '/articles/assets/waline/waline.css', ...options.settings };
  const document = {
    querySelector: selector => selector === '#waline-settings'
      ? options.noSettings ? null : { textContent: JSON.stringify(settings) }
      : selector === '#article-comments' ? section : null,
    querySelectorAll: () => stats
  };
  const location = new URL(options.url || 'https://site.test' + raw + '?utm_source=test#heading');
  const fetch = async (address, request) => {
    const url = new URL(address); calls.push({ url, ...request });
    if (options.fail === 'network' || (options.fail === 'views' && url.pathname.endsWith('/article')))
      throw new Error('Mock network failure');
    if (options.fail === 'increment' && request.method === 'POST') throw new Error('Uncertain result');
    if (options.fail === 'http') return { ok: false };
    let data;
    if (url.pathname.endsWith('/article')) {
      const length = request.method === 'POST' ? 1 : url.searchParams.get('path').split(',').length;
      data = Array.from({ length }, () => ({ time: options.zero ? 0 : 12 }));
    } else if (url.searchParams.get('type') === 'count') {
      data = url.searchParams.get('url').split(',').map(() => options.zero ? 0 : 2);
    } else data = { data: [], count: 0, page: 1, pageSize: 10 };
    if (options.fail === 'shape') data = {};
    if (options.fail === 'invalid') data = Array.isArray(data) ? data.map(() => -1) : data;
    return { ok: true, json: async () => ({ errno: options.fail === 'api' ? 1 : 0, data }) };
  };
  await startWaline({ document, location, fetch,
    loadClient: async url => { loads.push(url); if (options.fail === 'client') throw new Error('Load failed'); return { init: value => init.push(value) }; },
    loadStyles: async url => { loads.push(url); if (options.fail === 'css') throw new Error('CSS failed'); }
  });
  return { calls, init, loads, stats, section };
}
for (const settings of [{ enabled: false }, { serverURL: '' }, { backendVerified: false },
  { hostingProvider: '' }, { databaseProvider: '' }, { serverURL: 'http://comments.test' },
  { serverURL: 'https://user:password@comments.test' }, { serverURL: 'https://comments.test?q=1' }]) {
  const ui = await setup({ settings }); assert.equal(ui.calls.length, 0); assert.equal(ui.loads.length, 0);
  checks.push('disabled/incomplete/unsafe configuration emits no requests: ' + JSON.stringify(settings));
}
assert.equal((await setup({ noSettings: true })).calls.length, 0); checks.push('missing settings are inert');
assert.equal(stablePath('/articles/%E4%B8%AD%E6%96%87/test.html?a=1#top', 'https://site.test'), '/articles/中文/test.html');
assert.equal(stablePath('/articles/a%2Cb.html?x=1', 'https://site.test'), '/articles/a%2Cb.html');
checks.push('stable paths remove query/hash and preserve reserved encoded commas');
const list = await setup({ list: true, paths: Array.from({ length: 23 }, (_, i) => `/articles/${i}.html`) });
assert(list.calls.every(x => x.method === 'GET')); assert.equal(list.calls.length, 6);
assert.equal(list.loads.length, 0); assert.equal(list.init.length, 0);
assert(list.stats.every(x => !x.hidden && x.counters.views.value.textContent === '12' && x.counters.comments.value.textContent === '2'));
checks.push('list batches 23 article counts with GET only and no widget/client');
const article = await setup();
assert.equal(article.calls.filter(x => x.method === 'POST').length, 1);
const post = article.calls.find(x => x.method === 'POST');
assert.deepEqual(JSON.parse(post.body), { path: '/articles/中文/test.html', type: 'time', action: 'inc' });
assert.equal(article.calls.filter(x => x.url.pathname.endsWith('/article') && x.method === 'GET').length, 0);
assert.equal(article.section.hidden, false); assert.equal(article.init.length, 1);
checks.push('published article increments once without duplicate client counting');
const o = article.init[0];
assert.deepEqual(o.meta, ['nick', 'mail']); assert.deepEqual(o.requiredMeta, ['nick']); assert.equal(o.login, 'disable');
for (const key of ['imageUploader', 'search', 'emoji', 'reaction', 'texRenderer', 'highlighter', 'comment', 'pageview']) assert.equal(o[key], false);
assert.equal(o.dark, 'html[data-theme="dark"]');
assert.equal(o.path, '/articles/中文/test.html'); assert.equal(o.noRss, true);
checks.push('guest nickname/optional mail and disabled external features match policy');
const variant = await setup({ url: 'https://site.test/articles/%E4%B8%AD%E6%96%87/test.html?different=2#end' });
assert.equal(variant.init[0].path, o.path);
checks.push('different tracking parameters share the same comment identity');
const preview = await setup({ url: 'http://127.0.0.1:8765/articles/%E4%B8%AD%E6%96%87/test.html' });
assert(preview.calls.every(x => x.method === 'GET')); checks.push('local preview does not increase production views');
const duplicate = await setup({ list: true, paths: ['/articles/test.html', '/articles/test.html'] });
assert.equal(duplicate.calls.length, 2); assert(duplicate.stats.every(x => !x.hidden));
checks.push('duplicate references share one query result');
const zero = await setup({ zero: true });
assert.equal(zero.stats[0].counters.views.value.textContent, '0'); assert.equal(zero.stats[0].hidden, false);
checks.push('valid successful zero is displayed');
for (const fail of ['network', 'http', 'api', 'shape', 'invalid']) {
  const ui = await setup({ fail });
  assert.equal(ui.stats[0].hidden, true); assert.equal(ui.stats[0].counters.views.value.textContent, '');
  assert.equal(ui.stats[0].counters.comments.value.textContent, '');
  if (fail !== 'invalid') assert.equal(ui.section.hidden, true);
  checks.push(`${fail} failure leaves invalid counters hidden without fake zero`);
}
const partial = await setup({ fail: 'views' });
assert.equal(partial.stats[0].counters.views.hidden, true); assert.equal(partial.stats[0].counters.comments.hidden, false);
checks.push('independent comment counts survive view service failure');
for (const fail of ['client', 'css']) {
  const ui = await setup({ fail }); assert.equal(ui.section.hidden, true); assert.equal(ui.stats[0].hidden, false);
  checks.push(`${fail} load failure hides widget and preserves other page features`);
}
const uncertain = await setup({ fail: 'increment' });
assert.equal(uncertain.calls.filter(x => x.method === 'POST').length, 1);
assert.equal(uncertain.stats[0].counters.views.value.textContent, '12');
checks.push('uncertain increment is not retried; GET can still recover its count');
assert(article.calls.every(x => x.credentials === 'omit' && x.signal && x.cache === 'no-store'));
checks.push('counter requests omit cookies and carry timeout signals');
console.log(JSON.stringify({ success: true, check_count: checks.length, checks,
  network_used: false, actual_server_moderation_tested: false, browser_used: false }, null, 2));
