---
name: audit-project
description: "Check the repo you are in against the team conventions: the marker and its version, the hub and its CLAUDE.md link, the ignore block and the CI gate, drift of the repo's scripts and pre-commit hook, the shared permission rules, the lane commands against the package scripts, a strict test gate with nothing to run, a live lane where a model is called, and credentials in the index. Use when the guards or the CI gate seem off, after a plugin update, or when asked to audit or verify the setup. --fix applies the mechanical repairs. To set a repo up in the first place use init-project."
argument-hint: "[--fix]"
---

# audit-project

One pass over this repo, then a short report. The script finds; you judge and, with `--fix`, repair.

## Step 1: Scan

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/audit-project.mjs" --json
```

`{root, errors, warnings, rules_tokens, findings[]}`, each finding carrying `check`, `severity` (`error`, `warn`, `info`), `detail`, and sometimes `fix`. It exits 0 whatever it found: reporting is its whole job.

*Done when: the JSON is parsed. Never re-derive a count in prose; the numbers are the script's.*

## Step 2: Report

Errors first, then warnings, then info, one line each:

```
<severity> <check>: <detail>
```

Close with the counts and, when there are no findings, `On the conventions, nothing to report.`

Three findings deserve a sentence rather than a line, because none has a mechanical fix:

- **`secret`**: a credential pattern in the git index. Report the `file:line`, never the value, and say plainly that a credential in the index is compromised: it needs removing *and* rotating.
- **`live-lane`**: the repo calls a model and has no live lane. That is a gap in what the tests can see, not a formatting problem. Offer to wire one from `/agentic-teamwork:tdd`, `references/live-lane.md`.
- **`hooks-path`**: this clone has not turned the pre-commit hook on. It is one clone's setting and the person's call; name the command and leave it to them.

*Done when: every finding appears once and the counts match the script's.*

## Step 3: Fix, only with `--fix`

Only when the person asked for repairs in this conversation. When you reached for this skill on your own, report the findings and offer `--fix`; do not apply it. Each repair is shown before it is applied:

| Finding | Fix |
| --- | --- |
| `marker`, `floor`, `standard-version`, `scripts`, `script-drift`, `pre-commit`, `pre-commit-drift`, `settings`, `lanes`, and `verify-standard` lines starting `ci-gate`, `gitignore-fence`, `scripts-present`, `hub` | `node "${CLAUDE_PLUGIN_ROOT}/scripts/init-project.mjs" --upgrade --dry-run`, read the plan, then without `--dry-run`. It keeps an edited file and shows its diff. |
| `verify-standard: claude-md` | A `CLAUDE.md` with content beside an `AGENTS.md`: merge it into `AGENTS.md`, delete it, then run the upgrade to make the link. |
| `verify-standard: rules-imported` | Add the missing `@.agents/rules/<file>.md` line to the root `AGENTS.md`. |
| `strict-gate` | The upgrade with `--strict --test-command "<cmd>"`, once the person names the command. |
| `first-layout` | Nothing to run: the session hook moves the file at the next session start, and the upgrade carries its rules into the marker. |
| `personal-settings` | `git rm --cached .claude/settings.local.json`, then check the `.gitignore` block is there. |
| `rule-length`, `rules-budget` | Cut the rule down; it loads in every session. A person's call on what goes. |

Never auto-fix a `secret` or a `live-lane` finding. Removing a credential is one action and rotating it is another, and only a person can do the second.

*Done when: every applied fix has been re-checked by re-running the scan, and the remaining findings are the ones that need a person.*
