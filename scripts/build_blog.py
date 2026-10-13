"""Build the blog from existing public Markdown, without editing its source."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, timezone
from email.utils import format_datetime
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import struct
import sys
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from xml.etree.ElementTree import Element, SubElement, tostring

ROOT = Path(__file__).resolve().parent.parent
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))

from markdown_it import MarkdownIt
from mdit_py_plugins.footnote import footnote_plugin
from image_assets import ResponsiveImages

OUTPUT = ROOT / "_site"
INTERACTION_DIR = ROOT / "blog"
FOLDERS = {"中文文章": ("zh-CN", "中文文章", "chinese.html"),
           "English Articles": ("en", "English Articles", "english.html")}
ASSETS = ("images", "附属资料")


def read_waline_config(path: Path) -> dict:
    config = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    if config.get("enabled") is not True:
        return {"enabled": False}
    address = config.get("serverURL", "").strip()
    parsed = urlsplit(address)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.hostname in {"example.com", "localhost", "127.0.0.1"}
            or parsed.hostname.endswith((".example", ".invalid"))):
        raise ValueError("Waline needs the real HTTPS backend URL, without credentials, query or fragment.")
    if config.get("backendVerified") is not True or not all(
            isinstance(config.get(name), str) and config[name].strip()
            for name in ("hostingProvider", "databaseProvider")):
        raise ValueError("Verify backend moderation/privacy settings and confirm providers before enabling Waline.")
    return {"enabled": True, "backendVerified": True, "serverURL": address.rstrip("/"),
            "hostingProvider": config["hostingProvider"].strip(), "databaseProvider": config["databaseProvider"].strip()}


@dataclass
class Article:
    source: Path
    destination: str
    title: str
    published: str
    language: str
    category: str
    listing: str
    markdown: str


def plain_inline(token) -> str:
    return "".join(child.content for child in (token.children or [])
                   if child.type in {"text", "code_inline", "image", "softbreak"})


def safe_line_break(state, silent: bool) -> bool:
    """Allow Markdown table line breaks without enabling arbitrary raw HTML."""
    match = re.match(r"<br\s*/?>", state.src[state.pos:state.posMax], re.IGNORECASE)
    if match is None:
        return False
    if not silent:
        state.push("html_inline", "", 0).content = "<br>"
    state.pos += len(match.group(0))
    return True


class WechatContent(HTMLParser):
    """Give the copyable body its own inline styles, independent of the blog theme."""

    BASE = "background-color:#ffffff;color:inherit;font-size:inherit;line-height:inherit;letter-spacing:inherit;"
    STYLES = {
        "p": "margin:0 0 20px;padding:0;font-size:16px;line-height:2;text-align:left;",
        "h1": "margin:28px 0 16px;font-size:22px;line-height:1.5;font-weight:700;",
        "h2": "margin:28px 0 16px;font-size:20px;line-height:1.5;font-weight:700;",
        "h3": "margin:24px 0 12px;font-size:18px;line-height:1.5;font-weight:700;",
        "h4": "margin:20px 0 12px;font-size:16px;line-height:1.5;font-weight:700;",
        "h5": "margin:20px 0 12px;font-size:16px;line-height:1.5;font-weight:700;",
        "h6": "margin:20px 0 12px;font-size:16px;line-height:1.5;font-weight:700;",
        "strong": "font-weight:700;",
        "em": "font-style:italic;",
        "s": "text-decoration:line-through;",
        "a": "color:#316c65;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word;",
        "img": "display:block;max-width:100%;height:auto;margin:16px auto;border:0;border-radius:0;",
        "ul": "margin:0 0 20px;padding:0 0 0 24px;list-style:disc;",
        "ol": "margin:0 0 20px;padding:0 0 0 24px;list-style:decimal;",
        "li": "margin:6px 0;padding:0;",
        "blockquote": "margin:20px 0;padding:0 0 0 14px;border-left:3px solid #316c65;",
        "table": "display:table;width:100%;max-width:100%;margin:20px 0;border-collapse:collapse;table-layout:fixed;font-size:14px;line-height:1.7;letter-spacing:0;",
        "th": "padding:8px;border:1px solid #dddddd;text-align:left;vertical-align:top;font-weight:700;word-break:break-word;overflow-wrap:anywhere;",
        "td": "padding:8px;border:1px solid #dddddd;text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere;",
        "hr": "margin:28px 0;border:0;border-top:1px solid #dddddd;",
        "pre": "margin:20px 0;padding:12px;border:1px solid #dddddd;white-space:pre-wrap;word-break:break-word;",
        "code": 'padding:0;font-family:Consolas,"Liberation Mono",monospace;white-space:pre-wrap;',
    }

    def __init__(self, page_url: str):
        super().__init__(convert_charrefs=False)
        self.page_url = page_url
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        # No blog classes, heading IDs or lazy loading in the clipboard payload.
        originals = dict(attrs)
        values = {key: value for key, value in attrs
                  if key not in {"id", "class", "style", "loading", "decoding", "srcset", "sizes"}
                  and not key.startswith("data-original-")}
        if tag == "img" and originals.get("data-original-src"):
            values["src"] = originals["data-original-src"]
            for dimension in ("width", "height"):
                if originals.get("data-original-" + dimension):
                    values[dimension] = originals["data-original-" + dimension]
                else:
                    values.pop(dimension, None)
        for key in ("src", "href"):
            if values.get(key):
                values[key] = urljoin(self.page_url, values[key])
        values["style"] = self.BASE + self.STYLES.get(tag, "")
        attributes = "".join(f' {key}="{escape(value, quote=True)}"' if value is not None else f" {key}"
                             for key, value in values.items())
        self.parts.append(f"<{tag}{attributes}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        self.parts.append(data)

    def handle_entityref(self, name):
        self.parts.append(f"&{name};")

    def handle_charref(self, name):
        self.parts.append(f"&#{name};")


class Blog:
    def __init__(self, site_url: str, output: Path | None = None):
        self.output = Path(output) if output is not None else OUTPUT
        self.config = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
        self.waline = read_waline_config(INTERACTION_DIR / "waline.json")
        self.site_url = site_url.rstrip("/")
        parsed = urlsplit(self.site_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("The site URL must be a full http(s) URL without query or fragment.")
        self.base_path = parsed.path.rstrip("/") + "/"
        self.parser = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
        self.parser.use(footnote_plugin)
        self.parser.inline.ruler.before("html_inline", "safe_line_break", safe_line_break)
        self.articles: list[Article] = []
        self.pages = {(ROOT / "README.md").resolve(): "about.html"}
        dates_file = ROOT / "blog/publication-dates.json"
        self.publication_dates = json.loads(dates_file.read_text(encoding="utf-8")) if dates_file.exists() else {}
        self.image_sizes = {}
        self.responsive_images = ResponsiveImages(ROOT, self.output, self.base_path)

    def href(self, destination: str) -> str:
        return self.base_path + quote(destination, safe="/")

    def canonical(self, destination: str) -> str:
        return self.site_url + "/" + quote(destination, safe="/")

    def collect(self):
        for folder, (language, category, listing) in FOLDERS.items():
            for source in sorted((ROOT / folder).rglob("*.md")):
                relative = source.relative_to(ROOT)
                if any(part.startswith(".") for part in relative.parts):
                    continue
                if source.is_symlink():
                    raise ValueError(f"Article symlinks are not supported: {relative}")
                published = source.name[:10]
                date.fromisoformat(published)
                if not source.name.startswith(published + "-"):
                    raise ValueError(f"Use YYYY-MM-DD-title.md: {relative}")
                text = source.read_text(encoding="utf-8-sig")
                tokens = self.parser.parse(text)
                if not tokens or tokens[0].type != "heading_open" or tokens[0].tag != "h1":
                    raise ValueError(f"The article must begin with # title: {relative}")
                title = plain_inline(tokens[1])
                body = "\n".join(text.splitlines()[tokens[0].map[1]:]).lstrip("\n")
                destination = relative.with_suffix(".html").as_posix()
                self.pages[source.resolve()] = destination
                published = self.publication_dates.get(relative.as_posix(), {}).get("date", published)
                if published and not re.fullmatch(r"\d{4}-\d{2}(?:-\d{2})?", published):
                    raise ValueError(f"Invalid original publication date: {relative}")
                if len(published) == 10:
                    date.fromisoformat(published)
                self.articles.append(Article(source, destination, title, published,
                                             language, category, listing, body))
        self.articles.sort(key=lambda article: (article.published or article.source.name[:10], article.destination), reverse=True)

    def publication(self, article: Article) -> str:
        if not article.published:
            return '<span class="publication-date">发表时间待确认</span>'
        metadata = self.publication_dates.get(article.source.relative_to(ROOT).as_posix(), {})
        label = escape(metadata.get("label", "发表于"))
        qualifier = '（首发时间待确认）' if metadata.get("first_publication_unknown") else ''
        return f'<span class="publication-date">{label} <time datetime="{article.published}">{article.published}</time>{qualifier}</span>'

    def image_dimensions(self, url: str):
        """Read common image headers locally without changing the original bytes."""
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith(self.base_path):
            return None
        path = ROOT / unquote(parsed.path[len(self.base_path):])
        if path in self.image_sizes:
            return self.image_sizes[path]
        size = None
        with path.open("rb") as stream:
            header = stream.read(32)
            if header.startswith(b"\x89PNG\r\n\x1a\n") and len(header) >= 24:
                size = struct.unpack(">II", header[16:24])
            elif header[:6] in {b"GIF87a", b"GIF89a"} and len(header) >= 10:
                size = struct.unpack("<HH", header[6:10])
            elif header[:4] == b"RIFF" and header[8:12] == b"WEBP":
                chunk = header[12:16]
                if chunk == b"VP8X" and len(header) >= 30:
                    size = (1 + int.from_bytes(header[24:27], "little"),
                            1 + int.from_bytes(header[27:30], "little"))
                elif chunk == b"VP8 " and len(header) >= 30 and header[23:26] == b"\x9d\x01\x2a":
                    size = tuple(value & 0x3fff for value in struct.unpack("<HH", header[26:30]))
                elif chunk == b"VP8L" and len(header) >= 25 and header[20] == 0x2f:
                    bits = int.from_bytes(header[21:25], "little")
                    size = ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
            elif header.startswith(b"\xff\xd8"):
                stream.seek(2)
                while True:
                    byte = stream.read(1)
                    if not byte:
                        break
                    if byte != b"\xff":
                        continue
                    marker = stream.read(1)
                    while marker == b"\xff":
                        marker = stream.read(1)
                    if not marker or marker in {b"\xd9", b"\xda"}:
                        break
                    if marker in {b"\x00", b"\xd8"} or 0xd0 <= marker[0] <= 0xd7:
                        continue
                    length_bytes = stream.read(2)
                    if len(length_bytes) != 2:
                        break
                    length = struct.unpack(">H", length_bytes)[0]
                    if length < 2:
                        break
                    if marker[0] in {0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf}:
                        data = stream.read(5)
                        if len(data) == 5:
                            height, width = struct.unpack(">HH", data[1:5])
                            size = (width, height)
                        break
                    stream.seek(length - 2, 1)
        self.image_sizes[path] = size
        return size

    def rewrite(self, url: str, source: Path) -> str:
        parsed = urlsplit(url)
        if parsed.scheme or parsed.netloc or not parsed.path:
            return url
        decoded = unquote(parsed.path)
        if decoded.startswith("/"):
            decoded = decoded.removeprefix(self.base_path).lstrip("/")
            target = (ROOT / decoded).resolve()
        else:
            target = (source.parent / decoded).resolve()
        if not target.is_relative_to(ROOT) or not target.is_file():
            raise ValueError(f"Missing or outside-repository link in {source.relative_to(ROOT)}: {url}")
        relative = target.relative_to(ROOT)
        if target in self.pages:
            destination = self.pages[target]
        elif relative.parts[0] in ASSETS and not any(part.startswith(".") for part in relative.parts):
            destination = relative.as_posix()
        else:
            raise ValueError(f"Link is outside published content in {source.relative_to(ROOT)}: {url}")
        return urlunsplit(("", "", self.href(destination), parsed.query, parsed.fragment))

    def render(self, text: str, source: Path) -> str:
        tokens = self.parser.parse(text)
        slugs = {}

        def visit(token):
            for attr in ("href", "src"):
                value = token.attrGet(attr)
                if value is not None:
                    token.attrSet(attr, self.rewrite(value, source))
            if token.type == "image":
                token.attrSet("loading", "lazy")
                token.attrSet("decoding", "async")
                dimensions = self.image_dimensions(token.attrGet("src") or "")
                if dimensions and all(dimensions):
                    token.attrSet("width", str(dimensions[0]))
                    token.attrSet("height", str(dimensions[1]))
                for name, value in self.responsive_images.attributes(token.attrGet("src") or "").items():
                    token.attrSet(name, str(value))
            for child in token.children or []:
                visit(child)

        for index, token in enumerate(tokens):
            if token.type == "heading_open":
                slug = re.sub(r"[^\w\- ]", "", plain_inline(tokens[index + 1]).lower())
                slug = re.sub(r"\s", "-", slug) or "section"
                count = slugs.get(slug, 0)
                slugs[slug] = count + 1
                token.attrSet("id", slug if count == 0 else f"{slug}-{count}")
            visit(token)
        return self.parser.renderer.render(tokens, self.parser.options, {})

    def wechat_content(self, article: Article) -> str:
        content = WechatContent(self.canonical(article.destination))
        content.feed(self.render(article.markdown, article.source))
        style = ('background-color:#ffffff;color:#333333;font-family:-apple-system,BlinkMacSystemFont,'
                 '"Segoe UI","Microsoft YaHei",sans-serif;font-size:16px;line-height:2;letter-spacing:1px;'
                 'margin:0;padding:0;max-width:100%;text-align:left;overflow-wrap:anywhere;')
        return f'<section lang="{article.language}" style="{escape(style, quote=True)}">' + "".join(content.parts) + '</section>'

    def wechat_tools(self, article: Article) -> str:
        """Keep original-image copy markup inert until preview or copy is requested."""
        return f'''<aside class="wechat-tools" aria-label="公众号排版" lang="zh-CN">
<div class="wechat-action">
<button type="button" id="wechat-copy">复制到公众号</button>
<p id="wechat-copy-status" role="status" aria-live="polite">复制正文和图片；标题在公众号单独填写。</p>
</div>
<details class="wechat-preview"><summary>公众号排版预览</summary>
<div id="wechat-copy-content"></div>
<template id="wechat-copy-template">{self.wechat_content(article)}</template>
<noscript><p>请启用 JavaScript 后展开预览或复制正文；上方文章仍可正常阅读。</p></noscript>
</details></aside>'''

    def document(self, title: str, body: str, destination: str, language="zh-CN", active="", description="") -> str:
        description = description or self.config["description"]
        nav = []
        for label, target in [("个人主页", "/"), ("文章首页", "index.html"),
                              ('作品 <span lang="en">Projects</span>', "/projects/"),
                              ("中文文章", "chinese.html"), ("English", "english.html"), ("关于我", "about.html")]:
            current = ' aria-current="page"' if target == active else ""
            address = target if target in {"/", "/projects/"} else self.href(target)
            link_language = ' lang="en"' if target == "english.html" else ""
            nav.append(f'<a href="{escape(address)}"{current}{link_language}>{label}</a>')
        return f'''<!doctype html>
<html lang="{language}" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)} · {escape(self.config['title'])}</title>
  <meta name="description" content="{escape(description)}">
  <meta name="author" content="{escape(self.config['author'])}">
  <link rel="canonical" href="{escape(self.canonical(destination))}">
  <meta property="og:type" content="{'article' if destination not in {'index.html', 'chinese.html', 'english.html', 'about.html'} else 'website'}">
  <meta property="og:title" content="{escape(title)}">
  <meta property="og:description" content="{escape(description)}">
  <meta property="og:url" content="{escape(self.canonical(destination))}">
  <script>try {{ if (localStorage.getItem("xieyuqing-blog-theme") === "light") document.documentElement.dataset.theme = "light"; }} catch (_) {{}}</script>
  <link rel="stylesheet" href="{escape(self.href('assets/style.css'))}">
  <link rel="alternate" type="application/rss+xml" title="{escape(self.config['title'])}" href="{escape(self.href('feed.xml'))}">
  <script src="{escape(self.href('assets/site.js'))}" defer></script>
  {self.waline_head(destination)}
</head>
<body id="top">
  <a class="skip-link" href="#main" lang="zh-CN">跳转到正文 / <span lang="en">Skip to content</span></a>
  <header class="site-header container" lang="zh-CN">
    <a class="brand" href="{escape(self.href('index.html'))}"><span class="brand-mark" aria-hidden="true">卿</span><span>{escape(self.config['title'])}<small lang="en">XIE YUQING · CARL</small></span></a>
    <div class="header-actions"><nav class="site-nav" aria-label="导航 / Navigation">{''.join(nav)}</nav>
    <button class="theme-toggle" id="theme-toggle" type="button" aria-label="切换到浅色模式" title="切换到浅色模式" hidden><span class="theme-icon" aria-hidden="true">◐</span><span class="theme-label">浅色</span></button></div>
  </header>
  <main id="main" class="container">{body}</main>
  <footer class="site-footer container" lang="zh-CN">
    <div><strong>{escape(self.config['title'])}</strong><span>生活、学习与社会的观察和思考。</span></div>
    <p>© {date.today().year} {escape(self.config['author'])}</p>
    <div class="footer-links"><a href="{escape(self.href('feed.xml'))}">RSS 订阅</a><a href="{escape(self.config['repository_url'])}" lang="en">GitHub ↗</a></div>
  </footer>
</body>
</html>
'''

    def waline_head(self, destination: str) -> str:
        if not self.waline["enabled"] or destination == "about.html":
            return ""
        settings = {**self.waline, "siteOrigin": urlunsplit((*urlsplit(self.site_url)[:2], "", "", "")),
                    "clientJS": self.href("assets/waline/waline.js"),
                    "clientCSS": self.href("assets/waline/waline.css")}
        encoded = json.dumps(settings, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
        return (f'<link rel="stylesheet" href="{escape(self.href("assets/waline-integration.css"))}">'
                f'<script type="application/json" id="waline-settings">{encoded}</script>'
                f'<script type="module" src="{escape(self.href("assets/waline-integration.js"))}"></script>')

    def metrics(self, article: Article) -> str:
        if not self.waline["enabled"]:
            return ""
        return (f'<span class="article-stat" data-stats-path="{escape(self.href(article.destination))}" lang="zh-CN" hidden>'
                '<span data-counter="views" hidden>浏览 <b></b></span>'
                '<span data-counter="comments" hidden>评论 <b></b></span></span>')

    def provider_notice(self) -> str:
        return f'服务托管：{escape(self.waline["hostingProvider"])}；数据库：{escape(self.waline["databaseProvider"])}。'

    def statistics_notice(self) -> str:
        if not self.waline["enabled"]:
            return ""
        return ('<p class="statistics-notice" lang="zh-CN">浏览与评论统计请求会向所选Waline后端及其托管商发送IP和浏览器信息。'
                + self.provider_notice() + '</p>')

    def comments(self, article: Article) -> str:
        if not self.waline["enabled"]:
            return ""
        return (f'<section class="article-comments" id="article-comments" data-article-path="{escape(self.href(article.destination))}" aria-labelledby="comments-heading" lang="zh-CN" hidden>'
                '<h2 id="comments-heading">留言</h2><p class="comment-policy">无需注册；昵称必填，邮箱选填。评论审核通过后显示。</p>'
                '<p class="comment-privacy">评论和昵称会公开；邮箱不公开且不用于通知。评论、昵称、可选邮箱及请求中的IP和浏览器信息会由所选Waline后端及其托管商处理；不公开地区和浏览器标签。'
                + self.provider_notice() + '</p><div id="waline"></div></section>')

    def excerpt(self, article: Article) -> str:
        tokens = self.parser.parse(article.markdown)
        for index, token in enumerate(tokens):
            if token.type == "paragraph_open" and tokens[index + 1].type == "inline":
                content = plain_inline(tokens[index + 1])
                if content:
                    return content[:150] + ("…" if len(content) > 150 else "")
        return ""

    def topic(self, article: Article) -> str:
        """Navigation labels inferred from public writing, never source metadata."""
        title = article.title.lower()
        if any(word in title for word in ("中学生", "教育", "学校")):
            return "学习与思考"
        if any(word in title for word in ("markdown", "word", "geo", "生成式", "ai", "人工智能", "论文", "youtube", "扣子", "公众号", "写作", "创作", "互联网", "网站")):
            return "科技与写作"
        if any(word in title for word in ("资本论", "劳动", "价值形式", "生产方式", "工资", "就业", "失业", "经济", "社会主义", "煤老板", "家督", "继承", "生育", "人口", "生存", "重男轻女")):
            return "经济与社会"
        if any(word in title for word in ("明朝", "皇帝", "历史", "朝代", "姓名", "华人", "诸葛亮", "刘备", "庞统", "范仲淹", "李白", "毛泽东", "司马迁", "史记", "苏轼", "近体诗", "诗歌", "西塞山", "孔子", "老子", "四川话", "传统")):
            return "历史与文化"
        if any(word in title for word in ("吉隆坡", "马来西亚", "地铁", "天气", "城市", "布城", "青岛", "山西", "涿州", "通州", "开车", "出行", "公交", "交通", "旅游")):
            return "城市生活"
        if any(word in title for word in ("学习", "study", "learning", "读书", "阅读", "找书", "学术", "时区", "mba", "读研", "英语", "文学", "识字率")):
            return "学习与思考"
        return "生活与思考"

    def reading_minutes(self, article: Article) -> int:
        text = " ".join(plain_inline(token) for token in self.parser.parse(article.markdown)
                        if token.type == "inline")
        units = len(re.findall(r"[\u3400-\u9fff]|[a-zA-Z]+", text))
        return max(1, round(units / (320 if article.language == "zh-CN" else 220)))

    def listing(self, articles: list[Article]) -> str:
        cards = []
        for index, article in enumerate(articles, 1):
            topic = self.topic(article)
            excerpt = self.excerpt(article)
            searchable = escape(f"{article.title} {excerpt} {topic} {article.category} {article.published}", quote=True)
            cards.append(f'''<li class="article-card">
<span class="article-number" aria-hidden="true">{index:02d}</span>
<div class="article-card-content" data-topic="{escape(topic)}" data-year="{article.published[:4]}" data-search="{searchable}">
<p class="article-meta"><span class="topic-tag">{escape(topic)}</span>{self.publication(article)}<span>{article.category}</span>{self.metrics(article)}</p>
<h2 class="article-title"><a href="{escape(self.href(article.destination))}" lang="{article.language}">{escape(article.title)}</a></h2>
<p class="article-excerpt" lang="{article.language}">{escape(excerpt)}</p>
<p class="article-read"><span>约 {self.reading_minutes(article)} 分钟阅读</span><a href="{escape(self.href(article.destination))}" aria-label="阅读：{escape(article.title)}">阅读全文 <span aria-hidden="true">↗</span></a></p>
</div>
</li>''')
        return '<ul class="article-list">' + "\n".join(cards) + '</ul>' if cards else '<p class="empty-state">文章即将更新。</p>'

    def archive(self, articles: list[Article], title="文章", subtitle="从一篇文章开始，慢慢读。") -> str:
        notice = ('<p class="statistics-notice">浏览与评论统计请求会向所选Waline后端及其托管商发送IP和浏览器信息。'
                  + self.provider_notice() + '</p>') if self.waline["enabled"] else ""
        topics = sorted({self.topic(article) for article in articles})
        filters = ['<button type="button" class="filter-button active" data-filter="all" aria-pressed="true">全部<span>' + str(len(articles)) + '</span></button>']
        for topic in topics:
            count = sum(self.topic(article) == topic for article in articles)
            filters.append(f'<button type="button" class="filter-button" data-filter="{escape(topic)}" aria-pressed="false">{escape(topic)}<span>{count}</span></button>')
        years = sorted({article.published[:4] for article in articles if article.published}, reverse=True)
        year_options = ''.join(f'<option value="{year}">{year} 年</option>' for year in years)
        if any(not article.published for article in articles):
            year_options += '<option value="unknown">时间待确认</option>'
        return f'''<section class="archive" id="archive" aria-labelledby="archive-heading">
<div class="section-heading"><div><p class="eyebrow">~/writing · 文章</p><h2 id="archive-heading">{escape(title)}</h2><p>{escape(subtitle)}</p></div><span class="archive-total">{len(articles):02d} <small>篇文章</small></span></div>
<div class="archive-controls" hidden>
<div class="topic-filters" role="group" aria-label="按主题筛选">{''.join(filters)}</div>
<div class="archive-query"><label class="year-filter"><span class="sr-only">按发表年份筛选</span><select id="article-year" aria-label="按发表年份筛选"><option value="all">全部年份</option>{year_options}</select></label>
<label class="search-box"><span class="search-icon" aria-hidden="true"></span><span class="sr-only">搜索文章标题或摘要</span><input type="search" id="article-search" placeholder="搜索标题或摘要…" autocomplete="off" aria-controls="archive-results"><span class="search-key" aria-hidden="true">/</span></label>
</div></div>
{notice}<p class="search-status" id="archive-results" role="status" aria-live="polite" hidden></p>
{self.listing(articles)}
<nav class="archive-pagination" aria-label="文章分页" hidden>
<button type="button" data-page="prev">← 上一页</button><span class="pagination-position"></span><button type="button" data-page="next">下一页 →</button>
<form class="page-jump" novalidate><label for="article-page">跳至</label><input id="article-page" name="page" type="text" inputmode="numeric" autocomplete="off" aria-label="跳转页码" aria-describedby="page-jump-message"><span>页</span><button type="submit">跳转</button></form>
<p id="page-jump-message" class="page-jump-message" role="status" aria-live="polite" hidden></p>
</nav>
<div class="search-empty" hidden><p>没有找到符合条件的文章。</p><button type="button" class="reset-search">清除搜索与筛选</button></div>
</section>'''

    def toc(self, rendered: str, language="zh-CN") -> str:
        class Headings(HTMLParser):
            def __init__(self):
                super().__init__()
                self.items = []
                self.current = None
            def handle_starttag(self, tag, attrs):
                if tag in {"h2", "h3", "h4"}:
                    self.current = [tag, dict(attrs).get("id", ""), ""]
            def handle_data(self, text):
                if self.current:
                    self.current[2] += text
            def handle_endtag(self, tag):
                if self.current and tag == self.current[0]:
                    self.items.append(self.current)
                    self.current = None
        headings = Headings()
        headings.feed(rendered)
        if not headings.items:
            return '<aside class="article-toc" lang="zh-CN"><p class="eyebrow">阅读这篇文章</p><p class="toc-note">慢慢读，保持好奇。</p><a class="toc-top" href="#top">↑ 回到顶部</a></aside>'
        links = ''.join(f'<li class="toc-{tag}"><a href="#{escape(slug)}" lang="{language}">{escape(label)}</a></li>'
                        for tag, slug, label in headings.items)
        return f'''<aside class="article-toc" lang="zh-CN"><details open><summary><span>文章目录</span><span class="toc-toggle" aria-hidden="true">+</span></summary><nav aria-label="文章目录"><ol>{links}</ol></nav></details><a class="toc-top" href="#top">↑ 回到顶部</a></aside>'''

    def feed(self):
        rss = Element("rss", version="2.0")
        channel = SubElement(rss, "channel")
        for key, value in (("title", self.config["title"]), ("link", self.site_url + "/"),
                           ("description", self.config["description"]), ("language", "zh-CN")):
            SubElement(channel, key).text = value
        for article in self.articles:
            item = SubElement(channel, "item")
            address = self.canonical(article.destination)
            for key, value in (("title", article.title), ("link", address), ("guid", address),
                               ("description", self.excerpt(article)), ("category", self.topic(article))):
                SubElement(item, key).text = value
            if len(article.published) == 10:
                SubElement(item, "pubDate").text = format_datetime(datetime.fromisoformat(article.published).replace(tzinfo=timezone.utc))
        (self.output / "feed.xml").write_bytes(tostring(rss, encoding="utf-8", xml_declaration=True))

    def write(self, destination: str, html: str):
        target = self.output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")

    def build(self, clean=True):
        self.collect()
        # Only remove this generator's own output, after checking its exact path.
        if self.output.is_symlink() or self.output.resolve() not in {ROOT.resolve() / "_site", ROOT.resolve() / "_site_unified" / "articles"}:
            raise ValueError("Unsafe generated output path.")
        if self.output.exists():
            if not (self.output / ".generated-by-blog").is_file():
                raise ValueError("_site already exists without this generator's marker; keep it intact.")
            if clean:
                shutil.rmtree(self.output)
        self.output.mkdir(parents=True, exist_ok=True)
        (self.output / ".generated-by-blog").write_text("Generated website only.\n", encoding="utf-8")
        (self.output / ".nojekyll").write_text("", encoding="utf-8")
        (self.output / "assets").mkdir(exist_ok=True)
        shutil.copy2(ROOT / "blog/style.css", self.output / "assets/style.css")
        shutil.copy2(ROOT / "blog/wechat-copy.js", self.output / "assets/wechat-copy.js")
        shutil.copy2(ROOT / "blog/site.js", self.output / "assets/site.js")
        if self.waline["enabled"]:
            for name in ("waline-integration.js", "waline-integration.css", "comment-avatar.svg"):
                shutil.copy2(INTERACTION_DIR / name, self.output / "assets" / name)
            shutil.copytree(INTERACTION_DIR / "vendor/waline", self.output / "assets/waline", dirs_exist_ok=True)
        for folder in ASSETS:
            for source in sorted((ROOT / folder).rglob("*")):
                relative = source.relative_to(ROOT)
                if any(part.startswith(".") for part in relative.parts):
                    continue
                if source.is_symlink():
                    raise ValueError(f"Asset symlinks are not supported: {relative}")
                if source.is_file():
                    target = self.output / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
        self.responsive_images.prepare()
        chinese = sum(article.language == "zh-CN" for article in self.articles)
        english = len(self.articles) - chinese
        featured = ""
        if self.articles:
            latest = self.articles[0]
            featured = f'''<aside class="featured-article"><div class="feature-top"><p class="eyebrow">LATEST ESSAY · 最新一篇</p><span aria-hidden="true">↗</span></div><div><p class="featured-meta">{escape(self.topic(latest))} <span> / </span>{self.publication(latest)}</p><h2><a href="{escape(self.href(latest.destination))}" lang="{latest.language}">{escape(latest.title)}</a></h2><p class="featured-excerpt" lang="{latest.language}">{escape(self.excerpt(latest))}</p></div><a class="featured-link" href="{escape(self.href(latest.destination))}">读这篇文章 <span aria-hidden="true">→</span></a></aside>'''
        chinese_heading, separator, english_heading = self.config['article_heading'].partition(' ')
        article_heading = escape(chinese_heading) + (f' <span>{escape(english_heading)}</span>' if separator else '')
        intro = f'''<section class="home-intro" aria-labelledby="home-heading"><div class="intro-copy"><p class="eyebrow"><span class="eyebrow-line" aria-hidden="true"></span> ~/essays · 个人写作</p><h1 id="home-heading">{article_heading}</h1><p class="intro-description">{escape(self.config['article_description'])}</p><p class="intro-english" lang="en">{escape(self.config['article_english_description'])}</p><div class="intro-actions"><a class="primary-link" href="#archive">浏览文章 <span aria-hidden="true">↓</span></a><a class="quiet-link" href="{escape(self.href('about.html'))}">认识作者 ↗</a></div></div>{featured}</section>
<div class="archive-banner"><p>写作，是观察世界的另一种方式。</p><div><span><strong>{chinese:02d}</strong> 中文文章</span><span><strong>{english:02d}</strong> English</span><span><strong>{len({self.topic(a) for a in self.articles}):02d}</strong> 写作主题</span></div></div>'''
        self.write("index.html", self.document("文章", intro + self.archive(self.articles), "index.html", active="index.html", description=self.config["article_description"]))
        for folder, (language, category, destination) in FOLDERS.items():
            entries = [article for article in self.articles if article.category == category]
            label = "CHINESE ESSAYS" if language == "zh-CN" else "ENGLISH WRITING"
            description = "用中文记录生活里的问题、见闻与思考。" if language == "zh-CN" else "Short essays and writing practice, one piece at a time."
            heading = f'<section class="page-intro"><p class="eyebrow">{label}</p><h1>{category}</h1><p>{description}</p></section>'
            self.write(destination, self.document(category, heading + self.archive(entries, "全部文章", "按写作日期排列，最新文章在前。"), destination, active=destination))
        readme = (ROOT / "README.md").read_text(encoding="utf-8-sig")
        about_text = re.sub(r"(?ms)^## 文章索引 · Article Index\n.*?(?=^## )", "", readme)
        about = '<section class="page-intro"><p class="eyebrow">~/about · 关于作者</p><h1>关于我</h1><p>从日常出发，在学习中继续追问。</p></section><article class="article-body about-body">' + self.render(about_text, ROOT / "README.md") + '</article>'
        self.write("about.html", self.document("关于我", about, "about.html", active="about.html"))
        for index, article in enumerate(self.articles):
            rendered = self.render(article.markdown, article.source)
            related = []
            for neighbour, label in ((index - 1, "较新一篇"), (index + 1, "较早一篇")):
                if 0 <= neighbour < len(self.articles):
                    next_article = self.articles[neighbour]
                    related.append(f'<a href="{escape(self.href(next_article.destination))}"><span>{label}</span><strong lang="{next_article.language}">{escape(next_article.title)}</strong><small>{next_article.published} <span aria-hidden="true">↗</span></small></a>')
            next_reading = '<nav class="next-reading" aria-label="继续阅读" lang="zh-CN">' + ''.join(related) + '</nav>' if related else ''
            body = f'''<div class="reading-progress" aria-hidden="true"><span></span></div><article class="reading-page"><header class="article-header">
<a class="back-link" href="{escape(self.href(article.listing))}" lang="{article.language}">← {article.category}</a>
<p class="eyebrow" lang="zh-CN">{escape(self.topic(article))}</p><h1>{escape(article.title)}</h1>
<p class="article-meta" lang="zh-CN">{self.publication(article)}<span>{escape(self.config['author'])}</span><span>约 {self.reading_minutes(article)} 分钟阅读</span>{self.metrics(article)}</p></header>
{self.statistics_notice()}
<div class="reading-layout"><div class="reading-content">
<div class="article-body" id="article-content">{rendered}</div>
{self.comments(article)}
{self.wechat_tools(article)}
<div class="article-end" lang="zh-CN"><span aria-hidden="true">◆</span><p>谢谢你读到这里。</p><a href="{escape(self.href('index.html'))}#archive">返回文章归档 →</a></div>{next_reading}</div>{self.toc(rendered, article.language)}</div></article>
<script src="{escape(self.href('assets/wechat-copy.js'))}" defer></script>'''
            self.write(article.destination, self.document(article.title, body, article.destination, article.language, article.listing, self.excerpt(article)))
        sitemap = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
        for destination in ["index.html", "chinese.html", "english.html", "about.html", *[a.destination for a in self.articles]]:
            SubElement(SubElement(sitemap, "url"), "loc").text = self.canonical(destination)
        (self.output / "sitemap.xml").write_bytes(tostring(sitemap, encoding="utf-8", xml_declaration=True))
        self.feed()
        self.check()

    def check(self):
        class Links(HTMLParser):
            def __init__(self):
                super().__init__()
                self.urls = []
                self.images = 0

            def handle_starttag(self, tag, attrs):
                for key, value in attrs:
                    if key in {"href", "src"} and value:
                        self.urls.append(value)
                self.images += tag == "img"

        checked = images = root_links = 0
        for source in self.output.rglob("*.html"):
            parser = Links()
            parser.feed(source.read_text(encoding="utf-8"))
            images += parser.images
            for url in parser.urls:
                parsed = urlsplit(url)
                own_site = urlsplit(self.site_url)
                if (parsed.scheme or parsed.netloc) and (parsed.scheme, parsed.netloc) != (own_site.scheme, own_site.netloc):
                    continue
                if not parsed.path:
                    continue
                # These exact root destinations belong to the unified-site builder.
                # Do not exempt arbitrary root paths from this article-site check.
                if parsed.path in {"/", "/projects/"}:
                    root_links += 1
                    continue
                if not parsed.path.startswith(self.base_path):
                    raise ValueError(f"Link misses site base path: {url}")
                target = (self.output / unquote(parsed.path[len(self.base_path):])).resolve()
                if not target.is_relative_to(self.output) or not target.is_file():
                    raise ValueError(f"Broken generated link in {source.relative_to(self.output)}: {url}")
                checked += 1
        print(f"Built {len(self.articles)} articles; checked {checked} article-site links, {root_links} unified-root links and {images} image references (including inert copy templates).")


if __name__ == "__main__":
    settings = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--site-url", default=settings["site_url"])
    Blog(arguments.parse_args().site_url).build()
