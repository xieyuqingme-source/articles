"""Serve only the generated blog on localhost, preserving its configured URL prefix."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site"
CONFIG = json.loads((ROOT / "blog/config.json").read_text(encoding="utf-8"))
PREFIX = urlsplit(CONFIG["site_url"]).path.rstrip("/")


class PreviewHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        parsed = urlsplit(self.path)
        if parsed.path == "/" and PREFIX:
            self.send_response(302)
            self.send_header("Location", self.server.portal_url)
            self.end_headers()
            return None
        if parsed.path == PREFIX and PREFIX:
            self.send_response(302)
            self.send_header("Location", PREFIX + "/")
            self.end_headers()
            return None
        if PREFIX and not parsed.path.startswith(PREFIX + "/"):
            self.send_error(404, "Only the generated blog is served here.")
            return None
        return super().send_head()

    def translate_path(self, path):
        parsed = urlsplit(path)
        relative = parsed.path[len(PREFIX):] if PREFIX else parsed.path
        return super().translate_path(urlunsplit(("", "", relative, "", "")))

    def list_directory(self, path):
        self.send_error(403, "Directory listing is disabled.")
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--portal-url", default="http://127.0.0.1:8766/")
    args = parser.parse_args()
    portal = urlsplit(args.portal_url)
    if portal.scheme != "http" or portal.hostname not in {"127.0.0.1", "localhost"}:
        parser.error("The personal-home preview URL must be a local http URL.")
    if (OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT.resolve() / "_site"
            or not (OUTPUT / ".generated-by-blog").is_file()
            or not (OUTPUT / "index.html").is_file()):
        parser.error("Build the blog first: python scripts/build_blog.py")
    handler = partial(PreviewHandler, directory=str(OUTPUT))
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    server.portal_url = args.portal_url
    print(f"Local preview: http://127.0.0.1:{args.port}{PREFIX}/", flush=True)
    print("Press Ctrl+C to stop. Only _site is served.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
