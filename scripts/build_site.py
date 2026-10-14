"""Build the personal home, /projects/, /about/ and /articles/ into one Pages directory."""
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit
from xml.etree import ElementTree as ET
import argparse
import json
import ipaddress
import re
import shutil

from build_blog import Blog, ROOT

OUTPUT = ROOT / "_site_unified"

PROJECT_FIELDS = {"id", "title", "english_title", "kind", "summary", "problem", "features",
                  "contribution", "usage", "icon", "source_url", "guide_url"}
PROJECT_OPTIONAL_FIELDS = {"download_url"}
ABOUT_FIELDS = {"name", "english_name", "chinese_bio", "english_bio", "wechat", "email"}
PRIVATE_PATH = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]:[\\/]|\\\\[^\s\\]+[\\/]|/(?:Users|home|mnt)/", re.I)
PROJECT_ICONS = {
    "editor": '''<svg viewBox="0 0 360 180" role="presentation" aria-hidden="true" focusable="false">
  <rect x="42" y="24" width="124" height="132" rx="10" class="visual-panel"/>
  <path d="M61 46h46M61 62h82M61 74h70M61 86h77M61 98h68" class="visual-line"/>
  <rect x="61" y="112" width="44" height="25" rx="3" class="visual-image"/>
  <path d="m66 131 11-10 9 7 7-5 8 8" class="visual-line"/>
  <path d="M183 90h22m-7-6 7 6-7 6" class="visual-arrow"/>
  <rect x="222" y="18" width="96" height="144" rx="14" class="visual-panel"/>
  <path d="M255 29h30M237 48h49M237 61h66M237 71h57M237 81h63" class="visual-line"/>
  <rect x="237" y="94" width="66" height="31" rx="3" class="visual-image"/>
  <path d="M237 137h66M237 144h48" class="visual-line"/>
</svg>''',
    "workflow": '''<svg viewBox="0 0 360 180" role="presentation" aria-hidden="true" focusable="false">
  <rect x="25" y="59" width="54" height="62" rx="8" class="visual-panel"/>
  <path d="M38 77h25M38 88h22M38 99h25" class="visual-line"/>
  <path d="M84 90h17m-6-6 6 6-6 6" class="visual-arrow"/>
  <rect x="109" y="63" width="62" height="54" rx="8" class="visual-panel"/>
  <path d="m130 78-9 12 9 12m20-24 9 12-9 12m-6-26-8 28" class="visual-line"/>
  <path d="M177 90h17m-6-6 6 6-6 6" class="visual-arrow"/>
  <rect x="202" y="63" width="62" height="54" rx="8" class="visual-panel"/>
  <path d="M218 78h30M218 90h23M218 102h30" class="visual-line"/>
  <path d="M270 90h17m-6-6 6 6-6 6" class="visual-arrow"/>
  <rect x="295" y="53" width="42" height="74" rx="8" class="visual-panel"/>
  <path d="M305 72h22M305 84h22M305 96h22M305 108h14" class="visual-line"/>
</svg>''',
}


def project_url(value):
    if not isinstance(value, str) or not value or any(c.isspace() for c in value) or "\\" in value:
        raise ValueError("Project links must be public HTTPS URLs.")
    parts = urlsplit(value)
    hostname = parts.hostname
    if (parts.scheme != "https" or not hostname or parts.username or parts.password
            or parts.query or hostname == "localhost"
            or hostname.endswith((".localhost", ".local", ".internal"))):
        raise ValueError("Project links must be public HTTPS URLs without credentials or query tokens.")
    try:
        numeric_address = ipaddress.ip_address(hostname)
    except ValueError:
        numeric_address = None
    if numeric_address is not None and not numeric_address.is_global:
        raise ValueError("Private network links cannot be published as project links.")
    if parts.port not in {None, 443}:
        raise ValueError("Project links must use the standard public HTTPS port.")
    return value


