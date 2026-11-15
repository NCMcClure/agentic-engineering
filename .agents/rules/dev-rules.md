# agentic-engineering dev rules

The contract for maintaining this marketplace. Applies to humans and agents alike.
`scripts/validate.mjs` enforces the checkable rules; CI runs it on every push and PR.
When a rule changes, change the check in the same commit.

## Stack

- Node 22, stdlib only, `.mjs`. No dependencies in `package.json`, no lockfile,
  no build step. One runtime to install, one to test on three operating systems.
- Plugins run on Node: no Python, no shell scripts, and a hook module is a `.mjs`
  or `.js` file.
- A non-Node file that has to stay is listed by exact path in
  `NON_NODE_ALLOWLIST` in `scripts/validate.mjs`, with the reason beside it.
- Set `process.exitCode` and let Node unwind. Never call `process.exit()`: a
  hook's stdout is its whole contract, and an early exit can cut it short. An
  early exit can also crash: where `NODE_USE_SYSTEM_CA` is set, Node 24 reads the
  system's certificates on a thread at start-up, and an exit that lands before it
  has finished takes the process down with a segfault (one run in five on a busy
  Mac). The one-line commands a test hands to `node -e` are held to the same
  rule; validate fails a call in any Node file under `plugins/` or `scripts/`.

## Layout invariants

- Every in-tree plugin is a self-contained directory under `plugins/<name>/` with:
  - `.claude-plugin/plugin.json` (name, version, description, author)
  - `README.md` and `CHANGELOG.md`
  - `skills/<skill-name>/SKILL.md` (plus whatever else the plugin needs)
- One name everywhere: directory name == `plugin.json` `name` == marketplace entry `name`.
- Plugins never reference files outside their own directory: installs are cached
  copies, so `../` paths break. Use `${CLAUDE_PLUGIN_ROOT}` for intra-plugin paths.
- `${CLAUDE_PLUGIN_ROOT}` is ephemeral (replaced on update). Plugins that need
  persistent state (installed deps, caches) use `${CLAUDE_PLUGIN_DATA}`.
- Absolute machine paths never ship, in any tracked file.
- `SKILL.md` frontmatter carries only `name`, `description`,
  `disable-model-invocation`, `user-invocable`, and `argument-hint`. `name`
  matches the directory. A skill agents call and people do not type is
  `user-invocable: false`; hide one with `disable-model-invocation` only where
  nothing sends an agent to it, because the host refuses that call.
- Hooks register known events, their commands point at files inside the plugin,
  and a hooks module listed under `modules` is a `.mjs` or `.js` file inside it.
- A Node hook's command is a guard, then `node "${CLAUDE_PLUGIN_ROOT}/<file>"`:
  `hookCommand()` in `scripts/lib.mjs` writes it. A machine without Node on PATH
  hears so once, at session start, instead of failing on every event. SessionStart
  takes the guard that tells the person and a `statusMessage`; every other event
  takes the quiet one.
- A hook judges the work tree of the payload's `cwd`, falling back to
  `CLAUDE_PROJECT_DIR`: a worktree session's project dir is the main checkout.
- Plugin dirs carry no `.claude-plugin/marketplace.json` of their own. The only
  catalog is the root one.
- No `.DS_Store`, `node_modules/`, build artifacts, or caches in the tree. LF
  line endings everywhere.

## One plugin of areas

The plugins are becoming areas of one plugin, `agentcraft`. Until the cutover the
gate takes both shapes: a plugin with its own skills, held to everything above,
and an area of `agentcraft`, held to what follows. None of it finds anything to
judge in a tree with no area and no stub.

- An area is a skill directory that holds `routes/`:
  `plugins/agentcraft/skills/<area>/`. Its data is `door.json` beside its
  `SKILL.md`: `lead` (one sentence, one line), `default` (one of its routes), and
  `routes` in table order, each with a `cue` of 1 to 60 characters and
  `"starts": "person"` where only a person starts it. `npm run guide` writes the
  area's frontmatter and its `## Route` block, through the end marker; the text on
  either side is the author's. An area carries `user-invocable: false` and stays
  callable by a model. Its description is capped at 1,536 characters, its body at
  8,000.
