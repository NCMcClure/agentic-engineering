---
name: start-here
description: "Use when a person asks what the agentic-engineering plugin offers, which of its areas does a job, or how to begin with it. An agent with a task calls the area whose name fits (agent-works, agentic-teamwork, but-first-planning, code-diet, codebase-optimizer, context-doctor, docs-parity, perceptual-loop, picture-this, plugin-workbench, system-map, workflow-studio, write-like-me) and does not come here first; ordinary work no area covers needs no skill, this one included. With a person it asks which areas they want, explains each, and hands off to the route that does the work. With the task as its argument, or with nobody to ask, it asks nothing and names the area and route that fit."
argument-hint: "[the task, in a sentence]"
---

# start-here

The agentic-engineering plugin holds thirteen areas and more routes than anyone should
have to remember, and a job does not say which one it needs. This is the one
way in for a person, and the only skill of the plugin they can type: it finds
out what is wanted, says what each area is for, and hands off to the route
that does the work. It routes and explains, and does none of the work itself.

An agent that already knows its area does not need this skill: it calls the
area by name, `agentic-engineering:<area>`, with the route as the first word of its
arguments.

## Which mode

Settle this before anything else, from two facts: whether this skill was given
arguments, and whether a person is there to answer a question.

- **Guided:** no arguments, and a person is in this session. Ask, explain,
  hand off, in the order below.
- **Direct:** there are arguments, or nobody can answer. Ask nothing.

Nobody can answer in a child session another session started, in a headless or
scheduled run, in a subagent, and on a host with no way to put a question to a
person. When it is not clear that a person is there, nobody is: take the
direct mode.

## Guided: a person, and no arguments

Four steps, in this order. The tables under "The areas" hold everything said
or offered here.

A question tool has limits, and the steps are written to them: in Claude Code,
AskUserQuestion takes two to four options to a question and four questions to
a call. On a host with no question tool, print the options as a numbered list
under each heading and wait for the reply.

1. **Ask which areas they want to use**, once, in one call. Each group of rows
   in the area table is one multi-select question: the group's title is the
   question, the text in its code span is the question's short label, and its
   options are that group's areas in order (the area's name, with its "A
   person picks it to" text as what the option means). The last question
   takes one more option: "Learn more about the areas and their routes". If
   the person answers with a job in their own words and picks nothing, that is
   a task: go to the direct mode with it.
2. **Explain each one they chose**, in the table's order, in two or three
   lines apiece: what it is for (its row) and how it is used (the line under
   its heading). Say it in plain words; do not paste the tables. If they chose
   "Learn more", do that first (below), then come back to whatever else they
   chose.
3. **Ask how they want to use each one**, a single choice per area: one option
   per row of that area's "They want to" table, in order. That is one question
   an area and four questions to a call, so a fifth area and beyond go in a
   second call. An area with one row is not asked about: its one row is its
   use, and say so. The person can always answer in their own words, and what
   they say then is the task for that area; where no row fits it, pick as the
   direct mode does.
4. **Hand off** to the first area they chose, in the table's order, and to
   that one only. Say what it is called first, so they can ask for it by name
   next time: "this is the `<route>` route of `<area>`". Then hand off (below),
   with what they said about the job as its arguments. A use marked `person`
   is handed off like any other here: the person picking it is the person
   asking for it. For every other area they chose, name the area and the
   route and what it will do, one line each, and say they can ask for it when
   this one is done. One run of this skill makes one hand-off: the work it
   starts is theirs to finish before the next begins.

A person cannot type an area: the host keeps every area out of the slash menu
and refuses one typed by hand. So never tell them to type an address from the
tables. They ask for a route in words ("ship this", "grill me on this idea"),
or type `/agentic-engineering:start-here` followed by what they want.

### Learn more

Each area keeps its own table of routes: read `../<area>/SKILL.md`, from the
directory this file is in, for the area in question. Its `## Route` table has
a row for every route: when to take it, its arguments, and who starts it. Read
the file; do not call the area for this, since calling it starts work.

Walk through one group at a time, then one area at a time: what the area is
for, then each of its routes in a line, in plain words, saying of a route
marked `person` that it runs only when they ask for it. Stop after each group
and ask whether to go on, say more about one area, or start using something.
When they pick something to use, go to step 3 for that area.

How the plugin is installed and updated is not in those tables: that is
`/plugin install agentic-engineering@agentic-engineering`, and the marketplace's README.

## Direct: arguments, or nobody to ask

Ask nothing, of anyone, in any form. The task is the arguments; with no
arguments, it is the task this session was given.

1. If the task is a question about the areas or routes themselves (what is
   there, what one does, whether one exists for a job), it is not a job to
   hand off: answer from the tables below, and from the area's own table,
   read as "Learn more" reads it, where the question is about an area's
   routes (the tables here list only a few of them), in a few lines, and stop.
2. Otherwise find the area whose row fits the task, then the row of its "They
   want to" table that fits.
3. Where an area fits and none of its rows does, hand the task to the area
   alone, with no route: it holds every route it has, not only the few listed
   here, and picks its own.
