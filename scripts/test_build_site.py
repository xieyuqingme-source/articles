"""Check unified publication boundaries and link validation without touching source files."""
from pathlib import Path
from copy import deepcopy
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from xml.etree import ElementTree as ET
import json
import re
import shutil
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))
import build_site
from build_site import (site_root, default_root, check_site, Elements, load_projects,
                        validate_projects, render_projects, check_publication_metadata, build_site as publish_site,
                        load_about, validate_about, render_about)


class UnifiedPublicationTests(unittest.TestCase):
    def test_root_url_normalization(self):
        self.assertEqual(site_root("https://xieyuqingme-source.github.io/"),
                         "https://xieyuqingme-source.github.io")
        self.assertEqual(default_root(), "https://xieyuqing.me")

    def test_project_and_unsafe_urls_are_rejected(self):
        for url in ("https://example.com/articles", "http://example.com/",
                    "https://user@example.com/", "https://example.com/?preview=1",
                    "https://example.com/#main", "/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                site_root(url)

    def validate(self, html, target_html=None):
        output = ROOT / "_site_unified"
        page = output / "index.html"
        targets = {page: html}
        if target_html is not None:
            targets[output / "articles/about.html"] = target_html
        with patch.object(Path, "rglob", return_value=list(targets)), \
             patch.object(Path, "read_text", side_effect=lambda **kw: html), \
             patch.object(Path, "is_dir", return_value=False), \
             patch.object(Path, "is_file", side_effect=lambda: True):
            # The parser map has each page's own IDs; no filesystem writes are used.
            with patch("build_site.Elements", side_effect=[Elements(v) for v in targets.values()]):
                return check_site("https://xieyuqingme-source.github.io")

    def test_duplicate_article_prefix_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicated article prefix"):
            self.validate('<a href="/articles/articles/index.html">Wrong</a>')

    def test_fragment_and_encoded_article_link(self):
        result = self.validate('<a href="/articles/about.html#%E4%BB%8B%E7%BB%8D">About</a>',
                               '<h1 id="介绍">About</h1>')
        self.assertEqual(result["valid_fragments"], 1)

    def test_responsive_sources_are_checked(self):
        result = self.validate('<img src="/articles/images/a.webp" '
                               'srcset="/articles/images/a.webp 960w, /articles/images/b.webp 1920w">')
        self.assertEqual(result["local_links"], 3)

    def test_malformed_or_outside_responsive_sources_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "srcset"):
            self.validate('<img srcset="/articles/images/a.webp bad">')
        with self.assertRaisesRegex(ValueError, "outside-publication"):
            self.validate('<img srcset="../../private.webp 960w">')

    def test_missing_fragment_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Missing anchor"):
            self.validate('<a href="#absent">Missing</a>')

    def test_outside_publication_link_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside-publication"):
            self.validate('<a href="../../private.html">Outside</a>')

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate IDs"):
            self.validate('<h1 id="main">Title</h1><div id="main"></div>')


