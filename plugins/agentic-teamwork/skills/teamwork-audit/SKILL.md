---
name: teamwork-audit
description: Check the health of agentic-teamwork enforcement in this repository — hooksPath set, pre-commit mirror present and current, teamwork.json valid and matching reality, permissions deny-list present, CI file present and aligned with the configured test command. Use when enforcement seems broken, after plugin updates, or when asked to audit or verify the teamwork setup.
---

# teamwork-audit

Audit the four enforcement layers and report a PASS/WARN/FAIL table. Read
`skills/teamwork-init/reference.md` (next to this skill) for the config
schema. Offer to fix everything that isn't PASS.

## Checks (run all, report all)

1. **Config present** — `.claude/teamwork.json` exists at the repo root.
   FAIL → "not initialized; run /teamwork-init" and stop.
2. **Config valid** — `jq . .claude/teamwork.json` parses; keys match the
   schema in reference.md; `provider` is explicit (`auto` = WARN); patterns
   are valid EREs (test each with `grep -E` against an empty string).
3. **jq installed** — `command -v jq`. FAIL: agent hooks fail open and the
   pre-commit fails closed without it.
4. **hooksPath** — `git config core.hooksPath` = `.githooks`. WARN if unset
   (terminal commits are unguarded in this clone; each clone sets it once).
5. **Mirror present** — `.githooks/pre-commit` (executable) and
   `.githooks/lib-guard.sh` exist.
6. **Mirror current** — compare `TW_LIB_VERSION` in `.githooks/lib-guard.sh`
   against `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib.sh`; also diff the file
   contents (a hash/`cmp -s` is enough). Drift → WARN, offer to re-copy the
   plugin lib over the mirror.
7. **Test gate sane** — run the configured `test.command` (or `build.command`
   fallback) once in its dir; it should exit 0 or 1 in a reasonable time, not
   "command not found". Both null → WARN (the gate is vacuous).
8. **Remote/base real** — the configured `remote` exists
   (`git remote get-url`) and `remote/baseBranch` resolves
   (`git rev-parse --verify`).
9. **Deny-list present** — `.claude/settings.json` contains the five
   force-push/no-verify deny entries and the hooksPath ask entry from
   `${CLAUDE_PLUGIN_ROOT}/templates/settings.merge.json`.
10. **CI aligned** — the provider's CI file exists
    (`.github/workflows/ci.yml` or `.gitlab-ci.yml`) and contains the
    configured test command. Missing or mismatched → WARN (CI is the only
    server-side layer; without it, local bypasses are final).

## Report

One table: `| # | Check | Status | Detail |` with PASS / WARN / FAIL, then a
short "Fixes" section listing the concrete commands or edits for each
non-PASS row, and offer to apply them.
