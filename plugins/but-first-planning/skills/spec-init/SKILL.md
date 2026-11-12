---
name: spec-init
description: >
  Scaffolds the `.agents/plan/` workspace: spec site, empty plan tree,
  glossary and ADRs, tracker config, status scripts. Run once per project,
  when the user wants to spec or plan it and no workspace exists; `--refresh`
  updates a workspace's scripts.
disable-model-invocation: true
argument-hint: "[--refresh]"
---

# spec-init

The foundation the rest of the plugin builds on. It creates `.agents/plan/`:
a spec docs website (`spec/`), an empty plan tree (`plan/`), a glossary and
ADR folder, a tracker config, a `progress/` directory, the deterministic
status funnel (`plan/plan-status.mjs`), the publisher, and the two structural
verifiers.

After this runs the user authors the spec with `spec-write`, sharpens it with
`spec-grill` and `spec-architect`, decomposes it with `plan-decompose`,
publishes with `plan-publish`, and builds with `build-next-issue`.

The whole workspace is plain markdown so it stays readable on disk, browsable
as a website, and editable by agents. That duality is the point. By default
the spec is language-agnostic (it describes systems, not code), but the
language posture chosen in the interview, recorded as ADR-0001 so it outlives
this session, can tie it to one language.

## Where `.agents/plan/` belongs

At a **repo root**. In a single-repo session that is the current directory,
but in a multi-repo workspace the session's cwd may not be the repo that
should own the plan. Confirm the target repo first and `cd` there, so every
emitted path resolves against the repo that actually holds `.agents/plan/`.

`.agents/` is the home of everything agent-facing in a repo, and it may
already exist (other plugins keep their own files there). Add `plan/` beside
what is there and touch nothing else in it. Nothing this skill scaffolds goes
into `./docs`: that folder is for end-user documentation.

## When NOT to scaffold

Decide "already initialised" on a **sentinel file**, not on `.agents/plan/`
merely existing: an interrupted run can leave a hollow skeleton that a bare
existence check would wrongly call done. The sentinel is
`.agents/plan/spec/scripts/verify-spec-tree.mjs` (the scaffold always writes
it):

- **Sentinel present**: `.agents/plan/` is initialised. Do not overwrite it.
  Say so and point the user at `spec-write` (to author) or `spec-edit` (to
  revise).
- **`.agents/plan/` exists but the sentinel is missing**: treat it as an
  incomplete scaffold. Say so, and offer to finish it by writing the missing
  files rather than bailing.

Two re-runs touch one thing each and are safe to repeat:

