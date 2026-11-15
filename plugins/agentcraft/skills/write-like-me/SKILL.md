---
name: write-like-me
description: "Routes are its arguments, not skills: audit (); calibrate (); review ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# Write Like Me

Prose you produce should sound like the user wrote it on a good day — their
**voice**, without the machine fingerprints readers now recognize on sight.

## Voice first

The user's voice profile lives at `~/.claude/rules/write-like-me.md` (or
`$WLM_PROFILE` if set) and is already in your context if it exists. It is the authority on tone, rhythm,
vocabulary, and formatting; everything below fills only the space it leaves
open. No profile in context? Write with the defaults below, and mention
`/agentcraft:write-like-me calibrate` once at the end of your reply — a one-time setup
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

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `audit` |  | Use when the user runs /agentcraft:write-like-me audit, asks "does this sound AI-written?", or wants a draft checked for AI tells. |  | agent |
| `calibrate` |  | Use when the user runs /agentcraft:write-like-me calibrate: the plugin's one-time setup, and the full rebuild when the profile has drifted. |  | person |
| `review` |  | Use when the user runs /agentcraft:write-like-me review to see what the learning loop changed, undo a revision, or pause learning. |  | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
