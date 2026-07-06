## Team workflow rules

Enforced by agentic-teamwork hooks (Claude Code sessions) and `.githooks/pre-commit` (terminal); the bullets are the intent behind them.

- **Never commit on {{PROTECTED_BRANCHES}}.** Branch first ({{BRANCH_PREFIXES}}), push the branch, open a {{PR_NOUN}} with `{{PR_CREATE_CMD}}`. Never force-push; never `--no-verify`.
- **`{{TEST_COMMAND}}` must pass before every commit** (hook-enforced; re-run by {{CI_NAME}} on every {{PR_NOUN}}).
- **Secrets never enter the repo** — commits are scanned and blocked on likely credentials.
- Escape hatch for maintainers only: `{{ESCAPE_VAR}}=1` in the command (auditable). Humans committing outside Claude Code: run `git config core.hooksPath .githooks` once per clone.
- Full checklist: `.claude/rules/team-workflow.md`.
