#!/usr/bin/env python3
"""
Source-tree structure verifier (thin pass/fail wrapper over repo_scan.py).

This is a deterministic gate the optimize-codebase workflow's agents run to
check whether the Python source tree honors the codebase-organizer's
philosophy (`references/philosophy.md`). It does NOT re-derive structure
itself: it shells out to the organizer skill's `scripts/repo_scan.py`
(the single source of truth for "what's messy"), then thresholds that
deterministic JSON profile into pass/fail findings with exit codes.

Checks (severity):
1. FLAT_DIR_BLOAT (WARNING) — a package directory whose *source* file count
   meets/exceeds --flat-max (philosophy principle 3; the canonical default
   lives in repo_scan.py's FLAT_MAX_DEFAULT).
2. OVERSIZED_MODULE (INFO) — a source file at/over --module-max lines; the
   decompose stage's god-file signal (agrees with the workflow's discoverLines).
3. MISSING_INIT (CRITICAL) — a non-root directory under the subtree that holds
   .py modules but no __init__.py. Breaks the regular-package import contract
   that the workflow's re-export shims depend on. (Native check — orthogonal to
   repo_scan, not a duplication of it.)
4. CRUFT_PRESENT (WARNING) — backup/old/migration/.orig files repo_scan flags
   as quarantine candidates (never deleted; moved to archive/ by the organizer).
5. EPHEMERA_UNIGNORED (INFO) — build/test cache dirs that should be .gitignore'd.

Usage:
    python3 dev/bin/verify_source_structure.py [repo_path] [--subtree src]
        [--flat-max N] [--module-max 1500] [--json] [--scan-script PATH]

    repo_path defaults to the repo root inferred from this script's location
    (dev/bin/ -> two levels up). Findings are filtered to --subtree (default
    "src"); pass --subtree "" to report the whole repo.

    Exit code 0 = clean, 1 = warnings only, 2 = critical issues found.
"""

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Default location of the organizer skill's deterministic recon script,
# relative to the repo root. Overridable with --scan-script.
DEFAULT_SCAN_SCRIPT = ".claude/skills/codebase-organizer/scripts/repo_scan.py"

# Dirs that are never a Python package and should not be walked for the
# MISSING_INIT check (mirrors repo_scan's SKIP_DIRS intent, kept local so this
# script stays stdlib-only and self-contained).
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__",
    ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache",
    ".tox", ".nox", ".idea", ".vscode", "target", "dist", "build",
    ".next", ".turbo", ".cache", "vendor", ".egg-info",
}

# ---------------------------------------------------------------------------
# Data structures (mirrors .loom/bin/verify_knowledge_structure.py)
# ---------------------------------------------------------------------------

@dataclass
class Finding:
    severity: str          # CRITICAL, WARNING, INFO
    check: str             # short code like FLAT_DIR_BLOAT, MISSING_INIT
    path: str              # path relative to repo root
    message: str


@dataclass
class Report:
    repo_root: Path
    subtree: str = ""
    excludes: list = field(default_factory=list)
    total_files: int = 0
    total_dirs: int = 0
    findings: list = field(default_factory=list)

    def add(self, severity: str, check: str, path: str, message: str):
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


# ---------------------------------------------------------------------------
# repo_scan invocation
# ---------------------------------------------------------------------------

def run_repo_scan(scan_script: Path, repo_root: Path, flat_max):
    """Run repo_scan.py and return its parsed JSON profile, or raise.

    flat_max=None means "use repo_scan's canonical FLAT_MAX_DEFAULT" — the
    threshold is read back from the profile's overstuffed_threshold field, so
    the number lives in exactly one script.
    """
    cmd = [sys.executable, str(scan_script), str(repo_root)]
    if flat_max is not None:
        cmd += ["--overstuffed", str(flat_max)]
    proc = subprocess.run(
        cmd,
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0 and not proc.stdout.strip():
        raise RuntimeError(
            f"repo_scan.py failed (exit {proc.returncode}): {proc.stderr.strip()}")
    try:
        profile = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"repo_scan.py emitted non-JSON output: {exc}")
    if isinstance(profile, dict) and profile.get("error"):
        raise RuntimeError(f"repo_scan.py error: {profile['error']}")
    return profile


