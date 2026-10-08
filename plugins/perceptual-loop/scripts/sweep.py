# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "Pillow>=10.1"]
# ///
"""sweep.py: is a sequence smooth over time?

Reads a clip (frames folder, video file, or a shot's clip) and/or a table of per-frame values, makes one series per
quantity, and looks for what an eye catches in motion but no single frame shows:

  jump      a step between consecutive frames far above the local rate of change (a pop, a snap, a missed blend)
  flicker   energy of the second difference (a value that wobbles frame to frame)
  direction a value expected to rise, fall or hold that does not (--expect)
  judder    uneven steps of a motion that should be even, and repeated / dropped frames (--positions or --track)

From frames the series are, for the whole frame and each region: mean luma and mean R, G, B of the display-encoded
picture (names `frame.luma`, `<region>.r` …). From --values they are the columns of a CSV or JSONL file (a probe's
read-back of the real value is a better series than any pixel mean). Writes a plot and a JSON report.
"""
from __future__ import annotations

import sys

sys.dont_write_bytecode = True

import argparse
import csv
import fnmatch
import json
import math
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import video as V  # noqa: E402


# ----------------------------------------------------------------------------------------------------------- inputs

def read_table(path: str | Path) -> dict[str, list[float]]:
    """A CSV (with or without a header row) or a JSONL file of objects/arrays -> {column: values}; non-numbers are NaN."""
    path = Path(path)
    if not path.is_file():
        pl.fail(f"no such file: {path}")

    def num(x: Any) -> float:
        try:
            return float(x)
        except (TypeError, ValueError):
            return math.nan

    text = path.read_text(encoding="utf-8-sig").strip()
    if not text:
        pl.fail(f"{path} is empty")
    cols: dict[str, list[float]] = {}
    if text[0] in "{[":
        for line in text.splitlines():
            if line.strip():
                row = json.loads(line)
                for k, v in (row.items() if isinstance(row, dict) else ((f"c{i}", v) for i, v in enumerate(row))):
                    if isinstance(v, (list, tuple)):  # {"pos": [x, y, z]} -> pos.0, pos.1, pos.2
                        for j, e in enumerate(v):
                            cols.setdefault(f"{k}.{j}", []).append(num(e))
                    else:
                        cols.setdefault(k, []).append(num(v))
    else:
        rows = [r for r in csv.reader(text.splitlines()) if r]
        header = any(math.isnan(num(c)) for c in rows[0])
        names = [c.strip() for c in rows[0]] if header else [f"c{i}" for i in range(len(rows[0]))]
        for r in rows[1 if header else 0:]:
            for name, c in zip(names, r):
                cols.setdefault(name, []).append(num(c))
    n = max(len(v) for v in cols.values())
    return {k: v for k, v in cols.items() if len(v) == n and not all(math.isnan(x) for x in v)}


def pick_columns(table: dict[str, list[float]], wanted: str | None, what: str) -> list[str]:
    if not wanted:
        return list(table)
    names = [c.strip() for c in wanted.split(",")]
    missing = [c for c in names if c not in table]
    if missing:
        pl.fail(f"{what}: no column {', '.join(missing)} (have: {', '.join(table)})")
    return names


