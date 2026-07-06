# Publishing in local-markdown mode

When `.plan/tracker.md` says the tracker is local markdown, there is no external
service to publish to — the plan tree *is* the tracker. "Publishing" a sprint
here just transitions its issues from planned to active and records that, so
`build-next-issue` and any human reader can see what's in flight.

## Procedure

For the chosen sprint, for each issue you're starting:

1. Leave `**GitHub**:` as `<unassigned>` — there's no external reference. (The
   verifier accepts `<unassigned>` indefinitely.) Optionally, record a local
   handle instead, e.g. `**GitHub**: local:01-01/02`, to give the issue a stable
   name in conversation and in `progress/`.
2. Set status with the funnel — `python .plan/plan/plan-status.py set EE-SS-II
   in-progress` — when work actually starts (not merely when "published"); in local
   mode it touches only the plan markdown (no `gh`) and rolls the sprint/epic up. If
   you're only marking the sprint ready, leave it `not-started`.
3. If a branch is opened for the issue, note it in the issue file under
   `## Blocked by` or a short `## Notes` line, so the active work is discoverable
   from the plan alone.

## What replaces the tracker

Without a remote, completion state comes from three local sources, which
`build-next-issue` reconciles:

- the plan-tree `**Status**:` fields,
- the `.plan/progress/` log (per-epic ledgers + per-run notes),
- git history — merged branches and commits that reference an issue file or slug.

## Switching to a real tracker later

If the project later adopts GitHub or another tracker, re-run `plan-0-init` (or edit
`.plan/tracker.md`) to point at it, then publish unpublished sprints with the
GitHub recipe. Nothing in the plan tree needs to change — issues that were
tracked locally simply gain a real reference the next time they're published.
