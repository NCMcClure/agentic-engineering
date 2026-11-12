---
name: spec-write
description: >
  Authors or extends the spec as a progressive-disclosure docs site under
  `.agents/plan/spec/`. Use when the user wants to write or grow a spec ("spec
  this out", "document the design"). Needs `.agents/plan/`.
---

# spec-write: author the specification

Grow the specification under `.agents/plan/spec/` into a navigable, progressive-
disclosure knowledge base that reads well as a website and edits cleanly as
markdown. You are writing **what the system is and how it behaves**, not code.
The deliverable is a knowledge base, not one long document: many small, self-
contained files, each findable by its frontmatter and reachable by navigation.

If `.agents/plan/` doesn't exist, stop: ask the person to run `/but-first-planning:spec-init` first.

## The mental model: five-level progressive disclosure

A reader (human or agent) should be able to find the right file cheaply, without
reading everything. Five levels, each cheaper than the next: root index →
category index → frontmatter summary → full file → cross-references. You author
*for* that cost model, which is why indexes stay thin, files stay small and
single-topic, and every file advertises itself through frontmatter. Full model
in [PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md); read it once before
your first big spec.

## Process

### 1. Understand what's being specified

Work from the conversation. If the spec already has categories, read
`.agents/plan/spec/index.md` and the relevant category indexes to see what exists and
where the new material belongs. Don't duplicate a topic that already has a home, grow the existing file instead (updating beats creating; see why in
[PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)).

If terminology is in play, check `.agents/plan/spec/reference/glossary.md` and use its
canonical terms. Read the recorded postures once
(`.agents/plan/spec/reference/adr/0001-language-posture.md`,
`0002-ui-posture.md`, `0003-user-docs-posture.md`) so you write to them
(language, visual verification, end-user docs shape) from the first file. If the user is fuzzy on a concept or you hit a real fork in the
design, that's a signal to pause and hand off to `spec-grill` rather than
guessing, say so.

### 2. Propose the structure before writing

Sketch the category/file layout you intend and confirm it with the user. A few
top-level categories is plenty to start (three is a fine number); add more only
when a category starts holding files that don't belong together. Each category
is a numbered directory (`01-foundations/`, `02-…/`) with an `index.md` hub.
Layout rules, index isolation, index scope, file sizing, naming, are in
[FILE-LAYOUT.md](FILE-LAYOUT.md). Read it before creating categories.

Two content pages are **mandatory** in every spec, whatever the outline
(`verify-spec-tree.mjs` warns until they exist; exact filenames are the
contract):

- **`repository-layout.md`**: how the source tree is organized for agents:
  organizing rules, the top-level tree, the module map back to spec
  categories, thin entrypoints, and where the AGENTS.md hubs sit. Contract:
  [CODEBASE-LAYOUT.md](CODEBASE-LAYOUT.md).
- **`user-docs-plan.md`**: the end-user docs stack (per ADR-0003) and the
  page map each sprint's docs pass writes into. Contract:
  [USER-DOCS-SPEC.md](USER-DOCS-SPEC.md).

Slot them into whichever categories fit; plan them into the outline from the
start rather than bolting them on after.

### 3. Write the files

For each content file:

