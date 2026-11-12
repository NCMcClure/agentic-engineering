# Publishing in local-markdown mode

When `.agents/plan/tracker.md` says the tracker is local markdown, there is no
external service to publish to: the plan tree is the tracker.
`publish-issues.mjs` says so and exits 2. "Publishing" a sprint here means
moving its issues from planned to active and recording that, so
`build-next-issue` and any human reader can see what is in flight.

## Procedure

For the chosen sprint, for each issue you are starting:

1. Leave `**Tracker**:` as `<unassigned>`: there is no external reference, and
   the verifier accepts `<unassigned>` for good. To give the issue a stable
   name in conversation and in `progress/`, record a local handle instead:
   `**Tracker**: local:01-01/02`.
2. Set status with the funnel,
   `node .agents/plan/plan/plan-status.mjs set EE-SS-II in-progress`, when
   work actually starts, not when the sprint is merely "published". In local
   mode it touches only the plan markdown and rolls the sprint and the epic
   up. If you are only marking the sprint ready, leave it `not-started`.
3. If a branch is opened for the issue, note it in the issue file in a short
   `## Notes` line, so the active work is discoverable from the plan alone.

## What replaces the tracker

Without a remote, completion state comes from three local sources, which
`build-next-issue` reconciles:

- the plan tree's `**Status**:` fields,
- the `.agents/plan/progress/` log (per-epic ledgers and per-run notes),
- git history: merged branches and commits that name an issue file or slug.

The spec site's **Plan** page is the board: `/but-first-planning:spec-open` serves it (the person runs it).

## Switching to a real tracker later

Replace `.agents/plan/tracker.md` with the GitHub or GitLab stub from
`spec-init`'s assets (fill its placeholders), then publish the unpublished
sprints. Nothing in the plan tree changes: issues that were tracked locally
gain a real reference the next time they are published.