- **Refreshing the scripts** (`--refresh`, or when a session start says the
  workspace's scripts are not the plugin's current copies):

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/skills/spec-init/scaffold.mjs" --refresh
  ```

  It rewrites only the scripts that differ, never a spec or plan file. Run the
  verifiers afterwards and commit the result.
- **Reconfiguring the tracker**: replace only `tracker.md` with another stub.

A workspace this plugin scaffolded before 5.0 (a `.plan/` folder, or Python
scripts under `.agents/plan/`) needs nothing from this skill: the plugin's
session hook moves it to the current layout and says what it moved.

## Process

### 1. Interview, briefly

Ask only what you cannot infer. A few questions, one at a time:

- **Project name and one-line description**, for the site title and the spec
  index. Infer a default from the repo if you can and confirm it.
- **Issue tracker**. Three choices. **GitHub** (the default when `origin` is
  on GitHub): issues through `gh`, plus an optional Project board; ask for the
  board's URL, owner and number if there is one. **GitLab**: issues through
  `glab`, epics as scoped labels and sprints as milestones, on gitlab.com or a
  self-hosted instance; ask for the project path, its numeric id and the host.
  Or **local-markdown only**: the plan tree is the only source of truth and
  nothing is published. Missing values can stay as placeholders until the
  first publish. For GitHub and GitLab also ask for an optional **notify
  handle**, the person to mention when an autonomous run defers on a human
  gate; leave it unset to disable notifications.
- **Language posture**, how every spec file expresses logic. Ask only if it is
  not already obvious. Default is agnostic. Three choices:
  - **Agnostic** (default): pseudocode and diagrams only, no real-language
    code; the spec survives whatever language eventually implements it.
  - **Language-tied, minimal**: a named language, but a snippet appears only
    where a concrete one pins a decision better than prose.
  - **Language-tied, code-forward**: a named language, with idiomatic
    snippets used liberally alongside diagrams.

  This is load-bearing: it shapes every spec file and is expensive to reverse
  once the spec is written, which is why it becomes ADR-0001 rather than a
  session-only preference.
- **UI/UX posture**, how a human will visually verify the system. Ask only if
  it is not obvious. Default is headless for CLI tools and libraries. Four
  choices:
  - **headless**: no visual surfaces; every behaviour is verified by commands
    and tests.
  - **dev-dashboard**: end users never see a UI, but a minimal internal
    dashboard is spec'd and built as the human verification surface.
  - **existing-design-system**: a feature in an established product; new UI is
    spec'd into the existing design system, whose tokens, components, and
    conventions the spec captures as constraints.
  - **greenfield-product**: polished UI/UX is a deliverable: full design-system
    spec, key screens, and HTML prototypes under `spec/prototypes/`.

  Load-bearing too: it decides what UI/UX content `spec-write` authors,
  whether a `prototypes/` playground is scaffolded, and whether
  `plan-decompose` cuts `REVIEW` issues. It becomes ADR-0002.
- **User-docs posture**, the shape of the end-user documentation (the product
  docs, not the spec site). Ask only if it is not obvious. Default is
  docs-site. Three choices:
  - **docs-site** (default): a structured multi-page site, `docs/` pages plus
    a static-site config.
  - **readme-only**: one README carries install and usage, for tools where a
    second page would be padding.
  - **existing-convention**: the project already has a docs convention; the
    spec captures it as the constraint.

  Two follow-ups in the same breath, recorded in the same ADR: **where
  readers read it** (a site, a `docs/` folder read on the forge, or a wiki whose
  source lives in the repo under `wiki/` and CI publishes; default: follow the
  posture) and the **screenshots posture** (`themed-pair` for a product with
  light and dark themes, `single`, or `none` for a library or API; default:
  `themed-pair` unless ADR-0002 says there is no UI). If docs-parity is
  installed, these are the answers `/docs-parity:docs-init` writes into
  `.agents/docs-parity.json`; run it once the code has a first surface.

  It shapes `spec-write`'s mandatory `user-docs-plan.md` page
  ([USER-DOCS-SPEC.md](../spec-write/USER-DOCS-SPEC.md)), the docs-skeleton
  issue `plan-decompose` cuts, and where `build-user-docs` writes after every
  verified sprint. It becomes ADR-0003.

Record the tracker choice in `tracker.md`, the language posture as
**ADR-0001**, the UI/UX posture as **ADR-0002**, and the user-docs posture as
**ADR-0003**, each with its `spec/index.md` posture line, so every later skill
honours them rather than just this session.

### 2. Copy the scaffold into place

Two kinds of file. The ones that copy **verbatim** (every script, the site's
CSS and JS, the empty ledger folders) are placed by one command, never by
hand:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/spec-init/scaffold.mjs"
```

It never overwrites a file that exists. The scripts locate themselves from
their own path, so where it puts them is where they must stay.

The rest are stubs under `${CLAUDE_PLUGIN_ROOT}/skills/spec-init/assets/` that
you write, filling the `{{PLACEHOLDER}}` tokens. **Substitute every `{{...}}`
token**, especially `{{MONTH}}` (the current year-month, `YYYY-MM`), or the
spec verifier rejects the glossary.

