// Executes the real copy script against a small DOM model. No browser, network,
// operating-system clipboard, or additional package is used by these checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = fs.readFileSync(path.join(root, "blog/wechat-copy.js"), "utf8");
const checks = [];
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function setup(options = {}) {
  const stats = { mounts: 0, holders: 0, clipboard: [], fallback: [], exec: 0 };
  let document;
  class Text {
    constructor(value) { this.textContent = value; this.parentNode = null; }
    cloneNode() { return new Text(this.textContent); }
    get outerHTML() { return escape(this.textContent); }
  }
  class Element {
    constructor(tag, attributes = {}, children = []) {
      this.tagName = tag.toUpperCase(); this.attributes = new Map(Object.entries(attributes));
      this.children = []; this.parentNode = null; this.listeners = new Map(); this.style = {};
      this.disabled = false; this.open = false;
      children.forEach(child => this.appendChild(typeof child === "string" ? new Text(child) : child));
    }
    get textContent() { return this.children.map(child => child.textContent).join(""); }
    set textContent(value) { this.replaceChildren(new Text(value)); }
    get outerHTML() {
      const tag = this.tagName.toLowerCase();
      const attributes = [...this.attributes].map(([key, value]) => ` ${key}="${escape(value)}"`).join("");
      const opening = `<${tag}${attributes}>`;
      return ["img", "br"].includes(tag) ? opening : opening + this.children.map(child => child.outerHTML).join("") + `</${tag}>`;
    }
    setAttribute(key, value) { this.attributes.set(key, String(value)); }
    getAttribute(key) { return this.attributes.get(key) ?? null; }
    removeAttribute(key) { this.attributes.delete(key); }
    appendChild(child) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      child.parentNode = this; this.children.push(child);
      if (this === document?.body && child.contentEditable === "true") stats.holders++;
      return child;
    }
    replaceChildren(...children) {
      if (this.getAttribute("id") === "wechat-copy-content") stats.mounts++;
      this.children.forEach(child => { child.parentNode = null; }); this.children = [];
      children.forEach(child => this.appendChild(child));
    }
    remove() {
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    replaceWith(node) {
      const parent = this.parentNode, index = parent.children.indexOf(this);
      parent.children[index] = node; node.parentNode = parent; this.parentNode = null;
    }
    cloneNode(deep) {
      return new Element(this.tagName, Object.fromEntries(this.attributes), deep ? this.children.map(child => child.cloneNode(true)) : []);
    }
    matches(selector) {
      const match = /^([a-z0-9]+)(?:\[([a-z-]+)\])?$/.exec(selector.trim());
      return !!match && this.tagName === match[1].toUpperCase() && (!match[2] || this.attributes.has(match[2]));
    }
    querySelectorAll(selector) {
      const selectors = selector.split(","), found = [];
      const visit = node => {
        if (!(node instanceof Element)) return;
        if (selectors.some(item => node.matches(item))) found.push(node);
        node.children.forEach(visit);
      };
      this.children.forEach(visit); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
      return null;
    }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set());
      this.listeners.get(name).add(callback);
    }
    removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
    async dispatch(name, event = {}) {
      for (const callback of this.listeners.get(name) ?? []) await callback(event);
    }
    focus() { document.activeElement = this; }
  }
  const element = (tag, attributes, ...children) => new Element(tag, attributes, children);
  const image = element("img", {
    src: options.imageSrc ?? "../../images/原图 中文.webp", width: "2600", height: "1800",
    loading: "lazy", decoding: "async", srcset: "small.webp 800w", sizes: "100vw"
  });
  if (options.missingSrc) image.removeAttribute("src");
  const section = element("section", { id: "copy-section", style: "font-size:16px;line-height:1.8" },
    element("h2", {}, "标题"), element("p", {}, "正文第一行", element("br", {}), "正文第二行", image),
    element("p", {}, element("a", { href: "../index.html" }, "文章"), " ",
      element("a", { href: "mailto:hello@example.test" }, "邮件"), " ",
      element("a", { href: options.unsafeHref ?? "javascript:alert(1)" }, "不可执行链接")),
    element("table", {}, element("tr", {}, element("td", {}, "甲"), element("td", {}, "乙"))));
  const template = element("template", { id: "wechat-copy-template" });
  template.content = element("fragment", {}, ...(options.emptyTemplate ? [] : [section]));
  const source = element("div", { id: "wechat-copy-content" });
  const details = element("details", {}, source, template); details.open = options.initialOpen ?? false;
  const button = element("button", { id: "wechat-copy" });
  const status = element("p", { id: "wechat-copy-status" });
  const priorFocus = element("input", {});
  const originalRange = { kind: "original", cloneRange() { return { kind: this.kind, cloneRange: this.cloneRange }; } };
  const selection = {
    ranges: [originalRange], get rangeCount() { return this.ranges.length; },
    getRangeAt(index) { return this.ranges[index]; },
    removeAllRanges() { this.ranges = []; }, addRange(range) { this.ranges.push(range); }
  };
  const body = element("body", {}, button, status, details, priorFocus);
  document = {
    baseURI: "https://xieyuqing.me/articles/English%20Articles/example.html", body, activeElement: priorFocus,
    getElementById(id) {
      if (options.missingElement === id) return null;
      return { "wechat-copy": button, "wechat-copy-status": status,
        "wechat-copy-content": source, "wechat-copy-template": template }[id];
    },
    createTextNode: value => new Text(value), createElement: tag => element(tag, {}),
    createRange: () => ({ kind: "temporary", selectNodeContents(node) { this.container = node; } }),
    execCommand(command) {
      assert.equal(command, "copy"); stats.exec++;
      if (options.execThrows) throw new Error("Mock clipboard failure");
      const holder = selection.ranges[0]?.container;
      const payload = {}, event = { clipboardData: {
        setData(type, value) { payload[type] = value; }
      }, preventDefault() { payload.prevented = true; } };
      for (const callback of holder?.listeners.get("copy") ?? []) callback(event);
      stats.fallback.push(payload);
      return options.execResult ?? true;
    }
  };
  const window = { getSelection: () => options.noSelection ? null : selection };
  const navigator = {};
  if (!options.noAPI) {
    window.ClipboardItem = class { constructor(payload) { this.payload = payload; } };
    navigator.clipboard = { async write(items) {
      stats.clipboard.push(items[0].payload);
      if (options.writeGate) await options.writeGate;
      if (options.apiFails) throw new Error("Mock API rejection");
    } };
  }
  vm.runInNewContext(script, { document, window, navigator, URL, Blob });
  return { stats, source, template, section, image, details, button, status, selection, document, priorFocus,
    click: () => button.dispatch("click"),
    toggle: async open => { details.open = open; await details.dispatch("toggle"); },
    activeImages: () => body.querySelectorAll("img").length,
    async clipboardPayload(index = 0) {
      const payload = stats.clipboard[index];
      return { html: await payload["text/html"].text(), text: await payload["text/plain"].text() };
    }
  };
}

