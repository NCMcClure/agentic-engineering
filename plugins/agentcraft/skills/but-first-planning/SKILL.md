---
name: but-first-planning
description: "Routes are its arguments, not skills: autopilot (); build-assess-drift (); build-audit (); build-improve-architecture (); build-next-issue (); build-rubber-duck (); build-sprint (); build-tdd (); build-user-docs (); grill (); plan-decompose (); plan-publish (); spec-architect (); spec-edit (); spec-grill (); spec-init (); spec-open (); spec-write ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# but-first-planning

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `autopilot` |  | Runs the whole pipeline hands-off (spec, grill, architect, plan, publish, build, docs) under one up-front contract with one consolidated human gate. Run when the user wants a well-specified project built end to end unwatched. |  | person |
| `build-assess-drift` |  | Use when open drift has piled up, at a sprint boundary, or when asked to triage drift. |  | agent |
| `build-audit` |  | Audits a finished plan tree for what the plan missed (unbuilt or unreachable spec promises, onboarding holes, thin tests, missing docs) and turns confirmed gaps into a new epic. Run when a plan tree or an epic is done and a gap audit is wanted. |  | person |
| `build-improve-architecture` |  | Use when the user asks to find refactors, improve the architecture, or where the seams are. |  | agent |
| `build-next-issue` |  | Use when build work starts or resumes, the user asks what is next, or a done-claim needs checking. |  | agent |
| `build-rubber-duck` |  | Use when a bug, an approach, or a confusing piece of code needs talking through. |  | agent |
| `build-sprint` |  | Use when the user asks agents to build a sprint or an epic. |  | agent |
| `build-tdd` |  | Use when implementing a plan issue. |  | agent |
| `build-user-docs` |  | Use after a sprint verifies, or when asked to document what was built. |  | agent |
| `grill` |  | Use before planning or building anything not fully specified, before handing work off, and after a round of work to reflect. |  | agent |
| `plan-decompose` |  | Use when the spec is settled and the user wants a backlog or a plan. |  | agent |
| `plan-publish` |  | Use when a sprint is about to start or the user asks to publish issues; local-markdown mode publishes nothing. |  | agent |
| `spec-architect` |  | Use after spec-grill, or when asked to review the design. |  | agent |
| `spec-edit` |  | Use for any change once a spec exists ("the design changed", "add a feature") and to turn inline spec comments into edits. |  | agent |
| `spec-grill` |  | Use after spec-write and before planning, or when asked to grill or stress-test the spec. |  | agent |
| `spec-init` |  | Scaffolds the `.agents/plan/` workspace: spec site, empty plan tree, glossary and ADRs, tracker config, status scripts. Run once per project, when the user wants to spec or plan it and no workspace exists; `--refresh` updates a workspace's scripts. | `[--refresh]` | person |
| `spec-open` |  | Serves the `.agents/plan/` spec site locally (reusing a running server) and opens it in the browser, with inline comments and the live Plan page. Run when the user wants to read, review, or comment on the spec. |  | person |
| `spec-write` |  | Use when the user wants to write or grow a spec ("spec this out", "document the design"). |  | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
