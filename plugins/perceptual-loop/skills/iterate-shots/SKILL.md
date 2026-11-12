---
name: iterate-shots
description: "Use for every change and check on a picture or render, and when tempted to run the whole suite: a few proving shots, before and after, the gate."
argument-hint: "<shot> [<shot> <shot>] | --group <g> --match <glob>"
---

# iterate-shots

One command renders the chosen shots, compares them, gates them against the baseline, draws a sheet per shot to open, and says where the time went. The discipline is in what you choose and what you do with the result.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`.

## Step 1: Choose the shots before touching anything

Take them from the task's success file (`.agents/perceptual/success/<task>.md`); when there is none, run `define-success` first. As few shots as show the thing (doctrine rule 6, `${CLAUDE_PLUGIN_ROOT}/references/doctrine.md`); the config's `budget.free` is the ceiling. Name them in your plan.

```
P iterate <shot> [<shot> <shot>] --dry-run
```

*Done when: the dry run lists the proving shots, within the budget, and the render command it would run.*

## Step 2: Change one thing, then run

```
P iterate <shot> [<shot> <shot>]
```

It prints, per shot, the headline numbers **before and after** against the baseline, the gate for exactly those shots, the seconds spent rendering, comparing, and drawing, and the shot's sheet: `runs/iterate/<shot>/sheet.<source>.png`. The sheet holds the reference, the candidate as it was before this run (kept as `runs/iterate/<shot>/before.<source>.png`), and the candidate now, and under them what this run changed, where the edges differ from the reference, and the colour difference after the exposure fit, on a fixed scale. It never writes the baseline.

- Render only what changed. When the renderer can skip helper passes for look-only work, skip them; after a change to geometry, the camera, or an import, render every pass.
- `--skip-render` compares what is already there, after changing only compare options. `--no-sheets` skips the drawing and prints the three picture paths instead.

*Done when: the run exited 0 or 1, and you have the before and after lines and the sheet's path.*

## Step 3: Look

Open the sheet with your own vision (the Read tool on the PNG). Then write two sentences: **what changed in the picture**, and **whether that is what you meant**. Only then read the numbers. When the detail is too small to judge, crop it from every source: `P sheet crop <shot> --box x0,y0,x1,y1 --zoom 3` (the box in fractions of the frame).

Numbers that moved where you changed nothing are either noise or an effect you did not intend: render that shot once more before believing either, and go to `calibrate-gate` when it keeps happening.

*Done when: you have stated the visible change in words, and it matches what you meant or you know what to change next.*

## Step 4: Classify what is left

Give each remaining visible difference from the reference a verdict from the doctrine's table (rule 2). Work only on `wrong` and `less-plausible`. A difference you cannot classify by looking needs its source probed (`probe-the-source`); a matter of taste is the owner's, queued with the three pictures and your recommendation (`judge-and-queue`). Do not tune a constant to move a number toward the reference.

*Done when: every difference you can see in the proving shots has a verdict, and a next action or none.*

## Step 5: Widen once, then finish once

When the change works on its own shots, run one group, with the reason in the command:

```
PL_RUN="verify: <what already works; what this run checks>" P iterate --group <topic-or-smoke>
```

Then, **once, when the work is finished**, the full run if the success file says the change can reach everything: `PL_RUN="full: <what is finished>" P iterate --all`. If that run cannot happen in this session, owe it where the next session finds it: a line at the top of the report, or the task board if agent-works is installed. Accepting the new numbers, and sorting out entries beyond tolerance in shots your work cannot have reached (noise, not ready, stale), is `calibrate-gate` steps 3 and 4: follow them, then run `smoke` once more.

Before you report the change as done, it gets a blind second look and its taste questions go to the owner: `judge-and-queue` steps 3 to 5.

*Done when: the topical or smoke gate passed (or every entry beyond tolerance has a verdict), the accepted entries are listed by shot in your report, and the second smoke run held.*

## When the loop is slow

`P timing` reads `.agents/perceptual/runs/timing.jsonl` (one line per run: shots, sources, the seconds spent rendering, comparing, and drawing, how many comparisons came from the cache) and the guard's `runs/budget.log`, and says where the time went and what to change. The usual fixes: fewer shots, fewer passes, one application start per run instead of per shot, a cache defeated by inputs rewritten on every run.

Before blaming the loop, rule out the machine: another session's render makes every run slow. Look at the processor and GPU load before the run, wait if another job is running, and write what you saw beside the numbers.