const initial = setup();
assert.equal(initial.activeImages(), 0); assert.equal(initial.stats.mounts, 0);
assert.equal(initial.stats.clipboard.length, 0); assert.equal(initial.stats.holders, 0);
checks.push("closed preview starts with zero live images, mounts, or clipboard operations");
await initial.toggle(true);
assert.equal(initial.activeImages(), 1); assert.equal(initial.stats.mounts, 1);
await initial.toggle(false); await initial.toggle(true); await initial.toggle(true);
assert.equal(initial.activeImages(), 1); assert.equal(initial.stats.mounts, 1);
checks.push("first expansion mounts once; closing and reopening never duplicates images");
assert.equal(setup({ initialOpen: true }).stats.mounts, 1);
checks.push("an explicitly open preview initializes once");

const api = setup();
await api.click();
const payload = await api.clipboardPayload();
assert.equal(api.activeImages(), 0); assert.equal(api.stats.mounts, 0); assert.equal(api.stats.holders, 0);
assert.equal(api.details.open, false); assert.equal(api.stats.exec, 0);
assert(payload.html.includes('src="https://xieyuqing.me/images/%E5%8E%9F%E5%9B%BE%20%E4%B8%AD%E6%96%87.webp"'));
assert(payload.html.includes('width="2600" height="1800"'));
assert(payload.html.includes('href="https://xieyuqing.me/articles/index.html"'));
assert(payload.html.includes('href="mailto:hello@example.test"'));
assert(!payload.html.includes("javascript:"));
assert(!/\s(?:id|loading|decoding|srcset|sizes)=/.test(payload.html));
assert.equal(payload.text, "标题\n正文第一行\n正文第二行\n文章 邮件 不可执行链接\n甲\t乙");
assert.equal(api.image.getAttribute("loading"), "lazy");
assert.equal(api.image.getAttribute("src"), "../../images/原图 中文.webp");
assert(api.status.textContent.startsWith("已复制。"));
assert.equal(api.button.disabled, false); assert.equal(api.button.getAttribute("aria-busy"), null);
checks.push("closed API copy preserves complete original-image HTML and structured plain text without mounting or changing template");
await api.click();
assert.equal(api.stats.clipboard.length, 2); assert.deepEqual(await api.clipboardPayload(1), payload);
assert.equal(api.activeImages(), 0);
checks.push("repeated API copying remains complete while preview stays closed");
await api.toggle(true);
api.source.querySelector("img").setAttribute("src", "altered-preview.webp");
await api.toggle(false); await api.click();
assert.deepEqual(await api.clipboardPayload(2), payload); assert.equal(api.details.open, false);
assert.equal(api.stats.mounts, 1);
checks.push("copying reads the original template and respects the reader's preview state");

