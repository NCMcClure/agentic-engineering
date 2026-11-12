# {{PROJECT}}

{{DESCRIPTION}}

This repo follows its team's conventions, version {{STANDARD_VERSION}}. `.agents/manifest.json` is the marker: the agentic-teamwork plugin reads it at every session start and brings the working rules with it (branch first, tests with the logic, no secrets, how a change lands), so this file carries no copy of them.

## Project rules

This repo's own durable rules go in `.agents/rules/`, one file per rule, each with an `@.agents/rules/<file>.md` import line in this section so that loading this file loads them. Keep them short: they cost context in every session.

## Layout

- `.agents/` - `manifest.json` (the marker: the project, its default branch, the four lane commands, and the hash of every file the scaffold wrote), `scripts/` (`verify-standard.mjs`, the check CI runs; `lane.mjs`, which runs a test lane by name; `plugin-check.mjs`, which offers the plugin to a teammate who does not have it), and `rules/` for this repo's own rules.
- `.claude/settings.json` - the shared permission rules: a force push and `--no-verify` are denied for every agent that opens this repo.
- `.githooks/` - the pre-commit hook for commits made outside an agent. Each clone turns it on once: `git config core.hooksPath .githooks`.
{{LAYOUT}}
- `README.md` - for a person: what this is, how to install it, how to use it.
- `CONTRIBUTING.md` - how this repo is built, tested, and merged.
- `AGENTS.md` / `CLAUDE.md` - this hub and its link.

## Commands

```bash
node .agents/scripts/verify-standard.mjs   # the conventions check CI runs
node .agents/scripts/lane.mjs unit         # the unit lane: {{UNIT_CMD}}
node .agents/scripts/lane.mjs --list       # all four lanes and their commands
```
