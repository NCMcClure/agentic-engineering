# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Scaffold .perceptual-loop/ in a project, and add shots to it.

  init.py [--reference ID] [--candidate ID]... [--render SOURCE=CMD]...     the folder and its files
  init.py new-shot NAME [--meta k=v]... [--from-image SOURCE[.PASS]=PATH]...  one shot folder

Nothing that exists is ever overwritten: the command reports what it found and writes only what is absent.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402

# Starting points so that a first gate is not tripped by the last digit of a float. They are guesses: the
# calibrate-gate skill replaces them with tolerances measured from this project's own run-to-run noise.
DEFAULT_TOLERANCES = {
    "*/frame.ssim": 0.01, "*/frame.deltaE": 0.3, "*/frame.deltaENorm": 0.3, "*/frame.exposureEV": 0.03,
    "*/frame.contrast": 0.02, "*/frame.edgeF1": 0.02, "*/frame.edgeRecall": 0.02, "*/frame.edgePrecision": 0.02,
    "*/frame.detailLog2": 0.05,
    "*/region.*.ssim": 0.02, "*/region.*.deltaENorm": 0.5, "*/region.*.edgeF1": 0.04, "*/region.*.iou": 0.01,
}
NAME_RX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]*$")


def _pairs(items: list[str], flag: str) -> list[tuple[str, str]]:
    out = []
    for item in items:
        k, sep, v = item.partition("=")
        if not sep or not k or not v:
            raise pl.PlError(f"{flag} wants KEY=VALUE, got '{item}'")
        out.append((k, v))
    return out


def _create(path: Path, text: str, made: list[str], kept: list[str], root: Path) -> None:
    rel = path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path)
    if path.exists():
        kept.append(rel)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")
    made.append(rel)


def scaffold(args: argparse.Namespace) -> dict[str, Any]:
    root = Path(args.root).resolve() if args.root else pl.find_root()
    d = pl.pl_dir(root)
    candidates = args.candidate or list(pl.DEFAULT_CONFIG["candidates"])
    for name in [args.reference, *candidates]:
        if not NAME_RX.match(name) or "." in name:
            raise pl.PlError(f"a source id is a short word without dots (it names files: <source>.png), got '{name}'")
    if args.reference in candidates:
        raise pl.PlError(f"'{args.reference}' cannot be both the reference and a candidate")
    render = dict(_pairs(args.render, "--render"))
    unknown = [s for s in render if s not in [args.reference, *candidates]]
    if unknown:
        raise pl.PlError(f"--render names a source that is neither the reference nor a candidate: {', '.join(unknown)}")
    config = {**pl.DEFAULT_CONFIG, "reference": args.reference, "candidates": candidates, "render": render,
              "regionsFrom": args.reference}
    baseline = {
        "version": 1, "tolerances": DEFAULT_TOLERANCES, "minRegionArea": 0.002, "spread": {}, "entries": {},
        "notes": {"_tolerances": "the starting tolerances are guesses that keep float dust from failing a gate, not "
                                 "measurements: render the smoke group several times and run calibrate.py "
                                 "--write-tolerances (the calibrate-gate skill) to replace them with this project's noise"},
    }
    made: list[str] = []
    kept: list[str] = []
    dump = lambda doc: json.dumps(doc, indent=2) + "\n"  # noqa: E731
    _create(d / "config.json", dump(config), made, kept, root)
    _create(d / "groups.json", dump({"smoke": []}), made, kept, root)
    _create(d / "baseline.json", dump(baseline), made, kept, root)
    # shots are large and runs are throwaway; a project that wants its shots in git deletes the first line
    _create(d / ".gitignore", "shots/\nruns/\n", made, kept, root)
    for folder in ("success", "decisions"):
        if (d / folder).is_dir():
            kept.append(f"{pl.DIR_NAME}/{folder}/")
        else:
            (d / folder).mkdir(parents=True)
            made.append(f"{pl.DIR_NAME}/{folder}/")
    return {"root": str(root), "created": made, "exists": kept}


