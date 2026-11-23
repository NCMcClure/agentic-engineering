---
name: writing
description: "Use every time you are about to write or rewrite prose a human will read (emails, docs, READMEs, reports, posts, summaries, chat replies), and whenever the person says draft, write up, humanize, de-AI, make it sound like me, or says text sounds like AI: writes in their own voice, free of AI tells. Routes are its arguments, not skills: audit (check existing text for AI tells, optionally rewrite it); calibrate (build or rebuild the voice profile from samples); review (show, prune, or undo what the learning loop changed)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# writing

Prose an agent writes for a person reads as an agent's: uniform rhythm, hedged claims, triads, an empty closing line. This area makes it sound like the person wrote it on a good day. A calibrated profile of their **voice** is loaded into every session, the drafting moves below fill the space it leaves open, and hooks learn from the style feedback they give. Prose only: code, commit messages, and pull request descriptions are out of scope.

Two jobs come here. Writing or rewriting prose a human will read is this area's own, done from the moves below; it is not a route. Checking a text that already exists, building the profile, and curating what the hooks learned are routes: read your route's file before you act or ask.

The data directory for this area is `${CLAUDE_PLUGIN_DATA}/writing`. The routes keep the changelog of learned revisions, the writing samples, and the pause flag there.

## Voice first

The person's voice profile lives at `~/.claude/rules/write-like-me.md` (or `$WLM_PROFILE` if set) and is already in your context if it exists. It is the authority on tone, rhythm, vocabulary, and formatting; everything below fills only the space it leaves open. No profile in context? Write with the defaults below, and say once at the end of your reply that a one-time calibration makes every later draft personal: they can ask for it in words, and it is the `calibrate` route.

## Drafting moves

Apply these while writing, in the person's voice:

1. **Vary the rhythm on purpose.** Mix long and short sentences; let paragraph size follow the weight of the point. Uniform rhythm is the single most machine-flagged trait, and the fix is free.
2. **Anchor every paragraph in something concrete.** A name, number, date, quote, or specific consequence. A paragraph true of anything is about nothing.
3. **Use spoken-register verbs and nouns.** The word the person would say to a colleague: *use* over *leverage*, *has* over *boasts*, *look at* over *delve into*.
4. **Commit to claims.** State it, then support it. Put uncertainty in the content ("untested beyond X") where it is information, and keep the framing direct.
5. **Prose for connected reasoning, lists for parallel items.** Bullets carry order-free enumerable things; if the ideas lean on each other, write sentences.
6. **End on the last real point.** When the content is done, stop.

## Done when

Before presenting the draft, reread it hunting **clusters** of the patterns in [references/ai-tells.md](references/ai-tells.md); read that file whenever you need the full catalog. The draft passes when no cluster survives: a lone em-dash or a single triad is fine; a triad inside a hedged, uniform-rhythm paragraph with an empty closer is a rewrite. Fix by rewriting the passage in the person's voice, not by swapping the flagged word for a synonym.

Draft passes but reads flat? Read [references/natural-writing.md](references/natural-writing.md) for craft techniques, then revise once.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `audit`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `audit` | check existing text for AI tells, optionally rewrite it | Use when the person asks for a text to be audited, asks whether it sounds AI-written, or wants a draft checked for AI tells. |  | agent |
| `calibrate` | build or rebuild the voice profile from samples | Use when the person asks to calibrate their voice: the one-time setup, and the full rebuild when the profile has drifted. |  | person |
| `review` | show, prune, or undo what the learning loop changed | Use when the person asks to see what the learning loop changed, to undo a revision, or to pause learning. |  | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
