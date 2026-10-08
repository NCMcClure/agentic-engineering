# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""The gate: a run's metrics against the accepted values of baseline.json, within measured tolerances.

A gate compares a candidate with its own earlier run. It reports that a number moved and in which direction;
whether the picture is better for it is decided by looking, never here.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import groups as gr  # noqa: E402

# The value a metric has when candidate and reference are the same picture. It gives a move a direction
# (toward / away from the reference) and nothing more: toward the reference is not "better" when the
# candidate is the more correct of the two.
IDEAL = {"ssim": 1.0, "edgeF1": 1.0, "edgeRecall": 1.0, "edgePrecision": 1.0, "iou": 1.0, "contrast": 1.0,
         "deltaE": 0.0, "deltaENorm": 0.0, "exposureEV": 0.0, "detailLog2": 0.0}
EPS = 1e-9  # values are rounded when written; equal numbers must not fail a zero tolerance on float dust


def baseline_path(root: Path) -> Path:
    return pl.pl_dir(root) / "baseline.json"


def load_baseline(root: Path) -> dict[str, Any]:
    doc = pl.read_json(baseline_path(root))
    if doc is None:
        raise pl.PlError(f"no {baseline_path(root)}: run init.py first")
    for k in ("tolerances", "spread", "entries", "notes"):
        doc.setdefault(k, {})
    return doc


def run_dir_of(args: argparse.Namespace, root: Path) -> Path:
    d = Path(args.dir).resolve() if args.dir else pl.runs_dir(root) / args.run
    if not d.is_dir():
        raise pl.PlError(f"no run folder {d}")
    return d


def add_run_flags(p: argparse.ArgumentParser, required: bool = True) -> None:
    g = p.add_mutually_exclusive_group(required=required)
    g.add_argument("--run", metavar="RUN", help="a run under .perceptual-loop/runs/")
    g.add_argument("--dir", metavar="DIR", help="a run folder anywhere (DIR/<shot>/metrics.<source>.json)")


def shots_in_run(run_dir: Path, source: str) -> list[str]:
    return sorted(p.parent.name for p in run_dir.glob(f"*/metrics.{source}.json"))


def sources_in_run(run_dir: Path) -> list[str]:
    return sorted({p.name[len("metrics."):-len(".json")] for p in run_dir.glob("*/metrics.*.json")})


def read_run(run_dir: Path, shots: list[str], source: str) -> tuple[dict[str, float], dict[str, str]]:
    """Flat metrics of the shots, and for each shot that has none the reason (not compared, or its error)."""
    flat: dict[str, float] = {}
    problems: dict[str, str] = {}
    for shot in shots:
        doc = pl.read_json(run_dir / shot / f"metrics.{source}.json")
        if doc is None:
            problems[shot] = "not in this run"
        elif "error" in doc:
            problems[shot] = doc["error"]
        else:
            flat.update(pl.flatten_metrics(doc))
    return flat, problems


def direction(metric: str, before: float, now: float) -> str | None:
    ideal = IDEAL.get(metric.rsplit(".", 1)[-1])
    if ideal is None or abs(now - ideal) == abs(before - ideal):
        return None
    return "toward" if abs(now - ideal) < abs(before - ideal) else "away from"


def gate(baseline: dict[str, Any], flat: dict[str, float], shots: list[str], source: str) -> dict[str, Any]:
    """Every entry of the shots and source as ok / beyond / new / missing."""
    wanted = set(shots)

    def mine(key: str) -> bool:
        shot, src, _ = pl.split_key(key)
        return src == source and shot in wanted

    entries = []
    for key in [k for k in baseline["entries"] if mine(k)] + [k for k in flat if k not in baseline["entries"]]:
        shot, _, metric = pl.split_key(key)
        before, now = baseline["entries"].get(key), flat.get(key)
        e: dict[str, Any] = {"key": key, "shot": shot, "metric": metric, "baseline": before, "now": now}
        if before is None:
            e["status"] = "new"
        elif now is None:
            e["status"] = "missing"
        else:
            e["tolerance"] = pl.tolerance_for(key, baseline)
            e["moved"] = now - before
            e["status"] = "beyond" if abs(e["moved"]) > e["tolerance"] + EPS else "ok"
            e["direction"] = direction(metric, before, now)
        entries.append(e)
    totals = {s: sum(e["status"] == s for e in entries) for s in ("ok", "beyond", "new", "missing")}
    return {"source": source, "shots": shots, "totals": totals, "entries": entries}


def num(v: float) -> str:
    return f"{v:.4f}"


