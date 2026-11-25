---
id: "0015"
title: "Sync that scales to a thousand issues"
status: backlog
order: 1
priority: high
labels: []
skills: []
source: user
created: 2026-02-01T09:00:00.000Z
updated: 2026-02-01T09:00:00.000Z
kind: epic
---

## Goal

A board linked to a repository with a thousand open issues syncs in under ten seconds.

## Done looks like

- One GraphQL round trip per page of issues.
- No pull rewrites a card that did not change.
