"""Prepare selected local albums, build the canonical website, optionally serve it."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / ".photos-local.json")
    parser.add_argument("--serve", action="store_true", help="Serve only generated files on localhost after checks.")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    from export_photos import export
    from build_site import build_site, default_root
    print(json.dumps({"export": export(ROOT, args.config)}, ensure_ascii=False, indent=2), flush=True)
    result = build_site(default_root())
    fields = ("success", "pages", "local_links", "valid_fragments", "metadata", "photography", "waline_enabled")
    print(json.dumps({"build": {key: result[key] for key in fields}}, ensure_ascii=False, indent=2), flush=True)
    print(f"摄影预览：http://127.0.0.1:{args.port}/photos/", flush=True)
    print("本次仅生成本地预览；检查照片和说明后，再自行选择公开文件提交、推送。", flush=True)
    if args.serve:
        subprocess.run([sys.executable, str(ROOT / "scripts/preview_site.py"), "--port", str(args.port)], check=True)
    else:
        print("启动预览：python scripts/preview_site.py", flush=True)


if __name__ == "__main__":
    main()
