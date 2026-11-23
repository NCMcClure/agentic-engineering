export const meta = {
  name: 'review-apply',
  description: "Land confirmed over-engineering cuts one commit at a time behind validate-or-revert: review-scan.mjs --apply begin records the base commit and the untracked files nothing may touch, the repo's own checks are baselined, then per cut: edit -> check -> repair forward once -> commit on green, put the files back on red; report predicted against realized per cut and the realized net-lines total",
  whenToUse: "review-diet skill's --apply mode only. The inline skill produces confirmed findings; this workflow lands them safely. Args: {root, scan, findings: [{file, line, tag, cut, replacement, spanLines?}], scope?, predictedNet?}, where scan is the absolute path of the plugin's scripts/review-scan.mjs. Never runs on unconfirmed findings, never batches cuts, never pushes.",
  phases: [
    { title: 'Capture', detail: 'base commit + protected untracked files; stops on uncommitted tracked changes' },
    { title: 'Baseline', detail: "find the repo's own checks, keep the ones that are green before any cut" },
    { title: 'Apply', detail: 'per cut, serial: edit -> check -> repair once -> commit on green, put back on red' },
    { title: 'Report', detail: 'predicted vs realized per cut + realized net lines' },
  ],
}

// Model tiers: haiku = running one review-scan.mjs --apply command and relaying
// its JSON (capture, put back, report); sonnet = the mechanical edit, check and
// commit; inherit (omit model) = repair-forward diagnosis, the hardest judgment
// in the run. The pipeline is strictly SERIAL: every cut mutates one shared
// working tree, so there is no parallel fan-out anywhere here. The git
// arithmetic and every undo belong to review-scan.mjs; no agent composes a
// reset, a clean, or a stash. No Date.now / Math.random.

// ---------- args (may arrive as a JSON string; coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.scan || !Array.isArray(A.findings)) {
  throw new Error('args must be an object: {root, scan, findings: [{file, line, tag, cut, replacement, spanLines?}], scope?, predictedNet?}')
}
const Q = s => JSON.stringify(String(s))
const ROOT = String(A.root).replace(/[\\/]$/, '')
const APPLY = `cd ${Q(ROOT)} && node ${Q(A.scan)} --apply`
const FINDINGS = A.findings.filter(f => f && f.file && f.cut)
const DROPPED = A.findings.length - FINDINGS.length
if (DROPPED) log(`Skipped ${DROPPED} malformed finding(s) missing file/cut`)
const SCOPE = A.scope === 'repo' ? 'repo' : 'diff'
// negative = lines removed, matching realizedNet's insertions - deletions
const PREDICTED_NET = Number.isFinite(A.predictedNet)
  ? A.predictedNet
  : FINDINGS.reduce((n, f) => n - (Number(f.spanLines) || 0), 0)
const BRIEF = 'Be terse in every string field. Your final message is machine-consumed via the structured-output tool; no prose preamble.'
const PROHIBITIONS = 'HARD PROHIBITIONS: never git clean, git reset, git stash, or git push; never commit with --no-verify; never modify or delete any path in the protected-untracked set; never put more than one cut in a commit.'

if (!FINDINGS.length) return { applied: [], reverted: [], predictedNet: 0, realizedNet: 0, note: 'no confirmed findings to apply' }

// ---------- Phase 1: Capture ----------
phase('Capture')
const capture = await agent(
  `You are the pre-apply recorder for the repo at ${ROOT}. Run exactly this and nothing else:
${APPLY} begin
Exit 0 prints one JSON object {base, branch, protected}: return ok:true with base and protected copied VERBATIM. A non-zero exit prints the reason on stderr: return ok:false with that reason as refusal. Change nothing. ${PROHIBITIONS} ${BRIEF}`,
  {
    label: 'capture', phase: 'Capture', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['ok'],
      properties: {
        ok: { type: 'boolean' },
        base: { type: 'string' },
        protected: { type: 'array', items: { type: 'string' }, description: 'untracked paths, verbatim' },
        refusal: { type: 'string', description: 'stderr of a non-zero exit' },
      },
    },
  }
)
if (!capture || !capture.ok || !capture.base) return { aborted: 'Capture', reason: capture ? (capture.refusal || 'begin printed no base commit') : 'capture agent produced no result' }
const BASE_SHA = capture.base
const PROTECTED = (capture.protected || []).map(s => String(s).trim()).filter(Boolean)
log(`Capture: base ${BASE_SHA.slice(0, 8)}, ${PROTECTED.length} protected untracked path(s)`)
const PROTECTED_NOTE = `Protected-untracked set (NEVER touch): ${PROTECTED.length ? JSON.stringify(PROTECTED) : '(none)'}.`

