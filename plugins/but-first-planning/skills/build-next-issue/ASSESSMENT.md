# Verifying a "done" claim

"Done" and "closed" are claims, not facts. Before trusting one, re-derive it from
evidence. This is the difference between a progress report you can act on and one
that quietly accumulates fiction.

## The check, per claimed-done issue

For each issue marked `done` in the plan or closed in the tracker (and not
already verified in `.plan/progress/completed/`):

1. **Run the testing checkpoint.** The issue's `## Testing checkpoint` table names
   a command (or a manual step). Run it. An issue whose checkpoint command exits
   non-zero — or whose manual step you can't confirm — is **not** done, regardless
   of its flag or ticket state.
2. **Walk the acceptance criteria.** Each `- [ ]` in `## Acceptance criteria`
   should be genuinely satisfiable against the current code/artifacts. The first
   criterion ("the behaviour in the title is implemented end-to-end") is the one
   that matters most: confirm the *observable behaviour* exists, not just that
   some code was written.
3. **Confirm the spec anchors still resolve.** If the anchor points at a spec file
   that has since moved or been deleted, the issue may have been built against a
   design that's since changed — flag it for `plan-6-edit` rather than passing it.
4. **Cross-check git.** Look for a merged branch or commits referencing the issue
   (its file, slug, or tracker number). Merged work with no status change is a
   bookkeeping miss to fix; a `done` flag with no corresponding change anywhere is
   a red flag to investigate.

An issue is **verified-complete** only when its checkpoint passes and its
acceptance criteria hold. Record that verdict; don't re-verify it on the next run.

## When the checkpoint itself is the problem

A checkpoint can fail to pass for reasons that aren't the issue's fault.
Distinguish three cases, because they route differently:

- **Failed** — the command ran and the behaviour is genuinely absent. The issue is not done; send it back (see below).
- **Not-yet-runnable** — the command names tooling a *later* issue builds (a script, binary, or fixture that doesn't exist yet). The `Blocked by` field probably lied; this is an implicit-dependency signal (see [DISPATCH-PLAN.md](DISPATCH-PLAN.md)). Verify against the acceptance criteria directly in the meantime and record the gap, rather than calling a genuinely-built slice "failed."
- **Broken by construction** — the command can *never* pass even when the work is done (the classic, now fixed: a sprint-exit `grep -L "Status: done"` run against `**Status**: done` frontmatter — the pattern never matches the bold form, so the gate is a permanent false negative). The current templates use `plan-status.py check EE-SS` instead, which has no such blind spot; if you still meet a broken-by-construction checkpoint, flag it for `plan-6-edit` and don't let it block a genuinely-complete sprint.

## Verify against the right ref, and only the delta

In a multi-builder sprint build, work is `done` on an unmerged sprint branch long before it
reaches `main`. Record *where* you verified it — `verified on sprint/NN` vs
`merged to main` — so a checkpoint that needs an artifact still living on a branch
isn't mistaken for a regression on `main`. And keep repeated runs cheap:
`.plan/progress/completed/` is the ledger of what's already verified, so on each run
re-verify only the **delta** since the last verified ref (newly-merged or
newly-`done` issues), not the whole tree. Continuous use of this skill depends on that.

## How strict to be

Match the issue's `Type`:

- **AFK** issues were specified to be autonomously verifiable — hold them to their checkpoint command exactly. If it can't be run mechanically, that itself is a defect in the issue (note it).
- **HITL** issues often end in a human judgement (a design accepted, a review passed). You can't re-run a judgement; instead confirm the artifact of the decision exists (the ADR was written, the spec section updated) and take the human's sign-off as the evidence.

Don't gold-plate: you're confirming the slice does what it claimed, not re-
reviewing its quality. Quality review is `code-review`'s job, not this skill's.

## When verification fails

If an issue claimed done doesn't pass:

- Flip it back with `python .plan/plan/plan-status.py set EE-SS-II in-progress` (or `blocked` if it's waiting on something) — the funnel reopens the tracker and rolls the sprint/epic down with it.
- Record it in a `.plan/progress/notes/` run file with the specific failure (which criterion, what the checkpoint did); if it's a recurring or cross-cutting defect, give it its own file under `.plan/progress/drift/` (`drift-<slug>.md`; format in the SKILL).
- Do **not** count it toward completion, and do **not** let anything that depends on it be selected as "next" — a falsely-done blocker is exactly how broken foundations propagate.

## Recording evidence

Record a verified-complete entry with `plan-status.py set EE-SS-II done --evidence
"<what convinced you>"` — e.g. `--evidence "checkpoint run_tests.py exits 0; PR #42
merged"`. The funnel writes the row into `.plan/progress/completed/<epic>.md`.
Evidence beats a checkmark — the next run (and the next person) can trust a logged
reason without re-deriving it. Pass `--evidence` only for work you've actually
verified; a status-only `set … done` (no evidence) writes no ledger row.
