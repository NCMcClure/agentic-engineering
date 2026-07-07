#!/usr/bin/env python3
"""Stop hook: when style feedback is pending, fork a subagent to refine the profile.

Contract (mirrors Claude Code Stop-hook semantics):
  exit 0, no stdout                      -> allow the stop
  exit 0, {"decision":"block","reason"}  -> block; reason becomes the model's next turn

Guards, in order: stop_hook_active loop guard, refine-disabled flag, pending
observations, once-per-session flag, 1-hour cooldown.
Fail-open: any error exits 0.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

COOLDOWN_SECONDS = 3600
SESSION_FLAG_STALE_SECONDS = 86400


def _read_epoch(p: Path) -> float:
    try:
        return float(p.read_text().strip())
    except Exception:
        return 0.0


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    # Loop guard: this Stop follows the refinement turn we ourselves triggered.
    if data.get("stop_hook_active"):
        sys.exit(0)

    from wlm import observations, paths

    paths.ensure_dirs()
    state = paths.state_dir()

    if (state / "refine-disabled").exists():
        sys.exit(0)

    if not observations.pending():
        sys.exit(0)

    session_id = data.get("session_id", "unknown")
    session_flag = state / f"refine-fired-{session_id}"
    if session_flag.exists():
        sys.exit(0)

    now = time.time()
    if now - _read_epoch(state / "last-refined") < COOLDOWN_SECONDS:
        sys.exit(0)

    # Sweep stale session flags so state/ doesn't accumulate forever.
    for flag in state.glob("refine-fired-*"):
        try:
            if now - flag.stat().st_mtime > SESSION_FLAG_STALE_SECONDS:
                flag.unlink()
        except OSError:
            pass

    # Arm: stamp before emitting so a crashed fork can't re-fire in a loop.
    session_flag.write_text(str(now))
    (state / "last-refined").write_text(str(now))

    # refine-profile.md is read by the subagent as a raw file, so plugin
    # variables are never substituted in it — resolve the paths here.
    rules_path = Path(__file__).resolve().parent / "refine-profile.md"
    directive = (
        "Create a forked subagent with 'sonnet' model. "
        "Subagent initial message is: "
        f"'Read & execute writing-profile refinement rules: {rules_path}. "
        f"Profile: {paths.profile_path()}. Data dir: {paths.data_home()}.'"
    )
    print(json.dumps({"decision": "block", "reason": directive}))
    sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        sys.exit(0)
