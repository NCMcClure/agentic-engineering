# But First, Planning

A numbered, file-based **planning + build** workflow for Claude Code, packaged as
installable Skills. Author a language-agnostic specification, sharpen it, decompose
it into an epic/sprint/issue backlog, then build it test-first, everything landing
in a single `.agents/plan/` workspace in whatever project you install it into.

> The premise: *but first, planning.* Get the spec and the architecture right,
> readable as a website and editable as markdown, before you write the code.

## Install

Two ways. Either gets you the same 16 skills.

### 1. Claude Code plugin (recommended)

Add the marketplace:

```text
/plugin marketplace add NCMcClure/agentic-engineering
```

Then install the plugin:

```text
/plugin install but-first-planning@agentic-engineering
```

Skills become available as `/but-first-planning:spec-0-init`, etc., and update
when you bump the plugin.

### 2. Install script

Copies the skills straight into a project's `.claude/skills/` (or your global one).
Re-running updates them in place.

Install into the current project (`./.claude/skills`):

```bash
curl -fsSL https://raw.githubusercontent.com/NCMcClure/agentic-engineering/main/plugins/but-first-planning/install.sh | bash
```

Install globally for every project (`~/.claude/skills`):

```bash
curl -fsSL https://raw.githubusercontent.com/NCMcClure/agentic-engineering/main/plugins/but-first-planning/install.sh | bash -s -- --global
```

Or, from a clone of the marketplace repo, inside `plugins/but-first-planning/`:

```bash
./install.sh                 # into ./.claude/skills (the current project)
```

```bash
./install.sh /path/to/repo   # into another project's .claude/skills
```

```bash
./install.sh --global        # into ~/.claude/skills (available everywhere)
```

## The workflow

Three prefixes mark the phase: **`spec-*` authors and sharpens the
specification**, **`plan-*` turns it into an executable backlog and publishes
it**, and **`build-*` implements that backlog test-first**. It all lives under
`.agents/plan/`.

**Spec (`spec-*`, run roughly in order):**

| Skill | What it does |
|-------|--------------|
| `spec-0-init` | Scaffold the `.agents/plan/` workspace (spec docs site, plan tree, glossary, ADRs, tracker config, verifiers) and wire a read-only plan-tree integrity gate into `.claude/settings.json` for sprint builds. |
| `spec-1-specify` | Author the specification as a progressive-disclosure, language-agnostic docs website. |
| `spec-2-grill` | Relentlessly grill the spec for clarity; sharpen the glossary and record ADRs. |
| `spec-3-architect` | Pressure-test the *design* before code exists: find deepening opportunities and seams. |
| `spec-4-edit` | Revise the spec or plan later and keep spec ↔ plan ↔ tracker in sync. |

**Plan (`plan-*`):**

| Skill | What it does |
|-------|--------------|
| `plan-0-decompose` | Decompose the spec into an epic → sprint → issue backlog of tracer-bullet slices. |
| `plan-1-publish-issues` | Publish a sprint's issues to the tracker (GitHub by default; GitLab via `glab` supported), dependency-ordered via the bundled publisher script. |

**Autonomous modes:** ten skills bundle
[Claude Code dynamic Workflow scripts](https://code.claude.com/docs) under their
`workflows/` directories; each is that skill's **autonomous mode**, run to
convergence after one up-front approval: `spec-1-specify` (author a spec from a
brief), `spec-2-grill` (grill until a re-review round confirms no
critical/major finding), `spec-3-architect` (deepening hunt, optionally
applying Strong candidates as ADR-backed spec edits), `plan-0-decompose` (build the
whole tree; `decisionPolicy: 'decide'` resolves derivable open questions as
ADRs), `spec-4-edit` (wide blast-radius propagation), `build-next-issue`
(verify every done-claim, emit the dispatch JSON), `build-sprint` (build a
whole sprint AFK: TDD builders, serial re-checkpointed integration, one PR),
`build-assess-drift` (triage + ticket drift), `build-improve-architecture`
(code-side deepening report), and `build-audit` (post-build gap audit
synthesized into a new epic). The interactive prose path stays the default;
each SKILL.md's **Autonomous mode** section says when to offer the workflow,
how to invoke it, and what convergence means. The `autopilot` skill chains
these modes end-to-end (brief → spec → plan → published sprints → built PRs)
behind a single autonomy contract. House conventions (model tiers, schemas,
shared contracts) live in [WORKFLOWS.md](WORKFLOWS.md). Deliberately not
workflows: `spec-0-init` (a short interview), `plan-1-publish-issues`
(deterministic I/O via the bundled `publish-issues.py`), `build-tdd` (the leaf
discipline each builder agent executes), `build-user-docs` (serial grounded
writing — a fan-out would fragment doc coherence), and `build-rubber-duck`
(conversational).

**Build (`build-*`, recurring tools used while implementing):**

| Skill | What it does |
|-------|--------------|
| `build-next-issue` | Reconcile progress and tell you the single next issue to build and, for parallel builds, emit a dispatch plan. |
| `build-sprint` | Run a coordinator that builds a whole sprint from `build-next-issue`'s dispatch plan: fan builder subagents out, integrate, verify, PR. |
| `build-tdd` | Implement a plan issue test-first (its acceptance criteria + spec anchors drive the tests). |
| `build-user-docs` | Write and refresh the product's end-user docs (README, `docs/`) for verified-complete sprint work, every claim grounded by running the built commands. |
| `build-improve-architecture` | Find deepening refactors in built code; feed decisions back into the glossary/ADRs. |
| `build-assess-drift` | Re-assess recorded drift against the live code, plan fixes, and open a tracker issue per surviving item routed to the right skill. |
| `build-audit` | Audit a finished plan tree for what the plan missed — unreachable promises, UX holes, thin tests, absent benchmarks/docs — verify each gap adversarially, and synthesize the survivors into a new epic. |
| `build-rubber-duck` | An ephemeral thinking partner for working through a bug or approach. |
| `autopilot` | Chain every skill's autonomous mode end-to-end (brief → spec → plan → published sprints → built PRs) behind one autonomy contract and one consolidated human touchpoint. |

**Viewing:** `spec-open` serves the spec docs site (reusing a running server if
there is one) and opens it in your browser in one step, so you can read it or
leave inline comments without remembering the serve command. The site also
carries a live **Plan** page — the epic → sprint → issue tree with statuses,
blockers, acceptance progress, and the next unblocked issue, refreshed as
statuses flip. For local-tracker projects (no GitHub/GitLab), that page is the
issue board.

## How it fits together

```
spec-0-init → spec-1-specify ⇄ spec-2-grill ⇄ spec-3-architect
                                   │
                                   ▼
                              plan-0-decompose → plan-1-publish-issues
                                   │
        ┌──────────────────────────┴───────────────┐
        ▼                                           ▼
  build-next-issue  →  build-sprint  →  build-tdd  →  (build-rubber-duck / build-improve-architecture)
        ▲                    (fans builder subagents across  (per issue,
        │                     the dispatch plan's frontier)   test-first)
        └──────────────── spec-4-edit ◄────────────────────────────┘  (revise spec/plan, keep in sync)
```

`autopilot` drives that whole graph hands-off: settle its autonomy contract
once, then it chains each skill's autonomous mode with one consolidated human
touchpoint after planning. After each sprint's independent verification writes
the ledger, `build-user-docs` refreshes the product's end-user docs (README,
`docs/` — not the spec site) onto the still-open sprint PR, so documentation
stays current with what's actually built, sprint by sprint.

