---
name: plan-0-init
description: Scaffold the .plan/ planning workspace — spec site, plan tree, glossary, ADRs, tracker. Run once, when the user wants to plan or spec a project and .plan/ doesn't exist — "set up planning".
---

# plan-0-init — scaffold the `.plan/` workspace

This is the foundation the rest of the suite builds on. It creates `.plan/` at
the repo root: a spec docs website (`spec/`), an empty plan tree (`plan/`), a
glossary and ADR folder, a tracker config, a `progress/` directory, the
deterministic status funnel (`plan/plan-status.py`), and the two structural
verifiers. After this runs, the user authors the spec with
`plan-1-specify`, sharpens it with `plan-2-grill-spec` / `plan-3-architect-spec`, decomposes
it with `plan-4-plan`, publishes with `plan-5-publish-issues`, and tracks with
`build-next-issue`.

The whole workspace is plain markdown so it stays human-readable on disk,
browsable as a website, and trivially editable by agents — that duality is the
point. Keep it language-agnostic: the spec describes systems, not code.

## When NOT to scaffold

If `.plan/` already exists, do **not** overwrite it. Tell the user it's already
initialised and point them at `plan-1-specify` (to author) or `plan-6-edit` (to
revise). Two narrow exceptions where a re-run touches only one thing: reconfiguring
the tracker (touch only `tracker.md`), and backfilling a helper script into an
older `.plan/` project that predates it — copy `plan-gate.py` (and add the hooks per
step 2a) or `drift-status.py` into place. These are idempotent, so they're safe if
the file is already there.

## Process

### 1. Interview (briefly)

Ask only what you can't infer. Keep it to a few questions, one at a time:

- **Project name + one-line description** — for the site title and spec index. Infer a sensible default from the repo if you can, and just confirm.
- **Issue tracker** — default **GitHub** (the `gh` CLI + an optional GitHub Project board). Alternatives: **GitLab** (the `glab` CLI — epics as scoped labels, sprints as milestones; works on self-hosted instances and personal namespaces), another tracker, or **local-markdown only** (the plan tree is the only source of truth). If GitHub with a project board, ask for the board URL / owner / number; if GitLab, ask for the project path, numeric project ID, and host. Missing values can stay as placeholders to fill in before first publish.
- **Target language** — default **language-agnostic** (pseudocode + diagrams). Only if the user insists on a specific language do you record it; even then, the spec stays mostly neutral and uses that language only where a concrete snippet genuinely encodes a decision.

Record the language choice and tracker choice in the scaffold so later skills honour them.

### 2. Copy the scaffold into place

Create the tree below by copying this skill's bundled `assets/` and filling the
`{{PLACEHOLDER}}` tokens. Resolve the bundle path relative to this SKILL.md
(`assets/...`). **Substitute every `{{...}}` token** — especially `{{MONTH}}`
(use the current year-month, `YYYY-MM`), or the spec verifier will reject the
glossary.

```
.plan/
├── README.md                 # from stubs/README.md
├── mkdocs.yml                # from assets/mkdocs.yml  ({{PROJECT_NAME}})
├── tracker.md                # from stubs/tracker-github.md, tracker-gitlab.md, OR tracker-local.md
├── progress/
│   ├── index.md              # from stubs/progress-index.md
│   ├── drift-status.py       # from assets/drift-status.py (verbatim)
│   ├── completed/            # empty (epic ledgers appear as work completes)
│   │   └── .gitkeep
│   ├── notes/                # empty (one file per sprint-build-run)
│   │   └── .gitkeep
│   └── drift/                # empty (one file per cross-cutting item: drift-<slug>.md)
│       └── .gitkeep
├── spec/
│   ├── index.md              # from stubs/spec-index.md
│   ├── reference/
│   │   ├── index.md          # from stubs/reference-index.md
│   │   ├── glossary.md       # from stubs/glossary.md  (fill {{MONTH}}!)
│   │   └── adr/
│   │       └── index.md      # from stubs/adr-index.md
│   ├── assets/
│   │   ├── gruvbox.css        # from assets/gruvbox.css (verbatim)
│   │   └── mermaid-init.js    # from assets/mermaid-init.js (verbatim)
│   └── scripts/
│       └── verify-spec-tree.py   # from assets/verify-spec-tree.py (verbatim)
└── plan/
    ├── index.md              # from stubs/plan-index.md
    ├── plan-status.py        # from assets/plan-status.py (verbatim)
    ├── publish-issues.py     # from ../plan-5-publish-issues/assets/publish-issues.py (verbatim)
    ├── verify-plan-tree.py   # from assets/verify-plan-tree.py (verbatim)
    └── plan-gate.py          # from assets/plan-gate.py (verbatim)
```

