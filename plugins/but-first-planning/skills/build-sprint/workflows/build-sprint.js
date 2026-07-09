export const meta = {
  name: 'build-sprint-run',
  description: 'Autonomously build one sprint from a dispatch plan: preflight, HITL triage by policy (REVIEW units are never built under any policy — surfaced as pending human walkthroughs), wave-by-wave TDD builders (serial on the sprint branch by default, git-worktree isolation opt-in), strictly serial integration with full re-checkpointing and a stop-the-line diagnostician, sprint-exit verification, bookkeeping, and one PR with gate notification',
  whenToUse: "build-sprint's autonomous mode — the user approved an AFK sprint build and its policies in plan mode. One run = one sprint; epic/backlog scope is a loop in the caller (re-run build-next-issue's reconcile between sprints). Args: {root, skillDir, tddSkillPath, sprint, dispatch, hitlPolicy?, parallelism?, openPr?, maxFailures?, prBase?}. dispatch is the JSON contract from build-next-issue's reconcile.js (object, or path to .plan/progress/dispatch/EE-SS.json). hitlPolicy: 'skip-and-flag' (default) | 'draft-and-defer' | 'auto-implement' — pause-and-ask is the interactive skill's cadence, not a workflow option. parallelism: 'serial' (default, robust) | 'worktree' (parallel file-disjoint units in real git worktrees).",
  phases: [
    { title: 'Preflight', detail: 'clean tree, sprint branch, tooling spot-check', model: 'sonnet' },
    { title: 'Triage', detail: 'HITL units handled per policy before any dispatch' },
    { title: 'Build', detail: 'wave-by-wave TDD builders (read the build-tdd skill first)', model: 'sonnet' },
    { title: 'Integrate', detail: 'strictly serial: merge, re-checkpoint everything landed, funnel', model: 'sonnet' },
    { title: 'Exit', detail: 'sprint-exit checkpoint suite + genuine-vs-broken classification', model: 'opus' },
    { title: 'Bookkeep', detail: 'progress notes + drift files, own commit', model: 'sonnet' },
    { title: 'PR', detail: 'push the sprint branch and open one PR', model: 'sonnet' },
  ],
}

// Model-tier policy: sonnet = builders (implementation — quality is enforced by the
// red-green discipline and the re-checkpoint gates, not model size), integrators,
// preflight, bookkeeping, PR; opus = HITL drafters and the sprint-exit verifier
// (parallel-heavy / classification judgment); inherit (session model) = the
// stop-the-line diagnostician — failure diagnosis mid-run is the hardest judgment here.
//
// Isolation doctrine (ORCHESTRATION.md): never two writers in one tree, ever. This
// script does NOT rely on any harness isolation option — in 'worktree' mode the
// builders create and work in their own `git worktree` as their first act, and only
// dispatch-declared file-disjoint units of a wave run concurrently. 'serial' mode
// (default) runs one builder at a time directly on the sprint branch.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir || !A.tddSkillPath || !A.sprint || !A.dispatch) {
  throw new Error('args must be an object: {root, skillDir, tddSkillPath, sprint: "EE-SS", dispatch: <object|path>, hitlPolicy?, parallelism?, openPr?, maxFailures?, prBase?}')
}
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const TDD = A.tddSkillPath
const SPRINT = A.sprint
const PLANDIR = `${ROOT}/.plan/plan`
const PROG = `${ROOT}/.plan/progress`
const BRANCH = `sprint/${SPRINT}`
const PR_BASE = A.prBase || 'main'
const HITL_POLICY = ['skip-and-flag', 'draft-and-defer', 'auto-implement'].includes(A.hitlPolicy) ? A.hitlPolicy : 'skip-and-flag'
const PARALLELISM = A.parallelism === 'worktree' ? 'worktree' : 'serial'
const OPEN_PR = A.openPr !== false
const MAX_FAILURES = Math.max(parseInt(A.maxFailures, 10) || 2, 1)

