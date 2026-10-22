#!/usr/bin/env python3
"""Stop hook: warn, never block, when this turn's changes leave the docs behind.

Runs docs_check against the working tree: parity for everything changed since
HEAD (committed work is CI's to check), plus the tree findings on the files that
changed. One message when there is something to say, silence otherwise.
Skipped in a project without `.agents/docs-parity.json`.

Fail open, always exit 0.
"""

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

CHECK = Path(__file__).resolve().parent.parent / "scripts" / "docs_check.py"
SHOWN = 4


def load_check():
    spec = importlib.util.spec_from_file_location("docs_check", CHECK)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def message(report, changed):
    parity = [f for f in report["findings"] if f["code"] == "PARITY_MISSING" and f["severity"] != "info"]
    tree = [f for f in report["findings"] if f["severity"] != "info" and f["code"] != "PARITY_MISSING"
            and f["path"] in changed]
    if not parity and not tree:
        return None
    lines = ["Docs parity, before you finish:"]
    for f in parity[:SHOWN]:
        lines.append(f"- {f['message']}.")
    for f in tree[:SHOWN]:
        where = f["path"] + (f":{f['line']}" if f["line"] else "")
        lines.append(f"- {f['code']} {where}: {f['message']}.")
    hidden = len(parity) + len(tree) - min(len(parity), SHOWN) - min(len(tree), SHOWN)
    if hidden > 0:
        lines.append(f"- and {hidden} more: run docs_check.py --changed HEAD.")
    lines.append("Update the pages and retake the shots in this change (docs-parity:docs-sync), "
                 "or write `Docs: none, <why>` in the commit message.")
    return "\n".join(lines)


def main():
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw.lstrip("﻿")) if raw.strip() else {}
        if payload.get("stop_hook_active") is True:
            return 0
        root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd())
        if not (root / ".agents" / "docs-parity.json").is_file():
            return 0
        check = load_check()
        changed, _ = check.changed_files(root, "HEAD")
        if not changed:
            return 0
        report = check.run(root, changed="HEAD")
        text = message(report, set(changed))
        if text:
            json.dump({"systemMessage": text}, sys.stdout)
    except (Exception, subprocess.SubprocessError):
        pass  # fail open: a warning is never worth a failed turn
    return 0


if __name__ == "__main__":
    sys.exit(main())
