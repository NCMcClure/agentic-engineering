# But First, Planning

A numbered, file-based **planning + build** workflow for Claude Code, packaged as
installable Skills. Author a language-agnostic specification, sharpen it, decompose
it into an epic/sprint/issue backlog, then build it test-first, everything landing
in a single `.plan/` directory at the root of whatever project you install it into.

> The premise: *but first, planning.* Get the spec and the architecture right,
> readable as a website and editable as markdown, before you write the code.

## Install

Two ways. Either gets you the same 14 skills.

### 1. Claude Code plugin (recommended)

Add the marketplace:

```text
/plugin marketplace add NCMcClure/agentic-engineering
```

Then install the plugin:

```text
/plugin install but-first-planning@agentic-engineering
```

Skills become available as `/but-first-planning:plan-0-init`, etc., and update
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

One naming rule: **`plan-*` maintains the planning artifacts under `.plan/`**
(which is why `plan-6-edit` keeps its prefix even though you run it during the
build), **`build-*` operates on and around code during implementation**.

**Planning (`plan-*`, run roughly in order):**

| Skill | What it does |
|-------|--------------|
| `plan-0-init` | Scaffold the `.plan/` workspace (spec docs site, plan tree, glossary, ADRs, tracker config, verifiers) and wire a read-only plan-tree integrity gate into `.claude/settings.json` for sprint builds. |
| `plan-1-specify` | Author the specification as a progressive-disclosure, language-agnostic docs website. |
| `plan-2-grill-spec` | Relentlessly grill the spec for clarity; sharpen the glossary and record ADRs. |
| `plan-3-architect-spec` | Pressure-test the *design* before code exists: find deepening opportunities and seams. |
| `plan-4-plan` | Decompose the spec into an epic → sprint → issue backlog of tracer-bullet slices. |
| `plan-5-publish-issues` | Publish a sprint's issues to the tracker (GitHub by default; GitLab via `glab` supported), dependency-ordered via the bundled publisher script. |
| `plan-6-edit` | Modify the spec or plan later and keep spec ↔ plan ↔ tracker in sync. |
| `build-next-issue` | Reconcile progress and tell you the single next issue to build and, for parallel builds, emit a dispatch plan. |
| `build-sprint` | Run a coordinator that builds a whole sprint from `build-next-issue`'s dispatch plan: fan builder subagents out, integrate, verify, PR. |

**Autonomous modes:** nine skills bundle
[Claude Code dynamic Workflow scripts](https://code.claude.com/docs) under their
`workflows/` directories; each is that skill's **autonomous mode**, run to
convergence after one up-front approval: `plan-1-specify` (author a spec from a
brief), `plan-2-grill-spec` (grill until a re-review round confirms no
critical/major finding), `plan-3-architect-spec` (deepening hunt, optionally
applying Strong candidates as ADR-backed spec edits), `plan-4-plan` (build the
whole tree; `decisionPolicy: 'decide'` resolves derivable open questions as
ADRs), `plan-6-edit` (wide blast-radius propagation), `build-next-issue`
(verify every done-claim, emit the dispatch JSON), `build-sprint` (build a
whole sprint AFK: TDD builders, serial re-checkpointed integration, one PR),
`build-assess-drift` (triage + ticket drift), and `build-improve-architecture`
(code-side deepening report). The interactive prose path stays the default;
each SKILL.md's **Autonomous mode** section says when to offer the workflow,
how to invoke it, and what convergence means. The `autopilot` skill chains
these modes end-to-end (brief → spec → plan → published sprints → built PRs)
behind a single autonomy contract. House conventions (model tiers, schemas,
shared contracts) live in [WORKFLOWS.md](WORKFLOWS.md). Deliberately not
workflows: `plan-0-init` (a short interview), `plan-5-publish-issues`
(deterministic I/O via the bundled `publish-issues.py`), `build-tdd` (the leaf
discipline each builder agent executes), and `build-rubber-duck`
(conversational).

**Build (`build-*`, recurring tools used while implementing):**

| Skill | What it does |
|-------|--------------|
| `build-tdd` | Implement a plan issue test-first (its acceptance criteria + spec anchors drive the tests). |
| `build-improve-architecture` | Find deepening refactors in built code; feed decisions back into the glossary/ADRs. |
| `build-assess-drift` | Re-assess recorded drift against the live code, plan fixes, and open a tracker issue per surviving item routed to the right skill. |
| `build-rubber-duck` | An ephemeral thinking partner for working through a bug or approach. |
| `autopilot` | Chain every skill's autonomous mode end-to-end (brief → spec → plan → published sprints → built PRs) behind one autonomy contract and one consolidated human touchpoint. |

## How it fits together

```
plan-0-init → plan-1-specify ⇄ plan-2-grill-spec ⇄ plan-3-architect-spec
                                   │
                                   ▼
                              plan-4-plan → plan-5-publish-issues
                                   │
        ┌──────────────────────────┴───────────────┐
        ▼                                           ▼
  build-next-issue  →  build-sprint  →  build-tdd  →  (build-rubber-duck / build-improve-architecture)
        ▲                    (fans builder subagents across  (per issue,
        │                     the dispatch plan's frontier)   test-first)
        └──────────────── plan-6-edit ◄────────────────────────────┘  (revise spec/plan, keep in sync)
```

`autopilot` drives that whole graph hands-off: settle its autonomy contract
once, then it chains each skill's autonomous mode with one consolidated human
touchpoint after planning.

Everything the skills produce lives under `.plan/` in the target project and is
plain markdown: browsable as an MkDocs website, diffable in git, and editable by
agents. The spec stays language-agnostic (pseudocode + diagrams) unless you opt
into a language at `plan-0-init`.

## Releasing

This plugin ships from the [agentic-engineering](https://github.com/NCMcClure/agentic-engineering)
marketplace. Bump the `version` in `.claude-plugin/plugin.json` (the marketplace
entry carries none; plugin.json is authoritative) and follow the repo's
`.claude/rules/dev-rules.md`.

## Changelog

- **2.6.0**: inline commenting on the spec site — highlight text, leave a note in a right-side rail, and it auto-saves to `.plan/spec-comments.json` (each with a `resolved` flag). Ships `comments-server.py`, a stdlib front door that serves the comment API on the same origin as the pages and reverse-proxies MkDocs behind it, so a single port covers both and it keeps working through a forwarded port (code-server / SSH tunnel). `plan-6-edit` now reads unresolved comments as requested spec edits and flips them resolved once addressed.
- **2.5.3**: README reworded.
- **2.5.2**: halved the always-on description footprint; deduplicated rules restated across skill/reference pairs; drift-file format disclosed to DRIFT-FORMAT.md; HTML report skeleton shipped as an asset; build-sprint workflow now prunes/cleans orphaned worktrees from blocked builders.
- **2.5.1**: moved into the agentic-engineering marketplace; install paths updated. No skill changes.
- **2.5.0**: rubric-driven skill overhaul; autonomous workflow modes for 9 skills; autopilot.

## License

MIT; see [LICENSE](LICENSE).