def image_series(seq: dict[str, Any], regions: dict[str, list[float]], mask_path: str | None, track: str | None, size: int, thr: float):
    """-> (series {name: [v per frame]}, positions or None, identical-frame indices, notes)"""
    import numpy as np
    from PIL import Image

    series: dict[str, list[float]] = {}
    grays, notes, mask = [], [], None
    for f in seq["frames"]:
        rgb = V.load_rgb(f["path"], size)
        h, w = rgb.shape[:2]
        if mask_path and mask is None:
            with Image.open(mask_path) as im:
                mask = np.asarray(im.convert("L").resize((w, h), Image.BOX)) > 127
            if not mask.any():
                pl.fail(f"--mask {mask_path} has no white pixel")
        areas = {"frame": rgb.reshape(-1, 3), **{n: rgb[V.region_slice(b, h, w)].reshape(-1, 3) for n, b in regions.items()}}
        if mask is not None and mask.shape == (h, w):
            areas["mask"] = rgb[mask]
        for name, px in areas.items():
            m = px.mean(0)
            for key, v in (("luma", float(V.luma(m))), ("r", float(m[0])), ("g", float(m[1])), ("b", float(m[2]))):
                series.setdefault(f"{name}.{key}", []).append(v)
        grays.append(V.luma(rgb))
    same = [seq["frames"][i + 1]["index"] for i in range(len(grays) - 1)
            if grays[i].shape == grays[i + 1].shape and float(np.abs(grays[i + 1] - grays[i]).mean()) < 1e-5]
    positions = None
    if track:
        if track != "frame" and track not in regions:
            pl.fail(f"--track {track}: no such region (have: frame, {', '.join(regions) or 'none'})")
        stack = np.stack(grays)
        moving = np.abs(stack - np.median(stack, axis=0)) > thr  # what differs from the still background
        h, w = stack.shape[1:]
        if track != "frame":
            keep = np.zeros((h, w), bool)
            keep[V.region_slice(regions[track], h, w)] = True
            moving &= keep
        ys, xs = np.mgrid[0:h, 0:w]
        positions = np.full((len(grays), 2), np.nan)
        for i, m in enumerate(moving):
            if m.sum() >= 4:
                positions[i] = [xs[m].mean() / w, ys[m].mean() / w]  # both in frame widths, so a step has one unit
        lost = int(np.isnan(positions[:, 0]).sum())
        if lost:
            notes.append(f"--track: nothing stood out from the background in {lost} of {len(grays)} frames (raise or lower --track-threshold?)")
    return series, positions, same, notes


# ---------------------------------------------------------------------------------------------------------- analysis

def analyse(values, frames: list[int], window: int, floor: float, flag_ratio: float) -> dict[str, Any]:
    """Steps of one series. A jump is a step measured against the median absolute step of the `window` steps on
    each side of it (itself excluded): the series' own local rate of change, so a fast sweep is not a jump and a
    small pop in a still passage is. `floor` stands in for a local rate of zero and is the smallest step that counts."""
    import numpy as np

    v = np.asarray(values, dtype=np.float64)
    ok = ~np.isnan(v)
    v, fr = v[ok], [f for f, k in zip(frames, ok) if k]
    out: dict[str, Any] = {"n": int(len(v))}
    if len(v) < 3:
        return {**out, "note": "fewer than 3 values: nothing to measure"}
    d = np.diff(v)
    ad = np.abs(d)
    local = np.array([np.median(np.delete(ad[max(0, i - window):i + window + 1], min(i, window))) if len(ad) > 1 else 0.0 for i in range(len(ad))])
    ratio = np.where(ad > floor, ad / np.maximum(local, floor), 0.0)
    i, j = int(ad.argmax()), int(ratio.argmax())
    out.update({
        "min": float(v.min()), "max": float(v.max()),
        "maxStep": {"step": float(d[i]), "frame": fr[i + 1]},
        "worstJump": {"step": float(d[j]), "localMedianStep": float(local[j]), "ratio": float(ratio[j]), "frame": fr[j + 1]},
        "flagged": [fr[k + 1] for k in np.flatnonzero(ratio > flag_ratio)],
        "flicker": float(np.sqrt(np.mean(np.diff(v, 2) ** 2))),
    })
    return out


def expectation(values, frames: list[int], kind: str, floor: float, steady_range: float) -> dict[str, Any]:
    import numpy as np

    v = np.asarray(values, dtype=np.float64)
    d = np.diff(v)
    if kind == "steady":
        rng = float(np.nanmax(v) - np.nanmin(v))
        return {"expect": kind, "range": rng, "allowed": steady_range, "ok": rng <= steady_range}
    against = (d < -floor) if kind == "rising" else (d > floor)
    worst = int((d if kind == "rising" else -d).argmin())
    return {"expect": kind, "against": int(against.sum()), "of": int(len(d)), "worstReversal": float(d[worst]) if against.any() else 0.0,
            "frame": frames[worst + 1] if against.any() else None, "ok": not against.any()}


