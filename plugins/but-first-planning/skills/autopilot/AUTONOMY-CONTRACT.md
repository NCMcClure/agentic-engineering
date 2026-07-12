# The autonomy contract — settled once, honoured all run

Four calls the user makes before anything runs. Record the answers in your plan
and repeat them in the final report — the contract is what makes "no further
questions" honest rather than presumptuous.

## 1. decisions — who makes the product calls?

| Setting | Meaning | Maps to |
|---|---|---|
| `batch` (default) | Derivable open questions still get decided by agents (they were never real product calls); the genuine residue is batched into **Touchpoint 1** with a recommended answer each. | `build-plan-tree.js {decisionPolicy: 'route'}` + the touchpoint |
| `auto` | Agents also decide the residue where any defensible reading exists; every decision is an ADR + a flagged report line. Truly undecidable ones (no defensible reading) still surface. | `build-plan-tree.js {decisionPolicy: 'decide'}` |

## 2. hitl — what happens at a HITL issue mid-sprint?

| Setting | Meaning | Cost |
|---|---|---|
| `draft-and-defer` (default) | An agent drafts the gated artifact (uncommitted, facts grounded in real sources); the human signs off at the sprint report; its dependents wait a sprint. | Safest; slowest through gates |
| `skip-and-flag` | HITL units and their transitive dependents are skipped and listed; the rest of the sprint builds. | Fast; leaves holes to fill |
| `auto-implement` | HITL units are built AFK: the agent makes the call, records an ADR, flags it prominently. | Full speed; decisions to review after the fact |

("Pause and ask" is the interactive `build-sprint` coordinator's cadence — a
workflow cannot pause. If the user wants real mid-sprint pauses, that stage runs
interactively, not on autopilot.)

`REVIEW` issues are outside this policy entirely: under every setting they
defer to the human — an agent can't draft or auto-implement an act of looking.
Their implementing slices still build AFK; the sprint report lists the pending
walkthroughs (`reviewPending`) and the run continues past them.

## 3. scope — how far does this run go?

One sprint, epic NN, or the whole backlog. Scope is also the failure budget's
blast radius: a sprint that `stoppedEarly` twice on the same route ends the run
early regardless of scope — report, don't push through.

## 4. publish / PR posture

Which tracker (from `.plan/tracker.md`), whether each sprint opens a PR
(`openPr`), the PR base branch, and whether `triage-drift.js` may publish drift
issues (`publish: true`) or must batch them. Also the **docs posture**: whether
each sprint runs the `build-user-docs` pass after its reconcile (default
**on**), and where its commit lands — appended to the still-open sprint PR
(default; docs reviewed with the code) or left uncommitted for the human.
Publishing tickets, pushing branches (the docs commit included), and
**gate-notification comments** (a `Human gate` @mention posted on each
HITL/REVIEW issue the run defers on, whenever `tracker.md` names a
`**Notify**` handle — unsetting the handle is the only off switch) are the
run's outward-facing actions — they are exactly what the contract's approval
covers, and nothing else is.

## Permissions to pre-approve

Per `build-sprint`'s ORCHESTRATION.md: the project's build/test commands, the
verifiers (`python3 .plan/...`), `git` branch/commit/push, and the tracker CLI
(`gh` / `glab`). Builders that stall on permission prompts break the cadence —
settle this at contract time, in the project's `.claude/settings.json`.

## Which stages run autonomous?

Default: all of them. The user may keep any stage manual (commonly the spec, or
Touchpoint 1 expanded into a real review session) — record the split and hand
off to the interactive skill at that stage, resuming autopilot after.
