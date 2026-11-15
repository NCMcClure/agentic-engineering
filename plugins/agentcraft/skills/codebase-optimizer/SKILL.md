---
name: codebase-optimizer
description: "Restructures a repository that has already accreted, in stages behind its own tests with revert on red: use for a sprawling file tree, god-files, or shallow, tightly coupled modules. Routes are its arguments, not skills: optimize-codebase (the whole sweep: organize, split god-files, deepen); codebase-organizer (the file tree alone: a bloated root, AGENTS.md hubs); improve-codebase-architecture (the seams alone: shallow modules, leaky interfaces)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# codebase-optimizer

Codebases accrete. Roots fill with loose files, modules balloon into god-files, and shallow pass-through layers pile up, and refactoring that by hand is slow and breaks the build somewhere in the middle. This area does it in stages: organize the file tree into `AGENTS.md` hubs, split god-files behind compatibility shims, deepen shallow modules, each stage checked against the repo's own tests.

What the routes share, each in its own file's words, so read the route before you act or ask:

- **The person says yes before the repository changes.** Every route has its own point for that yes (a plan to approve, candidates to pick from, a go-ahead for a sweep you started on your own), and the route's file says where it is.
- **The repo's own build and tests are the judge.** A change that turns them red is reverted or reported with what broke, never passed off as done.
- **Code moves on a branch, and nothing is pushed or deleted.** The original tree stays one command away, and cruft goes to `archive/` for the person to review.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `optimize-codebase`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `optimize-codebase` | the whole sweep: organize, split god-files, deepen | Use when the ask is a multi-stage refactor over a repository that has accreted ("optimize this codebase", "decompose these huge files"). |  | agent |
| `codebase-organizer` | the file tree alone: a bloated root, AGENTS.md hubs | Use when the ask is about the tree alone (the root is a mess, too many top-level files, organize the folder structure, add AGENTS.md hubs to this repo). |  | agent |
| `improve-codebase-architecture` | the seams alone: shallow modules, leaky interfaces | Use when the ask is about architecture ("improve the architecture", consolidate tightly-coupled modules, make this testable) or a seam worth extracting has been spotted. |  | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