Everything the skills produce lives under `.agents/plan/` in the target project and is
plain markdown: browsable as an MkDocs website, diffable in git, and editable by
agents.

```
.agents/plan/
├── README.md  mkdocs.yml  tracker.md
├── spec/        the specification (the docs site), its glossary and ADRs
├── plan/        the plan tree: epics → sprints → issues, and its scripts
└── progress/    verified-complete ledgers, run notes, drift
```

The plan tree is `.agents/plan/plan/`. The doubled name is intended (the
workspace is `plan`, the tree inside it is `plan`): do not flatten it, the
scripts locate themselves by it. `.agents/` is the home of everything
agent-facing in a repo; `./docs` is for end-user documentation only, and
`build-user-docs` is the one skill here that writes to it.

The spec's **language posture** is your call at `spec-0-init` and is
recorded as ADR-0001 so every spec skill honours it: language-agnostic
(pseudocode + diagrams) by default, or tied to a language with snippets used
sparingly or liberally. The **UI/UX posture** (ADR-0002) is the same idea for
eyes: headless, dev-dashboard, existing-design-system, or greenfield-product —
it scales the spec's UI/UX content (up to a `prototypes/` playground of static
HTML mockups served by the spec site) and puts `REVIEW` issues in the plan:
human visual-verification gates the build skills never auto-build.

## With agent-works

The plugin runs alone, and hands four things to the
`agent-works` plugin when that is installed:

- **The AGENTS.md hub check.** This plugin ships no hub verifier. With
  agent-works, `spec-0-init` wires a stub at
  `.agents/plan/plan/verify-agents-tree.py` that calls `aw hubs`; without it
  the hub checkpoint row is omitted and hub structure is not verified.
- **Scarce resources, notes, counters and briefs** in a sprint build go
  through `aw lock run`, `aw sys`, `aw note` and `aw claim`; without it,
  builders take turns.
- **CLAUDE.md siblings** are agent-works' generated twins.
- **Decisions and terms of the built codebase** (not of the spec) live in
  `.agents/decisions/` and `.agents/CONTEXT.md`; out-of-scope work and gates
  owed between agents go to its kanban. The spec's own glossary and ADRs stay
  in `.agents/plan/spec/reference/`, and the plan tree stays the task home.

## Upgrading from 3.x

4.0 moved the workspace from `.plan/` to `.agents/plan/`. In each project that
has a `.plan/`, from the repo root:

```bash
mkdir -p .agents
git mv .plan .agents/plan
```

Then ask for `spec-0-init` (it sees the old layout and runs its migration
section): it re-copies the workspace scripts, which changed, replaces the old
`verify-agents-tree.py`, rewrites the `TaskCompleted` hook path in
`.claude/settings.json` and the `.gitignore` line, fixes `.plan/` paths in
checkpoint rows, and runs the verifiers. Until then the 4.0 scripts refuse a
`.plan/` layout with one line naming this migration.

## Releasing

This plugin ships from the [agentic-engineering](https://github.com/NCMcClure/agentic-engineering)
marketplace. Bump the `version` in `.claude-plugin/plugin.json` (the marketplace
entry carries none; plugin.json is authoritative) and follow the repo's
`.agents/rules/dev-rules.md`.

## License

MIT; see [LICENSE](LICENSE).
