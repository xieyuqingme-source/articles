"""Regression checks for Markdown rendering, without writing a generated site."""

from collections import Counter
from contextlib import redirect_stdout
from html.parser import HTMLParser
from io import StringIO
from pathlib import Path
import sys
import json
import struct
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch
import unittest
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))

from build_blog import Article, Blog, read_waline_config  # noqa: E402

class Elements(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.elements = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

class MarkdownRenderingTests(unittest.TestCase):
    def setUp(self):
        self.blog = Blog("https://example.com/articles")
        self.source = ROOT / "中文文章" / "2026-01-01-测试.md"
        self.reference_url = "https://www.ebsco.com/research-starters/history/longqing/"
        self.definition = (
            "[^明表R04]: [www.ebsco.com：嘉靖末年与公历跨年相关资料]"
            f"({self.reference_url})。"
        )

    def test_chinese_footnote_keeps_external_link_and_punctuation(self):
        html = self.blog.render("日期说明。[^明表R04]\n\n" + self.definition, self.source)
        elements = Elements(html).elements
        self.assertTrue(any(tag == "a" and attrs.get("href") == self.reference_url
                            for tag, attrs in elements))
        self.assertIn("嘉靖末年与公历跨年相关资料</a>。", html)
        self.assertNotIn("%5Bwww.ebsco.com", html)

    def test_repeated_footnotes_have_valid_targets_and_return_links(self):
        html = self.blog.render("第一次[^明表R04]，第二次[^明表R04]。\n\n" + self.definition,
                                self.source)
        elements = Elements(html).elements
        ids = {attrs["id"] for _, attrs in elements if "id" in attrs}
        targets = [attrs["href"][1:] for tag, attrs in elements
                   if tag == "a" and attrs.get("href", "").startswith("#")]
        self.assertEqual(len(targets), 4, "Two references need two return links.")
        self.assertEqual(sorted(Counter(targets).values()), [1, 1, 2])
        self.assertTrue(set(targets).issubset(ids), "Every footnote link must reach an element.")

    def test_table_breaks_render_while_code_and_unsafe_html_stay_literal(self):
        markdown = (
            "| 事件 |\n| --- |\n| A<br>B<br/>C<br />D |\n\n"
            "`<br>`\n\n```html\n<br/>\n```\n\n"
            "<script>alert(1)</script>\n\n"
            '<img src="x" onerror="alert(1)">\n\n'
            '<br onmouseover="alert(1)">\n'
        )
        html = self.blog.render(markdown, self.source)
        elements = Elements(html).elements
        tags = Counter(tag for tag, _ in elements)
        self.assertEqual(tags["table"], 1)
        self.assertEqual(tags["br"], 3)
        self.assertEqual(tags["code"], 2)
        self.assertEqual(tags["script"], 0)
        self.assertEqual(tags["img"], 0)
        self.assertTrue(all(not attrs for tag, attrs in elements if tag == "br"))
        self.assertIn("&lt;br&gt;", html)
        self.assertIn("&lt;br/&gt;", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("&lt;br onmouseover=", html)

    def test_missing_image_still_stops_rendering(self):
        markdown = "![缺失图片](../images/regression-missing-34f9b51c.png)"
        with self.assertRaisesRegex(ValueError, "Missing or outside-repository link"):
            self.blog.render(markdown, self.source)

    def test_article_directory_targets_repeated_and_formatted_headings(self):
        rendered = self.blog.render("## 重复标题\n\n## 重复标题\n\n### *细节* & 方法\n", self.source)
        headings = [attrs["id"] for tag, attrs in Elements(rendered).elements
                    if tag in {"h2", "h3"}]
        directory = self.blog.toc(rendered)
        targets = [attrs["href"][1:] for tag, attrs in Elements(directory).elements
                   if tag == "a" and attrs.get("href", "").startswith("#")
                   and attrs["href"] != "#top"]
        self.assertEqual(targets, headings)
        self.assertEqual(len(set(headings)), 3)
        self.assertIn("细节 &amp; 方法", directory)

    def test_search_metadata_and_article_titles_cannot_inject_html(self):
        article = Article(self.source, "中文文章/2026-01-01-测试.html",
                          '<script>alert("x")</script>', "2026-01-01", "zh-CN",
                          "中文文章", "chinese.html", '正文含有 " 引号和 <img src=x>。')
        listing = self.blog.archive([article])
        elements = Elements(listing).elements
        self.assertFalse(any(tag in {"script", "img"} for tag, _ in elements))
        searchable = [attrs["data-search"] for _, attrs in elements if "data-search" in attrs]
        self.assertEqual(len(searchable), 1)
        self.assertIn(article.title, searchable[0])
        self.assertIn('" 引号', searchable[0])

    def test_publication_preserves_month_precision_and_marks_unknown(self):
        article = Article(self.source, "中文文章/example.html", "测试", "2024-09",
                          "zh-CN", "中文文章", "chinese.html", "正文")
        self.assertIn('datetime="2024-09"', self.blog.publication(article))
        self.assertNotIn("2024-09-01", self.blog.publication(article))
        article.published = ""
        self.assertIn("发表时间待确认", self.blog.publication(article))
        self.assertNotIn("datetime", self.blog.publication(article))

    def test_verified_date_override_does_not_change_old_article_url(self):
        source = ROOT / "中文文章/2026-10-04-快乐的马来西亚中学生.md"
        destination = source.relative_to(ROOT).with_suffix(".html").as_posix()
        self.blog.publication_dates[source.relative_to(ROOT).as_posix()] = {"date": "2024-09-01"}
        self.blog.collect()
        article = next(a for a in self.blog.articles if a.source == source)
        self.assertEqual(article.published, "2024-09-01")
        self.assertEqual(article.destination, destination)

    def test_archive_contains_original_year_choices_and_pagination(self):
        articles = [Article(self.source, "中文文章/example.html", "测试", day,
                            "zh-CN", "中文文章", "chinese.html", "正文")
                    for day in ["2024-09-01", "2026-10-01", ""]]
        elements = Elements(self.blog.archive(articles)).elements
        years = [attrs["value"] for tag, attrs in elements if tag == "option"]
        self.assertEqual(years, ["all", "2026", "2024", "unknown"])
        self.assertTrue(any(tag == "nav" and attrs.get("aria-label") == "文章分页"
                            for tag, attrs in elements))
        self.assertEqual([attrs["data-year"] for _, attrs in elements if "data-year" in attrs],
                         ["2024", "2026", ""])

    def test_page_jump_has_keyboard_form_and_accessible_feedback(self):
        elements = Elements(self.blog.archive([])).elements
        self.assertTrue(any(tag == "form" and attrs.get("class") == "page-jump"
                            and "novalidate" in attrs for tag, attrs in elements))
        self.assertTrue(any(tag == "label" and attrs.get("for") == "article-page"
                            for tag, attrs in elements))
        field = next(attrs for tag, attrs in elements
                     if tag == "input" and attrs.get("id") == "article-page")
        self.assertEqual(field["inputmode"], "numeric")
        self.assertEqual(field["aria-describedby"], "page-jump-message")
        self.assertTrue(any(tag == "button" and attrs.get("type") == "submit"
                            for tag, attrs in elements))
        self.assertTrue(any(attrs.get("id") == "page-jump-message"
                            and attrs.get("role") == "status" for _, attrs in elements))

    def test_waline_disabled_generates_no_widget_stats_or_client(self):
        self.blog.waline = {"enabled": False}
        article = Article(self.source, "中文文章/测试.html", "测试", "2026-01-01",
                          "zh-CN", "中文文章", "chinese.html", "正文")
        self.assertEqual(self.blog.metrics(article), "")
        self.assertEqual(self.blog.comments(article), "")
        self.assertEqual(self.blog.waline_head(article.destination), "")
        self.assertNotIn("data-stats-path", self.blog.archive([article]))

    def test_waline_requires_backend_verification_and_provider_names(self):
        path = Mock()
        path.is_file.return_value = True
        for config in [{"enabled": True, "serverURL": ""},
                           {"enabled": True, "serverURL": "https://example.com"},
                           {"enabled": True, "serverURL": "https://comments.test", "backendVerified": False},
                           {"enabled": True, "serverURL": "https://user:password@comments.test",
                            "backendVerified": True, "hostingProvider": "Host", "databaseProvider": "DB"}]:
            path.read_text.return_value = json.dumps(config)
            with self.assertRaises(ValueError):
                read_waline_config(path)
        path.read_text.return_value = '{"enabled": false, "serverURL": ""}'
        self.assertEqual(read_waline_config(path), {"enabled": False})
        path.read_text.return_value = json.dumps({"enabled": True, "serverURL": "https://comments.test",
                                                "backendVerified": True, "hostingProvider": "Host",
                                                "databaseProvider": "DB", "unexpected_private_option": "secret"})
        self.assertNotIn("unexpected_private_option", read_waline_config(path))

    def test_waline_article_and_list_identifiers_match_and_start_hidden(self):
        self.blog.waline = {"enabled": True, "serverURL": "https://comments.test",
                            "backendVerified": True, "hostingProvider": "Host", "databaseProvider": "DB"}
        article = Article(self.source, "中文文章/2026-01-01-中文 标题.html", "测试", "2026-01-01",
                          "zh-CN", "中文文章", "chinese.html", "正文")
        metric = Elements(self.blog.metrics(article)).elements
        widget = Elements(self.blog.comments(article)).elements
        metric_path = next(a["data-stats-path"] for _, a in metric if "data-stats-path" in a)
        widget_path = next(a["data-article-path"] for _, a in widget if "data-article-path" in a)
        self.assertEqual(metric_path, widget_path)
        self.assertEqual(unquote(metric_path), "/articles/" + article.destination)
        self.assertTrue(all("hidden" in a for _, a in metric if "data-counter" in a))
        self.assertTrue(any(a.get("id") == "article-comments" and "hidden" in a for _, a in widget))
        self.assertNotIn(">0<", self.blog.metrics(article))

    def test_waline_public_settings_cannot_break_out_of_json_script(self):
        self.blog.waline = {"enabled": True, "serverURL": "https://comments.test",
                            "backendVerified": True, "hostingProvider": "</script><script>alert(1)</script>",
                            "databaseProvider": "DB"}
        html = self.blog.waline_head("index.html")
        self.assertNotIn("<script>alert(1)", html)
        self.assertIn('"siteOrigin": "https://example.com"', html)
        self.assertEqual(self.blog.waline_head("about.html"), "")

    def test_projects_navigation_uses_exact_site_root(self):
        page = self.blog.document("Example", "<p>Body</p>", "example.html", "en")
        links = [attrs for tag, attrs in Elements(page).elements if tag == "a"]
        self.assertEqual(sum(attrs.get("href") == "/projects/" for attrs in links), 1)
        self.assertNotIn("/articles/projects/", page)
        self.assertTrue(any(attrs.get("href") == "/articles/english.html"
                            and attrs.get("lang") == "en" for attrs in links))

    def test_about_navigation_uses_root_route_without_article_prefix(self):
        page = self.blog.document("Example", "<p>Body</p>", "example.html", "en")
        links = [attrs for tag, attrs in Elements(page).elements if tag == "a"]
        self.assertEqual(sum(attrs.get("href") == "/about/" for attrs in links), 1)
        self.assertNotIn('/articles/about.html', page)
        self.assertNotIn('/articles/about/', page)

    def test_readme_link_rewrites_to_about_without_repository_fragment(self):
        self.assertEqual(self.blog.rewrite("../README.md?from=article#文件说明--folder-guide",
                                          self.source), "/about/?from=article")

    def test_legacy_about_is_noindex_root_redirect_without_readme_content(self):
        page = self.blog.about_redirect()
        elements = Elements(page).elements
        canonical = next(attrs["href"] for tag, attrs in elements
                         if tag == "link" and attrs.get("rel") == "canonical")
        self.assertEqual(canonical, "https://example.com/about/")
        self.assertTrue(any(tag == "meta" and attrs.get("name") == "robots"
                            and attrs.get("content") == "noindex,follow" for tag, attrs in elements))
        self.assertTrue(any(tag == "meta" and attrs.get("http-equiv") == "refresh"
                            and attrs.get("content") == "0; url=/about/" for tag, attrs in elements))
        self.assertTrue(any(tag == "a" and attrs.get("href") == "/about/" for tag, attrs in elements))
        self.assertNotIn("Folder Guide", page)
        self.assertNotIn("文件说明", page)
        self.assertNotIn("mailto:", page)

    def test_legacy_about_canonical_uses_current_origin(self):
        self.blog.site_url = "https://xieyuqing.me/articles"
        self.assertIn('href="https://xieyuqing.me/about/"', self.blog.about_redirect())
        self.assertIn('content="https://xieyuqing.me/about/"', self.blog.about_redirect())

    def test_toc_without_headings_has_no_empty_sidebar(self):
        self.assertEqual(self.blog.toc("<p>A short article.</p>"), "")

    def test_toc_keeps_native_details_and_accessible_control_targets(self):
        rendered = self.blog.render("## English heading\n\nText", self.source)
        markup = self.blog.toc(rendered, "en")
        elements = Elements(markup).elements
        self.assertTrue(any(tag == "details" and "open" in attrs for tag, attrs in elements))
        self.assertTrue(any(tag == "summary" and attrs.get("aria-controls") == "article-toc-links"
                            and attrs.get("aria-expanded") == "true" for tag, attrs in elements))
        self.assertTrue(any(tag == "nav" and attrs.get("id") == "article-toc-links"
                            for tag, attrs in elements))
        controls = Elements(self.blog.toc_controls()).elements
        self.assertTrue(any(attrs.get("class") == "toc-controls" and "hidden" in attrs
                            for _, attrs in controls))
        buttons = [attrs for tag, attrs in controls if tag == "button"]
        self.assertEqual([attrs["data-toc-position"] for attrs in buttons], ["left", "right", "hidden"])
        self.assertEqual([attrs["aria-pressed"] for attrs in buttons], ["false", "true", "false"])
        self.assertTrue(all(attrs["aria-controls"] == "article-toc" for attrs in buttons))

    def _fixture_build(self, waline=None):
        """Build only two synthetic articles, retaining no private input or full site."""
        with TemporaryDirectory(prefix=".blog-test-", dir=ROOT) as temporary:
            root = Path(temporary)
            (root / "blog").mkdir()
            (root / "blog/style.css").write_text("body{}", encoding="utf-8")
            (root / "blog/site.js").write_text("", encoding="utf-8")
            (root / "blog/comment-avatar.svg").write_text("<svg/>", encoding="utf-8")
            self.blog.output = root / "_site"
            (self.blog.output / "assets").mkdir(parents=True)
            (self.blog.output / ".generated-by-blog").write_text("fixture", encoding="utf-8")
            (self.blog.output / "assets/wechat-copy.js").write_text("obsolete", encoding="utf-8")
            self.blog.waline = {"enabled": False} if waline is None else waline
            self.blog.articles = [
                Article(root / "English Articles/long.md", "English Articles/long.html", "Long",
                        "2026-01-02", "en", "English Articles", "english.html", "## Heading\n\nBody"),
                Article(root / "中文文章/short.md", "中文文章/short.html", "Short",
                        "2026-01-01", "zh-CN", "中文文章", "chinese.html", "Short body."),
            ]
            self.blog.collect = Mock()
            self.blog.responsive_images.prepare = Mock()
            with patch("build_blog.ROOT", root), redirect_stdout(StringIO()):
                # There is deliberately no README: publishing never reads it.
                self.blog.build(clean=False)
            pages = {path.relative_to(self.blog.output).as_posix(): path.read_text(encoding="utf-8")
                     for path in self.blog.output.rglob("*.html")}
            return {"pages": pages, "sitemap": (self.blog.output / "sitemap.xml").read_text(encoding="utf-8"),
                    "feed": (self.blog.output / "feed.xml").read_text(encoding="utf-8"),
                    "obsolete_asset_exists": (self.blog.output / "assets/wechat-copy.js").exists(),
                    "avatar": (self.blog.output / "assets/comment-avatar.svg").read_text(encoding="utf-8"),
                    "asset_paths": {path.relative_to(self.blog.output).as_posix()
                                    for path in (self.blog.output / "assets").rglob("*") if path.is_file()},
                    "waline_assets_exist": any((self.blog.output / "assets" / name).exists()
                                               for name in ("waline-integration.js", "waline-integration.css", "waline"))}

    def test_build_drops_copy_ui_asset_and_legacy_about_sitemap_entry(self):
        result = self._fixture_build()
        self.assertFalse(result["obsolete_asset_exists"])
        self.assertNotIn("about.html", result["sitemap"])
        self.assertIn("English%20Articles/long.html", result["sitemap"])
        self.assertEqual(result["feed"].count("<item>"), 2)
        for page in result["pages"].values():
            for removed in ("wechat-copy", "wechat-preview", "wechat-tools", "复制到公众号", "Folder Guide"):
                self.assertNotIn(removed, page)
        self.assertIn('href="/about/"', result["pages"]["index.html"])

    def test_disabled_build_publishes_avatar_without_waline_code_or_requests(self):
        public_settings = json.loads((ROOT / "blog/waline.json").read_text(encoding="utf-8"))
        # A disabled fixture remains valid even after an authorized future launch.
        result = self._fixture_build(waline={**public_settings, "enabled": False, "backendVerified": False})
        self.assertEqual(result["avatar"], "<svg/>")
        self.assertFalse(result["waline_assets_exist"])
        for page in result["pages"].values():
            for marker in ("waline-settings", "waline-integration", "data-stats-path", "article-comments"):
                self.assertNotIn(marker, page)

    def test_staged_live_backend_build_keeps_assets_and_article_identity(self):
        public_settings = json.loads((ROOT / "blog/waline.json").read_text(encoding="utf-8"))
        staged = {**public_settings, "enabled": True, "backendVerified": True}
        config_file = Mock()
        config_file.is_file.return_value = True
        config_file.read_text.return_value = json.dumps(staged)
        staged = read_waline_config(config_file)
        self.blog = Blog("https://xieyuqing.me/articles")
        # Enable only the in-memory fixture, writing two synthetic articles in a temporary root.
        result = self._fixture_build(waline=staged)
        self.assertTrue({"assets/waline-integration.js", "assets/waline-integration.css",
                         "assets/waline/waline.js", "assets/waline/waline.css", "assets/waline/LICENSE"}
                        .issubset(result["asset_paths"]))
        for destination in ("index.html", "chinese.html", "english.html", "中文文章/short.html"):
            page = result["pages"][destination]
            settings = json.loads(page.split('id="waline-settings">', 1)[1].split("</script>", 1)[0])
            self.assertEqual(settings["serverURL"], public_settings["serverURL"])
            self.assertEqual(settings["hostingProvider"], public_settings["hostingProvider"])
            self.assertEqual(settings["databaseProvider"], public_settings["databaseProvider"])
            self.assertEqual(settings["siteOrigin"], "https://xieyuqing.me")
            self.assertEqual(settings["clientJS"], "/articles/assets/waline/waline.js")
            self.assertEqual(settings["clientCSS"], "/articles/assets/waline/waline.css")
            self.assertIs(settings["enabled"], True)
            self.assertIs(settings["backendVerified"], True)
            self.assertNotIn("审核通过后显示", page)
        article = Elements(result["pages"]["中文文章/short.html"]).elements
        widget_path = next(attrs["data-article-path"] for _, attrs in article
                           if attrs.get("id") == "article-comments")
        self.assertEqual(unquote(widget_path), "/articles/中文文章/short.html")
        self.assertTrue(any(attrs.get("data-stats-path") == widget_path for _, attrs in article))
        listing = Elements(result["pages"]["index.html"]).elements
        self.assertTrue(any(attrs.get("data-stats-path") == widget_path for _, attrs in listing))
        self.assertNotIn("waline-settings", result["pages"]["about.html"])

    def test_build_shows_toc_controls_only_for_articles_with_headings(self):
        result = self._fixture_build()
        long = result["pages"]["English Articles/long.html"]
        short = result["pages"]["中文文章/short.html"]
        self.assertIn('class="toc-controls"', long)
        self.assertIn('data-toc-position="right"', long)
        self.assertIn('id="article-toc"', long)
        self.assertNotIn('class="toc-controls"', short)
        self.assertNotIn('id="article-toc"', short)
        self.assertIn('class="reading-layout reading-layout-no-toc"', short)

    def test_english_document_marks_chinese_interface_and_keeps_body_language(self):
        page = self.blog.document("Example", "<p>English body</p>", "example.html", "en")
        elements = Elements(page).elements
        self.assertTrue(any(tag == "html" and attrs.get("lang") == "en" for tag, attrs in elements))
        for tag, css_class in (("header", "site-header container"), ("footer", "site-footer container")):
            self.assertTrue(any(element == tag and attrs.get("class") == css_class
                                and attrs.get("lang") == "zh-CN" for element, attrs in elements))
        self.assertTrue(any(tag == "small" and attrs.get("lang") == "en" for tag, attrs in elements))
        headings = self.blog.toc(self.blog.render("## English heading", self.source), "en")
        self.assertTrue(any(tag == "a" and attrs.get("href") == "#english-heading"
                            and attrs.get("lang") == "en" for tag, attrs in Elements(headings).elements))

    def test_webp_dimensions_support_extended_lossy_and_lossless_headers(self):
        width, height = 640, 361
        headers = {
            "VP8X": b"RIFF" + b"\x00" * 4 + b"WEBPVP8X" + struct.pack("<I", 10)
                    + b"\x00" * 4 + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little"),
            "VP8": b"RIFF" + b"\x00" * 4 + b"WEBPVP8 " + struct.pack("<I", 10)
                   + b"\x00" * 3 + b"\x9d\x01\x2a" + struct.pack("<HH", width, height),
            "VP8L": b"RIFF" + b"\x00" * 4 + b"WEBPVP8L" + struct.pack("<I", 5)
                    + b"\x2f" + ((width - 1) | ((height - 1) << 14)).to_bytes(4, "little"),
        }
        with TemporaryDirectory(prefix=".blog-test-", dir=ROOT) as temporary:
            root = Path(temporary)
            (root / "images").mkdir()
            with patch("build_blog.ROOT", root):
                for name, header in headers.items():
                    (root / "images" / (name + ".webp")).write_bytes(header)
                    self.assertEqual(self.blog.image_dimensions("/articles/images/" + name + ".webp"),
                                     (width, height), name)
                (root / "images" / "truncated.webp").write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8L")
                self.assertIsNone(self.blog.image_dimensions("/articles/images/truncated.webp"))

    def test_existing_webp_images_receive_dimensions_without_changing_files(self):
        images = list((ROOT / "images").glob("*.webp"))
        self.assertTrue(images, "The public image regression set must include WebP files.")
        for image in images:
            before = image.read_bytes()
            rendered = self.blog.render(f"![Image](../images/{image.name})", self.source)
            attrs = next(attrs for tag, attrs in Elements(rendered).elements if tag == "img")
            self.assertGreater(int(attrs["width"]), 0, image.name)
            self.assertGreater(int(attrs["height"]), 0, image.name)
            self.assertEqual(image.read_bytes(), before, image.name)

    def test_responsive_article_images_keep_srcset_and_lazy_loading(self):
        image = next(path for path in sorted((ROOT / "images").iterdir())
                     if path.is_file() and path.suffix.lower() in {".png", ".jpg"})
        original_url = self.blog.href("images/" + image.name)
        derived = {"src": "/articles/assets/responsive-images/example-960.webp",
                   "srcset": "/articles/assets/responsive-images/example-960.webp 960w, /articles/assets/responsive-images/example-1920.webp 1920w",
                   "sizes": "(max-width: 760px) calc(100vw - 40px), 760px",
                   "width": "960", "height": "540", "data-original-src": original_url,
                   "data-original-width": "4000", "data-original-height": "2250"}
        self.blog.responsive_images.attributes = Mock(return_value=derived)
        article = Article(self.source, "中文文章/example.html", "示例", "2026-01-01", "zh-CN",
                          "中文文章", "chinese.html", f"![Image](../images/{image.name})")
        rendered = self.blog.render(article.markdown, self.source)
        attrs = next(attrs for tag, attrs in Elements(rendered).elements if tag == "img")
        self.assertEqual(attrs["src"], derived["src"])
        self.assertEqual(attrs["loading"], "lazy")
        self.assertEqual(attrs["srcset"], derived["srcset"])

    def test_render_does_not_modify_original_markdown(self):
        source = next((ROOT / "中文文章").rglob("*.md"))
        before = source.read_bytes()
        article = Article(source, "中文文章/example.html", "示例", "2026-01-01", "zh-CN",
                          "中文文章", "chinese.html", source.read_text(encoding="utf-8-sig"))
        self.blog.collect()
        self.blog.render(article.markdown, source)
        self.assertEqual(source.read_bytes(), before)

    def test_article_check_exempts_only_declared_root_destinations(self):
        with TemporaryDirectory(prefix=".blog-test-", dir=ROOT) as temporary:
            self.blog.output = Path(temporary)
            page = self.blog.output / "index.html"
            page.write_text('<a href="/">Home</a><a href="/projects/">Projects</a><a href="/about/">About</a>', encoding="utf-8")
            with redirect_stdout(StringIO()):
                self.blog.check()
            page.write_text('<a href="/arbitrary/">Missing</a>', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Link misses site base path"):
                self.blog.check()

if __name__ == "__main__":
    unittest.main()
