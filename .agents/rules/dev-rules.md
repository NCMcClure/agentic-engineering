# agentic-engineering dev rules

The contract for maintaining this marketplace, for humans and agents alike.
`scripts/validate.mjs` enforces the checkable rules; CI runs it on every push
and PR. When a rule changes, change the check in the same commit.

## Stack

- Node 22, stdlib only, `.mjs`: no dependencies, no lockfile, no build step.
- No Python or shell in the plugin. A non-Node file that has to stay is listed
  by exact path in `NON_NODE_ALLOWLIST` in validate, with the reason.
- Set `process.exitCode` and let Node unwind; never call `process.exit()`. A
  hook's stdout is its whole contract, and an early exit can cut it short or
  crash Node 24. Validate fails a call in any Node file under `plugins/` or
  `scripts/`, a test's `node -e` line included.

## Layout invariants

- The marketplace ships one plugin, `plugins/agentcraft/`. Every other
  directory under `plugins/` is a stub. The tree has no third shape.
- The plugin holds `.claude-plugin/plugin.json`, `README.md`, `CHANGELOG.md`,
  `hooks/`, `lib/`, `agents/`, `bin/`, `.mcp.json`, and `skills/`: the entry
  skill and the areas, nothing else.
- What several areas use sits once, in `lib/`, with a suite of its own name.
  A file a route copies into a user's repo is the one exception, held
  hash-equal to the one in `lib/` (`HASH_PAIRS` in `scripts/lib.mjs`).
- The plugin never references a file outside its own directory: an install is
  a cached copy. `${CLAUDE_PLUGIN_ROOT}` is replaced on update, so state that
  has to last goes under `${CLAUDE_PLUGIN_DATA}/<area>/` (`lib/data-home.mjs`).
- No absolute machine path, `.DS_Store`, `node_modules/`, build artifact, or
  cache in the tree. LF line endings.
- The catalog has one entry per plugin directory and never a `version` key.

## Areas

- An area is `skills/<area>/`: a skill directory that holds `routes/`. A route
  is a document, `routes/<route>/ROUTE.md`, read by path; no `SKILL.md` sits
  below an area.
- `door.json` beside the area's `SKILL.md` is its data: a one-line `lead`, a
  `default` route, and per route a `cue` of at most 60 characters and, where
  only a person starts it, `"starts": "person"`.
- The area's frontmatter and `## Route` table are generated from that and each
  route's frontmatter; the text around the table is written by hand.
  Description at most 1,536 characters, body 8,000.
- An area carries `user-invocable: false` and never `disable-model-invocation`:
  a model calls it, and a hidden skill is refused with an order to stop.
- A route's frontmatter carries only `name` (its directory's), `description`
  (which says when to take it), and `argument-hint`.
- A route never writes `${CLAUDE_PLUGIN_ROOT}` or `${CLAUDE_PLUGIN_DATA}`:
  read by path, neither is filled in. It names a directory from its own file
  ("`W` below is `../..` from the directory this file is in") and writes each
  path under it, quoted in a command and in a code span in prose. A directory
  of the repo the route works in, which differs from run to run, is named the
  same way by what it is ("`P` below is the workspace this run works in"):
  declared, and resolved by nothing here. The area's
  `SKILL.md`, which the host does fill in, names the data directory for its
  routes.

## The entry skill

- `skills/start-here/` is the one skill a person can type. A person cannot
  type an area: the host refuses it. So nothing written for a person (a
  README, a doc, a message a hook shows them) tells them to. It says
  `/agentcraft:start-here`, or to ask in plain words.
- `start-here.json` holds what a person is asked: one to four groups, each a
  question of two to four options, every area in exactly one group, and per
  area a cue, a one-line how, and one to four uses that each hand off to a
  route. Its areas section is generated; the rest is written by hand.

## Stubs

- A stub is what is left under a plugin's old name: a `plugin.json` with
  `"dependencies": ["agentcraft"]` and a description that says where it moved,
  a `README.md`, and a `CHANGELOG.md`. An update of the old plugin then brings
  `agentcraft` in. It ships no hook, agent, MCP server, or command.
- The only skills a stub may hold are the aliases in `ALIASES` in validate: an
  old address a copied file still prints. An alias is callable,
  `user-invocable: false`, at most 600 characters, and gives the new address.
- Nothing tells a reader to install a stub. `scripts/install.mjs` never
  installs one, and retires a copy an earlier install left under its name.

## Addresses

- An agent reaches a route as `/agentcraft:<area> <route>`, an agent as
  `agentcraft:<name>`, a tool of the plugin's mod as `mcp__agentcraft__<tool>`.
  Every address in a tracked file resolves to something the plugin ships; an
  old plugin's name, or a route named as a skill, fails with what to write.
