# System map

Diagrams drawn after the fact describe the system someone remembered. Here the code declares its own shape, so the diagram is extracted from it rather than drawn: each module says what it is and whom it calls in `@system` comment lines, and the map, the board, and the checks all read those lines.

`MAP` below is the checker, `scripts/system-map.mjs` at the plugin root, run with `node` from the repo root; the diagrams-sync skill spells the command out.

## The grammar

Comment lines, in any language (the `//`, `#`, `*`, or `--` prefix is stripped):

```
// @system node intake "Intake" layer=service
// @system calls queue "hands on approved request"
// @system calls ext:tracker "files the request as an issue"
// @system exposes intake "takes one request and checks it"
// @system internal parseRequest
```

- `node <id> "<title>" layer=<layer>` declares the module rooted at the file's directory, usually in its entry file. One node per directory; ids are unique in the repo.
- `calls <id> "<label>"` declares an edge from the module that owns the file (the nearest declared ancestor directory) to another node. `ext:<id>` names a system outside the repo, listed under `externals` in `.agents/system-map.json`. The label says what passes, in a few words.
- `exposes <name> "<label>"` puts an export of the node's entry file on its card; `internal <name>...` marks exports that are not its interface (helpers exported for tests). Every export of the entry file takes one or the other.
- Layers are the rows of the picture, top to bottom: `people`, `surface`, `service`, `adapter`, `runtime`, `external`. Calls go down or across, never up.
- What cannot carry a comment (a JSON catalog, a directory of manifests and Markdown, a host outside the repo that calls in) is declared under `nodes` in `.agents/system-map.json`, with a `title`, a `layer`, an optional `path` it owns, and its own `calls`. Prefer a comment in code wherever one fits.

## The rules

**Annotate in the same change.** A new module gets its `node` line, and a new call between modules gets its `calls` line, in the commit that adds the code. Then `MAP --write` regenerates `diagrams/system-map.json`, which is committed beside the code and reviewed as a diff.

**The imports and runs keep it honest.** The checker reads the real import graph (JS/TS and Python) and the repo scripts each module runs as a child process (a `path.join` of literals in a file that spawns, a quoted path inside a spawn call, a `node <path>` line in YAML or shell), and reports any that cross modules with no `calls` line. Declare the call, or move the code. An import that deliberately needs no edge takes `Diagram: none, <why>` in the commit message or the pull request description.

**The structure is checked, not trusted.** Every directory of source files belongs to a node (`NODE_MISSING`). A call up the layers is `LAYER_VIOLATION`. A network call (`fetch`, `http`, a spawned `gh`/`glab`/`curl`, a Python HTTP client, or a pattern in the config's `egress`) belongs in an `adapter` node (`EGRESS_OUTSIDE_ADAPTER`). An unclassified export of an entry file is `UNDECLARED_EXPORT`. A deliberate exception goes in the config's `accept` with a `why`.

**The board is generated, never edited for content.** Moving cards on the Miro board is fine, and the layout is pulled back into `diagrams/miro/`. Renaming, adding, or removing a box happens in the code.

**A publish goes through one gate.** `MAP --can-publish` refuses until the config records a board. A repo whose boards must carry a classification label sets `requireClassification` to it, and the gate then also refuses until `classification` records that label as confirmed on the board. Who may see a board is set in Miro, by its owner; nothing here changes it.

## The config

`.agents/system-map.json`, at the repo root. Its presence is what turns the map on; a repo without it is untouched.

| Key | What it holds |
| --- | --- |
| `title` | the map's title, and the frame's |
| `map` | where the committed map goes (default `diagrams/system-map.json`) |
| `include`, `exclude` | globs of what is scanned; `.agents/**` is excluded by default, and Markdown, tests, fixtures, `node_modules`, `diagrams/`, and any `miro.config.mjs` always are. A config file at the repo root (a bundler's, a linter's) is source no node owns until it is excluded here or accepted |
| `externals` | `{ id: title }` for systems outside the repo, named `ext:<id>` in `calls` lines |
| `nodes` | modules that cannot carry a comment: `{ id: { title, layer, path?, calls: [{ to, label }] } }` |
| `egress` | extra regex patterns that count as a network call |
| `accept` | deliberate exceptions: `{ code, path?, why }` |
| `board` | the Miro board's URL, once there is one |
| `requireClassification`, `classification` | the opt-in label gate above |
| `publishedHash` | what `--mark-published` records, so `BOARD_BEHIND` knows when the board is stale |

## Opting in

`/marvelous-miro:diagrams-init`, run by a person once per repo, writes the config, proposes the annotations from the import graph, records the board, and can copy the checker into the repo for CI. From then on `/marvelous-miro:diagrams-sync` brings the map and the board level with a change.
