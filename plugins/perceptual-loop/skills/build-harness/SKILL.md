---
name: build-harness
description: "Scaffold the capture, compare, sheet and gate harness in a project: the .perceptual-loop folder, the render commands, shots and groups."
disable-model-invocation: true
argument-hint: "[what the project renders and what the reference is]"
---

# build-harness

The loop needs one thing from a project: two commands that write a shot's outputs into its folder, one for the
**reference** and one for each **candidate**. Everything else (metrics, sheets, baseline, groups, budget) is the
plugin's. Shapes and names: `${CLAUDE_PLUGIN_ROOT}/core/references/contract.md`.

## Step 1 — Scaffold

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/init.py" --reference <id> --candidate <id> \
  --render <candidate-id>="<command with {shots}>" [--render <reference-id>="<command with {shots}>"]
```

It creates `.perceptual-loop/` (config, groups, an empty baseline, `success/`, `decisions/`, a `.gitignore` for
`shots/` and `runs/`) and never overwrites. Decide now whether shots are committed: pictures made from licensed or
third-party content stay out of the repository; point `shotsDir` at a folder outside it.

*Done when: `.perceptual-loop/config.json` exists and names the reference and every candidate.*

## Step 2 — The candidate's render command

Write (or find) the project's script that, given shot names, renders each and writes `<candidate>.png` into the
shot's folder. Recipes per kind of project (web page, game engine, CLI/TUI, generated image, audio):
read `references/capture-recipes.md` for the one that matches.

Make it **deterministic** before measuring anything; these are the usual causes of a picture that differs between
two runs of the same shot, with the fix that worked:

- **Time and randomness:** fix the clock and every seed from the shot's state.
- **Temporal filters** (anti-aliasing with history, auto-exposure, eye adaptation, motion blur, dithered
  transparency): render N warm-up frames, then write the **mean of the last M frames** as the shot.
- **Async loading:** wait for an explicit "ready" from the application (assets built, fonts loaded, network idle),
  never a fixed sleep. The first render after an import or a cold cache is suspect: gate on the second.
- **Order dependence:** a shot rendered after another on a warm scene is not quite the shot rendered fresh. Render
  the baseline in one fixed order (by name), and iterate in that order.
- **History in the picture** (trails, accumulated effects): make it settle at once when time stands still, so the
  shot is a function of its instant.

Then prove it: render the same few shots twice and compare the two runs against each other; the spread is what
`calibrate-gate` will turn into tolerances.

*Done when: `iterate.py <shot> --dry-run` prints the command, a real run writes the picture, and `sheet.py diff <run-1 picture> <run-2 picture> --max-delta-e 0.5` exits 0 for the same shot rendered twice (or the
residual it prints is recorded as what `calibrate-gate` must measure).*

## Step 3 — The reference

A reference is captured **once** and kept; it is re-captured only when the reference itself must change. Its command
may be slow, need a person's session, or be a manual export: that is fine, record how in the config's `render`
entry or in `.perceptual-loop/README.md`. Each reference shot must carry the **state** that produced it (a
recording, a URL and viewport, a seed, a scene file) in `shot.json` `meta` or beside it, so a candidate can
reproduce the same instant. Keep an archive when references are replaced.

*Done when: every shot has `<reference>.png`, and its folder holds what a candidate needs to reproduce that instant.*

## Step 4 — Helper passes, where the renderer can make them

A frame-wide number hides where the difference is. Region numbers need the regions:

- **`id` pass** (best): the scene drawn in flat colours, one per kind of thing, with `ids.json` naming the colours.
  Draw it with alpha sampled the way the beauty pass samples it, or silhouettes disagree.
- **`mask` pass:** the subject white on black: gives `subject` and `background`.
- **Boxes** in `shot.json` `regions`: the fallback for a UI or a fixed camera.
- **`albedo` pass:** the surface before light. It is what settles "is the colour wrong or is the light different?"
  (`probe-the-source`).

Set `regionsFrom` to the one source whose regions every run uses, so numbers stay comparable between runs.

*Done when: `compare.py` on one shot prints region rows, or the config records that no region source exists.*

## Step 5 — Shots, names and groups

Name shots `<content>__<place-or-state>__<view>` (double underscores between parts), so patterns select them.
Put what distinguishes them in `shot.json` `meta` (content ids, condition, view). Then:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/init.py" new-shot <name> --meta k=v … --from-image <source>=<path>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/groups.py" suggest-smoke --by <meta-key>,<meta-key>
```

Write the suggested `smoke` group (every content pair and condition once) and topical groups as name patterns in
`groups.json`: patterns, not lists, so new shots join by their names.

*Done when: `groups.py list` shows `smoke` with a count, and every topic the work touches has a group.*

## Step 6 — Budget and scarce applications (optional, per project)

In `config.json`, `budget.match` lists patterns of the commands that render (the hook then refuses a run above
`budget.free` shots without a stated reason). Leave it empty until a slow render makes it worth it.

An application only one agent may run at a time (the renderer, an editor, the GPU for a timing) needs a lock.
Locks, leases and the machine's load are agent-works' job (`agent-works:coordinate` / `aw lock`, `aw lease`,
`aw sys`). Without it: nothing enforces the turn, so run one agent at a time on that application and say so in
every brief (`orchestrate-agents`).

*Done when: `budget.match` in `config.json` is filled in or deliberately empty, each scarce application is
declared to agent-works or named in the brief as one-at-a-time, and a first
`iterate.py` run on one shot exits 0 or 1 and prints the pair sheet's path. Next: `calibrate-gate`
to give the baseline its tolerances, then `iterate`.*