- **Frontmatter first.** `tags`, `summary`, `created`, `updated`, and optional `relates-to`. The summary is the most important hundred bytes in the file, it's what a reader uses to decide whether to open it. Full contract in [FRONTMATTER.md](FRONTMATTER.md).
- **One clear topic per file**, under ~200 lines. If it's growing past that, it's two files.
- **Honour the recorded language posture** ([`reference/adr/0001-language-posture.md`](../spec-init), echoed in the spec's root `index.md`). Structure, flow, and state are always mermaid diagrams. What changes is how logic reads: **agnostic** → pseudocode / numbered steps, no real-language code; **language-tied, minimal** → still pseudocode by default, with a real snippet only where one pins a decision better than prose; **language-tied, code-forward** → idiomatic snippets used liberally alongside the diagrams. When unsure, read the ADR; don't default to agnostic if the project chose a language. Diagram, pseudocode, and snippet patterns: [DIAGRAMS.md](DIAGRAMS.md).
- **Honour the recorded UI/UX posture** ([`reference/adr/0002-ui-posture.md`](../spec-init), echoed in the spec's root `index.md`). It scales what UI/UX content the spec carries, nothing under **headless**, up to a full design-system + key-screens + verification-surfaces category (and `prototypes/`) under **greenfield-product**. The category shapes, the verification-surfaces table, wireframe conventions, and the prototype loop, render to an image and *look* while iterating; promote the approved capture on sign-off, live in [UI-SPEC.md](UI-SPEC.md).
- **Self-contained.** A reader who lands here from a search hit should be able to use the file without opening another. Use `relates-to` for the sideways trail, not as a crutch for missing content.

Update the category `index.md` (one line for the new file, at the right scope)
and, if you added a category, the root `index.md` (one line for the category).
Keep indexes navigation-only, no content, no reaching two levels deep.

### 4. Verify

Run the structural verifier and fix anything it flags:

```bash
node .agents/plan/spec/scripts/verify-spec-tree.mjs
```

It checks frontmatter validity, that indexes stay hub-only, and that
`relates-to` links resolve. A clean spec exits 0 (warnings, e.g. an oversized
file, exit 1 and are worth addressing).

### 5. Offer to serve and hand off

Offer to serve the site (`mkdocs serve -f .agents/plan/mkdocs.yml`) so the user can read
what you wrote. Then point at the natural next step: `spec-grill` to stress-
test and sharpen, `spec-architect` to pressure-test the system design before
any code exists, or `plan-decompose` once the spec is solid enough to decompose.

## Discipline that keeps the cost model honest

- **Thin indexes.** An index that lists every file in the tree collapses the cheap-orientation levels into one expensive read. One line per direct child, no deeper.
- **Small files.** An oversized file's summary stops describing its contents accurately, which silently breaks search.
- **Accurate frontmatter.** A stale `summary` is a quiet failure, search keeps surfacing the file and readers keep getting the wrong picture. Bump `updated` and the summary whenever the body meaningfully changes.
- **Prefer updating over creating.** A new file adds a new summary the reader must learn; updating refreshes one line. Create a file only when the topic genuinely has no home.

These aren't bureaucracy, each one protects the property that makes the spec cheap to navigate. [PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md) explains the why behind each.

## Autonomous mode

To author a whole spec from a brief/PRD hands-off (roughly **10+ expected
pages**), offer the bundled workflow instead of the interactive loop, don't
silently run it. The user approves the run and its args once (plan mode), then
it runs to convergence with no further stops:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/spec-write/workflows/author-spec.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/spec-write",
    brief: "<the product brief text, or an absolute path to it>",
    // optional: context, sourcePaths: [...],
    // languagePosture: "agnostic" | "<lang>:minimal" | "<lang>:code-forward" (read from ADR-0001)
    // uiPosture: "headless" | "dev-dashboard" | "existing-design-system" | "greenfield-product" (read from ADR-0002)
    // docsPosture: "docs-site" | "readme-only" | "existing-convention" (read from ADR-0003)
  }
})
```

**Converged when** `verify-spec-tree.mjs` exits 0 and the three audit critics
(coverage-vs-brief, disclosure-discipline, coherence) come back clean. Open
questions are parked as `**Open question:**` blocks, never guessed, the
returned `openQuestions` inventory is the hand-off to `spec-grill`
(interactively, or via its deep-review workflow).

Where the session has no `Workflow()` tool, run the same phases with parallel
subagents instead, in the same order, with the parent session owning every
shared file and the status funnel:
[references/subagent-fallback.md](../../references/subagent-fallback.md) is
the contract, and it is what keeps an autonomous run there from quietly
becoming a different, unverified run.

## Done when

`verify-spec-tree.mjs` exits 0; every file you created or edited has a current
`summary`/`updated` frontmatter and exactly one line in its category index; no
content file exceeds ~200 lines without being flagged to the user; the spec
carries `repository-layout.md` and `user-docs-plan.md` (or the user explicitly
deferred them, reported, never silent); and any fork or fuzzy concept you hit
is either resolved in the text or explicitly handed to `spec-grill`, not
silently guessed.
