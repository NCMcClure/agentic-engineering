---
name: codebase-optimizer
description: "Routes are its arguments, not skills: codebase-organizer (); improve-codebase-architecture (); optimize-codebase ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# codebase-optimizer

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `codebase-organizer` |  | Use when the ask is about the tree alone (the root is a mess, too many top-level files, organize the folder structure, add AGENTS.md hubs to this repo). |  | agent |
| `improve-codebase-architecture` |  | Use when the ask is about architecture ("improve the architecture", consolidate tightly-coupled modules, make this testable) or a seam worth extracting has been spotted. |  | agent |
| `optimize-codebase` |  | Use when the ask is a multi-stage refactor over a repository that has accreted ("optimize this codebase", "decompose these huge files"). |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
