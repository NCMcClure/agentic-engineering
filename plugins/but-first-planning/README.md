# But First, Planning

A numbered, file-based **planning + build** workflow for Claude Code, packaged as
installable Skills. Author a language-agnostic specification, sharpen it, decompose
it into an epic/sprint/issue backlog, then build it test-first, everything landing
in a single `.plan/` directory at the root of whatever project you install it into.

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
`.plan/`.

**Spec (`spec-*`, run roughly in order):**

| Skill | What it does |
|-------|--------------|
| `spec-0-init` | Scaffold the `.plan/` workspace (spec docs site, plan tree, glossary, ADRs, tracker config, verifiers) and wire a read-only plan-tree integrity gate into `.claude/settings.json` for sprint builds. |
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

Everything the skills produce lives under `.plan/` in the target project and is
plain markdown: browsable as an MkDocs website, diffable in git, and editable by
agents. The spec's **language posture** is your call at `spec-0-init` and is
recorded as ADR-0001 so every spec skill honours it: language-agnostic
(pseudocode + diagrams) by default, or tied to a language with snippets used
sparingly or liberally. The **UI/UX posture** (ADR-0002) is the same idea for
eyes: headless, dev-dashboard, existing-design-system, or greenfield-product —
it scales the spec's UI/UX content (up to a `prototypes/` playground of static
HTML mockups served by the spec site) and puts `REVIEW` issues in the plan:
human visual-verification gates the build skills never auto-build.

## Releasing

