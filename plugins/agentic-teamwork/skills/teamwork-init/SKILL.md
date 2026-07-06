---
name: teamwork-init
description: Set up agentic-teamwork enforcement in the current repository — detect the git provider (GitHub or GitLab) and test/lint commands, write .claude/teamwork.json, install the .githooks pre-commit mirror, add the permissions deny-list to .claude/settings.json, add the team-workflow rules file, update CLAUDE.md, and generate CI. Use when the user asks to initialize, install, or configure teamwork enforcement, version-control guardrails, or branch protection for this repo.
disable-model-invocation: true
argument-hint: "[--provider github|gitlab]"
---

# teamwork-init

Set up agentic-teamwork enforcement in the current repository. Work through
the steps in order. Templates live in `${CLAUDE_PLUGIN_ROOT}/templates/`; the
shared library is `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib.sh`. The full
config schema (every key, type, default, and what it drives) is in
[reference.md](reference.md) — read it before the interview.

## 1. Preflight

- `git rev-parse --show-toplevel` — if this is not a git repo, stop and say so.
- If `.claude/teamwork.json` already exists, offer **update mode**: re-run the
  interview with current values as defaults and only rewrite what changed.
  Never silently clobber an existing config.
- `command -v jq` — if missing, warn that the hooks fail open and the terminal
  pre-commit fails closed until jq is installed; offer to continue anyway.

## 2. Detect

Detect, don't guess — every detection is confirmed in step 3.

- **Provider**: `$ARGUMENTS` may carry `--provider github|gitlab`; otherwise
  from `git remote get-url origin` (host contains `github` → github,
  `gitlab` → gitlab). Unknown host → ask. Always write the explicit value,
  never `"auto"`.
- **Base branch**: `git symbolic-ref refs/remotes/origin/HEAD` (fallback: does
  `main` or `master` exist on the remote?).
- **Test / build / lint commands**: look at the manifests that exist —
  `package.json` scripts (`test`, `lint`, `build`), `pyproject.toml`
  (pytest/ruff), `Cargo.toml` (`cargo test`), `go.mod` (`go test ./...`),
  `Package.swift` (`swift test`), `Makefile` targets. Also derive
  `test.sourcePatterns` / `test.testPatterns` EREs from the actual layout
  (e.g. `^src/.*\.(ts|tsx)$`, `^(test|tests)/`).

## 3. Interview (AskUserQuestion)

Confirm or adjust, one topic per question, detections pre-filled as defaults:

1. Provider + base branch.
2. Protected branches (default: base branch + `master` if it exists).
3. Branch prefixes (default `feature/`, `fix/`, `chore/`).
4. Test command, dir, and timeout; build command if tests don't exist yet.
5. Lint command (with `{file}` placeholder) and file patterns, or none.
6. Coupled-file groups: "any sets of files that must change together?"
   (paths + a one-line why). Skip if none.
7. CI runner: GitHub → `ubuntu-latest` unless the project needs an Apple
   toolchain (then `macos-14`); GitLab → runner image (e.g. `node:22`,
   `python:3.12`).

## 4. Write the config

Start from `templates/teamwork.default.json`, fill in the interview results,
write `.claude/teamwork.json`, and validate: `jq . .claude/teamwork.json`.

## 5. Install the terminal mirror

- `mkdir -p .githooks`
- Copy `${CLAUDE_PLUGIN_ROOT}/hooks/scripts/lib.sh` → `.githooks/lib-guard.sh`
  (exact copy — this is the versioned mirror the pre-commit hook sources).
- Copy `templates/githooks/pre-commit` → `.githooks/pre-commit`.
- `chmod +x .githooks/pre-commit`
- **ASK the user** before running `git config core.hooksPath .githooks`
  (it changes their clone's behavior; teammates each run it once, or CI/docs
  remind them). Do not run it unprompted.

## 6. Permissions deny-list

Deep-merge `templates/settings.merge.json` into `.claude/settings.json`,
preserving everything already there and deduplicating:

```bash
jq -s '.[0] as $cur | .[1] as $add | $cur * $add
  | .permissions.deny = ((($cur.permissions.deny // []) + $add.permissions.deny) | unique)
  | .permissions.ask  = ((($cur.permissions.ask  // []) + $add.permissions.ask)  | unique)' \
  .claude/settings.json "${CLAUDE_PLUGIN_ROOT}/templates/settings.merge.json"
```

(If `.claude/settings.json` doesn't exist, start from `{}`.) Write the result
back only after `jq .` accepts it.

## 7. Rules file + CLAUDE.md

- Fill `templates/rules/team-workflow.md` placeholders ({{BASE_BRANCH}},
  {{BRANCH_PREFIXES}}, {{TEST_COMMAND}}, {{PR_NOUN}}, {{PR_CREATE_CMD}},
  {{ESCAPE_VAR}}, {{CI_NAME}}) and write `.claude/rules/team-workflow.md`.
- Fill `templates/claude-md-section.md` and append it to `CLAUDE.md` (create
  the file if absent). If a "## Team workflow rules" section already exists,
  show a diff and ask instead of appending a duplicate.

## 8. CI

Fill the provider's template (`templates/ci/github-ci.yml` →
`.github/workflows/ci.yml`, or `templates/ci/gitlab-ci.yml` →
`.gitlab-ci.yml`). Remove the build step/line when there is no separate build
command. **If a CI file already exists, do not clobber it** — show a diff of
what the template would add (the test job, concurrency/interruptible) and let
the user decide.

## 9. Validate

- `jq . .claude/teamwork.json` parses.
- Run the configured test command once in its dir — it must exit 0 (or the
  user acknowledges it's currently red).
- `bash -n .githooks/pre-commit .githooks/lib-guard.sh`.

## 10. Summary

Print what was written/changed, then:

- "Commit these files **on a branch** — the guards are now live, so a direct
  commit to the base branch will be blocked (as intended)."
- Team activation: each clone runs `git config core.hooksPath .githooks` once;
  Claude Code users just need the agentic-teamwork plugin enabled.
- Suggest `/teamwork-audit` any time enforcement seems off.
