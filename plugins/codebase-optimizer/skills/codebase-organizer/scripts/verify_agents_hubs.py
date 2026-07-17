#!/usr/bin/env python3
"""
AGENTS.md hub verifier (whole-repo, read-only, stdlib-only).

Checks the AGENTS.md orientation-hub structure over a source tree, per the
contract in the organizer skill's `references/agent-hubs.md` (kept in
intentional sync with but-first-planning's CODEBASE-LAYOUT.md — same rules,
same skip marker):

1. HUB_ROOT_MISSING (WARNING) — the repo has source files but no root
   AGENTS.md. Legacy repos ramp in; nothing hard-fails until the root hub
   exists.
2. HUB_ISOLATION — a directory carrying an AGENTS.md holds source files
   directly (code belongs in subdirectories; manifests/README/dotfiles/CI
   config and package markers like __init__.py are exempt). CRITICAL once a
   root AGENTS.md exists (the repo has opted in), WARNING before that.
3. HUB_MISSING (WARNING) — a non-leaf code directory (its subdirectories
   contain code) carries no AGENTS.md.
4. HUB_MIXED_DIR (WARNING) — a directory mixes loose source files with code
   subdirectories; it can't satisfy both hub rules until the files move down
   a level.
5. CLAUDE_CHAIN (WARNING) — only when the root CLAUDE.md contains
   `@AGENTS.md` (the opt-in signal): every AGENTS.md needs a sibling
   CLAUDE.md whose content is exactly `@AGENTS.md`, and no CLAUDE.md may be
   an orphan.

Hub *scope* (direct children only) and staleness stay prose-enforced — a
mechanical check for either would be noise.

Unlike verify_source_structure.py this is deliberately whole-repo (root hub,
root CLAUDE.md signal, every non-leaf dir) — no --subtree. Extra exclusions:
--exclude prefixes, or a marker line in the root AGENTS.md:
    <!-- verify-agents-tree: skip generated/ data/fixtures/ -->

Usage:
    python3 verify_agents_hubs.py [repo_path] [--json] [--exclude PREFIX ...]

    repo_path defaults to the current directory (the workflows cd into the
    repo and pass '.'). Exit 0 = clean (also: no source files yet),
    1 = warnings only, 2 = critical issues found.
"""

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Never walked. `archive/` is the organizer's cruft quarantine — deliberately
# non-navigable, so it neither needs hubs nor counts as code.
SKIP_DIRS = {
    ".git", ".plan", "node_modules", "build", "dist", "target", "out",
    "third_party", "third-party", "vendor", "vendored", "__pycache__",
    ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache",
    ".tox", ".nox", ".idea", ".vscode", ".next", ".turbo", ".cache",
    "venv", "virtualenv", "env", ".venv", "archive",
}
# Package markers are structural glue, not content — a Python package dir
# cannot exist without __init__.py, so it never violates hub isolation.
PACKAGE_MARKERS = {"__init__.py", "__init__.pyi"}
CODE_EXTS = {
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".vue",
    ".svelte", ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx",
    ".rs", ".go", ".java", ".kt", ".kts", ".swift", ".m", ".mm", ".rb",
    ".php", ".cs", ".fs", ".scala", ".clj", ".ex", ".exs", ".erl", ".hrl",
    ".hs", ".ml", ".mli", ".lua", ".zig", ".nim", ".d", ".jl", ".r",
    ".sh", ".bash", ".zsh", ".ps1", ".sql", ".proto",
}
SKIP_MARKER_RE = re.compile(r"<!--\s*verify-agents-tree:\s*skip\s+([^>]+?)\s*-->")


@dataclass
class Finding:
    severity: str          # CRITICAL, WARNING, INFO
    check: str             # HUB_ISOLATION, HUB_MISSING, ...
    path: str              # path relative to repo root
    message: str


@dataclass
class Report:
    repo_root: Path
    findings: list = field(default_factory=list)
    hubs: int = 0
    chain: bool = False

    def add(self, severity, check, path, message):
        self.findings.append(Finding(severity, check, path, message))

    @property
    def critical_count(self):
        return sum(1 for f in self.findings if f.severity == "CRITICAL")

    @property
    def warning_count(self):
        return sum(1 for f in self.findings if f.severity == "WARNING")

    @property
    def info_count(self):
        return sum(1 for f in self.findings if f.severity == "INFO")


def load_marker_skips(root_agents: Path, repo_root: Path):
    if not root_agents.is_file():
        return set()
    m = SKIP_MARKER_RE.search(root_agents.read_text(errors="replace"))
    if not m:
        return set()
    return {
        (repo_root / entry.strip().rstrip("/")).resolve()
        for entry in m.group(1).split() if entry.strip()
    }


