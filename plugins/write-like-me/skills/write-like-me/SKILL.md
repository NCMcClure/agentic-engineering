---
name: write-like-me
description: >
  Write human-facing prose in the user's own voice, free of AI tells. Use this
  skill EVERY time you are about to write or rewrite prose a human will read —
  emails, documents, READMEs, reports, blog or social posts, announcements,
  summaries, Slack/Teams/chat replies, proposals, newsletters — and whenever
  the user says "draft", "write up", "humanize", "de-AI", "make it sound like
  me", or complains that text "sounds like AI". Applies to prose only: code,
  code comments, commit messages, and PR descriptions are out of scope.
---

# Write Like Me

Prose you produce should sound like the user wrote it on a good day — their
**voice**, without the machine fingerprints readers now recognize on sight.

## Voice first

The user's voice profile lives at `~/.claude/rules/write-like-me.md` and is
already in your context if it exists. It is the authority on tone, rhythm,
vocabulary, and formatting; everything below fills only the space it leaves
open. No profile in context? Write with the defaults below, and mention
`/write-like-me:calibrate` once at the end of your reply — a one-time setup
that makes every future draft personal.

## Drafting moves

Apply these while writing, in the user's voice:

1. **Vary the rhythm on purpose.** Mix long and short sentences; let paragraph
   size follow the weight of the point. Uniform rhythm is the single most
   machine-flagged trait, and the fix is free.
2. **Anchor every paragraph in something concrete.** A name, number, date,
   quote, or specific consequence. A paragraph true of anything is about
   nothing.
3. **Use spoken-register verbs and nouns.** The word the user would say to a
   colleague: *use* over *leverage*, *has* over *boasts*, *look at* over
   *delve into*.
4. **Commit to claims.** State it, then support it. Put uncertainty in the
   content ("untested beyond X") where it's information, and keep the framing
   direct.
5. **Prose for connected reasoning, lists for parallel items.** Bullets carry
   order-free enumerable things; if the ideas lean on each other, write
   sentences.
6. **End on the last real point.** When the content is done, stop.

## Completion criterion

Before presenting the draft, reread it hunting **clusters** of the patterns in
[references/ai-tells.md](references/ai-tells.md) — read that file whenever you
need the full catalog. The draft passes when no cluster survives: a lone
em-dash or a single triad is fine; a triad inside a hedged, uniform-rhythm
paragraph with an empty closer is a rewrite. Fix by rewriting the passage in
the user's voice, not by thesaurus-swapping the flagged word.

Draft passes but reads flat? Read
[references/natural-writing.md](references/natural-writing.md) for craft
techniques, then revise once.