def validate_projects(data):
    if not isinstance(data, dict) or set(data) != {"projects"}:
        raise ValueError("home/projects.json must contain only a projects list.")
    projects = data["projects"]
    if not isinstance(projects, list) or not 1 <= len(projects) <= 100:
        raise ValueError("Keep between 1 and 100 public project entries.")
    seen = set()
    for item in projects:
        if (not isinstance(item, dict) or not PROJECT_FIELDS.issubset(item)
                or set(item) - PROJECT_FIELDS - PROJECT_OPTIONAL_FIELDS):
            raise ValueError("Project fields are incomplete or contain unsupported private metadata.")
        for name, value in item.items():
            if (not isinstance(value, str) or not value.strip() or len(value) > 2000
                    or PRIVATE_PATH.search(value) or any(ord(c) < 32 for c in value)):
                raise ValueError(f"Invalid public project field: {name}.")
        if not re.fullmatch(r"[a-z][a-z0-9-]{1,63}", item["id"]) or item["id"] in seen:
            raise ValueError("Project IDs must be unique lowercase slugs.")
        seen.add(item["id"])
        if item["icon"] not in PROJECT_ICONS:
            raise ValueError("Project visuals must use the built-in editor or workflow icon.")
        for name in ("source_url", "guide_url", "download_url"):
            if name in item:
                project_url(item[name])
    return projects


def load_projects():
    source = ROOT / "home/projects.json"
    if source.is_symlink():
        raise ValueError("Project data symlinks are not supported.")
    return validate_projects(json.loads(source.read_text(encoding="utf-8")))


def validate_about(data):
    if not isinstance(data, dict) or set(data) != ABOUT_FIELDS:
        raise ValueError("home/about.json must contain only the public biography fields.")
    paragraphs = data["chinese_bio"]
    if not isinstance(paragraphs, list) or not 1 <= len(paragraphs) <= 20:
        raise ValueError("The Chinese biography needs a short list of paragraphs.")
    values = [value for key, value in data.items() if key != "chinese_bio"] + paragraphs
    if any(not isinstance(value, str) or not value.strip() or len(value) > 2000
           or PRIVATE_PATH.search(value) or any(ord(c) < 32 for c in value) for value in values):
        raise ValueError("Invalid public biography text.")
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", data["email"]):
        raise ValueError("The contact email must be a plain public email address.")
    return data


def load_about():
    source = ROOT / "home/about.json"
    if source.is_symlink():
        raise ValueError("Biography data symlinks are not supported.")
    return validate_about(json.loads(source.read_text(encoding="utf-8")))


def render_about(data):
    data = validate_about(data)
    text = {key: escape(value, quote=True) for key, value in data.items() if key != "chinese_bio"}
    paragraphs = "\n".join(f'<p>{escape(value, quote=True)}</p>' for value in data["chinese_bio"])
    return f'''<article class="about-profile" aria-labelledby="about-name">
  <h2 class="about-name" id="about-name">{text["name"]}</h2>
  <p class="about-identity" lang="en">{text["english_name"]}</p>
  <div class="about-bio" lang="zh-CN">{paragraphs}</div>
  <section class="about-contact" aria-labelledby="about-contact-title">
    <h2 id="about-contact-title">联系我</h2>
    <dl><dt>微信公众号</dt><dd>{text["wechat"]}</dd><dt>邮箱</dt><dd><a href="mailto:{text["email"]}">{text["email"]}</a></dd></dl>
  </section>
  <section class="about-english" lang="en" aria-labelledby="about-english-title">
    <h2 id="about-english-title">About me</h2><p>{text["english_bio"]}</p>
  </section>
</article>'''


