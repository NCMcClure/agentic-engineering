#!/usr/bin/env python3
"""SessionStart/SubagentStart hook: inject the docs-parity kernel in a project that adopted it.

The kernel's single home is the marked block in skills/docs-parity/SKILL.md. A
project adopts docs-parity by carrying `.agents/docs-parity.json`; anywhere else
this hook stays silent, because a project that has not opted in has agreed to
none of it.

Fail-open contract: any error, a missing kernel, or an over-cap kernel exits 0
with no output. The session must never be blocked or slowed by this hook.
"""

import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True

SKILL = Path(__file__).resolve().parent.parent / "skills" / "docs-parity" / "SKILL.md"
START, END = "<!-- kernel:start -->", "<!-- kernel:end -->"
HARD_CAP_TOKENS = 160  # target 120; the test holds the target


def extract_kernel(text):
    start = text.find(START)
    end = text.find(END, start + len(START)) if start != -1 else -1
    return text[start + len(START):end].strip() if start != -1 and end != -1 else None


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw.lstrip("﻿")) if raw.strip() else {}
        root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        if not (root / ".agents" / "docs-parity.json").is_file():
            return 0
        kernel = extract_kernel(SKILL.read_text(encoding="utf-8"))
        if not kernel or len(kernel) // 4 > HARD_CAP_TOKENS:
            return 0
        event = payload.get("hook_event_name") or "SessionStart"
        json.dump({"hookSpecificOutput": {"hookEventName": event,
                                          "additionalContext": "DOCS-PARITY ACTIVE\n\n" + kernel}}, sys.stdout)
    except Exception:
        pass  # fail open: an unreadable kernel must never cost the user a session
    return 0


if __name__ == "__main__":
    sys.exit(main())