```
.agents/plan/
├── README.md                 # from stubs/README.md
├── mkdocs.yml                # from assets/mkdocs.yml  ({{PROJECT_NAME}})
├── tracker.md                # from stubs/tracker-github.md, tracker-gitlab.md, OR tracker-local.md
├── progress/
│   ├── index.md              # from stubs/progress-index.md
│   ├── drift-status.mjs      # scaffold.mjs
│   ├── completed/            # scaffold.mjs (epic ledgers appear as work completes)
│   ├── notes/                # scaffold.mjs (one file per sprint-build run)
│   └── drift/                # scaffold.mjs (one file per cross-cutting item: drift-<slug>.md)
├── spec/
│   ├── index.md              # from stubs/spec-index.md
│   ├── plan.md               # from stubs/plan-page.md  (fill {{MONTH}}!)
│   ├── reference/
│   │   ├── index.md          # from stubs/reference-index.md
│   │   ├── glossary.md       # from stubs/glossary.md  (fill {{MONTH}}!)
│   │   └── adr/
│   │       ├── index.md      # from stubs/adr-index.md
│   │       ├── 0001-language-posture.md   # from stubs/adr-0001-language-posture.md (fill posture tokens)
│   │       ├── 0002-ui-posture.md         # from stubs/adr-0002-ui-posture.md (fill posture tokens)
│   │       └── 0003-user-docs-posture.md  # from stubs/adr-0003-user-docs-posture.md (fill posture tokens)
│   ├── prototypes/            # ONLY when the UI posture is greenfield-product (or the user opts in)
│   │   ├── index.md           # from stubs/prototypes-index.md
│   │   └── prototype-skeleton.html  # from assets/prototype-skeleton.html (verbatim)
│   ├── assets/                # scaffold.mjs: gruvbox.css, mermaid-init.js, spec-comments.*, plan-view.*
│   └── scripts/
│       ├── verify-spec-tree.mjs   # scaffold.mjs
│       └── comments-server.py     # scaffold.mjs
└── plan/
    ├── index.md              # from stubs/plan-index.md
    ├── plan-status.mjs       # scaffold.mjs
    ├── publish-issues.mjs    # scaffold.mjs
    ├── tracker.mjs           # scaffold.mjs (what the two above speak GitHub and GitLab through)
    ├── provider.mjs          # scaffold.mjs (the layer over `gh` and `glab`)
    └── verify-plan-tree.mjs  # scaffold.mjs
```

`spec-comments.css` and `spec-comments.js` power inline commenting on the spec
site (highlight text, leave a note; the notes auto-save to
`.agents/plan/spec-comments.json` and feed `spec-edit`) and are already
registered in `mkdocs.yml`. `plan-view.css` and `plan-view.js` power the live
**Plan** page (`spec/plan.md`): it renders the plan tree (epics, sprints, and
issues with statuses, blockers, acceptance progress, and the next unblocked
issue) from the read-only `/__plan_status__` endpoint in
`comments-server.py`, and it is the issue board for local-tracker projects.
`comments-server.py` is the one Python file in the workspace: it fronts
MkDocs, which is Python too.

**Record the language posture** from step 1 in two places so downstream skills
honour it. Author `adr/0001-language-posture.md` from its stub (the
[ADR format](../spec-grill/ADR-FORMAT.md)) and set `spec/index.md`'s
`{{LANGUAGE_POSTURE}}` line, where `L` is the chosen language:

| Choice | `{{LANGUAGE_POSTURE}}` line | ADR summary / decision |
|--------|------------------------------|------------------------|
| Agnostic | "Every file is self-contained and language-agnostic: logic is expressed as pseudocode and diagrams, not code in any one language." | the spec stays language-agnostic (pseudocode and diagrams); no real-language code |
| `L`, minimal | "Files are language-agnostic by default; where a concrete `L` snippet pins a decision better than prose, the spec uses one." | the spec targets `L`, using snippets only where one encodes a decision better than prose; otherwise agnostic |
| `L`, code-forward | "The spec targets `L` and uses idiomatic `L` snippets liberally, alongside diagrams, to illustrate behaviour and contracts." | the spec targets `L`, code-forward: idiomatic snippets used liberally alongside diagrams |

