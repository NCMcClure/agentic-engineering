---
name: decisions
description: Use for a hard-to-reverse choice, a new project term, or an agent contract page.
---

# decisions

Three references live beside each other under `.agents/`: decision records (`.agents/decisions/`), the glossary
(`.agents/CONTEXT.md`) and contract pages (`.agents/contracts/`). None of them goes under `./docs`, which is for
the project's users. The contract is `${CLAUDE_PLUGIN_ROOT}/core/references/decisions.md`.

## Step 1 — Does the choice deserve a record

Write a record when at least one holds: the choice is **hard to reverse**; it is **surprising without context**
(a later reader would "fix" it); it was a **real trade-off**. Otherwise it is a commit message, or a memory of
type `decision` (the `memory` skill).

Read `.agents/decisions/README.md` first: a record on the subject may exist. That index is generated when it
carries the marker of `aw decisions index`; one written by hand is kept as it is (`DEC_INDEX_HANDWRITTEN`), and
only `aw decisions index --adopt` replaces it.

*Done when: you can name which of the three holds, or you have sent the choice elsewhere.*

## Step 2 — Write the record

```
aw decisions new "<title>"
```

It takes the next number, starts the file from `${CLAUDE_PLUGIN_ROOT}/assets/templates/decision.md` and rewrites
the index (a hand-written index gets the record's one line). The heading takes the form the folder's latest
records use (`# ADR 0014: Title` where they are titled so). Records the project already has in the ADR form,
with `- **Status:** accepted` and `**Sources:** …` as lines under the title, are read as they are: do not
rewrite them to pass the lint. Fill the five sections: Status, Sources, Context, Decision, Consequences. 150 lines at most: numbers
and long reasoning go into a memory that the record links. Set Status to `accepted` only when the owner, or
whoever owns the choice, accepted it.

*Done when: the five sections are filled, and Sources links to where the decision came from.*

## Step 3 — A decision changed: supersede

A record takes one `## Amendment`, for a correction that leaves the choice as it is. When the choice itself
changes: write a new record (Step 2) whose Context says what changed, and set the old record's Status to
`superseded by NNNN`. Never rewrite an accepted record's Decision.

*Done when: the old record points at the new one, and no record carries a second amendment.*

## Step 4 — Words

A term the project uses with a meaning of its own gets one row in `.agents/CONTEXT.md` (Term, Meaning, Source), in
the same change that introduces it. Before naming something, read the glossary and use its word. A second
glossary (a root `CONTEXT.md`, one under the user docs) is merged into this one.

*Done when: every new term of your change has its row, and no term has two.*

## Step 5 — Contract pages

A page an agent needs to change the project safely (a protocol, a file format, what an extension implements)
lives in `.agents/contracts/` and changes in the same commit as the thing it describes.

*Done when: the page and the code it describes agree after your change.*

## Step 6 — Check

```
aw decisions lint
aw links
```

The first checks records, index and glossary (`DEC_*`, `GLOSSARY_*`: the contract's table says how to repair
each); the second that the links and paths in every agent file resolve.

*Done when: both exit 0, or what remains was there before your change and is in your report.*
