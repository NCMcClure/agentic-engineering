# agent-works

Agent workflows rot the same way in every repository. `AGENTS.md` grows until nobody reads it, the same rule is
stated in four places that then disagree, task status lives in six, the rules that matter sit in a scratch brief,
a round of parallel work lives in one conversation and dies with it, and two sessions on one machine wreck each
other's measurements without ever knowing the other was there.

**agent-works** gives every kind of fact one home with a size budget, checks all of them with one command, keeps
tasks on a kanban board the person and the agents share, runs a large goal from that board as child sessions in
their own worktrees, guards the files and runs that need it, and lets agents across projects coordinate through
one command-line tool.

It was distilled from a project whose root `AGENTS.md` had reached 494 lines and whose status file 2,446. Every
budget and every check here is the lesson of something that went wrong there.

## How it works

### One home per kind of fact

Everything agent-facing lives under `.agents/`, beside the root `AGENTS.md` and its hubs. `./docs` is for the
people who use the project; agent-works never writes there and flags agent material it finds in it.

| Fact | Home | Budget |
|---|---|---|
| What is where | root `AGENTS.md`, a hub `AGENTS.md` per non-leaf code directory | 200 / 40 lines |
| Project rules | root `AGENTS.md`, five lines each, linking to the why | inside the 200 |
| Why, measurements, lessons | `.agents/memory/<folder>/<date>-<slug>.md`, indexes generated (hand-written ones are kept until adopted) | 400 lines, 12 a folder |
| Status | one status memory: goal, current focus, known issues as card links | 120 lines |
| What is done | the git log and closed cards, printed by `aw status` | derived |
| Decisions, words, contracts | `.agents/decisions/`, `.agents/CONTEXT.md`, `.agents/contracts/` | 150 lines a record |
| Tasks, and checks still owed | kanban cards in `.agents/kanban/`, shared by every worktree | |
| Briefs for a round of agents | `.agents/briefs/`, tracked | 120 / 80 lines |
| Reports | the final message or the pull request; never a file | |

The full table, with what never goes where, is [`references/homes.md`](references/homes.md). A project gets its
own short copy as `.agents/README.md`, generated and version-stamped.

### The `aw` command line

One Node program (standard library only) fronts everything: `aw setup`, `aw doctor`, `aw hubs`, `aw twins`,
`aw memory`, `aw decisions`, `aw links`, `aw dup`, `aw board`, `aw status`, and the coordination commands below.
Skills and hooks call it by its path, `node "${CLAUDE_PLUGIN_ROOT}/scripts/aw.mjs" <command>`, so nothing depends
on a PATH. Claude Code also puts an enabled plugin's `bin/` on the PATH of its Bash tool, and
`aw setup --install-launcher [DIR]` writes a launcher into a folder on yours, so plain `aw` works in a terminal;
there one permission rule, `Bash(aw:*)`, covers everything an agent does outside the repository.

`aw doctor` runs every check and exits 0, 1 or 2. Only three findings are critical (source files beside a hub, a
config that does not parse, a status file past three times its budget), so an old repository gets a report
instead of a wall. `aw doctor --baseline` records today's numbers; later runs print what moved.
`aw doctor --machine` checks the machine instead: Node 22, git, and the forge's command line.

### The kanban board

Tasks and their status have one place: cards on the project's board, Markdown files in the main checkout that
every worktree shares. `/kanban` opens it as a pane (columns, a Suggested lane for what agents propose). Agents
reach the same cards through six tools (`surface_task`, `list_tasks`, `move_task`, `plan_task`, `owe_gate`,
`settle_gate`) or through `aw board` from any shell; the pane and the tools write every change through that
command, so one set of rules holds. A check that could not be run is not forgotten: it becomes a **gate** card
that says what it is owed for and what running it needs, and it closes only by being settled with its evidence.

- **Sprints** time-box the work: while one is active, the board shows its cards and nothing else. **Epics** hold
  a goal larger than one session; an agent handed an epic slices it into cards instead of building it.
- **Plan issues** written by but-first-planning under `.agents/plan/` show on the board as read-only cards.
- **Remote sync** (`aw board remote on`, then `aw board remote sync`, or `/kanban sync on`) keeps cards in step
  with GitHub (`gh`) or GitLab (`glab`) issues: a card is an issue, its column a project-board status or a
  `status:` label, a sprint a milestone, an epic the parent of its cards' issues.
- The board is working state: its folder is kept out of git through the repository's own `info/exclude`. A
  repository that shares its board through git says `"kanban": { "tracked": true }`.

### A goal bigger than one change

`/agent-works:orchestrate` makes the session an orchestrator, and the board the record of the round, so a restart
or a compaction loses nothing.

1. It puts the tasks on the board as cards, each with done criteria a stranger could check.
2. `aw board propose` picks the ready cards that can run side by side: their files do not overlap, neither waits
   on the other, they share no long-held lock.
