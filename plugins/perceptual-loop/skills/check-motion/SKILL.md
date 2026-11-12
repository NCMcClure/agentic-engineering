---
name: check-motion
description: "Use for animation, transitions, smoothness, latency, or any clip, where a still cannot show it. Measures over time: jumps, flicker, judder, flow direction, clip against clip, contact sheets."
---

# check-motion

A still shows only its instant (doctrine rule 7, `${CLAUDE_PLUGIN_ROOT}/references/doctrine.md`). A pop in a fade, a flicker, a stutter, a motion going the wrong way, or a transition that differs from the reference is in no single frame, so a sheet of stills does not find it and a person scrubbing a clip finds it once. This skill makes the sequence reproducible and measures it with numbers made for sequences, then points the eyes at the frames the numbers name.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`. Every command takes `--help`, which says what its numbers mean and what they cannot tell. A clip is a folder of frames (no ffmpeg needed) or a video file (ffmpeg, the one external tool), or a shot's clip: `frames/<source>/` or `<source>.mp4` in the shot folder, read with `--shot NAME --source ID`.

| The question | Measurement | Command |
| --- | --- | --- |
| Does anything **jump** while a value changes smoothly (a fade, a light, an exposure)? | the step between frames against the local median step | `P sweep` |
| Does a value **flicker**, or go the wrong way? | RMS of the second difference; `--expect rising`, `falling`, `steady` | `P sweep` |
| Does a moving thing move **evenly** (stutter, a repeated or dropped frame)? | judder: the spread of the per-frame step at constant speed | `P sweep --positions` or `--track` |
| Does it move **the right way**, and do still things stay still? | dense optical flow per region: direction, speed, coherence, and what is unknown | `P flow` |
| Are two **clips** of the same instants alike, and where not? | per-frame SSIM and PSNR of luma, the worst frames side by side | `P video compare` |
| How **late** is the output behind its input? | the time from a step in the input to the first changed output | a probe (step 3) |
| What does it **look like** over time? | a contact sheet, a burst around one moment | `P video contact`, `P video burst` |

Character pose is the one question here Node cannot answer alone: `P keypoints compare <candidate> <reference> --min-pck 0.9` gives per-joint error in torso lengths, limb angles, left and right swaps, and jitter. It is an optional extra that hands over to a Python script and needs Python with mediapipe (`P keypoints --help` says what it found on this machine). Where that is not installed, say so and queue the look for the owner instead (`judge-and-queue`); never report a pose as checked without it.

## Step 1: Make the sequence without a person

Drive the candidate through the change synthetically and deterministically: a scripted sweep of the input (a day at a high rate, a transition from A to B, a camera move, a pass at constant speed), with frames written at a fixed step of the candidate's own clock, not of wall time. When the picture is too costly to keep, record the values that would betray a jump per frame instead (region means, the exposure, the positions of tracked objects) as a CSV or JSONL file; a value read back from the system is a better series than any pixel mean.

Make accumulated state settle when time stands still or jumps, so the stills stay deterministic while the sweep shows the dynamics. If a recording of the reference exists, replay its input; a synthetic input is fine and is labelled as such.

*Done when: one command with no person in it writes the frames folder or the values file for the sweep.*

## Step 2: Measure, and gate on the number that matters

```
P sweep <frames> --region sky=0,0,1,0.3 --region road=0,0.6,1,1 --expect sky.luma=falling --max-ratio <R>
P sweep --values <file.csv> --columns exposure,sun --max-step <V>
P sweep --positions <file.jsonl> --max-judder <J>
P flow <frames> --region car=<box> --expect-direction car=0 --tolerance 10 --expect-static <region>
P video compare <candidate> <reference> --align --min-ssim <V>
```

A **jump** is a step far above what the local slope explains, not a large step: a fast change is allowed to be fast. State each bound with what it was measured against (the frame rate, the rate of the sweep), and put the check in the project's own test suite so it holds after you leave. Measure **before** fixing: the flagged frames with their sizes are the work list, and the table of before and after is the report.

Flow counts a pixel with nothing to measure (flat colour, a straight edge) as **unknown**, apart from moving and still, and an expectation on a region that is mostly unknown fails as unknown. Do not read a blank region as static; add texture to the test scene, or measure that region another way.

*Done when: each question of the task has a number before and after, a bound a test holds, and the flagged frames are named.*

## Step 3: Latency

Measure latency with a step, never estimate it from parts when it can be measured: inject a step into the input at a known instant through the real path, find the first output sample that differs, and report the median and the 95th and 99th percentiles over repeated steps, at each rate that matters, with the **floor** the design allows beside each number. Timestamps come from one clock, or from clocks whose relation is measured.

A latency or a frame time measured on a busy machine is a number about the other job. Read the processor and GPU load yourself before the run (the process list, `nvidia-smi`), wait if another job is running, and write what you saw beside the numbers. When the check needs hardware only one session may use (a GPU, a device, a display) and agent-works is installed, run it under that plugin's resource lock; the render guard judges the wrapped command as the command inside it.

*Done when: the table has before, after, and floor per path and rate, with the number of steps measured and the machine's load at the time.*

## Step 4: Look

Numbers find the frame; eyes say what happened there.

```
P video contact <clip> --max-tiles 24
P video burst <clip> --frame <N> --count 9
```

Open every sheet the commands print: the frames around each flagged step, the worst frames of a comparison (`video.<stem>.worst.png`), and the flow sheet (arrows on the frame before, direction as hue, grey where unknown). A contact sheet of every Nth frame is also what the owner looks at for a transition (`judge-and-queue`), and what the critic judges blind.

*Done when: you have looked at the frames around every flagged step and can say what is seen there.*

## Owed work

When the full sweep of every clip is owed (a long render, the clips of every shot) and this session will not run it, owe it where the next session finds it: a line at the top of the report, or the task board if agent-works is installed, so it is not lost when the session ends.

## What these numbers cannot tell

- `sweep` sees region means: a small thing popping inside a large region hides in the mean. Add a region for it, or track it.
- Flow is the apparent motion of brightness: a moving shadow or a flickering light reads as motion, and motion faster than a few dozen analysed pixels a frame is underestimated. Near a moving edge the window drags a halo of slower pixels along, so `speed` sits under the true speed.
- SSIM and PSNR between clips say how far apart two frames are, never which is right.
- A measured latency excludes the display and whatever comes after the last timestamp. Say where it ends.
- Comfort, readability, and whether it feels smooth on real hardware are the owner's: list them as not verified.
