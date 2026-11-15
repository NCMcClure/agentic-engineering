---
name: picture-this
description: "Routes are its arguments, not skills: export-stills (); visualize ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# picture-this

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `export-stills` |  | Use when a figure changed and its images need refreshing, or when a README or a plain Markdown page needs a picture, a step-by-step strip or an animation of a figure that already exists. | `<figure> [--strip] [--gif] [--beat <id>]` | agent |
| `visualize` |  | Use when asked to visualize, diagram, illustrate or animate how a system, feature, architecture, mechanism or idea works, or to explain one to a non-technical audience. | `[what to visualize: a description, or a path or feature in this repo]` | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
