export const meta = {
  name: 'build-improve-deepening-hunt',
  description: 'Parallel deepening hunt over built code: per-area hunters + churn/test-surface/pass-through lenses, semantic dedup, adversarial deletion-test verification, a judge ranking with a top recommendation, and an HTML report. Report-only — applying refactors is test-gated build-tdd work',
  whenToUse: "build-improve-architecture's autonomous mode, or a codebase too big for one Explore pass (roughly 20+ modules). Args: {root, skillDir, areas?, context?, extraLenses?}. areas (paths relative to root) overrides discovery.",
  phases: [
    { title: 'Discover', detail: 'map top-level code areas + git churn top-20', model: 'haiku' },
    { title: 'Hunt', detail: 'one deepening hunter per area + cross-cutting lenses', model: 'opus' },
    { title: 'Dedup', detail: 'semantic merge of overlapping candidates', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial re-run of the deletion test on every candidate', model: 'opus' },
    { title: 'Judge', detail: 'rank survivors, pick the top recommendation' },
    { title: 'Report', detail: 'self-contained HTML report in the OS temp dir', model: 'sonnet' },
  ],
}

// Model tiers: haiku+low = pure retrieval/discovery, never judgment; sonnet = mechanical
// authoring / report rendering; opus+high = parallel-heavy judgment (hunters, lenses,
// adversarial verifiers); model omitted (inherit the session model) + high/max effort =
// singleton judgment (the judge).
//
// NO Apply stage by design: applying a refactor to built code is test-gated
// implementation work — it goes through the skill's interactive grilling loop and
// build-tdd, never through a headless pipeline.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir) throw new Error('args must be an object: {root: <absolute repo root>, skillDir: <build-improve-architecture skill dir>, areas?, context?, extraLenses?}')
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const CANON = `${SKILL}/../spec-3-architect` // canonical LANGUAGE.md / DEEPENING.md / HTML-REPORT.md
const SPEC = `${ROOT}/.plan/spec` // may not exist — hunters check before reading

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your total structured output must stay well under 4000 tokens. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a deepening hunt over the BUILT CODEBASE at ${ROOT}/ — real code,
not a design. The aim is testability and AI-navigability: find refactor candidates that
turn shallow modules into deep ones.
${A.context ? `PROJECT NOTES: ${A.context}` : ''}
`

const HUNT_GUIDE = `
Read ${CANON}/LANGUAGE.md and ${CANON}/DEEPENING.md FIRST — every string you emit uses that
vocabulary exactly (module, interface, seam, depth, deep, shallow, adapter, leverage,
locality; NEVER "component", "service", or "boundary"). THEN, if a .plan/ workspace exists
(check for ${SPEC}/), also read the project glossary (${SPEC}/reference/glossary.md), the
ADRs (${SPEC}/reference/adr/), and the spec sections covering your area — the spec is the
DESIGN INTENT. Where the code has drifted from what the spec describes, that is a FINDING
to route to spec-4-edit, NOT a refactor candidate: report it in specDriftFindings (where =
code location, spec = the spec file, claim = what the spec says vs what the code does,
evidence = paths + quotes) and leave it out of candidates.
Hunt for: (a) shallow modules — interface nearly as complex as the implementation; apply
the DELETION TEST to every suspect and QUOTE its outcome in deletionTest ("deleting X: the
complexity reappears in each of its 4 callers" / "vanishes — pass-through"); (b) leaky
seams — modules that each need the other's internals; (c) missing seams for testability —
dependencies that cannot be substituted through the current interface (the interface is
the test surface). wins are phrased in locality/leverage terms. files are source paths
relative to ${ROOT}/. If a candidate contradicts an ADR, list it in adrConflicts and only
propose it when the friction justifies reopening. Badge honesty: Strong only when the
deletion test clearly signals; do not pad — empty lists are acceptable.
`

const CANDIDATE = {
  type: 'object',
  required: ['title', 'modules', 'files', 'problem', 'solution', 'wins', 'badge', 'evidence', 'adrConflicts', 'deletionTest'],
  properties: {
    title: { type: 'string', description: 'names the deepening, e.g. "Collapse the intake pipeline into one module"' },
    modules: { type: 'array', items: { type: 'string' }, description: 'modules involved (functions/classes/packages), project names' },
    files: { type: 'array', items: { type: 'string' }, description: 'source files involved, relative to repo root' },
    problem: { type: 'string', description: 'the friction, one sentence' },
    solution: { type: 'string', description: 'what the code becomes, one sentence' },
    wins: { type: 'string', description: 'gains in locality/leverage terms, incl. how tests improve' },
    badge: { enum: ['Strong', 'Worth exploring', 'Speculative'] },
    evidence: { type: 'string', description: 'source paths + verbatim quotes supporting the claim' },
    adrConflicts: { type: 'array', items: { type: 'string' }, description: 'ADRs this contradicts (empty if none)' },
    deletionTest: { type: 'string', description: 'what the deletion test showed, quoted outcome' },
  },
}
const DRIFT = {
  type: 'object', required: ['where', 'spec', 'claim', 'evidence'],
  properties: {
    where: { type: 'string', description: 'code location of the drift' },
    spec: { type: 'string', description: 'spec file describing the intent' },
    claim: { type: 'string', description: 'what the spec says vs what the code does' },
    evidence: { type: 'string', description: 'paths + quotes' },
  },
}
const HUNT_OUT = {
  type: 'object', required: ['candidates', 'specDriftFindings'],
  properties: {
    candidates: { type: 'array', maxItems: 12, items: CANDIDATE },
    specDriftFindings: { type: 'array', items: DRIFT, description: 'empty if no .plan/ workspace or no drift' },
  },
}
const VERDICT = {
  type: 'object',
  required: ['refuted', 'reasoning', 'confidence', 'adjusted_badge'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    adjusted_badge: { enum: ['Strong', 'Worth exploring', 'Speculative'] },
  },
}

// ---------- Phase 0: discover areas + churn ----------
phase('Discover')
const disco = await agent(
  `Map the codebase at ${ROOT}/ — pure retrieval, no judgment. (1) List the top-level CODE areas: source directories with their file and line-of-code counts (use ls/glob/wc; exclude vendored/node_modules/dist/build/target dirs, .git/, and .plan/). (2) Report churn: run \`git -C ${ROOT} log --since='6 months ago' --pretty=format: --name-only | sort | uniq -c | sort -rn | head -20\` and return it as {path, changes} pairs (skip blank lines). ${BRIEF}`,
  {
    label: 'discover:areas', phase: 'Discover', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['areas', 'churnTop'],
      properties: {
        areas: { type: 'array', items: { type: 'object', required: ['path', 'files', 'loc'], properties: { path: { type: 'string' }, files: { type: 'integer' }, loc: { type: 'integer' } } } },
        churnTop: { type: 'array', items: { type: 'object', required: ['path', 'changes'], properties: { path: { type: 'string' }, changes: { type: 'integer' } } } },
      },
    },
  }
)
const AREAS = (Array.isArray(A.areas) && A.areas.length) ? A.areas : (disco && disco.areas ? disco.areas.map(a => a.path) : [])
if (!AREAS.length) throw new Error('no code areas found under ' + ROOT + ' — pass args.areas explicitly')
const CHURN = (disco && disco.churnTop) ? disco.churnTop : []

