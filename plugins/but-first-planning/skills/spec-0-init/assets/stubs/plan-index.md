# {{PROJECT_NAME}} Implementation Plan

<!-- plan-format: 3.7 — do not remove: verify-plan-tree.py reads this marker
     to enforce the 3.7 issue rules (e.g. the **User-facing** line) at
     CRITICAL level rather than warning. -->

This tree decomposes the specification at [`../spec/`](../spec/index.md) into an
executable backlog of **tracer-bullet vertical-slice** issues. Its shape mirrors
the spec's progressive-disclosure structure so a reader can descend from this
index to a single issue without losing context.

GitHub (or other tracker) references default to `<unassigned>`; real IDs are
filled in when each sprint's issues are published via `plan-1-publish-issues`.

## Conventions

- Numeric-prefix + kebab-case directories (mirrors `spec/`).
- Issue files: `NN_issue_ISSUE-NAME.md` (uppercase slug, underscores).
- `GitHub: <unassigned>` until published; then a real tracker reference.
- Default triage label on publication: `ready-for-agent` (see `../tracker.md`).
- Each issue cuts a thin end-to-end path and links the spec sections it realises
  ("spec anchors"), so changes propagate and the verifier can check them.

## Epics

<!-- plan-0-decompose maintains this table: one row per NN-<epic>/ directory. -->

_No epics yet. Run `plan-0-decompose` to decompose the spec into epics, sprints, and issues._

Status legend: `not-started` / `in-progress` / `blocked` / `done`.

## Verification

Run `python plan/verify-plan-tree.py` to assert the tree is well-formed
(structure, required fields, blocked-by links, and spec-anchor integrity).

## Status

Never hand-edit a `Status` field or table cell. Run `python plan/plan-status.py
set EE-SS-II <status>` — it propagates the change across the issue file, the
sprint/epic tables and fields, this index, and the tracker in one deterministic
step. `python plan/plan-status.py check [EE[-SS[-II]]]` reports the rolled-up
status and verifies every surface agrees.
