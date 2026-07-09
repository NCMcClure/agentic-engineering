---
tags: [adr, decision, ui-posture]
summary: "Decision: {{UI_POSTURE_SUMMARY}}. Status: accepted."
created: {{MONTH}}
updated: {{MONTH}}
---

# UI/UX posture

{{UI_POSTURE_DECISION}}

This governs how a human visually verifies the system. `spec-1-specify` reads
it to decide what UI/UX content the spec carries (design system, key screens,
verification surfaces, prototypes); `plan-0-decompose` reads it to decide
whether and where to cut `REVIEW` (human visual-verification) issues; the build
skills treat those issues as human gates that are never auto-built. If the
project's needs change, revisit the posture *here* (supersede this ADR) rather
than quietly changing it in one file.
