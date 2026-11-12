# agentic-engineering dev rules

The contract for maintaining this marketplace. Applies to humans and agents alike.
`scripts/validate.mjs` enforces the checkable rules; CI runs it on every push and PR.
When a rule changes, change the check in the same commit.

## Stack

- Node 22, stdlib only, `.mjs`. No dependencies in `package.json`, no lockfile,
  no build step. One runtime to install, one to test on three operating systems.
- Plugins run on Node. A plugin that still ships Python or shell carries
  `"legacy": true` in `scripts/plugins/<name>.json`. The flag waives the three
  Node-only rules (non-Node files, extra `SKILL.md` frontmatter keys, hook modules
  that are not `.mjs`/`.js`) and nothing else. Validate fails a flag the plugin no
  longer needs, so flags only come off. A new plugin never gets one.
- A non-Node file that has to stay is listed by exact path in
  `NON_NODE_ALLOWLIST` in `scripts/validate.mjs`, with the reason beside it.
- Set `process.exitCode` and let Node unwind. Never call `process.exit()` after
  writing to stdout: a hook's stdout is its whole contract, and an early exit
  can cut it short.

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
  `disable-model-invocation`, and `argument-hint`. `name` matches the directory.
- Hooks register known events, their commands point at files inside the plugin,
  and a hooks module listed under `modules` is a `.mjs` or `.js` file inside it.
- A hook judges the work tree of the payload's `cwd`, falling back to
  `CLAUDE_PROJECT_DIR`: a worktree session's project dir is the main checkout.
- Plugin dirs carry no `.claude-plugin/marketplace.json` of their own. The only
  catalog is the root one.
- No `.DS_Store`, `node_modules/`, build artifacts, or caches in the tree. LF
  line endings everywhere.

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

## Tests

- `npm test` is the unit lane: every hook, spawned through the command its
  `hooks.json` registers. CI runs it on Linux, macOS and Windows, Node 22 and 24.
- Every Node hook ships three cases in `scripts/test-hooks/cases/<plugin>/`: a
  real payload, empty stdin, and malformed JSON. The lane fails a hook without them.
- `npm run test:live` is the live lane: real sessions, read back from their
  transcripts. Opt-in, a few cents a run, never in CI. Run it after changing a
  hook, a skill description, or anything else that alters what an agent sees, and
  record the new baseline in the same change.
- `scripts/test-hooks/README.md` has the case format and the baseline ratchet.

## Adding a plugin

1. Create `plugins/<name>/` with the layout above.
2. Write `plugin.json`: name, `"version": "0.1.0"`, description, author
   `{"name": "Nicholas McClure", "email": "contact@protospatial.com"}`.
3. Add a marketplace entry: `name`, `source: "./plugins/<name>"`, one-sentence
   `description`, `category`. No version.
4. Add a 2–4 sentence section for it in the root README and a line in
   `plugins/AGENTS.md`.
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
