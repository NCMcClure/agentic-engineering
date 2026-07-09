#!/usr/bin/env python3
"""Canonical home of the `debt:` marker grammar and the only place that counts.

The debt marker is a deliberate-shortcut comment of the form:

    <comment-leader> debt: <ceiling>[, <trigger>]

`<ceiling>` names the limit the shortcut accepts; the optional `<trigger>`
names the condition that should make someone upgrade past it. A marker with a
ceiling but no trigger is rot risk: nothing says when to revisit it, so it
quietly becomes permanent.

Every other skill in this plugin points here rather than restating the regex.
The debt SKILL.md invokes this script and judges only whether each deferral
still holds; the ladder skill writes markers in this exact shape.

Contract
--------
argv:
  --root <dir>    tree to scan (default: cwd)
  --write <file>  also render the markers as a markdown ledger table to <file>

Recognised comment leaders: #  //  --  ;  /*  <!--  (leader may repeat, e.g.
`;;` or `##`, and may sit inline after code). The ceiling is split from the
trigger on the FIRST comma; trailing block-comment closers (`*/`, `-->`) are
stripped. Skipped dirs: .git, node_modules, dist, build, out, target, .venv,
__pycache__, coverage.

stdout (always, single JSON object):
  {
    "count": int,               # total markers found
    "no_trigger_count": int,    # markers with a ceiling but no trigger
    "markers": [
      {"file": str,             # root-relative path
       "line": int,             # 1-indexed
       "ceiling": str,
       "trigger": str | null,
       "no_trigger": bool}
    ]
  }
markers are sorted by (file, line).

exit: 0 on a successful scan regardless of how many markers were found;
      1 on I/O error (bad --root, unwritable --write target), message on stderr.

stdlib only.
"""

import argparse
import json
import os
import re
import sys

sys.dont_write_bytecode = True

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "out", "target",
    ".venv", "__pycache__", "coverage",
}

# A comment leader (possibly repeated) followed by `debt:` and the payload.
MARKER = re.compile(r"(?:#|//|--|;|/\*|<!--)+\s*debt:\s*(.*)")
# Trailing block-comment closer to strip off the payload.
CLOSER = re.compile(r"\s*(?:-->|\*/)\s*$")


def parse_payload(payload):
    """Return (ceiling, trigger_or_None) split on the first comma."""
    payload = CLOSER.sub("", payload.strip()).strip()
    if "," in payload:
        ceiling, trigger = payload.split(",", 1)
        ceiling = ceiling.strip()
        trigger = trigger.strip() or None
    else:
        ceiling, trigger = payload, None
    return ceiling, trigger


def scan(root):
    markers = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            path = os.path.join(dirpath, name)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    lines = fh.readlines()
            except (OSError, ValueError):
                # Unreadable/binary file: skip it, don't abort the scan.
                continue
            rel = os.path.relpath(path, root)
            for lineno, text in enumerate(lines, start=1):
                m = MARKER.search(text)
                if not m:
                    continue
                ceiling, trigger = parse_payload(m.group(1))
                markers.append({
                    "file": rel,
                    "line": lineno,
                    "ceiling": ceiling,
                    "trigger": trigger,
                    "no_trigger": trigger is None,
                })
    markers.sort(key=lambda r: (r["file"], r["line"]))
    return markers


def render_ledger(markers):
    def cell(s):
        return str(s).replace("|", "\\|")

    out = ["# Debt ledger", ""]
    out.append(f"{len(markers)} markers, "
               f"{sum(1 for m in markers if m['no_trigger'])} with no trigger.")
    out.append("")
    out.append("| File | Line | Ceiling | Trigger |")
    out.append("| --- | --- | --- | --- |")
    for m in markers:
        trig = m["trigger"] if m["trigger"] is not None else "_(none)_"
        out.append(f"| {cell(m['file'])} | {m['line']} | "
                   f"{cell(m['ceiling'])} | {cell(trig)} |")
    return "\n".join(out) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Scan for debt: markers.")
    parser.add_argument("--root", default=os.getcwd(),
                        help="tree to scan (default: cwd)")
    parser.add_argument("--write", metavar="FILE",
                        help="also write a markdown ledger table to FILE")
    args = parser.parse_args()

    if not os.path.isdir(args.root):
        print(f"debt.py: not a directory: {args.root}", file=sys.stderr)
        return 1

    markers = scan(args.root)
    result = {
        "count": len(markers),
        "no_trigger_count": sum(1 for m in markers if m["no_trigger"]),
        "markers": markers,
    }

    if args.write:
        try:
            with open(args.write, "w", encoding="utf-8") as fh:
                fh.write(render_ledger(markers))
        except OSError as exc:
            print(f"debt.py: cannot write ledger: {exc}", file=sys.stderr)
            return 1

    json.dump(result, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