def describe(e: dict[str, Any]) -> str:
    if e["status"] == "missing":
        return f"{e['metric']}  {num(e['baseline'])} → (missing from the run)"
    if e["status"] == "new":
        return f"{e['metric']}  (new) {num(e['now'])}"
    where = f", {e['direction']} the reference" if e.get("direction") else ""
    return f"{e['metric']}  {num(e['baseline'])} → {num(e['now'])}  (moved by {e['moved']:+.4f}, tolerance {num(e['tolerance'])}{where})"


def totals_line(totals: dict[str, int]) -> str:
    return " / ".join(f"{k} {totals[k]}" for k in ("ok", "beyond", "new", "missing"))


def report_text(report: dict[str, Any], problems: dict[str, str], show: tuple[str, ...] = ("beyond", "missing")) -> str:
    lines = []
    for shot in report["shots"]:
        rows = [e for e in report["entries"] if e["shot"] == shot and e["status"] in show]
        if shot in problems:  # one line says it; its entries are all 'missing' for that one reason
            lines.append(f"{shot}: no metrics ({problems[shot]})")
            continue
        if rows:
            lines.append(shot)
        width = max((len(e["metric"]) for e in rows), default=0)
        lines += ["  " + describe(e).replace(e["metric"], e["metric"].ljust(width), 1) for e in rows]
    lines.append(f"{report['source']}, {len(report['shots'])} shots: {totals_line(report['totals'])}")
    return "\n".join(lines)


def failed(report: dict[str, Any], problems: dict[str, str]) -> bool:
    return bool(report["totals"]["beyond"] or report["totals"]["missing"] or problems)


# ------------------------------------------------------------------------------------------------------------ commands

def cmd_check(args: argparse.Namespace, root: Path, config: dict[str, Any], stale: bool = False) -> int:
    run_dir = run_dir_of(args, root)
    # with no selection the run itself says which shots are meant: a gate is about what was just compared
    shots = gr.selected(args, root, config) if gr.has_selection(args) else shots_in_run(run_dir, args.source)
    if not shots:
        raise pl.PlError(f"{run_dir} holds no metrics.{args.source}.json")
    baseline = load_baseline(root)
    flat, problems = read_run(run_dir, shots, args.source)
    report = gate(baseline, flat, shots, args.source)
    report["problems"] = problems
    if stale:
        # this run was made from the unchanged main branch, so whatever is beyond tolerance here moved before
        # the current work began
        report["stale"] = [e["key"] for e in report["entries"] if e["status"] in ("beyond", "missing")]
        text = report_text(report, problems)
        if report["stale"]:
            text += (f"\n{len(report['stale'])} entries are beyond tolerance on unchanged main: the baseline is stale for them. "
                     f"Do not count them against the current work; refresh them with\n"
                     f"  baseline.py update --source {args.source} --shots {','.join(sorted({pl.split_key(k)[0] for k in report['stale']}))} "
                     + (f"--run {args.run}" if args.run else f"--dir {args.dir}"))
        else:
            text += "\nnothing is stale: the baseline holds on unchanged main"
    else:
        text = report_text(report, problems)
    pl.emit(report, args.json, text)
    return 1 if failed(report, problems) else 0


def cmd_update(args: argparse.Namespace, root: Path, config: dict[str, Any]) -> int:
    run_dir = run_dir_of(args, root)
    if args.all_shots_of_run:
        shots = shots_in_run(run_dir, args.source)
    elif gr.has_selection(args):
        shots = gr.selected(args, root, config)
    else:
        raise pl.PlError("update is always targeted: name the shots (--shots a,b), a --group, or say --all-shots-of-run")
    flat, problems = read_run(run_dir, shots, args.source)
    if problems or not shots:
        why = "; ".join(f"{s}: {p}" for s, p in problems.items()) or f"no metrics.{args.source}.json in it"
        raise pl.PlError(f"nothing written: the run {run_dir.name} cannot update every selected shot ({why})")
    baseline = load_baseline(root)
    wanted = set(shots)
    old = baseline["entries"]
    # Rebuild in place: an entry that stays keeps its position, a shot's new entries follow its old ones, and
    # nothing outside the selection is touched, so the diff of baseline.json shows exactly what was accepted.
    new_by_shot: dict[str, dict[str, float]] = {}
    for key, v in flat.items():
        new_by_shot.setdefault(pl.split_key(key)[0], {})[key] = v
    out: dict[str, float] = {}
    changed = added = removed = 0
    placed: set[str] = set()

    def place_rest(shot: str) -> None:
        nonlocal added
        if shot in placed:
            return
        placed.add(shot)
        for key, v in new_by_shot.get(shot, {}).items():
            if key not in out:
                out[key] = v
                added += 1

    last_of_shot = {pl.split_key(k)[0]: k for k in old if pl.split_key(k)[1] == args.source and pl.split_key(k)[0] in wanted}
    for key, v in old.items():
        shot, source, _ = pl.split_key(key)
        if source == args.source and shot in wanted:
            if key in flat:
                out[key] = flat[key]
                changed += flat[key] != v
            else:
                removed += 1
            if last_of_shot[shot] == key:
                place_rest(shot)
        else:
            out[key] = v
    for shot in shots:
        place_rest(shot)
    baseline["entries"] = out
    pl.write_json(baseline_path(root), baseline)
    doc = {"source": args.source, "shots": shots, "changed": changed, "added": added, "removed": removed, "run": str(run_dir)}
    pl.emit(doc, args.json, f"baseline.json: {args.source}, {len(shots)} shots from {run_dir.name}: "
                            f"{changed} entries changed, {added} added, {removed} removed; everything else untouched")
    return 0


