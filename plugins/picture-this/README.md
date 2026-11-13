# Picture This

A system that takes three paragraphs to explain usually takes one good picture.
Drawing that picture is the hard part, so most docs settle for the paragraphs.

This plugin draws it. Describe how something works, or point at a feature in
your codebase, and it comes back with three rough animated drafts, each a
different picture designed from that subject. You pick one, it gets finished, and you end
up with a React component that drops into MDX, and pictures of it for a plain
README: a still, a strip of its steps, or a looping GIF.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/iso-flow.dark.png">
  <img alt="How an upload becomes a thumbnail. The API answers before the slow work starts, so an upload never waits on it." src="assets/iso-flow.light.png" width="880">
</picture>

That picture is one frame of the plugin's worked example, taken by the plugin.
Live, it plays: the pulse travels, the story moves on to the next beat, and a
strip under it pauses, steps, and scrubs. Its source is `studies/iso-flow/`.

The same model, the same layout, drawn in 3D (`studies/iso-flow-3d/`):

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/iso-flow-3d.dark.png">
  <img alt="How an upload becomes a thumbnail, in 3D. The API answers before the slow work starts, so an upload never waits on it." src="assets/iso-flow-3d.light.png" width="880">
</picture>

## How it works

Before anything else comes the **lens**. Not every subject is boxes with
arrows: a device is parts inside a case, a pipeline is work stepping through
stages in time, a blur is a number spread over a grid, a lock is five gaps
that must line up at once. Four questions about the subject say which
of eight lenses leads (structure, path, time, field, transformation,
difference, cases, scale), and where a second one goes when the subject
needs two.

Then the **model**: what the subject is made of, what is inside what, what
passes or changes, how much, and the beats of the story, saved as
`model.json` beside the figure. When the model comes from code, each entry
carries the file and line it was read from, and you approve it before
anything is drawn.

The three drafts all draw that one model, each as a different **view**: what
the page is, what each axis and each mark means, what moves. A view is
designed from the subject and stated in words before it is drawn, so you
read what each draft set out to show beside what it shows. Before you see
them, each draft is checked for defects, tested for being a stock diagram
with new labels on it, and shown, without captions, to a reader that knows
nothing about your system. What that reader understood is reported beside
the draft.

The plugin ships no templates. It ships a **vocabulary**: boxes, bars and
tiles, connectors, tokens, meters, ruled axes, grids of cells, isometric
slabs, blocks, drums and wires. A shape is in the kit only if figures of
unrelated subjects reached for it; what one subject alone needs (a key, a
gear, a globe) is drawn in that figure. And it ships
**studies**: eleven worked figures (a flow, a layer stack, a time grid, a
field of cells, and so on) to learn a technique from. A draft starts on a
blank stage unless a study's view is exactly the view the subject wants.

The look is one **house style**: monochrome with a single orange accent,
hairline line art, flat or isometric as the subject calls for, flat upright
labels. It ships as a small **kit**
that is copied into your repo and is yours from then on: plain CSS, React, no
animation library.

Two studies draw in **3D**: the same isometric framing in matte clay,
frosted glass and soft shadow, on React Three Fiber. A 3D figure reads the
same clock and the same model, and its labels stay flat. Drafts and stills
cost your repo nothing, since the studio has three.js; showing one live in a
site needs three packages there, and the plugin asks before it adds them.

A figure is drawn as a function of one **clock**. It plays when it scrolls
into view, loops, and has a strip to pause, scrub, or step. Because any
instant can be reproduced, the still in your README is an exact frame of the
live figure, not a screenshot taken at a lucky moment. The same goes for the
other two README exports. The **beat strip** lays every step side by side,
each held at its middle. The **looping GIF** is one frame for each instant of
a loop, photographed with the clock held there: nothing is recorded, so it
comes out the same every time, on any machine.

Rendering happens in a **studio**: a Vite app and a headless browser that the
plugin installs once into its own data folder, never into your project. The
plugin itself is plain Node with no dependencies.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install picture-this@agentic-engineering
```

The first figure installs the studio: Node 20+, network access, and a headless
browser (about 100 MB to download), once. It asks before it downloads anything.
After an update that changes the studio's packages it asks once more.

This plugin replaces `animated-storytelling`. If you had that one installed,
uninstall it and install this one; it will not update in place.

## Skills

| Skill | What it does |
|---|---|
| `/picture-this:visualize` | Finds the lens, models the subject from a description or from code, drafts three views designed from it, refines the one you pick, and places the component and its model in your repo. |
| `/picture-this:export-stills` | Captures a figure for a README and hands back the snippet that shows it: light and dark PNGs of its hero frame, a beat strip of every step in one row, or a looping GIF. |

Or just ask: "visualize how the job queue works", "diagram this feature for
someone non-technical", "the README needs a picture of the sync flow".

## Honesty box

- The kit is React. Figures embed in MDX on fumadocs or any React site; other
  targets get the stills only.
- A still taken in the studio uses the studio's fonts, so it matches your
  live docs in geometry, not in typeface.
- The cold read is a model looking at a picture. It catches a figure that
  does not explain itself; it is not a substitute for showing a person.
- A GIF is the costly export. It is 256 colours at one pixel per pixel, so
  it is rougher than the live figure, and every reader downloads all of it.
  The defaults keep it small (720 px wide, 15 frames a second, one loop: the
  worked example is 549 KB), the size is printed every time, a GIF past 5 MB
  comes with a warning, and one past GitHub's 10 MB is not written.
- A beat strip is one row, so a README shrinks it: its captions are sized to
  survive that, the labels inside each small picture are not.
- 3D is code-built, not modelled: it gets matte clay, frosted glass and soft
  shadows right, and has no bounce light, glow, or glass that bends what is
  behind it.
- A 3D figure adds `three`, `@react-three/fiber` and `@react-three/drei` to
  the site that shows it live: about 165 MB in `node_modules` with what they
  depend on. Its stills need none of them.
