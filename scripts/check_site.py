"""Check the whole unified publication without a browser or network."""
import argparse
import json
from build_site import check_site, check_publication_metadata, default_root

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-url", default=default_root())
    args = parser.parse_args()
    report = check_site(args.site_url)
    report["metadata"] = check_publication_metadata(args.site_url)
    print(json.dumps(report, ensure_ascii=False, indent=2))
