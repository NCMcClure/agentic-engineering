---
tags: [adr, decision, agent-context-files]
summary: "Decision: AGENTS.md hubs always; CLAUDE.md siblings {{AGENTS_POSTURE_SUMMARY}}. Status: accepted."
created: {{MONTH}}
updated: {{MONTH}}
---

# Agent-context files

AGENTS.md orientation hubs are unconditional: one at the repo root, one in
every non-leaf code directory, no source files beside a hub — the full rules
live in the root AGENTS.md and in the `agent-works` plugin's hub contract
(summarised in `spec-1-specify`'s CODEBASE-LAYOUT.md). This ADR records the one choice that was the user's to make:

{{AGENTS_POSTURE_DECISION}}

When Claude Code support is on, every AGENTS.md carries a sibling CLAUDE.md
whose entire content is `@AGENTS.md` (the import), so there is one source of
truth per directory. The hub check keys the chain off the root CLAUDE.md, and
builders create the sibling whenever they create a hub. Where the agent-works
plugin is installed, the siblings are its generated *twins* (`aw twins`,
git-ignored by default) and nobody writes them by hand. If the
project's needs change, revisit the posture *here* (supersede this ADR) rather
than quietly changing it in one file.
