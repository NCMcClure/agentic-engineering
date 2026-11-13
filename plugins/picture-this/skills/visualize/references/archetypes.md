# Archetypes

An archetype is a kind of picture. The lens (`lenses.md`) says which kinds
fit a subject; this file says what each is and how to make one. The plugin
ships a working starter for most: `draft archetypes` lists them, and
`draft new` copies one into each draft. A round uses three different ones, so
the choice is between forms and not between shades of one.

| Archetype | Reach for it when | The picture | What moves |
|---|---|---|---|
| `iso-flow` | the story is a path: a request, a job, a message going somewhere | things in a line on the ground, a wire per flow | pulses along the wire being told; the thing it reaches takes the accent |
| `layer-stack` | the system is layers: a request passing down through them, one platform on another | wide slabs stacked, the first on top | the layer a flow reaches lifts and takes the accent |
| `staged-build` | the point is why each part is there | the same ground, built up | each part arrives with its beat; its wire is laid as it does |
| `split` | the point is a difference: before and after, without and with | two rows, one behind the other, each named | the story tells one row, then the other |
| `card-flow` | labels are long, notes matter, or the figure sits in running prose | flat cards joined by soft threads | a pulse on the thread being told |
| `case-loop` | the system is a handful of separate cases: hit and miss, success and failure | one small tile per beat | only the tile being told |
| `series` | it must work as a still: a README, a slide, a printed page | one small panel per beat, each a held frame | nothing but the mark under the panel being told |
| `blank` | the lens calls for a view with no starter (an exploded view, a cutaway, a time grid, a field, a mapping, a zoom), or the subject has a shape of its own | whatever you draw, with the kit's helpers | whatever the mechanism does |

`blank` is named for the view it will become, and may be used more than once
in a round under different names:

```
draft new --model <file> --archetypes iso-flow,blank:exploded,blank:time-grid
```

## Choosing three

Start from the lens. It names the views that can show the mechanism at all;
choose three of them, or two and one from a neighbouring lens for contrast.

| Lens | Draft from |
|---|---|
| structure | `layer-stack`, `blank:exploded`, `blank:cutaway` |
| path | `iso-flow`, `card-flow`, `staged-build` |
| time | `blank:time-grid`, `series`, `staged-build` |
| field | `blank:grid`, `blank:surface`, `series` |
| transformation | `blank:mapping`, `split`, `series` |
| difference | `split`, `series`, `case-loop` |
| cases | `case-loop`, `split`, `iso-flow` |
| scale | `blank:zoom`, `layer-stack`, `series` |

Then let the claim break ties:

- A claim about **order** ("answers before the work starts"): `iso-flow`,
  `staged-build`, `series`.
- A claim about **structure** ("each layer only talks to the one below"):
  `layer-stack`, `iso-flow`, `card-flow`.
- A claim about **difference** ("with a queue, the upload stops waiting"):
  `split`, `series`, `iso-flow`. A `split` needs a model whose entities carry
  a `group`.
- A claim about **cases** ("a miss costs one extra read"): `case-loop`,
  `split`, `iso-flow`.

Make the three as unlike each other as the claim allows: one isometric, one
flat, one that holds still, for instance. If two of the three would look alike,
swap one.

## What a starter is

A starter draws whatever model sits beside it, straight away, on a default
layout. That first render is a starting point, not a draft. Making it this
model's picture means:

- **Placing things by hand.** Move the boxes so the path reads at a glance,
  related things sit together, and no wire passes behind a shape.
- **Fixing every collision.** A word over another word, a label over a shape,
  a wire's word on top of a label.
- **Choosing what carries the accent.** One thing per beat.
- **Cutting.** A note that says what the label already says, a ground outline
  that adds nothing, a second line of text nobody needs.
- **Adding what only this system has.** A count on a queue, a file name on a
  store, the one detail that makes it this system and not any system.

## Drawing on the blank starter

The blank starter sets up the stage and draws a placeholder: the model's
entities as slabs pulled apart along one axis. Replace the placeholder with
the view the lens calls for. What the kit gives you (`kit/README.md` has the
detail):

- `project` turns a ground point into a screen point; `plate`, `block` and
  `disc` give the outlines of a slab, a box and a circle on the ground.
- `Face` draws any outline in the house style, so a part can have its own
  shape. `Guide` draws a dashed line: where a part returns to, a path through
  empty space.
- `Label`, `Wire`, `Block`, `Plate`, `Layers`, `Cylinder` and `Ground` work
  in any view.
- A flat view (a time grid, a mapping) can ignore the isometric helpers and
  draw plain SVG inside the stage, with the kit's classes for line and text.

How each view is usually built:

- **Exploded**: parts in their real order along one axis, pulled apart, with
  guides at two corners. The gap is wide enough to see each part's top.
- **Cutaway**: the thing's real outline, one side open, the inside drawn in
  place. What is cut is drawn with a heavier edge.
- **Time grid**: stages as rows, ticks as columns, a token per unit of work.
  A token's place is a function of the tick, so every token steps together.
- **Grid or surface**: cells tinted by value in steps of the accent; or a
  wireframe over a plane, drawn back to front.
- **Mapping**: the input on one side, the output on the other, and the rule
  between them applied to one element per beat.
- **Zoom**: the whole, a ring on one region, two lines out to the
  enlargement. The enlargement uses the same vocabulary as the whole.

Everything is still a function of the frame: read `useFigure()`, compute,
draw.

## Isometric layout

Ground coordinates are `[x, y, z]`: x runs down to the right, y down to the
left, z up. A flow along x reads left to right and downhill.

A shape hides the ground behind it, and that is where the wire to it arrives.
Keep shapes under one unit tall and at least two units apart, and a pulse is
in view for most of its trip. When a wire must pass something, send it round
the front on a lane of its own.

Labels are flat, upright, and drawn last. They never lie on the isometric
plane.
