(() => {
  "use strict";

  const button = document.getElementById("wechat-copy");
  const status = document.getElementById("wechat-copy-status");
  const source = document.getElementById("wechat-copy-content");
  const template = document.getElementById("wechat-copy-template");
  if (!button || !status || !source || !template || !template.content) return;
  const preview = source.closest("details");
  let busy = false;
  let mounted = false;

  // A template is inert: none of its images enter the live document until the
  // reader opens the preview. Copying uses its own detached clone instead.
  function cloneContent() {
    const section = template.content.querySelector("section");
    if (!section) throw new Error("Missing WeChat content");
    return section.cloneNode(true);
  }

  function mountPreview() {
    if (mounted) return;
    source.replaceChildren(cloneContent());
    mounted = true;
  }

  if (preview) {
    preview.addEventListener("toggle", () => {
      if (preview.open) mountPreview();
    });
    if (preview.open) mountPreview();
  }

  function prepareContent() {
    const content = cloneContent();
    content.removeAttribute("id");
    content.querySelectorAll("img, a[href]").forEach((element) => {
      const attribute = element.tagName === "IMG" ? "src" : "href";
      const address = element.getAttribute(attribute);
      if (!address) {
        if (element.tagName === "IMG") throw new Error("Missing image URL");
        return;
      }
      const url = new URL(address, document.baseURI);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        if (element.tagName === "IMG") throw new Error("Unsupported image URL");
        if (["javascript:", "data:", "vbscript:"].includes(url.protocol)) {
          element.removeAttribute(attribute);
        }
        return;
      }
      element.setAttribute(attribute, url.href);
      if (element.tagName === "IMG") {
        ["loading", "decoding", "srcset", "sizes"].forEach((name) => {
          element.removeAttribute(name);
        });
      }
    });
    return content;
  }

  function plainText(content) {
    const copy = content.cloneNode(true);
    copy.querySelectorAll("br").forEach((node) => node.replaceWith(document.createTextNode("\n")));
    copy.querySelectorAll("th, td").forEach((node) => {
      node.appendChild(document.createTextNode("\t"));
    });
    copy.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, tr, pre").forEach((node) => {
      node.appendChild(document.createTextNode("\n"));
    });
    return copy.textContent.trim();
  }

  function fallbackCopy(content, text) {
    const selection = window.getSelection();
    if (!selection) return false;
    const ranges = Array.from({ length: selection.rangeCount }, (_, index) => {
      return selection.getRangeAt(index).cloneRange();
    });
    const focused = document.activeElement;
    const holder = document.createElement("div");
    holder.contentEditable = "true";
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:fixed;left:-10000px;top:0;width:700px;";
    holder.appendChild(content);
    document.body.appendChild(holder);
    let copied = false;
    const onCopy = (event) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/html", content.outerHTML);
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    };
    try {
      holder.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(holder);
      selection.removeAllRanges();
      selection.addRange(range);
      holder.addEventListener("copy", onCopy);
      copied = document.execCommand("copy");
    } finally {
      holder.removeEventListener("copy", onCopy);
      holder.remove();
      if (focused && typeof focused.focus === "function") {
        focused.focus({ preventScroll: true });
      }
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
    return copied;
  }

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "正在复制正文和图片…";
    try {
      const content = prepareContent();
      const text = plainText(content);
      let copied = false;
      if (navigator.clipboard && typeof navigator.clipboard.write === "function" && window.ClipboardItem) {
        try {
          await navigator.clipboard.write([new window.ClipboardItem({
            "text/html": new Blob([content.outerHTML], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" })
          })]);
          copied = true;
        } catch (_) { /* Older browsers may still allow selection copying. */ }
      }
      if (!copied) copied = fallbackCopy(content, text);
      if (!copied) throw new Error("Copy failed");
      status.textContent = "已复制。请在公众号正文中按 Ctrl+V，保存草稿并预览图片和排版。";
    } catch (_) {
      // The toggle event can be delivered later. Mount synchronously so the
      // manual-copy instruction never points at an empty preview.
      try { mountPreview(); } catch (_) { /* Keep the failure message usable. */ }
      if (preview) preview.open = true;
      status.textContent = "复制未成功。请在下方预览中选中正文，按 Ctrl+C，再到公众号粘贴。";
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
})();
