# Contributing to {{PROJECT}}

## How this repo is set up

It follows its team's conventions, version {{STANDARD_VERSION}}. `AGENTS.md` is the map; start there. `.agents/manifest.json` records the default branch, the test lanes, and which files the scaffold wrote, and `.agents/scripts/` holds the checks the repo runs on itself.

Working with Claude Code, install the agentic-teamwork plugin: it enforces the rules below as you go, and the repo offers it at session start if you do not have it. Working in a terminal, turn the pre-commit hook on once per clone:

```bash
git config core.hooksPath .githooks
```

## Tests

`{{UNIT_CMD}}` runs the unit lane. All four lanes (unit, integration, e2e, live) are `lanes` in `.agents/manifest.json`:

```bash
node .agents/scripts/lane.mjs --list   # the lanes and their commands
node .agents/scripts/lane.mjs unit     # run one by name
```

New or changed logic ships with a test that fails without it.

## The check

```bash
node .agents/scripts/verify-standard.mjs   # the marker, the hub and its link, the ignore block, the CI gate
```

CI runs it, and the unit lane, on every {{CHANGE_NOUN}}.

## Changes

`{{DEFAULT_BRANCH}}` moves only through a reviewed {{CHANGE_NOUN}} with green CI. Branch as `<type>/<topic>`, push the branch, open the {{CHANGE_NOUN}}. Never force push, never `--no-verify`, and never commit a secret: credentials live in a secret manager or an untracked `.env`.
