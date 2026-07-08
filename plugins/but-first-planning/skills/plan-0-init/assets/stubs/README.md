# {{PROJECT_NAME}} — planning workspace

This `.plan/` directory holds the **specification** and **implementation plan**
for {{PROJECT_NAME}}, authored and maintained by the numbered planning skills
(`plan-0-init` … `build-next-issue`). Everything here is plain markdown — human-
readable on disk, browsable as a website, and editable by agents.

## Layout

| Path | What it is | Skill that owns it |
|------|-----------|--------------------|
| `spec/` | The specification, as a progressive-disclosure docs website | `plan-1-specify` |
| `spec/reference/glossary.md` | Domain glossary | `plan-2-grill-spec`, `plan-3-architect-spec` |
| `spec/reference/adr/` | Architecture decision records | `plan-2-grill-spec`, `plan-3-architect-spec` |
| `plan/` | Epic → sprint → issue implementation backlog | `plan-4-plan` |
| `plan/plan-status.py` | The single status funnel — set/check status across every surface + the tracker | all build/assess skills |
| `tracker.md` | Where issues get published, and how | `plan-0-init`, `plan-5-publish-issues` |
| `progress/` | Progress: per-epic ledgers (`completed/`), per-run notes (`notes/`), drift registry (`drift/`) | `build-next-issue`, `build-sprint` |

## Reading the spec as a website

```bash
# one-time: install the docs toolchain
pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin
# or, with uv:  uv add --group docs mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin

mkdocs serve -f .plan/mkdocs.yml      # then open http://127.0.0.1:8000
```

Edits to anything under `.plan/spec/` reload live.

## Leaving inline comments on the spec

The spec pages support inline commenting: select any text, type a note, and it
shows in a rail on the right. Comments auto-save to `.plan/spec-comments.json`,
each with a `resolved` flag. To persist them to disk, run the comments server
(stdlib Python, no install) **instead of** `mkdocs serve`:

```bash
python .plan/spec/scripts/comments-server.py   # site + comments on http://127.0.0.1:8000
```

It fronts MkDocs on a single port and serves the comment API on the same origin,
so it also works when the site is opened through a forwarded port (VS Code /
code-server / SSH tunnel): forward the one port you already open for the site and
comments persist, no second port needed.

Then point `plan-6-edit` at the file when you want the changes made: it reads
every unresolved comment as a requested spec edit and flips it to `resolved`
once addressed. Plain `mkdocs serve` still works for a read-only view; comments
just save to the browser's localStorage instead of the file.

## Verifying structure

```bash
python .plan/spec/scripts/verify-spec-tree.py   # spec frontmatter + links
python .plan/plan/verify-plan-tree.py           # plan structure + spec anchors
```

Both are read-only, stdlib-only, and exit non-zero on a structural violation.

## Tracking status

Completion status is never hand-edited. One deterministic script updates it
everywhere — the issue file, the parent sprint/epic tables and fields, the plan
index, and the GitHub issue/board — in a single call:

```bash
python .plan/plan/plan-status.py set 01-03-07 done   # flip an issue; sprint/epic roll up
python .plan/plan/plan-status.py check 01-03         # is sprint 01-03 fully done + consistent?
```

`check` (with no argument, an epic `EE`, a sprint `EE-SS`, or an issue `EE-SS-II`)
reports the rolled-up status and exits 0 only when that node is `done` and every
surface agrees. It is stdlib-only; GitHub sync is best-effort and degrades to a
warning when `gh` is absent or the issue is unpublished.
