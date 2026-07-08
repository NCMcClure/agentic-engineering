export const meta = {
  name: 'plan-0-build-plan-tree',
  description: 'Decompose an approved spec into the full epic/sprint/issue plan tree: parallel page assessment, a lens-diverse judge panel for the epic shape, per-epic decomposition and authoring, a verify loop, and a three-critic audit',
  whenToUse: "plan-0-decompose at scale (roughly 15+ spec pages) or on an explicit headless/comprehensive run, after the user approves the run in plan mode. Args: {root, skillDir, pages?, context?, lenses?, decisionPolicy?}. decisionPolicy 'route' (default) turns product decisions into HITL decision issues; 'decide' (autonomous mode) resolves the derivable ones as ADRs first and leaves only the genuinely non-derivable residue as decision issues.",
  phases: [
    { title: 'Discover', detail: 'list spec content pages (skipped when args.pages is given)' },
    { title: 'Assess', detail: 'one assessor per page: contracts, deps, open questions', model: 'sonnet' },
    { title: 'Architect', detail: 'three lens proposals + judge synthesis of the epic shape' },
    { title: 'Decide', detail: "decisionPolicy:'decide' only — resolve derivable open questions as ADRs" },
    { title: 'Decompose', detail: 'one decomposer per epic — sprints, issues, open-question routing' },
    { title: 'Author', detail: 'writers emit verifier-exact plan files per epic', model: 'sonnet' },
    { title: 'Verify', detail: 'verify-plan-tree.py fix loop with escalation' },
    { title: 'Audit', detail: 'coverage / slice-quality / testability critics + fixer' },
  ],
}

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir) {
  throw new Error('args must be an object: {root: <absolute repo root>, skillDir: <plan-0-decompose skill dir>, pages?, context?, lenses?}')
}
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`
const PLANDIR = `${ROOT}/.plan/plan`

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your total structured output must stay well under 4000 tokens. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a planning pipeline decomposing the specification at ${SPEC}/ into an
implementation plan tree at ${PLANDIR}/ (epic -> sprint -> issue files whose formats are enforced
by ${PLANDIR}/verify-plan-tree.py). Orient at ${SPEC}/index.md; the project glossary is
${SPEC}/reference/glossary.md and its decision records are under ${SPEC}/reference/adr/.
${A.context ? `PROJECT NOTES: ${A.context}` : ''}
`

// ---------- Phase 0: discover pages ----------
let PAGES = Array.isArray(A.pages) && A.pages.length ? A.pages : null
if (!PAGES) {
  phase('Discover')
  const listing = await agent(
    `List every CONTENT page of the spec at ${SPEC}/ as paths relative to ${SPEC}/ (e.g. "02-runtime/event-loop.md"). Include section content files only: EXCLUDE every index.md, everything under reference/ (glossary, adr), assets/, scripts/, and .site/. Use ls/glob, not judgment. ${BRIEF}`,
    {
      label: 'discover:pages', phase: 'Discover', model: 'haiku', effort: 'low',
      schema: { type: 'object', required: ['pages'], properties: { pages: { type: 'array', items: { type: 'string' } } } },
    }
  )
  PAGES = listing && listing.pages && listing.pages.length ? listing.pages : null
  if (!PAGES) throw new Error('page discovery returned nothing — pass args.pages explicitly')
}

// ---------- Phase 1: page assessment (sonnet fan-out) ----------
phase('Assess')
log(`Assessing ${PAGES.length} spec pages`)

const ASSESS_SCHEMA = {
  type: 'object',
  required: ['page', 'summary', 'contracts', 'testSurface', 'dependsOn', 'openQuestions', 'complexity'],
  properties: {
    page: { type: 'string' },
    summary: { type: 'string', description: '1-2 sentences: what this page pins' },
    contracts: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object', required: ['name', 'oneLiner'],
        properties: { name: { type: 'string' }, oneLiner: { type: 'string' } },
      },
      description: 'buildable modules/contracts/surfaces this page defines',
    },
    testSurface: { type: 'string', description: 'what the page says is assertable, and how' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: "other spec pages this page's contracts consume (relative paths)" },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object', required: ['quote', 'kind', 'decisionNeeded', 'route'],
        properties: {
          quote: { type: 'string', description: 'short identifying quote of the open question' },
          kind: { enum: ['build-time-decision', 'product-decision'] },
          decisionNeeded: { type: 'string' },
          route: { enum: ['decision-issue', 'inline-note'], description: 'product decisions someone must make -> decision-issue; builder-choice-within-fixed-constraints -> inline-note' },
          blockedWork: { type: 'string', description: 'what implementation work this question gates' },
        },
      },
    },
    complexity: { type: 'integer', minimum: 1, maximum: 5 },
  },
}