The `.py`, `.css`, and `.js` files copy **verbatim** — do not hand-retype them.
`verify-plan-tree.py`, `plan-status.py`, `publish-issues.py`, and `plan-gate.py`
locate themselves by their own path / `$CLAUDE_PROJECT_DIR` (all root at `plan/`),
as do `verify-spec-tree.py` (`spec/scripts/`) and `drift-status.py` (`progress/`),
so they must land exactly where shown. (`publish-issues.py` is bundled with
`plan-5-publish-issues`; resolve it relative to that sibling skill's directory.)

Then add `.plan/.site/` to the repo's `.gitignore` (the built site is
regenerable and should not be committed).

### 2a. Wire the plan-tree integrity gate

`plan-gate.py` is a read-only backstop for autonomous sprint builds
(`build-sprint`): it runs `verify-plan-tree.py` and blocks an event when the
plan tree is critically broken, so a task can't be marked done on a corrupted
tree. It no-ops outside a `.plan/` workspace. Wire it into the project's
**`.claude/settings.json`** (the shared, committed settings file —
*not* `settings.local.json`) on the `TaskCompleted` hook event:

```json
{
  "hooks": {
    "TaskCompleted": [ { "hooks": [ { "type": "command",
      "command": "python3 \"${CLAUDE_PROJECT_DIR}/.plan/plan/plan-gate.py\"" } ] } ]
  }
}
```

Merge, don't clobber: if `.claude/settings.json` already exists, read it and add
this entry to its `hooks` object **without disturbing other keys or existing
hooks**; create the file if absent. This is **idempotent** — if a `plan-gate.py` hook
is already wired (a re-scaffold, or the tracker-only re-run path), leave it as is.
`TaskCompleted` takes no matcher (it always fires), so omit it.

### 3. Verify and offer to serve

Run both verifiers — a fresh scaffold must pass:

```bash
python .plan/spec/scripts/verify-spec-tree.py   # expect: OK: ... (exit 0)
python .plan/plan/verify-plan-tree.py           # expect: OK: 0 epics, 0 sprints, 0 issues ...
python .plan/plan/plan-status.py check          # expect: "plan tree: not-started" (exit 1 — nothing built yet)
python .plan/progress/drift-status.py           # expect: "No drift items." (exit 0 — none recorded yet)
```

`plan-status.py check` exits 1 on a fresh, all-not-started tree — that's expected,
not a scaffold failure; it only confirms the funnel runs and roots itself correctly.

The integrity gate (`plan-gate.py`) is now wired but inert: it only acts once there's
a plan tree and only blocks on *critical* corruption, so a clean fresh scaffold never
trips it. No `chmod` is needed — it's invoked via `python3`.

If the user wants to see the site, give them the install + serve commands (see
`.plan/README.md`): `pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin`
(or the `uv` equivalent), then `mkdocs serve -f .plan/mkdocs.yml`. Don't install
doc dependencies unless asked.

### 4. Hand off

Tell the user the workspace is ready and that the next step is `plan-1-specify` to
author the first part of the specification. Summarise the tracker they chose and
the language posture (agnostic by default).

## Why this shape

- **One `.plan/` root** keeps the project's top level uncluttered and the whole planning effort self-contained and easy to delete or relocate.
- **Glossary and ADRs live inside `spec/`** so they render on the website alongside the spec, instead of being invisible side-files.
- **The plan tree is plain markdown, not in the site nav** — it's an execution backlog, browsable on the file host and validated by its verifier, mirroring how a spec and its backlog are kept separate but linked by spec anchors.
- **Verifiers are count-agnostic** so they keep working as the spec and plan grow; they assert structure, not a fixed number of files.
- **The integrity gate is scaffolded, not just documented** — a real `.claude/settings.json` hook so an autonomous sprint build (`build-sprint`) physically can't accept a builder's work on a corrupted plan tree. It's read-only and self-disables outside `.plan/`, so it costs nothing elsewhere.
