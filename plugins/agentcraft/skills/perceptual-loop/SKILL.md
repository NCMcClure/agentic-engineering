---
name: perceptual-loop
description: "Routes are its arguments, not skills: calibrate-gate (); check-audio (); check-motion (); define-success (); iterate-shots (); judge-and-queue (); probe-the-source (); shot-harness ()."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# perceptual-loop

Work judged by looking or listening fails in one particular way with an agent: it cannot tell whether a change got closer, so it stops at the first plausible picture or asks a person after every change. This plugin closes that loop. The result becomes **reproducible** (a shot), **measured** (metrics against a reference), **gated** (a baseline with measured tolerances), **looked at** (the pictures, opened with your own vision), and **judged** by the right party (the agent for defects, the owner for taste, in batches).

Read `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/doctrine.md` once per session before any look work: nine short rules. The two broken most often:

- **A metric that moved is not a verdict.** Look at the picture and classify the difference.
- **The smallest run that answers the question.** The few proving shots per iteration, never the suite.

The words (shot, source, pass, region, gate, verdict, group, probe) and every file's shape are defined once in `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/contract.md`. Use those words in plans, briefs, and reports.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `calibrate-gate` |  | Use when a perceptual gate fails on something untouched, numbers wobble between identical runs, or a baseline is about to be accepted. |  | agent |
| `check-audio` |  | Use when a task produces or changes sound, or sound must stay in sync with a picture. |  | agent |
| `check-motion` |  | Use for animation, transitions, smoothness, latency, or any clip, where a still cannot show it. |  | agent |
| `define-success` |  | Use before changing how something looks, moves, or sounds, or when a brief only says make it look right. | `<task in a sentence>` | agent |
| `iterate-shots` |  | Use for every change and check on a picture or render, and when tempted to run the whole suite: a few proving shots, before and after, the gate. | `<shot> [<shot> <shot>] \| --group <g> --match <glob>` | agent |
| `judge-and-queue` |  | Use when a difference in a picture needs a verdict, a finished look change needs a blind second look, or taste questions wait for the owner: one review page. |  | agent |
| `probe-the-source` |  | Use when a colour, brightness, shape, or timing differs from the reference and the cause is unknown, or before implementing a rule guessed from pictures. |  | agent |
| `shot-harness` |  | Use to set a project up for perceptual checks: the state folder, the render commands, shots, helper passes, groups, and the render budget. | `[what the project renders, and what the reference is]` | person |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->

| The situation | Skill |
| --- | --- |
| A perceptual task is about to start, or "how will we know it worked?" has no answer yet | `define-success` |
| The project has no `.agents/perceptual/` folder, or cannot render a shot on command yet | `shot-harness` |
| A change is being made and checked | `iterate-shots` |
| A gate fails on something untouched, numbers wobble between runs, or a baseline is about to be accepted | `calibrate-gate` |
| A colour, brightness, shape, or timing differs and the cause is unknown, or a rule is about to be fitted to pictures | `probe-the-source` |
| A difference needs a verdict, a finished change needs a blind second look, or taste questions wait for the owner | `judge-and-queue` |
| Anything a still cannot show: an animation, a transition, smoothness, latency, a clip against a clip | `check-motion` |
| A task produces or changes sound, or sound must stay in sync with a picture | `check-audio` |

`shot-harness` is a set-up skill the person starts (`/agentcraft:perceptual-loop shot-harness`). When you need it mid-task, read `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/routes/shot-harness/ROUTE.md` and follow it.

**No pixel-aligned reference** (a generated image, a restyle, a prompt as the reference): the pixel metrics here do not apply between candidate and reference. Gate the candidate against its own earlier runs of the same seed, and queue the look itself for the owner.

Two optional extras measure what pixels cannot. Each hands over to a Python script and needs Python with its packages; `--help` on either says what it needs and what it found on this machine, and every other command works without them:

- `node "${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/scripts/pl.mjs" semantic`: how alike two pictures are, or a picture and a description (CLIP cosine, LPIPS), to gate and rank with. Needs torch.
- `node "${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/scripts/pl.mjs" keypoints`: a character's joints, and whether two pictures or clips agree about them. Needs mediapipe.

Both are models with blind spots (counting, text, occlusion, left and right): signals to gate a candidate against its own earlier run, never verdicts. Where neither is installed, say so in the report rather than claim the check.

## Working beside other sessions

- **A session handing look work to other agents** appends `${CLAUDE_PLUGIN_ROOT}/skills/perceptual-loop/references/agent-brief.md` to every child's brief: how to judge, how much to render, and what a report about pictures holds.
- **Renders only one session may run at a time** (an editor, a GPU timing, a simulator): say in every brief that the renderer is one session at a time. If agent-works is installed, run them under its resource lock; the render guard judges a wrapped command as the command inside it.
- **An owed full run or a stale baseline** goes where the next session finds it: a line at the top of the report, or the task board if agent-works is installed.
- **A ruling with reach** (the owner decides how every sky should look) becomes a line in the root `AGENTS.md`, or a decision record in the plan if but-first-planning is installed.
- **What must be probed before a rule is implemented** goes in the success file's "Unknowns", where the next session finds it.
- **The machine's load**: before a timing or a calibration, look at the processor and GPU load yourself (the process list, `nvidia-smi`), wait if another job is running, and write what you saw beside the numbers.

## The loop

Define, render the proving shots, look, classify, widen once, accept, queue. The steps and their commands are `iterate-shots`'s, and only there.

*Done when: the skill for the situation is loaded and the doctrine has been read this session.*
