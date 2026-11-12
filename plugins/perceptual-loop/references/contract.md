# The perceptual-loop contract

What every command and skill of this plugin agrees on: the words, the files on disk, and the JSON they exchange. A project adapts the loop only through `config.json` and its render commands; everything else is the plugin's.

## Words

- **shot**: one reproducible instant of the thing under test, with a name. It holds the state that produces it, the viewpoint, and what each source made of it. Runs, groups, gates, and reports are all counted in shots.
- **source**: who made an output of a shot. One source is the **reference**, what the result is judged against (another renderer, a design export, the last release, a recording). The others are **candidates**, what the work changes. Source ids are short words without dots (`reference`, `candidate`, `web`).
- **pass**: one output of a source for a shot. `beauty` is the picture a person sees. Helper passes make the numbers mean more: `mask` (white is the subject), `id` (flat colours, one per region), `depth`, `albedo` (the surface before light).
- **region**: a named part of the picture, cut from the `id` pass, the `mask`, or boxes in `shot.json`. Metrics are computed for the frame and for each region.
- **metric**: a number comparing a candidate pass with the reference pass of the same shot.
- **baseline**: the accepted metric values of each shot, per candidate, with **tolerances** measured from run-to-run noise.
- **gate**: whether every metric of these shots is within tolerance of its baseline. A gate compares a candidate with its own earlier run. It is a regression check, never a score against the reference.
- **verdict**: a judgement about a difference, made by looking and by going to the source; a metric never gives one. The six verdicts are in `doctrine.md` rule 2, and only there.
- **group**: a named set of shots chosen by name patterns (`smoke`, a topic, a content pair).
- **probe**: a small tool that reads the truth out of a system (a value read back, a log line, a file's numbers), so a rule is measured instead of fitted to pictures.

## Files

Everything lives in `.agents/perceptual/` at the project root, or where `PL_DIR` points. The root is the first folder at or above the working directory holding `.agents/perceptual/config.json`, else the git root, else the working directory.

The plugin's first layout kept the same files in `.perceptual-loop/`. The session hook moves that folder to `.agents/perceptual/` in one rename and rewrites nothing inside it; a repo it has not moved yet is read in place, and a `shotsDir` that still says `.perceptual-loop/shots` is read from the new folder until someone edits it.

```
.agents/perceptual/
  config.json            the adapter (below)                                        tracked
  groups.json            { "<group>": ["<glob>", "!<glob>", ...] } over shot names   tracked
  baseline.json          accepted values and tolerances (below)                     tracked
  success/<task>.md      a task's success definition (define-success)              tracked
  decisions/             the owner's rulings, as files agents read                  tracked
    queue.json           the open look questions (pl.mjs review add)
    <date>-<id>.md       one ruling per answered question (pl.mjs review apply)
    review.html          the page the owner answers on (pl.mjs review build)        ignored
  .gitignore             shots/, runs/, decisions/review.html
  shots/<shot>/          one folder per shot (config.shotsDir or PL_SHOTS_DIR move it)
    shot.json            { "name", "meta": {...}, "regions": { "<name>": [x0, y0, x1, y1] } }   boxes in 0..1
    ids.json             { "<name>": [r, g, b] }, the id pass's colours
    <source>.png         beauty
    <source>.mask.png  <source>.id.png  <source>.depth.png  <source>.albedo.png   optional passes
    frames/<source>/     a clip as frames named by frame number (000000.png, ...); or <source>.mp4 (.webm, .mov, ...)
    <source>.wav         a sound (or .flac, .ogg, .opus, .mp3, .m4a, .aac, through ffmpeg)
  runs/<run>/<shot>/     metrics.<source>.json, before.<source>.png, sheet.<source>.png
                         and from the motion commands (run motion by default): video.<source>.json and .worst.png,
                         sweep.<source>.json and .png, flow.<source>.json and .png, contact.<source>.png, burst.<source>.png
  runs/motion/clips/     the same files for a clip given by path, named after it
  runs/audio/<shot>/     <source>.spectrogram.png (and <a>-vs-<b>.spectrogram.png for several sounds)
  runs/audio/sounds/     the same for a sound given by path, named after it
  runs/sheets/           sheets drawn on their own (pl.mjs sheet)
  runs/blind/<id>.json   the key of a blinded comparison: which letter is the before
  runs/timing.jsonl      one line per iterate run
  runs/budget.log        the large runs the guard allowed, tab-separated
```

`init` writes the `.gitignore`, and when the repo keeps a list of what `.agents/` holds in `.agents/AGENTS.md` it adds the Layout line naming `perceptual/`.

## config.json

```json
{
  "version": 1,
  "reference": "reference",
  "candidates": ["candidate"],
  "shotsDir": ".agents/perceptual/shots",
  "render": {
    "candidate": "npm run render -- {shots}",
    "reference": ["node", "tools/capture.mjs", "--out", "{shotsDir}", "{shots}"]
  },
  "passes": ["beauty"],
  "regionsFrom": "reference",
  "budget": { "free": 3, "match": ["pl\\.mjs[\"']?\\s+iterate\\b", "npm run render"] },
  "metrics": { "ssim": true, "deltaE": true, "edges": true, "detail": true }
}
```

- `render.<source>` writes that source's passes into each shot's folder and exits non-zero on failure. It is started from the project root as a program with its arguments, never through a shell. A string is split into words as a shell would split them, quotes respected, and its leading `NAME=value` words become the program's environment; an array is taken as it is. `{shots}` as a whole argument becomes one argument per shot, and inside an argument the names separated by spaces; `{shotsDir}` is the shots folder, `{source}` the id. A string that needs a shell (a pipeline, a redirection, a `$VARIABLE`) is refused with the fix: a script, or an array that names the shell. Shot names must match `^[A-Za-z0-9][A-Za-z0-9_.-]*$` and are refused, never quoted. Rendering must be **deterministic**: the same shot gives the same picture.
- `regionsFrom` names the source whose `id` or `mask` pass cuts the regions for every candidate, so baseline numbers are the same pixels from run to run.
- `budget.free` is how many shots one command may render without a stated reason; `budget.match` holds regular expressions over command text that mark a command as a render. The reason is `PL_RUN="verify: <what already works, what this checks>"` or `PL_RUN="full: <what is finished>"`.

## metrics.<source>.json

One per shot and candidate, written by `compare` (and `iterate`) into the run's shot folder:

```json
{
  "shot": "home__hero__desktop", "source": "candidate", "against": "reference",
  "size": [1920, 1080], "regionsFrom": "reference", "regionsKind": "id",
  "frame": { "ssim": 0.91, "deltaE": 4.2, "deltaENorm": 3.1, "exposureEV": -0.12, "wb": [0.98, 1, 1.03],
             "contrast": 0.95, "edgeF1": 0.83, "edgeRecall": 0.8, "edgePrecision": 0.86, "detailLog2": -0.11 },
  "regions": { "car_body": { "area": 0.12, "ssim": 0.88, "deltaENorm": 2.9, "edgeF1": 0.81, "iou": 0.97 } },
  "notes": []
}
```

- `ssim` and `deltaE` are measured on the candidate as rendered. `exposureEV`, `wb` (green is 1), and `contrast` (the ratio of the 5 to 95 percentile spreads of log luminance) are the fit that brings the candidate to the reference. `deltaENorm`, the edge numbers, and `detailLog2` (log2 of the ratio of fine-detail energy, candidate over reference) are measured after that fit, so they speak of colour, structure, and sharpness rather than repeating the exposure.
- Regions under `minRegionArea` of the frame (0.002 by default) are dropped. `iou` compares the candidate's own cut of a region with the reference's.
- A shot that could not be compared gets a document with `error` and no `frame`. Values are stored to 5 decimals.
- A flat key for one number is `<shot>/<source>/<metric>`, with `<metric>` such as `frame.ssim`, `frame.wb.r`, or `region.car_body.edgeF1`.

## baseline.json

```json
{
  "version": 1,
  "tolerances": { "candidate/frame.ssim": 0.01, "candidate/region.*.edgeF1": 0.04, "*/frame.exposureEV": 0.05 },
  "minRegionArea": 0.002,
  "spread": { "home__hero__desktop/candidate/region.glass.edgeF1": 0.03 },
  "entries": { "home__hero__desktop/candidate/frame.ssim": 0.91 },
  "notes": { "candidate/frame.ssim": "6 runs of 12 shots on 2026-01-10: max spread 0.004, tolerance = 2.5x (floor 0.002)" }
}
```

- An entry's tolerance comes from the most specific matching pattern (`*` matches within one part). An entry with a `spread` is allowed `1.5 x spread` instead.
- `check` reports each entry as `ok`, `beyond` (outside tolerance in either direction), `new`, or `missing`, with the direction it moved relative to the reference. It says moved, never worse.
- `update` is always targeted: one source, and named shots, a group, or `--all-shots-of-run`. It rebuilds in place, so the diff shows exactly what was accepted.

## The CLI

- One entry point: `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs" <command>`. Node 22 stdlib only; ffmpeg is the one external tool, for pictures that are not PNG, for video files, and for sounds that are not WAV. Without it, those exit 2 naming the remedies, and a folder of PNG frames or a PCM or float WAV still works.
- Two commands are optional extras that hand over to a Python script beside the CLI, because they need trained models: `semantic` (`scripts/semantic.py`: CLIP and LPIPS, needs torch) and `keypoints` (`scripts/keypoints.py`: pose landmarks, needs mediapipe). They run through `PL_PYTHON` when it is set, else `uv run --no-project` (uv installs what the script lists), else `python3` or `python` as they are. Without the script or without Python they exit 2 and say what is missing; nothing else in the CLI needs either. In a project they write `semantic.<source>.json` and `keypoints.<source>.json` (with its `.png` sheet) into the run's shot folder.
- Every command takes `--help`, and `--json` prints one JSON document on stdout and nothing else. Exit 0 is done (and, for a gate, passed), 1 a gate failed or a check found something, 2 a usage or environment error.
- No command writes outside `.agents/perceptual/` or an `--out` file it was given, except `blind`, which puts its neutral copies in a new folder under the OS temp directory, away from the key. Only `iterate` runs the project's render commands, each as a program with its arguments and never through a shell.
- Environment: `PL_RUN` (the reason for a large run), `PL_DIR` (the state folder; `PERCEPTUAL_LOOP_DIR`, its first name, is still read), `PL_SHOTS_DIR` (the shots folder), `PL_FFMPEG` and `PL_FFPROBE` (the tools, when they are not on `PATH`), `PL_PYTHON` (the interpreter for the two optional extras), `PL_CACHE_DIR` (where `keypoints` keeps its models).

## Sheets

Every sheet fits `--max-width` (1568 px by default, the largest a vision model reads without shrinking it first), labels its panels in a built-in bitmap font, and draws colour difference (dE2000) on one fixed scale, 0 to 20 and above, so two sheets made apart compare by eye. A box is `x0,y0,x1,y1` in 0..1 of each picture's frame; a zoom enlarges with nearest-neighbour so pixels stay square. `iterate` draws one sheet per shot and candidate: reference, before, after, then what the run changed, where the edges differ (white both, magenta the reference only, green the candidate only), and the colour difference after the exposure and white-balance fit.

## Clips

A **clip** is a folder of frames read in name order, a video file, or a shot's clip (`--shot NAME --source ID`). A frame's number is its index in a video, from 0; in a folder it is the number in the file name when every name is one, else the position in name order, so `frame 17` is `000017.png` and every sheet and report says the same. Times are the number over the rate: a video's own, or `--rate` for a folder.

- `video compare` pairs frames by number (or after `--align`) and gives per frame `ssim` (mean over 7x7 windows of luma, at `--size` on the long side) and `psnr` (dB, 99 for identical); the gate is the worst frame's or the mean.
- `sweep` gives per series `maxStep`, `worstJump` (`step`, `localMedianStep`, `ratio`, `frame`), `flagged` frames, and `flicker`; per motion `judder`, `judderLocal`, `repeated`, `dropped`. Luma and colour series are in 0..1 of display-encoded values.
- `flow` gives per region and pair `dx`, `dy`, `mag`, `speed` (pixels of the original frame per frame step), `direction` (degrees, 0 right, 90 down), `coherence`, and the shares `moving`, `still`, and `unknown`, which sum to 1. A pixel with nothing to measure is unknown, never still.

## Sounds

A **sound** is a WAV file (PCM u8, s16, s24, s32, or float32 and float64, plain or extensible), anything ffmpeg reads, or a shot's sound (`--shot NAME --source ID`). Samples are floats in -1..1, integers scaled by their container's full range; the measurements use the mean of the channels, except loudness, which weights the channels as BS.1770 does, and the silence checks, which look at each channel.

- `probe` gives `rate`, `channels`, `samples`, `duration`, `peakDb` (sample peak, dBFS), `rmsDb`, and `lufs` (integrated, BS.1770-4; null with a `lufsNote` when shorter than 0.4 s or silent).
- `pitch` gives a track every 10 ms of `hz` and `confidence` (1 minus the YIN dip), and against an expectation `medianErrorPct`, `withinTolerance` (a share), `octaveErrors` (a share), and `medianRatio`.
- `onsets` gives `onsets` in seconds, and against expected times `matched`, `missed`, `extra`, and offsets in ms (+ is late).
- `compare` measures B against A: `lagMs` (+ is B later) with `lagFrom` (`waveform` or `envelope`), `levelDb` (+ is B louder), `lsdDb`, `bandsDb` (B - A per octave band, keyed by its centre in Hz), and `envelopeCorrelation`.
- Every gate is `{ passed, failed: [reasons] }`, and a failed gate exits 1.

## queue.json and decisions.json

```json
[{ "id": "sky-exposure", "title": "Sky exposure", "question": "Which exposure is right?", "context": "what differs and why",
   "images": [{ "label": "before", "path": "runs/iterate/sky_0/before.candidate.png", "compare": true }],
   "options": [{ "id": "keep", "label": "Keep the brighter sky" }, { "id": "revert", "label": "Go back" }],
   "recommended": "keep", "defaultOption": "keep",
   "evidence": [{ "label": "exposure fit", "value": "+0.30 EV" }], "verdicts": [{ "by": "agent", "verdict": "different-ok", "note": "..." }] }]
```

Picture paths are relative to the project root, or absolute. Two pictures marked `compare` get the page's slider and blink. The page exports `{ "decidedAt": "<ISO time>", "items": [{ "id", "option" (an option id, or null when the note is the ruling), "note" }] }`, which `review apply` reads.
