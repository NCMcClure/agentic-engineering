export const meta = {
  name: 'build-audit-run',
  description: 'Full-project audit after a plan tree completes: map spec promises, hunt implementation/UX/test/docs/benchmark gaps across the audit dimensions, adversarially verify, synthesize a new plan-tree epic, author it, and (opt-in) publish its issues to the tracker',
  whenToUse: "build-audit's autonomous mode — a plan tree (or epic) reached done and the owner wants a gap audit turned into a backlog. Args: {root, pluginRoot, epicNumber, projectBrief, knownDebt?, hardRules?, commissioned?, transcriptDirs?, uiCapture?, publish?, forceModel?, maxEpicIssues?} — pluginRoot is the but-first-planning plugin dir; projectBrief (2-6 sentences of project context) opens every prompt; knownDebt is standing debt to sharpen; hardRules is an array of extra project bounds; commissioned records owner-granted scope exceptions; transcriptDirs (array) gates the session-fixtures finder; uiCapture (a capture command template) gates live-UI driving in the UX finder; forceModel overrides every tier (single-model runs); publish defaults false (author the epic, stop before the tracker).",
  phases: [
    { title: 'Inventory', detail: 'corpus map: spec pages, code areas, tests, docs, drift, captures, epics', model: 'haiku' },
    { title: 'Map', detail: 'one promise-extractor per spec category -> promise ledger' },
    { title: 'Find', detail: 'dimension finders over ledger + code + captures (+transcripts when allowed)' },
    { title: 'Critic', detail: 'completeness critic; up to 4 follow-up finders on the holes' },
    { title: 'Dedup', detail: 'semantic merge of overlapping findings', model: 'sonnet' },
    { title: 'Verify', detail: 'adversarial re-derivation of every merged finding' },
    { title: 'Synthesize', detail: 'cluster survivors into one epic: sprints, issues, owner decisions' },
    { title: 'Author', detail: 'epic.md + index row, parallel sprint authors, verify-plan-tree loop', model: 'sonnet' },
    { title: 'Publish', detail: 'publish:true only — publish-issues.py per sprint + project board fields', model: 'sonnet' },
  ],
}

// Model-tier policy (WORKFLOWS.md): haiku+low = retrieval; sonnet = mechanical
// authoring/CLI driving; opus+high = parallel judgment fan-outs; inherit+max =
// singleton judgment (critic, synthesizer). args.forceModel overrides every
// tier for single-model runs.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.pluginRoot || !A.epicNumber || !A.projectBrief) {
  throw new Error('args must be an object: {root, pluginRoot: <but-first-planning dir>, epicNumber: "09", projectBrief: <2-6 sentences>, knownDebt?: string, hardRules?: string[], commissioned?: string, transcriptDirs?: string[], uiCapture?: string, publish?: boolean, forceModel?: string, maxEpicIssues?: number}')
}
const ROOT = A.root.replace(/\/$/, '')
const PLUGIN = A.pluginRoot.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`
const PLAN = `${ROOT}/.plan/plan`
const PROGRESS = `${ROOT}/.plan/progress`
const EPICNUM = String(A.epicNumber)
const PUBLISH = A.publish === true
const MAXISSUES = A.maxEpicIssues || 30
const TRANSCRIPTS = Array.isArray(A.transcriptDirs) ? A.transcriptDirs : []
const UICAPTURE = typeof A.uiCapture === 'string' && A.uiCapture.trim() ? A.uiCapture.trim() : null
const TIER = { retrieval: 'haiku', mechanical: 'sonnet', fanout: 'opus', singleton: undefined }
const M = t => A.forceModel || TIER[t]

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are part of a build-audit pipeline over the FINISHED build at ${ROOT}/.
${A.projectBrief}
The spec at ${SPEC}/ is the source of truth for all design; the plan tree at ${PLAN}/ is
complete. The audit's aim: find what the plan MISSED — unimplemented or unreachable spec
promises, onboarding/UX holes, sub-par test coverage, missing quantifiable benchmarks, and
missing end-user docs — so they become a new epic of tracker issues.
${A.knownDebt ? `KNOWN standing debt (sharpen it, do not just restate it): ${A.knownDebt}` : ''}
HARD RULES:
- If ${SPEC}/01-foundations/scope-and-non-goals.md exists, its scope table is BINDING. A
  finding that needs a capability that table excludes is ownerDecision:true — never a
  suggestedIssue.${A.commissioned ? ` Exception already granted by the owner for this audit: ${A.commissioned}` : ''}
${TRANSCRIPTS.length ? `- Transcript access is limited to exactly these locations: ${TRANSCRIPTS.join(', ')}. Nothing
  else outside ${ROOT}/ may be opened, and no personal content from a transcript may be
  quoted in any output.` : `- Nothing outside ${ROOT}/ and ${PLUGIN}/ may be opened.`}
${(A.hardRules || []).map(r => `- ${r}`).join('\n')}
- Never echo secrets or API tokens; any config example uses \${VAR} placeholders.
- Read-only toward git: no git mutations anywhere in this pipeline.
`

