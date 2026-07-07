#!/usr/bin/env python3
"""UserPromptSubmit hook: record style feedback and remind Claude to honor it.

Fail-open: any error exits 0 so the user's prompt is never blocked.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    prompt = data.get("prompt") or ""
    if not prompt:
        sys.exit(0)

    from wlm import feedback, observations

    hit = feedback.detect(prompt)
    if hit is None:
        sys.exit(0)

    label, phrase = hit
    observations.append(
        {
            "session_id": data.get("session_id", ""),
            "label": label,
            "phrase": phrase,
            "prompt_excerpt": prompt[:300],
        }
    )

    context = (
        "write-like-me: the user just gave style feedback about your prose "
        f"(\"{phrase}\"). Honor it in this response, and treat it as a durable "
        "preference about their voice, not a one-off. It has been recorded and "
        "will be folded into their writing profile."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": context,
                }
            }
        )
    )
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)
