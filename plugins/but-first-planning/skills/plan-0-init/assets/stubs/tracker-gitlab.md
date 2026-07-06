# Issue tracker: GitLab

Issues for this project are published to GitLab via the `glab` CLI. The plan
tree under `plan/` remains the **source of truth** for structure, dependencies,
and acceptance criteria; GitLab is where work is grabbed, labeled, and closed.

`plan-5-publish-issues` reads this file to learn where and how to publish;
`build-next-issue` reads it to learn where to look for completion state;
`plan-status.py` reads it to pick its `gitlab` sync mode.

- **Project**: `{{GITLAB_PROJECT_PATH}}`
- **Project ID**: `{{GITLAB_PROJECT_ID}}`
- **Host**: `{{GITLAB_HOST}}` (authenticated `glab` CLI)
- **Namespace notes**: if this is a personal namespace, group-level Epics and
  Iterations are unavailable — epics are labels and sprints are milestones
  (see below). That mapping works everywhere, so it is the default either way.

## Field naming: `**GitHub**:` holds the GitLab ref

The plan-tree field name `**GitHub**:` is pinned by `plan/verify-plan-tree.py` —
do **not** rename it. In this project it holds the **GitLab** issue reference:
`<unassigned>` before publish, `#NNN` (the GitLab issue iid) after.

## Label vocabulary

| Label | Meaning |
|---|---|
| `epic::EE-<slug>` | Which epic the issue belongs to. Created **lazily by plan-5** when an epic's first sprint is published. One hue per epic. |
| `status::in-progress` | Work started (issue stays open) |
| `status::blocked` | Blocked; the reason is posted as an issue **comment** |
| `type::HITL` | Needs a human in the loop |
| `type::AFK` | Agent-runnable without supervision |
| `decision` | Decision issue — applied **in addition to** `type::HITL` |

Scoped labels (`::`) require instance support; verify once, and fall back to
plain `epic-EE-<slug>` / `status-...` names if unsupported.

## Status vocabulary mapping

Plan-tree `Status:` ∈ `not-started | in-progress | blocked | done`.

| Plan status | GitLab state | Status label |
|---|---|---|
| `not-started` | open | none |
| `in-progress` | open | `status::in-progress` |
| `blocked` | open | `status::blocked` + reason comment |
| `done` | closed | none (status labels removed on close) |

All transitions go through the funnel — never hand-edit state on both sides:

```bash
python plan/plan-status.py set 01-03-07 in-progress
python plan/plan-status.py set 01-03-07 blocked --evidence "waiting on ADR decision"
python plan/plan-status.py set 01-03-07 done --evidence "checkpoint exits 0"
```

In GitLab mode the funnel updates the plan markdown first, then (best-effort,
warnings only) swaps `status::*` labels, closes/reopens the issue, and posts the
`--evidence` text as a `Blocked:` comment on a blocked transition. Missing
`glab` or `<unassigned>` refs degrade to markdown-only with a warning.

## Sprints as milestones

One milestone per sprint, titled `EE-SS <sprint-slug>`. Created **lazily by
plan-5** when that sprint is published — never pre-create milestones for the
whole plan.

## Board (optional)

Configure the default project board with label lists for `status::in-progress`
and `status::blocked` (Open list = backlog, Closed list = done). Label-driven —
the funnel's label swaps move cards automatically; no board API calls at status
time.

## Publish mechanics

The full recipe (per-sprint label/milestone creation, per-issue `glab issue
create` in dependency order, immediate `#NNN` backfill, published-issue update
commands, and the known `glab` traps) lives in `plan-5-publish-issues`'s
TRACKER-GITLAB.md reference. Prefer the bundled `plan/publish-issues.py` script
over hand-running the commands.