def render_projects(projects):
    projects = validate_projects({"projects": projects})
    cards = []
    for item in projects:
        text = {name: escape(value, quote=True) for name, value in item.items()}
        facts = "".join(f'<div><dt>{label}</dt><dd>{text[name]}</dd></div>' for label, name in (
            ("解决的问题", "problem"), ("主要功能", "features"),
            ("实际贡献", "contribution"), ("使用方式", "usage")))
        download = (f'<a class="project-guide" href="{text["download_url"]}">下载工作流 <span lang="en">Download</span></a>'
                    if "download_url" in text else "")
        cards.append(f'''<article class="project-card" aria-labelledby="project-{text["id"]}">
  <div class="project-visual">{PROJECT_ICONS[item["icon"]]}</div>
  <div class="project-body">
    <p class="project-kind">{text["kind"]}</p>
    <h2 id="project-{text["id"]}">{text["title"]}<span class="project-english" lang="en">{text["english_title"]}</span></h2>
    <p class="project-summary">{text["summary"]}</p>
    <dl class="project-facts">{facts}</dl>
    <div class="project-actions"><a class="project-source" href="{text["source_url"]}">查看 GitHub <span lang="en">Source</span></a><a class="project-guide" href="{text["guide_url"]}">下载与使用说明 <span lang="en">Guide</span></a>{download}</div>
  </div>
</article>''')
    return "\n".join(cards)


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
            references = [attrs[key] for key in ("href", "src") if attrs.get(key)]
            if attrs.get("srcset"):
                for candidate in attrs["srcset"].split(","):
                    match = re.fullmatch(r"\s*(\S+)\s+([1-9]\d*)w\s*", candidate)
                    if not match:
                        raise ValueError(f"Invalid generated image srcset in {p}.")
                    references.append(match.group(1))
            for reference in references:
                parsed = urlsplit(reference)
                if parsed.netloc and parsed.netloc != urlsplit(address).netloc: continue
                if parsed.scheme and parsed.scheme not in {"http", "https"}: continue
                if "/articles/articles/" in parsed.path:
                    raise ValueError(f"Duplicated article prefix: {reference}")
                target = (OUTPUT / unquote(parsed.path).lstrip("/")).resolve() if parsed.path.startswith("/") else (p.parent / unquote(parsed.path)).resolve() if parsed.path else p
                if target.is_dir(): target /= "index.html"
                if not target.is_relative_to(OUTPUT.resolve()) or not target.is_file():
                    raise ValueError(f"Broken or outside-publication link in {p}: {reference}")
                links += 1
                if parsed.fragment and target.suffix == ".html":
                    targets = {a["id"] for _, a in pages[target.resolve()].elements if "id" in a}
                    if unquote(parsed.fragment) not in targets:
                        raise ValueError(f"Missing anchor in {p}: {reference}")
                    fragments += 1
    return {"success": True, "pages": len(pages), "local_links": links,
            "valid_fragments": fragments, "image_references": images,
            "site_root": address + "/", "article_root": address + "/articles/"}


