#!/usr/bin/env python3
"""Enforce the profile line budget — the canonical home of the number.

The profile is auto-loaded into every session, so every line is paid for in
permanent context. BUDGET below is the single source of that constant; skills,
hooks, and docs say "the budget profile_budget.py enforces" instead of
restating it.

Usage:
    python3 profile_budget.py [path]

path defaults to the resolved profile (WLM_PROFILE or
~/.claude/rules/write-like-me.md). Prints "<lines>/<budget> lines"; exits 0
when at or under budget, 1 when over, 2 when the file is missing.
"""

import sys

try:
    from paths import profile_path          # run as a file from this dir
except ImportError:                          # pragma: no cover
    from wlm.paths import profile_path      # imported as a package

BUDGET = 60


def main(argv):
    from pathlib import Path
    target = Path(argv[1]) if len(argv) > 1 else profile_path()
    if not target.is_file():
        print(f"no profile at {target}", file=sys.stderr)
        return 2
    lines = len(target.read_text(encoding="utf-8").splitlines())
    status = "OK" if lines <= BUDGET else "OVER BUDGET"
    print(f"{lines}/{BUDGET} lines — {status}")
    return 0 if lines <= BUDGET else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
