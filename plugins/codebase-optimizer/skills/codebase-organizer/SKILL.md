---
name: codebase-organizer
description: >
  Reorganize a sprawling file tree into a progressive-disclosure layout: plan,
  history-preserving git mv, reference rewriting, AGENTS.md hubs, verified by
  the repo's own build. Use when the ask is about the tree alone (the root is a
  mess, too many top-level files, organize the folder structure, add AGENTS.md
  hubs to this repo). Nothing moves until the person has approved the plan. To
  split god-files in the same pass use optimize-codebase.
---

# Codebase organizer

Turn a large, unwieldy codebase with a bloated root into something a newcomer
can navigate in thirty seconds: the test the whole skill optimizes for. It
runs in four beats: **scan & plan → you approve → apply → verify.** Planning is
read-only and produces a concrete target tree plus a move list; nothing on disk
changes until you approve; applying preserves git history and keeps the build
green by rewriting references; verification runs the project's own tests.

The organizing taste lives in `references/philosophy.md` (the nine principles)
and `references/language-layouts.md` (idiomatic target trees per ecosystem).
Reference-fixing detail lives in `references/reference-rewriting.md`, and the
AGENTS.md orientation-hub contract in `references/agent-hubs.md`: the reorg
doesn't just shape the tree, it writes the hubs that make it self-describing.
The two workflow scripts under `workflows/` carry the fan-out; you orchestrate
them. Three Node scripts under `scripts/` supply the facts: `repo-scan.mjs`
(the recon), `verify-hubs.mjs` (the hub checker) and `verify-structure.mjs`
(the gate that grades both and exits on the worst finding).

`Workflow()` is not in every session. When it is unavailable, run the same
beats as a parallel-subagent fan-out under the contract in
[../../references/subagent-fallback.md](../../references/subagent-fallback.md).
The approval gate in Beat 2 does not move either way.

## When to reach for this

Reorganizing a real codebase is high-stakes (you're moving the user's files and
can break their build), multi-step, and benefits enormously from parallel
analysis: exactly what a Workflow is for. Use it for any "this repo is a mess,
fix the layout" request. For a single obvious move ("put these two files in a
`utils/` folder") just do it directly; the workflow overhead isn't worth it.

## Prerequisites: check before planning

1. **The target is a git repository.** History-preserving moves and the safety
   net both depend on git. If it isn't one, tell the user and offer to `git
   init` first, or stop. Confirm with `git -C <repo> rev-parse --is-inside-work-tree`.
2. **Know the repo path.** If the user didn't give one, ask; default to the
   current working directory only if that's clearly the repo they mean.
3. **Working tree is clean (strongly preferred).** Uncommitted changes muddy the
   safety net. If dirty, recommend committing or stashing first. The apply phase
   re-checks this and will refuse to run on a dirty tree unless explicitly told
   to proceed on a fresh branch.
4. **`node` is on PATH.** The three scripts are Node 22, standard library only,
   and run on a repo of any language.

## Beat 1: Scan and plan (read-only)

Run the planning workflow. It runs the deterministic recon script, fans out
read-only `Explore` agents to characterize the tree, designs the target layout,
predicts the reference impact of every move, and adversarially critiques its own
plan before returning it.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/workflows/organize-plan.js",
  args: {
    projectDir: "<absolute repo path>",
    dateToday: "<YYYY-MM-DD>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer",
    depth: "recursive",           // "recursive" (default) or "root-only"
    hubs: "on",                   // "on" (default) | "only" (hubs, no moves) | "off"
    claudeMd: "detect"            // "detect" (default: read it from the repo) | true | false
  }
})
```

`skillDir` is the directory containing this SKILL.md; the workflow finds
`scripts/repo-scan.mjs` and the references through it. Stamp `dateToday`
yourself: the workflow sandbox has no clock.

The workflow returns `{ plan_path, plan }`. The `plan` object holds the proposed
**target tree**, an ordered **move list** (each move = `from`, `to`, rationale,
and predicted `ref_impact`), any **new_files** to scaffold (e.g. package
`__init__.py`), a **cruft/ephemera** section (quarantine vs `.gitignore`), the
**hubs** list (AGENTS.md orientation hubs drafted for the post-move tree per
`references/agent-hubs.md`), **claude_md** (`"twin"` or `"none"`, with
`claude_md_reason`), and the critic's **verdict and risks**.

**You must persist the returned `plan` to disk yourself**: write it as JSON to
`plan_path` (`<repo>/.codebase-organizer-plan.json`) with the Write tool. The
workflow deliberately does *not* write the file: its runtime has no filesystem
access, and a large plan is far too big to hand to a transcription agent without
stalling. You have the plan object in the result and Write access, so saving it
is a one-step operation on your side. The apply workflow reads it from that path.

## Beat 2: Present the plan and get explicit approval

