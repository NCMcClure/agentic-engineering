export const meta = {
  name: 'spec-2-deep-review',
  description: 'Adversarially-verified multi-agent deep review of the spec: per-section reviewers + cross-cutting lenses, semantic dedup, refutation-based verification, a completeness critic with follow-up probes, and (opt-in) applied fixes with a reference reconciler, loop-until-dry re-review rounds, and a post-fix audit',
  whenToUse: "The headless complement to spec-2-grill's interactive grill — when the user asks for a deep/comprehensive/multi-agent review of the spec, or spec-2's autonomous mode. Args: {root, context?, extraLenses?, applyFixes?, rounds?, maxFindings?}. applyFixes=false (default) reports; true edits the spec pages. rounds (1-3, applyFixes only) re-reviews the changed files after fixing until a round confirms no critical/major finding. maxFindings (default 60) caps the verified set per round by severity.",
  phases: [
    { title: 'Discover', detail: 'list the spec section directories', model: 'haiku' },
    { title: 'Review', detail: 'one reviewer per section + cross-cutting lenses', model: 'opus' },
    { title: 'Dedup', detail: 'semantic merge of overlapping findings', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial refutation of every finding', model: 'opus' },
    { title: 'Critique', detail: 'completeness critic + follow-up probes (first round only)' },
    { title: 'Fix', detail: 'per-section fixers + serial reference reconciler (applyFixes only)' },
    { title: 'Audit', detail: 'verifier + whole-diff coherence pass (applyFixes only)' },
  ],
}

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root) throw new Error('args must be an object: {root: <absolute repo root>, context?, extraLenses?, applyFixes?, rounds?, maxFindings?}')
const ROOT = A.root.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`
const APPLY = A.applyFixes === true
const ROUNDS = APPLY ? Math.min(Math.max(parseInt(A.rounds, 10) || 1, 1), 3) : 1
const MAX_FINDINGS = Math.max(parseInt(A.maxFindings, 10) || 60, 1)

const CONTEXT = `
CONTEXT — read carefully before starting.
You are reviewing a SPECIFICATION (not code) at ${SPEC}/. Orient at ${SPEC}/index.md; the
canonical vocabulary is ${SPEC}/reference/glossary.md and the decision records are under
${SPEC}/reference/adr/.
${A.context ? `PROJECT NOTES: ${A.context}` : ''}
Rules for findings:
- Every finding MUST cite specific evidence: spec file path(s) + a short verbatim quote,
  and where relevant the contradicting source (another spec file, or an external source
  named in the project notes) also with path + quote.
- file = the primary spec file the finding anchors to, as a path relative to ${SPEC}/.
- Report real problems, not style nits. Do not pad; an empty list is acceptable.
- severity: critical = would sink or badly misdirect implementation; major = would cause
  significant rework or a wrong design commitment; minor = worth fixing, low blast radius.
