# The docs ledger and managed-files manifest

`build-user-docs` records its state in one file, `.plan/progress/docs.md`,
created lazily on the skill's first run (no scaffolding step, no backfill
exception — like drift files). This skill owns the format; `build-next-issue`
consumes it read-only for its docs-freshness report line.

```markdown
# End-user docs ledger

Maintained by `build-user-docs`. Which verified sprints have end-user
documentation, and which doc files the skill manages. See that skill for the
gate rule and grounding rule — nothing lands here that wasn't verified first.

## Documented sprints

| Sprint | Documented on | Docs commit | Files touched |
|--------|---------------|-------------|---------------|
| 01-01  | 2026-07-12    | `a1b2c3d`   | README.md, docs/quickstart.md |
| 01-02  | 2026-07-15    | `e4f5a6b`   | docs/quickstart.md, docs/export.md |

## Managed files

Files created by `build-user-docs`, which it may freely restructure on any
pass. Every other doc file is user-authored: section-level edits only.

- docs/quickstart.md
- docs/export.md

## Notes

- 01-02: `export` docs written ahead of REVIEW sign-off (issue 01-02-05).
```

- **One row per documented sprint**, appended when a pass covers that sprint's
  verified issues. A sprint can appear twice if a later reconcile verifies
  issues that were deferred (e.g. past a `verifyLimit` cap or a HITL draft) —
  the ledger records passes, not promises.
- **`Docs commit`** is the sha of the docs commit (or `uncommitted` when the
  git posture said to leave it). It's the pointer from "documented" back to
  "exactly what was written".
- **`## Managed files`** is the ownership boundary — the load-bearing list.
- **`## Notes`** is optional: ahead-of-REVIEW flags, ungroundable claims,
  conflicts with user-authored files.

## Ownership rules

- A file goes on the managed list **only if this skill created it**. Once
  listed, any pass may rewrite, merge, split, or rename it (updating the list)
  to keep the doc set coherent.
- A file not on the list — a user-authored README, a pre-existing docs page —
  gets **surgical, section-level edits**: add or update the section the new
  behaviour belongs in, leave the rest byte-for-byte alone. If the needed
  change conflicts with what a human wrote (their quickstart contradicts the
  built behaviour), report the conflict; never silently overwrite prose you
  don't own.
- Never delete a doc file, managed or not, without saying so in the report.

## Coherence rules

- Each pass re-reads the **entire managed set** and rewrites it to describe
  the product as it exists now. The sprint delta says what changed; it does
  not shape the output. No append-only fragments, no per-sprint "what's new"
  sections, no stale examples left because they were true last sprint.
- End-user docs answer: what is this, how do I install it, how do I do the
  things it's for. They never document internal architecture, agent workflow,
  or anything under `.plan/` — that's what the spec site is for.
- Every command, flag, path, and example is grounded by execution against the
  built tree before it's written (the grounding rule in
  [SKILL.md](SKILL.md)). An ungroundable claim is a report line, not a doc line.

## Docs-layout detection order

Follow the first convention that exists; impose the default only at the end:

1. A docs-site config — `mkdocs.yml`, `docusaurus.config.*`, `conf.py`
   (Sphinx), `book.toml` (mdBook) — write pages into that site's source tree
   and wire them into its nav.
2. A `docs/` (or `doc/`) directory of prose pages — match its structure and
   file naming.
3. Man pages / a `--help`-driven CLI with no prose docs — README-only, kept
   tight and current.
4. README only — extend it while it stays scannable; split into `docs/` when
   install + quickstart + topics stop fitting comfortably.
5. Nothing — the default: README carries install + quickstart, `docs/`
   carries topic pages, both created and listed as managed.