class PublicProjectTests(unittest.TestCase):
    def setUp(self):
        self.projects = load_projects()

    def test_two_verified_projects_have_source_and_usage_links(self):
        self.assertEqual([p["id"] for p in self.projects[:2]],
                         ["yuliao-wechat-editor", "coze-paper-quick-reference"])
        for item in self.projects[:2]:
            with self.subTest(project=item["id"]):
                self.assertEqual(item["source_url"],
                                 "https://github.com/xieyuqingme-source/" + item["id"])
                self.assertEqual(item["guide_url"], item["source_url"] + "/blob/main/README.md")
                self.assertTrue(item["problem"] and item["features"] and item["contribution"] and item["usage"])
        self.assertIn("Raphael", self.projects[0]["contribution"])
        self.assertIn("markdown-it", self.projects[0]["contribution"])
        self.assertTrue(self.projects[1]["download_url"].endswith(
            "/blob/main/Workflow-thesis_1-draft-9128.zip"))

    def test_markup_is_displayed_as_text_without_html_or_attribute_injection(self):
        project = deepcopy(self.projects[0])
        project["title"] = '<img src=x onerror="alert(1)"> & Example'
        project["summary"] = '</p><script>alert(1)</script><p>'
        html = render_projects([project])
        elements = Elements(html).elements
        self.assertFalse(any(tag in {"script", "img", "iframe"} for tag, _ in elements))
        self.assertFalse(any(key.lower().startswith("on") for _, attrs in elements for key in attrs))
        self.assertIn("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Example", html)
        self.assertIn("&lt;/p&gt;&lt;script&gt;", html)

    def test_privacy_schema_rejects_unknown_fields_and_absolute_machine_paths(self):
        for field, value in (("private_body", "Private article"), ("summary", r"D:\Obsidian Vault\draft.md"),
                             ("summary", "C:/Users/Author/picture.png"), ("summary", r"\\private-server\share\x"),
                             ("summary", "/home/author/drafts"), ("summary", "/Users/author/file")):
            item = deepcopy(self.projects[0]); item[field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_projects({"projects": [item]})

    def test_unsafe_project_links_are_rejected_before_publication(self):
        for value in ("javascript:alert(1)", "data:text/html,a", "http://github.com/project",
                      "https://user:secret@github.com/project", "https://github.com/project?token=private",
                      "https://localhost/project", "https://127.0.0.1/project", "https://192.168.0.1/project",
                      "https://[::1]/project", "https://host.local/project", "https://github.com:bad/project",
                      'https://github.com/project" onclick="x', "https://github.com\\project"):
            item = deepcopy(self.projects[0]); item["source_url"] = value
            with self.subTest(url=value), self.assertRaises(ValueError):
                validate_projects({"projects": [item]})

    def test_incomplete_or_duplicate_ids_and_unknown_visuals_are_rejected(self):
        samples = [[], {}, [self.projects[0], self.projects[0]]]
        bad = deepcopy(self.projects[0]); bad["id"] = 'bad" id'
        samples.append([bad])
        bad = deepcopy(self.projects[0]); bad["icon"] = "https://example.com/private-screenshot.png"
        samples.append([bad])
        bad = deepcopy(self.projects[0]); del bad["usage"]
        samples.append([bad])
        for items in samples:
            with self.subTest(items=items), self.assertRaises(ValueError):
                validate_projects({"projects": items})

    def test_accessible_native_visuals_and_real_buttons_have_no_online_claims(self):
        html = render_projects(self.projects)
        elements = Elements(html).elements
        ids = {attrs["id"] for _, attrs in elements if "id" in attrs}
        cards = [attrs for tag, attrs in elements if tag == "article"]
        self.assertEqual(len(cards), len(self.projects))
        self.assertTrue(all(card["aria-labelledby"] in ids for card in cards))
        svgs = [attrs for tag, attrs in elements if tag == "svg"]
        self.assertEqual(len(svgs), len(self.projects))
        self.assertTrue(all(svg.get("aria-hidden") == "true" and svg.get("viewbox") == "0 0 360 180"
                            for svg in svgs))
        self.assertFalse(any(tag in {"img", "image", "foreignobject"} for tag, _ in elements))
        published = sum(item.get("link_status") != "pending" for item in self.projects)
        self.assertEqual(html.count("查看 GitHub"), published)
        default_guides = sum(item.get("link_status") != "pending" and "guide_label" not in item for item in self.projects)
        self.assertEqual(html.count("下载与使用说明"), default_guides)
        self.assertNotIn("在线体验", html)
        links = {attrs["href"] for tag, attrs in elements if tag == "a"}
        self.assertEqual(links, {item[key] for item in self.projects for key in
                                ("source_url", "guide_url", "download_url") if key in item})

    def test_project_data_never_follows_a_symlink(self):
        with patch.object(Path, "is_symlink", return_value=True), self.assertRaisesRegex(ValueError, "symlinks"):
            load_projects()

    def test_wallpaper_beta_has_an_honest_pending_card_without_guessed_links(self):
        item = self.projects[2]
        self.assertEqual(item["id"], "yuliao-wallpaper")
        self.assertIn("v0.2.0", item["kind"])
        self.assertIn("测试版", item["kind"])
        self.assertIn("单个活动显示器", item["summary"])
        self.assertIn("人工验收", item["usage"])
        self.assertIn("30", item["features"])
        self.assertIn("5 分钟", item["features"])
        pending = deepcopy(item)
        for field in ("source_url", "guide_url", "guide_label", "download_url", "download_label"):
            pending.pop(field, None)
        pending["link_status"] = "pending"
        html = render_projects([pending])
        self.assertIn("发布链接待确认", html)
        self.assertFalse(any(tag == "a" for tag, _ in Elements(html).elements))

    def test_pending_links_unknown_states_and_unpaired_download_labels_are_rejected(self):
        pending = deepcopy(self.projects[0])
        for field in ("source_url", "guide_url"):
            pending.pop(field)
        pending["link_status"] = "pending"
        for field in ("source_url", "guide_url", "guide_label", "download_url", "download_label"):
            bad = deepcopy(pending); bad[field] = "https://example.com/confirmed-fixture"
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_projects({"projects": [bad]})
        for status in (None, [], "unconfirmed"):
            bad = deepcopy(pending); bad["link_status"] = status
            with self.subTest(status=status), self.assertRaises(ValueError):
                validate_projects({"projects": [bad]})
        bad = deepcopy(self.projects[0]); bad["download_label"] = "下载测试版"
        with self.assertRaises(ValueError):
            validate_projects({"projects": [bad]})

    def test_confirmed_download_label_is_escaped_without_changing_legacy_links(self):
        published = deepcopy(self.projects[0])
        published["download_url"] = "https://example.com/public-test-fixture.zip"
        published["download_label"] = '<script>download</script>'
        published["guide_label"] = '<img src=x onerror="guide">'
        html = render_projects([published])
        self.assertIn('&lt;script&gt;download&lt;/script&gt;', html)
        self.assertFalse(any(tag == "script" for tag, _ in Elements(html).elements))
        self.assertFalse(any(tag == "img" for tag, _ in Elements(html).elements))
        self.assertIn('href="' + self.projects[0]["source_url"] + '"', html)

    def test_page_viewport_and_responsive_card_structure_do_not_hide_overflow(self):
        for name in ("index.template.html", "projects.template.html", "about.template.html"):
            elements = Elements((ROOT / "home" / name).read_text(encoding="utf-8")).elements
            self.assertTrue(any(tag == "meta" and attrs.get("name") == "viewport"
                                and attrs.get("content") == "width=device-width, initial-scale=1"
                                for tag, attrs in elements))
            self.assertEqual(sum(tag == "h1" for tag, _ in elements), 1)
        css = (ROOT / "home/assets/portal.css").read_text(encoding="utf-8")
        self.assertRegex(css, r"\.project-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)")
        mobile = css.split("@media (max-width: 650px)", 1)[1]
        self.assertRegex(mobile, r"\.project-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)")
        self.assertIsNone(re.search(r"overflow(?:-x|-y)?\s*:\s*hidden", css),
                          "Long bilingual titles must wrap rather than disappear.")


class ProjectPublicationTests(unittest.TestCase):
    """Exercise actual unified output and navigation without copying private article fixtures."""
    def fake_blog(self, address, output):
        folder = Path(output)
        articles = [SimpleNamespace(title="Synthetic article", published="2026-01-01", language="en",
                                    destination="synthetic.html")]

        def build(clean=False):
            self.assertFalse(clean, "The existing article build must keep its original clean=False policy.")
            folder.mkdir(parents=True, exist_ok=True)
            for name in ("index.html", "synthetic.html"):
                url = address + "/" + name
                (folder / name).write_text('<html><head><link rel="canonical" href="' + url
                    + '"><meta property="og:url" content="' + url
                    + '"></head><body id="main">Synthetic public fixture</body></html>', encoding="utf-8")
            url = address.removesuffix("/articles") + "/about/"
            (folder / "about.html").write_text('<html><head><link rel="canonical" href="' + url
                + '"><meta property="og:url" content="' + url
                + '"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=/about/">'
                + '</head><body><a href="/about/">About</a></body></html>', encoding="utf-8")
            (folder / "feed.xml").write_text('<rss><channel><link>' + address + '/</link><item><link>'
                + address + '/synthetic.html</link><guid>' + address + '/synthetic.html</guid></item></channel></rss>', encoding="utf-8")
            (folder / "sitemap.xml").write_text(
                '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>'
                + address + '/index.html</loc></url><url><loc>'
                + address + '/synthetic.html</loc></url></urlset>', encoding="utf-8")
        return SimpleNamespace(articles=articles, build=build, waline={"enabled": False},
                               href=lambda path: "/articles/" + path)

    def test_projects_build_has_canonical_sitemap_and_preserves_article_outputs(self):
        with TemporaryDirectory(prefix="yuliao-site-projects-", dir=ROOT) as temporary:
            root = Path(temporary)
            shutil.copytree(ROOT / "home", root / "home")
            output = root / "_site_unified"
            with patch.object(build_site, "ROOT", root), patch.object(build_site, "OUTPUT", output), \
                 patch.object(build_site, "Blog", side_effect=self.fake_blog):
                report = publish_site("https://xieyuqing.me")
                self.assertEqual((report["articles"], report["projects"]), (1, 3))
                self.assertEqual(report["article_root"], "https://xieyuqing.me/articles/")
                self.assertTrue(report["success"])
                home = (output / "index.html").read_text(encoding="utf-8")
                projects = (output / "projects/index.html").read_text(encoding="utf-8")
                about = (output / "about/index.html").read_text(encoding="utf-8")
                nav = home.split('class="site-nav"', 1)[1].split("</nav>", 1)[0]
                self.assertIn('href="/articles/"', nav)
                self.assertIn('href="/projects/"', nav)
                self.assertIn('href="/about/"', nav)
                self.assertIn('href="/articles/synthetic.html"', home)
                self.assertIn("Synthetic article", home)
                for text in (home, projects, about):
                    self.assertNotIn("{{", text)
                    self.assertNotIn("Obsidian Vault", text)
                    self.assertNotIn("D:\\", text)
                tags = Elements(projects).elements
                self.assertTrue(any(tag == "link" and attrs.get("rel") == "canonical"
                                    and attrs.get("href") == "https://xieyuqing.me/projects/" for tag, attrs in tags))
                self.assertTrue(any(tag == "meta" and attrs.get("property") == "og:url"
                                    and attrs.get("content") == "https://xieyuqing.me/projects/" for tag, attrs in tags))
                sitemap = [node.text for node in ET.parse(output / "sitemap.xml").findall(".//{*}loc")]
                self.assertEqual(sitemap, ["https://xieyuqing.me/", "https://xieyuqing.me/projects/", "https://xieyuqing.me/about/",
                                           "https://xieyuqing.me/game/", "https://xieyuqing.me/game/ranking/",
                                           "https://xieyuqing.me/photos/",
                                           "https://xieyuqing.me/articles/index.html",
                                           "https://xieyuqing.me/articles/synthetic.html"])
                self.assertEqual(report["metadata"]["compatibility_redirects"], 1)
                self.assertNotIn("Folder Guide", about)
                self.assertNotIn("Essays by Xie Yuqing", about)
                self.assertIn(load_about()["english_bio"], about)
                qr = [attrs for tag, attrs in Elements(about).elements if tag == "img"]
                self.assertEqual(len(qr), 1)
                self.assertEqual(qr[0]["src"], "/assets/wechat-qrcode.jpg")
                self.assertEqual((qr[0]["width"], qr[0]["height"]), ("1280", "1280"))
                self.assertIn("手机端可保存图片后，在微信中识别二维码", about)
                self.assertEqual((output / "assets/wechat-qrcode.jpg").read_bytes(),
                                 (root / "home/assets/wechat-qrcode.jpg").read_bytes())
                self.assertNotIn("wechat-qrcode", home)
                # About content is independent from repository README text.
                (root / "README.md").write_text("Private folder guide; must never appear on /about/.", encoding="utf-8")
                before = {path.relative_to(output / "articles"): path.read_bytes()
                          for path in (output / "articles").rglob("*") if path.is_file()}
                data = json.loads((root / "home/projects.json").read_text(encoding="utf-8"))
                data["projects"][0]["summary"] = "A revised public project description."
                (root / "home/projects.json").write_text(json.dumps(data), encoding="utf-8")
                publish_site("https://xieyuqing.me")
                after = {path.relative_to(output / "articles"): path.read_bytes()
                         for path in (output / "articles").rglob("*") if path.is_file()}
                self.assertEqual(before, after, "Project text updates must not change article paths or RSS.")
                self.assertIn("A revised public project description.",
                              (output / "projects/index.html").read_text(encoding="utf-8"))
                self.assertFalse((output / "projects.json").exists())

    def test_invalid_private_project_data_stops_before_output_is_written(self):
        with TemporaryDirectory(prefix="yuliao-site-private-", dir=ROOT) as temporary:
            root = Path(temporary); (root / "home").mkdir()
            data = json.loads((ROOT / "home/projects.json").read_text(encoding="utf-8"))
            data["projects"][0]["usage"] = r"D:\Obsidian Vault\private.md"
            (root / "home/projects.json").write_text(json.dumps(data), encoding="utf-8")
            output = root / "_site_unified"
            with patch.object(build_site, "ROOT", root), patch.object(build_site, "OUTPUT", output), \
                 patch.object(build_site, "Blog") as blog, self.assertRaisesRegex(ValueError, "public project"):
                publish_site("https://xieyuqing.me")
            blog.assert_not_called()
            self.assertFalse(output.exists())


class PublicBiographyTests(unittest.TestCase):
    def test_known_biography_is_preserved_without_repository_guides(self):
        data = load_about()
        self.assertEqual(data["name"], "谢雨卿")
        self.assertEqual(data["wechat"], "谢雨聊")
        self.assertEqual(data["email"], "xieyuqing.me@gmail.com")
        html = render_about(data)
        self.assertEqual(sum(tag == "article" for tag, _ in Elements(html).elements), 1)
        for paragraph in data["chinese_bio"]:
            self.assertIn(paragraph, html)
        self.assertNotIn("Folder Guide", html)

    def test_text_is_escaped_and_private_fields_are_rejected(self):
        data = deepcopy(load_about())
        data["name"] = '<script>alert("name")</script>'
        self.assertNotIn("<script>", render_about(data))
        for key, value in (("internal_notes", "Private"), ("chinese_bio", []),
                           ("name", r"D:\Obsidian Vault\private.md"), ("email", 'x@example.com" onclick="x')):
            sample = deepcopy(load_about()); sample[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                validate_about(sample)

    def test_data_symlinks_are_rejected(self):
        with patch.object(Path, "is_symlink", return_value=True), self.assertRaisesRegex(ValueError, "symlinks"):
            load_about()


class PublicationMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory(prefix="yuliao-metadata-", dir=ROOT)
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name)
        (self.output / "articles").mkdir()
        urls = ("https://xieyuqing.me/", "https://xieyuqing.me/articles/index.html",
                "https://xieyuqing.me/articles/example.html")
        for relative, url in zip(("index.html", "articles/index.html", "articles/example.html"), urls):
            (self.output / relative).write_text('<html><head><link rel="canonical" href="' + url
                + '"><meta property="og:url" content="' + url + '"></head><body></body></html>', encoding="utf-8")
        def sitemap(values):
            return '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + ''.join(
                '<url><loc>' + url + '</loc></url>' for url in values) + '</urlset>'
        (self.output / "sitemap.xml").write_text(sitemap(urls), encoding="utf-8")
        (self.output / "articles/sitemap.xml").write_text(sitemap(urls[1:]), encoding="utf-8")
        (self.output / "articles/feed.xml").write_text('<rss><channel><link>https://xieyuqing.me/articles/</link>'
            '<item><link>' + urls[2] + '</link><guid>' + urls[2] + '</guid></item></channel></rss>', encoding="utf-8")
        (self.output / "robots.txt").write_text('User-agent: *\nSitemap: https://xieyuqing.me/sitemap.xml\n', encoding="utf-8")

    def validate(self):
        with patch.object(build_site, "OUTPUT", self.output):
            return check_publication_metadata("https://xieyuqing.me")

    def test_metadata_sitemaps_and_feed_share_the_requested_domain(self):
        self.assertEqual(self.validate(), {"success": True, "canonical_pages": 3, "sitemap_urls": 3,
                                          "rss_items": 1, "domain": "xieyuqing.me"})

    def test_old_default_domain_cannot_silently_skip_site_canonicals(self):
        with patch.object(build_site, "OUTPUT", self.output), self.assertRaisesRegex(ValueError, "requested site domain"):
            check_publication_metadata("https://xieyuqingme-source.github.io")

    def test_mismatched_og_or_canonical_target_is_rejected(self):
        page = self.output / "index.html"
        original = page.read_text(encoding="utf-8")
        for replacement in (original.replace('content="https://xieyuqing.me/"', 'content="https://example.com/"'),
                            original.replace('https://xieyuqing.me/', 'https://xieyuqing.me/articles/example.html')):
            page.write_text(replacement, encoding="utf-8")
            with self.assertRaises(ValueError): self.validate()

    def test_missing_or_duplicate_sitemap_and_wrong_feed_origin_are_rejected(self):
        paths = (self.output / "sitemap.xml", self.output / "articles/sitemap.xml", self.output / "articles/feed.xml",
                 self.output / "robots.txt")
        for path in paths:
            original = path.read_text(encoding="utf-8")
            path.write_text(original.replace('https://xieyuqing.me', 'https://old.example'), encoding="utf-8")
            with self.subTest(path=path.name), self.assertRaises(ValueError): self.validate()
            path.write_text(original, encoding="utf-8")
        path = self.output / "sitemap.xml"
        original = path.read_text(encoding="utf-8")
        path.write_text(original.replace('</urlset>', '<url><loc>https://xieyuqing.me/</loc></url></urlset>'), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "exactly once"): self.validate()

    def test_only_explicit_legacy_about_redirect_can_share_about_canonical(self):
        (self.output / "about").mkdir()
        url = "https://xieyuqing.me/about/"
        (self.output / "about/index.html").write_text('<link rel="canonical" href="' + url
            + '"><meta property="og:url" content="' + url + '">', encoding="utf-8")
        sitemap = self.output / "sitemap.xml"
        sitemap.write_text(sitemap.read_text(encoding="utf-8").replace('</urlset>',
            '<url><loc>' + url + '</loc></url></urlset>'), encoding="utf-8")
        redirect = '<link rel="canonical" href="' + url + '"><meta property="og:url" content="' + url \
            + '"><meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=/about/">' \
            + '<a href="/about/">About</a>'
        legacy = self.output / "articles/about.html"
        legacy.write_text(redirect, encoding="utf-8")
        self.assertEqual(self.validate()["canonical_pages"], 4)
        self.assertEqual(self.validate()["compatibility_redirects"], 1)
        for changed in (redirect.replace('noindex,follow', 'index,follow'),
                        redirect.replace('0; url=/about/', '3; url=/about/'),
                        redirect.replace('href="/about/"', 'href="/articles/"')):
            legacy.write_text(changed, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "noindex redirect"):
                self.validate()
        legacy.write_text(redirect, encoding="utf-8")
        alias = self.output / "articles/another.html"
        alias.write_text(redirect, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "different page"):
            self.validate()
        alias.unlink()
        sitemap.write_text(sitemap.read_text(encoding="utf-8").replace('</urlset>',
            '<url><loc>https://xieyuqing.me/articles/about.html</loc></url></urlset>'), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "exactly once"):
            self.validate()


if __name__ == "__main__":
    unittest.main()
