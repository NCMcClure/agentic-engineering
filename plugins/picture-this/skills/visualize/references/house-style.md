# The house style

One look, for every figure. It is fixed so that three drafts differ in form
and not in decoration, and so that a repo's figures look like one set.

## Colour

- **Monochrome first.** Neutrals carry the picture: a page colour, three face
  tones, ink, a quieter line. A figure should read in greyscale.
- **One accent: orange.** It marks where the story is now: the pulse on the
  wire being told, the one thing the beat is about. Nothing else is fully
  orange. If two things are orange in one frame, one of them is wrong.
- **A tint of the accent remembers.** A part the story marked earlier and
  will come back to (a cell already worked out, the cut that was wrong)
  may keep a pale fill of the accent with its hairline. It is quieter than
  ink, so the one full accent still leads.
- **Hues only to tell things apart.** Blue, green, violet, yellow, pink, on
  two to four entities, as a dot on the label. One hue alone tells nothing
  apart and leaves a reader wondering what it means. A hue never means "good"
  or "bad", and never repeats the accent's job.
- **Dim by colour, not by opacity.** What the story has left keeps solid
  faces and moves toward the page colour. A see-through shape stops hiding
  what is behind it.
- **Light and dark from the same drawing.** Colours are the tokens in
  `kit.css`; a figure never writes a hex value of its own.

Every colour has a job. Point at one and name it: page, face, ink, quiet
line, accent, hue. A colour with no job is decoration, and it goes.

## Line

- Hairlines: one pixel, at any size the figure is shown.
- Every wire carries a small mark for the way it runs, so a still says so
  too. The line says what kind of flow it is: a write is a little heavier, a
  query is dashed, a read's mark and pulses run back to whoever asked, an
  event is a plain line.
- Corners are rounded a little. Wires run along the ground's axes, never at
  an arbitrary angle.

## Shape

- **Flat or isometric, by what the subject is.** Things standing in space
  (services, parts, layers) are isometric: low slabs and blocks on a ground,
  drawn as hairlines with three flat face tones. A record, a window, a
  chart, a table or a page is flat, in the page's own coordinates. Neither
  is the default, and a figure does not mix them.
- No gradients, no shadows, no glow, in either.
- **Flat shapes are few and plain.** A box is a white panel with a hairline;
  a bar or a tile is flat ink, in whichever of three weights tells it from
  its neighbours; a connector has rounded corners and a small filled
  arrowhead; a unit of work is a dot. A subject's own shape (a key, a gear,
  a coastline) is drawn as itself, in the same hairline.
- A thing's shape comes from what it is: a queue is a stack of thin slabs, a
  store is a drum, a client is a flat slab, a service or a worker is a block.
- Keep things low and apart. Height is for emphasis, used once.

## 3D

The same house, lit. A 3D figure keeps the isometric framing, the one accent,
the flat labels and the tokens; what changes is that shapes are made of
something and stand in light.

- **Four materials, each with a job.** Clay is the default: matte, pale,
  quiet. Matte black is for the one or two things that carry weight (a
  service). Frosted glass is for what holds other things (a queue, a layer),
  because it shows what is behind it. The accent is not chosen: a shape turns
  the accent when the beat is about it, exactly as in 2D.
- **A top face is its token colour, exactly.** Nothing is tone-mapped, and
  the lights are set so a top gets its own colour, its left face about 0.78
  of it and its right about 0.62. So an accent top is the accent, and a still
  matches the page it sits on.
- **Shadows are soft and short.** One lamp casts them, to the right. Under
  each thing is a contact shadow; glass leaves only a faint one. No glow, no
  bloom, no reflections of anything but a plain lit room.
- **Wires and pulses are flat colour.** They are marks on the picture, not
  objects in it: unlit, in the wire and accent tokens.
- **Labels never go into the scene.** They are the same flat SVG as in 2D,
  over the canvas. Their leaders end at a shape's far top corner, so a line
  never crosses a lit face.
- **Dim by colour here too.** A shape the story has left moves a little
  toward the page. Glass thins out instead.

The materials and the lights are tokens in `kit.css` (`--pt-clay`,
`--pt-matte`, `--pt-glass`, `--pt-light-key` and their neighbours), in both
themes. A figure never sets a material colour or a light of its own.

## Words

- **Labels are flat and upright**, in small mono capitals, with a hairline
  leader to the thing they name. Text is never skewed onto a plane.
- A note under a label is one quiet line in the body face.
- **Real content.** A real file name, a real message, a real count. Never a
  grey bar standing in for text, with one exception: when the bars are the
  subject. The entries in a log, the rows of a buffer, the frames of a film
  are drawn as bars when what each says does not matter and how many there
  are does. Then the bars are data: their count, their order and
  their tone come from the model.
- Words sit on a halo of the page colour, so a line behind them never cuts
  through a letter.
- The caption under the figure is a sentence. The claim under that is the
  one sentence the reader should leave with.

## Density

Five to eight things is a figure. Nine is the limit, and it shows. One focal
point per beat. If everything is emphasized, nothing is.

## Changing the style

The style lives in the kit, and the kit in a repo belongs to that repo. To
restyle a repo's figures, edit its `kit.css` once, outside a round. Never
restyle inside a draft: `draft check` fails a round whose kit was edited,
because a change to the house style is a change for every figure.
