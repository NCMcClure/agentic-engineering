# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Measure run-to-run noise from several runs of the same shots, and turn it into tolerances.

It renders nothing: make the runs first (the same shots, the same code, e.g. `iterate.py --group smoke --run cal1`
... `cal6`), then give them here. A tolerance is the largest spread seen in a class of metrics times a margin;
an entry that flips between two values gets its own measured `spread` instead of widening its whole class.
"""
from __future__ import annotations

import argparse
import math
import statistics
import sys
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import groups as gr  # noqa: E402
import baseline as bl  # noqa: E402

# No tolerance goes under these, however quiet the runs were: metrics are stored to 5 decimals, and six quiet
# runs do not promise a seventh. In the unit of each metric.
FLOORS = {"ssim": 0.002, "edgeF1": 0.002, "edgeRecall": 0.002, "edgePrecision": 0.002, "iou": 0.002,
          "deltaE": 0.05, "deltaENorm": 0.05, "exposureEV": 0.005, "contrast": 0.005, "detailLog2": 0.01}
DEFAULT_FLOOR = 0.001


def metric_class(key: str) -> str:
    """`shot/candidate/region.glass.edgeF1` -> `candidate/region.*.edgeF1`: the pattern a tolerance is written for."""
    _, source, metric = pl.split_key(key)
    parts = metric.split(".")
    if parts[0] == "region" and len(parts) == 3:
        parts[1] = "*"
    return f"{source}/{'.'.join(parts)}"


def floor_of(cls: str) -> float:
    return FLOORS.get(cls.rsplit(".", 1)[-1], DEFAULT_FLOOR)


def round_up(v: float, digits: int = 2) -> float:
    """Up to two significant digits: a tolerance is read by people, and must not round below what was measured."""
    if v <= 0:
        return 0.0
    scale = 10 ** (digits - 1 - math.floor(math.log10(v)))
    return math.ceil(v * scale - 1e-9) / scale


def two_clusters(values: list[float]) -> tuple[float, float] | None:
    """If the values fall into two tight groups far apart, the groups' centres; else None."""
    v = sorted(values)
    gaps = [(v[i + 1] - v[i], i) for i in range(len(v) - 1)]
    gap, i = max(gaps)
    low, high = v[: i + 1], v[i + 1:]
    if gap > 0 and max(low[-1] - low[0], high[-1] - high[0]) <= gap / 4:
        return statistics.fmean(low), statistics.fmean(high)
    return None


def measure(runs: list[dict[str, float]], margin: float) -> dict[str, Any]:
    keys = [k for k in runs[0] if all(k in r for r in runs)]
    partial = sorted({k for r in runs for k in r} - set(keys))
    spread = {k: max(r[k] for r in runs) - min(r[k] for r in runs) for k in keys}
    by_class: dict[str, list[str]] = {}
    for k in keys:
        by_class.setdefault(metric_class(k), []).append(k)
    classes: dict[str, Any] = {}
    bistable: dict[str, Any] = {}
    for cls, members in sorted(by_class.items()):
        floor = floor_of(cls)
        typical = statistics.median(spread[k] for k in members)
        steady = []
        for k in members:
            # Bistable: two tight clusters whose distance stands far out of the class's ordinary noise. It takes
            # three runs to tell a flip from plain spread (two values are always "two clusters").
            centres = two_clusters([r[k] for r in runs]) if len(runs) >= 3 else None
            if centres and spread[k] > max(2 * floor, 4 * typical):
                bistable[k] = {"spread": spread[k], "values": [round(c, 5) for c in centres], "class": cls}
            else:
                steady.append(k)
        largest = max((spread[k] for k in steady), default=0.0)
        where = max(steady, key=lambda k: spread[k]) if steady else None
        classes[cls] = {"entries": len(members), "maxSpread": largest, "at": where, "medianSpread": typical,
                        "tolerance": round_up(max(floor, margin * largest)), "floor": floor,
                        "bistable": len(members) - len(steady)}
    return {"keys": len(keys), "notInEveryRun": partial, "classes": classes, "bistable": bistable}


