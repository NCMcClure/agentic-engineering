---
name: design
description: "Use for work judged by eye or ear (a render, an image, an animation, a sound), and for a web front end held to the person's design system. Look work: what will prove it is said before the first change, each change is checked by measured shots, defects are fixed, and taste is left to the owner. A front end: one system for every repo, a pin, and a check that fails on anything off-system. Routes are its arguments, not skills: define-success (about to start, or nothing says what will prove it); iterate (a change is being made and checked: a few proving shots); judge (a difference needs a verdict, or taste waits for the owner); probe (a colour, shape, or timing differs and the cause is unknown); calibrate (a gate fails on something untouched, or numbers wobble); motion (what a still cannot show: animation, smoothness, a clip); audio (sound is produced or changed, or must stay in sync); shot-harness (no .agents/perceptual/ folder, or no shot renders on command); system (declare or see the one design system your front ends use); adopt (a web front end is not yet on the design system); check (front-end work in a pinned repo, or the design check fails)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# design

Two halves: work judged by eye or ear, and a web front end held to the person's design system. The first is below; the second is under **A design system**.

Work judged by looking or listening fails in one particular way with an agent: it cannot tell whether a change got closer, so it stops at the first plausible picture or asks a person after every change. This area closes that loop. The result becomes **reproducible** (a shot), **measured** (metrics against a reference), **gated** (a baseline with measured tolerances), **looked at** (the pictures, opened with your own vision), and **judged** by the right party (the agent for defects, the owner for taste, in batches).

Read `${CLAUDE_PLUGIN_ROOT}/skills/design/references/doctrine.md` once per session before any look work: nine short rules. The two broken most often:

- **A metric that moved is not a verdict.** Look at the picture and classify the difference.
- **The smallest run that answers the question.** The few proving shots per iteration, never the suite.

The words (shot, source, pass, region, gate, verdict, group, probe) and every file's shape are defined once in `${CLAUDE_PLUGIN_ROOT}/skills/design/references/contract.md`. Use those words in plans, briefs, and reports.

The doctrine and the words are what every route shares. The steps, the commands, and where the owner is asked are in each route's own file, so read your route before you act or ask. Three more things hold across them:

- **No pixel-aligned reference** (a generated image, a restyle, a prompt as the reference): the pixel metrics do not apply between candidate and reference. Gate the candidate against its own earlier runs of the same seed, and queue the look itself for the owner.
- **Look work handed to other sessions** carries `${CLAUDE_PLUGIN_ROOT}/skills/design/references/agent-brief.md` in every child's brief, and a render only one session may run at a time goes under `/agentic-engineering:agents locks`.
- **An owed full run or a stale baseline** goes on the board, `/agentic-engineering:agents board`, where the next session finds it.

Two optional measures see what pixels cannot: `pl.mjs semantic` (how alike two pictures are, or a picture and a description) and `pl.mjs keypoints` (a character's joints). Each needs Python with its packages, and `node "${CLAUDE_PLUGIN_ROOT}/skills/design/scripts/pl.mjs" semantic --help` says what it found on this machine. Both are models with blind spots: signals to gate a candidate against its own earlier run, never verdicts. Where neither is installed, say so in the report instead of claiming the check.

## A design system

A person picks one design system for all their projects, and every repo with a web front end adopts it. The plugin works with any system that describes itself in a `design-system.json` at its root (or that the person describes once, by interview); it builds none, and leaves how a page looks to the routes above.

- **The profile**, on this machine and never committed: which system, at which tag. The data directory for this area is `${CLAUDE_PLUGIN_DATA}/design`; pass it to `design.mjs` as `--data`. `system` declares it, and the person starts that route.
- **The pin**, committed by `adopt`: `.agents/design.json`, the rules copied to `.agents/rules/design.md`, and the checker at `.agents/scripts/design-check.mjs`, which runs on Node alone.
- **The check**: `check` runs it and fixes what it finds with the system's own tokens and components. A missing component is installed from the system, never hand-rolled; a new look is a variant in the system, never a restyle at a call site; an exception is an allow entry, and only on the person's yes.

In a repo with `.agents/design.json`, front-end work reads `.agents/rules/design.md` first and runs the check before it is called done.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `define-success`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `define-success` | about to start, or nothing says what will prove it | Use before changing how something looks, moves, or sounds, or when a brief only says make it look right. | `<task in a sentence>` | agent |
| `iterate` | a change is being made and checked: a few proving shots | Use for every change and check on a picture or render, and when tempted to run the whole suite: a few proving shots, before and after, the gate. | `<shot> [<shot> <shot>] \| --group <g> --match <glob>` | agent |
| `judge` | a difference needs a verdict, or taste waits for the owner | Use when a difference in a picture needs a verdict, a finished look change needs a blind second look, or taste questions wait for the owner: one review page. |  | agent |
| `probe` | a colour, shape, or timing differs and the cause is unknown | Use when a colour, brightness, shape, or timing differs from the reference and the cause is unknown, or before implementing a rule guessed from pictures. |  | agent |
| `calibrate` | a gate fails on something untouched, or numbers wobble | Use when a perceptual gate fails on something untouched, numbers wobble between identical runs, or a baseline is about to be accepted. |  | agent |
| `motion` | what a still cannot show: animation, smoothness, a clip | Use for animation, transitions, smoothness, latency, or any clip, where a still cannot show it. |  | agent |
| `audio` | sound is produced or changed, or must stay in sync | Use when a task produces or changes sound, or sound must stay in sync with a picture. |  | agent |
| `shot-harness` | no .agents/perceptual/ folder, or no shot renders on command | Use to set a project up for perceptual checks: the state folder, the render commands, shots, helper passes, groups, and the render budget. | `[what the project renders, and what the reference is]` | person |
| `system` | declare or see the one design system your front ends use | Use when the person wants to declare, change, or see the one design system all their front ends follow: where it lives, at which tag, and what it bans. | `[<local folder or owner/repo> [--ref <tag>]]` | person |
| `adopt` | a web front end is not yet on the design system | Use to put a repo's web front end on the person's design system: install the kit at the pinned tag, wire its entry CSS and root setup, commit a pin and the rules, and add the check. | `[--upgrade]` | agent |
| `check` | front-end work in a pinned repo, or the design check fails | Use before calling front-end work done in a repo with .agents/design.json, and when its design check fails: read each finding, fix it with the system's own tokens and components, install a missing component from the system, and allow an exception only on the person's yes. | `[paths...]` | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
