"""Export approved footprint records, or build a separate local draft preview."""
import argparse
import json
from pathlib import Path
from map_pages import public_from_document

ROOT = Path(__file__).resolve().parent.parent


def source_path(explicit=None):
    if explicit:
        return Path(explicit).expanduser().resolve()
    configuration = ROOT / ".map-local.json"
    if configuration.is_symlink():
        raise ValueError("Local map configuration cannot be a symlink.")
    data = json.loads(configuration.read_text(encoding="utf-8-sig"))
    if (not isinstance(data, dict) or not {"source"}.issubset(data)
            or set(data) - {"source", "runtime"} or not isinstance(data["source"], str)):
        raise ValueError("Local map configuration needs a source path and optional runtime settings.")
    return Path(data["source"]).expanduser().resolve()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", help="Local Markdown or JSON; otherwise read ignored .map-local.json")
    parser.add_argument("--preview", action="store_true", help="Only build _site_map_preview; never update the public catalog")
    args = parser.parse_args()
    source = source_path(args.source)
    if args.preview:
        import build_site
        build_site.OUTPUT = ROOT / "_site_map_preview"
        report = build_site.build_site(build_site.default_root(), map_preview_source=source)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        data = public_from_document(source, preview=False)
        target = ROOT / "map/catalog.json"
        from map_pages import safe_file
        safe_file(ROOT, target)
        target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"success": True, "approved_records": len(data["records"]),
                          "target": "map/catalog.json", "published": False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
