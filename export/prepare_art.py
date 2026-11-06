#!/usr/bin/env python3
"""Convert a downloaded painting into the site's two WebP sizes.

Writes images/<name>.webp (long edge at most 1600 px) and images/<name>-800.webp (long edge 800 px),
never upscaling, with metadata stripped. Credits live in export/story.toml ([chapter.art]); the
story compiler (render_story.py) checks the files against the image budget.

Needs cwebp (brew install webp) and macOS sips.

Usage (from the site root):
    python3 export/prepare_art.py path/to/source.jpg bouts-gathering-of-the-manna
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
QUALITY = 78
SIZES = {"": 1600, "-800": 800}  # file suffix -> long edge


def pixel_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return int(re.search(r"pixelWidth: (\d+)", out)[1]), int(re.search(r"pixelHeight: (\d+)", out)[1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("source", type=Path, help="downloaded image (JPEG, PNG or TIFF)")
    parser.add_argument("name", help="output base name, e.g. bouts-gathering-of-the-manna")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", args.name):
        sys.exit("name must be lowercase-kebab-case")

    width, height = pixel_size(args.source)
    (SITE / "images").mkdir(exist_ok=True)
    for suffix, long_edge in SIZES.items():
        out = SITE / "images" / f"{args.name}{suffix}.webp"
        scale = min(1.0, long_edge / max(width, height))
        w, h = round(width * scale), round(height * scale)
        subprocess.run(["cwebp", "-quiet", "-q", str(QUALITY), "-resize", str(w), str(h),
                        str(args.source), "-o", str(out)], check=True)
        print(f"{out.relative_to(SITE)}: {w}x{h}, {out.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
