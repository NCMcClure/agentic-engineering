# Accessibility

Built into the stage, so a figure gets it by using the kit as it is. Know
what is there, and do not undo it.

## Reduced motion

A reader whose system asks for reduced motion is never shown a figure that
plays on its own. They get the hero frame, held, with the strip to step
through the beats when they choose to. Nothing is hidden from them: every
beat and every caption is one step away.

Do not add motion that bypasses the clock. It would play for these readers
too, and it would also be missing from the stills.

## Without sight

- The figure is a `figure` with a `figcaption`: the caption and the claim are
  real text, read in order.
- The drawing carries the model's title as its label.
- The caption updates quietly while the figure plays and is announced when the
  reader steps.

The captions and the claim are the text alternative, which is one more reason
they must explain the system on their own. A README still gets an `alt` of the
title and the claim from the snippet `still` prints.

## Without a pointer

The strip is native controls: buttons and a range input, in reading order,
with visible focus. Nothing in a figure needs hover to be understood.

## Colour

Meaning is never carried by colour alone. A write differs from a read by its
line, not its hue; the thing a beat is about is also the thing the caption
names. Check any new colour pair with the contrast checker.

## What to avoid

Flashing, anything that sweeps across a large area, parallax, and motion that
loops fast enough to pull the eye from the text beside it.
