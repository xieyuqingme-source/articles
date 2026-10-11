(() => {
  "use strict";

  const themeButton = document.querySelector("#theme-toggle");
  const themeKey = "xieyuqing-blog-theme";
  let savedTheme = "dark";
  try {
    if (localStorage.getItem(themeKey) === "light") savedTheme = "light";
  } catch (_) { /* Theme storage is optional; all page features still work. */ }

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
  applyTheme(savedTheme);
  if (themeButton) themeButton.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try { localStorage.setItem(themeKey, theme); } catch (_) { /* Keep the switch usable without storage. */ }
  });

  const archive = document.querySelector(".archive");
  if (archive) {
    const controls = archive.querySelector(".archive-controls");
    const search = archive.querySelector("#article-search");
    const filters = [...archive.querySelectorAll("[data-filter]")];
    const entries = [...archive.querySelectorAll(".article-card-content")].map((content) => ({
      card: content.closest(".article-card"),
      topic: content.dataset.topic,
      text: content.dataset.search.toLocaleLowerCase()
    }));
    const status = archive.querySelector(".search-status");
    const empty = archive.querySelector(".search-empty");
    let topic = "all";

    function update() {
      const terms = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      let count = 0;
      entries.forEach((entry) => {
        const visible = (topic === "all" || entry.topic === topic) && terms.every((term) => entry.text.includes(term));
        entry.card.hidden = !visible;
        if (visible) count += 1;
      });
      filters.forEach((button) => {
        const active = button.dataset.filter === topic;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      status.hidden = !terms.length && topic === "all";
      status.textContent = `找到 ${count} 篇文章${topic === "all" ? "" : ` · ${topic}`}`;
      empty.hidden = count !== 0 || entries.length === 0;
    }

    controls.hidden = false;
    search.addEventListener("input", update);
    filters.forEach((button) => button.addEventListener("click", () => {
      topic = button.dataset.filter;
      update();
    }));
    archive.querySelector(".reset-search").addEventListener("click", () => {
      topic = "all";
      search.value = "";
      update();
      search.focus({ preventScroll: true });
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey ||
          event.target.closest("input, textarea, select") || event.target.isContentEditable) return;
      event.preventDefault();
      search.focus();
    });
    update();
  }

  const content = document.querySelector("#article-content");
  const toc = document.querySelector(".article-toc");
  if (content) {
    const progress = document.querySelector(".reading-progress span");
    const headings = [...content.querySelectorAll("h2[id], h3[id], h4[id]")];
    const links = toc ? [...toc.querySelectorAll("nav a")] : [];
    const details = toc && toc.querySelector("details");
    const mobile = window.matchMedia("(max-width: 760px)");
    const adaptToc = () => { if (details) details.open = !mobile.matches; };
    adaptToc();
    mobile.addEventListener("change", adaptToc);
    links.forEach((link) => link.addEventListener("click", () => {
      if (mobile.matches && details) details.open = false;
    }));

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
        if (decodeURIComponent(link.hash.slice(1)) === active) link.setAttribute("aria-current", "location");
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