const BRIEF = 'Be terse in every string field. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of an autonomous sprint build for sprint ${SPRINT} of the plan at
${PLANDIR}/ (issue coords EE-SS-II; an issue file matches ${PLANDIR}/EE-*/SS-*/issues/II_issue_*.md;
spec at ${ROOT}/.plan/spec/). The integration branch for this run is ${BRANCH} (based on ${PR_BASE}).
The status funnel is python3 ${PLANDIR}/plan-status.py — in this run ONLY the integrator agent
calls it, never a builder. The user approved this run and its policies in plan mode.
`

// ---------- load the dispatch plan if given as a path ----------
let dispatch = A.dispatch
if (typeof dispatch === 'string') {
  const loaded = await agent(
    `Read the JSON file at ${dispatch} and return its parsed content verbatim in the structured output. Pure retrieval. ${BRIEF}`,
    {
      label: 'load:dispatch', phase: 'Preflight', model: 'haiku', effort: 'low',
      schema: { type: 'object', required: ['sprint', 'waves', 'edges', 'hitlGates', 'checkpointHealth'] },
    }
  )
  if (!loaded || !loaded.waves) throw new Error('could not load dispatch JSON from ' + dispatch)
  dispatch = loaded
}
if (dispatch.sprint && dispatch.sprint !== SPRINT) throw new Error(`dispatch plan is for ${dispatch.sprint}, not ${SPRINT} — re-run build-next-issue's reconcile`)
const unitKey = u => u.coords.join('+')

