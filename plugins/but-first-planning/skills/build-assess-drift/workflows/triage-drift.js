export const meta = {
  name: 'build-drift-triage',
  description: 'Re-assess every open drift item against the live code in parallel — verdict + fix plan per item, settle terminal items in their files, and (opt-in) publish one routed tracker issue per survivor',
  whenToUse: "build-assess-drift's autonomous mode, or 5+ open items; below that the interactive triage is faster. Args: {root, skillDir, items?, publish?} — items limits the run to specific drift ids; publish defaults false. The skill runs publish:false first, presents the batch for approval, then re-invokes with publish:true and the surviving ids.",
  phases: [
    { title: 'Index', detail: 'drift-status.py --open listing, filtered to args.items', model: 'haiku' },
    { title: 'Reassess', detail: 'one re-assessor+planner per open item, in parallel' },
    { title: 'Settle', detail: 'serial: terminal status flips, survivor annotations, index refresh', model: 'sonnet' },
    { title: 'Publish', detail: 'publish:true only — one routed tracker issue per survivor', model: 'sonnet' },
  ],
}

// Model-tier policy for this script:
//   haiku+low  — pure retrieval (Index: run and parse the drift-status.py listing)
//   sonnet     — mechanical file edits and tracker CLI driving (Settle, Publish)
//   opus+high  — parallel-heavy judgment (Reassess: per-item verdict + fix plan)
//   inherit (no model) — reserved for singleton judgment; this script has none,
//   so every agent pins its model explicitly.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir) {
  throw new Error('args must be an object: {root: <absolute repo root>, skillDir: <build-assess-drift skill dir>, items?: [drift ids to limit to], publish?: boolean (default false)}')
}
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const PROGRESS = `${ROOT}/.plan/progress`
const DRIFTDIR = `${PROGRESS}/drift`
const PUBLISH = A.publish === true
const ONLY = Array.isArray(A.items) && A.items.length ? A.items : null