// ---------- Phase 1: hunt (per-area hunters + cross lenses) ----------
phase('Hunt')
const LENSES = [
  { key: 'test-surface', prompt: `You are the test-surface lens over the whole codebase. The interface is the test surface: find modules that are UNTESTABLE through their current interface — no seam to substitute a dependency, so tests would have to reach past the interface (or the module is simply untested because it can't be). Classify each candidate's dependencies per ${CANON}/DEEPENING.md (in-process / local-substitutable / owned-remote / true-external) and say where the seam belongs.` },
  { key: 'churn-coupling', prompt: `You are the churn-coupling lens. Hot files from the last six months, by commit count:\n${JSON.stringify(CHURN, null, 1)}\nFor the hottest files, check which of them keep changing TOGETHER — grep git log for co-changes (e.g. git -C ${ROOT} log --since='6 months ago' --pretty=format:'%h' --name-only, read-only) and read the co-changing files. Files that always change in lockstep across a seam signal a responsibility split across modules with no locality — a deepening candidate that concentrates it in one module.` },
  { key: 'pass-through', prompt: `You are the pass-through lens. Hunt for modules that FAIL the deletion test — deleting them would just move the same complexity elsewhere, not make it reappear across callers: thin wrappers that add a name but no behaviour, layers every call traverses unchanged, one-caller indirections, single-adapter seams where nothing varies. Each candidate proposes the collapse and quotes the deletion-test outcome.` },
  ...(Array.isArray(A.extraLenses) ? A.extraLenses.filter(l => l && l.key && l.prompt) : []),
]
log(`Fanning out ${AREAS.length} area hunters + ${LENSES.length} cross-cutting lenses (churn top: ${CHURN.length} files)`)

