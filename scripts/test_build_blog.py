"""Regression checks for Markdown rendering, without writing a generated site."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))

from build_blog import Article, Blog  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
