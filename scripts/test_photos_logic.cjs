"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createGallery } = require(path.join(__dirname, "../home/assets/photos.js"));

class Element {
  constructor(document) { this.document = document; this.listeners = {}; this.children = []; this.style = {}; this.dataset = {}; this.hidden = false; this.open = false; this.textContent = ""; }
  addEventListener(name, action) { (this.listeners[name] ||= []).push(action); }
  dispatch(name, values = {}) {
    const event = { target: this, button: 0, preventDefault() { this.prevented = true; }, ...values };
    for (const action of this.listeners[name] || []) action(event);
    return event;
  }
  focus() { this.document.activeElement = this; }
  replaceChildren() { this.children = []; }
  appendChild(element) { this.children.push(element); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
  getBoundingClientRect() { return { left: 10, right: 100, top: 10, bottom: 100 }; }
}

function fixture({ supported = true, historyFails = false } = {}) {
  const document = { activeElement: null };
  const make = () => new Element(document);
  document.documentElement = make(); document.body = make();
  document.documentElement.style.overflow = "auto"; document.body.style.overflow = "scroll";
  document.createElement = make;
  const data = make(), dialog = make();
  const photos = [0, 1, 2].map((index) => ({
    src: `/photos/images/${index}.webp`, title: index ? `照片 ${index}` : "",
    caption: index === 0 ? '<img src=x onerror="alert(1)">' : index === 1 ? "长故事的第一段。".repeat(500) + "\n\n" + "第二段也必须完整保留。".repeat(200) : "",
    date: "2026-10-16", date_text: "2026年10月16日", time: "12:34", location: "北京", width: 1600, height: 1000
  }));
  data.textContent = JSON.stringify(photos);
  const nodes = Object.fromEntries([".photo-large", "#photo-viewer-title", "#photo-viewer-caption", "#photo-viewer-story-label", "#photo-viewer-facts", ".photo-position", ".photo-close", ".photo-previous", ".photo-next", ".photo-stage"].map((name) => [name, make()]));
  dialog.querySelector = (selector) => nodes[selector];
  if (!supported) dialog.showModal = undefined;
  const links = photos.map((_, index) => { const link = make(); link.dataset.photoIndex = String(index); return link; });
  document.querySelector = (selector) => selector === "#photo-data" ? data : selector === "#photo-viewer" ? dialog : null;
  document.querySelectorAll = () => links;
  const window = make();
  const stack = [{ route: "album" }];
  window.history = {
    state: stack[0], backCalls: 0,
    pushState(state) { if (historyFails) throw new Error("History unavailable"); stack.push(state); this.state = state; },
    back() { this.backCalls++; if (stack.length > 1) stack.pop(); this.state = stack[stack.length - 1]; window.dispatch("popstate", { state: this.state }); }
  };
  const controller = createGallery(document, window);
  return { document, window, nodes, data, links, dialog, photos, controller, stack };
}

test("unmodified photo click opens modal, presents literal metadata and preserves previous history", () => {
  const f = fixture();
  const event = f.links[0].dispatch("click");
  assert.equal(event.prevented, true);
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.controller.getState(), { opened: true, index: 0 });
  assert.equal(f.nodes[".photo-large"].src, f.photos[0].src);
  assert.equal(f.nodes["#photo-viewer-title"].hidden, true);
  assert.equal(f.nodes["#photo-viewer-caption"].textContent, '<img src=x onerror="alert(1)">');
  assert.equal(f.nodes["#photo-viewer-caption"].children.length, 0);
  assert.deepEqual(f.nodes["#photo-viewer-facts"].children.map((item) => item.textContent), ["2026年10月16日", "12:34", "北京"]);
  assert.equal(f.document.activeElement, f.nodes[".photo-close"]);
  assert.equal(f.document.body.style.overflow, "hidden");
  assert.equal(f.window.history.state.route, "album");
  assert.equal(f.stack.length, 2);
});

test("keyboard and buttons wrap through the album; Esc closes, restores focus and consumes only modal history", () => {
  const f = fixture();
  f.links[0].dispatch("click");
  assert.equal(f.dialog.dispatch("keydown", { key: "ArrowLeft" }).prevented, true);
  assert.equal(f.controller.getState().index, 2);
  f.nodes[".photo-next"].dispatch("click");
  assert.equal(f.controller.getState().index, 0);
  f.nodes[".photo-previous"].dispatch("click");
  assert.equal(f.nodes[".photo-position"].textContent, "3 / 3");
  f.dialog.dispatch("keydown", { key: "Escape" });
  assert.equal(f.controller.getState().opened, false);
  assert.equal(f.dialog.open, false);
  assert.equal(f.window.history.backCalls, 1);
  assert.equal(f.stack.length, 1);
  assert.equal(f.document.activeElement, f.links[0]);
  assert.equal(f.document.documentElement.style.overflow, "auto");
  assert.equal(f.document.body.style.overflow, "scroll");
});

