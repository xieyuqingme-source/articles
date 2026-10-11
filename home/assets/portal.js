(() => {
  "use strict";
  const key = "xieyuqing-blog-theme";
  const button = document.querySelector("#theme-toggle");
  let theme = "dark";
  try { if (localStorage.getItem(key) === "light") theme = "light"; } catch (_) {}
  function apply() {
    document.documentElement.dataset.theme = theme;
    if (!button) return;
    const next = theme === "dark" ? "浅色" : "深色";
    button.querySelector(".theme-label").textContent = next;
    button.setAttribute("aria-label", `切换到${next}模式`);
    button.hidden = false;
  }
  apply();
  if (button) button.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    apply();
    try { localStorage.setItem(key, theme); } catch (_) {}
  });
})();
