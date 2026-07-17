# File layout and structural rules

The spec lives under `.plan/spec/`. The layout is small and the rules are few,
but each one is load-bearing: break it and you break the progressive-disclosure
cost model (see [PROGRESSIVE-DISCLOSURE.md](PROGRESSIVE-DISCLOSURE.md)). The
verifier (`.plan/spec/scripts/verify-spec-tree.py`) enforces the mechanical ones.

## Canonical layout

```
.plan/spec/
├── index.md                 # root navigation hub — categories only, no content
├── 01-<category>/           # a category: numbered, kebab-case
│   ├── index.md             # category hub — one line per file in this category
│   ├── <topic>.md           # a content file (carries frontmatter)
│   └── <another-topic>.md
├── 02-<category>/
│   ├── index.md
│   └── ...
├── reference/               # reserved: glossary + decision records (rendered on the site)
│   ├── index.md
│   ├── glossary.md
│   └── adr/
│       ├── index.md
│       └── 0001-slug.md
├── prototypes/              # reserved: HTML design prototypes + signed-off captures (see UI-SPEC.md; posture-dependent)
├── assets/                  # gruvbox.css, mermaid-init.js (site chrome — not docs)
└── scripts/                 # verify-spec-tree.py (excluded from the site)
```

## The rules

### 1. Indexes are hubs, not destinations

An `index.md` exists to point at things, not to hold content. It carries **no
frontmatter** and contains navigation prose plus a list of links. Content lives
in named content files that *do* carry frontmatter. Keep the two roles distinct:
when a reader opens an index they're orienting; when they open a content file
they've arrived.

### 2. Index scope: direct children only

An `index.md` describes only the things one level below it — one line each. The
root index lists categories (and `reference/`); a category index lists the files
in that category. An index must **not** reach two levels deep.

Why: if the root index lists every file in the tree, it becomes a flat manifest
and the cheap orientation levels collapse into one expensive read. Files below
the category level are found via search against frontmatter, not by walking
indexes.

```markdown
# Wrong — root index reaching into files
- `01-foundations/overview.md` — what this is
- `01-foundations/goals.md` — what we want
- `02-runtime/event-loop.md` — the loop

# Right — root index stays at category level
- [`01-foundations/`](01-foundations/index.md) — the mental model and goals
- [`02-runtime/`](02-runtime/index.md) — how the system behaves at run time
```

### 3. Categories are numbered; the root stays clean

Top-level categories use a numeric prefix (`01-`, `02-`, …) so the site and the
file host order them deterministically. Don't put content files directly at the
spec root — the root holds only `index.md`, the category directories, and the
reserved `reference/`, `prototypes/`, `assets/`, `scripts/`.

Start with a few categories (three is plenty). Add a category only when an
existing one starts holding files that obviously don't belong together — not
preemptively. A category with a single content file is a smell: fold it into a
sibling.

### 4. Two mandatory content pages

Every spec carries a `repository-layout.md` (agent-optimized source-tree
organization — [CODEBASE-LAYOUT.md](CODEBASE-LAYOUT.md)) and a
`user-docs-plan.md` (end-user docs stack + page map —
[USER-DOCS-SPEC.md](USER-DOCS-SPEC.md)), each in whichever category fits. The
exact filenames are the machine contract; `verify-spec-tree.py` warns while
either is missing.

### 5. Content files: named, sized, self-contained

- **Named descriptively.** `event-ordering.md`, not `notes.md` or `stuff.md`.
- **Sized under ~200 lines.** The verifier warns past that. An oversized file's summary stops describing its contents accurately, which breaks search. Split it.
- **Frontmatter-decorated.** Every content file. See [FRONTMATTER.md](FRONTMATTER.md).
- **Self-contained.** A reader arriving from a search hit should be able to use the file alone. Cross-link siblings with `relates-to`; don't rely on read-order.

## The `reference/` category

`reference/` is reserved and scaffolded by `spec-0-init`. It holds `glossary.md` (the
domain vocabulary) and `adr/` (decision records). Those are maintained by
`spec-2-grill` and `spec-3-architect`, not hand-edited here — but link into
them freely from spec files (e.g. a file that uses a term can `relates-to` the
glossary).

## Deeper nesting (rarely needed)

A category may contain a topic subdirectory if a cluster of files genuinely
belongs together (`05-compatibility/per-host/…`). The same rules apply at every
level: a directory's index, if present, describes only its direct children. Most
specs never need this — prefer a flat category of well-named files.