const assessments = (await parallel(PAGES.map(p => () =>
  agent(
    `${CTX}\nYou are a spec-page assessor. Read ${SPEC}/${p} closely (and skim any ADR it cites if needed to understand a contract). Extract, for the implementation planner: the buildable contracts it pins, its test surface, which OTHER spec pages its contracts depend on (consume interfaces of), and EVERY open question — both "## Open questions" sections and inline "**Open question:**" blocks. Classify each open question: 'build-time-decision' (spec fixes constraints, builder picks encoding — route: inline-note) vs 'product-decision' (a genuine unmade decision that gates work — route: decision-issue). Set page="${p}". ${BRIEF}`,
    { label: `assess:${p.split('/').pop()}`, phase: 'Assess', schema: ASSESS_SCHEMA, model: 'sonnet', effort: 'medium' }
  )
))).filter(Boolean)
log(`Assessed ${assessments.length}/${PAGES.length} pages; ${assessments.reduce((n, a) => n + a.openQuestions.length, 0)} open questions inventoried`)

// ---------- Phase 2: epic shape (lens proposals + judge) ----------
phase('Architect')
const SHAPE_SCHEMA = {
  type: 'object',
  required: ['epics', 'openQuestionRouting', 'rationale'],
  properties: {
    epics: {
      type: 'array',
      items: {
        type: 'object',
        required: ['num', 'slug', 'title', 'goal', 'anchors', 'sprints', 'blockedBy'],
        properties: {
          num: { type: 'string', description: 'two digits, e.g. "01"' },
          slug: { type: 'string', description: 'kebab-case' },
          title: { type: 'string' },
          goal: { type: 'string', description: 'the coarse observable outcome' },
          anchors: { type: 'array', items: { type: 'string' }, description: 'spec pages this epic realises (relative paths)' },
          blockedBy: { type: 'array', items: { type: 'string' }, description: 'epic nums this depends on' },
          sprints: {
            type: 'array',
            items: {
              type: 'object', required: ['num', 'slug', 'title', 'goal'],
              properties: {
                num: { type: 'string' }, slug: { type: 'string' }, title: { type: 'string' },
                goal: { type: 'string', description: 'observable sprint exit outcome' },
                blockedBy: { type: 'array', items: { type: 'string' }, description: 'sprint refs like "01-02" (may cross epics)' },
              },
            },
          },
        },
      },
    },
    openQuestionRouting: {
      type: 'array',
      items: {
        type: 'object', required: ['page', 'quote', 'route', 'epicNum'],
        properties: {
          page: { type: 'string' }, quote: { type: 'string' },
          route: { enum: ['decision-issue', 'inline-note'] },
          epicNum: { type: 'string', description: 'epic that owns addressing it' },
          sprintNum: { type: 'string', description: 'sprint within the epic, if determinable' },
          note: { type: 'string' },
        },
      },
      description: 'EVERY open question from the assessments must appear exactly once',
    },
    rationale: { type: 'string' },
  },
}

const LENSES = (Array.isArray(A.lenses) && A.lenses.length) ? A.lenses : [
  { key: 'tracer-first', prompt: 'Optimize for the earliest possible end-to-end tracer bullet: the thinnest path from nothing to a demoable walking skeleton, then widen. Every epic must keep the system demoable.' },
  { key: 'risk-first', prompt: 'Optimize for retiring the riskiest integrations and least-understood contracts first — front-load whatever could invalidate the design if it turns out harder than the spec assumes.' },
  { key: 'dependency-first', prompt: 'Optimize for a clean topological build order from the dependsOn graph in the assessments: no sprint ever blocked on a later epic, maximal parallel-safe frontier for multi-agent building (build-sprint fans builders across unblocked issues).' },
]

