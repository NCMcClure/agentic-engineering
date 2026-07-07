---
name: plan-1-specify
description: Author the specification as a progressive-disclosure docs site under .plan/spec/. Use when the user wants to write or grow a spec — "spec this out", "document the design", "add a section". Requires .plan/.
---

# plan-1-specify — author the specification

Grow the specification under `.plan/spec/` into a navigable, progressive-
disclosure knowledge base that reads well as a website and edits cleanly as
markdown. You are writing **what the system is and how it behaves**, not code.
The deliverable is a knowledge base, not one long document: many small, self-
contained files, each findable by its frontmatter and reachable by navigation.

If `.plan/` doesn't exist, stop and run `plan-0-init` first.

## The mental model: five-level progressive disclosure

A reader (human or agent) should be able to find the right file cheaply, without
reading everything. Five levels, each cheaper than the next: root index →
category index → frontmatter summary → full file → cross-references. You author
*for* that cost model — which is why indexes stay thin, files stay small and
single-topic, and every file advertises itself through frontmatter. Full model
in [PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md); read it once before
your first big spec.

## Process

### 1. Understand what's being specified

Work from the conversation. If the spec already has categories, read
`.plan/spec/index.md` and the relevant category indexes to see what exists and
where the new material belongs. Don't duplicate a topic that already has a home —
grow the existing file instead (updating beats creating; see why in
[PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)).

If terminology is in play, check `.plan/spec/reference/glossary.md` and use its
canonical terms. If the user is fuzzy on a concept or you hit a real fork in the
design, that's a signal to pause and hand off to `plan-2-grill-spec` rather than
guessing — say so.

### 2. Propose the structure before writing

Sketch the category/file layout you intend and confirm it with the user. A few
top-level categories is plenty to start (three is a fine number); add more only
when a category starts holding files that don't belong together. Each category
is a numbered directory (`01-foundations/`, `02-…/`) with an `index.md` hub.
Layout rules — index isolation, index scope, file sizing, naming — are in
[FILE-LAYOUT.md](FILE-LAYOUT.md). Read it before creating categories.

### 3. Write the files

For each content file:

- **Frontmatter first.** `tags`, `summary`, `created`, `updated`, and optional `relates-to`. The summary is the most important hundred bytes in the file — it's what a reader uses to decide whether to open it. Full contract in [FRONTMATTER.md](FRONTMATTER.md).
- **One clear topic per file**, under ~200 lines. If it's growing past that, it's two files.
- **Language-agnostic by default.** Express logic as pseudocode or numbered steps; express structure, flow, and state as mermaid diagrams. Reach for a real language only if `plan-0-init` recorded one *and* a concrete snippet encodes a decision better than prose. Diagram and pseudocode patterns: [DIAGRAMS.md](DIAGRAMS.md).
- **Self-contained.** A reader who lands here from a search hit should be able to use the file without opening another. Use `relates-to` for the sideways trail, not as a crutch for missing content.

Update the category `index.md` (one line for the new file, at the right scope)
and, if you added a category, the root `index.md` (one line for the category).
Keep indexes navigation-only — no content, no reaching two levels deep.

### 4. Verify

Run the structural verifier and fix anything it flags:

```bash
python .plan/spec/scripts/verify-spec-tree.py
```

It checks frontmatter validity, that indexes stay hub-only, and that
`relates-to` links resolve. A clean spec exits 0 (warnings, e.g. an oversized
file, exit 1 and are worth addressing).

### 5. Offer to serve and hand off

Offer to serve the site (`mkdocs serve -f .plan/mkdocs.yml`) so the user can read
what you wrote. Then point at the natural next step: `plan-2-grill-spec` to stress-
test and sharpen, `plan-3-architect-spec` to pressure-test the system design before
any code exists, or `plan-4-plan` once the spec is solid enough to decompose.

## Discipline that keeps the cost model honest

- **Thin indexes.** An index that lists every file in the tree collapses the cheap-orientation levels into one expensive read. One line per direct child, no deeper.
- **Small files.** An oversized file's summary stops describing its contents accurately, which silently breaks search.
- **Accurate frontmatter.** A stale `summary` is a quiet failure — search keeps surfacing the file and readers keep getting the wrong picture. Bump `updated` and the summary whenever the body meaningfully changes.
- **Prefer updating over creating.** A new file adds a new summary the reader must learn; updating refreshes one line. Create a file only when the topic genuinely has no home.

These aren't bureaucracy — each one protects the property that makes the spec cheap to navigate. [PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md) explains the why behind each.

## Autonomous mode

To author a whole spec from a brief/PRD hands-off (roughly **10+ expected
pages**), offer the bundled workflow instead of the interactive loop — don't
silently run it. The user approves the run and its args once (plan mode), then
it runs to convergence with no further stops:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/plan-1-specify/workflows/author-spec.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/plan-1-specify",
    brief: "<the product brief text, or an absolute path to it>",
    // optional: context: "<project orientation>", sourcePaths: [...], language: "<from plan-0-init>"
  }
})
```

**Converged when** `verify-spec-tree.py` exits 0 and the three audit critics
(coverage-vs-brief, disclosure-discipline, coherence) come back clean. Open
questions are parked as `**Open question:**` blocks, never guessed — the
returned `openQuestions` inventory is the hand-off to `plan-2-grill-spec`
(interactively, or via its deep-review workflow).

## Done when

`verify-spec-tree.py` exits 0; every file you created or edited has a current
`summary`/`updated` frontmatter and exactly one line in its category index; no
content file exceeds ~200 lines without being flagged to the user; and any fork
or fuzzy concept you hit is either resolved in the text or explicitly handed to
`plan-2-grill-spec` — not silently guessed.
