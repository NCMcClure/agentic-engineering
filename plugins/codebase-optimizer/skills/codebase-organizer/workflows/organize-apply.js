export const meta = {
  name: 'codebase-organize-apply',
  description: 'Mutating: execute an approved reorganization plan — create a working branch, git mv every file, quarantine cruft, rewrite broken references, then run the project\'s own build/tests to verify behavior is preserved',
  phases: [
    { title: 'Preflight', detail: 'assert git + clean tree, create working branch' },
    { title: 'Move', detail: 'git mv per plan; quarantine cruft; gitignore ephemera' },
    { title: 'Rewrite', detail: 'apply reference fixes; re-grep for misses' },
    { title: 'Verify', detail: "run the project's build/test/lint" },
  ],
}

// args may arrive as a JSON string in the sandbox — coerce defensively.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
if (!A || typeof A !== 'object') A = {}

const ROOT = A.projectDir || ''
const DATE = A.dateToday || 'unknown-date'
const SKILL_DIR = A.skillDir || ''
const PLAN_PATH = A.planPath || (ROOT + '/.codebase-organizer-plan.json')
const BRANCH = A.branch || 'codebase-organizer/reorg'
// Safety: only proceed on a dirty tree if the caller explicitly opted in.
const ALLOW_DIRTY = A.allowDirty === true

if (!ROOT) return { error: 'projectDir is required (absolute path to the repo)' }

// ---------- Schemas ----------
const STAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'detail'],
  properties: {
    ok: { type: 'boolean' },
    detail: { type: 'string', description: 'what happened, with specifics' },
    branch: { type: 'string' },
    moved: { type: 'array', items: { type: 'string' }, description: 'from -> to for each move performed' },
    skipped: { type: 'array', items: { type: 'string' }, description: 'moves skipped and why' },
    quarantined: { type: 'array', items: { type: 'string' } },
  },
}

const REWRITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ok', 'files_edited', 'detail'],
  properties: {
    ok: { type: 'boolean' },
    files_edited: { type: 'array', items: { type: 'string' } },
    missed_references: { type: 'array', items: { type: 'string' }, description: 'references found by post-move re-grep that were not in the plan' },
    unresolved: { type: 'array', items: { type: 'string' }, description: 'risky/dynamic references that need human attention (not auto-edited)' },
    detail: { type: 'string' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['passed', 'commands_run', 'detail'],
  properties: {
    passed: { type: 'boolean' },
    commands_run: { type: 'array', items: { type: 'string' } },
    detail: { type: 'string', description: 'pass/fail per command; on failure, the failing output and the suspected missed reference' },
    suspected_cause: { type: 'string' },
  },
}

// ---------- Phase 1: Preflight ----------
phase('Preflight')
const pre = await agent(
  `You are preparing a repository at ${ROOT} for an approved reorganization. Anchor every git command to the repo with git -C "${ROOT}" (your cwd is NOT the repo).

Do, in order:
1. Confirm it is a git work tree: git -C "${ROOT}" rev-parse --is-inside-work-tree. If not, return ok:false.
2. Check cleanliness: git -C "${ROOT}" status --porcelain. ${ALLOW_DIRTY ? 'The caller allowed a dirty tree, so proceed regardless, but report what was dirty in detail.' : 'If there is ANY uncommitted change, return ok:false with detail listing the dirty paths — do NOT proceed (the clean tree is the safety net).'}
3. Read the approved plan at ${PLAN_PATH} to confirm it exists and parses as JSON; if not, return ok:false.
4. Create and switch to the working branch: git -C "${ROOT}" checkout -b "${BRANCH}" (if it already exists, check it out with git -C "${ROOT}" checkout "${BRANCH}"). Report the branch in the branch field.

Return ok:true only if the repo is a git tree, ${ALLOW_DIRTY ? '(dirty allowed)' : 'the tree is clean,'} the plan parses, and you are on the working branch. Do not move any files yet.`,
  { label: 'preflight', phase: 'Preflight', schema: STAGE_SCHEMA }
)

if (!pre || !pre.ok) {
  return { aborted: 'Preflight', reason: pre ? pre.detail : 'preflight produced no result', branch: pre && pre.branch }
}
log('Preflight ok on branch ' + (pre.branch || BRANCH))

// ---------- Phase 2: Move ----------
phase('Move')
const move = await agent(
  `You are executing the move list of an approved reorganization in the repo at ${ROOT}, on branch ${pre.branch || BRANCH}. Anchor git to the repo: git -C "${ROOT}" .... Read the plan at ${PLAN_PATH}.

Execute, in the plan's move order (it is ordered so parent content lands first):
1. For each move in plan.moves: create the destination's parent directory if needed (mkdir -p), then git -C "${ROOT}" mv "<from>" "<to>". ALWAYS use git mv so history follows the file — never cp+rm or delete+create. If a from-path no longer exists or a destination already exists (collision), skip that move and record it in skipped with the reason; do not force-overwrite.
2. Create scaffolding files: for each entry in plan.new_files (e.g. __init__.py for new Python subpackages), mkdir -p its parent and create the file empty (touch), then git -C "${ROOT}" add it. These are NEW files the target layout needs — they have no "from". Skip any that already exist.
3. Quarantine cruft: for each path in plan.cruft.quarantine, git -C "${ROOT}" mv it under an archive/ directory at the repo root (preserving its relative subpath, e.g. archive/<original/path>). This is for the HUMAN to review and delete later — do NOT delete anything yourself.
4. Gitignore ephemera: append each pattern in plan.cruft.gitignore to ${ROOT}/.gitignore if not already present (one per line, under a "# added by codebase-organizer" comment). Do not git-rm tracked cache files; just ignore going forward.

Do NOT commit. Do NOT rewrite any references yet (next phase). Report every move performed (from -> to), every skip with reason, and what was quarantined.`,
  { label: 'move', phase: 'Move', schema: STAGE_SCHEMA }
)

if (!move || !move.ok) {
  return { aborted: 'Move', reason: move ? move.detail : 'move stage produced no result', branch: pre.branch || BRANCH, partial: move }
}
log('Move done: ' + (move.moved || []).length + ' moved, ' + (move.skipped || []).length + ' skipped, ' + (move.quarantined || []).length + ' quarantined')

// ---------- Phase 3: Rewrite references ----------
phase('Rewrite')
const rewrite = await agent(
  `You are fixing the references broken by the file moves just performed in ${ROOT} (branch ${pre.branch || BRANCH}). Read ${SKILL_DIR}/references/reference-rewriting.md for the categories and method. Read the plan at ${PLAN_PATH}: each move carries a ref_impact list of predicted fixes (file + old->new + confidence).

Do:
1. Apply every "mechanical" fix from the plan's ref_impact lists: make the precise edit (old string -> new string) in the named file. Use targeted edits, NOT blind global search-and-replace — a global replace of a short module name corrupts unrelated matches.
2. Re-grep the repo for each moved path's old form (dotted module path, relative-import fragments, bare filename, bare directory name) to catch references the plan missed; fix the mechanical ones and record them in missed_references.
3. For "risky" fixes and any dynamic/runtime references (paths computed from __file__, importlib/require-by-variable, directory-scanning loaders, build-config semantics): apply them ONLY if you are confident; otherwise leave them and list them in unresolved for human attention. Better to flag than to silently break.
4. Anchor all git/grep to ${ROOT}. Do NOT commit.

Return the list of files edited, missed references you found and fixed, and unresolved items needing human attention.`,
  { label: 'rewrite', phase: 'Rewrite', schema: REWRITE_SCHEMA }
)
log('Rewrite done: ' + (rewrite ? (rewrite.files_edited || []).length : 0) + ' files edited, ' + (rewrite ? (rewrite.unresolved || []).length : 0) + ' unresolved')

// ---------- Phase 4: Verify ----------
phase('Verify')
const verify = await agent(
  `You are verifying that an in-progress reorganization of the repo at ${ROOT} (branch ${pre.branch || BRANCH}) did not break the build. Detect the project's OWN tooling and run it; let exit codes judge. Anchor to the repo: cd "${ROOT}" before running, or use the tool's project-dir flag.

Detect ecosystem from manifests, cross-checking the ecosystems list in the plan at ${PLAN_PATH}, and run the appropriate checks, fastest first:
- Python: python3 -c "import <top-level package>" smoke test, then pytest (or pytest --co -q to confirm collection if a full run is too slow/heavy), and ruff/flake8 if configured.
- Node/TS: npm run build or npx tsc --noEmit for path/type resolution, then npm test if a test script exists.
- Go: go build ./... then go test ./...
- Rust: cargo build then cargo test.
- Else: a Makefile target (make test / make check) or the commands in the CI config.

Prefer a quick resolution-level check (does everything still import/compile?) over an exhaustive slow suite — the goal is to confirm references resolve after the moves. Report passed (true only if the checks you ran succeeded), the exact commands you ran, and on any failure the failing output plus the suspected missed reference (cross-reference the move list). Do NOT commit, do NOT revert — the user's original branch is the safety net.`,
  { label: 'verify', phase: 'Verify', schema: VERIFY_SCHEMA }
)

log('Verify: ' + (verify && verify.passed ? 'PASSED' : 'FAILED') + ' (' + (verify ? (verify.commands_run || []).join(', ') : 'no result') + ')')

return {
  branch: pre.branch || BRANCH,
  moved: (move.moved || []).length,
  skipped: move.skipped || [],
  quarantined: move.quarantined || [],
  references_rewritten: rewrite ? (rewrite.files_edited || []).length : 0,
  unresolved_references: rewrite ? (rewrite.unresolved || []) : [],
  missed_references: rewrite ? (rewrite.missed_references || []) : [],
  verification: verify || { passed: false, detail: 'verify produced no result' },
  next_steps: (verify && verify.passed)
    ? 'Review the diff on branch ' + (pre.branch || BRANCH) + ', check quarantined files under archive/, then merge.'
    : 'Verification failed — see verification.detail. Fix forward, or discard with: git -C "' + ROOT + '" checkout <original-branch> && git -C "' + ROOT + '" branch -D ' + (pre.branch || BRANCH),
}
