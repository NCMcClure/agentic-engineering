# The shot contract

What every docs screenshot satisfies, whatever made it. The recipes in `capture-recipes.md` are ways to meet
it in a given stack; the contract is the part that does not change.

## Made by the harness, never by hand

A picture in the docs is the output of a declared shot in the project's capture harness. Nobody saves a
screenshot from their own screen into the docs folder: it cannot be retaken when the screen changes, it shows
whatever happened to be in that person's account, and it is never the same twice.

## Names and files

- A shot's name is `<section>/<name>`, lowercase and hyphenated (`^[a-z0-9-]+/[a-z0-9-]+$`). The section is
  the docs area (`guide`, `export`, `admin`), not the code module.
- Output: `<images dir>/<section>/<name>.<ext>`, plus `<name>.dark.<ext>` when the product has a dark theme.
  The page embeds the light file; the target's mechanism finds the twin (`targets.md`).
- Format: WebP for a site or a wiki that renders it (a fraction of PNG's size, alpha kept, quality about
  0.85); PNG where the renderer is unknown. One format per project.
- Shots are grouped by docs area, one group per file, and **one group runs alone** (`--grep <group>`, a test
  filter, a commandlet argument). A change retakes the groups it affects and no others.
- Optionally the harness writes a manifest, `<images dir>/shots.json`:
  `{"shots": {"guide/export-menu.webp": {"commit": "<HEAD sha at capture>"}}}`. With it, the checker's
  `--stale` mode knows exactly when each picture was taken, even when a retake produced identical bytes.

## Size and crop

- Capture at device scale 2 (or the engine's 2x resolution) and show at 1x: the picture appears at the size
  it has in the product, sharp on a high-density screen.
- Fix a picture that is too big by **cropping** to what the text describes (an element, a union of elements,
  a clip), never by scaling it down. A scaled screenshot has text smaller than the reader's own screen.
- A fixed viewport per project (1440x900 suits most desktop web apps). Change it for one shot only when the text is about a
  narrow layout.

## Deterministic

Two runs of a group on the same commit make the same pictures. The usual causes of a difference, and the fix:

| Cause | Fix |
|---|---|
| The clock ("2 minutes ago", today's date) | pin it: a fixed time in the browser, a fake clock in the app, an engine time of day |
| Locale, time zone, fonts | pin them in the harness; wait for fonts to load before the shot |
| Random ids, seeds, ordering | seed everything; seed data in a fixed order with fixed names |
| Animation, transitions, carets, cursors, scrollbars, focus rings | disable them for the shot; move the pointer off the frame |
| Async loading, spinners, toasts | wait for an explicit ready signal, never a fixed sleep; hide transient UI |
| Remote and third-party data | fake it at the boundary (route interception, a stub server, a scripted model) |
| Temporal effects in a renderer (TAA history, auto-exposure, motion blur) | turn them off or render warm-up frames and take a settled one |
| Leftover state from the last run | a fresh database, profile, or save per run and per port |

## Isolated

The harness starts the **built** product itself, on its own port or instance with its own scratch data, and
stops it after. It never uses the developer's running server or their data, so two agents can capture in
parallel and nobody's work leaks into a picture. This is the one sanctioned place an agent starts the product
for the docs.

## Safe to publish

- A **fictional cast**: the same few people in every shot (Alice, Bob, Carol, an Admin) at a domain that can
  never resolve (`example.invalid`). Seed history from fiction too, never by importing real commits or logs.
- **Mask secrets** that appear on screen (a device code, an API key field, a token) before the shot, by
  replacing the text in the page or covering the element.
- **No internal or unreleased features** in any picture, including behind-flag UI the seed data happens to
  show.
- No production build, account, or environment is ever photographed.

## Looked at

A shot is done when someone has looked at every image it wrote, every theme: the right state, nothing secret
or real, nothing transient, cropped to the text. An agent opens the files and looks; "the run passed" is not
looking.
