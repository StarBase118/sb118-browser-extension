#!/usr/bin/env python3
"""Regenerate the toolbar icons from the SB118 white delta mark.

Brand navy (#1D72A6) rounded square + the white mark, so the icon reads on both
light and dark browser toolbars. Run from the repo root:

    python3 scripts/make-icons.py [path/to/SB118_logo_favicon512x512_white.png]

Default source is the shared branding folder outside this repo, which is why the
generated PNGs are committed rather than built on the fly.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (0x1D, 0x72, 0xA6, 0xFF)
SIZES = (16, 48, 128)
# Mark box as a fraction of the icon. 16px gets a bigger mark and a tighter
# plate: the gap between the two chevrons is roughly one pixel there, so the
# margin that looks right at 128 is what turns the mark to mush at 16.
MARK_SCALE = {16: 0.94, 48: 0.78, 128: 0.72}
DEFAULT_SRC = Path.home() / "ClaudeCode/sb118/branding/logos/SB118_logo_favicon512x512_white.png"


def build(src: Path, out_dir: Path) -> None:
    mark = Image.open(src).convert("RGBA")
    # Trim the source's transparent padding so the mark fills the icon predictably.
    bbox = mark.getbbox()
    if bbox:
        mark = mark.crop(bbox)

    for size in SIZES:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # Supersample the rounded rect so small sizes don't get jagged corners.
        ss = 8
        plate = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
        radius = max(1, round(size * (0.14 if size == 16 else 0.22))) * ss
        ImageDraw.Draw(plate).rounded_rectangle(
            (0, 0, size * ss - 1, size * ss - 1), radius=radius, fill=NAVY
        )
        canvas.alpha_composite(plate.resize((size, size), Image.LANCZOS))

        box = max(1, round(size * MARK_SCALE[size]))
        w, h = mark.size
        scale = min(box / w, box / h)
        resized = mark.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        canvas.alpha_composite(
            resized, ((size - resized.width) // 2, (size - resized.height) // 2)
        )

        dest = out_dir / f"icon{size}.png"
        canvas.save(dest, optimize=True)
        print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SRC
    if not source.is_file():
        sys.exit(f"source mark not found: {source}")
    target = Path(__file__).resolve().parent.parent / "src" / "icons"
    build(source, target)
