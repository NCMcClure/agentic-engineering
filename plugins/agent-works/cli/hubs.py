"""aw hubs: verify the AGENTS.md orientation hubs of a source tree (whole repository, read-only).

    aw hubs [path] [--json] [--exclude PREFIX …]

The contract (core/references/hubs.md): the root AGENTS.md orients, every non-leaf code directory carries a short hub
that lists its direct children, and a directory with a hub holds no source files of its own.

  HUB_ROOT_MISSING    warning   the tree has source files but no root AGENTS.md (legacy trees ramp in)
  HUB_ISOLATION       critical  source files sit beside an AGENTS.md (warning until a root AGENTS.md exists)
  HUB_MISSING         warning   a non-leaf code directory carries no AGENTS.md
  HUB_MIXED_DIR       warning   a directory mixes loose source files with code sub-directories
  CLAUDE_CHAIN        warning   only when the root CLAUDE.md imports @AGENTS.md: a hub without its CLAUDE.md twin, a
                                twin with content of its own, an orphan CLAUDE.md
  ROOT_SIZE           warning   the root AGENTS.md is over budgets.rootAgentsLines
  HUB_SIZE            warning   a hub is over budgets.hubLines
  HUB_STALE_CHILD     warning   a hub lists a child that is not there
  HUB_UNLISTED_CHILD  warning   a hub does not name one of its code sub-directories

Never walked: dot-directories (so `.agents/` and `.git/`), a legacy `.plan/`, dependency and build folders, an
`archive/`, the prefixes given with --exclude, and those of a marker line in the root AGENTS.md:
    <!-- verify-agents-tree: skip generated/ data/fixtures/ -->

Exit 0 clean (also: no source files yet), 1 warnings only, 2 critical.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set

import common
from common import Finding

SKIP_DIRS = {
    ".git", ".agents", ".plan", "node_modules", "build", "dist", "target", "out", "third_party", "third-party",
    "vendor", "vendored", "__pycache__", ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache", ".tox",
    ".nox", ".idea", ".vscode", ".next", ".turbo", ".cache", "venv", "virtualenv", "env", ".venv", "archive",
}
# Package markers are structural glue, not content: a Python package cannot exist without __init__.py.
PACKAGE_MARKERS = {"__init__.py", "__init__.pyi"}
CODE_EXTS = {
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue", ".svelte", ".c", ".h", ".cc", ".cpp", ".cxx",
    ".hh", ".hpp", ".hxx", ".rs", ".go", ".java", ".kt", ".kts", ".swift", ".m", ".mm", ".rb", ".php", ".cs", ".fs",
    ".scala", ".clj", ".ex", ".exs", ".erl", ".hrl", ".hs", ".ml", ".mli", ".lua", ".zig", ".nim", ".d", ".jl", ".r",
    ".sh", ".bash", ".zsh", ".ps1", ".sql", ".proto",
}
SKIP_MARKER = re.compile(r"<!--\s*verify-agents-tree:\s*skip\s+([^>]+?)\s*-->")
TWIN = "@AGENTS.md"

# The child a list item or a table row is about: its leading code span or link.
_LEAD = re.compile(r"^\s*(?:[-*+]\s+|\d+[.)]\s+|\|\s*)(?:\*\*)?(?:`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))")
_CHILD = re.compile(r"^[A-Za-z0-9_.@+-]+(/[A-Za-z0-9_.@+-]+)*/?$")


def _read(path: Path) -> str:
    return common.read_text(path, "") or ""


def marker_skips(root_agents: Path, root: Path) -> Set[Path]:
    m = SKIP_MARKER.search(_read(root_agents))
    if not m:
        return set()
    return {(root / e.strip().rstrip("/")).resolve() for e in m.group(1).split() if e.strip()}


def listed_children(text: str) -> List[tuple]:
    """(line number, the path as written) of every child a hub's list items and table rows lead with."""
    out = []
    fenced = False
    for n, line in enumerate(text.splitlines(), 1):
        if re.match(r"^\s*(```|~~~)", line):
            fenced = not fenced
            continue
        if fenced:
            continue
        m = _LEAD.match(line)
        if not m:
            continue
        written = m.group(1) or ""
        if not written:  # a link: its target when it is relative, else its text
            target = m.group(3).split("#")[0]
            written = "" if re.match(r"^[a-z][a-z0-9+.-]*:", target, re.I) else target
            if written.endswith("/AGENTS.md"):
                written = written[:-len("AGENTS.md")]
        written = written.strip()
        if written.startswith("./"):
            written = written[2:]
        # A child is a folder (`name/`), a path, or a file name with an extension; a bare word may be a command.
        if not _CHILD.match(written) or written.startswith("..") or not ("/" in written or "." in written.strip(".")):
            continue
        out.append((n, written))
    return out