const proposals = (await parallel(LENSES.map(l => () =>
  agent(
    `${CTX}\nYou are a plan architect. Read ${SKILL}/SKILL.md and ${SKILL}/VERTICAL-SLICES.md for the decomposition discipline (epics = large observable outcomes; sprints = coherent batches ordered by data-flow dependency; issues come later). Read ${SPEC}/index.md for orientation. Then design the FULL epic -> sprint shape for building this product, from these page assessments (contracts, dependencies, complexity, open questions):\n${JSON.stringify(assessments, null, 1)}\n\nLens: ${l.prompt}\n\nRules: every one of the ${PAGES.length} spec pages appears in at least one epic's anchors; every open question in the assessments appears exactly once in openQuestionRouting (kind product-decision -> route decision-issue; build-time-decision -> inline-note); epics number from 01 in build order; 4-8 epics, 2-5 sprints each; cross-epic sprint dependencies allowed but minimized. If the spec includes a deployment/platform story, a deployed skeleton belongs early, not last. ${BRIEF}`,
    { label: `shape:${l.key}`, phase: 'Architect', schema: SHAPE_SCHEMA, model: 'opus', effort: 'high' }
  )
))).filter(Boolean) // barrier justified: the judge needs all proposals
log(`${proposals.length} epic-shape proposals in; judging`)

const shape = await agent(
  `${CTX}\nYou are the plan-shape judge. Read ${SKILL}/VERTICAL-SLICES.md. Below are ${proposals.length} independent epic->sprint shape proposals (lenses: ${LENSES.map(l => l.key).join(', ')}) for the same spec, plus the open-question ledger they were built from. Score each on: earliest end-to-end tracer bullet, risk retirement order, dependency cleanliness (no forward references), open-question routing sanity, and honesty of sprint exit outcomes. Synthesize the WINNING shape — take the best proposal as the base and graft superior elements from the others. Enforce: every spec page anchored somewhere; every open question routed exactly once; epic/sprint numbering dense from 01.\n\nPROPOSALS:\n${JSON.stringify(proposals, null, 1)}\n\nASSESSMENT OPEN-QUESTION LEDGER (for completeness checking):\n${JSON.stringify(assessments.map(a => ({ page: a.page, openQuestions: a.openQuestions.map(q => q.quote) })), null, 1)}\n${BRIEF}`,
  { label: 'shape:judge', phase: 'Architect', schema: SHAPE_SCHEMA, effort: 'max' }
)
if (!shape || !shape.epics || !shape.epics.length) throw new Error('shape synthesis failed')
log(`Shape: ${shape.epics.length} epics — ${shape.epics.map(e => `${e.num}-${e.slug}(${e.sprints.length}sp)`).join(', ')}`)

// ---------- Phase 2b: decision resolution (decisionPolicy: 'decide' only) ----------
let decisionsMade = []
if (A.decisionPolicy === 'decide') {
  const pending = shape.openQuestionRouting.filter(q => q.route === 'decision-issue')
  if (pending.length) {
    phase('Decide')
    log(`decisionPolicy=decide: attempting to resolve ${pending.length} decision-issue open questions`)
    // singleton judgment — inherits the session model deliberately
    const resolved = await agent(
      `${CTX}\nYou are the decision resolver for an autonomous planning run. Below are the open questions routed as product decisions. For EACH one, decide it ONLY where the answer is genuinely derivable from existing sources — the spec's own stated constraints and tensions, ${SPEC}/reference/glossary.md, the ADRs under ${SPEC}/reference/adr/, and the project notes. For each decision you make: write a new ADR under ${SPEC}/reference/adr/ (next free number, matching the existing ADR file format exactly, and add it to adr/index.md) recording the decision, the options considered, and why it is derivable rather than a fresh product call; then report it decided=true with the decision text and ADR filename. A question whose answer is NOT derivable — a genuine unmade product call — stays decided=false with a reason; do not guess, that residue is the point. Do not run git.\n\nOPEN QUESTIONS:\n${JSON.stringify(pending, null, 1)}\n${BRIEF}`,
      {
        label: 'decide:resolver', phase: 'Decide', effort: 'max',
        schema: {
          type: 'object', required: ['decisions'],
          properties: {
            decisions: {
              type: 'array',
              items: {
                type: 'object', required: ['page', 'quote', 'decided'],
                properties: {
                  page: { type: 'string' }, quote: { type: 'string' },
                  decided: { type: 'boolean' },
                  decision: { type: 'string', description: 'the decision made (decided=true)' },
                  adr: { type: 'string', description: 'ADR filename written (decided=true)' },
                  reason: { type: 'string', description: 'why it is not derivable (decided=false)' },
                },
              },
            },
          },
        },
      }
    )
    if (resolved && resolved.decisions) {
      decisionsMade = resolved.decisions.filter(d => d.decided)
      for (const d of decisionsMade) {
        const entry = shape.openQuestionRouting.find(q => q.route === 'decision-issue' && q.page === d.page && q.quote === d.quote)
        if (entry) {
          entry.route = 'inline-note'
          entry.note = `decided: ${d.decision} (${d.adr})${entry.note ? ' — ' + entry.note : ''}`
        }
      }
      log(`Decide: ${decisionsMade.length}/${pending.length} resolved as ADRs; ${pending.length - decisionsMade.length} remain HITL decision issues`)
    }
  }
}

