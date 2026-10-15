(() => {
  "use strict";

  const themeButton = document.querySelector("#theme-toggle");
  const themeKey = "xieyuqing-blog-theme";
  let preferredTheme = null;
  try {
    const saved = localStorage.getItem(themeKey);
    if (saved === "light" || saved === "dark") preferredTheme = saved;
  } catch (_) { /* System preference still works when storage is unavailable. */ }
  let systemTheme = null;
  try { systemTheme = window.matchMedia("(prefers-color-scheme: dark)"); } catch (_) {}
  const initialTheme = preferredTheme || (systemTheme && systemTheme.matches ? "dark" : "light");

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (themeButton) {
      const nextLabel = theme === "dark" ? "浅色" : "深色";
      const label = `切换到${nextLabel}模式`;
      themeButton.querySelector(".theme-label").textContent = nextLabel;
      themeButton.setAttribute("aria-label", label);
      themeButton.setAttribute("title", label);
      themeButton.hidden = false;
    }
  }
  applyTheme(initialTheme);
  const followSystem = (event) => {
    if (!preferredTheme) applyTheme(event.matches ? "dark" : "light");
  };
  if (systemTheme) {
    if (systemTheme.addEventListener) systemTheme.addEventListener("change", followSystem);
    else if (systemTheme.addListener) systemTheme.addListener(followSystem);
  }
  if (themeButton) themeButton.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    preferredTheme = theme;
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch (_) { /* Keep the switch usable without storage. */ }
  });

  const archive = document.querySelector(".archive");
  if (archive) {
    const controls = archive.querySelector(".archive-controls");
    const search = archive.querySelector("#article-search");
    const year = archive.querySelector("#article-year");
    const filters = [...archive.querySelectorAll("[data-filter]")];
    const entries = [...archive.querySelectorAll(".article-card-content")].map((content) => ({
      card: content.closest(".article-card"),
      topic: content.dataset.topic,
      year: content.dataset.year || "unknown",
      text: content.dataset.search.toLocaleLowerCase()
    }));
    const status = archive.querySelector(".search-status");
    const empty = archive.querySelector(".search-empty");
    const pagination = archive.querySelector(".archive-pagination");
    const previous = pagination.querySelector('[data-page="prev"]');
    const next = pagination.querySelector('[data-page="next"]');
    const position = pagination.querySelector(".pagination-position");
    const jumpForm = pagination.querySelector(".page-jump");
    const jumpInput = pagination.querySelector("#article-page");
    const jumpButton = jumpForm.querySelector('button[type="submit"]');
    const jumpMessage = pagination.querySelector("#page-jump-message");
    const pageSize = 12;
    let topic = "all";
    let page = 1;
    let totalPages = 0;

    function clearJumpMessage() {
      jumpMessage.hidden = true;
      jumpMessage.textContent = "";
      jumpInput.removeAttribute("aria-invalid");
    }

    function restoreState() {
      const params = new URLSearchParams(window.location.search);
      search.value = params.get("q") || "";
      const requestedTopic = params.get("topic") || "all";
      topic = filters.some((button) => button.dataset.filter === requestedTopic) ? requestedTopic : "all";
      const requestedYear = params.get("year") || "all";
      year.value = [...year.options].some((option) => option.value === requestedYear) ? requestedYear : "all";
      page = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
    }

    function update(resetPage = false, scroll = false, persist = true) {
      if (resetPage) page = 1;
      const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const matched = entries.filter((entry) => (topic === "all" || entry.topic === topic) &&
        (year.value === "all" || entry.year === year.value) && terms.every((term) => entry.text.includes(term)));
      const count = matched.length;
      totalPages = Math.ceil(count / pageSize);
      const pages = Math.max(1, totalPages);
      page = Math.min(page, pages);
      const start = (page - 1) * pageSize;
      const visible = new Set(matched.slice(start, start + pageSize));
      entries.forEach((entry) => { entry.card.hidden = !visible.has(entry); });
      filters.forEach((button) => {
        const active = button.dataset.filter === topic;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      status.hidden = false;
      status.textContent = count ? `显示第 ${start + 1}–${Math.min(start + pageSize, count)} 篇，共 ${count} 篇${topic === "all" ? "" : ` · ${topic}`}${year.value === "all" ? "" : ` · ${year.value === "unknown" ? "时间待确认" : year.value + " 年"}`}` : "找到 0 篇文章";
      empty.hidden = count !== 0 || entries.length === 0;
      pagination.hidden = pages <= 1;
      position.textContent = `${page} / ${pages} 页`;
      previous.disabled = page === 1;
      next.disabled = page === pages;
      jumpInput.value = count ? String(page) : "";
      jumpInput.disabled = jumpButton.disabled = count === 0;
      clearJumpMessage();
      if (persist) {
        const url = new URL(window.location.href);
        ["q", "topic", "year", "page"].forEach((name) => url.searchParams.delete(name));
        if (search.value.trim()) url.searchParams.set("q", search.value.trim());
        if (topic !== "all") url.searchParams.set("topic", topic);
        if (year.value !== "all") url.searchParams.set("year", year.value);
        if (page !== 1) url.searchParams.set("page", String(page));
        try { window.history.replaceState(null, "", url); } catch (_) { /* Filtering still works without URL persistence. */ }
      }
      if (scroll) archive.scrollIntoView({ behavior: "instant", block: "start" });
    }

    controls.hidden = false;
    search.addEventListener("input", () => update(true));
    year.addEventListener("change", () => update(true));
    filters.forEach((button) => button.addEventListener("click", () => {
      topic = button.dataset.filter;
      update(true);
    }));
    archive.querySelector(".reset-search").addEventListener("click", () => {
      topic = "all";
      search.value = "";
      year.value = "all";
      update(true);
      search.focus({ preventScroll: true });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey ||
          event.target.closest("input, textarea, select") || event.target.isContentEditable) return;
      event.preventDefault();
      search.focus();
    });
    previous.addEventListener("click", () => { page -= 1; update(false, true); });
    next.addEventListener("click", () => { page += 1; update(false, true); });
    function jumpToPage(event) {
      event.preventDefault();
      if (!totalPages) return;
      const value = jumpInput.value.trim();
      const requested = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(requested) || requested < 1 || requested > totalPages) {
        jumpMessage.textContent = `请输入 1–${totalPages} 的整数页码。`;
        jumpMessage.hidden = false;
        jumpInput.setAttribute("aria-invalid", "true");
        jumpInput.focus();
        return;
      }
      page = requested;
      update(false, true);
    }
    jumpForm.addEventListener("submit", jumpToPage);
    jumpInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) jumpToPage(event);
    });
    jumpInput.addEventListener("input", clearJumpMessage);
    window.addEventListener("popstate", () => { restoreState(); update(false, false, false); });
    restoreState();
    update();
  }

  const content = document.querySelector("#article-content");
  const toc = document.querySelector(".article-toc");
  if (content) {
    const progress = document.querySelector(".reading-progress span");
    const headings = [...content.querySelectorAll("h2[id], h3[id], h4[id]")];
    const links = toc ? [...toc.querySelectorAll("nav a")] : [];
    const details = toc && toc.querySelector("details");
    const summary = details && details.querySelector("summary");
    const layout = document.querySelector(".reading-layout");
    const controls = document.querySelector(".toc-controls");
    function headingForLink(link) {
      try {
        const id = decodeURIComponent(link.hash.slice(1));
        return headings.find((heading) => heading.id === id) || null;
      } catch (_) { return null; }
    }
    if (toc && details && summary && layout && controls && headings.length && links.length) {
      const positionKey = "xieyuqing-toc-position";
      const positions = new Set(["left", "right", "hidden"]);
      const buttons = [...controls.querySelectorAll("[data-toc-position]")];
      const mobile = window.matchMedia("(max-width: 760px)");
      let position = "right";
      try {
        const saved = localStorage.getItem(positionKey);
        if (positions.has(saved)) position = saved;
      } catch (_) { /* The layout controls still work when storage is unavailable. */ }

      const updateExpanded = () => summary.setAttribute("aria-expanded", String(details.open));
      function adaptToc() {
        // Mobile always has its own reachable summary, regardless of desktop preference.
        layout.dataset.tocPosition = mobile.matches ? "right" : position;
        details.open = !mobile.matches;
        updateExpanded();
        buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tocPosition === position)));
      }
      details.addEventListener("toggle", updateExpanded);
      buttons.forEach((button) => button.addEventListener("click", () => {
        const requested = button.dataset.tocPosition;
        if (mobile.matches || !positions.has(requested)) return;
        position = requested;
        adaptToc();
        try { localStorage.setItem(positionKey, position); } catch (_) { /* Persistence is optional. */ }
      }));
      controls.hidden = false;
      adaptToc();
      if (mobile.addEventListener) mobile.addEventListener("change", adaptToc);
      else if (mobile.addListener) mobile.addListener(adaptToc);
      links.forEach((link) => link.addEventListener("click", (event) => {
        if (!mobile.matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || (event.button && event.button !== 0)) return;
        const heading = headingForLink(link);
        if (!heading) return;
        // Leave the anchor's default navigation intact so hash links and Back work.
        // Move focus before hiding the nav; don't leave keyboard focus in a closed details.
        const temporaryTabIndex = !heading.hasAttribute("tabindex");
        if (temporaryTabIndex) {
          heading.setAttribute("tabindex", "-1");
          heading.addEventListener("blur", () => {
            if (heading.getAttribute("tabindex") === "-1") heading.removeAttribute("tabindex");
          }, { once: true });
        }
        heading.focus({ preventScroll: true });
        details.open = false;
        updateExpanded();
      }));
    }

    content.querySelectorAll("table").forEach((table) => {
      table.tabIndex = 0;
      table.setAttribute("aria-label", "文章表格，可横向滚动查看");
    });

    let scheduled = false;
    function updateReading() {
      scheduled = false;
      const start = content.getBoundingClientRect().top + window.scrollY;
      const finish = start + content.offsetHeight - window.innerHeight * .6;
      const percent = Math.min(100, Math.max(0, (window.scrollY - start + 80) / Math.max(1, finish - start) * 100));
      if (progress) progress.style.width = `${percent}%`;
      let active = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 110) active = heading.id;
        else break;
      }
      links.forEach((link) => {
        const heading = headingForLink(link);
        if (heading && heading.id === active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }
    function scheduleUpdate() {
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(updateReading);
      }
    }
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("load", scheduleUpdate);
    updateReading();
  }
})();
