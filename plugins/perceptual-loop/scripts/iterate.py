# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy>=1.24", "pillow>=10", "scipy>=1.10"]
# ///
"""One turn of the loop: render the candidate for a few shots, compare, gate against the baseline, draw the sheets.

Prints, per shot, before → after for the headline numbers, the gate for exactly those shots, where the time
went, and the sheets to open. It never writes the baseline: accepting a result is a separate, deliberate
`baseline.py update`.

Rendering more shots than config.budget.free needs its reason in the command, where the owner sees it:
  PL_RUN="verify: <what already works, what this checks>"   a group, once the change works on its own shots
  PL_RUN="full: <what is finished>"                         everything, once, when the work is done
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402
import groups as gr  # noqa: E402
import compare as cmp  # noqa: E402
import baseline as bl  # noqa: E402
import sheet as sh  # noqa: E402

HEADLINE = ("frame.ssim", "frame.deltaENorm", "frame.exposureEV", "frame.edgeF1")


def quote(word: str) -> str:
    """A shot name as one shell word, for the shell this platform's `shell=True` uses (cmd.exe or sh)."""
    if re.fullmatch(r"[A-Za-z0-9_.\-]+", word):
        return word
    return subprocess.list2cmdline([word]) if os.name == "nt" else shlex.quote(word)


def render_command(config: dict[str, Any], source: str, shots: list[str], shots_dir: Path) -> str:
    template = (config.get("render") or {}).get(source)
    if not template:
        raise pl.PlError(f"config.json has no render command for '{source}': add render.{source}, or pass --skip-render to compare what is there")
    return (template.replace("{shots}", " ".join(quote(s) for s in shots))
            .replace("{shotsDir}", quote(str(shots_dir))).replace("{source}", source))


def budget_refusal(count: int, free: int) -> str:
    return (f"{count} shots selected, and one command renders at most {free} without a reason.\n"
            "Narrow it first:\n"
            "  - pick the 1-3 shots that show the thing you changed, and name them\n"
            "  - or cut a group down with --match '<glob>'\n"
            "  - --dry-run lists what a selection means and starts nothing\n"
            "A larger run is for after the change works, with its reason in the command:\n"
            '  PL_RUN="verify: <what already works, what this checks>"   (a group, once)\n'
            '  PL_RUN="full: <what is finished>"                         (everything, once)')