// ---------- Phase 0: inventory (pure retrieval) ----------
phase('Inventory')
const inv = await agent(
  `Map the audit corpus at ${ROOT}/ — pure retrieval, no judgment. Report:
(1) specCategories: the NN-* + reference category dirs under ${SPEC}/ with per-dir content-file counts (ls, count .md).
(2) codeAreas: the source dirs of the project (src/, lib/, apps/, or equivalent — read the top-level layout) with file and LOC counts (wc).
(3) testTree: for each dir under the project's test tree (tests/, test/, or equivalent) the file count; plus testTotal = the total registered test count IF one command enumerates it (ctest --test-dir <builddir> -N, pytest --collect-only -q, a test runner's list mode — whatever this project uses), else null.
(4) docs: every markdown file at repo top level and any docs/ dir, with line counts.
(5) driftFiles: ls ${PROGRESS}/drift/*.md (names only, count them; empty if the dir does not exist).
(6) notes: ls ${PROGRESS}/notes/ (names only; empty if absent).
(7) captures: ls ${SPEC}/prototypes/assets/ (names only, count; empty if absent).
${TRANSCRIPTS.length ? `(8) transcripts: for each of these allowed locations — ${TRANSCRIPTS.join(', ')} — the transcript-file count and total size (du -sh). Do not open any transcript.` : '(8) transcripts: report an empty array (no transcript access on this run).'}
(9) entrypoints: the shipped executables/commands — grep the build config (CMakeLists add_executable, package.json bin/scripts, pyproject [project.scripts], Makefile targets, or equivalent).
(10) epics: ls -d ${PLAN}/[0-9][0-9]-*/ (dir names only, sorted).
${BRIEF}`,
  {
    label: 'inventory:corpus', phase: 'Inventory', model: M('retrieval'), effort: 'low',
    schema: {
      type: 'object',
      required: ['specCategories', 'codeAreas', 'testTree', 'docs', 'driftFiles', 'notes', 'captures', 'transcripts', 'entrypoints', 'epics'],
      properties: {
        specCategories: { type: 'array', items: { type: 'object', required: ['dir', 'files'], properties: { dir: { type: 'string' }, files: { type: 'integer' } } } },
        codeAreas: { type: 'array', items: { type: 'object', required: ['path', 'files', 'loc'], properties: { path: { type: 'string' }, files: { type: 'integer' }, loc: { type: 'integer' } } } },
        testTree: { type: 'array', items: { type: 'object', required: ['dir', 'files'], properties: { dir: { type: 'string' }, files: { type: 'integer' } } } },
        testTotal: { type: ['integer', 'null'] },
        docs: { type: 'array', items: { type: 'object', required: ['path', 'lines'], properties: { path: { type: 'string' }, lines: { type: 'integer' } } } },
        driftFiles: { type: 'array', items: { type: 'string' } },
        notes: { type: 'array', items: { type: 'string' } },
        captures: { type: 'array', items: { type: 'string' } },
        transcripts: { type: 'array', items: { type: 'object', required: ['dir', 'files', 'size'], properties: { dir: { type: 'string' }, files: { type: 'integer' }, size: { type: 'string' } } } },
        entrypoints: { type: 'array', items: { type: 'string' } },
        epics: { type: 'array', items: { type: 'string' } },
      },
    },
  }
)
if (!inv) throw new Error('inventory agent failed — cannot audit blind')
const CATS = inv.specCategories.map(c => c.dir).filter(d => !/prototypes|assets|scripts/.test(d))
// the newest existing epic is the calibration exemplar and the Blocked-by link
const EXEMPLAR = (inv.epics || []).map(e => e.replace(/\/$/, '').split('/').pop()).filter(e => e && !e.startsWith(EPICNUM)).sort().pop() || null
log(`Corpus: ${CATS.length} spec categories, ${inv.codeAreas.length} code areas, ${inv.testTotal || '?'} tests, ${inv.driftFiles.length} drift files, ${inv.captures.length} signed-off captures, ${inv.transcripts.length} transcript dirs, exemplar epic ${EXEMPLAR || 'none'}`)

// ---------- Phase 1: map — promise ledger, one extractor per spec category ----------
phase('Map')
const PROMISE = {
  type: 'object', required: ['page', 'claim', 'kind'],
  properties: {
    page: { type: 'string', description: 'spec file, relative to .plan/spec/' },
    claim: { type: 'string', description: 'the promise, one terse sentence' },
    kind: { enum: ['user-facing-flow', 'assertable-behavior', 'config-key', 'integration', 'doc-promise', 'benchmark'] },
    testSurface: { type: 'string', description: 'the named test surface, or "NONE NAMED"' },
    note: { type: 'string', description: 'anything that smells unbuilt/unreachable, else empty' },
  },
}
// barrier justified: every finder needs the COMPLETE promise ledger to cross-reference
const mapResults = await parallel(CATS.map(cat => () =>
  agent(
    `${CTX}
You are the promise extractor for spec category ${SPEC}/${cat}/. Read every content page
(skip index.md hub tables). Extract the ledger of PROMISES the category makes: user-facing
flows (what a user can see/do), assertable behaviors (with their named test surface —
testing-conventions.md demands one; write "NONE NAMED" when a claim has none), config keys,
cross-module integrations, promises of documentation, and any numeric/benchmark claims.
Prioritize user-facing flows and integrations if you must trim; max 45 promises; set
"dropped" to how many you left out (0 if none). In "note", flag anything the page itself
marks as deferred, demo-seamed, or owner-call. ${BRIEF}`,
    {
      label: `map:${cat}`, phase: 'Map', model: M('fanout'), effort: 'medium',
      schema: {
        type: 'object', required: ['promises', 'dropped'],
        properties: { promises: { type: 'array', maxItems: 45, items: PROMISE }, dropped: { type: 'integer' } },
      },
    }
  )
))
const LEDGER = []
mapResults.forEach((r, i) => { if (r && r.promises) r.promises.forEach(p => LEDGER.push({ cat: CATS[i], ...p })) })
const mapDropped = mapResults.filter(Boolean).reduce((s, r) => s + (r.dropped || 0), 0)
log(`Promise ledger: ${LEDGER.length} promises from ${mapResults.filter(Boolean).length}/${CATS.length} categories (${mapDropped} dropped by extractors)`)
if (!LEDGER.length) throw new Error('empty promise ledger — spec unreadable?')

