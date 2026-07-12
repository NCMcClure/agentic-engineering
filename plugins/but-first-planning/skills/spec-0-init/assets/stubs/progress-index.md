# Progress

Navigation hub for execution progress. Maintained by `build-next-issue`
(verification, roll-up, and this snapshot) and `build-sprint` (per-run
notes). "Done" here means *verified*-done, not merely closed — see `completed/`.

Status itself is never hand-edited. It is set through the single funnel
`plan/plan-status.py`, which updates every plan surface and the tracker at once:

```bash
python plan/plan-status.py set 01-03-07 done --evidence "checkpoint exits 0; PR #42"
python plan/plan-status.py check 01-03      # is this sprint fully done + consistent?
```

## Status snapshot

<!-- build-next-issue rewrites this table from the plan-tree roll-up on each run. -->

| Epic | Sprints done | Issues done | Status |
|------|--------------|-------------|--------|
| _none yet_ | | | |

## Open cross-cutting items

Plan/spec defects (route to `spec-4-edit`) and architecture smells (route to
`build-improve-architecture`) each get their own file in [`drift/`](drift/) —
one `drift-<slug>.md` per item — so they have a lifecycle instead of being
restated every run. Top open items:

- _none yet_

## How to navigate

- **`completed/`** — one ledger file per epic (`NN-epic-slug.md`): one row per
  verified-complete issue with the evidence that convinced the verifier. The
  durable audit trail. Rows are appended by `plan-status.py set … done --evidence`.
- **`notes/`** — one file per sprint-build-run (`YYYY-MM-DD-NN-MM-slug.md`): build
  method, scope/deferrals, drift, architecture smells, checkpoint health, test
  totals, HITL/REVIEW sign-offs (for REVIEW: who verified, on which ref). Newest
  run is a new file, so you never scroll past old epics.
- **`drift/`** — one `drift-<slug>.md` file per cross-cutting defect or smell, each
  with `id`/`kind`/`surfaced`/`where`/`route`/`status` frontmatter and a short
  write-up. List them with `python progress/drift-status.py` (add `--open` for just
  the actionable `open`/`routed` items); `build-assess-drift` re-checks the open ones
  against the live code and turns the real ones into issues.
- **`drift-status.py`** — read-only index of the `drift/` items for triage; never
  writes. Scaffolded here so it roots itself at `progress/drift/`.
- **`docs.md`** — created by `build-user-docs` on its first run: which verified
  sprints have end-user documentation, and which doc files in the target
  project that skill manages. Absent until the first docs pass.
