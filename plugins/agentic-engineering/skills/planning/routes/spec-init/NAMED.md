# A named workspace: one feature's or task's spec and plan

`W` below is the area's own directory and `P` the workspace this run works in, as the route that sent you here settled them.

The project workspace, `.agents/plan/`, is the whole system's spec and plan,
and setting it up is an interview. Most work is smaller than a system and
still bigger than one card: a feature, a migration, a long refactor, a task
that will take several sessions. That work gets a workspace of its own,
`.agents/plans/<name>/`, with no interview and almost nothing in it.

## When one is right

- The work needs more than one session or more than a handful of issues, and
  someone other than this session will pick part of it up.
- The repo has no project workspace, or has one and this work is not a
  chapter of the system's spec: it has its own done.
- The person asked for one, by `--plan <name>` or in words.

Where the repo has a project workspace and the work is a change to what the
system *is*, it belongs there instead: that is `spec-edit` in `.agents/plan/`.
A task one session finishes needs neither: `grill` it and build it.

## Making it

Pick a name: lowercase letters, digits and dashes, starting with a letter,
forty characters at most, said the way the team says the work
(`billing-export`, `auth-migration`). `project` is taken: it is how the
project workspace is named where a name is asked for. Say the name and what
it is for in one line before you make it, then:

```bash
node "W/routes/spec-init/scaffold.mjs" --workspace <name> --title "<what the team calls it>"
```

It writes only what is missing, so running it again is safe:

```
.agents/plans/
├── _scripts/                 # the scripts every named workspace shares (written once)
└── <name>/
    ├── spec/
    │   ├── index.md          # the hub; spec-write puts pages beside it
    │   └── scripts/verify-spec-tree.mjs    # launcher
    ├── plan/
    │   ├── index.md          # the empty plan, with its plan-format marker
    │   ├── plan-status.mjs                 # launcher
    │   ├── publish-issues.mjs              # launcher
    │   └── verify-plan-tree.mjs            # launcher
    └── progress/
        ├── index.md
        ├── drift-status.mjs                # launcher
        └── completed/  notes/  drift/
```

A launcher runs the shared copy of the script it is named for against the
workspace it sits in, so every command a route gives reads the same here as in
the project workspace: `node P/plan/plan-status.mjs check`. Run the shared
copy directly and it refuses, naming the workspaces there are.

Then check it, and commit what was written:

```bash
node P/spec/scripts/verify-spec-tree.mjs   # expect: OK: 0 categories, 0 content files, 1 index hubs ... (exit 0)
node P/plan/verify-plan-tree.mjs           # expect: OK: 0 epics, 0 sprints, 0 issues ...
node P/plan/plan-status.mjs check          # expect: "plan tree of <name>: not-started" (exit 1, nothing built yet)
```

If the repo's root `AGENTS.md` has a Layout list and no line for
`.agents/plans/` yet, add one and change nothing else in it:

```
- `.agents/plans/` - named planning workspaces, one per feature or task: its spec (`spec/`), its backlog (`plan/`), its progress. Owned by the planning skills; never hand-edit a status.
```

## What it leaves out, and where that comes from

| Not scaffolded | A named workspace uses |
|---|---|
| `tracker.md` | its own if it has one, else `.agents/plan/tracker.md`, else nothing: the plan tree is the tracker. To publish from a repo with no project workspace, write `P/tracker.md` from `W/routes/spec-init/assets/stubs/tracker-github.md` or `tracker-gitlab.md`. |
| the three posture ADRs | the project's, under `.agents/plan/spec/reference/adr/`. Without a project workspace there is no posture to record: the code that is there is the language, the UI and the docs convention. |
| the glossary and ADR folder | the project's, for reading. A term or decision that belongs to this work alone goes in `P/spec/reference/`, made when the first one is. One that reaches past this work is the project's: change it there, through `spec-edit --plan project`, and link to it. |
| `repository-layout.md`, `user-docs-plan.md` | the project spec's. The verifier does not ask a named workspace for them. |
| the spec site | nothing. The pages are markdown, read on disk or on the forge. |
| a plan-gate config | `"taskGate": true` in `.agents/plan/config.json`, or in `.agents/plans/config.json` where there is no project workspace, turns the gate on for every workspace. |

On a forge, what a named workspace publishes says its name: a `plan:<name>`
label on GitHub, and on GitLab the epic label and the milestone
(`epic::<name>.01-core`, `<name>.01-01 store`). On the agent-works board its
issues are `<name>.EE-SS-II`.

## When it is done

A named workspace whose plan checks done has served its purpose. It stays in
the repo as the record, or the person deletes the directory: git has it
either way. Nothing else names it.
