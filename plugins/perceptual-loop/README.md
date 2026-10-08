# perceptual-loop

An agent can't iterate on what it can't measure. Ask one to "make it look right" and it either stops at the first
plausible picture or asks you after every change. **perceptual-loop** gives image, video and audio work the loop
that code already has: a reproducible unit (a *shot*), numbers that gate regressions, pictures the agent opens with
its own vision, and one batched queue for the judgements only a person should make.

It was distilled from weeks of bringing one renderer to parity with another, with sub-agents doing the work
unattended. Every rule in it is the lesson of a failure that cost time.

## The idea

| | |
|---|---|
| **A reproducible instant** | Every check is a named shot: the state, the viewpoint, and what each source made of it. |
| **A gate, not a score** | Numbers compare a candidate with *its own* accepted run, inside tolerances measured from run-to-run noise. |
| **A metric that moved is not a verdict** | The agent looks, goes to the source, and gives each difference a verdict (the six are in `core/references/doctrine.md`). |
| **The smallest run that answers the question** | The few proving shots per iteration, a group once, everything once. A hook enforces the budget. |
| **Measure the reference, don't fit pictures** | Probes read the rule out of the source system. |
| **The owner's eye, in batches** | Taste questions become cards on one review page, each with reference, before, after and a recommendation. |

## Install

```text
/plugin install perceptual-loop@agentic-engineering
```

Requires [`uv`](https://docs.astral.sh/uv/) and, for clips, `ffmpeg`. In a project, ask for the task as usual:
`define-success` writes what will prove it, `/perceptual-loop:build-harness` wires the project's render command into
`.perceptual-loop/config.json`, and `iterate` is the loop.

## Skills

| Skill | Use it when |
|---|---|
| `perceptual-loop` | Starting any work judged by eye or ear; routes to the rest |
| `define-success` | Before the work: triage whether it can be measured, name the observables and the proving shots |
| `build-harness` (you start it) | The project cannot yet render a shot on command, or needs a new shot, pass or reference |
| `iterate` | Every change-and-check |
| `calibrate-gate` | Numbers wobble, a gate fails on something untouched, a baseline is accepted |
| `probe-the-source` | A difference needs explaining, or a rule is being guessed from pictures |
| `judge-and-queue` | A difference needs a verdict, an unanchored second look, or the owner's ruling |
| `check-motion` | Animation, transitions, smoothness, character motion, latency, clips |
| `check-audio` | Sound: pitch, loudness, timing, sync, spectrograms to look at |
| `orchestrate-agents` (you start it) | Several agents, one renderer: briefs, locks, a board, proportionate verification |

Plus the **vision-critic** agent (a judge that sees only pictures and neutral questions, never the builder's intent)
and the **perceptual-critique** workflow (a blind critic per comparison, a refuter per finding).

## Scripts

All Python, run with [`uv`](https://docs.astral.sh/uv/) (`uv run --no-project <script>`); each declares its own
dependencies, so the heavy ones cost nothing until used. Every script has `--help` and `--json`.

| Script | What it does |
|---|---|
| `init.py`, `groups.py` | Scaffold `.perceptual-loop/`, add shots and success files (from `assets/success-template.md`), name groups, propose a smoke set |
| `iterate.py` | Render → compare → gate → sheet for a few shots, with before → after and where the time went |
| `compare.py` | Structure, colour difference after exposure and white-balance normalisation, edges, detail, per region |
| `sheet.py`, `blind.py` | Pair sheets, reference / before / after triptychs, strips, contact sheets, crops, heat maps with their numbers; neutral A/B copies for the blind critic |
| `baseline.py`, `calibrate.py` | Check, targeted update, measured tolerances, per-entry spread, stale entries |
| `sweep.py`, `flow.py`, `video.py` | Jumps against the local slope, judder, optical-flow direction, clip comparison, contact sheets |
| `keypoints.py` | Character pose: per-joint error, limb angles, left/right swaps, jitter |
| `semantic.py` | Similarity when nothing is pixel-aligned: image–image, image–text, ranking, drift |
| `audio.py` | Pitch against expectation, loudness, onsets, lag, spectral distance, spectrograms |
| `lock.py` | One instance of a scarce application across agents and worktrees; a shared board |
| `review_page.py` | The owner's review page (one self-contained HTML file) and applying the exported rulings |
| `evidence_lint.py`, `timing.py` | Lint a report for verdicts without evidence; show where iteration time goes |

## Hooks

One PreToolUse hook, **inert until a project has `.perceptual-loop/config.json`** and only for what that config
turns on:

- **Budget:** a render of more shots than `budget.free` is refused unless the command states its reason
  (`PL_RUN="verify: …"` or `"full: …"`); allowed large runs are logged.
- **Locks:** a command that starts a configured application is refused unless it names its agent (`PL_AGENT=…`) and
  that agent holds the lock.
- **Baseline safety:** an update without a source and a selection is refused.

## Tests

`python -B -m unittest discover -s tests` runs the standard-library tests: `tests/test_guard.py` (the hook's
decisions), `tests/test_lock.py` (queue order, races, `run` releasing) and `tests/test_evidence_lint.py`. The
measuring scripts carry their own `--self-test` on synthetic data.

## What it does not do

- It does not decide taste. It prepares the comparison and asks once.
- Its numbers are regression signals. None of them says which of two pictures is right.
- `semantic.py` and `keypoints.py` are models with blind spots (counting, text, occlusion, left/right); their help
  says so.
- The hook matches command **text**. It skips heredoc bodies and the arguments of commit messages and `echo`, but
  a guarded command quoted as an argument of another program still matches, a render started from inside a script
  file is not seen, and the caller's name is self-declared: a coordination aid, not a security boundary.

## Changelog

- 0.1.0 — First release: ten skills, the vision-critic agent, the critique workflow, the script set, the guard hook.
