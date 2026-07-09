#!/usr/bin/env python3
"""SessionStart/SubagentStart hook: inject the ladder kernel.

The kernel is the discipline's distilled always-on text. Its single home is
the marked block in skills/ladder/SKILL.md; its extraction logic and token
budget live in skills/ladder/scripts/ladder.py. This hook only plumbs: load
that module by path, extract the kernel, and emit it as additionalContext for
whichever event fired (the event name is echoed from the hook's stdin JSON).

Fail-open contract: any error, a missing kernel, or an over-budget kernel
exits 0 with no output — the session must never be blocked or slowed by this
hook. Budget enforcement belongs to authoring/CI (ladder.py's exit code),
not to session start.
"""

import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

LADDER_DIR = Path(__file__).resolve().parent.parent / "skills" / "ladder"


def main() -> int:
    try:
        raw = sys.stdin.read()
        event = "SessionStart"
        if raw.strip():
            event = json.loads(raw.lstrip("﻿")).get("hook_event_name") or event

        spec = importlib.util.spec_from_file_location(
            "ladder", LADDER_DIR / "scripts" / "ladder.py")
        ladder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ladder)

        kernel = ladder.extract_kernel(
            (LADDER_DIR / "SKILL.md").read_text(encoding="utf-8"))
        if not kernel or len(kernel) // 4 > ladder.HARD_CAP_TOKENS:
            return 0

        json.dump({"hookSpecificOutput": {
            "hookEventName": event,
            "additionalContext": "CODE-DIET ACTIVE\n\n" + kernel,
        }}, sys.stdout)
    except Exception:
        pass  # fail open: an unreadable kernel must never cost the user a session
    return 0


if __name__ == "__main__":
    sys.exit(main())
