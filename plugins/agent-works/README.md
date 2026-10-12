# agent-works

Agent workflows rot the same way in every repository. `AGENTS.md` grows until nobody reads it, the same rule is
stated in four places that then disagree, task status lives in six, the rules that matter sit in a scratch brief,
and two sessions on one machine wreck each other's measurements without ever knowing the other was there.

**agent-works** gives every kind of fact one home with a size budget, checks all of them with one command, keeps
tasks on a kanban board the owner and the agents share, guards the files and runs that need it, and lets agents
across projects coordinate through one command-line tool.

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

The full table, with what never goes where, is [`core/references/homes.md`](core/references/homes.md). A project
gets its own short copy as `.agents/README.md`, generated and version-stamped.

### The `aw` CLI

One Python program (standard library only) fronts everything: `aw setup`, `aw doctor`, `aw hubs`, `aw twins`,
`aw memory`, `aw decisions`, `aw links`, `aw dup`, `aw kanban`, `aw status`, and the coordination commands below.
It exists so that skills name one command instead of script paths, and so that **one permission rule covers
everything**: every action outside a project's root goes through `aw`, so `Bash(aw:*)` in the allow list is all a
sub-agent in a worktree needs. `aw setup` shows you the rule; adding it is your call.

Claude Code puts an enabled plugin's `bin/` on the PATH of its Bash tool, so `aw` works there as installed. For
PowerShell, hooks and your own terminal, `aw setup --install-launcher [DIR]` writes a small launcher into a folder
on your PATH (default `~/.local/bin`) that finds the installed plugin each time it runs.

`aw doctor` runs every check and exits 0, 1 or 2. Only three findings are critical (source files beside a hub, a
config that does not parse, a status file past three times its budget), so an old repository gets a report
instead of a wall. `aw doctor --baseline` records today's numbers; later runs print what moved.

### Coordination across projects

One store per machine, `~/.agent-works/` (override with `AGENT_WORKS_HOME`), written only by `aw`:

| Command | For |
|---|---|
| `aw sys`, `aw sys --quiet-for timing` | live GPU, CPU, memory and disk beside what agents said they use; is the machine quiet enough to measure? |
| `aw lock run <resource> --for "…" -- <command>` | one at a time: a queue, a time limit, release on failure; per project or machine-wide |
| `aw lease gpu --share 0.5 --mem 12GB -- <command>` | declared shared use, shown to every project |
| `aw note`, `aw notes`, `aw who` | one-line notes between agents; who is running where |
| `aw claim <counter>` | a shared version number, taken once, until its merge lands |
| `aw learn add`, `aw learn search` | lessons about the machine and its tools, readable from any project |

Leases are declarations, not enforcement; `aw sys` prints live readings beside them so a mismatch shows. Details:
[`core/references/coordination.md`](core/references/coordination.md).

### The kanban board

Tasks and their status have one place: cards on the project's board. `/kanban` opens it as a pane (columns, a
Suggested lane for what agents propose, optional sync with GitHub or GitLab issues). Agents reach the same cards
through tools (`surface_task`, `list_tasks`, `move_task`, `owe_gate`, `settle_gate`) or through `aw kanban` from
any shell. A check that could not be run is not forgotten: it becomes a **gate** card that says what it is owed
for and what running it needs, and is settled with its evidence.

### The guard

With `.agents/agent-works.json` present, a hook refuses the mistakes agents repeat: staging the whole tree,
staging or editing files that are the owner's alone, hand edits of generated files, starting a scarce application
without its lock, an expensive run without a stated reason, and whatever else the project adds as data rules.
Without the file both hooks do nothing. `python -B hooks/guard.py --explain '<command>'` says what it would
decide. The config is documented in [`core/references/guard-config.md`](core/references/guard-config.md).

**Boundary with agentic-teamwork.** That plugin owns **team version-control guardrails**: protected branches,
force pushes, secrets, junk files and failing tests, in Claude Code, the terminal and CI. This one owns
**agent-specific guards** (the owner's own files, blanket staging, generated files, scarce-resource locks,
expensive-run budgets) and everything about how agents share a codebase. The two are meant to run together.

### How the other plugins lean on it

Each defers at run time with one sentence and keeps a few lines of fallback, so each still runs alone.

| Plugin | Defers |
|---|---|
| codebase-optimizer | hub verification (`aw hubs`), decision records and the glossary |
| but-first-planning | the hub verifier, scarce resources, notes and briefs; its workspace is `.agents/plan/` |
| perceptual-loop | locks, leases, machine load, and the general half of orchestration |
| agentic-teamwork | nothing; it draws the boundary above |

## Install

```text
/plugin install agent-works@agentic-engineering
```

