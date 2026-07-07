#!/usr/bin/env python3
"""Deterministic recon for the codebase-organizer skill.

Walks a repository and emits a single JSON profile to stdout describing the
shape of the tree: what sits loose at the root, which directories are
overstuffed, what ecosystem(s) the manifests imply, where cruft has
accumulated, and whether the tree is a clean git checkout. The organize-plan
workflow feeds this profile to its planner agents so they reason from facts
(counts, names, paths) instead of re-deriving them by hand for every run.

Stdlib only — no pip installs, so it runs anywhere a repo can be checked out.

Usage:
    python3 repo_scan.py <repo_path> [--overstuffed N] [--max-list M]

The scan respects .gitignore *loosely*: it skips a built-in set of always-noise
directories (.git, node_modules, venvs, caches) so the counts reflect source,
not dependencies. Cruft inside those dirs is still summarized at a high level
because "you have three duplicate cache dirs" is itself a finding.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter

# Directories that are never the point of an organization pass — dependency
# trees, VCS internals, and build/test caches. We don't descend into these for
# the per-directory file census, but we do note when they exist (cruft signal).
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "env", "__pycache__",
    ".pytest_cache", ".pytest-cache", ".ruff_cache", ".mypy_cache",
    ".tox", ".nox", ".gradle", ".idea", ".vscode", "target", "dist",
    "build", ".next", ".turbo", ".cache", "__snapshots__", ".terraform",
    "vendor", ".bundle", ".dart_tool", "Pods",
}

# Files that legitimately belong at the root of a tidy repo: they describe
# intent, contract, or entry — not implementation. Everything else loose at the
# root is a candidate for nesting. Matched case-insensitively; some are globs.
ROOT_INTENT_EXACT = {
    "readme", "readme.md", "readme.rst", "readme.txt",
    "license", "license.md", "license.txt", "licence", "copying", "notice",
    "changelog", "changelog.md", "contributing.md", "code_of_conduct.md",
    "security.md", "authors", "authors.md", "codeowners",
    # python manifests / lockfiles
    "pyproject.toml", "setup.py", "setup.cfg", "requirements.txt",
    "manifest.in", "tox.ini", "poetry.lock", "uv.lock", "pipfile",
    "pipfile.lock", "environment.yml",
    # node
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "tsconfig.json", ".nvmrc",
    # go / rust / ruby / php / java / elixir
    "go.mod", "go.sum", "cargo.toml", "cargo.lock", "gemfile", "gemfile.lock",
    "composer.json", "composer.lock", "pom.xml", "build.gradle",
    "build.gradle.kts", "settings.gradle", "mix.exs", "mix.lock",
    # build / container / infra entry
    "makefile", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
    "flake.nix", "flake.lock", "default.nix", "shell.nix",
    # meta / dotfiles that configure the repo as a whole
    ".gitignore", ".gitattributes", ".editorconfig", ".dockerignore",
    ".gitlab-ci.yml", ".pre-commit-config.yaml", ".mailmap", ".envrc",
    ".python-version", ".tool-versions", ".prettierrc", ".eslintrc.json",
    ".eslintrc.js", ".eslintrc", "renovate.json", "cliff.toml",
    # common user-facing entry scripts
    "install.sh", "install.ps1", "install.cmd", "main.py", "__main__.py",
    "index.js", "index.ts", "app.py",
}

# Prefix/suffix patterns that read as "intent-ish" so we don't over-flag.
ROOT_INTENT_REGEX = [
    re.compile(r"^\.env(\..+)?$", re.I),          # .env, .env.example
    re.compile(r"^readme", re.I),
    re.compile(r"^license", re.I),
    re.compile(r"^dockerfile", re.I),              # Dockerfile.prod etc.
    re.compile(r"^\.[a-z0-9_-]+rc$", re.I),        # arbitrary .*rc dotfiles
    re.compile(r".+\.ya?ml\.example$", re.I),
]

# Names/patterns that signal accumulated cruft worth quarantining or ignoring.
CRUFT_REGEX = [
    re.compile(r"_backup(\.|$)", re.I),
    re.compile(r"_bak(\.|$)", re.I),
    re.compile(r"[-_]old(\.|$)", re.I),
    re.compile(r"[-_]copy(\.|$)", re.I),
    re.compile(r"[-_]deprecated(\.|$)", re.I),
    re.compile(r"_migration(\.|$)", re.I),
    re.compile(r"_retirement(\.|$)", re.I),
    re.compile(r"\.orig$", re.I),
    re.compile(r"\.tmp$", re.I),
    re.compile(r"~$"),
    re.compile(r"\.egg-info$", re.I),
]

# Manifest filename -> ecosystem label, for sniffing project type.
MANIFEST_ECOSYSTEM = {
    "pyproject.toml": "python", "setup.py": "python", "setup.cfg": "python",
    "requirements.txt": "python", "pipfile": "python", "uv.lock": "python",
    "package.json": "node", "tsconfig.json": "node",
    "go.mod": "go", "cargo.toml": "rust", "gemfile": "ruby",
    "composer.json": "php", "pom.xml": "java", "build.gradle": "java",
    "build.gradle.kts": "java", "mix.exs": "elixir",
}

SOURCE_EXTS = {
    ".py", ".js", ".ts", ".jsx", ".tsx", ".go", ".rs", ".rb", ".java",
    ".kt", ".php", ".ex", ".exs", ".c", ".h", ".cpp", ".hpp", ".cs",
    ".swift", ".scala", ".sh", ".ps1",
}


def is_intent_file(name):
    low = name.lower()
    if low in ROOT_INTENT_EXACT:
        return True
    return any(rx.search(name) for rx in ROOT_INTENT_REGEX)


def is_cruft(name):
    return any(rx.search(name) for rx in CRUFT_REGEX)


def count_lines(path):
    """Best-effort line count; returns None if unreadable."""
    try:
        with open(path, "rb") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return None


def git_info(repo):
    """Return git tracking facts, or {'is_git': False} if not a repo."""
    def run(args):
        try:
            out = subprocess.run(
                ["git", "-C", repo] + args,
                capture_output=True, text=True, timeout=20,
            )
            return out.stdout.strip(), out.returncode
        except (OSError, subprocess.SubprocessError):
            return "", 1

    inside, rc = run(["rev-parse", "--is-inside-work-tree"])
    if rc != 0 or inside != "true":
        return {"is_git": False}
    status, _ = run(["status", "--porcelain"])
    branch, _ = run(["rev-parse", "--abbrev-ref", "HEAD"])
    tracked, _ = run(["ls-files"])
    n_tracked = len([l for l in tracked.splitlines() if l])
    return {
        "is_git": True,
        "branch": branch,
        "clean": status == "",
        "dirty_count": len([l for l in status.splitlines() if l]),
        "tracked_files": n_tracked,
    }


def _norm_rel(p):
    """Normalize a repo-relative path: strip leading ./ and trailing slashes, use /."""
    return p.replace("\\", "/").lstrip("./").rstrip("/")


def make_exclude_matcher(excludes):
    """Return a predicate over repo-relative paths that is True for any path at
    or under an excluded prefix. Empty list -> matches nothing."""
    norm = [_norm_rel(e) for e in (excludes or []) if _norm_rel(e)]

    def excluded(rel):
        if not norm:
            return False
        r = _norm_rel(rel)
        return any(r == ex or r.startswith(ex + "/") for ex in norm)

    return excluded


# Canonical "overstuffed directory" threshold (philosophy principle 3). This is
# the single source for the number: verify_source_structure.py imports it, and
# prose/prompts elsewhere refer to "repo_scan's flat-max" instead of restating it.
FLAT_MAX_DEFAULT = 25


def scan(repo, overstuffed_threshold, max_list, excludes=None,
         large_min=800, large_cap=25):
    repo = os.path.abspath(repo)
    is_excluded = make_exclude_matcher(excludes)
    profile = {
        "repo_path": repo,
        "git": git_info(repo),
        "ecosystems": [],
        "root": {"intent_files": [], "loose_files": [], "dirs": []},
        "overstuffed_threshold": overstuffed_threshold,
        "overstuffed_dirs": [],
        "cruft": {"files": [], "dirs": [], "duplicate_cache_dirs": []},
        "large_source_files": [],
        "totals": {},
    }

    ecosystems = set()
    total_files = 0
    total_dirs = 0
    cache_dir_seen = Counter()

    # ---- Root inventory --------------------------------------------------
    try:
        root_entries = sorted(os.listdir(repo))
    except OSError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        return

    for name in root_entries:
        full = os.path.join(repo, name)
        # Caller-supplied exclusions also hide the entry from the root inventory,
        # not just from the walk — otherwise an excluded top-level dir (e.g.
        # `tests`) still shows up as a root dir the planner might try to move.
        if is_excluded(name):
            continue
        if os.path.isdir(full):
            profile["root"]["dirs"].append(name)
            if name.lower() in MANIFEST_ECOSYSTEM:
                pass
        else:
            low = name.lower()
            if low in MANIFEST_ECOSYSTEM:
                ecosystems.add(MANIFEST_ECOSYSTEM[low])
            if is_cruft(name):
                profile["cruft"]["files"].append("./" + name)
            elif is_intent_file(name):
                profile["root"]["intent_files"].append(name)
            else:
                entry = {"name": name}
                if os.path.splitext(name)[1] in SOURCE_EXTS:
                    lines = count_lines(full)
                    if lines is not None:
                        entry["lines"] = lines
                profile["root"]["loose_files"].append(entry)

    # ---- Walk for per-directory census, cruft, big files, ecosystems -----
    for dirpath, dirnames, filenames in os.walk(repo):
        rel = os.path.relpath(dirpath, repo)
        base = os.path.basename(dirpath)

        # Note cruft/cache dirs, then prune them from the walk.
        kept = []
        for d in dirnames:
            child_rel = d if rel == "." else os.path.join(rel, d)
            # Caller-supplied exclusions (e.g. test trees): prune the whole
            # subtree so it never enters the census, overstuffed detection,
            # large-file list, or sample output.
            if is_excluded(child_rel):
                continue
            if d in SKIP_DIRS:
                cache_dir_seen[d] += 1
                if d in {".pytest_cache", ".pytest-cache", "__pycache__",
                         ".ruff_cache", ".mypy_cache"}:
                    profile["cruft"]["dirs"].append(
                        os.path.join(rel, d) if rel != "." else d)
                continue
            if is_cruft(d):
                profile["cruft"]["dirs"].append(
                    os.path.join(rel, d) if rel != "." else d)
                continue
            kept.append(d)
        dirnames[:] = kept

        total_dirs += len(kept)
        total_files += len(filenames)

        # Manifest-based ecosystem sniffing anywhere in the tree.
        for fn in filenames:
            low = fn.lower()
            if low in MANIFEST_ECOSYSTEM:
                ecosystems.add(MANIFEST_ECOSYSTEM[low])
            if is_cruft(fn) and rel != ".":
                profile["cruft"]["files"].append(os.path.join(rel, fn))
            # Track unusually large source files (refactor candidates).
            if os.path.splitext(fn)[1] in SOURCE_EXTS:
                lines = count_lines(os.path.join(dirpath, fn))
                if lines and lines >= large_min:
                    profile["large_source_files"].append({
                        "path": os.path.join(rel, fn) if rel != "." else fn,
                        "lines": lines,
                    })

        # Overstuffed detection: many direct file children + a hint that the
        # names share prefixes (so a by-feature/by-type split is plausible).
        n_files = len(filenames)
        if n_files >= overstuffed_threshold and rel != ".":
            stems = Counter()
            n_source = 0
            for fn in filenames:
                if os.path.splitext(fn)[1] in SOURCE_EXTS:
                    n_source += 1
                token = re.split(r"[_\-.]", fn, maxsplit=1)[0].lower()
                if token:
                    stems[token] += 1
            common = [{"prefix": p, "count": c}
                      for p, c in stems.most_common(8) if c >= 2]
            profile["overstuffed_dirs"].append({
                "path": rel,
                "file_count": n_files,
                # source_file_count lets the planner ignore data/ephemera dumps
                # (e.g. a 700-file session-state dir) and focus on real code dirs.
                "source_file_count": n_source,
                "subdir_count": len(kept),
                "common_prefixes": common,
                "sample_files": sorted(filenames)[:max_list],
            })

    # ---- Duplicate cache dirs (e.g. .pytest_cache AND .pytest-cache) -----
    dup_pairs = [(".pytest_cache", ".pytest-cache")]
    for a, b in dup_pairs:
        if cache_dir_seen.get(a) and cache_dir_seen.get(b):
            profile["cruft"]["duplicate_cache_dirs"].append([a, b])

    profile["ecosystems"] = sorted(ecosystems)
    profile["overstuffed_dirs"].sort(key=lambda d: d["file_count"], reverse=True)
    profile["large_source_files"].sort(key=lambda f: f["lines"], reverse=True)
    profile["large_source_files"] = profile["large_source_files"][:large_cap]
    profile["totals"] = {
        "root_dirs": len(profile["root"]["dirs"]),
        "root_intent_files": len(profile["root"]["intent_files"]),
        "root_loose_files": len(profile["root"]["loose_files"]),
        "total_files": total_files,
        "total_dirs": total_dirs,
        "overstuffed_dir_count": len(profile["overstuffed_dirs"]),
        "cruft_file_count": len(profile["cruft"]["files"]),
        "cruft_dir_count": len(profile["cruft"]["dirs"]),
    }
    json.dump(profile, sys.stdout, indent=2)
    sys.stdout.write("\n")


def main():
    ap = argparse.ArgumentParser(description="Recon a repo's tree shape.")
    ap.add_argument("repo_path")
    ap.add_argument("--overstuffed", type=int, default=FLAT_MAX_DEFAULT,
                    help="files-in-one-dir threshold to flag as overstuffed "
                         "(default: FLAT_MAX_DEFAULT, the canonical constant)")
    ap.add_argument("--max-list", type=int, default=30,
                    help="max sample filenames to include per overstuffed dir")
    ap.add_argument("--large-min", type=int, default=800,
                    help="min line count for a file to enter large_source_files "
                         "(default 800; the optimize-codebase discovery step "
                         "raises this to its god-file threshold)")
    ap.add_argument("--large-cap", type=int, default=25,
                    help="max entries kept in large_source_files (default 25; "
                         "raise for exhaustive worklist discovery)")
    ap.add_argument("--exclude", action="append", default=[],
                    metavar="PATH",
                    help="repo-relative path prefix to prune from the scan "
                         "entirely (applies to all nested paths). Repeatable. "
                         "Use for trees that must not be reorganized, e.g. "
                         "--exclude dev/tests --exclude tests")
    args = ap.parse_args()
    if not os.path.isdir(args.repo_path):
        json.dump({"error": f"not a directory: {args.repo_path}"}, sys.stdout)
        sys.exit(1)
    scan(args.repo_path, args.overstuffed, args.max_list, args.exclude,
         args.large_min, args.large_cap)


if __name__ == "__main__":
    main()
