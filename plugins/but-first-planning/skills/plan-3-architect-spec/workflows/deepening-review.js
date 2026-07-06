export const meta = {
  name: 'plan-3-deepening-review',
  description: 'Parallel deepening hunt over the designed system in the spec: per-section hunters + cross-cutting lenses (test-surface, cross-section-coupling, adr-tension), semantic dedup, adversarial deletion-test verification, a judge ranking with a top recommendation, an HTML report, and (opt-in) applied Strong candidates with one ADR per deepening',
  whenToUse: "plan-3-architect-spec's autonomous mode, or a broad spec (roughly 10+ sections) where a single Explore pass would go shallow; the interactive report+grilling loop stays the default. Args: {root, skillDir, context?, extraLenses?, apply?}. apply 'none' (default) reports only; 'strong' also applies the confirmed Strong candidates as spec edits with ADRs.",
  phases: [
    { title: 'Discover', detail: 'list the spec section directories', model: 'haiku' },
    { title: 'Hunt', detail: 'one deepening hunter per section + cross-cutting lenses', model: 'opus' },
    { title: 'Dedup', detail: 'semantic merge of overlapping candidates', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial re-run of the deletion test on every candidate', model: 'opus' },
    { title: 'Judge', detail: 'rank survivors, pick the top recommendation' },
    { title: 'Report', detail: 'self-contained HTML report in the OS temp dir', model: 'sonnet' },
    { title: 'Apply', detail: "apply:'strong' only — per-section fixers + serial reference reconciler writing one ADR per deepening" },
    { title: 'Audit', detail: 'apply only — verifier + whole-diff coherence pass' },
  ],
}

// Model tiers: haiku+low = pure retrieval/discovery, never judgment; sonnet = mechanical
// authoring / report rendering; opus+high = parallel-heavy judgment (hunters, lenses,
// adversarial verifiers); model omitted (inherit the session model) + high/max effort =
// singleton judgment (judge/rank, reference reconciler, post-fix audit).

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir) throw new Error("args must be an object: {root: <absolute repo root>, skillDir: <plan-3-architect-spec skill dir>, context?, extraLenses?, apply?: 'none'|'strong'}")
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`
const APPLY = A.apply === 'strong'

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your total structured output must stay well under 4000 tokens. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a deepening hunt over the DESIGNED SYSTEM described by the
specification at ${SPEC}/ — a design, not code; no code exists yet, and that is the
leverage: a seam moved here costs a sentence, not a refactor. Orient at ${SPEC}/index.md;
the canonical vocabulary is ${SPEC}/reference/glossary.md and the decision records are
under ${SPEC}/reference/adr/.
${A.context ? `PROJECT NOTES: ${A.context}` : ''}
`

const HUNT_GUIDE = `
Read ${SKILL}/LANGUAGE.md and ${SKILL}/DEEPENING.md FIRST — every string you emit uses that
vocabulary exactly (module, interface, seam, depth, deep, shallow, adapter, leverage,
locality; NEVER "component", "service", or "boundary"). Then read ${SPEC}/reference/glossary.md
and every ADR under ${SPEC}/reference/adr/ your area touches, so candidates use the
project's names and don't casually re-litigate settled decisions.
Hunt for: (a) shallow designed modules — interface nearly as complex as the behaviour it
hides; apply the DELETION TEST to every suspect and QUOTE its outcome in deletionTest
("deleting X: the complexity reappears in each of its 4 callers" / "vanishes — pass-through");
(b) leaky seams — two designed modules that each need the other's internals; (c) missing
seams for testability — a dependency that cannot be substituted through the interface as
drawn (the interface is the test surface). wins are phrased in locality/leverage terms.
files are spec file paths relative to ${SPEC}/. If a candidate contradicts an ADR, list it
in adrConflicts and only propose it when the friction genuinely justifies reopening.
Badge honesty: Strong only when the deletion test clearly signals and the win is concrete;
do not pad — an empty list is acceptable.
`