// ---------- Phase 2: Baseline ----------
phase('Baseline')
const baseline = await agent(
  `You are the toolchain baseliner for the repo at ${ROOT}. Find the project's OWN checks: the unit lane in .agents/manifest.json ("lanes") when the repo has one, otherwise from its manifests (package.json scripts, pyproject/setup, Makefile, go.mod, Cargo.toml) a compile or smoke check (tsc --noEmit, python -c import, go build, cargo check), the unit tests when they are quick, and the linter if one is configured. Write each as ONE shell command line that runs from the repo root, and run each ONCE, read-only, on the current tree. Record whether it PASSES now. A check that is red before any cut cannot judge a cut, so it will be left out. ${PROHIBITIONS} ${BRIEF}`,
  {
    label: 'baseline', phase: 'Baseline', model: 'sonnet', effort: 'low',
    schema: {
      type: 'object', required: ['checks'],
      properties: {
        checks: { type: 'array', items: { type: 'object', required: ['name', 'cmd', 'passes'], properties: { name: { type: 'string' }, cmd: { type: 'string', description: 'one shell command line, run from the repo root' }, passes: { type: 'boolean' } } } },
      },
    },
  }
)
const FOUND = baseline ? (baseline.checks || []).filter(c => c && c.cmd) : []
const CHECKS = FOUND.filter(c => c.passes).map(c => c.cmd)
const PREEXISTING = FOUND.filter(c => !c.passes).map(c => c.cmd)
log(`Baseline: ${CHECKS.length} green check(s), ${PREEXISTING.length} red before any cut and left out`)
const CHECK_FLAGS = CHECKS.map(c => ` --check ${Q(c)}`).join('')
const CHECK_NOTE = `The check command for a cut, naming every file the cut changed (root-relative):
${APPLY} check <file>...${CHECK_FLAGS}
You may append one more --check "<command>" for a test that targets the files this cut touched. It prints one JSON object {green, validated, files, checks}; a failed check carries its output in "tail". A non-zero exit is a refusal, with the reason on stderr.`

// ---------- Phase 3: Apply — strictly serial ----------
phase('Apply')
const CUT_SCHEMA = {
  type: 'object', required: ['edited', 'green', 'committed'],
  properties: {
    edited: { type: 'boolean', description: 'the cut is in the working tree' },
    files: { type: 'array', items: { type: 'string' }, description: 'every file changed, root-relative' },
    green: { type: 'boolean', description: 'the check command printed green:true' },
    validated: { type: 'boolean', description: 'the check command printed validated:true (at least one check ran)' },
    committed: { type: 'boolean', description: 'the cut is exactly one new commit' },
    sha: { type: 'string', description: 'the cut commit SHA' },
    failure: { type: 'string', description: 'the failed command and the tail of its output, or the refusal' },
    detail: { type: 'string' },
  },
}
const REVERT_SCHEMA = {
  type: 'object', required: ['reverted'],
  properties: { reverted: { type: 'boolean' }, detail: { type: 'string' } },
}
const COMMIT_NOTE = f => `On green:true, stage ONLY those files (git -C ${Q(ROOT)} add -- <file>..., never -A) and commit as exactly ONE commit: message "code-diet: <tag> <short what> (${f.file})". Record the commit SHA.`

const applied = []   // {finding, sha, validated}
const reverted = []  // {finding, reason}