def verify(root: Path, excludes: Iterable[str] = (), cfg: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """{"findings": [Finding], "hubs": n, "claude_chain": bool} for the tree at ``root``."""
    cfg = cfg if cfg is not None else common.defaults()
    findings: List[Finding] = []
    root = root.resolve()
    root_agents = root / "AGENTS.md"
    skip_paths = marker_skips(root_agents, root) | {(root / e.strip("/")).resolve() for e in excludes if e}

    def skipped(d: Path) -> bool:
        return d.name.startswith(".") or d.name in SKIP_DIRS or d.resolve() in skip_paths

    direct_code: Dict[Path, bool] = {}
    subtree_code: Dict[Path, bool] = {}
    children: Dict[Path, List[Path]] = {}

    def walk(d: Path) -> bool:
        direct, kids = False, []
        try:
            entries = sorted(d.iterdir())
        except OSError:
            entries = []
        for e in entries:
            try:
                if e.is_dir():
                    if not skipped(e):
                        kids.append(e)
                elif e.suffix.lower() in CODE_EXTS and e.name not in PACKAGE_MARKERS and e.is_file():
                    direct = True
            except OSError:
                continue
        direct_code[d], children[d] = direct, kids
        sub = direct
        for k in kids:
            if walk(k):
                sub = True
        subtree_code[d] = sub
        return sub

    def rel(p: Path) -> str:
        r = common.posix(p.relative_to(root))
        return r or "."

    def size_check(hub: Path, is_root: bool, text: str) -> None:
        lines = common.line_count(text)
        limit = common.budget(cfg, "rootAgentsLines" if is_root else "hubLines")
        if lines > limit:
            findings.append(Finding("ROOT_SIZE" if is_root else "HUB_SIZE", "warning", rel(hub), 0,
                                    f"{lines} lines, the budget is {limit}: " +
                                    ("keep orientation and the rules here; move the why into decisions and memory"
                                     if is_root else "a hub lists its direct children, one line each")))

    if root_agents.is_file():
        size_check(root_agents, True, _read(root_agents))  # every session loads it, code or no code
    if not walk(root):
        return {"findings": findings, "hubs": 0, "claude_chain": False}  # no code yet: nothing else to check

    strict = root_agents.is_file()
    if not strict:
        findings.append(Finding("HUB_ROOT_MISSING", "warning", ".", 0,
                                "the tree has source files but no root AGENTS.md: write one (aw setup --plan shows how)"))

    hub_dirs: List[Path] = []
    for d in sorted(direct_code):
        hub = d / "AGENTS.md"
        has_hub = hub.is_file()
        if has_hub:
            hub_dirs.append(d)
        if has_hub and direct_code[d]:
            findings.append(Finding("HUB_ISOLATION", "critical" if strict else "warning", rel(d), 0,
                                    "source files sit directly beside AGENTS.md: move the code into sub-directories"))
        code_kids = [c for c in children[d] if subtree_code[c]]
        if code_kids and not has_hub:
            if direct_code[d]:
                findings.append(Finding("HUB_MIXED_DIR", "warning", rel(d), 0,
                                        "mixes loose source files with code sub-directories: move the files down a "
                                        "level, then add an AGENTS.md hub"))
            else:
                findings.append(Finding("HUB_MISSING", "warning", rel(d), 0,
                                        "non-leaf code directory without an AGENTS.md hub"))
        if not has_hub:
            continue

        text = _read(hub)
        if d != root:
            size_check(hub, False, text)
        for n, written in listed_children(text):
            if "*" in written or "<" in written:
                continue
            if d == root and "/" not in written:
                continue  # the root file is prose too: a bullet that leads with a file name is not a child line
            if not (d / written.rstrip("/")).exists():
                findings.append(Finding("HUB_STALE_CHILD", "warning", rel(hub), n, f"lists `{written}`, which is not there"))
        for kid in code_kids:
            if not re.search(r"(?<![\w.-])" + re.escape(kid.name) + r"(?![\w-])", text):
                findings.append(Finding("HUB_UNLISTED_CHILD", "warning", rel(hub), 0,
                                        f"does not name its code sub-directory `{kid.name}/`"))

    root_claude = root / "CLAUDE.md"
    chain = root_claude.is_file() and TWIN in _read(root_claude)
    if chain:
        for d in hub_dirs:
            claude = d / "CLAUDE.md"
            if not claude.is_file():
                findings.append(Finding("CLAUDE_CHAIN", "warning", rel(d), 0,
                                        "AGENTS.md has no sibling CLAUDE.md (run `aw twins`)"))
            elif d != root and _read(claude).strip() != TWIN:
                findings.append(Finding("CLAUDE_CHAIN", "warning", rel(claude), 0, "content must be exactly '@AGENTS.md'"))
        for d in sorted(direct_code):
            if (d / "CLAUDE.md").is_file() and not (d / "AGENTS.md").is_file():
                findings.append(Finding("CLAUDE_CHAIN", "warning", rel(d / "CLAUDE.md"), 0,
                                        "orphan CLAUDE.md (no sibling AGENTS.md)"))
    return {"findings": findings, "hubs": len(hub_dirs), "claude_chain": chain}


def find_root(path: Optional[str]) -> Path:
    """The given path, else the working tree's top (found by its .git), else the working directory."""
    if path:
        return Path(path).resolve()
    return (common.repo_root() or Path.cwd()).resolve()


def run(args: argparse.Namespace) -> int:
    root = find_root(args.path)
    if not root.is_dir():
        print(f"aw hubs: {root} is not a directory", file=sys.stderr)
        return 2
    excludes = [e for group in (args.exclude or []) for e in group]
    res = verify(root, excludes, common.load_config(root))
    extra = {"root": common.posix(root), "hubs": res["hubs"], "claude_chain": res["claude_chain"]}
    chain = "checked" if res["claude_chain"] else "not opted in"
    return common.report(res["findings"], args.json, f"hubs: {res['hubs']}, CLAUDE.md chain {chain}", extra)


def register(subparsers: Any) -> None:
    p = subparsers.add_parser("hubs", help="verify the AGENTS.md hub tree",
                              description="Verify the AGENTS.md orientation hubs. Exit 0 clean, 1 warnings, 2 critical.")
    p.add_argument("path", nargs="?", default=None, help="the tree's root (default: the working tree's top)")
    p.add_argument("--json", action="store_true", help="one JSON document: {summary, findings, …}")
    p.add_argument("--exclude", action="append", nargs="+", metavar="PREFIX",
                   help="repo-relative prefix to skip (repeatable; the root AGENTS.md skip marker adds more)")
    p.set_defaults(func=run)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="aw")
    register(parser.add_subparsers(dest="command"))
    return run(parser.parse_args(["hubs", *(sys.argv[1:] if argv is None else argv)]))


if __name__ == "__main__":
    sys.exit(main())