def judder(positions, frames: list[int]) -> dict[str, Any]:
    """Evenness of a motion's per-frame steps. `judder` = std / mean of the step length: 0 for constant speed, and it
    grows with any real acceleration too, so `judderLocal` (steps divided by their rolling median first) is the one
    to read when the speed is meant to change. A step under 10 % of the median is a repeated frame, over 175 % a
    dropped one."""
    import numpy as np

    p = np.asarray(positions, dtype=np.float64)
    keep = ~np.isnan(p).any(1)
    p, fr = p[keep], [f for f, k in zip(frames, keep) if k]
    if len(p) < 4:
        return {"n": int(len(p)), "note": "fewer than 4 positions: nothing to measure"}
    s = np.linalg.norm(np.diff(p, axis=0), axis=1)
    med = float(np.median(s))
    if med <= 0:
        return {"n": int(len(p)), "meanStep": float(s.mean()), "note": "the subject does not move in most frames: judder is undefined"}
    roll = np.array([np.median(s[max(0, i - 4):i + 5]) for i in range(len(s))])
    return {"n": int(len(p)), "meanStep": float(s.mean()), "stdStep": float(s.std()), "judder": float(s.std() / s.mean()),
            "judderLocal": float((s / np.maximum(roll, 0.1 * med)).std()),
            "repeated": [fr[i + 1] for i in np.flatnonzero(s < 0.1 * med)], "dropped": [fr[i + 1] for i in np.flatnonzero(s > 1.75 * med)]}


# -------------------------------------------------------------------------------------------------------------- plot

def plot(series: dict[str, list[float]], stats: dict[str, dict[str, Any]], frames: list[int], title: str, width: int, extra: list[tuple[str, list[float], list[int]]], floor: float = 1e-12):
    """Small multiples, one panel per series, flagged frames in red. Drawn with Pillow: no plotting library to install."""
    from PIL import Image, ImageDraw

    panels = [(n, series[n], stats[n].get("flagged", []), stats[n]) for n in series] + [(n, v, fl, {}) for n, v, fl in extra]
    panels.sort(key=lambda p: (not p[2], p[0] not in dict((e[0], 1) for e in extra)))  # flagged first, then the motion panels
    shown, hidden = panels[:12], len(panels) - 12
    ph, left, right, top = 132, 78, 16, 30
    img = Image.new("RGB", (width, top + ph * len(shown) + 8), V.BG)
    dr = ImageDraw.Draw(img)
    dr.text((8, 6), title + (f"   (+{hidden} more series in the report)" if hidden > 0 else ""), fill=V.DIM, font=V.font(14))
    n = len(frames)
    for k, (name, vals, flagged, st) in enumerate(shown):
        y0, y1 = top + k * ph + 22, top + (k + 1) * ph - 12
        clean = [v for v in vals if v is not None and not math.isnan(v)]
        lo, hi = (min(clean), max(clean)) if clean else (0.0, 1.0)
        if hi - lo < 4 * floor:  # do not zoom into rounding noise: a still series must look still
            mid = (lo + hi) / 2
            lo, hi = mid - 2 * floor, mid + 2 * floor
        X = lambda i: left + (width - left - right) * i / max(1, len(vals) - 1)  # noqa: E731
        Y = lambda v: y1 - (y1 - y0) * (v - lo) / (hi - lo)  # noqa: E731
        dr.rectangle([left, y0, width - right, y1], outline=(60, 60, 64))
        head = name
        if st.get("worstJump"):
            j = st["worstJump"]
            head += f"    largest jump {j['step']:+.4g} at frame {j['frame']} = {j['ratio']:.1f}x the local step    flicker {st['flicker']:.3g}"
        dr.text((left, y0 - 18), head, fill=(255, 120, 110) if flagged else V.FG, font=V.font(13))
        dr.text((4, y0 - 2), f"{hi:.4g}", fill=V.DIM, font=V.font(12))
        dr.text((4, y1 - 12), f"{lo:.4g}", fill=V.DIM, font=V.font(12))
        pos = {f: i for i, f in enumerate(frames[len(frames) - len(vals):])}
        for f in flagged:
            if f in pos:
                dr.line([X(pos[f]), y0, X(pos[f]), y1], fill=(210, 60, 50), width=1)
                dr.text((min(X(pos[f]) + 3, width - 60), y0 + 2), str(f), fill=(255, 120, 110), font=V.font(12))
        pts = [(X(i), Y(v)) for i, v in enumerate(vals) if v is not None and not math.isnan(v)]
        if len(pts) > 1:
            dr.line(pts, fill=(120, 190, 255), width=2)
        if len(pts) <= 120:
            for x, y in pts:
                dr.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(200, 225, 255))
    if n:
        dr.text((left, img.height - 14), f"frame {frames[0]}", fill=V.DIM, font=V.font(12))
        dr.text((width - right - 70, img.height - 14), f"frame {frames[-1]}", fill=V.DIM, font=V.font(12))
    return img


