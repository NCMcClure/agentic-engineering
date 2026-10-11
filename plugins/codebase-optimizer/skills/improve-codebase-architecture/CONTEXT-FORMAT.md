# Glossary format

The glossary lives at `.agents/CONTEXT.md` (or the `paths.glossary` of
`.agents/agent-works.json` when that file exists). Never at the repo root and
never under `./docs`, which is for user-facing documentation.

Keeping the glossary is agent-works' job (`agent-works:decisions` /
`aw decisions lint`). Without it: keep the file by hand in the format below.

```md
# CONTEXT

{One or two sentences on what this vocabulary covers.}

## Language

**Order**:
A customer's request to purchase one or more items, tracked from placement to fulfilment.
_Avoid_: purchase, transaction
```

- One canonical word per concept; the other words go under _Avoid_.
- One or two sentences: what the term *is*. No rationale (that is a decision record, see [ADR-FORMAT.md](ADR-FORMAT.md)) and no implementation detail.
- Project-specific terms only; general engineering vocabulary stays out.
- One glossary per repo. A term used two ways is a contradiction to resolve with the user, not two entries.
