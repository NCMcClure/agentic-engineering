---
name: perceptual-loop
description: "Use at the start of work judged by eye or ear: a render, an image, an animation, or a sound. Routes are its arguments, not skills: define-success (about to start, or nothing says what will prove it); iterate-shots (a change is being made and checked: a few proving shots); judge-and-queue (a difference needs a verdict, or taste waits for the owner); probe-the-source (a colour, shape, or timing differs and the cause is unknown); calibrate-gate (a gate fails on something untouched, or numbers wobble); check-motion (what a still cannot show: animation, smoothness, a clip); check-audio (sound is produced or changed, or must stay in sync); shot-harness (no .agents/perceptual/ folder, or no shot renders on command)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# perceptual-loop

Work judged by looking or listening fails in one particular way with an agent: it cannot tell whether a change got closer, so it stops at the first plausible picture or asks a person after every change. This area closes that loop. The result becomes **reproducible** (a shot), **measured** (metrics against a reference), **gated** (a baseline with measured tolerances), **looked at** (the pictures, opened with your own vision), and **judged** by the right party (the agent for defects, the owner for taste, in batches).

Read `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/doctrine.md` once per session before any look work: nine short rules. The two broken most often:

- **A metric that moved is not a verdict.** Look at the picture and classify the difference.
- **The smallest run that answers the question.** The few proving shots per iteration, never the suite.

The words (shot, source, pass, region, gate, verdict, group, probe) and every file's shape are defined once in `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/contract.md`. Use those words in plans, briefs, and reports.

The doctrine and the words are what every route shares. The steps, the commands, and where the owner is asked are in each route's own file, so read your route before you act or ask. Three more things hold across them:

- **No pixel-aligned reference** (a generated image, a restyle, a prompt as the reference): the pixel metrics do not apply between candidate and reference. Gate the candidate against its own earlier runs of the same seed, and queue the look itself for the owner.
- **Look work handed to other sessions** carries `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/agent-brief.md` in every child's brief, and a render only one session may run at a time goes under `/agentic-engineering:agent-works resource-locks`.
- **An owed full run or a stale baseline** goes on the board, `/agentic-engineering:agent-works board`, where the next session finds it.

Two optional measures see what pixels cannot: `pl.mjs semantic` (how alike two pictures are, or a picture and a description) and `pl.mjs keypoints` (a character's joints). Each needs Python with its packages, and `node "${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/scripts/pl.mjs" semantic --help` says what it found on this machine. Both are models with blind spots: signals to gate a candidate against its own earlier run, never verdicts. Where neither is installed, say so in the report instead of claiming the check.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `define-success`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `define-success` | about to start, or nothing says what will prove it | Use before changing how something looks, moves, or sounds, or when a brief only says make it look right. | `<task in a sentence>` | agent |
| `iterate-shots` | a change is being made and checked: a few proving shots | Use for every change and check on a picture or render, and when tempted to run the whole suite: a few proving shots, before and after, the gate. | `<shot> [<shot> <shot>] \| --group <g> --match <glob>` | agent |
| `judge-and-queue` | a difference needs a verdict, or taste waits for the owner | Use when a difference in a picture needs a verdict, a finished look change needs a blind second look, or taste questions wait for the owner: one review page. |  | agent |
| `probe-the-source` | a colour, shape, or timing differs and the cause is unknown | Use when a colour, brightness, shape, or timing differs from the reference and the cause is unknown, or before implementing a rule guessed from pictures. |  | agent |
| `calibrate-gate` | a gate fails on something untouched, or numbers wobble | Use when a perceptual gate fails on something untouched, numbers wobble between identical runs, or a baseline is about to be accepted. |  | agent |
| `check-motion` | what a still cannot show: animation, smoothness, a clip | Use for animation, transitions, smoothness, latency, or any clip, where a still cannot show it. |  | agent |
| `check-audio` | sound is produced or changed, or must stay in sync | Use when a task produces or changes sound, or sound must stay in sync with a picture. |  | agent |
| `shot-harness` | no .agents/perceptual/ folder, or no shot renders on command | Use to set a project up for perceptual checks: the state folder, the render commands, shots, helper passes, groups, and the render budget. | `[what the project renders, and what the reference is]` | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
