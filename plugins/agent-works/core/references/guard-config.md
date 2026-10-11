# The config: `.agents/agent-works.json`

One file per project, tracked with the repository. **Its presence turns the guard on**: without it both hooks do
nothing, and every `aw` check runs on the defaults, so a legacy repository gets a report before anything is set up.
`aw setup --apply` writes a minimal one. Every key is optional; what is left out takes the default shown here.
`aw doctor` reports a file that is not valid JSON, a key of the wrong shape or a pattern that is not a regular
expression as `CONFIG_INVALID` (critical). A broken file never blocks work: the guard falls back to the defaults.

```json
{
  "version": 1,
  "paths": { "memory": ".agents/memory", "kanban": ".agents/kanban", "briefs": ".agents/briefs",
             "decisions": ".agents/decisions", "glossary": ".agents/CONTEXT.md", "contracts": ".agents/contracts",
             "plan": ".agents/plan", "userDocs": "docs" },
  "tasks": { "home": "kanban" },
  "claude": { "twins": "generated" },
  "budgets": { "rootAgentsLines": 200, "hubLines": 40, "contractLines": 120, "statusLines": 120,
               "memoryFileLines": 400, "memoryFolderFiles": 12, "indexHookChars": 160,
               "decisionLines": 150, "glossaryRowChars": 300, "briefLines": 120, "roundBriefLines": 80, "noteChars": 200 },
  "links": { "roots": [], "planned": [], "notChecked": [] },
  "dup": { "shingleWords": 12, "minWords": 14, "ignore": [] },
  "kanban": { "staleStartDays": 7, "gateOwedDays": 3 },
  "guard": {
    "agentVar": "AW_AGENT", "agentVarAliases": ["PL_AGENT"],
    "ownerFiles": [], "ownerFilesEdit": "ask",
    "generated": [],
    "staging": { "blanket": "deny", "unseen": "deny" },
    "defaultBranch": { "names": ["main", "master"], "commit": "warn", "forcePush": "ask" },
    "rules": [],
    "log": true
  },
  "resources": {},
  "lockOrder": [],
  "runs": [],
  "counters": {},
  "coordination": { "lockStaleMinutes": 45, "agentStaleMinutes": 120, "holdMinutes": 120, "claimHours": 72,
                    "learningChars": 6000, "logBytes": 262144 }
}
```

## Key by key

