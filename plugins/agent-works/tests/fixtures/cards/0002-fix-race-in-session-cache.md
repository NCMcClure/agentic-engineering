---
id: "0002"
title: "Fix race in session cache"
status: in-progress
order: 1
priority: high
labels: ["bug","needs triage"]
skills: ["code-review","agent-works:kanban-cards"]
source: claude
created: 2026-01-05T10:00:00.000Z
updated: 2026-01-06T08:30:15.250Z
owner: "worker-2"
needs: "a quiet machine"
ref: "#41"
---

Two writers, no lock.

Files:
- src/cache.ts
- src/session/store.ts