Then add the ADR's row to `adr/index.md`'s Records section. Write ADR-0001
even for the agnostic default: a recorded "we chose agnostic" is what stops a
later skill from silently drifting into code.

**Record the UI/UX posture** the same way: author `adr/0002-ui-posture.md`
from its stub and set `spec/index.md`'s `{{UI_POSTURE}}` line:

| Choice | `{{UI_POSTURE}}` line | ADR summary / decision |
|--------|------------------------|------------------------|
| headless | "The system is headless: there are no visual surfaces; every behaviour is verified by commands and tests." | headless: no UI surfaces, no prototypes, no REVIEW issues |
| dev-dashboard | "End-users never see a UI; a minimal internal dashboard is spec'd and built as the human verification surface." | dev-dashboard: a minimal internal dashboard is spec'd and built early (ordinary AFK slices); REVIEW issues verify against it |
| existing-design-system | "New UI/UX is spec'd into the existing design system, whose tokens, components, and conventions the spec captures as constraints." | existing-design-system: existing conventions captured as spec constraints; REVIEW issues verify new UI against them |
| greenfield-product | "Polished UI/UX is a deliverable: the spec carries a full design system, key screens, and HTML prototypes under `prototypes/`." | greenfield-product: full design-system spec, key screens, verification surfaces, and a `prototypes/` playground; REVIEW issues per verification boundary |

Add the ADR-0002 row to `adr/index.md` too. Write it even for the headless
default: a recorded "we chose headless" is what stops a later skill from
inventing UI work nobody asked for. Scaffold `spec/prototypes/` (the stub hub
page plus `prototype-skeleton.html` verbatim) when the posture is
**greenfield-product**; under any other posture offer it as an opt-in. When
scaffolded, add one line to `spec/index.md`'s reference links:
``- [`prototypes/`](prototypes/index.md) - throwaway HTML design prototypes and signed-off design captures, linked from the spec pages.``

**Record the user-docs posture** the same way: author
`adr/0003-user-docs-posture.md` from its stub and set `spec/index.md`'s
`{{DOCS_POSTURE}}` line:

| Choice | `{{DOCS_POSTURE}}` line | ADR summary / decision |
|--------|--------------------------|------------------------|
| docs-site | "End-user docs are a structured multi-page site, planned in `user-docs-plan.md` and grown per verified sprint." | docs-site: a `docs/` tree plus a site config; `user-docs-plan.md` pins the page map; `build-user-docs` writes into it per verified sprint |
| readme-only | "End-user docs are a single README (install and usage), planned as a section map in `user-docs-plan.md`." | readme-only: one README, kept tight; the page map collapses to a section map |
| existing-convention | "End-user docs follow the project's existing convention, captured as the constraint in `user-docs-plan.md`." | existing-convention: the detected existing docs layout is the constraint; pages are planned in its terms |

Write all three even when the defaults were taken. The recorded posture is
what stops a later skill, or a long collaborative session, from drifting.

### 3. Wire the workspace into the repo

Two small edits outside `.agents/plan/`:

