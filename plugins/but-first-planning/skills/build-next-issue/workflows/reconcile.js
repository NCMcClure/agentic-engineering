export const meta = {
  name: 'build-next-reconcile',
  description: 'Reconcile plan tree, tracker, git, and progress ledger in parallel; independently verify every claimed-done issue against its checkpoint; record through the status funnel; select the next issue — and optionally derive the dispatch-plan JSON that build-sprint consumes',
  whenToUse: "build-next-issue's autonomous mode — when 5+ done-claims need verification or a parallel build needs a dispatch plan; the interactive read stays the default for quick what's-next questions. Args: {root, skillDir, scope?, dispatch?, verifyLimit?}. scope bounds the run to an epic (EE) or sprint (EE-SS); dispatch:true also derives and writes .plan/progress/dispatch/EE-SS.json; verifyLimit caps the verification fan-out (default 20).",
  phases: [
    { title: 'Gather', detail: 'four parallel state readers: plan, tracker, git, drift+ledger', model: 'haiku' },
    { title: 'Verify', detail: 'one verifier per unverified done-claim, per ASSESSMENT.md', model: 'sonnet' },
    { title: 'Record', detail: 'one serial agent drives the status funnel, notes, and drift files', model: 'sonnet' },
    { title: 'Select', detail: 'next-issue selection and (dispatch:true) the dispatch-plan JSON' },
  ],
}

