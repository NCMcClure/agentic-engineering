---
name: define-success
description: "Success definition before perceptual work starts. Use before changing how something looks, moves or sounds, or when a brief says 'make it look right'."
argument-hint: "<task in a sentence>"
---

# define-success

Most wasted iterations start without an answer to "what will prove this change?". This skill produces that answer as
a short file an agent can act on, **before** any change is made. It never sets a target against the reference
(doctrine rule 5: `${CLAUDE_PLUGIN_ROOT}/core/references/doctrine.md`).

## Step 1 — Triage: can it be measured?

Answer each line in one sentence. A "no" is not a stop: it names the harness to build first.

| Question | If no |
|---|---|
| Can the result be produced **on command**, without a person clicking? | Build the capture path first (`build-harness` (`${CLAUDE_PLUGIN_ROOT}/skills/build-harness/SKILL.md`)): a script, a headless mode, a replay. |
| Is it **deterministic** (same input → same output)? | Find the source of variation (time, randomness, async load, temporal filters) and pin it: fixed seed, fixed clock, settle frames, an average of the last N frames. |
| Is there a **reference** for the same instant? | Name the nearest: another renderer, last release, a design mock, a recording, a text description (then `semantic.py` gives similarity, not alignment). |
| Is the reference **pixel-aligned** with the candidate (same camera, same moment)? | Use region metrics from a mask or boxes, semantic similarity, keypoints or flow; say alignment is absent. |
| Does the result depend on **history** (motion, trails, adaptation, audio)? | A still cannot show it: plan a sweep or a recording (`check-motion`, `check-audio`) and make accumulated state settle in stills. |
| Can it be checked **without hardware or a person** (a headset, a wheel, a speaker)? | Write the synthetic stand-in (an emulated device, a mock sink writing to a file) and list what only the owner can validate. |

*Done when: every row has an answer and each "no" names what will be built or what is left to the owner.*

## Step 2 — Observables

List what a correct result **is**, as things one could point at. Not "looks good": "the lamp is lit", "the banner
shows the right texture", "no near-black faces in sunlit foliage", "the display reads the stream's speed", "the
transition has no step larger than the slope explains". For each observable give:

- the **source of truth** it is right against (the asset's values, the spec, the stream, a measured rule), not the
  reference picture;
- the **evidence** that shows it: a shot and a region, a probe's value, a sweep's number, a crop;
- the **check**: a metric to gate on (`region.<name>.edgeF1`, a step bound, a pitch error), or "eyes" when only
  looking decides.

Split the list in two: **the agent decides** (defects: missing, wrong, black, blown out, artefact, unstable) and
**the owner decides** (taste: how bright, how much, which of two plausible looks).

*Done when: every observable has a source of truth, an evidence line and a check, and sits in one of the two lists.*

## Step 3 — The proving shots

Pick the **few shots that show the thing** for iteration (doctrine rule 6), the **group** that shows it on other content, and say
whether the finished work justifies a full run (it does only when the change can reach everything, e.g. a shared
material or a post-process). If no existing shot shows it, the first task is to add one (step 5 of that same file).

`uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/groups.py" list` shows the groups;
`… groups.py show <group> --match '<glob>'` narrows one.

*Done when: the iteration shots are named, exist (or their creation is the first task), and a person reading their
names can tell what they show.*

## Step 4 — Write it down

Create the file from the plugin's template and fill in its six parts (Triage, Observables, Proving shots, Not a
goal, Unknowns, Left to the owner), adding none:

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/init.py" new-success "<task in a few words>"
```

Keep "Not a goal" honest: it is what stops an agent from chasing the reference's own flaws.

*Done when: the file exists, has all six parts, sets no numeric target against the reference, and the agent that
will do the work (you or a sub-agent) has it as the first thing to read.*
