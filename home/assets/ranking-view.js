/* Local viewing controls. Zoom changes layout only; ranking data and PNG stay independent. */
(() => {
  'use strict';
  function create(options = {}) {
    const $ = id => document.getElementById(id);
    const viewport = $('board-viewport'), canvas = $('ranking-canvas'), sizer = $('board-scale-wrap');
    if (!viewport || !canvas || !sizer) return null;
    const body = document.body, root = document.documentElement;
    let scale = 1, boardOnly = false, poolCount = 0, large = false, fallback = false;
    let nativeSeen = false, pending = false, requestIndex = 0, frame = 0, resetAfterLayout = false;
    const status = $('view-status');
    function notice(text) { status.textContent = text; status.hidden = !text; }
    function schedule() { if (!frame) frame = requestAnimationFrame(layout); }
    function layout() {
      frame = 0;
      if (!viewport.clientWidth) return;
      viewport.style.maxHeight = large ? Math.max(160, innerHeight - viewport.getBoundingClientRect().top - 16) + 'px' : '';
      const width = Math.max(1, viewport.clientWidth);
      canvas.style.width = width + 'px';
      canvas.style.transform = 'scale(' + scale + ')';
      sizer.style.width = Math.ceil(Math.max(width, canvas.scrollWidth) * scale) + 'px';
      sizer.style.height = Math.ceil(canvas.offsetHeight * scale) + 'px';
      $('view-zoom-value').value = Math.round(scale * 100) + '%';
      $('view-zoom-value').textContent = Math.round(scale * 100) + '%';
      $('view-zoom-out').disabled = scale <= .75;
      $('view-zoom-in').disabled = scale >= 2;
      $('view-fullscreen').disabled = pending;
      if (resetAfterLayout) { resetAfterLayout = false; resetOrigin(); }
    }
    function resetOrigin() {
      // The site uses smooth scrolling. Mode changes must reveal Exit immediately.
      const previous = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      viewport.scrollLeft = 0; viewport.scrollTop = 0;
      scrollTo(0, 0);
      root.style.scrollBehavior = previous;
    }
    function zoom(value, fit = false) {
      const previous = scale;
      scale = Math.max(.75, Math.min(2, Math.round(value * 100) / 100));
      const left = viewport.scrollLeft, top = viewport.scrollTop;
      layout();
      viewport.scrollLeft = fit ? 0 : left * scale / previous;
      viewport.scrollTop = fit ? 0 : top * scale / previous;
      schedule();
    }
    function poolNote() {
      const note = $('view-pool-note');
      note.textContent = boardOnly && poolCount ? '待选区还有 ' + poolCount + ' 项，点「显示待选区」可恢复查看。' : '';
      note.hidden = !note.textContent;
    }
    function onlyBoard(enabled, enter = true) {
      if (enabled && enter) options.enterPresentation?.();
      boardOnly = enabled;
      body.classList.toggle('view-board-only', enabled);
      $('view-board-only').setAttribute('aria-pressed', String(enabled));
      $('view-board-only').textContent = enabled ? '显示待选区' : '仅看榜单';
      poolNote(); schedule();
    }
    function mode() {
      body.classList.toggle('view-large', large);
      body.classList.toggle('view-fallback', large && fallback);
      $('view-fullscreen').setAttribute('aria-pressed', String(large));
      $('view-fullscreen').textContent = large ? (fallback ? '退出大屏' : '退出全屏') : '全屏查看';
      schedule();
    }
    async function exitLarge() {
      ++requestIndex; pending = false;
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        try { await document.exitFullscreen(); }
        catch (_) { notice('暂时无法退出原生全屏，请按 Esc 或使用浏览器的退出全屏操作。'); return; }
      }
      large = false; fallback = false; nativeSeen = false; mode(); notice('');
    }
    async function enterLarge() {
      options.enterPresentation?.();
      if (!poolCount) onlyBoard(true, false);
      large = true; fallback = false; resetAfterLayout = true; mode(); resetOrigin();
      const attempt = ++requestIndex;
      if (typeof root.requestFullscreen !== 'function' || document.fullscreenEnabled === false) {
        fallback = true; mode(); notice('当前浏览器使用页面内大屏。点「退出大屏」或按 Esc 返回。'); return;
      }
      pending = true; schedule();
      try {
        // Called synchronously from the user's click so transient activation is retained.
        await root.requestFullscreen();
        if (attempt !== requestIndex) {
          if (document.fullscreenElement) await document.exitFullscreen();
          return;
        }
        nativeSeen = Boolean(document.fullscreenElement);
        fallback = !nativeSeen;
        notice(fallback ? '浏览器未进入原生全屏，已使用页面内大屏。点「退出大屏」或按 Esc 返回。' : '已进入全屏，点「退出全屏」或按 Esc 返回。');
      } catch (_) {
        if (attempt !== requestIndex) return;
        fallback = true;
        notice('浏览器未允许原生全屏，已使用页面内大屏。点「退出大屏」或按 Esc 返回。');
      } finally {
        if (attempt === requestIndex) { pending = false; mode(); }
      }
    }
    $('view-zoom-out').addEventListener('click', () => zoom(scale - .25));
    $('view-zoom-in').addEventListener('click', () => zoom(scale + .25));
    $('view-zoom-reset').addEventListener('click', () => zoom(1));
    $('view-fit-width').addEventListener('click', () => zoom(1, true));
    $('view-board-only').addEventListener('click', () => onlyBoard(!boardOnly));
    $('view-fullscreen').addEventListener('click', () => { (large ? exitLarge() : enterLarge()).catch(() => notice('查看模式切换未完成，请重试。')); });
    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement) { nativeSeen = true; large = true; fallback = false; }
      else if (nativeSeen) { large = false; fallback = false; nativeSeen = false; notice(''); }
      mode();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !large || $('item-dialog').open || $('row-dialog').open) return;
      event.preventDefault(); event.stopImmediatePropagation(); exitLarge().catch(() => {});
    }, true);
    window.addEventListener('resize', schedule);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(schedule); observer.observe(viewport); observer.observe(canvas);
    }
    if (document.fonts?.ready) document.fonts.ready.then(schedule).catch(() => {});
    schedule();
    return Object.freeze({
      refresh(count) { poolCount = count; poolNote(); schedule(); },
      presentation(enabled) { if (!enabled) { onlyBoard(false, false); if (large) exitLarge().catch(() => {}); } schedule(); },
      scrollDrag(x, y) {
        const box = viewport.getBoundingClientRect();
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
        if (x < box.left + 40) viewport.scrollLeft -= 12;
        else if (x > box.right - 40) viewport.scrollLeft += 12;
        if (viewport.scrollHeight > viewport.clientHeight + 1) {
          if (y < box.top + 45) viewport.scrollTop -= 12;
          else if (y > box.bottom - 45) viewport.scrollTop += 12;
          return true;
        }
        return false;
      }
    });
  }
  window.RankingView = Object.freeze({ create });
})();
