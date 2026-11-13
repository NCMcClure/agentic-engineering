# The picture-this kit

What a figure draws with. This folder was copied into your repo and is yours:
restyle `kit.css`, change a shape. `kit.json` records each file as it was
written, so a later `kit install` updates only what you have not touched.

A figure is a folder holding `figure.tsx` and the `model.json` it draws:

```tsx
"use client";
import type { Model } from "../kit/model";
import { Stage } from "../kit/stage";
import type { StageProps } from "../kit/stage";
import { extent, row } from "../kit/iso/place";
import { fitBox } from "../kit/iso/project";
import { IsoScene, standing } from "../kit/iso/scene";
import data from "./model.json";

const model = data as Model;
const BOX = standing(model.entities, row(model.entities.map((e) => e.id)));
const VIEW = fitBox(extent(Object.values(BOX)).points, 42, [88, 40, 30, 40]);

export default function Figure(props: StageProps) {
  return (
    <Stage model={model} unit={42} viewBox={VIEW} {...props}>
      <IsoScene boxes={BOX} />
    </Stage>
  );
}
```

`{...props}` must reach the `Stage`: it is how a page, the studio, and the
camera choose the theme, hold a frame, and pick the caption track.

## The one rule

A figure is drawn as a function of its clock. Nothing in a figure or the kit
moves on its own: no `@keyframes`, no `transition`, no timers, no randomness.
Read the frame, compute what to draw, draw it. That is why a still is an exact
frame of the live figure, and why any moment can be held and photographed.

## The stage

`<Stage model viewBox unit {...props}>` is the frame: the clock, play when in
view, the caption, the claim, the scrub strip. Its props:

| Prop | What it does |
|---|---|
| `theme` | `"light"` or `"dark"`. Left out, the figure follows the page (`.dark`, `[data-theme="dark"]`). |
| `beat`, `at` | Where to start: a beat's id, and a point inside it (0 to 1). Left out, the model's hero frame. |
| `still` | Hold that one frame: no clock, no strip. |
| `audience` | `"plain"` or `"technical"` captions. |
| `captions`, `controls`, `autoplay` | On unless set to `false`. |
| `build` | Each part arrives with the beat that first tells it. Off, everything is there from the start and only the focus moves. |

Leave `viewBox` out and the stage draws HTML instead of SVG (see `flow/`).

Inside a stage, `useFigure()` answers the questions a drawing asks:

| Call | Returns (0 to 1) |
|---|---|
| `f.here(entity)` | has it arrived |
| `f.lit(entity)` | is the story on it now (everything is lit while the loop rests) |
| `f.arriving(entity)` | is it the one thing this beat is about (what the beat's leading flow arrives at) |
| `f.laid(flow)` | has its wire been laid |
| `f.moving(flow)` | is it moving now |
| `f.phase(laps, offset)` | where a pulse is along its wire |

`f.frame` is the beat and the progress through it; `f.model`, `f.tl`,
`f.audience` and `f.unit` are there too. `<Hold beat="..." build>` draws its
children at one held frame whatever the clock says: a panel of a series.

## Isometric

Ground coordinates are `[x, y, z]`: x runs down to the right, y down to the
left, z up. `unit` is px per ground unit.

- `iso/shapes`: `Block`, `Plate`, `Layers`, `Cylinder`, `Ground`, and `Thing`,
  which picks one from an entity's `kind` (a queue is a stack, a store a drum,
  a client a slab). Give a shape `entity="id"` and its arrival and focus come
  from the model; `accent` takes it toward the accent colour.
- `Face` (also in `iso/shapes`) draws any outline in the house style, for a
  part with a shape of its own; `Guide` draws a dashed line between two ground
  points: where a part returns to, a path through empty space.
- `iso/wire`: `<Wire flow="id" via={[[x,y,z], ...]} />`. Its kind sets its
  line (a write is heavier, a query is dashed, a read's mark and pulses run
  home), and every wire carries a small mark for the way it runs. `part="line"` and `part="tag"` draw the line and
  its word separately, so the word can go over the shapes.
- `label`: `<Label entity="id" at={[x,y,z]} sub="..." dx dy anchor />`, flat
  and upright with a hairline leader. Labels are drawn last.
- `iso/place`: `row`, `grid`, `hop` (the wire between two boxes), `around`,
  `extent`. `iso/project`: `project`, `fitBox`, `plate`, `block`, `smooth`,
  `slice`, `along`.
- `iso/scene`: `<IsoScene boxes={...} />` draws the whole model on a layout:
  ground, wires, shapes, words, labels. `only`, `ground`, `labels`, `notes`,
  `rise` trim it; children are drawn between the shapes and the words.

A tall shape hides the ground behind it, which is where a wire to it arrives.
Keep shapes low (under one unit) and well apart (two units or more).

## Flat

`flow/flow`: `<Flow rows={[["a","b"],[null,"c"]]} />` lays real cards on a
grid and draws threads between them once they have been measured. Use it when
the words matter more than the shape.

## In prose

`term`: `<Term hue="blue">Resizer</Term>` gives a word in the surrounding text
the mark its entity carries in the figure.

## Colour

Tokens live on `.pt-stage` in `kit.css`: neutrals (`--pt-bg`, `--pt-ink`,
`--pt-line`, `--pt-line-2`), the accent (`--pt-accent`, for where the story is
now and nothing else), and five entity hues (`--pt-hue-blue` and so on, for
telling things apart). Fonts are `--pt-font-sans` and `--pt-font-mono`: set
them on the page, or the figure inherits the page's.