**This is a required human gate. Workflows run headless and cannot ask
mid-run, so the approval happens here, in the conversation, between the two
workflow calls.** Do not invoke the apply workflow until the user says yes. The
apply workflow enforces it from its side: without `approved: true` it returns
`aborted: "Approval"` and touches nothing, and you set that argument only after
the person has seen this plan and agreed to it. A yes to an earlier plan, or to
"organize my repo", is not a yes to this one.

Show the user, concisely:

- **Before → after at the root:** how many loose files become how few, and the
  proposed top-level directories with their one-line purposes.
- **The headline moves:** the overstuffed dirs being split and how; any
  ecosystem-layout shift (e.g. adopting `src/`).
- **Cruft to quarantine** (to `archive/`, for *their* later deletion, never
  auto-deleted) and **ephemera to gitignore**.
- **The risks list verbatim**: especially anything touching dynamic imports,
  build config semantics, or large refactors. Be honest about blast radius.
- **The hub list:** which directories gain or refresh an `AGENTS.md`, with the
  root hub's Layout lines shown as the preview. Existing hubs are merged, never
  clobbered.
- **The CLAUDE.md twins:** one line from the plan's `claude_md` and
  `claude_md_reason`. `"twin"` means each new hub gets a `CLAUDE.md` beside it
  that is a symlink to `AGENTS.md` (or the one line `@AGENTS.md` where a symlink
  cannot be made); `"none"` means the repo keeps hubs without twins. Nobody is
  asked, but they can overrule it: change `claude_md` in the plan JSON, or
  re-plan with `claudeMd: true` or `false`.

Then let them approve, approve-with-changes, or decline. If they want changes,
adjust the plan (you can edit the plan JSON or re-run planning with guidance)
and re-present. A reorg the user didn't fully understand is a reorg that erodes
trust when their build breaks, so over-communicate here.

## Beat 3: Apply (mutating, only after approval)

Run the apply workflow against the approved plan.

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/workflows/organize-apply.js",
  args: {
    projectDir: "<absolute repo path>",
    dateToday: "<YYYY-MM-DD>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer",
    planPath: "<repo>/.codebase-organizer-plan.json",
    branch: "codebase-organizer/reorg",  // it works on a fresh branch by default
    approved: true                       // only once the person has said yes to THIS plan
  }
})
```

It re-asserts a clean tree, creates the working branch, performs each move with
`git mv`, quarantines cruft, rewrites references per the plan's recipes,
re-greps for anything missed, writes the planned AGENTS.md hubs (merging with
any pre-existing ones, plus the `CLAUDE.md` twins when the plan says so), then
runs **Beat 4** inline.

## Beat 4: Verify (inside the apply workflow, surfaced to you)

The apply workflow detects and runs the project's own build/test/lint (`pytest`,
`npm test` / `tsc`, `go build ./...`, `cargo test`, or a `Makefile`/CI target)
and, when hubs are in play, the structure gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/codebase-organizer/scripts/verify-structure.mjs" <repo> --strict --json
```

Its exit code is the verdict. **2, a CRITICAL finding, fails the apply**: in
strict mode that is a hub the apply just wrote that leaves a child unnamed,
names a path that is gone, or has source beside it, or a Python package
directory without its `__init__.py`. **1 is warnings only and never fails it**:
a `CLAUDE.md` with content of its own, a directory still without a hub, cruft,
an overstuffed directory. They are reported so the person hears about them.
The full ladder is in `references/agent-hubs.md`.

A green result is the success criterion. If it's red, the workflow reports
exactly what broke and the suspected missed reference; relay that and propose
next steps: fix forward, or discard the branch (`git checkout <original-branch>`
then `git branch -D <branch>`). The apply never commits and never touches the
user's original branch, so the tree they started from is one command away.

## Hubs-only runs

"Add AGENTS.md hubs to my repo", a tidy tree that just lacks orientation, routes
through the same pipeline as the degenerate case, not a separate mode: run
planning with `hubs: "only"` (Design is skipped, zero moves; hubs are drafted
against the current tree), present the hub list at the same gate, and apply.
Verification reduces to a fast resolution-level build check plus the structure
gate, since no code moved.

## Reporting back

Summarize: root file count before → after, top-level dirs created, overstuffed
dirs split, moves applied, references rewritten, cruft quarantined, hubs
written/merged (and CLAUDE.md twins, if any) with the structure gate's summary
(`structure_summary`: critical, warning, info, and what failed), and the
verification result. Tell the user the work is on branch `<branch>` and that
nothing was deleted: quarantined files await their review under `archive/`.
Remind them to review the diff before merging.

## Guardrails

- **Never delete files.** Cruft is quarantined to `archive/` and flagged; the
  human decides. Ephemera is `.gitignore`d, not removed.
- **Never run apply without explicit approval** of the specific plan, and never
  pass `approved: true` on your own judgment.
- **Always work on a branch / clean tree** so the tree they started from is one
  command away.
- **Predict before you move**: every move carries its reference impact so the
  build can stay green; relay risky/dynamic references rather than guessing.
- **Honor the ecosystem's idioms** over a generic template (see
  `references/language-layouts.md`).
- For the full reasoning behind these, read `references/philosophy.md`.
