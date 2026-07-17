"""Codebase AGENTS.md hub verifier (count-agnostic).

Read-only, stdlib only. Validates the AGENTS.md orientation hubs over the
target repo's source tree, per the contract owned by spec-1-specify's
CODEBASE-LAYOUT.md:

  * a root AGENTS.md exists once the repo has code;
  * hub isolation — a directory carrying an AGENTS.md holds no source files
    directly (code lives in subdirectories; manifests/README/dotfiles exempt);
  * every non-leaf code directory carries an AGENTS.md hub;
  * when the repo opted into Claude Code support (root CLAUDE.md contains
    `@AGENTS.md`), every AGENTS.md has a sibling CLAUDE.md whose content is
    exactly `@AGENTS.md`, and no CLAUDE.md is an orphan.

Hub *scope* (direct children only) and staleness stay prose-enforced.

Exits 0 clean (including a repo with no code yet), 1 on warnings only,
2 on any critical violation. Hub isolation is CRITICAL once a root AGENTS.md
exists (the tree has opted in); everything else warns, so legacy repos ramp
in without breaking mid-build.

Extra exclusions: add a marker line to the root AGENTS.md —
    <!-- verify-agents-tree: skip generated/ data/fixtures/ -->
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

# Deployed at <repo>/.plan/plan/verify-agents-tree.py
PLAN_DIR = Path(__file__).resolve().parent
REPO_ROOT = PLAN_DIR.parent.parent

SKIP_DIR_NAMES = {
    ".plan", "node_modules", "build", "dist", "target", "out",
    "third_party", "third-party", "vendor", "vendored", "__pycache__",
    "venv", "virtualenv", "env", ".venv",
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


def rel(p: Path) -> str:
    return str(p.relative_to(REPO_ROOT)) or "."


def load_extra_skips(root_agents: Path) -> set[Path]:
    if not root_agents.exists():
        return set()
    m = SKIP_MARKER_RE.search(root_agents.read_text())
    if not m:
        return set()
    return {
        (REPO_ROOT / entry.strip().rstrip("/")).resolve()
        for entry in m.group(1).split()
        if entry.strip()
    }


def verify() -> int:
    failures: list[str] = []
    warnings: list[str] = []

    root_agents = REPO_ROOT / "AGENTS.md"
    extra_skips = load_extra_skips(root_agents)

    def skipped(d: Path) -> bool:
        return (
            d.name.startswith(".")
            or d.name in SKIP_DIR_NAMES
            or d.resolve() in extra_skips
        )

    # Walk once; record per-directory facts.
    has_direct_code: dict[Path, bool] = {}
    subtree_has_code: dict[Path, bool] = {}
    child_dirs: dict[Path, list[Path]] = {}

    def walk(d: Path) -> bool:
        """Populate the maps; return whether d's subtree contains code."""
        direct = False
        children: list[Path] = []
        for entry in sorted(d.iterdir()):
            if entry.is_dir():
                if not skipped(entry):
                    children.append(entry)
            elif (entry.is_file() and entry.suffix.lower() in CODE_EXTS
                    and entry.name not in PACKAGE_MARKERS):
                direct = True
        has_direct_code[d] = direct
        child_dirs[d] = children
        sub = direct
        for child in children:
            if walk(child):
                sub = True
        subtree_has_code[d] = sub
        return sub

    repo_has_code = walk(REPO_ROOT)

    if not repo_has_code:
        print("OK: no source files yet — nothing to check")
        return 0

    strict = root_agents.exists()
    if not strict:
        warnings.append(
            "AGENTS.md: missing at the repo root (the repo has code; "
            "scaffold it per spec-0-init / CODEBASE-LAYOUT.md)"
        )

    hubs: list[Path] = []
    isolation_violations = 0
    missing_hubs = 0

    for d in sorted(has_direct_code):
        agents = d / "AGENTS.md"
        has_hub = agents.is_file()
        if has_hub:
            hubs.append(d)

        # Hub isolation: an AGENTS.md directory holds no source files directly.
        if has_hub and has_direct_code[d]:
            isolation_violations += 1
            msg = (
                f"{rel(agents)}: hub isolation broken — source files sit "
                f"beside AGENTS.md (move code into subdirectories)"
            )
            (failures if strict else warnings).append(msg)

        # Hub presence: a directory whose subdirectories contain code is a
        # non-leaf code directory and needs a hub. A directory mixing direct
        # code with code subdirectories can't satisfy both rules — the mix
        # itself is the finding.
        code_children = [c for c in child_dirs[d] if subtree_has_code[c]]
        if code_children and not has_hub:
            missing_hubs += 1
            if has_direct_code[d]:
                warnings.append(
                    f"{rel(d)}/: mixes source files and code subdirectories — "
                    f"move the files down a level, then add an AGENTS.md hub"
                )
            else:
                warnings.append(
                    f"{rel(d)}/: non-leaf code directory without an AGENTS.md hub"
                )

    # CLAUDE.md sibling chain (opt-in keyed off the root CLAUDE.md).
    root_claude = REPO_ROOT / "CLAUDE.md"
    chain = root_claude.is_file() and "@AGENTS.md" in root_claude.read_text()
    if chain:
        for d in hubs:
            claude = d / "CLAUDE.md"
            if not claude.is_file():
                warnings.append(f"{rel(d)}/: AGENTS.md has no sibling CLAUDE.md")
            elif claude.read_text().strip() != "@AGENTS.md":
                warnings.append(
                    f"{rel(claude)}: content must be exactly '@AGENTS.md'"
                )
        for d in sorted(has_direct_code):
            claude = d / "CLAUDE.md"
            if claude.is_file() and not (d / "AGENTS.md").is_file():
                warnings.append(f"{rel(claude)}: orphan CLAUDE.md (no sibling AGENTS.md)")

    for w in warnings:
        print(f"WARN: {w}")
    if failures:
        for f in failures:
            print(f"FAIL: {f}")
        print(f"\n{len(failures)} failure(s), {len(warnings)} warning(s)")
        return 2

    print(
        f"OK: {len(hubs)} hubs, {isolation_violations} isolation violations, "
        f"{missing_hubs} missing hubs, chain "
        + ("checked" if chain else "not opted in")
        + (f", {len(warnings)} warning(s)" if warnings else "")
    )
    return 1 if warnings else 0


if __name__ == "__main__":
    sys.exit(verify())