def cmd_tolerances(args: argparse.Namespace, root: Path) -> int:
    baseline = load_baseline(root)
    if args.action == "set":
        if "/" not in args.pattern:
            raise pl.PlError("a tolerance pattern is '<source>/<metric>', e.g. 'candidate/frame.ssim' or '*/region.*.edgeF1'")
        baseline["tolerances"][args.pattern] = args.value
        baseline["notes"][args.pattern] = args.note
        pl.write_json(baseline_path(root), baseline)
        pl.emit({"pattern": args.pattern, "tolerance": args.value, "note": args.note}, args.json, f"{args.pattern} = {args.value}  ({args.note})")
        return 0
    doc = {k: baseline.get(k) for k in ("tolerances", "minRegionArea", "spread", "notes")}
    width = max((len(p) for p in baseline["tolerances"]), default=0)
    lines = [f"{p:<{width}}  {t:<8g}  {baseline['notes'].get(p, '(no note: where does this number come from?)')}" for p, t in baseline["tolerances"].items()]
    lines.append(f"minRegionArea {baseline.get('minRegionArea', 0.002)}; {len(baseline['entries'])} entries")
    lines += [f"note: {v}" for k, v in baseline["notes"].items() if k.startswith("_")]
    lines += [f"spread  {k}  {v:g} (allowed 1.5x = {1.5 * v:g})  {baseline['notes'].get(k, '')}".rstrip() for k, v in baseline["spread"].items()]
    pl.emit(doc, args.json, "\n".join(lines))
    return 0


# ----------------------------------------------------------------------------------------------------------------- cli

def main(argv: list[str] | None = None) -> int:
    gr.utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    js = argparse.ArgumentParser(add_help=False)
    js.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="{check,update,tolerances,stale}")

    p = sub.add_parser("check", parents=[js], help="gate a run: which entries are beyond tolerance (exit 1 if any, or any missing)")
    gr.add_selection(p)
    p.add_argument("--source", required=True, metavar="ID", help="the candidate source to gate")
    add_run_flags(p)

    p = sub.add_parser("update", parents=[js], help="accept a run's values for one source and the named shots; nothing else is rewritten")
    gr.add_selection(p)
    p.add_argument("--source", required=True, metavar="ID", help="the candidate source whose entries are replaced")
    p.add_argument("--all-shots-of-run", action="store_true", help="every shot the run compared for this source (say it explicitly)")
    add_run_flags(p)

    p = sub.add_parser("tolerances", help="show the tolerances, or set one with the measurement behind it")
    tsub = p.add_subparsers(dest="action", required=True, metavar="{show,set}")
    tsub.add_parser("show", parents=[js], help="patterns, values and their notes")
    s = tsub.add_parser("set", parents=[js], help="set one tolerance")
    s.add_argument("pattern", metavar="PATTERN", help="'<source>/<metric>', '*' matches one part: 'candidate/region.*.edgeF1'")
    s.add_argument("value", metavar="VALUE", type=float)
    s.add_argument("--note", required=True, metavar="TEXT", help="what was measured (runs, shots, date): a tolerance without one is a guess")

    p = sub.add_parser("stale", parents=[js], help="entries beyond tolerance in a run made from unchanged main: the baseline's own drift")
    gr.add_selection(p)
    p.add_argument("--source", required=True, metavar="ID")
    add_run_flags(p)

    args = ap.parse_args(argv)
    try:
        root = pl.find_root()
        config = pl.load_config(root, required=True)
        if args.cmd == "check":
            return cmd_check(args, root, config)
        if args.cmd == "stale":
            return cmd_check(args, root, config, stale=True)
        if args.cmd == "update":
            return cmd_update(args, root, config)
        return cmd_tolerances(args, root)
    except pl.PlError as e:
        pl.fail(str(e))


if __name__ == "__main__":
    raise SystemExit(main())