const FINDING = {
  type: 'object',
  required: ['dimension', 'title', 'severity', 'area', 'claim', 'evidence', 'userImpact', 'ownerDecision'],
  properties: {
    dimension: { type: 'string' },
    title: { type: 'string', description: 'names the gap, behaviorally' },
    severity: { enum: ['critical', 'major', 'minor'] },
    area: { type: 'string', description: 'code/spec area, e.g. src/core or 05-some-category' },
    claim: { type: 'string', description: 'what is missing/wrong, one or two sentences' },
    evidence: { type: 'string', description: 'concrete paths (+ line refs or quotes) that demonstrate the gap' },
    userImpact: { type: 'string', description: 'what the end user cannot do / would suffer' },
    ownerDecision: { type: 'boolean', description: 'true = needs a scope/product decision, do NOT auto-issue' },
    ownerQuestion: { type: 'string', description: 'when ownerDecision: the exact question the owner must answer' },
    suggestedIssue: {
      type: 'object', required: ['title', 'type', 'whatToBuild', 'specAnchors', 'acceptanceCriteria', 'testingCheckpoint', 'userFacing'],
      properties: {
        title: { type: 'string', description: 'behavioral, present-tense, like existing plan issues' },
        type: { enum: ['AFK', 'HITL', 'REVIEW'] },
        whatToBuild: { type: 'string' },
        specAnchors: { type: 'array', items: { type: 'string' }, description: 'spec paths relative to .plan/spec/' },
        acceptanceCriteria: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
        testingCheckpoint: { type: 'string', description: 'command + expected result' },
        userFacing: { type: 'string', description: 'the **User-facing** line value: "yes — <what>" or "no — internal"' },
      },
    },
  },
}
const FIND_OUT = {
  type: 'object', required: ['findings', 'dropped'],
  properties: { findings: { type: 'array', maxItems: 14, items: FINDING }, dropped: { type: 'integer', description: 'candidates left out by the cap' } },
}
const LEDGER_JSON = JSON.stringify(LEDGER, null, 0)
const AREAS_JSON = JSON.stringify({ codeAreas: inv.codeAreas.map(c => c.path), testTree: inv.testTree.map(t => t.dir), entrypoints: inv.entrypoints })

