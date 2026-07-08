# The drift-file format

Each cross-cutting item is one file,
`.plan/progress/drift/drift-<kebab-title>.md`, with greppable frontmatter so a recurring
item is found and updated rather than re-logged. Open items are the files whose
`status:` is `open` or `routed`:

```markdown
---
id: D1
kind: defect | smell | checkpoint-bug | note
surfaced: 2026-05-31 (01-03)
where: <spec/plan/code location, e.g. spec/03-runtime/... or sprint 02-04>
route: spec-4-edit | build-improve-architecture | follow-up issue #NNN
status: open | routed | resolved | by-design | human-or-future
---

# <Short title>

<one paragraph: what it is, why it's cross-cutting, and how it recurs>
```

## The lifecycle

`status:` is the drift lifecycle. `open` (recorded, untriaged) and `routed` (handed off
to a `follow-up issue #NNN`) are the **actionable** set; `resolved` (fixed, or confirmed
already fixed), `by-design` (re-assessed as intentional — never a real defect), and
`human-or-future` (parked for a human decision or deferred work) are **terminal**. A
status may carry a trailing note of how/when it was settled, e.g.
`resolved (drift-triage 2026-06-06, #376)` — tools classify on the leading keyword.

Defects route to `spec-4-edit`; architecture smells route to
`build-improve-architecture`. A `note` is an observation recorded for the record — not
itself a defect or smell (e.g. "this is a fixture convenience, correct by design") — and
usually settles straight to a terminal status rather than earning an issue. Flip
`status:` to `routed` once handed off and `resolved` once fixed — don't delete the file, so the history stays. Later, `build-assess-drift`
re-checks each open item against the live code — resolving the ones already fixed,
closing the ones that turn out to be `by-design`, parking the rest as `human-or-future`,
and advancing the survivors to `routed` with a `route: follow-up issue #NNN`.

## Migrating an old workspace

If `.plan/progress.md` still exists and
`.plan/progress/` does not, do a one-time split on this run: create the `progress/`
tree, move each `## Completed` row into `completed/<epic>.md` grouped by its
`EE-SS/II` prefix (ambiguous rows → `completed/_unsorted.md`, and flag them), move
each dated `## Notes` block into its own `notes/YYYY-MM-DD-…md`, then replace
`progress.md` with a one-line pointer to `progress/index.md`. Best-effort, no row loss.
