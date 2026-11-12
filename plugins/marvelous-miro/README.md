# marvelous-miro

An architecture diagram is true on the day it is drawn. After that the code
moves and the picture does not, and nobody finds out until a new person
trusts it. The second problem is smaller and more irritating: a diagram an
agent puts on a Miro board is rarely one a person can read. Captions stack on
shared connectors, a "straight" line draws diagonally, text spills out of its
card. marvelous-miro takes both on: the diagram is extracted from the code and
checked against it, and what reaches the board is linted like code.

## How it works

**The code declares its own shape.** Each module says what it is and whom it
calls in comment lines:

```js
// @system node intake "Intake" layer=service
// @system calls queue "hands on approved request"
// @system exposes take "takes one request and checks it"
```

`scripts/system-map.mjs` extracts those lines into `diagrams/system-map.json`,
committed beside the code and reviewed as a diff. Then it checks the map
against the code instead of trusting it: the real import graph (JS/TS and
Python) and the scripts a module runs as child processes must each have a
`calls` line, every directory of source files belongs to a node, calls go down
the layers, network calls live in adapters, and every export of an entry file
is classified. A stale map is `MAP_STALE`; an import nobody declared is
`UNDECLARED_IMPORT`. An import that deliberately needs no edge takes
`Diagram: none, <why>` in the commit message. The grammar and every finding
are in `skills/diagrams-sync/references/grammar.md`.

**The board is generated.** A project keeps a `miro.config.mjs` that names the
board and lists its frames. Each frame comes from a generator, a small module
that receives a drawing kit and returns a scene of cards, text, and arrows;
the system map's generator is one line.

1. **Build.** Each scene becomes Miro SVG, and the build writes nothing while
   the legibility lint finds overflowing text, collisions, crossed or diagonal
   connectors, captions longer than their run, or cards across a border. Each
   check encodes how Miro really draws (`skills/miro-board/references/how-miro-draws.md`).
2. **Publish.** The files go to the board through the Miro MCP.
3. **Live check.** Miro's read does not return connector routes or caption
   positions, so a script run in the board's browser tab dumps what Miro
   actually drew, and the same lint reads it.
4. **Pull.** The board's layout comes back into `miro/<frame>.layout.json`, so
   a card someone dragged in Miro survives the next build. Content changes in
   code; layout may change on the board.

**Two lines stay in the agent's context**, in a repo that has opted in to the
agentic-engineering plugins and carries a `miro.config.mjs` or a system map:
lint before publishing and check live after, and annotate a new module or call
in the same commit. They come back after a compaction or a `/clear` and reach
subagents that write code. In a repo with a Miro project, the session also
says one line when the machine lacks what the live check needs.

Node 22, no dependencies of its own. The scripts read files and git; only the
publish and the live check reach Miro, and they go through your sessions.

## Credentials

The plugin holds none, and asks for none.

- **Publishing** goes through the Miro MCP you connect yourself (the Miro
  connector, or `claude mcp add --transport http miro https://mcp.miro.com/`).
  Its sign-in is between you and Miro; no script here sees a token, and there
  is no API key to set.
- **The live check** drives a Chrome window through the bundled `miro-browser`
  server (chrome-devtools-mcp, pinned to one version, fetched by `npx` on first
  start). That Chrome uses a profile of its own under
  `~/.cache/marvelous-miro/chrome-profile`, and you sign in to Miro there once,
  yourself. The agent never types a password, and no script reads the profile.
- **The repo** gets a board URL and item ids (`miro/board.json`,
  `.agents/system-map.json`), nothing that grants access. Who can see a board
  is set in Miro, by you.

Nothing assumes a Miro organisation, team, or space: you name the board, or
ask for a new one. A repo whose boards must carry a classification label
before anything lands on them can set `requireClassification` in
`.agents/system-map.json`; the publish gate then refuses until the label is
recorded as confirmed.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install marvelous-miro@agentic-engineering
```

Start a new session after installing. You need:

- Node 22.12 or newer (20.19 also works for the browser server), with npx.
- Google Chrome, for the live check.
- The Miro MCP connected, for publishing.

`/marvelous-miro:browser-setup` checks the machine and gets the browser
connected. The system map and its check need none of the three beyond Node:
a repo can adopt the map and never touch a board.

## Skills

| Skill | Invocation | Does |
|---|---|---|
| `diagrams-init` | `/marvelous-miro:diagrams-init [board name or URL]` | Once per repo: proposes the `@system` annotations from the import graph, writes `.agents/system-map.json` and the committed map, records the board, publishes the first frame, and on request copies the checker in for CI. |
| `diagrams-sync` | model-invoked | Brings the map and the board level with a change: reads the checker's findings, fixes the annotations, regenerates the map, republishes. Also the whole-repo sweep, which fans out a writer and a reviewer per module in a large repo. |
| `miro-board` | model-invoked | Starts a Miro project, then runs the build, publish, live check, and pull loop for any frame drawn from code. |
| `browser-setup` | `/marvelous-miro:browser-setup` | Checks Node, npx, and Chrome, connects the bundled browser server on the current surface, and waits while you sign in to Miro once. |

## The check, by hand and in CI

```bash
node <plugin root>/scripts/system-map.mjs                  # check the whole repo
node <plugin root>/scripts/system-map.mjs --changed HEAD   # only what this change touched
node <plugin root>/scripts/system-map.mjs --write          # regenerate the map, then check
```

It exits 0 clean, 1 on a warning, 2 when it cannot run, and `--json` prints
the findings for a machine. The script is one file with no imports of its own,
so `diagrams-init` can copy it to `.agents/scripts/system-map.mjs` for a
pipeline step. A repo without `.agents/system-map.json` is untouched.

## Where it does not reach

The live check needs a local browser, so a cloud or remote session can build,
lint, and publish, but says the live check did not run. The import cross-check
reads JS/TS and Python; modules in other languages are declared by annotation
alone. Calls the checker cannot see (HTTP, queues, events, a script path built
at runtime) are found by reading the code, which is what the sweep's reviewers
are for.
