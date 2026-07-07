#!/usr/bin/env python3
"""SessionStart hook: nudge toward calibration when no profile exists yet.

The profile itself needs no injection here — ~/.claude/rules/*.md is
auto-loaded by Claude Code. Fail-open: any error exits 0.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

NUDGE_INTERVAL_SECONDS = 86400


def main() -> None:
    try:
        json.load(sys.stdin)
    except Exception:
        pass  # SessionStart input is not needed; still proceed.

    from wlm import paths

    if paths.profile_path().exists():
        sys.exit(0)

    paths.ensure_dirs()
    nudge_file = paths.state_dir() / "last-nudge"
    now = time.time()
    try:
        last = float(nudge_file.read_text().strip())
    except Exception:
        last = 0.0
    if now - last < NUDGE_INTERVAL_SECONDS:
        sys.exit(0)

    nudge_file.write_text(str(now))
    print(
        json.dumps(
            {
                "systemMessage": (
                    "write-like-me: no writing profile found. Run "
                    "/write-like-me:calibrate once to teach Claude your voice."
                )
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
