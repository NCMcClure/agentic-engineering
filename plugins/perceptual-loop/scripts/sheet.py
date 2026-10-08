# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "pillow>=10", "scipy>=1.10"]
# ///
"""Sheets: pictures made for eyes (the agent's and the owner's).

  pair      reference | candidate, and under them where the edges differ and where the colour differs
  triptych  any pictures side by side at one height, labelled (reference | before | after)
  strip     the same, stacked
  contact   a grid of frames, every Nth, with frame numbers and times
  crop      one box of a shot, from every source, side by side and zoomed
  diff      the colour-difference heat map of two pictures

A number says that two pictures differ; a sheet shows how. Every sheet fits --max-width so that a vision
model reads it whole instead of a downscaled blur.
"""
from __future__ import annotations

import argparse
import math
import sys
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import groups as gr  # noqa: E402
import compare as cmp  # noqa: E402

BG, FG, DIM = (22, 22, 24), (236, 236, 236), (150, 150, 155)
GAP = 6
DE_MAX = 20.0  # the heat map's scale is fixed, so two sheets made a week apart can be compared by eye
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


# ------------------------------------------------------------------------------------------------------------ drawing

def font(size: int = 14):
    from PIL import ImageFont

    try:
        return ImageFont.load_default(size)
    except TypeError:  # an older Pillow has only the fixed bitmap font
        return ImageFont.load_default()


def safe(text: str) -> str:
    """The built-in font knows Latin-1 only: spell out what it cannot draw rather than print boxes."""
    for a, b in (("Δ", "d"), ("→", "->"), ("·", "|"), ("×", "x"), ("−", "-"), ("…", "...")):
        text = text.replace(a, b)
    return text.encode("latin-1", "replace").decode("latin-1")


def bar(width: int, text: str, size: int = 14, colour: tuple[int, int, int] = FG):
    """A line of text on the sheet's background, cut to the width it has."""
    from PIL import Image, ImageDraw

    f, text = font(size), safe(text)
    im = Image.new("RGB", (max(1, width), size + 8), BG)
    d = ImageDraw.Draw(im)
    while len(text) > 4 and d.textlength(text, font=f) > width - 8:
        text = text[:-5] + "..."
    d.text((4, 3), text, fill=colour, font=f)
    return im


def open_rgb(path: str | Path):
    from PIL import Image

    try:
        with Image.open(path) as im:
            return im.convert("RGB")
    except FileNotFoundError:
        raise pl.PlError(f"no such picture: {path}") from None
    except OSError as e:
        raise pl.PlError(f"cannot read {path}: {e}") from None


def scaled(im, scale: float):
    """Smooth when shrinking; nearest when enlarging, so a zoomed crop shows the pixels that are there."""
    from PIL import Image

    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    if size == im.size:
        return im
    return im.resize(size, Image.Resampling.LANCZOS if scale < 1 else Image.Resampling.NEAREST)


def stack(tiles: list, horizontal: bool):
    from PIL import Image

    w = sum(t.width for t in tiles) + GAP * (len(tiles) - 1) if horizontal else max(t.width for t in tiles)
    h = max(t.height for t in tiles) if horizontal else sum(t.height for t in tiles) + GAP * (len(tiles) - 1)
    out = Image.new("RGB", (w, h), BG)
    at = 0
    for t in tiles:
        out.paste(t, (at, 0) if horizontal else (0, at))
        at += (t.width if horizontal else t.height) + GAP
    return out


def labelled(im, label: str):
    return stack([bar(im.width, label), im], horizontal=False) if label else im


def framed(sheet, header: str | None = None):
    from PIL import ImageOps

    if header:
        sheet = stack([bar(sheet.width, header, 16), sheet], horizontal=False)
    return ImageOps.expand(sheet, GAP, BG)


