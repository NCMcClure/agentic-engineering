# Frontmatter contract

Every **content** file in the spec begins with a YAML frontmatter block. Index
files do not get frontmatter — they are pure navigation hubs. The frontmatter is
how a reader triages a file *without reading it*: it is the most important
hundred bytes in the file.

## Required shape

```yaml
---
tags: [lowercase-hyphenated, free-form-terms]
summary: "1-2 sentences: what this file covers and its current state."
created: YYYY-MM
updated: YYYY-MM
relates-to:
  - ../other-category/related-file.md
  - reference/glossary.md
---
```

| Field | Required | Type | Semantics |
|-------|----------|------|-----------|
| `tags` | yes | non-empty list of strings | Lowercase, hyphenated, free-form. The primary retrieval signal. |
| `summary` | yes | quoted string, 1–2 sentences | What the file covers and its current state. Must reflect current truth. |
| `created` | yes | `YYYY-MM` | Month the file was first written. Never changes. |
| `updated` | yes | `YYYY-MM` | Month of the last meaningful edit. Drives staleness. |
| `relates-to` | optional | list of relative paths | Sideways cross-references, resolved at read time. |

## Field guidance

**`tags`** — the single most important field for finding the file. Lowercase
only; hyphenate multi-word terms (`event-ordering`, not `event ordering`). Use
the project's own vocabulary over generic words (`migration-rollback` beats
`database`). Three to seven tags: fewer and the file is hard to find, more and
the signal dilutes.

**`summary`** — written for fast triage. Answer two questions: what does this
file cover, and what is its current state (stable / draft / superseded)? "This
file documents X" wastes the space — the file's existence already says that.
Better: "X works by Y, with the caveat Z; current status: draft." Keep it under
~200 characters. A stale summary is a quiet failure: search keeps surfacing the
file and readers keep getting the wrong picture. Bump it whenever the body
meaningfully changes.

**`created` / `updated`** — month granularity (`2026-05`). Day precision is more
than staleness needs and adds diff churn. `created` is immutable; `updated`
moves only when the body meaningfully changes (typo fixes don't count). The
verifier may warn when `updated` is far in the past.

**`relates-to`** — paths relative to *this* file. Use it to link the file that
defines a term you use, a companion file covering an adjacent aspect, or the
decision that informed this content. Do **not** use it as a substitute for index
navigation — it's sideways links between specific files, not a way to enumerate a
category.

## What the verifier checks

`verify-spec-tree.py` treats a missing `---` block on a content file as critical
(`MISSING_FRONTMATTER`), a missing required field as critical
(`INVALID_FRONTMATTER`), a non-`YYYY-MM` date as critical, an empty `tags` list
as a warning, an unresolved `relates-to` link as critical, and frontmatter on an
`index.md` as a warning. Keep it clean and the spec stays cheap to navigate.

## Treat it like a function signature

The frontmatter is the file's interface to the rest of the planning workspace —
search reads it, the glossary links into it, `plan-4-plan` and `plan-6-edit` follow
`relates-to` trails. Keep it accurate, change it deliberately, and never let it
drift from the body. Bad frontmatter doesn't crash anything; it just quietly
surfaces the wrong files at the wrong moments, which is far harder to debug than
a hard failure.
