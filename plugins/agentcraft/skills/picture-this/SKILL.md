---
name: picture-this
description: "Use when asked to visualize, diagram, illustrate, or animate how a system, a feature, a mechanism, or an idea works, or when a README needs a picture of a figure that already exists. Routes are its arguments, not skills: visualize (a description or a feature into an animated figure); export-stills (a figure's stills, beat strip, or GIF for a README)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# picture-this

A system that takes three paragraphs to explain usually takes one good picture, and drawing that picture is the hard part, so most docs settle for the paragraphs. This area draws it: from a description, or a feature in a codebase, to a minimalist animated figure delivered as a React component for MDX, with a still, a strip of its steps, or a looping GIF for a plain README.

What the routes share, each in its own file's words, so read your route before you act or ask:

- **The model comes before the picture.** A figure is drawn from a model of its subject, and where the subject is code the model's sources name the files and lines they came from, so what the figure shows can be checked.
- **The person picks.** Three drafts are designed from the subject, one is chosen and refined, and which picture is right is theirs to say.
- **Images are captured, never drawn by hand.** A still, a strip, or a GIF is taken from the figure by the area's own tooling, in light and in dark.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `visualize`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `visualize` | a description or a feature into an animated figure | Use when asked to visualize, diagram, illustrate or animate how a system, feature, architecture, mechanism or idea works, or to explain one to a non-technical audience. | `[what to visualize: a description, or a path or feature in this repo]` | agent |
| `export-stills` | a figure's stills, beat strip, or GIF for a README | Use when a figure changed and its images need refreshing, or when a README or a plain Markdown page needs a picture, a step-by-step strip or an animation of a figure that already exists. | `<figure> [--strip] [--gif] [--beat <id>]` | agent |

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