// ---------- Phase 3+4: decompose per epic, then author files, pipelined ----------
const DECOMP_SCHEMA = {
  type: 'object',
  required: ['epicNum', 'sprints'],
  properties: {
    epicNum: { type: 'string' },
    sprints: {
      type: 'array',
      items: {
        type: 'object',
        required: ['num', 'slug', 'title', 'goal', 'issues', 'blockedBy'],
        properties: {
          num: { type: 'string' }, slug: { type: 'string' }, title: { type: 'string' }, goal: { type: 'string' },
          blockedBy: { type: 'array', items: { type: 'string' } },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              required: ['num', 'slug', 'title', 'type', 'whatToBuild', 'anchors', 'acceptanceCriteria', 'checkpoint', 'blockedBy'],
              properties: {
                num: { type: 'string', description: 'two digits within the sprint' },
                slug: { type: 'string', description: 'UPPERCASE-HYPHENATED, short' },
                title: { type: 'string', description: 'the observable behaviour, domain language' },
                type: { enum: ['HITL', 'AFK'] },
                whatToBuild: { type: 'string', description: '2-5 sentences, end-to-end slice description; name the spec constraints; include inline-note open-question dispositions here' },
                anchors: { type: 'array', items: { type: 'string' }, description: 'spec pages, relative paths — at least one' },
                acceptanceCriteria: { type: 'array', items: { type: 'string' }, description: 'each phrased as an executable/checkable target' },
                checkpoint: {
                  type: 'object', required: ['check', 'command', 'expected'],
                  properties: { check: { type: 'string' }, command: { type: 'string' }, expected: { type: 'string' } },
                },
                blockedBy: { type: 'array', items: { type: 'string' }, description: 'sibling issue nums in this sprint, or cross refs "EE-SS-II"' },
                decisionIssue: { type: 'boolean', description: 'true if this is an open-question decision issue' },
              },
            },
          },
        },
      },
    },
  },
}

const epicAssessFor = e => assessments.filter(a => e.anchors.includes(a.page))
const oqFor = e => shape.openQuestionRouting.filter(q => q.epicNum === e.num)

