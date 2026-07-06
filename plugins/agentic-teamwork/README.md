# agentic-teamwork

Deterministic version-control guardrails for mixed-skill teams — the rules
that keep a repo healthy when experienced engineers, vibe-coders, and Claude
itself all commit to it.

## The problem

On a team where some contributors are prototyping at full speed, "please
don't push to main" is a wish, not a control. The failure modes are always
the same: a commit lands directly on main, a force-push rewrites shared
history, an API key ends up in a diff, a branch cut from a stale base merges
with vacuously green tests. Prompting an agent to behave helps until it
doesn't; humans forget faster than that.

This plugin makes the rules deterministic. Hooks — not vibes — decide.

## The four enforcement layers

| Layer | Where it runs | What it covers |
|---|---|---|
| Claude Code hooks | Every Claude session with the plugin enabled | Denies bad `git commit`/`git push` before execution; briefs each session; lint + coupled-file feedback on edits; blocks ending a turn with a broken tree |
| `.githooks/pre-commit` | Any terminal, any teammate (once `core.hooksPath` is set) | Same protected-branch / junk / secret / test checks for humans committing outside Claude |
| `permissions.deny` | Claude Code, before the hook even fires | Belt-and-suspenders denial of `--force` and `--no-verify` variants |
| CI (GitHub Actions / GitLab CI) | Server-side, every PR/MR | The one gate nobody can configure away locally |

One config file — `.claude/teamwork.json`, committed in the repo — drives all
four. Its presence turns the guards on; repos without it are untouched (the
hooks exit instantly, so the plugin is safe to leave enabled globally).

## Blocked vs warned

| Action | Result |
|---|---|
| `git commit` on a protected branch | **Blocked** |
| `git push` to a protected branch (incl. refspecs, `HEAD`, bare push) | **Blocked** |
| Force-push (`--force`, `-f`, `--force-with-lease[=…]`, `--force-if-includes`) | **Blocked** |
| `--no-verify` / `-n` on commit or push | **Blocked** |
| Committing likely secrets (Anthropic/AWS/GitHub/GitLab/Slack tokens, private keys, your own patterns) | **Blocked** (reported as file:line, never the token) |
| Committing junk (`.DS_Store`, `node_modules/`, `.env`, …) | **Blocked** |
| Committing while the test command fails | **Blocked** |
| Ending a Claude turn with dirty source files and failing tests | **Blocked** (Stop hook) |
| Lint issues in an edited file | Warned (feedback to Claude) |
| Touching one file of a coupled group | Warned (reminder of the others) |
| Branch behind the remote base at session start | Warned |
| Source changes without test changes | Warned |
| Docs (README/CLAUDE.md) not touched despite architecture changes | Warned |
| Untracked files loitering at the repo root | Warned |

## Install

From a marketplace that carries it:

```
/plugin install agentic-teamwork
```

Or as a skills-directory plugin: clone this repo and copy (or symlink)
`plugins/agentic-teamwork/` into `~/.claude/skills/`.

Requirements: bash, git, and **jq** on every machine that should enforce
(hooks fail open without jq — and tell you so at session start; the terminal
pre-commit fails closed). `gh` or `glab` are used by the skills, not the guards.

## Initialize a repo

```
/teamwork-init
```

The skill detects your provider (GitHub or GitLab) from the remote URL, the
default branch, and your test/lint/build commands from the project manifests;
confirms everything in a short interview; then writes:

- `.claude/teamwork.json` — the committed config (see reference below)
- `.githooks/pre-commit` + `.githooks/lib-guard.sh` — the terminal mirror
- `.claude/settings.json` — merged `permissions.deny` entries
- `.claude/rules/team-workflow.md` + a short CLAUDE.md section
- `.github/workflows/ci.yml` or `.gitlab-ci.yml` (diffed, never clobbered)

Commit the result **on a branch** — the guards are live immediately, and yes,
they will block you from committing them to main. That's the product working.

Each teammate activates the terminal mirror once per clone:

```
git config core.hooksPath .githooks
```

`/teamwork-audit` checks all four layers any time enforcement seems off.

## Config reference

Full schema with types and defaults: `skills/teamwork-init/reference.md`.
The short version — every key of `.claude/teamwork.json`:

