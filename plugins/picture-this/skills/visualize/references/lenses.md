# Finding the picture

A method for getting from "explain this" to a picture, for any subject: a
device, a protocol, a pipeline, an algorithm, a piece of maths. Work through
it before writing the model. It ends with two lines the model carries: the
**mechanism** and the **lens**.

## 1. Four questions

Answer each in a sentence. If one will not come, read more of the subject
before going on.

**What is it, at one size?** Name its parts at a single level of zoom: two to
nine of them. A disk's shell, liner and platter are one size; the magnetic
domains on the platter are another. Pick one. A second size is a zoom, and a
zoom is declared (see the scale lens).

**What happens?** One sentence with a subject, a verb and an object: "the
beam sweeps the screen", "each core takes the next instruction", "the outline
is sampled onto a grid". The verb is the mechanism. If there is no verb, the
figure is about structure, and that is fine: say "it is made of" and move on.

**Why can the reader not already see it?** Something hides it. It is inside a
case. It is over in a nanosecond. It is too small, or there are millions of
it. It is a number, not a thing. They have only ever seen one of the two
alternatives. Name which.

**What should they be able to say afterwards?** That is the claim.

## 2. The lens

What hides the mechanism picks the picture. One lens leads; a second may sit
beside it as an inset.

| Lens | The question | Hidden because | The view | What moves | Starter |
|---|---|---|---|---|---|
| **structure** | What is it made of? | it is assembled, or inside a case | the parts pulled apart along one axis with guides back to where they sit; or a cut through it; or a stack of layers | the parts separate, one is named, they return | `layer-stack`, `blank` |
| **path** | Where does it go? | it passes through places you cannot follow | the places on a ground, a wire for each hop | a pulse along the hop being told | `iso-flow`, `card-flow`, `staged-build` |
| **time** | What happens when? | it is too fast, or several things overlap | stages down one side, ticks along the other, a token per unit of work | every token steps one cell per tick | `series`, `blank` |
| **field** | How much, and where? | it is a quantity spread over a space | a grid of cells tinted by value, or a surface standing over a plane | the value changes, or a marker travels over it | `blank` |
| **transformation** | What does it turn into? | the before and the after are never seen together | both in one frame, with the rule drawn between them | the rule applied to one element, then the next | `blank` |
| **difference** | How do these two differ? | you only ever see one of them | the same parts drawn twice, side by side, in the same vocabulary | the story tells one, then the other | `split` |
| **cases** | What happens if? | it branches | one small tile per case | only the tile being told | `case-loop` |
| **scale** | What is inside this? | it is too small, or there are too many | the whole, a ring around one region, and that region enlarged beside it | the ring travels, or the enlargement opens | `blank` |

A starter is a working figure for a view. `blank` is the starter for a view
that has none yet: it sets up the stage and the clock and leaves the drawing
to you, with the kit's helpers.

Choosing between lenses that both fit: take the one whose view shows the
**mechanism's verb** most directly. "Takes the next instruction" is time, not
path. "Is sampled onto a grid" is transformation, not field.

## 3. Draw the thing itself

When the subject has a shape people know, draw that shape. A disk is a disk, a
cable is a cable, a screen is a screen. The picture then does half the
labelling, and the reader trusts it.

When the subject has no shape (a service, a queue, a function), give it the
simplest shape that tells it from its neighbours, and keep that shape for that
kind of thing everywhere.

Proportions may be bent to make the mechanism visible: a gap widened, a layer
thickened, a million pixels drawn as sixty. What may not be bent is the
arrangement: what touches what, what is inside what, what comes before what.

## 4. Take things away

For each part, each line and each word, ask whether the claim survives
without it. If it does, remove it.

- One size. One accent. One focal point per beat.
- Many of a thing is drawn as a few, enough to see that it repeats.
- A case, a housing, a boundary is drawn only when the mechanism crosses it.
- Detail that proves the thing is real (a notch, a real file name) stays;
  detail that merely decorates goes.

## 5. Encode, once

Each visual property means one thing, the same in every figure.

| Property | Means |
|---|---|
| Position and order | the real arrangement: what is above, inside, before |
| A solid hairline | a thing, or a connection that exists |
| A dashed line | not a thing: where a part goes back to, a path through empty space, something hidden behind |
| The accent, as line and as tint | the part the beat is about, and what is moving |
| A hue | this kind of thing as against that kind, on two to four kinds |
| A label with a leader | a name. Small mono capitals, flat and upright |

## 6. Step through it

Beats are the mechanism in the order it happens. The reader should be able to
stop on any one and say what just changed.

1. **The whole, at rest.** What they are looking at. Nothing moves yet.
2. **The first move.** The mechanism's verb, once, on one thing.
3. **It carries on.** The same move on the next thing, or the move that
   follows from it. One change per beat.
4. **The result.** What is now true that was not.
5. **Rest.** Everything lit, and the implication.

A structure figure steps differently: together, then apart with each part
named in turn, then together again.

Two to seven beats. If the mechanism needs more, it is two figures, or the
size chosen in question one is too small.

## 7. Two worked passes

**A processor's pipeline.** *Parts:* the four stages, a queue of instructions
waiting, a pile of them finished. *Happens:* "each instruction moves one stage
on every clock tick, with the next one right behind it." *Hidden because:*
it is too fast, and four instructions are in flight at once. *Lens:* time.
*View:* stages as rows, ticks as columns, each instruction a dot of its own
hue stepping diagonally down the grid. *Beats:* one instruction alone through
all four stages; a second enters behind it; the pipeline full, one finishing
per tick. *Claim:* after the first, one instruction finishes every tick.

**A cache in front of a database.** *Parts:* the app, the cache, the
database. *Happens:* "a read is answered by the cache when it holds the row,
and by the database when it does not." *Hidden because:* it branches. *Lens:*
cases, with path inside each tile. *View:* two tiles, hit and miss, the same
three things in each. *Beats:* the hit; the miss; the miss filling the cache.
*Claim:* a miss costs one extra trip, once.

## What goes in the model

```json
"mechanism": "Each instruction moves one stage on every clock tick, with the next right behind it.",
"lens": "time"
```

`mechanism` is the sentence from question two. `lens` is the one that leads.
`draft new` will not start a round without both: three drafts of a subject
nobody has put into one sentence are three guesses.