Your final message is machine-consumed via the structured output tool — no prose preamble.
`

const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array', maxItems: 20,
      items: {
        type: 'object',
        required: ['title', 'file', 'severity', 'category', 'description', 'evidence', 'recommendation'],
        properties: {
          title: { type: 'string', description: 'one-line statement of the defect' },
          file: { type: 'string', description: 'primary spec file, relative to spec root' },
          severity: { enum: ['critical', 'major', 'minor'] },
          category: { enum: ['contradiction', 'fidelity-gap', 'feasibility', 'underspecified', 'missing', 'testability', 'risk'] },
          description: { type: 'string' },
          evidence: { type: 'string', description: 'file paths + verbatim quotes supporting the claim' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'reasoning', 'confidence', 'adjusted_severity'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    adjusted_severity: { enum: ['critical', 'major', 'minor'] },
  },
}

// ---------- Phase 0: discover sections ----------
phase('Discover')
const disco = await agent(
  `List the top-level SECTION directories of the spec at ${SPEC}/ (the numbered/topic content directories). Exclude reference/, assets/, scripts/, .site/, and loose files. Return names relative to ${SPEC}/ (e.g. "02-runtime"). Also report the total content .md file count under them. Use ls/glob, not judgment. Machine-consumed output; no prose.`,
  {
    label: 'discover:sections', phase: 'Discover', model: 'haiku', effort: 'low',
    schema: { type: 'object', required: ['sections', 'fileCount'], properties: { sections: { type: 'array', items: { type: 'string' } }, fileCount: { type: 'integer' } } },
  }
)
if (!disco || !disco.sections || !disco.sections.length) throw new Error('no spec section directories found under ' + SPEC)
const SECTIONS = disco.sections

const CROSS = [
  {
    key: 'coherence',
    prompt: `You are a consistency auditor for the spec at ${SPEC}/. First run: python3 ${SPEC}/scripts/verify-spec-tree.py (report any failures as findings). Then hunt CROSS-FILE contradictions: (a) glossary (reference/glossary.md) terms vs how spec files actually use them; (b) ADRs (reference/adr/) vs the section text that should reflect them — find ADRs the prose has drifted from, and section text making decisions no ADR records; (c) the same concept specified differently in two sections; (d) index.md descriptions that no longer match their children.`,
  },
  {
    key: 'gap-hunter',
    prompt: `You are a completeness reviewer for the spec at ${SPEC}/. Read the whole spec, then ask: what would an implementing team hit in the first three months that the spec is silent or hand-wavy on? Candidate areas (verify, don't assume): data migration, concurrent-edit/conflict behaviour, performance and scale envelopes, failure modes of the main pipelines, observability/debugging, rate limits and cost controls, security of any privileged write path. Only report a gap if you verified the spec genuinely doesn't cover it (Grep ${SPEC} thoroughly first).`,
  },
  {
    key: 'plan-readiness',
    prompt: `You are a planning-readiness reviewer. The spec at ${SPEC}/ will be decomposed by plan-0-decompose into an epic->sprint->issue tree of tracer-bullet vertical slices with testable acceptance criteria. Audit: (a) which spec areas are too vague to slice into issues with testable acceptance criteria; (b) whether the spec's own testing conventions (check reference/adr/ and any testing page) actually cover its assertable surface; (c) undeclared dependencies between sections that would force a serial build order the spec doesn't acknowledge; (d) whether anything marked future/fast-follow leaks into core sections as if it were v1.`,
  },
  ...(Array.isArray(A.extraLenses) ? A.extraLenses.filter(l => l && l.key && l.prompt) : []),
]

// ---------- reusable stages (round 1 runs them over the whole spec; later rounds over the changed slice) ----------

const runReview = async (sections, lenses, roundTag) => {
  const sectionThunks = sections.map(s => () =>
    agent(
      `${CONTEXT}\nYou are the dedicated reviewer for spec section ${s}. Read EVERY file under ${SPEC}/${s}/ closely, plus ${SPEC}/reference/glossary.md and every ADR under ${SPEC}/reference/adr/ that the section relates to. Find internal contradictions, underspecified load-bearing behavior, unresolved forks presented as resolved, and claims that conflict with the glossary or ADRs. Where the section makes claims about external systems named in the project notes, spot-check them against those sources.`,
      { label: `review:${s}${roundTag}`, phase: 'Review', schema: FINDINGS, model: 'opus', effort: 'high' }
    )
  )
  const crossThunks = lenses.map(c => () =>
    agent(`${CONTEXT}\n${c.prompt}`, { label: `lens:${c.key}${roundTag}`, phase: 'Review', schema: FINDINGS, model: 'opus', effort: 'high' })
  )
  // barrier justified: dedup needs the full finding set
  const results = await parallel([...sectionThunks, ...crossThunks])
  const sources = [...sections.map(s => `review:${s}`), ...lenses.map(c => `lens:${c.key}`)]
  const raw = []
  results.forEach((r, i) => {
    if (r && r.findings) r.findings.forEach(f => raw.push({ ...f, source: sources[i] }))
  })
  log(`Collected ${raw.length} raw findings from ${results.filter(Boolean).length}/${sources.length} reviewers${roundTag}`)
  return raw
}

const DEDUP_SCHEMA = {
  type: 'object',
  required: ['merged'],
  properties: {
    merged: {
      type: 'array',
      items: {
        type: 'object',
        required: ['ids', 'title', 'file', 'severity', 'category', 'description', 'evidence', 'recommendation'],
        properties: {
          ids: { type: 'array', items: { type: 'integer' }, description: 'ids of the raw findings merged into this one' },
          title: { type: 'string' },
          file: { type: 'string' },
          severity: { enum: ['critical', 'major', 'minor'] },
          category: { enum: ['contradiction', 'fidelity-gap', 'feasibility', 'underspecified', 'missing', 'testability', 'risk'] },
          description: { type: 'string' },
          evidence: { type: 'string' },
          recommendation: { type: 'string' },
        },
      },
    },
  },
}

const SEV_ORDER = { critical: 0, major: 1, minor: 2 }

const runDedup = async (raw, roundTag) => {
  const numbered = raw.map((f, i) => ({ id: i, ...f }))
  const deduped = await agent(
    `You are a findings editor. Below is a JSON array of spec-review findings from independent reviewers of the same specification. Merge findings that describe the SAME underlying defect (even if worded differently or anchored to neighboring files) into single findings — union their evidence, keep the clearest title, keep the HIGHEST severity among members, and list all member ids. Findings about genuinely different defects stay separate, even if in the same file. Do not drop any finding: every input id must appear in exactly one merged entry. Do not soften descriptions.\n\nFINDINGS:\n${JSON.stringify(numbered, null, 1)}`,
    { label: `dedup${roundTag}`, phase: 'Dedup', schema: DEDUP_SCHEMA, model: 'sonnet', effort: 'medium' }
  )
  let merged = (deduped && deduped.merged) ? deduped.merged : numbered.map(f => ({ ...f, ids: [f.id] }))
  let truncated = 0
  if (merged.length > MAX_FINDINGS) {
    merged = merged.slice().sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
    truncated = merged.length - MAX_FINDINGS
    merged = merged.slice(0, MAX_FINDINGS)
    log(`maxFindings=${MAX_FINDINGS}: dropped ${truncated} lowest-severity merged findings${roundTag}`)
  }
  log(`Deduped ${raw.length} raw findings into ${merged.length}${roundTag}`)
  return { merged, truncated }
}

const verifyOne = (f, roundTag) =>
  agent(
    `${CONTEXT}\nYou are an adversarial verifier. A reviewer claims the following defect in the spec. Your job is to REFUTE it if you can: re-read the cited spec files (and any external sources referenced) and check (1) the quotes are real and in context, (2) the spec doesn't already address this elsewhere (Grep ${SPEC} for the key terms before concluding a gap is real), (3) the reasoning holds. If the finding misreads the spec, is already covered, or the evidence doesn't support the claim, set refuted=true and explain. If it survives, set refuted=false, and set adjusted_severity to what the evidence actually supports (you may raise or lower it). Default to refuted=true when the evidence is too thin to confirm.\n\nFINDING:\n${JSON.stringify({ title: f.title, file: f.file, severity: f.severity, category: f.category, description: f.description, evidence: f.evidence }, null, 1)}`,
    { label: `verify:${f.title.slice(0, 40)}${roundTag}`, phase: 'Verify', schema: VERDICT, model: 'opus', effort: 'high' }
  )

const runVerify = async (merged, roundTag) => {
  const verified = await parallel(merged.map(f => () => verifyOne(f, roundTag).then(v => ({ ...f, verdict: v }))))
  const confirmed = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === false)
    .map(x => ({ ...x, severity: x.verdict.adjusted_severity || x.severity }))
  const refuted = verified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === true)
  log(`Verification${roundTag}: ${confirmed.length} confirmed, ${refuted.length} refuted`)
  return { confirmed, refuted }
}

const slim = f => ({
  title: f.title, file: f.file, severity: f.severity, category: f.category,
  description: f.description, evidence: f.evidence, recommendation: f.recommendation,
  verifier_reasoning: f.verdict ? f.verdict.reasoning : '',
})

const FIX_GUIDE = `
You have full write access and are TRUSTED to make sound spec changes — apply fixes by
editing the spec files directly (Read a file before you Edit it). Judgment rules:
- Prefer actually resolving the defect over hedging: rewrite contradictory text, specify
  underspecified behavior precisely, and author missing content where the right answer is
  derivable from context (the glossary, existing ADRs, the spec's own stated tensions, and
  any external sources named in the project notes).
- Only when a finding requires a genuine product decision that is NOT derivable from
  existing decisions: do not invent it. Add a clearly-marked "**Open question:**" block to
  the most relevant spec file stating the decision needed and the options, and count that
  as applied. (The interactive grill — spec-2-grill — resolves these with the user.)
- If on re-reading you judge a finding unsound, already addressed, or too risky to change
  unilaterally, skip it and say why.
- Match each file's existing conventions exactly: frontmatter shape, heading style,
  pseudocode/diagram style, relative link style, tone, line width. Bump each edited file's
  'updated' frontmatter. Update the section's index.md only if you add or remove a file.
- Never renumber an existing ADR or reverse its decision; clarifying ADR text is fine.
- Do NOT run any git commands that mutate state (no add/commit/checkout). Leave all
  changes in the working tree.
- Self-check when done: run python3 ${SPEC}/scripts/verify-spec-tree.py and fix any
  reported error that mentions a file you touched (other sections are being edited
  concurrently by peer agents — ignore errors in files you did not touch).
Your final structured output must account for every finding you were given, as applied,
deferred, or skipped.
`
const FIX_SCHEMA = {
  type: 'object',
  required: ['applied', 'deferred', 'skipped'],
  properties: {
    applied: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'files', 'summary'],
        properties: {
          title: { type: 'string', description: 'finding title' },
          files: { type: 'array', items: { type: 'string' }, description: 'spec files edited' },
          summary: { type: 'string', description: 'what was changed' },
        },
      },
    },
    deferred: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'change'],
        properties: {
          title: { type: 'string', description: 'finding title' },
          change: { type: 'string', description: 'the exact glossary/ADR change needed in reference/' },
        },
      },
    },
    skipped: {
      type: 'array',
      items: {
        type: 'object', required: ['title', 'reason'],
        properties: { title: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
}

const runFix = async (all, roundTag) => {
  const buckets = {}
  for (const f of all) {
    const top = f.file.split('/')[0]
    const key = top === 'reference' ? 'reference' : top
    if (!buckets[key]) buckets[key] = []
    buckets[key].push(f)
  }
  const sectionKeys = Object.keys(buckets).filter(k => k !== 'reference').sort()
  log(`Applying fixes${roundTag}: ${all.length} findings across ${sectionKeys.length} sections${buckets.reference ? ' + reference/' : ''}`)

  // parallel across sections is safe: each fixer edits only its own directory and defers
  // reference/ changes to a single serial reconciler afterwards
  const fixResults = await parallel(sectionKeys.map(key => () =>
    agent(
      `${CONTEXT}\n${FIX_GUIDE}\nYou own the spec section directory ${SPEC}/${key}/ and may ONLY edit files under it. If a fix also requires changing ${SPEC}/reference/glossary.md or an ADR under ${SPEC}/reference/adr/ (including adding a new ADR), do NOT edit those files: record the exact needed change (file, term/ADR, precise wording) in your "deferred" output instead, and make the section-side edit consistent with that pending change.\n\nApply these verified review findings to the section:\n${JSON.stringify(buckets[key].map(slim), null, 1)}`,
      { label: `fix:${key}${roundTag}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'opus', effort: 'high' }
    )
  ))
  const sectionFixes = fixResults.filter(Boolean)
  const deferredChanges = sectionFixes.flatMap(r => r.deferred || [])
  const referenceFindings = (buckets.reference || []).map(slim)

  let referenceFix = null
  if (referenceFindings.length || deferredChanges.length) {
    // serial reconciliation of the shared reference/ dir — singleton judgment, inherits the session model
    referenceFix = await agent(
      `${CONTEXT}\n${FIX_GUIDE}\nYou are the reference reconciler for ${SPEC}/reference/ (glossary.md and adr/). You run AFTER the per-section fixers, so read the CURRENT working-tree state of any file before editing. Your inputs:\n\n(1) Verified findings anchored in reference/ — apply them:\n${JSON.stringify(referenceFindings, null, 1)}\n\n(2) Deferred reference changes requested by the section fixers — apply them, harmonizing duplicates and resolving conflicts between requests with your own judgment:\n${JSON.stringify(deferredChanges, null, 1)}\n\nYou may add new ADRs (next free number, matching the existing ADR file format, and add them to adr/index.md) and edit glossary entries. If applying a reference change makes a one-line pointer in a section file necessary (e.g. citing a new ADR number), you may make that minimal section edit too. Report deferred=[] (you are the last stop).`,
      { label: `fix:reference${roundTag}`, phase: 'Fix', schema: FIX_SCHEMA, effort: 'high' }
    )
  }
  return { sectionKeys, fixResults, sectionFixes, referenceFix }
}

