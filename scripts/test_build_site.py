"""Check unified publication boundaries and link validation without touching source files."""
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
if (ROOT / ".blog-deps").is_dir():
    sys.path.insert(0, str(ROOT / ".blog-deps"))
from build_site import site_root, default_root, check_site, Elements


class UnifiedPublicationTests(unittest.TestCase):
    def test_root_url_normalization(self):
        self.assertEqual(site_root("https://xieyuqingme-source.github.io/"),
                         "https://xieyuqingme-source.github.io")
        self.assertEqual(default_root(), "https://xieyuqingme-source.github.io")

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

    def test_missing_fragment_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Missing anchor"):
            self.validate('<a href="#absent">Missing</a>')

    def test_outside_publication_link_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "outside-publication"):
            self.validate('<a href="../../private.html">Outside</a>')

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate IDs"):
            self.validate('<h1 id="main">Title</h1><div id="main"></div>')


if __name__ == "__main__":
    unittest.main()
