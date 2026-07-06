"""Drift listing — a fast, read-only index of the cross-cutting drift items so an
agent can triage *which* drift files to open rather than reading them all at once.

Lives in `.plan/progress/` and roots itself there, reading the sibling `drift/`
directory's `drift-*.md` files. Stdlib only; never writes — `build-assess-drift`
owns advancing a drift item's status, this script only reports.

Each drift file carries greppable frontmatter (the format owned by
`build-next-issue`):

    ---
    id: D1
    kind: defect | smell | checkpoint-bug | note
    surfaced: 2026-05-31 (01-03)
    where: <spec/plan/code location>
    route: plan-6-edit | build-improve-architecture | follow-up issue #NNN
    status: open | routed | resolved | by-design | human-or-future
    ---
    # <Short title>

`status:` is the drift lifecycle. `open` and `routed` are the *actionable* set
(recorded-but-untriaged, and handed-off-to-an-issue); `resolved`, `by-design`
(re-assessed as intentional — never a real defect), and `human-or-future`
(parked for a human decision or deferred work) are terminal. A status may carry a
trailing annotation of how/when it was settled, e.g. `resolved (drift-triage
2026-06-06, #376)` — only the leading keyword is classified.

Usage:

    drift-status.py [--status S [S ...]] [--open] [--json]

    (no args)        list every drift item as an aligned table + a counts summary
    --open           shortcut for `--status open routed` (the actionable set)
    --status open …  list only items whose status is one of the given values
    --json           emit the items as a JSON array (one object per item) instead

The table prints id, status, kind, where, route, and the file name — enough to
decide what to read — plus a one-line summary of counts by status. Exit codes:
0 = listed (even if zero items); 2 = bad usage / unreadable drift directory.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PROGRESS_ROOT = Path(__file__).resolve().parent      # .plan/progress/
DRIFT_DIR = PROGRESS_ROOT / "drift"

# The drift lifecycle vocabulary (owned by build-next-issue). CORE is always shown in
# the summary so "is there work?" reads at a glance even at zero; the terminal outcomes
# beyond it are shown only when present. ACTIONABLE is what --open lists.
CORE = ("open", "routed", "resolved")
STATUSES = ("open", "routed", "resolved", "by-design", "human-or-future")
ACTIONABLE = ("open", "routed")
FIELDS = ("id", "kind", "surfaced", "where", "route", "status")

_FM_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_KV_RE = re.compile(r"^([A-Za-z_-]+):\s*(.*)$")
_H1_RE = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)


def _unquote(value: str) -> str:
    """Drop a single matched pair of surrounding quotes — frontmatter scalars are
    sometimes written as `status: "resolved"` (valid YAML), and the raw quotes
    must not leak into the field value."""
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1].strip()
    return value


def status_key(status: str) -> str:
    """The leading status keyword, lowercased — drift files routinely annotate a
    status with how/when it was settled (`resolved (drift-triage 2026-06-06, #376)`),
    so classify on the first token rather than the whole string. Empty status (no
    frontmatter) is reported as the sentinel "?"."""
    head = status.split(maxsplit=1)[0].lower() if status.strip() else ""
    return head or "?"


def parse_drift_file(path: Path) -> dict:
    """Pull the frontmatter fields + title out of one drift file.

    Returns a dict with every FIELDS key (missing ones as ""), plus `title` and
    `file`. A file without parseable frontmatter still returns a row, flagged with
    status "?" so it surfaces in the listing rather than vanishing silently.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    item = {k: "" for k in FIELDS}
    item["file"] = path.name
    item["title"] = ""

    m = _FM_RE.match(text)
    if not m:
        item["status"] = "?"
        return item

    for line in m.group(1).splitlines():
        kv = _KV_RE.match(line.strip())
        if kv and kv.group(1) in FIELDS:
            item[kv.group(1)] = _unquote(kv.group(2).strip())

    body = text[m.end():]
    h1 = _H1_RE.search(body)
    if h1:
        item["title"] = h1.group(1).strip()
    return item


def collect(statuses: tuple[str, ...] | None) -> list[dict]:
    if not DRIFT_DIR.is_dir():
        return []
    items = [parse_drift_file(p) for p in sorted(DRIFT_DIR.glob("drift-*.md"))]
    if statuses:
        items = [it for it in items if status_key(it["status"]) in statuses]
    # Order: actionable first (open, then routed), terminal outcomes after, then by id.
    rank = {s: i for i, s in enumerate(STATUSES)}

    def key(it: dict) -> tuple:
        return (rank.get(status_key(it["status"]), 9), it["id"] or "~", it["file"])

    return sorted(items, key=key)


def _truncate(value: str, width: int) -> str:
    return value if len(value) <= width else value[: width - 1] + "…"


def print_table(items: list[dict]) -> None:
    if not items:
        print("No drift items.")
        return

    cols = [
        ("id", "ID", 5),
        ("status", "STATUS", 8),
        ("kind", "KIND", 14),
        ("where", "WHERE", 30),
        ("route", "ROUTE", 24),
        ("file", "FILE", 36),
    ]
    header = "  ".join(name.ljust(w) for _, name, w in cols)
    print(header)
    print("  ".join("-" * w for _, _, w in cols))
    for it in items:
        print("  ".join(_truncate(it.get(key, ""), w).ljust(w) for key, _, w in cols))

    counts = {s: 0 for s in STATUSES}
    malformed = 0   # no parseable frontmatter at all
    unknown: dict[str, int] = {}   # valid frontmatter, status outside the vocabulary
    for it in items:
        sk = status_key(it["status"])
        if sk in counts:
            counts[sk] += 1
        elif sk == "?":
            malformed += 1
        else:
            unknown[sk] = unknown.get(sk, 0) + 1
    # CORE always shown; extended terminal statuses only when non-zero.
    parts = [f"{counts[s]} {s}" for s in CORE]
    parts += [f"{counts[s]} {s}" for s in STATUSES if s not in CORE and counts[s]]
    parts += [f"{n} {k}" for k, n in sorted(unknown.items())]
    if malformed:
        parts.append(f"{malformed} malformed")
    print(f"\n{len(items)} item{'s' if len(items) != 1 else ''}: " + ", ".join(parts))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="List the .plan/progress/drift/ items for triage (read-only)."
    )
    parser.add_argument(
        "--status",
        nargs="+",
        metavar="S",
        help="only items with one of these statuses (e.g. open routed)",
    )
    parser.add_argument(
        "--open",
        action="store_true",
        help="shortcut for --status open routed (the actionable set)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = parser.parse_args(argv)

    statuses: tuple[str, ...] | None = None
    if args.open:
        statuses = ACTIONABLE
    elif args.status:
        statuses = tuple(args.status)

    if not DRIFT_DIR.is_dir():
        print(f"No drift directory at {DRIFT_DIR} — nothing to list.", file=sys.stderr)
        # Not an error: a workspace may simply have no drift yet.
        if args.json:
            print("[]")
        else:
            print("No drift items.")
        return 0

    items = collect(statuses)
    if args.json:
        print(json.dumps(items, indent=2))
    else:
        print_table(items)
    return 0


if __name__ == "__main__":
    sys.exit(main())
