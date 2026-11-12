# {{PROJECT_NAME}}: planning workspace

This `.agents/plan/` directory holds the **specification** and **implementation plan**
for {{PROJECT_NAME}}, authored and maintained by the but-first-planning skills
(`spec-init` through `build-next-issue`). Everything here is plain markdown:
readable on disk, browsable as a website, and editable by agents.

## Layout

| Path | What it is | Skill that owns it |
|------|-----------|--------------------|
| `spec/` | The specification, as a progressive-disclosure docs website | `spec-write` |
| `spec/reference/glossary.md` | Domain glossary | `spec-grill`, `spec-architect` |
| `spec/reference/adr/` | Architecture decision records | `spec-grill`, `spec-architect` |
| `spec/prototypes/` | Throwaway HTML design prototypes + signed-off design captures (greenfield-product posture, or opt-in) | `spec-write` |
| `plan/` | Epic → sprint → issue implementation backlog | `plan-decompose` |
| `plan/plan-status.mjs` | The single status funnel: set and check status across every surface and the tracker | all build skills |
| `plan/publish-issues.mjs` | Publishes a sprint to the tracker and reads it back (`tracker.mjs` and `provider.mjs` beside it are what it runs on) | `plan-publish` |
| `config.json` | Optional. `"taskGate": true` makes the plugin refuse to mark a task done while the plan tree is critically broken | you |
| `tracker.md` | Where issues get published, and how | `spec-init`, `plan-publish` |
| `progress/` | Progress: per-epic ledgers (`completed/`), per-run notes (`notes/`), drift registry (`drift/`) | `build-next-issue`, `build-sprint` |

## Reading the spec as a website

```bash
# one-time: install the docs toolchain
pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin
# or, with uv:  uv add --group docs mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin

mkdocs serve -f .agents/plan/mkdocs.yml      # then open http://127.0.0.1:8000
```

Edits to anything under `.agents/plan/spec/` reload live.

## Leaving inline comments on the spec

The spec pages support inline commenting: select any text, type a note, and it
shows in a rail on the right. Comments auto-save to `.agents/plan/spec-comments.json`,
each with a `resolved` flag. To persist them to disk, run the comments server
(standard-library Python, the runtime MkDocs already needs) **instead of**
`mkdocs serve`:

```bash
python .agents/plan/spec/scripts/comments-server.py   # site + comments on http://127.0.0.1:8000
```

It fronts MkDocs on a single port and serves the comment API on the same origin,
so it also works when the site is opened through a forwarded port (VS Code /
code-server / SSH tunnel): forward the one port you already open for the site and
comments persist, no second port needed.

Then point `spec-edit` at the file when you want the changes made: it reads
every unresolved comment as a requested spec edit and flips it to `resolved`
once addressed. Plain `mkdocs serve` still works for a read-only view; comments
just save to the browser's localStorage instead of the file.

## Verifying structure

```bash
node .agents/plan/spec/scripts/verify-spec-tree.mjs   # spec frontmatter + links
node .agents/plan/plan/verify-plan-tree.mjs           # plan structure + spec anchors
```

Both are read-only, need only Node 22, and exit non-zero on a structural violation.

## Tracking status

Completion status is never hand-edited. One deterministic script updates it
everywhere (the issue file, the parent sprint and epic tables and fields, the
plan index) in a single call, then moves the issue's ticket on GitHub or
GitLab to match:

```bash
node .agents/plan/plan/plan-status.mjs set 01-03-07 done   # flip an issue; sprint/epic roll up
node .agents/plan/plan/plan-status.mjs check 01-03         # is sprint 01-03 fully done + consistent?
```

`check` (with no argument, an epic `EE`, a sprint `EE-SS`, or an issue `EE-SS-II`)
reports the rolled-up status and exits 0 only when that node is `done` and every
surface agrees. The markdown is always written first: a tracker that cannot be
reached, or an issue that is not published yet, is a warning, never a failure.
