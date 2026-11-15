---
name: visualize
description: >-
  Turn a description, or a feature in a codebase, into a minimalist animated
  figure of how something works, whatever it is: a system, a device, a
  protocol, an algorithm, a process. Find the lens, model the subject, draft
  three views designed from it, refine one, and deliver a React component for
  MDX plus README stills. Use when asked to visualize, diagram, illustrate or
  animate how a system, feature, architecture, mechanism or idea works, or to
  explain one to a non-technical audience.
argument-hint: "[what to visualize: a description, or a path or feature in this repo]"
---

# visualize

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

Draws how something works: what it is made of, what happens in it, and why
that matters, as one small animated figure that also holds still for a
README. The figure is a React component and a `model.json`, in the repo.

The picture is designed from the subject. The plugin ships a drawing
vocabulary (the kit) and worked studies to learn technique from; it does not
ship templates to fill in. A job queue, a lock, a sort and the solar system
do not share a picture.

`P` below is `node "W/scripts/pt.mjs"`. Every command
takes `--help`. Exit codes: 0 done, 1 a check found something, 2 usage or
environment.

The method is six steps: model, message, form, grammar, time, deliver. Read
`references/framework.md` first; it is short, and it says why the model comes
before any drawing.

## 0. The studio

Figures are rendered in a studio the plugin installs once, into its own data
folder, never into the project.

```
P setup --check
```

If it is not installed, run `P setup` (it only prints what it would
download), tell the person what it said, and ask. On a yes: `P setup --yes`.
Do not download without that yes.

## 1. Find the picture, then model it

Read `references/lenses.md` and work through it: what the subject is at one
size, what happens (one sentence with a verb), why the reader cannot already
see it, and so which lens leads. Not every subject is things with flows
between them. *Done when* you can state the mechanism in one sentence and
name the lens.

Then read `references/model.md`. Write the model, with its `mechanism` and
`lens`, to a scratch file, for example
`.agents/picture-this/drafts/<name>.model.json`. A model is things and flows
where the subject has them, and also what is inside what (`parent`), what
comes into being (`born`), what repeats, numbers that change (`quantities`),
and the data a view lays out (`data`).

- **From a description**: write it, then `P model check <file>`.
- **From code**: read the feature first. Put a `source` (`path:line`) on
  every entity and flow, run `P model check <file> --require-source`, then
  show the person the model as a short plain-language list (the things, what
  passes or changes, the beats, the claim) and **wait for a yes** before
  drawing anything.

*Done when* the check passes and, from code, the person agreed.

## 2. Design three views

Read `references/archetypes.md`. A view is a kind of picture: what the page
is, what each axis and each mark means, what moves. Design three for this
subject, as unlike each other as the claim allows, starting from the lens and
the subject's own shape, numbers and order. Name each for what it draws,
in the subject's own nouns: for a lock, `sawn-lock`, `five-gaps`,
`pins-apart`. Nothing an example in the references
draws is yours by default: a device from one (a meter, a tint, a row of
tiles) has to earn its place in this subject.

The plugin's studies (`P draft studies`) are worked figures to learn from. A
draft starts from one only when that study's view, as it stands, is the view
this subject wants: `<view>=<study>`. Otherwise it starts on the blank stage.
A round of three is rarely three studies.

Two of the studies draw in 3D. Use at most one in a round, and only when the
figure is a page's centrepiece: "When to draw in 3D" in
`references/archetypes.md`. Drafting in 3D adds nothing to the repo.

```
P draft new --model <file> --views <a>,<b>,<c>
P draft new --model <file> --views sawn-lock,five-gaps,pins-apart
P draft new --model <file> --views <a>,<b>,layers=layer-stack
```

This makes a round in `.agents/picture-this/drafts/round-N/`: one folder per
draft (`a`, `b`, `c`), each with the model, a `figure.tsx` to draw in and a
`view.json` to state the view in, and the kit they share. The folder is
ignored by git.

*Done when* the round exists and you can say in a sentence how the three
differ.

## 3. State, then draft

Each draft first **states its view** in its `view.json`, before any drawing:
`drawn` (the shapes on the page and what each one is), `moves` (what moves,
and what that says), `means` (what each visual property stands for: position,
size, tone, the accent). A sentence or two each. Then it draws that.

Give each draft to its own subagent, all three in one message so they run
together. Each brief carries:

- its draft folder, and that it may edit **only** `view.json` and
  `figure.tsx` there: not the model, not the kit, not another draft;
