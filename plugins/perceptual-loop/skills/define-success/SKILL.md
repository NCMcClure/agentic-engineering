---
name: define-success
description: "Use before changing how something looks, moves, or sounds, or when a brief only says make it look right. Writes the success file naming what will prove the change."
argument-hint: "<task in a sentence>"
---

# define-success

Most wasted iterations start without an answer to "what will prove this change?". This skill writes that answer down as a short file an agent can act on, **before** any change is made. It never sets a target against the reference (doctrine rule 5, `${CLAUDE_PLUGIN_ROOT}/references/doctrine.md`).

## Step 1: Triage, can it be measured?

Answer each question in one sentence. A "no" is not a stop: it names what is built first.

| Question | If no |
| --- | --- |
| Can the result be produced **on command**, without a person clicking? | Build the capture path first (`shot-harness`, `${CLAUDE_PLUGIN_ROOT}/skills/shot-harness/SKILL.md`): a script, a headless mode, a replay. |
| Is it **deterministic** (the same input gives the same output)? | Find the source of variation (the clock, randomness, an async load, a temporal filter) and pin it: a fixed seed, a fixed clock, settle frames, the mean of the last few frames. |
| Is there a **reference** for the same instant? | Name the nearest one: another renderer, the last release, a design export, a recording, or a description (then nothing is pixel-aligned: the optional `pl.mjs semantic` gives similarity to gate and rank with, where its Python extra is installed, never alignment). |
| Is the reference **pixel-aligned** with the candidate (the same camera, the same moment)? | Use region numbers from a mask or boxes, optical flow, or the optional `semantic` and `keypoints` extras, gate the candidate against its own runs, and say that alignment is absent. |
| Does the result depend on **history** (motion, trails, adaptation, sound)? | A still cannot show it: plan a sequence, and make accumulated state settle at once in stills (doctrine rule 7). Motion is measured with `check-motion`, sound with `check-audio`. |
| Can it be checked **without hardware or a person** (a headset, a wheel, a speaker)? | Write the synthetic stand-in (an emulated device, a sink writing to a file) and list what only the owner can validate. |

*Done when: every row has an answer, and each "no" names what will be built or what is left to the owner.*

## Step 2: Observables

List what a correct result **is**, as things one can point at. Not "looks good" but "the lamp is lit", "the banner shows the right texture", "no near-black faces in sunlit foliage", "the readout shows the stream's speed". For each, give:

- the **source of truth** it is right against (the asset's values, the spec, the stream, a measured rule), never the reference picture;
- the **evidence** that shows it: a shot and a region, a probe's value, a crop;
- the **check**: a metric to gate on (`region.<name>.edgeF1`, `frame.exposureEV`), or "eyes" when only looking decides.

Split the list in two: **the agent decides** (defects: missing, wrong, crushed, blown, an artefact, unstable) and **the owner decides** (taste: how bright, how much, which of two plausible looks).

*Done when: every observable has a source of truth, an evidence line, and a check, and sits in one of the two lists.*

## Step 3: The proving shots

Pick the **few shots that show the thing** for iteration (doctrine rule 6), the **group** that shows it on other content, and say whether the finished work justifies a full run. It does only when the change can reach everything, such as a shared material or a post-process. If no shot shows the thing yet, the first task is to add one (`shot-harness` step 5).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" groups list
node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" groups show <group> --match '<glob>'
```

*Done when: the iteration shots are named, exist (or creating them is the first task), and a person reading their names can tell what they show.*

## Step 4: Write it down

Create the file from the plugin's template and fill in its six parts (Triage, Observables, Proving shots, Not a goal, Unknowns, Left to the owner), adding none:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" new-success "<task in a few words>"
```

Keep "Not a goal" honest: it is what stops an agent from chasing the reference's own flaws. Put in "Unknowns" whatever must be probed before a rule is implemented, so the next session starts from it.

*Done when: the file exists in `.agents/perceptual/success/`, has all six parts, sets no numeric target against the reference, and the agent doing the work (you, or a child session's brief) has it as the first thing to read.*
