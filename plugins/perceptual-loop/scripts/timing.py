#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Where the iteration time went, and whether the render budget is being kept.

  timing.py [--since 2h|3d|2026-01-10|2026-01-10T14:00] [--json]

Reads .perceptual-loop/runs/timing.jsonl (one JSON object per iterate.py invocation:
{"at" or "when": ISO time, "shots": N or [names], "seconds": {"render": s, "compare": s, "sheets": s}, "reason": "..."}) and
.perceptual-loop/runs/budget.log (the guard hook's record of runs above the free budget: time, kind, shots, reason,
command; tab-separated). Prints, per phase, the count, median and 90th percentile; seconds per shot; iterations per
active hour; the runs above the free budget with their reasons; and advice where a threshold is crossed.

Exit 0 always (this is a report, not a gate); 2 on a usage error.
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402

PHASES = ("render", "compare", "sheets")
SLOW_ITERATION_S = 60.0   # above this an agent stops iterating and starts waiting
FULL_RUNS_PER_DAY = 3     # the full suite is for finished work: this many in a day is a habit, not an ending
OVER_BUDGET_SHARE = 0.3


def parse_time(text: str) -> datetime | None:
    try:
        t = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    return t if t.tzinfo else t.astimezone()  # a time without a zone is local time


def parse_since(text: str) -> datetime:
    unit = {"m": "minutes", "h": "hours", "d": "days"}.get(text[-1:].lower())
    if unit and text[:-1].replace(".", "", 1).isdigit():
        return datetime.now(timezone.utc) - timedelta(**{unit: float(text[:-1])})
    t = parse_time(text)
    if t is None:
        raise pl.PlError(f"--since '{text}': use 90m, 2h, 3d, a date (2026-01-10) or a time (2026-01-10T14:00)")
    return t


