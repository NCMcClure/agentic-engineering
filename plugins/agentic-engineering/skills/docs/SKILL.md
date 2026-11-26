---
name: docs
description: "Use whenever a change touches what a user, integrator, or operator sees, for any README being written or cut down, when a module or a call between modules is added in a repo that keeps a system map, and to draw a system, a feature, or an idea as an animated figure or a Miro frame: the docs, the map, and the pictures move in the same change as the code. Routes are its arguments, not skills: sync (bring user docs level with a diff before it is committed); audit (are the user docs current: report only); shots (the docs screenshot harness: add, retake, repair a shot); readme (write or cut down a README); init (adopt the user-docs checks in a repo); map-sync (a code change moved the system map or its board); miro (draw or update a frame, fix overlaps, pull layout back); map-init (give a repo a system map generated from its code); browser-setup (the live check has no browser tools or cannot reach Miro); figure (a description or a feature into an animated figure); stills (a figure's stills, beat strip, or GIF for a README)."
user-invocable: false
argument-hint: "[route] [the route's arguments]"
---

# docs

Docs that ship after the code ship wrong, and so does a diagram drawn once and never again. This area makes them part of the change, the same way a test is: user docs and their screenshots, the README, a system map extracted from the code and drawn on Miro, and animated figures of how a thing works. Three kinds of route live here.

## User docs and the README

The rule's short form is a critical line the session hook prints in every repo that carries `.agents/docs-parity.json`; its long form is `${CLAUDE_PLUGIN_ROOT}/skills/docs/references/rule.md`.

A change needs docs when a reader of any root (`audiences.md`) would notice it: a screen, label, or message; a flow's steps; a command, flag, default, or exit code; a config key or file format; an endpoint, payload, or event; a permission; an install or upgrade step; a limit or a price. A refactor, a test, or an internal rename moves nothing a reader sees. Say which in the `Docs:` line either way.

In a repo with no `.agents/docs-parity.json` the hooks are silent. The rule still holds if the project's `AGENTS.md` states it: follow the references by hand and skip the checker. Do not create the config unasked: `init` is the person's to start.

The contracts are under `${CLAUDE_PLUGIN_ROOT}/skills/docs/references`: `audiences.md` (the roots, and what each may contain), `page-shape.md` (frontmatter, the opening summary, budgets, nav order, voice), `targets.md` (sites, `docs/` folders, wikis, README-only, the CI job), `shot-contract.md` and `capture-recipes.md` (what every screenshot must satisfy, and a harness per stack), and `config.md` (the config and every finding code: read it when the checker prints one you do not recognise). The checker is `${CLAUDE_PLUGIN_ROOT}/skills/docs/scripts/docs-check.mjs`, and a route says how it runs it.

## The system map

Each module declares what it is and whom it calls in `@system` annotations; the map is extracted from them into a committed file that a checker holds to the import graph, and generators draw it on Miro, linted before it is published and checked live after.

- **The code is the source of the map.** A module or a call changes in its annotation, and the map file is regenerated, never edited by hand.
- **The lint is the reviewer.** Never zoom in on the board hunting for overlaps, never place items by eye, and never loosen a check to get past a finding.
- **Content changes in code, layout on the board.** A box, a caption, or a connector changes in its generator; a card the person moved in Miro is pulled back, not redrawn.
- **Signing in to Miro is the person's.** It happens in their browser window; never type a credential. Nothing on a board is deleted without their yes.

## Figures

`figure` draws how something works, from a description or a feature in a codebase, as a minimalist animated React component for MDX; `stills` takes a still, a strip of its steps, or a looping GIF for a plain README.

- **The model comes before the picture.** Where the subject is code, the model's sources name the files and lines.
- **The person picks.** Three drafts are designed from the subject, one is chosen and refined, and which picture is right is theirs to say.
- **Images are captured, never drawn by hand.** A still, a strip, or a GIF is taken from the figure by `pt`, in light and in dark.