def _value(text: str) -> Any:
    """`--meta lap=3` is a number, `--meta wet=true` a boolean, anything else the string it is."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return text


def new_shot(args: argparse.Namespace) -> dict[str, Any]:
    root = pl.find_root()
    config = pl.load_config(root, required=True)
    if not NAME_RX.match(args.name) or "/" in args.name:
        raise pl.PlError(f"a shot name is letters, digits, '_', '-' and '.', got '{args.name}'")
    shot_dir = pl.shot_path(args.name, root, config)
    made: list[str] = []
    kept: list[str] = []
    doc: dict[str, Any] = {"name": args.name, "meta": {k: _value(v) for k, v in _pairs(args.meta, "--meta")}}
    regions = {}
    for name, box in _pairs(args.region, "--region"):
        try:
            x0, y0, x1, y1 = (float(v) for v in box.split(","))
        except ValueError:
            raise pl.PlError(f"--region wants NAME=x0,y0,x1,y1 in 0..1, got '{box}'") from None
        if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
            raise pl.PlError(f"--region {name}: the box must lie in 0..1 with x0 < x1 and y0 < y1")
        regions[name] = [x0, y0, x1, y1]
    if regions:
        doc["regions"] = regions
    ids = {}
    for name, hexa in _pairs(args.id, "--id"):
        if not re.fullmatch(r"#?[0-9A-Fa-f]{6}", hexa):
            raise pl.PlError(f"--id wants NAME=RRGGBB, got '{hexa}'")
        h = hexa.lstrip("#")
        ids[name] = [int(h[i:i + 2], 16) for i in (0, 2, 4)]

    copies = []
    for target, src in _pairs(args.from_image, "--from-image"):
        source, _, pass_ = target.partition(".")
        pass_ = pass_ or "beauty"
        if pass_ not in pl.PASS_SUFFIX:
            raise pl.PlError(f"--from-image {target}: no pass '{pass_}' (have: {', '.join(pl.PASS_SUFFIX)})")
        if not Path(src).is_file():
            raise pl.PlError(f"--from-image {target}: no file {src}")
        copies.append((Path(src), pl.pass_file(shot_dir, source, pass_)))

    _create(shot_dir / "shot.json", json.dumps(doc, indent=2) + "\n", made, kept, root)
    if ids:
        _create(shot_dir / "ids.json", json.dumps(ids, indent=2) + "\n", made, kept, root)
    for src, dst in copies:
        rel = dst.relative_to(root).as_posix() if dst.is_relative_to(root) else str(dst)
        if dst.exists():
            kept.append(rel)
            continue
        if src.suffix.lower() == ".png":
            shutil.copyfile(src, dst)
        else:  # the contract's files are PNG: anything else is converted on the way in
            from PIL import Image

            with Image.open(src) as im:
                im.save(dst)
        made.append(rel)
    return {"root": str(root), "shot": args.name, "created": made, "exists": kept}


def new_success(args: argparse.Namespace) -> dict[str, Any]:
    """Copy assets/success-template.md to .perceptual-loop/success/<slug>.md; never overwrites."""
    root = pl.find_root()
    slug = re.sub(r"[^a-z0-9]+", "-", args.task.lower()).strip("-")
    if not slug:
        raise pl.PlError("the task needs at least one letter or digit")
    template = Path(__file__).resolve().parent.parent / "assets" / "success-template.md"
    path = pl.pl_dir(root) / "success" / f"{slug}.md"
    made: list[str] = []
    kept: list[str] = []
    _create(path, template.read_text(encoding="utf-8").replace("{{TASK}}", args.task), made, kept, root)
    return {"created": made, "exists": kept, "path": str(path)}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    try:
        if argv[:1] == ["new-shot"]:
            ap = argparse.ArgumentParser(prog="init.py new-shot", description="Create a shot folder with its shot.json and copy pictures in under the contract's names.")
            ap.add_argument("name", metavar="NAME", help="the shot's name; use a pattern such as <content>__<view>__<condition> so groups can glob it")
            ap.add_argument("--meta", action="append", default=[], metavar="K=V", help="free metadata for shot.json (repeatable); groups.py suggest-smoke reads it")
            ap.add_argument("--from-image", action="append", default=[], metavar="SOURCE[.PASS]=PATH",
                            help="copy a picture in as a pass of a source: reference=a.png, candidate.id=ids.png (passes: mask, id, depth, albedo; repeatable)")
            ap.add_argument("--id", action="append", default=[], metavar="NAME=RRGGBB", help="name a colour of the id pass (writes ids.json; repeatable)")
            ap.add_argument("--region", action="append", default=[], metavar="NAME=x0,y0,x1,y1", help="a box region in 0..1, for shots without an id or mask pass (repeatable)")
            ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
            args = ap.parse_args(argv[1:])
            doc = new_shot(args)
        elif argv[:1] == ["new-success"]:
            ap = argparse.ArgumentParser(prog="init.py new-success", description="Create a task's success file from the plugin's template (the define-success skill fills it in).")
            ap.add_argument("task", metavar="TASK", help="the task in a few words; the file is named after it")
            ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
            args = ap.parse_args(argv[1:])
            doc = new_success(args)
        else:
            ap = argparse.ArgumentParser(prog="init.py", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
            ap.add_argument("--root", metavar="DIR", help="the project root (default: the git root above the working directory, else the working directory)")
            ap.add_argument("--reference", default=pl.DEFAULT_CONFIG["reference"], metavar="ID", help="the reference source's id (default: reference)")
            ap.add_argument("--candidate", action="append", metavar="ID", help="a candidate source's id (repeatable; default: candidate)")
            ap.add_argument("--render", action="append", default=[], metavar="SOURCE=CMD",
                            help="the shell command that renders a source; {shots} {shotsDir} {source} are filled in (repeatable)")
            ap.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
            args = ap.parse_args(argv)
            doc = scaffold(args)
    except pl.PlError as e:
        pl.fail(str(e))
    lines = [f"created  {p}" for p in doc["created"]] + [f"exists   {p}  (left as it is)" for p in doc["exists"]]
    pl.emit(doc, args.json, "\n".join(lines) or "nothing to do")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