const BRIEF = 'Be terse in every string field. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a drift-triage pipeline (the build-assess-drift skill). Drift files
live under ${DRIFTDIR}/ — one drift-<slug>.md per cross-cutting item, with greppable
frontmatter (id / kind / surfaced / where / route / status). That format is owned by
build-next-issue; this pipeline consumes and advances it but never redefines it. Drift
status: is a plain-file lifecycle edited directly — this run must NOT touch any plan/spec
Status field or call the plan-status funnel, and must never delete a drift file.
`

// ---------- Phase 1: index the open drift ----------
phase('Index')
const indexed = await agent(
  `Run: python3 ${PROGRESS}/drift-status.py --open --json (cwd ${ROOT}). Report every listed item verbatim — id, status, kind, where, route — and its file as an ABSOLUTE path (${DRIFTDIR}/<file>). Pure retrieval: do not read the drift files themselves, do not judge anything. If the script is missing or lists nothing, return an empty items array. ${BRIEF}`,
  {
    label: 'index:open-drift', phase: 'Index', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['items'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object', required: ['id', 'status', 'kind', 'where', 'route', 'file'],
            properties: {
              id: { type: 'string' },
              status: { type: 'string' },
              kind: { type: 'string', description: 'defect | smell | checkpoint-bug | note' },
              where: { type: 'string' },
              route: { type: 'string' },
              file: { type: 'string', description: 'absolute path of the drift file' },
            },
          },
        },
      },
    },
  }
)
const allOpen = (indexed && indexed.items) || []
const items = ONLY ? allOpen.filter(i => ONLY.includes(i.id)) : allOpen
log(`${items.length} open drift items${ONLY ? ` (filtered from ${allOpen.length} by args.items)` : ''}`)
if (!items.length) return { items: [], note: 'no open drift items to triage' }

// ---------- Phase 2: re-assess + plan, one agent per item ----------
phase('Reassess')
const REASSESS_SCHEMA = {
  type: 'object', required: ['id', 'verdict', 'evidence'],
  properties: {
    id: { type: 'string' },
    verdict: { enum: ['still-relevant', 'already-resolved', 'changed', 'by-design', 'human-or-future'] },
    evidence: { type: 'string', description: 'concrete paths + what you saw there that settled the verdict' },
    plan: {
      type: 'object', required: ['scope', 'routeSkill', 'acceptanceCriteria'],
      properties: {
        scope: { type: 'string', description: 'what actually needs to change, refreshed by the re-assessment' },
        routeSkill: { enum: ['plan-6-edit', 'build-improve-architecture', 'build-tdd'] },
        acceptanceCriteria: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'string' }, description: 'checkable bullets that say when the drift is gone' },
      },
      description: 'only for still-relevant/changed: the fix plan the eventual issue body will carry',
    },
  },
}
// Per-item re-assessment is parallel-heavy judgment — opus+high per the model-tier policy.
// Single stage (no separate planner): the re-assessor already holds all the context the
// fix plan needs. The await on parallel() is a deliberate barrier: Settle serializes
// shared-file edits (every item's outcome funnels into .plan/progress/index.md), so it
// needs the full verdict set before it can start.
const verdicts = (await parallel(items.map(i => () =>
  agent(
    `${CTX}\nYou are the re-assessor for ONE drift item. Read ${SKILL}/REASSESS.md FIRST and follow its method — confirm the where: still exists, then judge by kind; demonstrate, don't assert. Then read the drift file ${i.file}. IDEMPOTENCY: if that file's status: line already carries an annotation naming drift-triage with today's date (compare against date +%F), a previous pass of this same run settled it — trust it and re-emit the matching verdict without re-investigating. Otherwise: walk the where: location ("${i.where}") against the live tree with Read/Grep/Glob, and use git history (git log --oneline -- <paths>; read-only, no git mutations) to distinguish fixed-since-surfaced from never-a-real-problem. Reach ONE verdict: still-relevant | already-resolved | changed | by-design | human-or-future, with evidence naming the paths/commands and what you saw. For still-relevant or changed (changed = re-scope against what's actually there now) ALSO emit the fix plan: scope, routeSkill by kind per ${SKILL}/SKILL.md (defect/checkpoint-bug -> plan-6-edit; architecture smell -> build-improve-architecture; a concrete bounded fix -> build-tdd), and 2-4 checkable acceptance criteria. Set id="${i.id}". ${BRIEF}`,
    { label: `reassess:${i.id}`, phase: 'Reassess', model: 'opus', effort: 'high', schema: REASSESS_SCHEMA }
  ).then(v => v && { ...i, ...v })
))).filter(Boolean)

const TERMINAL = { 'already-resolved': 'resolved', 'by-design': 'by-design', 'human-or-future': 'human-or-future' }
const terminal = verdicts.filter(v => TERMINAL[v.verdict])
const survivors = verdicts.filter(v => v.verdict === 'still-relevant' || v.verdict === 'changed')
log(`reassessed ${verdicts.length}/${items.length}: ${survivors.length} survivors, ${terminal.length} terminal (${terminal.map(v => v.verdict).join(', ') || 'none'})`)

// ---------- Phase 3: settle the drift files ----------
// ONE serial agent, not a fan-out: every item's outcome touches the shared
// .plan/progress/index.md list (and the drift dir the index script re-reads), so
// concurrent editors would race; one sonnet pass applies the whole verdict set.
phase('Settle')
const settled = await agent(
  `${CTX}\nYou are the settler. Derive today's date once: date +%F. Apply the verdict set below, then refresh the hub.\n\nTERMINAL VERDICTS — for each, edit ONLY the status: line of its drift file:\n- already-resolved -> "status: resolved (drift-triage <today>)"\n- by-design -> "status: by-design (drift-triage <today>)"\n- human-or-future -> "status: human-or-future (drift-triage <today>)"\nTools classify on the leading keyword, so the trailing annotation is safe. NEVER delete a drift file — the history stays.\n${JSON.stringify(terminal.map(v => ({ id: v.id, file: v.file, verdict: v.verdict, evidence: v.evidence })), null, 1)}\n\nSURVIVORS — for each, leave status: as-is but append a short "## Triage <today>" section to its drift file carrying the verdict, the evidence, and the fix plan below, so a later publish pass can trust the triage without re-deriving it:\n${JSON.stringify(survivors.map(v => ({ id: v.id, file: v.file, verdict: v.verdict, evidence: v.evidence, plan: v.plan })), null, 1)}\n\nThen refresh the "Open cross-cutting items" list in ${PROGRESS}/index.md from: python3 ${PROGRESS}/drift-status.py --open. Do not run git. ${BRIEF}`,
  {
    label: 'settle:drift-files', phase: 'Settle', model: 'sonnet', effort: 'medium',
    schema: {
      type: 'object', required: ['settled', 'survivorsAnnotated', 'indexRefreshed'],
      properties: {
        settled: {
          type: 'array',
          items: {
            type: 'object', required: ['id', 'newStatus'],
            properties: { id: { type: 'string' }, newStatus: { type: 'string' } },
          },
        },
        survivorsAnnotated: { type: 'array', items: { type: 'string' } },
        indexRefreshed: { type: 'boolean' },
      },
    },
  }
)