// ---------- Round 1: full review ----------
phase('Review')
log(`Round 1: fanning out ${SECTIONS.length} section reviewers + ${CROSS.length} cross-cutting lenses over ~${disco.fileCount} spec files`)
const raw = await runReview(SECTIONS, CROSS, '')
if (raw.length === 0) return { confirmed: [], note: 'no findings reported' }

phase('Dedup')
const { merged, truncated } = await runDedup(raw, '')

phase('Verify')
const { confirmed, refuted } = await runVerify(merged, '')

// ---------- Critique (first round only) ----------
phase('Critique')
const CRITIC_SCHEMA = {
  type: 'object',
  required: ['assessment', 'probes'],
  properties: {
    assessment: { type: 'string', description: 'what the review covered well and where coverage is thin' },
    probes: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['angle', 'prompt'],
        properties: {
          angle: { type: 'string' },
          prompt: { type: 'string', description: 'a fully self-contained reviewer prompt for the uncovered angle' },
        },
      },
    },
  },
}
// completeness critique is singleton synthesis — inherits the session model
const critic = await agent(
  `${CONTEXT}\nA multi-reviewer audit of the spec just completed. Reviewer lenses used: per-section reviews of ${SECTIONS.join(', ')}, plus ${CROSS.map(c => c.key).join(', ')}. Confirmed finding titles:\n${confirmed.map(f => `- [${f.severity}] ${f.title} (${f.file})`).join('\n') || '(none)'}\n\nQuestion: what review angle is MISSING — a class of defect none of these lenses would have caught? Consider what a skeptical staff engineer would probe that isn't covered (adversarial/abuse cases, operational cost, migration, whatever the spec's domain implies). Only propose probes where the existing lenses genuinely could not have surfaced the issue, and verify with a quick Grep of ${SPEC} that the spec doesn't obviously handle it. Propose at most 3 probe prompts (each fully self-contained, instructing a reviewer to produce evidence-cited findings).`,
  { label: 'completeness-critic', phase: 'Critique', schema: CRITIC_SCHEMA, effort: 'high' }
)

