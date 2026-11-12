---
name: perceptual-loop
description: "Use at the start of work judged by eye or ear: a render, an image, an animation, or a sound. Routes to the skill for each step."
---

# perceptual-loop

Work judged by looking or listening fails in one particular way with an agent: it cannot tell whether a change got closer, so it stops at the first plausible picture or asks a person after every change. This plugin closes that loop. The result becomes **reproducible** (a shot), **measured** (metrics against a reference), **gated** (a baseline with measured tolerances), **looked at** (the pictures, opened with your own vision), and **judged** by the right party (the agent for defects, the owner for taste, in batches).

Read `${CLAUDE_PLUGIN_ROOT}/references/doctrine.md` once per session before any look work: nine short rules. The two broken most often:

- **A metric that moved is not a verdict.** Look at the picture and classify the difference.
- **The smallest run that answers the question.** The few proving shots per iteration, never the suite.

The words (shot, source, pass, region, gate, verdict, group, probe) and every file's shape are defined once in `${CLAUDE_PLUGIN_ROOT}/references/contract.md`. Use those words in plans, briefs, and reports.

## Route

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

`shot-harness` is a set-up skill the person starts (`/perceptual-loop:shot-harness`). When you need it mid-task, read `${CLAUDE_PLUGIN_ROOT}/skills/shot-harness/SKILL.md` and follow it.

**No pixel-aligned reference** (a generated image, a restyle, a prompt as the reference): the pixel metrics here do not apply between candidate and reference. Gate the candidate against its own earlier runs of the same seed, and queue the look itself for the owner.

Two optional extras measure what pixels cannot. Each hands over to a Python script and needs Python with its packages; `--help` on either says what it needs and what it found on this machine, and every other command works without them:

- `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" semantic`: how alike two pictures are, or a picture and a description (CLIP cosine, LPIPS), to gate and rank with. Needs torch.
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" keypoints`: a character's joints, and whether two pictures or clips agree about them. Needs mediapipe.

Both are models with blind spots (counting, text, occlusion, left and right): signals to gate a candidate against its own earlier run, never verdicts. Where neither is installed, say so in the report rather than claim the check.

## Working beside other sessions

- **A session handing look work to other agents** appends `${CLAUDE_PLUGIN_ROOT}/references/agent-brief.md` to every child's brief: how to judge, how much to render, and what a report about pictures holds.
- **Renders only one session may run at a time** (an editor, a GPU timing, a simulator): say in every brief that the renderer is one session at a time. If agent-works is installed, run them under its resource lock; the render guard judges a wrapped command as the command inside it.
- **An owed full run or a stale baseline** goes where the next session finds it: a line at the top of the report, or the task board if agent-works is installed.
- **A ruling with reach** (the owner decides how every sky should look) becomes a line in the root `AGENTS.md`, or a decision record in the plan if but-first-planning is installed.
- **What must be probed before a rule is implemented** goes in the success file's "Unknowns", where the next session finds it.
- **The machine's load**: before a timing or a calibration, look at the processor and GPU load yourself (the process list, `nvidia-smi`), wait if another job is running, and write what you saw beside the numbers.

## The loop

Define, render the proving shots, look, classify, widen once, accept, queue. The steps and their commands are `iterate-shots`'s, and only there.

*Done when: the skill for the situation is loaded and the doctrine has been read this session.*