def in_subtree(rel_path: str, subtree: str) -> bool:
    """True if a repo-relative path is inside the subtree filter."""
    if not subtree:
        return True
    rel_path = rel_path.lstrip("./")
    return rel_path == subtree or rel_path.startswith(subtree.rstrip("/") + "/")


def is_excluded(rel_path: str, excludes) -> bool:
    """True if a repo-relative path is under any excluded prefix (e.g. the TS
    ui-tui workspace, which the decompose/deepen stages never touch)."""
    rel_path = rel_path.lstrip("./")
    for ex in (excludes or []):
        ex = ex.strip("/")
        if ex and (rel_path == ex or rel_path.startswith(ex + "/")):
            return True
    return False


# Standard build/test cache directory basenames — universally .gitignore'd, so
# reporting each one is noise. EPHEMERA only surfaces the non-standard cruft.
STD_CACHE_NAMES = {
    "__pycache__", ".pytest_cache", ".pytest-cache", ".ruff_cache",
    ".mypy_cache", ".tox", ".nox", ".cache",
}


def _is_std_cache(path: str) -> bool:
    return os.path.basename(path.rstrip("/")) in STD_CACHE_NAMES


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

def check_flat_dir_bloat(profile, report, flat_max):
    """Principle 3: a dir with too many source files should add a layer."""
    for d in profile.get("overstuffed_dirs", []):
        path = d.get("path", "")
        if not in_subtree(path, report.subtree) or is_excluded(path, report.excludes):
            continue
        n_source = d.get("source_file_count", 0)
        if n_source < flat_max:
            continue
        prefixes = ", ".join(
            f"{p['prefix']}*({p['count']})" for p in d.get("common_prefixes", [])
        ) or "no obvious prefix clusters"
        report.add(
            "WARNING", "FLAT_DIR_BLOAT", path,
            f"{n_source} source files (limit {flat_max}) — split into "
            f"subpackages by feature/type; clusters: {prefixes}",
        )


def check_oversized_module(profile, report, module_max):
    """Decompose signal: files at/over the god-file line threshold."""
    for f in profile.get("large_source_files", []):
        path = f.get("path", "")
        if not in_subtree(path, report.subtree) or is_excluded(path, report.excludes):
            continue
        lines = f.get("lines", 0)
        if lines < module_max:
            continue
        report.add(
            "INFO", "OVERSIZED_MODULE", path,
            f"{lines} lines (>= {module_max}) — decompose candidate",
        )


def check_cruft(profile, report):
    """Principle 5: surface backup/old/migration files for quarantine."""
    for path in profile.get("cruft", {}).get("files", []):
        if not in_subtree(path, report.subtree):
            continue
        report.add(
            "WARNING", "CRUFT_PRESENT", path,
            "looks like cruft (backup/old/migration/.orig) — quarantine to "
            "archive/ for human review, never auto-delete",
        )


def check_ephemera(profile, report):
    """Principle 5: surface NON-standard build cruft that should be .gitignore'd.

    Standard caches (__pycache__, .pytest_cache, .ruff_cache, …) are universally
    ignored already, so listing each is pure noise — we skip those and only flag
    the unusual artifacts (e.g. a tracked .egg-info) plus duplicate cache dirs.
    """
    cruft = profile.get("cruft", {})
    for path in cruft.get("dirs", []):
        if _is_std_cache(path):
            continue
        report.add(
            "INFO", "EPHEMERA_UNIGNORED", path,
            "build artifact / non-standard cache directory — add to .gitignore",
        )
    for pair in cruft.get("duplicate_cache_dirs", []):
        report.add(
            "INFO", "EPHEMERA_UNIGNORED", " / ".join(pair),
            "duplicate cache directories — consolidate and .gitignore",
        )