const CANDIDATE = {
  type: 'object',
  required: ['title', 'modules', 'files', 'problem', 'solution', 'wins', 'badge', 'evidence', 'adrConflicts', 'deletionTest'],
  properties: {
    title: { type: 'string', description: 'names the deepening, e.g. "Collapse the intake pipeline into one module"' },
    modules: { type: 'array', items: { type: 'string' }, description: 'designed modules involved, glossary names' },
    files: { type: 'array', items: { type: 'string' }, description: 'spec files involved, relative to spec root' },
    problem: { type: 'string', description: 'the friction, one sentence' },
    solution: { type: 'string', description: 'what the design becomes, one sentence' },
    wins: { type: 'string', description: 'gains in locality/leverage terms' },
    badge: { enum: ['Strong', 'Worth exploring', 'Speculative'] },
    evidence: { type: 'string', description: 'spec paths + verbatim quotes supporting the claim' },
    adrConflicts: { type: 'array', items: { type: 'string' }, description: 'ADRs this contradicts (empty if none)' },
    deletionTest: { type: 'string', description: 'what the deletion test showed, quoted outcome' },
  },
}
const CANDIDATES = {
  type: 'object', required: ['candidates'],
  properties: { candidates: { type: 'array', maxItems: 12, items: CANDIDATE } },
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

// ---------- Phase 0: discover sections ----------
phase('Discover')
const disco = await agent(
  `List the top-level SECTION directories of the spec at ${SPEC}/ (the numbered/topic content directories). Exclude reference/, assets/, scripts/, .site/, and loose files. Return names relative to ${SPEC}/ (e.g. "02-runtime"). Also report the total content .md file count under them. Use ls/glob, not judgment. ${BRIEF}`,
  {
    label: 'discover:sections', phase: 'Discover', model: 'haiku', effort: 'low',
    schema: { type: 'object', required: ['sections', 'fileCount'], properties: { sections: { type: 'array', items: { type: 'string' } }, fileCount: { type: 'integer' } } },
  }
)
if (!disco || !disco.sections || !disco.sections.length) throw new Error('no spec section directories found under ' + SPEC)
const SECTIONS = disco.sections

// ---------- Phase 1: hunt (per-section hunters + cross lenses) ----------
phase('Hunt')
const LENSES = [
  { key: 'test-surface', prompt: `You are the test-surface lens over the whole spec. The interface is the test surface: for each major designed module, ask whether its dependencies could be substituted through the interface as drawn. Report the modules with NO seam to substitute a dependency — where the future tests would have to reach past the interface. Classify each candidate's dependencies per ${SKILL}/DEEPENING.md (in-process / local-substitutable / owned-remote / true-external) and say where the seam belongs.` },
  { key: 'cross-section-coupling', prompt: `You are the locality lens over the whole spec. Find concepts whose understanding requires bouncing across multiple sections — a single responsibility smeared over several designed modules with no clear owner, or the same behaviour specified from two sides of a seam. Each candidate proposes where that behaviour should concentrate (one deep module, one place to decide).` },
  { key: 'adr-tension', prompt: `You are the ADR-tension lens. Read every ADR under ${SPEC}/reference/adr/, then hunt for deepening candidates the current decisions FORBID but whose friction may justify reopening. Only propose a candidate when the pain is concrete and evidenced in the spec text; every such candidate lists the ADR in adrConflicts and is clearly marked as reopening a decision. Do not list every theoretical refactor an ADR forbids.` },
  ...(Array.isArray(A.extraLenses) ? A.extraLenses.filter(l => l && l.key && l.prompt) : []),
]
log(`Fanning out ${SECTIONS.length} section hunters + ${LENSES.length} cross-cutting lenses over ~${disco.fileCount} spec files`)

const sectionThunks = SECTIONS.map(s => () =>
  agent(
    `${CTX}${HUNT_GUIDE}\nYou are the dedicated deepening hunter for spec section ${s}. Read EVERY file under ${SPEC}/${s}/ closely. Find deepening candidates within and at the edges of this section. ${BRIEF}`,
    { label: `hunt:${s}`, phase: 'Hunt', schema: CANDIDATES, model: 'opus', effort: 'high' }
  )
)
const lensThunks = LENSES.map(l => () =>
  agent(`${CTX}${HUNT_GUIDE}\n${l.prompt} ${BRIEF}`, { label: `lens:${l.key}`, phase: 'Hunt', schema: CANDIDATES, model: 'opus', effort: 'high' })
)
// barrier justified: dedup needs the complete candidate set before it can merge overlaps
const huntResults = await parallel([...sectionThunks, ...lensThunks])
const huntSources = [...SECTIONS.map(s => `hunt:${s}`), ...LENSES.map(l => `lens:${l.key}`)]
const raw = []
huntResults.forEach((r, i) => { if (r && r.candidates) r.candidates.forEach(c => raw.push({ ...c, source: huntSources[i] })) })
log(`Collected ${raw.length} raw candidates from ${huntResults.filter(Boolean).length}/${huntSources.length} hunters`)
if (!raw.length) return { reportPath: null, candidates: [], refuted: [], topRecommendation: null, applied: null, stats: { raw: 0 }, note: 'hunt found no deepening candidates — the design may already be deep' }

// ---------- Phase 2: dedup ----------
phase('Dedup')
const numbered = raw.map((c, i) => ({ id: i, ...c }))
const deduped = await agent(
  `You are a candidates editor. Below is a JSON array of deepening candidates from independent hunters over the same spec. Merge candidates that describe the SAME underlying deepening (even if worded differently or anchored to neighboring files) into single candidates — union modules/files/evidence/adrConflicts, keep the clearest title and deletionTest, keep the STRONGEST badge among members (Strong > Worth exploring > Speculative), and list all member ids. Genuinely different deepenings stay separate, even in the same section. Every input id must appear in exactly one merged entry. Do not soften claims.\n\nCANDIDATES:\n${JSON.stringify(numbered, null, 1)}\n${BRIEF}`,
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
    `${CTX}\nYou are an adversarial verifier. A hunter proposes the deepening candidate below. REFUTE it if you can: (1) re-run the deletion test yourself, skeptically — re-read the cited spec files and check whether deleting the module really makes complexity reappear across callers, or the claimed pass-through is actually earning its keep; (2) check no ADR under ${SPEC}/reference/adr/ already settles this (Grep before concluding); (3) check the "shallow" claim against the module's interface AS ACTUALLY SPECIFIED — everything a caller must know, not just the signature sketch. If the candidate misreads the spec, is settled by an ADR it doesn't justify reopening, or the evidence doesn't support the claim, set refuted=true and explain. If it survives, set refuted=false and set adjusted_badge to what the evidence actually supports (raise or lower). Default to refuted=true when the evidence is too thin to confirm. Vocabulary per ${SKILL}/LANGUAGE.md.\n\nCANDIDATE:\n${JSON.stringify({ title: c.title, modules: c.modules, files: c.files, problem: c.problem, solution: c.solution, badge: c.badge, evidence: c.evidence, adrConflicts: c.adrConflicts, deletionTest: c.deletionTest }, null, 1)}\n${BRIEF}`,
    { label: `verify:${c.title.slice(0, 40)}`, phase: 'Verify', schema: VERDICT, model: 'opus', effort: 'high' }
  ).then(v => ({ ...c, verdict: v }))
))
const confirmed = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === false)
  .map(x => ({ ...x, badge: x.verdict.adjusted_badge || x.badge }))