4. Say in one line which area and route fit, and why. Then hand off, with the
   task as the arguments.
5. When none fits, say so plainly: no area of the agentic-engineering plugin covers
   this task. Name the nearest one only if it is close, with what it would
   leave uncovered. Never stretch a route over a job it was not written for.
   This skill ends there, and the task is still the session's to do, without
   one of these areas.

## Handing off

An address in the tables is how an agent reaches its route, and the "Starts
it" column says who may start it.

- `/agentic-engineering:<area> <route>` is an area with a route: invoke the skill
  `agentic-engineering:<area>` with the host's skill tool, with the route as the first
  word of the arguments and the task after it. A route is a document the area
  reads, never a skill to call under its own name: no skill is named after
  one.
- `/agentic-engineering:<area>` alone is the area with no route: invoke it with the
  task as its arguments. It does its own job where it has one (writing in the
  person's voice, opening the workflow studio, the doctrine for work judged by
  eye), and otherwise takes the route that fits.
- **A row that says `person`** is the person's to start, never an agent's on
  its own.
  - A person is in the session and picked it or asked for it: hand off to the
    area, and say in the arguments that the person asked for this route.
  - Nobody can answer: do not start it by any path, and do not do its work
    another way. Say that it needs a person and what to ask for, and take
    nothing else on in its place.

Once a hand-off is made, the area it reached owns the work and this one has
nothing more to say about it.

## The areas

Generated by `scripts/gen-guide.mjs` from `start-here.json` beside this file and each skill's own frontmatter. Change those, never this section.

| Ask under | Area | A person picks it to |
| --- | --- | --- |
| Plan and run work (`Plan & run`) | `but-first-planning` | turn an idea into a spec, a backlog, and built issues |
| Plan and run work (`Plan & run`) | `agent-works` | run several tasks at once, each in its own session |
| Plan and run work (`Plan & run`) | `agentic-teamwork` | set up, check, or ship a repo the team's way |
| Plan and run work (`Plan & run`) | `code-diet` | keep new code small, and cut what is not needed |
| Shape the code and its docs (`Code & docs`) | `codebase-optimizer` | restructure a codebase that has grown messy |
| Shape the code and its docs (`Code & docs`) | `docs-parity` | keep user docs level with the code |
| Shape the code and its docs (`Code & docs`) | `system-map` | keep a diagram of the system that the code checks |
| Shape the code and its docs (`Code & docs`) | `picture-this` | draw how something works as an animated figure |
| Judge the result, and write (`Judge, write`) | `perceptual-loop` | check work judged by eye or ear |
| Judge the result, and write (`Judge, write`) | `write-like-me` | write in your own voice, and catch AI tells |
| Judge the result, and write (`Judge, write`) | `workflow-studio` | build a Claude Code workflow, by canvas or by hand |
| Make plugins, and see what they cost (`Plugins`) | `plugin-workbench` | make, score, or fix a plugin or its skills |
| Make plugins, and see what they cost (`Plugins`) | `context-doctor` | see what a session's agent was actually given |

### but-first-planning

Three phases, each leaving files in a workspace: write and sharpen a spec, decompose it into a backlog, then build that backlog one issue at a time, test-first. The project's workspace is `.agents/plan/`, which `spec-init` scaffolds the first time; a feature or a long task gets its own, `.agents/plans/<name>/`, made when you ask for its spec.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| be questioned on a goal until nothing about it is left unsaid | `/agentic-engineering:but-first-planning grill` | agent |
| write or extend the spec for a project or a feature | `/agentic-engineering:but-first-planning spec-write` | agent |
| break a finished spec into epics, sprints, and issues | `/agentic-engineering:but-first-planning plan-decompose` | agent |
| find the next unblocked issue of the plan | `/agentic-engineering:but-first-planning build-next-issue` | agent |

### agent-works

The session becomes the orchestrator: it turns a goal into cards on a kanban board, asks before starting anything, has a subagent build each card in its own worktree (or a child session, when you ask for sessions), and reviews what comes back. It also keeps a repo's agent-facing files in one place under `.agents/`.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| build a goal bigger than one change, or resume a round | `/agentic-engineering:agent-works orchestrate` | agent |
| see what is on the board, add to it, or move a card | `/agentic-engineering:agent-works board` | agent |
| set a repository up for agent work | `/agentic-engineering:agent-works setup` | person |
| find out why agent files have bloated, or what the machine lacks | `/agentic-engineering:agent-works doctor` | agent |

### agentic-teamwork

Most of it runs unasked: hooks judge commits and pushes against the team's git conventions. What a person starts by name is the setup, the audit, and the two ends of landing work.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| put a new repo on the team conventions before any code is written | `/agentic-engineering:agentic-teamwork bootstrap` | person |
| check the repo against the conventions and repair what drifted | `/agentic-engineering:agentic-teamwork audit-project` | agent |
| commit the work in hand and open its pull or merge request | `/agentic-engineering:agentic-teamwork ship` | agent |
| merge a reviewed request once its checks are green | `/agentic-engineering:agentic-teamwork land` | agent |

