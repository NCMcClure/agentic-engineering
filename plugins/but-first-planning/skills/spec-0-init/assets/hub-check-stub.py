#!/usr/bin/env python3
"""Hub check for sprint checkpoint rows: delegates to agent-works (`aw hubs`).

Copied by spec-0-init to `.agents/plan/plan/verify-agents-tree.py` when the
agent-works plugin is available. It holds no verifier logic: the hub contract
and its checker are agent-works'. Exit code is `aw hubs`' own (0 clean,
1 warnings, 2 critical); 1 with a one-line note when `aw` is not on PATH.
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]   # <repo>/.agents/plan/plan/<this file>
AW = shutil.which("aw")
if not AW:
    sys.exit("hub structure is not verified: install agent-works")
sys.exit(subprocess.call([AW, "hubs", str(REPO), *sys.argv[1:]]))