let probeConfirmed = []
if (critic && critic.probes && critic.probes.length) {
  log(`Critic proposed ${critic.probes.length} follow-up probes: ${critic.probes.map(p => p.angle).join('; ')}`)
  const probeResults = await parallel(critic.probes.map(p => () =>
    agent(`${CONTEXT}\n${p.prompt}`, { label: `probe:${p.angle.slice(0, 40)}`, phase: 'Critique', schema: FINDINGS, model: 'opus', effort: 'high' })
  ))
  const probeRaw = []
  probeResults.forEach((r, i) => {
    if (r && r.findings) r.findings.forEach(f => probeRaw.push({ ...f, source: `probe:${critic.probes[i].angle}` }))
  })
  if (probeRaw.length) {
    const probeVerified = await parallel(probeRaw.map(f => () => verifyOne(f, '').then(v => ({ ...f, verdict: v }))))
    probeConfirmed = probeVerified.filter(Boolean).filter(x => x.verdict && x.verdict.refuted === false)
      .map(x => ({ ...x, severity: x.verdict.adjusted_severity || x.severity }))
    log(`Probes: ${probeRaw.length} findings, ${probeConfirmed.length} survived verification`)
  }
}

let all = [...confirmed, ...probeConfirmed].sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))

const report = {
  stats: { raw: raw.length, deduped: merged.length, truncated, confirmed: confirmed.length, probeConfirmed: probeConfirmed.length, refutedCount: refuted.length },
  criticAssessment: critic ? critic.assessment : null,
  confirmed: all.map(slim),
  refuted: refuted.map(x => ({ title: x.title, file: x.file, reason: x.verdict.reasoning })),
}

