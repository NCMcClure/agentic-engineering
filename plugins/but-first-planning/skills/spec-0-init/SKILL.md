---
name: spec-0-init
description: Scaffold the .plan/ planning workspace — spec site, plan tree, glossary, ADRs, tracker. Run once, when the user wants to plan or spec a project and .plan/ doesn't exist — "set up planning".
---

# spec-0-init — scaffold the `.plan/` workspace

This is the foundation the rest of the suite builds on. It creates `.plan/` at
the repo root: a spec docs website (`spec/`), an empty plan tree (`plan/`), a
glossary and ADR folder, a tracker config, a `progress/` directory, the
deterministic status funnel (`plan/plan-status.py`), and the two structural
verifiers. After this runs, the user authors the spec with
`spec-1-specify`, sharpens it with `spec-2-grill` / `spec-3-architect`, decomposes
it with `plan-0-decompose`, publishes with `plan-1-publish-issues`, and tracks with
`build-next-issue`.

The whole workspace is plain markdown so it stays human-readable on disk,
browsable as a website, and trivially editable by agents — that duality is the
point. By default the spec is language-agnostic (it describes systems, not
code), but the **language posture** chosen in the interview — recorded as
ADR-0001 so it outlives this session — can tie it to a specific language.

## Before you scaffold — where does `.plan/` belong?

`.plan/` lives at a **repo root**. In a single-repo session that's just the
current directory, but in a multi-repo workspace the session's cwd may not be the
repo that should own the plan (e.g. cwd is a tooling repo but the spec targets a
sibling app repo). **Confirm the target repo first**, and `cd` there before
scaffolding so `$CLAUDE_PROJECT_DIR` and every emitted path (the `plan-gate.py`
hook command, verifier invocations, the `.gitignore` edit) resolve against the
repo that actually holds `.plan/`.

## When NOT to scaffold

Decide "already initialised" on a **sentinel file**, not on the `.plan/` directory
merely existing — an interrupted prior run can leave a hollow skeleton (the
directory tree present, zero files in it), which a bare existence check would
wrongly treat as done. Use `.plan/spec/scripts/verify-spec-tree.py` as the
sentinel (the scaffold always writes it):

- **Sentinel present** → `.plan/` is initialised. Do **not** overwrite it; tell the
  user and point them at `spec-1-specify` (to author) or `spec-4-edit` (to revise).
- **`.plan/` exists but the sentinel is missing** (or `find .plan -type f` shows an
  essentially empty tree) → treat it as an **incomplete/aborted scaffold**. Say so,
  and offer to finish/repair it by populating the missing files rather than bailing.

Three narrow exceptions where a re-run touches only one thing: reconfiguring the
tracker (touch only `tracker.md`); backfilling a helper script into an older
`.plan/` project that predates it — copy `plan-gate.py` (and add the hooks per
step 2a) or `drift-status.py` into place; and backfilling the **Plan page** into
a workspace scaffolded before 3.4 — copy `stubs/plan-page.md` → `spec/plan.md`
(fill `{{MONTH}}`), `plan-view.js` / `plan-view.css` → `spec/assets/`, re-copy
`comments-server.py` → `spec/scripts/` (it carries the `/__plan_status__`
endpoint), add the two `plan-view` lines to `mkdocs.yml`'s `extra_css` /
`extra_javascript` if absent, and restart the comments server. These are
idempotent, so they're safe if the file is already there.

## Process

### 1. Interview (briefly)

Ask only what you can't infer. Keep it to a few questions, one at a time:

