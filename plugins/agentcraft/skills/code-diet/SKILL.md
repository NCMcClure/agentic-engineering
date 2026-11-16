---
name: code-diet
description: "Use on any coding task to build at the simplest rung that holds, and to check what already exists before building, hunt over-engineering in a diff, inventory deferred shortcuts, or note what this work built that another project could use. Routes are its arguments, not skills: ladder (any coding task: the simplest rung that holds); reuse-first (before building: what this repo and others already have); review-diet (hunt over-engineering in the diff, cut behind a check); debt (inventory the debt: markers, and whether each still holds); capture-reusable (wrapping up: what another project could use)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# code-diet

Every line an agent writes gets paid for more than once: at generation, again at review, and again in every later session that loads it as context. Agents over-build by default, and the surplus compounds. This area prices the line at each of those moments: before the code, the simplest rung that holds; at review, a scan for what can be cut; and for what was deferred on purpose, a marker that says when it comes due.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **Stop at the first rung that holds.** YAGNI, what the repo already has, stdlib, the platform, an installed dependency, one line, then the minimum that works.
- **Four things are never cut:** trust-boundary validation, data-loss handling, security, and accessibility.
- **A script finds, you judge.** The scans locate candidates deterministically; whether one is cut is decided at the flagged spot, and a cut lands behind the repo's own checks or is reverted.
- **A shortcut taken on purpose carries a `debt:` marker** with its ceiling and its trigger, so it can be found and judged later.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `ladder`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `ladder` | any coding task: the simplest rung that holds | Use on any coding task (writing, adding, refactoring, fixing, choosing a dependency) and whenever the user asks for the simplest solution or complains about bloat, boilerplate, or over-engineering. |  | agent |
| `reuse-first` | before building: what this repo and others already have | Use whenever a task would add a dependency, a UI component, or a capability another module plausibly has, and whenever the ladder reaches rung 2. | `<the thing, in plain words>` | agent |
| `review-diet` | hunt over-engineering in the diff, cut behind a check | Use before opening a pull or merge request, or when a diff feels bloated. | `[repo] [--base <ref>] [--apply]` | agent |
| `debt` | inventory the debt: markers, and whether each still holds | Use when auditing shortcuts already in the tree, before a release, or when the user asks what debt this repo carries; the ladder route is what writes new markers. | `[--write <file>]` | agent |
| `capture-reusable` | wrapping up: what another project could use | Use when wrapping up work that produced something general; reuse-first is the same question pointed the other way. |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