// ---------- Phase 2: find — dimension finders ----------
phase('Find')
const FINDERS = [
  { key: 'spec-vs-code', prompt: `You are the missing-implementation finder. Cross-reference the promise ledger below against the live code and tests (inventoried areas: ${AREAS_JSON}). Hunt promises with NO implementation or whose implementation is a stub: grep for log-only paths, empty bodies, "demo" seams serving where a real seam was promised, and assertable behaviors whose testSurface is "NONE NAMED" or names a test that does not exist (enumerate the project's registered tests via its runner's list mode; grep the test tree). Every finding quotes the promise's spec page and the code location that falls short.\nPROMISE LEDGER:\n${LEDGER_JSON}` },
  { key: 'reachability', prompt: `You are the feature-route finder. Question: can a real user actually REACH each user-facing promise end-to-end from the shipped entrypoints? Start from the entrypoints (${JSON.stringify(inv.entrypoints)}) and walk their wiring through the code areas (${JSON.stringify(inv.codeAreas.map(c => c.path))}): which spec'd flows are wired to real seams vs demo/fake data, which factories or constructors are never invoked from any entrypoint, which capabilities are never registered into a live run, which stores are never opened by any shipped binary.${A.knownDebt ? ' The known standing debt lives here — decompose it into concrete, separately-buildable gaps rather than one blob.' : ''} Use the ledger's user-facing-flow and integration rows:\n${LEDGER_JSON}` },
  { key: 'onboarding-ux', prompt: `You are the onboarding/UX finder. Judge the FIRST-RUN and daily-driver experience: what does a fresh user see with no config, how do they discover config keys, connect the integrations the spec promises, recover from bad config, learn the controls? Read the spec's UX/first-run/config pages, then the real code paths${inv.captures.length ? `, and READ (as images) a sample of the signed-off capture PNGs in ${SPEC}/prototypes/assets/ — judge what a newcomer would fail to figure out` : ''}.${UICAPTURE ? ` You MAY drive the real UI for fresh states: ${UICAPTURE} — then Read the captured image back.` : ''} Findings = missing affordances, dead-end error states, undiscoverable features, absent help — each anchored to spec+code evidence.` },
  { key: 'docs', prompt: `You are the end-user documentation finder. Read ${ROOT}/README.md and any other top-level docs (${JSON.stringify(inv.docs)}), then read ${PLUGIN}/skills/build-user-docs/SKILL.md for the doc taxonomy the plugin expects. Judge what an end user (not a spec reader) is missing: install/build guide, quickstart, config reference (every config key the code reads — grep the source for config lookups), setup walkthroughs for each promised integration, automation/extension authoring guides, troubleshooting. Doc-promise ledger rows:\n${JSON.stringify(LEDGER.filter(p => p.kind === 'doc-promise' || p.kind === 'config-key'), null, 0)}` },
  { key: 'test-coverage', prompt: `You are the test-coverage finder. Read ${SPEC}/reference/testing-conventions.md FIRST if it exists — the project's named test-surface kinds and which are advisory vs gating. Then inventory the test tree (${JSON.stringify(inv.testTree)}) against it: which kinds are underbuilt, which spec'd test surfaces exist vs promised, where fixtures are toy-sized vs realistic, which concurrency claims lack a concurrency check, which integration flows are only unit-tested. Findings propose concrete test surfaces (target names, fixture shapes, what they'd assert), sized as single issues.` },
  { key: 'benchmarks', prompt: `You are the benchmarks finder. The audit wants QUANTIFIABLE benchmarks. Read ${SPEC}/reference/testing-conventions.md if it exists (advisory numbers never gate CI). Inventory what benchmark/perf tests exist in the test tree and what the spec quantifies anywhere in the ledger (kind=benchmark rows plus ~-marked numbers). Propose a small benchmark suite as issues: latency/throughput through the project's key seams, end-to-end timing over a scripted flow, correctness rates over N live runs against real backends, accounting/accuracy checks against ground truth — whatever the spec's claims make measurable. Each proposed benchmark names its metric, method, fixture, and where numbers land (advisory, recorded to a file — never a CI gate). Ledger:\n${JSON.stringify(LEDGER.filter(p => p.kind === 'benchmark' || p.kind === 'assertable-behavior').slice(0, 120), null, 0)}` },
  { key: 'drift-owner-calls', prompt: `You are the drift sweeper. Read EVERY file in ${PROGRESS}/drift/ (${inv.driftFiles.length} files). Collect every OWNER CALL, human-or-future parking, and "consumer/payer: future X" annotation. For each, judge against the live code whether it deserves promotion to a buildable issue now that the plan tree is done (in-scope hardening -> suggestedIssue) or remains a product decision (ownerDecision:true with the exact ownerQuestion). Do not re-litigate items the owner already accepted as-is unless leaving them costs users something concrete (then say what).` },
  { key: 'debt-markers', prompt: `You are the debt sweeper. Grep the code and test areas (${AREAS_JSON}) for explicit debt: "debt:" comments, TODO/FIXME, "log-only", "not yet", "placeholder", "stub". For each hit, read enough context to name the payer the code expects. Findings = debts whose payer was never scheduled (no plan issue covers them), grouped sensibly; quote file:line.${A.knownDebt ? ' Skip debts already inside the known standing debt only if another finder obviously owns them — when in doubt, report (dedup happens downstream).' : ''}` },
]
if (TRANSCRIPTS.length) FINDERS.push({ key: 'session-fixtures', prompt: `You are the session-fixture finder. The owner wants realistic session/interaction fixtures — both fabricated families and ones derived from REAL usage transcripts — to drive end-to-end testing that emulates real-world usage. Assess feasibility: sample the STRUCTURE of 2-3 transcript files under the allowed locations (${TRANSCRIPTS.join(', ')}; read a few hundred lines, note the event shapes — do not quote personal content). Then check what fixture machinery already exists in the test tree (${JSON.stringify(inv.testTree)}) and what the spec's session/transcript formats are. Findings = concrete fixture-conversion and fixture-family issues: a sanitizer/converter (transcript -> project fixture, PII-scrubbed by construction), fixture families per scenario, and the harness runs that consume them (offline replay in CI; live runs on demand). Sanitization is a trust boundary: derived fixtures must never embed personal content.` })
if (inv.driftFiles.length === 0) {
  const di = FINDERS.findIndex(f => f.key === 'drift-owner-calls')
  if (di >= 0) FINDERS.splice(di, 1)
  log('No drift files — skipping the drift-owner-calls finder')
}
// barrier justified: the critic and dedup both need the complete finding set
const found = await parallel(FINDERS.map(f => () =>
  agent(`${CTX}\n${f.prompt}\nEmit at most 14 findings (dimension="${f.key}"); prioritize by user impact and set dropped to what the cap cut. Findings must be demonstrated from files you actually read, never assumed. ${BRIEF}`,
    { label: `find:${f.key}`, phase: 'Find', model: M('fanout'), effort: 'high', schema: FIND_OUT })
))
let rawFindings = []
found.forEach((r, i) => { if (r && r.findings) r.findings.forEach(x => rawFindings.push({ ...x, dimension: FINDERS[i].key })) })
const findDropped = found.filter(Boolean).reduce((s, r) => s + (r.dropped || 0), 0)
log(`Find: ${rawFindings.length} raw findings from ${found.filter(Boolean).length}/${FINDERS.length} finders (${findDropped} dropped at caps)`)

