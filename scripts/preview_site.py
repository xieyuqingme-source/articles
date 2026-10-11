"""Preview only the unified generated site on localhost."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "_site_unified"


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        relative = unquote(urlsplit(path).path).lstrip("/")
        target = (OUTPUT / relative).resolve()
        if not target.is_relative_to(OUTPUT) or any(part.startswith(".") for part in Path(relative).parts):
            return str(OUTPUT / "__not_served__")
        return str(target)

    def list_directory(self, path):
        self.send_error(403, "Directory listing is disabled.")
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    if (OUTPUT.is_symlink() or OUTPUT.resolve() != ROOT.resolve() / "_site_unified"
            or not (OUTPUT / ".generated-by-unified-site").is_file()):
        parser.error("Build first: python scripts/build_site.py")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=str(OUTPUT)))
    print(f"Unified preview: http://127.0.0.1:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