The data directory for this area is `${CLAUDE_PLUGIN_DATA}/docs`. The figure studio is installed and run from there, so it survives a plugin update.

Each route's steps are in its own file: read your route before you act or ask.

## Route

A route is `routes/<route>/ROUTE.md` under the directory this file is in, which the host names when it loads this skill.

The arguments are the text this skill was invoked with. Their first word is the route: read that route's `ROUTE.md` and follow it, with the rest as its arguments. If the first word is not a route, the arguments are the task; with no arguments, the task is the one at hand. Take the route whose row fits the task, and when none plainly does, the default, `sync`.

A route is a document to read, never a skill to call: no skill is named after one.

| Route | In short | Use when | Arguments | Starts it |
| --- | --- | --- | --- | --- |
| `sync` | bring user docs level with a diff before it is committed | Use after (or while) changing a user-visible surface, when the Stop hook or CI reports PARITY_MISSING or SHOT_STALE, or when the user says "update the docs for this", "sync the docs", or "retake the screenshots". |  | agent |
| `audit` | are the user docs current: report only | Use before a release, after a large change to a user-visible surface, or when the user asks whether the docs are current; to fix what it finds use sync. | `[root or page glob to limit the audit]` | agent |
| `shots` | the docs screenshot harness: add, retake, repair a shot | Use when a page needs a new screenshot, a shot is stale or flaky, a project has no capture harness yet, or the user asks to "add a screenshot", "retake the screenshots", or "set up screenshot capture" for a web app, desktop app, CLI, game engine (Unreal), notebook, or mobile app. |  | agent |
| `readme` | write or cut down a README | Use when readme-check.mjs, the Stop hook, or CI reports a readme-* finding or warning, when a README is over the limit, and when writing or reviewing a README. |  | agent |
| `init` | adopt the user-docs checks in a repo | Use when a repo with user docs should get the docs rule in every session, the Stop check, and the checker in CI. | `[target: site \| docs-folder \| wiki \| readme] [audiences]` | person |
| `map-sync` | a code change moved the system map or its board | Use when adding a module or a call between modules in a repo that carries .agents/system-map.json, when the Stop hook, the checker or CI reports MAP_STALE, MAP_MISSING, UNDECLARED_IMPORT, UNDECLARED_RUN, or BOARD_BEHIND, or when the user says "update the diagram", "sync the board", or "redraw the system map". |  | agent |
| `miro` | draw or update a frame, fix overlaps, pull layout back | Use when drawing or updating a diagram, flow, or architecture frame on Miro. |  | agent |
| `map-init` | give a repo a system map generated from its code | Use when a repo should get a diagram that is extracted from its code and checked against it, once per repo. | `[board name or URL]` | person |
| `browser-setup` | the live check has no browser tools or cannot reach Miro | Use when the miro route's live check has no evaluate_script or list_pages tool, when the system-map session note says the check cannot run on this machine, when the Miro tab cannot be found or reached, or to repair the browser for Miro. |  | person |
| `figure` | a description or a feature into an animated figure | Use when asked to visualize, diagram, illustrate or animate how a system, feature, architecture, mechanism or idea works, or to explain one to a non-technical audience. | `[what to visualize: a description, or a path or feature in this repo]` | agent |
| `stills` | a figure's stills, beat strip, or GIF for a README | Use when a figure changed and its images need refreshing, or when a README or a plain Markdown page needs a picture, a step-by-step strip or an animation of a figure that already exists. | `<figure> [--strip] [--gif] [--beat <id>]` | agent |

A `person` route runs when the person asks for it, by name or by what it does; never start one on your own. That holds when its name is the first word of the arguments too: read it only where the person in this session asked, or the arguments say they did (`start-here` says so when it hands one over). In a child session, a headless run, or a subagent, say that it needs a person, name it, and do not do its work another way.

After a compaction, read your route's `ROUTE.md` again before going on: the host re-attaches this skill, not a file read by path.

<!-- end of the generated Route section -->