const perEpic = await pipeline(
  shape.epics,
  // stage 1: decomposer (inherits the session model — judgment work)
  e => agent(
    `${CTX}\nYou are the issue decomposer for Epic ${e.num} "${e.title}" (${e.slug}). Read ${SKILL}/VERTICAL-SLICES.md and ${SKILL}/SPEC-ANCHORS.md first — every issue is a tracer-bullet vertical slice, demoable alone; prefer many thin slices. Read the anchored spec pages as needed: ${e.anchors.map(a => `${SPEC}/${a}`).join(', ')}.\n\nEPIC SHAPE (yours + siblings for cross-epic blockedBy refs):\n${JSON.stringify(shape.epics.map(x => ({ num: x.num, slug: x.slug, sprints: x.sprints.map(s => ({ num: s.num, slug: s.slug, goal: s.goal })) })), null, 1)}\n\nYOUR EPIC: ${JSON.stringify(e, null, 1)}\n\nPAGE ASSESSMENTS for your anchors:\n${JSON.stringify(epicAssessFor(e), null, 1)}\n\nOPEN QUESTIONS ROUTED TO THIS EPIC — every 'decision-issue' one MUST become a dedicated HITL issue (type HITL, decisionIssue true, placed in the earliest sprint whose work it gates, blocking the gated issues; its criteria are decision-shaped, not code-shaped); every 'inline-note' one MUST appear verbatim-referenced in the whatToBuild of the issue that implements the constrained contract:\n${JSON.stringify(oqFor(e), null, 1)}\n\nProduce the complete sprint+issue decomposition for this epic. Acceptance criteria are executable/checkable targets in the project's own test vocabulary (honour any testing conventions the spec pins). Checkpoint commands should be real where inferable, else an honest manual step. Type=AFK wherever an agent can honestly implement+verify alone. ${BRIEF} Cap: total structured output under 8000 tokens; keep whatToBuild tight.`,
    { label: `decompose:${e.num}-${e.slug}`, phase: 'Decompose', schema: DECOMP_SCHEMA, model: 'opus', effort: 'high' }
  ),
  // stage 2: file author for this epic's directory (menial template work)
  (decomp, e) => decomp && agent(
    `${CTX}\nYou are a plan-file author. Write the plan-tree files for Epic ${e.num} "${e.title}" under ${PLANDIR}/${e.num}-${e.slug}/ EXACTLY per the templates in ${SKILL}/PLAN-FORMAT.md (READ IT FIRST — field names, bold labels, section headings, link shapes, and the issue filename regex ^[0-9]{2}_issue_[A-Z][A-Z0-9-]+\\.md$ are verifier-enforced; keep **GitHub**: <unassigned> and **Status**: not-started everywhere; spec-anchor links from an issue file use ../../../../spec/<path>).\n\nEPIC: ${JSON.stringify({ num: e.num, slug: e.slug, title: e.title, goal: e.goal, anchors: e.anchors, blockedBy: e.blockedBy }, null, 1)}\n\nDECOMPOSITION (authoritative content):\n${JSON.stringify(decomp, null, 1)}\n\nWrite: epic.md (sprint table + goal + sprint sequencing + testing checkpoints + blocked-by/blocks using sibling epic dirs ${shape.epics.map(x => `${x.num}-${x.slug}`).join(', ')}), each sprint dir's sprint.md (issue table matching the files you create), and every issues/NN_issue_SLUG.md (all four bold fields, all five sections, blocked-by links resolving to real sibling files or "None"). Do NOT write ${PLANDIR}/index.md (another agent owns it). Do NOT run git. Return counts.`,
    {
      label: `author:${e.num}-${e.slug}`, phase: 'Author', model: 'sonnet', effort: 'medium',
      schema: {
        type: 'object', required: ['epicNum', 'sprintCount', 'issueCount', 'files'],
        properties: { epicNum: { type: 'string' }, sprintCount: { type: 'integer' }, issueCount: { type: 'integer' }, files: { type: 'integer' } },
      },
    }
  )
)

const authored = perEpic.filter(Boolean)
const totalIssues = authored.reduce((n, a) => n + (a.issueCount || 0), 0)
log(`Authored ${authored.length}/${shape.epics.length} epics, ${totalIssues} issues total; writing index`)

// index author (needs all epics done — pipeline() completion is that barrier)
await agent(
  `You are the plan-index author. ${PLANDIR}/index.md currently holds a spec-0-init stub. Rewrite its "## Epics" section as the epic table per ${SKILL}/PLAN-FORMAT.md (READ IT): one row per epic dir on disk under ${PLANDIR}/ (link (NN-slug/epic.md)), with real sprint/issue counts from disk, Status not-started, and a Total row. Keep any non-Epics prose that still makes sense. Then run: python3 ${PLANDIR}/verify-plan-tree.py — report its exit code and first errors verbatim. Fix nothing else.`,
  {
    label: 'author:index', phase: 'Author', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', required: ['verifierExit0', 'firstErrors'], properties: { verifierExit0: { type: 'boolean' }, firstErrors: { type: 'string' } } },
  }
)

