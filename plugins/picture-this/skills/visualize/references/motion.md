# Motion

Motion is part of the explanation, not a finish applied to it. Decide what
moves, and what that says, before tuning how it moves.

## One clock

A figure has one timeline: its beats, in order, then a rest. Everything that
moves reads that clock. Nothing has a timer of its own.

This is a hard rule, and the kit's tests enforce it: no `@keyframes`, no CSS
`transition`, no `setTimeout`, no `Math.random`. A figure computes what to
draw from the frame, with the helpers on `useFigure()` and in `timeline.ts`:

| Helper | Use it for |
|---|---|
| `f.here(entity)`, `f.laid(flow)` | something that arrives and stays |
| `f.lit(entity)`, `f.moving(flow)` | something that is on only while it is told |
| `f.arriving(entity)` | the one thing the beat is about |
| `f.phase(laps, offset)` | something circulating during a beat: a pulse, a tick |
| `f.level(quantity)`, `f.share(quantity)` | a number that changes: a level, a count, a fill against its limit |
| `f.present` | the whole figure fading in as the loop starts and out as it ends, for a drawing with no entity of its own |
| `since`, `during`, `outro`, `ease`, `lerp`, `span` | anything of your own, from `f.tl` and `f.frame` |

A pulse makes a whole number of laps per beat. Then the beat and the progress
through it fix the picture, and a pulse is mid-wire at mid-beat, which is
where the hero frame is taken.

## In 3D

A 3D scene reads the same clock through the same helpers, and they mean the
same. It has no clock of its own: the canvas draws a frame when the figure
changes and at no other time, so a held frame is still, and a still is exact.
Never animate from the renderer's time (`useFrame`, a delta, an elapsed
time); the kit's tests fail a 3D file that does.

What each helper looks like there:

- `here`: a shape grows from the middle of its base, and its shadow grows
  with it. Nothing fades in, because a half-seen solid still casts a whole
  shadow.
- `lit`: a shape the story has left steps toward the page colour; glass
  thins.
- `arriving`: the shape turns the accent. In a layer stack it also lifts.
- `laid`, `moving`, `phase`: a wire is laid along its length, and a pulse
  travels it, as in 2D.

Camera moves, orbiting, and a shape that turns to show itself off are not in
the kit. The framing is fixed so that labels stay where they point.

## Every motion has a job

Before adding one, say what it tells the reader about the system:

- **Travel** along a wire: something passes from here to there, this way.
- **Arrival**: this part exists from now on.
- **Lift or accent**: this is what is happening now.
- **Dimming**: this is not what we are talking about.
- **Filling, counting, stacking**: this much has built up.
- **Emptying at once**: it was reset, and what it held is gone.
- **Scrolling**: time is passing in a record, at the rate things are added.
- **Sliding out of something**: that thing started this one.

If a motion says nothing about the system, remove it. The test: would a
reader be confused if it were gone? If not, it was decoration.

## Pacing

- A beat holds 2.5 to 4 seconds: long enough to read its caption once.
- An arrival eases out over about 600 ms. Easing is always out, never in:
  things settle, they do not wind up.
- Focus changes over about 400 ms at the start of a beat, so something lit in
  two beats running never flickers between them.
- The loop ends on a rest of about 1.5 seconds with everything lit, then
  fades and starts over. The rest is where the implication is read.
- The whole loop is under 30 seconds, and better under 15.

## The tenth viewing

A figure in a docs page loops while someone reads beside it. What delights
once and irritates by the tenth pass has to go: bounces, overshoot, anything
that flashes. Quiet motion survives being watched sideways.

## The reader has the clock

A figure plays when it scrolls into view and pauses when it leaves. The strip
lets the reader pause, step beat by beat, or scrub. Stepping lands on the
middle of a beat, so every step is a readable frame.

## Reduced motion and stills

A reader who asked for less motion gets the hero frame, held, with the strip
to step through the beats. That same frame is what a server renders and what
the camera photographs. So the hero frame must be a complete picture on its
own: check it as a still before anything else.

A loop that scrolls or fills must start where it ends, or the seam shows.
The figure fades out over the loop's last half second and in over its first
(`f.present`); what is under the fade should be the same state at both ends:
a level back at its start, a column back at its first row.

With `build` on, a part is absent until its beat. A thing with a `born` beat
is absent until then whether or not the figure builds up. Pick a late hero beat for a
build-up, or the still shows half a system.
