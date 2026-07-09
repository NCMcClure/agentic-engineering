---
name: spec-open
description: Serve the .plan/ spec docs site (reusing a running instance) and open it in the browser. Use when the user wants to view, open, preview, or read the spec site, or to leave inline comments on it — "open the spec", "serve the docs", "let me review the spec". Requires .plan/.
---

# spec-open — view the spec site

Bring the spec docs site up and open it in the default browser, reusing the
server if one is already running. Run the bundled helper from the repo root:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/spec-open/spec-open.sh"
```

It probes `http://127.0.0.1:8000/__spec_comments__`: if the server is already up
it just opens the browser; otherwise it starts `.plan/spec/scripts/comments-server.py`
(which serves the site, the inline-comment API, and the plan-status API on one
port), waits for it to respond, then opens the browser.

The served site includes a live **Plan** page at `<url>/plan/` — the plan tree
rendered with statuses, blockers, acceptance progress, and the next unblocked
issue, refreshed as `plan-status.py` flips statuses. For local-tracker projects
it is the issue board. If a workspace scaffolded before plugin 3.4 has no Plan
entry in the nav, offer the spec-0-init backfill exception (copy the plan-page
stub, the `plan-view` assets, and the current `comments-server.py` into place).

Relay whatever the script prints. If it reports no `.plan/`, the project isn't
scaffolded yet: point the user at `spec-0-init`. If the server never comes up,
the docs toolchain is likely missing: `pip install mkdocs mkdocs-shadcn
mkdocs-awesome-pages-plugin`. On a remote or headless host the browser won't pop
open: pass on the printed URL so the user can open it (or their forwarded port).
