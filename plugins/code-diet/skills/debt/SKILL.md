---
name: debt
description: "Inventory every `debt:` marker in the repo with scripts/debt.mjs, judge whether each deferral still holds, and flag trigger-less markers as rot risk. Use when auditing shortcuts already in the tree, before a release, or when the user asks what debt this repo carries; the ladder skill is what writes new markers."
argument-hint: "[--write <file>]"
---

# debt

A `debt:` marker records a deliberate shortcut: `debt: <ceiling>, <trigger>`. The ceiling is the limit the code accepts, the trigger is the observable condition that should make someone upgrade past it. This skill inventories every marker, then judges each: does the deferral still hold, has its trigger tripped, or is it rotting toward permanent?

The scan and every count live in `scripts/debt.mjs`, the single home of the grammar. Never grep for markers yourself and never recount in prose. Judgment is the only thing asked of you here.

## Step 1: Scan

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/debt.mjs" --root . [--write <file>]
```

It walks the tree (skipping `.git`, `node_modules`, and build output), matches every `debt:` comment, and splits each into ceiling and trigger. Parse the JSON: `{count, no_trigger_count, markers[]}`, each marker carrying `file`, `line`, `ceiling`, `trigger` (or null), and `no_trigger`.

*Done when: the script exited 0 and its JSON is parsed.*

## Step 2: Judge each marker

Read enough of the surrounding code to decide, then assign exactly one verdict:

- **HOLDS**: the ceiling is still acceptable and the trigger has not tripped.
- **UPGRADE**: the trigger is now true. Name the concrete change the trigger promised, not "revisit this".
- **NEEDS-TRIGGER**: the row is flagged `no_trigger`. Propose a concrete trigger, or recommend deleting the marker when the shortcut is permanent by decision and no upgrade is coming.

*Done when: every marker row carries exactly one of the three verdicts.*

## Step 3: Report

Header with the script's counts, then one line per marker, UPGRADE first, then NEEDS-TRIGGER, then HOLDS:

```
<count> markers, <no_trigger_count> with no trigger.

<file>:<line>: <verdict> - <ceiling> / <trigger or 'no trigger'>
```

Confirm the ledger path when `--write` was used. Zero markers reports: `No debt markers. Either disciplined or undocumented; check that recent shortcuts carry them.`

*Done when: the number of marker lines equals the script's `count` exactly.*

## Where markers come from

The ladder skill's step 4 writes them, in this same shape. The plugin's edit hook (`hooks/debt-nudge.mjs`) reads the same grammar at edit time and nudges on a marker with no trigger, before it ever reaches this audit.