3. You say yes, and `aw board grant` records that approval on each card with the one branch it covers.
4. `dispatch` starts each card as a child session in its own git worktree, with a generated brief. Where the host
   cannot start sessions you get a `claude -w` command to run; where there is no terminal either, the cards are
   worked one at a time.
5. Each child (`work-card`) builds test-first, opens its pull or merge request, moves its card to review, and
   reports with a one-line `CARD` summary.
6. `review-card` checks the diff against the criteria, sends findings back, lands it on green, closes the card,
   and tells the other children the base moved. What a child could not check becomes a gate.

Two hooks keep the board true. At session start the briefing prints the board in one line, or, in a worktree a
card names, which card this session is working and what done means. After a tool call, and at a stop, the
card-sync hook tells the model when a card is behind the work (a request opened owes review, a merge owes done)
and asks about cards the session worked on; `sync-cards` sweeps what no hook could see.

### Coordination across projects

One store per machine, `~/.agent-works/` (override with `AW_HOME`), written only by `aw`:

| Command | For |
|---|---|
| `aw sys`, `aw sys --quiet-for timing` | live GPU, CPU, memory and disk beside what agents said they use; is the machine quiet enough to measure? |
| `aw lock run <resource> --for "…" -- <command>` | one at a time: a queue, a time limit, release on failure; per project or machine-wide |
| `aw lease gpu --share 0.5 --mem 12GB -- <command>` | declared shared use, shown to every project |
| `aw note`, `aw notes`, `aw who` | one-line notes between agents; who is running where |
| `aw claim <counter>` | a shared version number, taken once, until its merge lands |
| `aw learn add`, `aw learn search` | lessons about the machine and its tools, readable from any project |

The command after `--` runs as a program with its arguments, never through a shell; a line that needs one is
`-- bash -c "make && make test"`. Leases are declarations, not enforcement; `aw sys` prints live readings beside
them so a mismatch shows. Details: [`references/coordination.md`](references/coordination.md).

### The guard

A hook reads each shell command and each edit before it runs. With a config file in the project
(`.agents/agent-works.json`) it stops the mistakes agents make more than once: staging the whole tree or the
owner's own files, hand-editing a generated file, an expensive run without a stated reason, and whatever else the
project adds as data rules. A command that starts a scarce resource outside its lock gets a warning, or a refusal
where the config says `"guard": { "locks": "deny" }`; the command inside `aw lock run ... --` and
`aw lease ... --` is judged too. A linked worktree with no copy of the config is judged by the main checkout's.
Without the file the guard does nothing.

`node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs" --explain '<command>' [--cwd DIR] [--tool T] [--file PATH] [--json]`
says what it would decide and how it read the command. Every key is documented in
[`references/guard-config.md`](references/guard-config.md); patterns are JavaScript regular expressions.

**Boundary with agentic-teamwork.** That plugin owns team version-control guardrails: protected branches, force
pushes, secrets, junk files and failing tests, in Claude Code, the terminal and CI. This one owns agent-specific
guards and everything about how agents share a codebase. The two are meant to run together; where both judge one
command (a force push is asked about here and denied there), the stronger answer wins.

### What a session is told

Seven lines, at session start, after every compaction, and (the ones for every agent) in subagents: a goal bigger
than one change goes to `orchestrate`; the board is the record; nothing starts without a yes or merges without a
review; never poll; out-of-scope work goes on the board and an unrun check is owed; scarce things run under a
lock; and, in a repository set up for agent work, the hub rules. They print where a repository carries a plugin's
marker or the person said to use the plugins, and nowhere else.

## Install

```text
/plugin install agent-works@agentic-engineering
```

Requires Node 22 or newer and git. Then, in a repository, run `/agent-works:setup`: it plans, asks a handful of
questions, applies, and records a baseline. The board and the locks work without it.

## Skills

Fifteen. The model starts all but `setup`, which is yours to run (`/agent-works:setup`).

| Skill | Use it when |
|---|---|
| `agent-works` | Unsure where something goes or which skill owns it |
| `setup` | A new repository, or one that already has agent files to adopt |
| `doctor` | `AGENTS.md`, memory or status has bloated; rules repeat; agent files sit in `./docs`; the machine lacks a prerequisite |
| `hubs` | Adding, moving or renaming a directory; writing or fixing a hub |
| `memory` | Reading before a task; writing a lesson or a measurement; updating status |
| `decisions` | A choice that is hard to reverse, a new term, an agent-facing contract page |
| `board` | Out-of-scope work you noticed, what is ready, moving or planning a card, a check you cannot run, settling one |
| `orchestrate` | Several tasks, a backlog or a sprint to work in parallel; briefs for a round; resuming a round |
| `dispatch` | A card should start: after your yes, the next ready card, or the pane's Start |
| `work-card` | This session was started to work one card |
| `review-card` | A child reported its card in review |
| `sync-cards` | The board may have drifted from the work |
| `resource-locks` | Before anything only one session on the machine can use at a time |
| `coordinate` | A heavy job, a timing run, other sessions on the machine, a shared counter, a lesson for every project |
| `guard` | The guard refused or questioned something, or a mistake must not happen again |