This plugin ships from the [agentic-engineering](https://github.com/NCMcClure/agentic-engineering)
marketplace. Bump the `version` in `.claude-plugin/plugin.json` (the marketplace
entry carries none; plugin.json is authoritative) and follow the repo's
`.claude/rules/dev-rules.md`.

## Changelog

- **3.9.0**: new `build-audit` skill — a post-build gap audit for a finished plan tree. Its bundled workflow (`build-audit-run`, the plugin's tenth) maps every promise the spec makes into a ledger, hunts gaps across eight base dimensions (spec-vs-code, reachability, onboarding/UX, end-user docs, test coverage, benchmarks, drift owner-calls, debt markers) plus an opt-in session-fixtures dimension gated on user-granted transcript access, runs a completeness critic that commissions up to four follow-up finders, semantically dedups, adversarially verifies every merged finding, and synthesizes the survivors into one new plan-tree epic (authored to disk, verify-plan-tree loop, `plan/index.md` row) with scope questions split out as owner decisions. Publishing to the tracker is an opt-in second pass via workflow resume. Everything project-specific arrives through args (`projectBrief`, `knownDebt`, `hardRules`, `commissioned`, `transcriptDirs`, `uiCapture`), so the workflow itself stays project-agnostic; `disable-model-invocation` — it's an expensive fan-out, invoked deliberately.
- **3.8.0**: `build-sprint`'s workflow takes an optional `models` arg — per-stage model overrides (`{build: 'fable', exit: 'fable'}`; stages: load, preflight, draft, build, cleanup, integrate, exit, bookkeep, pr; unlisted stages keep the tier defaults), so a run can pin heavier or cheaper models per stage without editing the script. Also hardened the dispatch loader's schema: the array fields are now typed and guarded (`Array.isArray`), fixing a crash where the loader returned `waves` as a JSON-encoded string and the wave loop fell over downstream.
- **3.7.1**: hub-isolation fix — Python package markers (`__init__.py`/`__init__.pyi`) are now exempt in `verify-agents-tree.py` and CODEBASE-LAYOUT.md; without the exemption a package directory could never legally carry an AGENTS.md hub (found by codebase-optimizer's retrofit smoke test; the two contracts stay in intentional sync).
- **3.7.0**: end-user docs and agent-optimized codebase organization become enforced contracts instead of suggestions. Two new spec-0-init interview questions, recorded as postures: the **user-docs posture** (ADR-0003 — docs-site/MkDocs default, readme-only, existing-convention) and **Claude Code support** (ADR-0004 — AGENTS.md hubs are unconditional; opting in adds a sibling `CLAUDE.md` containing `@AGENTS.md` beside every hub). Every spec now carries two mandatory pages, `user-docs-plan.md` (docs stack + logically paced page map; contract in spec-1-specify's new USER-DOCS-SPEC.md) and `repository-layout.md` (agent-navigable source tree: hub isolation, direct-children-only hub scope, module map back to spec categories; contract in the new CODEBASE-LAYOUT.md) — `verify-spec-tree.py` warns until they exist. The issue-level `**User-facing**:` line goes optional→required (CRITICAL on new `plan-format: 3.7` trees, warning on legacy ones — `verify-plan-tree.py` grows a warnings tier), every plan cuts an early docs-skeleton issue, and `spec-4-edit` propagates docs/hub ripples (`propagate.js` returns `docsRipples`/`agentsRipples`). `spec-0-init` scaffolds the repo-root `AGENTS.md` (the durable agentic-dev rules, merge-don't-clobber for brownfield) and ships a third verifier, `verify-agents-tree.py`, wired into the sprint/epic checkpoint tables, `build-tdd`'s done-when, `build-sprint`'s exit stage, and `build-next-issue`'s report. Builders keep hubs current in the same commit as the change. Removed the stale empty `skills/build-issue/` dir. prototype iteration with agent-visible visual feedback. `spec-1-specify`'s UI-SPEC.md now requires the agent authoring or revising a prototype to **render it to an image and look** (a headless-browser screenshot for HTML; terminal-capture-to-image for a TUI): read the capture back, judge it against the design intent, iterate — a visual change isn't done until it's been looked at, every state the change touches gets a capture, and working captures stay in a tmp dir, never committed. On human sign-off the capture is promoted into the spec as the durable record of what was approved: image(s) under `spec/prototypes/assets/`, a `prototypes/<slug>.md` page embedding them (normal content-file frontmatter), a line in `prototypes/index.md`'s new sign-off section, links from the pages it illustrates — the artifact later `REVIEW` issues compare the built product against. `spec-4-edit` gains the promotion step in its propagation list; `spec-0-init`'s prototypes-index stub carries both artifact kinds.
- **3.5.0**: new `build-user-docs` skill — a per-sprint end-user documentation pass, so the product ships with current README/`docs/` instead of getting one rushed docs pass at the end. It documents only work with a row in the verified-complete ledger (`.plan/progress/completed/`, written only by `build-next-issue`'s independent verification), grounds every command/flag/example by executing it against the built tree, follows the project's existing docs convention, and only restructures files it created (its ledger + managed-files manifest live in `.plan/progress/docs.md`, created lazily). Features whose runnable checkpoints passed but whose REVIEW walkthrough is pending are documented and flagged "ahead of REVIEW sign-off". The docs commit lands on the still-open sprint PR (fallback: standalone commit/PR per git posture). Wired in everywhere: `plan-0-decompose` seeds an optional link-free `**User-facing**:` line per issue (verifier ignores it — no plan-tree schema change), `build-sprint` points at the docs pass after reconcile, `autopilot` runs it per sprint under a new docs posture in the autonomy contract (§4, default on), and `build-next-issue`'s report gains a docs-freshness line.
- **3.4.0**: the spec site grows a live **Plan** page — epics → sprints → issues with statuses, types (AFK/HITL/REVIEW), blocked-by chains, acceptance progress, and the next unblocked issues, rendered from a new read-only `/__plan_status__` endpoint in `comments-server.py` (re-parsed fresh on every poll, so a `plan-status.py` flip shows within 15s). Especially useful in local-tracker mode, where the plan tree is the only issue database and this page is the board. Plain `mkdocs serve` / static builds show a graceful fallback pointing at `spec-open`; workspaces scaffolded before 3.4 backfill via the spec-0-init exception (plan-page stub + `plan-view` assets + current `comments-server.py` + two `mkdocs.yml` lines).
- **3.3.0**: first-class UI/UX awareness, so the human can *visually* verify what gets built. `spec-0-init` asks a fourth interview question — the **UI/UX posture** (headless / dev-dashboard / existing-design-system / greenfield-product), seeded as ADR-0002 and echoed in the spec index; greenfield projects get a `spec/prototypes/` playground (self-contained HTML mockups served verbatim by the spec site, with a skeleton to copy). `spec-1-specify` gains UI-SPEC.md (design-system spec, key screens, the verification-surfaces mapping, wireframe/prototype conventions) and `author-spec.js` takes a `uiPosture` arg. `plan-0-decompose` cuts a third issue type, **`Type: REVIEW`** — a human opens a UI surface and confirms a capability per spec — one per verification boundary, blocked by its implementing slices, with observation-shaped criteria and a manual-walkthrough checkpoint. REVIEW issues flow as human gates everywhere: never auto-built by `build-sprint` under any hitlPolicy (`reviewPending` in its report), listed in dispatch `hitlGates`, verified by `build-next-issue` against the recorded human sign-off, published with a ready-for-review label (GitHub) / `type::REVIEW` (GitLab). New **gate notification**: an optional `**Notify**: @handle` in `tracker.md` makes headless runs post a `Human gate` @mention comment on each deferred HITL/REVIEW issue (idempotent; GitHub/GitLab email mentions — unless the agent runs as the same account, see the tracker stub). `verify-plan-tree.py` now validates the Type value.
- **3.2.0**: Windows/Git-Bash and multi-repo robustness, plus a spec-outline fix. A repo-level `.gitattributes` forces bundled assets to check out LF, so workflow `.js` files no longer arrive CRLF and trip the Workflow approval dialog. `spec-open` now falls back to `python` when `python3` is absent, walks up (or takes a `SPEC_ROOT` override) to find the repo that owns `.plan/`, and fails fast with the pip install line when the docs toolchain is missing instead of waiting out the cold-start timeout. `author-spec.js` detects Windows drive-letter brief paths (`C:\…`, `C:/…`) instead of silently inlining them, and the spec-outline judge now actually receives the three lens proposals in-prompt (previously it got only their count and re-derived from the brief), with lens keys kept aligned when a lens fails. `spec-0-init` decides "already initialised" on a sentinel file so an interrupted hollow scaffold is repaired rather than skipped, and prompts to confirm the target repo in multi-repo workspaces.
- **3.1.0**: the language posture chosen at `spec-0-init` is now actually honoured. It used to be asked and then dropped on the floor. Now it's a three-way choice (agnostic / language-tied-minimal / language-tied-code-forward), recorded as ADR-0001 plus the spec index, and read by every spec-writing skill (`spec-1-specify` and its `author-spec.js` workflow, `spec-2-grill`, `spec-3-architect`). A code-forward project gets a code-forward spec instead of a silently agnostic one. author-spec.js's `language` arg becomes `languagePosture` (bare `language` still accepted).
- **3.0.1**: fixed `build-improve-architecture`'s frontmatter (a colon in the `description` broke YAML parsing, so the skill loaded with no metadata); its trigger description now registers.
- **3.0.0**: split the planning skills by phase and renamed them (breaking — invocation names change): the spec-authoring skills are now `spec-0-init`, `spec-1-specify`, `spec-2-grill`, `spec-3-architect`, `spec-4-edit` (was `plan-6-edit`), plus `spec-open` (was `open-spec`); the backlog skills renumber to `plan-0-decompose` (was `plan-4-plan`) and `plan-1-publish-issues` (was `plan-5-publish-issues`). No behavior changes.
- **2.7.0**: new `spec-open` skill — brings up the spec docs site (reusing a running server) and opens it in the browser in one step.
- **2.6.0**: inline commenting on the spec site — highlight text, leave a note in a right-side rail, and it auto-saves to `.plan/spec-comments.json` (each with a `resolved` flag). Ships `comments-server.py`, a stdlib front door that serves the comment API on the same origin as the pages and reverse-proxies MkDocs behind it, so a single port covers both and it keeps working through a forwarded port (code-server / SSH tunnel). `spec-4-edit` now reads unresolved comments as requested spec edits and flips them resolved once addressed.
- **2.5.3**: README reworded.
- **2.5.2**: halved the always-on description footprint; deduplicated rules restated across skill/reference pairs; drift-file format disclosed to DRIFT-FORMAT.md; HTML report skeleton shipped as an asset; build-sprint workflow now prunes/cleans orphaned worktrees from blocked builders.
- **2.5.1**: moved into the agentic-engineering marketplace; install paths updated. No skill changes.
- **2.5.0**: rubric-driven skill overhaul; autonomous workflow modes for 9 skills; autopilot.

## License

MIT; see [LICENSE](LICENSE).
