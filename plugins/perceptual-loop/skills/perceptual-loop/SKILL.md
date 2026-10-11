---
name: perceptual-loop
description: "Measured loop for work judged by eye or ear. Use at the start of perceptual work, or when the output has no pixel-aligned reference (a generated image, a prompt as the reference)."
---

# perceptual-loop

Work that is judged by looking or listening fails in a particular way with agents: the agent cannot tell whether it
got closer, so it either stops early or asks a person after every change. This plugin closes that loop. The agent
makes the result **reproducible** (a shot), **measurable** (metrics against a reference), **gated** (a baseline with
measured tolerances), **visible** (sheets it opens with its own vision) and **judged** by the right party (the agent
for defects, the owner for taste, in batches).

Read `${CLAUDE_PLUGIN_ROOT}/core/references/doctrine.md` once per session before any look work: nine short rules,
each the lesson of a real failure. The two that are broken most often:

- **A metric that moved is not a verdict.** Look at the picture and classify the difference.
- **The smallest run that answers the question.** The few proving shots per iteration, never the suite.

## Route

| The situation | Skill |
|---|---|
| A perceptual task is about to start, or "how will we know it worked?" has no answer yet | `define-success` |
| The project has no `.perceptual-loop/` folder, or cannot yet render a shot on command | `build-harness` |
| A change is being made and checked | `iterate` |
| A gate fails on something untouched, numbers wobble between runs, or a baseline is being accepted | `calibrate-gate` |
| A difference from the reference needs explaining, or a rule is being guessed from pictures | `probe-the-source` |
| A difference needs a verdict, a comparison for the owner, or open look questions are piling up | `judge-and-queue` |
| The result changes over time: animation, transitions, smoothness, latency, a clip | `check-motion` |
| The result is sound, or sound must stay in sync with a picture | `check-audio` |
| Several agents work on looks at once: who proves what, how much each renders, who opens the pictures | `orchestrate-agents` |

**No pixel-aligned reference** (a generated image, a restyle, a prompt as the reference): pixel metrics do not
apply. `uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/semantic.py" --help` gives image–image and image–text
similarity to gate and rank with, and `keypoints.py` checks a character's pose. Both are models with blind spots
(counting, text, fine geometry, left and right): a signal between runs, never a verdict.

`build-harness` and `orchestrate-agents` are set-up skills the user starts (`/perceptual-loop:build-harness`); when
you need one mid-task, read `${CLAUDE_PLUGIN_ROOT}/skills/<name>/SKILL.md` and follow it.

Sharing a codebase and a machine between agents (tasks, briefs, worktrees, locks on a scarce application, the
machine's load, the project's memory) is agent-works' job (`agent-works:orchestrate` / `agent-works:coordinate`).
Without it: one agent at a time on the application that renders, by hand.

The words (shot, source, pass, region, gate, verdict, group, probe, sheet) and every file's shape are defined once in
`${CLAUDE_PLUGIN_ROOT}/core/references/contract.md`. Use those words in plans, briefs and reports.

## The loop

Define, render the proving shots, look, classify, widen once, accept, queue: the steps and their commands are the
`iterate` skill's, and only there.

*Done when: the right skill for the situation is loaded and the doctrine has been read this session.*