// ---------- Phase 4: publish (opt-in) ----------
phase('Publish')
let pub = null
if (PUBLISH && survivors.length) {
  // ONE serial agent again: tracker CLI calls plus per-file route:/status: edits are
  // cheap but order-sensitive, and idempotency checks must see each prior edit.
  pub = await agent(
    `${CTX}\nYou are the publisher. Read ${ROOT}/.plan/tracker.md for the tracker backend, repo, exact label strings, and optional Project board — do not hardcode any of them. Derive today via date +%F. For EACH survivor below, in order:\n1. IDEMPOTENCY: read its drift file first — if route: already names a "follow-up issue #NNN", it is already published: record it as skipped, never open a duplicate.\n2. Otherwise create the issue per ${SKILL}/ISSUE-FORMAT.md: short specific title (the fix, not the symptom); body = "What's drifting" refreshed from the file's ## Triage note, the Where/Kind/Drift item lines, "How to address it" naming the routeSkill and why, and the acceptance criteria as checkboxes; label from the kind->route mapping using tracker.md's exact label strings. Use gh issue create (or tracker.md's equivalent for a non-GitHub backend) and capture #NNN from the printed URL.\n3. Edit the drift file: set "route: follow-up issue #NNN" and "status: routed (drift-triage <today>)".\nIf tracker.md configures a Project board, mirror each created issue in and set its Type field ONLY — leave Epic/Sprint unset; drift isn't sprint-bound. On a per-item failure, record it and continue with the rest. Do not run git mutations beyond the tracker CLI itself.\n\nSURVIVORS (fix plans already annotated under "## Triage" in each file):\n${JSON.stringify(survivors.map(v => ({ id: v.id, file: v.file, kind: v.kind, where: v.where, verdict: v.verdict, plan: v.plan })), null, 1)}\n${BRIEF}`,
    {
      label: 'publish:survivors', phase: 'Publish', model: 'sonnet', effort: 'medium',
      schema: {
        type: 'object', required: ['published', 'skippedAlreadyRouted', 'failures'],
        properties: {
          published: {
            type: 'array',
            items: {
              type: 'object', required: ['id', 'ref'],
              properties: { id: { type: 'string' }, ref: { type: 'string', description: '#NNN' } },
            },
          },
          skippedAlreadyRouted: { type: 'array', items: { type: 'string' } },
          failures: {
            type: 'array',
            items: {
              type: 'object', required: ['id', 'error'],
              properties: { id: { type: 'string' }, error: { type: 'string' } },
            },
          },
        },
      },
    }
  )
  log(`published ${(pub && pub.published || []).length}, skipped ${(pub && pub.skippedAlreadyRouted || []).length} already-routed, ${(pub && pub.failures || []).length} failures`)
} else {
  log(PUBLISH ? 'publish:true but no survivors — nothing to publish' : 'publish:false — batch stops at the approval gate')
}

// ---------- report ----------
const actionFor = v => {
  if (TERMINAL[v.verdict]) return `settled: ${TERMINAL[v.verdict]}`
  const hit = pub && (pub.published || []).find(p => p.id === v.id)
  if (hit) return `published: ${hit.ref}`
  if (pub && (pub.skippedAlreadyRouted || []).includes(v.id)) return 'skipped: already routed'
  if (pub) return 'publish failed — see published.failures'
  return 'survivor — awaiting publish approval'
}

return {
  items: verdicts.map(v => ({ id: v.id, kind: v.kind, where: v.where, verdict: v.verdict, evidence: v.evidence, plan: v.plan, action: actionFor(v) })),
  settled,
  published: pub,
  note: PUBLISH ? undefined : 'publish:false — present the batch and re-invoke with publish:true and the surviving ids',
  stats: {
    open: items.length,
    reassessed: verdicts.length,
    resolved: verdicts.filter(v => v.verdict === 'already-resolved').length,
    byDesign: verdicts.filter(v => v.verdict === 'by-design').length,
    parked: verdicts.filter(v => v.verdict === 'human-or-future').length,
    survivors: survivors.length,
    published: pub ? (pub.published || []).length : 0,
  },
}
