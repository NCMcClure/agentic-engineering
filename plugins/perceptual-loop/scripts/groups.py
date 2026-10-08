# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Shot groups: list them, show one, resolve a selection, propose a smoke group.

Also the home of the selection flags every script shares (shot names, --group, --match, --all), so that
"which shots does this command mean" has one answer across compare, sheet, baseline and iterate.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pl_common as pl  # noqa: E402


def utf8_stdio() -> None:
    """Arrows and deltas must not crash a Windows console that still speaks cp1252."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass


def add_selection(parser: argparse.ArgumentParser) -> None:
    g = parser.add_argument_group("selection (the same in every script)")
    g.add_argument("shots", nargs="*", metavar="SHOT", help="shot names or globs; commas allowed (a,b)")
    g.add_argument("--shots", dest="shots_opt", metavar="A,B", help="the same as naming them, for use after other flags")
    g.add_argument("--group", metavar="NAME", help="a group of groups.json")
    g.add_argument("--match", metavar="GLOB", help="narrow the selection to names matching this glob")
    g.add_argument("--all", action="store_true", help="every shot in the shots folder")


def has_selection(args: argparse.Namespace) -> bool:
    if args.shots_opt:  # fold --shots into the names once, so the rest sees one list
        args.shots, args.shots_opt = [*args.shots, args.shots_opt], None
    return bool(args.shots or args.group or args.all)


def selected(args: argparse.Namespace, root: Path, config: dict) -> list[str]:
    """The shots the flags mean; an empty or absent selection is a usage error, never 'everything'."""
    if not has_selection(args):
        raise pl.PlError("no shots selected: name 1-3 shots that show the thing, or use --group NAME / --all")
    shots = pl.resolve_shots(args.shots, args.group, args.match, args.all, root, config)
    if not shots:
        raise pl.PlError("the selection matches no shot (groups.py list shows the groups, groups.py resolve --all the shots)")
    return shots


# --------------------------------------------------------------------------------------------------- suggest-smoke

def suggest_smoke(metas: dict[str, dict], dimensions: list[list[str]]) -> tuple[list[str], dict[str, list[str]], int]:
    """Greedy set cover: the fewest shots such that every value combination of every dimension is seen once.

    A dimension is a list of meta keys (`car,track` = every pair that exists). With several dimensions a shot
    covers one element of each, which is where greedy beats 'one shot per combination'.
    """
    covers: dict[str, set[tuple]] = {}
    for shot, meta in metas.items():
        elems = set()
        for dim in dimensions:
            if any(k in meta for k in dim):  # a shot that has none of the keys says nothing about this dimension
                elems.add((tuple(dim), tuple(json.dumps(meta.get(k), sort_keys=True) for k in dim)))
        covers[shot] = elems
    todo = set().union(*covers.values()) if covers else set()
    total = len(todo)
    picked: list[str] = []
    why: dict[str, list[str]] = {}
    while todo:
        # most new elements first; the name breaks ties so the proposal is stable between runs
        best = max(sorted(covers), key=lambda s: len(covers[s] & todo))
        gained = covers[best] & todo
        picked.append(best)
        why[best] = sorted(", ".join(f"{k}={json.loads(v)}" for k, v in zip(dim, vals)) for dim, vals in gained)
        todo -= gained
    return picked, why, total


# --------------------------------------------------------------------------------------------------------------- cli

def main(argv: list[str] | None = None) -> int:
    utf8_stdio()
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 epilog="groups.json maps a group to globs over shot names; '!glob' excludes.")
    js = argparse.ArgumentParser(add_help=False)
    js.add_argument("--json", action="store_true", help="print one JSON document and nothing else")
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="{list,show,resolve,suggest-smoke}")
    sub.add_parser("list", parents=[js], help="the groups and how many shots each selects")
    p = sub.add_parser("show", parents=[js], help="the shots of one group")
    p.add_argument("name", metavar="GROUP")
    p.add_argument("--match", metavar="GLOB", help="narrow to names matching this glob")
    p = sub.add_parser("resolve", parents=[js], help="print the shot names a selection means, one per line")
    add_selection(p)
    p = sub.add_parser("suggest-smoke", parents=[js], help="the fewest shots covering every value combination of meta keys")
    p.add_argument("--by", action="append", required=True, metavar="KEY[,KEY]",
                   help="shot.json meta keys whose value combinations must each appear once; repeat the flag "
                        "to cover several things independently (--by car,track --by weather)")
    add_selection(p)
    args = ap.parse_args(argv)

    try:
        root = pl.find_root()
        config = pl.load_config(root)
        if args.cmd == "list":
            have, groups = pl.all_shots(root, config), pl.load_groups(root)
            doc = {"shots": len(have), "groups": {g: len(pl.match_globs(have, globs)) for g, globs in groups.items()}}
            width = max([len(g) for g in groups] + [5])
            text = "\n".join([f"{g:<{width}}  {n:>4}  {' '.join(groups[g])}" for g, n in doc["groups"].items()]
                             + [f"{'(all)':<{width}}  {len(have):>4}"])
            pl.emit(doc, args.json, text)
        elif args.cmd == "show":
            shots = pl.resolve_shots(group=args.name, match=args.match, root=root, config=config)
            pl.emit({"group": args.name, "shots": shots}, args.json, "\n".join(shots))
        elif args.cmd == "resolve":
            shots = selected(args, root, config)
            pl.emit({"shots": shots}, args.json, "\n".join(shots))
        else:
            pool = selected(args, root, config) if has_selection(args) else pl.all_shots(root, config)
            if not pool:
                raise pl.PlError("no shots yet: create some with init.py new-shot")
            metas = {s: (pl.read_json(pl.shot_path(s, root, config) / "shot.json", {}) or {}).get("meta") or {} for s in pool}
            dims = [[k for k in d.split(",") if k] for d in args.by]
            unknown = [k for d in dims for k in d if not any(k in m for m in metas.values())]
            if unknown:
                raise pl.PlError(f"no shot has meta key: {', '.join(unknown)}")
            picked, why, total = suggest_smoke(metas, dims)
            doc = {"by": args.by, "combinations": total, "of": len(pool), "smoke": picked, "covers": why}
            lines = [f"{len(picked)} of {len(pool)} shots cover the {total} combinations of {' + '.join(args.by)}:"]
            width = max(len(s) for s in picked) if picked else 0
            lines += [f"  {s:<{width}}  {'; '.join(why[s])}" for s in picked]
            lines += ["", "paste into groups.json:", '  "smoke": ' + json.dumps(picked)]
            pl.emit(doc, args.json, "\n".join(lines))
    except pl.PlError as e:
        pl.fail(str(e))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
