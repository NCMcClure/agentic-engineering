# perceptual-loop

An agent can't iterate on what it can't measure. Ask one to "make it look right" and it either stops at the
first plausible picture or asks you after every change, and nothing catches the shot it broke three steps ago.
Code has tests; a picture has a person squinting at it. perceptual-loop gives image, video and audio work the
loop code already has: a reproducible unit (a *shot*), numbers that gate regressions, a sheet the agent opens
with its own vision after every change, a second look from a critic who does not know what was meant, and one
page where you answer the taste questions in a sitting.

## How it works

A project keeps its state in `.agents/perceptual/`: a config naming the reference (another renderer, a design
export, last release), the candidates, and the command that renders a source's shots. Everything else is the
plugin's, through one CLI, `node scripts/pl.mjs <command>`.

| | |
|---|---|
| **A reproducible instant** | Every check is a named shot: the state, the viewpoint, and what each source made of it. |
| **A gate, not a score** | Numbers compare a candidate with *its own* accepted run, inside tolerances measured from run-to-run noise. A gate says an entry moved and which way, never better or worse. |
| **A metric that moved is not a verdict** | The agent opens the sheet, goes to the source, and gives each difference one of six verdicts (`references/doctrine.md`). |
| **The smallest run that answers the question** | The few proving shots per iteration, a group once, everything once. A hook enforces the budget. |
| **Measure the reference, don't fit pictures** | Probes read the rule out of the source system. |
| **The owner's eye, in batches** | Taste questions become cards on one review page, each with reference, before, after and a recommendation. |

**Measure.** `compare` writes, per shot, SSIM and CIEDE2000 on the candidate as rendered; the exposure,
white-balance and contrast fit that brings it to the reference; and colour difference, edge F1 and detail
after that fit, so a brighter picture is reported once as brighter and not four times. Regions from an id
pass, a mask or boxes get the same numbers. `calibrate` turns the spread of repeated runs into tolerances and
finds entries that flip between two values.

**Look.** `iterate` renders a few shots, compares, gates, and draws each shot's sheet: reference, before and
after side by side, then what the run changed, where the edges differ, and the colour difference on one fixed
scale. Triptychs, zoomed crops, contact sheets and heat maps are drawn on demand, in a built-in bitmap font,
at a width a vision model reads without shrinking.

**Over time, and by ear.** A clip (a folder of frames, or a video) gets numbers made for sequences: `sweep`
finds jumps, flicker and judder, `flow` measures which way and how fast pixels move and counts what it cannot
measure as unknown, `video compare` puts the worst frames of two clips side by side. `audio` turns a sound into
loudness (BS.1770-4), silence and clipping, pitch, onsets, lag, spectral distance, and a spectrogram to look at.

**Judge.** `blind` copies a before and after to `A` and `B` and keeps the key apart; the `vision-critic` agent
judges them without knowing which is which or what was meant, and a workflow has a skeptic try to refute each
finding. Your questions go on one self-contained review page, and `review apply` turns your answers into
ruling files later sessions read. `lint` checks a report for verdicts read off a number and claims with no
evidence.

Everything is Node 22, standard library only: the PNG codec, the JPEG encoder, the WAV reader, the metrics,
the optical flow and the DSP are written here. `ffmpeg` is the one external tool, and only for pictures that
are not PNG, video files, and sounds that are not WAV. The numbers match the Python scripts this plugin
shipped until 0.2.0 (within 0.00002 for a frame's metrics and 0.00005 for a region's, edge scores exactly,
sound to the printed digit, onsets within 2 ms), so a baseline accepted then still gates now.

## The guard

One hook on Bash and PowerShell, inert until a project has a perceptual config:

- **Budget:** a command matching `budget.match` that renders more than `budget.free` shots is refused unless
  it states its reason (`PL_RUN="verify: ..."` or `PL_RUN="full: ..."`); allowed large runs are logged.
- **Baseline:** `pl.mjs baseline update` without `--source` and a selection is refused.

It reads the command the way a shell does, so a render inside `bash -c "..."` or `powershell -Command "..."`
is seen, a commit message that quotes one is not, and a render behind the agent-works lock wrapper
(`aw lock run <resource> ... -- <command>`) is judged as the command it runs. It matches command text: a
coordination aid, not a security boundary.