def main(argv: list[str] | None = None) -> int:
    gr.utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--runs", nargs="+", metavar="RUN", help="two or more runs under .perceptual-loop/runs/ (six make a tolerance worth trusting)")
    g.add_argument("--dirs", nargs="+", metavar="DIR", help="the same, as run folders anywhere")
    ap.add_argument("--source", action="append", metavar="ID", help="only these candidate sources (repeatable; default: every source in the runs)")
    ap.add_argument("--margin", type=float, default=2.5, metavar="X", help="tolerance = X times the class's largest spread (default 2.5)")
    ap.add_argument("--write-tolerances", action="store_true", help="write the proposed tolerances and a dated note into baseline.json")
    ap.add_argument("--write-spread", action="store_true", help="write a per-entry spread for every bistable entry into baseline.json")
    ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    args = ap.parse_args(argv)
    try:
        root = pl.find_root()
        dirs = [Path(d).resolve() for d in args.dirs] if args.dirs else [pl.runs_dir(root) / r for r in args.runs]
        if len(dirs) < 2:
            raise pl.PlError("a spread needs at least two runs of the same shots")
        missing = [str(d) for d in dirs if not d.is_dir()]
        if missing:
            raise pl.PlError(f"no run folder: {', '.join(missing)}")
        runs, shots = [], set()
        for d in dirs:
            flat: dict[str, float] = {}
            for source in args.source or bl.sources_in_run(d):
                found = bl.shots_in_run(d, source)
                flat.update(bl.read_run(d, found, source)[0])
            if not flat:
                raise pl.PlError(f"{d} holds no metrics" + (f" for {', '.join(args.source)}" if args.source else ""))
            runs.append(flat)
            shots |= {pl.split_key(k)[0] for k in flat}
        doc = measure(runs, args.margin)
        doc.update(runs=[d.name for d in dirs], shots=len(shots), margin=args.margin)
        if not doc["keys"]:
            raise pl.PlError("the runs share no metric: were they made of the same shots and source?")

        today = time.strftime("%Y-%m-%d")
        written: list[str] = []
        if args.write_tolerances or args.write_spread:
            baseline = bl.load_baseline(root)
            if args.write_tolerances:
                for cls, c in doc["classes"].items():
                    baseline["tolerances"][cls] = c["tolerance"]
                    baseline["notes"][cls] = (f"{len(runs)} runs of {len(shots)} shots on {today}: max spread {c['maxSpread']:.5f}, "
                                              f"tolerance = {args.margin:g}x (floor {c['floor']:g})")
                written.append(f"{len(doc['classes'])} tolerances")
            if args.write_spread:
                for key, b in doc["bistable"].items():
                    baseline["spread"][key] = round(b["spread"], 5)
                    baseline["notes"][key] = f"bistable in {len(runs)} runs on {today}: takes {b['values'][0]} or {b['values'][1]}"
                written.append(f"{len(doc['bistable'])} per-entry spreads")
            pl.write_json(bl.baseline_path(root), baseline)
        doc["written"] = written
    except pl.PlError as e:
        pl.fail(str(e))

    rows = [("class", "entries", "median", "max spread", "tolerance", "largest at")]
    rows += [(cls, str(c["entries"]), f"{c['medianSpread']:.5f}", f"{c['maxSpread']:.5f}", f"{c['tolerance']:g}",
              (c["at"] or "-") + (f"  (+{c['bistable']} bistable, left out)" if c["bistable"] else ""))
             for cls, c in doc["classes"].items()]
    widths = [max(len(r[i]) for r in rows) for i in range(6)]
    lines = [f"{len(runs)} runs ({', '.join(doc['runs'])}) of {len(shots)} shots, {doc['keys']} numbers each; tolerance = max({args.margin:g} x max spread, floor)"]
    lines += ["  ".join(c.ljust(widths[i]) if i in (0, 5) else c.rjust(widths[i]) for i, c in enumerate(r)).rstrip() for r in rows]
    if len(runs) < 3:
        lines.append("with two runs a flip between two values cannot be told from noise: use three or more to find bistable entries")
    if doc["bistable"]:
        lines.append("bistable entries (two tight clusters, far apart for their class): give them a per-entry spread with --write-spread")
        lines += [f"  {k}  {b['values'][0]} or {b['values'][1]}  (spread {b['spread']:.5f})" for k, b in doc["bistable"].items()]
    if doc["notInEveryRun"]:
        lines.append(f"{len(doc['notInEveryRun'])} numbers are not in every run and were left out (first: {doc['notInEveryRun'][0]})")
    lines.append(f"baseline.json: wrote {' and '.join(written)}" if written else "nothing written (--write-tolerances / --write-spread apply this to baseline.json)")
    pl.emit(doc, args.json, "\n".join(lines))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