def pct(values: list[float], q: float) -> float:
    """Nearest-rank percentile: a value that was really measured."""
    s = sorted(values)
    return s[min(len(s) - 1, max(0, int(-(-q * len(s) // 1)) - 1))]


def read_timing(path: Path, since: datetime | None) -> tuple[list[dict[str, Any]], int]:
    rows, bad = [], 0
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return [], 0
    for line in lines:
        if not line.strip():
            continue
        try:
            doc = json.loads(line)
            at = parse_time(doc.get("at") or doc["when"])  # iterate.py writes "when"
            shots = doc.get("shots")
            n = len(shots) if isinstance(shots, list) else int(shots or 0)
            secs = {p: float((doc.get("seconds") or {}).get(p) or 0.0) for p in PHASES}
        except (ValueError, KeyError, TypeError):
            bad += 1
            continue
        if at is None:
            bad += 1
        elif since is None or at >= since:
            rows.append({"at": at, "shots": n, "seconds": secs, "total": sum(secs.values()), "reason": doc.get("reason") or ""})
    return rows, bad


def read_budget(path: Path, since: datetime | None) -> list[dict[str, Any]]:
    rows = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in lines:
        parts = line.split("\t")
        at = parse_time(parts[0]) if len(parts) >= 5 else None
        if at and (since is None or at >= since):
            rows.append({"at": at, "kind": parts[1], "shots": parts[2], "reason": parts[3], "command": parts[4]})
    return rows


def report(timing: list[dict[str, Any]], budget: list[dict[str, Any]], free: int) -> dict[str, Any]:
    doc: dict[str, Any] = {"iterations": len(timing), "free": free, "phases": {}, "advice": []}
    advice: list[str] = doc["advice"]
    if timing:
        for p in PHASES:
            vals = [r["seconds"][p] for r in timing if r["seconds"][p] > 0]
            if vals:
                doc["phases"][p] = {"count": len(vals), "median": round(statistics.median(vals), 1), "p90": round(pct(vals, 0.9), 1),
                                    "total": round(sum(vals), 1)}
        totals = [r["total"] for r in timing]
        per_shot = [r["total"] / r["shots"] for r in timing if r["shots"] > 0]
        hours = {r["at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H") for r in timing}
        doc["iteration"] = {"median": round(statistics.median(totals), 1), "p90": round(pct(totals, 0.9), 1), "total": round(sum(totals), 1)}
        doc["secondsPerShot"] = round(statistics.median(per_shot), 1) if per_shot else None
        doc["medianShots"] = statistics.median([r["shots"] for r in timing])
        doc["activeHours"] = len(hours)
        doc["iterationsPerHour"] = round(len(timing) / len(hours), 1)
        over = [r for r in timing if r["shots"] > free]
        doc["overBudget"] = {"count": len(over), "share": round(len(over) / len(timing), 2),
                             "runs": [{"at": r["at"].isoformat(timespec="seconds"), "shots": r["shots"], "seconds": round(r["total"], 1),
                                       "reason": r["reason"]} for r in over]}
        med = {p: doc["phases"].get(p, {}).get("median", 0.0) for p in PHASES}
        if doc["iteration"]["median"] > SLOW_ITERATION_S:
            advice.append(f"The median iteration takes {doc['iteration']['median']:g} s (above {SLOW_ITERATION_S:g}): narrow the shots "
                          f"to the 1-{free} that show the thing, or render fewer passes (beauty only while only the look changes).")
        if med["compare"] > med["render"] > 0 and med["compare"] > 5:
            advice.append(f"Comparing (median {med['compare']:g} s) is slower than rendering ({med['render']:g} s): is the cache being "
                          "defeated? An unchanged shot should be skipped; look for --force, a new --run folder each time, or inputs rewritten every run.")
        if med["sheets"] > max(med["render"], 5):
            advice.append(f"Drawing sheets (median {med['sheets']:g} s) costs more than rendering: draw them only for the shots you will open.")
        if len(timing) >= 5 and doc["overBudget"]["share"] > OVER_BUDGET_SHARE:
            advice.append(f"{len(over)} of {len(timing)} iterations rendered more than {free} shots: an iteration answers one question "
                          "with the shots that show it; a group once the change works; the suite once at the end.")
    else:
        advice.append("No iterations recorded in this period (runs/timing.jsonl is written by iterate.py).")

    doc["budgetLog"] = {"count": len(budget), "byKind": {}, "runs": [{**r, "at": r["at"].isoformat(timespec="seconds")} for r in budget]}
    per_day: dict[str, int] = {}
    for r in budget:
        doc["budgetLog"]["byKind"][r["kind"]] = doc["budgetLog"]["byKind"].get(r["kind"], 0) + 1
        if r["kind"] == "full":
            day = r["at"].astimezone().strftime("%Y-%m-%d")
            per_day[day] = per_day.get(day, 0) + 1
    for day, n in sorted(per_day.items()):
        if n >= FULL_RUNS_PER_DAY:
            advice.append(f"{n} full runs on {day}: the full suite is for finished work, once. Batch the fixes, then one full pass.")
    return doc


def as_text(doc: dict[str, Any], since: datetime | None) -> str:
    out = [f"iterations: {doc['iterations']}" + (f" since {since.isoformat(timespec='minutes')}" if since else "")]
    if doc["iterations"]:
        it = doc["iteration"]
        out.append(f"  {'phase':<9}{'count':>6}{'median':>9}{'p90':>9}{'total':>10}")
        for p, s in doc["phases"].items():
            out.append(f"  {p:<9}{s['count']:>6}{s['median']:>8g}s{s['p90']:>8g}s{s['total']:>9g}s")
        out.append(f"  {'all':<9}{doc['iterations']:>6}{it['median']:>8g}s{it['p90']:>8g}s{it['total']:>9g}s")
        out.append(f"  median shots per iteration: {doc['medianShots']:g}; seconds per shot: {doc['secondsPerShot']}")
        out.append(f"  iterations per active hour: {doc['iterationsPerHour']:g} ({doc['activeHours']} hours with work)")
        ob = doc["overBudget"]
        out.append(f"  above the free budget of {doc['free']} shots: {ob['count']} of {doc['iterations']}")
        for r in ob["runs"][-10:]:
            out.append(f"    {r['at']}  {r['shots']} shots, {r['seconds']:g} s  {r['reason'] or '(no reason recorded)'}")
    bl = doc["budgetLog"]
    if bl["count"]:
        kinds = ", ".join(f"{n} {k}" for k, n in sorted(bl["byKind"].items()))
        out.append(f"large runs let through by the guard: {bl['count']} ({kinds})")
        for r in bl["runs"][-10:]:
            out.append(f"    {r['at']}  {r['kind']}, {r['shots']} shots: {r['reason']}")
    out += [f"advice: {a}" for a in doc["advice"]] or ["advice: none; the loop is fast and within its budget"]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="timing.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--since", metavar="WHEN", help="only runs since: 90m, 2h, 3d, a date or an ISO time (default: everything)")
    ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    a = ap.parse_args(argv)
    try:
        since = parse_since(a.since) if a.since else None
        root = pl.find_root()
        config = pl.load_config(root)
    except pl.PlError as e:
        pl.fail(str(e))
    runs = pl.runs_dir(root)
    timing, bad = read_timing(runs / "timing.jsonl", since)
    doc = report(timing, read_budget(runs / "budget.log", since), int((config.get("budget") or {}).get("free", 3)))
    if bad:
        doc["advice"].append(f"{bad} line(s) of timing.jsonl could not be read and were left out.")
    pl.emit(doc, a.json, as_text(doc, since))
    return 0


if __name__ == "__main__":
    sys.exit(main())
