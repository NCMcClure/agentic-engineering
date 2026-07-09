---
name: debt
description: Inventory every `debt:` marker in the repo via scripts/debt.py, judge whether each deferral still holds, and flag trigger-less markers as rot risk; `--write <file>` also saves a ledger.
disable-model-invocation: true
argument-hint: "[--write <file>]"
---

# debt

A `debt:` marker records a deliberate shortcut: `debt: <ceiling>, <trigger>`,
where the ceiling is the limit the code accepts and the trigger is the
condition that should make someone upgrade past it. This skill inventories
every marker in the repo, then judges each one: does the deferral still hold,
has its trigger tripped, or is it a trigger-less marker rotting toward
permanent? Auditing deferred debt is a human act, so this skill is
user-invoked and carries no passive cost.

The scan and all counting live in `scripts/debt.py` — the single canonical home
of the marker grammar. This body never restates the regex, never recounts by
hand, and never greps for markers itself; the model's only job here is
judgment.

## Step 1 — Scan

Run the scanner from the repo root, appending `--write <file>` when the user
passed it:

```
python3 ${CLAUDE_PLUGIN_ROOT}/skills/debt/scripts/debt.py [--write <file>]
```

It walks the tree (skipping `.git`, `node_modules`, and build output), matches
every `debt:` comment, splits each into ceiling and trigger, and flags rows
with no trigger. Parse its JSON: `{count, no_trigger_count, markers[]}`, where
each marker carries `file`, `line`, `ceiling`, `trigger` (or null), and
`no_trigger`.

*Done when: the script exited 0 and its JSON is parsed into memory.*

## Step 2 — Judge each marker

For each marker row, read enough of the surrounding code and context to decide
whether its upgrade trigger has tripped, then assign exactly one verdict:

- **HOLDS** — the ceiling is still acceptable and the trigger has not tripped.
- **UPGRADE** — the trigger condition is now true. Name the concrete next step
  the trigger promised (the actual change to make, not "revisit this").
- **NEEDS-TRIGGER** — the script flagged the row `no_trigger`: rot risk.
  Propose a concrete trigger to add, or recommend deleting the marker if the
  shortcut is now permanent-by-default and no upgrade is ever coming.

*Done when: every marker row in the JSON carries exactly one of the three
verdicts.*

## Step 3 — Report

Open with a header carrying the script's counts, then one line per marker,
grouped UPGRADE first, then NEEDS-TRIGGER, then HOLDS:

```
<count> markers, <no_trigger_count> with no trigger.

<file>:<line>: <verdict> — <ceiling> / <trigger or 'no trigger'>
```

If `--write` was used, confirm the ledger path the script wrote. If the scan
found zero markers, report instead: `No debt markers. Either disciplined or
undocumented — check recent shortcuts carry markers.`

*Done when: the number of marker lines in the report equals the script's
`count` field exactly.*

## Sibling files

- `scripts/debt.py` — the marker grammar and all counting; this skill invokes
  it and judges, never re-deriving what it computes. The plugin's advisory
  `hooks/debt_nudge.py` reuses the same module at edit time to nudge on
  trigger-less markers before they ever reach this audit.

New markers get written by the ladder skill's step 4, in this same
`debt: <ceiling>, <trigger>` shape; this skill only audits what already exists.