# -------------------------------------------------------------------------------------------------------------- run

def clean(o: Any) -> Any:
    """Rounded, and NaN as null: the report must be JSON anything can read."""
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else float(f"{o:.6g}")
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    return o


def sweep(args) -> tuple[dict[str, Any], str, int]:
    import numpy as np

    have_clip = bool(args.frames or args.video or args.shot)
    if not (have_clip or args.values or args.positions):
        pl.fail("give a clip (--frames DIR, --video FILE or --shot NAME --source S), --values FILE or --positions FILE")
    series: dict[str, list[float]] = {}
    notes: list[str] = []
    frames: list[int] = []
    positions = None
    identical: list[int] | None = None
    label = []
    floor = args.floor
    if have_clip:
        seq = V.sequence_from_args(args, what="sweep")
        regions = V.parse_regions(args.region, None if (args.frames or args.video) else args.shot)
        s, positions, identical, n = image_series(seq, regions, args.mask, args.track, args.size, args.track_threshold)
        series.update(s)
        notes += n
        frames = [f["index"] for f in seq["frames"]]
        label.append(seq["label"])
        floor = 0.002 if floor is None else floor  # half an 8-bit code value: below it a step is rounding, not a jump
    if args.values:
        table = read_table(args.values)
        for c in pick_columns(table, args.columns, "--columns"):
            series[c] = table[c]
        label.append(Path(args.values).name)
    if args.positions:
        table = read_table(args.positions)
        cols = pick_columns(table, args.position_columns, "--position-columns") if args.position_columns else \
            ([c for c in ("x", "y", "z") if c in table] if {"x", "y"} <= set(table) else list(table)[:3])
        positions = np.array([table[c] for c in cols]).T
        label.append(f"{Path(args.positions).name}[{','.join(cols)}]")
    n_rows = max([len(v) for v in series.values()] + ([len(positions)] if positions is not None else []))
    frames = frames or list(range(n_rows))
    wanted = args.series or ["*"]
    series = {k: v for k, v in series.items() if any(fnmatch.fnmatchcase(k, g) for g in wanted)}
    if floor is None:  # values in unknown units: a millionth of the largest range present
        span = max((np.nanmax(v) - np.nanmin(v) for v in series.values()), default=0.0)
        floor = max(1e-12, 1e-6 * float(span))
    if positions is None and not series:
        pl.fail(f"no series matches --series {' '.join(wanted)}")

    stats = {name: analyse(v, frames[:len(v)], args.window, floor, args.flag_ratio) for name, v in series.items()}
    failed: list[str] = []
    for spec in args.expect or []:
        glob, _, kind = spec.rpartition("=")
        if kind not in ("rising", "falling", "steady"):
            pl.fail(f"--expect {spec!r}: expected rising, falling or steady, optionally as SERIES=KIND (SERIES may be a glob)")
        hits = [n for n in series if fnmatch.fnmatchcase(n, glob or "*")]
        if not hits:
            pl.fail(f"--expect {spec!r}: no series matches (have: {', '.join(series)})")
        for name in hits:
            e = stats[name]["expect"] = expectation(series[name], frames, kind, floor, args.steady_range)
            if not e["ok"]:
                failed.append(f"{name} expected {kind}: " + (f"range {e['range']:.4g} > {e['allowed']:g}" if kind == "steady"
                              else f"{e['against']} of {e['of']} steps go the other way (worst {e['worstReversal']:+.4g} at frame {e['frame']})"))
    for name, st in stats.items():
        if "maxStep" not in st:
            continue
        if args.max_step is not None and abs(st["maxStep"]["step"]) > args.max_step:
            failed.append(f"{name}: step {st['maxStep']['step']:+.4g} at frame {st['maxStep']['frame']} > --max-step {args.max_step:g}")
        if args.max_ratio is not None and st["worstJump"]["ratio"] > args.max_ratio:
            failed.append(f"{name}: jump at frame {st['worstJump']['frame']} is {st['worstJump']['ratio']:.1f}x the local step > --max-ratio {args.max_ratio:g}")
        if args.max_flicker is not None and st["flicker"] > args.max_flicker:
            failed.append(f"{name}: flicker {st['flicker']:.4g} > --max-flicker {args.max_flicker:g}")
    motion = None
    extra: list[tuple[str, list[float], list[int]]] = []
    if positions is not None:
        motion = judder(positions, frames[:len(positions)])
        steps = np.linalg.norm(np.diff(positions, axis=0), axis=1)
        extra.append(("motion: step length per frame", [math.nan, *steps.tolist()], sorted(set(motion.get("repeated", []) + motion.get("dropped", [])))))
        if args.max_judder is not None:
            if "judder" not in motion:
                failed.append(f"motion: {motion.get('note')}")
            elif motion["judder"] > args.max_judder:
                failed.append(f"motion: judder {motion['judder']:.3f} > --max-judder {args.max_judder:g}")
    elif args.max_judder is not None:
        pl.fail("--max-judder needs a motion: --positions FILE or --track")

    doc: dict[str, Any] = {"input": " + ".join(label), "frames": len(frames), "window": args.window, "floor": floor, "flagRatio": args.flag_ratio,
                           "series": stats, "motion": motion, "identicalFrames": identical, "notes": notes,
                           "gate": {"passed": not failed, "failed": failed}}
    shot = None if (args.frames or args.video) else args.shot
    d = V.out_dir(args, shot, need=False)
    if d:
        stem = f"sweep.{V.default_source(args)}" if shot else "sweep"
        img = plot(series, stats, frames, f"sweep   {doc['input']}   {len(frames)} frames", min(args.max_width, 1500), extra, floor)
        doc["plot"] = str(V.save_sheet(img, d / f"{stem}.png", args.max_width))
        doc["report"] = str(d / f"{stem}.json")
        pl.write_json(d / f"{stem}.json", clean({**doc, "values": series}))
    else:
        notes.append("no --out and no .perceptual-loop/ here: no plot or report written")
    lines = [f"sweep of {doc['input']}: {len(frames)} frames, {len(series)} series   (jump = step / median |step| of the {args.window} steps each side; floor {floor:.3g})"]
    w = max((len(n) for n in stats), default=4)
    for name, st in stats.items():
        if "maxStep" not in st:
            lines.append(f"  {name:<{w}}  {st.get('note')}")
            continue
        j = st["worstJump"]
        lines.append(f"  {name:<{w}}  max step {st['maxStep']['step']:+.4g} @ {st['maxStep']['frame']}   worst jump {j['step']:+.4g} @ {j['frame']} = {j['ratio']:.1f}x local {j['localMedianStep']:.3g}"
                     f"   flicker {st['flicker']:.3g}" + (f"   FLAGGED frames {st['flagged']}" if st["flagged"] else ""))
    if motion:
        lines.append("  motion  " + (f"judder {motion['judder']:.3f} (local {motion['judderLocal']:.3f})   mean step {motion['meanStep']:.4g}"
                                     f"   repeated frames {motion['repeated'] or 'none'}   dropped {motion['dropped'] or 'none'}" if "judder" in motion else motion["note"]))
    if identical:
        lines.append(f"  frames identical to the one before: {identical}")
    lines += [f"  note: {n}" for n in notes]
    if "plot" in doc:
        lines.append(f"  plot: {doc['plot']}\n  report: {doc['report']}")
    lines += [f"  GATE FAILED: {f}" for f in failed]
    return clean(doc), "\n".join(lines), 1 if failed else 0