// Model-tier policy: haiku = the four Gather readers (pure retrieval, no judgment);
// sonnet = checkpoint verification + the serial funnel/bookkeeping agent; the
// Select/Dispatch stage inherits the session model — recovering implicit
// dependencies and wave-ordering the frontier is the judgment core of this run.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir) {
  throw new Error('args must be an object: {root: <absolute repo root>, skillDir: <build-next-issue skill dir>, scope?, dispatch?, verifyLimit?}')
}
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const PLANDIR = `${ROOT}/.plan/plan`
const PROG = `${ROOT}/.plan/progress`
const SCOPE = typeof A.scope === 'string' && /^\d\d(-\d\d)?$/.test(A.scope) ? A.scope : null
const DISPATCH = A.dispatch === true
const VERIFY_LIMIT = Math.max(parseInt(A.verifyLimit, 10) || 20, 1)

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a reconciliation pipeline for the plan workspace at ${ROOT}/.plan/:
the plan tree is ${PLANDIR}/ (epic/sprint/issue files; issue coords are EE-SS-II and an issue
file matches ${PLANDIR}/EE-*/SS-*/issues/II_issue_*.md), the tracker config is
${ROOT}/.plan/tracker.md, and the progress records live under ${PROG}/ (completed/ ledgers,
notes/, drift/). The status funnel is: python3 ${PLANDIR}/plan-status.py — NEVER hand-edit a
Status field or ledger row.
${SCOPE ? `SCOPE: this run is bounded to ${SCOPE} — ignore issues outside it.` : ''}
`

// ---------- Phase 1: gather state (four parallel readers) ----------
phase('Gather')
// barrier justified: the verification delta is a set computation over all four signals
const [planState, trackerState, gitState, progressState] = await parallel([
  () => agent(
    `${CTX}\nRead plan-tree state, mechanically. Run: python3 ${PLANDIR}/plan-status.py check${SCOPE ? ' ' + SCOPE : ''} (report exit code + rolled-up line). Then grep the issue files${SCOPE ? ` under the ${SCOPE} subtree` : ''} for their bold fields: report every issue whose Status is NOT not-started as {coords, ref (#NNN or <unassigned>), status, title(H1)}, and separately EVERY published issue (ref != <unassigned>) as a {ref, coords} map entry regardless of status. Also name the first sprint (EE-SS) that still has not-started issues. Pure retrieval — no judgment. ${BRIEF}`,
    {
      label: 'gather:plan', phase: 'Gather', model: 'haiku', effort: 'low',
      schema: {
        type: 'object', required: ['issues', 'refMap', 'currentSprint', 'checkExit'],
        properties: {
          issues: { type: 'array', items: { type: 'object', required: ['coords', 'ref', 'status', 'title'], properties: { coords: { type: 'string' }, ref: { type: 'string' }, status: { type: 'string' }, title: { type: 'string' } } } },
          refMap: { type: 'array', items: { type: 'object', required: ['ref', 'coords'], properties: { ref: { type: 'string' }, coords: { type: 'string' } } } },
          currentSprint: { type: 'string', description: 'first sprint with not-started issues, EE-SS' },
          checkExit: { type: 'integer' },
          checkSummary: { type: 'string' },
        },
      },
    }
  ),
  () => agent(
    `${CTX}\nRead tracker state, mechanically. Read ${ROOT}/.plan/tracker.md for the backend. GitHub: gh issue list --state closed --limit 200 (and --state open) — report closed and open refs as "#NNN" lists. GitLab: the glab equivalent per tracker.md. Local mode: report backend "local" and empty lists (the plan is the tracker). Pure retrieval. ${BRIEF}`,
    {
      label: 'gather:tracker', phase: 'Gather', model: 'haiku', effort: 'low',
      schema: {
        type: 'object', required: ['backend', 'closedRefs', 'openRefs'],
        properties: { backend: { type: 'string' }, closedRefs: { type: 'array', items: { type: 'string' } }, openRefs: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } },
      },
    }
  ),
  () => agent(
    `${CTX}\nRead git signals, mechanically. Run git -C ${ROOT} log --oneline -150 and git -C ${ROOT} branch -a --merged. Report every commit/branch whose message or name references an issue coord (EE-SS-II), an issue slug (UPPERCASE-HYPHENATED), or a ticket ref (#NNN): {ref: <what it referenced>, sha, summary}. Pure retrieval — do not judge whether the work is complete. ${BRIEF}`,
    {
      label: 'gather:git', phase: 'Gather', model: 'haiku', effort: 'low',
      schema: {
        type: 'object', required: ['signals'],
        properties: { signals: { type: 'array', items: { type: 'object', required: ['ref', 'sha', 'summary'], properties: { ref: { type: 'string' }, sha: { type: 'string' }, summary: { type: 'string' } } } } },
      },
    }
  ),
  () => agent(
    `${CTX}\nRead progress state, mechanically. (a) The verified-complete ledgers: every coords that appears as a row in ${PROG}/completed/*.md. (b) Run python3 ${PROG}/drift-status.py --open — report each open/routed item {id, status, kind, route}. (c) Any "follow-up issue #NNN" refs named in those routes. Pure retrieval. ${BRIEF}`,
    {
      label: 'gather:progress', phase: 'Gather', model: 'haiku', effort: 'low',
      schema: {
        type: 'object', required: ['ledgerCoords', 'openDrift', 'routedFollowUps'],
        properties: {
          ledgerCoords: { type: 'array', items: { type: 'string' } },
          openDrift: { type: 'array', items: { type: 'object', required: ['id', 'status', 'kind', 'route'], properties: { id: { type: 'string' }, status: { type: 'string' }, kind: { type: 'string' }, route: { type: 'string' } } } },
          routedFollowUps: { type: 'array', items: { type: 'string' } },
        },
      },
    }
  ),
])
if (!planState || !planState.issues) throw new Error('plan-state gather failed — cannot reconcile without it')
const tracker = trackerState || { backend: 'unknown', closedRefs: [], openRefs: [] }
const progress = progressState || { ledgerCoords: [], openDrift: [], routedFollowUps: [] }
const gitSignals = (gitState && gitState.signals) || []

