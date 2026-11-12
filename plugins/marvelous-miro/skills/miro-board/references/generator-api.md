# Writing a generator

A generator is a module whose default export is `generate(kit, ...args)`; it returns a scene. `build.mjs` imports it, passes the drawing kit (`scripts/scene-kit.mjs`, plus `systemMap`) and the view's `args`, so the generator never imports the plugin and keeps working when the plugin updates. The config that lists generators (`miro.config.mjs`) is documented in the header of `scripts/project.mjs`. `assets/gen-example.mjs`, which `init.mjs` copies into a new project, is a complete small generator to start from.

## The kit

| Name | What it is |
| --- | --- |
| `createScene()` | a new scene; every drawing call below is a method on it |
| `PAL` | colors by name (`blue`, `green`, `purple`, `yellow`, `gray`, `teal`, `orange`), each `{ bg, stroke }` |
| `INK`, `MUTED` | the text and connector colors |
| `TS`, `BS`, `PAD` | card title size (19), body size (14), card inner padding (16) |
| `tw(str, size)` | the width of a line of text, for sizing boxes |
| `wrap(str, width, size)` | greedy word wrap to a width, returns lines |
| `systemMap(mapFile)` | the whole scene of a committed system map (`diagrams/system-map.json`), laid out to the lint's rules; a system map's generator returns it and draws nothing itself |

## A scene's methods

| Call | Draws |
| --- | --- |
| `card(id, x, y, w, h, { color, title, body, sub, pill, dashed, boardAt })` | a colored card with a bold title and body lines; registers node `id` |
| `decision(id, x, y, w, h, label, { color })` | a diamond; the label's first line becomes its bold title |
| `rect(id, x, y, w, h, { bg, stroke, dashed, layer })` | a bare box: a band or group box when it holds two or more boxes, otherwise a card |
| `box(id, el)` | registers a `rect()` as a node arrows can attach to |
| `text(id, x, y, str, { size, color, align })` | loose text; 18px and up is bold |
| `arrow(id, from, to, pts, { label, color, dashed, both })` | a connector between two nodes; `pts` only picks the sides |
| `R(n)`, `L(n)`, `T(n)`, `B(n)` | the middle of a node's right, left, top, or bottom side, for `pts` |
| `nodes` | every registered node, `{ x, y, w, h, r, b, cx, cy }` |

Ids are unique within the scene and stable across builds: the build keys every board item by `<view key>-<id>`, so renaming an id deletes nothing on the board but orphans the old item and creates a new one. `pull.mjs` lists orphans as items on the board the generators do not know.

## How scene elements become Miro items

`scripts/miro.mjs` decides, so a generator only places things:

- Text inside a card becomes the card's content (first text bold); text outside every card stays a text item.
- An arrow's label becomes its caption.
- The frame is sized to the scene plus 40px until the board has a layout for it; after a pull, the board's size and position win.

## Strict frames

By default the build blocks only on firm findings about what it is about to publish. A finding on a connector route the predictor is known to miss is marked `(est)` and only warns, and so does a finding on an item this build leaves alone, because a frame people arrange by hand in Miro is settled by the live check.

A frame whose generator lays it out alone can opt into strict mode in `miro.config.mjs`:

```js
views: [
  { key: "pipeline", title: "Pipeline", gen: "./src/gen-pipeline.mjs", strict: true },
],
```

On a strict view:

- every lint finding blocks the build, estimated or not, and whether or not this build touches its items;
- the `direction` check runs: at least 80% of the main connectors (solid, one arrowhead) point right or down, where a connector points backward only when its end box is above, left of, or above and left of its start box.

Leave it off for frames people rearrange in Miro: there the board's layout wins, and estimated findings stay warnings until the live check sees the real routes.

Layout code that runs the lint itself calls `lint(model, { strict })` from `scripts/lint.mjs`, where `strict` is `true` (every frame) or a list of frame keys. Each finding carries `est` and `blocking`, which is true for a firm finding and for every finding on a strict frame. The same file exports `route` (Miro's default route between two boxes), `caption` (the box Miro draws a caption in), and `pointAt` (a point a fraction along a route), so layout code places things with the lint's own model.