- A changelog, a recording, and a template copy keep what they say. A test
  that needs an address nothing ships at builds it from its parts.
- A `${CLAUDE_PLUGIN_ROOT}` path in the plugin's markdown names a file in it.

## The session hooks

- One map, `hooks/hooks.json`: known events, and commands that are a guard,
  then `node "${CLAUDE_PLUGIN_ROOT}/<file>"` (`hookCommand()` in
  `scripts/lib.mjs`). One SessionStart command takes the guard that tells the
  person Node is missing; every other takes the quiet one. A SessionStart
  command has a `statusMessage`.
- The plugin speaks through two commands, and no area has a session hook of
  its own. `hooks/session-start.mjs` prints every area's critical lines, on
  SessionStart (`startup|resume|clear|compact`) and SubagentStart.
  `hooks/briefing.mjs` runs each area's migration, then its briefing, on
  SessionStart only.
- An area's lines are data, `skills/<area>/hooks/critical.json`: each has
  `text`, `for` (`main` or `all`), `mode` (`full`, `portable`, or `any`), and
  an optional `when` (a repo path that must exist). The area is in `AREAS` in
  `hooks/critical-context.mjs` and has a cap in `CRITICAL_CAPS` in validate:
  every request pays for them, so 7,500 characters across the areas and
  10,000 for either command's worst case. An agent type in `DENYLIST` gets
  none.
- The lines command also prints the route index in the main session: each
  area's routes by name, read from its `door.json` as the hook runs, and how
  a route is taken. At a 200k window the listing shows fourteen names and no
  route, so this is the only place a route's own name ("ship") is seen. It
  counts toward the 7,500.
- An area's briefing is `skills/<area>/hooks/briefing.mjs`, within its
  allowance in `BRIEFING_CHARS`. Its `migrate` changes a repo only through the
  `move` and `write` it is given, which refuse a path that exists.
- The mode decides who speaks. `full`: the repo has `.agents/manifest.json`,
  or the person answered `team`. `portable`: an area's marker is committed, or
  the person answered `on`. Otherwise nothing prints and the question is asked
  once per clone; the answer is `git config --local
  agentic-engineering.plugins`, and a committed marker outranks an `off`.
- A hook judges the work tree of the payload's `cwd`, falling back to
  `CLAUDE_PROJECT_DIR`: a worktree session's project dir is the main checkout.

## Versioning

- One version, in `plugins/agentcraft/.claude-plugin/plugin.json`. Bump it on
  every user-visible change (patch: fixes and wording; minor: a new route or
  behavior; major: a breaking change). No bump, and installed users never
  receive the change.
- One line at the top of `plugins/agentcraft/CHANGELOG.md`, newest first:
  validate fails a top entry that is not the `plugin.json` version.
- An area has no version: its `CHANGELOG.md` is its history as a plugin of its
  own and takes no new line. A stub's version moved once, when it became one.

## Adding or changing an area or a route

1. A route: write `skills/<area>/routes/<route>/ROUTE.md` and give it a cue in
   the area's `door.json`. An area: `skills/<area>/` with a `door.json` and a
   route, and a place in a group of `start-here.json`.
2. `npm run guide` writes each area's frontmatter and table, the entry skill's
   areas section, and `docs/plugins.md`. Validate fails a stale copy of any.
3. Pin the route in `scripts/test-hooks/unit/<area>-skills.test.mjs`, and a
   new area in `areas.test.mjs`.
4. Bump the version, add the changelog line, and sync the catalog entry and
   the root README if the pitch changed.

## Tests

- `npm test` is the unit lane; CI runs it on Linux, macOS and Windows, Node 22
  and 24. Every Node hook ships three cases in
  `scripts/test-hooks/cases/<owner>/`: a real payload, empty stdin, and
  malformed JSON.
- `npm run test:live` is the live lane: real sessions against
  `plugins/agentcraft`, read back from their transcripts. Opt-in, never in CI.
  Run it after changing a hook, a description, a cue, or anything else an
  agent sees, and record the new baseline in the same change.
- `scripts/test-hooks/README.md` has the case format and the baseline ratchet.

## Testing locally

- `node scripts/refresh.mjs` validates the tree, then installs `agentcraft`
  for your user; start a new session to load it.
  `node scripts/install.mjs --uninstall` takes it back off.

## Releases and tags

- `npm run validate && npm test` before every commit, then one tag form,
  `agentcraft/v<version>`, on the commit that bumps the version. CI fails a
  tag whose version is not the one in `plugin.json`, and a tag that names
  anything else. A stub is never tagged.
- Users get updates from `main` through `/plugin marketplace update`. Tags are
  for history and diffing, not distribution.

## Voice and quality bar

- READMEs, descriptions, and cues: concise, declarative, a little wit. State
  the problem, then the mechanism. No hype words.
- A description says when to reach for the thing, not only what it is.
