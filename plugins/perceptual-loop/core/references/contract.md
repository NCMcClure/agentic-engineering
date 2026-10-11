# The perceptual-loop contract

What every script and skill of this plugin agrees on: the vocabulary, the files on disk, and the shapes of the JSON
they exchange. A project adapts the loop to itself only through `config.json` and two commands (how to make a
reference, how to make a candidate). Everything else is the plugin's.

## Vocabulary

- **shot** — one reproducible instant of the thing under test, with a name: the state that produces it, the
  viewpoint, and the outputs each source made of it. A shot is the unit of every run, group, gate and report.
- **source** — who made an output of a shot. One source is the **reference** (what the result is judged against:
  another renderer, a design mock, last release, a recording of the real thing). The others are **candidates**
  (what the agent is changing). Source ids are short lower-case words (`reference`, `candidate`, `web`, `unreal`).
- **pass** — one output of a source for a shot. `beauty` is the picture a person would see. Optional helper passes
  make numbers meaningful: `mask` (white = the subject), `id` (flat colours, one per region), `depth`, `albedo`
  (what the surface is before light). A clip (`clip`) and a sound (`audio`) are passes too.
- **region** — a named part of the picture (from the `id` pass, the `mask`, boxes in `shot.json`, or a segmentation
  fallback). Metrics are computed for the whole frame and per region.
- **metric** — a number comparing a candidate pass with the reference pass of the same shot.
- **baseline** — the accepted metric values of each shot, per candidate source, with **tolerances** measured from
  run-to-run noise.
- **gate** — "is every metric of these shots within tolerance of its baseline?" A gate compares a candidate with
  *its own earlier run*. It is a regression check, never a score against the reference.
- **verdict** — a judgement about a difference, made by looking and by going to the source; a metric never gives
  one. The six verdicts and their meanings are in `doctrine.md` rule 2, and only there.
