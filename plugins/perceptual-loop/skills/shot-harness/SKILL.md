---
name: shot-harness
description: "Use to set a project up for perceptual checks: the state folder, the render commands, shots, helper passes, groups, and the render budget. The person starts it."
disable-model-invocation: true
argument-hint: "[what the project renders, and what the reference is]"
---

# shot-harness

The loop needs one thing from a project: a command that writes a shot's outputs into its folder, one for the **reference** and one for each **candidate**. Everything else (the metrics, the baseline, groups, the budget) is the plugin's. Shapes and names: `${CLAUDE_PLUGIN_ROOT}/references/contract.md`.

`P` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/pl.mjs"`.

## Step 1: Scaffold

```
P init --reference <id> --candidate <id> --render <candidate-id>="<command with {shots}>" [--render <reference-id>="<command>"]
```

It creates `.agents/perceptual/` (the config, groups, an empty baseline, `success/`, `decisions/`, and a `.gitignore` for `shots/`, `runs/`, and `decisions/review.html`) and never overwrites. In a repo with `.agents/AGENTS.md` it also adds the Layout line naming `perceptual/`, and says so. Decide now whether shots are committed: pictures made from licensed or third-party content stay out of the repository, so point `shotsDir` at a folder outside it.

A render command is started from the project root as a program with its arguments, never through a shell, so a shot name or a folder with a space in it cannot become a second command. A string is split into words the way a shell would split them (quotes respected, leading `NAME=value` words become its environment); an array in `config.json`, such as `["node", "tools/render.mjs", "{shots}"]`, is taken as it is, and `{shots}` as a whole argument becomes one argument per shot. A pipeline, a redirection, or a `$VARIABLE` needs a shell: put the line in a script and name the script, or name the shell yourself, `["bash", "-c", "<the line>"]`. On Windows a `.cmd` program such as `npm` is started as `["cmd", "/c", "npm", ...]`.

*Done when: `.agents/perceptual/config.json` exists and names the reference and every candidate.*

## Step 2: The candidate's render command

Write (or find) the project's script that, given shot names, renders each one and writes `<candidate>.png` into the shot's folder, exiting non-zero on failure. Recipes per kind of project (a web page, a game engine, a terminal UI, a generated image) are in `references/capture-recipes.md`: read the one that matches.

Make it **deterministic** before measuring anything. The usual causes of a picture that differs between two renders of the same shot, and the fix for each:

- **The clock and randomness:** fix the clock and every seed from the shot's state.
- **Temporal filters** (anti-aliasing with history, auto exposure, eye adaptation, motion blur, dithered transparency): render warm-up frames, then write the **mean of the last few frames** as the shot.
- **Asynchronous loading:** wait for an explicit "ready" from the application (assets built, fonts loaded, the network idle), never a fixed sleep. The first render after an import or a cold cache is suspect: gate on the second.
- **Order dependence:** a shot rendered after another on a warm scene is not quite the shot rendered fresh. Render in one fixed order, by name, every time.
- **History in the picture** (trails, accumulated effects): make it settle at once when time stands still, so the shot is a function of its instant.

A shot whose point is motion also gets a **clip**: its frames as `frames/<source>/000000.png`, named by frame number at a fixed step of the candidate's clock, or one `<source>.mp4` in the shot's folder. `check-motion` reads it with `--shot <name> --source <source>`. A shot whose point is sound gets a `<source>.wav` in its folder, captured with no audio device in the path (rendered offline, or tapped before the output) at a fixed rate and length; `check-audio` reads it the same way.

Then prove it: render the same few shots twice into two runs and calibrate the pair; the spread it prints is what `calibrate-gate` turns into tolerances.

```
P iterate <shot> --run twice --repeat 2
P calibrate --runs twice1,twice2
```

*Done when: `P iterate <shot> --dry-run` prints the command, a real run writes the picture, and the two runs' spread is under the smallest change the gate must catch (or it is recorded as what `calibrate-gate` must measure).*

## Step 3: The reference

A reference is captured **once** and kept; it is captured again only when the reference itself must change. Its command may be slow, need a person's session, or be a manual export; record how in the config's `render` entry or in `.agents/perceptual/README.md`. Each reference shot carries the **state** that produced it (a recording, a URL and a viewport, a seed, a scene file) in `shot.json` `meta` or beside it, so a candidate can reproduce the same instant. Keep an archive when references are replaced.

*Done when: every shot has `<reference>.png`, and its folder holds what a candidate needs to reproduce that instant.*

## Step 4: Helper passes, where the renderer can make them

A number for the whole frame hides where the difference is. Region numbers need regions:

- **An `id` pass** (best): the scene in flat colours, one per kind of thing, with `ids.json` naming the colours (`P new-shot <name> --id body=FF0000`). Draw it with alpha sampled the way the beauty pass samples it, or the silhouettes disagree.
- **A `mask` pass:** the subject white on black, giving `subject` and `background`.
- **Boxes** in `shot.json` `regions` (`P new-shot <name> --region panel=0.1,0.2,0.5,0.6`): the fallback for a UI or a fixed camera.
- **An `albedo` pass:** the surface before light; it settles whether a colour is wrong or the light is different.

Set `regionsFrom` to the one source whose regions every run uses, so the numbers stay comparable from run to run.

*Done when: `P compare <shot> --run probe` prints a shot whose metrics file has a `regions` section, or the config records that no region source exists.*

## Step 5: Shots, names, and groups

Name shots `<content>__<place-or-state>__<view>` (double underscores between parts), so patterns select them. Put what distinguishes them in `shot.json` `meta` (the content, the condition, the view). Then:

```
P new-shot <name> --meta <key>=<value> --from-image <source>=<path>
P groups suggest-smoke --by <meta-key>,<meta-key>
```

Write the proposed `smoke` group (every content pair and condition once) and topical groups into `groups.json` as name patterns, not lists, so new shots join by their names.

*Done when: `P groups list` shows `smoke` with a count, and every topic the work touches has a group.*

## Step 6: The budget, and renders only one session may run

`budget.match` in `config.json` holds patterns of the commands that render. It starts with the pattern for `pl.mjs iterate`; add the project's own render commands when an agent might run them directly. The guard then refuses a render above `budget.free` shots that states no reason.

An application only one session may use at a time (the renderer, an editor, the GPU for a timing): nothing in this plugin enforces the turn, so name it as one session at a time in every brief. If agent-works is installed, declare it as a resource there and run the render under that plugin's lock; the guard judges the wrapped command as the command inside it, so the budget still counts.

*Done when: `budget.match` covers every command that renders, each scarce application is locked or named as one at a time, and a first `P iterate <shot>` exits 0 or 1 and prints the pictures to open. Next: `calibrate-gate` for the tolerances, then `iterate-shots`.*