if (!APPLY || all.length === 0) return { ...report, fixes: null, rounds: 1, note: APPLY ? 'nothing to fix' : 'report-only run (applyFixes=false)' }

// ---------- Fix + loop-until-dry re-review rounds (applyFixes only) ----------
const perRound = []
let fixes = null
let converged = false

for (let round = 1; round <= ROUNDS; round++) {
  const roundTag = round === 1 ? '' : `:r${round}`

  if (round > 1) {
    // Re-review only what changed since the run started: the fixers leave everything
    // uncommitted, so the working-tree diff is exactly this run's blast radius.
    phase('Review')
    const changed = await agent(
      `Run: git -C ${ROOT} diff --name-only -- .plan/spec and also git -C ${ROOT} status --porcelain -- .plan/spec (to catch new untracked files). Return every changed/added spec file path relative to ${SPEC}/ (strip the .plan/spec/ prefix). Pure retrieval; no judgment. Machine-consumed output; no prose.`,
      {
        label: `changed-files:r${round}`, phase: 'Review', model: 'haiku', effort: 'low',
        schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
      }
    )
    const changedFiles = (changed && changed.files) || []
    if (!changedFiles.length) { converged = true; break }
    const changedSections = SECTIONS.filter(s => changedFiles.some(f => f === s || f.startsWith(s + '/')))
    log(`Round ${round}: re-reviewing ${changedSections.length} changed sections (${changedFiles.length} changed files) + coherence lens`)

    const roundRaw = await runReview(changedSections, [CROSS[0]], roundTag) // CROSS[0] = coherence — the lens that catches fix-introduced contradictions
    if (!roundRaw.length) { converged = true; break }
    phase('Dedup')
    const roundDedup = await runDedup(roundRaw, roundTag)
    phase('Verify')
    const roundVerify = await runVerify(roundDedup.merged, roundTag)
    perRound.push({ round, raw: roundRaw.length, confirmed: roundVerify.confirmed.length, criticalMajor: roundVerify.confirmed.filter(f => f.severity !== 'minor').length })
    const seriousNew = roundVerify.confirmed.filter(f => f.severity !== 'minor')
    if (!seriousNew.length) { converged = true; break } // dry: nothing critical/major survived this round
    all = roundVerify.confirmed.sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
  }

  phase('Fix')
  const fixRound = await runFix(all, roundTag)
  if (round === 1) {
    fixes = {
      bySection: fixRound.sectionKeys.map((k, i) => ({ section: k, result: fixRound.fixResults[i] })),
      reference: fixRound.referenceFix,
    }
    report.stats.fixed = fixRound.sectionFixes.flatMap(r => r.applied || []).length + ((fixRound.referenceFix && fixRound.referenceFix.applied) ? fixRound.referenceFix.applied.length : 0)
    report.stats.skippedFixes = fixRound.sectionFixes.flatMap(r => r.skipped || []).length + ((fixRound.referenceFix && fixRound.referenceFix.skipped) ? fixRound.referenceFix.skipped.length : 0)
  } else {
    report.stats.fixed += fixRound.sectionFixes.flatMap(r => r.applied || []).length + ((fixRound.referenceFix && fixRound.referenceFix.applied) ? fixRound.referenceFix.applied.length : 0)
  }
}
if (ROUNDS > 1) log(`Rounds: ${perRound.length ? perRound.map(r => `r${r.round}=${r.criticalMajor} crit/major`).join(', ') : 'single fix round'}; converged=${converged}`)

