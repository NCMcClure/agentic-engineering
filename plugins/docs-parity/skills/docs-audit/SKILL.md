---
name: docs-audit
description: "Audit the whole user-docs set against the product: the checker's tree and stale modes plus a read of every page against the code, reported as findings with fixes. Report only; edits nothing."
disable-model-invocation: true
argument-hint: "[root or page glob to limit the audit]"
---

# docs-audit

`docs-sync` keeps one change honest. This audit catches what slipped between changes: a page nobody touched
while its screen changed three times, a flag removed two releases ago, a shot from before a redesign. It
reports; fixing is a `docs-sync` pass the user starts.

## Step 1: The mechanical pass

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/docs_check.py" --stale --json
```

Group the findings by page. `SHOT_STALE` is a heuristic (code in the surface changed after the picture was
taken), so it lists candidates, not verdicts: Step 2 decides each.

## Step 2: The read

For each page in scope (fan out one sub-agent per root when the set is large, each with the page list and
the contract `.agents/contracts/docs.md`):

1. Every claim against the built product: run each command and flag, open each screen, check each default and
   limit in the code. A claim you could not ground is a finding, with what you ran.
2. Every image against the screen it shows: open the product in the shot's state and compare. A moved
   button, a renamed label or a new field is a stale shot.
3. Coverage the other way: list the surfaces a reader meets (routes, commands, endpoints, config keys) and
   name the ones no page covers.
4. The audience rules (`audiences.md`) and the page shape (`page-shape.md`).

## Step 3: Report

One table, most severe first: page, finding, evidence (what you ran or saw), the fix. Then the uncovered
surfaces, then a proposed `surfaces` change for `.agents/docs-parity.json` if the map missed something. With
agent-works installed, offer to turn the fixes into cards (`aw kanban add`). Write no file.

## Done when

Every page in scope was checked by the script and read against the product, every finding carries its
evidence, and the user has the report.