def verify(repo_root: Path, excludes) -> Report:
    report = Report(repo_root=repo_root)
    root_agents = repo_root / "AGENTS.md"
    skip_paths = load_marker_skips(root_agents, repo_root)
    skip_paths |= {(repo_root / e.strip("/")).resolve() for e in excludes if e}

    def skipped(d: Path) -> bool:
        return (d.name.startswith(".") or d.name in SKIP_DIRS
                or d.resolve() in skip_paths)

    has_direct_code, subtree_has_code, child_dirs = {}, {}, {}

    def walk(d: Path) -> bool:
        direct, children = False, []
        try:
            entries = sorted(d.iterdir())
        except OSError:
            entries = []
        for entry in entries:
            if entry.is_dir():
                if not skipped(entry):
                    children.append(entry)
            elif (entry.is_file() and entry.suffix.lower() in CODE_EXTS
                    and entry.name not in PACKAGE_MARKERS):
                direct = True
        has_direct_code[d], child_dirs[d] = direct, children
        sub = direct
        for child in children:
            if walk(child):
                sub = True
        subtree_has_code[d] = sub
        return sub

    if not walk(repo_root):
        return report  # code-less repo: clean by definition

    strict = root_agents.is_file()
    if not strict:
        report.add("WARNING", "HUB_ROOT_MISSING", ".",
                   "repo has source files but no root AGENTS.md — scaffold it "
                   "per references/agent-hubs.md")

    def rel(p: Path) -> str:
        r = str(p.relative_to(repo_root))
        return r if r != "." else "."

    hub_dirs = []
    for d in sorted(has_direct_code):
        has_hub = (d / "AGENTS.md").is_file()
        if has_hub:
            hub_dirs.append(d)
        if has_hub and has_direct_code[d]:
            report.add(
                "CRITICAL" if strict else "WARNING", "HUB_ISOLATION", rel(d),
                "source files sit directly beside AGENTS.md — move code into "
                "subdirectories (hub isolation)",
            )
        code_children = [c for c in child_dirs[d] if subtree_has_code[c]]
        if code_children and not has_hub:
            if has_direct_code[d]:
                report.add(
                    "WARNING", "HUB_MIXED_DIR", rel(d),
                    "mixes loose source files with code subdirectories — move "
                    "the files down a level, then add an AGENTS.md hub",
                )
            else:
                report.add(
                    "WARNING", "HUB_MISSING", rel(d),
                    "non-leaf code directory without an AGENTS.md hub",
                )

    report.hubs = len(hub_dirs)

    root_claude = repo_root / "CLAUDE.md"
    chain = (root_claude.is_file()
             and "@AGENTS.md" in root_claude.read_text(errors="replace"))
    report.chain = chain
    if chain:
        for d in hub_dirs:
            claude = d / "CLAUDE.md"
            if not claude.is_file():
                report.add("WARNING", "CLAUDE_CHAIN", rel(d),
                           "AGENTS.md has no sibling CLAUDE.md (repo opted in "
                           "via the root import)")
            elif claude.read_text(errors="replace").strip() != "@AGENTS.md" \
                    and d != repo_root:
                report.add("WARNING", "CLAUDE_CHAIN", rel(claude),
                           "content must be exactly '@AGENTS.md'")
        for d in sorted(has_direct_code):
            if (d / "CLAUDE.md").is_file() and not (d / "AGENTS.md").is_file():
                report.add("WARNING", "CLAUDE_CHAIN", rel(d / "CLAUDE.md"),
                           "orphan CLAUDE.md (no sibling AGENTS.md)")
    return report


def print_report(report: Report):
    print("\n## AGENTS.md Hub Report\n")
    print(f"**Path:** {report.repo_root}  |  **Hubs:** {report.hubs}  |  "
          f"**CLAUDE.md chain:** {'checked' if report.chain else 'not opted in'}\n")
    for severity in ("CRITICAL", "WARNING", "INFO"):
        items = [f for f in report.findings if f.severity == severity]
        if not items:
            continue
        print(f"### {severity} ({len(items)})\n")
        for f in sorted(items, key=lambda x: (x.check, x.path)):
            print(f"- **[{f.check}]** `{f.path}` — {f.message}")
        print()
    print("### Summary\n")
    print("| Severity | Count |")
    print("|----------|-------|")
    print(f"| Critical | {report.critical_count} |")
    print(f"| Warning  | {report.warning_count} |")
    print(f"| Info     | {report.info_count} |")
    if report.critical_count == 0 and report.warning_count == 0:
        print("\nAll checks passed.")


def print_json(report: Report):
    json.dump({
        "root": str(report.repo_root),
        "hubs": report.hubs,
        "claude_chain": report.chain,
        "summary": {
            "critical": report.critical_count,
            "warning": report.warning_count,
            "info": report.info_count,
        },
        "findings": [
            {"severity": f.severity, "check": f.check,
             "path": f.path, "message": f.message}
            for f in sorted(report.findings,
                            key=lambda x: (x.severity, x.check, x.path))
        ],
    }, sys.stdout, indent=2)
    sys.stdout.write("\n")


def main():
    ap = argparse.ArgumentParser(
        description="Verify the AGENTS.md orientation-hub structure.")
    ap.add_argument("repo_path", nargs="?", default=".",
                    help="repo root (default: current directory)")
    ap.add_argument("--exclude", action="append", default=[],
                    help="repo-relative prefix to skip (repeatable; the root "
                         "AGENTS.md skip marker adds more)")
    ap.add_argument("--json", action="store_true",
                    help="emit machine-readable JSON instead of markdown")
    args = ap.parse_args()

    repo_root = Path(args.repo_path).resolve()
    if not repo_root.is_dir():
        print(f"Error: {repo_root} is not a directory", file=sys.stderr)
        sys.exit(2)

    report = verify(repo_root, args.exclude)

    if args.json:
        print_json(report)
    else:
        print_report(report)

    if report.critical_count > 0:
        sys.exit(2)
    elif report.warning_count > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