1. **`.gitignore`.** Add `.agents/plan/.site/` (the built site is regenerable)
   and `.agents/plan/.comments.log` (the spec server's log). If the file
   carries a fenced block another tool manages (a `# >>> ...` to `# <<< ...`
   pair), put the lines outside it.
2. **The agent hub.** The next agent has to find the workspace from the
   repo's root `AGENTS.md`.

   - **It exists** (always the case in a repo on team conventions, where
     `.agents/manifest.json` is present): add one Layout line and change
     nothing else in it:

     ```
     - `.agents/plan/` - the planning workspace: the spec site (`spec/`), the epic to issue backlog (`plan/`), and the progress ledgers. Owned by the but-first-planning skills; descend to read the spec or the plan, never to hand-edit a status.
     ```

   - **It does not**: write it from `stubs/agents-root.md` (fill
     `{{PROJECT_NAME}}` and `{{ONE_LINE_DESCRIPTION}}`), and beside it a
     `CLAUDE.md` whose whole content is `@AGENTS.md`, so a Claude Code
     session loads the hub. An existing `CLAUDE.md` gets that line added at
     the top and keeps everything else.

   Hubs below the root are not created now: builders add them as directories
   appear (`build-tdd`), guided by the spec's `repository-layout.md`.

**The plan gate is off unless the user asks for it.** The plugin ships a
`TaskCompleted` hook that refuses to mark a task done while the plan tree is
critically broken (a hand-edited status that disagrees with its parents, a
dead link, an orphaned spec anchor). It is a backstop for autonomous sprint
builds and does nothing until the repo opts in. If the user wants it, write
`.agents/plan/config.json`:

```json
{ "taskGate": true }
```

### 4. Verify and offer to serve

Run the verifiers. A fresh scaffold produces no CRITICAL findings; the
warnings below are the expected ramp-in state:

```bash
node .agents/plan/spec/scripts/verify-spec-tree.mjs   # expect: WARN on the two mandatory pages (they do not exist yet), exit 1
node .agents/plan/plan/verify-plan-tree.mjs           # expect: OK: 0 epics, 0 sprints, 0 issues ...
node .agents/plan/plan/plan-status.mjs check          # expect: "plan tree: not-started" (exit 1, nothing built yet)
node .agents/plan/progress/drift-status.mjs           # expect: "No drift items." (exit 0, none recorded yet)
```

The spec verifier's two mandatory-page warnings (`repository-layout.md`,
`user-docs-plan.md`) are the expected fresh-scaffold state: `spec-write`
authors those pages, and the warnings are the reminder, not a failure.
`plan-status.mjs check` exits 1 on a fresh all-not-started tree for the same
reason; it only confirms the funnel runs and roots itself correctly.

If the user wants to see the site, give them the install and serve commands
(they are in `.agents/plan/README.md`):
`pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin` (or the `uv`
equivalent), then ask the person to run `/but-first-planning:spec-open`,
which serves the site with inline comments and the live Plan page on one
port. Do not install doc
dependencies unless asked. Plain `mkdocs serve -f .agents/plan/mkdocs.yml`
gives a read-only view: comments then fall back to browser localStorage, and
the **Plan** page shows its static fallback instead of live status.

### 5. Hand off

Tell the user the workspace is ready and that the next step is `spec-write`.
Summarise the tracker they chose, the language posture in ADR-0001 (agnostic
unless they tied it to a language), the UI/UX posture in ADR-0002 (headless
unless they chose a UI tier), the user-docs posture in ADR-0003 (docs-site
unless they chose otherwise), and whether the plan gate is on.

## Why this shape

- **One `.agents/plan/` root** keeps the planning effort self-contained, easy
  to read and easy to delete, and leaves `./docs` to end-user documentation.
  The plan tree inside it is `.agents/plan/plan/`: the workspace is `plan`,
  the tree in it is `plan`, and the doubled name is intended.
- **Glossary and ADRs live inside `spec/`** so they render on the website
  alongside the spec, rather than being invisible side-files.
- **The plan tree is plain markdown and not in the site nav**: it is an
  execution backlog, browsable on the file host and validated by its verifier,
  mirroring how a spec and its backlog stay separate but linked by anchors.
- **Verifiers are count-agnostic** so they keep working as the spec and plan
  grow; they assert structure, not a fixed number of files.
- **Scripts are copied, not referenced**, so a checkpoint row in a plan file
  runs the same command for a teammate, a CI job, and an agent, with or
  without this plugin installed. `scaffold.mjs --refresh` is how the copies
  catch up when the plugin changes them.