- **Project name + one-line description** — for the site title and spec index. Infer a sensible default from the repo if you can, and just confirm.
- **Issue tracker** — default **GitHub** (the `gh` CLI + an optional GitHub Project board). Alternatives: **GitLab** (the `glab` CLI — epics as scoped labels, sprints as milestones; works on self-hosted instances and personal namespaces), another tracker, or **local-markdown only** (the plan tree is the only source of truth). If GitHub with a project board, ask for the board URL / owner / number; if GitLab, ask for the project path, numeric project ID, and host. Missing values can stay as placeholders to fill in before first publish. For GitHub/GitLab, also ask for an optional **notify handle** — the username to @mention in an issue comment when an autonomous run defers on a human gate (a HITL or REVIEW issue it wasn't authorized to decide). Fills `{{NOTIFY_HANDLE}}` in the tracker stub; leave unset to disable notifications. Skip this question entirely for local-markdown mode.
- **Language posture** — how every spec file expresses logic. Ask only if it isn't already obvious from the conversation. **Default is agnostic.** Three choices:
  - **Agnostic** (default) — pseudocode and diagrams only, no real-language code; the spec survives whatever language eventually implements it.
  - **Language-tied, minimal** — a named language (say Python), but a snippet appears *only* where a concrete one pins a decision better than prose; otherwise the file stays agnostic.
  - **Language-tied, code-forward** — a named language, with idiomatic snippets used liberally alongside diagrams to illustrate behaviour and contracts.

  This choice is **load-bearing**: it shapes every spec file and is expensive to reverse once the spec is written, which is exactly why it becomes ADR-0001 rather than a session-only preference.
- **UI/UX posture** — how a human will *visually* verify the system. Ask only if it isn't obvious from the conversation. **Default is headless** for CLI tools and libraries. Four choices:
  - **headless** — no visual surfaces; every behaviour is verified by commands and tests.
  - **dev-dashboard** — end-users never see a UI, but a minimal internal dashboard is spec'd and built as the human verification surface.
  - **existing-design-system** — a feature/integration in an established product; new UI is spec'd into the existing design system, whose tokens/components/conventions the spec captures as constraints.
  - **greenfield-product** — polished UI/UX is a deliverable: full design-system spec, key screens, and HTML prototypes under `spec/prototypes/`.

  Like the language posture, this is **load-bearing**: it decides what UI/UX content `spec-1-specify` authors, whether a `prototypes/` playground is scaffolded, and whether `plan-0-decompose` cuts `REVIEW` (human visual-verification) issues — so it becomes ADR-0002.

Record the tracker choice in `tracker.md`, the language posture as **ADR-0001** plus the `spec/index.md` posture line, and the UI/UX posture as **ADR-0002** plus the `spec/index.md` `{{UI_POSTURE}}` line (step 2), so every later skill honours them — not just this session.

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
│   ├── plan.md               # from stubs/plan-page.md  (fill {{MONTH}}!)
│   ├── reference/
│   │   ├── index.md          # from stubs/reference-index.md
│   │   ├── glossary.md       # from stubs/glossary.md  (fill {{MONTH}}!)
│   │   └── adr/
│   │       ├── index.md      # from stubs/adr-index.md
│   │       ├── 0001-language-posture.md  # from stubs/adr-0001-language-posture.md (fill posture tokens)
│   │       └── 0002-ui-posture.md        # from stubs/adr-0002-ui-posture.md (fill posture tokens)
│   ├── prototypes/            # ONLY when the UI posture is greenfield-product (or the user opts in)
│   │   ├── index.md           # from stubs/prototypes-index.md
│   │   └── prototype-skeleton.html  # from assets/prototype-skeleton.html (verbatim)
│   ├── assets/
│   │   ├── gruvbox.css        # from assets/gruvbox.css (verbatim)
│   │   ├── mermaid-init.js    # from assets/mermaid-init.js (verbatim)
│   │   ├── spec-comments.css  # from assets/spec-comments.css (verbatim)
│   │   ├── spec-comments.js   # from assets/spec-comments.js (verbatim)
│   │   ├── plan-view.css      # from assets/plan-view.css (verbatim)
│   │   └── plan-view.js       # from assets/plan-view.js (verbatim)
│   └── scripts/
│       ├── verify-spec-tree.py   # from assets/verify-spec-tree.py (verbatim)
│       └── comments-server.py    # from assets/comments-server.py (verbatim)
└── plan/
    ├── index.md              # from stubs/plan-index.md
    ├── plan-status.py        # from assets/plan-status.py (verbatim)
    ├── publish-issues.py     # from ../plan-1-publish-issues/assets/publish-issues.py (verbatim)
    ├── verify-plan-tree.py   # from assets/verify-plan-tree.py (verbatim)
    └── plan-gate.py          # from assets/plan-gate.py (verbatim)
```

The `.py`, `.css`, and `.js` files copy **verbatim** — do not hand-retype them.
`verify-plan-tree.py`, `plan-status.py`, `publish-issues.py`, and `plan-gate.py`
locate themselves by their own path / `$CLAUDE_PROJECT_DIR` (all root at `plan/`),
as do `verify-spec-tree.py` (`spec/scripts/`), `comments-server.py` (`spec/scripts/`,
writes `.plan/spec-comments.json` two levels up), and `drift-status.py` (`progress/`),
so they must land exactly where shown. (`publish-issues.py` is bundled with
`plan-1-publish-issues`; resolve it relative to that sibling skill's directory.)
`spec-comments.css` / `spec-comments.js` power inline commenting on the spec site
(highlight text, leave a note; the notes auto-save to `.plan/spec-comments.json`
and feed `spec-4-edit`) and are already registered in `mkdocs.yml`.
`plan-view.css` / `plan-view.js` power the live **Plan** page (`spec/plan.md`):
it renders the plan tree — epics, sprints, and issues with statuses, blockers,
acceptance progress, and the next unblocked issue — from the read-only
`/__plan_status__` endpoint in `comments-server.py`, and is the issue board for
local-tracker projects.

**Record the language posture** from step 1 in two places so downstream skills
honour it. Author `adr/0001-language-posture.md` from its stub (the [ADR
format](../spec-2-grill/ADR-FORMAT.md)) and set `spec/index.md`'s
`{{LANGUAGE_POSTURE}}` line, matching the choice — where `L` is the chosen
language:

| Choice | `{{LANGUAGE_POSTURE}}` line | ADR summary / decision |
|--------|------------------------------|------------------------|
| Agnostic | "Every file is self-contained and language-agnostic: logic is expressed as pseudocode and diagrams, not code in any one language." | the spec stays language-agnostic (pseudocode + diagrams); no real-language code |
| `L`, minimal | "Files are language-agnostic by default; where a concrete `L` snippet pins a decision better than prose, the spec uses one." | the spec targets `L`, using snippets only where one encodes a decision better than prose; otherwise agnostic |
| `L`, code-forward | "The spec targets `L` and uses idiomatic `L` snippets liberally, alongside diagrams, to illustrate behaviour and contracts." | the spec targets `L`, code-forward: idiomatic snippets used liberally alongside diagrams |

Then add the ADR's row to `adr/index.md`'s Records section. Write ADR-0001 even
for the agnostic default — a recorded "we chose agnostic" is what stops a later
skill from silently drifting into code.

**Record the UI/UX posture** the same way: author `adr/0002-ui-posture.md` from
its stub and set `spec/index.md`'s `{{UI_POSTURE}}` line, matching the choice:

| Choice | `{{UI_POSTURE}}` line | ADR summary / decision |
|--------|------------------------|------------------------|
| headless | "The system is headless: there are no visual surfaces; every behaviour is verified by commands and tests." | headless — no UI surfaces, no prototypes, no REVIEW issues |
| dev-dashboard | "End-users never see a UI; a minimal internal dashboard is spec'd and built as the human verification surface." | dev-dashboard — a minimal internal dashboard is spec'd and built early (ordinary AFK slices); REVIEW issues verify against it |
| existing-design-system | "New UI/UX is spec'd into the existing design system, whose tokens, components, and conventions the spec captures as constraints." | existing-design-system — existing conventions captured as spec constraints; REVIEW issues verify new UI against them |
| greenfield-product | "Polished UI/UX is a deliverable: the spec carries a full design system, key screens, and HTML prototypes under `prototypes/`." | greenfield-product — full design-system spec, key screens, verification surfaces, and a `prototypes/` playground; REVIEW issues per verification boundary |

Add the ADR-0002 row to `adr/index.md`'s Records section too. Write ADR-0002
even for the headless default — a recorded "we chose headless" is what stops a
later skill from inventing UI work nobody asked for. Scaffold `spec/prototypes/`
(the stub hub page plus `prototype-skeleton.html` verbatim) when the posture is
**greenfield-product**; under any other posture offer it as an opt-in. When
scaffolded, add one line to `spec/index.md`'s reference links:
`- [`prototypes/`](prototypes/index.md) — throwaway HTML design prototypes linked from the spec pages.`

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
doc dependencies unless asked. To also leave inline comments on the spec, they run
`python .plan/spec/scripts/comments-server.py` *instead of* `mkdocs serve`: it
fronts MkDocs on a single port and serves the comment API on the same origin, so
comments auto-save to `.plan/spec-comments.json` and it keeps working when the
site is viewed through a forwarded port (VS Code / code-server / SSH tunnel), with
no second port to forward. Plain `mkdocs serve` still works for a read-only view;
comments just fall back to browser localStorage without the sidecar, and the
**Plan** page shows its static fallback text instead of live plan-tree status
(the `/__plan_status__` endpoint lives in the sidecar).

### 4. Hand off

Tell the user the workspace is ready and that the next step is `spec-1-specify` to
author the first part of the specification. Summarise the tracker they chose,
the language posture recorded in ADR-0001 (agnostic unless they tied it to a
language), and the UI/UX posture recorded in ADR-0002 (headless unless they
chose a UI tier).

## Why this shape

- **One `.plan/` root** keeps the project's top level uncluttered and the whole planning effort self-contained and easy to delete or relocate.
- **Glossary and ADRs live inside `spec/`** so they render on the website alongside the spec, instead of being invisible side-files.
- **The plan tree is plain markdown, not in the site nav** — it's an execution backlog, browsable on the file host and validated by its verifier, mirroring how a spec and its backlog are kept separate but linked by spec anchors.
- **Verifiers are count-agnostic** so they keep working as the spec and plan grow; they assert structure, not a fixed number of files.
- **The integrity gate is scaffolded, not just documented** — a real `.claude/settings.json` hook so an autonomous sprint build (`build-sprint`) physically can't accept a builder's work on a corrupted plan tree. It's read-only and self-disables outside `.plan/`, so it costs nothing elsewhere.
