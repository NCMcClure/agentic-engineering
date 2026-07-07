# CONTEXT.md format

`CONTEXT.md` lives at the repo root and holds the project's domain language —
one canonical word per concept, the rest listed as aliases to avoid. It is a
glossary and nothing else: no implementation detail, no design rationale, no
scratch notes. Rationale belongs in ADRs (see [ADR-FORMAT.md](ADR-FORMAT.md)).

## Structure

```md
# CONTEXT

{One or two sentences on what this vocabulary covers.}

## Language

**Order**:
A customer's request to purchase one or more items, tracked from placement to fulfilment.
_Avoid_: purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: bill, payment request

**Customer**:
A person or organisation that places Orders.
_Avoid_: client, buyer, account
```

## Rules

- **Be opinionated.** When several words exist for one concept, pick the best and list the others as aliases to avoid.
- **Keep definitions tight.** One or two sentences. Define what the term *is*, not what it does.
- **Show relationships.** Reference other canonical terms by name (capitalised) and express cardinality where it's obvious.
- **Only project-specific terms.** General programming concepts (timeout, retry, cache) don't belong even if the code uses them constantly. Before adding a term, ask: is this unique to *this* project's domain, or just general engineering vocabulary? Only the former.
- **Group under subheadings** when natural clusters emerge; a flat list under `## Language` is fine when they don't.
- **Flag genuine ambiguity.** If a term is still used two ways and you can't yet resolve it, record both senses under a "Flagged ambiguities" subheading with the open question — then resolve it with the user rather than leaving it silently broken.

## One repo, one CONTEXT.md

The repository is a single context: one `CONTEXT.md`. Don't introduce per-area
glossaries — if two parts of the codebase use a term differently, that's a
contradiction to resolve, not two definitions to keep.
