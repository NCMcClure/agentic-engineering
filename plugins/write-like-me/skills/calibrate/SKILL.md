---
name: calibrate
description: >
  Build or rebuild the user's writing voice profile through sample analysis
  and a short interview — the plugin's one-time (re)setup step.
disable-model-invocation: true
---

# Calibrate: Build the Voice Profile

Produce a **concise** profile of how the user writes, saved to the profile
path (normally `~/.claude/rules/write-like-me.md`, or `$WLM_PROFILE` if set —
`scripts/wlm/paths.py` is the resolver). That file is auto-loaded into every
one of the user's future sessions, so every line is paid for in permanent
context: the line budget is **hard**, and
`scripts/wlm/profile_budget.py` owns the number and the count. A profile that
captures five true things beats one that catalogs twenty.

## Steps

1. **Check for an existing profile.** If the profile file
   exists, read it and tell the user you'll update rather than start over.
   `${CLAUDE_PLUGIN_DATA}/changelog.md` records which lines were auto-revised
   from observed feedback — carry those preferences forward unless the user
   drops them.

2. **Gather 2–4 writing samples.** Ask for prose the user actually wrote —
   pasted text or file paths (emails, docs, posts; a few hundred words total
   is enough). Copy each into `${CLAUDE_PLUGIN_DATA}/samples/` (create dirs as
   needed) so future recalibrations can reuse them. If the user has no samples
   handy, proceed on interview alone and say the profile will sharpen once
   they add some.

3. **Analyze the samples** along these dimensions, quoting evidence to
   yourself as you go:
   - Formality register, and whether it shifts by audience
   - Contractions: always, sometimes, never
   - Sentence length distribution — average and spread (do they write short
     punchy lines? long clauses? both?)
   - Punctuation habits: em-dash frequency, semicolons, parentheticals,
     exclamation marks
   - Vocabulary register: plain vs. technical vs. playful; signature words or
     phrases they reach for
   - Humor and directness: dry, warm, blunt, diplomatic
   - Openings and sign-offs in correspondence
   - Formatting: prose vs. lists, header usage, emoji

4. **Interview for what samples can't show.** Ask 3–5 questions, one round:
   typical audiences; pet peeves in others' writing; words or constructions
   they'd never use; anything they've been told their writing sounds like.
   Skip questions the samples already answered decisively.

5. **Draft the profile** from
   [assets/profile-template.md](assets/profile-template.md). Every line must
   be an instruction Claude can act on while writing ("Short declarative
   openers; no throat-clearing greeting line") — a line that merely describes
   ("has a distinctive style") is dead weight; cut it. Verify the budget with
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/wlm/profile_budget.py" <draft>` —
   it must exit 0 before you show the draft.

6. **Show the user the full draft and iterate** until they approve it. Then
   write it to the profile path and append a dated entry to
   `${CLAUDE_PLUGIN_DATA}/changelog.md` noting calibration (created or
   rebuilt, and what changed).

Calibration is complete when the approved profile is on disk, the changelog
entry exists, and you've told the user it now loads in every session — and
that the plugin will keep refining it as they give style feedback, reviewable
anytime via `/write-like-me:review`.
