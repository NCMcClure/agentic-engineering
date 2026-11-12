---
name: build-audit
description: >
  Audits a finished plan tree for what the plan missed (unbuilt or unreachable
  spec promises, onboarding holes, thin tests, missing docs) and turns
  confirmed gaps into a new epic. Run when a plan tree or an epic is done and
  a gap audit is wanted.
disable-model-invocation: true
---

# build-audit: what did the plan miss?

A completed plan tree proves the plan was built; it says nothing about what the
plan never contained. Spec promises can ship unreachable from any entrypoint,
first-run UX can be a dead end no issue ever covered, test suites can be green
yet toy-sized, benchmarks and end-user docs can simply never have been cut as
issues. This skill runs a full-corpus audit *after* the build: it maps every
promise the spec makes, hunts gaps across independent dimensions, adversarially
verifies each finding against the live code, and turns the survivors into one
new epic in the plan tree, ready for `plan-publish`-style publishing
and the normal build loop.

It is a fan-out-heavy workflow (dozens of subagents), so it never triggers on
its own, invoke it deliberately, once per finished tree or epic.

## What it reads

- `.agents/plan/spec/`, every content page, category by category, to build the
  promise ledger (the spec is the source of truth for what was promised).
- The live code, tests, entrypoints, and top-level docs, where the gaps show.
- `.agents/plan/progress/drift/`, owner calls and parked items worth promoting now.
- `.agents/plan/plan/`, the existing epics, as calibration exemplars and for the next
  free epic number.
- This plugin's own contracts: `plan-decompose/PLAN-FORMAT.md`,
  `VERTICAL-SLICES.md`, `build-user-docs/SKILL.md` (doc taxonomy).
- Optionally, usage transcripts (only the directories the user explicitly
  allows), to ground a session-fixtures dimension.

## What it hunts

Eight base dimensions: spec-vs-code (promises with no or stub implementation),
reachability (can a user actually get there from a shipped entrypoint),
onboarding/UX, end-user docs, test coverage, benchmarks, drift owner-calls
worth promoting, and unscheduled debt markers. A ninth, session-fixtures,
activates only when the user grants transcript access. A completeness critic
then commissions up to four follow-up finders for whatever the base set
missed, and every merged finding faces an adversarial verifier before it can
become an issue.

## Process

### 1. Confirm the audit is ripe

The plan tree (or at least the epic being audited past) should be done:
`node .agents/plan/plan/plan-status.mjs check` and a recent `build-next-issue`
reconcile with no open done-claim disputes. Auditing a half-built tree just
rediscovers the backlog.

### 2. Interview for the args

Everything project-specific arrives through args, the workflow itself is
project-agnostic. Gather:

- **projectBrief** (required), 2-6 sentences: what the project is, what the
  finished tree covered, what the owner most wants the audit to find.
- **epicNumber**: the next free `NN` from `.agents/plan/plan/index.md`.
- **knownDebt**: standing debt the owner already knows about, so finders
  sharpen it into buildable pieces instead of proudly rediscovering it.
- **hardRules**: extra bounds as plain sentences (out-of-bounds paths,
  predecessor repos not to cite, anything the finders must not touch).
- **commissioned**: owner-granted scope exceptions: work the scope table
  would normally exclude but the owner is explicitly commissioning.
- **transcriptDirs** (opt-in), transcript directories the session-fixtures
  finder may sample. Omit it and that whole dimension is skipped.
- **uiCapture** (opt-in), a one-line capture command template (binary,
  geometry, output path) that lets the UX finder drive the real UI and read
  the screenshots back. Omit it and the finder judges from spec + code + any
  signed-off captures only.

### 3. Launch the workflow (publish off)

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-audit/workflows/build-audit.js",
  args: {
    root: "<absolute repo root>",
    pluginRoot: "${CLAUDE_PLUGIN_ROOT}",
    epicNumber: "NN",
    projectBrief: "<2-6 sentences of project context>",
    // knownDebt: "<standing debt to sharpen, not restate>",
    // hardRules: ["<extra bound>", ...],
    // commissioned: "<owner-granted scope exceptions>",
    // transcriptDirs: ["<allowed transcript dir>", ...],
    // uiCapture: "<capture command template>",
    // publish: false (default), forceModel: "<model>", maxEpicIssues: 30
  }
})
```

Pre-approve the project's test/build commands in permissions first so finders
don't stall. `forceModel` collapses the model-tier policy to a single model
for the whole run.

### 4. Walk the report with the user

The workflow authors the epic to disk (uncommitted) and returns a report.
Present it in this order:

1. **`ownerDecisions`**: scope/product questions only the owner can answer;
   each carries the exact question. These never became issues.
2. **`epic`**: the sprint/issue tree it authored, with `epicPath`.
3. **`deferred`**: findings cut by the issue cap, each with its reason.
4. **`refuted`**: what the adversarial pass killed, for confidence.
5. **`treeGreen`/`treeProblems`**: whether `verify-plan-tree.mjs` passes.

The user edits or prunes the epic like any plan-tree change (`spec-edit`
for anything that ripples into the spec).

### 5. Publish (opt-in second pass)

Once the user approves the epic, re-invoke with `resumeFromRunId` from the
first run and `publish: true`, every phase before Publish replays from the
workflow cache (the publish flag isn't referenced in any earlier prompt), so
only the tracker work runs live. It drives `publish-issues.mjs` per sprint,
idempotently: one ticket per issue on the tracker `tracker.md` names.

**Converged when** the epic exists on disk, `verify-plan-tree.mjs` is green,
every confirmed finding is an issue / a deferred entry / an owner decision,
and (if publishing) every issue carries its `#NNN`.

## Scope boundary

The workflow writes only the new epic directory and the one new row (plus
Total arithmetic) in `.agents/plan/plan/index.md`, never the spec, never existing
epics, never drift files. It is read-only toward git: the user reviews and
commits the epic themselves.

## Without the Workflow tool

Where the session has no `Workflow()` tool, run the same phases with parallel
subagents instead, in the same order, with the parent session owning every
shared file and the status funnel:
[references/subagent-fallback.md](../../references/subagent-fallback.md) is
the contract, and it is what keeps an autonomous run there from quietly
becoming a different, unverified run.
