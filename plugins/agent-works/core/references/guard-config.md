# The config: `.agents/agent-works.json`

One file per project, tracked with the repository. **Its presence turns the guard on**: without it both hooks do
nothing, and every `aw` check runs on the defaults, so a legacy repository gets a report before anything is set up.
`aw setup --apply` writes a minimal one. Every key is optional; what is left out takes the default shown here
(`name` has none: it is the folder's name until you set it).
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
  "plugins": ["agent-works", "codebase-optimizer", "perceptual-loop"],
  "budgets": { "rootAgentsLines": 200, "hubLines": 40, "contractLines": 120, "statusLines": 120,
               "memoryFileLines": 400, "memoryFolderFiles": 12, "indexHookChars": 160,
               "decisionLines": 150, "glossaryRowChars": 300, "briefLines": 120, "roundBriefLines": 80, "noteChars": 200 },
  "links": { "roots": [], "files": [], "planned": [], "notChecked": [] },
  "briefs": { "stray": ["*brief*.md", "agent-*.md", "handoff*.md", "handover*.md"] },
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
  "accept": [],
  "coordination": { "lockStaleMinutes": 45, "agentStaleMinutes": 120, "holdMinutes": 120, "claimHours": 72,
                    "learningChars": 6000, "logBytes": 262144 }
}
```

## Key by key

| Key | Meaning |
|---|---|
| `version` | The schema version, `1`. A higher number than the plugin reads is `CONFIG_INVALID`. |
| `name` | The project's name where it is shown to people: the title of `.agents/README.md`, of a new root `AGENTS.md`, and the project in `aw who`, notes and learnings. Not set (the default): the folder name of the repository's main working tree, so a linked worktree says the project's name and not its own folder's. Set it when the folder is not the name (`"name": "Cardan"` in a folder `ac-headless`), then `aw setup --apply`. The project's id in the machine's store stays the folder's. Not a string: `CONFIG_INVALID`. |
| `paths.*` | Where each kind of fact lives, relative to the repository's top. `userDocs` is the folder for user-facing documentation: agent-works never writes there, and agent material found in it is `DOCS_AGENT_FILE`. An existing `.agents/board` is used as the kanban folder while `paths.kanban` does not exist. |
| `tasks.home` | Where tasks are kept: `kanban`. Another value with cards in the kanban folder is `TASKS_TWO_HOMES`. |
| `plugins` | The plugins the root `AGENTS.md` introduces in its § Agent plugins (what each is for, when to open each skill), so every session and sub-agent is primed at start. `aw setup --apply` writes the section between its two markers and nothing else; `aw doctor` reports it missing or out of date (`ROOT_PLUGINS`). Remove a name to drop its row; `[]` for no section. |
| `claude.twins` | `generated` (a `CLAUDE.md` importing its sibling beside every `AGENTS.md`, git-ignored, healed at session start), `committed` (the same, tracked), `off`. |
| `budgets.*` | Size limits the checks compare against: lines of the root `AGENTS.md`, of a hub, of `.agents/README.md`, of the status memory, of a memory, of a decision, of a brief and a round brief; memories per folder; characters of a memory's `description`, of a glossary row, of a note. |
| `links.roots` | Top-level folders whose paths are checked when written in code. Empty: every top-level folder git tracks. |
| `links.files` | Markdown files or folders `aw links` (and `aw doctor`) reads besides its defaults (the root `AGENTS.md`, every hub, the Markdown under `.agents/`), relative to the top: `["README.md"]` adds the root README. One that is not there is skipped. `links.roots` does not do this: it only says which paths count as repository paths. |
| `links.planned`, `links.notChecked` | Paths named before they exist, and paths never checked (build output). |
| `briefs.stray` | File-name globs (case is ignored) of Markdown that says it is a brief or a hand-over for agents. One outside `paths.briefs` is `BRIEF_STRAY`. `aw doctor` walks the working tree as it is on disk, git-ignored scratch and run-output folders included, three folders deep; it skips `.git`, `node_modules`, the hubs' skip list, `.claude/worktrees`, the other homes under `.agents/`, and any folder with more than 3000 entries. `[]` switches the check off. |
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
| `resources.<name>` | Something of which one runs at a time. `scope`: `project` (default) or `machine`. `match`: the commands that start it, each a regex or `{ "pattern": "<regex>", "unless": ["<regex>"] }`. `unless`: regexes of commands that match but start nothing (a listing, a dry run), for every pattern of the resource. `matchFileCommands`: `true` to test commands that only handle files as well (see below). `processes`, `maxMinutes`, `exclusive`: read by `aw lock` (see `coordination.md`). |
| `lockOrder` | The order to take several resources in; the refusal names it. |
| `runs` | Budgets for expensive runs. See below. |
| `counters.<name>` | Shared counters agents claim with `aw claim` (a `note` says what it numbers). |
| `accept` | Findings the project decided are fine as they are, each with its reason. See below. |
| `coordination.lockStaleMinutes` | A lock not refreshed for this long, while none of its resource's `processes` runs, is taken over by the next to ask. |
| `coordination.agentStaleMinutes` | An agent registered without a process id is dropped from `aw who` after this long without a beat. |
| `coordination.holdMinutes` | How long a lease taken with `--hold` lasts unless it says otherwise. |
| `coordination.claimHours` | How long a claim on a counter lasts before it lapses. |
| `coordination.learningChars`, `coordination.logBytes` | The size cap of one shared learning; the size past which a notes log rotates. |

## Accepted findings: `accept`

A check sometimes reports what the project has decided to keep: a directory that mixes loose files with
sub-folders and will stay so, a reference memory that is the approved plan as written and over its size budget.
Left alone such a finding warns forever, `aw doctor` is never clean, and a new warning drowns among the old.
`accept` takes it out, with the reason written down:

```json
"accept": [
  { "code": "HUB_MIXED_DIR", "path": "apps/hub/src", "why": "cli.ts is the path every run command names" },
  { "code": "MEM_FILE_SIZE", "path": ".agents/memory/reference/*-approved-plan.md", "why": "the approved plan, kept as written" }
]
```

| Field | Meaning |
|---|---|
| `code` | The finding's code, as `aw doctor` prints it. One code per entry. |
| `path` | The finding's path as the report prints it (relative to the top, forward slashes, no line number), or a glob over such paths: `*` is any run of characters, `/` included; `?` one character; `[…]` a set. Case counts. |
| `why` | The reason it stays, in a sentence. Required, and not empty. |

An accepted finding is not counted and does not fail the run. `aw doctor` says in one line how many there are;
`aw doctor --accepted` lists each with its why, and `--json` carries them under `accepted` (the finding's fields
plus `why`). Every check command honours the list (`aw hubs`, `aw memory lint`, `aw decisions lint`, `aw links`,
`aw dup`, `aw kanban lint`, `aw twins --check`); there the `accepted` key is present only when something was accepted.

- **Never accepted:** a finding of level critical, whatever its code, and `CONFIG_INVALID`. Those are repaired.
- An entry that matches no finding of a whole `aw doctor` run is reported as `ACCEPT_UNUSED` (info), as is one
  that matches only a critical finding: remove it, so the list stays what is true today.
- An entry of another shape, a `code` that is no finding code, a missing `path` or an empty `why` is
  `CONFIG_INVALID`; the well-formed entries beside it still hold.
- Accept one place, not a kind: prefer the exact path, and a glob only where the name carries a date or the
  reason holds for the whole folder. Raising a budget (`budgets.*`) is for every file of a kind; `links.planned`,
  `links.notChecked` and `dup.ignore` remain the way to tell those two checks what not to read.

## What the guard does with it

The guard reads a command the way a shell does: quotes, here-documents, PowerShell here-strings and `$(…)` are words,
not commands, so the text of a commit message, an `echo` or a search never trips a rule. A line handed to another
shell (`bash -c "…"`, `powershell -Command "…"`) is read too. Commands that only read or print (`cat`, `grep`, `rg`,
`sed -n`, `echo`, `git log|show|diff|grep`, `git commit` for its message, `gh`, `aw` itself) are skipped by the
resource, run and project rules. A refusal wins over a question, a question over a warning.

**Naming a file is not running it.** The resource and run rules are asked only of commands that can start
something. Besides the readers they skip the commands that only handle the files they name: `git` (`add`, `mv`,
`rm`, `restore`, `stash`, `checkout` and the rest; not `bisect`, `rebase`, `submodule`, `filter-branch`, `difftool`
and `mergetool`, which can run a command), `cp`, `mv`, `rm`, `mkdir`, `touch`, `chmod`, `chown`, `ln`, `tee`, `sed`,
`find` without `-exec`, PowerShell's `Copy-Item`, `Move-Item`, `Remove-Item`, `Rename-Item`, `New-Item`,
`Set-Content`, `Add-Content`, `Out-File`, cmd's `copy`, `move`, `del`, `ren`, and the editors `code`, `vi`, `vim`,
`nano`, `notepad`. So `git add scripts/run-tests.ps1` needs no lock, and `git add tools/render.ps1 a b c d` is not
a run of four items. Set `"matchFileCommands": true` on a resource or a run to have these commands tested too. A
project's own `guard.rules` always read them: a rule may be about `rm`.

**An excuse may belong to one pattern.** Wherever a `match` is a list of regexes (`resources.<name>.match`,
`runs[].match`, `guard.rules[].match`), an entry may be an object instead:

```json
"match": [ { "pattern": "shot-render\\.ps1", "unless": ["(^|\\s)-List\\b"] }, "\\bEditor(\\.exe)?\\b" ],
"unless": ["--version\\b"]
```

`-List` excuses the script and not the editor; the `unless` beside `match` excuses every pattern, as before.
`aw doctor` reports an entry of another shape, and a `pattern` or `unless` that is not a regular expression, as
`CONFIG_INVALID`.

| Rule | When | Answer |
|---|---|---|
| `staging-blanket` | staging the whole tree | `guard.staging.blanket` |
| `staging-owner-files` | a `git add` / `stage` / `commit <paths>` that reaches an owner file: the file, a folder above it, a glob, from another folder (`cd`, `git -C`), an exclusion that does not cover it; or an unreadable pathspec | deny (`unseen` for the unreadable) |
| `owner-file-edit` | Edit / Write / MultiEdit / NotebookEdit of an owner file | `guard.ownerFilesEdit` |
| `generated-file` | Edit / Write of a path in `guard.generated` | deny, with the `how` |
| `default-branch-commit` | `git commit` on one of `defaultBranch.names`. The branch is the one checked out where the commit runs: after a `cd`, `pushd` or `Set-Location` earlier in the command and after `git -C`, so a session in the main checkout that commits in a worktree is judged by the worktree's branch. A folder the guard cannot resolve (a variable, `popd`) gives no finding. | `defaultBranch.commit` |
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
| `match` | Regexes (Python syntax; `(?i)` for any case), or `{ "pattern", "unless" }` objects (above). The rule fires when one matches. Required. |
| `unless` | Regexes that excuse a match of the same command. |
| `scope` | `segment` (default): each command between `;`, `&&`, `\|\|`, `\|` and line breaks, as its words joined by one space. `command`: all segments together, one per line. `file`: the path of an Edit or Write, relative to the top. |
| `skipReaders` | `true` (default): commands that only read or print are not looked at (with their `VAR=value` prefix). `false`: every segment is, so a word in an `echo`, a `curl` body or a commit message counts. |
| `when.branch` | Only on these branches. |
| `message` | What the agent is told: the rule, why, and what to do instead. |

**A rule sees what a command sets in its environment.** Each command is read twice, and a `match` or an `unless`
may hit either reading: the command alone (`npm publish`, so a pattern anchored with `^` keeps working whatever is
set in front), and the command with its environment (`CI=1 npm publish`, `env CI=1 npm publish`). A segment that
only assigns is read too: `export CI=1`, `set CI=1`, and PowerShell's `$env:CI = "1"`, which is also offered as
`CI=1` so one pattern covers every shell. A rule that must refuse clearing a marker variable is therefore plain data:

```json
{ "id": "keep-the-marker", "decision": "deny", "match": ["\\bACME_UNATTENDED="],
  "message": "ACME_UNATTENDED is set by the session scripts and stays set." }
