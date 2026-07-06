# ADR format

Architecture decision records live under `.plan/spec/reference/adr/` and render
on the spec website. They use sequential numbering: `0001-slug.md`,
`0002-slug.md`, … Scan the folder for the highest existing number and increment.

Because ADRs render on the site, each one carries frontmatter like any content
file. After writing one, add a line to `.plan/spec/reference/adr/index.md`.

## Template

```md
---
tags: [adr, decision, <topic>]
summary: "Decision: <one line>. Status: accepted."
created: 2026-05
updated: 2026-05
---

# {Short title of the decision}

{1–3 sentences: the context, what was decided, and why.}
```

That's it. An ADR can be a single paragraph. The value is recording *that* a
decision was made and *why* — not filling out sections.

## Optional sections

Include only when they add genuine value (most ADRs won't need them):

- **Status** — `proposed | accepted | deprecated | superseded by ADR-NNNN`, useful when decisions get revisited.
- **Considered options** — only when the rejected alternatives are worth remembering.
- **Consequences** — only when non-obvious downstream effects need calling out.

## When to offer an ADR

All three must be true:

1. **Hard to reverse** — changing your mind later carries real cost.
2. **Surprising without context** — a future reader will wonder "why on earth did they design it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and one was chosen for specific reasons.

If a decision is easy to reverse, skip it — you'll just reverse it. If it isn't
surprising, nobody will wonder. If there was no real alternative, there's nothing
to record beyond "we did the obvious thing."

### What qualifies in a spec

- **Architectural shape.** "The write path is event-sourced; the read path is a projection." "The system is a single service, not a fleet."
- **Integration patterns.** "Subsystems communicate by events, not synchronous calls."
- **Boundary and scope decisions.** "Identity is owned by one subsystem; others reference it by id only." The explicit *no*s are as valuable as the *yes*es.
- **Deliberate deviations from the obvious design.** Anything where a reasonable reader would assume the opposite — record it so the next person doesn't "fix" what was intentional.
- **Constraints not visible in the spec prose.** "Must operate offline." "Latency budget is 200ms because of a partner contract."
- **Non-obvious rejected alternatives.** If you considered an approach and rejected it for subtle reasons, record it — otherwise someone re-proposes it in six months.

## ADRs vs the glossary vs spec files

- **Glossary** — what a term *means*. No rationale.
- **Spec file** — how the system *behaves*. The source of truth for the design.
- **ADR** — *why* a particular load-bearing choice was made, especially when it isn't self-evident from the spec. An ADR explains; it doesn't replace the spec text describing the behaviour.
