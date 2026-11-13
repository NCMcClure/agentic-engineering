---
name: export-stills
description: >-
  Capture light and dark PNG stills of a picture-this figure's hero frame and
  write the snippet that shows the right one in a README. Use when a figure
  changed and its images need refreshing, or when a README or a plain
  Markdown page needs a picture of a figure that already exists.
argument-hint: "<figure> [--beat <id>]"
---

# export-stills

A figure's still is an exact frame of the live figure, taken in the studio at
twice its size, once for a light page and once for a dark one. This skill
takes them and hands back the Markdown that shows the right one.

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

## 4. Hand over

Give the person the snippet. Put it in a README or a page yourself only if
they asked, and put it where the prose is about to explain what it shows.

GitHub shows the dark still to a reader on a dark theme. A renderer that does
not honour `<picture>` shows the light one. Commit both stills with the figure.

If the hero frame is not the frame a newcomer should see, change `hero` in
the figure's `model.json` and retake, so the live figure, its reduced-motion
state and its still all agree.