## Coming from 0.x

1.0 runs on **Node 22 and nothing else**: Python is no longer needed, and nothing is built. Every `aw` command
is still there with the same arguments, and the machine's store keeps its formats, so two versions on one
machine during an update do not corrupt it.

**What the session hook does for a repository that already has `.agents/agent-works.json`**, once, and silently
after that:

- writes `.agents/retired/agent-works/config-additions.json` with the keys that keep three changed defaults as
  they were, and asks the agent to merge them into the config and delete the file (it never rewrites your
  config; a reminder stands at session start until they are merged):
  - `"claude": { "twins": "generated" }`, where the config named no form;
  - `"guard": { "locks": "deny" }`, where the config did not say;
  - `"kanban": { "tracked": true }`, where git holds the board's folder;
- moves a board still in `.agents/board` to `.agents/kanban` (or the folder `paths.kanban` names), from a
  session in the main checkout.

**What changed:**

| Was | Is |
|---|---|
| Python 3.9 and a TypeScript pane | Node 22, `.mjs` only |
| `aw kanban` | `aw board` (`aw kanban` still answers, for this major version) |
| the board folder committed by default | untracked by default (`kanban.tracked: true` shares it through git); a board with committed files stays tracked |
| a gate could be moved to done | a gate closes only with `aw board settle <id> --evidence "..."` |
| `aw lock run ... -- "a shell line"` passed the string to a shell | the words after `--` are a program and its arguments; a shell line is `-- bash -c "..."`. The same for `aw lease` |
| `CLAUDE.md` twins: git-ignored generated files by default | a tracked symlink to `AGENTS.md` by default (`claude.twins: "link"`; the one-line file on Windows) |
| `aw hubs` counted a child as named however the hub mentioned it | in a git repository a child is named only by a bullet that opens with its path in a code span, and the `verify-hubs` marker line is read too |
| config patterns were Python regular expressions | JavaScript regular expressions (`guard.rules`, `guard.generated`, `resources.<name>.match`, `runs`, `dup.ignore`): inline flags like `(?i)`, named groups written `(?P<n>…)` and atomic groups need rewriting; `aw doctor` reports a pattern that does not compile as `CONFIG_INVALID` |
| the guard refused a resource's command run outside its lock | it warns, and only when another agent holds the lock; `guard.locks: "deny"` refuses as before |
| the guard did not look inside `aw lock run ... --` | the wrapped command is judged like any other, also under `aw lease` |
| a linked worktree without the config was unguarded | it is judged by the main checkout's config |
| the pane wrote cards and synced issues itself | the pane writes through `aw board`; remote sync is `aw board remote on\|off\|sync`, which the pane runs on its timer |
| `python -B hooks/guard.py --explain` | `node "${CLAUDE_PLUGIN_ROOT}/hooks/guard.mjs" --explain` |
| no machine check | `aw doctor --machine` |
| cards said `## Done looks like` | new cards say `## Done when`; the old heading is still read |
| the plugin options `kanbanDir` and `startMode` | `paths.kanban` in the config, and `aw board config --start-mode` (or the pane's own switch) |
| ten skills, `kanban-cards` among them | fifteen: `kanban-cards` is `board`; new are `dispatch`, `work-card`, `review-card`, `sync-cards`, `resource-locks`; `setup` is started by you, not by the model |
| the session hook healed twins and registered the session | it also migrates, prints the board line or the card a worktree is working, and delivers the critical lines; a card-sync hook runs after tool calls and at stops |
| a board without a config was briefed on nowhere, and nothing could switch the hooks off | a repository with a board and no config hears the board line and card-sync once you answer the marketplace's one question with `on`; answered `off`, or not yet answered, those two hooks say nothing |

The board came from the standalone **claudeban** plugin in 0.2: never enable both, and permission entries for its
tools use the prefix `mcp__agent-works__`.

## Layout

| Path | Holds |
|---|---|
| `skills/` | the fifteen skills; `skills/orchestrate/references/subagent-fallback.md` is what the multi-agent ones do on a host without sessions, subagents or the Workflow tool |
| `references/` | the contracts, each written once: `homes`, `hubs`, `memory`, `decisions`, `coordination`, `guard-config` |
| `assets/templates/` | what `aw setup` and the skills fill: config, root and hub `AGENTS.md`, the contracts page, memory, status, decision, glossary, cards, briefs, the report |
| `scripts/` | `aw.mjs` and one module per command; `scripts/coord/` is the machine's store |
| `lib/` | the rules as functions: config, cards, the board, the loop, card sync, the guard's rules |
| `bin/` | the `aw` launchers |
| `hooks/` | the session hook, the guard, card-sync, the critical lines, and `hooks/kanban/` (the pane) |

Its tests are the `agent-works-*` suites and hook cases of the marketplace's own lanes (`npm test` at the root).
