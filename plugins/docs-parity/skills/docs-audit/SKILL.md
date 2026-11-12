---
name: docs-audit
description: "Audit the whole user-docs set against the product: the checker's tree and stale modes plus a read of every page against the code, reported as findings with fixes. Report only; edits nothing. Use before a release, after a large change to a user-visible surface, or when the user asks whether the docs are current; to fix what it finds use docs-sync."
argument-hint: "[root or page glob to limit the audit]"
---

# docs-audit

`docs-sync` keeps one change honest. This audit catches what slipped between changes: a page nobody touched
while its screen changed three times, a flag removed two releases ago, a shot from before a redesign. It
reports; fixing is a `docs-sync` pass the user starts.

## Step 1: The mechanical pass

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/docs-check.mjs" --stale --json
```

Group the findings by page. `SHOT_STALE` is a heuristic (code in the surface changed after the picture was
taken), so it lists candidates, not verdicts: Step 2 decides each.

## Step 2: The read

For each page in scope (fan out one sub-agent per root when the set is large, each with the page list and
the contract `.agents/docs-contract.md`):

1. Every claim against the built product: run each command and flag, open each screen, check each default and
   limit in the code. A claim you could not ground is a finding, with what you ran.
2. Every image against the screen it shows: open the product in the shot's state and compare. A moved
   button, a renamed label or a new field is a stale shot.
3. Coverage the other way: list the surfaces a reader meets (routes, commands, endpoints, config keys) and
   name the ones no page covers.
4. The audience rules and the page shape (`audiences.md` and `page-shape.md` in
   `${CLAUDE_PLUGIN_ROOT}/skills/docs-parity/references/`).

## Step 3: Report

One table, most severe first: page, finding, evidence (what you ran or saw), the fix. Then the uncovered
surfaces, then a proposed `surfaces` change for `.agents/docs-parity.json` if the map missed something. With
the user's go-ahead, add the fixes as tasks in the project's tracker (with agent-works, cards:
`aw board add`). Write no file.

## Done when

Every page in scope was checked by the script and read against the product, every finding carries its
evidence, and the user has the report.
