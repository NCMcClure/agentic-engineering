---
name: codebase-organizer
description: >
  Reorganize a sprawling file tree into a progressive-disclosure layout — plan,
  history-preserving git mv, reference rewriting, build verification. Use for
  tree-only asks — the repo root is "a mess", "too many files at the top
  level", "organize the folder structure".
---

# Codebase organizer

Turn a large, unwieldy codebase with a bloated root into something a newcomer
can navigate in thirty seconds — the test the whole skill optimizes for. It
runs in four beats: **scan & plan → you approve → apply → verify.** Planning is
read-only and produces a concrete target tree plus a move list; nothing on disk
changes until you approve; applying preserves git history and keeps the build
green by rewriting references; verification runs the project's own tests.

The organizing taste lives in `references/philosophy.md` (the eight principles)
and `references/language-layouts.md` (idiomatic target trees per ecosystem).
Reference-fixing detail lives in `references/reference-rewriting.md`. The two
workflow scripts under `workflows/` carry the fan-out; you orchestrate them.

## When to reach for this

Reorganizing a real codebase is high-stakes (you're moving the user's files and
can break their build), multi-step, and benefits enormously from parallel
analysis — exactly what a Workflow is for. Use it for any "this repo is a mess,
fix the layout" request. For a single obvious move ("put these two files in a
`utils/` folder") just do it directly; the workflow overhead isn't worth it.

## Prerequisites — check before planning

1. **The target is a git repository.** History-preserving moves and the safety
   net both depend on git. If it isn't one, tell the user and offer to `git
   init` first, or stop. Confirm with `git -C <repo> rev-parse --is-inside-work-tree`.
2. **Know the repo path.** If the user didn't give one, ask; default to the
   current working directory only if that's clearly the repo they mean.
3. **Working tree is clean (strongly preferred).** Uncommitted changes muddy the
   safety net. If dirty, recommend committing or stashing first. The apply phase
   re-checks this and will refuse to run on a dirty tree unless explicitly told
   to proceed on a fresh branch.

## Beat 1 — Scan and plan (read-only)

Run the planning workflow. It runs the deterministic recon script, fans out
read-only `Explore` agents to characterize the tree, designs the target layout,
predicts the reference impact of every move, and adversarially critiques its own
plan before returning it.

```
Workflow({
  scriptPath: "<skill-dir>/workflows/organize-plan.js",
  args: {
    projectDir: "<absolute repo path>",
    dateToday: "<YYYY-MM-DD>",
    skillDir: "<absolute path to this skill dir>",
    depth: "recursive"            // "recursive" (default) or "root-only"
  }
})
```

`<skill-dir>` is the directory containing this SKILL.md; pass it as `skillDir`
so the workflow can locate `scripts/repo_scan.py` and the references. Stamp
`dateToday` yourself — the workflow sandbox has no clock.

The workflow returns `{ plan_path, plan }`. The `plan` object holds the proposed
**target tree**, an ordered **move list** (each move = `from`, `to`, rationale,
and predicted `ref_impact`), any **new_files** to scaffold (e.g. package
`__init__.py`), a **cruft/ephemera** section (quarantine vs `.gitignore`), and
the critic's **verdict + risks**.

**You must persist the returned `plan` to disk yourself** — write it as JSON to
`plan_path` (`<repo>/.codebase-organizer-plan.json`) with the Write tool. The
workflow deliberately does *not* write the file: its runtime has no filesystem
access, and a large plan is far too big to hand to a transcription agent without
stalling. You have the plan object in the result and Write access, so saving it
is a one-step operation on your side. The apply workflow reads it from that path.

## Beat 2 — Present the plan and get explicit approval

**This is a required human gate. Workflows run headless and cannot ask
mid-run — so the approval happens here, in the conversation, between the two
workflow calls.** Do not invoke the apply workflow until the user says yes.

Show the user, concisely:

- **Before → after at the root:** how many loose files become how few, and the
  proposed top-level directories with their one-line purposes.
- **The headline moves:** the overstuffed dirs being split and how; any
  ecosystem-layout shift (e.g. adopting `src/`).
- **Cruft to quarantine** (to `archive/`, for *their* later deletion — never
  auto-deleted) and **ephemera to gitignore**.
- **The risks list verbatim** — especially anything touching dynamic imports,
  build config semantics, or large refactors. Be honest about blast radius.

Then let them approve, approve-with-changes, or decline. If they want changes,
adjust the plan (you can edit the plan JSON or re-run planning with guidance)
and re-present. A reorg the user didn't fully understand is a reorg that erodes
trust when their build breaks — over-communicate here.

## Beat 3 — Apply (mutating, only after approval)

Run the apply workflow against the approved plan.

```
Workflow({
  scriptPath: "<skill-dir>/workflows/organize-apply.js",
  args: {
    projectDir: "<absolute repo path>",
    dateToday: "<YYYY-MM-DD>",
    skillDir: "<absolute skill dir>",
    planPath: "<repo>/.codebase-organizer-plan.json",
    branch: "codebase-organizer/reorg"   // it works on a fresh branch by default
  }
})
```

It re-asserts a clean tree, creates the working branch, performs each move with
`git mv`, quarantines cruft, rewrites references per the plan's recipes,
re-greps for anything missed, then runs **Beat 4** inline.

## Beat 4 — Verify (inside the apply workflow, surfaced to you)

The apply workflow detects and runs the project's own build/test/lint (`pytest`,
`npm test` / `tsc`, `go build ./...`, `cargo test`, or a `Makefile`/CI target)
and reports pass/fail with the failing output. A green result is the success
criterion. If it's red, the workflow reports exactly what broke and the
suspected missed reference; relay that and propose next steps (fix forward, or
`git checkout`/branch-discard to revert — the original tree is untouched on the
user's original branch).

## Reporting back

Summarize: root file count before → after, top-level dirs created, overstuffed
dirs split, moves applied, references rewritten, cruft quarantined, and the
verification result. Tell the user the work is on branch `<branch>` and that
nothing was deleted — quarantined files await their review under `archive/`.
Remind them to review the diff before merging.

## Guardrails

- **Never delete files.** Cruft is quarantined to `archive/` and flagged; the
  human decides. Ephemera is `.gitignore`d, not removed.
- **Never run apply without explicit approval** of the specific plan.
- **Always work on a branch / clean tree** so the original is one command away.
- **Predict before you move** — every move carries its reference impact so the
  build can stay green; relay risky/dynamic references rather than guessing.
- **Honor the ecosystem's idioms** over a generic template (see
  `references/language-layouts.md`).
- For the full reasoning behind these, read `references/philosophy.md`.
