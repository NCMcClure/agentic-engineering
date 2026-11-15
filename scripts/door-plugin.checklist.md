# The cutover checklist

What `node scripts/door-plugin.mjs <plugin> --write` leaves for a hand. It is
Stage 6's list, and it is deleted with the script.

Measured on a scratch copy of this tree (tip `515de38` plus Stage 5's tooling):
all twelve plugins moved in catalog order, one commit each, nothing by hand,
then `node scripts/gen-guide.mjs --write`, `node scripts/validate.mjs`, and
`npm test`, all in the copy. Run it again on a clean checkout before the
cutover: the script walks files git does not track too, and the counts below
move with the tree.

## What the script does

- Moves 678 files under `plugins/agentcraft/skills/`: thirteen areas (the
  twelve plugins, and `context-doctor` from the lens), 74 routes, each a
  `ROUTE.md`. Each old directory keeps its manifest and nothing else.
- Merges 29 hook entries, 1 module, 1 MCP server, and 2 agents into the one
  plugin's own files, each Node command written again behind the one plugin's
  guard, in the catalog's order of plugins.
- Rewrites 187 addresses in markdown and JSON, places 212 plugin-root paths
  under a named directory in routes, and rewrites 442 repo-root paths, 82 paths
  built from string parts, and 64 other root paths and relative links.
- Ends with the generator, which writes the area's file and brings the entry
  skill and the guide level with it.
- A second run of any plugin changes nothing. Shared copies still match
  `scripts/shared/` (15 of 15): the gate finds each where it moved.

Nothing below is the script's to fix. What the copy runs found that was, is
fixed: the lens route kept its skill's `name`, a split route's named directory
pointed at the plugin it left, a file the generator found missing was not
counted as changed, a template copy was only recognised under `agentcraft`,
and the gate knew the marker agent-works writes into AGENTS.md only without
its slash.

## The gate on the copy: 321 findings

| Group | Findings | Whose |
|---|---|---|
| Area data blank: 74 cues, 13 leads, 13 defaults | 100 | hand: the words |
| Entry skill: no group asks about `context-doctor`; `plugin-workbench` still hands off to `context-lens` (the data, and the line generated from it) | 3 | hand: the words |
| A critical line where an area named alone runs into the next word (the `perceptual-loop` area's address, then "and its doctrine") | 2 | hand: the words, with the hooks |
| Stubs: 12 with no README.md, 12 with no CHANGELOG.md, 12 with no `dependencies`, 12 whose description does not name `agentcraft`, 4 aliases missing, 1 manifest that still names `userConfig` | 53 | hand: stubs |
| An install line names a stub: 12 area READMEs, the root README, `install.mjs`, one test | 15 | hand: docs |
| An address names an area by its old plugin name, in tests | 80 | hand: tests |
| The same, in plugin code (hooks, scripts, workflows) | 31 | hand: ids in code |
| The same, in the kernel and its seven copies (2 lines each) | 16 | hand: shared copies |
| The same, in a figure (`.agents/picture-this/figures/profile-page-revised/figure.tsx`) | 1 | hand: ids in code |
| The mod's tool prefix: `mcp__agent-works__` in `register.mjs` (6), the `hooks.json` matcher (1), `sync.mjs`'s pattern (1) | 8 | hand: ids in code |
| The `DENYLIST` entry for the `vision-critic` agent, still under `perceptual-loop` | 1 | hand: ids in code |
| A route still writes `${CLAUDE_PLUGIN_ROOT}` (`codebase-optimizer/routes/optimize-codebase`, `context-doctor/routes/lens`): a form the script cannot place, listed in its report | 2 | hand: the words |
| Example addresses in `docs/known-limits.md` that name nothing: an area written as the word "area", and skills named "start" and "go" | 9 | hand: docs (write each as a placeholder, `<area>`) |

The script's own reports list what it left as it ran: 473 sites across the
twelve runs, about 230 distinct, since a line that names several plugins is
listed by each run. By what they are: an address in code (about 125, 76 of them
in tests), a path built from string parts with the plugin or the skill in a
variable (about 60, 16 in `scripts/*.mjs`), a path to a manifest that stays
(21), the root variable alone in prose (12), and a path that reads as prose
(8). `node scripts/door-plugin.mjs <plugin> --check` prints them again.

## The unit lane on the copy

2,298 tests: 2,203 pass, 92 fail, 3 skipped (this tree: 2,878 tests, 0 fail).
The failures are in 35 files, and every one is a test written for the old
shape, so all of it is hand work: tests. The three suites of the tooling
itself (`area-plugin`, `door-plugin`, `gen-guide`) pass on the copy.

| Group | Entries | Where |
|---|---|---|
| The suite does not load: a path it builds from parts (`hooks/hooks.json`, `skills/`, a module to import) is where the plugin was | 18 suites, each hiding all its tests | `hooks.test.mjs`, and in `unit/`: `agent-works-hooks-json`, `agent-works-skills`, `agentic-teamwork-skills`, `but-first-planning-hooks`, `but-first-planning-skills`, `but-first-planning-workspace`, `code-diet-hooks`, `codebase-optimizer-skills`, `picture-this-skills`, `plugin-workbench-skills`, `system-map-hooks`, `system-map-map-sweep`, `system-map-skills`, `system-map-stop`, `workflow-studio-skills`, `write-like-me-hooks`, `write-like-me-skills` |
| A test stops at a path that moved (a file to read, a script to run) | 49 | `agent-works-aw` 21, `system-map-board` 12, `validate` 4, and 12 across `agent-works-common`, `agent-works-pane`, `docs-parity-hooks`, `perceptual-loop-guard`, `perceptual-loop-hooks`, `perceptual-loop-review`, `picture-this-kit`, `system-map-system-map` |
| An assertion on what the old shape printed (an old address in a line a hook injects, a finding the gate words differently, a count of plugins) | 26 | `validate` 14, and 12 across `agent-works-conflicts`, `agent-works-session`, `docs-parity-hooks`, `live-lane`, `perceptual-loop-hooks`, `plugin-workbench-context-lens`, `plugin-workbench-scaffold`, `plugin-workbench-scan`, `system-map-board` |

The runner counts 92 failures and lists 93 entries; the table follows the
list. A suite that loads again will show what its own tests assert, so expect
the second and third rows to grow before they shrink. `scripts/test-hooks/cases/`
is keyed by plugin, and `hooks.test.mjs` reads each plugin's own `hooks.json`:
the cases move to the one plugin's hook map with the hooks commit.

## What the host spikes add

Measured on Claude Code 2.1.325 in a scratch config (`docs/known-limits.md`
has each run). None of it is something the gate can see.

- A person cannot type an area: `/agentcraft:<area> <route>` typed by a person
  is refused before the model sees it. Every line written for a person (a
  README, a hook's `systemMessage`, `start-here`'s hand-off of a route only a
  person starts) says to type `/agentcraft:start-here`, or to ask in words.
  Whether areas stay out of the slash menu at all is the owner's call, to be
  settled before the cutover.
- An alias that is `user-invocable: false` answers a model and turns a person
  away. An old command a person should still be able to type needs an alias
  they can type, which costs a listing entry.
- State moves while the stub is still installed. A plugin's data directory is
  deleted on uninstall, so write-like-me's ledger is copied by the first
  session that runs `agentcraft`. A `userConfig` value does not carry to the
  new plugin id: agent-works' `syncIntervalSeconds` starts unset, so say so.
- A route never mentions `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}`. An
  area's `SKILL.md` gets both filled in, and names the data directory for the
  routes that need it (write-like-me, workflow-studio).
- The `aw` launcher lives at `plugins/agentcraft/bin/` and reaches its script
  under `skills/agent-works/scripts/`: the plugin's `bin/` is on the Bash
  tool's PATH. A hook's process does not get that entry.
- The doctor checks two more things: the Claude Code build against 2.1.321,
  and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, under which a stub's
  dependency is not installed and the stub fails to load.
- Before a stub is deleted, a person has installed `agentcraft` by name. A
  dependency the host installed is marked removable, and one `claude plugin
  prune` takes it once every stub is gone. The stub's README says so.

## What no rule sees yet

The gate does not yet hold the one plugin's hooks to anything, so these pass
on the copy and are still wrong:

- Hooks speak once. `plugins/agentcraft/hooks/hooks.json` runs eight commands on
  SessionStart and seven on SubagentStart, one per area that had a session
  hook, each with its own `critical.json` and its own copy of the kernel under
  `skills/<area>/hooks/`. The gate reads critical lines from
  `plugins/<plugin>/hooks/critical.json`, finds none, and reports 0 of 7,500
  characters. The hooks commit makes them one helper, one `critical.json`, and
  the kernel's `ORDER` a list of areas, with the gate's rules for that shape
  in the same commit.
- Per-plugin gate data. `scripts/plugins/<name>.json` still lists `shared` and
  `critical` by old plugin; it resolves today through `placed()` in
  `scripts/lib.mjs` and becomes the one plugin's file.
- `plugins/agentcraft/bin/aw.cmd` still runs `..\scripts\aw.mjs`: a Windows path
  no pass reads. It is `..\skills\agent-works\scripts\aw.mjs` now. `bin/aw` was
  rewritten.
- `plugins/agentcraft/skills/but-first-planning/install.mjs` moved with its plugin. The stub
  keeps a file at that path (the README publishes a curl to it) that says where
  to go.
- Versions and history. `agentcraft`'s `plugin.json` version and `CHANGELOG.md`
  entry, the catalog descriptions, the root README's sections, and
  `plugins/AGENTS.md` are all a person's; each area keeps the README and
  CHANGELOG it had as a plugin.
- The live lane. Its triggers and baseline name a skill by its plugin; the
  baseline is a recording and stays, the triggers move, and a new baseline is
  recorded after the cutover.
- `UNHELD` in `scripts/test-hooks/unit/validate.test.mjs` lists five files
  whose fixture addresses the gate fails once the tree holds an area. Fix those
  files and delete the list.
- `SPLIT`, `TEMPLATE_TREES`, `ALIASES`, `STUB_EXTRAS`, `MOD`, and
  `NON_NODE_ALLOWLIST` name files by their path as a plugin's own. Once every
  plugin has moved, write the paths as they are and drop `placed()`,
  `areaPath()`, and this script.