const areaThunks = AREAS.map(a => () =>
  agent(
    `${CTX}${HUNT_GUIDE}\nYou are the dedicated deepening hunter for the code area ${ROOT}/${a}. Read its modules closely — interfaces first (what every caller must know), then implementations. Find deepening candidates within and at the edges of this area. ${BRIEF}`,
    { label: `hunt:${a}`, phase: 'Hunt', schema: HUNT_OUT, model: 'opus', effort: 'high' }
  )
)
const lensThunks = LENSES.map(l => () =>
  agent(`${CTX}${HUNT_GUIDE}\n${l.prompt} ${BRIEF}`, { label: `lens:${l.key}`, phase: 'Hunt', schema: HUNT_OUT, model: 'opus', effort: 'high' })
)
// barrier justified: dedup needs the complete candidate set before it can merge overlaps
const huntResults = await parallel([...areaThunks, ...lensThunks])
const huntSources = [...AREAS.map(a => `hunt:${a}`), ...LENSES.map(l => `lens:${l.key}`)]
const raw = []
const specDriftFindings = []
huntResults.forEach((r, i) => {
  if (r && r.candidates) r.candidates.forEach(c => raw.push({ ...c, source: huntSources[i] }))
  if (r && r.specDriftFindings) specDriftFindings.push(...r.specDriftFindings)
})
log(`Collected ${raw.length} raw candidates + ${specDriftFindings.length} spec-drift findings from ${huntResults.filter(Boolean).length}/${huntSources.length} hunters`)
if (!raw.length) return { reportPath: null, candidates: [], refuted: [], topRecommendation: null, specDriftFindings, stats: { raw: 0 }, note: 'hunt found no deepening candidates — the codebase may already be deep' }

// ---------- Phase 2: dedup ----------
phase('Dedup')
const numbered = raw.map((c, i) => ({ id: i, ...c }))
const deduped = await agent(
  `You are a candidates editor. Below is a JSON array of deepening candidates from independent hunters over the same codebase. Merge candidates that describe the SAME underlying deepening (even if worded differently or anchored to neighboring files) into single candidates — union modules/files/evidence/adrConflicts, keep the clearest title and deletionTest, keep the STRONGEST badge among members (Strong > Worth exploring > Speculative), and list all member ids. Genuinely different deepenings stay separate, even in the same area. Every input id must appear in exactly one merged entry. Do not soften claims.\n\nCANDIDATES:\n${JSON.stringify(numbered, null, 1)}\n${BRIEF}`,
  {
    label: 'dedup', phase: 'Dedup', model: 'sonnet', effort: 'medium',
    schema: {
      type: 'object', required: ['merged'],
      properties: { merged: { type: 'array', items: { ...CANDIDATE, required: ['ids', ...CANDIDATE.required], properties: { ids: { type: 'array', items: { type: 'integer' } }, ...CANDIDATE.properties } } } },
    },
  }
)
const merged = (deduped && deduped.merged) ? deduped.merged : numbered.map(c => ({ ...c, ids: [c.id] }))
log(`Deduped ${raw.length} raw candidates into ${merged.length}`)

