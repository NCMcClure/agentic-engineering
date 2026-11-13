# Views and studies

A **view** is a kind of picture: what is on the page, what each mark stands
for, and what moves. It is designed from the subject, after the lens
(`lenses.md`) and before any drawing. A **study** is a figure the plugin
ships, drawing one view of one example, so that a technique can be read and
borrowed. This file is how to design a view, what views there are to think
with, and what the studies are for.

The rule that matters: **a study is reached for only when its view is the
view.** Most subjects have a picture of their own, and it starts on the blank
stage. A round of three is rarely three studies. If it is, ask whether the
subject was looked at or a template was filled in.

## Designing a view

A view answers five questions. Answer them in words before drawing.

1. **What is the page?** The thing itself seen from outside, a cut through
   it, a ground things stand on, a chart with time along it, a window onto a
   record, a table. A subject with a shape people know is drawn as that shape.
2. **What does each axis mean?** Across and down are the two strongest
   things a picture has. Give each one a meaning (time, order, depth, who
   started what, how much) or say that it has none.
3. **What is each mark?** One kind of mark per kind of thing: a row is a
   turn, a dot is a job, a slab is a layer. Count the kinds; past four the
   reader is learning a legend.
4. **What moves?** The mechanism's verb, and nothing else. Scrolling is time
   passing in a record. Sliding out is one thing starting another. Filling
   is a quantity building up.
5. **Where is the number?** If the claim is about how much (how full, how
   many, how long), something on the page is drawn to scale and the reader
   can compare two of them.

Then write the **view statement**: three short answers, in the draft's
`view.json`, before the first line of the figure.

```json
{
  "view": "transcript",
  "base": "blank",
  "drawn": "Each session's context window is a column of rows, one row per turn. A session a turn starts is a smaller column to the right of that turn, joined to it by a right-angled line.",
  "moves": "Rows scroll up as turns are added. A row turns orange as it hands work off, and the new column slides out along the line. The meter beside a column rises with its rows and drops when it is compacted.",
  "means": "Down is time. Right is started-by. Row tone is who spoke. Orange is the turn that is delegating now; an orange tint is one that did. Meter height is tokens used against the limit."
}
```

`draft check` will not pass a round until every draft has said all three, and
it prints them, so the person reads what each draft set out to draw beside
what it drew. A statement that cannot be written is a view that has not been
designed yet.

## Views to think with

Not a list to choose from. These are views that have explained things before,
grouped by the lens that usually leads to them, to widen what comes to mind.
The right one is often a blend, or none of them.

| Lens | Views |
|---|---|
| structure | the parts pulled apart along one axis, with dashed guides back to where they sit; a cutaway with the inside drawn in place; layers stacked; boxes inside boxes; a tree of what holds what |
| path | places on a ground with a wire per hop; cards joined by threads; a route drawn on the thing's own outline; lanes, one per actor, with the message crossing between them |
| time | stages by ticks with a token per unit of work; a transcript that scrolls; lanes along a time axis, each with a level that rises and resets; queues of work draining through workers |
| field | a grid of cells tinted by value; a wireframe surface over a plane; a strip of values along a line; contours |
| transformation | input, rule and output in one frame; an outline sampled onto a grid; a shape projected onto a plane; a list before and after a sort |
| difference | the same parts twice, side by side; one drawn over the other; small multiples of one frame under different settings |
| cases | one tile per case; a fork with one branch lit; a table of outcomes |
| scale | the whole, a ring on a region, and the region enlarged; a chain of zooms, each inside the last; a ruler of sizes |

A second lens goes on the other axis, inside each unit, over the picture as
one mark, or beside it as an inset: `lenses.md`, section 3.

## The studies

`draft studies` lists them. Each is a complete figure with an example model:
read its `figure.tsx` to see how a technique is done with the kit.

| Study | Its view | Lens | What to learn from it |
|---|---|---|---|
| `iso-flow` | things in a line on a ground, a wire per flow | path | placing boxes, routing wires, pulses that say which way |
| `card-flow` | flat cards joined by threads | path | a figure whose words are long, laid out by the page |
| `staged-build` | the same ground, built up part by part | path | parts that arrive with their beat |
| `layer-stack` | wide slabs stacked, the first on top | structure | lifting the part a beat is about |
| `split` | two arrangements, one behind the other | difference | drawing two things in one vocabulary |
| `case-loop` | one small tile per beat | cases | isolating a case, and stepping focus between tiles |
| `series` | one small held panel per beat | any, as a still | holding frames with `Hold`, for a figure that must work printed |
| `time-grid` | stages by ticks, a token per unit, trails left behind | time | mapping the clock to ticks, tokens that step together, a meter beside a grid |
| `cell-field` | a table of cells tinted by value, filled in order | field | revealing cells with the clock, the accent on the cell being worked out |
| `iso-flow-3d` | the isometric flow, lit | path | the 3D tier: materials, flat labels over a canvas |
| `layer-stack-3d` | the layer stack in frosted glass | structure | glass, and lifting in 3D |

