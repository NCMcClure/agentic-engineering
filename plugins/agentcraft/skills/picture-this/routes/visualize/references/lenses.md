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

What hides the mechanism picks the picture. One lens leads. Many subjects
need a second, and section 3 says where it goes.

| Lens | The question | Hidden because | The view | What moves | A study of it |
|---|---|---|---|---|---|
| **structure** | What is it made of? | it is assembled, or inside a case | the parts pulled apart along one axis with guides back to where they sit; or a cut through it; or a stack of layers; or boxes inside boxes | the parts separate, one is named, they return | `layer-stack` |
| **path** | Where does it go? | it passes through places you cannot follow | the places, in the arrangement they really have, and a line for each hop | something travels the hop being told | `iso-flow`, `card-flow`, `staged-build` |
| **time** | What happens when? | it is too fast, too slow, or several things overlap | time drawn as an axis: stages by ticks with a token per unit of work; or a record that scrolls; or a level that rises against its limit and is reset | everything steps with the clock, together | `time-grid` |
| **field** | How much, and where? | it is a quantity spread over a space | a grid of cells tinted by value, or a surface standing over a plane | the value changes, or a marker travels over it | `cell-field` |
| **transformation** | What does it turn into? | the before and the after are never seen together | both in one frame, with the rule drawn between them | the rule applied to one element, then the next | `before-after` |
| **difference** | How do these two differ? | you only ever see one of them | the same parts drawn twice, side by side, in the same vocabulary | the story tells one, then the other | `split` |
| **cases** | What happens if? | it branches | one small tile per case | only the tile being told | `case-loop` |
| **scale** | How big, how far, what is inside? | it is too small, too large, or there are too many | the whole, a ring around one region, and that region enlarged beside it; or the same things on a true scale and a squeezed one | the ring travels, or the enlargement opens | `two-rulers` |

The view column is a place to start thinking, not a menu. The subject decides
the picture: its own shape, its own numbers, its own order. A study is one
worked figure of one view, there to learn technique from. Start a draft from
one only when its view is exactly the view this subject wants, which is less
often than it is tempting to think: `archetypes.md` has the rule.

Choosing between lenses that both fit: take the one whose view shows the
**mechanism's verb** most directly. "Takes the next instruction" is time, not
path. "Is sampled onto a grid" is transformation, not field.

## 3. Two lenses in one picture

A beam through a cutaway is structure and path. Two processors as queues of
work are difference and time. A surface with one slice drawn as a curve is
field and structure. Say the mechanism sentence again: the **verb** belongs to
the lead lens, and what is left (who, where, how much, inside what) is the
second.

The lead takes the page. Its axis is the picture's long axis and its motion
is the figure's motion. The second takes a place the lead leaves free, and
there are four:

| The second sits | When | For example |
|---|---|---|
| **on the other axis** | both run through the whole subject | time along the page, structure down it: which process started which |
| **inside each unit** | the lead repeats a unit | cases, with a path inside each tile |
| **over it**, as one mark | the second is a single thing: a route, a cut, a level | a field with a marker's path on it; a cutaway with a beam through it |
| **beside it**, as an inset | the second is another size | a structure with a zoom on one part |

Never three. A third question is a second figure.

Two subjects look as if they need a lens of their own, and do not:

- **Something that fills and is emptied**: a buffer, a tank, a battery. It
  is a quantity, but one that changes over time and not over space, so
  **time** leads. The model carries it as a `quantity`. How it is drawn is
  the view's business: a level, a stack, a curve, a count.
- **Something that starts other things**: a process that forks, a cell that
  divides. When each one starts is **time**; what belongs to what is
  **structure**, on the other axis. The model carries it as a `parent`, and
  a `born` beat for a thing that is not there at the start.

## 4. Draw the thing itself

When the subject has a shape people know, draw that shape. A disk is a disk, a
cable is a cable, a screen is a screen. The picture then does half the
labelling, and the reader trusts it.

