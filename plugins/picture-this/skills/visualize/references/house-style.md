# The house style

One look, for every figure. It is fixed so that three drafts differ in form
and not in decoration, and so that a repo's figures look like one set.

## Colour

- **Monochrome first.** Neutrals carry the picture: a page colour, three face
  tones, ink, a quieter line. A figure should read in greyscale.
- **One accent: orange.** It marks where the story is now: the pulse on the
  wire being told, the one thing the beat is about. Nothing else is orange.
  If two things are orange in one frame, one of them is wrong.
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

- **2D leans isometric.** Low slabs and blocks on a ground, drawn as
  hairlines with three flat face tones. No gradients, no shadows, no glow.
- A thing's shape comes from what it is: a queue is a stack of thin slabs, a
  store is a drum, a client is a flat slab, a service or a worker is a block.
- Keep things low and apart. Height is for emphasis, used once.

## Words

- **Labels are flat and upright**, in small mono capitals, with a hairline
  leader to the thing they name. Text is never skewed onto a plane.
- A note under a label is one quiet line in the body face.
- **Real content.** A real file name, a real message, a real count. Never a
  grey bar standing in for text.
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