The render command a project configures is started as a program with its arguments and never through a
shell. A string is split into words as a shell would split them; a pipeline or a redirection goes in a script,
or in `config.json` as an array that names the shell (`["bash", "-c", "..."]`).

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install perceptual-loop@agentic-engineering
```

Requires Node 22 or newer. `ffmpeg` only for what is listed above (`PL_FFMPEG` and `PL_FFPROBE` name it when
it is not on `PATH`). In a project, ask for the task as usual: `define-success` writes what will prove it,
`/perceptual-loop:shot-harness` wires the project's render command into `.agents/perceptual/config.json`, and
`iterate-shots` is the loop.

Four lines of the doctrine stay in the agent's context where the repo has opted in to the agentic-engineering
plugins (it carries `.agents/perceptual/` or another plugin's marker, or you answered the one-time question a
session asks). They come back after a compaction or a `/clear` and reach working subagents, never the blind
critic. The skills and the CLI work in any repo.

### Coming from 0.2.0

A repo that keeps its state in `.perceptual-loop/` is moved to `.agents/perceptual/` by the first session:
one rename, tracked and untracked files together, nothing inside rewritten. The session is told which config
keys still name the old folder (usually `shotsDir`), and the CLI reads that spelling from the new folder until
they are edited. Each `<command>.py` is now `pl.mjs <command>` (`evidence_lint.py` is `pl.mjs lint`,
`review_page.py` is `pl.mjs review`), and `uv` is no longer needed. A render command that relied on a shell
(`cd app && ...`, a pipe, a `$VARIABLE`) is refused with the fix.

## Skills

| Skill | Use it when |
|---|---|
| `perceptual-loop` | Starting any work judged by eye or ear; it routes to the rest |
| `define-success` | Before the work: whether it can be measured, the observables, the proving shots |
| `shot-harness` (you start it) | The project cannot yet render a shot on command, or needs a new shot, pass or reference |
| `iterate-shots` | Every change and check |
| `calibrate-gate` | Numbers wobble between identical runs, a gate fails on something untouched, a baseline is about to be accepted |
| `probe-the-source` | A colour, brightness, shape or timing differs and the cause is unknown, or a rule is about to be fitted to pictures |
| `judge-and-queue` | A difference needs a verdict, a finished change needs a blind second look, or taste questions wait for you |
| `check-motion` | Anything a still cannot show: an animation, a transition, smoothness, latency, a clip against a clip |
| `check-audio` | A task produces or changes sound, or sound must stay in sync with a picture |

Plus the **vision-critic** agent (`perceptual-loop:vision-critic`: it sees only pictures and neutral questions,
never the builder's intent) and the **perceptual-critique** workflow (a blind critic per comparison, a skeptic
per finding). Where the host has no workflow tool or no subagents, `references/subagent-fallback.md` gives the
same steps by hand. A session handing look work to other agents appends `references/agent-brief.md` to each
brief.

## The CLI

Every command takes `--help` and `--json`. Exit 0 is done or passed, 1 a gate failed or a check found
something, 2 a usage or environment error.

| Command | What it does |
|---|---|
| `init`, `new-shot`, `new-success` | Scaffold `.agents/perceptual/`, add shots, start a task's success file |
| `groups` | List, show, resolve a selection, propose the smallest smoke group |
| `compare` | The numbers, per shot and candidate, into a run folder |
| `baseline` | `check` and `stale` gate a run, `update` accepts it for named shots only, `tolerances` shows or sets them with a note |
| `calibrate` | Tolerances from repeated runs, and bistable entries |
| `iterate` | Render, compare, gate, before and after, a sheet per shot, where the time went |
| `sheet` | `shot`, `triptych`, `crop`, `contact`, `diff`; PNG, or JPEG with `--jpeg` |
| `blind` | Neutral copies `A`, `B`, `R` for a critic, the key kept apart |
| `review` | `add` a question to your queue, `build` the page, `apply` the exported answers |
| `lint` | A report's verdicts beside a bare metric, claims with no artefact, targets set against the reference |
| `timing` | Where the iteration time went, and whether the render budget is kept |
| `video`, `sweep`, `flow` | Clips: probe, frames, contact sheets, clip against clip; jumps, flicker and judder; optical flow per region |
| `audio` | `probe`, `silence`, `pitch`, `onsets`, `compare`, `spectrogram` |
| `semantic`, `keypoints` | Optional extras, below |

### Two optional extras

Two measurements need trained models, which Node does not have, so they stay Python scripts beside the CLI:
`scripts/semantic.py` (CLIP and LPIPS: how alike two pictures are, or a picture and a description, when no
pixel lines up; needs torch) and `scripts/keypoints.py` (MediaPipe landmarks: a character's joints, and
whether two pictures agree about them). `pl.mjs semantic ...` and `pl.mjs keypoints ...` hand the arguments
over, through `PL_PYTHON` when set, else `uv run --no-project` (uv installs what the script lists, which for
`semantic` is around a gigabyte with its models), else `python3` as it is. Without Python, the command exits
2 and says so; nothing else in the plugin needs either file. Both are models with blind spots (counting, text,
occlusion, left and right): their help says so.

## What it does not do

- It does not decide taste. It prepares the comparison and asks once.
- Its numbers are regression signals. None of them says which of two pictures is right.
- It does not coordinate agents. Locks on a renderer only one session may use, the machine's load before a
  timing, and owed work are yours to arrange, or agent-works' if that plugin is installed.
- No JPEG decoder (a JPEG goes in through ffmpeg), no true-peak meter (`audio probe` reports the sample
  peak), and nobody listens: whether a sound is good stays yours, queued with its spectrogram.
