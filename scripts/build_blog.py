"""Build the blog from existing public Markdown, without editing its source."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from xml.etree.ElementTree import Element, SubElement, tostring

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site"
FOLDERS = {"中文文章": ("zh-CN", "中文文章", "chinese.html"),
           "English Articles": ("en", "English Articles", "english.html")}
ASSETS = ("images", "附属资料")


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
        values = {key: value for key, value in attrs
                  if key not in {"id", "class", "style", "loading", "decoding"}}
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
    def __init__(self, site_url: str):
        self.config = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
        self.site_url = site_url.rstrip("/")
        parsed = urlsplit(self.site_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("The site URL must be a full http(s) URL without query or fragment.")
        self.base_path = parsed.path.rstrip("/") + "/"
        self.parser = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])
        self.articles: list[Article] = []
        self.pages = {(ROOT / "README.md").resolve(): "about.html"}

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
                self.articles.append(Article(source, destination, title, published,
                                             language, category, listing, body))
        self.articles.sort(key=lambda article: (article.published, article.destination), reverse=True)

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

    def document(self, title: str, body: str, destination: str, language="zh-CN", active="", description="") -> str:
        description = description or self.config["description"]
        nav = []
        for label, target in [("首页", "index.html"), ("中文文章", "chinese.html"),
                              ("English", "english.html"), ("关于我", "about.html")]:
            current = ' aria-current="page"' if target == active else ""
            nav.append(f'<a href="{escape(self.href(target))}"{current}>{label}</a>')
        return f'''<!doctype html>
<html lang="{language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)} · {escape(self.config['title'])}</title>
  <meta name="description" content="{escape(description)}">
  <meta name="author" content="{escape(self.config['author'])}">
  <link rel="canonical" href="{escape(self.canonical(destination))}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{escape(title)}">
  <meta property="og:description" content="{escape(description)}">
  <meta property="og:url" content="{escape(self.canonical(destination))}">
  <link rel="stylesheet" href="{escape(self.href('assets/style.css'))}">
</head>
<body>
  <a class="skip-link" href="#main">跳转到正文 / Skip to content</a>
  <header class="site-header container">
    <a class="brand" href="{escape(self.href('index.html'))}">{escape(self.config['title'])}<small>Xie Yuqing · Carl</small></a>
    <nav class="site-nav" aria-label="导航 / Navigation">{''.join(nav)}</nav>
  </header>
  <main id="main" class="container">{body}</main>
  <footer class="site-footer container">
    <span>© {date.today().year} {escape(self.config['author'])}</span>
    <a href="{escape(self.config['repository_url'])}">GitHub</a>
  </footer>
</body>
</html>
'''

    def excerpt(self, article: Article) -> str:
        tokens = self.parser.parse(article.markdown)
        for index, token in enumerate(tokens):
            if token.type == "paragraph_open" and tokens[index + 1].type == "inline":
                content = plain_inline(tokens[index + 1])
                if content:
                    return content[:150] + ("…" if len(content) > 150 else "")
        return ""

    def listing(self, articles: list[Article]) -> str:
        cards = []
        for article in articles:
            cards.append(f'''<li class="article-card">
<p class="article-meta"><time datetime="{article.published}">{article.published}</time> · {article.category}</p>
<h2 class="article-title"><a href="{escape(self.href(article.destination))}" lang="{article.language}">{escape(article.title)}</a></h2>
<p class="article-excerpt" lang="{article.language}">{escape(self.excerpt(article))}</p>
</li>''')
        return '<ul class="article-list">' + "\n".join(cards) + '</ul>' if cards else '<p class="empty-state">文章即将更新。</p>'

    def write(self, destination: str, html: str):
        target = OUTPUT / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html, encoding="utf-8")

    def build(self):
        self.collect()
        # Only remove this generator's own output, after checking its exact path.
        if OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT.resolve() / "_site":
            raise ValueError("Unsafe generated output path.")
        if OUTPUT.exists():
            if not (OUTPUT / ".generated-by-blog").is_file():
                raise ValueError("_site already exists without this generator's marker; keep it intact.")
            shutil.rmtree(OUTPUT)
        OUTPUT.mkdir()
        (OUTPUT / ".generated-by-blog").write_text("Generated website only.\n", encoding="utf-8")
        (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
        (OUTPUT / "assets").mkdir()
        shutil.copy2(ROOT / "blog/style.css", OUTPUT / "assets/style.css")
        shutil.copy2(ROOT / "blog/wechat-copy.js", OUTPUT / "assets/wechat-copy.js")
        for folder in ASSETS:
            for source in sorted((ROOT / folder).rglob("*")):
                relative = source.relative_to(ROOT)
                if any(part.startswith(".") for part in relative.parts):
                    continue
                if source.is_symlink():
                    raise ValueError(f"Asset symlinks are not supported: {relative}")
                if source.is_file():
                    target = OUTPUT / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)
        intro = f'''<section class="intro"><p class="eyebrow">XIE YUQING · CARL</p>
<h1>生活、学习与思考</h1><p>{escape(self.config['description'])}</p>
<p lang="en">{escape(self.config['english_description'])}</p></section>
<h2 class="section-heading">最近文章 <small>Latest writing</small></h2>'''
        self.write("index.html", self.document("首页", intro + self.listing(self.articles), "index.html", active="index.html"))
        for folder, (language, category, destination) in FOLDERS.items():
            entries = [article for article in self.articles if article.category == category]
            heading = f'<section class="intro"><h1>{category}</h1><p>{len(entries)} 篇文章</p></section>'
            self.write(destination, self.document(category, heading + self.listing(entries), destination, active=destination))
        about = '<article class="article-body">' + self.render((ROOT / "README.md").read_text(encoding="utf-8-sig"), ROOT / "README.md") + '</article>'
        self.write("about.html", self.document("关于我", about, "about.html", active="about.html"))
        for article in self.articles:
            body = f'''<article><header class="article-header">
<a class="back-link" href="{escape(self.href(article.listing))}">← {article.category}</a>
<p class="article-meta"><time datetime="{article.published}">{article.published}</time> · {escape(self.config['author'])}</p>
<h1>{escape(article.title)}</h1></header>
<aside class="wechat-tools" aria-label="公众号排版">
<button type="button" id="wechat-copy">复制到公众号</button>
<p id="wechat-copy-status" role="status" aria-live="polite">复制正文和图片；标题在公众号单独填写。</p>
<details class="wechat-preview"><summary>公众号排版预览</summary>
<div id="wechat-copy-content">{self.wechat_content(article)}</div></details>
</aside>
<div class="article-body">{self.render(article.markdown, article.source)}</div></article>
<script src="{escape(self.href('assets/wechat-copy.js'))}" defer></script>'''
            self.write(article.destination, self.document(article.title, body, article.destination, article.language, article.listing, self.excerpt(article)))
        sitemap = Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
        for destination in ["index.html", "chinese.html", "english.html", "about.html", *[a.destination for a in self.articles]]:
            SubElement(SubElement(sitemap, "url"), "loc").text = self.canonical(destination)
        (OUTPUT / "sitemap.xml").write_bytes(tostring(sitemap, encoding="utf-8", xml_declaration=True))
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

        checked = images = 0
        for source in OUTPUT.rglob("*.html"):
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
                if not parsed.path.startswith(self.base_path):
                    raise ValueError(f"Link misses site base path: {url}")
                target = (OUTPUT / unquote(parsed.path[len(self.base_path):])).resolve()
                if not target.is_relative_to(OUTPUT) or not target.is_file():
                    raise ValueError(f"Broken generated link in {source.relative_to(OUTPUT)}: {url}")
                checked += 1
        print(f"Built {len(self.articles)} articles; checked {checked} local links and {images} image references.")


if __name__ == "__main__":
    settings = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--site-url", default=settings["site_url"])
    Blog(arguments.parse_args().site_url).build()
