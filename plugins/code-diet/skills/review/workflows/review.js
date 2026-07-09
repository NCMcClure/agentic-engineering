export const meta = {
  name: 'review-apply',
  description: 'Apply confirmed over-engineering cuts one commit at a time behind a validate-or-revert loop: capture a base SHA and the protected-untracked set, baseline the repo\'s own toolchain, then per cut apply -> validate -> repair-forward once -> revert-only-that-cut on red; report predicted vs realized per cut and the realized net-lines total',
  whenToUse: "review skill's --apply mode only. The inline skill produces confirmed findings; this workflow lands them safely. Args: {root, findings: [{file, line, tag, cut, replacement, spanLines?}], scope?, predictedNet?}. Never runs on unconfirmed findings, never batches cuts, never pushes.",
  phases: [
    { title: 'Capture', detail: 'base SHA + protected-untracked set recorded verbatim' },
    { title: 'Baseline', detail: "detect the repo's toolchain, record pre-existing failures" },
    { title: 'Apply', detail: 'per cut, serial: apply one commit -> validate -> repair once -> revert on red' },
    { title: 'Report', detail: 'predicted vs realized per cut + realized net lines' },
  ],
}

// Model tiers: haiku = pure git command driving (capture, revert, final numstat);
// sonnet = mechanical apply + validate (edit, commit, run the toolchain); inherit
// (omit model) = repair-forward diagnosis, the hardest judgment in the run. The
// pipeline is strictly SERIAL — every cut mutates one shared working tree, so
// there is no parallel fan-out anywhere here. No Date.now / Math.random.

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !Array.isArray(A.findings)) {
  throw new Error('args must be an object: {root, findings: [{file, line, tag, cut, replacement, spanLines?}], scope?, predictedNet?}')
}
const ROOT = String(A.root).replace(/\/$/, '')
const FINDINGS = A.findings.filter(f => f && f.file && f.cut)
const DROPPED = A.findings.length - FINDINGS.length
if (DROPPED) log(`Skipped ${DROPPED} malformed finding(s) missing file/cut`)
const SCOPE = A.scope === 'repo' ? 'repo' : 'diff'
// negative = lines removed, matching realizedNet's insertions - deletions
const PREDICTED_NET = Number.isFinite(A.predictedNet)
  ? A.predictedNet
  : FINDINGS.reduce((n, f) => n - (Number(f.spanLines) || 0), 0)
const BRIEF = 'Be terse in every string field. Your final message is machine-consumed via the structured-output tool; no prose preamble.'
const PROHIBITIONS = `HARD PROHIBITIONS: never git clean; never git push; never modify or delete any path in the protected-untracked set; never squash more than one cut into a commit. git is anchored to the repo with git -C ${ROOT}.`

if (!FINDINGS.length) return { applied: [], reverted: [], predictedNet: 0, realizedNet: 0, note: 'no confirmed findings to apply' }

// ---------- Phase 1: Capture ----------
phase('Capture')
const capture = await agent(
  `You are the pre-apply recorder for the repo at ${ROOT}. Do, in order:
1. git -C ${ROOT} rev-parse --is-inside-work-tree — if not a work tree, return ok:false.
2. Record the base SHA: git -C ${ROOT} rev-parse HEAD (empty string if no commits yet).
3. Record the protected-untracked set VERBATIM: git -C ${ROOT} status --porcelain, keep every line starting with "?? " — these are the user's untracked files and are off-limits to every later step.
Change nothing. ${PROHIBITIONS} ${BRIEF}`,
  {
    label: 'capture', phase: 'Capture', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['ok', 'baseSha', 'protectedUntracked'],
      properties: {
        ok: { type: 'boolean' },
        baseSha: { type: 'string' },
        protectedUntracked: { type: 'array', items: { type: 'string' }, description: '"?? path" lines, verbatim' },
      },
    },
  }
)
if (!capture || !capture.ok) return { aborted: 'Capture', reason: capture ? 'not a git work tree' : 'capture agent produced no result' }
const BASE_SHA = capture.baseSha || ''
const PROTECTED = (capture.protectedUntracked || []).map(s => s.replace(/^\?\?\s+/, '').trim()).filter(Boolean)
log(`Capture: base ${BASE_SHA.slice(0, 8) || '(none)'}, ${PROTECTED.length} protected untracked path(s)`)
const PROTECTED_NOTE = `Protected-untracked set (NEVER touch): ${PROTECTED.length ? JSON.stringify(PROTECTED) : '(none)'}.`

