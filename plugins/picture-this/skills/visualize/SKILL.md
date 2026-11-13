---
name: visualize
description: >-
  Turn a description, or a feature in a codebase, into a minimalist animated
  visualization of how a system works: model it, draft three variations,
  refine one, and deliver a React component for MDX plus README stills. Use
  when asked to visualize, diagram, illustrate or animate how a system,
  feature, architecture or idea works, or to explain one to a non-technical
  audience.
argument-hint: "[what to visualize: a description, or a path or feature in this repo]"
---

# visualize

Draws how a system works: what it is made of, what passes between its parts,
and why that matters, as one small animated figure that also holds still for
a README. The figure is a React component and a `model.json`, in the repo.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pt.mjs"`. Every command
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

## 1. Model

Read `references/model.md`. Write the model to a scratch file, for example
`.agents/picture-this/drafts/<name>.model.json`.

- **From a description**: write it, then `P model check <file>`.
- **From code**: read the feature first. Put a `source` (`path:line`) on
  every entity and flow, run `P model check <file> --require-source`, then
  show the person the model as a short plain-language list (the things, what
  passes between them, the beats, the claim) and **wait for a yes** before
  drawing anything.

*Done when* the check passes and, from code, the person agreed.

## 2. Form

Pick three archetypes that are as unlike each other as the claim allows:
`references/archetypes.md` has the table and how to choose. `P draft
archetypes` lists what there is.

Two of them draw in 3D. Use at most one in a round, and only when the figure
is a page's centrepiece: "When to draw in 3D" in `references/archetypes.md`.
Drafting in 3D adds nothing to the repo.

```
P draft new --model <file> --archetypes <a>,<b>,<c>
```

This makes a round in `.agents/picture-this/drafts/round-N/`: one folder per
draft (`a`, `b`, `c`), each with the model and its archetype's starter, and
the kit they share. The folder is ignored by git.

## 3. Draft

A starter draws the model at once, on a default layout. That is a starting
point. Each draft has to become this model's picture.

Give each draft to its own subagent, all three in one message so they run
together. Each brief carries:

- its draft folder, and that it may edit **only** `figure.tsx` there: not the
  model, not the kit, not another draft;
- to read `kit/README.md` in the round folder (the kit's API),
  `references/house-style.md`, and its archetype's row and the "What a
  starter is" section in `references/archetypes.md`;
- the two commands it runs: `P sheet <round>/<id>` to render, and to open the
  `sheet.png` that writes and look at it;
- the checklist in `references/review.md`, and to fix what fails and render
  again, at least once;
- what to return: what it changed from the starter, which checklist items
  pass, and anything it could not fix.

With no subagents, draft the three yourself, one after another, the same way.

Do not polish motion yet. A rough draft has a sound layout, readable words,
the accent in the right place, and the default motion.

## 4. Check

```
P draft check <round>
```

Then, for each draft, the two passes in `references/review.md`: the
checklist on `sheet.png`, and the cold read of `sheet.nocap.png` by the
`picture-this:cold-reader` agent, which is told nothing but the picture's
path. Write each draft's `coldread.json`.

*Done when* every draft passes the checklist and has been read cold.

## 5. Pick

Show the person the three `sheet.png` files, with one line each: the
archetype, and what the cold reader understood and missed. Say which you
would pick and why, in a sentence. Then ask.

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
PNGs and prints the Markdown that shows them.

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

Look at the sheet before retaking the stills. A new form for the same system
is a new round from its model: `P draft new --model <figures>/<name>/model.json ...`.

## Rules

- The model comes first, and every draft in a round draws the same one. A
  change to the model is a new round.
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
├── model.md          model.json: the fields, the limits, from a description, from code
├── archetypes.md     the nine kinds of picture, how to choose three, when to draw in 3D
├── house-style.md    colour, line, shape, 3D, words, density
├── motion.md         one clock, in 3D, what each motion means, pacing, stills
├── legibility.md     the squint test, overlap, contrast, reading order
├── accessibility.md  reduced motion, text alternatives, the strip
├── delivery.md       where figures live, MDX, a figure drawn in 3D, README stills
└── review.md         the checklist, and the cold read
```
