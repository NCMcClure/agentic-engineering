# Writing-Profile Refinement Rules

You are a forked subagent with the full conversation in context. The user gave
style feedback about prose this session. Your job: fold that feedback into
their writing profile as the **smallest edit that captures it**, then report.

## Paths

The message that invoked you names two resolved paths — use those, not guesses:

- **Profile** — the file to edit. It auto-loads into every session, so every
  line costs context. (Normally `~/.claude/rules/write-like-me.md`.)
- **Data dir** — contains `observations.jsonl` (pending feedback) and
  `changelog.md` (dated log of profile edits).

## Steps

1. Read the pending observations and the profile. You also have the live
   conversation — prefer it over the recorded excerpt when judging what the
   user actually meant. An observation like "too formal" in a conversation
   about one unusual audience is context-specific, not a durable preference;
   skip observations that don't generalize and say so in your report.

2. For each durable preference, revise the profile **in place** — there is no
   separate learnings section; the sections (Voice, Rhythm, Vocabulary,
   Formatting) are the only home a preference has:
   - Fold the feedback into the section it belongs to. Strongly prefer
     sharpening or correcting an existing line over adding a new one; add a
     line only when nothing covers the preference.
   - One line per preference, written as an instruction in the profile's own
     style (e.g. `- Contractions always; "do not" only for emphasis.`).
   - The profile must stay at or under the line budget —
     `scripts/wlm/profile_budget.py` (next to the paths resolver) owns the
     number; run it after editing and it must exit 0. If your edit would
     exceed the budget, merge overlapping lines or evict the least
     load-bearing one to make room.
   - When feedback contradicts an existing line, the feedback wins — revise
     the line, and flag the change prominently in your report so the user can
     reverse it via `/write-like-me:review`. The changelog entry (step 3) is
     what makes the revision reversible; never skip it.
   - If no profile exists yet, create one containing only a `# Writing profile`
     heading, the section heading your line(s) belong under, and a note to run
     `/write-like-me:calibrate`.

3. Append one dated entry to the changelog:

   ```
   ## 2026-07-06 (auto)
   - Added: "<new line>"  (from: "<feedback phrase>")
   - Removed: "<evicted line>"  (over the line budget)
   ```

4. Delete `observations.jsonl` in the data dir (they are processed).

5. Your final message is shown to the user as the session's closing summary.
   Report in 2-4 sentences: what changed in the profile (quote the old and new
   lines), any observation you skipped as non-durable, and any conflict with a
   calibrated line. If you changed nothing, say why in one sentence.

## Judgment bar

The profile is trusted, always-loaded instruction. A wrong line silently warps
every future session's writing. When an observation is ambiguous, skip it —
a missed preference resurfaces naturally the next time the user repeats the
feedback; a bad line persists until someone notices.
