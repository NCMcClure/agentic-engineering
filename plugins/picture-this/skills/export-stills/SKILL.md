---
name: export-stills
description: >-
  Capture a picture-this figure for a README: light and dark PNG stills of
  its hero frame, a beat strip of every step in one row, or a looping GIF,
  each with the snippet that shows it. Use when a figure changed and its
  images need refreshing, or when a README or a plain Markdown page needs a
  picture, a step-by-step strip or an animation of a figure that already
  exists.
argument-hint: "<figure> [--strip] [--gif] [--beat <id>]"
---

# export-stills

A figure's still is an exact frame of the live figure, taken in the studio at
twice its size, once for a light page and once for a dark one. This skill
takes them and hands back the Markdown that shows the right one. It also
takes the two exports that show more than one frame: the beat strip and the
looping GIF.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pt.mjs"`.

## 1. The studio and the figure

```
P setup --check
```

Stills need the studio and its browser. If either is missing, run `P setup`
to see what it would download, tell the person, and run `P setup --yes` only
on their yes.

The figure is one of the repo's (`<figures>/<name>/`, as `P init` recorded,
or `.agents/picture-this/figures/<name>/` by default). To make a new one, use
the **visualize** skill.

## 2. Look first

If the figure or its model changed since the last stills, look at it before
photographing it:

```
P model check <figures>/<name>/model.json
P sheet <name>
```

Open the `sheet.png` it writes. A still of a broken figure is a broken image
in a README.

## 3. Take the stills

```
P still <name>
```

It writes `<stills>/<name>.light.png` and `<name>.dark.png` and prints a
`<picture>` snippet.

| Option | For |
|---|---|
| `--beat <id>`, `--at <0-100>` | a frame other than the model's hero frame |
| `--technical` | the technical captions instead of the plain ones |
| `--width <px>` | a width other than 880 |
| `--from <dir>` | paths written for a Markdown file in that folder, not the repo's root |
| `--out <dir>` | somewhere other than the repo's stills folder |

The same command twice gives the same files, byte for byte, so a retake shows
up in git only when the picture changed.

## 4. More than one frame

The still is the figure's best frame. When the README has to carry the story
too, there are two more exports. Both are made by holding the figure's clock
at chosen instants, so they are as exact as the still, and the same command
twice gives the same bytes.

```
P still <name> --strip
P still <name> --gif
```

| Flag | Writes | Reach for it when |
|---|---|---|
| `--strip` | `<name>.strip.light.png` and `<name>.strip.dark.png`: the told beats in one row, numbered, each held at its middle with its caption under it, and the claim once beneath | the order of the steps is the point, or the page must hold still |
| `--gif` | `<name>.gif`: one whole loop, moving. `--dark` adds `<name>.dark.gif` | the motion is the point: something travels, builds up, or swaps |

With either flag the hero still is not retaken; give both flags for both.
`--technical`, `--from` and `--out` work as they do for the still. `--width`
is each beat's width in a strip (640 unless given) and the GIF's width (720
unless given). `--beat` and `--at` are refused: a strip shows every beat and
a GIF the whole loop.

A GIF costs what it weighs, and every reader downloads all of it before it
moves. The defaults cap that: 720 px wide, 15 frames a second, one loop, a
palette built from the figure's own frames. The command prints the size after
every export. Tell the person what it was.

- Past 5 MB it writes the GIF and warns.
- Past 10 MB, the most GitHub shows, it writes nothing and exits 1. A GIF
  that was there before is left as it was.

To bring one down, lower `--width` first (to 520 at the least), then `--fps`
(5 to 30). If it is still too large, the loop is too long for a GIF: use the
strip.

Open the strip, and the GIF, before handing them over. A GIF moves whether or
not the reader asked for less motion, so offer it beside the prose that
explains the system, never in place of it.

## 5. Hand over

Give the person the snippet. Put it in a README or a page yourself only if
they asked, and put it where the prose is about to explain what it shows.

GitHub shows the dark still to a reader on a dark theme. A renderer that does
not honour `<picture>` shows the light one. Commit both stills with the figure.
A GIF taken without `--dark` comes with a plain `<img>`: it is the light one
on every theme.

If the hero frame is not the frame a newcomer should see, change `hero` in
the figure's `model.json` and retake, so the live figure, its reduced-motion
state and its still all agree.