- **group** — a named set of shots chosen by name patterns (`smoke`, a topic, a content pair).
- **probe** — a small tool that reads the truth out of a system (a value read back, a log, a file's numbers) so a
  rule is measured instead of fitted to pictures.
- **sheet** — a picture made for eyes (the agent's and the owner's): pair, triptych, strip, contact sheet, crop.

## Files

Everything lives under one folder, `.perceptual-loop/` at the project root unless `PERCEPTUAL_LOOP_DIR` says
otherwise. Scripts find the project root by walking up from the working directory to the first folder that holds
`.perceptual-loop/config.json` (or a `.git`).

```
.perceptual-loop/
  config.json              the adapter (below)
  groups.json              { "<group>": ["<glob>", "!<glob>" …] }   globs over shot names
  baseline.json            accepted values and tolerances (below)
  success/<task>.md        a task's success definition (define-success)
  decisions/               the owner's rulings, as files the agents read (judge-and-queue)
  shots/<shot>/            one folder per shot (may be redirected by config.shotsDir; large, usually git-ignored)
    shot.json              { "name", "meta": {…free…}, "regions": { "<name>": [x0,y0,x1,y1] in 0..1 }? }
    ids.json               { "<name>": [r,g,b] }   the id pass's colours, when there is one
    <source>.png           beauty
    <source>.mask.png  <source>.id.png  <source>.depth.png  <source>.albedo.png      optional passes
    <source>.mp4|.webm|frames/<source>/000001.png …                                   a clip, optional
    <source>.wav                                                                      a sound, optional
    <source>.json          the renderer's own report (timings, state), free form
  runs/<run>/<shot>/       outputs of a compare run: metrics.<source>.json, sheets, crops (git-ignored)
  runs/timing.jsonl  runs/budget.log     one line per iterate run; allowed over-budget runs
```

## config.json

```json
{
  "version": 1,
  "reference": "reference",
  "candidates": ["candidate"],
  "shotsDir": ".perceptual-loop/shots",
  "render": {
    "candidate": "npm run render -- {shots}",
    "reference": "npm run capture -- {shots}"
  },
  "passes": ["beauty"],
  "regionsFrom": "reference",
  "budget": { "free": 3, "match": ["render", "capture", "perceptual-loop.*iterate"] },
  "metrics": { "ssim": true, "deltaE": true, "edges": true, "detail": true }
}
```

- `render.<source>` is a shell command; `{shots}` is replaced by the shot names separated by spaces, `{shotsDir}`
  by the shots folder, `{source}` by the source id. The command must write that source's passes into each shot's
  folder and exit non-zero on failure. Rendering must be **deterministic**: the same shot gives the same picture.
- `regionsFrom` names the source whose `id`/`mask` pass cuts the regions for every source (regions must be the same
  pixels for baseline numbers to be comparable between runs).
- `budget.free` is how many shots one command may render without stating a reason; `budget.match` are regular
  expressions over command text that mark a command as a render. The reason goes in the command as
  `PL_RUN="verify: <what already works, what this checks>"` or `PL_RUN="full: <what is finished>"`.
- There is no `locks` key (it was removed in 0.2.0; a leftover one is ignored). Locks on scarce applications and
  the notes agents leave each other are the agent-works plugin's. The budget rule reads through its wrappers: in
  `aw lock run <resource> … -- <command>` and `aw lease <resource> … -- <command>` it judges `<command>`.

## metrics.<source>.json (one per shot and candidate, written by compare.py into the run's shot folder)

```json
{
  "shot": "home__hero__desktop", "source": "candidate", "against": "reference",
  "size": [1920, 1080], "regionsFrom": "reference",
  "frame": { "ssim": 0.91, "deltaE": 4.2, "deltaENorm": 3.1, "exposureEV": -0.12, "wb": [0.98, 1.0, 1.03],
             "contrast": 0.95, "edgeF1": 0.83, "edgeRecall": 0.80, "edgePrecision": 0.86, "detailLog2": -0.11 },
  "regions": { "car_body": { "area": 0.12, "ssim": 0.88, "deltaENorm": 2.9, "edgeF1": 0.81, "iou": 0.97 } },
  "notes": []
}
```

- `ssim` and `deltaE` are measured on the candidate as rendered; `deltaENorm`, the edge numbers and `detailLog2`
  on the candidate after normalisation. A shot that could not be compared gets a document with `error` and no
  `frame`.
- `deltaE` is CIEDE2000 averaged over the frame; `deltaENorm` is the same after the candidate was normalised for
  exposure and white balance (so it speaks of colour, not of brightness); `exposureEV` and `wb` are that
  normalisation. `detailLog2` is log2 of the ratio of fine-detail energy (candidate / reference).
- A flat key for one number is `<shot>/<source>/<metric>` with `<metric>` = `frame.ssim`, `frame.wb.r`, `region.car_body.edgeF1`…

## baseline.json

```json
{
  "version": 1,
  "tolerances": { "candidate/frame.ssim": 0.01, "candidate/region.*.edgeF1": 0.04, "*/frame.exposureEV": 0.05 },
  "minRegionArea": 0.002,
  "spread": { "home__hero__desktop/candidate/region.glass.edgeF1": 0.03 },
  "entries": { "home__hero__desktop/candidate/frame.ssim": 0.91 },
  "notes": { "candidate/frame.ssim": "6 runs of 12 shots on 2026-01-10: max spread 0.004, tolerance = 2.5x" }
}
```

- The tolerance of an entry is the most specific matching pattern (`*` matches within one path part). An entry with
  a `spread` is allowed `1.5 × spread` instead. Regions smaller than `minRegionArea` of the frame carry no entries.
- `check` reports each entry as `ok`, `beyond` (outside tolerance, either direction), `new`, or `missing`. It says
  *moved*, never *worse*: the direction is given, the judgement is not.
- `update` is always **targeted**: one source, and a list of shots or a group. It never rewrites what it was not
  asked about.

## Script conventions

- Python 3.10+, run with `uv run --no-project <script>`; each script declares its own dependencies inline (PEP 723),
  so heavy ones (torch for `semantic.py`, mediapipe for `keypoints.py`) cost nothing until that script is used.
- Every script: `--help`; `--json` prints one JSON document on stdout and nothing else; human text otherwise;
  exit 0 = done and (for gates) passed, 1 = a gate failed or a check found something, 2 = usage or environment
  error. No script writes outside `.perceptual-loop/` or an `--out` folder it was given. No `__pycache__` is left in
  the plugin (`sys.dont_write_bytecode = True` before importing siblings).
- Shared helpers are in `scripts/pl_common.py` (find the root, read the config, resolve groups and shot folders,
  load images as float RGB in linear light and in sRGB, flat-key helpers).
- Scripts never start the project's applications themselves except `iterate.py`, which runs `config.render`.
