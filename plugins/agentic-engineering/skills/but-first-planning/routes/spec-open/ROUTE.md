---
name: spec-open
description: >
  Serves the project workspace's spec site (`.agents/plan/`) locally, reusing a
  running server, and opens it in the browser, with inline comments and the
  live Plan page. Run when the user wants to read, review, or comment on the
  spec.
---

# spec-open: view the spec site

`W` below is `../..` from the directory this file is in: the area's own directory. Write it out as an absolute path wherever a command or an argument says `W`.

Bring the spec docs site up and open it in the default browser, reusing the
server if one is already running. Run the bundled helper from the repo root:

```bash
node "W/routes/spec-open/spec-open.mjs"
```

It probes `http://127.0.0.1:8000/__spec_comments__`: if the server is already
up it just opens the browser; otherwise it starts
`.agents/plan/spec/scripts/comments-server.py` (which serves the site, the
inline-comment API, and the plan-status API on one port), waits for it to
respond, then opens the browser. `SPEC_PORT` names another port, and
`SPEC_ROOT` (or a path argument) another repo; from a subdirectory it walks up
to the repo that owns `.agents/plan/`.

The served site includes a live **Plan** page at `<url>/plan/`: the plan tree
rendered with statuses, blockers, acceptance progress, and the next unblocked
issue, refreshed as `plan-status.mjs` flips statuses. For local-tracker
projects it is the issue board.

**A named workspace has no site.** If the spec the person means is one under
`.agents/plans/<name>/`, start nothing: tell them its pages are markdown, give
them `.agents/plans/<name>/spec/index.md` to open, and offer the plan's status
(`node .agents/plans/<name>/plan/plan-status.mjs check`). The script says the
same when it finds named workspaces and no site.

Relay whatever the script prints. If it reports no spec site, the project is
not scaffolded yet: that is the `spec-init` route (`/agentic-engineering:but-first-planning spec-init`),
the person's to start, so ask them and take it on their yes. If
the server never comes up, the docs toolchain is likely missing:
`pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin`. On a remote or
headless host the browser will not open: pass on the printed URL so the user
can open it (or their forwarded port).