def check_missing_init(repo_root, report):
    """A package dir under the subtree with .py modules must have __init__.py.

    Native walk (orthogonal to repo_scan): the re-export shim contract the
    workflow leaves at old import paths only resolves if every directory in
    the path is a regular package.
    """
    base = repo_root / report.subtree if report.subtree else repo_root
    if not base.is_dir():
        return
    py_dirs = 0
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS and not d.endswith(".egg-info")
        ]
        d = Path(dirpath)
        # The subtree root itself (e.g. src/) is a source root, not a package.
        if d == base:
            continue
        rel_dir = os.path.relpath(dirpath, repo_root)
        if is_excluded(rel_dir, report.excludes):
            dirnames[:] = []  # don't descend into excluded trees (e.g. ui-tui)
            continue
        has_py = any(fn.endswith(".py") for fn in filenames)
        if not has_py:
            continue
        py_dirs += 1
        if "__init__.py" not in filenames:
            rel = os.path.relpath(dirpath, repo_root)
            n = sum(1 for fn in filenames if fn.endswith(".py"))
            report.add(
                "CRITICAL", "MISSING_INIT", rel,
                f"contains {n} .py module(s) but no __init__.py — not an "
                f"importable package; shims/imports targeting it will break",
            )
    report.total_dirs = py_dirs


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def print_report(report: Report):
    print("\n## Source Structure Report\n")
    print(f"**Path:** {report.repo_root}  |  **Subtree:** {report.subtree or '(whole repo)'}")
    print(f"**Package dirs scanned:** {report.total_dirs}\n")

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
        "subtree": report.subtree,
        "package_dirs": report.total_dirs,
        "summary": {
            "critical": report.critical_count,
            "warning": report.warning_count,
            "info": report.info_count,
        },
        "findings": [
            {"severity": f.severity, "check": f.check,
             "path": f.path, "message": f.message}
            for f in sorted(report.findings, key=lambda x: (x.severity, x.check, x.path))
        ],
    }, sys.stdout, indent=2)
    sys.stdout.write("\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Verify the source tree's structure via repo_scan.py.")
    ap.add_argument("repo_path", nargs="?",
                    help="repo root (default: inferred from this script's location)")
    ap.add_argument("--subtree", default="src",
                    help="restrict findings to this repo-relative subtree "
                         "(default: src; pass '' for the whole repo)")
    ap.add_argument("--flat-max", type=int, default=None,
                    help="source files per dir before FLAT_DIR_BLOAT "
                         "(default: repo_scan.py's canonical FLAT_MAX_DEFAULT)")
    ap.add_argument("--module-max", type=int, default=1500,
                    help="lines before OVERSIZED_MODULE (default 1500)")
    ap.add_argument("--scan-script", default=None,
                    help="path to repo_scan.py (default: organizer skill copy)")
    ap.add_argument("--exclude", action="append", default=None,
                    help="repo-relative prefix to skip in the Python-structure "
                         "checks (repeatable; default: src/ui-tui — the TS "
                         "workspace the decompose/deepen stages never touch). "
                         "Pass --exclude '' to disable the default.")
    ap.add_argument("--json", action="store_true",
                    help="emit machine-readable JSON instead of markdown")
    args = ap.parse_args()

    excludes = args.exclude if args.exclude is not None else ["src/ui-tui"]
    excludes = [e for e in excludes if e]  # drop empties (allows --exclude '')

    if args.repo_path:
        repo_root = Path(args.repo_path).resolve()
    else:
        repo_root = Path(__file__).resolve().parent.parent.parent

    if not repo_root.is_dir():
        print(f"Error: {repo_root} is not a directory", file=sys.stderr)
        sys.exit(2)

    scan_script = (Path(args.scan_script).resolve() if args.scan_script
                   else repo_root / DEFAULT_SCAN_SCRIPT)
    if not scan_script.is_file():
        print(f"Error: repo_scan.py not found at {scan_script} "
              f"(pass --scan-script)", file=sys.stderr)
        sys.exit(2)

    report = Report(repo_root=repo_root, subtree=args.subtree.strip("/"),
                    excludes=excludes)

    try:
        profile = run_repo_scan(scan_script, repo_root, args.flat_max)
    except (RuntimeError, subprocess.SubprocessError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(2)

    report.total_files = profile.get("totals", {}).get("total_files", 0)

    # Effective threshold: explicit flag, else the canonical default echoed
    # back by repo_scan in the profile (single source of the number).
    flat_max = (args.flat_max if args.flat_max is not None
                else profile.get("overstuffed_threshold"))

    check_missing_init(repo_root, report)
    if flat_max is not None:
        check_flat_dir_bloat(profile, report, flat_max)
    check_oversized_module(profile, report, args.module_max)
    check_cruft(profile, report)
    check_ephemera(profile, report)

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
