# Architecture Decision Records

Load-bearing decisions about the design of {{PROJECT_NAME}}: what was decided,
why, and what it rules out. An ADR earns its place only when the decision is
**hard to reverse**, **surprising without context**, and **the result of a real
trade-off**. ADRs are numbered sequentially (`0001-slug.md`, `0002-slug.md`, …)
and created lazily by `spec-2-grill` and `spec-3-architect` — except
`0001-language-posture.md` and `0002-ui-posture.md`, which are seeded at init.

## Records

- [0001 — language posture](0001-language-posture.md) — how spec files express logic (agnostic, or tied to a language).
- [0002 — UI/UX posture](0002-ui-posture.md) — how a human visually verifies the system (headless, dev-dashboard, existing-design-system, greenfield-product).

<!-- One row per ADR, newest last:
- [0001 — slug](0001-slug.md) — one-line summary of the decision. -->