// ---------- Phase 2: Baseline ----------
phase('Baseline')
const baseline = await agent(
  `You are the toolchain baseliner for the repo at ${ROOT}. Detect the project's OWN checks from its manifests (package.json scripts, pyproject/setup, Makefile, go.mod, Cargo.toml) and run them ONCE, read-only, on the current tree:
- a compile/smoke check (tsc --noEmit, python -c import, go build, cargo check) — fastest first;
- the linter if one is configured (ruff/eslint/etc.).
Do NOT run the full slow test suite here — targeted tests run per cut later. Record each check's command and whether it currently PASSES or FAILS. Failing checks are pre-existing: later validation subtracts them so an unrelated red does not block a cut. ${PROHIBITIONS} ${BRIEF}`,
  {
    label: 'baseline', phase: 'Baseline', model: 'sonnet', effort: 'low',
    schema: {
      type: 'object', required: ['checks', 'preexistingFailures'],
      properties: {
        checks: { type: 'array', items: { type: 'object', required: ['name', 'cmd'], properties: { name: { type: 'string' }, cmd: { type: 'string' }, passes: { type: 'boolean' } } } },
        preexistingFailures: { type: 'array', items: { type: 'string' }, description: 'names of checks red before any cut' },
      },
    },
  }
)
const CHECKS = baseline ? (baseline.checks || []) : []
const PREEXISTING = baseline ? (baseline.preexistingFailures || []) : []
log(`Baseline: ${CHECKS.length} check(s), ${PREEXISTING.length} pre-existing failure(s)`)
const TOOLCHAIN_NOTE = `Repo checks: ${JSON.stringify(CHECKS.map(c => ({ name: c.name, cmd: c.cmd })))}. Pre-existing failures to SUBTRACT (a red among these does not count against the cut): ${JSON.stringify(PREEXISTING)}.`

// ---------- Phase 3: Apply — strictly serial ----------
phase('Apply')
const APPLY_SCHEMA = {
  type: 'object', required: ['committed', 'green'],
  properties: {
    committed: { type: 'boolean', description: 'the cut was applied as exactly one commit' },
    sha: { type: 'string', description: 'the cut commit SHA' },
    green: { type: 'boolean', description: 'validation passed (no NEW failures vs baseline)' },
    validated: { type: 'array', items: { type: 'string' }, description: 'checks run, each with pass/fail' },
    failures: { type: 'array', items: { type: 'string' }, description: 'NEW failures introduced by this cut' },
    detail: { type: 'string' },
  },
}
const REPAIR_SCHEMA = {
  type: 'object', required: ['green', 'summary'],
  properties: {
    green: { type: 'boolean', description: 'repaired forward to green' },
    summary: { type: 'string', description: 'the root cause and the one repair tried' },
    sha: { type: 'string', description: 'the amended cut commit SHA (amending changes it)' },
  },
}
const REVERT_SCHEMA = {
  type: 'object', required: ['reverted'],
  properties: { reverted: { type: 'boolean' }, detail: { type: 'string' } },
}

const applied = []   // {finding, sha, spanLines}
const reverted = []  // {finding, reason}