test("browser Back closes the viewer without an extra Back and a later close works normally", () => {
  const f = fixture();
  f.links[1].dispatch("click");
  f.window.history.back();
  assert.equal(f.dialog.open, false);
  assert.equal(f.document.activeElement, f.links[1]);
  assert.equal(f.window.history.backCalls, 1);
  f.links[2].dispatch("click");
  f.nodes[".photo-close"].dispatch("click");
  assert.equal(f.window.history.backCalls, 2);
  assert.equal(f.dialog.open, false);
});

test("native cancel and backdrop close use the same cleanup", () => {
  const f = fixture(); f.links[0].dispatch("click");
  assert.equal(f.dialog.dispatch("cancel").prevented, true);
  assert.equal(f.dialog.open, false);
  f.links[0].dispatch("click");
  f.dialog.dispatch("click", { clientX: 5, clientY: 5 });
  assert.equal(f.dialog.open, false);
  assert.equal(f.window.history.backCalls, 2);
});

test("touch swipe switches photos; vertical gesture, pinch and pointer cancellation do not", () => {
  const f = fixture(); f.links[0].dispatch("click");
  const stage = f.nodes[".photo-stage"], image = f.nodes[".photo-large"];
  const down = (values = {}) => stage.dispatch("pointerdown", { pointerType: "touch", pointerId: 1, isPrimary: true, clientX: 200, clientY: 100, target: image, ...values });
  const up = (values = {}) => stage.dispatch("pointerup", { pointerId: 1, clientX: 100, clientY: 110, ...values });
  assert.equal(down().prevented, undefined); assert.equal(up().prevented, undefined);
  assert.equal(f.controller.getState().index, 1);
  down(); up({ clientY: 250 });
  assert.equal(f.controller.getState().index, 1);
  down(); down({ pointerId: 2, isPrimary: false }); up();
  assert.equal(f.controller.getState().index, 1);
  down(); stage.dispatch("pointercancel"); up();
  assert.equal(f.controller.getState().index, 1);
});

test("unsupported dialogs and modified clicks preserve direct compressed image links", () => {
  const old = fixture({ supported: false });
  assert.equal(old.controller, null);
  assert.equal(old.links[0].dispatch("click").prevented, undefined);
  const f = fixture();
  for (const values of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    assert.equal(f.links[0].dispatch("click", values).prevented, undefined);
    assert.equal(f.dialog.open, false);
  }
});

test("history/storage restrictions still permit image browsing and closing", () => {
  const f = fixture({ historyFails: true });
  f.links[0].dispatch("click"); f.nodes[".photo-next"].dispatch("click");
  assert.equal(f.controller.getState().index, 1);
  f.nodes[".photo-close"].dispatch("click");
  assert.equal(f.dialog.open, false);
  assert.equal(f.window.history.backCalls, 0);
  assert.equal(f.document.activeElement, f.links[0]);
});

test("every move replaces the complete story, retaining long multi-paragraph text without stale content", () => {
  const f = fixture(); f.links[0].dispatch("click");
  assert.equal(f.nodes["#photo-viewer-story-label"].hidden, false);
  f.dialog.scrollTop = 780;
  f.nodes[".photo-next"].dispatch("click");
  assert.equal(f.dialog.scrollTop, 0);
  assert.equal(f.nodes["#photo-viewer-caption"].textContent, f.photos[1].caption);
  assert.ok(f.nodes["#photo-viewer-caption"].textContent.length > 5000);
  assert.equal(f.nodes["#photo-viewer-caption"].textContent.split("\n\n").length, 2);
  f.dialog.scrollTop = 920;
  f.nodes[".photo-next"].dispatch("click");
  assert.equal(f.dialog.scrollTop, 0);
  assert.equal(f.nodes["#photo-viewer-caption"].textContent, "");
  assert.equal(f.nodes["#photo-viewer-caption"].hidden, true);
  assert.equal(f.nodes["#photo-viewer-story-label"].hidden, true);
  f.nodes[".photo-previous"].dispatch("click");
  assert.equal(f.nodes["#photo-viewer-caption"].textContent, f.photos[1].caption);
  assert.equal(f.nodes["#photo-viewer-caption"].hidden, false);
  assert.equal(f.nodes["#photo-viewer-story-label"].hidden, false);
});
