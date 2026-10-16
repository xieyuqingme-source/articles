(function (scope) {
  "use strict";
  function createGallery(document, window) {
    const data = document.querySelector("#photo-data");
    const dialog = document.querySelector("#photo-viewer");
    if (!data || !dialog || typeof dialog.showModal !== "function") return null;
    let photos;
    try { photos = JSON.parse(data.textContent); } catch (_) { return null; }
    if (!Array.isArray(photos) || !photos.length) return null;
    const links = Array.from(document.querySelectorAll("[data-photo-open]"));
    const image = dialog.querySelector(".photo-large");
    const title = dialog.querySelector("#photo-viewer-title");
    const caption = dialog.querySelector("#photo-viewer-caption");
    const storyLabel = dialog.querySelector("#photo-viewer-story-label");
    const facts = dialog.querySelector("#photo-viewer-facts");
    const position = dialog.querySelector(".photo-position");
    const closeButton = dialog.querySelector(".photo-close");
    const previous = dialog.querySelector(".photo-previous");
    const next = dialog.querySelector(".photo-next");
    const stage = dialog.querySelector(".photo-stage");
    let index = 0, opened = false, trigger = null, historyOwned = false, pointer = null;
    let oldRootOverflow = "", oldBodyOverflow = "";
    const marker = `photos-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    function render() {
      const photo = photos[index];
      image.src = photo.src;
      image.alt = photo.title || photo.caption || "";
      image.width = photo.width;
      image.height = photo.height;
      title.textContent = photo.title;
      title.hidden = !photo.title;
      caption.textContent = photo.caption;
      caption.hidden = !photo.caption;
      storyLabel.hidden = !photo.caption;
      facts.replaceChildren();
      const date = photo.date_text || photo.date;
      const metadata = [date, photo.time && !(date || "").includes(photo.time) ? photo.time : "", photo.location];
      metadata.filter(Boolean).forEach((value) => {
        const item = document.createElement("li");
        item.textContent = value;
        facts.appendChild(item);
      });
      facts.hidden = !facts.children.length;
      position.textContent = `${index + 1} / ${photos.length}`;
      previous.hidden = next.hidden = photos.length < 2;
      dialog.scrollTop = 0;
    }
    function finishClose() {
      if (!opened) return;
      opened = false;
      pointer = null;
      document.documentElement.style.overflow = oldRootOverflow;
      document.body.style.overflow = oldBodyOverflow;
      if (dialog.open) dialog.close();
      if (trigger && typeof trigger.focus === "function") trigger.focus({ preventScroll: true });
    }
    function requestClose() {
      const goBack = historyOwned && window.history.state && window.history.state.photoLightbox === marker;
      finishClose();
      historyOwned = false;
      if (goBack) window.history.back();
    }
    function open(selected, element) {
      if (!Number.isInteger(selected) || selected < 0 || selected >= photos.length || opened) return false;
      index = selected;
      trigger = element;
      render();
      try { dialog.showModal(); } catch (_) { return false; }
      opened = true;
      oldRootOverflow = document.documentElement.style.overflow;
      oldBodyOverflow = document.body.style.overflow;
      document.documentElement.style.overflow = document.body.style.overflow = "hidden";
      try {
        const state = window.history.state;
        window.history.pushState({ ...(state && typeof state === "object" ? state : {}), photoLightbox: marker }, "");
        historyOwned = true;
      } catch (_) { historyOwned = false; }
      closeButton.focus();
      return true;
    }
    function move(step) {
      if (!opened) return;
      index = (index + step + photos.length) % photos.length;
      render();
    }
    links.forEach((link) => link.addEventListener("click", (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (open(Number(link.dataset.photoIndex), link)) event.preventDefault();
    }));
    closeButton.addEventListener("click", requestClose);
    previous.addEventListener("click", () => move(-1));
    next.addEventListener("click", () => move(1));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); });
    dialog.addEventListener("close", () => { if (opened) requestClose(); });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) requestClose();
    });
    dialog.addEventListener("keydown", (event) => {
      if (!opened || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key === "Escape") { event.preventDefault(); requestClose(); }
    });
    stage.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "touch" && event.isPrimary && event.target === image) pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      else pointer = null;
    });
    stage.addEventListener("pointerup", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
      pointer = null;
      if (Math.abs(dx) >= 65 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    });
    stage.addEventListener("pointercancel", () => { pointer = null; });
    window.addEventListener("popstate", (event) => {
      if (opened && (!event.state || event.state.photoLightbox !== marker)) { historyOwned = false; finishClose(); }
    });
    return { open, close: requestClose, move, getState: () => ({ opened, index }) };
  }
  if (typeof module === "object" && module.exports) module.exports = { createGallery };
  else if (scope.document) createGallery(scope.document, scope);
})(typeof window !== "undefined" ? window : globalThis);
