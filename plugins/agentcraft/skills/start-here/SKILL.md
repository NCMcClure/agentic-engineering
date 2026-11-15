---
name: start-here
description: "Use when a person asks what the agentic-engineering plugins offer, which one does a job, or how to begin with them. An agent with a task calls the skill whose plugin fits (agent-works, agentic-teamwork, but-first-planning, code-diet, codebase-optimizer, docs-parity, perceptual-loop, picture-this, plugin-workbench, system-map, workflow-studio, write-like-me) and does not come here first; ordinary work none of them covers needs no skill, this one included. With a person it asks which areas they want, explains each, and hands off to the skill that does the work. With the task as its argument, or with nobody to ask, it asks nothing and names the area and skill that fit."
argument-hint: "[the task, in a sentence]"
---

# start-here

The agentic-engineering plugins hold twelve areas and more skills than anyone
should have to remember, and a job does not say which one it needs. This is
the one way in for a person: it finds out what is wanted, says what each area
is for, and hands off to the skill that does the work. It routes and
explains, and does none of the work itself.

An agent that already knows its area does not need this skill: it calls the
skill by its address.

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

1. **Ask which areas they want to use**, once, in one call. Each row group of
   the area table is one multi-select question: the group's title is the
   question, the text in its code span is the question's short label, and its
   options are that group's areas in order (the area's name, with its "A
   person picks it to" text as what the option means). The last question
   takes one more option: "Learn more about the areas and their skills". If
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
   that one only. Say the address first, as the table writes it, so they can
   ask for it by name next time: "this is `<address>`". Then hand off (below),
   with what they said about the job as its arguments. For every other area
   they chose, name its address and what it will do, one line each, and say
   they can ask for it when this one is done. One run of this skill makes one
   hand-off: the work it starts is theirs to finish before the next begins.

### Learn more

Walk through one group at a time, then one area at a time: what the area is
for, then each row of its table in a line, in plain words, saying of a row
marked `person` that it runs only when they type it. The tables here list a
few skills per area; the session's skill listing holds every skill of an
installed plugin, under `<plugin>:`. Stop after each group and ask whether to
go on, say more about one area, or start using something. When they pick
something to use, go to step 3 for that area.

How a plugin is installed and updated is not in these tables: that is
`/plugin install <plugin>@agentic-engineering`, and the marketplace's README.

## Direct: arguments, or nobody to ask

Ask nothing, of anyone, in any form. The task is the arguments; with no
arguments, it is the task this session was given.

1. If the task is a question about the areas or skills themselves (what is
   there, what one does, whether one exists for a job), it is not a job to
   hand off: answer from the tables below in a few lines, naming the address
   of each skill the answer mentions, and stop.
2. Otherwise find the area whose row fits the task, then the row of its "They
   want to" table that fits.
3. Where an area fits and none of its rows does, look in the session's skill
   listing for a skill of that plugin whose name fits, and take that.
4. Say in one line which area and skill fit, why, and the address. Then hand
   off, with the task as the arguments.
5. When none fits, say so plainly: none of these plugins covers this task.
   Name the nearest one only if it is close, with what it would leave
   uncovered. Never stretch a skill over a job it was not written for. This
   skill ends there, and the task is still the session's to do, without one
   of these plugins.

## Handing off

An address in the tables is how its skill is reached, and the "Starts it"
column says who may start it.

- **`/<plugin>:<skill>` with `agent`:** invoke the skill `<plugin>:<skill>`
  with the host's skill tool, with the task as its arguments.
- **A row that says `person`** is the person's to start, never an agent's: the
  host refuses a call on it, so do not try one, and do not do its work
  another way.
  - A person is in the session: give them the address to type, with what to
    put after it, and stop there for this area.
  - Nobody can answer: say that it needs a person, name the address for them,
    and take nothing else on in its place.
- **A plugin that is not installed** has no entry under `<plugin>:` in the
  session's skill listing. Say so, give
  `/plugin install <plugin>@agentic-engineering`, and stop there for it.

Once a hand-off is made, the skill it reached owns the work and this one has
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
| Make plugins (`Plugins`) | `plugin-workbench` | make, score, or fix a plugin or its skills |

### but-first-planning

Three phases, each leaving files under `.agents/plan/`: write and sharpen a spec, decompose it into a backlog, then build that backlog one issue at a time, test-first. `spec-init` scaffolds the workspace the first time.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| be questioned on a goal until nothing about it is left unsaid | `/agentcraft:but-first-planning grill` | agent |
| write or extend the spec for a project or a feature | `/agentcraft:but-first-planning spec-write` | agent |
| break a finished spec into epics, sprints, and issues | `/agentcraft:but-first-planning plan-decompose` | agent |
| find the next unblocked issue of the plan | `/agentcraft:but-first-planning build-next-issue` | agent |

### agent-works