# -------------------------------------------------------------------------------------------------------- self-test

def self_test() -> int:
    from PIL import Image, ImageDraw

    ok = True

    def check(name: str, cond: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= bool(cond)
        print(f"  {'ok  ' if cond else 'FAIL'}  {name}{'   ' + detail if detail else ''}")

    with tempfile.TemporaryDirectory(prefix="pl-sweep-test-") as t:
        tmp = Path(t)
        out = ["--out", str(tmp / "out")]
        # a dimming ramp of 2 levels per frame with one pop of 20 levels landing on frame 17, in the top half only
        (tmp / "ramp").mkdir()
        for i in range(40):
            im = Image.new("RGB", (64, 48), (60, 60, 60))
            v = 30 + 2 * i + (20 if i >= 17 else 0)
            ImageDraw.Draw(im).rectangle([0, 0, 63, 23], fill=(v, v, v))
            im.save(tmp / "ramp" / f"{i + 1:06d}.png")
        base = ["--frames", str(tmp / "ramp"), "--region", "top=0,0,1,0.5", "--region", "bottom=0,0.5,1,1"]
        _, d, _, code = run([*base, "--expect", "top.luma=rising", "--expect", "bottom.*=steady", "--max-ratio", "6", *out])
        j = d["series"]["top.luma"]["worstJump"]
        check("ramp with a pop: flagged at frame 17, about 11x the local step", j["frame"] == 17 and 9 < j["ratio"] < 13 and d["series"]["top.luma"]["flagged"] == [17],
              f"frame {j['frame']}, step {j['step']}, local {j['localMedianStep']}, ratio {j['ratio']}")
        check("the still region is not flagged and holds steady; the rising one rises", not d["series"]["bottom.luma"]["flagged"]
              and d["series"]["bottom.luma"]["expect"]["ok"] and d["series"]["top.luma"]["expect"]["ok"])
        check("--max-ratio 6 fails the gate (exit 1) and a plot is written", code == 1 and Path(d["plot"]).is_file(), f"exit {code}")
        _, d, _, code = run([*base, "--series", "bottom.*", "--max-ratio", "6", "--max-step", "0.01", *out])
        check("gating only the still region passes", code == 0, f"exit {code}")
        # values file: a smooth sine, then the same with every other sample pushed (flicker)
        rows = ["t,smooth,wobble"] + [f"{i},{math.sin(i / 8):.6f},{math.sin(i / 8) + (0.05 if i % 2 else -0.05):.6f}" for i in range(60)]
        (tmp / "v.csv").write_text("\n".join(rows), encoding="utf-8")
        _, d, _, _ = run(["--values", str(tmp / "v.csv"), "--columns", "smooth,wobble", *out])
        check("flicker: the wobbling column has far more second-difference energy", d["series"]["wobble"]["flicker"] > 10 * d["series"]["smooth"]["flicker"],
              f"smooth {d['series']['smooth']['flicker']}, wobble {d['series']['wobble']['flicker']}")
        # motion at constant speed, then the same with frame 12 shown twice
        even = [(3.0 * i, 1.5 * i) for i in range(40)]
        dup = even[:12] + [even[11]] + even[12:39]
        for name, pts in (("even", even), ("dup", dup)):
            (tmp / f"{name}.jsonl").write_text("\n".join(json.dumps({"x": x, "y": y}) for x, y in pts), encoding="utf-8")
        _, a, _, ca = run(["--positions", str(tmp / "even.jsonl"), "--max-judder", "0.05", *out])
        _, b, _, cb = run(["--positions", str(tmp / "dup.jsonl"), "--max-judder", "0.05", *out])
        check("constant speed: judder 0, gate passes", a["motion"]["judder"] < 1e-9 and ca == 0, f"judder {a['motion']['judder']}")
        check("one duplicated frame: judder rises, frame 12 reported as repeated, gate fails", b["motion"]["judder"] > 0.1 and b["motion"]["repeated"] == [12] and cb == 1,
              f"judder {b['motion']['judder']}, repeated {b['motion']['repeated']}, exit {cb}")
        # the same from pixels: a square tracked across frames, one frame repeated
        V.synth_frames(tmp / "sq", n=20, ramp=False)
        (tmp / "sq" / "000009.png").write_bytes((tmp / "sq" / "000008.png").read_bytes())
        _, d, _, _ = run(["--frames", str(tmp / "sq"), "--track", *out])
        check("--track: the repeated frame of a moving square is found from pixels", d["motion"]["repeated"] == [8] and d["identicalFrames"] == [8],
              f"repeated {d['motion']['repeated']}, identical {d['identicalFrames']}, judder {d['motion']['judder']}")
    print("sweep.py self-test:", "passed" if ok else "FAILED")
    return 0 if ok else 1


# ------------------------------------------------------------------------------------------------------------- main

EPILOG = """what the numbers mean
  max step    the largest change between two consecutive frames, in the series' own units (luma and colour: 0..1
              of display-encoded values, so 0.004 is one 8-bit level).
  worst jump  the step with the largest ratio to the median absolute step of the --window steps before and after it.
              A ratio near 1 is a step like its neighbours; above --flag-ratio (default 6) the frame is flagged.
              `local` is that median; when it is zero the --floor stands in, so a pop in a still passage has a
              very large ratio. The frame given is the one the jump lands on.
  flicker     root mean square of the second difference: 0 for a constant or a straight ramp, large for a value
              that alternates. It also grows with honest curvature, so compare it between runs of the same shot.
  judder      std / mean of the per-frame step length of a motion: 0 at constant speed. judderLocal divides each
              step by the median of its 9 neighbours first, which forgives acceleration. Repeated = a step under
              10 % of the median, dropped = over 175 %.
what they do not mean
  A mean over a frame or region hides anything that moves inside it without changing the mean; use a tighter
  region, --track, or values read back from the system. A flagged frame is a place to look (video.py burst
  --frame N), not a verdict: a cut, a light switched on or a flash is a jump that is meant.

exit codes: 0 done (gates and expectations passed), 1 a gate or an expectation failed, 2 usage or environment error"""


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="sweep.py", description=__doc__, epilog=EPILOG, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 parents=[V.common_parent()])
    ap.add_argument("--self-test", action="store_true", help="run the built-in checks on synthetic data and exit")
    g = ap.add_argument_group("series")
    g.add_argument("--values", metavar="FILE", help="a CSV (header row optional) or JSONL file, one row per frame")
    g.add_argument("--columns", help="the columns of --values to use, comma separated (default: every numeric column)")
    g.add_argument("--region", action="append", metavar="NAME=x0,y0,x1,y1", help="a named box in fractions of the frame, origin top left; repeatable (a shot's shot.json regions are used too)")
    g.add_argument("--mask", metavar="FILE", help="an image whose white pixels are one more region, named `mask`")
    g.add_argument("--series", action="append", metavar="GLOB", help="report, plot and gate only the series matching (repeatable), e.g. '*.luma' or 'sky.*'")
    g.add_argument("--size", type=int, default=256, help="frames are reduced to this long side before averaging (default 256)")
    g = ap.add_argument_group("motion")
    g.add_argument("--positions", metavar="FILE", help="a CSV or JSONL file of per-frame positions: columns x,y[,z] (or the first three numeric columns)")
    g.add_argument("--position-columns", help="the position columns, comma separated")
    g.add_argument("--track", nargs="?", const="frame", metavar="REGION", help="take the motion from the pixels instead: per frame, the centroid of what differs from "
                   "the clip's median picture (a subject moving over a still background), in the whole frame or a region")
    g.add_argument("--track-threshold", type=float, default=0.08, help="how far (luma, 0..1) a pixel must be from the median picture to belong to the subject (default 0.08)")
    g = ap.add_argument_group("measurement")
    g.add_argument("--window", type=int, default=5, help="steps on each side that define the local rate of change (default 5)")
    g.add_argument("--floor", type=float, help="smallest step that can count as a jump, and the stand-in for a local rate of zero "
                   "(default 0.002 for pictures: half an 8-bit level; for --values a millionth of the range)")
    g.add_argument("--flag-ratio", type=float, default=6.0, help="flag a frame when its step is more than this many times the local step (default 6)")
    g.add_argument("--expect", action="append", metavar="[SERIES=]rising|falling|steady", help="what a series should do; a step the other way (beyond --floor), or a "
                   "range above --steady-range, fails the gate. SERIES may be a glob; repeatable")
    g.add_argument("--steady-range", type=float, default=0.01, help="largest max-min of a series expected steady (default 0.01)")
    g = ap.add_argument_group("gates (exit 1 when exceeded)")
    g.add_argument("--max-step", type=float, metavar="V", help="largest allowed step between consecutive frames, in the series' units")
    g.add_argument("--max-ratio", type=float, metavar="R", help="largest allowed ratio of a step to its local step")
    g.add_argument("--max-flicker", type=float, metavar="F", help="largest allowed flicker")
    g.add_argument("--max-judder", type=float, metavar="J", help="largest allowed judder of the motion (needs --positions or --track)")
    return ap


def run(argv: list[str] | None = None):
    V.utf8_stdio()
    args = build_parser().parse_args(argv)
    if args.self_test:
        raise SystemExit(self_test())
    try:
        doc, text, code = sweep(args)
    except pl.PlError as e:
        pl.fail(str(e))
    return args, doc, text, code


def main() -> None:
    args, doc, text, code = run()
    pl.emit(doc, args.json, text)
    raise SystemExit(code)


if __name__ == "__main__":
    main()