// ---------- compute the verification delta in script code ----------
const ledger = new Set(progress.ledgerCoords)
const refToCoords = new Map((planState.refMap || []).map(r => [r.ref, r.coords]))
const claimedDone = planState.issues.filter(i => i.status === 'done').map(i => i.coords)
const closedCoords = tracker.closedRefs.map(r => refToCoords.get(r)).filter(Boolean)
const inScope = c => !SCOPE || c.startsWith(SCOPE)
let delta = [...new Set([...claimedDone, ...closedCoords])].filter(c => inScope(c) && !ledger.has(c)).sort()
let deltaTruncated = 0
if (delta.length > VERIFY_LIMIT) {
  deltaTruncated = delta.length - VERIFY_LIMIT
  delta = delta.slice(0, VERIFY_LIMIT)
}
log(`Gather: ${planState.issues.length} non-not-started issues, ${tracker.closedRefs.length} closed tickets, ${progress.ledgerCoords.length} ledgered; ${delta.length} done-claims to verify${deltaTruncated ? ` (${deltaTruncated} deferred by verifyLimit — NOT silently passed)` : ''}`)

// ---------- Phase 2: verify each unverified done-claim ----------
phase('Verify')
const byCoords = new Map(planState.issues.map(i => [i.coords, i]))
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['coords', 'verdict', 'evidence', 'whereVerified'],
  properties: {
    coords: { type: 'string' },
    verdict: { enum: ['verified', 'failed', 'not-yet-runnable', 'broken-checkpoint'] },
    evidence: { type: 'string', description: 'checkpoint command + exit, criteria walked, git cross-check' },
    whereVerified: { type: 'string', description: 'branch/ref the checkpoint ran on' },
    checkpointCommand: { type: 'string' },
  },
}
const verdicts = (await parallel(delta.map(c => () =>
  agent(
    `${CTX}\nYou are the completion verifier for exactly one issue: ${c}. Read ${SKILL}/ASSESSMENT.md FIRST and follow its method and strictness. Find the issue file (glob ${PLANDIR}/${c.slice(0, 2)}-*/${c.slice(3, 5)}-*/issues/${c.slice(6)}_issue_*.md). Re-derive completion from evidence: run its ## Testing checkpoint command from ${ROOT}, walk each acceptance criterion against the working tree, confirm the spec anchors resolve, and cross-check these git signals: ${JSON.stringify(gitSignals.filter(s => s.ref.includes(c) || (byCoords.get(c) && s.summary.includes(byCoords.get(c).title.slice(0, 20)))).slice(0, 5))}. Verdicts: verified (checkpoint passes AND criteria hold); failed (claimed done but checkpoint fails or a criterion is unmet); not-yet-runnable (checkpoint needs tooling that legitimately isn't built yet); broken-checkpoint (the command can never pass by construction — an issue defect, not a work failure). Set coords="${c}". Do not edit anything. ${BRIEF}`,
    { label: `verify:${c}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VERIFY_SCHEMA }
  )
))).filter(Boolean)
const verified = verdicts.filter(v => v.verdict === 'verified')
const failed = verdicts.filter(v => v.verdict === 'failed')
const brokenCheckpoints = verdicts.filter(v => v.verdict === 'broken-checkpoint')
log(`Verify: ${verified.length} verified, ${failed.length} failed, ${brokenCheckpoints.length} broken checkpoints, ${verdicts.filter(v => v.verdict === 'not-yet-runnable').length} not-yet-runnable`)

// ---------- Phase 3: record through the funnel (ONE serial agent) ----------
// serialized on purpose: plan-status.py rewrites shared parent files (sprint.md, epic.md,
// index.md) on every set — funnel calls must never fan out across agents
phase('Record')
const record = await agent(
  `${CTX}\nYou are the reconciliation recorder — the ONLY agent in this run allowed to mutate state, and everything goes through the funnel or its owned files. Inputs below. Steps, in order:
1. For each VERIFIED issue not already ledgered: python3 ${PLANDIR}/plan-status.py set <coords> done --evidence "<its evidence, one line>" (the --evidence flag is what appends the ledger row — use it only here, where verification actually happened this run).
2. For each FAILED issue: python3 ${PLANDIR}/plan-status.py set <coords> in-progress (it claimed done but is not).
3. For each BROKEN-CHECKPOINT issue: do NOT flip its status. Instead create/refresh a drift file ${PROG}/drift/drift-<kebab-slug>.md per the drift-file format in ${SKILL}/SKILL.md (kind: checkpoint-bug, route: spec-4-edit, status: open) — reuse an existing item's file (bump it) rather than duplicating.
4. Write this run's reconciliation narrative to a NEW ${PROG}/notes/<today>-<scope-or-all>-reconcile.md (derive today via date +%F): verification method, per-issue outcomes, plan/tracker disagreements you can see in the inputs, checkpoint health.
5. Refresh the "## Status snapshot" and "## Open cross-cutting items" sections of ${PROG}/index.md from python3 ${PLANDIR}/plan-status.py check and python3 ${PROG}/drift-status.py --open.
Do not run git. Report exactly what you ran and wrote.
INPUTS:\nVERIFIED: ${JSON.stringify(verified, null, 1)}\nFAILED: ${JSON.stringify(failed, null, 1)}\nBROKEN CHECKPOINTS: ${JSON.stringify(brokenCheckpoints, null, 1)}\nALREADY LEDGERED: ${JSON.stringify([...ledger].filter(inScope))}\n${BRIEF}`,
  {
    label: 'record:funnel', phase: 'Record', model: 'sonnet', effort: 'medium',
    schema: {
      type: 'object', required: ['funnelSets', 'notesFile', 'driftFiles'],
      properties: {
        funnelSets: { type: 'array', items: { type: 'string' }, description: 'each plan-status.py set command run, with outcome' },
        notesFile: { type: 'string' },
        driftFiles: { type: 'array', items: { type: 'string' } },
        problems: { type: 'array', items: { type: 'string' } },
      },
    },
  }
)

// ---------- Phase 4: select next / derive dispatch ----------
phase('Select')
const DISPATCH_SCHEMA = {
  type: 'object',
  required: ['sprint', 'waves', 'edges', 'hitlGates', 'checkpointHealth', 'declaredVsImpliedMismatches'],
  properties: {
    sprint: { type: 'string' },
    waves: {
      type: 'array',
      items: {
        type: 'object', required: ['n', 'units'],
        properties: {
          n: { type: 'integer' },
          units: {
            type: 'array',
            items: {
              type: 'object', required: ['coords', 'refs', 'type', 'title', 'files', 'reason'],
              properties: {
                coords: { type: 'array', items: { type: 'string' }, description: 'more than one = same-module cluster: one builder, one commit' },
                refs: { type: 'array', items: { type: 'string' } },
                type: { enum: ['AFK', 'HITL'] },
                title: { type: 'string' },
                files: { type: 'array', items: { type: 'string' }, description: 'predicted file paths this unit touches' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object', required: ['from', 'to', 'kind', 'why'],
        properties: { from: { type: 'string' }, to: { type: 'string' }, kind: { enum: ['declared', 'implicit-checkpoint', 'implicit-module', 'file-overlap'] }, why: { type: 'string' } },
      },
    },
    hitlGates: { type: 'array', items: { type: 'object', required: ['coords', 'title', 'gatesWhat'], properties: { coords: { type: 'string' }, title: { type: 'string' }, gatesWhat: { type: 'string' } } } },
    checkpointHealth: { type: 'array', items: { type: 'object', required: ['coords', 'problem', 'route'], properties: { coords: { type: 'string' }, problem: { type: 'string' }, route: { type: 'string' } } } },
    declaredVsImpliedMismatches: { type: 'array', items: { type: 'object', required: ['coords', 'declared', 'implied', 'why'], properties: { coords: { type: 'string' }, declared: { type: 'string' }, implied: { type: 'string' }, why: { type: 'string' } } } },
  },
}
const SELECT_SCHEMA = {
  type: 'object',
  required: ['nextIssue', 'onDeck'],
  properties: {
    nextIssue: {
      type: 'object', required: ['coords', 'title', 'type', 'ref', 'anchors', 'acceptanceCriteria'],
      properties: {
        coords: { type: 'string' }, title: { type: 'string' }, type: { type: 'string' }, ref: { type: 'string' },
        anchors: { type: 'array', items: { type: 'string' } },
        acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        unpublishedSprint: { type: 'boolean', description: 'true if its sprint still needs plan-1-publish-issues' },
      },
    },
    onDeck: { type: 'array', items: { type: 'object', required: ['coords', 'title'], properties: { coords: { type: 'string' }, title: { type: 'string' } } } },
    frontierBlocked: { type: 'string', description: 'set when nothing is buildable — what unblocks it' },
    dispatch: DISPATCH_SCHEMA,
  },
}
// judgment core — inherits the session model
const selection = await agent(
  `${CTX}\nYou are the next-issue selector${DISPATCH ? ' and dispatch planner' : ''}. Read ${SKILL}/NEXT-SELECTION.md${DISPATCH ? ` and ${SKILL}/DISPATCH-PLAN.md (including its JSON-contract section)` : ''} FIRST and apply them exactly. The freshly verified state: use the plan tree on disk (the Record step just reconciled it) plus these inputs — treat routed drift follow-up issues as buildable candidates alongside plan issues.
Select the single next issue (lowest-numbered not-started whose blockers are ALL verified-complete, respecting sprint/epic order) with its anchors and acceptance criteria read from its file. List the 1-3 on-deck issues that unlock after it.${DISPATCH ? `
Then derive the FULL dispatch plan for sprint ${planState.currentSprint || '(current)'}: recover implicit dependencies from checkpoint commands and What-to-build (a "Blocked by: None" routinely lies — read every issue file in the sprint), predict per-issue file sets, cluster same-module issues into single units, map HITL gates, order into waves per DISPATCH-PLAN.md, and record declared-vs-implied mismatches (they route to spec-4-edit; do not silently reroute). Write the dispatch object as JSON to ${PROG}/dispatch/${planState.currentSprint || 'EE-SS'}.json (mkdir -p the directory; set "generated" via date +%F) AND return it in your structured output.` : ''}
INPUTS:\nVERIFIED THIS RUN: ${JSON.stringify(verified.map(v => v.coords))}\nSTILL FAILED: ${JSON.stringify(failed.map(v => v.coords))}\nOPEN DRIFT: ${JSON.stringify(progress.openDrift, null, 1)}\nDRIFT FOLLOW-UPS: ${JSON.stringify(progress.routedFollowUps)}\nCHECKPOINT HEALTH FROM VERIFY: ${JSON.stringify(brokenCheckpoints, null, 1)}\n${BRIEF}`,
  { label: DISPATCH ? 'select+dispatch' : 'select', phase: 'Select', effort: 'high', schema: SELECT_SCHEMA }
)

return {
  whereWeAre: {
    scope: SCOPE, currentSprint: planState.currentSprint,
    checkSummary: planState.checkSummary || null,
    verifiedThisRun: verified.map(v => v.coords),
    ledgered: progress.ledgerCoords.length + verified.length,
  },
  anythingOff: {
    claimedDoneButFailed: failed.map(v => ({ coords: v.coords, evidence: v.evidence })),
    brokenCheckpoints: brokenCheckpoints.map(v => ({ coords: v.coords, evidence: v.evidence, route: 'spec-4-edit' })),
    verifyDeferredByLimit: deltaTruncated,
    openDrift: progress.openDrift,
    recordProblems: (record && record.problems) || [],
  },
  nextIssue: selection ? selection.nextIssue : null,
  onDeck: selection ? selection.onDeck : [],
  frontierBlocked: selection ? selection.frontierBlocked : 'selection agent failed',
  dispatch: DISPATCH && selection ? selection.dispatch : null,
  dispatchFile: DISPATCH && planState.currentSprint ? `${PROG}/dispatch/${planState.currentSprint}.json` : null,
  record,
}
