---
name: check-audio
description: "Measurement of sound. Use when a task produces or changes audio, or sound must stay in sync with a picture."
---

# check-audio

An agent cannot listen, but it can measure and it can **look**: a spectrogram is a picture of a sound, and its
vision reads one well. This skill turns "does it sound right?" into numbers with tolerances and sheets for eyes.
Run as `uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/audio.py" <subcommand> …` (`--help`, `--self-test`).

## Step 1 — Capture without a device

Get the sound as a file with **no audio device in the path**: render offline, or tap the signal before the output
(a null or file sink, a capture inside the process). Never change the user's devices, default outputs or volumes to
make a capture possible, and never play test audio on their speakers. Fixed sample rate, fixed duration from a fixed
start state, levels fixed. If several sources mix, capture each **dry and separate** where the system allows it
(before panning, attenuation and reverb): a mix cannot be un-mixed, and position-dependent processing hides the
source's own signal.

*Done when: a `.wav` per source exists for the same instant sequence, produced by one command, and nothing audible
happened.*

## Step 2 — Sanity first

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/audio.py" silence <file>
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/audio.py" probe <file>
```

Silent, clipped, DC-offset, wrong rate, wrong duration, one channel dead: these explain most "wrong" sounds and
cost one command to rule out.

*Done when: the file is not silent, not clipped, and has the rate, channels and duration you expect.*

## Step 3 — Measure what the task is about

| The question | Command | The number |
|---|---|---|
| Is the **pitch** what the state says it should be? (an engine at this speed, a note, a tone) | `pitch <file> --expect-hz F` or `--expect-csv <file with columns time,hz>` | median relative error; share of frames within tolerance |
| Is it as **loud** as it should be, and as the reference? | `probe`, `compare A B` | integrated loudness; level difference in dB |
| Do events happen **when** they should? | `onsets <file> --expect-times t1,t2,…` | per-event timing error |
| Is it **in sync** with the reference or the picture? | `compare A B` | lag in ms by cross-correlation |
| Does it have the reference's **character**? | `compare A B` | log-spectral distance; octave-band differences; envelope correlation |

Tie expectations to the **source of truth**, not to the reference recording, wherever one exists: the expected
frequency from the state that drives the sound (speed, a parameter the stream carries), the expected onset from the
event that triggers it. Position-independence is checkable too: a dry source's level must be the same wherever the
listener is.

Gate with the measured run-to-run spread plus a margin, as for pictures (`calibrate-gate`). For sound that must
follow a picture, schedule and measure against the **same clock** the picture is drawn at.

*Done when: each audio observable of the success file has a number, a tolerance with its origin, and a pass or a
finding.*

## Step 4 — Look at it

```
uv run --no-project "${CLAUDE_PLUGIN_ROOT}/scripts/audio.py" spectrogram <file> --pitch --out <folder>
```

Open the PNG it prints. Read it like a picture: harmonics as parallel lines that should rise with speed, a click as a
vertical line, a dropout as a gap, hum as a horizontal line at mains frequency, clipping as energy smeared to the
top. Put the reference's spectrogram beside the candidate's with `sheet.py triptych` when comparing.

*Done when: you have described what the spectrogram shows in a sentence, and it agrees with the numbers.*

## What stays the owner's

Whether it sounds **good**, whether a level is comfortable, whether spatial placement feels right on their
speakers or headphones: queue these with the spectrogram pair and, where possible, a short file for them to play
(`judge-and-queue`). Say plainly that nobody has listened.