### code-diet

On any coding task the agent takes the simplest rung that works, checks what already exists before building, and marks what it defers as debt. A person asks for the review or the debt inventory.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| hunt over-engineering in the working diff before a request | `/agentic-engineering:code-diet review-diet` | agent |
| check what already exists before building something | `/agentic-engineering:code-diet reuse-first` | agent |
| list every deferred shortcut and whether it still holds | `/agentic-engineering:code-diet debt` | agent |
| note what this work built that another project could use | `/agentic-engineering:code-diet capture-reusable` | agent |

### codebase-optimizer

It works in stages on a branch, each one checked by the repo's own tests and reverted when they go red: organize the tree, split the god-files, deepen shallow modules.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| the whole sweep, stage by stage | `/agentic-engineering:codebase-optimizer optimize-codebase` | agent |
| reorganize a sprawling file tree and nothing else | `/agentic-engineering:codebase-optimizer codebase-organizer` | agent |
| find shallow modules and leaky seams and nothing else | `/agentic-engineering:codebase-optimizer improve-codebase-architecture` | agent |

### docs-parity

Pages, screenshots, and the nav move in the same change as the code they describe; a Stop check and CI say when they did not.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| bring the docs level with a change before it is committed | `/agentic-engineering:docs-parity docs-sync` | agent |
| find out whether the whole docs set is current | `/agentic-engineering:docs-parity docs-audit` | agent |
| cut a README down to what a newcomer needs | `/agentic-engineering:docs-parity readme` | agent |
| adopt the docs checks in a repo | `/agentic-engineering:docs-parity docs-init` | person |

### system-map

`@system` annotations in the code become a committed map that is checked against the imports and drawn as a frame on a Miro board, with a lint before publishing and a live check after.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| give a repo a system map generated from its code | `/agentic-engineering:system-map diagrams-init` | person |
| bring the map and its board level with a code change | `/agentic-engineering:system-map diagrams-sync` | agent |
| draw or update a diagram on Miro | `/agentic-engineering:system-map miro-board` | agent |
| set up the browser the live Miro check drives | `/agentic-engineering:system-map browser-setup` | person |

### picture-this

From a description or a feature in a codebase it finds the lens, models the subject, drafts three views, refines one, and delivers a React component plus stills for a README.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| turn a system, a mechanism, or an idea into a figure | `/agentic-engineering:picture-this visualize` | agent |
| retake a figure's stills, strip, or GIF for a README | `/agentic-engineering:picture-this export-stills` | agent |

### perceptual-loop

The session writes down what will prove a change, renders a few reproducible shots before and after, gates the numbers against the last accepted run, and looks at the picture before calling it done. Questions of taste wait for the person on one review page.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| start any change to how something looks, moves, or sounds | `/agentic-engineering:perceptual-loop` | agent |
| set a project up so it can render a shot on command | `/agentic-engineering:perceptual-loop shot-harness` | person |
| check an animation, a transition, or a clip | `/agentic-engineering:perceptual-loop check-motion` | agent |
| check a sound, or a sound against its picture | `/agentic-engineering:perceptual-loop check-audio` | agent |

### write-like-me

A calibrated profile of how the person writes, applied to prose a human will read, with hooks that learn from style feedback.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| build or rebuild the voice profile | `/agentic-engineering:write-like-me calibrate` | person |
| draft something in their voice | `/agentic-engineering:write-like-me` | agent |
| check a draft for AI-writing tells | `/agentic-engineering:write-like-me audit` | agent |
| see or undo what the learning loop changed | `/agentic-engineering:write-like-me review` | person |

### workflow-studio

A node editor in the browser for dynamic workflows, and the rules for writing the same scripts and graphs by hand.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| open the visual editor | `/agentic-engineering:workflow-studio` | agent |
| write or change a workflow script or its graph directly | `/agentic-engineering:workflow-studio author-workflow` | agent |

### plugin-workbench

One rubric serves all of it: a new plugin is scaffolded against it, as a skill per job or as areas with routes and one skill to type; an existing one is scored into a scorecard with a verdict; and the fixes are applied in the order of the points each is worth.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| make a new plugin, or wrap skills and scripts they already have | `/agentic-engineering:plugin-workbench create-plugin` | agent |
| raise an existing plugin's score | `/agentic-engineering:plugin-workbench improve-plugin` | agent |
| score a plugin and get a scorecard with a verdict | `/agentic-engineering:plugin-workbench evaluate-plugin` | person |
| reinstall a marketplace checkout from the working tree | `/agentic-engineering:plugin-workbench refresh-marketplace` | person |

### context-doctor

It reads a session's transcript back: each hook's output and who saw it, the skill listing, the rule files, the size of every request, and what each compaction kept or lost. Then it names what went wrong, with the fix for each.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| find out why a session ignored a rule or forgot its instructions | `/agentic-engineering:context-doctor diagnose` | agent |
| see what entered an agent's context, and from which area | `/agentic-engineering:context-doctor lens` | agent |

<!-- end of the generated areas section -->
