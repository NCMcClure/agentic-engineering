#!/usr/bin/env python3
"""PostToolUse hook (Edit|MultiEdit|Write): advisory nudge on malformed debt markers.

The `debt:` grammar has one home, skills/debt/scripts/debt.py; this hook loads
that module by path and reuses its MARKER regex and parse_payload — it never
restates the grammar. When freshly written text contains a debt marker with a
ceiling but no upgrade trigger, it emits an additionalContext nudge so the
model adds the trigger while the edit is still in hand.

Advisory only, fail-open: exit 0 always, never a blocking decision — a missed
nudge costs nothing (the debt skill's scan flags the same rows later), while a
blocked edit would cost real work.
"""

import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

DEBT_PY = (Path(__file__).resolve().parent.parent
           / "skills" / "debt" / "scripts" / "debt.py")


def new_text(tool_input: dict) -> str:
    parts = [tool_input.get("content", ""), tool_input.get("new_string", "")]
    parts += [e.get("new_string", "") for e in tool_input.get("edits", [])]
    return "\n".join(p for p in parts if p)


def main() -> int:
    try:
        data = json.loads(sys.stdin.read().lstrip("﻿"))
        text = new_text(data.get("tool_input") or {})
        if "debt:" not in text:
            return 0

        spec = importlib.util.spec_from_file_location("debt", DEBT_PY)
        debt = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(debt)

        triggerless = []
        for line in text.splitlines():
            m = debt.MARKER.search(line)
            if m:
                ceiling, trigger = debt.parse_payload(m.group(1))
                if ceiling and trigger is None:
                    triggerless.append(ceiling)
        if triggerless:
            json.dump({"hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    "code-diet: debt marker(s) missing an upgrade trigger: "
                    + "; ".join(triggerless[:3])
                    + ". Grammar: `debt: <ceiling>, <trigger>` — name the "
                    "condition that should make someone upgrade past the "
                    "ceiling, or the shortcut rots into permanent."),
            }}, sys.stdout)
    except Exception:
        pass  # fail open: never block or slow an edit over a nudge
    return 0


if __name__ == "__main__":
    sys.exit(main())
