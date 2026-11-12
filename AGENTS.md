# agentic-engineering: a Claude Code plugin marketplace

Eleven plugins, each a fix for a problem that keeps turning up when engineering
with agents. Nothing here runs in production; it runs in the agents, so a
mistake ships to every session that has the plugin installed.

Read the rules below before editing anything under `plugins/` or the catalog.
They are the maintenance contract, and they name what `scripts/validate.mjs`
enforces.

@.agents/rules/dev-rules.md

## Layout

- `.agents/rules/` - this repo's own rules. `dev-rules.md` is the contract
  imported above.
- `.claude-plugin/marketplace.json` - the catalog. One entry per plugin, never a
  `version` key.
- `plugins/` - the shipped plugins, one self-contained directory each. Its
  `AGENTS.md` says what each one is for. Descend to change what an agent does.
- `scripts/` - repo tooling, never shipped: `validate.mjs` (the structural
  gate), `plugins/<name>.json` (per-plugin gate data: the `legacy` flag, the
  `shared` copies, the `critical` cap), `install.mjs` and `refresh.mjs` (the
  local dev loop), `lib.mjs`, and `test-hooks/` (the unit and live lanes; its
  README has the detail).
- `scripts/shared/` - the files several plugins ship unchanged, each edited
  here and nowhere else. `scripts/sync-shared.mjs --write` rewrites the copies.
- `.github/workflows/validate.yml` - CI: the gate, the unit lane on three
  operating systems, and the tag check.
- `package.json` - the npm script names. No dependencies, ever.
- `README.md` - for a person: what this is, how to install, a section per plugin.
- `CONTRIBUTING.md` - what to run before a commit, the dev loop, releasing.
- `AGENTS.md` / `CLAUDE.md` - this hub and its tracked link.

## Before every commit

```bash
npm run validate   # the structural gate CI runs
npm test           # the unit lane CI runs
```

Run `npm run test:live` too when a change alters what an agent sees: a hook, a
skill description, a rule a hook injects.
