---
name: review
description: >
  Show, prune, revert, or configure the user's writing profile and its
  auto-refinement history. Use when the user runs /write-like-me:review, asks
  what's in their writing profile, wants to see or undo auto-applied style
  refinements, or wants to pause/resume profile learning from feedback.
---

# Review: Inspect and Curate the Profile

The profile at `~/.claude/rules/write-like-me.md` is auto-loaded into every
session, and the Stop hook auto-applies refinements to its `## Learned`
section. This skill is the human valve on that loop.

## Steps

1. **Show the current state.** Print the profile with line count against the
   60-line budget, then the recent entries from
   `${CLAUDE_PLUGIN_DATA}/changelog.md` so the user can see what was
   auto-applied and when. Flag any conflict between a Learned line and a calibrated line.

2. **Ask what they want to change**, then do it:
   - **Revert** — remove or restore a Learned line; note the reversal in the
     changelog so the refinement loop doesn't re-add it blindly.
   - **Prune** — Learned lines accrete; merge overlapping ones and evict the
     stale, keeping the profile comfortably under budget. Propose the pruned
     Learned section before writing it.
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
