"""Check game publication, navigation and directory URLs without opening a browser."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from xml.etree import ElementTree as ET
from unittest.mock import patch
import base64
import json
import re
import shutil
import subprocess
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

EXPECTED_FOODS = ("hotpot.webp", "noodles.webp", "dumpling.webp", "burger.webp", "watermelon.webp",
                  "chicken.webp", "sushi.webp", "pizza.webp", "cake.webp", "tea.webp",
                  "mianyang-rice-noodles.webp", "jiaxing-zongzi.webp", "houttuynia.webp", "frozen-dumplings.webp",
                  "douzhi.webp", "durian.webp", "loofah-noodles.webp", "mooncake.webp",
                  "pea-mince-noodles.webp", "handmade-dumplings.webp",
                  "japanese-ramen.webp", "egg-noodles.webp", "bak-kut-teh.webp", "dongpo-pork.webp",
                  "sea-intestine-rice.webp", "eight-treasure-tofu.webp", "vietnamese-chicken-noodles.webp",
                  "pad-krapow-rice.webp", "egg-tart.webp", "barbecue.webp", "lamb-shumai.webp",
                  "zhejiang-dry-noodles.webp", "bread.webp", "lanzhou-noodles.webp",
                  "beijing-zhajiang-noodles.webp", "west-lake-vinegar-fish.webp",
                  "sichuan-hotpot.webp", "donkey-burger.webp", "smoked-pork-flatbread.webp")
EXPECTED_SPORTS = ("walking.webp", "hiking.webp", "running.webp", "weight-training.webp",
                   "swimming.webp", "badminton.webp", "cycling.webp", "football.webp",
                   "tennis.webp", "table-tennis.webp", "combat-training.webp", "tree-climbing.webp",
                   "skydiving.webp", "rock-climbing.webp", "diving.webp", "golf.webp", "gaming.webp")


def art_registries(source):
    """Read the actual exported model registries without evaluating them as Python or HTML."""
    result = subprocess.run(["node", "-e",
        "const m=require(process.argv[1]);process.stdout.write(JSON.stringify({food:m.FOOD_ART,sport:m.SPORT_ART,builtin:m.BUILTIN_ART}));",
        str(source)], check=True, capture_output=True, text=True, encoding="utf-8", timeout=10)
    return json.loads(result.stdout)


class GamePublicationTests(unittest.TestCase):
    def build_fixture(self, origin="https://preview.example"):
        temporary = TemporaryDirectory(prefix="game-routes-test-", dir=ROOT)
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        shutil.copytree(ROOT / "home", root / "home")
        shutil.copytree(ROOT / "map", root / "map")
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
        self.assertEqual(report["metadata"]["canonical_pages"], 9)
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
        ranking = Elements((output / "game/ranking/index.html").read_text(encoding="utf-8")).elements
        scripts = [attrs.get("src") for tag, attrs in ranking if tag == "script" and attrs.get("src")]
        styles = [attrs.get("href") for tag, attrs in ranking if tag == "link" and attrs.get("rel") == "stylesheet"]
        for name in ("ranking-model.js", "ranking-storage.js", "ranking-export.js", "ranking-images.js", "ranking-view.js", "ranking.js"):
            self.assertIn("/assets/" + name, scripts)
        self.assertLess(scripts.index("/assets/ranking-images.js"), scripts.index("/assets/ranking.js"))
        self.assertLess(scripts.index("/assets/ranking-view.js"), scripts.index("/assets/ranking.js"))
        for name in ("portal.css", "game.css", "ranking-skins.css"):
            self.assertIn("/assets/" + name, styles)
        self.assertEqual(build_site.GAME_FOOD_ASSETS, EXPECTED_FOODS)
        self.assertEqual(build_site.GAME_SPORT_ASSETS, EXPECTED_SPORTS)
        registries = art_registries(output / "assets/ranking-model.js")
        for directory, registry, expected in (("foods", "food", EXPECTED_FOODS), ("sports", "sport", EXPECTED_SPORTS)):
            self.assertEqual({path.name for path in (output / "assets" / directory).iterdir()}, set(expected),
                             "Only fixed public photos should be copied; source notes and previews stay out.")
            photo_paths = [entry["photo"] for entry in registries[registry].values()]
            self.assertEqual(set(photo_paths), {"/assets/" + directory + "/" + name for name in expected})
            self.assertEqual(len(photo_paths), len(expected))
            for name in expected:
                with self.subTest(directory=directory, photo=name):
                    photo = output / "assets" / directory / name
                    self.assertEqual(photo.read_bytes(), (ROOT / "home/assets" / directory / name).read_bytes())
                    header = photo.read_bytes()[:12]
                    self.assertEqual((header[:4], header[8:12]), (b"RIFF", b"WEBP"))
        self.assertEqual(registries["builtin"], {**registries["food"], **registries["sport"]})

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


class GameFoodPreflightTests(unittest.TestCase):
    def test_missing_photo_is_reported_before_any_output_is_written(self):
        with TemporaryDirectory(prefix="game-missing-photo-", dir=ROOT) as temporary:
            root = Path(temporary)
            output = root / "_site_unified"
            with patch.object(build_site, "ROOT", root), patch.object(build_site, "OUTPUT", output), \
                 patch.object(build_site, "load_projects", return_value=[]), \
                 patch.object(build_site, "load_about", return_value={}), \
                 patch.object(build_site, "Blog") as blog, \
                 self.assertRaisesRegex(ValueError, r"Missing required game food photo: home/assets/foods/hotpot\.webp"):
                build_site.build_site("https://preview.example")
            blog.assert_not_called()
            self.assertFalse(output.exists())

    def test_source_photo_and_directory_symlinks_are_explicitly_rejected(self):
        with TemporaryDirectory(prefix="game-symlink-photo-", dir=ROOT) as temporary:
            root = Path(temporary)
            folder = root / "home/assets/foods"
            for target, message in ((folder, "directory symlinks"), (folder / "hotpot.webp", "asset symlinks")):
                with self.subTest(target=target), patch.object(build_site, "ROOT", root), \
                     patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path == target), \
                     self.assertRaisesRegex(ValueError, message):
                    build_site.game_food_sources()


class GameSportResourceTests(unittest.TestCase):
    def test_sport_photos_copy_only_the_fixed_names_using_temporary_fixtures(self):
        with TemporaryDirectory(prefix="game-sport-fixture-", dir=ROOT) as temporary:
            root = Path(temporary)
            folder = root / "home/assets/sports"
            folder.mkdir(parents=True)
            # A valid 1px WebP used only inside this disposable test root, never production assets.
            fixture = base64.b64decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQnqJUpv+BiOh/AAA=")
            for name in EXPECTED_SPORTS:
                (folder / name).write_bytes(fixture)
            (folder / "private-preview.webp").write_bytes(b"not a public photo")
            (folder / "SOURCE.txt").write_text("test-only source notes", encoding="utf-8")
            output = root / "_site_unified"
            (output / "assets").mkdir(parents=True)
            with patch.object(build_site, "ROOT", root), patch.object(build_site, "OUTPUT", output):
                sources = build_site.game_sport_sources()
                build_site.copy_game_photo_assets((("sports", "sport", sources),))
            self.assertEqual(build_site.GAME_SPORT_ASSETS, EXPECTED_SPORTS)
            self.assertEqual([source.name for source in sources], list(EXPECTED_SPORTS))
            self.assertEqual({path.name for path in (output / "assets/sports").iterdir()}, set(EXPECTED_SPORTS))
            for name in EXPECTED_SPORTS:
                self.assertEqual((output / "assets/sports" / name).read_bytes(), fixture)

    def test_missing_last_sport_photo_leaves_new_or_existing_output_untouched(self):
        with TemporaryDirectory(prefix="game-sport-missing-", dir=ROOT) as temporary:
            root = Path(temporary)
            missing = root / "home/assets/sports/gaming.webp"
            for existing in (False, True):
                output = root / ("existing" if existing else "fresh") / "_site_unified"
                if existing:
                    output.mkdir(parents=True)
                    (output / "sentinel.txt").write_text("preserve existing output", encoding="utf-8")
                before = {path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()}
                with self.subTest(existing=existing), patch.object(build_site, "ROOT", root), \
                     patch.object(build_site, "OUTPUT", output), \
                     patch.object(build_site, "load_projects", return_value=[]), \
                     patch.object(build_site, "load_about", return_value={}), \
                     patch.object(Path, "is_symlink", return_value=False), \
                     patch.object(Path, "is_file", autospec=True, side_effect=lambda path: path != missing), \
                     patch.object(build_site, "Blog") as blog, \
                     self.assertRaisesRegex(ValueError, r"Missing required game sport photo: home/assets/sports/gaming\.webp"):
                    build_site.build_site("https://preview.example")
                blog.assert_not_called()
                after = {path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()}
                self.assertEqual(after, before)
                self.assertEqual(output.exists(), existing)

    def test_sport_source_parent_directory_and_file_symlinks_are_rejected(self):
        with TemporaryDirectory(prefix="game-sport-symlink-", dir=ROOT) as temporary:
            root = Path(temporary)
            folder = root / "home/assets/sports"
            for target in (root / "home/assets", folder, folder / "walking.webp"):
                with self.subTest(target=target), patch.object(build_site, "ROOT", root), \
                     patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path == target), \
                     self.assertRaisesRegex(ValueError, "symlinks"):
                    build_site.game_sport_sources()

    def test_linked_output_parent_is_rejected_before_copying_any_sport_photo(self):
        with TemporaryDirectory(prefix="game-sport-output-link-", dir=ROOT) as temporary:
            output = Path(temporary) / "_site_unified"
            with patch.object(build_site, "OUTPUT", output), \
                 patch.object(Path, "is_symlink", autospec=True, side_effect=lambda path: path == output / "assets"), \
                 patch.object(build_site.shutil, "copy2") as copy, \
                 self.assertRaisesRegex(ValueError, "directory symlinks"):
                build_site.copy_game_photo_assets((("sports", "sport", [Path("walking.webp")]),))
            copy.assert_not_called()

    def test_directory_photo_destination_is_rejected_before_copying(self):
        with TemporaryDirectory(prefix="game-sport-output-dir-", dir=ROOT) as temporary:
            output = Path(temporary) / "_site_unified"
            destination = output / "assets/sports/walking.webp"
            destination.mkdir(parents=True)
            with patch.object(build_site, "OUTPUT", output), \
                 patch.object(build_site.shutil, "copy2") as copy, \
                 self.assertRaisesRegex(ValueError, "photo destination must be a regular file"):
                build_site.copy_game_photo_assets((("sports", "sport", [Path("walking.webp")]),))
            copy.assert_not_called()
            self.assertEqual(list(destination.iterdir()), [])


class GameArtRegistryTests(unittest.TestCase):
    def test_model_registries_match_all_thirty_nine_foods_and_seventeen_sports_without_photo_fixtures(self):
        registries = art_registries(ROOT / "home/assets/ranking-model.js")
        self.assertEqual(build_site.GAME_FOOD_ASSETS, EXPECTED_FOODS)
        self.assertEqual(build_site.GAME_SPORT_ASSETS, EXPECTED_SPORTS)
        food, sport = registries["food"], registries["sport"]
        self.assertEqual(set(food), {Path(name).stem for name in EXPECTED_FOODS})
        self.assertEqual(set(sport), {Path(name).stem for name in EXPECTED_SPORTS})
        self.assertTrue(set(food).isdisjoint(sport))
        self.assertEqual(registries["builtin"], {**food, **sport})
        self.assertEqual(len(registries["builtin"]), 56)
        for directory, registry in (("foods", food), ("sports", sport)):
            for key, entry in registry.items():
                self.assertEqual(entry["photo"], "/assets/" + directory + "/" + key + ".webp")


if __name__ == "__main__":
    unittest.main()
