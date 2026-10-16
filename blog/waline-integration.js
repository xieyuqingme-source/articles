// Waline REST counters and a locally hosted client. No network activity while disabled.
export function stablePath(raw, base) {
  return decodeURI(new URL(raw, base).pathname);
}

export async function startWaline(deps = {}) {
  const doc = deps.document || document;
  const current = deps.location || window.location;
  const request = deps.fetch || fetch;
  const settingsNode = doc.querySelector('#waline-settings');
  if (!settingsNode) return;
  let settings;
  try { settings = JSON.parse(settingsNode.textContent); } catch (_) { return; }
  if (settings.enabled !== true || settings.backendVerified !== true ||
      !settings.serverURL || !settings.hostingProvider || !settings.databaseProvider) return;
  let server;
  try {
    server = new URL(settings.serverURL);
    if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash) return;
  } catch (_) { return; }
  const prefix = server.href.replace(/\/?$/, '/') + 'api/';
  const stats = [...doc.querySelectorAll('[data-stats-path]')];
  const comments = doc.querySelector('#article-comments');
  const articlePath = comments ? stablePath(comments.dataset.articlePath, current.href) : null;
  const paths = [...new Set(stats.map(node => stablePath(node.dataset.statsPath, current.href)))];

  async function api(endpoint, params, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL(prefix + endpoint);
      for (const [name, value] of Object.entries(params || {})) url.searchParams.set(name, value);
      const response = await request(url.href, {
        method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      });
      if (!response.ok) throw new Error('Waline unavailable');
      const payload = await response.json();
      if (!payload || payload.errno || payload.data === undefined) throw new Error('Waline error');
      return payload.data;
    } finally { clearTimeout(timer); }
  }

  function render(path, kind, value) {
    if (!Number.isSafeInteger(value) || value < 0) return;
    for (const node of stats.filter(node => stablePath(node.dataset.statsPath, current.href) === path)) {
      const counter = node.querySelector(`[data-counter="${kind}"]`);
      counter.querySelector('b').textContent = String(value);
      counter.hidden = false;
      node.hidden = false;
    }
  }

  async function getCounts(batch, kind) {
    try {
      const values = kind === 'views'
        ? await api('article', { path: batch.join(','), type: 'time', lang: 'zh-CN' })
        : await api('comment', { type: 'count', url: batch.join(','), lang: 'zh-CN' });
      if (!Array.isArray(values) || values.length !== batch.length) return;
      batch.forEach((path, i) => render(path, kind, kind === 'views' ? values[i]?.time : values[i]));
    } catch (_) { /* Missing counts stay hidden; an outage never becomes a false zero. */ }
  }

  // Lists only read counts. Only the published article origin increments a view.
  async function countViews() {
    let incremented = false;
    if (articlePath && current.origin === settings.siteOrigin) {
      try {
        const values = await api('article', { lang: 'zh-CN' }, { path: articlePath, type: 'time', action: 'inc' });
        if (Array.isArray(values) && values.length === 1 && Number.isSafeInteger(values[0]?.time) && values[0].time >= 0) {
          render(articlePath, 'views', values[0].time);
          incremented = true;
        }
      } catch (_) { /* Do not retry increments: the first request may already have succeeded. */ }
    }
    const toRead = incremented ? paths.filter(path => path !== articlePath) : paths;
    for (let i = 0; i < toRead.length; i += 10) await getCounts(toRead.slice(i, i + 10), 'views');
  }

  async function countComments() {
    for (let i = 0; i < paths.length; i += 10) await getCounts(paths.slice(i, i + 10), 'comments');
  }

  async function loadStyle() {
    if (deps.loadStyles) return deps.loadStyles(settings.clientCSS);
    return new Promise((resolve, reject) => {
      const link = doc.createElement('link');
      const timer = setTimeout(() => { link.remove(); reject(new Error('Waline style unavailable')); }, 8000);
      link.rel = 'stylesheet'; link.href = settings.clientCSS;
      link.onload = () => { clearTimeout(timer); resolve(); };
      link.onerror = () => { clearTimeout(timer); link.remove(); reject(new Error('Waline style unavailable')); };
      doc.head.append(link);
    });
  }

  async function mountComments() {
    if (!comments) return;
    try {
      // Check the public comment endpoint before revealing the widget.
      const list = await api('comment', { path: articlePath, page: '1', pageSize: '10', sortBy: 'insertedAt_desc', lang: 'zh-CN' });
      if (!list || !Array.isArray(list.data)) return;
      const [client] = await Promise.all([
        deps.loadClient ? deps.loadClient(settings.clientJS) : import(settings.clientJS), loadStyle()
      ]);
      client.init({
        el: '#waline', serverURL: server.href.replace(/\/$/, ''), path: articlePath,
        lang: 'zh-CN', dark: 'html[data-theme="dark"]', meta: ['nick', 'mail'], requiredMeta: ['nick'],
        login: 'disable', imageUploader: false, search: false, emoji: false, reaction: false,
        texRenderer: false, highlighter: false, comment: false, pageview: false, noRss: true,
        locale: { placeholder: '欢迎留言。昵称必填，邮箱选填；提交成功后直接公开，无需人工预审。' }
      });
      comments.hidden = false;
    } catch (_) { comments.hidden = true; }
  }
  await Promise.allSettled([countViews(), countComments(), mountComments()]);
}

if (typeof document !== 'undefined') void startWaline().catch(() => {});