- A route is a document, `routes/<route>/ROUTE.md`, which no host lists. Its
  frontmatter carries only `name` (the directory's), `description`, and
  `argument-hint`. It is read by path, so it never writes
  `${CLAUDE_PLUGIN_ROOT}`: it names a directory from its own file ("`W` below is
  `../..` from the directory this file is in") and writes each path under it,
  quoted in a command and in a code span of its own in prose. No `SKILL.md` sits
  below an area, and a plugin that holds areas lists areas and `start-here`, and
  nothing else.
- A stub is what stays under a plugin's old name once it has moved in: its
  manifest, with `"dependencies": ["agentcraft"]` and a description that names
  `agentcraft`, a `README.md`, a `CHANGELOG.md`, and whatever `ALIASES` and
  `STUB_EXTRAS` in `scripts/validate.mjs` list for it. An alias answers an address
  a copied file still prints: callable, `user-invocable: false`, 600 characters at
  most, and it gives the route's new address. No install line names a stub.
- A route's address is its area, then the route as the first argument:
  `/agentcraft:<area> <route>`. Once the tree holds an area, every address in a
  tracked file resolves to a skill, an agent, or an MCP server its plugin ships,
  and the word after an area is one of its routes. A route named as a skill and
  an area named as a plugin each fail with what to write. A `CHANGELOG.md`, a
  recording, and a template copy keep what they say.
- An agent and an MCP server are named by the plugin that ships them, and so is
  a mod's tool prefix: a `DENYLIST` entry and `mcp__<plugin>__<tool>` follow a
  plugin that moves.
- `node scripts/door-plugin.mjs <plugin> --write` moves one plugin in, and
  `scripts/door-plugin.checklist.md` lists what a hand finishes after it. Both
  are deleted with the cutover.

## Shared files

- What several areas use sits once, in `plugins/agentcraft/lib/`: `provider.mjs`
  (GitHub and GitLab through `gh` and `glab`), `shell-words.mjs` (the command
  lexer the guards read a Bash call with), and `verify-hubs.mjs` (the check that
  every `AGENTS.md` hub names its children). An area imports the file by its
  relative path: one plugin, so nothing is copied and nothing is synced.
- Every file in `lib/` has a suite of the same name in
  `scripts/test-hooks/unit/`. Validate fails one without, and fails a
  `scripts/shared/` or `scripts/plugins/` folder that comes back.
- A file a route copies into a user's repo cannot reach back into the plugin, so
  it stays a copy: it is listed in `HASH_PAIRS` in `scripts/lib.mjs`, and validate
  holds it hash-equal to the one in `lib/`. Today that is spec-init's
  `assets/provider.mjs`.
- A change to a shared file changes every area that imports it: run each one's
  suites.

## Critical lines

The lines the plugin keeps in an agent's context for a whole session, delivered
at session start, after a compaction or `/clear`, and in subagents.

- The plugin speaks once. One helper, `plugins/agentcraft/hooks/critical-context.mjs`,
  and two commands built on it. `hooks/session-start.mjs` runs on SessionStart
  (`startup|resume|clear|compact`) and SubagentStart: the shared line once, then
  each area's lines under the area's name, then the once-per-clone question.
  `hooks/briefing.mjs` runs on SessionStart only, for the main session: each
  area's migration, then each area's briefing. They are two commands because a
  host shows the model only a preview of a hook's output past 10,000 characters.
- An area's lines are data, in `skills/<area>/hooks/critical.json`: `area` and
  `lines`. A line has `text`, `for` (`main` or `all`), `mode` (`full`,
  `portable`, or `any`), and an optional `when` (a repo path, or a list of them,
  one of which must exist). Every area is always present, so no line waits on
  another plugin: there is no `chains` block and no `partner`. A line names a
  route by its address, `/agentcraft:<area> <route>`.
- An area's briefing is `skills/<area>/hooks/briefing.mjs`, exporting `briefing`
  and, where its layout in a repo has changed, `migrate`. An area has no session
  hook of its own and no copy of the helper.
- Every request pays for the lines, so they are capped: per area by
  `CRITICAL_CAPS` in `scripts/validate.mjs`, and 7,500 characters across all of
  them. `AREAS` in the helper names exactly the areas with a cap, in the order
  their blocks print. Each command's worst case stays under 10,000: the lines
  plus the question, and for the briefing the sum of `BRIEFING_CHARS`,
  `MIGRATION_CHARS` and `CATALOG_CHARS` in the helper, which the command cuts
  each part to.
- The mode decides who speaks. `full`: the repo has `.agents/manifest.json`, or
  the person answered `team`. `portable`: an area's own marker is committed, or
  the person answered `on`. Otherwise nothing prints but the question, asked
  once per clone, with the team conventions always among its answers. The answer
  lives in `git config --local agentic-engineering.plugins`; a committed marker
  outranks a personal `off`.
- A denied agent type (the helper's `DENYLIST`) gets nothing, and an entry that
  names one of the plugin's agents names one it ships. A subagent never gets a
  briefing, only the lines marked `all`.
- When an area's layout in a repo changes, its `briefing.mjs` exports `migrate`.
  The briefing command runs it first, in the main session only, whatever the
  repo's mode, and it changes the repo only through the `move` and `write` it is
  given: both refuse a path that exists, so it never overwrites and a second run
  changes nothing. It recognises the old layout by a file only the plugin wrote,
  writes the opt-in that keeps behavior the same, and finishes inside three
  seconds. The helper reports what moved to the model and the person.
- A host runs the two commands side by side, so the lines may be read before the
  repo is moved. A marker of the old layout stays in the helper's `OLD_MANIFESTS`
  or `OLD_MARKERS`, and in the `when` of a line that waits on it, for as long as
  a repo may still carry it.
- Validate fails a second copy of the helper, an area's own `session-start.mjs`,
  a `chains` block, a line with `partner`, a briefing with no allowance, and a
  hook map that runs the lines other than once per event or the briefing other
  than once on SessionStart.

## Versioning: the one rule that matters

- `version` lives ONLY in each plugin's `plugin.json`. Marketplace entries never
  carry `version`: when both are set, plugin.json wins *silently* and the stale
  entry masks releases. Validate fails the tree if an entry has one.
- Bump `plugin.json` on every user-visible change (patch: fixes/wording; minor:
  new skills or behavior; major: breaking workflow changes). No bump = installed
  users never receive the change.
- Add a one-line entry to the top of the plugin's `CHANGELOG.md`, newest first.
  It lives inside the plugin so the history ships with the installed copy.
  Validate fails a missing file, a top entry that is not the `plugin.json`
  version, and a README that still carries a `## Changelog` section.

## The plugin guide

- `docs/plugins.md` lists every plugin, its version and its skills. It is
  generated (`npm run guide`) from the catalog, each `plugin.json`, and each
  skill's frontmatter, and never edited by hand. Validate fails a stale copy, so
  regenerate it in the same change as a version bump, a new skill, or a reworded
  description.

## The entry skill

- `plugins/agentcraft/skills/start-here/` is the one skill a person types. Its
  flow is written by hand; its `## The areas` section is generated by the same
  `npm run guide`, and is the last thing in the file.
- The person's side is `start-here.json` beside it: `groups` (the questions a
  person is asked, one to four, each two to four options with "Learn more"
  counted on the last, a `title` and a `header` of at most 12 characters) and
  `areas`, one per plugin: a `cue` of at most 60 characters, a one-line `how`,
  and one to four `uses`, each a `want` and a `to` that is one of the plugin's
  skills. A use carries `"starts": "person"` exactly when only a person can
  start that skill.
- Validate fails a stale section, a plugin no group asks about, an entry no
  group names, a use that names no skill, and an entry skill hidden from the
  model or kept out of the slash menu.

## Tests

- `npm test` is the unit lane: every hook, spawned through the command its
  `hooks.json` registers. CI runs it on Linux, macOS and Windows, Node 22 and 24.
- Every Node hook ships three cases in `scripts/test-hooks/cases/<plugin>/`: a
  real payload, empty stdin, and malformed JSON. The lane fails a hook without them.
- Every file in `scripts/shared/` has a suite of the same name in
  `scripts/test-hooks/unit/`.
- `npm run test:live` is the live lane: real sessions, read back from their
  transcripts, for what each plugin put in context and whether a prompt still
  reaches its skill. Opt-in, it spends model quota, never in CI. Run it after
  changing a hook, a skill description, or anything else that alters what an
  agent sees, and record the new baseline in the same change.
- A change to how skills are laid out lands only if reach is no worse. The lane
  refuses to record a baseline over a prompt that stopped reaching its skill.
- `scripts/test-hooks/README.md` has the case format and the baseline ratchet.

## Adding a plugin

1. Create `plugins/<name>/` with the layout above.
2. Write `plugin.json`: name, `"version": "0.1.0"`, description, author
   `{"name": "Nicholas McClure", "email": "contact@protospatial.com"}`.
3. Add a marketplace entry: `name`, `source: "./plugins/<name>"`, one-sentence
   `description`, `category`. No version.
4. Add a 2–4 sentence section for it in the root README, a line in
   `plugins/AGENTS.md`, and its entry and group in `start-here.json`.
5. `npm run validate && npm test`, test locally (below), then commit and tag.

## Updating a plugin

1. Change files inside `plugins/<name>/` only.
2. Bump `plugin.json` version; add the `CHANGELOG.md` line.
3. If the one-sentence pitch changed, sync the marketplace entry description and
   the root README section.
4. `npm run validate && npm test`, the live lane if agent-visible context
   changed, a local install test, then commit and tag.

## External-source plugins

- A plugin may live in its own repo and appear here as a catalog entry with an
  object source (`{"source": "github", "repo": ..., "ref": ...}`). Never vendor
  its files. Releases happen in that repo; this repo changes only when the entry
  itself changes. There are currently none; the entry's repo must be public (a
  private repo makes the entry uninstallable for anyone without access).

## Testing locally before pushing

- `node scripts/refresh.mjs` validates the tree, then installs this checkout's
  plugins for your user. Start a new session to load them.
  `node scripts/install.mjs --uninstall` takes them back off.
- Or by hand: `/plugin marketplace add <path to this checkout>`,
  `/plugin install <name>@agentic-engineering`, exercise a skill, then
  `/plugin uninstall` and `/plugin marketplace remove agentic-engineering`.
- `claude plugin validate plugins/<name>` for manifest/frontmatter checks.

## Releases and tags

- Tag per plugin: `<plugin>/v<version>` (e.g. `but-first-planning/v2.5.1`) on the
  commit that bumps that plugin's version. CI fails a tag whose version is not
  the one in `plugin.json`. No repo-wide versions.
- Users get updates from `main` via `/plugin marketplace update`; tags are for
  history and diffing, not distribution.

## Voice and quality bar

- READMEs and skill descriptions: concise, declarative, a little wit. State the
  problem, then the mechanism. No hype words.
- Skill `description` frontmatter must say *when to trigger*, not just what it is.
- Every plugin README answers, in order: what problem, how it works, how to
  install, what the skills are.