The session becomes the orchestrator: it turns a goal into cards on a kanban board, asks before starting anything, runs each card as a child session in its own worktree, and reviews what comes back. It also keeps a repo's agent-facing files in one place under `.agents/`.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| build a goal bigger than one change, or resume a round | `/agentcraft:agent-works orchestrate` | agent |
| see what is on the board, add to it, or move a card | `/agentcraft:agent-works board` | agent |
| set a repository up for agent work | `/agentcraft:agent-works setup` | person |
| find out why agent files have bloated, or what the machine lacks | `/agentcraft:agent-works doctor` | agent |

### agentic-teamwork

Most of it runs unasked: hooks judge commits and pushes against the team's git conventions. What a person starts by name is the setup, the audit, and the two ends of landing work.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| put a new repo on the team conventions before any code is written | `/agentic-teamwork:bootstrap` | person |
| check the repo against the conventions and repair what drifted | `/agentic-teamwork:audit-project` | agent |
| commit the work in hand and open its pull or merge request | `/agentic-teamwork:ship` | agent |
| merge a reviewed request once its checks are green | `/agentic-teamwork:land` | agent |

### code-diet

On any coding task the agent takes the simplest rung that works, checks what already exists before building, and marks what it defers as debt. A person asks for the review or the debt inventory.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| hunt over-engineering in the working diff before a request | `/code-diet:review-diet` | agent |
| check what already exists before building something | `/code-diet:reuse-first` | agent |
| list every deferred shortcut and whether it still holds | `/code-diet:debt` | agent |
| note what this work built that another project could use | `/code-diet:capture-reusable` | agent |

### codebase-optimizer

It works in stages on a branch, each one checked by the repo's own tests and reverted when they go red: organize the tree, split the god-files, deepen shallow modules.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| the whole sweep, stage by stage | `/codebase-optimizer:optimize-codebase` | agent |
| reorganize a sprawling file tree and nothing else | `/codebase-optimizer:codebase-organizer` | agent |
| find shallow modules and leaky seams and nothing else | `/codebase-optimizer:improve-codebase-architecture` | agent |

### docs-parity

Pages, screenshots, and the nav move in the same change as the code they describe; a Stop check and CI say when they did not.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| bring the docs level with a change before it is committed | `/docs-parity:docs-sync` | agent |
| find out whether the whole docs set is current | `/docs-parity:docs-audit` | agent |
| cut a README down to what a newcomer needs | `/docs-parity:readme` | agent |
| adopt the docs checks in a repo | `/docs-parity:docs-init` | person |

### system-map

`@system` annotations in the code become a committed map that is checked against the imports and drawn as a frame on a Miro board, with a lint before publishing and a live check after.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| give a repo a system map generated from its code | `/system-map:diagrams-init` | person |
| bring the map and its board level with a code change | `/system-map:diagrams-sync` | agent |
| draw or update a diagram on Miro | `/system-map:miro-board` | agent |
| set up the browser the live Miro check drives | `/system-map:browser-setup` | person |

### picture-this

From a description or a feature in a codebase it finds the lens, models the subject, drafts three views, refines one, and delivers a React component plus stills for a README.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| turn a system, a mechanism, or an idea into a figure | `/picture-this:visualize` | agent |
| retake a figure's stills, strip, or GIF for a README | `/picture-this:export-stills` | agent |

### perceptual-loop

The session writes down what will prove a change, renders a few reproducible shots before and after, gates the numbers against the last accepted run, and looks at the picture before calling it done. Questions of taste wait for the person on one review page.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| start any change to how something looks, moves, or sounds | `/perceptual-loop:perceptual-loop` | agent |
| set a project up so it can render a shot on command | `/perceptual-loop:shot-harness` | person |
| check an animation, a transition, or a clip | `/perceptual-loop:check-motion` | agent |
| check a sound, or a sound against its picture | `/perceptual-loop:check-audio` | agent |

### write-like-me

A calibrated profile of how the person writes, applied to prose a human will read, with hooks that learn from style feedback.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| build or rebuild the voice profile | `/write-like-me:calibrate` | person |
| draft something in their voice | `/write-like-me:write-like-me` | agent |
| check a draft for AI-writing tells | `/write-like-me:audit` | agent |
| see or undo what the learning loop changed | `/write-like-me:review` | person |

### workflow-studio

A node editor in the browser for dynamic workflows, and the rules for writing the same scripts and graphs by hand.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| open the visual editor | `/workflow-studio:workflow-studio` | agent |
| write or change a workflow script or its graph directly | `/workflow-studio:author-workflow` | agent |

### plugin-workbench

One rubric serves all of it: a new plugin is scaffolded against it, an existing one is scored into a scorecard with a verdict, and the fixes are applied in the order of the points each is worth. It also reads a session's transcript for what each plugin put in the agent's context.

| They want to | Hand off to | Starts it |
| --- | --- | --- |
| make a new plugin, or wrap skills and scripts they already have | `/plugin-workbench:create-plugin` | agent |
| raise an existing plugin's score | `/plugin-workbench:improve-plugin` | agent |
| score a plugin and get a scorecard with a verdict | `/plugin-workbench:evaluate-plugin` | person |
| see what entered an agent's context, and from which plugin | `/plugin-workbench:context-lens` | agent |

<!-- end of the generated areas section -->
