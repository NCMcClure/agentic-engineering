---
name: check-audio
description: "Use when a task produces or changes sound, or sound must stay in sync with a picture. Measures loudness, silence and clipping, pitch, onsets, lag, spectra, and draws spectrograms."
---

# check-audio

An agent cannot listen, so "does it sound right?" becomes either a guess or a person asked after every change. It can measure, though, and it can look: a spectrogram is a picture of a sound, and reading one is a vision task. This skill makes the sound reproducible, measures it with numbers that carry tolerances, and draws the spectrogram the eyes check those numbers against.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`. `P audio --help` says what each number means and what it cannot tell. A sound is a WAV file (read directly), anything ffmpeg reads (a FLAC, an MP3, a video's sound track), or a shot's sound, `<source>.wav` in the shot folder, read with `--shot NAME --source ID`.

## Step 1: Capture without a device

Get the sound as a file with no audio device in the path: render offline, or tap the signal before the output (a null or file sink, a capture inside the process). Never change the person's devices, default outputs, or volumes to make a capture possible, and never play test sound on their speakers. Fix the sample rate, the duration, the start state, and the levels. When several sources mix, capture each one dry and apart where the system allows it (before panning, attenuation, and reverb): a mix cannot be taken apart afterwards, and processing that depends on position hides the source's own signal.

*Done when: one command with no person in it writes a WAV per source for the same instants, and nothing was audible.*

## Step 2: The cheap checks first

```
P audio silence <sound>
P audio probe <sound>
```

Silence, clipping, a DC offset, the wrong rate, the wrong length, a dead channel: these explain most wrong sounds, and each costs one command to rule out.

*Done when: the sound is not silent, not clipped, and has the rate, channels, and duration expected.*

## Step 3: Measure what the task is about

| The question | Command | The number |
| --- | --- | --- |
| Is the **pitch** what the state says it should be (an engine at this speed, a note, a tone)? | `P audio pitch <sound> --expect-hz F`, or `--expect-csv <time,hz file>` | median error in percent; the share of frames within tolerance |
| Is it as **loud** as it should be, and as the reference? | `P audio probe`, `P audio compare A B` | integrated loudness in LUFS; level difference in dB |
| Do events happen **when** they should? | `P audio onsets <sound> --expect-times t1,t2,...` | offset per event in ms; missed and extra |
| Is it **in sync** with the reference or the picture? | `P audio compare A B` | lag in ms |
| Does it keep the reference's **character**? | `P audio compare A B` | log-spectral distance; octave-band differences; envelope correlation |

Tie each expectation to the source of truth where one exists, not to a reference recording: the expected frequency from the state that drives the sound (a speed, a parameter the stream carries), the expected onset from the event that triggers it. A dry source's level should not depend on where the listener stands, and that is checkable too.

Gate with bounds measured from the spread between runs plus a margin, as for pictures (`calibrate-gate`): capture the same sound twice with no change, compare the two, and set `--max-lsd`, `--max-level-db`, and `--max-lag-ms` above what the identical runs show. For sound that must follow a picture, schedule and measure both against the same clock.

*Done when: each sound observable in the success file has a number, a tolerance with its origin, and a pass or a finding.*

## Step 4: Look

```
P audio spectrogram <reference> <candidate> --pitch
```

Open the PNG it prints. The panels share one time scale and one level scale, so a difference in brightness is a difference in level. Read it as a picture: harmonics are parallel lines that rise with speed, a click is a vertical line, a dropout is a gap, hum is a horizontal line at the mains frequency, and clipping smears energy up to the top. The dots are the fundamental the pitch numbers came from.

*Done when: you can say in a sentence what the spectrogram shows, and it agrees with the numbers.*

## Owed work

When a full pass over every sound is owed and this session will not run it, owe it where the next session finds it: a line at the top of the report, or the task board if agent-works is installed, so it is not lost when the session ends.

## What stays the owner's

Whether it sounds good, whether a level is comfortable, and whether the placement feels right on their speakers or headphones. Queue these with the spectrogram and, where possible, a short file to play (`judge-and-queue`), and say plainly in the report that nobody has listened.

## What these numbers cannot tell

- Peak is the largest sample, not the true peak between samples: a sound whose samples stay under full scale can still clip in a converter.
- Pitch is one fundamental per frame: a chord, or two engines at once, gives a low confidence or a wrong value.
- An onset is a start that adds energy; a slow swell, or a change of pitch at a constant level, has none.
- Two recordings of noise never reach a log-spectral distance of zero: compare a run with a run, not with zero.
