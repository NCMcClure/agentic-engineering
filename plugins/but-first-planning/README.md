# But First, Planning

An agent that starts from a one-line request builds its own guess at what was
meant, and three sessions later nobody can say what "done" was. The fix is
old and unglamorous: get the spec and the architecture right before anybody
writes code, then build from that spec rather than from memory.

This plugin makes that a workflow of files. A specification you read as a
website and edit as markdown, a backlog decomposed out of it, and one
deterministic script that owns every status change, so the plan, the tracker
and the ledgers cannot disagree. All of it lands in `.agents/plan/`.

## How it works

Three prefixes mark the phase. `spec-*` authors and sharpens the
specification, `plan-*` turns it into a published backlog, `build-*`
implements that backlog test-first. `grill` has no prefix because it applies
in any phase.

**Spec.** `spec-init` scaffolds the workspace. `spec-write` authors the spec
as a progressive-disclosure docs site: thin index pages, small single-topic
files, diagrams over prose. `spec-grill` interrogates it one question at a
time until the vocabulary is sharp and the decisions are recorded as ADRs.
`spec-architect` pressure-tests the design itself (shallow modules, leaky
seams) before any code exists. `spec-edit` is how anything changes later: it
follows spec anchors into the plan and the published tickets, so a decision
never changes in one place only.

**Plan.** `plan-decompose` cuts the spec into an epic, sprint, issue tree of
tracer-bullet vertical slices, each with acceptance criteria, a testing
checkpoint, and links back to the spec sections it realises. `plan-publish`
publishes a sprint to GitHub or GitLab, blockers first, and writes each
`#NNN` back into the plan.

**Build.** `build-next-issue` reconciles the plan, the tracker and git,
verifies every done-claim itself, and names the next unblocked issue or a
parallel dispatch plan. `build-tdd` builds that one issue test-first.
`build-sprint` runs a whole sprint through builder subagents, integrated
serially, stopping at human gates. `build-user-docs`, `build-assess-drift`,
`build-improve-architecture` and `build-audit` are the periodic passes, and
`autopilot` chains the lot under one up-front contract.

**One funnel.** Status is never hand-edited. `plan-status.mjs set 01-03-07
done` rewrites the issue file, its sprint and epic tables and fields, and the
plan index in one step, then moves the issue's ticket to match (closes it,
swaps the status label, sets the Project board's Status). `check` exits 0
only when a node is done and every surface agrees. The markdown is written
first, so a tracker that cannot be reached is a warning, never a failure.

## What lands in your repo

```
.agents/plan/
├── spec/        the specification site (MkDocs), glossary and ADRs inside it
├── plan/        the epic, sprint, issue tree, and the scripts that guard it
├── progress/    verified-complete ledgers, per-run notes, the drift registry
├── tracker.md   where issues are published: GitHub, GitLab, or nowhere
└── config.json  optional; see "The plan gate"
```

The scripts are copied into the workspace on purpose: a checkpoint row in a
plan file runs the same command for a teammate, a CI job, and an agent, with
or without this plugin. They need Node 22 and nothing else.

| Script | Lands at | Does |
| --- | --- | --- |
| `plan-status.mjs` | `plan/` | the funnel: `set` one issue's status (`--evidence` writes the verified ledger, `--cancelled` drops an issue) and roll it up; `check` a node |
| `publish-issues.mjs` | `plan/` | `publish` a sprint, `sync` a changed issue's ticket, `status` to read every ticket back |
| `verify-plan-tree.mjs` | `plan/` | plan-tree structure, required fields, blocked-by links, spec anchors |
| `tracker.mjs`, `provider.mjs` | `plan/` | what the two above speak GitHub (`gh`) and GitLab (`glab`) through |
| `verify-spec-tree.mjs` | `spec/scripts/` | spec frontmatter, index pages, `relates-to` links |
| `drift-status.mjs` | `progress/` | a read-only index of the drift registry |
| `comments-server.py` | `spec/scripts/` | fronts MkDocs and serves inline comments and the live Plan page on one port |

`comments-server.py` is the one Python file: the spec site is MkDocs, which is
Python already. Reading the site needs
`pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin`; nothing else
in the workflow does.

When the plugin updates a script, a session start says which of your copies
are behind and gives the one command that refreshes them
(`scaffold.mjs --refresh`).

## The tracker

`tracker.md` names one of three:

- **GitHub**: one issue per plan issue, labelled by type with your repo's
  triage labels (`ready-for-agent`, `ready-for-human`, a review label).
  `done` closes it, anything else reopens it, and a Project board named in
  `tracker.md` has its Status kept in step.
- **GitLab** (gitlab.com or self-hosted, group or personal namespace): epics
  are `epic::` scoped labels, sprints are milestones, types are `type::`
  labels, and `status::in-progress` / `status::blocked` follow the plan.
- **Local markdown**: nothing is published, and the spec site's Plan page is
  the board.

Both forges go through the `gh` and `glab` you are already signed in to. No
token is read and no host is assumed.

## The plan gate

The plugin ships a `TaskCompleted` hook that refuses to mark a task done while
the plan tree is critically broken (a hand-edited status that disagrees with
its parents, a dead link, an orphaned spec anchor). It is off by default. A
repo turns it on with one key in `.agents/plan/config.json`:

```json
{ "taskGate": true }
```

