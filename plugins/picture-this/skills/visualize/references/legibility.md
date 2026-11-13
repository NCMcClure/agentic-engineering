# Legibility

A figure is read in a second or it is not read. These are the checks that
decide which.

## The squint test

Blur your eyes at a frame, or look at it small. Exactly one thing should
stand out, and it should be what the beat is about. If two things stand out
equally, the hierarchy is broken. If nothing does, the frame says nothing.

Run it on every beat of the sheet, not only the hero frame.

## One focal point per beat

Point at the thing this beat exists to show. If you hesitate, the reader
will. The accent goes there and nowhere else.

## Words

- Nothing overlaps: no word over a word, a label over a shape's edge, a
  wire's word over a label. Move the label, shorten it, or move the thing.
- Every label is readable at the size a README shows it. A still is 880 px
  wide by default; if a label needs zooming there, it is too small or there
  are too many.
- A label says what the thing is. A note says what it does here. If the note
  repeats the label, cut the note.
- Leave slack. The studio's fonts are not the page's, so a label that only
  just fits will not fit somewhere.

## Contrast

Never judge contrast by eye. When a figure or a repo's `kit.css` introduces a
colour pair, compute it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/contrast-check.mjs" '#5c5c58:#f5f5f3' '#c2410c:#f5f5f3'
```

Each argument is `foreground:background`, as hex or `h,s%,l%`. Text needs
4.5:1; large text and the lines of a diagram need 3:1. The command exits
non-zero when a pair fails 3:1. The quiet text is where it usually fails.

## Order

Reading order is the order the story travels. In an isometric flow that is
along x, down to the right. A figure whose first beat happens on the right
and whose second happens on the left is fighting the reader.

## Space

Whitespace is what lets a pulse be seen travelling and a label be read
without its neighbour. A crowded figure is a model with too much in it:
remove an entity before shrinking the type.
