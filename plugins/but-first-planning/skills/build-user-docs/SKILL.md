---
name: build-user-docs
description: Write and refresh end-user documentation (README, docs/) for verified-complete sprint work, grounded by running the built commands — product docs, not the .plan/ spec site. Use after a sprint verifies, or when the user asks to "update the docs" / "document what we built".
---

# build-user-docs — docs for the people who'll use the thing

The spec site under `.plan/spec/` documents the *design* for the people building
it. Nothing in the pipeline documents the *product* for the people who'll use
it — how to install it, run it, and get something done with it. This skill
closes that gap: after `build-next-issue`'s verification confirms a sprint's
work is genuinely done, it writes or refreshes the target project's end-user
docs (README, `docs/`), so documentation grows sprint by sprint alongside the
code instead of being one rushed pass at the end.

It does not verify work (that's `build-next-issue`), and it never documents
unverified work — the whole point is that docs describe only behaviour that
demonstrably exists. It writes doc files in the target project and its own
ledger, nothing else.

## The gate rule

An issue is **documentable if and only if it has a row in
`.plan/progress/completed/`** — the per-epic ledger that only gains rows via
`plan-status.py set EE-SS-II done --evidence`, written only by
`build-next-issue`'s independent verification. A `Status: done` field, a closed
ticket, or a builder's claim is *not* enough. This reuses the suite's trust
property (evidence re-derived, never forwarded) instead of inventing a new one,
and it means deferred HITL drafts, skipped units, and their dependents are
automatically excluded until a later reconcile verifies them — the ledger diff
picks them up on the next pass with no special-casing.

One deliberate exception at the boundary: a feature whose runnable checkpoints
passed but whose `REVIEW` walkthrough is still pending **is documented**, and
the report flags it as *documented ahead of REVIEW sign-off*. Waiting would
stall docs on a human in every autonomous run; if the walkthrough later fails,
the docs correction rides the existing drift machinery like any other defect.

## What it reads

- `.plan/progress/docs.md` — this skill's own ledger and managed-files
  manifest, created lazily on the first run. This skill owns the format; it is
  defined in [DOCS-STATE.md](DOCS-STATE.md).
- `.plan/progress/completed/` — the verified-complete ledgers. The diff against
  `docs.md` is the work list: every verified issue not yet documented.
- The undocumented issues' files — title, `## What to build`, the optional
  `**User-facing**` line (seeded by `plan-0-decompose`; absent on older plans —
  infer from the title, spec anchors, and the diff), and spec anchors — plus
  their sprints' `## Goal`. This is the *intent*.
- The sprint's diff or PR — what *actually* changed.
- The built tree itself — the only admissible evidence for anything the docs
  claim (see the grounding rule below).

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. Compute the undocumented set

Diff `.plan/progress/completed/` against the sprints recorded in
`.plan/progress/docs.md`. The result is the verified-but-undocumented issue
set. If it's empty, say so and stop — this skill is idempotent, and a no-op
run is a correct run. Sort the set user-first: issues whose `**User-facing**`
line says `no — internal` need no docs, only a line in the report saying they
were considered and excluded.

### 2. Gather intent and reality

For each documentable issue, read its file and sprint goal (the intent), then
the sprint diff/PR (the reality). Where they disagree, the diff wins — docs
describe the product as built, and the disagreement is worth a drift file if
it's more than cosmetic.

### 3. Detect the docs layout

Find the project's existing documentation convention before writing anything:
a README-only project, a `docs/` directory, `mkdocs.yml`, a Docusaurus site,
man pages. Follow what exists. Only when nothing exists, impose the default:
README carries install + quickstart, `docs/` carries topic pages. The
detection order and layout rules are in [DOCS-STATE.md](DOCS-STATE.md).

### 4. Ground every claim

**Every command, flag, path, and example that appears in end-user docs must be
executed or verified against the built tree before it is written** — run the
`--help`, run the quickstart, check the file exists. Spec anchors supply
vocabulary and intent; they are never evidence that a flag exists. This is the
same posture `build-next-issue` takes toward done-claims: don't assert,
demonstrate. A claim you couldn't ground doesn't go in the docs — it goes in
the report.

### 5. Write and rewrite

Apply the ownership and coherence rules from [DOCS-STATE.md](DOCS-STATE.md):

- Files this skill created (listed under `## Managed files` in `docs.md`) are
  **managed** — restructure them freely every pass so the doc set reads as a
  whole. Files it didn't create get **surgical section-level edits only**;
  a conflict with user-authored prose is reported, never overwritten.
- Each pass re-reads the whole managed set and rewrites for the *current*
  product. The per-sprint delta is an input, not the output shape — no
  append-only changelog fragments, no "New in sprint 03" sections.
- Forbidden content: internal architecture, the `.plan/` workflow, anything
  behind a slice that has no ledger row.

### 6. Commit per the run's git posture

The default: commit the doc changes onto the sprint branch and push, so they
land on the **still-open sprint PR** — docs get reviewed alongside the code
and the one-PR-per-sprint contract holds. If the sprint PR is already merged
(a slow interactive run), fall back to a small standalone docs commit or PR
per the run's git discipline. If the posture says leave uncommitted, leave
uncommitted and say so.

### 7. Record and report

Append this pass's rows to `.plan/progress/docs.md` (sprint, date, docs
commit, files touched) and update its `## Managed files` list. Then report:
which issues were documented and where, which were excluded as
`User-facing: no`, every claim grounded by execution vs. reported ungroundable,
and — prominently — any features documented ahead of a pending REVIEW
sign-off.

## Done when

Every verified-but-undocumented issue is either documented or explicitly
reported out-of-surface (`User-facing: no`); every command and example in the
docs was executed against the built tree; `.plan/progress/docs.md` records the
pass; and the docs commit landed where the git posture says it should.

## Scope boundary

This skill touches only the target project's documentation files and
`.plan/progress/docs.md`. It never flips a plan `Status:` field (the funnel
owns those), never edits the spec (that's `spec-4-edit`), and never writes
under `.plan/spec/` — the spec site is design docs, and keeping the two
separate is the point.