def main(argv: list[str] | None = None) -> int:
    gr.utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    gr.add_selection(ap)
    ap.add_argument("--source", action="append", metavar="ID", help="candidate to render and compare (repeatable; default: every candidate of the config)")
    ap.add_argument("--run", default="iterate", metavar="NAME", help="run folder under .perceptual-loop/runs/ (default: iterate, reused each time)")
    ap.add_argument("--dry-run", action="store_true", help="print the shots and the commands, start nothing")
    ap.add_argument("--skip-render", action="store_true", help="compare the pictures that are there")
    ap.add_argument("--render-reference", action="store_true", help="also render the reference (only when the reference itself must change)")
    ap.add_argument("--sheets", choices=("pair", "all"), default="pair", help="pair: one pair sheet per shot (default); all: with a grid, plus the heat map alone and every source side by side")
    ap.add_argument("--no-sheets", action="store_true", help="draw nothing")
    ap.add_argument("--edge-tolerance", type=int, default=2, metavar="PX", help="as in compare.py (default 2)")
    ap.add_argument("--jobs", type=int, metavar="N", help="parallel comparisons (default: the CPU count, at most 8)")
    ap.add_argument("--repeat", type=int, default=1, metavar="N",
                    help="render and compare N times with no change in between, into runs <run>1 … <run>N, without sheets: the input of calibrate.py")
    ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else (render output goes to stderr)")
    args = ap.parse_args(argv)

    if args.repeat > 1:
        # Calibration: the same shots N times, each into its own run. A loop a person would otherwise type N times.
        raw, rest, skip = list(sys.argv[1:] if argv is None else argv), [], 0
        for word in raw:
            if skip:
                skip -= 1
            elif word in ("--repeat", "--run"):
                skip = 1
            elif not word.startswith(("--repeat=", "--run=")) and word != "--no-sheets":
                rest.append(word)
        runs = [f"{args.run}{i}" for i in range(1, args.repeat + 1)]
        for name in runs:
            if main(rest + ["--run", name, "--no-sheets"]) == 2:
                return 2
        if not args.json:
            print()
            print(f"{args.repeat} runs: {' '.join(runs)}")
            print(f"next: calibrate.py --runs {' '.join(runs)}")
        return 0
    try:
        root = pl.find_root()
        config = pl.load_config(root, required=True)
        shots = gr.selected(args, root, config)
        sources = args.source or list(config["candidates"])
        reference = config["reference"]
        if reference in sources:
            raise pl.PlError(f"'{reference}' is the reference; --render-reference renders it, --source names candidates")
        shots_dir = pl.shots_dir(root, config)
        to_render = [] if args.skip_render else ([reference] if args.render_reference else []) + sources
        commands = {s: render_command(config, s, shots, shots_dir) for s in to_render}
        reason = os.environ.get("PL_RUN", "").strip()
        free = int(config["budget"]["free"])

        if args.dry_run:
            doc = {"shots": shots, "sources": sources, "render": commands, "run": str(pl.runs_dir(root) / args.run),
                   "withinBudget": len(shots) <= free or not commands}
            lines = [f"{len(shots)} shots:"] + [f"  {s}" for s in shots]
            lines += [f"render {s}: {c}" for s, c in commands.items()] or ["render: nothing (--skip-render)"]
            if commands and len(shots) > free:
                lines.append(f"over the budget of {free}: this needs PL_RUN=\"verify: ...\" or PL_RUN=\"full: ...\"")
            pl.emit(doc, args.json, "\n".join(lines))
            return 0
        # The budget is about renders: they are what costs minutes. Comparing what is already there is free.
        if commands and len(shots) > free and not reason.startswith(("verify:", "full:")):
            pl.fail(budget_refusal(len(shots), free))

        seconds = {"render": 0.0, "compare": 0.0, "sheets": 0.0}
        # Keep each candidate's picture as it was before this render: reference | before | after needs it, and once
        # the render has run it is gone.
        kept_before: list[str] = []
        for source in (s for s in commands if s != reference):
            for shot in shots:
                old = pl.pass_file(shots_dir / shot, source)
                if old.is_file():
                    keep = pl.runs_dir(root) / args.run / shot / f"before.{source}.png"
                    keep.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(old, keep)
                    kept_before.append(str(keep))
        t0 = time.perf_counter()
        for source, command in commands.items():
            if not args.json:
                print(f"render {source}: {command}", flush=True)
            # the project's own command line, as written in config.json: it is run by the shell on purpose
            done = subprocess.run(command, shell=True, cwd=root, stdout=sys.stderr if args.json else None)
            if done.returncode:
                pl.fail(f"the render of '{source}' exited with {done.returncode}: nothing was compared")
        seconds["render"] = time.perf_counter() - t0

        t0 = time.perf_counter()
        run_dir = pl.runs_dir(root) / args.run
        docs = cmp.run_compare(root, config, shots, sources, run_dir, args.jobs, False, args.edge_tolerance)
        seconds["compare"] = time.perf_counter() - t0
        by = {(d["shot"], d["source"]): d for d in docs}

        baseline = bl.load_baseline(root)
        reports = {}
        for source in sources:
            flat, problems = bl.read_run(run_dir, shots, source)
            reports[source] = (bl.gate(baseline, flat, shots, source), problems, flat)

        t0 = time.perf_counter()
        sheets: dict[tuple[str, str], list[str]] = {}
        if not args.no_sheets:
            everything = args.sheets == "all"
            for shot in shots:
                shot_dir = pl.shot_path(shot, root, config)
                for source in sources:
                    if "error" in by[(shot, source)]:
                        continue
                    made = [sh.save(sh.pair_sheet(shot_dir, shot, source, reference, by[(shot, source)].get("frame"), 2000,
                                                  (8, 6) if everything else None, args.edge_tolerance),
                                    run_dir / shot / f"pair.{source}.png", False)]
                    if everything:
                        made.append(sh.save(sh.diff_sheet(str(pl.pass_file(shot_dir, reference)), str(pl.pass_file(shot_dir, source)), 2000),
                                            run_dir / shot / f"diff.{source}.png", False))
                    sheets[(shot, source)] = [str(p) for p in made]
                if everything:
                    have = [s for s in [reference, *config["candidates"]] if pl.pass_file(shot_dir, s).is_file()]
                    if len(have) > 1:
                        out = sh.save(sh.row_sheet([str(pl.pass_file(shot_dir, s)) for s in have], have, 2000), run_dir / shot / "sources.png", False)
                        for source in sources:
                            sheets.setdefault((shot, source), []).append(str(out))
        seconds["sheets"] = time.perf_counter() - t0
    except pl.PlError as e:
        pl.fail(str(e))

    seconds = {k: round(v, 2) for k, v in seconds.items()}
    seconds["total"] = round(sum(seconds.values()), 2)
    gate_failed = any(bl.failed(report, problems) for report, problems, _ in reports.values())
    totals = {s: r[0]["totals"] for s, r in reports.items()}
    # one line per invocation, for timing.py: what the loop costs is itself something to measure
    line = {"when": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "run": args.run, "shots": len(shots), "sources": sources,
            "rendered": list(commands), "seconds": seconds, "reason": reason or None,
            "cached": sum(bool(d.get("cached")) for d in docs), "gate": totals}
    log = pl.runs_dir(root) / "timing.jsonl"
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")

    out_lines: list[str] = []
    shots_doc = []
    for source in sources:
        report, problems, flat = reports[source]
        for shot in shots:
            head = f"{shot}  [{source}]"
            if shot in problems:
                out_lines.append(f"{head}  no metrics: {problems[shot]}")
                shots_doc.append({"shot": shot, "source": source, "error": problems[shot]})
                continue
            out_lines.append(head)
            rows = {}
            for metric in HEADLINE:
                key = f"{shot}/{source}/{metric}"
                before, now = baseline["entries"].get(key), flat.get(key)
                if now is None:
                    continue
                rows[metric] = {"before": before, "after": now}
                out_lines.append(f"  {metric:<17} " + (f"{bl.num(before)} → {bl.num(now)}" if before is not None else f"(no baseline) {bl.num(now)}"))
            for note in by[(shot, source)].get("notes", []):
                out_lines.append(f"  note: {note}")
            out_lines += [f"  sheet: {p}" for p in sheets.get((shot, source), [])]
            shots_doc.append({"shot": shot, "source": source, "headline": rows, "sheets": sheets.get((shot, source), [])})
        verdict = "beyond tolerance: look at the sheets, the number is not the judgement" if bl.failed(report, problems) else "within tolerance"
        out_lines.append(f"gate [{source}, {len(shots)} shots]: {bl.totals_line(report['totals'])}  ({verdict})")
        # the entries behind the gate line, grouped by shot (baseline.py's own report, minus its totals line)
        out_lines += ["  " + line for line in bl.report_text(report, {}).splitlines()[:-1]]
    render_note = "" if commands else " (skipped)"
    out_lines.append(f"time: render {seconds['render']:.1f} s{render_note} · compare {seconds['compare']:.1f} s · sheets {seconds['sheets']:.1f} s · total {seconds['total']:.1f} s")
    doc = {"run": str(run_dir), "shots": shots_doc, "gate": {s: {"totals": r[0]["totals"], "entries": [e for e in r[0]["entries"] if e["status"] != "ok"],
                                                             "problems": r[1]} for s, r in reports.items()},
           "passed": not gate_failed, "seconds": seconds, "reason": reason or None, "before": kept_before}
    if kept_before:
        out_lines.append(f"before: {len(kept_before)} picture(s) kept as <run>/<shot>/before.<source>.png (for sheet.py triptych)")
    pl.emit(doc, args.json, "\n".join(out_lines))
    return 1 if gate_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
