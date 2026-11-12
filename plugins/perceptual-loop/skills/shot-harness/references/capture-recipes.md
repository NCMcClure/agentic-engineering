# Capture recipes

How to turn "render these shots" into a deterministic command, per kind of project. Each recipe ends by writing `<source>.png` (and any helper passes) into each shot's folder and exiting non-zero on failure.

## A web page or a component, through a headless browser

- **A shot's state:** the URL, the viewport, the device scale, the colour scheme, the data fixture, and the interaction that reaches the state.
- **Determinism:** freeze the page clock, turn off animations and transitions (a style tag, or `prefers-reduced-motion`), wait for `document.fonts.ready` and an idle network, stub random and remote data with fixtures, and hide carets and scrollbars.
- **Regions:** boxes from element bounding rectangles, written into `shot.json` `regions` at capture time (one per component), or a mask drawn by toggling a class.
- **Reference:** the design export at the same viewport, or the production build's capture of the same state.

## A game engine or a 3D renderer

- **A shot's state:** a recorded instant (the scene, object transforms, the camera, the time of day, the seed). Replaying a recording to an instant and pausing is the reliable way to give two renderers the same moment.
- **Determinism,** beyond the causes in the skill's step 2: wait for shader and asset builds before the first shot, and fix or settle exposure.
- **Passes:** a second render with flat id materials (`id`), unlit base colour (`albedo`), a subject mask.
- **Cost:** start the application once and render every requested shot in that process.

## A command line or a terminal UI

- Render the output through a terminal emulator with a fixed size, font, and theme, or compare the text directly and keep pictures for looking at only.
- **Determinism:** a fixed locale, time zone, width, and colour setting, and fixture inputs.

## Generated images, with no aligned reference

- **A shot's state:** the prompt, the seed, the model, and its parameters, in `meta`.
- The reference is a prompt, a style image, or an earlier accepted output: pixel metrics apply only between runs of the same seed, and the look itself is the owner's to judge.
- Where Python and torch are installed, the optional `pl.mjs semantic` gives image to image and image to text similarity to gate and rank with (`pl.mjs semantic --help` says what it found); it is a signal, never a verdict.

## A manual or expensive reference

- Capture it in a batch, once; keep the capture procedure beside the shots; archive replaced references by date.
- Capture again only when the reference itself must change (new content, new conditions, a changed state format), and only the shots that need it.