const refuted = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === true)
log(`Verification: ${confirmed.length} confirmed, ${refuted.length} refuted`)
const refutedSlim = refuted.map(x => ({ title: x.title, reason: x.verdict.reasoning }))
if (!confirmed.length) return { reportPath: null, candidates: [], refuted: refutedSlim, topRecommendation: null, applied: null, stats: { raw: raw.length, deduped: merged.length, confirmed: 0, refutedCount: refuted.length }, note: 'every candidate was refuted under adversarial verification' }

// ---------- Phase 4: judge (singleton judgment — inherits the session model) ----------
phase('Judge')
const judged = await agent(
  `${CTX}\nYou are the deepening judge. Below are the deepening candidates that survived adversarial verification, numbered. Rank them by expected payoff at the spec stage: leverage of the deepened interface, locality gained, how clearly the deletion test signalled, testability won (a seam where there was none), and cost/risk of the spec change (ADR conflicts weigh against). DROP any Speculative candidate that substantially overlaps a Strong one (the Strong one subsumes it). Pick ONE topRecommendation and say why in a sentence. Vocabulary per ${SKILL}/LANGUAGE.md.\n\nCANDIDATES:\n${JSON.stringify(confirmed.map((c, i) => ({ id: i, title: c.title, modules: c.modules, files: c.files, problem: c.problem, solution: c.solution, wins: c.wins, badge: c.badge, adrConflicts: c.adrConflicts, deletionTest: c.deletionTest, verifier: c.verdict.reasoning })), null, 1)}\n${BRIEF}`,
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
  `${CTX}\nYou are the report renderer. Read ${SKILL}/HTML-REPORT.md FIRST and follow it exactly — scaffold, candidate cards, diagram patterns, tone. Per its Framing section this is the plan-3 SPEC-SIDE report: title "Spec architecture review" (the before/after diagrams show how designed modules and seams change; Files means spec files). Render one card per candidate below, in ranked order, plus the Top recommendation section${topRec ? ` (top: ${JSON.stringify(topRec.title)})` : ''}. Include each candidate's deletion-test outcome and any ADR callout. Write the file to the OS temp dir — resolve $TMPDIR, falling back to /tmp — as spec-architecture-review-<stamp>.html where <stamp> you generate yourself by running \`date +%s\` in Bash (this pipeline cannot generate timestamps). Do NOT open the file (the calling skill decides). Return the absolute path.\n\nRANKED CANDIDATES:\n${JSON.stringify(rankedSlim, null, 1)}\n${BRIEF}`,
  {
    label: 'report', phase: 'Report', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', required: ['reportPath'], properties: { reportPath: { type: 'string' } } },
  }
)
const reportPath = rep ? rep.reportPath : null

