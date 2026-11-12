---
name: miro-board
description: Draw a Miro board from code and keep it legible, with a lint before publishing and a live check after. Use when drawing or updating a diagram, flow, or architecture frame on Miro. Also use when a project has a miro.config.mjs, when a board has overlapping cards, crossed or diagonal connectors, or text that does not fit, or when layout changes made in Miro need to reach the repo.
---

# miro-board

A project's Miro frames are code. Generators draw scenes; `build.mjs` turns them into canvas-composer SVG and writes nothing while the legibility lint finds a problem; the Miro MCP publishes; `live.mjs` lints what Miro actually drew; `pull.mjs` brings the board's layout back, so a card moved in Miro survives the next build. The lint is the reviewer: never zoom in on the board hunting for overlaps, and never place items by eye.

`S` below is `${CLAUDE_PLUGIN_ROOT}/skills/miro-board/scripts`. Run every script from the project root; each one finds `miro.config.mjs` there or in `diagrams/` (or takes `--config <path>`).

The tools come from two servers, and both are the person's own sessions:

- **Miro MCP:** `canvas_create_from_svg`, `canvas_update_from_svg`, and `canvas_read_as_svg`. If it is missing, ask the person to connect it: the Miro connector, or `claude mcp add --transport http miro https://mcp.miro.com/`.
- **Browser:** `list_pages`, `new_page`, and `evaluate_script`, from this plugin's `miro-browser` server or any chrome-devtools server whose browser is signed in to Miro. If they are missing, ask the person to run `/marvelous-miro:browser-setup` before Step 3; it is theirs to run.

No script here takes a token, and nothing about the board's access is written to the repo: `miro/board.json` holds the board's URL and item ids, nothing else. Never type credentials into Miro, and never ask for them in chat. Publish only to the board the config names; create a board, or change who can see one, only when the person asks.

## Step 0, Start a project (once)

If the project has no `miro.config.mjs`, get the board URL from the person (create a board with `board_create` only if they ask for a new one), then run `node S/init.mjs diagrams --board <url>`. It writes the config, an example generator, `miro/board.json`, and the `.gitignore` lines.

*Done when: `node S/build.mjs` prints "a new frame" for the example view.*

## Step 1, Draw

Write or change a generator and list it in the config's `views`.

- [references/generator-api.md](references/generator-api.md) holds the kit and the generator contract.
- [references/how-miro-draws.md](references/how-miro-draws.md) holds the layout rules. Read it before laying out a frame, and whenever a lint finding needs explaining.

Then run `node S/build.mjs`. On a lint error or a config `check` problem it exits 1 and writes nothing. Fix the generator; the lint encodes how Miro really draws, so never loosen a check to get past it. Findings marked `(est)` rest on a connector route the predictor is known to miss; they are warnings, and Step 3 settles them. On a view marked `strict` (a frame the generator lays out alone) every finding blocks. After changing a generator's layout logic, use `--relayout <frame>` to send its geometry in place of the board's.

*Done when: `build.mjs` exits 0 and names the files to publish.*

## Step 2, Publish

Send each file the build named, in the order it named them, to the board in `miro/board.json`:

- **`<frame>.svg`, a new frame:** send it with `canvas_create_from_svg`, then save the full result to `miro/create-<frame>.json`, because Step 4 needs its ids.
- **`<frame>.update.svg`:** send it with `canvas_update_from_svg`.
- **`<frame>.resize.svg`:** send it last, with `canvas_update_from_svg`.

Never edit these files by hand. An error such as "connector endpoint unresolved" means the files are stale: rebuild and send again.

*Done when: every named file was accepted.*

## Step 3, Live check

1. Run `node S/live.mjs prepare`. It prints the board URL and the `sourcePath` and `filePath` that `evaluate_script` needs, both inside the project.
2. Use `list_pages` to find the tab whose URL holds the board id, or open the board with `new_page`. If Miro shows a sign-in page, ask the person to sign in in that browser window and wait.
3. Call `evaluate_script` with that tab's `pageId`, `sourcePath`, and `filePath`.
4. Run `node S/live.mjs check --frames <the frames you published> --verbose`.

Each finding names its check and its items. Fix it in the generator and go back to Step 1. After three rounds, stop and list the remaining findings for the person. Take a screenshot only for questions of taste.

Where there is no local browser (a cloud or remote session), say that the live check did not run and stop after Step 2; a board that was never checked live is not reported as checked.

*Done when: `live.mjs check` prints "live board legible: no findings" for the published frames, or the residual findings are reported.*

## Step 4, Pull

1. If you created a frame, run `node S/pull.mjs miro/create-<frame>.json` first. It records the new frame and its items' board ids.
2. Read the published frames with `canvas_read_as_svg`. The frame ids are in `miro/board.json`.
3. Save the read and run `node S/pull.mjs <saved read>`.
4. Run `node S/build.mjs --published` to record what the board now holds.

If the create result was lost, read the new frame and run `pull.mjs <read> --adopt <frame>`, which matches items by position and connectors by their ends.

When `pull.mjs` lists items "on the board but not in any generator", show them to the person. Never delete board items without their yes.

When the person has only rearranged things in Miro, run this step on its own.

*Done when: `node S/build.mjs` prints "board up to date" for every frame. Then commit `miro/` with the generator change.*
