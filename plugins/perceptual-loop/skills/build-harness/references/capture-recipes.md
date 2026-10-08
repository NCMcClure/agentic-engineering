# Capture recipes

How to turn "render these shots" into a deterministic command, per kind of project. Each recipe ends by writing
`<source>.png` (and helper passes) into each shot's folder and exiting non-zero on failure.

## Web page or component (Playwright or the like)

- State of a shot: URL, viewport, device scale, colour scheme, the data fixture, the interaction to reach the state.
- Determinism: freeze time (`page.clock`), disable animations and transitions (a style tag, or
  `prefers-reduced-motion`), wait for fonts (`document.fonts.ready`) and for network idle, stub random and remote
  data with fixtures, hide carets and scrollbars.
- Regions: boxes from element bounding rectangles written into `shot.json` `regions` at capture time (one per
  component), or a mask drawn by toggling a CSS class.
- Reference: the design export at the same viewport, or the production build's capture of the same state.

## Game engine or 3D renderer

- State of a shot: a recorded instant (scene, object transforms, camera, time of day, random seed). Replaying a
  recording to an instant and pausing is the reliable way to give two renderers the same moment.
- Determinism, beyond the general causes in the skill's step 2: wait for shader and asset builds to finish before
  the first shot, and fix or settle exposure.
- Passes: a second render with flat id materials (`id`), unlit base colour (`albedo`), a subject mask.
- Cost: start the application once and render every requested shot in that process.

## Command-line or terminal UI

- Render the output to an image through a terminal emulator with a fixed size, font and theme, or compare text
  directly and keep images for the sheet only.
- Determinism: fixed locale, time zone, width, colour settings; fixture inputs.

## Generated images (no aligned reference)

- State of a shot: prompt, seed, model and parameters, written into `meta`.
- The reference is a prompt, a style image or an earlier accepted output: use `semantic.py` (similarity and
  image–text scores), `keypoints.py` for characters, and the owner's queue; pixel metrics only between runs of the
  same seed.

## Audio and clips

- A sound is a pass: write `<source>.wav` at a fixed rate; a clip is `<source>.mp4` or a `frames/<source>/` folder.
- Determinism: a fixed duration from a fixed start state, no device in the path (render offline or tap before the
  output), levels fixed.
- Reference: a recording of the real thing made the same way, or the expected signal (a frequency for a given
  speed, onset times).

## A manual or expensive reference

- Capture it in a batch, once; store the capture procedure next to the shots; archive replaced references by date.
- Re-capture only when the reference itself must change (new content, new conditions, a changed state format), and
  only the shots that need it.
