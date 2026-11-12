---
name: diagrams-init
description: "Set a repo up with a system map generated from its code: propose @system annotations from the import graph, write .agents/system-map.json and the committed diagrams/system-map.json, record the Miro board, publish the first frame, and on request copy the checker in for CI. Use when a repo should get a diagram that is extracted from its code and checked against it, once per repo."
disable-model-invocation: true
argument-hint: "[board name or URL]"
---

# diagrams-init

Setting the map up makes the code the source of the repo's system diagram. Investigate first, propose, and write only after the person agrees. Never overwrite an existing file; a conflict is a report line.

`MAP` below is `node "${CLAUDE_PLUGIN_ROOT}/scripts/system-map.mjs"`. Run it from the repo root (or pass `--root <repo>`). The grammar it reads is in `${CLAUDE_PLUGIN_ROOT}/skills/diagrams-sync/references/grammar.md`; read that first.

## Step 0: What it needs

- **The Miro MCP** (`board_search_boards`, `board_create`, `canvas_create_from_svg`, `canvas_read_as_svg`), connected by the person: the Miro connector, or `claude mcp add --transport http miro https://mcp.miro.com/`.
- **The browser the live check drives**, signed in to Miro. If `list_pages` is not an available tool, ask the person to run `/marvelous-miro:browser-setup`.

Without either, Steps 1 and 2 still give the repo its map and its check; say that the board waits, and stop after Step 2.

*Done when: both are present, or the person has been told exactly what is missing and what still works.*

## Step 1: Propose the modules

If the repo already has `.agents/system-map.json` when you start, Steps 1 and 2 are done: run `MAP`, fix anything it reports, and go to Step 3 for the board.

Read what the repo says about its own layout (the root README, an AGENTS.md and the files it points at), then the tree. Every directory with a job of its own (not a folder of helpers) is a candidate node; its entry file (`index.*`, `main.*`, `__init__.py`, `app.*`) carries the `node` line. Pick each node's layer from the grammar's six. List the systems outside the repo the code talks to (SDK clients, HTTP base URLs, queues, databases) as `externals`. A module that cannot carry a comment (a JSON catalog, a directory of only manifests and Markdown) and anything outside that calls in (people, agent hosts) is a config node under `nodes`, with its own `calls`.

Show the person that node list and get their yes to it. Then let the imports propose the edges: write the agreed `node` lines and the config (Step 2, item 1), run `MAP --json`, and read each `UNDECLARED_IMPORT` and `UNDECLARED_RUN` as a `calls` line to propose, with a label that says what passes. Calls the checker cannot see (HTTP, queues, events, script paths built at runtime) come from reading the code.

The checker then proposes the rest: every `NODE_MISSING` is a directory the node list missed, every `UNDECLARED_EXPORT` is an entry-file export to mark `exposes` (its interface) or `internal`, and every `LAYER_VIOLATION` or `EGRESS_OUTSIDE_ADAPTER` is a layer to reconsider, a call to move behind an adapter, or an exception to accept with a why. Run it without `--changed`, so it reports the whole repo.

Show the person the externals, the edges, the exports, and the exceptions as one table before writing any of them.

*Done when: the person has agreed the nodes, layers, externals, and edges.*

## Step 2: Write the annotations and the map

1. Copy `${CLAUDE_PLUGIN_ROOT}/skills/diagrams-init/assets/system-map.json` to `.agents/system-map.json`, with the title and `externals` filled in.
2. Add the agreed `@system` lines at the top of each entry file, in that language's comment syntax and below any shebang.
3. `MAP --write`, then fix every finding it prints. One that is deliberate goes in `accept` with a `why`.
4. Where the repo documents its layout, add a line for `.agents/system-map.json` and one for `diagrams/`.

*Done when: `MAP` prints `0 warning`, and `diagrams/system-map.json` exists.*

## Step 3: Record the board

Ask the person which board the map goes on. Nothing here picks a board, a team, or a space for them.

- **They name a board, or pass its URL as the argument:** use it.
- **They want a new one:** search first with `board_search_boards` for the name (default `<repo> system map`, at most 60 characters), so a rerun never makes a second board. If none exists, say what you are about to create and where, and on their yes call `board_create` with that name and a one-line description naming the repo. Pass a parent space only if they name one.

Record the board URL as `board` in `.agents/system-map.json`. The URL is all that is recorded: who may see the board is set in Miro, by the person.

If their boards must carry a classification label before anything lands on them, set `requireClassification` in the config to that label. The person sets the label in Miro. Confirm it by reading the board's label from a page snapshot through the browser, never by guessing, then record `"classification": { "label": "<the label>", "confirmed": "<YYYY-MM-DD>" }`. Until that is recorded, `MAP --can-publish` refuses.

*Done when: `MAP --can-publish` exits 0.*

## Step 4: Draw and publish the first frame

1. Follow the miro-board skill's Step 0 to initialize `diagrams/` against the board URL, then replace its example view in `diagrams/miro.config.mjs` with one view, `{ key: "system", title: "<the map's title>", gen: "./src/gen-system.mjs" }`, and delete `src/gen-example.mjs`.
2. Copy `${CLAUDE_PLUGIN_ROOT}/skills/diagrams-init/assets/gen-system.mjs` to `diagrams/src/gen-system.mjs`. It is one line: the build hands it the drawing.
3. Run `MAP --can-publish` again, then the miro-board loop: build, publish, live check, pull.
4. `MAP --mark-published`.

*Done when: the frame is on the board, the live check passes, `diagrams/miro/` holds the pulled layout, and `MAP` reports no findings at all.*

## Step 5: The check in CI, on request

Ask whether the map should be checked in CI. On a yes:

1. Copy `${CLAUDE_PLUGIN_ROOT}/scripts/system-map.mjs` to `.agents/scripts/system-map.mjs`. It is one file with no imports of its own, and the config's default `exclude` keeps `.agents/` out of the map.
2. Add one step to the repo's pipeline, on Node 22, with enough history fetched for the range to resolve: `node .agents/scripts/system-map.mjs --changed <base>..HEAD --note "<the pull request description>"`. It exits 1 on a stale map, an undeclared import, or a module no node owns.
3. Say that the copy is a snapshot: after a plugin update, copy it again.

*Done when: the person has said no, or the pipeline step is in a commit they have seen.*
