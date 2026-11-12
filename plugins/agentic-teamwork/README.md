# agentic-teamwork

Team git conventions that hold whoever is typing: an experienced engineer, a
prototyper at full speed, or the agent itself.

## The problem

"Please don't push to main" is a wish, not a control. The failures are always
the same: a commit lands on the default branch, a force push rewrites shared
history, an API key ends up in a diff, a change merges on checks nobody ran.
Asking an agent to behave works until its context is compacted; people forget
faster than that.

## How it works

A repo opts in with one committed file, `.agents/manifest.json`. From then on
four layers apply the same rules:

| Layer | Where it runs | What it does |
|---|---|---|
| Session hooks | Every Claude Code session with the plugin enabled | Judges each `git commit` and `git push` before it runs, briefs the session, and reports what a turn leaves behind |
| `.githooks/pre-commit` | Any terminal, once `core.hooksPath` points at it | The commit-time rules for people committing outside Claude Code |
| `permissions.deny` | Claude Code, before a hook fires | Refuses the force and `--no-verify` spellings outright |
| CI gate | The forge, on every pull or merge request | The one check nobody can configure away locally |

**The guard** reads a Bash or PowerShell call the way a shell does: each
command in a chain is judged in the repo it will run in (`cd`, `git -C`,
`bash -c`, `sudo`), and the strictest verdict wins.

| Action | Verdict |
|---|---|
| Commit or push on a protected branch | refused |
| Force push, in any spelling including `+branch` | refused |
| `--no-verify` | refused |
| A credential in what is staged or about to be staged | refused, reported as file and line, never the value |
| Adding junk (`.DS_Store`, `node_modules/`, `.env`) | refused; deleting tracked junk is fine, and so is `.env.example` |
| Any other push | asks you first, unless you granted that branch |
| The first commit of a new repo | allowed, wherever it lands |

**The briefing** costs about a hundred tokens at session start: the branch,
whether it is protected or behind its base, the repo's lane commands, and
whatever needs a hand (an upgrade to run, a hook git would skip, a forge CLI
that is not installed). Six critical lines stay in context after it, come back
after a compaction or `/clear`, and reach subagents that write code.

**The stop gate** tells the agent, once, what the turn is leaving behind:
uncommitted work, a stray file at the root, source changed with no test run.

**Where there is no manifest**, the plugin asks once per clone whether to use
it. Answer `on` and the portable rules apply (force push, `--no-verify`,
credentials, junk, the push question) without the branch conventions. Answer
`off` and it is silent.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install agentic-teamwork@agentic-engineering
```

Then, in the repo:

```text
/agentic-teamwork:bootstrap
```

Node 22 and git are the only requirements. Opening and landing change requests
needs the forge's own CLI, `gh` or `glab`, signed in.

## Skills

| Skill | Invocation | Does |
|---|---|---|
| `bootstrap` | `/agentic-teamwork:bootstrap` | Puts a repo, or an empty folder, on the conventions. Local only: nothing is pushed or created on a forge. |
| `init-project` | `/agentic-teamwork:init-project [--upgrade] [--strict]` | The scaffold itself: the manifest, the `AGENTS.md` hub and its `CLAUDE.md` link, the ignore block, the pre-commit hook, the CI gate. `--upgrade` brings an existing repo forward and never overwrites a file it did not write. |
| `audit-project` | model-invoked, or `/agentic-teamwork:audit-project [--fix]` | Checks every layer and names the broken one. |
| `ship` | model-invoked on "ship it" or "open a PR" | Commits, pushes, and opens the pull or merge request. |
| `land` | model-invoked when a reviewed change should merge | Waits for checks, merges the reviewed commit, cleans up the branch. |
| `tdd` | model-invoked when writing or changing tests | Red, green, refactor per behavior, which lane a check belongs in, and what to mock. |

`ship` and `land` work the same on GitHub and GitLab.

## Stricter rules

The defaults protect the default branch and gate nothing on tests. A team that
wants more adds a `teamwork` block to the manifest; every key is optional.

```json
{
  "teamwork": {
    "requireTestsPass": true,
    "test": { "command": "npm test", "sourcePatterns": ["^src/"], "timeoutSeconds": 240 },
    "protectedBranches": ["main", "release"],
    "branchPrefixes": ["feature/", "fix/", "chore/"],
    "lint": { "command": "eslint {file}", "filePatterns": ["\\.ts$"] },
    "coupledFiles": [{ "files": ["schema.sql", "src/models/*"], "message": "Schema and models change together." }],
    "secretPatternsExtra": ["ACME_[A-Z0-9]{32}"],
    "rules": { "askBeforePush": false }
  }
}
```

- `requireTestsPass` makes passing tests a hard gate: the test command runs
  before a commit and when a turn ends with source changed, and a failure
  refuses the commit or holds the turn.
- `lint` runs on each edited file that matches and feeds a failure back to the
  agent; `coupledFiles` reminds it of the other half of a pair.
- `rules` turns a single rule off: `blockCommitOnProtected`,
  `blockPushToProtected`, `blockForcePush`, `blockNoVerify`, `blockSecrets`,
  `blockJunk`, `askBeforePush`, `stopGate`.
- `escapeHatch` names the environment variable (default `TEAMWORK_ALLOW`) that
  lets one command through when set on that command: `TEAMWORK_ALLOW=1 git push`.
  A mention in a comment or a commit message does not count.

`/agentic-teamwork:init-project --strict` writes the test gate for you.

## Coming from 0.x

A repo set up by an earlier version keeps its rules in `.claude/teamwork.json`.
The first session after the update moves it: the settings become the `teamwork`
block with everything the old file enforced spelled out, so nothing loosens;
the old files are parked under `.agents/retired/agentic-teamwork/`, never
deleted; the bash pre-commit hook is replaced by the Node one. The agent is
told what moved and what is left to edit by hand. `/teamwork-init` and
`/teamwork-audit` are now `bootstrap`, `init-project` and `audit-project`.

## Boundaries

This plugin owns a team's version-control conventions. How agents share a
codebase (locks, owner files, the board) is agent-works; the build ladder is
code-diet; documentation checks are docs-parity. They are meant to run
together, and each works alone.
