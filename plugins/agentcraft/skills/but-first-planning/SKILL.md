---
name: but-first-planning
description: "Use to pin down a vague request by interview, and to take a project from spec to published plan to test-first build: write or change the spec, break it into issues, build the next one, audit a sprint. Routes are its arguments, not skills: grill (a vague or ambiguous ask: one question at a time); spec-init (scaffold .agents/plan/ where no spec exists yet); spec-write (author the spec from a brief or a codebase); spec-grill (interrogate the spec for gaps and contradictions); spec-architect (pressure-test the design, record ADRs); spec-edit (change a spec page, keep plan and tracker level); spec-open (serve the spec site to read and comment on); plan-decompose (the spec into epics, sprints, and issues); plan-publish (a sprint of the plan tree into GitHub or GitLab issues); build-next-issue (what is next: the unblocked issue, or a dispatch plan); build-tdd (one plan issue: criteria to failing tests to done); build-sprint (a sprint's issues in parallel, by subagents); build-audit (a finished plan tree: what the plan missed); build-assess-drift (where spec, plan, and code disagree); build-improve-architecture (deepening refactors in built code, fed back to ADRs); build-rubber-duck (talk a stuck problem through, changing no file); build-user-docs (end-user docs from the spec and what shipped); autopilot (every phase in order, spec to docs, one human gate)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# but-first-planning

A project built straight from a conversation drifts: the intent sits in a chat that gets compacted, the plan in someone's head, and "done" is whatever the last session said. This area keeps a spec site, a plan tree of epics, sprints, and issues, and the tracker (GitHub or GitLab issues, or none) level with each other, on disk under `.agents/plan/`.

The routes are phases, and they run in order: the spec (`spec-init`, `spec-write`, `spec-grill`, `spec-architect`, then `spec-edit` for every later change), the plan (`plan-decompose`, `plan-publish`), and the build (`build-next-issue` or `build-sprint`, each issue through `build-tdd`, a finished tree checked by `build-audit`). `grill` stands outside the phases: it is for anything not fully specified, with a plan or without one, which is why it is the route when no row plainly fits.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **Each phase ends at a gate.** The route's file says what its gate is and who passes it; a later phase does not start on a failed one.
- **The spec is the source.** A decision changes there first, and the plan and the tracker follow it. Neither is edited to match the code.
- **Done is checked, not claimed.** An issue is done when its acceptance criteria have tests that pass, and a done-claim is verified before the next issue starts.
- **A route that hands on to another names it through this area**, `/agentcraft:but-first-planning <route>`: a file to read next, never a skill to call.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `grill`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `grill` | a vague or ambiguous ask: one question at a time | Use before planning or building anything not fully specified, before handing work off, and after a round of work to reflect. |  | agent |
| `spec-init` | scaffold .agents/plan/ where no spec exists yet | Scaffolds the `.agents/plan/` workspace: spec site, empty plan tree, glossary and ADRs, tracker config, status scripts. Run once per project, when the user wants to spec or plan it and no workspace exists; `--refresh` updates a workspace's scripts. | `[--refresh]` | person |
| `spec-write` | author the spec from a brief or a codebase | Use when the user wants to write or grow a spec ("spec this out", "document the design"). |  | agent |
| `spec-grill` | interrogate the spec for gaps and contradictions | Use after spec-write and before planning, or when asked to grill or stress-test the spec. |  | agent |
| `spec-architect` | pressure-test the design, record ADRs | Use after spec-grill, or when asked to review the design. |  | agent |
| `spec-edit` | change a spec page, keep plan and tracker level | Use for any change once a spec exists ("the design changed", "add a feature") and to turn inline spec comments into edits. |  | agent |
| `spec-open` | serve the spec site to read and comment on | Serves the `.agents/plan/` spec site locally (reusing a running server) and opens it in the browser, with inline comments and the live Plan page. Run when the user wants to read, review, or comment on the spec. |  | person |
| `plan-decompose` | the spec into epics, sprints, and issues | Use when the spec is settled and the user wants a backlog or a plan. |  | agent |
| `plan-publish` | a sprint of the plan tree into GitHub or GitLab issues | Use when a sprint is about to start or the user asks to publish issues; local-markdown mode publishes nothing. |  | agent |
| `build-next-issue` | what is next: the unblocked issue, or a dispatch plan | Use when build work starts or resumes, the user asks what is next, or a done-claim needs checking. |  | agent |
| `build-tdd` | one plan issue: criteria to failing tests to done | Use when implementing a plan issue. |  | agent |
| `build-sprint` | a sprint's issues in parallel, by subagents | Use when the user asks agents to build a sprint or an epic. |  | agent |
| `build-audit` | a finished plan tree: what the plan missed | Audits a finished plan tree for what the plan missed (unbuilt or unreachable spec promises, onboarding holes, thin tests, missing docs) and turns confirmed gaps into a new epic. Run when a plan tree or an epic is done and a gap audit is wanted. |  | person |
| `build-assess-drift` | where spec, plan, and code disagree | Use when open drift has piled up, at a sprint boundary, or when asked to triage drift. |  | agent |
| `build-improve-architecture` | deepening refactors in built code, fed back to ADRs | Use when the user asks to find refactors, improve the architecture, or where the seams are. |  | agent |
| `build-rubber-duck` | talk a stuck problem through, changing no file | Use when a bug, an approach, or a confusing piece of code needs talking through. |  | agent |
| `build-user-docs` | end-user docs from the spec and what shipped | Use after a sprint verifies, or when asked to document what was built. |  | agent |
| `autopilot` | every phase in order, spec to docs, one human gate | Runs the whole pipeline hands-off (spec, grill, architect, plan, publish, build, docs) under one up-front contract with one consolidated human gate. Run when the user wants a well-specified project built end to end unwatched. |  | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
