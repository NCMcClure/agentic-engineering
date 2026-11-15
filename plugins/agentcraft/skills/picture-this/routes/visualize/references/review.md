# Review

Two passes on every draft before the person sees it. Defects are yours to
fix. Taste, which of two sound pictures is better, is theirs to decide.

## The checklist

Look at `sheet.png` for the draft, every panel. Each item passes or fails.

**It draws**

1. `sheet` exited 0: `checks.json` lists no errors and nothing on the console.
2. `draft check` passes: the model is the round's, the kit is untouched, and
   the view is stated.

**It reads**

3. Squint: one thing stands out in each panel, and it is what the beat is
   about.
4. Nothing overlaps: no word over a word, a label over a shape's edge, or a
   line's word over a label.
5. Every label is readable at the sheet's size without zooming.
6. No line passes behind a shape, and nothing that travels spends most of its
   trip hidden.
7. The reading order is the order the story travels.

**It is in style**

8. The accent is on the one part each panel is about, and on what is moving.
   A tint of it may stay on parts the story marked earlier.
9. No colour of the draft's own: every colour is a token.
10. Labels are flat and upright. Content is real, not placeholder.

**It is this subject's picture**

11. The picture is what its view statement says: each thing it names is
    drawn, what it says moves does, and each visual property means the one
    thing stated.
12. It fails the swap test (below): with another system's labels on it, the
    picture would be wrong.
13. The mechanism's verb can be seen without reading a word: as motion, or
    as arrangement.

**It tells the story**

14. Each panel shows a visible change from the one before, and the change is
    what its caption says. A beat is read at its middle: what it is about
    has happened by then.
15. The hero frame is a complete picture on its own.
16. The captions read as sentences, and the claim is why it matters, not a
    description of the figure.

Fix what fails, take the sheet again, and check again. Do not present a draft
with a failing item; say so plainly if one cannot be fixed.

## Its own picture, or a template with new labels?

A draft can pass every other item and still be a stock diagram with this
subject's names on it: boxes in a row, an arrow between each pair. That
picture explains nothing the sentence "A sends to B" did not. Five ways to
tell, and a draft should pass all of them:

- **Swap the labels.** Put another system's names on the same shapes. If the
  picture would still be right, nothing in it is about this subject. A
  picture of its own breaks under the swap: this queue has seven jobs in it,
  this pin is four units long, this part is the shape it really is.
- **Cover the labels.** Look at `sheet.nocap.png` with the words blurred. A
  reader should still be able to say what kind of thing happens (something
  fills, something is handed on, something is cut open), because the shapes
  and the motion carry it.
- **Find the subject's own fact.** Point at one thing drawn to the subject's
  numbers, proportions, order or shape. A study drawn straight from its
  default layout has none.
- **Name where each device came from.** A meter, a tint, a ring, a row of
  dots: say what in this subject each one stands for. One that is there
  because a study or an example in these documents had one is a borrowed
  device, and it goes.
- **Read the cold reader's sentence.** "Things send messages to other
  things" is what a template reads as. A reader of the subject's own picture
  says something only true of this subject.

A draft that began from a study is held to the same five. If it differs from
the study only in labels and positions, either the study's view is exactly
this subject's view (say so in the view statement, and say why), or the
draft should have begun on the blank stage. A round where all three began
from studies is the usual sign that it was the second.

## The cold read

You know what the figure means, so you cannot tell whether it says so. The
cold reader can.

For each draft, dispatch the `agentcraft:cold-reader` agent with one thing:
the path of that draft's `sheet.nocap.png`, the sheet with captions and claim
left off. Give it nothing else: not the model, not the title, not what the
figure is for. One fresh reader per draft, in one message so they run
together.

Score its answer against the model and write `coldread.json` in the draft's
folder:

| Check | Pass when |
|---|---|
| Things | it named every entity in the hero beat's focus |
| Its own | its `does` sentence could only be about this subject, not any system |
| Order | its sequence matches the beats' order and each flow's direction |
| Meaning | its `does` sentence agrees with the claim: yes, partly, or no |
| Focus | its `focal` thing is in the hero beat's focus |
| Unclear | each item it lists is a defect to fix, or a reason it is not one |

```json
{ "things": "4 of 4", "order": "matches", "meaning": "partly", "own": "yes", "focal": "Jobs",
  "does": "<its sentence, quoted>", "unclear": ["could not tell which way 'accepted' goes"] }
```

A reader that got the order but not the meaning has understood the mechanism
and missed the point: usually the accent is on the wrong thing, or the claim
is not something a picture can show. A reader that missed a thing could not
read its label or tell it from its neighbour.

Fix what the reader could not read, then present. Do not rerun the reader
until it agrees with you: one read per draft per round is the measure.

**With no subagents available**, say that the read was not independent, and
show the person the caption-free sheet themselves before they pick.

## What the cold read cannot tell you

It reads stills, so it cannot judge motion: whether the pacing is right, or a
transition distracts. And a model reading a picture is a stand-in for a
person, not a substitute. When a figure matters, show it to someone who does
not know the system and listen to what they say back.
