---
tags: [adr, decision, user-docs-posture]
summary: "Decision: {{DOCS_POSTURE_SUMMARY}}. Status: accepted."
created: {{MONTH}}
updated: {{MONTH}}
---

# User-docs posture

{{DOCS_POSTURE_DECISION}}

This governs the shape of the *end-user* documentation (the product docs, not
this spec site). `spec-1-specify` reads it to write the mandatory
`user-docs-plan.md` page (docs stack + page map); `plan-0-decompose` cuts the
early docs-skeleton issue from that page; `build-user-docs` writes into the
recorded stack after each verified sprint instead of guessing a layout. If the
project's needs change, revisit the posture *here* (supersede this ADR) rather
than quietly changing it in one file.
