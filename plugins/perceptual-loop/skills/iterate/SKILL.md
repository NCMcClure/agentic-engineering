---
name: iterate
description: "Iteration cycle for a look change: a few proving shots, before and after, a sheet to open. Use for every change-and-check on an image or render, or when tempted to run the whole suite."
argument-hint: "<shot> [<shot> <shot>] | --group <g> --match <glob>"
---

# iterate

One command renders the chosen shots, compares them, checks them against the baseline, draws the sheet and says
where the time went. The discipline is in what you choose and what you do with the result.

## Step 1 — Choose the shots before touching anything

Take them from the task's success file (`.perceptual-loop/success/<task>.md`); if there is none, run
`define-success` first. As few shots as **show the thing** (doctrine rule 6; the config's `budget.free` is the ceiling). Say them out
loud in your plan.

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/iterate.py" <shot> [<shot> <shot>] --dry-run
```

*Done when: the dry run lists the proving shots, within the budget, and the command it would run.*

## Step 2 — Change one thing, then run

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/iterate.py" <shot> [<shot> <shot>]
```

It prints, per shot, the headline numbers **before → after** against the baseline, the gate for those shots, the
seconds spent in render / compare / sheets, and the pair sheet's path. It never writes the baseline.

- Render only what changed: if the project's renderer can skip helper passes for look-only work, do so; after a
  change to geometry, camera or import, render every pass.
- `--skip-render` compares what is already there (after editing only the compare options, or to redraw a sheet).

*Done when: the run exited and you have the before → after lines and at least one sheet path.*

## Step 3 — Look

Open the pair sheet with your own vision (the Read tool on the PNG). Then write two sentences: **what changed in
the picture**, and **whether that is what you meant**. Only then read the numbers. If the sheet is too coarse for
the detail in question, crop:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sheet.py" crop <shot> --box x0,y0,x1,y1 --zoom 3
```

Numbers that moved where you changed nothing are either noise or an effect you did not intend: render that shot
once more before believing either (`calibrate-gate` if it keeps happening).

*Done when: you have stated the visible change in words and it matches, or you know what to change next.*

## Step 4 — Classify what is left

For each remaining visible difference from the reference give a verdict from the doctrine's table
(`${CLAUDE_PLUGIN_ROOT}/core/references/doctrine.md` rule 2). Work only on `wrong` and `less-plausible`. A
difference you cannot classify by looking goes to `probe-the-source`; one that is a matter of taste goes to
`judge-and-queue`. Do not tune a constant to move a number towards the reference.

*Done when: every difference you can see in the proving shots has a verdict and a next action or none.*

## Step 5 — Widen once, then finish once

When the change works on its own shots:

```
PL_RUN="verify: <what already works; what this run checks>" \
  uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/iterate.py" --group <topic-or-smoke>
```

(PowerShell: `$env:PL_RUN = "verify: …";` in front.) Then, **once, when the work is finished**, the full run if the
success file says the change can reach everything (`PL_RUN="full: <what is finished>"` and `--all`). Accepting
the new numbers, and sorting out entries beyond tolerance in shots your work cannot have reached (noise, not
ready, stale), is `calibrate-gate` steps 3 and 4: follow them, then run `smoke` once more.

*Done when: the topical or smoke gate passed (or every entry beyond tolerance has a verdict), accepted entries are
listed by shot in your report, and the second smoke run held.*

## When the loop is slow

`uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/timing.py"` shows where iterations' time went and how many runs
went over budget. The usual fixes: fewer shots, fewer passes, one application start per run instead of per shot, a
cache hit that is being defeated (inputs rewritten each run), sheets drawn for shots nobody opens (`--no-sheets`).