| Key | Meaning |
|---|---|
| `version` | The schema version, `1`. A higher number than the plugin reads is `CONFIG_INVALID`. |
| `paths.*` | Where each kind of fact lives, relative to the repository's top. `userDocs` is the folder for user-facing documentation: agent-works never writes there, and agent material found in it is `DOCS_AGENT_FILE`. An existing `.agents/board` is used as the kanban folder while `paths.kanban` does not exist. |
| `tasks.home` | Where tasks are kept: `kanban`. Another value with cards in the kanban folder is `TASKS_TWO_HOMES`. |
| `claude.twins` | `generated` (a `CLAUDE.md` importing its sibling beside every `AGENTS.md`, git-ignored, healed at session start), `committed` (the same, tracked), `off`. |
| `budgets.*` | Size limits the checks compare against: lines of the root `AGENTS.md`, of a hub, of `.agents/README.md`, of the status memory, of a memory, of a decision, of a brief and a round brief; memories per folder; characters of a memory's `description`, of a glossary row, of a note. |
| `links.roots` | Top-level folders whose paths are checked when written in code. Empty: every top-level folder git tracks. |
| `links.planned`, `links.notChecked` | Paths named before they exist, and paths never checked (build output). |
| `dup.shingleWords`, `dup.minWords`, `dup.ignore` | How `aw dup` reads: the window in words, the shortest shared run it reports, and regexes of lines it skips. |
| `kanban.staleStartDays`, `kanban.gateOwedDays` | Days before `aw kanban lint` speaks: a card in progress that nobody touched (`KANBAN_STALE_START`), a gate still owed (`GATE_OWED_OLD`). |
| `guard.agentVar`, `guard.agentVarAliases` | The environment variable that carries an agent's name, and older names read as the same. A command may set it in its own text (`AW_AGENT=a1 …`, `$env:AW_AGENT = "a1"; …`). |
| `guard.ownerFiles` | Files local to the owner's machine that are never committed, relative to the top, with forward slashes. A trailing slash is a folder. Literal paths, not globs. |
| `guard.ownerFilesEdit` | What an Edit or Write of one of them gets: `ask` (default), `deny`, `warn`, `off`. |
| `guard.generated` | `[{ "match": "<regex on the path relative to the top>", "how": "<what to run instead>" }]`. An Edit or Write of a match is refused with the `how`. Case is ignored. |
| `guard.staging.blanket` | `git add -A` / `-u` / `.` / `:/` / `'*'` and `git commit -a`: `deny` (default), `ask`, `warn`, `off`. |
| `guard.staging.unseen` | A pathspec the guard cannot read (a variable, `$(…)`, `xargs`, `--pathspec-from-file`), when `ownerFiles` is not empty: `deny` (default), `ask`, `warn`, `off`. |
| `guard.defaultBranch` | `names`: the branches work does not land on directly. `commit`: a `git commit` while on one (`warn` by default: the agent is told to branch, nobody is asked). `forcePush`: any `git push --force` / `-f` / `+refspec` (`ask` by default). Each `ask`, `deny`, `warn` or `off`. Set `commit` to `ask` only when the owner wants to approve it. |
| `guard.rules` | The project's own rules, as data. See below. |
| `guard.log` | `true`: every deny, ask and warn is appended as one JSON line to `<aw home>/projects/<project id>/guard.log`. |
| `resources.<name>` | Something of which one runs at a time. `scope`: `project` (default) or `machine`. `match`: regexes of the commands that start it. `unless`: regexes of commands that match but start nothing (a listing, a dry run). `processes`, `maxMinutes`, `exclusive`: read by `aw lock` (see `coordination.md`). |
| `lockOrder` | The order to take several resources in; the refusal names it. |
| `runs` | Budgets for expensive runs. See below. |
| `counters.<name>` | Shared counters agents claim with `aw claim` (a `note` says what it numbers). |
| `coordination.lockStaleMinutes` | A lock not refreshed for this long, while none of its resource's `processes` runs, is taken over by the next to ask. |
| `coordination.agentStaleMinutes` | An agent registered without a process id is dropped from `aw who` after this long without a beat. |
| `coordination.holdMinutes` | How long a lease taken with `--hold` lasts unless it says otherwise. |
| `coordination.claimHours` | How long a claim on a counter lasts before it lapses. |
| `coordination.learningChars`, `coordination.logBytes` | The size cap of one shared learning; the size past which a notes log rotates. |

## What the guard does with it

The guard reads a command the way a shell does: quotes, here-documents, PowerShell here-strings and `$(…)` are words,
not commands, so the text of a commit message, an `echo` or a search never trips a rule. A line handed to another
shell (`bash -c "…"`, `powershell -Command "…"`) is read too. Commands that only read or print (`cat`, `grep`, `rg`,
`sed -n`, `echo`, `git log|show|diff|grep`, `git commit` for its message, `gh`, `aw` itself) are skipped by the
resource, run and project rules. A refusal wins over a question, a question over a warning.

| Rule | When | Answer |
|---|---|---|
| `staging-blanket` | staging the whole tree | `guard.staging.blanket` |
| `staging-owner-files` | a `git add` / `stage` / `commit <paths>` that reaches an owner file: the file, a folder above it, a glob, from another folder (`cd`, `git -C`), an exclusion that does not cover it; or an unreadable pathspec | deny (`unseen` for the unreadable) |
| `owner-file-edit` | Edit / Write / MultiEdit / NotebookEdit of an owner file | `guard.ownerFilesEdit` |
| `generated-file` | Edit / Write of a path in `guard.generated` | deny, with the `how` |
| `default-branch-commit` | `git commit` on one of `defaultBranch.names` | `defaultBranch.commit` |
| `force-push` | a forced `git push` | `defaultBranch.forcePush` |
| `resource-lock` | a command matching `resources.<name>.match` that neither runs inside `aw lock run <name> … -- <command>` nor carries the name of the agent holding the lock | deny, with the commands to take it |
| `run-budget` | a command matching `runs[].match` that asks for more than `free` items without its reason | deny; with a reason: allowed, and logged |
| *your id* | a `guard.rules` entry matches | its `decision` |

`default-branch-commit` and `force-push` are aids for an agent. The ordinary cadence (branch, commit, push, pull request, merge) is never
asked of the owner by this guard: only the forced push is, because it destroys work. Branch protection, secrets and
failing tests as a team policy belong to the agentic-teamwork plugin.

See what the guard would say, without running anything and without logging:

