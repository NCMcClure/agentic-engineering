#!/usr/bin/env python3
"""Plan-tree integrity gate (read-only).

Wired into the project's `.claude/settings.json` by `spec-0-init` for the
`TaskCompleted` hook event. It runs the plan-tree verifier and **blocks
(exit 2) only on CRITICAL violations**, so a task cannot be marked done on a
corrupted plan tree (e.g. a hand-edited `Status` that no longer agrees with
its parents, a broken link, or an orphaned spec anchor).

It is a backstop against plan-tree corruption, **not** a substitute for an
issue's `## Testing checkpoint`: the per-issue checkpoint command is
project-specific and is not visible to a hook, so re-running each checkpoint
green on serial integration stays the coordinator's job.

No external dependencies (stdlib only). No-ops (exit 0) when there is no
`.agents/plan/` workspace, which keeps it inert outside plan projects and after a
`.agents/plan/` removal. A workspace still at the pre-4.0 `.plan/` path blocks
(exit 2) with one line naming the migration. The hook's stdin JSON is
intentionally ignored — the gate is coord-agnostic.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

CRITICAL = 2  # verify-plan-tree.py: 0 clean, 1 warnings-only, 2 critical


def main() -> int:
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR", "")).resolve() if os.environ.get(
        "CLAUDE_PROJECT_DIR"
    ) else Path.cwd()
    verifier = root / ".agents" / "plan" / "plan" / "verify-plan-tree.py"
    if not verifier.is_file():
        if (root / ".plan" / "plan").is_dir():
            sys.stderr.write(
                "plan-tree gate: this workspace is still at .plan/ (but-first-planning < 4.0); "
                "it now lives at .agents/plan/. Migrate: mkdir -p .agents && git mv .plan "
                ".agents/plan, then re-copy the scripts and rewrite this hook's path "
                "(spec-0-init, 'Migrating a .plan/ workspace').\n"
            )
            return 2
        return 0  # no plan workspace -> nothing to gate

    proc = subprocess.run(
        [sys.executable, str(verifier)],
        capture_output=True,
        text=True,
    )
    if proc.returncode == CRITICAL:
        sys.stderr.write(
            "plan-tree gate: the plan tree has critical violations — fix them "
            "before a task is marked done.\n"
        )
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