const stats = { raw: raw.length, deduped: merged.length, confirmed: confirmed.length, refutedCount: refuted.length, ranked: ranked.length }
if (!APPLY) return { reportPath, candidates: rankedSlim, refuted: refutedSlim, topRecommendation: topRec, applied: null, stats, note: "report-only run (apply!=='strong')" }

// ---------- Phase 6: apply (apply:'strong' only — confirmed Strong candidates) ----------
phase('Apply')
const strong = ranked.filter(c => c.badge === 'Strong')
if (!strong.length) return { reportPath, candidates: rankedSlim, refuted: refutedSlim, topRecommendation: topRec, applied: null, stats, note: 'apply=strong but no candidate holds a Strong badge after verification' }

const FIX_GUIDE = `
You have full write access and are TRUSTED to make sound spec changes — apply each
deepening by editing the spec files directly (Read a file before you Edit it). Rewrite the
design so the deepened module's interface, seam placement, and test surface are explicit
per ${SKILL}/DEEPENING.md (state the interface the future tests sit on, which dependencies
are substituted and by what adapter, and the observable outcomes). Match each file's
existing conventions exactly — frontmatter shape, heading style, diagram style, link
style, line width — and bump each edited file's 'updated' frontmatter. Update the
section's index.md only if you add or remove a file. Do NOT run any git command that
mutates state. Self-check: run python3 ${SPEC}/scripts/verify-spec-tree.py and fix any
reported error mentioning a file you touched (peer agents edit other sections
concurrently — ignore their files). Account for every candidate as applied, deferred, or
skipped (skip with a reason if on re-reading you judge it unsound or too risky to change
unilaterally).
`
const FIX_SCHEMA = {
  type: 'object', required: ['applied', 'deferred', 'skipped'],
  properties: {
    applied: { type: 'array', items: { type: 'object', required: ['title', 'files', 'summary'], properties: { title: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } } } },
    deferred: { type: 'array', items: { type: 'object', required: ['title', 'change'], properties: { title: { type: 'string' }, change: { type: 'string', description: 'exact glossary/ADR change needed in reference/' } } } },
    skipped: { type: 'array', items: { type: 'object', required: ['title', 'reason'], properties: { title: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

const buckets = {}
for (const c of strong) {
  const key = (c.files[0] || '').split('/')[0] || 'misc'
  if (!buckets[key]) buckets[key] = []
  buckets[key].push(c)
}
const sectionKeys = Object.keys(buckets).filter(k => k !== 'reference').sort()
log(`Applying ${strong.length} Strong deepenings across ${sectionKeys.length} sections`)

// parallel across sections is safe: each fixer edits only its own directory and defers all
// reference/ (glossary + ADR) changes to the single serial reconciler that runs afterwards
const fixResults = await parallel(sectionKeys.map(key => () =>
  agent(
    `${CTX}${FIX_GUIDE}\nYou own the spec section directory ${SPEC}/${key}/ and may ONLY edit files under it. If a deepening also requires changing ${SPEC}/reference/glossary.md (new/sharpened term for the deepened module) do NOT edit it: record the exact needed change in "deferred" and make the section text consistent with that pending change. Do NOT write ADRs — the reconciler records one per applied deepening.\n\nApply these verified Strong deepening candidates to the section:\n${JSON.stringify(buckets[key].map(slim), null, 1)}\n${BRIEF}`,
    { label: `apply:${key}`, phase: 'Apply', schema: FIX_SCHEMA, model: 'opus', effort: 'high' }
  )
))
const sectionFixes = fixResults.filter(Boolean)
const appliedDeepenings = sectionFixes.flatMap(r => r.applied || [])
const deferredChanges = sectionFixes.flatMap(r => r.deferred || [])

// serial reconciliation of the shared reference/ dir — singleton judgment, inherits the session model
const referenceFix = await agent(
  `${CTX}${FIX_GUIDE}\nYou are the reference reconciler for ${SPEC}/reference/ (glossary.md and adr/). You run AFTER the per-section fixers, so read the CURRENT working-tree state of any file before editing. Your inputs:\n\n(1) Applied deepenings — you MUST write ONE new ADR per applied deepening (a deepening is a load-bearing design decision; format per ${SKILL}/../plan-2-grill-spec/ADR-FORMAT.md, next free number, added to adr/index.md), recording the decision, the shallow shape it replaced, and the deletion-test evidence:\n${JSON.stringify(appliedDeepenings, null, 1)}\n\n(2) Deferred glossary changes requested by the section fixers — apply them, harmonizing duplicates and resolving conflicts with your own judgment:\n${JSON.stringify(deferredChanges, null, 1)}\n\n${buckets.reference ? `(3) Strong candidates anchored in reference/ itself — apply them too:\n${JSON.stringify(buckets.reference.map(slim), null, 1)}\n\n` : ''}If a reference change makes a one-line pointer in a section file necessary (e.g. citing the new ADR number), you may make that minimal section edit. Report deferred=[] (you are the last stop). ${BRIEF}`,
  { label: 'apply:reference', phase: 'Apply', schema: FIX_SCHEMA, effort: 'high' }
)

// ---------- Phase 7: audit (singleton judgment — inherits the session model) ----------
phase('Audit')
const audit = await agent(
  `${CTX}\nYou are the post-apply auditor. Several agents just edited the spec in parallel to apply deepening candidates, and a reconciler added ADRs and glossary entries. Your job:\n1. Run python3 ${SPEC}/scripts/verify-spec-tree.py — if it fails, fix every reported problem (broken links, frontmatter, structure) and re-run until it exits 0.\n2. Review the whole change set: git -C ${ROOT} diff --stat -- .plan/spec, then read the full diff (git -C ${ROOT} diff -- .plan/spec) plus git -C ${ROOT} status --porcelain -- .plan/spec for new untracked files (the ADRs).\n3. Check coherence: every applied deepening has exactly one ADR and the section text cites it where natural; new glossary terms are used consistently by the edited sections; no two fixers introduced contradictory statements; index.md files still describe their children; no edit deleted content unrelated to its candidate. Make surgical corrective edits where needed (Read before Edit; match conventions).\n4. Do NOT run any git command that mutates state — leave everything uncommitted.\n${BRIEF}`,
  {
    label: 'post-apply-audit', phase: 'Audit', effort: 'high',
    schema: {
      type: 'object', required: ['verifier_passed', 'corrections', 'summary'],
      properties: {
        verifier_passed: { type: 'boolean', description: 'verify-spec-tree.py exits 0 after any corrections' },
        corrections: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string', description: 'coherence assessment of the full applied diff' },
      },
    },
  }
)

stats.applied = appliedDeepenings.length + ((referenceFix && referenceFix.applied) ? referenceFix.applied.length : 0)
stats.skippedApply = sectionFixes.flatMap(r => r.skipped || []).length
return {
  reportPath,
  candidates: rankedSlim,
  refuted: refutedSlim,
  topRecommendation: topRec,
  applied: {
    bySection: sectionKeys.map((k, i) => ({ section: k, result: fixResults[i] })),
    reference: referenceFix,
    audit,
  },
  stats,
}
