---
name: review
description: "Show, prune, revert, or configure the person's writing profile and its auto-refinement history. Use when the person asks to see what the learning loop changed, to undo a revision, or to pause learning."
---

# Review: Inspect and Curate the Profile

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

The profile (normally `~/.claude/rules/write-like-me.md`, or `$WLM_PROFILE`
if set) is auto-loaded into every session, and the Stop hook auto-applies
refinements as in-place revisions to its sections; the changelog in
the data directory (the one the write-like-me area names when it loads) is the only record of what was auto-applied. This
skill is the human valve on that loop.

## Steps

1. **Show the current state.** Print the profile, run
   `node "W/scripts/wlm/profile-budget.mjs"` for the
   line count against the budget, then show the recent entries from
   `changelog.md` in the data directory so the user can see what was
   auto-applied and when. Flag any auto-applied revision that overwrote a
   calibrated line (the changelog records old → new).

2. **Ask what they want to change**, then do it:
   - **Revert** — restore a line to its pre-revision wording using the
     changelog's old → new record; note the reversal in the changelog so the
     refinement loop doesn't re-apply it blindly.
   - **Prune** — auto-revisions accrete; merge overlapping lines and evict
     the stale, keeping the profile comfortably under budget. Propose the
     pruned lines before writing them.
   - **Edit** — direct wording changes anywhere in the profile at the user's
     dictation.
   - **Pause/resume learning** — pause: create the empty file
     `state/refine-disabled` in the data directory; resume: delete it.
     Confirm which state it's now in.
   - **Full rebuild** — that is the `calibrate` route (`/agentcraft:write-like-me calibrate`). The person
     asked for it, so read that route and follow it instead of reimplementing the interview here.

3. **Write and log.** Any profile change gets a dated changelog entry
   (`## <date> (review)`) recording old → new. Review is complete when the
   profile on disk matches what the user approved and the changelog reflects
   it.