for (let i = 0; i < FINDINGS.length; i++) {
  const f = FINDINGS[i]
  const loc = `${f.file}:L${f.line} ${f.tag || ''}`.trim()
  log(`Cut ${i + 1}/${FINDINGS.length}: ${loc}`)

  const step = await agent(
    `You are the surgeon applying ONE over-engineering cut in the repo at ${ROOT} (scope: ${SCOPE}). ${PROTECTED_NOTE} ${TOOLCHAIN_NOTE}
THE CUT: ${JSON.stringify({ file: f.file, line: f.line, tag: f.tag, cut: f.cut, replacement: f.replacement })}.
Do, in order:
1. Make exactly this cut in ${f.file} — remove what "cut" names and apply "replacement" (nothing to add when the replacement is empty). Touch no other finding.
2. git -C ${ROOT} add ONLY the files this cut changed (never -A), then commit as exactly ONE commit: message "code-diet: <tag> <short what> (${f.file})". Record the commit SHA.
3. Validate: run the repo's compile/smoke check, then any tests targeting the files this cut touched, then the linter. Subtract the pre-existing failures above. green = no NEW failure vs baseline.
Report committed, the sha, green, the checks you ran, and any NEW failures. ${PROHIBITIONS} ${BRIEF}`,
    { label: `apply:${i + 1}`, phase: 'Apply', model: 'sonnet', effort: 'medium', schema: APPLY_SCHEMA }
  )

  if (!step || !step.committed) {
    reverted.push({ finding: loc, reason: step ? (step.detail || 'cut could not be applied') : 'apply agent produced no result' })
    continue
  }

  let green = step.green
  let cutSha = step.sha || ''
  if (!green) {
    // repair-forward ONCE — the hardest judgment, so it inherits the session model
    const repair = await agent(
      `You are repairing forward, ONCE, after a cut in ${ROOT} went red. The cut commit is ${step.sha || 'HEAD'} on ${f.file}. NEW failures: ${JSON.stringify(step.failures || [])}. ${TOOLCHAIN_NOTE}
Diagnose the root cause. If a surgical fix (a missed reference, an import the cut orphaned, a caller the cut left dangling) makes it green, apply that fix and AMEND it into the same cut commit (git -C ${ROOT} commit --amend --no-edit), re-run the same validation, and report the amended commit's SHA. If the fix is not surgical, do NOT force it — return green:false so the cut gets reverted. ${PROHIBITIONS} ${BRIEF}`,
      { label: `repair:${i + 1}`, phase: 'Apply', effort: 'high', schema: REPAIR_SCHEMA }
    )
    green = !!(repair && repair.green)
    if (green && repair.sha) cutSha = repair.sha
    if (!green) {
      const revert = await agent(
        `You are reverting ONLY this one failed cut in ${ROOT}. Its commit is ${step.sha || 'HEAD'}. Undo exactly that commit and nothing else: if it is HEAD, git -C ${ROOT} reset --hard ${step.sha ? step.sha + '^' : 'HEAD^'}; otherwise git -C ${ROOT} revert --no-edit ${step.sha}. Leave every other landed cut in place. Confirm the tree builds again afterward. ${PROHIBITIONS} ${BRIEF}`,
        { label: `revert:${i + 1}`, phase: 'Apply', model: 'haiku', effort: 'low', schema: REVERT_SCHEMA }
      )
      reverted.push({ finding: loc, reason: ((repair && repair.summary) || 'validation red, repair-forward did not recover') + (revert && revert.reverted ? '' : ' (revert also reported trouble)') })
      continue
    }
  }
  applied.push({ finding: loc, sha: cutSha, spanLines: Number(f.spanLines) || 0 })
}
log(`Apply: ${applied.length} landed green, ${reverted.length} reverted`)

// ---------- Phase 4: Report ----------
phase('Report')
let realizedNet = 0
if (applied.length) {
  // no base commit = diff against git's empty-tree object
  const DIFF_BASE = BASE_SHA || '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  const tally = await agent(
    `Report the realized line change of the landed cuts in ${ROOT}. Run git -C ${ROOT} diff --numstat ${DIFF_BASE} HEAD and sum insertions and deletions across all listed files. Return insertions, deletions, and net = insertions - deletions (negative means lines removed). Pure arithmetic on git output; change nothing. ${BRIEF}`,
    {
      label: 'tally', phase: 'Report', model: 'haiku', effort: 'low',
      schema: { type: 'object', required: ['net'], properties: { insertions: { type: 'integer' }, deletions: { type: 'integer' }, net: { type: 'integer' } } },
    }
  )
  realizedNet = tally && Number.isFinite(tally.net) ? tally.net : 0
}

return {
  baseSha: BASE_SHA,
  protectedUntracked: PROTECTED,
  predictedNet: PREDICTED_NET,
  realizedNet,
  applied: applied.map(a => ({ finding: a.finding, sha: a.sha, outcome: 'applied and green' })),
  reverted: reverted.map(r => ({ finding: r.finding, outcome: `reverted: ${r.reason}` })),
}