def with_grid(panel, cols: int, rows: int):
    """Faint lines over a panel and letters/numbers in a margin, so a place can be named in text ('C4')."""
    from PIL import Image, ImageDraw

    left, top, f = 18, 16, font(11)
    over = Image.new("RGBA", panel.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(over)
    for i in range(1, cols):
        x = round(i * panel.width / cols)
        d.line([(x, 0), (x, panel.height)], fill=(255, 255, 255, 70))
    for j in range(1, rows):
        y = round(j * panel.height / rows)
        d.line([(0, y), (panel.width, y)], fill=(255, 255, 255, 70))
    out = Image.new("RGB", (panel.width + left, panel.height + top), BG)
    out.paste(Image.alpha_composite(panel.convert("RGBA"), over).convert("RGB"), (left, top))
    d = ImageDraw.Draw(out)
    for i in range(cols):
        name = chr(65 + i % 26) * (1 + i // 26)
        d.text((left + (i + 0.5) * panel.width / cols - 3 * len(name), 1), name, fill=DIM, font=f)
    for j in range(rows):
        d.text((2, top + (j + 0.5) * panel.height / rows - 6), str(j + 1), fill=DIM, font=f)
    return out


def _heat_lut():
    import numpy as np

    stops = [(0.0, (0, 0, 0)), (0.12, (30, 20, 110)), (0.35, (160, 30, 130)), (0.65, (245, 110, 30)), (1.0, (255, 250, 190))]
    x = np.linspace(0, 1, 256)
    return np.stack([np.interp(x, [s[0] for s in stops], [s[1][c] for s in stops]) for c in range(3)], -1).astype(np.uint8)


def heat_image(delta_e):
    import numpy as np
    from PIL import Image

    return Image.fromarray(_heat_lut()[np.clip(delta_e / DE_MAX * 255, 0, 255).astype(np.uint8)])


def heat_legend(width: int):
    import numpy as np
    from PIL import Image, ImageDraw

    ramp = Image.fromarray(np.repeat(_heat_lut()[np.linspace(0, 255, max(2, width)).astype(int)][None], 10, 0))
    out = stack([ramp, bar(width, "", 11)], horizontal=False)
    d, f = ImageDraw.Draw(out), font(11)
    for v in (0, 1, 2, 5, 10, 20):
        x = min(width - 22, round(v / DE_MAX * (width - 1)))
        d.line([(x, 8), (x, 13)], fill=FG)
        d.text((x + 2, 13), f"{v}+" if v == DE_MAX else str(v), fill=DIM, font=f)
    return out


def edge_overlay(ref_u8, maps: dict[str, Any], thickness: int):
    """White where both pictures have the edge, magenta where only the reference has it, green where only the candidate."""
    import numpy as np
    from PIL import Image
    from scipy.ndimage import maximum_filter

    def fat(mask):  # thin lines vanish when the panel is shrunk: thicken them before, by as much
        return maximum_filter(mask.view(np.uint8), size=thickness).view(bool) if thickness > 1 else mask

    # the reference, dark and grey, behind the lines: an edge is easier to place when the object is visible
    out = np.repeat((ref_u8.mean(-1, keepdims=True) * 0.22).astype(np.uint8), 3, -1)
    out[fat(maps["refHit"] | maps["candHit"])] = (255, 255, 255)
    out[fat(maps["refEdge"] & ~maps["refHit"])] = (255, 0, 255)
    out[fat(maps["candEdge"] & ~maps["candHit"])] = (0, 230, 60)
    return Image.fromarray(out)


def save(sheet, out: Path, jpeg: bool) -> Path:
    if jpeg:
        out = out.with_suffix(".jpg")
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, **({"quality": 90} if out.suffix.lower() in (".jpg", ".jpeg") else {}))
    return out


# ------------------------------------------------------------------------------------------------------------- sheets

def headline(shot: str, source: str, reference: str, frame: dict[str, Any]) -> str:
    parts = [f"{shot}", f"{source} vs {reference}"]
    for key, label, fmt in (("ssim", "ssim", ".4f"), ("deltaENorm", "dE norm", ".2f"), ("exposureEV", "EV", "+.2f"), ("edgeF1", "edge F1", ".3f")):
        if isinstance(frame.get(key), (int, float)):
            parts.append(f"{label} {frame[key]:{fmt}}")
    return " | ".join(parts)


def pair_sheet(shot_dir: Path, shot: str, source: str, reference: str, frame: dict[str, Any] | None = None,
               max_width: int = 2000, grid: tuple[int, int] | None = None, edge_tolerance: int = 2):
    from PIL import Image

    files = [pl.pass_file(shot_dir, reference), pl.pass_file(shot_dir, source)]
    absent = [f.name for f in files if not f.is_file()]
    if absent:
        raise pl.PlError(f"{shot}: missing pass: {', '.join(absent)}")
    ref, size = cmp.load_u8(files[0])
    cand, _ = cmp.load_u8(files[1], size)
    an = cmp.analyse(ref, cand, edge_tolerance, {"ssim": False, "detail": False})
    margin = 18 if grid else 0
    panel_w = min(size[0], (max_width - 3 * GAP - 2 * margin) // 2)
    scale = panel_w / size[0]
    ev = an["frame"]["exposureEV"]
    panels = [
        (Image.fromarray(ref), reference),
        (Image.fromarray(cand), source),
        # two pixels wide on the finished sheet: at one pixel a line's colour cannot be told, by eye or by model
        (edge_overlay(ref, an["maps"], math.ceil(2 / scale)),
         f"edges: white = both, magenta = {reference} only, green = {source} only (within {edge_tolerance} px)"),
        (heat_image(an["maps"]["deltaENorm"]), f"dE2000 after normalising {source} ({ev:+.2f} EV and white balance removed)"),
    ]
    tiles = []
    for im, label in panels:
        im = scaled(im, scale)
        tiles.append(labelled(with_grid(im, *grid) if grid else im, label))
    legend = heat_legend(tiles[3].width)
    spacer = Image.new("RGB", (tiles[2].width, legend.height), BG)
    sheet = stack([stack([tiles[0], tiles[2], spacer], False), stack([tiles[1], tiles[3], legend], False)], True)
    return framed(sheet, headline(shot, source, reference, frame or an["frame"]))


def row_sheet(paths: list[str], labels: list[str] | None, max_width: int, horizontal: bool = True,
              box: tuple[float, float, float, float] | None = None, zoom: float = 1.0):
    """Pictures at one height side by side (or at one width, stacked), each under its label; optionally one box of each."""
    if labels and len(labels) != len(paths):
        raise pl.PlError(f"{len(paths)} pictures but {len(labels)} labels")
    images = [open_rgb(p) for p in paths]
    if box:
        # the box is in 0..1 of each picture, so pictures of different sizes show the same part of the frame
        x0, y0, x1, y1 = box
        images = [im.crop((round(x0 * im.width), round(y0 * im.height), max(round(x0 * im.width) + 1, round(x1 * im.width)),
                           max(round(y0 * im.height) + 1, round(y1 * im.height)))) for im in images]
    if zoom != 1.0:
        images = [scaled(im, zoom) for im in images]
    labels = labels or [Path(p).name for p in paths]
    room = max_width - 2 * GAP
    if horizontal:
        h = min(im.height for im in images)
        widths = [im.width * h / im.height for im in images]
        k = min(1.0, (room - GAP * (len(images) - 1)) / sum(widths))
        tiles = [scaled(im, h * k / im.height) for im in images]
    else:
        w = min(room, min(im.width for im in images))
        tiles = [scaled(im, w / im.width) for im in images]
    return framed(stack([labelled(t, lab) for t, lab in zip(tiles, labels)], horizontal))


def contact_sheet(paths: list[str], every: int, cols: int | None, fps: float | None, max_width: int):
    files: list[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(f for f in p.iterdir() if f.suffix.lower() in IMAGE_SUFFIXES)
        else:
            files.append(p)
    if not files:
        raise pl.PlError("no frames: give pictures or a folder of them")
    picked = list(enumerate(files))[::max(1, every)]
    cols = cols or max(1, min(len(picked), (max_width - 2 * GAP) // 320))
    cell_w = (max_width - 2 * GAP - GAP * (cols - 1)) // cols
    tiles = []
    for index, f in picked:
        im = open_rgb(f)
        # the file's own number when it has one (frames/000120.png), else its place in the list
        label = f"#{int(f.stem)}" if f.stem.isdigit() else f"#{index} {f.stem}"
        if fps:
            label += f"  {index / fps:.2f} s"
        tiles.append(labelled(scaled(im, min(1.0, cell_w / im.width)), label))
    rows = [stack(tiles[i:i + cols], True) for i in range(0, len(tiles), cols)]
    note = f"{len(picked)} of {len(files)} frames" + (f", every {every}" if every > 1 else "") + (f", {fps:g} fps" if fps else "")
    return framed(stack(rows, False), note)


def crop_sheet(shot_dir: Path, shot: str, sources: list[str], box: tuple[float, float, float, float], zoom: float, max_width: int):
    x0, y0, x1, y1 = box
    crops = []
    for s in sources:
        im = open_rgb(pl.pass_file(shot_dir, s))
        # the box is in 0..1 of each picture, so sources of different sizes show the same part of the frame
        crops.append(im.crop((round(x0 * im.width), round(y0 * im.height), max(round(x0 * im.width) + 1, round(x1 * im.width)),
                              max(round(y0 * im.height) + 1, round(y1 * im.height)))))
    h = min(c.height for c in crops) * zoom
    widths = [c.width * h / c.height for c in crops]
    k = min(1.0, (max_width - 2 * GAP - GAP * (len(crops) - 1)) / sum(widths))
    tiles = [labelled(scaled(c, h * k / c.height), s) for c, s in zip(crops, sources)]
    shown = zoom * k
    return framed(stack(tiles, True), f"{shot} | box {x0:g},{y0:g},{x1:g},{y1:g} | zoom {shown:.3g}x" + ("" if k == 1 else " (limited by --max-width)"))


def diff_sheet(a: str, b: str, max_width: int):
    ref, size = cmp.load_u8(Path(a))
    other, _ = cmp.load_u8(Path(b), size)
    an = cmp.analyse(ref, other, want={"ssim": False, "edges": False, "detail": False})
    heat = scaled(heat_image(an["maps"]["deltaENorm"]), min(1.0, (max_width - 2 * GAP) / size[0]))
    head = (f"dE2000, {Path(b).name} against {Path(a).name}, after normalising {an['frame']['exposureEV']:+.2f} EV and white balance: "
            f"mean {an['frame']['deltaENorm']:.2f} (before: {an['frame']['deltaE']:.2f})")
    return framed(stack([heat, heat_legend(heat.width)], False), head), an["frame"]


# ----------------------------------------------------------------------------------------------------------------- cli

def _grid(text: str) -> tuple[int, int]:
    try:
        cols, rows = (int(v) for v in text.lower().split("x"))
        if not (1 <= cols <= 52 and 1 <= rows <= 99):
            raise ValueError
        return cols, rows
    except ValueError:
        raise argparse.ArgumentTypeError("a grid is COLSxROWS, e.g. 8x6") from None


def _box(text: str) -> tuple[float, float, float, float]:
    try:
        x0, y0, x1, y1 = (float(v) for v in text.split(","))
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise ValueError
        return x0, y0, x1, y1
    except ValueError:
        raise argparse.ArgumentTypeError("a box is x0,y0,x1,y1 in 0..1 with x0 < x1 and y0 < y1") from None


def default_out(root: Path, run: str | None, shot: str | None, name: str) -> Path:
    base = pl.runs_dir(root) / (run or "sheets")
    return base / shot / name if shot else base / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.png"


def main(argv: list[str] | None = None) -> int:
    gr.utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--out", metavar="FILE", help="where to write the sheet (default: under .perceptual-loop/runs/)")
    common.add_argument("--max-width", type=int, default=2000, metavar="PX", help="the sheet's largest width (default 2000: readable by a vision model)")
    common.add_argument("--jpeg", action="store_true", help="write a JPEG (smaller) instead of a PNG")
    common.add_argument("--json", action="store_true", help='print one JSON document ({"sheet": path}; diff adds its numbers) and nothing else')
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="{pair,triptych,strip,contact,crop,diff}")

    p = sub.add_parser("pair", parents=[common], help="reference | candidate, edge overlay and colour-difference heat map")
    p.add_argument("shot", metavar="SHOT")
    p.add_argument("--source", metavar="ID", help="the candidate (default: the config's first)")
    p.add_argument("--run", metavar="RUN", help="the run whose metrics go in the header, and where the sheet is written")
    p.add_argument("--grid", type=_grid, metavar="COLSxROWS", help="draw a lettered and numbered grid, so a cell can be named in text (C4)")
    p.add_argument("--edge-tolerance", type=int, default=2, metavar="PX", help="as in compare.py (default 2)")

    for name, text in (("triptych", "pictures side by side at one height (reference | before | after)"), ("strip", "pictures stacked at one width")):
        p = sub.add_parser(name, parents=[common], help=text)
        p.add_argument("--images", nargs="+", required=True, metavar="FILE")
        p.add_argument("--labels", nargs="+", metavar="TEXT", help="one per picture (default: the file names)")
        p.add_argument("--box", type=_box, metavar="x0,y0,x1,y1", help="show only this part of every picture, in 0..1 of the frame")
        p.add_argument("--zoom", type=float, default=1.0, metavar="K", help="enlarge by K before fitting (default 1)")

    p = sub.add_parser("contact", parents=[common], help="a grid of frames with their numbers and times")
    p.add_argument("frames", nargs="+", metavar="PATH", help="pictures, or a folder of them (sorted by name)")
    p.add_argument("--every", type=int, default=1, metavar="N", help="take every Nth frame (default 1)")
    p.add_argument("--cols", type=int, metavar="C", help="columns (default: as many as stay 320 px wide)")
    p.add_argument("--fps", type=float, metavar="F", help="label each frame with its time at this rate")

    p = sub.add_parser("crop", parents=[common], help="one box of a shot from every source, side by side")
    p.add_argument("shot", metavar="SHOT")
    p.add_argument("--box", type=_box, required=True, metavar="x0,y0,x1,y1", help="the part to show, in 0..1 of the frame")
    p.add_argument("--zoom", type=float, default=1.0, metavar="K", help="enlarge by K, pixels kept square and unsmoothed (default 1)")
    p.add_argument("--source", action="append", metavar="ID", help="sources to show (repeatable; default: the reference and every candidate that has the shot)")
    p.add_argument("--run", metavar="RUN", help="write the sheet into this run's folder")

    p = sub.add_parser("diff", parents=[common], help="the colour-difference heat map of two pictures, nothing else")
    p.add_argument("a", metavar="A")
    p.add_argument("b", metavar="B")
    p.add_argument("--max-delta-e", type=float, metavar="V", help="exit 1 when the mean colour difference after normalisation exceeds V (two runs of one shot: 0.5 is a sensible bound)")

    args = ap.parse_args(argv)
    try:
        root = pl.find_root()
        config = pl.load_config(root)
        if args.cmd == "pair":
            shot = pl.resolve_shots([args.shot], root=root, config=config)[0]
            source = args.source or config["candidates"][0]
            metrics = pl.read_json(cmp.metrics_file(pl.runs_dir(root) / args.run, shot, source)) if args.run else None
            sheet = pair_sheet(pl.shot_path(shot, root, config), shot, source, config["reference"], (metrics or {}).get("frame"),
                               args.max_width, args.grid, args.edge_tolerance)
            out = default_out(root, args.run, shot, f"pair.{source}.png")
        elif args.cmd in ("triptych", "strip"):
            sheet = row_sheet(args.images, args.labels, args.max_width, horizontal=args.cmd == "triptych", box=args.box, zoom=args.zoom)
            out = default_out(root, None, None, args.cmd)
        elif args.cmd == "contact":
            sheet = contact_sheet(args.frames, args.every, args.cols, args.fps, args.max_width)
            out = default_out(root, None, None, "contact")
        elif args.cmd == "crop":
            shot = pl.resolve_shots([args.shot], root=root, config=config)[0]
            shot_dir = pl.shot_path(shot, root, config)
            sources = args.source or [s for s in [config["reference"], *config["candidates"]] if pl.pass_file(shot_dir, s).is_file()]
            if not sources:
                raise pl.PlError(f"{shot} has no beauty pass of any source")
            sheet = crop_sheet(shot_dir, shot, sources, args.box, args.zoom, args.max_width)
            out = default_out(root, args.run, shot, "crop." + "-".join(f"{v:g}" for v in args.box) + ".png")
        else:
            for f in (args.a, args.b):
                if not Path(f).is_file():
                    raise pl.PlError(f"no such picture: {f}")
            sheet, numbers = diff_sheet(args.a, args.b, args.max_width)
            out = default_out(root, None, None, "diff")
        out = save(sheet, Path(args.out).resolve() if args.out else out, args.jpeg)
    except pl.PlError as e:
        pl.fail(str(e))
    doc: dict[str, Any] = {"sheet": str(out)}
    text = str(out)
    code = 0
    if args.cmd == "diff":
        # the numbers the heat map is drawn from, so a step can gate on them instead of reading a picture
        doc.update({k: numbers[k] for k in ("deltaE", "deltaENorm", "exposureEV")})
        lines = [text, f"mean dE {numbers['deltaE']:.3f}, after normalisation {numbers['deltaENorm']:.3f}, exposure {numbers['exposureEV']:+.3f} EV"]
        if args.max_delta_e is not None:
            doc["passed"] = numbers["deltaENorm"] <= args.max_delta_e
            code = 0 if doc["passed"] else 1
            lines.append(f"gate (mean dE after normalisation <= {args.max_delta_e:g}): {'passed' if doc['passed'] else 'FAILED'}")
        text = "\n".join(lines)
    pl.emit(doc, args.json, text)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
