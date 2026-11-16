# Decision record format

Decision records (ADRs) live at `.agents/decisions/NNNN-slug.md`: sequential
numbers, `0001-slug.md`, `0002-slug.md`, and so on. When `.agents/agent-works.json`
exists, its `paths.decisions` names the folder instead. Never under `./docs`,
which is for user-facing documentation: a `docs/adr/` folder is not read, so
move what it holds.

If the agent-works plugin is installed, numbering, indexing and superseding
records is its job; use it. Without it: take the highest number in the folder
plus one, create the folder if it is missing, and write the record below.

## Template

```md
# {Short title of the decision}

{1-3 sentences: the context, what was decided, and why.}
```

That's it. A record can be a single paragraph. The value is recording *that* a
decision was made and *why*, not filling out sections.

## Optional sections

Include only when they add genuine value (most records won't need them):

- **Status**: `proposed | accepted | deprecated | superseded by ADR-NNNN`, useful when decisions get revisited.
- **Considered options**: only when the rejected alternatives are worth remembering.
- **Consequences**: only when non-obvious downstream effects need calling out.

## When to offer one

All three must be true:

1. **Hard to reverse**: changing your mind later carries real cost.
2. **Surprising without context**: a future reader will wonder "why on earth did they design it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and one was chosen for specific reasons.

If a decision is easy to reverse, skip it: you'll just reverse it. If it isn't
surprising, nobody will wonder. If there was no real alternative, there's nothing
to record beyond "we did the obvious thing."

### What qualifies in an architecture review

- **A rejected deepening candidate with a load-bearing reason**: record it so a future review doesn't re-suggest the same refactor.
- **Architectural shape.** "The write path is event-sourced; the read path is a projection."
- **Boundary and scope decisions.** "Identity is owned by one module; others reference it by id only." The explicit *no*s are as valuable as the *yes*es.
- **Deliberate deviations from the obvious design.** Anything where a reasonable reader would assume the opposite: record it so the next person doesn't "fix" what was intentional.
- **Non-obvious rejected alternatives.** If an approach was considered and rejected for subtle reasons, record it, or someone re-proposes it in six months.

## Decision records and the glossary

- **The glossary**: what a term *means*. No rationale (see [CONTEXT-FORMAT.md](CONTEXT-FORMAT.md)).
- **A decision record**: *why* a particular load-bearing choice was made, especially when it isn't self-evident from the code.
