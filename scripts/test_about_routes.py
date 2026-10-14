"""Check directory redirects and preview boundaries using local HTTP, without a browser."""
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from unittest.mock import patch
import unittest

import preview_site

ROOT = Path(__file__).resolve().parent.parent


class AboutPreviewRoutes(unittest.TestCase):
    def test_directory_about_and_legacy_route_with_no_private_listing(self):
        with TemporaryDirectory(prefix="about-preview-test-", dir=ROOT) as temporary:
            output = Path(temporary).resolve()
            (output / "about").mkdir()
            (output / "about/index.html").write_text("<h1>About public fixture</h1>", encoding="utf-8")
            (output / "articles").mkdir()
            (output / "articles/about.html").write_text(
                '<meta name="robots" content="noindex,follow"><meta http-equiv="refresh" content="0; url=/about/">'
                '<a href="/about/">About</a>', encoding="utf-8")
            (output / ".private").write_text("must not be served", encoding="utf-8")
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
                    self.assertEqual(request("/about")[:2], (301, "/about/"))
                    status, _, text = request("/about/")
                    self.assertEqual(status, 200)
                    self.assertIn("About public fixture", text)
                    status, _, text = request("/articles/about.html")
                    self.assertEqual(status, 200)
                    self.assertIn('content="0; url=/about/"', text)
                    self.assertIn("noindex,follow", text)
                    self.assertEqual(request("/articles/")[0], 403)
                    self.assertEqual(request("/.private")[0], 404)
                    self.assertEqual(request("/%2e%2e/README.md")[0], 404)
                finally:
                    server.shutdown()
                    server.server_close()
                    worker.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
