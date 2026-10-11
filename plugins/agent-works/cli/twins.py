"""aw twins: the CLAUDE.md beside every AGENTS.md.

    aw twins            write what is missing (per claude.twins of the config)
    aw twins --check    list what is missing or stale, write nothing; exit 1 when something is

The agent guidance of a repository is tool-neutral (AGENTS.md); Claude Code reads CLAUDE.md. A twin is a one-line file
that imports its sibling (`@AGENTS.md`): portable, where a symlink needs a permission Windows often withholds. A
symlink to AGENTS.md that is already there counts as a twin and is left alone.

claude.twins:  generated  twins are git-ignored and healed at session start (the default)
               committed  twins are tracked; this command still writes the missing ones
               off        no twins

  GEN_TWIN_MISSING  warning  an AGENTS.md without its CLAUDE.md, or a CLAUDE.md with content of its own beside one
  GEN_TWIN_ORPHAN   warning  a twin whose AGENTS.md is gone
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import common
from common import Finding

STUB = "@AGENTS.md\n"
MODES = ("generated", "committed")
SKIP_DIRS = {"node_modules", "build", "dist", "target", "out", "vendor", "third_party", "__pycache__", "venv", "archive"}


def mode_of(cfg: Dict[str, Any]) -> str:
    return str((cfg.get("claude") or {}).get("twins") or "generated").lower()


def _walk(root: Path, name: str) -> List[str]:
    found = []
    for base, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in SKIP_DIRS)
        if name in files:
            found.append(common.rel(Path(base) / name, root))
    return sorted(found)


def agents_files(root: Path) -> List[str]:
    """Every AGENTS.md git knows or would add (tracked and untracked, ignored paths left out); a walk without git."""
    code, out = common.git(["ls-files", "--cached", "--others", "--exclude-standard", "--", "AGENTS.md", "**/AGENTS.md"], root)
    if code != 0:
        return _walk(root, "AGENTS.md")
    names = {l.strip().strip('"') for l in out.splitlines() if l.strip()}
    return sorted(n for n in names if (root / n).is_file())


def state_of(file: Path) -> str:
    """link (a symlink to AGENTS.md) | stub | other | none."""
    try:
        if file.is_symlink():
            return "link" if os.readlink(file).replace("\\", "/") == "AGENTS.md" else "other"
        if not file.exists():
            return "none"
    except OSError:
        return "none"
    text = common.read_text(file)
    return "stub" if text is not None and text.strip() == "@AGENTS.md" else "other"


def heal(root: Path, cfg: Optional[Dict[str, Any]] = None, check: bool = False, orphans: bool = True) -> Dict[str, Any]:
    """Write the missing twins (or only report them with ``check``).

    Returns {"mode", "written": [paths], "removed": [paths], "findings": [Finding], "root_created": bool}.
    ``orphans=False`` skips the walk for twins whose AGENTS.md is gone (the session hook's quick pass).
    """
    cfg = cfg if cfg is not None else common.load_config(root)
    mode = mode_of(cfg)
    res: Dict[str, Any] = {"mode": mode, "written": [], "removed": [], "findings": [], "root_created": False}
    if mode not in MODES:
        return res
    hubs = agents_files(root)
    for agents in hubs:
        rel = (agents[:-len("AGENTS.md")] + "CLAUDE.md")
        file = root / rel
        state = state_of(file)
        if state in ("link", "stub"):
            continue
        if state == "other":
            res["findings"].append(Finding("GEN_TWIN_MISSING", "warning", rel, 0,
                                           "has content of its own: move that into the AGENTS.md beside it and leave "
                                           "the one line `@AGENTS.md`"))
            continue
        if check:
            res["findings"].append(Finding("GEN_TWIN_MISSING", "warning", rel, 0, "is missing (run `aw twins`)"))
            continue
        try:
            with open(file, "w", encoding="utf-8", newline="\n") as f:
                f.write(STUB)
        except OSError as e:
            res["findings"].append(Finding("GEN_TWIN_MISSING", "warning", rel, 0, f"could not be written: {e}"))
            continue
        res["written"].append(rel)
        if rel == "CLAUDE.md":
            res["root_created"] = True
    if orphans:
        have = {h[:-len("AGENTS.md")] for h in hubs}
        for rel in _walk(root, "CLAUDE.md"):
            folder = rel[:-len("CLAUDE.md")]
            if folder in have or (root / folder / "AGENTS.md").is_file() or state_of(root / rel) != "stub":
                continue  # a CLAUDE.md with content of its own and no AGENTS.md is the owner's, not a twin
            if check or mode != "generated":
                res["findings"].append(Finding("GEN_TWIN_ORPHAN", "warning", rel, 0,
                                               "imports an AGENTS.md that is not there: delete it"))
            else:
                try:
                    (root / rel).unlink()
                    res["removed"].append(rel)
                except OSError:
                    pass
    return res


def findings(root: Path, cfg: Optional[Dict[str, Any]] = None) -> List[Finding]:
    """What doctor reports: the check, writing nothing."""
    return heal(root, cfg, check=True)["findings"]


def run(args: argparse.Namespace) -> int:
    if common.find_config() is None:
        common.emit({"mode": None, "written": [], "summary": {"critical": 0, "warning": 0, "info": 0}, "findings": []}
                    if args.json else "aw twins: no .agents/agent-works.json here, nothing to do (aw setup --plan)", args.json)
        return 0
    root = common.project_root()
    cfg = common.load_config(root)
    res = heal(root, cfg, check=args.check)
    if res["mode"] not in MODES:
        common.emit(common.findings_doc([], {"mode": res["mode"], "written": []}) if args.json
                    else f"aw twins: claude.twins is \"{res['mode']}\", nothing to do", args.json)
        return 0
    extra = {"mode": res["mode"], "written": res["written"], "removed": res["removed"]}
    if args.json:
        return common.report(res["findings"], True, extra=extra)
    for rel in res["written"]:
        print(f"wrote {rel}")
    for rel in res["removed"]:
        print(f"removed {rel} (its AGENTS.md is gone)")
    done = f"{len(res['written'])} written" if not args.check else "checked"
    return common.report(res["findings"], False, f"twins ({res['mode']}, {done})")


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("twins", help="write or check the CLAUDE.md twin beside every AGENTS.md",
                              description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="list what is missing or stale; write nothing")
    p.add_argument("--json", action="store_true")
    p.set_defaults(func=run)
