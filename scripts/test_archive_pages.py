"""Run archive behavior checks against the actual unified generated HTML (no browser)."""
from html.parser import HTMLParser
from pathlib import Path
import json
import subprocess

ROOT = Path(__file__).resolve().parent.parent

class Archive(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.data = {"years": [], "filters": [], "cards": []}
        self.in_year = False
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "select" and a.get("id") == "article-year":
            self.in_year = True
        elif tag == "option" and self.in_year:
            self.data["years"].append(a["value"])
        if "data-filter" in a:
            self.data["filters"].append(a["data-filter"])
        if "article-card-content" in a.get("class", "").split():
            self.data["cards"].append({"topic": a["data-topic"], "year": a["data-year"], "text": a["data-search"]})
    def handle_endtag(self, tag):
        if tag == "select": self.in_year = False

if __name__ == "__main__":
    output = ROOT / "_site_unified/articles"
    data = {name: Archive((output / name).read_text(encoding="utf-8")).data
            for name in ("index.html", "chinese.html", "english.html")}
    checks = ROOT / ".local-checks"
    checks.mkdir(exist_ok=True)
    (checks / "archive-test-data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    subprocess.run(["node", str(ROOT / "scripts/test_archive_logic.cjs"), str(checks)], check=True)
