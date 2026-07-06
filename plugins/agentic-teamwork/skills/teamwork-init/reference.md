# .claude/teamwork.json — config schema reference

Committed at the target repo's `.claude/teamwork.json`. Its **presence turns
the guards on**; delete it (on a branch, via a PR/MR…) to turn them off.
Absent keys take the defaults below — a minimal config can be tiny. All
pattern fields are POSIX EREs matched against repo-relative paths unless
noted. Read by `hooks/scripts/lib.sh` (`tw_cfg`, `tw_cfg_list`, `tw_rule`).

## Top level

| Key | Type | Default | Drives |
|---|---|---|---|
| `version` | number | `1` | Schema version; only `1` exists. |
| `provider` | `"github"` \| `"gitlab"` \| `"auto"` | `"auto"` | Every user-facing message (PR vs MR, `gh pr create` vs `glab mr create`, CI name/file). `auto` sniffs the remote URL; init always writes an explicit value. Unknown host + `auto` → generic "PR/MR" wording. |
| `remote` | string | `"origin"` | Which remote the stale-base check, changed-set diff, and provider sniffing use. |
| `baseBranch` | string | `"main"` | Stale-base warning (`HEAD..remote/base`), stop-gate changed set, CI triggers. |
| `protectedBranches` | string[] | `["main","master"]` | Exact branch names where commits and pushes are denied (git-guard + pre-commit). |
| `branchPrefixes` | string[] | `["feature/","fix/","chore/"]` | Suggested in deny messages and the session briefing; first entry is the example prefix. |
| `escapeHatch` | string | `"TEAMWORK_ALLOW"` | Env var name; `<VAR>=1` in a command bypasses git-guard, `<VAR>=1` in the environment bypasses pre-commit. Auditable in transcripts/shell history. |

## `test`

| Key | Type | Default | Drives |
|---|---|---|---|
| `test.command` | string \| null | `null` | The commit/stop test gate, run via `bash -lc` in `test.dir`. `null` → fall back to `build.command`; both null → gate passes vacuously. |
| `test.dir` | string | `"."` | Working directory for `test.command` (repo-relative). |
| `test.sourcePatterns` | string[] (ERE) | `[]` | Files that count as "logic". Dirty matches trigger the stop-gate test run; changed matches trigger the logic-without-tests warning. Empty → stop-gate hard block never fires. |
| `test.testPatterns` | string[] (ERE) | `[]` | Files that count as tests. Empty → logic-without-tests warning is skipped. |
| `test.timeoutSeconds` | number | `240` | `timeout` wrapper for the test run (when `timeout` exists). |

## `build`, `lint`

| Key | Type | Default | Drives |
|---|---|---|---|
| `build.command` | string \| null | `null` | Fallback gate when `test.command` is null (repos with no tests yet). |
| `build.dir` | string | `"."` | Working directory for `build.command`. |
| `lint.command` | string \| null | `null` | Post-edit lint feedback (non-blocking, exit-2 feedback to Claude). `{file}` is replaced with the edited file's absolute path. |
| `lint.filePatterns` | string[] (ERE) | `[]` | Only matching files are linted. Empty → lint never runs. |

## Scanners

| Key | Type | Default | Drives |
|---|---|---|---|
| `junkPatterns` | string[] (ERE) | `.DS_Store`, `Thumbs.db`, `node_modules/`, `__pycache__/`, `.env*` (see template) | Staged files matching any pattern are deny-listed at commit time. |
| `secretPatternsExtra` | string[] (ERE) | `[]` | Appended to the built-in secret regex (Anthropic/AWS/GitHub/GitLab/Slack tokens, private-key blocks). Example: `"sk_live_[A-Za-z0-9]{8,}"` for a vendor key format. Hits report file:line, never the token. |
| `scan.maxFileBytes` | number | `524288` | Per-file byte cap for the secret scan. |

## `coupledFiles`

Array of `{ "files": ["path/or/glob", …], "message": "why they move together" }`.
When an edited file matches a group (glob or exact, repo-relative), the edit
hook reminds Claude of the other members and the message. Default `[]`.

## `docs`

| Key | Type | Default | Drives |
|---|---|---|---|
| `docs.files` | string[] (exact paths) | `["README.md","CLAUDE.md"]` | The docs that should move when watched files change. |
| `docs.watchPatterns` | string[] (ERE) | `[]` → falls back to `test.sourcePatterns` | Changed files that make the stop hook check for docs drift. |

## `rules` — per-rule kill switches (all default `true`)

Only an explicit `false` disables a rule.

| Key | Guards |
|---|---|
| `rules.blockCommitOnProtected` | `git commit` on a protected branch (git-guard + pre-commit). |
| `rules.blockPushToProtected` | `git push` targeting a protected branch, incl. refspecs and bare push. |
| `rules.blockForcePush` | `--force`, `-f`, `--force-with-lease[=…]`, `--force-if-includes`, combined short flags. |
| `rules.blockNoVerify` | `--no-verify`/`-n` on commit and push. |
| `rules.blockSecrets` | Secret scan of staged (and, with `-a`/`git add`, worktree) content. |
| `rules.blockJunk` | Staged junk-pattern files. |
| `rules.requireTestsPass` | Test gate before commits and in the stop-gate. |
| `rules.stopGate` | The Stop-hook hard block (warnings still print). |
