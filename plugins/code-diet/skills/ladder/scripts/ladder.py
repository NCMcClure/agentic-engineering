#!/usr/bin/env python3
"""Kernel-budget checker for the ladder skill: canonical owner of the kernel
token budget.

Extracts the marked kernel block from a ladder SKILL.md and checks it against
the budget. The kernel is the discipline's distilled always-on text, injected
into every session by the plugin's host configuration; this script is the only
place that measures it.

Contract
--------
argv: optional positional PATH to a SKILL.md. Default: the SKILL.md sibling of
this script, resolved from the script's own location (never the cwd).

Extraction: the text strictly between the exact markers
    <!-- kernel:start -->
    <!-- kernel:end -->
stripped of surrounding whitespace. Token estimate = len(kernel) // 4.

stdout: one JSON object, always:
    {"ok": bool, "est_tokens": int, "kernel": str}
kernel is "" when the markers are missing. ok is true iff both markers are
present AND est_tokens <= 250 (the hard cap). When est_tokens is in the
(200, 250] band the object additionally carries "warn": "over 200-token
target", but the run still succeeds (exit 0).

exit codes: 0 ok; 1 over the 250 hard cap; 2 markers missing or file
unreadable. Nothing is written to stderr on success. Stdlib only.
"""

import argparse
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True

KERNEL_START = "<!-- kernel:start -->"
KERNEL_END = "<!-- kernel:end -->"
TARGET_TOKENS = 200
HARD_CAP_TOKENS = 250


def extract_kernel(text: str):
    """Return the stripped text between the markers, or None if either marker
    is absent or they are out of order."""
    start = text.find(KERNEL_START)
    if start == -1:
        return None
    start += len(KERNEL_START)
    end = text.find(KERNEL_END, start)
    if end == -1:
        return None
    return text[start:end].strip()


def default_skill_path() -> Path:
    # scripts/ladder.py -> the SKILL.md one directory up.
    return Path(__file__).resolve().parent.parent / "SKILL.md"


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the ladder kernel block against its token budget.")
    parser.add_argument(
        "path",
        nargs="?",
        default=None,
        help="Path to a ladder SKILL.md (default: the SKILL.md sibling of this script).",
    )
    args = parser.parse_args()

    skill_path = Path(args.path) if args.path else default_skill_path()

    try:
        text = skill_path.read_text(encoding="utf-8")
    except OSError as exc:
        json.dump({"ok": False, "est_tokens": 0, "kernel": "", "error": str(exc)}, sys.stdout)
        return 2

    kernel = extract_kernel(text)
    if kernel is None:
        json.dump({"ok": False, "est_tokens": 0, "kernel": ""}, sys.stdout)
        return 2

    est_tokens = len(kernel) // 4
    result = {"ok": est_tokens <= HARD_CAP_TOKENS, "est_tokens": est_tokens, "kernel": kernel}
    if TARGET_TOKENS < est_tokens <= HARD_CAP_TOKENS:
        result["warn"] = "over 200-token target"

    json.dump(result, sys.stdout)

    if est_tokens > HARD_CAP_TOKENS:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
