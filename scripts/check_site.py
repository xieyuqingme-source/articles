"""Check the whole unified publication without a browser or network."""
import json
from build_site import check_site, default_root

if __name__ == "__main__":
    print(json.dumps(check_site(default_root()), ensure_ascii=False, indent=2))