```bash
python -B "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py" --explain 'git add -A'            # add --cwd DIR, --json
python -B "${CLAUDE_PLUGIN_ROOT}/hooks/guard.py" --explain --file src/gen/layout.h   # an Edit of a path
```

## A project's own rules: `guard.rules`

Rules are data: patterns and a message. The plugin never runs code from a repository; a rule that needs code stays
a hook in the project's own `.claude/settings.json`.

```json
{ "id": "no-direct-launch", "decision": "deny",
  "match": ["(^|[\\\\/\\s])sim(\\.exe)?(\\s|$)", "steam://run"],
  "unless": ["run-in-session"],
  "scope": "segment", "skipReaders": true, "when": { "branch": ["main"] },
  "message": "Launch through tools/run-in-session.ps1: a direct launch runs in the service session." }
```

| Field | Meaning |
|---|---|
| `id` | The rule's name in answers and in the log. Required. |
| `decision` | `deny`, `ask` or `warn`; anything else switches the rule off. |
| `match` | Regexes (Python syntax; `(?i)` for any case). The rule fires when one matches. Required. |
| `unless` | Regexes that excuse a match in the same text. |
| `scope` | `segment` (default): each command between `;`, `&&`, `\|\|`, `\|` and line breaks, as its words joined by one space, without `VAR=value` prefixes. `command`: all segments together. `file`: the path of an Edit or Write, relative to the top. |
| `skipReaders` | `true` (default): commands that only read or print are not looked at. `false`: every segment is, so a word in an `echo`, a `curl` body or a commit message counts. |
| `when.branch` | Only on these branches. |
| `message` | What the agent is told: the rule, why, and what to do instead. |

## Budgets for expensive runs: `runs`

```json
{ "id": "render", "match": ["render\\.py\\b"], "reasonVar": "AW_RUN", "free": 3, "fullAt": 100,
  "count": { "names": true, "allFlags": ["--all"], "groupFlag": "--group", "matchFlag": "--match",
             "valueFlags": ["--out"], "groupsFile": "tools/groups.json", "itemsDir": "shots" },
  "dryFlags": ["--dry-run", "--list"],
  "message": "Pick the shots that show the change: tools/render.py --list prints a selection." }
```

A command that matches is counted: the plain words after the matched program are items (`names`, commas split),
`allFlags` mean everything (the entries of `itemsDir`, when given), `groupFlag` names a group of `groupsFile`
(`{ "group": ["glob", "!glob"] }` over the entries of `itemsDir`), `matchFlag` narrows by a glob, and the values of
`valueFlags` are not items. Flags are compared without their dashes and without case, so `-All` and `--all` are one.
A `dryFlags` flag means nothing runs.

- Up to `free` items: goes through.
- More than `free`: needs `<reasonVar>="verify: <what already works, what this run checks>"` in the command.
- Everything (an all-flag over at least four fifths of the items, or `fullAt` items or more): needs
  `<reasonVar>="full: <what is finished>"`.
- A size the text does not say (an unknown group) is refused rather than guessed, and needs a reason.

The reason is read from the command's own text (`AW_RUN="verify: …" <command>`; PowerShell: `$env:AW_RUN = "verify: …";
<command>`), must be at least 12 characters, and is logged where the owner sees it. With a reason the run is allowed
and the agent is reminded that it was the exception.

## Example

```json
{
  "version": 1,
  "guard": {
    "agentVar": "ACME_AGENT",
    "ownerFiles": [".editor/settings.json", "apps/host/Config/Local.ini", "apps/host/Content/Maps/"],
    "generated": [{ "match": "(^|/)src/gen/", "how": "It is generated: change src/schema/ and run `make codegen`." }],
    "rules": [{ "id": "baseline-needs-engine", "decision": "deny", "match": ["\\bbaseline\\s+update\\b"],
                "unless": ["--engine\\b"], "message": "`baseline update` without --engine replaces every entry: name the engine." }]
  },
  "resources": {
    "editor": { "scope": "project", "match": ["scripts/(run-tests|render)\\.ps1"], "unless": ["(^|\\s)-List\\b"],
                "processes": ["Editor"], "maxMinutes": 30 },
    "gpu-exclusive": { "scope": "machine", "match": ["\\btrain\\.py\\b"] }
  },
  "lockOrder": ["gpu-exclusive", "editor"],
  "counters": { "material-version": { "note": "bumped by every change to a master material" } }
}
```
