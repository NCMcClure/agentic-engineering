# Review

Two passes on every draft before the person sees it. Defects are yours to
fix. Taste, which of two sound pictures is better, is theirs to decide.

## The checklist

Look at `sheet.png` for the draft, every panel. Each item passes or fails.

**It draws**

1. `sheet` exited 0: `checks.json` lists no errors and nothing on the console.
2. `draft check` passes: the model is the round's, the kit is untouched.

**It reads**

3. Squint: one thing stands out in each panel, and it is what the beat is
   about.
4. Nothing overlaps: no word over a word, a label over a shape's edge, or a
   wire's word over a label.
5. Every label is readable at the sheet's size without zooming.
6. No wire passes behind a shape, and no pulse spends most of its trip hidden.
7. The reading order is the order the story travels.

**It is in style**

8. The accent is on one thing per panel: the pulse being told and what it
   reaches.
9. No colour of the draft's own: every colour is a token.
10. Labels are flat and upright. Content is real, not placeholder.

**It tells the story**

11. Each panel shows a visible change from the one before, and the change is
    what its caption says.
12. The hero frame is a complete picture on its own.
13. The captions read as sentences, and the claim is why it matters, not a
    description of the figure.

Fix what fails, take the sheet again, and check again. Do not present a draft
with a failing item; say so plainly if one cannot be fixed.

## The cold read

You know what the figure means, so you cannot tell whether it says so. The
cold reader can.

For each draft, dispatch the `picture-this:cold-reader` agent with one thing:
the path of that draft's `sheet.nocap.png`, the sheet with captions and claim
left off. Give it nothing else: not the model, not the title, not what the
figure is for. One fresh reader per draft, in one message so they run
together.

Score its answer against the model and write `coldread.json` in the draft's
folder:

| Check | Pass when |
|---|---|
| Things | it named every entity in the hero beat's focus |
| Order | its sequence matches the beats' order and each flow's direction |
| Meaning | its `does` sentence agrees with the claim: yes, partly, or no |
| Focus | its `focal` thing is in the hero beat's focus |
| Unclear | each item it lists is a defect to fix, or a reason it is not one |

```json
{ "things": "4 of 4", "order": "matches", "meaning": "partly", "focal": "Jobs",
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