def check_publication_metadata(address):
    """Validate the requested origin and actual targets, rather than skipping foreign canonicals."""
    address = site_root(address)
    expected_origin = urlsplit(address).netloc

    def target_for(url):
        parsed = urlsplit(url or "")
        if (parsed.scheme != "https" or parsed.netloc != expected_origin or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise ValueError(f"Publication metadata must use the requested site domain: {url}")
        target = (OUTPUT / unquote(parsed.path).lstrip("/")).resolve()
        if target.is_dir(): target /= "index.html"
        if not target.is_relative_to(OUTPUT.resolve()) or not target.is_file():
            raise ValueError(f"Metadata target is missing or outside publication: {url}")
        return target

    canonicals = set()
    article_canonicals = set()
    compatibility_redirects = 0
    pages = list(OUTPUT.rglob("*.html"))
    if not pages:
        raise ValueError("Build the unified site before checking publication metadata.")
    for page in pages:
        elements = Elements(page.read_text(encoding="utf-8")).elements
        canonical = [attrs.get("href") for tag, attrs in elements
                     if tag == "link" and attrs.get("rel") == "canonical"]
        og = [attrs.get("content") for tag, attrs in elements
              if tag == "meta" and attrs.get("property") == "og:url"]
        if len(canonical) != 1 or len(og) != 1 or canonical != og:
            raise ValueError(f"Each page needs one matching canonical and OG URL: {page}")
        if page.resolve() == (OUTPUT / "articles/about.html").resolve():
            robots = [attrs.get("content", "").lower().replace(" ", "") for tag, attrs in elements
                      if tag == "meta" and attrs.get("name", "").lower() == "robots"]
            refresh = [attrs.get("content", "") for tag, attrs in elements
                       if tag == "meta" and attrs.get("http-equiv", "").lower() == "refresh"]
            manual = any(tag == "a" and attrs.get("href") == "/about/" for tag, attrs in elements)
            if (canonical[0] != address + "/about/" or target_for(canonical[0]) != (OUTPUT / "about/index.html").resolve()
                    or robots != ["noindex,follow"] or refresh != ["0; url=/about/"] or not manual):
                raise ValueError("The legacy about page must be a noindex redirect to /about/.")
            compatibility_redirects += 1
            continue
        if target_for(canonical[0]) != page.resolve():
            raise ValueError(f"Canonical points to a different page: {page}")
        if canonical[0] in canonicals:
            raise ValueError("Two publication pages claim the same canonical URL.")
        canonicals.add(canonical[0])
        if page.is_relative_to(OUTPUT / "articles"):
            article_canonicals.add(canonical[0])

    def sitemap_urls(path, expected):
        urls = [node.text for node in ET.parse(path).findall(".//{*}loc")]
        if len(urls) != len(set(urls)) or set(urls) != expected:
            raise ValueError(f"Sitemap must contain each generated canonical exactly once: {path}")
        for url in urls: target_for(url)
        return len(urls)

    total = sitemap_urls(OUTPUT / "sitemap.xml", canonicals)
    sitemap_urls(OUTPUT / "articles/sitemap.xml", article_canonicals)
    rss = ET.parse(OUTPUT / "articles/feed.xml")
    if rss.findtext("./channel/link") != address + "/articles/":
        raise ValueError("RSS channel must use the requested article root.")
    seen = set()
    for item in rss.findall("./channel/item"):
        link = item.findtext("link")
        if link != item.findtext("guid") or link not in article_canonicals or link in seen:
            raise ValueError("RSS item links and GUIDs must match unique article canonicals.")
        target_for(link)
        seen.add(link)
    robots = (OUTPUT / "robots.txt").read_text(encoding="utf-8")
    if robots.count("Sitemap: " + address + "/sitemap.xml") != 1:
        raise ValueError("robots.txt must reference the requested root sitemap.")
    report = {"success": True, "canonical_pages": len(canonicals), "sitemap_urls": total,
            "rss_items": len(seen), "domain": expected_origin}
    if compatibility_redirects:
        report["compatibility_redirects"] = compatibility_redirects
    return report


def build_site(address):
    address = site_root(address)
    projects = load_projects()
    about_data = load_about()
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
              "english_total": str(sum(a.language != "zh-CN" for a in blog.articles)), "recent_articles": "\n".join(recent), "site_url": escape(address, quote=True),
              "project_total": str(len(projects))}
    for name, value in values.items(): home = home.replace("{{" + name + "}}", value)
    if "{{" in home: raise ValueError("Unresolved home template placeholder.")
    (OUTPUT / "index.html").write_text(home, encoding="utf-8")
    projects_page = (ROOT / "home/projects.template.html").read_text(encoding="utf-8")
    project_values = {"site_url": escape(address, quote=True), "project_total": str(len(projects)),
                      "project_cards": render_projects(projects)}
    for name, value in project_values.items():
        projects_page = projects_page.replace("{{" + name + "}}", value)
    if "{{" in projects_page:
        raise ValueError("Unresolved projects template placeholder.")
    (OUTPUT / "projects").mkdir(exist_ok=True)
    (OUTPUT / "projects/index.html").write_text(projects_page, encoding="utf-8")
    about_page = (ROOT / "home/about.template.html").read_text(encoding="utf-8")
    for name, value in {"site_url": escape(address, quote=True), "about_content": render_about(about_data)}.items():
        about_page = about_page.replace("{{" + name + "}}", value)
    if "{{" in about_page:
        raise ValueError("Unresolved about template placeholder.")
    (OUTPUT / "about").mkdir(exist_ok=True)
    (OUTPUT / "about/index.html").write_text(about_page, encoding="utf-8")
    (OUTPUT / "assets").mkdir(exist_ok=True)
    for name in ("portal.css", "portal.js"):
        source = ROOT / "home/assets" / name
        if source.is_symlink(): raise ValueError("Home asset symlinks are not supported.")
        shutil.copy2(source, OUTPUT / "assets" / name)
    (OUTPUT / ".nojekyll").write_text("", encoding="utf-8")
    sitemap = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = address + "/"
    ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = address + "/projects/"
    ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = address + "/about/"
    article_sitemap = ET.parse(OUTPUT / "articles/sitemap.xml")
    for loc in article_sitemap.findall(".//{*}loc"):
        ET.SubElement(ET.SubElement(sitemap, "url"), "loc").text = loc.text
    (OUTPUT / "sitemap.xml").write_bytes(ET.tostring(sitemap, encoding="utf-8", xml_declaration=True))
    (OUTPUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {address}/sitemap.xml\n", encoding="utf-8")
    report = check_site(address)
    report["metadata"] = check_publication_metadata(address)
    responsive = getattr(blog, "responsive_images", None)
    if responsive is not None:
        report["responsive_images"] = responsive.report()
    report.update({"articles": len(blog.articles), "projects": len(projects),
                   "publication_directory": "_site_unified", "waline_enabled": blog.waline["enabled"]})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-url", default=default_root())
    args = parser.parse_args()
    print(json.dumps(build_site(args.site_url), ensure_ascii=False, indent=2))
