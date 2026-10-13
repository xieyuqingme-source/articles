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

from build_blog import Article, Blog, WechatContent, read_waline_config  # noqa: E402


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

    def test_wechat_export_has_external_sources_absolute_images_and_white_background(self):
        image = next(path for path in sorted((ROOT / "images").iterdir())
                     if path.is_file() and path.suffix.lower() in {".png", ".jpg"})
        markdown = "正文。[^明表R04]\n\n" + self.definition + f"\n\n![图片](../images/{image.name})"
        article = Article(self.source, "中文文章/2026-01-01-测试.html", "测试", "2026-01-01",
                          "zh-CN", "中文文章", "chinese.html", markdown)
        html = self.blog.wechat_content(article)
        elements = Elements(html).elements
        hrefs = [attrs["href"] for tag, attrs in elements if tag == "a"]
        images = [attrs for tag, attrs in elements if tag == "img"]
        self.assertIn(self.reference_url, hrefs)
        self.assertEqual(len(images), 1)
        self.assertEqual(unquote(images[0]["src"]),
                         "https://example.com/articles/images/" + image.name)
        self.assertNotIn("loading", images[0])
        self.assertTrue(all("background-color:#ffffff" in attrs.get("style", "")
                            for _, attrs in elements))

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

    def test_responsive_article_images_restore_original_sources_in_wechat_copy(self):
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
        copied = self.blog.wechat_content(article)
        original = next(attrs for tag, attrs in Elements(copied).elements if tag == "img")
        self.assertEqual(original["src"], "https://example.com" + original_url)
        self.assertEqual((original["width"], original["height"]), ("4000", "2250"))
        self.assertFalse(set(original) & {"srcset", "sizes", "loading", "decoding"})
        self.assertFalse(any(key.startswith("data-original-") for key in original))

    def test_wechat_restore_does_not_keep_derived_size_when_original_size_is_unknown(self):
        content = WechatContent("https://example.com/articles/example.html")
        content.feed('<img src="/articles/derived.webp" width="960" height="540" '
                     'data-original-src="/articles/original.png" data-original-extra="private">')
        attrs = next(attrs for tag, attrs in Elements("".join(content.parts)).elements if tag == "img")
        self.assertEqual(attrs["src"], "https://example.com/articles/original.png")
        self.assertNotIn("width", attrs)
        self.assertNotIn("height", attrs)
        self.assertFalse(any(key.startswith("data-original-") for key in attrs))

    def test_wechat_preview_is_an_inert_template_with_empty_live_container(self):
        image = next(path for path in (ROOT / "images").iterdir()
                     if path.is_file() and path.suffix.lower() in {".png", ".jpg"})
        article = Article(self.source, "中文文章/example.html", "示例", "2026-01-01", "en",
                          "English Articles", "english.html", f"![Image](../images/{image.name})")
        markup = self.blog.wechat_tools(article)
        self.assertIn('<div id="wechat-copy-content"></div>', markup)
        self.assertIn('<template id="wechat-copy-template">', markup)
        self.assertIn('<noscript>', markup)

        class ActiveImages(HTMLParser):
            def __init__(self):
                super().__init__()
                self.template_depth = 0
                self.active_images = self.inert_images = 0

            def handle_starttag(self, tag, attrs):
                if tag == "template":
                    self.template_depth += 1
                elif tag == "img":
                    if self.template_depth:
                        self.inert_images += 1
                    else:
                        self.active_images += 1

            def handle_endtag(self, tag):
                if tag == "template":
                    self.template_depth -= 1

        parser = ActiveImages()
        parser.feed(markup)
        self.assertEqual((parser.active_images, parser.inert_images), (0, 1))
        self.assertTrue(any(tag == "section" and attrs.get("lang") == "en"
                            for tag, attrs in Elements(markup).elements))

    def test_render_and_wechat_do_not_modify_original_markdown(self):
        source = next((ROOT / "中文文章").rglob("*.md"))
        before = source.read_bytes()
        article = Article(source, "中文文章/example.html", "示例", "2026-01-01", "zh-CN",
                          "中文文章", "chinese.html", source.read_text(encoding="utf-8-sig"))
        self.blog.collect()
        self.blog.render(article.markdown, source)
        self.blog.wechat_content(article)
        self.assertEqual(source.read_bytes(), before)

    def test_article_check_exempts_only_declared_root_destinations(self):
        with TemporaryDirectory(prefix=".blog-test-", dir=ROOT) as temporary:
            self.blog.output = Path(temporary)
            page = self.blog.output / "index.html"
            page.write_text('<a href="/">Home</a><a href="/projects/">Projects</a>', encoding="utf-8")
            with redirect_stdout(StringIO()):
                self.blog.check()
            page.write_text('<a href="/arbitrary/">Missing</a>', encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Link misses site base path"):
                self.blog.check()


if __name__ == "__main__":
    unittest.main()