for (let i = 0; i < FINDINGS.length; i++) {
  const f = FINDINGS[i]
  const loc = `${f.file}:L${f.line} ${f.tag || ''}`.trim()
  log(`Cut ${i + 1}/${FINDINGS.length}: ${loc}`)

  const step = await agent(
    `You are the surgeon applying ONE over-engineering cut in the repo at ${ROOT} (scope: ${SCOPE}). ${PROTECTED_NOTE}
THE CUT: ${JSON.stringify({ file: f.file, line: f.line, tag: f.tag, cut: f.cut, replacement: f.replacement })}.
Do, in order:
1. Make exactly this cut in ${f.file}: remove what "cut" names and apply "replacement" (nothing to add when the replacement is empty). Touch no other finding.
2. Run the check command. ${CHECK_NOTE}
3. ${COMMIT_NOTE(f)} On green:false or a refusal, change nothing more and commit nothing: report the failure.
Report edited, files, green, validated, committed, the sha, and any failure. ${PROHIBITIONS} ${BRIEF}`,
    { label: `apply:${i + 1}`, phase: 'Apply', model: 'sonnet', effort: 'medium', schema: CUT_SCHEMA }
  )

  let landed = step && step.edited && step.green && step.committed ? step : null
  let reason = !step ? 'apply agent produced no result'
    : !step.edited ? (step.detail || 'cut could not be applied')
    : !step.green ? (step.failure || step.detail || 'validation red')
    : (step.detail || 'the commit did not land')
  const files = new Set([f.file, ...((step && step.files) || [])])

  if (!landed && step && step.edited && !step.green) {
    // repair-forward ONCE — the hardest judgment, so it inherits the session model
    const repair = await agent(
      `You are repairing forward, ONCE, after a cut in ${ROOT} went red. The cut is in the working tree, uncommitted, in ${JSON.stringify([...files])}. What failed: ${step.failure || '(not reported)'}. ${PROTECTED_NOTE}
Diagnose the root cause. If a surgical fix (a missed reference, an import the cut orphaned, a caller the cut left dangling) makes it green, apply that fix and re-run the check command, naming every file now changed. ${CHECK_NOTE}
${COMMIT_NOTE(f)} If the fix is not surgical, do NOT force it: commit nothing and return green:false so the cut is put back. ${PROHIBITIONS} ${BRIEF}`,
      { label: `repair:${i + 1}`, phase: 'Apply', effort: 'high', schema: CUT_SCHEMA }
    )
    for (const p of (repair && repair.files) || []) files.add(p)
    if (repair && repair.green && repair.committed) landed = repair
    else reason = (repair && (repair.failure || repair.detail)) || 'validation red, repair-forward did not recover'
  }

  if (landed) {
    applied.push({ finding: loc, sha: landed.sha || '', validated: landed.validated !== false && (CHECKS.length > 0 || landed.validated === true) })
    continue
  }
  // Anything this cut left in the tree goes back before the next cut starts.
  const revert = await agent(
    `You are putting back ONLY one failed cut in ${ROOT}. Run exactly this:
${APPLY} revert ${[...files].map(Q).join(' ')}
Then run git -C ${Q(ROOT)} status --porcelain and report reverted:true only when no tracked file is listed as changed. Leave every landed commit in place. ${PROHIBITIONS} ${BRIEF}`,
    { label: `revert:${i + 1}`, phase: 'Apply', model: 'haiku', effort: 'low', schema: REVERT_SCHEMA }
  )
  reverted.push({ finding: loc, reason: reason + (revert && revert.reverted ? '' : ' (putting it back also reported trouble)') })
}
log(`Apply: ${applied.length} landed, ${reverted.length} reverted`)

// ---------- Phase 4: Report ----------
phase('Report')
let realizedNet = 0
if (applied.length) {
  const tally = await agent(
    `Report the realized line change of the landed cuts in ${ROOT}. Run exactly this and return the numbers from the JSON it prints, unchanged:
${APPLY} report --base ${BASE_SHA}
Change nothing. ${BRIEF}`,
    {
      label: 'tally', phase: 'Report', model: 'haiku', effort: 'low',
      schema: { type: 'object', required: ['net'], properties: { commits: { type: 'integer' }, insertions: { type: 'integer' }, deletions: { type: 'integer' }, net: { type: 'integer' } } },
    }
  )
  realizedNet = tally && Number.isFinite(tally.net) ? tally.net : 0
}

return {
  baseSha: BASE_SHA,
  protectedUntracked: PROTECTED,
  checks: CHECKS,
  checksLeftOut: PREEXISTING,
  predictedNet: PREDICTED_NET,
  realizedNet,
  applied: applied.map(a => ({ finding: a.finding, sha: a.sha, outcome: a.validated ? 'applied and green' : 'applied, not validated' })),
  reverted: reverted.map(r => ({ finding: r.finding, outcome: `reverted: ${r.reason}` })),
}