Transformation and scale have no study yet. Their views are drawn on the
blank stage, like any view a study does not cover.

## Choosing three

A round is three views of one model, as unlike each other as the claim
allows, so the choice is between pictures and not between shades of one.

```
draft new --model <file> --views transcript,lanes,ledger
draft new --model <file> --views exploded,cutaway,layers=layer-stack
```

- Name each view for **what it draws**: `transcript`, `exploded`, `lanes`,
  `ledger`. A study's name is not a view of your subject, and `draft new`
  refuses one given bare.
- A view starts on the blank stage. `<view>=<study>` starts it from a study,
  and is for one case only: the study's view, as it stands, is what this
  subject wants, and what changes is the layout and the detail.
- Vary what the page is, not how it is finished: one that is the thing's own
  shape, one that is a chart of it, one that holds still, for instance. One
  flat and one isometric differ more than two flat ones.
- Start from the lens's views, and take one from a neighbouring lens for
  contrast when the claim allows it.
- If two of the three would look alike, replace one.
- Two drafts never start from the same study.

Let the claim break ties: a claim about **order** wants time or path on the
long axis; about **how much**, something drawn to scale; about a
**difference**, both sides in one frame; about **what is inside**, the thing
itself opened.

## When to draw in 3D

The two 3D studies are their 2D twins, lit: the same layout, the same model,
the same motion. They say nothing a 2D figure cannot. What they buy is
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

## Starting from a study

A study draws whatever model sits beside it, straight away, on a default
layout. That first render is a starting point, not a draft, and `draft check`
fails a draft that is still the study as shipped. Making it this model's
picture means:

- **Placing things by hand.** Move the boxes so the path reads at a glance,
  related things sit together, and no wire passes behind a shape.
- **Fixing every collision.** A word over another word, a label over a shape,
  a wire's word on top of a label.
- **Choosing what carries the accent.** One thing per beat.
- **Cutting.** A note that says what the label already says, a ground outline
  that adds nothing, a second line of text nobody needs.
- **Adding what only this subject has.** A count on a queue, a file name on a
  store, a shape of its own, the one detail that makes it this system and not
  any system.

If the last item comes up empty, the study was the wrong start: `review.md`
has the test.

## Drawing on the blank stage

The blank stage sets up the stage, the clock and the model, and draws
nothing. The kit is a vocabulary, not a set of layouts: take the shapes the
view needs (`kit/README.md` has each one's props) and place them yourself.

**Flat space** is the page's own coordinates, in px. Reach for it when the
subject is a record, a window, a chart, a table, or a page.

- `Panel` is a framed box that clips what it holds; `Rows` is a column of
  bars inside one, scrolled by an offset you read off the clock; `Spawn` is a
  panel sliding out of the end of a connector.
- `Elbow` is a right-angled connector with rounded corners and an arrowhead,
  between any two points; `Token` is one unit of work and `Queue` a line of
  them.
- `Meter` is a number against its limit; `Cells` a grid tinted by value;
  `Lanes` the ruled ground of a time grid.
- `geometry` says where things are before they are drawn: `anchor`, `elbow`,
  `column`, `windowed`, `bar`, `slotIn`, `cell`.

**Isometric space** is a ground, x down to the right, y down to the left, z
up. Reach for it when the subject is things standing in space.

- `project` turns a ground point into a screen point; `plate`, `block` and
  `disc` give the outlines of a slab, a box and a circle on the ground.
- `Face` draws any outline in the house style, so a part can have its own
  shape. `Guide` draws a dashed line: where a part returns to, a path through
  empty space.
- `Block`, `Plate`, `Layers`, `Cylinder`, `Ground` and `Wire` are the usual
  shapes.

`Label` names a thing in either space, and plain SVG with the kit's classes
draws anything else.

How some views are usually built:

- **Exploded**: parts in their real order along one axis, pulled apart, with
  guides at two corners. The gap is wide enough to see each part's top.
- **Cutaway**: the thing's real outline, one side open, the inside drawn in
  place. What is cut is drawn with a heavier edge.
- **Time grid**: stages as rows, ticks as columns, a token per unit of work.
  A token's place is a function of the tick, so every token steps together.
- **Transcript**: a window, rows scrolling through it at the rate turns are
  added, and whatever a row starts drawn beside the row.
- **Grid or surface**: cells tinted in a few even steps; or a wireframe over
  a plane, drawn back to front.
- **Mapping**: the input on one side, the output on the other, and the rule
  between them applied to one element per beat.
- **Zoom**: the whole, a ring on one region, two lines out to the
  enlargement. The enlargement uses the same vocabulary as the whole.

Everything is a function of the frame: read `useFigure()`, compute, draw.

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
