# Team workflow conventions

Working agreements for this repo. These distill the "Team workflow rules" in
`CLAUDE.md` into a per-change checklist. The `.githooks/` pre-commit hook, the
agentic-teamwork Claude Code hooks, and the {{CI_NAME}} workflow enforce most
of this; the notes below are the intent behind them, plus the things
automation can't check for you.

## Start from an up-to-date base

Branching off a stale `{{BASE_BRANCH}}` is a classic trap: a branch cut before
shared changes (test suites, interfaces, seams) landed never gains them, so
its "tests pass" gate passes vacuously and its diff conflicts at merge time.
Avoid it:

- Before branching: `git switch {{BASE_BRANCH}} && git pull`.
- Then: `git switch -c <prefix><topic>` (prefixes: {{BRANCH_PREFIXES}}).
- While the branch is open and `{{BASE_BRANCH}}` moves:
  `git fetch origin && git merge origin/{{BASE_BRANCH}}` (or rebase your own
  un-pushed work). Don't let a branch drift for days.
- The session-start hook warns when the current branch is behind
  `origin/{{BASE_BRANCH}}`; treat that warning as "sync now," not "later."

## Never commit or push to `{{BASE_BRANCH}}`

`{{BASE_BRANCH}}` moves only through reviewed {{PR_NOUN}}s with green CI.
Branch, push the branch, `{{PR_CREATE_CMD}}`. Never force-push; never
`--no-verify`. These are hook-blocked; the only escape hatch is a maintainer
adding `{{ESCAPE_VAR}}=1` to the command (auditable in the transcript).

## Ship tests with the logic

`{{TEST_COMMAND}}` must pass before every commit (hook-enforced) **and**
{{CI_NAME}} re-runs it on every {{PR_NOUN}} in a clean checkout — so a branch
that is missing the test suite can't hide behind a vacuous local pass.

New or changed pure logic ships with a test. Prefer testable seams over
hardcoded environment: functions take an injectable path, URL, clock, or
client so tests run against a temp dir or a fake. A hardcoded global is both
a latent bug and untestable — derive from inputs.

## Secrets never enter the repo

Credentials live in a secret manager or an untracked env file — never in
tracked files, committed config, or command lines. Commits are scanned and
blocked on likely credentials (the scan reports file:line, never the token).

## Formatting

Run the repo's configured lint/format command on files you touch; commits
should be lint-clean (edits get a non-blocking lint warning from the hooks).

## Coupled files change together

Some files move as a set (see `coupledFiles` in `.claude/teamwork.json`).
The edit hook reminds you when you touch one; update the whole group together
and verify before committing.

## Verify order (cheapest first)

lint → build → `{{TEST_COMMAND}}` → run the thing. Spend the cheap
verification first; never skip straight to "it probably works."
