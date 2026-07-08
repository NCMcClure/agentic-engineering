# Selecting the next issue

The output the user actually wants: *one* issue to start now. Selection is a
walk over the plan tree in order, gated by verified completion of dependencies.

## The rule

1. **Respect the epic and sprint order.** Don't pull an issue from a later sprint while an earlier sprint still has unfinished work, unless the plan explicitly marks the later sprint as parallel. Epics and sprints usually form a dependency chain (each one's exit is the next one's prerequisite); honour it.
2. **Within the current sprint, pick the lowest-numbered `not-started` issue whose blockers are all *verified*-complete.** "Verified" means it passed the check in [ASSESSMENT.md](ASSESSMENT.md) — not merely marked `done`. A blocker that failed verification does not unblock anything.
3. **A blocker that is `<unassigned>` but verified-complete still counts as done** — local-mode issues never get a tracker reference, so judge by completion, not by whether a ticket exists.

## Ties and parallel work

- If several issues are eligible (no blockers, same sprint), report the lowest-numbered as *the* next issue, but list the others as "also available now" — they can be grabbed in parallel by other contributors or agents. The plan marks issues parallelizable unless an explicit `Blocked by` says otherwise.
- **For a parallel build, don't stop at "also available now."** The `Blocked by` field under-declares real ordering, and two logically-independent issues still collide if they edit the same files. Produce the full **dispatch plan** instead — the wave-ordered, file-disjoint frontier with its true (declared + implied) DAG. The method is in [DISPATCH-PLAN.md](DISPATCH-PLAN.md).
- Prefer an **AFK** issue as the headline "next" when one is available and a human isn't waiting on a **HITL** decision that would unblock more — autonomous work can proceed without scheduling a person. But if a HITL issue is blocking a whole sprint, surface *that* as the real next action, because nothing else moves until it's resolved.

## When the frontier is fully blocked

If every `not-started` issue in the current sprint is blocked by something
incomplete:

- Trace the chain to the **root blocker** — the earliest incomplete issue everything is waiting on — and report *that* as what to do next, even if it's mid-sprint.
- If the root blocker is a **HITL** issue, say so plainly: the project needs a human decision before autonomous work can continue.
- If the blocker failed verification (was falsely marked done), that's the next action: finish it for real.

## When a sprint is complete

If the current sprint's issues are all verified-complete, the next issue is the
first issue of the next sprint. If that sprint hasn't been published yet (its
issues are `<unassigned>` and the tracker is GitHub), the real next action is to
run `plan-1-publish-issues` for it before work can be grabbed.

## What to hand back

For the selected issue, give the user everything needed to start without opening
another file:

- title and `Type` (HITL/AFK),
- tracker reference (or `<unassigned>`, with a note to publish),
- the spec anchors (so they can read the design it realises),
- the acceptance criteria and the testing-checkpoint command (so "done" is unambiguous from the outset),
- and the 1–3 issues that unlock once it lands, so the path forward is visible.
