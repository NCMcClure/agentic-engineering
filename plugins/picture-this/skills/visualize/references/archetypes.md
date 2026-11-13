# Archetypes

An archetype is a kind of picture. The plugin ships a working starter for
each: `draft archetypes` lists them, and `draft new` copies one into each
draft. A round uses three different ones, so the choice is between forms and
not between shades of one.

| Archetype | Reach for it when | The picture | What moves |
|---|---|---|---|
| `iso-flow` | the story is a path: a request, a job, a message going somewhere | things in a line on the ground, a wire per flow | pulses along the wire being told; the thing it reaches takes the accent |
| `layer-stack` | the system is layers: a request passing down through them, one platform on another | wide slabs stacked, the first on top | the layer a flow reaches lifts and takes the accent |
| `staged-build` | the point is why each part is there | the same ground, built up | each part arrives with its beat; its wire is laid as it does |
| `split` | the point is a difference: before and after, without and with | two rows, one behind the other, each named | the story tells one row, then the other |
| `card-flow` | labels are long, notes matter, or the figure sits in running prose | flat cards joined by soft threads | a pulse on the thread being told |
| `case-loop` | the system is a handful of separate cases: hit and miss, success and failure | one small tile per beat | only the tile being told |
| `series` | it must work as a still: a README, a slide, a printed page | one small panel per beat, each a held frame | nothing but the mark under the panel being told |
| `iso-flow-3d` | the story is a path, and the figure is a page's centrepiece | the isometric flow in clay, glass and soft shadow | pulses along the wire being told; the thing it reaches turns the accent |
| `layer-stack-3d` | the system is layers, and the figure is a page's centrepiece | cards of frosted glass stacked, the first on top | the card a flow reaches lifts and fills with the accent |

## Choosing three

Start from the claim, not from the system.

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

## When to draw in 3D

The two 3D archetypes are their 2D twins, lit: the same layout, the same
model, the same motion. They say nothing a 2D figure cannot. What they buy is
presence, so they are for the one figure a page is built around, not for the
fourth diagram in a reference page.

- **At most one 3D draft in a round**, and never beside its own twin: a round
  of `iso-flow` and `iso-flow-3d` compares finishes, not forms.
- **Drafting one costs the repo nothing.** The studio draws it, and its stills
  are plain PNGs. A README-only repo can use 3D freely.
- **Showing one live costs the site three packages**: `three`,
  `@react-three/fiber` and `@react-three/drei`. Ask before adding them; the
  skill's deliver step says when.
- A 3D still takes a few seconds, where a 2D one takes a fraction of one.

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

## Isometric layout

Ground coordinates are `[x, y, z]`: x runs down to the right, y down to the
left, z up. A flow along x reads left to right and downhill.

A shape hides the ground behind it, and that is where the wire to it arrives.
Keep shapes under one unit tall and at least two units apart, and a pulse is
in view for most of its trip. When a wire must pass something, send it round
the front on a lane of its own.

Labels are flat, upright, and drawn last. They never lie on the isometric
plane.

All of this holds in 3D, where it matters more: a 3D shape really is in front
of the wire behind it, and a label is still flat SVG laid over the canvas. A
3D figure uses the same boxes, so a layout worked out in 2D carries over as
it is.