## Where it speaks

Two lines reach the agent, and only where the repo has opted in to the
agentic-engineering plugins (it carries `.agents/plan/` or another plugin's
marker, or you answered the one-time question a session asks): grill what is
not fully specified before planning it or handing it off, and, in a repo with
`.agents/plan/`, change a decision through `spec-edit` and build an issue from
its acceptance criteria as failing tests. Answer `off` and it says nothing.

The skills work in any repo.

## Install

```text
/plugin marketplace add NCMcClure/agentic-engineering
/plugin install but-first-planning@agentic-engineering
```

Skills are then `/but-first-planning:spec-init` and so on.

Without the plugin system, `install.mjs` copies the skills into a project's
`.claude/skills/` (or `--global` into `~/.claude/skills/`), where they are
invoked without the prefix. The hooks do not come along.

```bash
node install.mjs                 # from a clone, inside plugins/but-first-planning/
node install.mjs /path/to/repo
node install.mjs --global
curl -fsSL https://raw.githubusercontent.com/NCMcClure/agentic-engineering/main/plugins/but-first-planning/install.mjs | node --input-type=module -
```

## Coming from 4.x

Nothing to do by hand first. The next session start moves an older workspace
to the current layout and tells the agent what it moved:

- a `.plan/` folder from before 4.0 becomes `.agents/plan/`;
- the Python scripts are parked under `.agents/retired/but-first-planning/`
  and the Node ones are written where they were;
- a repo whose `.claude/settings.json` ran `plan-gate.py` gets
  `"taskGate": true`, so the gate stays on.

It never overwrites a file and never edits one of yours. Checkpoint rows that
still say `python ... .py`, a `.gitignore` line, and the old settings entry
are listed for you (or the agent) to change. Issue files keep their
`**GitHub**:` field: the scripts read it as `**Tracker**:`.

| 4.x | 5.0 |
| --- | --- |
| `spec-0-init` | `spec-init` |
| `spec-1-specify` | `spec-write` |
| `spec-2-grill` | `spec-grill` |
| `spec-3-architect` | `spec-architect` |
| `spec-4-edit` | `spec-edit` |
| `plan-0-decompose` | `plan-decompose` |
| `plan-1-publish-issues` | `plan-publish` |
| `python .../plan-status.py` | `node .../plan-status.mjs` |
| `python .../publish-issues.py` | `node .../publish-issues.mjs` |
| `python .../verify-plan-tree.py` | `node .../verify-plan-tree.mjs` |
| `python .../verify-spec-tree.py` | `node .../verify-spec-tree.mjs` |
| `python .../drift-status.py` | `node .../drift-status.mjs` |
| `plan-gate.py` in `.claude/settings.json` | the plugin's hook, with `"taskGate": true` |
| `spec-open.sh`, `install.sh` | `spec-open.mjs`, `install.mjs` |

## Skills

| Skill | Invocation | Does |
| --- | --- | --- |
| `grill` | model-invoked | The alignment interview: one question at a time, each with a recommended answer, until intent, done criteria, scope and risks are agreed. Reflect mode after a round of work. |
| `spec-init` | `/but-first-planning:spec-init` | Scaffolds `.agents/plan/`; `--refresh` updates a workspace's scripts. Once per project. |
| `spec-write` | model-invoked | Authors or extends the spec site. |
| `spec-grill` | model-invoked | Interrogates the spec for gaps, contradictions and unstated decisions; sharpens the glossary, records ADRs. |
| `spec-architect` | model-invoked | Pressure-tests the design before code exists; candidates as an HTML report. |
| `spec-edit` | model-invoked | Changes a spec or plan and keeps the plan and the published tickets in step. |
| `spec-open` | `/but-first-planning:spec-open` | Serves the spec site with inline comments and the live Plan page. |
| `plan-decompose` | model-invoked | Spec to an epic, sprint, issue tree of vertical slices. |
| `plan-publish` | model-invoked | Publishes a sprint to GitHub or GitLab and writes the refs back. |
| `build-next-issue` | model-invoked | Reconciles and verifies; names the next issue or a dispatch plan. Builds nothing. |
| `build-tdd` | model-invoked | Builds one plan issue test-first. Uses agentic-teamwork's `tdd` loop when that plugin is installed, its own short one when not. |
| `build-sprint` | model-invoked | Builds a sprint with builder subagents, one pull or merge request. |
| `build-user-docs` | model-invoked | Coherence pass over the end-user docs for verified work. Finishes with docs-parity's checker when that plugin is installed. |
| `build-assess-drift` | model-invoked | Triages recorded drift against the live code and tickets the survivors. |
| `build-improve-architecture` | model-invoked | Finds deepening refactors in built code. |
| `build-rubber-duck` | model-invoked | Talks a stuck problem through, changing nothing. |
| `build-audit` | `/but-first-planning:build-audit` | Audits a finished plan tree for what the plan missed; the gaps become a new epic. |
| `autopilot` | `/but-first-planning:autopilot` | Chains every phase hands-off under one contract with one human gate. |

Ten skills bundle a Claude Code Workflow script as their autonomous mode;
[WORKFLOWS.md](WORKFLOWS.md) is the contract those scripts share, and
[references/subagent-fallback.md](references/subagent-fallback.md) is how the
same phases run where a session has no `Workflow()` tool.
