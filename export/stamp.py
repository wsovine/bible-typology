#!/usr/bin/env python3
"""Stamp content hashes into index.html so a deploy never mixes old and new files.

GitHub Pages lets browsers cache every file for about 10 minutes. Without versioned URLs, a reader who
loads the page just after a deploy can get some new modules and some old ones, and the page fails to
start. This script gives every JS module, stylesheet and data file a `?v=<hash>` URL:

- an import map remaps each `./js/*.js` and `./data/*.json` to its versioned URL (module imports stay
  plain, e.g. `import ... from './util.js'`; `js/data-loader.js` resolves its fetches through the same map);
- the entry `<script type="module" src="js/main.js">` and each stylesheet `<link>` get `?v=` directly,
  because import maps don't apply to `src`/`href` attributes.

Run it after any change to js/, css/ or data/ and before committing. It is idempotent: with nothing
changed it rewrites nothing.

Usage (from the site root):
    python3 export/stamp.py           # rewrite index.html
    python3 export/stamp.py --check   # exit 1 if index.html is out of date (rewrites nothing)
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
ENTRY = "js/main.js"

IMPORTMAP_RE = re.compile(r'[ \t]*<script type="importmap">.*?</script>\n', re.S)
ENTRY_RE = re.compile(r'<script type="module" src="js/main\.js(?:\?v=[0-9a-f]+)?"></script>')
STYLESHEET_RE = re.compile(r'(<link rel="stylesheet" href=")(css/[\w-]+\.css)(?:\?v=[0-9a-f]+)?(">)')


def file_hash(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()[:8]


def versioned(rel: str) -> str:
    return f"{rel}?v={file_hash(rel)}"


def build_importmap() -> str:
    files = sorted(p.relative_to(ROOT).as_posix() for p in (*ROOT.glob("js/*.js"), *ROOT.glob("data/*.json")))
    imports = {f"./{rel}": f"./{versioned(rel)}" for rel in files}
    body = json.dumps({"imports": imports}, indent=2).replace("\n", "\n  ")
    return f'  <script type="importmap">\n  {body}\n  </script>\n'


def stamp(html: str) -> str:
    html = STYLESHEET_RE.sub(lambda m: f"{m[1]}{versioned(m[2])}{m[3]}", html)

    if not ENTRY_RE.search(html):
        sys.exit(f'stamp: no <script type="module" src="{ENTRY}"> found in index.html')
    html = ENTRY_RE.sub(f'<script type="module" src="{versioned(ENTRY)}"></script>', html)

    # The import map must come before the first module script.
    html = IMPORTMAP_RE.sub("", html)
    entry_line = re.search(r'^[ \t]*<script type="module"', html, re.M)
    return html[: entry_line.start()] + build_importmap() + html[entry_line.start():]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if index.html is out of date")
    args = parser.parse_args()

    current = INDEX.read_text()
    updated = stamp(current)
    if args.check:
        if updated != current:
            print("stamp: index.html is out of date; run python3 export/stamp.py")
            return 1
        print("stamp: index.html is up to date")
        return 0
    if updated == current:
        print("stamp: index.html already up to date")
    else:
        INDEX.write_text(updated)
        print("stamp: index.html updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
