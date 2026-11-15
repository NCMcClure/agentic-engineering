---
name: code-diet
description: "Routes are its arguments, not skills: capture-reusable (); debt (); ladder (); reuse-first (); review-diet ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# code-diet

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `capture-reusable` |  | Use when wrapping up work that produced something general; reuse-first is the same question pointed the other way. |  | agent |
| `debt` |  | Use when auditing shortcuts already in the tree, before a release, or when the user asks what debt this repo carries; the ladder skill is what writes new markers. | `[--write <file>]` | agent |
| `ladder` |  | Use on any coding task (writing, adding, refactoring, fixing, choosing a dependency) and whenever the user asks for the simplest solution or complains about bloat, boilerplate, or over-engineering. |  | agent |
| `reuse-first` |  | Use whenever a task would add a dependency, a UI component, or a capability another module plausibly has, and whenever the ladder reaches rung 2. | `<the thing, in plain words>` | agent |
| `review-diet` |  | Use before opening a pull or merge request, or when a diff feels bloated. | `[repo] [--base <ref>] [--apply]` | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
