#!/usr/bin/env python3
"""WCAG 2.x contrast-ratio checker (stdlib-only).

The five-point visual audit requires exact contrast arithmetic — that's this
script's job, never the model's. Each argument is one FG:BG pair; colors are
hex (#rgb / #rrggbb) or hsl (h,s%,l%).

Usage:
    python3 contrast_check.py '#5b5b66:#ffffff' '240,8%,55%:#f4f4f5' ...

Output: one line per pair — ratio, and pass/fail at the two WCAG thresholds
(4.5:1 body text, 3:1 large text / UI). Exit 0 when every pair passes 3:1 and
at least the pairs you intend as body text pass 4.5:1 is your judgment; exit 1
when any pair fails 3:1 outright, so a shell gate can catch hard failures.
"""

import re
import sys


def _hsl_to_rgb(h, s, l):
    s /= 100.0
    l /= 100.0
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60.0) % 2 - 1))
    m = l - c / 2
    r, g, b = {0: (c, x, 0), 1: (x, c, 0), 2: (0, c, x),
               3: (0, x, c), 4: (x, 0, c), 5: (c, 0, x)}[int(h // 60) % 6]
    return tuple(round((v + m) * 255) for v in (r, g, b))


def parse_color(tok):
    tok = tok.strip().lower()
    m = re.fullmatch(r"#?([0-9a-f]{6})", tok)
    if m:
        v = m.group(1)
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))
    m = re.fullmatch(r"#?([0-9a-f]{3})", tok)
    if m:
        return tuple(int(c * 2, 16) for c in m.group(1))
    m = re.fullmatch(r"(?:hsl\()?\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)?", tok)
    if m:
        return _hsl_to_rgb(*(float(g) for g in m.groups()))
    raise ValueError(f"unparseable color: {tok!r} (use #rrggbb or h,s%,l%)")


def rel_luminance(rgb):
    def chan(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (chan(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    l1, l2 = sorted((rel_luminance(fg), rel_luminance(bg)), reverse=True)
    return (l1 + 0.05) / (l2 + 0.05)


def main(argv):
    if len(argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    hard_fail = False
    for pair in argv[1:]:
        if ":" not in pair:
            print(f"skipping {pair!r}: expected FG:BG", file=sys.stderr)
            hard_fail = True
            continue
        fg_s, bg_s = pair.rsplit(":", 1)
        try:
            ratio = contrast(parse_color(fg_s), parse_color(bg_s))
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            hard_fail = True
            continue
        body = "PASS" if ratio >= 4.5 else "fail"
        large = "PASS" if ratio >= 3.0 else "FAIL"
        if ratio < 3.0:
            hard_fail = True
        print(f"{fg_s} on {bg_s}: {ratio:.2f}:1  body(4.5:1)={body}  large/UI(3:1)={large}")
    return 1 if hard_fail else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
