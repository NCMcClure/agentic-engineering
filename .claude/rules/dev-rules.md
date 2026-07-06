# agentic-engineering dev rules

The contract for maintaining this marketplace. Applies to humans and agents alike.
`scripts/validate.sh` enforces the checkable rules; CI runs it on every push.

## Layout invariants

- Every in-tree plugin is a self-contained directory under `plugins/<name>/` with:
  - `.claude-plugin/plugin.json` (name, version, description, author)
  - `README.md`
  - `skills/<skill-name>/SKILL.md` (plus whatever else the plugin needs)
- One name everywhere: directory name == `plugin.json` `name` == marketplace entry `name`.
- Plugins never reference files outside their own directory — installs are cached
  copies, so `../` paths break. Use `${CLAUDE_PLUGIN_ROOT}` for intra-plugin paths.
  Absolute machine paths never ship.
- `${CLAUDE_PLUGIN_ROOT}` is ephemeral (replaced on update) — plugins that need
  persistent state (installed deps, caches) use `${CLAUDE_PLUGIN_DATA}`.
- Plugin dirs carry no `.claude-plugin/marketplace.json` of their own — the only
  catalog is the root one.
- No `.DS_Store`, `node_modules/`, build artifacts, or caches in the tree.

## Versioning — the one rule that matters

- `version` lives ONLY in each plugin's `plugin.json`. Marketplace entries never
  carry `version` — when both are set, plugin.json wins *silently* and the stale
  entry masks releases. validate.sh fails the tree if an entry has one.
- Bump `plugin.json` on every user-visible change (patch: fixes/wording; minor:
  new skills or behavior; major: breaking workflow changes). No bump = installed
  users never receive the change.
- Add a one-line entry to the plugin README's `## Changelog` (newest first).

## Adding a plugin

1. Create `plugins/<name>/` with the layout above.
2. Write `plugin.json`: name, `"version": "0.1.0"`, description, author
   `{"name": "Nicholas McClure", "email": "contact@protospatial.com"}`.
3. Add a marketplace entry: `name`, `source: "./plugins/<name>"`, one-sentence
   `description`, `category`. No version.
4. Add a 2–4 sentence section for it in the root README.
5. `bash scripts/validate.sh`, test locally (below), then commit and tag.

## Updating a plugin

1. Change files inside `plugins/<name>/` only.
2. Bump `plugin.json` version; add the changelog line.
3. If the one-sentence pitch changed, sync the marketplace entry description and
   the root README section.
4. validate.sh + local install test, then commit and tag.

## External-source plugins

- A plugin may live in its own repo and appear here as a catalog entry with an
  object source (`{"source": "github", "repo": ..., "ref": ...}`) — never vendor
  its files. Releases happen in that repo; this repo changes only when the entry
  itself changes. There are currently none; the entry's repo must be public (a
  private repo makes the entry uninstallable for anyone without access).

## Testing locally before pushing

- `/plugin marketplace add /fast/projects/agentic-engineering` (local paths work),
  `/plugin install <name>@agentic-engineering`, exercise a skill.
- `claude plugin validate plugins/<name>` for manifest/frontmatter checks.
- Clean up: `/plugin uninstall`, `/plugin marketplace remove agentic-engineering`.

## Releases and tags

- Tag per plugin: `<plugin>/v<version>` (e.g. `but-first-planning/v2.5.1`) on the
  commit that bumps that plugin's version. No repo-wide versions.
- Users get updates from `main` via `/plugin marketplace update`; tags are for
  history and diffing, not distribution.

## Voice and quality bar

- READMEs and skill descriptions: concise, declarative, a little wit — state the
  problem, then the mechanism. No hype words.
- Skill `description` frontmatter must say *when to trigger*, not just what it is.
- Every plugin README answers, in order: what problem, how it works, how to
  install, what the skills are.
