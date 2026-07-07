---
name: review
description: >
  Show, prune, revert, or configure the user's writing profile and its
  auto-refinement history — the human valve on the learning loop.
disable-model-invocation: true
---

# Review: Inspect and Curate the Profile

The profile (normally `~/.claude/rules/write-like-me.md`, or `$WLM_PROFILE`
if set) is auto-loaded into every session, and the Stop hook auto-applies
refinements as in-place revisions to its sections; the changelog in
`${CLAUDE_PLUGIN_DATA}` is the only record of what was auto-applied. This
skill is the human valve on that loop.

## Steps

1. **Show the current state.** Print the profile, run
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wlm/profile_budget.py"` for the
   line count against the budget, then show the recent entries from
   `${CLAUDE_PLUGIN_DATA}/changelog.md` so the user can see what was
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
     `${CLAUDE_PLUGIN_DATA}/state/refine-disabled`; resume: delete it.
     Confirm which state it's now in.
   - **Full rebuild** — that's `/write-like-me:calibrate`; hand off rather
     than reimplementing the interview here.

3. **Write and log.** Any profile change gets a dated changelog entry
   (`## <date> (review)`) recording old → new. Review is complete when the
   profile on disk matches what the user approved and the changelog reflects
   it.