// ---------- Phase 3: adversarial verify ----------
phase('Verify')
// barrier justified: the judge ranks only the surviving set — it needs every verdict in
const verified = await parallel(merged.map(c => () =>
  agent(
    `${CTX}\nYou are an adversarial verifier. A hunter proposes the refactor candidate below. REFUTE it if you can: (1) re-run the deletion test yourself, skeptically — read the cited source files and their callers and check whether deleting the module really makes complexity reappear across callers, or the claimed pass-through is actually earning its keep (error handling, invariants, caching it quietly owns); (2) if ${SPEC}/reference/adr/ exists, check no ADR already settles this (Grep before concluding); (3) check the "shallow" claim against the module's ACTUAL interface — everything a caller must know (types, invariants, error modes, config), not just the signature. If the candidate misreads the code, is settled by an ADR it doesn't justify reopening, or the evidence doesn't support the claim, set refuted=true and explain. If it survives, set refuted=false and set adjusted_badge to what the evidence actually supports (raise or lower). Default to refuted=true when the evidence is too thin to confirm. Vocabulary per ${CANON}/LANGUAGE.md.\n\nCANDIDATE:\n${JSON.stringify({ title: c.title, modules: c.modules, files: c.files, problem: c.problem, solution: c.solution, badge: c.badge, evidence: c.evidence, adrConflicts: c.adrConflicts, deletionTest: c.deletionTest }, null, 1)}\n${BRIEF}`,
    { label: `verify:${c.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT, model: 'opus', effort: 'high' }
  ).then(v => ({ ...c, verdict: v }))
))
const confirmed = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === false)
  .map(x => ({ ...x, badge: x.verdict.adjusted_badge || x.badge }))
const refuted = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === true)
log(`Verification: ${confirmed.length} confirmed, ${refuted.length} refuted`)
const refutedSlim = refuted.map(x => ({ title: x.title, reason: x.verdict.reasoning }))
if (!confirmed.length) return { reportPath: null, candidates: [], refuted: refutedSlim, topRecommendation: null, specDriftFindings, stats: { raw: raw.length, deduped: merged.length, confirmed: 0, refutedCount: refuted.length }, note: 'every candidate was refuted under adversarial verification' }

// ---------- Phase 4: judge (singleton judgment — inherits the session model) ----------
phase('Judge')
const judged = await agent(
  `${CTX}\nYou are the deepening judge. Below are the refactor candidates that survived adversarial verification, numbered. Rank them by expected payoff: leverage of the deepened interface, locality gained, testability won (a seam where there was none), churn relief (does it sit on hot files?), and refactor cost/risk (blast radius of callers, test coverage available to gate it; ADR conflicts weigh against). DROP any Speculative candidate that substantially overlaps a Strong one (the Strong one subsumes it). Pick ONE topRecommendation and say why in a sentence. Vocabulary per ${CANON}/LANGUAGE.md.\n\nCHURN TOP (for the churn-relief criterion):\n${JSON.stringify(CHURN, null, 1)}\n\nCANDIDATES:\n${JSON.stringify(confirmed.map((c, i) => ({ id: i, title: c.title, modules: c.modules, files: c.files, problem: c.problem, solution: c.solution, wins: c.wins, badge: c.badge, adrConflicts: c.adrConflicts, deletionTest: c.deletionTest, verifier: c.verdict.reasoning })), null, 1)}\n${BRIEF}`,
  {
    label: 'judge', phase: 'Judge', effort: 'max',
    schema: {
      type: 'object', required: ['ranked', 'topRecommendation'],
      properties: {
        ranked: { type: 'array', items: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'integer' }, why: { type: 'string', description: 'one-line ranking rationale' } } }, description: 'surviving candidate ids, best first' },
        topRecommendation: { type: 'object', required: ['id', 'why'], properties: { id: { type: 'integer' }, why: { type: 'string' } } },
        dropped: { type: 'array', items: { type: 'object', required: ['id', 'reason'], properties: { id: { type: 'integer' }, reason: { type: 'string' } } }, description: 'Speculative candidates subsumed by a Strong one' },
      },
    },
  }
)
const ranked = (judged && judged.ranked ? judged.ranked : confirmed.map((_, i) => ({ id: i, why: '' })))
  .filter(r => confirmed[r.id]).map(r => ({ ...confirmed[r.id], rankWhy: r.why }))
const topRec = judged && judged.topRecommendation && confirmed[judged.topRecommendation.id]
  ? { title: confirmed[judged.topRecommendation.id].title, why: judged.topRecommendation.why } : null
log(`Judge: ${ranked.length} ranked (${(judged && judged.dropped) ? judged.dropped.length : 0} dropped as subsumed); top: ${topRec ? topRec.title : 'none'}`)

const slim = c => ({
  title: c.title, modules: c.modules, files: c.files, problem: c.problem, solution: c.solution,
  wins: c.wins, badge: c.badge, evidence: c.evidence, adrConflicts: c.adrConflicts,
  deletionTest: c.deletionTest, verifier_reasoning: c.verdict ? c.verdict.reasoning : '', rankWhy: c.rankWhy || '',
})
const rankedSlim = ranked.map(slim)

// ---------- Phase 5: report (mechanical rendering — sonnet) ----------
phase('Report')
const rep = await agent(
  `${CTX}\nYou are the report renderer. Read ${CANON}/HTML-REPORT.md FIRST and follow it exactly — scaffold, candidate cards, diagram patterns, tone. Per its Framing section this is the build-improve CODE-SIDE report: title "Architecture review" (you are visualising a codebase; Files means source files). Render one card per candidate below, in ranked order, plus the Top recommendation section${topRec ? ` (top: ${JSON.stringify(topRec.title)})` : ''}. Include each candidate's deletion-test outcome and any ADR callout.${specDriftFindings.length ? ' Add a compact "Spec drift" section after the candidates listing these findings (they route to spec-4-edit, not to refactoring): ' + JSON.stringify(specDriftFindings) + '.' : ''} Write the file to the OS temp dir — resolve $TMPDIR, falling back to /tmp — as architecture-review-<stamp>.html where <stamp> you generate yourself by running \`date +%s\` in Bash (this pipeline cannot generate timestamps). Do NOT open the file (the calling skill decides). Return the absolute path.\n\nRANKED CANDIDATES:\n${JSON.stringify(rankedSlim, null, 1)}\n${BRIEF}`,
  {
    label: 'report', phase: 'Report', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', required: ['reportPath'], properties: { reportPath: { type: 'string' } } },
  }
)

// Report-only by design: applying any of these refactors is test-gated implementation
// work — route the chosen candidate through the skill's grilling loop and build-tdd.
return {
  reportPath: rep ? rep.reportPath : null,
  candidates: rankedSlim,
  refuted: refutedSlim,
  topRecommendation: topRec,
  specDriftFindings,
  stats: { raw: raw.length, deduped: merged.length, confirmed: confirmed.length, refutedCount: refuted.length, ranked: ranked.length, specDrift: specDriftFindings.length },
}