| Key | Default | Purpose |
|---|---|---|
| `provider` | `"auto"` | `github` / `gitlab`; drives PR-vs-MR wording, CLI commands, CI file |
| `remote` / `baseBranch` | `origin` / `main` | Stale-base check, changed-set diffs, CI triggers |
| `protectedBranches` | `["main","master"]` | Where commits/pushes are denied |
| `branchPrefixes` | `["feature/","fix/","chore/"]` | Suggested in messages |
| `escapeHatch` | `"TEAMWORK_ALLOW"` | Name of the bypass env var |
| `test.command` / `test.dir` / `test.timeoutSeconds` | `null` / `"."` / `240` | The test gate (`bash -lc`) |
| `test.sourcePatterns` / `test.testPatterns` | `[]` | What counts as logic / as tests (ERE) |
| `build.command` / `build.dir` | `null` / `"."` | Fallback gate for repos with no tests yet |
| `lint.command` / `lint.filePatterns` | `null` / `[]` | Post-edit lint; `{file}` placeholder |
| `junkPatterns` | OS/build cruft | Files that must never be committed |
| `secretPatternsExtra` | `[]` | Extra secret EREs (e.g. `sk_live_…`) |
| `coupledFiles` | `[]` | Groups of files that change together + why |
| `docs.files` / `docs.watchPatterns` | `[README.md, CLAUDE.md]` / `[]` | Docs-drift warning |
| `scan.maxFileBytes` | `524288` | Secret-scan cap per file |
| `rules.*` | all `true` | Per-rule kill switches |

## Escape hatches

- **`TEAMWORK_ALLOW=1`** (or your configured `escapeHatch` name) in the
  command bypasses everything for that command. Deliberately loud: it sits in
  the transcript or shell history, so it's auditable. Maintainers only.
- **`TEAMWORK_SKIP_TESTS=1`** skips only the test run in the terminal
  pre-commit — for the "fixing the tests is the commit" case.
- CI has no escape hatch. That's the point of the fourth layer.

## GitHub vs GitLab

Detection is automatic from the remote URL; the config pins it explicitly.
Everything user-facing follows: PR/`gh pr create`/GitHub Actions/
`.github/workflows/ci.yml` vs MR/`glab mr create`/GitLab CI/`.gitlab-ci.yml`.
The GitLab CI template runs on merge-request events and pushes to the base
branch, with `interruptible: true` standing in for Actions' concurrency
cancellation. Self-hosted instances whose hostname contains neither "github"
nor "gitlab": set `provider` explicitly (init asks).

## FAQ

**Why was my push blocked?** You targeted a protected branch, used a force
flag, or used `--no-verify`. The deny message says which and what to do
instead — usually `git push -u origin <branch>` and open a PR/MR.

**The hooks aren't firing.** In order: (1) the plugin must be enabled and
trusted (check `/plugin`); (2) the repo must contain `.claude/teamwork.json`
— no config, no guards; (3) `jq` must be installed — the session briefing
warns when it's missing; (4) for terminal commits,
`git config core.hooksPath` must be `.githooks` in *your* clone. Run
`/teamwork-audit` and it will point at the broken layer.

**I genuinely need to force-push.** Get a maintainer to run the command with
`TEAMWORK_ALLOW=1` (auditable), or flip `rules.blockForcePush` to `false` in
a reviewed config change. Note the Claude-side `permissions.deny` entries
also match force-push — remove those from `.claude/settings.json` too if the
push should come from a session.

**Does this replace server-side branch protection?** No — enable that too.
This plugin covers the gap where server rules can't reach: local commits,
agent sessions, and the feedback loop *before* the push fails.

**A rule is wrong for this repo.** Every hard block has a toggle under
`rules.*`; every pattern is config. Change the config in a PR like any other
code.

## Requirements

- bash ≥ 4, git, jq (guards)
- `gh` (GitHub) or `glab` (GitLab) — used by the skills for PR/MR flows
- GNU or BSD userland; macOS Homebrew paths handled automatically

## Changelog

- **0.1.0** — Initial release: git-guard, session briefing, edit-check,
  stop-gate; terminal pre-commit mirror; GitHub + GitLab providers;
  `/teamwork-init` and `/teamwork-audit`.
