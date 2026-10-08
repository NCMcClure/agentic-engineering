# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "opencv-python-headless>=4.8", "Pillow>=10.1"]
# ///
"""flow.py: which way, how fast and how coherently do the pixels move between consecutive frames?

Dense optical flow (Farnebäck's polynomial-expansion method, as in OpenCV) between each pair of consecutive frames of
a clip (frames folder, video file, or a shot's clip). For the frame and for each named region, per pair and
summarised over the clip:

  mean        the mean flow vector, in pixels of the original frame per frame step
  mag         the mean length of the flow vectors (same unit)
  direction   of the summed vectors of the moving pixels, in degrees: 0 = right, 90 = DOWN, 180 = left, 270 = up
              (image space: +x right, +y down)
  coherence   |sum of vectors| / sum of |vectors| over the moving pixels: 1 = all the same way, 0 = every way
  moving      the share of pixels whose flow is longer than --min-mag

With --against (or --ref-frames / --ref-video) the same is measured on a reference clip and compared pair by pair:
angular error of the direction and the ratio of the magnitudes. Expectations are gates: --expect-direction,
--expect-static, --expect-moving. Writes a sheet (arrows on a grid, and direction as colour) and a JSON report.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import math
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import video as V  # noqa: E402


def gray8(path: Path, size: int):
    import numpy as np

    rgb = V.load_rgb(path, size)
    return (V.luma(rgb) * 255 + 0.5).astype(np.uint8)


def flows(seq: dict[str, Any], size: int):
    """Yields (frame the motion arrives at, flow in ORIGINAL-frame pixels, the earlier frame's gray picture)."""
    import cv2
    import numpy as np
    from PIL import Image

    with Image.open(seq["frames"][0]["path"]) as im:
        full_w = im.width
    prev = gray8(seq["frames"][0]["path"], size)
    scale = full_w / prev.shape[1]
    for f in seq["frames"][1:]:
        cur = gray8(f["path"], size)
        if cur.shape != prev.shape:
            pl.fail(f"frames of {seq['label']} change size at frame {f['index']}")
        # Farnebäck: dense, deterministic, no model to download. pyramid 0.5 x 4 levels reaches motions of a few
        # dozen analysed pixels; window 15 averages over that neighbourhood, so thin things and textureless areas
        # get the flow of what surrounds them (or none)
        fl = cv2.calcOpticalFlowFarneback(prev, cur, None, 0.5, 4, 15, 3, 5, 1.2, 0)
        yield f, fl.astype(np.float32) * scale, prev
        prev = cur


def measure(fl, min_mag: float) -> dict[str, float | None]:
    import numpy as np

    v = fl.reshape(-1, 2)
    mag = np.linalg.norm(v, axis=1)
    mov = mag > min_mag
    s = v[mov].sum(0) if mov.any() else np.zeros(2)
    return {"dx": float(v[:, 0].mean()), "dy": float(v[:, 1].mean()), "mag": float(mag.mean()),
            "direction": float(math.degrees(math.atan2(s[1], s[0])) % 360) if mov.any() and np.linalg.norm(s) > 1e-9 else None,
            "coherence": float(np.linalg.norm(s) / mag[mov].sum()) if mov.any() else None, "moving": float(mov.mean()),
            "_sx": float(s[0]), "_sy": float(s[1])}


def angle_between(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Over the clip: medians (one odd pair does not move them), and the direction of all moving vectors summed."""
    import numpy as np

    sx, sy = sum(r["_sx"] for r in rows), sum(r["_sy"] for r in rows)
    coh = [r["coherence"] for r in rows if r["coherence"] is not None]
    return {"dx": float(np.median([r["dx"] for r in rows])), "dy": float(np.median([r["dy"] for r in rows])),
            "mag": float(np.median([r["mag"] for r in rows])), "magMax": float(max(r["mag"] for r in rows)),
            "direction": float(math.degrees(math.atan2(sy, sx)) % 360) if math.hypot(sx, sy) > 1e-9 else None,
            "coherence": float(np.median(coh)) if coh else None, "moving": float(np.median([r["moving"] for r in rows]))}


def analyse(seq: dict[str, Any], regions: dict[str, list[float]], args, keep: int):
    """-> (per-pair rows {region: [..]}, frames, a few (frame, flow, gray) kept for the sheet)"""
    n = len(seq["frames"]) - 1
    if n < 1:
        pl.fail(f"{seq['label']}: optical flow needs at least two frames")
    want = {round(i * (n - 1) / max(1, keep - 1)) for i in range(min(keep, n))}
    rows: dict[str, list[dict[str, Any]]] = {name: [] for name in ("frame", *regions)}
    kept, frames = [], []
    for k, (f, fl, g) in enumerate(flows(seq, args.size)):
        h, w = fl.shape[:2]
        frames.append(f["index"])
        rows["frame"].append(measure(fl, args.min_mag))
        for name, box in regions.items():
            rows[name].append(measure(fl[V.region_slice(box, h, w)], args.min_mag))
        if k in want:
            kept.append((f, fl, g))
    return rows, frames, kept


# ------------------------------------------------------------------------------------------------------------ sheet

def wheel(d: int = 72):
    """The key of the colour picture: hue = direction, at the place on the disc the motion points to."""
    import cv2
    import numpy as np

    y, x = np.mgrid[-1:1:d * 1j, -1:1:d * 1j]
    r = np.hypot(x, y)
    hsv = np.stack([(np.degrees(np.arctan2(y, x)) % 360) / 2, np.full_like(r, 255), np.clip(r, 0, 1) * 255], -1).astype(np.uint8)
    rgb = cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB)
    rgb[r > 1] = V.BG
    return rgb


def draw(fl, gray, top: float):
    """(arrows over the dimmed frame, direction as hue and speed as brightness), both as RGB arrays."""
    import cv2
    import numpy as np

    h, w = gray.shape
    base = cv2.cvtColor((gray * 0.55).astype(np.uint8), cv2.COLOR_GRAY2RGB)
    up = max(1, round(720 / w))  # draw large enough for thin arrows to read
    base = cv2.resize(base, (w * up, h * up), interpolation=cv2.INTER_NEAREST)
    step = max(8, w // 28)
    gain = step / max(top, 1e-6)  # the fastest motion of the clip draws one grid step long
    for y in range(step // 2, h, step):
        for x in range(step // 2, w, step):
            dx, dy = fl[y, x] * gain
            if math.hypot(dx, dy) < 0.08 * step:
                cv2.circle(base, (x * up, y * up), 1, (90, 90, 95), -1)
            else:
                cv2.arrowedLine(base, (x * up, y * up), (round((x + dx) * up), round((y + dy) * up)), (255, 220, 60), max(1, up), cv2.LINE_AA, tipLength=0.35)
    mag = np.linalg.norm(fl, axis=2)
    hsv = np.stack([(np.degrees(np.arctan2(fl[..., 1], fl[..., 0])) % 360) / 2, np.full_like(mag, 255), np.clip(mag / max(top, 1e-6), 0, 1) * 255], -1).astype(np.uint8)
    colour = cv2.resize(cv2.cvtColor(hsv, cv2.COLOR_HSV2RGB), (w * up, h * up), interpolation=cv2.INTER_NEAREST)
    key = wheel()
    colour[4:4 + key.shape[0], 4:4 + key.shape[1]] = key
    return base, colour


def sheet(kept, ref_kept, rows, label: str, ref_label: str | None, max_width: int):
    import numpy as np
    from PIL import Image

    top = float(np.percentile(np.concatenate([np.linalg.norm(fl, axis=2).ravel() for _, fl, _ in kept + (ref_kept or [])]), 99.5))
    cols = 3 if ref_kept else 2
    tw = (min(max_width, 1800) - 4 * (cols + 1)) // cols
    tiles = []
    for i, (f, fl, g) in enumerate(kept):
        arrows, colour = draw(fl, g, top)
        tiles.append(V.tile(Image.fromarray(arrows), f"motion into {V.frame_caption(f)} (drawn on the frame before)", tw))
        tiles.append(V.tile(Image.fromarray(colour), "hue = direction (see disc), brightness = speed", tw))
        if ref_kept:
            if i < len(ref_kept):
                tiles.append(V.tile(Image.fromarray(draw(ref_kept[i][1], ref_kept[i][2], top)[0]), f"reference {V.frame_caption(ref_kept[i][0])}", tw, (140, 220, 255)))
            else:
                tiles.append(Image.new("RGB", (tw, 10), V.BG))
    title = f"flow (Farneback)   {label}" + (f"   vs {ref_label}" if ref_label else "") + f"   longest arrow = {top:.2f} px/frame   0° right, 90° down"
    return V.grid(tiles, cols, title=title)


# -------------------------------------------------------------------------------------------------------------- run

def public(d: dict[str, Any]) -> dict[str, Any]:
    return {k: (None if v is None else round(v, 4)) for k, v in d.items() if not k.startswith("_")}


def name_value(spec: str, flag: str) -> tuple[str, float]:
    name, _, v = spec.rpartition("=")
    try:
        return name or "frame", float(v)
    except ValueError:
        pl.fail(f"{flag} {spec!r}: expected DEGREES or REGION=DEGREES")


def flow(args) -> tuple[dict[str, Any], str, int]:
    import numpy as np

    plain = bool(args.frames or args.video)
    shot = None if plain else args.shot
    seq = V.sequence_from_args(args, what="flow")
    regions = V.parse_regions(args.region, shot)
    rows, frames, kept = analyse(seq, regions, args, args.sheet_frames)
    summary = {name: summarise(r) for name, r in rows.items()}
    notes: list[str] = []
    failed: list[str] = []

    def region(name: str, flag: str) -> dict[str, Any]:
        if name not in summary:
            pl.fail(f"{flag} {name}: no such region (have: {', '.join(summary)})")
        return summary[name]

    for spec in args.expect_direction or []:
        name, want = name_value(spec, "--expect-direction")
        got = region(name, "--expect-direction")["direction"]
        if got is None:
            failed.append(f"{name}: expected motion towards {want:g}°, but nothing moves (no flow above --min-mag {args.min_mag:g})")
        elif angle_between(got, want) > args.tolerance:
            failed.append(f"{name}: direction {got:.1f}° is {angle_between(got, want):.1f}° from the expected {want:g}° (tolerance {args.tolerance:g}°)")
    for name in args.expect_static or []:
        m = region(name, "--expect-static")
        if m["magMax"] > args.static_below:
            failed.append(f"{name}: expected static, but its mean flow reaches {m['magMax']:.3f} px/frame (> --static-below {args.static_below:g})")
    for name in args.expect_moving or []:
        m = region(name, "--expect-moving")
        if m["mag"] < args.moving_above:
            failed.append(f"{name}: expected moving, but its median mean flow is {m['mag']:.3f} px/frame (< --moving-above {args.moving_above:g})")

    doc: dict[str, Any] = {"input": seq["label"], "method": "Farnebäck dense optical flow (OpenCV), on luma at long side " + str(args.size),
                           "unit": "pixels of the original frame per frame step; direction in degrees, 0 = right, 90 = down",
                           "pairs": len(frames), "summary": {k: public(v) for k, v in summary.items()}}
    ref_kept, ref_label, against = None, None, None
    ref_path = args.ref_frames or args.ref_video
    if ref_path or args.against:
        ref = V.open_sequence(ref_path, shot=None if ref_path else args.shot, source=None if ref_path else args.against, rate=args.rate, every=args.every, what="reference")
        ref_label = ref["label"]
        ref_rows, _, ref_kept = analyse(ref, regions, args, args.sheet_frames)
        against = {}
        for name in rows:
            n = min(len(rows[name]), len(ref_rows[name]))
            ang = [angle_between(a["direction"], b["direction"]) for a, b in zip(rows[name][:n], ref_rows[name][:n]) if a["direction"] is not None and b["direction"] is not None]
            ratio = [a["mag"] / b["mag"] for a, b in zip(rows[name][:n], ref_rows[name][:n]) if b["mag"] > args.min_mag * 0.1]
            against[name] = {"pairs": n, "angularError": round(float(np.median(ang)), 3) if ang else None, "angularErrorMax": round(float(max(ang)), 3) if ang else None,
                             "magRatio": round(float(np.median(ratio)), 4) if ratio else None, "reference": public(summarise(ref_rows[name]))}
            a = against[name]
            if args.max_angle_error is not None and a["angularError"] is not None and a["angularError"] > args.max_angle_error:
                failed.append(f"{name}: direction differs from the reference by {a['angularError']:.1f}° (median) > --max-angle-error {args.max_angle_error:g}")
            if args.mag_tolerance is not None and a["magRatio"] is not None and abs(a["magRatio"] - 1) * 100 > args.mag_tolerance:
                failed.append(f"{name}: speed is {a['magRatio']:.2f}x the reference's, outside ±{args.mag_tolerance:g} %")
        if len(frames) != len(ref_rows["frame"]):
            notes.append(f"the clips differ in length ({len(frames)} and {len(ref_rows['frame'])} pairs): compared pair by pair from the start")
        doc["against"] = {"reference": ref_label, "regions": against}
    doc.update({"notes": notes, "gate": {"passed": not failed, "failed": failed}})
    d = V.out_dir(args, shot, need=False)
    if d:
        stem = f"flow.{V.default_source(args)}" if shot else "flow"
        doc["sheet"] = str(V.save_sheet(sheet(kept, ref_kept, rows, seq["label"], ref_label, args.max_width), d / f"{stem}.png", args.max_width))
        doc["report"] = str(d / f"{stem}.json")
        pl.write_json(d / f"{stem}.json", {**doc, "frames": frames, "perPair": {k: [public(r) for r in v] for k, v in rows.items()}})
    else:
        notes.append("no --out and no .perceptual-loop/ here: no sheet or report written")

    def line(name: str, m: dict[str, Any]) -> str:
        dirn = "no motion" if m["direction"] is None else f"{m['direction']:6.1f}°"
        coh = "  -  " if m["coherence"] is None else f"{m['coherence']:.2f}"
        return f"  {name:<{w}}  mean ({m['dx']:+.2f}, {m['dy']:+.2f})  mag {m['mag']:.3f}  direction {dirn}  coherence {coh}  moving {m['moving'] * 100:.0f} %"

    w = max(len(n) for n in summary)
    lines = [f"flow of {seq['label']}: {len(frames)} frame pairs, Farnebäck; px of the original frame per frame; 0° = right, 90° = down"]
    lines += [line(n, m) for n, m in summary.items()]
    if against:
        lines.append(f"against {ref_label}:")
        lines += [f"  {n:<{w}}  angular error {('%.1f°' % a['angularError']) if a['angularError'] is not None else 'n/a (one of them does not move)'}"
                  f"   speed ratio {('%.2fx' % a['magRatio']) if a['magRatio'] is not None else 'n/a'}" for n, a in against.items()]
    lines += [f"  note: {n}" for n in notes]
    if "sheet" in doc:
        lines.append(f"  sheet: {doc['sheet']}\n  report: {doc['report']}")
    lines += [f"  GATE FAILED: {f}" for f in failed]
    return doc, "\n".join(lines), 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def synth(d: Path, dx: int, dy: int, n: int = 8, seed: int = 1) -> None:
    """A textured square moving (dx, dy) per frame in the top half of a still textured ground. Texture matters:
    flow cannot be measured inside a flat colour."""
    import numpy as np
    from PIL import Image

    rng = np.random.default_rng(seed)
    blur = lambda a: np.asarray(Image.fromarray(a).resize((a.shape[1] * 4, a.shape[0] * 4), Image.BICUBIC))  # noqa: E731
    ground = blur(rng.integers(40, 120, (60, 80), dtype=np.uint8))
    patch = blur(rng.integers(120, 255, (15, 15), dtype=np.uint8))
    d.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        im = ground.copy()
        x, y = 60 + dx * i, 30 + dy * i
        im[y:y + 60, x:x + 60] = patch
        Image.fromarray(im).save(d / f"{i + 1:06d}.png")


def self_test() -> int:
    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    with tempfile.TemporaryDirectory(prefix="pl-flow-test-") as t:
        tmp = Path(t)
        synth(tmp / "right", 5, 0)
        synth(tmp / "down", 0, 5)
        synth(tmp / "slow", 2, 0)
        reg = ["--region", "top=0,0,1,0.5", "--region", "bottom=0,0.6,1,1", "--out", str(tmp / "out")]
        _, d, _, code = run(["--frames", str(tmp / "right"), *reg, "--expect-direction", "0", "--expect-static", "bottom", "--expect-moving", "top"])
        s = d["summary"]
        check("a square moving right: direction near 0°, coherent", s["frame"]["direction"] is not None and angle_between(s["frame"]["direction"], 0) < 5 and s["frame"]["coherence"] > 0.9,
              f"direction {s['frame']['direction']}°, coherence {s['frame']['coherence']}")
        check("its expectations pass (direction 0°, bottom static, top moving) and a sheet is written", code == 0 and Path(d["sheet"]).is_file(),
              f"top mag {s['top']['mag']}, bottom mag {s['bottom']['mag']} px/frame; {d['gate']['failed']}")
        _, d, _, code = run(["--frames", str(tmp / "down"), *reg, "--expect-direction", "0"])
        check("moving down: direction near 90° (+y is down), and expecting 0° fails the gate", angle_between(d["summary"]["frame"]["direction"], 90) < 5 and code == 1,
              f"direction {d['summary']['frame']['direction']}°, exit {code}")
        _, d, _, code = run(["--frames", str(tmp / "right"), *reg, "--expect-static", "top"])
        check("expecting the moving region to be static fails", code == 1, f"exit {code}")
        _, d, _, _ = run(["--frames", str(tmp / "slow"), "--ref-frames", str(tmp / "right"), *reg])
        a = d["against"]["regions"]["top"]
        check("against a reference moving 2.5x as fast: same direction, speed ratio near 0.4", a["angularError"] < 5 and 0.3 < a["magRatio"] < 0.5,
              f"angular error {a['angularError']}°, ratio {a['magRatio']}")
        _, d, _, code = run(["--frames", str(tmp / "down"), "--ref-frames", str(tmp / "right"), *reg, "--max-angle-error", "20"])
        check("against a reference moving the other way: about 90° of angular error, gate fails", 80 < d["against"]["regions"]["top"]["angularError"] < 100 and code == 1,
              f"angular error {d['against']['regions']['top']['angularError']}°")
    print("flow.py self-test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers do not mean
  Optical flow is the apparent motion of brightness patterns, not of objects. It is blind inside flat colours and
  along straight edges (only the part of the motion across an edge is seen), it reads a moving shadow, a
  reflection or a flickering light as motion, and it underestimates anything faster than a few dozen analysed
  pixels per frame (raise --size or lower the step between frames). A mean over a region mixes the subject with
  its still background, so `mag` is smaller than the subject's own speed: `direction` and `coherence` use the
  moving pixels only. Use the numbers as a gate between runs of the same shot and the sheet to see what moved.

exit codes: 0 done (gates passed), 1 an expectation or gate failed, 2 usage or environment error"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="flow.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter, parents=[V.common_parent()])
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks on synthetic frames and exit")
    g = ap.add_argument_group("measurement")
    g.add_argument("--region", action="append", metavar="NAME=x0,y0,x1,y1", help="a named box in fractions of the frame, origin top left; repeatable (a shot's shot.json regions are used too). `frame` is always there")
    g.add_argument("--size", type=int, default=480, help="frames are reduced to this long side before the flow is computed (default 480); results are scaled back to original pixels")
    g.add_argument("--min-mag", type=float, default=0.25, help="a pixel counts as moving above this flow length, in original pixels per frame (default 0.25)")
    g.add_argument("--sheet-frames", type=int, default=4, help="how many frame pairs the sheet shows, spread over the clip (default 4)")
    g = ap.add_argument_group("reference (optional)")
    g.add_argument("--against", metavar="SOURCE", help="with --shot: the source whose clip is the reference")
    g.add_argument("--ref-frames", metavar="DIR", help="a folder of reference frames")
    g.add_argument("--ref-video", metavar="FILE", help="a reference video file")
    g.add_argument("--max-angle-error", type=float, metavar="DEG", help="gate: largest allowed median angle between the candidate's and the reference's direction, per region")
    g.add_argument("--mag-tolerance", type=float, metavar="PCT", help="gate: the candidate's speed must be within this many percent of the reference's, per region")
    g = ap.add_argument_group("expectations (gates, exit 1 when not met)")
    g.add_argument("--expect-direction", action="append", metavar="[REGION=]DEG", help="the motion should point this way (0 right, 90 down, 180 left, 270 up), within --tolerance; repeatable")
    g.add_argument("--tolerance", type=float, default=15.0, metavar="DEG", help="allowed deviation for --expect-direction (default 15)")
    g.add_argument("--expect-static", action="append", metavar="REGION", help="the region's mean flow must stay below --static-below in every pair; repeatable")
    g.add_argument("--expect-moving", action="append", metavar="REGION", help="the region's median mean flow must be at least --moving-above; repeatable")
    g.add_argument("--static-below", type=float, default=0.3, metavar="PX", help="default 0.3 px/frame")
    g.add_argument("--moving-above", type=float, default=0.5, metavar="PX", help="default 0.5 px/frame")
    return ap


def run(argv: list[str] | None = None):
    V.utf8_stdio()
    args = build_parser().parse_args(argv)
    if args.self_test:
        raise SystemExit(self_test())
    try:
        doc, text, code = flow(args)
    except pl.PlError as e:
        pl.fail(str(e))
    return args, doc, text, code


def main() -> None:
    args, doc, text, code = run()
    pl.emit(doc, args.json, text)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