// ---------- Phase 3: completeness critic + one bounded follow-up round ----------
phase('Critic')
const critic = await agent(
  `${CTX}
You are the completeness critic for this audit. Dimensions already hunted: ${FINDERS.map(f => f.key).join(', ')}.
Finding titles so far:\n${rawFindings.map(f => `- [${f.dimension}] ${f.title}`).join('\n')}
Corpus inventory:\n${JSON.stringify({ specCategories: inv.specCategories, codeAreas: inv.codeAreas, testTree: inv.testTree, docs: inv.docs.map(d => d.path), entrypoints: inv.entrypoints }, null, 0)}
What is MISSING from this audit — a spec category no finding touches, a user journey never assessed (upgrade/backup/data portability? operational failure recovery?), a modality not run? Emit up to 4 follow-up finder prompts, each a self-contained hunting instruction over named paths, only where you genuinely expect findings — an empty list is acceptable. ${BRIEF}`,
  {
    label: 'critic:completeness', phase: 'Critic', model: M('singleton'), effort: 'max',
    schema: {
      type: 'object', required: ['followups'],
      properties: { followups: { type: 'array', maxItems: 4, items: { type: 'object', required: ['key', 'prompt'], properties: { key: { type: 'string' }, prompt: { type: 'string' } } } } },
    },
  }
)
const followups = (critic && critic.followups) || []
if (followups.length) {
  log(`Critic commissioned ${followups.length} follow-up finders: ${followups.map(f => f.key).join(', ')}`)
  // barrier justified: dedup needs these merged into the full set
  const round2 = await parallel(followups.map(f => () =>
    agent(`${CTX}\n${f.prompt}\nEmit at most 10 findings (dimension="${f.key}"); set dropped to what the cap cut. Demonstrate from files actually read. ${BRIEF}`,
      { label: `find2:${f.key}`, phase: 'Critic', model: M('fanout'), effort: 'high', schema: FIND_OUT })
  ))
  round2.forEach((r, i) => { if (r && r.findings) r.findings.forEach(x => rawFindings.push({ ...x, dimension: followups[i].key })) })
  log(`Round 2 added ${round2.filter(Boolean).reduce((s, r) => s + r.findings.length, 0)} findings; total ${rawFindings.length}`)
} else { log('Critic found no holes worth a follow-up round') }
if (!rawFindings.length) return { epicPath: null, created: [], ownerDecisions: [], note: 'audit found nothing — suspicious; check finder outputs in the journal', stats: { raw: 0 } }

// ---------- Phase 4: dedup (mechanical merge) ----------
phase('Dedup')
const numbered = rawFindings.map((f, i) => ({ id: i, ...f }))
const dd = await agent(
  `You are the findings editor. Merge entries that describe the SAME underlying gap (even across dimensions — e.g. one wiring gap reported by spec-vs-code, reachability, and debt-markers) into single findings: union evidence, keep the clearest title/claim, keep the STRONGEST severity (critical > major > minor), keep ownerDecision true if ANY member set it (and keep its ownerQuestion), prefer the most concrete suggestedIssue, list all member ids. Genuinely different gaps stay separate even in the same file. Every input id appears in exactly one merged entry. Do not soften claims.\nFINDINGS:\n${JSON.stringify(numbered, null, 0)}\n${BRIEF}`,
  {
    label: 'dedup', phase: 'Dedup', model: M('mechanical'), effort: 'medium',
    schema: {
      type: 'object', required: ['merged'],
      properties: { merged: { type: 'array', items: { ...FINDING, required: ['ids', ...FINDING.required], properties: { ids: { type: 'array', items: { type: 'integer' } }, ...FINDING.properties } } } },
    },
  }
)
const merged = (dd && dd.merged) ? dd.merged : numbered.map(f => ({ ...f, ids: [f.id] }))
log(`Dedup: ${rawFindings.length} -> ${merged.length}`)

// ---------- Phase 5: adversarial verify ----------
phase('Verify')
const VERDICT = {
  type: 'object', required: ['refuted', 'reasoning', 'confidence', 'adjusted_severity', 'ownerDecision'],
  properties: {
    refuted: { type: 'boolean' },
    reasoning: { type: 'string' },
    confidence: { enum: ['high', 'medium', 'low'] },
    adjusted_severity: { enum: ['critical', 'major', 'minor'] },
    ownerDecision: { type: 'boolean', description: 'true if this actually needs a scope/product decision' },
  },
}
// barrier justified: the synthesizer clusters only the surviving set — needs every verdict
const verified = await parallel(merged.map(f => () =>
  agent(
    `${CTX}
You are an adversarial verifier. A finder claims the gap below. REFUTE it if you can:
(1) walk the cited paths yourself — is it actually implemented/tested/documented somewhere the finder missed (Grep widely: the test tree, docs, spec pages)? (2) does the spec actually promise this, or is the finder inventing scope? (3) is it excluded by the scope table at ${SPEC}/01-foundations/scope-and-non-goals.md, if that file exists (then not refuted — set ownerDecision=true instead)? (4) is the evidence real (quote what you find at those paths)? Default to refuted=true when evidence is thin. If it survives, set adjusted_severity to what the evidence supports.
FINDING:\n${JSON.stringify({ dimension: f.dimension, title: f.title, severity: f.severity, area: f.area, claim: f.claim, evidence: f.evidence, userImpact: f.userImpact, ownerDecision: f.ownerDecision }, null, 1)}\n${BRIEF}`,
    { label: `verify:${(f.title || '').slice(0, 40)}`, phase: 'Verify', model: M('fanout'), effort: 'high', schema: VERDICT }
  ).then(v => v && { ...f, verdict: v })
))
const alive = verified.filter(Boolean)
const confirmed = alive.filter(x => x.verdict.refuted === false).map(x => ({ ...x, severity: x.verdict.adjusted_severity || x.severity, ownerDecision: x.ownerDecision || x.verdict.ownerDecision }))
const refuted = alive.filter(x => x.verdict.refuted === true).map(x => ({ title: x.title, dimension: x.dimension, reason: x.verdict.reasoning }))
log(`Verify: ${confirmed.length} confirmed (${confirmed.filter(x => x.ownerDecision).length} owner-decisions), ${refuted.length} refuted, ${merged.length - alive.length} verifier failures`)
if (!confirmed.length) return { epicPath: null, created: [], ownerDecisions: [], refuted, note: 'every finding was refuted — the build may genuinely be tight; see journal', stats: { raw: rawFindings.length, merged: merged.length, confirmed: 0 } }

