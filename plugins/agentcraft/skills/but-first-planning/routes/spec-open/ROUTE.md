---
name: spec-open
description: >
  Serves the `.agents/plan/` spec site locally (reusing a running server) and
  opens it in the browser, with inline comments and the live Plan page. Run
  when the user wants to read, review, or comment on the spec.
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

Relay whatever the script prints. If it reports no spec site, the project is
not scaffolded yet: ask the person to run `/agentcraft:but-first-planning spec-init`. If
the server never comes up, the docs toolchain is likely missing:
`pip install mkdocs mkdocs-shadcn mkdocs-awesome-pages-plugin`. On a remote or
headless host the browser will not open: pass on the printed URL so the user
can open it (or their forwarded port).
