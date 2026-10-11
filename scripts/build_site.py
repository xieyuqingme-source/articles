"""Build the personal home and /articles/ into one Pages publication directory."""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit
from xml.etree import ElementTree as ET
import argparse
import json
import shutil

from build_blog import Blog, ROOT

OUTPUT = ROOT / "_site_unified"


def site_root(address):
    parts = urlsplit(address)
    if (parts.scheme != "https" or not parts.netloc or parts.path not in {"", "/"}
            or parts.query or parts.fragment or parts.username or parts.password):
        raise ValueError("Unified Pages needs a root HTTPS URL; a project /articles base would duplicate the path.")
    return urlunsplit((parts.scheme, parts.netloc, "", "", ""))


def default_root():
    config = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
    parts = urlsplit(config["site_url"])
    return site_root(urlunsplit((parts.scheme, parts.netloc, "", "", "")))


class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__(); self.elements = []; self.feed(text)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))


def check_site(address):
    address = site_root(address)
    pages = {p.resolve(): Elements(p.read_text(encoding="utf-8")) for p in OUTPUT.rglob("*.html")}
    links = fragments = images = 0
    for p, page in pages.items():
        ids = [a["id"] for _, a in page.elements if "id" in a]
        if len(ids) != len(set(ids)):
            raise ValueError(f"Duplicate IDs: {p}")
        for tag, attrs in page.elements:
            images += tag == "img"
            for key in ("href", "src"):
                if not attrs.get(key): continue
                parsed = urlsplit(attrs[key])
                if parsed.netloc and parsed.netloc != urlsplit(address).netloc: continue
                if parsed.scheme and parsed.scheme not in {"http", "https"}: continue
                if "/articles/articles/" in parsed.path:
                    raise ValueError(f"Duplicated article prefix: {attrs[key]}")
                target = (OUTPUT / unquote(parsed.path).lstrip("/")).resolve() if parsed.path.startswith("/") else (p.parent / unquote(parsed.path)).resolve() if parsed.path else p
                if target.is_dir(): target /= "index.html"
                if not target.is_relative_to(OUTPUT.resolve()) or not target.is_file():
                    raise ValueError(f"Broken or outside-publication link in {p}: {attrs[key]}")
                links += 1
                if parsed.fragment and target.suffix == ".html":
                    targets = {a["id"] for _, a in pages[target.resolve()].elements if "id" in a}
                    if unquote(parsed.fragment) not in targets:
                        raise ValueError(f"Missing anchor in {p}: {attrs[key]}")
                    fragments += 1
    return {"success": True, "pages": len(pages), "local_links": links,
            "valid_fragments": fragments, "image_references": images,
            "site_root": address + "/", "article_root": address + "/articles/"}


def build_site(address):
    address = site_root(address)
    if OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT.resolve() / "_site_unified":
        raise ValueError("Unsafe unified output path.")
    if OUTPUT.exists() and any(OUTPUT.iterdir()) and not (OUTPUT / ".generated-by-unified-site").is_file():
        raise ValueError("Keep the existing unrecognized output directory intact.")
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / ".generated-by-unified-site").write_text("Generated unified website.\n", encoding="utf-8")
    blog = Blog(address + "/articles", output=OUTPUT / "articles")
    # Keep the legacy _site and every pre-existing file; CI starts from a clean checkout.
    blog.build(clean=False)
    home = (ROOT / "home/index.template.html").read_text(encoding="utf-8")
    recent = []
    for article in blog.articles[:3]:
        published = (f'<time datetime="{escape(article.published)}">{escape(article.published)}</time>'
                     if article.published else '<time>发表时间待确认</time>')
        topic = blog.topic(article) if article.language == "zh-CN" else "English"
        recent.append(f'        <li><div class="article-meta">{published}<span>{escape(topic)}</span></div><h3 lang="{article.language}"><a href="{escape(blog.href(article.destination))}">{escape(article.title)}<span aria-hidden="true">↗</span></a></h3></li>')
    values = {"article_total": str(len(blog.articles)), "chinese_total": str(sum(a.language == "zh-CN" for a in blog.articles)),
              "english_total": str(sum(a.language != "zh-CN" for a in blog.articles)), "recent_articles": "\n".join(recent), "site_url": address}
    for name, value in values.items(): home = home.replace("{{" + name + "}}", value)
    if "{{" in home: raise ValueError("Unresolved home template placeholder.")
    (OUTPUT / "index.html").write_text(home, encoding="utf-8")
    (OUTPUT / "assets").mkdir(exist_ok=True)
    for name in ("portal.css", "portal.js"):
        source = ROOT / "home/assets" / name
        if source.is_symlink(): raise ValueError("Home asset symlinks are not supported.")
        shutil.copy2(source, OUTPUT / "assets" / name)
    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
    sitemap = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = address + "/"
    article_sitemap = ET.parse(OUTPUT / "articles/sitemap.xml")
    for loc in article_sitemap.findall(".//{*}loc"):
        ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = loc.text
    (OUTPUT / "sitemap.xml").write_bytes(ET.tostring(sitemap, encoding="utf-8", xml_declaration=True))
    (OUTPUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {address}/sitemap.xml\n", encoding="utf-8")
    report = check_site(address)
    report.update({"articles": len(blog.articles), "publication_directory": "_site_unified", "waline_enabled": blog.waline["enabled"]})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-url", default=default_root())
    args = parser.parse_args()
    print(json.dumps(build_site(args.site_url), ensure_ascii=False, indent=2))
