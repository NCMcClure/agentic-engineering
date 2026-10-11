---
name: check-motion
description: "Measurement over time. Use for animation, transitions, smoothness, clips, character motion or latency: anything a still cannot show."
---

# check-motion

A still shows only its instant (doctrine rule 7). Smoothness, direction, timing and continuity need a sequence and
numbers made for sequences. Pick the measurement by the question; each script prints what its number means and
what it cannot tell.

| The question | Measurement | Script |
|---|---|---|
| Does anything **jump** while a value changes smoothly? (light, colour, exposure, a fade) | largest step between frames against the local rate of change | `sweep.py` |
| Does a moving thing move **evenly**? (stutter, dropped or doubled frames, non-dividing rates) | judder: spread of per-frame displacement at constant speed | `sweep.py --positions` |
| Does it move **the right way**, and do still things stay still? | optical-flow direction, magnitude, coherence per region | `flow.py` |
| Does a **character** hold the right pose and move like the reference? | keypoints: per-joint error, limb angles, left/right swaps, jitter | `keypoints.py` |
| Are two **clips** of the same sequence alike, and where not? | per-frame similarity, worst frames side by side | `video.py compare` |
| How **late** is the output behind its input? | time from a step in the input to the first changed output sample | a probe (step 3) |
| What does it **look like** over time? | contact sheet, burst | `video.py contact`, `burst` |

All are run as `uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/<script>" …`; each has `--help` and `--self-test`.

## Step 1 — Make the sequence without a person

Drive the candidate through the change **synthetically and deterministically**: a scripted sweep of the input (a
full day at a high rate, a transition A → B, a camera move, a constant-speed pass), frames written at a fixed step
of the candidate's own clock, not of wall time. Record per frame the values that would betray a jump if the picture
is too expensive to keep (region means, exposure, the positions of tracked objects) as a CSV or JSONL.

Make accumulated state settle when time stands still or jumps, so stills stay deterministic while the sweep shows
the dynamics. If a recording of the real reference exists, replay it as input; a synthetic input is fine and is
labelled as such.

*Done when: a frames folder or a values file exists for the sweep, produced by one command with no person in it.*

## Step 2 — Measure, and gate on the number that matters

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.py" --frames <dir> --region sky=0,0,1,0.3 --region road=0,0.6,1,1 --max-ratio <R>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.py" --values <file> --columns exposure,sun --max-step <V>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/sweep.py" --positions <file> --max-judder <J>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/flow.py" --frames <dir> --expect-direction <deg> --tolerance <deg> --expect-static <region>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/keypoints.py" compare <candidate-frames-or-image> <reference-frames-or-image> --min-pck 0.9
```

A **jump** is a step far above what the local slope explains, not a large step: a fast change is allowed to be
fast. State the bound with what it was measured against (the frame rate, the rate of the sweep), and put the check
in the project's test suite so it holds after you leave. Measure **before** fixing: the list of jumps with their
sizes is the work list, and the before → after table is the report.

*Done when: each question of the task has a number before and after, a bound a test holds, and the flagged frames
are named.*

## Step 3 — Latency

Latency is measured with a **step**, never estimated from parts when it can be measured: inject a step into the
input at a known instant (a synthetic input through the real path), find the first output sample that differs, and
report the median and the 95th and 99th percentiles over repeated steps, at each rate that matters, with the
**floor** the design allows next to each number so the reader sees what is left. Timestamps come from one clock or
from clocks whose relation is measured.

A latency or a frame time measured on a busy machine is a number about the other job. Checking that the machine is quiet before a measurement is agent-works' job (`agent-works:coordinate` /
`aw sys --quiet-for timing`). Without it: read the GPU and processor load yourself before the run (`nvidia-smi`,
the system's process list), wait if another job is running, and write what you saw beside the numbers.

*Done when: the table has before, after and floor per path and rate, with the number of steps measured and the
machine's load at the time.*

## Step 4 — Look

Numbers find the frame; eyes say what happened there.

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/video.py" contact --frames <dir> --every <N>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/video.py" burst --frames <dir> --frame <N> --count 9
```

Open the sheet. A contact sheet of every Nth frame is also what the owner looks at for a transition
(`judge-and-queue`).

*Done when: you have looked at the frames around every flagged step and can say what is seen there.*

## What these numbers cannot tell

- `sweep.py` sees region means: a small object popping inside a large region hides in the mean. Add a region for it.
- Flow fails on textureless areas, repeated patterns and large displacements; coherence near zero means "unknown".
- Keypoints are a detector's guess: check visibility values, and distrust occluded joints.
- A measured latency excludes the display and whatever comes after the last timestamp. Say where it ends.
- Comfort, readability and "feels smooth" on real hardware are the owner's: list them as not verified.