- the view it is to design, in a line, and that the statement comes first;
- to read `references/lenses.md` (section 3 on), `references/house-style.md`,
  `kit/README.md` in the round folder (the kit's API), and "Drawing on the
  blank stage" or "Starting from a study" in `references/archetypes.md`;
- the two commands it runs: `P sheet <round>/<id>` to render, and to open the
  `sheet.png` that writes and look at it;
- the checklist in `references/review.md`, and to fix what fails and render
  again, at least once;
- what to return: its view statement, which checklist items pass, and
  anything it could not fix.

With no subagents, draft the three yourself, one after another, the same way.

Do not polish motion yet. A rough draft has a sound layout, readable words,
the accent in the right place, and motion that shows the mechanism. A beat
is read at its middle, where the sheet holds it: `P still <round>/<id>
--beat <id> --at <0-100>` holds any other moment, to look at the motion
between.

## 4. Check

```
P draft check <round>
```

It fails a draft whose view is not stated or whose figure is not drawn, and
prints each view in its own words. Then, for each draft, the two passes in
`references/review.md`: the checklist on `sheet.png`, the swap test included
(is this the subject's own picture, or a template with new labels?), and the
cold read of `sheet.nocap.png` by the `agentcraft:cold-reader` agent, which
is told nothing but the picture's path. Write each draft's `coldread.json`.

*Done when* every draft passes the checklist and has been read cold.

## 5. Pick

Show the person the three `sheet.png` files. With each: its view, in the
words of its statement, and what the cold reader understood and missed. Say
which you would pick and why, in a sentence. Then ask.

They may pick one, or ask for parts of two: start from the nearer draft and
bring the other's idea into it. They may also want to watch them move: start
the studio in the background and give them the URL it prints.

```
P studio
```

Read the URL from its `Local:` line. Do not guess the port. Stop the studio
by stopping the command.

## 6. Refine

Take the chosen draft to full quality, in its draft folder:

- **Motion**: `references/motion.md`. Every motion says something about the
  system; nothing moves that is not read from the clock.
- **Words**: both caption tracks if the figure is from code; every caption a
  sentence; the claim is why it matters.
- **Both themes**: `P sheet <round>/<id> --dark`, and look.
- **Legibility**: `references/legibility.md`, including contrast for any
  colour pair you introduced.

Captions and the claim live in the model. Changing them after the round is
fine for the chosen draft: it is no longer being compared.

Take the sheet again and run the checklist again.

## 7. Deliver

`references/delivery.md` has the detail.

```
P init --figures <dir> --stills <dir>     # once per repo, if it has a docs site
P land <round>/<id> --as <name>
P still <name>
```

`land` copies the figure and its model into the repo's figures folder and
adds the kit beside them the first time. `still` writes the light and dark
PNGs and prints the Markdown that shows them. When the README should show
the steps or the motion as well, `still --strip` writes a beat strip and
`still --gif` a looping GIF; `references/delivery.md` says which to reach
for and what a GIF costs.

**A 3D figure, shown live, needs three packages** in the site that shows it:
`three`, `@react-three/fiber` and `@react-three/drei`. Before the site's
`package.json` is touched, tell the person which three, that they are for
this figure, and about how big they are (165 MB installed, with what they
depend on), and ask. Do not add them without that yes. On a no, offer the figure as stills only, which
need nothing, or the round's 2D twin. `references/delivery.md` has the rest.

Tell the person where the figure is, how to embed it in a page, and give them
the README snippet. Add it to a README or a page yourself only if they asked.

*Done when* the figure renders in its page and its stills are written.

## Changing a figure that already exists

Edit `<figures>/<name>/figure.tsx` or its `model.json`, then:

```
P model check <figures>/<name>/model.json
P sheet <name>
P still <name>
```

Look at the sheet before retaking the stills. A new view of the same subject
is a new round from its model: `P draft new --model <figures>/<name>/model.json ...`.

## Rules

- The subject comes first: the lens, then the model, then a view designed
  for it. A study is a base only when its view is the view.
- Every draft in a round draws the same model, and says what it draws before
  it draws it. A change to the model is a new round.
- One house style. A draft never edits the kit; `draft check` fails a round
  where one did.
- A figure is a function of its clock. No `@keyframes`, no `transition`, no
  timers: `references/motion.md`.
- Nothing is shown to the person that has not passed the checklist.
- Nothing is downloaded, no package is added to the repo, and nothing is
  written outside the scratch folder, without the person having asked for it.

## References

```
references/
├── framework.md      the six steps, and why the model comes first
├── lenses.md         finding the picture: four questions, eight lenses, two lenses in one picture, how to step through a mechanism
├── model.md          model.json: the fields, the limits, more than things and flows, from a description, from code
├── archetypes.md     views and studies: designing a view, stating it, choosing three, the blank stage, when to draw in 3D
├── house-style.md    colour, line, shape, 3D, words, density
├── motion.md         one clock, in 3D, what each motion means, pacing, stills
├── legibility.md     the squint test, overlap, contrast, reading order
├── accessibility.md  reduced motion, text alternatives, the strip
├── delivery.md       where figures live, MDX, a figure drawn in 3D, README stills, strip and GIF
└── review.md         the checklist, the swap test for a template with new labels, and the cold read
```