// ---------- Phase 6: synthesize the epic (singleton judgment) ----------
phase('Synthesize')
const issuable = confirmed.filter(x => !x.ownerDecision)
const ownerDecisions = confirmed.filter(x => x.ownerDecision).map(x => ({ title: x.title, dimension: x.dimension, severity: x.severity, claim: x.claim, question: x.ownerQuestion || 'needs owner scoping', evidence: x.evidence }))
const synth = await agent(
  `${CTX}
You are the epic synthesizer. Cluster the confirmed findings below into ONE new plan-tree epic (number ${EPICNUM}) of tracker issues, matching how this plan's epics are shaped (${EXEMPLAR ? `read ${PLAN}/${EXEMPLAR}/epic.md and one of its sprint.md files for calibration; ` : ''}read ${PLUGIN}/skills/plan-0-decompose/PLAN-FORMAT.md for the required structure and ${PLUGIN}/skills/plan-0-decompose/VERTICAL-SLICES.md for issue sizing).
Constraints:
- 2 to 4 sprints, each 4-9 issues, HARD CAP ${MAXISSUES} issues total. Sprints group by theme AND dependency order (wiring/reachability gaps first if present — later test/benchmark work runs on top of them). Cross-sprint dependencies flow forward only.
- Each issue = one assertable behavior, present-tense behavioral title like the existing plan. Fold minor same-area findings into one issue; findings that do not make the cut go to "deferred" with a reason (no silent drops).
- Benchmark or live-endpoint issues must state that they run on demand, never gate CI, and name their metric + where numbers are recorded.
- Any sprint whose outcome is UI-observable or needs human judgment of live output ends with a REVIEW issue (human gate). Type HITL only where a human must supply credentials/accounts.
- Every issue carries: slug (UPPERCASE-HYPHENATED, short), type, title, whatToBuild (2-5 sentences, concrete), specAnchors (real spec paths — reuse the findings'), userFacing line value, acceptanceCriteria (2-5 checkable), testingCheckpoint (command + expected), blockedBy (list of "SS-II" refs within this epic, empty ok), sourceFindings (merged finding titles).
- epicSlug: kebab, short; goal: 1-2 sentences, checkable; also emit sprintSequencing prose and an epic-exit outcome sentence.
FINDINGS (issuable):\n${JSON.stringify(issuable.map(x => ({ dimension: x.dimension, severity: x.severity, title: x.title, area: x.area, claim: x.claim, userImpact: x.userImpact, evidence: x.evidence, suggestedIssue: x.suggestedIssue })), null, 0)}\n${BRIEF}`,
  {
    label: 'synthesize:epic', phase: 'Synthesize', model: M('singleton'), effort: 'max',
    schema: {
      type: 'object', required: ['epicSlug', 'epicTitle', 'goal', 'epicExit', 'sprintSequencing', 'sprints', 'deferred'],
      properties: {
        epicSlug: { type: 'string' }, epicTitle: { type: 'string' }, goal: { type: 'string' },
        epicExit: { type: 'string' }, sprintSequencing: { type: 'string' },
        sprints: {
          type: 'array', minItems: 2, maxItems: 4,
          items: {
            type: 'object', required: ['num', 'slug', 'title', 'goal', 'sprintExit', 'issues'],
            properties: {
              num: { type: 'string', description: '01..04' }, slug: { type: 'string' }, title: { type: 'string' },
              goal: { type: 'string' }, sprintExit: { type: 'string' },
              issues: {
                type: 'array', minItems: 3, maxItems: 9,
                items: {
                  type: 'object', required: ['num', 'slug', 'type', 'title', 'whatToBuild', 'specAnchors', 'userFacing', 'acceptanceCriteria', 'testingCheckpoint', 'blockedBy', 'sourceFindings'],
                  properties: {
                    num: { type: 'string' }, slug: { type: 'string' }, type: { enum: ['AFK', 'HITL', 'REVIEW'] },
                    title: { type: 'string' }, whatToBuild: { type: 'string' },
                    specAnchors: { type: 'array', items: { type: 'string' } },
                    userFacing: { type: 'string' },
                    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
                    testingCheckpoint: { type: 'string' },
                    blockedBy: { type: 'array', items: { type: 'string' } },
                    sourceFindings: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        deferred: { type: 'array', items: { type: 'object', required: ['title', 'reason'], properties: { title: { type: 'string' }, reason: { type: 'string' } } } },
      },
    },
  }
)
if (!synth) throw new Error('synthesizer failed')
const totalIssues = synth.sprints.reduce((s, sp) => s + sp.issues.length, 0)
log(`Epic ${EPICNUM}-${synth.epicSlug}: ${synth.sprints.length} sprints, ${totalIssues} issues, ${synth.deferred.length} deferred, ${ownerDecisions.length} owner decisions`)

// ---------- Phase 7: author the plan tree ----------
phase('Author')
const EPICDIR = `${PLAN}/${EPICNUM}-${synth.epicSlug}`
const AUTHOR_RULES = `Follow ${PLUGIN}/skills/plan-0-decompose/PLAN-FORMAT.md EXACTLY — field names, link shapes, and file naming are machine-verified.${EXEMPLAR ? ` Calibrate prose against ${PLAN}/${EXEMPLAR}/ exemplars.` : ''} Every issue: "**GitHub**: <unassigned>", "**Status**: not-started", a "**User-facing**" line, spec-anchor links written as relative markdown links that resolve on disk. Never run git, never run plan-status.py, never touch any file outside ${EPICDIR}/ except the one index edit assigned to you.`
// serial: epic.md + the shared plan index (one agent may touch index.md — the funnel rule)
const epicAuthored = await agent(
  `${CTX}\nYou are the epic author. ${AUTHOR_RULES}\nCreate ${EPICDIR}/epic.md for the structure below: Status not-started, "**GitHub epic**: <unassigned>", issue count "${totalIssues} across ${synth.sprints.length} sprints", Goal from goal, "## Sprints" table linking (NN-slug/sprint.md) rows with per-sprint issue counts and not-started status, "## Sprint sequencing" from sprintSequencing, "## Testing checkpoints" with the epic-exit outcome ("${synth.epicExit}") plus the standard runnable checkpoints (plan-status check ${EPICNUM}, verify-plan-tree), "## Blocked by" -> ${EXEMPLAR ? `link the newest existing epic (../${EXEMPLAR}/epic.md)` : 'None'}, "## Blocks" -> None. THEN edit ${PLAN}/index.md: add the epic row to the Epics table (sprints=${synth.sprints.length}, issues=${totalIssues}, not-started) and update the Total row arithmetic. Preserve every other line.\nSTRUCTURE:\n${JSON.stringify({ epicNumber: EPICNUM, slug: synth.epicSlug, title: synth.epicTitle, goal: synth.goal, sprints: synth.sprints.map(s => ({ num: s.num, slug: s.slug, title: s.title, issues: s.issues.length })) }, null, 1)}\n${BRIEF}`,
  { label: 'author:epic', phase: 'Author', model: M('mechanical'), effort: 'medium', schema: { type: 'object', required: ['epicPath', 'indexUpdated'], properties: { epicPath: { type: 'string' }, indexUpdated: { type: 'boolean' } } } }
)
if (!epicAuthored) throw new Error('epic author failed — aborting before sprint authoring')
// barrier justified: the verify loop must see the complete tree; sprint dirs are disjoint so authors parallelize safely
const sprintResults = await parallel(synth.sprints.map(sp => () =>
  agent(
    `${CTX}\nYou are the sprint author for sprint ${EPICNUM}-${sp.num}. ${AUTHOR_RULES}\nCreate ${EPICDIR}/${sp.num}-${sp.slug}/sprint.md (Epic link ../epic.md titled "E${EPICNUM} ${synth.epicTitle}", spec anchors = union of issue specAnchors, Status not-started, Goal, "## Issues" table (| # | Type | Title | GitHub | Status |) linking (issues/NN_issue_SLUG.md), "## Sprint dependency notes" derived from the issues' blockedBy, "## Testing checkpoints" with the sprint-exit outcome ("${sp.sprintExit}") and a runnable-checkpoints table) and, under ${EPICDIR}/${sp.num}-${sp.slug}/issues/, one NN_issue_SLUG.md per issue below: title line, Sprint/Epic/Type/GitHub/Status fields, "## Parent" link, "## What to build" (whatToBuild + "Anchor:" spec links), the "**User-facing**" line, "## Acceptance criteria" checkboxes (unchecked), "## Testing checkpoint" table from testingCheckpoint, "## Blocked by" linking blockedBy refs (./NN_issue_SLUG.md within this sprint, or ../../SS-slug/issues/... across sprints in this epic; "- None" if empty).\nISSUES:\n${JSON.stringify(sp.issues, null, 1)}\nCross-sprint slug lookup:\n${JSON.stringify(synth.sprints.map(s => ({ sprint: s.num, slug: s.slug, issues: s.issues.map(i => ({ num: i.num, slug: i.slug, ref: `${s.num}-${i.num}` })) })), null, 0)}\n${BRIEF}`,
    { label: `author:sprint-${sp.num}`, phase: 'Author', model: M('mechanical'), effort: 'medium', schema: { type: 'object', required: ['sprintPath', 'issueFiles'], properties: { sprintPath: { type: 'string' }, issueFiles: { type: 'array', items: { type: 'string' } } } } }
  )
))
log(`Authored: epic + ${sprintResults.filter(Boolean).length}/${synth.sprints.length} sprints (${sprintResults.filter(Boolean).reduce((s, r) => s + r.issueFiles.length, 0)} issue files)`)

// verify loop: mechanical fixers, escalate to singleton on round 3
let verifierOut = null
for (let round = 1; round <= 3; round++) {
  verifierOut = await agent(
    `Run: python3 ${PLAN}/verify-plan-tree.py (cwd ${ROOT}). Return ok=true only if it reports no errors and no broken links (warnings about size are tolerable). Quote the failing lines verbatim in problems. ${round > 1 ? 'A previous round attempted fixes; re-check from scratch.' : ''} ${BRIEF}`,
    { label: `verify-tree:round${round}`, phase: 'Author', model: M('retrieval'), effort: 'low', schema: { type: 'object', required: ['ok', 'problems'], properties: { ok: { type: 'boolean' }, problems: { type: 'array', items: { type: 'string' } } } } }
  )
  if (!verifierOut || verifierOut.ok) break
  log(`verify-plan-tree round ${round}: ${verifierOut.problems.length} problems`)
  await agent(
    `${CTX}\nYou are the plan-tree fixer (round ${round}). ${AUTHOR_RULES}\nverify-plan-tree.py reports:\n${verifierOut.problems.join('\n')}\nFix ONLY these problems — edit files under ${EPICDIR}/ (and the ${PLAN}/index.md row if the arithmetic is wrong). ${BRIEF}`,
    { label: `fix-tree:round${round}`, phase: 'Author', model: round === 3 ? M('singleton') : M('mechanical'), effort: round === 3 ? 'high' : 'medium', schema: { type: 'object', required: ['fixed'], properties: { fixed: { type: 'array', items: { type: 'string' } } } } }
  )
}
const treeGreen = !!(verifierOut && verifierOut.ok)
if (!treeGreen) log('verify-plan-tree still red after 3 rounds — returning the epic with problems listed, not throwing')

// ---------- Phase 8: publish (opt-in) ----------
phase('Publish')
let pub = null
if (PUBLISH && treeGreen) {
  // ONE serial agent: tracker CLI + per-file #NNN backfill is order-sensitive and idempotency must see prior edits
  pub = await agent(
    `${CTX}\nYou are the publisher. Read ${ROOT}/.plan/tracker.md for the tracker and Project-board contract (owner, project number, field semantics — look field/option IDs up at runtime, never hardcode). For EACH sprint of the new epic, in order (${synth.sprints.map(s => `${EPICNUM}-${s.num}`).join(', ')}):
1. Run: python3 ${PLAN}/publish-issues.py publish --sprint ${EPICNUM}-<NN> (cwd ${ROOT}). It creates the GitHub issues and backfills #NNN into the plan files. IDEMPOTENCY: files already carrying "**GitHub**: #NNN" are skipped by the script — never create duplicates yourself.
2. Mirror each created issue into the Project board: gh project item-add <num> --owner <owner> --url <issue-url>, then set Epic=E${EPICNUM}, Sprint=${EPICNUM}-<NN>, Type per the issue via gh project item-edit. The Epic/Sprint single-select OPTIONS for this new epic likely do not exist yet: fetch the field's current options first (gh project field-list --format json), and add the new option via the GraphQL updateProjectV2SingleSelectField mutation ONLY by passing the complete existing option list (with their ids and colors/descriptions) plus the new option — if the mutation errors or the shape is unclear, SKIP board mirroring for that field, leave the rest intact, and record it in fieldGaps rather than risking the board.
3. On a per-issue failure record it and continue.
Do not run git. Do not touch Status fields (new issues stay Todo/not-started). ${BRIEF}`,
    {
      label: 'publish:epic', phase: 'Publish', model: M('mechanical'), effort: 'high',
      schema: {
        type: 'object', required: ['created', 'failures', 'fieldGaps'],
        properties: {
          created: { type: 'array', items: { type: 'object', required: ['issue', 'ref'], properties: { issue: { type: 'string', description: 'EE-SS-II slug' }, ref: { type: 'string', description: '#NNN' } } } },
          failures: { type: 'array', items: { type: 'object', required: ['issue', 'error'], properties: { issue: { type: 'string' }, error: { type: 'string' } } } },
          fieldGaps: { type: 'array', items: { type: 'string' }, description: 'board fields left unset and why' },
        },
      },
    }
  )
  log(`Published ${(pub && pub.created || []).length} issues, ${(pub && pub.failures || []).length} failures, fieldGaps: ${(pub && pub.fieldGaps || []).length}`)
} else {
  log(PUBLISH ? 'publish skipped: plan tree still red' : 'publish:false — epic authored, tracker untouched')
}

// ---------- report ----------
return {
  epicPath: EPICDIR,
  epic: { number: EPICNUM, slug: synth.epicSlug, title: synth.epicTitle, goal: synth.goal, sprints: synth.sprints.map(s => ({ num: s.num, title: s.title, issues: s.issues.map(i => ({ ref: `${EPICNUM}-${s.num}-${i.num}`, type: i.type, title: i.title })) })) },
  ownerDecisions,
  deferred: synth.deferred,
  refuted,
  treeGreen,
  treeProblems: treeGreen ? [] : (verifierOut ? verifierOut.problems : ['verifier agent failed']),
  published: pub,
  stats: { promises: LEDGER.length, raw: rawFindings.length, merged: merged.length, confirmed: confirmed.length, ownerDecisions: ownerDecisions.length, refutedCount: refuted.length, issues: totalIssues, deferredCount: synth.deferred.length },
}