When the subject has no shape (a service, a queue, a function), give it the
simplest shape that tells it from its neighbours, and keep that shape for that
kind of thing everywhere.

Proportions may be bent to make the mechanism visible: a gap widened, a layer
thickened, a million pixels drawn as sixty. What may not be bent is the
arrangement: what touches what, what is inside what, what comes before what.

## 5. Take things away

For each part, each line and each word, ask whether the claim survives
without it. If it does, remove it.

- One size. One accent. One focal point per beat.
- Many of a thing is drawn as a few, enough to see that it repeats.
- A case, a housing, a boundary is drawn only when the mechanism crosses it.
- Detail that proves the thing is real (a notch, a real file name) stays;
  detail that merely decorates goes.

## 6. Encode, once

Each visual property means one thing, the same in every figure.

| Property | Means |
|---|---|
| Position and order | the real arrangement: what is above, inside, before |
| A solid hairline | a thing, or a connection that exists |
| A dashed line | not a thing: where a part goes back to, a path through empty space, something hidden behind |
| The accent, as line and as fill | the part the beat is about, and what is moving |
| A tint of the accent | a part the story marked earlier and will come back to |
| Size, where it varies | how much: taller, longer or fuller is more, to one scale across the figure |
| A hue | this kind of thing as against that kind, on two to four kinds |
| A label with a leader | a name. Small mono capitals, flat and upright |

## 7. Step through it

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

## 8. Three worked passes

Each ends on more than one view, on purpose. A lens narrows the field; it
does not hand over the picture. The round of three is where these are tried.

**A processor's pipeline.** *Parts:* the four stages, a queue of instructions
waiting, a pile of them finished. *Happens:* "each instruction moves one stage
on every clock tick, with the next one right behind it." *Hidden because:*
it is too fast, and four instructions are in flight at once. *Lens:* time.
*Views to try:* stages as rows and ticks as columns, each instruction a dot
stepping down the grid; the same four stages as places with instructions
queued at each; one instruction followed alone, then the pipeline full.
*Beats:* one instruction alone through all four stages; a second enters
behind it; the pipeline full, one finishing per tick. *Claim:* after the
first, one instruction finishes every tick.

**A pin tumbler lock.** *Parts:* the housing, the plug that turns inside it,
five stacks of two pins on springs, the key. *Happens:* "the right key lifts
each stack until the gap between its two pins sits at the edge of the plug."
*Hidden because:* it is inside a case. *Lens:* structure. *Views to try:* the
lock sawn in half lengthwise, key sliding in under the pins; its logic as a
chart, five columns against one line; the parts pulled apart along the axis
the pins move on. *Beats:* locked; the key goes in; every gap lines up; the
plug turns; one wrong cut. *Claim:* it opens only when all five line up at
once.

**Merging two sorted lists.** *Parts:* two runs already in order, the front
item of each, the merged run being built. *Happens:* "the smaller of the two
front items is taken, again and again." *Hidden because:* the before and the
after are never seen together, and the rule is one line of code. *Lens:*
transformation. *Views to try:* the two runs side by side feeding one row
below; the whole sort as rows, one per level, runs doubling in length; each
number as a bar, so order is a shape. *Beats:* cut down to ones; merge
neighbours; only the fronts; again, until empty; one pass per level.
*Claim:* a merge never looks back, so each level is one pass.

## What goes in the model

```json
"mechanism": "Each instruction moves one stage on every clock tick, with the next right behind it.",
"lens": "time"
```

`mechanism` is the sentence from question two. `lens` is the one that leads.
`draft new` will not start a round without both: three drafts of a subject
nobody has put into one sentence are three guesses.

What the second lens needs goes in the model too, so every draft draws the
same facts: a `parent` on a thing that is inside another or was started by
it, a `born` beat on a thing that comes into being, a `quantity` for a
number that changes, and `data` for what a view lays out many of (cell
values, units of work). `model.md` has each.
