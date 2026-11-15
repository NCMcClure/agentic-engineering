---
name: context-doctor
description: "Routes are its arguments, not skills: lens ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# context-doctor

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `lens` |  | Use when checking that a plugin's hooks inject what they should, sizing a briefing, checking what survives compaction, or when the person asks what the agent actually saw. | `[report\|serve] [session id or transcript path]` | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