// ---------- Phase 5: verify loop ----------
phase('Verify')
const VERIFY_SCHEMA = { type: 'object', required: ['exit0', 'summary'], properties: { exit0: { type: 'boolean' }, summary: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } } } }
let vres = null
for (let round = 1; round <= 3; round++) {
  vres = await agent(
    `Run: python3 ${PLANDIR}/verify-plan-tree.py (cwd ${ROOT}). If it exits 0, report exit0=true and stop. Otherwise fix EVERY reported violation in the plan tree under ${PLANDIR}/ — structure, field names, table/disk mismatches, unresolved blocked-by links, unresolved spec anchors (the correct relative prefix from an issue file is ../../../../spec/) — per the templates in ${SKILL}/PLAN-FORMAT.md, re-running the verifier until it exits 0 or you are stuck. Never delete an issue to silence the verifier; fix the reference instead. Do not run git. ${BRIEF}`,
    { label: `verify-fix:round${round}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VERIFY_SCHEMA }
  )
  if (vres && vres.exit0) break
  log(`verify round ${round}: ${vres ? vres.summary : 'agent failed'}`)
}
if (!vres || !vres.exit0) {
  vres = await agent(
    `The plan tree at ${PLANDIR}/ still fails python3 ${PLANDIR}/verify-plan-tree.py after 3 fix rounds (last state: ${JSON.stringify(vres && vres.summary)}). Read ${SKILL}/PLAN-FORMAT.md, diagnose the root cause (often a systematic template deviation), fix it tree-wide, and re-run until exit 0. ${BRIEF}`,
    { label: 'verify-fix:escalate', phase: 'Verify', effort: 'high', schema: VERIFY_SCHEMA }
  )
}
log(`Verifier: ${vres && vres.exit0 ? 'exit 0' : 'STILL FAILING'}`)

// ---------- Phase 6: audit (three critics + fixer) ----------
phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array', maxItems: 25,
      items: {
        type: 'object', required: ['severity', 'where', 'problem', 'fix'],
        properties: {
          severity: { enum: ['critical', 'major', 'minor'] },
          where: { type: 'string', description: 'plan file path or "shape"' },
          problem: { type: 'string' }, fix: { type: 'string', description: 'concrete instruction for the fixer' },
        },
      },
    },
  },
}
const CRITICS = [
  { key: 'coverage', prompt: `Audit COVERAGE of the plan tree at ${PLANDIR}/ against the spec: (a) every one of these ${PAGES.length} spec pages must be an anchor of at least one issue — build the matrix by grepping the tree (grep -rl "spec/<page>" ${PLANDIR}); (b) EVERY open question in this ledger must be addressed — a 'decision-issue' one has a dedicated HITL issue whose title names the decision, an 'inline-note' one is referenced in some issue's What to build; list every miss:\n` },
  { key: 'slices', prompt: `Audit SLICE QUALITY per ${SKILL}/VERTICAL-SLICES.md (read it first): sample at least 3 issues from EVERY sprint in ${PLANDIR}/ and flag horizontal slices (layer-only work with no observable behaviour), slices not verifiable alone, dishonest AFK labels (needs human judgment), oversized slices that should split, and sprint goals that are not observable exits. Ledger for context:\n` },
  { key: 'testability', prompt: `Audit TESTABILITY: acceptance criteria must be executable/checkable targets (honour any acceptance-criteria/testing conventions the spec pins — check ${SPEC}/reference/adr/ for them), checkpoint commands must be plausible, and decision issues must have decision-shaped (not code-shaped) criteria. Sample broadly across ${PLANDIR}/. Ledger for context:\n` },
]
const oqLedger = shape.openQuestionRouting
const criticResults = await parallel(CRITICS.map(c => () =>
  agent(`${CTX}\n${c.prompt}${JSON.stringify(oqLedger, null, 1)}\n\nReport findings with concrete per-file fixes. Empty findings list is acceptable if genuinely clean. ${BRIEF}`,
    { label: `audit:${c.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, model: 'opus', effort: 'high' })
))
const findings = criticResults.filter(Boolean).flatMap(r => r.findings)
log(`Audit: ${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical)`)

let auditFix = null
if (findings.length) {
  auditFix = await agent(
    `${CTX}\nYou are the plan-tree fixer. Apply these audit findings to the tree at ${PLANDIR}/ (templates: ${SKILL}/PLAN-FORMAT.md — keep every verifier contract intact; adding an issue means updating its sprint table and counts up the chain; renumbering is allowed only within a sprint). Skip a finding only if on inspection it is wrong, with a reason. Then run python3 ${PLANDIR}/verify-plan-tree.py until exit 0. Do not run git.\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n${BRIEF}`,
    {
      label: 'audit:fixer', phase: 'Audit', model: 'opus', effort: 'high',
      schema: {
        type: 'object', required: ['applied', 'skipped', 'verifierExit0'],
        properties: { applied: { type: 'integer' }, skipped: { type: 'array', items: { type: 'object', required: ['problem', 'reason'], properties: { problem: { type: 'string' }, reason: { type: 'string' } } } }, verifierExit0: { type: 'boolean' } },
      },
    }
  )
}

return {
  shape: { epics: shape.epics.map(e => ({ num: e.num, slug: e.slug, title: e.title, goal: e.goal, sprints: e.sprints.length })), rationale: shape.rationale },
  counts: { pagesAssessed: assessments.length, openQuestions: oqLedger.length, decisionIssues: oqLedger.filter(q => q.route === 'decision-issue').length, epics: authored.length, issues: totalIssues },
  verifier: vres,
  audit: { findings: findings.length, critical: findings.filter(f => f.severity === 'critical').length, fix: auditFix },
  openQuestionRouting: oqLedger,
  decisionsMade,
}
