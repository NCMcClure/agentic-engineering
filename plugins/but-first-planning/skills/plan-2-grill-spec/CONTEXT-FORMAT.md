# Glossary format

The glossary lives at `.plan/spec/reference/glossary.md` and renders on the spec
website. It is a single, opinionated list of the project's domain terms — one
canonical word per concept, the rest listed as aliases to avoid. It is a
glossary and nothing else: no implementation detail, no design rationale, no
scratch notes. Those belong in spec files and ADRs.

Because it's a content file on the site, it keeps its frontmatter (`tags`,
`summary`, `created`, `updated`). Bump `updated` when you add or sharpen terms.

## Structure

```md
---
tags: [glossary, terminology, domain-language]
summary: "The opinionated vocabulary for {Project}. One canonical term per concept, aliases to avoid."
created: 2026-05
updated: 2026-05
---

# Glossary

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
- **Only project-specific terms.** General programming concepts (timeout, retry, cache) don't belong even if the spec uses them constantly. Before adding a term, ask: is this unique to *this* project's domain, or just general engineering vocabulary? Only the former.
- **Group under subheadings** when natural clusters emerge; a flat list under `## Language` is fine when they don't.
- **Flag genuine ambiguity.** If a term is still used two ways and you can't yet resolve it, record both senses under a "Flagged ambiguities" subheading with the open question — then resolve it in a later question rather than leaving it silently broken.

## One spec, one glossary

The planning workspace is a single context: one `glossary.md`. Don't introduce
per-area glossaries — if two parts of the spec use a term differently, that's a
contradiction to resolve, not two definitions to keep.

## Optional: example dialogue

A short exchange between a developer and a domain expert that shows the terms
interacting naturally can clarify boundaries better than definitions alone. Add
one at the end of the glossary if the relationships between terms are subtle.
