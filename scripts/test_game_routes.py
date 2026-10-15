"""Check game publication, navigation and directory URLs without opening a browser."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from xml.etree import ElementTree as ET
from unittest.mock import patch
import re
import shutil
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))
import build_site
import build_blog
import preview_site
import test_build_site
from build_site import Elements


class GamePublicationTests(unittest.TestCase):
    def build_fixture(self, origin="https://preview.example"):
        temporary = TemporaryDirectory(prefix="game-routes-test-", dir=ROOT)
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        shutil.copytree(ROOT / "home", root / "home")
        output = root / "_site_unified"
        fixture = test_build_site.ProjectPublicationTests()
        with patch.object(build_site, "ROOT", root), patch.object(build_site, "OUTPUT", output), \
             patch.object(build_site, "Blog", side_effect=fixture.fake_blog):
            report = build_site.build_site(origin)
        return output, report

    def test_games_are_static_directories_with_complete_metadata_and_local_assets(self):
        origin = "https://preview.example"
        output, report = self.build_fixture(origin)
        self.assertTrue(report["success"])
        self.assertEqual(report["metadata"]["canonical_pages"], 7)
        sitemap = [node.text for node in ET.parse(output / "sitemap.xml").findall(".//{*}loc")]
        for route in ("game", "game/ranking"):
            with self.subTest(route=route):
                html = (output / route / "index.html").read_text(encoding="utf-8")
                elements = Elements(html).elements
                url = origin + "/" + route + "/"
                self.assertIn(url, sitemap)
                self.assertEqual([attrs.get("href") for tag, attrs in elements
                                  if tag == "link" and attrs.get("rel") == "canonical"], [url])
                self.assertEqual([attrs.get("content") for tag, attrs in elements
                                  if tag == "meta" and attrs.get("property") == "og:url"], [url])
                self.assertNotIn("xieyuqing.me", html, "Game metadata must follow the requested build origin.")
                self.assertNotIn("{{", html)
                self.assertEqual(sum(tag == "h1" for tag, _ in elements), 1)
                resources = [attrs.get("src", attrs.get("href", "")) for tag, attrs in elements
                             if tag == "script" or tag == "link" and attrs.get("rel") == "stylesheet"]
                self.assertTrue(all(resource.startswith("/assets/") for resource in resources if resource))
        for name in build_site.GAME_ASSETS:
            with self.subTest(asset=name):
                self.assertEqual((output / "assets" / name).read_bytes(),
                                 (ROOT / "home/assets" / name).read_bytes())
                if name.endswith(".js"):
                    source = (output / "assets" / name).read_text(encoding="utf-8")
                    imports = re.findall(r'(?:from\s*|import\s*)["\'](\./[^"\']+)["\']', source)
                    for imported in imports:
                        self.assertTrue((output / "assets" / imported).is_file(), f"Missing module: {imported}")

    def test_new_and_existing_navigation_preserve_public_entries(self):
        output, _ = self.build_fixture()
        for relative in ("index.html", "projects/index.html", "about/index.html", "game/index.html", "game/ranking/index.html"):
            with self.subTest(page=relative):
                html = (output / relative).read_text(encoding="utf-8")
                nav = html.split('class="site-nav"', 1)[1].split("</nav>", 1)[0]
                links = [attrs.get("href") for tag, attrs in Elements(nav).elements if tag == "a"]
                for route in ("/", "/articles/", "/projects/", "/game/", "/about/"):
                    self.assertIn(route, links)
        home = (output / "index.html").read_text(encoding="utf-8")
        self.assertIn('class="entry-title-link" href="/articles/"', home)
        self.assertIn('class="entry-title-link" href="/projects/"', home)
        self.assertIn('class="home-game-link" href="/game/"', home)

    def test_article_navigation_uses_exact_game_root_and_keeps_other_roots(self):
        blog = build_blog.Blog("https://preview.example/articles")
        html = blog.document("Public fixture", "<p>Article</p>", "fixture.html")
        nav = html.split('class="site-nav"', 1)[1].split("</nav>", 1)[0]
        links = [attrs.get("href") for tag, attrs in Elements(nav).elements if tag == "a"]
        self.assertIn("/game/", links)
        self.assertIn("/projects/", links)
        self.assertIn("/about/", links)
        self.assertNotIn("/articles/game/", html)

    def test_directory_game_routes_and_old_routes_are_served_without_source_exposure(self):
        output, _ = self.build_fixture()
        (output / ".private").write_text("not public", encoding="utf-8")
        (output / "empty").mkdir()

        class QuietHandler(preview_site.Handler):
            def log_message(self, *args):
                pass

        with patch.object(preview_site, "OUTPUT", output):
            server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                def request(path):
                    connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
                    try:
                        connection.request("GET", path)
                        response = connection.getresponse()
                        return response.status, response.getheader("Location"), response.read().decode("utf-8")
                    finally:
                        connection.close()

                for route in ("game", "game/ranking", "about", "projects", "articles"):
                    with self.subTest(route=route):
                        self.assertEqual(request("/" + route)[:2], (301, "/" + route + "/"))
                        self.assertEqual(request("/" + route + "/")[0], 200)
                self.assertIn("从夯到拉", request("/game/ranking/")[2])
                self.assertIn('content="0; url=/about/"', request("/articles/about.html")[2])
                self.assertEqual(request("/empty/")[0], 403)
                self.assertEqual(request("/.private")[0], 404)
                self.assertEqual(request("/%2e%2e/README.md")[0], 404)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