```

It refuses `ACME_UNATTENDED= tool`, `env ACME_UNATTENDED= tool`, `export ACME_UNATTENDED=` and
`$env:ACME_UNATTENDED = ""; tool`. Two limits: a way of unsetting that is a command (`unset X`,
`Remove-Item Env:X`, `env -u X`) is matched as a command, by a pattern for the name; and the variables the guard
reads itself (`guard.agentVar`, its aliases, every `runs[].reasonVar`) are left out, because an agent's name and a
run's reason are prose that may use any word.

## Budgets for expensive runs: `runs`

```json
{ "id": "render", "match": ["render\\.py\\b"], "reasonVar": "AW_RUN", "free": 3, "fullAt": 100,
  "count": { "names": true, "allFlags": ["--all"], "groupFlag": "--group", "matchFlag": "--match",
             "valueFlags": ["--out"], "groupsFile": "tools/groups.json", "itemsDir": "shots" },
  "dryFlags": ["--dry-run", "--list"],
  "message": "Pick the shots that show the change: tools/render.py --list prints a selection." }
```

`match` and an optional `unless` are read as a resource's are (pattern objects, file commands skipped unless
`matchFileCommands`). A command that matches is counted: the plain words after the matched program are items (`names`, commas split),
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
    "editor": { "scope": "project",
                "match": [{ "pattern": "scripts/(run-tests|render)\\.ps1", "unless": ["(^|\\s)-List\\b"] }, "\\bEditor-Cmd\\b"],
                "processes": ["Editor"], "maxMinutes": 30 },
    "gpu-exclusive": { "scope": "machine", "match": ["\\btrain\\.py\\b"] }
  },
  "lockOrder": ["gpu-exclusive", "editor"],
  "counters": { "material-version": { "note": "bumped by every change to a master material" } }
}
```