// ---------- Audit (once, over the cumulative diff of all rounds) ----------
phase('Audit')
const audit = await agent(
  `${CONTEXT}\nYou are the post-fix auditor. Several agents just edited the spec in parallel (possibly over multiple fix rounds) to resolve verified review findings. Your job:\n1. Run python3 ${SPEC}/scripts/verify-spec-tree.py — if it fails, fix every reported problem (broken links, frontmatter, structure) and re-run until it exits 0.\n2. Review the whole change set: run git -C ${ROOT} diff --stat -- .plan/spec, then read the full diff (git -C ${ROOT} diff -- .plan/spec).\n3. Check the edits are mutually coherent: no two fixers introduced contradictory statements, new glossary terms/ADR numbers referenced from section files actually exist, cross-references resolve, index.md files still describe their children accurately, and no fix accidentally deleted content unrelated to its finding. Make surgical corrective edits where needed (Read before Edit; match file conventions).\n4. Do NOT run any git command that mutates state — leave everything uncommitted.\nReport what you corrected and your overall coherence assessment.`,
  {
    label: 'post-fix-audit', phase: 'Audit', effort: 'high',
    schema: {
      type: 'object', required: ['verifier_passed', 'corrections', 'summary'],
      properties: {
        verifier_passed: { type: 'boolean', description: 'verify-spec-tree.py exits 0 after any corrections' },
        corrections: { type: 'array', items: { type: 'string' }, description: 'corrective edits made during the audit' },
        summary: { type: 'string', description: 'coherence assessment of the full applied diff' },
      },
    },
  }
)

return {
  ...report,
  fixes,
  rounds: 1 + perRound.length,
  perRound,
  converged: ROUNDS === 1 ? undefined : converged,
  audit,
}
