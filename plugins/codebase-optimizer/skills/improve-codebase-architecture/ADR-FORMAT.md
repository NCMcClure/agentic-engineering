# Decision record format

Decision records (ADRs) live at `.agents/decisions/NNNN-slug.md` (or under the
`paths.decisions` of `.agents/agent-works.json` when that file exists). Never
under `./docs`, which is for user-facing documentation.

Writing, numbering, indexing and superseding decision records is agent-works'
job (`agent-works:decisions` / `aw decisions new`). Without it: take the
highest number in the folder plus one, create the folder if it is missing, and
write the minimal record below.

```md
# {Short title of the decision}

{1–3 sentences: the context, what was decided, and why.}
```

Add **Status**, **Considered options** or **Consequences** only when they say
something the paragraph does not.

## When to offer one

All three must hold: the decision is **hard to reverse**, **surprising without
context**, and **the result of a real trade-off**. In an architecture review
that is mostly:

- a rejected deepening candidate with a load-bearing reason, so a later review does not suggest it again;
- an architectural shape or a scope decision, the explicit *no*s included;
- a deliberate deviation from the obvious design, so nobody "fixes" it.

The glossary says what a term *means* ([CONTEXT-FORMAT.md](CONTEXT-FORMAT.md));
a decision record says *why* a choice was made.
