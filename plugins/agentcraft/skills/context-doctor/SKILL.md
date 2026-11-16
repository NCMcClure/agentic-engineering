---
name: context-doctor
description: "Use when a session ignored a rule, lost its instructions after a compaction, stopped at a skill, or ran short of room, or after changing a hook, a critical line, or a skill description: reads the session transcript and says what reached the model, what did not, and the fix. Routes are its arguments, not skills: diagnose (what went wrong with a session's context, and the fix); lens (what entered an agent's context, by area and hook)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# context-doctor

A plugin's hooks are invisible from both ends. The person never sees a SessionStart briefing, and the agent cannot tell which of its context came from which area, which of it reached the person instead, or what came back after a compaction. Claude Code records all of it in the session transcript, and this area reads it back: what entered the model's window, when, and from where, and which of the faults with a known cause it shows.

It is the measured half of a plugin's cost. `/agentcraft:plugin-workbench` scores what a plugin should cost from its files; this says what it did cost in a session.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **The transcript is the evidence.** The text is the transcript's own and a request's size is the API's own count; a per-item token figure is an estimate, characters over four, and is said to be one.
- **Reading changes nothing.** No script here edits a plugin, a hook, or a transcript. A fix is named with its finding and made only when the person asks; a fix to a plugin's structure is the workbench's.
- **A transcript holds what the person typed and what the agent read.** Quote from it only what the question needs.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `diagnose`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `diagnose` | what went wrong with a session's context, and the fix | Use when a session ignored a rule, forgot its instructions after a compaction, stopped at a skill, or ran short of room, and after changing a hook, a critical line, or a skill description. | `[session id or transcript path] [--json]` | agent |
| `lens` | what entered an agent's context, by area and hook | Use when checking that a plugin's hooks inject what they should, sizing a briefing, checking what survives compaction, or when the person asks what the agent actually saw. | `[report\|serve] [session id or transcript path]` | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
