---
name: docs-shots
description: >
  Build, extend, or repair the project's documentation screenshot harness so
  every docs image is captured deterministically from the built product, never
  by hand: light and dark pairs, a fictional cast, pinned clock and seeds,
  cropped not scaled. Use when a page needs a new screenshot, a shot is stale
  or flaky, a project has no capture harness yet, or the user asks to "add a
  screenshot", "retake the screenshots", or "set up screenshot capture" for a
  web app, desktop app, CLI, game engine (Unreal), notebook, or mobile app.
---

# docs-shots

A screenshot in the docs is code output: a named shot, declared in the harness, made from a built artifact in
a state the harness sets up. That is what lets a change retake exactly the pictures it made wrong, and lets
two runs make the same picture. The contract every harness meets, in any language:
`${CLAUDE_PLUGIN_ROOT}/core/references/shot-contract.md`. Read it first.

## Step 1: Find or pick the harness

Look for an existing one before writing anything: a `capture/` or `screenshots/` folder, a `*.shots.*` file, a
Playwright project named for docs, an engine automation test that writes images, a `capture` command in
`.agents/docs-parity.json`. Extend what exists.

None exists: open `${CLAUDE_PLUGIN_ROOT}/core/references/capture-recipes.md` and take the recipe for the
stack. Reuse the project's end-to-end setup when it has one (its server start, its test users, its fixtures):
the harness is a second consumer of the same seams, not a fork of them.

*Done when: you know the file a new shot goes in and the command that runs one group.*

## Step 2: Make it deterministic before making it pretty

The determinism list is in the contract. Prove it: run one group twice and compare the two outputs. They
should be identical or differ only by encoder noise. With perceptual-loop installed, `sheet.py diff` measures
it; without it, compare the files' bytes or decode and diff the pixels in the harness's own language.

## Step 3: Declare the shot

- A name `<section>/<name>`, lowercase and hyphenated; the section is the docs area, not the code module.
- The state: who is signed in (the fictional cast), what data exists (seeded by the group, named so a re-run
  finds it), the clock, the route or scene, the interaction that reaches the moment.
- The frame: an element, a clip around a union of elements, or the window. Crop to what the text describes;
  never scale an image to fit a column.
- The themes the product has. Both, unless the docs only ever show one.

## Step 4: Run it, look at it, embed it

Run only the group you touched, on its own port or instance. Open every image written, every theme. Check:
the state the text describes, no real names, emails, tokens or internal features on screen, no loading
spinner, toast, focus ring or cursor that the text does not mention. Then embed it the target's way
(`targets.md`), with alt text that says what the picture shows.

If the harness writes a shots manifest (`images.manifest` in the config), the run updates it, so
`docs_check.py --stale` knows the commit each picture was taken from.

## Done when

The shot is declared in the harness, a rerun of its group writes the same picture, both themes were looked at,
the page embeds it the target's way, and `docs_check.py` reports no `IMAGE_*` finding for it.