for (const options of [{ noAPI: true }, { apiFails: true }]) {
  const fallback = setup(options); await fallback.click();
  assert.equal(fallback.stats.exec, 1); assert.equal(fallback.stats.holders, 1);
  assert.equal(fallback.activeImages(), 0); assert.equal(fallback.stats.mounts, 0);
  assert.equal(fallback.details.open, false);
  assert.equal(fallback.document.activeElement, fallback.priorFocus);
  assert.equal(fallback.selection.rangeCount, 1); assert.equal(fallback.selection.ranges[0].kind, "original");
  assert(fallback.stats.fallback[0]["text/html"].includes("/%E5%8E%9F%E5%9B%BE%20%E4%B8%AD%E6%96%87.webp"));
  assert.equal(fallback.stats.fallback[0]["text/plain"], payload.text);
  assert.equal(fallback.stats.fallback[0].prevented, true);
  await fallback.click();
  assert.equal(fallback.stats.holders, 2); assert.equal(fallback.activeImages(), 0);
  assert(fallback.status.textContent.startsWith("已复制。"));
  checks.push(`${options.noAPI ? "unavailable" : "rejected"} clipboard API falls back with rich HTML, restores selection/focus, removes temporary holders, and supports repeated copy`);
}

for (const options of [{ noAPI: true, execResult: false }, { noAPI: true, execThrows: true },
  { apiFails: true, noSelection: true }]) {
  const failure = setup(options); await failure.click();
  assert.equal(failure.details.open, true); assert.equal(failure.stats.mounts, 1); assert.equal(failure.activeImages(), 1);
  assert(failure.status.textContent.startsWith("复制未成功。"));
  assert.equal(failure.button.disabled, false); assert.equal(failure.button.getAttribute("aria-busy"), null);
  assert.equal(failure.document.activeElement, failure.priorFocus);
  assert.equal(failure.selection.rangeCount, 1); assert.equal(failure.selection.ranges[0].kind, "original");
  // Real browsers deliver this toggle asynchronously; mounting must already be complete.
  await failure.details.dispatch("toggle"); assert.equal(failure.stats.mounts, 1);
  await failure.toggle(false); await failure.toggle(true); assert.equal(failure.stats.mounts, 1);
  checks.push(`${options.execThrows ? "throwing" : options.noSelection ? "unavailable selection" : "false-result"} fallback reveals a populated manual-copy preview immediately and cleans up state`);
}

let release;
const gate = new Promise(resolve => { release = resolve; });
const pending = setup({ writeGate: gate });
const first = pending.click();
assert.equal(pending.button.disabled, true); assert.equal(pending.button.getAttribute("aria-busy"), "true");
assert(pending.status.textContent.startsWith("正在复制"));
await pending.click(); assert.equal(pending.stats.clipboard.length, 1);
release(); await first;
assert.equal(pending.button.disabled, false); assert.equal(pending.button.getAttribute("aria-busy"), null);
checks.push("concurrent clicks cannot start duplicate copy operations and busy feedback resets");

for (const imageSrc of ["data:image/png;base64,AAA", "file:///C:/private.png", "javascript:alert(1)"]) {
  const unsafe = setup({ imageSrc }); await unsafe.click();
  assert.equal(unsafe.stats.clipboard.length, 0); assert.equal(unsafe.stats.exec, 0);
  assert(unsafe.status.textContent.startsWith("复制未成功。"));
  checks.push(`unsupported image protocol is rejected before clipboard use: ${imageSrc.split(":")[0]}`);
}
const missingSrc = setup({ missingSrc: true }); await missingSrc.click();
assert.equal(missingSrc.stats.clipboard.length, 0); assert.equal(missingSrc.stats.exec, 0);
checks.push("missing image URL cannot produce an apparently successful image-free copy");
for (const imageSrc of ["//images.example.test/original.jpg", "http://images.example.test/original.jpg"]) {
  const remote = setup({ imageSrc }); await remote.click();
  assert((await remote.clipboardPayload()).html.includes(imageSrc.startsWith("//") ? "https://images.example.test/original.jpg" : imageSrc));
  assert.equal(remote.activeImages(), 0);
  checks.push("supported HTTP image addresses resolve correctly without mounting a preview: " + imageSrc);
}
for (const unsafeHref of ["data:text/html,test", "vbscript:alert(1)"]) {
  const unsafeLink = setup({ unsafeHref }); await unsafeLink.click();
  assert(!(await unsafeLink.clipboardPayload()).html.includes(unsafeHref));
  checks.push("unsafe link address is stripped from copied HTML: " + unsafeHref.split(":")[0]);
}
for (const missingElement of ["wechat-copy", "wechat-copy-status", "wechat-copy-content", "wechat-copy-template"]) {
  const missing = setup({ missingElement }); await missing.click(); await missing.toggle(true);
  assert.equal(missing.stats.mounts, 0); assert.equal(missing.stats.clipboard.length, 0);
  checks.push("incomplete page is inert: missing " + missingElement);
}
const empty = setup({ emptyTemplate: true }); await empty.click();
assert.equal(empty.stats.clipboard.length, 0); assert(empty.status.textContent.startsWith("复制未成功。"));
checks.push("empty template reports failure rather than copying empty content");

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
