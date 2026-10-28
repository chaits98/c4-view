#!/usr/bin/env python3
"""Generate data/font-metrics.json from DejaVu Sans (the pinned diagram font).

Deterministic text measurement without a browser: the SVG pins
`font-family="DejaVu Sans"`, and the layout reads advance widths from this
table instead of asking a canvas. Regenerate only when the font changes.

    python3 scripts/gen-metrics.py
"""
import json
import pathlib
import sys

from fontTools.ttLib import TTFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "font-metrics.json"

# printable ASCII + Latin-1 + the punctuation an architecture label actually uses
RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x2010, 0x2015), (0x2018, 0x201D),
          (0x2022, 0x2022), (0x2026, 0x2026), (0x2190, 0x2193)]


def main() -> int:
    font = TTFont(FONT)
    upm = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]

    widths: dict[str, int] = {}
    for lo, hi in RANGES:
        for cp in range(lo, hi + 1):
            name = cmap.get(cp)
            if not name or name not in hmtx.metrics:
                continue
            widths[chr(cp)] = round(hmtx.metrics[name][0] * 1000 / upm)

    # Cyrillic / Devanagari / CJK are not in DejaVu: fall back to a sane average
    fallback = widths["n"] if "n" in widths else 600
    data = {
        "font": "DejaVu Sans",
        "unitsPerEm": upm,
        "source": pathlib.Path(FONT).name,
        "fallback": fallback,
        "widths": dict(sorted(widths.items())),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    # self-check: the table must measure the strings the layout depends on
    assert widths[" "] > 0 and widths["M"] > widths["i"], "advance table looks wrong"
    assert fallback > 0
    print(f"wrote {OUT} — {len(widths)} glyphs, fallback {fallback}/1000 em")
    return 0


if __name__ == "__main__":
    sys.exit(main())