// ---------- Phase 1: preflight ----------
phase('Preflight')
const preflight = await agent(
  `${CTX}\nYou are the preflight checker. In order: (1) git -C ${ROOT} status --porcelain — if ANYTHING is uncommitted, report clean=false and STOP (never build on top of uncommitted user work). (2) Create the sprint branch: git -C ${ROOT} checkout -b ${BRANCH} ${PR_BASE} (if it already exists, check it out and report resumed=true).${PARALLELISM === 'worktree' ? ` (2b) Prune stale isolation leftovers from any previous run: git -C ${ROOT} worktree prune; then for each leftover ${ROOT}/.worktrees/* directory, git -C ${ROOT} worktree remove <it> --force, and delete its matching issue/* branch with git -C ${ROOT} branch -D — a stale worktree/branch collides with this run's worktree add. Report what you pruned in warnings.` : ''} (3) python3 ${PLANDIR}/verify-plan-tree.py — must exit 0; report its state. (4) Spot-check wave-1 tooling: for these first-wave checkpoint commands, check the named tools/scripts exist WITHOUT running the checkpoints: ${JSON.stringify((dispatch.waves[0] ? dispatch.waves[0].units : []).map(u => ({ unit: unitKey(u), files: u.files })))} — cross-reference the known checkpoint-health problems: ${JSON.stringify(dispatch.checkpointHealth || [])}. ${BRIEF}`,
  {
    label: 'preflight', phase: 'Preflight', model: 'sonnet', effort: 'low',
    schema: {
      type: 'object', required: ['clean', 'branch', 'planTreeGreen', 'warnings'],
      properties: {
        clean: { type: 'boolean' }, branch: { type: 'string' }, resumed: { type: 'boolean' },
        planTreeGreen: { type: 'boolean' }, warnings: { type: 'array', items: { type: 'string' } },
      },
    },
  }
)
if (!preflight || !preflight.clean) throw new Error('preflight failed: working tree not clean (or preflight agent failed) — commit or stash first')
if (!preflight.planTreeGreen) throw new Error('preflight failed: verify-plan-tree.py is red — fix the plan tree before building')

// ---------- Phase 2: HITL/REVIEW triage per policy ----------
phase('Triage')
const isHitl = u => u.type === 'HITL'
const isReview = u => u.type === 'REVIEW'
const allUnits = dispatch.waves.flatMap(w => w.units)
const hitlUnits = allUnits.filter(isHitl)
const reviewUnits = allUnits.filter(isReview)
const drafts = []
const skippedHitl = []
const autoImplemented = new Set()
if (reviewUnits.length) log(`REVIEW gates (never auto-built): ${reviewUnits.map(unitKey).join(', ')}`)

if (hitlUnits.length) {
  log(`HITL policy=${HITL_POLICY}: ${hitlUnits.length} HITL unit(s) — ${hitlUnits.map(unitKey).join(', ')}`)
  if (HITL_POLICY === 'draft-and-defer') {
    // drafters run in parallel: they write DISTINCT uncommitted draft files and never touch git
    const drafted = await parallel(hitlUnits.map(u => () =>
      agent(
        `${CTX}\nYou are the HITL drafter for issue(s) ${unitKey(u)} ("${u.title}"). Read the issue file(s) and every spec anchor. DRAFT the human-gated artifact (an ADR, design doc, decision note — whatever the issue's deliverable is) to disk, UNCOMMITTED, at a sensible path the issue implies. Ground every factual claim in real sources (read the actual docs/code — never guess a host/tool fact). Do NOT commit, do NOT run the funnel, do NOT mark anything done — a human signs off later. Report the draft path and each genuine judgement call you made (the things the human must actually decide). ${BRIEF}`,
        {
          label: `draft:${unitKey(u)}`, phase: 'Triage', model: 'opus', effort: 'high',
          schema: {
            type: 'object', required: ['coords', 'draftPath', 'judgementCalls'],
            properties: { coords: { type: 'string' }, draftPath: { type: 'string' }, judgementCalls: { type: 'array', items: { type: 'string' } } },
          },
        }
      )
    ))
    drafted.filter(Boolean).forEach(d => drafts.push(d))
  }
  if (HITL_POLICY === 'auto-implement') hitlUnits.forEach(u => autoImplemented.add(unitKey(u)))
}

// Units that will not be BUILT this run: HITL units under skip-and-flag and draft-and-defer
// (a draft is not a committed deliverable), plus — computed as failures occur — their
// transitive dependents via the dispatch edges. REVIEW units are ALWAYS excluded —
// hitlPolicy (even auto-implement) never applies: a human walkthrough cannot be
// drafted or auto-implemented.
const excluded = new Set([
  ...(HITL_POLICY === 'auto-implement' ? [] : hitlUnits.map(unitKey)),
  ...reviewUnits.map(unitKey),
])
const coordsToUnit = new Map()
allUnits.forEach(u => u.coords.forEach(c => coordsToUnit.set(c, unitKey(u))))
const dependentsOf = failedCoordsSet => {
  // transitive closure over edges: from (producer) -> to (dependent)
  const out = new Set()
  let grew = true
  while (grew) {
    grew = false
    for (const e of dispatch.edges || []) {
      if ((failedCoordsSet.has(e.from) || out.has(coordsToUnit.get(e.from))) && !out.has(coordsToUnit.get(e.to))) {
        out.add(coordsToUnit.get(e.to)); grew = true
      }
    }
  }
  return out
}
const excludedCoords = new Set(allUnits.filter(u => excluded.has(unitKey(u))).flatMap(u => u.coords))
for (const dep of dependentsOf(excludedCoords)) excluded.add(dep)
allUnits.filter(u => excluded.has(unitKey(u))).forEach(u => {
  if (isReview(u)) skippedHitl.push({ coords: unitKey(u), why: 'REVIEW — human visual verification; never auto-built' })
  else if (isHitl(u)) skippedHitl.push({ coords: unitKey(u), why: `hitlPolicy=${HITL_POLICY}` })
  else skippedHitl.push({ coords: unitKey(u), why: 'transitively gated by a HITL/REVIEW unit not built this run' })
})
if (excluded.size) log(`Not building this run: ${[...excluded].join(', ')}`)

// ---------- Phase 3+4: build waves, integrate strictly serially ----------
const BUILDER_SCHEMA = {
  type: 'object',
  required: ['unit', 'status', 'shas', 'checkpointCommand', 'checkpointExit', 'filesChanged', 'testsAdded', 'driftFlags', 'evidence'],
  properties: {
    unit: { type: 'string' },
    status: { enum: ['done', 'blocked', 'partial'] },
    shas: { type: 'array', items: { type: 'string' } },
    checkpointCommand: { type: 'string' },
    checkpointExit: { type: 'integer' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'integer' },
    driftFlags: { type: 'array', items: { type: 'string' }, description: 'checkpoint names unbuilt tooling, spec ambiguity hit, etc.' },
    evidence: { type: 'string', description: 'red->green trail: what failed first, what made it pass' },
  },
}
const INTEGRATE_SCHEMA = {
  type: 'object',
  required: ['unit', 'green', 'checkpointsRun', 'funnelSet'],
  properties: {
    unit: { type: 'string' },
    green: { type: 'boolean' },
    checkpointsRun: { type: 'array', items: { type: 'string' }, description: 'each checkpoint re-run on the sprint branch, with exit code' },
    funnelSet: { type: 'array', items: { type: 'string' }, description: 'plan-status.py set commands run' },
    failure: { type: 'string', description: 'what went red, if not green' },
  },
}

const builderPrompt = (u, wave) => {
  const auto = autoImplemented.has(unitKey(u))
  const iso = PARALLELISM === 'worktree'
    ? `ISOLATION: your FIRST action is git -C ${ROOT} worktree add ${ROOT}/.worktrees/${unitKey(u)} -b issue/${unitKey(u)} ${BRANCH} — then do ALL work inside ${ROOT}/.worktrees/${unitKey(u)} and commit on issue/${unitKey(u)}. NEVER touch the main working tree at ${ROOT}; peer builders are running concurrently in their own worktrees.`
    : `ISOLATION: you are the ONLY builder running. Work directly in ${ROOT} on branch ${BRANCH} (verify with git branch --show-current before writing anything).`
  return `${CTX}\nYou are the builder for unit ${unitKey(u)} ("${u.title}", wave ${wave})${u.coords.length > 1 ? ' — a same-module cluster: build the issues IN ORDER, one commit each' : ''}.
${iso}
DISCIPLINE — non-negotiable:
1. Read the TDD skill at ${TDD} FIRST and follow it exactly: the issue's acceptance criteria are the behaviour list, one tracer bullet per criterion, red -> green each time, never refactor while red, tests through public interfaces only.
2. Read your issue file(s) and EVERY spec anchor they cite before writing any code. The spec's vocabulary is your naming.${auto ? `
2b. This is a HITL decision issue running under auto-implement: MAKE the decision, ground it in the spec/glossary/ADRs, record it as a new ADR under ${ROOT}/.plan/spec/reference/adr/ (next free number, matching format, indexed), and flag it prominently in your evidence — it will be surfaced for after-the-fact review.` : ''}
3. The ## Testing checkpoint must GENUINELY pass. If it names tooling that doesn't exist yet, build the issue's behaviour, verify against the acceptance criteria, add it to driftFlags — do NOT invent the missing tooling and do NOT fake a pass.
4. Commit one commit per issue: git add ONLY the files you changed (never -A), message naming the issue coords and ticket ref.
5. Do NOT push. Do NOT run plan-status.py. Do NOT edit sprint.md/epic.md/index.md or any Status field — the integrator owns all of that.
Report per the schema; evidence is your red->green trail. Set unit="${unitKey(u)}". ${BRIEF}`
}

const integratorPrompt = (u, landed) => `${CTX}\nYou are the serial integrator for unit ${unitKey(u)}. You run ALONE — no builder is writing while you work. Steps, in order:
${PARALLELISM === 'worktree' ? `1. git -C ${ROOT} merge --no-ff issue/${unitKey(u)} (you are on ${BRANCH}; verify first). A conflict means the wave was batched wrong: abort the merge, report green=false with the conflict as failure.
2. git -C ${ROOT} worktree remove ${ROOT}/.worktrees/${unitKey(u)} --force and git -C ${ROOT} branch -d issue/${unitKey(u)} (only after a clean merge).` : `1. Confirm the builder's commits are on ${BRANCH} (git log --oneline -${u.coords.length + 2}).`}
3. Re-run THIS unit's checkpoint command(s) from its issue file(s), AND the checkpoint of every previously-landed unit this run: ${JSON.stringify(landed.map(l => l.unit))}. Every one must exit 0 — the sprint branch is green at every step or we stop the line.
4. Only if all green: python3 ${PLANDIR}/plan-status.py set <coords> done for each of ${JSON.stringify(u.coords)} (no --evidence — the verified ledger row is build-next-issue's to add). You are the only agent in this run allowed to touch the funnel.
5. Commit the funnel's file changes (plan tables/status) as their own commit: "chore(${SPRINT}): status roll-up ${unitKey(u)}".
Report every checkpoint you ran with its exit code. Set unit="${unitKey(u)}". ${BRIEF}`

phase('Build')
const built = []      // {unit, builder, integration}
const failed = []     // {unit, reason, route}
let failuresLeft = MAX_FAILURES
let stoppedEarly = false

// A blocked/failed builder in worktree mode never reaches its integrator, whose
// step 2 owns worktree/branch removal — clean up here so the orphaned
// .worktrees/<unit> dir and issue/<unit> branch can't collide with a re-run.
const cleanupWorktree = async (u) => {
  if (PARALLELISM !== 'worktree') return
  await agent(
    `Cleanup for skipped unit ${unitKey(u)} — its builder was blocked or failed, so its isolation worktree may be orphaned. Run, tolerating "not found" errors: git -C ${ROOT} worktree remove ${ROOT}/.worktrees/${unitKey(u)} --force ; git -C ${ROOT} branch -D issue/${unitKey(u)} ; git -C ${ROOT} worktree prune. Pure command driving; no judgment. ${BRIEF}`,
    {
      label: `cleanup:${unitKey(u)}`, phase: 'Build', model: 'haiku', effort: 'low',
      schema: { type: 'object', required: ['removed'], properties: { removed: { type: 'boolean', description: 'true if a worktree or branch existed and was removed' }, notes: { type: 'string' } } },
    }
  )
}

const integrateOne = async (u, builder) => {
  const integration = await agent(integratorPrompt(u, built), {
    label: `integrate:${unitKey(u)}`, phase: 'Integrate', model: 'sonnet', effort: 'medium', schema: INTEGRATE_SCHEMA,
  })
  if (integration && integration.green) {
    built.push({ unit: unitKey(u), coords: u.coords, refs: u.refs, builder, integration })
    return true
  }
  // stop the line: singleton failure diagnosis — inherits the session model
  const diagnosis = await agent(
    `${CTX}\nYou are the stop-the-line diagnostician. Integration of unit ${unitKey(u)} went red on ${BRANCH}: ${JSON.stringify(integration && integration.failure || 'integrator agent failed')}. Checkpoints run: ${JSON.stringify(integration && integration.checkpointsRun || [])}. Builder's report: ${JSON.stringify(builder)}.
Diagnose the root cause. Then EITHER fix forward — only if the fix is surgical (a missed import, a test-ordering assumption, a stale fixture): make the fix, re-run the failing checkpoint AND every previously-landed checkpoint (${JSON.stringify(built.map(l => l.unit))}) to green, run the funnel set for ${JSON.stringify(u.coords)}, commit — OR revert: git revert (or merge -abort fallout cleanup) so ${BRANCH} is exactly at its last green state, and report the unit failed with a route: 'spec-4-edit' if the checkpoint/plan is defective, 'retry' if the builder's implementation is salvageable next run, 'spec' if the spec itself is wrong. A green branch is the invariant — never leave ${BRANCH} red. ${BRIEF}`,
    {
      label: `diagnose:${unitKey(u)}`, phase: 'Integrate', effort: 'high',
      schema: {
        type: 'object', required: ['outcome', 'summary'],
        properties: {
          outcome: { enum: ['fixed-forward', 'reverted'] },
          summary: { type: 'string' },
          route: { enum: ['spec-4-edit', 'retry', 'spec'] },
        },
      },
    }
  )
  if (diagnosis && diagnosis.outcome === 'fixed-forward') {
    built.push({ unit: unitKey(u), coords: u.coords, refs: u.refs, builder, integration: { unit: unitKey(u), green: true, checkpointsRun: ['(re-run by diagnostician)'], funnelSet: [], fixedForward: diagnosis.summary } })
    return true
  }
  failed.push({ unit: unitKey(u), coords: u.coords, reason: diagnosis ? diagnosis.summary : 'diagnosis agent failed after red integration', route: (diagnosis && diagnosis.route) || 'retry' })
  return false
}

for (const wave of dispatch.waves) {
  if (stoppedEarly) break
  const units = wave.units.filter(u => !excluded.has(unitKey(u)))
  if (!units.length) continue
  log(`Wave ${wave.n}: ${units.length} unit(s) [${PARALLELISM}] — ${units.map(unitKey).join(', ')}`)

  if (PARALLELISM === 'worktree' && units.length > 1) {
    // parallel build is safe ONLY here: dispatch declared these units file-disjoint,
    // and each builder's first act is creating its own git worktree
    const builders = await parallel(units.map(u => () =>
      agent(builderPrompt(u, wave.n), { label: `build:${unitKey(u)}`, phase: 'Build', model: 'sonnet', effort: 'high', schema: BUILDER_SCHEMA })
    ))
    // integration is strictly serial regardless of build parallelism
    for (let i = 0; i < units.length; i++) {
      if (failuresLeft <= 0) { stoppedEarly = true; break }
      const u = units[i], b = builders[i]
      if (!b || b.status === 'blocked') {
        failed.push({ unit: unitKey(u), coords: u.coords, reason: b ? `builder blocked: ${b.evidence}` : 'builder agent failed', route: 'retry' })
        failuresLeft--
        await cleanupWorktree(u)
        continue
      }
      if (!(await integrateOne(u, b))) failuresLeft--
    }
  } else {
    for (const u of units) {
      if (failuresLeft <= 0) { stoppedEarly = true; break }
      const b = await agent(builderPrompt(u, wave.n), { label: `build:${unitKey(u)}`, phase: 'Build', model: 'sonnet', effort: 'high', schema: BUILDER_SCHEMA })
      if (!b || b.status === 'blocked') {
        failed.push({ unit: unitKey(u), coords: u.coords, reason: b ? `builder blocked: ${b.evidence}` : 'builder agent failed', route: 'retry' })
        failuresLeft--
        await cleanupWorktree(u)
        continue
      }
      if (!(await integrateOne(u, b))) failuresLeft--
    }
  }

  // prune transitive dependents of anything that failed, before the next wave
  if (failed.length) {
    const failedCoords = new Set(failed.flatMap(f => f.coords))
    for (const dep of dependentsOf(failedCoords)) {
      if (!excluded.has(dep)) {
        excluded.add(dep)
        const du = allUnits.find(u => unitKey(u) === dep)
        if (du) skippedHitl.push({ coords: dep, why: `dependency failed: ${[...failedCoords].filter(c => (dispatch.edges || []).some(e => e.from === c && du.coords.includes(e.to))).join(', ') || 'upstream failure'}` })
      }
    }
  }
}
log(`Build: ${built.length} landed, ${failed.length} failed, ${excluded.size} not attempted${stoppedEarly ? ' — STOPPED EARLY (failure budget exhausted)' : ''}`)

// ---------- Phase 5: sprint exit ----------
phase('Exit')
const sprintExit = await agent(
  `${CTX}\nYou are the sprint-exit verifier. Run, from ${ROOT} on ${BRANCH}: (1) python3 ${PLANDIR}/plan-status.py check ${SPRINT}; (2) the sprint's own exit checkpoints from its sprint.md (read it — Layer-1 test suite, any sprint E2E); (3) python3 ${PLANDIR}/verify-plan-tree.py. These units were NOT built this run (do not count their absence as failure): ${JSON.stringify([...excluded])}. Classify every failure: genuine (work is wrong/missing) vs broken-by-construction (the checkpoint can never pass as written — an issue defect that routes to spec-4-edit; cross-check ${JSON.stringify(dispatch.checkpointHealth || [])}). Run checkpoints read-only — fix nothing. ${BRIEF}`,
  {
    label: 'sprint-exit', phase: 'Exit', model: 'opus', effort: 'high',
    schema: {
      type: 'object', required: ['sprintComplete', 'checksRun', 'genuineFailures', 'brokenByConstruction'],
      properties: {
        sprintComplete: { type: 'boolean', description: 'every attempted unit done and all runnable exit checks green' },
        checksRun: { type: 'array', items: { type: 'string' } },
        genuineFailures: { type: 'array', items: { type: 'string' } },
        brokenByConstruction: { type: 'array', items: { type: 'string' } },
      },
    },
  }
)

// ---------- Phase 6: bookkeeping ----------
phase('Bookkeep')
const allDriftFlags = built.flatMap(b => (b.builder.driftFlags || []).map(f => ({ unit: b.unit, flag: f })))
const bookkeep = await agent(
  `${CTX}\nYou are the bookkeeper. On ${BRANCH}: (1) Write this run's narrative to a NEW ${PROG}/notes/<today>-${SPRINT}-sprint-build.md (today via date +%F): per-unit outcomes with checkpoint evidence, failures with routes, HITL handling (policy ${HITL_POLICY}), sprint-exit results. (2) For each drift flag below, create or bump a ${PROG}/drift/drift-<slug>.md per the drift-file format in the build-next-issue skill (kind by content: checkpoint-bug -> route spec-4-edit; smell -> build-improve-architecture; status: open). (3) Commit ONLY these bookkeeping files in their own commit: "chore(${SPRINT}): build notes + drift". Do not push.
DRIFT FLAGS: ${JSON.stringify(allDriftFlags, null, 1)}
SPRINT EXIT: ${JSON.stringify(sprintExit, null, 1)}
FAILED: ${JSON.stringify(failed, null, 1)}
${BRIEF}`,
  {
    label: 'bookkeep', phase: 'Bookkeep', model: 'sonnet', effort: 'medium',
    schema: {
      type: 'object', required: ['notesFile', 'driftFiles', 'committed'],
      properties: { notesFile: { type: 'string' }, driftFiles: { type: 'array', items: { type: 'string' } }, committed: { type: 'boolean' } },
    },
  }
)

// ---------- Phase 7: PR ----------
phase('PR')
let pr = null
if (OPEN_PR && built.length) {
  pr = await agent(
    `${CTX}\nYou are the PR opener and gate notifier. Read ${ROOT}/.plan/tracker.md for the backend. Push ${BRANCH} and open ONE pull/merge request against ${PR_BASE} (gh pr create / glab mr create; local-mode tracker: skip with pushed=false and say so). Title: "${SPRINT}: <sprint title from its sprint.md>". Body: a per-issue table (coords, ref, title, checkpoint command, exit code) from BUILT below; a "Not built this run" section from SKIPPED (HITL policy ${HITL_POLICY}) and FAILED (with routes); drift flags; the sprint-exit summary. Do not merge it.
THEN notify the developer of the deferred human gates. GATES below lists them (the gate issues themselves, not transitive dependents). Skip this step entirely — reporting notified=[] and why in note — when the tracker is local-mode, GATES is empty, or tracker.md has no "**Notify**:" field / the handle is unset or still a {{PLACEHOLDER}}. Otherwise, for each gate: read its plan issue file to get the "**GitHub**:" ref (skip <unassigned> ones); IDEMPOTENCY: view the tracker issue's comments first and skip it if one already contains "Human gate"; else post ONE comment (gh issue comment NNN / glab issue note) shaped: "**Human gate** — @<handle>: <why: REVIEW walkthrough pending, or HITL deferred under policy ${HITL_POLICY}><draft path if GATES lists one><PR link>". List the refs you commented on in notified.
BUILT: ${JSON.stringify(built.map(b => ({ unit: b.unit, refs: b.refs, checkpoint: b.builder.checkpointCommand, exit: b.builder.checkpointExit })), null, 1)}
SKIPPED: ${JSON.stringify(skippedHitl, null, 1)}
GATES: ${JSON.stringify([
  ...(HITL_POLICY === 'auto-implement' ? [] : hitlUnits.map(u => ({ unit: unitKey(u), title: u.title, kind: 'HITL', draft: (drafts.find(d => d.coords === unitKey(u)) || {}).draftPath || null }))),
  ...reviewUnits.map(u => ({ unit: unitKey(u), title: u.title, kind: 'REVIEW' })),
], null, 1)}
FAILED: ${JSON.stringify(failed, null, 1)}
DRIFT: ${JSON.stringify(allDriftFlags)}
SPRINT EXIT: ${JSON.stringify(sprintExit)}
${BRIEF}`,
    {
      label: 'pr', phase: 'PR', model: 'sonnet', effort: 'low',
      schema: {
        type: 'object', required: ['pushed'],
        properties: { pushed: { type: 'boolean' }, prUrl: { type: 'string' }, notified: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
      },
    }
  )
}

// ---------- the human re-entry contract ----------
return {
  sprint: SPRINT,
  policy: { hitlPolicy: HITL_POLICY, parallelism: PARALLELISM, maxFailures: MAX_FAILURES },
  built: built.map(b => ({
    unit: b.unit, refs: b.refs, status: 'done',
    checkpointCommand: b.builder.checkpointCommand, checkpointExit: b.builder.checkpointExit,
    shas: b.builder.shas, testsAdded: b.builder.testsAdded, evidence: b.builder.evidence,
  })),
  failed,
  skippedHitl,
  drafts,                        // draft-and-defer: paths + judgement calls awaiting human sign-off
  reviewPending: reviewUnits.map(u => ({ unit: unitKey(u), title: u.title })),  // REVIEW gates awaiting a human walkthrough
  autoDecisions: built.filter(b => autoImplemented.has(b.unit)).map(b => ({ unit: b.unit, evidence: b.builder.evidence })),
  drift: allDriftFlags,
  sprintExit,
  bookkeep,
  prUrl: pr ? pr.prUrl : null,
  notified: pr && pr.notified ? pr.notified : [],   // tracker issues that got a Human-gate @mention comment
  stoppedEarly,
}