Requires Python 3.9 or newer and git. Then, in a repository, ask for it ("set this repository up for agent
work") or run the `setup` skill: it plans, asks a handful of questions, applies, and records a baseline.

### Coming from claudeban

The kanban board is the former standalone **claudeban** plugin, moved in and renamed.

- Uninstall the standalone first, and never enable both: two boards would poll and write the same cards.
- Your boards are untouched. Cards stay where they are.
- A board in `.agents/board` is still read; `setup` or `doctor` offers the move to `.agents/kanban`.
- The tool prefix changed from `mcp__claudeban__` to `mcp__agent-works__`: permission allow-list entries for the
  old prefix no longer match and must be added again under the new one.
- The command is `/kanban`.

## Skills

All ten can be started by the model or by you (`/agent-works:<name>`).

| Skill | Use it when |
|---|---|
| `agent-works` | Unsure where something goes or which skill owns it |
| `setup` | A new repository, or one that already has agent files to adopt |
| `doctor` | `AGENTS.md`, memory or status has bloated; rules repeat; agent files sit in `./docs` |
| `hubs` | Adding, moving or renaming a directory; writing or fixing a hub |
| `memory` | Reading before a task; writing a lesson or a measurement; updating status |
| `decisions` | A choice that is hard to reverse, a new term, an agent-facing contract page |
| `kanban-cards` | Out-of-scope work you noticed, a card handed over, a check you cannot run, status |
| `orchestrate` | Several agents on one repository: tasks, briefs, worktrees, reports, the integration pass |
| `coordinate` | A scarce application, a heavy job, a timing run, other sessions on the machine |
| `guard` | The guard refused something, or a mistake must not happen again |

## Layout

| Path | Holds |
|---|---|
| `skills/` | the ten skills (none is named as a command of the mod: `/kanban` is the pane's) |
| `core/references/` | the contracts, each written once: `homes`, `hubs`, `memory`, `decisions`, `coordination`, `guard-config` |
| `assets/templates/` | what `aw setup` and the skills fill: config, root and hub `AGENTS.md`, the contracts page, memory, status, decision, glossary, cards, briefs, the report |
| `cli/` | `aw.py` and one module per command; `cli/coord/` is the machine's store |
| `bin/` | the `aw` launchers |
| `hooks/` | the guard, the session start, and `hooks/kanban/` (the board) |
| `tests/` | the Python tests, below |

### Tests

`python -B -m unittest discover -s tests -t .` from the plugin's folder: standard library only, no network, and
the machine's store is a temporary folder (`AGENT_WORKS_HOME`).

| Covers | Modules |
|---|---|
| the dispatcher and shared helpers | `test_aw`, `test_common` |
| the project checks | `test_hubs`, `test_twins`, `test_memory`, `test_decisions`, `test_links`, `test_dup`, `test_status`, `test_doctor`, `test_setup` |
| the guard | `test_guard`, `test_staging` |
| the machine's store | `test_coord_store`, `test_coord_locks`, `test_coord_leases`, `test_coord_sysinfo`, `test_coord_notes_claims`, `test_coord_learnings`, `test_coord_agents` |
| the board | `test_kanban` in Python; `cards.test.ts` and `kanban.test.ts` beside the mod (typed through `tsconfig.json`). Both sides read the golden cards of `tests/fixtures/cards/`, so a card either writes survives the other; `tests/fixtures/README.md` says what each card pins and how the expected files are regenerated. |

## Changelog

- **0.1.3**: Defects found while migrating a real project. **`/kanban` opens the pane again**: the skill that shared
  the command's name is now `kanban-cards` (`agent-works:kanban-cards`; run `aw setup --apply` to refresh the
  § Agent plugins of your root `AGENTS.md`), and the command says so in a toast when the pane cannot open. The guard: a project rule now sees what a command
  sets in its environment (`X= cmd`, `env X= cmd`, `export X=`, `$env:X = ""`), so "never clear this variable" is
  data; resource locks and run budgets no longer take `git add <script>`, `cp`, `mv` or `rm` for running the
  script (`matchFileCommands` restores the raw reading); a `match` entry may carry its own `unless`
  (`{ "pattern", "unless" }`), checked by `aw doctor`; `default-branch-commit` reads the branch of the checkout
  the commit runs in (`cd <worktree> && git commit`). Decisions: `new` titles a record as the folder's latest are
  (`# ADR 0014: Title`); the lint and the index read Status, Sources and
  Date in the ADR line forms (`- **Status:** accepted`), and a hand-written `README.md` index is kept
  (`DEC_INDEX_HANDWRITTEN`, `aw decisions index --adopt`) as memory's are. `aw doctor` finds briefs and hand-overs
  left in scratch folders, git-ignored ones included (`BRIEF_STRAY`, names in `briefs.stray`). `links.files` adds
  the root README to what `aw links` reads. Memory: `index --adopt` no longer carries a `Parent:` link into the
  root index, and a folder index left with its placeholder line is `MEM_INDEX_PLACEHOLDER`. The limits of
  `aw note` (200) and `aw learn add --topic` (120) are in the help, the reference and the refusal.
- **0.1.2**: The root `AGENTS.md` introduces the project's plugins (agent-works, codebase-optimizer,
  perceptual-loop: what each is for, when to open each skill) in a marked § Agent plugins that `aw setup --apply`
  writes and `aw doctor` checks (`ROOT_PLUGINS`), so sessions and sub-agents are primed at start. The list is
  `plugins` in the config.
- **0.1.1**: The git cadence (branch, commit, push, pull request, merge) no longer waits for approval unless the
  owner asked for it: a commit on the default branch is a warning (`guard.defaultBranch.commit`, was `ask`), and
  `setup`, the common brief and the generated `.agents/README.md` say so.
- **0.1.0**: Initial release: one home per fact under `.agents/` with budgets, `aw doctor` and its checks, hub
  verifier and `CLAUDE.md` twins, generated memory and decision indexes, the kanban board (formerly claudeban)
  with owed gates, the agent guard, and machine-wide locks, leases, notes, claims and shared learnings through
  the `aw` CLI.
