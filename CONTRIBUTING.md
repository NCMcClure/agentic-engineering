# Contributing to agentic-engineering

Read `AGENTS.md` for the map and `.agents/rules/dev-rules.md` for the
maintenance contract: the stack, the layout invariants, versioning, and what
`scripts/validate.mjs` enforces. You need Node 22 and git, nothing else.

Before every commit:

```bash
npm run validate
npm test
```

CI runs both on every push and pull request: the gate once, the tests on Linux,
macOS and Windows under Node 22 and 24.

## The dev loop

Everything that ships is in `plugins/agentic-engineering/`. Edit it in this checkout,
then:

```bash
node scripts/refresh.mjs             # validate, then install agentic-engineering for your user
node scripts/install.mjs --dry-run   # print every write, touch nothing
```

`refresh.mjs` installs nothing on a red gate. Claude Code loads plugins at
session start, so start a new session to see the change.

The installer copies `agentic-engineering`, the one plugin. If an earlier run left one
of the old plugins installed under the name an area had as a plugin of its
own, the installer retires that copy first (its cache folder, its install
record, its enable flag), so no hook runs twice. It leaves the old plugin's
data folder where it is. `--plugins <name>` still takes a list, and an old
name there is refused with where it moved.

If you already installed this marketplace from GitHub, the installer stops and
says so: Claude Code allows one source per marketplace name. `--force` repoints
the name at your checkout and parks the old entry; `--uninstall` puts it back.

```bash
node scripts/install.mjs --uninstall
```

## What is generated

Three things are written from the tree and never by hand:

- `docs/plugins.md`, the guide.
- Each area's `SKILL.md` frontmatter and `## Route` table, from the
  `door.json` beside it and each route's own frontmatter.
- The areas section of the entry skill, from `start-here.json`.

After a version bump, a new or renamed route, or a reworded description or cue:

```bash
npm run guide
```

The gate fails a stale copy of any of them.

## One copy of a shared file

What several areas use lives once, in `plugins/agentic-engineering/lib/`, and each area
imports it from there. There is nothing to sync.

One file is still held as a copy, because a user's repo gets it:
`skills/planning/routes/spec-init/assets/provider.mjs` has to equal
`lib/provider.mjs`. Edit the one in `lib/`, copy it over, and the gate fails a
copy that has drifted.

## When a change alters what an agent sees

A hook, an area's description, a route's cue, a rule a hook injects: run the
live lane. It starts real sessions against this checkout's plugin and reports
what reached the model, and whether a plainly worded prompt still ends in the
right area and route. It spends model quota and never runs in CI.

```bash
npm run test:live
npm run test:live -- --write-baseline          # record the new numbers in the same change
npm run test:live -- --write-baseline=skills   # record only what each prompt reached
```

`scripts/test-hooks/README.md` covers both lanes.

## Releasing

There is one version, in `plugins/agentic-engineering/.claude-plugin/plugin.json`, and
`plugins/agentic-engineering/CHANGELOG.md` has it as its top entry. An area has no
version and no changelog of its own: `history/<old-name>.md` beside it holds
the changelog of each plugin it was made from, and takes no new line.

A change is released the moment it reaches `main` with a version bump:
`/plugin marketplace update` picks it up. Tags are the history, and there is
one form, on the commit that carries the version:

```bash
git tag agentic-engineering/v1.0.1 main
git push origin agentic-engineering/v1.0.1
```

CI checks the tag against that `plugin.json` and fails on a mismatch, and on a
tag that names anything but `agentic-engineering`.
