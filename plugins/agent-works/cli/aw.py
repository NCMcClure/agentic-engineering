#!/usr/bin/env python3
"""aw: the one command line of agent-works.

    aw <command> [args]        aw --help lists the commands; aw <command> --help explains one

Each command lives in a module beside this file that exposes ``register(subparsers)``. The modules are imported
lazily and tolerantly: one that is missing or fails to import is listed as unavailable and never breaks the others.
"""
from __future__ import annotations

import argparse
import importlib
import os
import sys
from typing import Dict, List, Optional, Tuple

sys.dont_write_bytecode = True
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# module -> (the commands it registers, one line for --help)
MODULES: List[Tuple[str, Tuple[str, ...], str]] = [
    ("setup", ("setup",), "set a repository up for agent work, or adopt an existing one (--plan, --apply)"),
    ("doctor", ("doctor",), "run every check: sizes, duplication, staleness, agent files in the user docs"),
    ("status", ("status",), "derived status: the board, owed gates, locks, claims, recent merges"),
    ("hubs", ("hubs",), "verify the AGENTS.md hub tree"),
    ("twins", ("twins",), "write or check the CLAUDE.md twin beside every AGENTS.md"),
    ("memory", ("memory",), "project memory: lint, index, new, touch"),
    ("decisions", ("decisions",), "decision records and the glossary: new, index, lint"),
    ("links", ("links",), "check the links and paths of the agent files"),
    ("dup", ("dup",), "find a rule stated in more than one place"),
    ("kanban", ("kanban",), "the task board: list, add, move, owe, settle, lint"),
    ("coord.locks", ("lock",), "exclusive locks on scarce resources: run, acquire, release, status"),
    ("coord.leases", ("lease", "leases"), "declare shared use of a machine resource for the length of a command"),
    ("coord.sysinfo", ("sys",), "live machine readings beside the leases and locks held"),
    ("coord.notes", ("note", "notes"), "short notes to other agents"),
    ("coord.claims", ("claim", "claims"), "claim a shared counter until a merge lands"),
    ("coord.learnings", ("learn",), "learnings shared across projects: add, search, show, list"),
    ("coord.agents", ("who", "agent"), "who is running on this machine"),
]


def _owner(command: str) -> Optional[str]:
    for module, commands, _ in MODULES:
        if command in commands:
            return module
    return None


def _first_command(argv: List[str]) -> Optional[str]:
    for a in argv:
        if not a.startswith("-"):
            return a
    return None


def build_parser(only: Optional[str] = None) -> Tuple[argparse.ArgumentParser, Dict[str, str]]:
    """The parser with every importable module registered (or only the module ``only``), and what failed."""
    parser = argparse.ArgumentParser(prog="aw", description="agent-works: project tools and machine-wide coordination.",
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", metavar="DIR", help="work as if started in DIR (default: the working directory)")
    sub = parser.add_subparsers(dest="command", metavar="<command>")
    failed: Dict[str, str] = {}
    for module, _commands, _help in MODULES:
        if only is not None and module != only:
            continue
        try:
            mod = importlib.import_module(module)
            mod.register(sub)
        except Exception as e:  # a broken module must not take the others down
            failed[module] = f"{type(e).__name__}: {e}"
    return parser, failed


def _help_text(failed: Dict[str, str]) -> str:
    lines = ["commands:"]
    for module, commands, text in MODULES:
        mark = "  (unavailable)" if module in failed else ""
        lines.append(f"  {', '.join(commands):16} {text}{mark}")
    if failed:
        lines.append("")
        lines.append("unavailable:")
        lines += [f"  {m}: {why}" for m, why in failed.items()]
    lines.append("")
    lines.append("exit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error; aw lock: 3 still queued")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    # --root DIR may stand anywhere before a `--`; it is applied before any module looks for the project.
    root: Optional[str] = None
    i = 0
    while i < len(argv) and argv[i] != "--":
        if argv[i] == "--root" and i + 1 < len(argv):
            root = argv[i + 1]
            del argv[i:i + 2]
            continue
        if argv[i].startswith("--root="):
            root = argv[i].split("=", 1)[1]
            del argv[i]
            continue
        i += 1
    if root:
        try:
            os.chdir(root)
        except OSError as e:
            print(f"aw: --root {root}: {e}", file=sys.stderr)
            return 2

    command = _first_command(argv)
    owner = _owner(command) if command else None
    if command and owner is None:
        _, failed = build_parser()
        print(f"aw: no command '{command}'\n\n{_help_text(failed)}", file=sys.stderr)
        return 2

    # One command: import only its module, so `aw note` does not pay for the others.
    parser, failed = build_parser(owner)
    if owner and owner in failed:
        print(f"aw {command}: unavailable ({failed[owner]})", file=sys.stderr)
        return 2
    if owner is None:
        parser, failed = build_parser()
        parser.epilog = _help_text(failed)
        parser.print_help()
        return 0 if any(a in ("-h", "--help") for a in argv) or not argv else 2

    args = parser.parse_args(argv)
    func = getattr(args, "func", None)
    if func is None:
        parser.parse_args([*argv, "--help"])
        return 2
    try:
        code = func(args)
    except KeyboardInterrupt:
        return 130
    except BrokenPipeError:
        return 0
    except Exception as e:
        if type(e).__name__ in ("AwError", "CoordError", "KanbanError"):
            print(f"aw {command}: {e}", file=sys.stderr)
            return 2
        raise
    return int(code or 0)


if __name__ == "__main__":
    sys.exit(main())
