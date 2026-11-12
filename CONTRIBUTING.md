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

Edit a plugin in this checkout, then:

```bash
node scripts/refresh.mjs                               # validate, then install every plugin for your user
node scripts/refresh.mjs -- --plugins agentic-teamwork # or just one
node scripts/install.mjs --dry-run                     # print every write, touch nothing
```

`refresh.mjs` installs nothing on a red gate. Claude Code loads plugins at
session start, so start a new session to see the change.

If you already installed this marketplace from GitHub, the installer stops and
says so: Claude Code allows one source per marketplace name. `--force` repoints
the name at your checkout and parks the old entry; `--uninstall` puts it back.

```bash
node scripts/install.mjs --uninstall
```

## When a change alters what an agent sees

A hook, a skill description, a rule a hook injects: run the live lane. It
starts real sessions against this checkout's plugins and reports, per plugin,
what reached the model. It costs a few cents and never runs in CI.

```bash
npm run test:live
npm run test:live -- --write-baseline   # record the new numbers in the same change
```

`scripts/test-hooks/README.md` covers both lanes.

## Releasing

A change is released the moment it reaches `main` with a version bump:
`/plugin marketplace update` picks it up. Tags are the history. Cut one per
plugin, on the commit that carries that plugin's version:

```bash
git tag agent-works/v0.3.0 main
git push origin agent-works/v0.3.0
```

CI checks the tag against `plugins/<plugin>/.claude-plugin/plugin.json` and
fails on a mismatch.
