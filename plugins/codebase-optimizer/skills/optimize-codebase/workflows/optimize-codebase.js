export const meta = {
  name: 'optimize-codebase',
  description: 'Unified, staged codebase optimizer that folds three loops into one engine: ORGANIZE (tidy the file tree) -> DECOMPOSE (split god-files) -> DEEPEN (architectural deepenings). Built on the mature decompose-repo engine. A single Setup pass prepares a clean committed baseline + CI-faithful uv env + protected-untracked set; a Conventions pass derives the repo organization conventions (codebase-organizer philosophy + the deterministic structure verifier) into a context block injected into every stage so newly-created modules land in logically-organized subpackages instead of loose siblings. Stages run in order and are toggleable (pass stages:[...] or organizeOnly:true). ORGANIZE reuses the codebase-organizer skill (plan -> persist -> apply -> CI verify -> commit -> re-scan until converged), doing history-preserving git mv + reference rewriting. DECOMPOSE runs the proven per-file engine: lane plan -> parallel find -> decision panel -> select line-disjoint carve-outs -> sequential apply (targeted oracle -> AST codemod leaving re-export shims -> validate+repair -> commit), reverting any member that reds. DEEPEN reuses the same Setup/panel/apply machinery with improve-architecture find criteria (shallow modules / missing seams), applied SEQUENTIALLY with revert (no worktrees). After each engine apply a cheap org audit runs the structure verifier on the touched tree. Model-tiered: Opus for the chair + codemod implementer, Sonnet for mechanical steps.',
  phases: [
    { title: 'Setup', detail: 'assert git tree, clean committed baseline on the working branch, set up uv env, capture a baseline test oracle + protected-untracked set + structure-verifier baseline (once for the whole run)' },
    { title: 'Conventions', detail: 'derive the repo organization conventions (codebase-organizer philosophy + language layouts + live repo_scan/verifier output) into a CONVENTIONS block injected into every decompose/deepen find/panel/chair/implement prompt (once)' },
    { title: 'Org[{p}] · Iter {r}', detail: 'ORGANIZE stage repo-level rounds (when selected): codebase-organizer plan -> persist -> apply (git mv + ref rewrite) -> CI verify -> commit -> re-scan until converged; phases unique per (pass, round)' },
    { title: 'Discover[{stage}] {p}', detail: 'DECOMPOSE worklist scan (files > discoverLines) / DEEPEN anchor scan (files > deepAnchorLines), unique per pass' },
    { title: '{STAGE} F{n} {file} · Iter {r}', detail: 'per-file engine rounds, created DYNAMICALLY and uniquely per (stage, file, round) — e.g. "DEC F2 main · Iter 1": compute the file shim module + contract census, then iterate rounds (find -> panel -> apply+shims -> validate -> commit) until convergence; no phase name is reused across stages, files, or rounds' },
    { title: 'Report', detail: 'per-stage rollup: organize moves landed, per-file before/after line counts + extractions, deepenings landed, org-audit findings, and convergence reasons' },
  ],
}

// ---- args (passed in by the orchestrating session; sandbox has no clock) ----
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
if (!A || typeof A !== 'object') A = {}

const ROOT = A.projectDir || ''
const DATE = A.dateToday || 'unknown-date'
const SKILL_DIR = A.skillDir || ''
const BRANCH = A.branch || 'optimize-codebase/auto'
// PER-FILE round cap (how many decomposition rounds any single file may take before we move on).
const MAX_ITERS = Number.isFinite(A.maxIterations) ? A.maxIterations : 20
// OUTER cap: how many distinct god-files the sweep will process before stopping.
const MAX_FILES = Number.isFinite(A.maxFiles) ? A.maxFiles : 25
// MULTI-FILE CONCURRENCY (DECOMPOSE stage only): how many oversized files decompose AT ONCE, each in
// its own git worktree with its OWN .venv. (The root .venv's editable .pth hardcodes <ROOT>/src, so a
// worktree sharing it would validate ROOT's source, not its own edits — every worktree must `uv sync`
// its own env.) Converged files merge back to BRANCH one at a time. 1 = the legacy serial sweep on the
// main checkout (no worktree, no extra venv) — identical to the pre-concurrency behavior.
const FILE_CONCURRENCY = Number.isFinite(A.fileConcurrency) ? A.fileConcurrency : 3
// On a merge-back conflict (rare — a shared file two files' extractions both touched, e.g. a concern
// subpackage __init__.py), abort the merge and re-run the file FRESH on the now-updated base, up to
// this many times, then surface it for a human (the child branch is kept, never auto-resolved).
const MERGE_RETRIES = Number.isFinite(A.mergeRetries) ? A.mergeRetries : 1
// Worktrees live under .worktrees/ (already gitignored), so worktree dirs + their .venv never show in
// ROOT's status and are never seen by discovery (which scans SCAN_ROOTS) or the revert path.
const WORKTREES_SUBDIR = '.worktrees/decompose'
// Min output-tokens we want in reserve before starting another (expensive) round/file.
const BUDGET_FLOOR = Number.isFinite(A.budgetFloor) ? A.budgetFloor : 150_000
// BEST-EFFORT PER-FILE line target: once a file drops to/below this it converges ('target-reached')
// and the sweep advances to the next largest file instead of grinding for marginal carve-outs.
const TARGET_LINES = Number.isFinite(A.targetLines) ? A.targetLines : 1000
// DISCOVERY threshold: only files with MORE than this many lines enter the worklist.
const DISCOVER_LINES = Number.isFinite(A.discoverLines) ? A.discoverLines : 1500
// Where to hunt for god-files, and what to never touch. The shim/patch-seam/AST machinery only fits
// importable Python source modules — the TS ui-tui workspace and dev/tests are excluded by default.
// NOTE: SCAN_ROOTS / TEST_DIRS_FOR / ENV_SETUP / BASE_IMPORTS / LINT / KEEP_SET are `let` (not const)
// because the Setup-phase DETECT step (below) fills repo-appropriate defaults when the caller did not
// pass an explicit arg. Explicit args always win (tracked via HAS()).
let SCAN_ROOTS = (Array.isArray(A.scanRoots) && A.scanRoots.length) ? A.scanRoots : ['src']
const EXCLUDE_GLOBS = (Array.isArray(A.excludeGlobs) && A.excludeGlobs.length) ? A.excludeGlobs : ['src/ui-tui/**', '**/__pycache__/**']
// PER-ROUND BATCHING: land up to BATCH_MAX line-DISJOINT extractions per find+panel cycle. A "giant"
// cluster (>= GIANT_LINES) is too central to batch — it lands SOLO with the round to itself. Raised
// to 5 so each (expensive) plan+find pass yields more committed extractions before the pool is rebuilt.
const BATCH_MAX = Number.isFinite(A.batchMax) ? A.batchMax : 5
// POOL REUSE (DECOMPOSE stage): a plan+find pass surfaces far more disjoint Strong candidates than one
// batch consumes. Leftovers are cached and REUSED for subsequent rounds instead of re-finding from
// scratch every round. A fresh find is forced only when the pool can't form a batch, or after
// REFIND_EVERY reuse passes (re-anchoring candidate line ranges against drift). Set 1 to disable reuse.
const REFIND_EVERY = Number.isFinite(A.refindEvery) ? A.refindEvery : 3
const GIANT_LINES = Number.isFinite(A.giantLines) ? A.giantLines : 350
// DYNAMIC LANE PLANNING: each file is reshaped every round (clusters move out, shims appear), so a
// fixed lane map goes stale fast. An Opus planner reads the LIVE file at the top of each round and
// carves it into fresh, non-overlapping concern lanes. Set planLanes:false (or pass an explicit
// `lanes` array) to fall back to a generic equal-region split of the live file.
const LANE_MIN = Number.isFinite(A.laneMin) ? A.laneMin : 4
const LANE_MAX = Number.isFinite(A.laneMax) ? A.laneMax : 9
// CHAIR ROBUSTNESS: the chair is a single Opus call whose null return (transient API blip) must NOT
// be mistaken for an architectural reject. Retry the chair, then fall back to the panel majority.
const CHAIR_TRIES = Number.isFinite(A.chairTries) ? A.chairTries : 3
// MODEL TIERING: heavy judgment on Opus, mechanical steps on Sonnet.
const M_KEY = A.keyModel || 'opus'        // hard-veto correctness lenses, chair, codemod implementer
// MECHANICAL tier: find, scope, oracle, commit, revert, soft lenses, census. Defaults to Sonnet;
// pass haikuMech:true to swap the default down to Haiku (cheaper/faster) for these steps. An explicit
// mechModel always wins. M_CHAIR_FALLBACK + M_VAL/M_CHAIR defaults that key off M_MECH follow suit.
const M_MECH = A.mechModel || (A.haikuMech === true ? 'haiku' : 'sonnet')
// COORDINATION tier: the per-file / per-advance steps that are essentially pure structured-output
// transcription — fast-setup, discover (run wc -l, transcribe every oversized file), census (grep +
// tally), measure-target. Haiku is unreliable at emitting StructuredOutput for these and CRASHES the
// whole run (a dropped StructuredOutput call is a hard error, not a soft null), so they never drop
// below Sonnet even when haikuMech swaps the hot mechanical loop to Haiku. Override with coordModel.
const M_COORD = A.coordModel || (A.haikuMech === true ? 'sonnet' : M_MECH)
// VALIDATION runs on the strong model: it is the correctness gate (pre-existing vs new regression,
// patch-seam / source-introspection guard breaks), where a misjudgment either commits a red or
// reverts a good extraction. Defaults to the key (Opus) tier; override with valModel.
const M_VAL = A.valModel || M_KEY
// CHAIR model: defaults to the key (Opus) tier, but the chair is the heaviest call (big dossier in,
// big mandate out) and Opus has been returning empty/malformed gateway responses (HTTP 200) on it.
// So the LAST retry falls back to chairFallbackModel (Sonnet) — a working verdict beats none.
const M_CHAIR = A.chairModel || M_KEY
const M_CHAIR_FALLBACK = A.chairFallbackModel || M_MECH
// REPAIR-FORWARD: when validation reds, DON'T throw the extraction away. Hand the exact new failures
// back to an Opus implementer to fix IN PLACE, then re-validate — up to MAX_REPAIRS times. A revert
// is the LAST RESORT, only after repairs are exhausted (or a repair aborts). Most reds here are
// mechanical (a source-text/introspection guard test to repoint, a patch-seam to re-thread, a missed
// import) and far cheaper to fix than to discard the whole find/panel/codemod investment and re-find.
const MAX_REPAIRS = Number.isFinite(A.maxRepairs) ? A.maxRepairs : 3
// VALIDATION NON-VERDICT vs RED: the validator is an LLM and sometimes returns NO usable verdict —
// a null result (transient API blip) or passed set to something that is not a strict boolean (it
// hedged / emitted malformed structured output). That is a VALIDATOR FAILURE, categorically different
// from a genuine red (passed:false with real regressions). Treating a non-verdict as red sends sound,
// fully-implemented work into the code-mutating repair loop and ultimately reverts it. So a non-verdict
// triggers a plain VALIDATION RETRY (re-run the same checks, fresh agent) up to VAL_RETRIES times
// BEFORE any repair/revert. Only a real boolean false (or a persistent non-verdict after retries) ever
// enters the repair-or-revert path.
const VAL_RETRIES = Number.isFinite(A.valRetries) ? A.valRetries : 2

// SINGLE-FILE MODE: pass `target` to skip discovery and decompose only that file (legacy behavior).
const SINGLE_TARGET = (typeof A.target === 'string' && A.target.trim()) ? A.target.trim() : ''
// ISOLATION is on only for a true multi-file sweep with concurrency > 1. Single-file mode and K=1 both
// run on the shared main checkout/branch (no worktree, no extra venv) — exactly the legacy path. NOTE:
// it is further narrowed PER-STAGE to the decompose stage at call sites (deepen/organize never isolate).
const ISOLATE = FILE_CONCURRENCY > 1 && !SINGLE_TARGET

// FAST SETUP: when prior runs already synced the env + captured the oracle, pass skipSetup:true to
// skip the two SLOW setup steps (`uv sync` ~minutes, baseline pytest oracle ~3-4min). It still does
// the CHEAP but load-bearing safety work: verify the branch, ensure a clean committed tree, and
// re-capture the PROTECTED UNTRACKED set (without it, revert-on-red could delete .venv/node_modules/
// archive/build). env is assumed ready; the baseline keep-set oracle is left empty (each round's own
// targeted oracle still captures pre-existing reds on its exact validation scope, so the gate holds).
const SKIP_SETUP = A.skipSetup === true

// Per-file destination-package override map: { "src/gateway/run.py": "src/gateway/_run" }. When a file
// has no entry we extract into its OWN package directory (siblings of the file) — see deriveFile().
const DEST_PKG_FOR = (A.destPkgFor && typeof A.destPkgFor === 'object') ? A.destPkgFor : {}

// An explicit `lanes` array pins the lane set for EVERY file (disables the planner + generic fallback).
const STATIC_OVERRIDE = Array.isArray(A.lanes) && A.lanes.length
// Dynamic planning is ON by default; pinning lanes or passing planLanes:false reverts to the fallback.
const LANE_PLAN = A.planLanes !== false && !STATIC_OVERRIDE

// ======================= STAGE SELECTION =======================
// The optimizer runs an ORDERED list of stages over ONE shared engine + Setup. Default is the
// canonical pipeline organize -> decompose -> deepen (organize first so the tree is tidy and the
// CONVENTIONS block is accurate before new modules are created; deepen last on the settled tree).
// The user-supplied order is honored verbatim; duplicates are allowed (e.g. a trailing 'organize'
// tidy pass) and each stage instance gets a unique pass index so phase names never collide.
const ALL_STAGES = ['organize', 'decompose', 'deepen']
let STAGES = (Array.isArray(A.stages) && A.stages.length)
  ? A.stages.filter(s => ALL_STAGES.includes(s))
  : ALL_STAGES.slice()
// Convenience flags translate to a single-stage run.
if (A.organizeOnly === true || A.mode === 'organize') STAGES = ['organize']
else if (A.mode === 'decompose') STAGES = ['decompose']
else if (A.mode === 'deepen') STAGES = ['deepen']
// Per-stage on/off toggles (drop a stage without reordering the rest).
if (A.organize === false) STAGES = STAGES.filter(s => s !== 'organize')
if (A.decompose === false) STAGES = STAGES.filter(s => s !== 'decompose')
if (A.deepen === false) STAGES = STAGES.filter(s => s !== 'deepen')
// SINGLE-FILE mode targets one file for the engine stages; organize is whole-tree so it drops out.
if (SINGLE_TARGET) STAGES = STAGES.filter(s => s !== 'organize')

// Per-stage numeric override helper: perStage:{ deepen:{ maxFiles:8 } } wins over the flat default.
const PER_STAGE = (A.perStage && typeof A.perStage === 'object') ? A.perStage : {}
const stageNum = (stage, key, dflt) => {
  const v = PER_STAGE[stage] && PER_STAGE[stage][key]
  return Number.isFinite(v) ? v : dflt
}

// ---- ORGANIZE stage (reuses the codebase-organizer skill) ----
// The organizer is a SEPARATE skill from improve-codebase-architecture; default to its in-repo home.
const ORGANIZER_SKILL_DIR = A.organizerSkillDir || (ROOT + '/.claude/skills/codebase-organizer')
const ORG_DEPTH = A.orgDepth === 'root-only' ? 'root-only' : 'recursive'
const ORG_MAX_ROUNDS = stageNum('organize', 'maxRounds', Number.isFinite(A.orgMaxRounds) ? A.orgMaxRounds : 8)
// Plans live OUTSIDE the repo so persisting them never dirties the work tree (apply refuses a dirty
// tree), AND outside the (read-only) plugin dir. Default to a sibling scratch dir of the repo:
// /path/repo -> /path/repo.optimize-codebase-plans . Override with orgPlanDir for a custom location.
const ORG_PLAN_DIR = A.orgPlanDir || (ROOT.replace(/\/+$/, '') + '.optimize-codebase-plans')
// ORG_EXCLUDE: repo-relative path prefixes the organizer must NOT move/restructure/quarantine. Defaults
// to the test trees — their path-depth math + dynamic discovery make reorg moves unsafe (the headless
// critic vetoed a whole plan over exactly this). Forwarded to organize-plan's `exclude` arg.
// src/ui-tui is a self-contained TypeScript workspace (its own package layout + 100+ .test.ts files);
// the decompose stage already treats it as off-limits via EXCLUDE_GLOBS, so the Python-oriented
// organizer must skip it too — otherwise the scan drowns in TS test files.
const ORG_EXCLUDE = (Array.isArray(A.orgExclude) ? A.orgExclude : (A.orgExclude ? [A.orgExclude] : ['dev/tests', 'tests', 'archive', 'src/ui-tui']))

// ---- DEEPEN stage (improve-architecture find criteria, sequential apply on the shared engine) ----
// Anchors: files large enough to host a deepening. A LOWER bar than decompose's discoverLines, since
// shallow-module/seam deepenings live in mid-size modules too.
const DEEP_ANCHOR_LINES = Number.isFinite(A.deepAnchorLines) ? A.deepAnchorLines : 400
const DEEP_MAX_FILES = stageNum('deepen', 'maxFiles', Number.isFinite(A.deepMaxFiles) ? A.deepMaxFiles : 15)
// Subsystem -> full test dirs that must stay green when that subsystem is touched (from improve-arch).
// `let` so DETECT can synthesize it from the real src<->tests mirror when not passed. Explicit wins.
let TEST_DIRS_FOR = (A.testDirsFor && typeof A.testDirsFor === 'object') ? A.testDirsFor : {
  agent: ['dev/tests/agent', 'dev/tests/run_agent'],
  gateway: ['dev/tests/gateway'],
  tui_gateway: ['dev/tests/tui_gateway'],
  hermes_cli: ['dev/tests/hermes_cli', 'dev/tests/cli'],
  hermes_core: ['dev/tests/hermes_state'],
  cron: ['dev/tests/cron'],
  providers: ['dev/tests/providers'],
  tools: ['dev/tests/tools'],
  plugins: ['dev/tests/plugins'],
}

// ---- ORG-AWARE PLACEMENT (so new modules land in convention-correct subpackages, not loose siblings) ----
const ORG_AWARE_PLACEMENT = A.orgAwarePlacement !== false
const CONVENTIONS_DOC = (typeof A.conventionsDoc === 'string') ? A.conventionsDoc : ''

// ---- POST-IMPLEMENTATION ORG AUDIT (cheap structure check after each engine apply) ----
const ORG_AUDIT = A.orgAudit !== false
// 'warn' = log findings only; 'feedback' = queue suggested fixes to seed a later organize pass.
const ORG_AUDIT_ACTION = (A.orgAuditAction === 'feedback') ? 'feedback' : 'warn'

// ---- DETERMINISTIC STRUCTURE VERIFIER (thin wrapper over the organizer's repo_scan.py) ----
// Both the verifier and repo_scan.py are STDLIB-ONLY, so the structure check runs on a plain
// `python3` — it does NOT need the target repo's uv env, and works even when env_ready is false.
// When run from the plugin, the SKILL passes ABSOLUTE ${CLAUDE_PLUGIN_ROOT} paths for both the
// verifier (structVerifier) and the scan script (scanScript); the repo path is passed as `.` so the
// command works whether it is cd'd into ROOT or a decompose worktree (the verifier resolves `.` to
// the cwd). runStructVerify still appends `--subtree <path>` after `--json` (argparse is order-free).
const STRUCT_VERIFIER = A.structVerifier || 'dev/bin/verify_source_structure.py'
const SCAN_SCRIPT = (typeof A.scanScript === 'string' && A.scanScript.trim()) ? A.scanScript.trim() : ''
const STRUCT_VERIFY_CMD = A.structVerifyCmd
  || ('python3 ' + STRUCT_VERIFIER + ' . ' + (SCAN_SCRIPT ? '--scan-script ' + SCAN_SCRIPT + ' ' : '') + '--json')

if (!ROOT) return { error: 'projectDir is required (absolute repo path)' }
if (!SKILL_DIR) return { error: 'skillDir is required (path to the improve-codebase-architecture skill dir)' }
if (!STAGES.length) return { error: 'no stages selected (stages/organizeOnly/mode left an empty set)' }
const M_AUDIT = A.orgAuditModel || M_MECH

// Explicit-arg presence tracker: DETECT only fills a value the caller did NOT pass. A string arg
// counts only when non-blank; an array arg only when non-empty.
const HAS = (k) => {
  const v = A[k]
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  return true
}

// CI-faithful verification surface. Everything runs through the project's env command (uv by default);
// the loop never trusts a bare python/pytest on PATH. These are `let` so the Setup-phase DETECT step
// can fill repo-appropriate values (test root, packages, extras) when the caller did not pass them.
// The defaults below are the ORIGINAL repo's values, kept only as a last-resort fallback.
// TEST_ROOT: where the suite lives (pyproject testpaths). Detected as dev/tests | tests | test.
let TEST_ROOT = (typeof A.testRoot === 'string' && A.testRoot.trim()) ? A.testRoot.trim().replace(/\/+$/, '') : 'dev/tests'
let ENV_SETUP = A.envSetup || 'uv sync --locked --python 3.11 --extra all --extra dev'
// Repo-wide import smoke base: a fast set of top-level imports that catches package-wide breakage.
// Each file's smoke ALSO imports that file's own shim module (see importSmokeFor) so the moved names
// stay importable from the original path. Detected from the src package layout when not passed.
let BASE_IMPORTS = A.baseImports || 'hermes_cli.main, hermes_core.cli, hermes_core.run_agent, gateway.run, tui_gateway.server, tui_gateway.entry, hermes_cli.auth, hermes_cli.runtime_provider, agent.transports, hermes_cli.cron'
// Reads BASE_IMPORTS at CALL time (always after DETECT has run in Setup), so the detected set is used.
const importSmokeFor = (shimMod) => 'uv run python -c "import ' + BASE_IMPORTS + (shimMod ? ', ' + shimMod : '') + '"'
let LINT = A.lintCmd || 'uvx ruff check .'
// Per-round lint runs on just the touched files. Prefix is repo-specific; '' means "no linter
// configured" -> the per-round lint becomes a shell no-op so a non-ruff repo is never RED'd by lint.
// DETECT sets this from the repo (ruff -> "uvx ruff check"; none found -> ""). Explicit lintPerFile wins.
let LINT_PER_FILE_PREFIX = (typeof A.lintPerFile === 'string') ? A.lintPerFile.trim() : 'uvx ruff check'
// Baseline oracle: a fast keep-set the whole sweep is measured against for pre-existing redness.
let KEEP_SET = (Array.isArray(A.keepSet) && A.keepSet.length) ? A.keepSet : ['dev/tests/agent', 'dev/tests/cron', 'dev/tests/gateway']
let PYTEST_FAST = A.oracleCmd || ('uv run python -m pytest ' + KEEP_SET.join(' ') + ' -q')
// Full-sweep validation fallback when a moved symbol is too pervasive to scope safely. The per-round
// `scope` agent narrows to a minimal subset per extraction; this is only the safety net. Defaults to
// the whole test tree (∪ keep-set) so nothing is missed; override valDirs to narrow it. Recomputed
// after DETECT (see recomputeDerived) since it depends on KEEP_SET + TEST_ROOT.
let VAL_DIRS = Array.from(new Set([...KEEP_SET, ...((Array.isArray(A.valDirs) && A.valDirs.length) ? A.valDirs : [TEST_ROOT])]))
// Recompute the KEEP_SET-derived commands/sets. Called after DETECT reconciles KEEP_SET/TEST_ROOT.
const recomputeDerived = () => {
  if (!HAS('oracleCmd')) PYTEST_FAST = 'uv run python -m pytest ' + KEEP_SET.join(' ') + ' -q'
  VAL_DIRS = Array.from(new Set([...KEEP_SET, ...((Array.isArray(A.valDirs) && A.valDirs.length) ? A.valDirs : [TEST_ROOT])]))
}

// ---------- Per-file derivation ----------
// From a repo-relative path src/<pkg>/.../<name>.py derive: the dotted shim module that callers and
// test patch() sites pin to (<pkg>...<name>), a commit scope tag (<name>), and the destination
// package new modules land in (the file's OWN directory by default, so extracted modules are
// siblings — mirrors how cli.py carved into the hermes_cli package; a subpackage named after the
// file would collide with <name>.py, so flat siblings is the safe default). destPkgFor overrides.
const deriveFile = (rawPath) => {
  const target = String(rawPath).replace(/^\.\//, '').replace(/^\/+/, '')
  const shimModule = target.replace(/^src\//, '').replace(/\.py$/, '').replace(/\//g, '.')
  const scopeTag = (target.split('/').pop() || target).replace(/\.py$/, '')
  const destPkg = DEST_PKG_FOR[target] || target.replace(/\/[^/]+\.py$/, '')
  const destPkgDotted = destPkg.replace(/^src\//, '').replace(/\//g, '.')
  return { target, shimModule, scopeTag, destPkg, destPkgDotted }
}

// ---------- Per-file worktree path/branch helpers (used by the concurrent DECOMPOSE stage) ----------
// A filesystem/branch-safe per-file tag that is UNIQUE even when two files share a basename (e.g.
// two run.py) — qualify the scope tag with the dotted dest package: gateway.run -> "gateway-run".
const wtTag = (d) => (d.destPkgDotted ? d.destPkgDotted + '.' + d.scopeTag : d.scopeTag).replace(/[^A-Za-z0-9._-]/g, '-')
const worktreePathFor = (d) => ROOT + '/' + WORKTREES_SUBDIR + '/' + wtTag(d)
// Child branch name. CRITICAL: it must NOT nest under BRANCH with a '/', because git stores
// refs/heads/<BRANCH> as a FILE — a sibling ref refs/heads/<BRANCH>/<tag> is a directory/file
// conflict and `git worktree add -b` fails. Use a '-wt-' infix (sibling ref, same parent dir) and
// strip dots, so the exact name always creates cleanly: optimize-codebase/auto -> optimize-codebase/auto-wt-gateway-run.
const childBranchFor = (d) => BRANCH + '-wt-' + wtTag(d).replace(/\./g, '-')

// Generic equal-region fallback lanes (used when dynamic planning is off / fails and no explicit
// `lanes` override is given). Splits the live file into up to `n` roughly-equal contiguous regions,
// each a hunting ground a find agent confirms against the real file.
const genericFallbackLanes = (fileLines, n) => {
  const lines = Number.isFinite(fileLines) && fileLines > 0 ? fileLines : 0
  if (!lines) {
    return Array.from({ length: n }, (_, i) => ({
      key: 'region-' + (i + 1),
      hint: 'Read the live file and find the largest cohesive cluster of related defs/methods that can move to a focused sibling module behind a re-export shim. Confirm exact symbols + ranges against the real file.',
    }))
  }
  const lanes = []
  const size = Math.ceil(lines / n)
  for (let i = 0; i < n; i++) {
    const lo = i * size + 1
    if (lo > lines) break
    const hi = Math.min(lines, (i + 1) * size)
    lanes.push({
      key: 'region-' + (i + 1),
      hint: 'Find the largest cohesive cluster of related defs/methods within lines ' + lo + '-' + hi + ' of the file that can move to a focused sibling module behind a re-export shim. Confirm the exact symbols + current ranges against the live file (the line anchors are hints from the current file shape).',
    })
  }
  return lanes
}

// ---------- The decision-maker panel (built per file so briefs cite the real target) ----------
// CHARTER (autonomous, DECOMPOSITION mode): the panel decides whether a candidate is the RIGHT
// MOVE for breaking up a god-file and, if so, the CORRECT PATH to land it safely — NOT whether it is
// easy enough to do unattended. The KEY DIFFERENCE from a deepening loop: carving a cohesive cluster
// out of a large file into a focused module is a LOCALITY/NAVIGABILITY win and is a VALID direction
// even when the extracted code is not "deepened". Pure file-organisation moves that improve locality
// ARE in scope. Out of scope: a move that adds indirection WITHOUT improving locality/navigability,
// or that fabricates a speculative port/seam with only one adapter. Two CORRECTNESS hard-vetoes
// remain: (1) FALSE PREMISE (the named cluster isn't actually cohesive/self-contained, or the
// line/site counts are wrong by an order of magnitude), and (2) a change that CANNOT preserve the
// file's external surface by ANY path — every importable name + patch("<shim>.X") site means EVERY
// extraction MUST leave a re-export shim at the old <shim>.* path. The validation gate (revert-on-red)
// + per-round oracle + git-clean ban remain the backstop.
const buildPanel = (ctx, stage) => {
  const { TARGET, SHIM_MODULE, DEST_PKG, CONTRACT_CENSUS, FILE_LINES, VAL_DIRS_STR } = ctx
  const CONV = ctx.CONVENTIONS ? ('\n\nREPO ORGANIZATION CONVENTIONS (any NEW module must land in a convention-correct home, not a loose sibling):\n' + ctx.CONVENTIONS) : ''
  if (stage === 'deepen') {
    // DEEPEN panel — ported from recursive-improve-architecture (cross-file deepenings).
    return [
      {
        role: 'Premise Auditor',
        hardVeto: true,
        brief: `Verify the candidate's factual premise against the REAL source. Read every file it names and the modules it claims to consolidate. Cast a HARD VETO (vote:"veto", hard_veto:true) ONLY if the premise is false — e.g. "two near-identical modules" that are actually divergent, an export/usage count wrong by an order of magnitude, or a "duplication" whose copies have materially different semantics. Implementing on a false premise builds the wrong abstraction. A premise being HARD to act on is NOT a false premise — do not veto for difficulty. If the premise checks out, vote approve/concerns and say what you verified.`,
      },
      {
        role: 'Contract Guardian',
        hardVeto: true,
        brief: `Determine whether the change can be done while preserving EVERY externally observable contract: public/plugin APIs (check src/plugins/**/README.md and docstrings for documented extension points), CLI surface, wire formats / outbound request JSON, persisted schemas (sessions.json, config YAML, DB), error contracts callers depend on. A deepening reshapes internals BEHIND a seam. Cast a HARD VETO ONLY if the candidate INHERENTLY cannot preserve a contract by any implementation path (then it isn't a deepening). If a naive implementation would break a contract but a behaviour-preserving path exists (keep the old signature/shim/adapter), do NOT veto — instead list the exact behavior_invariants that must stay byte-identical (these become characterization-test targets + mandate constraints) and vote concerns. Difficulty of preserving the contract is a plan input, not a veto.`,
      },
      {
        role: 'Blast-Radius Engineer',
        hardVeto: false,
        brief: `Assess scope HONESTLY (the find pass routinely under-counts) and TURN IT INTO A PLAN — never a veto. Count call sites, \`from X import Y\` sites, and \`patch("X.Y")\` / monkeypatch sites across src/ AND dev/tests/. A large or judgment-heavy radius is fine; your job is to make it safe: put concrete preconditions into required_safeguards — every old import path that must keep resolving as "shim: <path>", and, when the change is too large to land correctly in a single round, a DECOMPOSITION into ordered safe sub-steps as "stage N: <bounded leaf-extraction that is independently behaviour-preserving and verifiable>". The loop re-finds after each commit, so a multi-stage change lands one safe leaf per round. Only vote veto if the radius reflects a FALSE PREMISE or an inherent contract break (defer to those lenses); otherwise vote approve (if a clean plan exists) or concerns (plan + caveats). Do NOT veto for size/difficulty/"needs judgment".`,
      },
      {
        role: 'Test-Net Architect',
        hardVeto: false,
        brief: `Make the change CATCHABLE — the classic trap is tests moving with the code so they pass while behaviour drifts. Require CHARACTERIZATION tests (golden-master, written and committed at the EXISTING interface BEFORE refactoring) for each behaviour the change touches; put each into required_safeguards as "characterization test: <behavior>". Name the full dev/tests/<sub> dirs whose suites must stay green. If behaviour is hard to pin (e.g. concurrency/race/timing), do NOT veto — instead prescribe HOW to net it: deterministic seams, fake clocks/loops, injected executors, thread-join probes, or staging the risky core into its own later round behind a smaller first step. Vote veto ONLY if NO net can exist even in principle for ANY decomposition (extremely rare); otherwise approve/concerns with the net spelled out.`,
      },
      {
        role: 'Deepening Steward',
        hardVeto: false,
        brief: `You are the DIRECTION arbiter. Judge architectural merit using ${SKILL_DIR}/LANGUAGE.md and DEEPENING.md: is this a REAL deepening (more leverage at a smaller interface; the deletion test concentrates complexity that today spreads across N callers) or merely indirection/rename/file-move with NO depth gain? Vote veto ONLY for WRONG DIRECTION — a change that adds churn without leverage or locality. Difficulty, size, and "an unattended agent might struggle" are NOT your concern (other lenses plan for those) — a hard but genuinely-deepening change should get your approve. For ADR conflicts: flag it in rationale and put "adr-conflict: <which> — <why friction justifies revisiting>" in required_safeguards so the chair can weigh it; only vote veto if it contradicts a settled ADR AND the deepening value is weak. Confirm dependency_category and testing strategy fit. Vote approve/concerns/veto with rationale.${CONV}`,
      },
      {
        role: 'Execution Strategist',
        hardVeto: false,
        brief: `Decide HOW to land it — and there is ALWAYS a how; never veto for "too hard/too big". STRONGLY PREFER programmatic transformation over manual rewriting (hand-editing large files is the #1 source of silent breakage). Inspect the real files (note line counts) and prescribe the mechanism in required_safeguards as "execution: <method> — <step>":
- Moving/splitting symbols out of a big file: git mv for whole-file moves (preserve history) + a scripted/AST codemod (Python ast/libcst or a one-off transform script) to relocate definitions and REWRITE all imports + patch("old.path") refs — never hand-retype a large file.
- Wide mechanical edits (rename across N sites, import rewrites): scripted (codemod / sed over a grep'd file list), not file-by-file.
- Genuinely large/unwieldy refactors: do NOT reject — recommend execution_method:"staged" and break it into ordered single-round sub-steps, each independently verifiable.
- Small, localized, low-site-count changes: manual is fine.
Recommend execution_method (programmatic / hybrid / staged / manual) + a concrete step list. Vote approve/concerns (never veto for difficulty). If the change creates a NEW module, place it in a convention-correct home.${CONV}`,
      },
    ]
  }
  return [
    {
      role: 'Premise Auditor',
      hardVeto: true,
      brief: `Verify the candidate's factual premise against the REAL ${TARGET}. Read the exact line range it names and every symbol it claims to extract. Cast a HARD VETO (vote:"veto", hard_veto:true) ONLY if the premise is false — e.g. the named cluster is NOT cohesive (its members are entangled with code that stays, so the "clean seam" doesn't exist), the symbols are already defined elsewhere and these are just shims, or a line/symbol count is wrong by an order of magnitude. Extracting on a false premise produces a broken or pointless split. A cluster being HARD to disentangle is NOT a false premise — that is a plan input (the Execution Strategist scripts it). If the premise checks out, vote approve/concerns and state which symbols + lines you confirmed move cleanly.`,
    },
    {
      role: 'Contract Guardian',
      hardVeto: true,
      brief: `${TARGET} is imported by other src modules and pinned by test seams. ${CONTRACT_CENSUS}
Determine whether the extraction can preserve EVERY externally observable contract: every name currently importable from ${SHIM_MODULE} must STAY importable from ${SHIM_MODULE} (via a re-export shim), every \`patch("${SHIM_MODULE}.X")\` must keep resolving to the SAME object the live code uses (so test seams still bite), CLI surface, wire formats, persisted schemas, and error contracts unchanged. A decomposition reshapes file layout BEHIND those unchanged import paths. Cast a HARD VETO ONLY if the extraction INHERENTLY cannot preserve a contract by any path (extremely rare for a pure move — almost always a shim fixes it). If a naive move would break \`patch("${SHIM_MODULE}.X")\` resolution (the classic trap: code moves but the patch target must still point at the object the moved code actually calls), do NOT veto — instead enumerate the exact shim re-exports AND the patch-target invariants required, and vote concerns. Difficulty of preserving the seam is a plan input, not a veto.
SECOND, audit for SOURCE-TEXT GUARD tests — a distinct failure class a re-export shim CANNOT fix. Some tests read ${TARGET} as a STRING and assert on its literal contents (e.g. \`source = Path(".../${TARGET.split('/').pop()}").read_text(); assert "def some_symbol" in source\`). grep dev/tests for tests that open/read the target path or parametrize on it (search: the file's basename, \`read_text\`, \`.py").read\`, \`ast.parse\`, the bare symbol names as quoted strings). For EVERY moved symbol, check whether any test asserts that symbol's def/call appears in ${TARGET}'s text — moving it makes that assertion FALSE no matter what shim you add. This is NOT an inherent contract break (do not hard-veto): the fix is to UPDATE the guard test to point at the new module (or assert the shim line is present). List each such guard in required_safeguards as "source-text-guard: <test node id> — repoint to <new module>" and vote concerns. A missed source-text guard is the #1 silent red for this loop.`,
    },
    {
      role: 'Blast-Radius Engineer',
      hardVeto: false,
      brief: `Assess scope HONESTLY (find passes routinely under-count) and TURN IT INTO A PLAN — never a veto. Count, across src/ AND dev/tests/: \`from ${SHIM_MODULE} import <sym>\` sites, \`patch("${SHIM_MODULE}.<sym>")\` / monkeypatch sites, and internal references within ${TARGET} between the extracted cluster and the code that stays (these become the cross-module imports or lazy-import seams after the move). A large radius is fine; make it safe: put every old import path that must keep resolving into required_safeguards as "shim: ${SHIM_MODULE}.<name>", and if the cluster is too tangled to move in one round, give a DECOMPOSITION into ordered sub-steps as "stage N: <bounded sub-cluster that moves cleanly on its own>". The loop re-finds after each commit, so a big carve-out lands one cohesive leaf per round. Only vote veto if the radius reflects a FALSE PREMISE or an inherent contract break (defer to those lenses); otherwise approve (clean plan) or concerns (plan + caveats). Do NOT veto for size/difficulty.`,
    },
    {
      role: 'Test-Net Architect',
      hardVeto: false,
      brief: `Make the extraction CATCHABLE. The classic trap: a name moves, its \`patch("${SHIM_MODULE}.X")\` test seam silently stops biting (now patches a dead shim, not the object the live code calls), and tests pass GREEN while behaviour drifted. Require, in required_safeguards: (a) for every heavily-patched symbol in the cluster, a CHARACTERIZATION assertion that \`patch("${SHIM_MODULE}.<sym>")\` STILL intercepts the live call path after the move (the import-binding-rename regression class from package-reorg-traps.md), and (b) the dev/tests dirs that must stay green (the validation scope): ${VAL_DIRS_STR}. If a symbol's behaviour is hard to pin, prescribe HOW to net it (golden-master against the existing interface BEFORE moving, deterministic seams, fake clocks/loops). Vote veto ONLY if NO net can exist even in principle (extremely rare); otherwise approve/concerns with the net spelled out.`,
    },
    {
      role: 'Decomposition Steward',
      hardVeto: false,
      brief: `You are the DIRECTION arbiter for GOD-FILE DECOMPOSITION. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md for vocabulary, but apply this loop's goal: ${TARGET} is a large god-file (~${FILE_LINES} lines) and the win is LOCALITY + NAVIGABILITY — concentrating one concern in one focused module under ${DEST_PKG} so a maintainer reads one place instead of scrolling a huge file. UNLIKE the deepening loop, a pure ORGANISATION move that improves locality IS a valid direction here even if it adds no new leverage at a smaller interface. Apply a navigability-aware deletion test: after the move, is the concept MORE local (one cohesive module) or did you just scatter it across more files you must now bounce between? Vote veto ONLY for genuine WRONG DIRECTION: (a) the move increases bouncing (splits a tight cluster across many files, or pulls out a fragment that still requires constant cross-reference to what stays), or (b) it fabricates a speculative port/seam with only one adapter (indirection, not locality — the two-adapter rule from DEEPENING.md still holds). A cohesive cluster moving to a focused module behind unchanged ${SHIM_MODULE} shims = APPROVE. Difficulty/size are NOT your concern. Also weigh PLACEMENT: the extracted module should land in a convention-correct home (an existing/justified subpackage under ${DEST_PKG}), not as yet another loose flat sibling in an already-large directory. Vote approve/concerns/veto with rationale naming the locality gain.${CONV}`,
    },
    {
      role: 'Execution Strategist',
      hardVeto: false,
      brief: `Decide HOW to land it — there is ALWAYS a how; never veto for "too hard/too big". ${TARGET} is ~${FILE_LINES} lines: hand-retyping or hand-moving symbols out of it is the #1 source of silent breakage — STRONGLY PREFER scripted/AST transformation. Inspect the real file (note line counts). Prescribe the mechanism in required_safeguards as "execution: <method> — <step>":
- Extracting a symbol cluster: a scripted/AST codemod (Python ast/libcst, or a throwaway /tmp transform run via \`uv run python\` and DELETED before commit) that (1) slices the named defs byte-for-byte out of ${TARGET} into the new ${DEST_PKG}/<module>.py, (2) writes a re-export shim block back in ${TARGET} (\`from ${ctx.DEST_PKG_DOTTED}.<module> import <names>\`) so ${SHIM_MODULE}.<name> still resolves, and (3) rewrites any in-file references + cross-module imports. NEVER hand-retype the slice.
- Wide mechanical edits (rename across N sites): scripted, not file-by-file.
- A cluster too tangled for one round: do NOT reject — recommend execution_method:"staged" and split into ordered single-round leaves (coordinate with the Blast-Radius Engineer's stages).
- A tiny, localized move (a few short helpers): manual is acceptable but a codemod is still safer.
Recommend execution_method (programmatic / hybrid / staged / manual) + a concrete step list. Vote approve/concerns (never veto for difficulty).`,
    },
  ]
}

// ---------- Schemas ----------
const SETUP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'detail'],
  properties: {
    ok: { type: 'boolean' },
    started_clean: { type: 'boolean', description: 'true if the tree was already clean (no baseline commit needed)' },
    baseline_commit: { type: 'string', description: 'short hash of the baseline commit if one was made, else empty' },
    branch: { type: 'string' },
    env_ready: { type: 'boolean', description: 'true if `uv sync` succeeded and the verification commands are runnable' },
    baseline_red_tests: { type: 'array', items: { type: 'string' }, description: 'pre-existing keep-set failures (oracle seed)' },
    baseline_untracked: { type: 'array', items: { type: 'string' }, description: 'CRITICAL: every pre-existing untracked path (git ls-files --others --directory). NEVER deleted; git clean is banned.' },
    detail: { type: 'string' },
  },
}

const DISCOVER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['files'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['path', 'lines'],
        properties: {
          path: { type: 'string', description: 'repo-relative path to a .py source file' },
          lines: { type: 'number', description: 'wc -l line count of that file' },
        },
      },
    },
    detail: { type: 'string' },
  },
}

// Live import/patch contract census for one file's shim module — replaces the old hardcoded counts.
const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['total_patch_sites', 'total_import_sites'],
  properties: {
    total_patch_sites: { type: 'number', description: 'count of patch("<shim>.X") / monkeypatch sites across dev/tests and src' },
    total_import_sites: { type: 'number', description: 'count of `from <shim> import X` / `<shim>.X` reference sites across dev/tests and src' },
    src_importers: { type: 'number', description: 'rough count of distinct src/ modules that import this file' },
    top_symbols: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['name', 'count'],
        properties: { name: { type: 'string' }, count: { type: 'number' } },
      },
      description: 'the most-referenced/most-patched symbols of this file, with their site counts',
    },
    detail: { type: 'string' },
  },
}

const FIND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'symbols', 'line_range', 'dest_module', 'problem', 'solution', 'strength', 'deletion_test'],
        properties: {
          title: { type: 'string', description: 'short name for the extraction (the concern being made local)' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'exact top-level def/class names (or method names) that move out of the target' },
          line_range: { type: 'string', description: 'approximate current line range in the target file, e.g. "1670-2010"' },
          dest_module: { type: 'string', description: 'proposed destination module path under the file\'s dest package — convention-correct per the CONVENTIONS block (an existing/justified subpackage), NOT a loose flat sibling' },
          placement_rationale: { type: 'string', description: 'why dest_module is the convention-correct home for this concern (cite the CONVENTIONS block / a sibling subpackage); avoid flat-sibling path bloat in an already-large directory' },
          problem: { type: 'string', description: 'why this concern is hard to navigate while embedded in the god-file' },
          solution: { type: 'string', description: 'plain-English description of the extraction + the shim left behind' },
          benefits: { type: 'string', description: 'in terms of locality/navigability (and leverage if any), and how tests improve' },
          strength: { type: 'string', enum: ['Strong', 'Worth exploring', 'Speculative'] },
          deletion_test: { type: 'string', description: 'navigability deletion test: after the move is the concept MORE local (one module) or just scattered?' },
          cohesion_note: { type: 'string', description: 'why the cluster is self-contained — what (if anything) ties it back to code that stays, and how the seam handles that' },
          est_blast_radius: { type: 'number', description: 'rough count of import + patch() sites across src/ and dev/tests/ that reference these symbols' },
          patched_symbols: { type: 'array', items: { type: 'string' }, description: 'subset of symbols that appear in patch("<shim>.X") test sites — these need shim + seam care' },
        },
      },
    },
  },
}

// DEEPEN candidates (ported from recursive-improve-architecture's FIND_SCHEMA): cross-file
// architectural deepenings (shallow modules, leaky seams) rather than line-range carve-outs.
const FIND_SCHEMA_DEEPEN = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'files', 'problem', 'solution', 'strength', 'dependency_category', 'deletion_test'],
        properties: {
          title: { type: 'string', description: 'short name for the deepening, using LANGUAGE.md vocabulary (module/interface/seam/adapter)' },
          files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths the refactor touches' },
          problem: { type: 'string', description: 'why the current architecture is shallow / leaks across its seam' },
          solution: { type: 'string', description: 'plain-English description of the deepening' },
          benefits: { type: 'string', description: 'in terms of locality and leverage, and how tests improve' },
          strength: { type: 'string', enum: ['Strong', 'Worth exploring', 'Speculative'] },
          dependency_category: { type: 'string', enum: ['in-process', 'local-substitutable', 'remote-owned', 'true-external'], description: 'from DEEPENING.md — determines how the deepened module is tested' },
          deletion_test: { type: 'string', description: 'result of the deletion test: does complexity concentrate (earning its keep) or just move (pass-through)?' },
          est_blast_radius: { type: 'number', description: 'rough count of call sites / files affected' },
          placement_rationale: { type: 'string', description: 'if the deepening creates a NEW module, why its path is convention-correct per the CONVENTIONS block (an existing/justified subpackage, not a loose sibling)' },
        },
      },
    },
  },
}

// The dynamic lane planner's output: a fresh, non-overlapping partition of the LIVE file into
// concern lanes, biased to where the line mass actually sits this round.
const LANE_PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['lanes'],
  properties: {
    file_lines: { type: 'number', description: 'total current line count of the target file you actually read' },
    structure_note: { type: 'string', description: 'one short paragraph: where the line mass lives NOW (largest remaining clusters) and which regions are already thin shims' },
    lanes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'concern', 'line_range', 'symbols', 'est_lines'],
        properties: {
          key: { type: 'string', description: 'short kebab-case slug naming the concern, unique within this plan' },
          concern: { type: 'string', description: 'the cohesive concern a find agent should hunt an extraction within (1-2 sentences)' },
          line_range: { type: 'string', description: 'current line range this lane OWNS, e.g. "1820-2240". Lanes MUST NOT overlap each other.' },
          symbols: { type: 'array', items: { type: 'string' }, description: 'representative def/class/method names actually present in that range right now' },
          est_lines: { type: 'number', description: 'approx live (non-shim) lines this lane covers — drives largest-first attention' },
          giant: { type: 'boolean', description: 'true if this lane is a single very large method/cluster (e.g. a run loop) that one agent should slice on its own' },
        },
      },
    },
  },
}

const PANELIST_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['role', 'vote', 'rationale'],
  properties: {
    role: { type: 'string' },
    vote: { type: 'string', enum: ['approve', 'concerns', 'veto'] },
    hard_veto: { type: 'boolean', description: 'true only for a NON-NEGOTIABLE blocker (false premise, or an inherent contract break a shim cannot fix) — overrides any majority' },
    confidence: { type: 'number', description: '0..1 after reading the actual file' },
    rationale: { type: 'string' },
    required_safeguards: { type: 'array', items: { type: 'string' }, description: 'concrete preconditions (e.g. "shim: <shim>.X", "characterization: patch(\\"<shim>.X\\") still bites after move", "execution: libcst codemod slices lines 1670-2010")' },
    behavior_invariants: { type: 'array', items: { type: 'string' }, description: 'observable behaviours / importable names that MUST stay identical' },
  },
}

const CHAIR_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['decision', 'rationale'],
  properties: {
    decision: { type: 'string', enum: ['implement', 'reject'] },
    tally: { type: 'string' },
    rationale: { type: 'string' },
    dissent: { type: 'string', description: 'strongest argument AGAINST the decision, preserved even when overruled' },
    mandate: {
      type: 'object', additionalProperties: false,
      properties: {
        dest_module: { type: 'string', description: 'final destination module path the implementer must create — convention-correct per the CONVENTIONS block (prefer an existing/justified subpackage over a loose flat sibling in an already-large directory)' },
        dest_placement_rationale: { type: 'string', description: 'why dest_module is the convention-correct home (cite the CONVENTIONS block / target subpackage)' },
        new_subpackage_init: { type: 'boolean', description: 'true if dest_module needs a NEW subpackage __init__.py created (the implementer must create it so the package is importable)' },
        validation_dirs: { type: 'array', items: { type: 'string' }, description: 'full dev/tests/<sub> dirs that must stay green for this change (used by the deepen stage; decompose derives scope from moved symbols)' },
        shims_required: { type: 'array', items: { type: 'string' }, description: 'every <shim>.<name> that must keep resolving via a re-export shim' },
        characterization_tests_required: { type: 'array', items: { type: 'string' }, description: 'golden-master / patch-still-bites tests to write + commit BEFORE moving' },
        behavior_invariants: { type: 'array', items: { type: 'string' } },
        execution_method: { type: 'string', enum: ['programmatic', 'hybrid', 'staged', 'manual'], description: '"programmatic"/AST codemod is the default for slicing symbols out of the god-file; "manual" only for a few short helpers; "staged" when the cluster is too tangled for one round.' },
        execution_plan: { type: 'array', items: { type: 'string' }, description: 'ordered concrete steps naming the exact mechanism (ast/libcst slice, shim block write-back, import rewrite)' },
        this_round_scope: { type: 'string', description: 'when staged, the SINGLE bounded sub-cluster to move THIS round' },
        deferred_stages: { type: 'array', items: { type: 'string' }, description: 'when staged, the remaining ordered sub-clusters NOT done this round' },
      },
    },
  },
}

const IMPLEMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'detail'],
  properties: {
    ok: { type: 'boolean' },
    files_touched: { type: 'array', items: { type: 'string' } },
    new_module: { type: 'string', description: 'the module created by the extraction' },
    shims_written: { type: 'array', items: { type: 'string' }, description: 'the <shim>.<name> re-exports written back into the target' },
    tests_changed: { type: 'array', items: { type: 'string' } },
    target_lines_after: { type: 'number', description: 'line count of the target file after the extraction (should shrink)' },
    detail: { type: 'string' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['passed', 'detail'],
  properties: {
    passed: { type: 'boolean', description: 'true ONLY if import smoke + pytest + lint all pass with NO new failures vs the per-round oracle' },
    import_smoke_ok: { type: 'boolean' },
    pytest_ok: { type: 'boolean' },
    lint_ok: { type: 'boolean' },
    new_failures: { type: 'array', items: { type: 'string' }, description: 'failing tests NOT in the oracle — regressions from this round' },
    detail: { type: 'string' },
  },
}

const COMMIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'detail'],
  properties: {
    ok: { type: 'boolean' },
    commit: { type: 'string' },
    files_changed: { type: 'number' },
    detail: { type: 'string' },
  },
}

const ORACLE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['red_tests'],
  properties: {
    red_tests: { type: 'array', items: { type: 'string' }, description: 'every failing/erroring test node id on the clean tree across the validation dirs' },
    base_sha: { type: 'string', description: 'short HEAD hash of the round base commit (git rev-parse --short HEAD) — the revert-on-red path resets back to this, undoing any mid-round commit' },
    collected: { type: 'number' },
    detail: { type: 'string' },
  },
}

const REVERT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'clean'],
  properties: { ok: { type: 'boolean' }, clean: { type: 'boolean' }, detail: { type: 'string' } },
}

// Per-file worktree bring-up: create an isolated checkout on a child branch with its OWN uv env.
const WORKTREE_SETUP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'env_ready'],
  properties: {
    ok: { type: 'boolean', description: 'true if the worktree exists on the child branch and is usable' },
    env_ready: { type: 'boolean', description: 'true if the worktree got its OWN .venv whose editable .pth points at the WORKTREE src (not ROOT src)' },
    worktree_path: { type: 'string' },
    branch: { type: 'string' },
    protected_untracked: { type: 'array', items: { type: 'string' }, description: 'the worktree\'s own untracked paths (git ls-files --others --directory) — off-limits to revert' },
    detail: { type: 'string' },
  },
}

// Serialized merge-back of a converged file's child branch onto the base BRANCH.
const MERGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['merged'],
  properties: {
    merged: { type: 'boolean', description: 'true if the child branch merged cleanly into BRANCH; false if there was a conflict (the merge was aborted, BRANCH left untouched)' },
    conflicts: { type: 'array', items: { type: 'string' }, description: 'conflicting paths if merged:false' },
    merge_commit: { type: 'string', description: 'short hash of the --no-ff merge commit when merged:true' },
    detail: { type: 'string' },
  },
}

// Per-round TARGETED test scope: the minimal subset of dev/tests that exercises the moved symbols.
// confident:false => the symbol is too pervasive to scope safely; the loop runs the full sweep.
const SCOPE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['confident', 'test_paths', 'detail'],
  properties: {
    confident: { type: 'boolean', description: 'true ONLY if a targeted subset safely covers every site that exercises the moved symbols; false if a moved symbol is pervasive (referenced across many dev/tests subdirs / 40+ files) or hit indirectly by integration tests that do not name it — then the loop runs the FULL suite' },
    test_paths: { type: 'array', items: { type: 'string' }, description: 'minimal deduped list of test files (preferred) or dirs under dev/tests/ (repo-relative) that reference the moved symbols / patch <shim>.<sym> / import the dest module / read the target as source text. Only meaningful when confident:true.' },
    lint_paths: { type: 'array', items: { type: 'string' }, description: 'source files the extraction will touch and should be linted (at least the target + dest module)' },
    site_counts: { type: 'string', description: 'short tally of what was grepped, e.g. "build_welcome_banner: 11 sites in 7 files"' },
    detail: { type: 'string' },
  },
}

const candKey = (c) => (c.title + '|' + (c.symbols || []).slice().sort().join(',')).toLowerCase()

// How many lines this extraction carves OUT of the god-file (span of its line_range). The size
// signal the loop ranks on: largest-first, so the biggest concerns leave the file earliest.
const candSpan = (c) => {
  const m = String(c.line_range || '').match(/(\d+)\s*[-–]\s*(\d+)/)
  if (m) { const lo = +m[1], hi = +m[2]; if (hi >= lo) return hi - lo + 1 }
  return (c.symbols || []).length
}

// Dedup a list of pytest targets and drop any file nested under an included dir.
const normalizePaths = (paths) => {
  const uniq = Array.from(new Set((paths || []).filter(Boolean).map(p => p.replace(/\/+$/, ''))))
  const dirs = uniq.filter(p => !p.endsWith('.py'))
  return uniq.filter(p => !p.endsWith('.py') || !dirs.some(d => p.startsWith(d + '/')))
}

// Parse a candidate's line_range into [lo,hi]; null if unparseable. Two candidates "overlap" when
// their ranges touch (or either is unknown — treat unknown as overlapping, i.e. don't co-batch it).
const rangeOf = (c) => { const m = String(c.line_range || '').match(/(\d+)\s*[-–]\s*(\d+)/); return m ? [+m[1], +m[2]] : null }
const overlaps = (a, b) => { const ra = rangeOf(a), rb = rangeOf(b); if (!ra || !rb) return true; return ra[0] <= rb[1] && rb[0] <= ra[1] }
// The batch slate for a round: a GIANT (>= GIANT_LINES) lands SOLO; otherwise greedily take up to
// BATCH_MAX mutually line-DISJOINT non-giant carve-outs.
const selectBatch = (ranked) => {
  if (!ranked.length) return []
  if (candSpan(ranked[0]) >= GIANT_LINES) return [ranked[0]]
  const picked = [ranked[0]]
  for (const c of ranked.slice(1)) {
    if (picked.length >= BATCH_MAX) break
    if (candSpan(c) >= GIANT_LINES) continue          // a giant must go solo, not folded into a batch
    if (picked.some(p => overlaps(p, c))) continue     // keep the batch line-disjoint
    picked.push(c)
  }
  return picked
}

// ---- DEEPEN-stage selection helpers (ported from recursive-improve-architecture) ----
// Deepen candidates are CROSS-FILE (files[]), not line-range carve-outs, so they dedup and batch
// by their touched-file footprint rather than by symbols/line ranges.
const candKeyFiles = (c) => (c.title + '|' + (c.files || []).slice().sort().join(',')).toLowerCase()
const normFiles = (c) => (c.files || []).map(f => String(f).replace(ROOT + '/', '').replace(/^\/+/, ''))
// Greedily pick a FILE-DISJOINT batch (no two share a touched file) up to `cap`, taking approved
// candidates in order (smallest blast radius first). A candidate with no declared files can't be
// proven disjoint, so it only goes in a batch of one.
function pickDisjointBatch(approved, cap) {
  const batch = []
  const claimed = new Set()
  for (const a of approved) {
    const files = normFiles(a.cand)
    if (!files.length) { if (batch.length === 0) { batch.push(a); break } else continue }
    if (files.some(f => claimed.has(f))) continue
    batch.push(a)
    files.forEach(f => claimed.add(f))
    if (batch.length >= cap) break
  }
  return batch
}
// Given the files a deepen candidate touches, resolve the union of test dirs to run (keep-set always).
const testDirsForFiles = (files) => {
  const dirs = new Set(KEEP_SET)
  for (const f of (files || [])) {
    const m = /(?:^|\/)src\/([^/]+)\//.exec(f) || /^([^/]+)\//.exec(f)
    const sub = m && m[1]
    for (const d of (TEST_DIRS_FOR[sub] || [])) dirs.add(d)
  }
  return Array.from(dirs)
}

// Build the human-readable contract census string the panel briefs interpolate.
const censusString = (c, shimModule) => {
  if (!c) return `Contract census for ${shimModule}: (unavailable — grep the import/patch sites yourself before voting).`
  const top = (c.top_symbols || []).map(s => `${s.name} ×${s.count}`).join(', ')
  return `Contract census for ${shimModule} (computed live this run): ~${c.total_patch_sites || 0} \`patch("${shimModule}.X")\`/monkeypatch site(s) and ~${c.total_import_sites || 0} \`from ${shimModule} import X\` / \`${shimModule}.X\` reference site(s) across dev/tests and src; ~${c.src_importers || 0} src module(s) import it. Most-referenced symbols: ${top || '(none surfaced)'}. EVERY name importable from ${shimModule} must STAY importable from it (via a re-export shim), and every \`patch("${shimModule}.X")\` must keep resolving to the live object the moved code calls.`
}

// ================= Phase: Setup (once for the whole sweep) =================
phase('Setup')
log('Repo decomposition sweep starting on ' + ROOT + ' (branch=' + BRANCH + ', discover>' + DISCOVER_LINES + ' lines, per-file target<=' + TARGET_LINES + ', max ' + MAX_FILES + ' file(s), ' + MAX_ITERS + ' round(s)/file' + (SINGLE_TARGET ? ', SINGLE-FILE mode: ' + SINGLE_TARGET : '') + (SKIP_SETUP ? ', FAST SETUP (skip env sync + baseline oracle)' : '') + ')')

// ---- DETECT: derive repo-appropriate defaults for the values the caller did not pin ----
// The engine was born tuned to one repo; a general Python project has a different src root, package
// set, test root, extras, and linter. A single read-only agent reads pyproject.toml + the source
// layout (+ repo_scan.py when bundled) and returns a config; each field fills the matching `let`
// ONLY when the caller passed no explicit arg (HAS()). Explicit args always win. Best-effort: if
// detection fails, the original hardcoded fallbacks stand and the loop proceeds.
const DETECT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    src_root: { type: 'string', description: 'the source root dir, repo-relative (e.g. "src", or "." for a flat layout)' },
    packages: { type: 'array', items: { type: 'string' }, description: 'top-level importable package names under src_root (dirs with __init__.py)' },
    base_imports: { type: 'string', description: 'comma-separated importable modules for a package-wide import smoke — one stable entry per top-level package (e.g. "pkg_a, pkg_b.cli")' },
    test_root: { type: 'string', description: 'where the test suite lives, repo-relative (pyproject [tool.pytest.ini_options] testpaths if set, else "tests"/"test"/"dev/tests" by dir presence)' },
    keep_set: { type: 'array', items: { type: 'string' }, description: 'a SMALL fast subset of test dirs (2-4) for the baseline oracle; [test_root] is fine if there are no sub-suites' },
    env_setup: { type: 'string', description: 'the command that builds the CI-faithful env — "uv sync" (+ any REAL extras this project declares, e.g. --extra dev) when uv.lock/pyproject present; else "" if none inferable' },
    lint_cmd: { type: 'string', description: 'whole-repo lint command if a linter is configured (ruff -> "uvx ruff check ."), else "" if no linter is configured' },
    test_dirs_for: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['package', 'test_dirs'],
        properties: { package: { type: 'string' }, test_dirs: { type: 'array', items: { type: 'string' } } },
      },
      description: 'per-package test dirs that must stay green when that package is touched — the src/<pkg> <-> <test_root>/<pkg> mirror',
    },
    detail: { type: 'string' },
  },
}
const det = await agent(
  `Read-only — make NO edits. Detect the build/test configuration of the Python repo at ${ROOT} so an automated refactor loop uses repo-appropriate defaults. Run commands from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

Gather:
1. Read pyproject.toml (and setup.cfg/setup.py if present): the build system, packages / package-dir (src layout?), optional-dependency groups (extras), and [tool.pytest.ini_options] testpaths. Note whether uv is used (uv.lock present).
2. List the source layout: \`ls -1 ${ROOT}\` and, if a src/ dir exists, \`ls -1 ${ROOT}/src\`; identify the SRC ROOT (the dir that holds the top-level importable packages — "src" if a src-layout, else "." for a flat top-level package) and the top-level PACKAGES under it (subdirs containing __init__.py).
3. Identify the TEST ROOT: testpaths from pyproject if set; else the first present of tests/, test/, dev/tests/.
4. Detect the linter: ruff if a [tool.ruff] table or ruff config exists.
${SCAN_SCRIPT ? '5. You MAY run `python3 ' + SCAN_SCRIPT + ' . --large-cap 5000` for a structured view of the tree (stdlib-only, no env needed).\n' : ''}
Return:
- src_root, packages (top-level importable package names).
- base_imports: ONE stable importable module per package (prefer the package itself, e.g. "pkg" or "pkg.__init__" -> just "pkg"; if the bare package import is heavy, a light submodule is fine). Comma-separated. These must ALL import cleanly on the current tree — when unsure, pick the safest (the bare package name).
- test_root, and keep_set (a small 2-4 dir fast subset under test_root; use [test_root] if there are no sub-suites).
- env_setup: the env-build command. If uv is used: "uv sync" plus ONLY extras this project actually declares that are needed for tests (e.g. "uv sync --extra dev"); do NOT invent "--extra all" unless such an extra exists. If no uv, return "".
- lint_cmd: "uvx ruff check ." if ruff is configured, else "".
- test_dirs_for: for each package, the test dirs that exercise it (the <test_root>/<package> mirror when it exists; else []).
Set ok:true if you produced a usable config; ok:false + detail if the repo is not a recognizable Python project. Do NOT edit anything.`,
  { label: 'detect-config', phase: 'Setup', agentType: 'Explore', schema: DETECT_SCHEMA, model: M_COORD }
)
if (det && det.ok) {
  if (!HAS('scanRoots') && det.src_root) SCAN_ROOTS = [det.src_root.replace(/\/+$/, '')]
  if (!HAS('testRoot') && det.test_root) TEST_ROOT = det.test_root.replace(/\/+$/, '')
  if (!HAS('baseImports') && det.base_imports && det.base_imports.trim()) BASE_IMPORTS = det.base_imports.trim()
  if (!HAS('keepSet') && Array.isArray(det.keep_set) && det.keep_set.length) KEEP_SET = det.keep_set
  if (!HAS('envSetup') && typeof det.env_setup === 'string' && det.env_setup.trim()) ENV_SETUP = det.env_setup.trim()
  if (!HAS('lintCmd') && typeof det.lint_cmd === 'string') {
    LINT = det.lint_cmd.trim() || 'true'                    // '' => no linter => whole-repo lint no-op
    if (!HAS('lintPerFile')) LINT_PER_FILE_PREFIX = /ruff/.test(det.lint_cmd) ? 'uvx ruff check' : (det.lint_cmd.trim() ? det.lint_cmd.replace(/\s+\.$/, '').trim() : '')
  }
  if (!HAS('testDirsFor') && Array.isArray(det.test_dirs_for) && det.test_dirs_for.length) {
    const m = {}
    for (const e of det.test_dirs_for) { if (e && e.package && Array.isArray(e.test_dirs) && e.test_dirs.length) m[e.package] = e.test_dirs }
    if (Object.keys(m).length) TEST_DIRS_FOR = m
  }
  recomputeDerived()
  log('Detect: src=' + JSON.stringify(SCAN_ROOTS) + ', tests=' + TEST_ROOT + ', keep=' + JSON.stringify(KEEP_SET) + ', env=' + (ENV_SETUP ? '"' + ENV_SETUP.slice(0, 40) + '"' : '(none)') + ', lint=' + (LINT_PER_FILE_PREFIX || 'none') + ', base_imports=' + BASE_IMPORTS.split(',').length + ' module(s)')
} else {
  log('Detect: no usable config (' + ((det && det.detail) || 'agent produced no result') + ') — using the hardcoded fallbacks / explicit args.')
}

const SETUP_PROMPT = SKIP_SETUP
  ? `FAST SETUP for an automated god-file decomposition loop on the repo at ${ROOT}. A previous run already synced the env and captured the test oracle, so SKIP \`uv sync\` and SKIP the baseline pytest — but you MUST still do the cheap, load-bearing safety steps below. Anchor every git command with git -C "${ROOT}" (your cwd is NOT the repo).

Do, in order:
1. Confirm a git work tree: git -C "${ROOT}" rev-parse --is-inside-work-tree. If not, return ok:false.
2. Ensure we are on the working branch ${BRANCH}: git -C "${ROOT}" checkout -b "${BRANCH}" (if it already exists, git -C "${ROOT}" checkout "${BRANCH}"). Report it in branch.
3. Check cleanliness: git -C "${ROOT}" status --porcelain.
   - If ALREADY clean: started_clean:true, baseline_commit:"".
   - If dirty (e.g. a prior run was stopped mid-extraction): make ONE baseline commit:
       git -C "${ROOT}" add -A
       git -C "${ROOT}" commit -m "chore(decompose-repo): baseline before god-file decomposition sweep

Captures pre-existing working-tree state so each extraction round starts from a clean tree. Safe to drop later.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
     Then started_clean:false and the new short hash in baseline_commit.
4. Re-verify clean (git -C "${ROOT}" status --porcelain prints nothing).
5. CRITICAL — capture the PROTECTED UNTRACKED SET (this repo legitimately carries untracked dirs a blanket clean would destroy, e.g. .venv/, node_modules/, archive/, build/): git -C "${ROOT}" ls-files --others --directory — put every line into baseline_untracked. Off-limits to all later revert/cleanup. Do NOT skip this even in fast setup.

Set env_ready:true (assumed from a prior run — do NOT run uv sync) and baseline_red_tests:[] (skipped; each round captures its own targeted oracle). NEVER delete files. NEVER run \`git clean\`. NEVER push. Report branch + clean/commit + untracked state in detail.`
  : `You are preparing the repo at ${ROOT} for an AUTOMATED, multi-round loop that sweeps the Python source tree for oversized god-files and decomposes each into focused modules, driven by the improve-codebase-architecture skill at ${SKILL_DIR}. The loop extracts ONE cohesive cluster per round and commits after each, so it needs (a) a clean committed baseline on a dedicated branch and (b) a runnable, CI-faithful verification environment plus a baseline test oracle. Anchor every git command with git -C "${ROOT}" (your cwd is NOT the repo).

Do, in order:
1. Confirm a git work tree: git -C "${ROOT}" rev-parse --is-inside-work-tree. If not, return ok:false.
2. Ensure we are on the working branch ${BRANCH}: git -C "${ROOT}" checkout -b "${BRANCH}" (if it already exists, git -C "${ROOT}" checkout "${BRANCH}"). Report it in branch.
3. Check cleanliness: git -C "${ROOT}" status --porcelain.
   - If ALREADY clean: started_clean:true, baseline_commit:"".
   - If dirty: make ONE baseline commit:
       git -C "${ROOT}" add -A
       git -C "${ROOT}" commit -m "chore(decompose-repo): baseline before god-file decomposition sweep

Captures pre-existing working-tree state so each extraction round starts from a clean tree. Safe to drop later.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
     Then started_clean:false and the new short hash in baseline_commit.
4. Re-verify clean (git -C "${ROOT}" status --porcelain prints nothing).
5. Set up the CI-faithful env (a bare python/pytest on PATH is NOT acceptable). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`):
       ${ENV_SETUP}
   If uv is missing or sync fails, env_ready:false + explain (still return ok:true if git steps succeeded — the loop aborts cleanly at the first validation).
6. Capture the BASELINE TEST ORACLE (keep-set already-red tests): cd "${ROOT}" && ${PYTEST_FAST} — record every failing node id into baseline_red_tests (empty = fully green).
7. CRITICAL — capture the PROTECTED UNTRACKED SET (this repo legitimately carries untracked dirs a blanket clean would destroy): git -C "${ROOT}" ls-files --others --directory — put every line into baseline_untracked. Off-limits to all later revert/cleanup.

NEVER delete files. NEVER run \`git clean\`. NEVER push. Report what you committed and env/oracle/untracked state in detail.`

const setup = await agent(SETUP_PROMPT, { label: SKIP_SETUP ? 'fast-setup' : 'setup-baseline', phase: 'Setup', schema: SETUP_SCHEMA, model: M_COORD })

if (!setup || !setup.ok) {
  return { aborted: 'Setup', reason: setup ? setup.detail : 'setup produced no result' }
}
const BASELINE_RED = (setup.baseline_red_tests || [])
const PROTECTED_UNTRACKED = (setup.baseline_untracked || [])
log('Setup ok on ' + (setup.branch || BRANCH) + (setup.started_clean ? ' (already clean)' : ' (baseline ' + setup.baseline_commit + ')') + ' — env_ready=' + setup.env_ready + ', baseline red=' + BASELINE_RED.length + ', protected untracked=' + PROTECTED_UNTRACKED.length)

if (!setup.env_ready) {
  log('WARNING: verification env not ready (' + setup.detail + '). The loop will abort at the first validation gate rather than implement blind.')
}

// ---- IMPORT-SMOKE BASELINE ORACLE (Fix #1) ----
// Unlike pytest (which subtracts a pre-existing-red oracle), the per-round import smoke must pass
// ABSOLUTELY: any module in BASE_IMPORTS that is already un-importable on the CLEAN tree — or that the
// DETECT step guessed wrong — would fail EVERY round's smoke and revert EVERY extraction, so the sweep
// could never commit. So: on the clean tree, test each BASE_IMPORTS module individually and DROP the
// ones already broken at baseline (logged). Import smoke then only asserts modules importable before we
// touched anything — a true regression gate. Runs only when the env is ready (else smoke can't run at all).
if (setup.env_ready && BASE_IMPORTS.trim()) {
  const IMPORT_ORACLE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['importable'],
    properties: {
      importable: { type: 'array', items: { type: 'string' }, description: 'BASE_IMPORTS modules that imported cleanly on the clean tree' },
      broken: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['module'], properties: { module: { type: 'string' }, error: { type: 'string' } } },
        description: 'modules that FAILED to import on the clean tree (pre-existing breakage — excluded from the smoke set)',
      },
      detail: { type: 'string' },
    },
  }
  const baseMods = BASE_IMPORTS.split(',').map(s => s.trim()).filter(Boolean)
  const impOracle = await agent(
    `Read-only — make NO edits. On the CLEAN committed tree at ${ROOT}, determine which of these top-level modules import cleanly through the project's env, so an automated refactor loop's import-smoke gate only asserts modules that were importable BEFORE any change. Test EACH module INDEPENDENTLY (a later one failing must not hide an earlier success) by running, per module, from inside the repo:
  \`bash -c 'cd "${ROOT}" && uv run python -c "import <module>"'\`
Modules to test: ${JSON.stringify(baseMods)}
Classify each into importable (exit 0) or broken (non-zero — capture a one-line error). Do NOT try to fix anything. Return importable + broken + a short detail. Do NOT edit code.`,
    { label: 'import-oracle', phase: 'Setup', schema: IMPORT_ORACLE_SCHEMA, model: M_COORD }
  )
  if (impOracle && Array.isArray(impOracle.importable)) {
    const good = impOracle.importable.map(s => String(s).trim()).filter(Boolean)
    const broken = (impOracle.broken || []).map(b => b && b.module).filter(Boolean)
    if (good.length) {
      BASE_IMPORTS = good.join(', ')
      if (broken.length) log('Import oracle: DROPPED ' + broken.length + ' pre-existing-broken module(s) from the smoke set (' + broken.slice(0, 6).join(', ') + (broken.length > 6 ? ', …' : '') + '). Smoke now asserts ' + good.length + ' baseline-importable module(s).')
      else log('Import oracle: all ' + good.length + ' baseline module(s) import cleanly.')
    } else {
      log('WARNING: import oracle found NONE of the ' + baseMods.length + ' base module(s) importable on the clean tree — leaving the smoke set as-is; extractions may red on import smoke until the env/base-imports are corrected (pass baseImports to override).')
    }
  } else {
    log('Import oracle step produced no result — leaving BASE_IMPORTS unchanged.')
  }
}

// SAFE revert instruction. `git clean` is BANNED everywhere (it has caused unrecoverable data loss
// in this repo). Restore tracked edits + delete ONLY untracked paths created DURING the round.
const PROTECTED_BLOCK = PROTECTED_UNTRACKED.length
  ? 'PROTECTED untracked paths (pre-existed at setup — NOT the loop\'s work; deleting any is unrecoverable data loss, so OFF-LIMITS):\n' + PROTECTED_UNTRACKED.map(p => '  - ' + p).join('\n')
  : 'PROTECTED untracked paths: (none recorded at setup)'

// ORPHAN-WORKTREE CLEANUP: a crashed prior concurrent run can leave stale decompose worktrees + child
// branches behind, which would collide with `git worktree add` for the same file. Prune them once up
// front (only when the decompose stage will run concurrently). Never `git clean`.
if (ISOLATE && STAGES.includes('decompose')) {
  try {
    await agent(
      `Clean up any STALE decomposition worktrees left by a crashed prior run, in the repo at ${ROOT}. Anchor with git -C "${ROOT}". Do, in order:
1. git -C "${ROOT}" worktree list --porcelain — find every worktree whose path is under ${ROOT}/${WORKTREES_SUBDIR}/ .
2. For EACH such stale worktree: git -C "${ROOT}" worktree remove --force "<path>"  (removes its dir + .venv).
3. git -C "${ROOT}" worktree prune.
4. Delete any leftover child branches: list git -C "${ROOT}" branch --list "${BRANCH}-wt-*" and for each, git -C "${ROOT}" branch -D "<branch>" (these are per-file worktree branches from crashed runs; the base ${BRANCH} itself must NOT be deleted).
NEVER run \`git clean\`. NEVER touch ${ROOT}'s tracked files or push. Report ok + detail (what you removed).`,
      { label: 'worktree-cleanup', phase: 'Setup', schema: REVERT_SCHEMA, model: M_COORD }
    )
  } catch (e) {
    log('Orphan-worktree cleanup skipped (' + ((e && e.message) ? e.message.slice(0, 80) : 'error') + ') — worktree add will fail loudly if a stale one collides.')
  }
}

const safeRevertPrompt = (intro, baseSha, ROOT, protectedBlock) =>
  `${intro} Anchor every git command with git -C "${ROOT}". Back the working tree out to the round's base commit WITHOUT destroying pre-existing untracked content.

${protectedBlock}

ROUND BASE COMMIT (the HEAD this round started from — the tree must end here): ${baseSha || '(unknown — use git -C "' + ROOT + '" rev-parse HEAD as the base and do NOT reset past it)'}

ABSOLUTE RULE: NEVER run \`git clean\` in any form. It cannot tell the loop's new files from pre-existing untracked content and has already caused unrecoverable data loss in this repo.

Do, in order:
1. git -C "${ROOT}" status --porcelain — inspect. Tracked edits: ' M'/'MM'; brand-new untracked: '??'.
2. UNDO ANY MID-ROUND COMMIT: git -C "${ROOT}" rev-parse HEAD. If it does NOT equal the round base ${baseSha || '(the SHA recorded for this round)'}, an implementer wrongly committed during the round — undo those commits WITHOUT losing their content by soft-resetting back to the base: git -C "${ROOT}" reset --soft ${baseSha || '<round base SHA>'}  (this moves HEAD back but leaves the committed changes staged in the tree, so the next steps then discard them like any other edit). NEVER use a hard reset and NEVER reset past the round base onto an EARLIER landed round. If HEAD already equals the base, skip this step.
3. Restore tracked edits (now including anything un-committed by step 2): git -C "${ROOT}" reset -q && git -C "${ROOT}" checkout -- .  (the \`reset\` unstages; \`checkout -- .\` touches only files git tracks; neither can harm untracked content).
4. For each '??' path, delete it ONLY IF it is NOT on the protected list (i.e. created during THIS round) by exact path (rm / rm -r). If a '??' path IS protected, LEAVE IT.
5. Re-verify: git -C "${ROOT}" rev-parse HEAD equals the round base ${baseSha || ''}, AND git -C "${ROOT}" status --porcelain shows only protected untracked (or nothing). Set clean:true. Do NOT reset past the round base, do NOT push. Report exactly which commits you undid and which paths you removed.`

// ================= Shared structure-verifier + org audit =================
const STRUCT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary'],
  properties: {
    summary: {
      type: 'object', additionalProperties: false,
      properties: { critical: { type: 'number' }, warning: { type: 'number' }, info: { type: 'number' } },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['severity', 'check', 'path', 'message'],
        properties: { severity: { type: 'string' }, check: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' } },
      },
    },
    detail: { type: 'string' },
  },
}

// Run the deterministic structure verifier and return its parsed JSON ({summary, findings}). The
// verifier wraps the codebase-organizer's repo_scan.py; if it is missing/errors the caller falls
// back to convention-text-only judgement (mirrors the census-failure fallback).
async function runStructVerify(extraArgs, phaseName, label, model, root) {
  const RT = root || ROOT   // run in the worktree's uv env when isolated; ROOT otherwise
  // Scope to the DETECTED source root (SCAN_ROOTS[0]) unless the caller already passed a --subtree.
  // The verifier defaults to "src"; a repo whose source root differs would otherwise scan a
  // nonexistent dir and silently report nothing. Explicit --subtree from a caller (org-audit) wins.
  const ea = String(extraArgs || '')
  const scoped = /--subtree/.test(ea) ? ea : (ea + ' --subtree ' + (String((SCAN_ROOTS && SCAN_ROOTS[0]) || 'src').replace(/\/+$/, ''))).trim()
  try {
    return await agent(
      `Read-only — make NO edits. Run the deterministic source-structure verifier on the repo at ${RT} and return its JSON verbatim. Run from inside the repo:
    bash -c 'cd "${RT}" && ${STRUCT_VERIFY_CMD}${scoped ? ' ' + scoped : ''}'
It prints a JSON object with "summary" {critical,warning,info} and a "findings" array of {severity,check,path,message}. Transcribe that JSON EXACTLY into your structured result (summary + findings). If the command errors or is missing, return summary:{critical:0,warning:0,info:0}, findings:[], and explain in detail. Do NOT edit anything.`,
      { label: label || 'struct-verify', phase: phaseName, schema: STRUCT_SCHEMA, model: model || M_COORD }
    )
  } catch (e) {
    log('Structure verifier failed (' + ((e && e.message) ? e.message.slice(0, 80) : 'error') + ') — convention-text-only fallback.')
    return null
  }
}

// ================= Phase: Conventions (once, when an engine stage runs) =================
// Build the CONVENTIONS block that org-aware placement injects into every decompose/deepen
// find/panel/chair/implement prompt, plus snapshot the structure-verifier baseline so the post-impl
// audit reports only NEW findings. Organize does not need this (it owns its own philosophy).
const NEEDS_CONV = STAGES.some(s => s === 'decompose' || s === 'deepen')
let CONVENTIONS = ''
let STRUCT_BASELINE = null
const CONV_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['conventions'],
  properties: { conventions: { type: 'string' }, detail: { type: 'string' } },
}
if (NEEDS_CONV) {
  phase('Conventions')
  log('Deriving repo organization conventions (codebase-organizer philosophy + live structure scan) for org-aware placement')
  STRUCT_BASELINE = await runStructVerify('', 'Conventions', 'struct-baseline')
  if (STRUCT_BASELINE && STRUCT_BASELINE.summary) {
    log('Structure baseline: ' + (STRUCT_BASELINE.summary.critical || 0) + ' critical, ' + (STRUCT_BASELINE.summary.warning || 0) + ' warning, ' + (STRUCT_BASELINE.summary.info || 0) + ' info (pre-existing — excluded from audit)')
  }
  if (ORG_AWARE_PLACEMENT) {
    const convRes = await agent(
      `Read-only — make NO edits. Produce a concise REPO ORGANIZATION CONVENTIONS block for the Python source tree at ${ROOT}, to guide WHERE newly-created modules should be placed during automated refactors (so they land in logically-organized subpackages, not as loose flat siblings that bloat a directory).

Sources to read and distill (do NOT copy verbatim — synthesize into <= ~30 lines):
- ${ORGANIZER_SKILL_DIR}/references/philosophy.md (the 8 organization principles — esp. "root holds intent", "no overstuffed directories ~25 files", "directories are nouns", "honor ecosystem idioms", progressive disclosure).
- ${ORGANIZER_SKILL_DIR}/references/language-layouts.md (the idiomatic Python src/<package>/ layout).
${CONVENTIONS_DOC ? '- ' + ROOT + '/' + CONVENTIONS_DOC + ' (project-specific layout notes — honor these over generic advice).\n' : ''}- The ACTUAL package layout under the source root **${SCAN_ROOTS[0]}**: list it with \`bash -c 'cd "${ROOT}" && ls -1 ${SCAN_ROOTS[0]}'\`, then inspect the contents of the 2-3 largest packages (\`ls -1 ${SCAN_ROOTS[0]}/<pkg>\`) so the conventions name the REAL packages of THIS repo + their existing subpackage patterns (mirror what already exists — do NOT invent a parallel scheme or copy names from another project).
- The current structure-verifier findings (which dirs are ALREADY over the flat-file limit, so new modules there MUST go into a subpackage): run \`bash -c 'cd "${ROOT}" && ${STRUCT_VERIFY_CMD} --subtree ${SCAN_ROOTS[0]}'\`.

Output a \`conventions\` string with: (1) the 1-line placement rule (a module extracted from <pkg> belongs in <pkg>/<concern-subpackage> grouped by concern, NOT a flat sibling, especially when <pkg> is already at/over the flat-file limit); (2) the real package map + the existing subpackage names to mirror (don't invent a parallel scheme); (3) which dirs are currently over the limit (from the verifier) so placement avoids worsening them; (4) tests mirror the source tree under ${TEST_ROOT}/<pkg>/...; (5) every relocation leaves a re-export shim at the OLD dotted path. Keep it tight and factual.`,
      { label: 'conventions', phase: 'Conventions', agentType: 'Explore', schema: CONV_SCHEMA, model: M_KEY }
    )
    CONVENTIONS = (convRes && convRes.conventions) ? convRes.conventions : ''
    log('Conventions block: ' + (CONVENTIONS ? (CONVENTIONS.replace(/\s+/g, ' ').slice(0, 160) + '…') : '(empty — placement falls back to file-sibling default)'))
  }
}

// Feedback queue: org-audit 'feedback' mode pushes suggested fixes here; a later organize pass
// (only if organize is selected) folds them into its plan as guidance.
const pendingOrgFixes = []

// Post-implementation org audit: after an engine member commits, run the verifier on the touched
// tree and report whether the implementer honored the conventions. Observational — never reverts.
async function orgAudit(touchedPaths, mtag, phaseName, root) {
  if (!ORG_AUDIT) return null
  const dirs = Array.from(new Set((touchedPaths || []).filter(p => /\.py$/.test(p)).map(p => p.replace(/\/[^/]+\.py$/, '')).filter(Boolean)))
  const baseKeys = new Set(((STRUCT_BASELINE && STRUCT_BASELINE.findings) || []).map(f => f.check + '|' + f.path))
  const res = await runStructVerify(dirs.length ? ('--subtree ' + (dirs[0].split('/').slice(0, 2).join('/') || 'src')) : '', phaseName, 'org-audit:' + mtag, M_AUDIT, root)
  if (!res) return null
  const findings = (res.findings || []).filter(f => !baseKeys.has(f.check + '|' + f.path))
  const fresh = findings.filter(f => dirs.some(d => (f.path || '').startsWith(d.split('/').slice(0, 2).join('/'))) || dirs.includes((f.path || '').replace(/\/[^/]+$/, '')))
  const report = fresh.length ? fresh : findings
  if (report.length) {
    log('Org audit ' + mtag + ': ' + report.length + ' NEW structure finding(s) vs baseline — ' + report.slice(0, 3).map(f => '[' + f.check + '] ' + f.path).join('; ') + (report.length > 3 ? ' …' : ''))
    if (ORG_AUDIT_ACTION === 'feedback') {
      for (const f of report) pendingOrgFixes.push({ check: f.check, path: f.path, message: f.message })
    }
  }
  return { new_findings: report }
}

// ================= Shared per-member apply pipeline (landMember) =================
// scope -> per-round oracle -> implement -> validate+repair-forward -> commit/revert -> org audit.
// Used by BOTH the decompose and deepen engines; stage-specific prompts come from `cfg`. Returns
// { committed, newLines, commit, stopFile, convergence } so the round loop can update its counters.
async function applyMemberOnRoot(P) {
  const { ctx, chosen, mtag, phaseOf, n, FLOOR, rounds, panelLog, cfg } = P
  const { TARGET, SHIM_MODULE, IMPORT_SMOKE } = ctx
  // PER-FILE ISOLATION: at K>1 (concurrent decompose) these point at this file's worktree; at K=1 /
  // deepen / organize they equal the global ROOT / PROTECTED_BLOCK (legacy behavior). The cfg prompt
  // builders + processOneFile already retarget via ctx.WORKDIR; here we wire the inline oracle, the
  // revert calls, and the org audit so the whole apply pipeline runs in the right tree.
  const WORKDIR = ctx.WORKDIR || ROOT
  const PROT = ctx.PROTECTED_BLOCK || PROTECTED_BLOCK
  const c = chosen.cand, mandate = chosen.mandate

  // --- TARGETED TEST SCOPE (stage-specific grep prompt) ---
  const scope = await agent(cfg.scopePrompt(chosen, FLOOR),
    { label: 'scope:' + mtag, phase: phaseOf(n), agentType: 'Explore', schema: SCOPE_SCHEMA, model: M_MECH })
  const TARGETED = !!(scope && scope.confident)
  let VAL_PATHS
  if (TARGETED) {
    VAL_PATHS = normalizePaths(Array.from(new Set([...cfg.floorList(chosen, FLOOR), ...((scope.test_paths) || [])])))
    if (!VAL_PATHS.length) VAL_PATHS = cfg.floorList(chosen, FLOOR)
  } else {
    VAL_PATHS = cfg.fullList(chosen)
  }
  const VAL_PATHS_STR = VAL_PATHS.join(' ')
  log('Round ' + mtag + ' scope: ' + (TARGETED ? ('TARGETED — ' + VAL_PATHS.length + ' path(s) [' + (scope.site_counts || '') + ']: ' + VAL_PATHS_STR) : ('FULL sweep over ' + VAL_PATHS.length + ' dir(s) — ' + (scope ? 'too pervasive to scope safely' : 'scope step failed'))))

  // --- PER-ROUND ORACLE (clean tree, this round's scope) ---
  const roundOracle = await agent(
    `Capture the CURRENT (pre-change) test failures on the clean committed tree at ${WORKDIR}, so a later validation pass can tell new regressions from pre-existing redness. The tree is clean — make NO edits. Run through the project's uv env, from inside the repo (\`bash -c 'cd "${WORKDIR}" && <cmd>'\`):
    uv run python -m pytest ${VAL_PATHS_STR} -q -p no:cacheprovider
RUN IT SYNCHRONOUSLY IN THE FOREGROUND in a SINGLE Bash call and read the output directly. Set the Bash tool's timeout to 600000 (10 min) for this call so it does not get cut off. Do NOT use run_in_background. Do NOT redirect the output to a file and then wait for a notification — you are a subagent and will NOT be notified of background completion; backgrounding will hang this step. The command may take a couple of minutes; that is expected — just let it finish in the foreground.
This is the TARGETED validation scope for this round (the minimal subset covering the change's blast radius — NOT the whole suite). Record EVERY failing or erroring test node id into red_tests, and the total collected count. Do NOT change the selection above. ALSO record the current HEAD short hash (git -C "${WORKDIR}" rev-parse --short HEAD) into base_sha — this is the round's base commit that the revert-on-red path must return to (undoing any commit an implementer wrongly makes mid-round). Do NOT edit code, do NOT commit.`,
    { label: 'oracle:' + mtag, phase: phaseOf(n), schema: ORACLE_SCHEMA, model: M_MECH })
  const ROUND_BASE = (roundOracle && roundOracle.base_sha) || ''
  const ROUND_RED = Array.from(new Set([...BASELINE_RED, ...((roundOracle && roundOracle.red_tests) || [])]))
  log('Round ' + mtag + ' oracle: ' + ROUND_RED.length + ' pre-existing failures across ' + VAL_PATHS.length + ' validation path(s) (clean tree)')

  // --- IMPLEMENT (stage-specific prompt) ---
  const impl = await agent(cfg.implPrompt(chosen),
    { label: 'implement:' + mtag, phase: phaseOf(n), schema: IMPLEMENT_SCHEMA, model: M_KEY })
  if (!impl || !impl.ok) {
    await agent(safeRevertPrompt(`The implementer aborted in the repo at ${WORKDIR}; ensure the tree is clean.`, ROUND_BASE, WORKDIR, PROT),
      { label: 'revert:' + mtag, phase: phaseOf(n), schema: REVERT_SCHEMA, model: M_MECH })
    rounds.push({ round: n, member: mtag, stage: 'implement', candidate: c.title, validated: false, note: impl ? impl.detail : 'implementer produced no result', panel: panelLog })
    log('Round ' + mtag + ': implementer aborted (' + (impl ? impl.detail : 'no result') + ') — member reverted, trying next.')
    return { committed: false }
  }
  log('Round ' + mtag + ': applied "' + c.title + '"' + (impl.new_module ? ' -> ' + impl.new_module : '') + ' (' + (impl.shims_written || []).length + ' shims). Validating...')

  // --- VALIDATE + REPAIR-FORWARD ---
  const curImpl = cfg.initialCurImpl(impl, mandate)
  const validateNow = async (vtag) => {
    const lintFiles = (curImpl.files_touched || []).filter(f => /\.py$/.test(f))
    // No configured linter -> a shell no-op so lint never REDs the round on a non-ruff repo.
    const ROUND_LINT = !LINT_PER_FILE_PREFIX ? 'true'
      : (lintFiles.length ? (LINT_PER_FILE_PREFIX + ' ' + lintFiles.map(f => "'" + f + "'").join(' ')) : LINT)
    const PYTEST_SCOPE = 'uv run python -m pytest ' + VAL_PATHS_STR + ' -q -p no:cacheprovider'
    return await agent(cfg.validatePrompt(chosen, curImpl, PYTEST_SCOPE, ROUND_RED, ROUND_LINT, IMPORT_SMOKE),
      { label: 'validate:' + vtag, phase: phaseOf(n), schema: VALIDATE_SCHEMA, model: M_VAL })
  }
  const isVerdict = (v) => !!(v && typeof v.passed === 'boolean')
  const validateWithRetry = async (vtag) => {
    let v = await validateNow(vtag)
    let t = 0
    while (!isVerdict(v) && t < VAL_RETRIES) {
      t++
      log('Round ' + mtag + ': validator returned NO boolean verdict — a validator failure, NOT a red. Re-validating ' + t + '/' + VAL_RETRIES + ' before any repair.')
      v = await validateNow(vtag + 'v' + t)
    }
    return v
  }

  let val = await validateWithRetry(mtag)
  let repairs = 0
  while (!(val && val.passed === true) && repairs < MAX_REPAIRS) {
    repairs++
    const rtag = mtag + 'r' + repairs
    const failures = (val && val.new_failures) || []
    log('Round ' + mtag + ': validation RED (' + (failures.length ? failures.length + ' new failure(s)' : 'no enumerated failures') + ') — repair attempt ' + repairs + '/' + MAX_REPAIRS + ' (fixing forward, NOT reverting).')
    const repair = await agent(cfg.repairPrompt(chosen, failures, val, curImpl, ROUND_RED),
      { label: 'repair:' + rtag, phase: phaseOf(n), schema: IMPLEMENT_SCHEMA, model: M_KEY })
    if (!repair || !repair.ok) {
      log('Round ' + mtag + ': repair attempt ' + repairs + ' could not fix it (' + (repair ? repair.detail : 'no result') + ') — exhausting repairs, will revert.')
      break
    }
    curImpl.files_touched = Array.from(new Set([...(curImpl.files_touched || []), ...(repair.files_touched || [])]))
    if (repair.tests_changed && repair.tests_changed.length) curImpl.tests_changed = Array.from(new Set([...(curImpl.tests_changed || []), ...repair.tests_changed]))
    if (repair.shims_written && repair.shims_written.length) curImpl.shims_written = Array.from(new Set([...(curImpl.shims_written || []), ...repair.shims_written]))
    if (Number.isFinite(repair.target_lines_after)) curImpl.target_lines_after = repair.target_lines_after
    log('Round ' + mtag + ': repair ' + repairs + ' applied — re-validating.')
    val = await validateWithRetry(rtag)
  }

  if (val && val.passed === true) {
    if (repairs > 0) log('Round ' + mtag + ': GREEN after ' + repairs + ' repair attempt(s) — committing.')
    const commit = await agent(cfg.commitPrompt(chosen, curImpl, mtag, repairs),
      { label: 'commit:' + mtag, phase: phaseOf(n), schema: COMMIT_SCHEMA, model: M_MECH })
    if (!commit || !commit.ok) {
      rounds.push({ round: n, member: mtag, stage: 'commit', candidate: c.title, error: commit ? commit.detail : 'no result', panel: panelLog })
      log('Round ' + mtag + ': commit failed — halting this file. ' + (commit ? commit.detail : ''))
      return { committed: false, stopFile: true, convergence: 'commit-error' }
    }
    // Post-implementation org audit (observational; never reverts a committed member).
    let audit = null
    try { audit = await orgAudit(curImpl.files_touched, mtag, phaseOf(n), WORKDIR) } catch (e) { /* audit is best-effort */ }
    rounds.push({
      round: n, member: mtag, candidate: c.title, execution_method: chosen.mandate.execution_method,
      new_module: curImpl.new_module, shims_written: curImpl.shims_written || [],
      files_touched: curImpl.files_touched || [], tests_changed: curImpl.tests_changed || [],
      target_lines_after: curImpl.target_lines_after, validated: true, repairs, commit: commit.commit,
      files_changed: commit.files_changed, org_audit: audit ? audit.new_findings : [], panel: panelLog,
    })
    log('Round ' + mtag + ' committed ' + commit.commit + ' ("' + c.title + '"' + (repairs > 0 ? ', +' + repairs + ' repair(s)' : '') + ').' + (Number.isFinite(curImpl.target_lines_after) ? ' target now ' + curImpl.target_lines_after + ' lines.' : ''))
    const result = { committed: true, newLines: curImpl.target_lines_after, commit: commit.commit }
    if (cfg.reportTargetLines && Number.isFinite(curImpl.target_lines_after) && curImpl.target_lines_after <= cfg.targetLines) {
      result.stopFile = true
      result.convergence = 'target-reached'
      log(mtag + ': reached line target — ' + TARGET + ' is ' + curImpl.target_lines_after + ' lines (<= ' + cfg.targetLines + '). Advancing.')
    }
    return result
  }
  // LAST RESORT — repairs exhausted. Revert ONLY this member.
  await agent(safeRevertPrompt(`The change "${c.title}" FAILED validation in the repo at ${WORKDIR} and could not be repaired in ${MAX_REPAIRS} attempt(s); discard it to restore the clean tree.`, ROUND_BASE, WORKDIR, PROT),
    { label: 'revert:' + mtag, phase: phaseOf(n), schema: REVERT_SCHEMA, model: M_MECH })
  rounds.push({ round: n, member: mtag, stage: 'validate', candidate: c.title, validated: false, repairs, new_failures: (val && val.new_failures) || [], panel: panelLog })
  log('Round ' + mtag + ': "' + c.title + '" FAILED validation after ' + repairs + ' repair attempt(s) — member reverted, trying next.')
  return { committed: false }
}

// ================= Phase: Discover the worklist =================
// In-workflow path filters so discovery can rely on a DETERMINISTIC whole-repo scan (repo_scan.py)
// and narrow it here, rather than baking the include/exclude logic into an LLM-run `find`.
const globToRe = (g) => {
  const esc = String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&')
  // Collapse runs of '*': '**' (globstar) -> '.*', a single '*' -> '[^/]*'. One pass, no placeholder.
  const re = esc.replace(/\*+/g, (m) => (m.length >= 2 ? '.*' : '[^/]*'))
  return new RegExp('^' + re + '$')
}
const EXCLUDE_RES = EXCLUDE_GLOBS.map(globToRe)
const isExcludedPath = (p) => EXCLUDE_RES.some(re => re.test(p))
const underScanRoots = (p) => SCAN_ROOTS.some(r => { const rr = String(r).replace(/\/+$/, ''); return rr === '.' || p === rr || p.startsWith(rr + '/') })

// List every importable Python source file over the threshold, largest-first. Re-runnable so the
// sweep can refresh the queue after each file (new extracted modules may themselves be oversized).
// DETERMINISTIC PATH (Fix #2): when a scanScript is available, drive discovery off repo_scan.py's
// machine-generated `large_source_files` JSON (a bounded {path,lines} array) rather than asking an
// agent to transcribe unbounded `wc -l` output — which silently truncated the worklist. The agent
// only relays a bounded JSON array; SCAN_ROOTS / EXCLUDE_GLOBS / threshold filtering happens HERE.
async function discover(processed, discoverPhase, threshold) {
  const TH = Number.isFinite(threshold) ? threshold : DISCOVER_LINES
  let res
  if (SCAN_SCRIPT) {
    // repo_scan is stdlib-only → plain python3, no uv env needed. --large-min at the god-file
    // threshold and a high --large-cap so a big worklist is never truncated.
    res = await agent(
      `Read-only — make NO edits. Run the deterministic repo scanner and relay its large-file list. Run EXACTLY this one command, synchronously in the foreground, and read its stdout directly:
\`bash -c 'cd "${ROOT}" && python3 ${SCAN_SCRIPT} . --large-min ${TH} --large-cap 5000'\`
It prints a JSON object. Take its \`large_source_files\` array — each element is {path, lines} (path repo-relative, biggest first) — and transcribe EVERY element VERBATIM into the \`files\` array of your structured result as {path, lines}. Do NOT filter, re-sort, summarize, or truncate; do NOT add or invent entries. If \`large_source_files\` is empty, return files:[]. If the command errors or emits no JSON, return files:[] and explain in detail. Do NOT edit anything.`,
      { label: 'discover', phase: discoverPhase || 'Discover', agentType: 'Explore', schema: DISCOVER_SCHEMA, model: M_COORD }
    )
  } else {
    // Legacy fallback (no scanScript passed): LLM-transcribed `find | wc -l`. Kept for direct,
    // non-plugin invocations that don't bundle repo_scan.py.
    res = await agent(
      `Read-only. Find every Python SOURCE file over ${TH} lines that is a candidate in the repo at ${ROOT}. Make NO edits.

Run EXACTLY this command (sorted largest-first so the files you want are all at the TOP of the output):
\`bash -c 'cd "${ROOT}" && find ${SCAN_ROOTS.join(' ')} -name "*.py" -not -path "*/ui-tui/*" -not -path "*/__pycache__/*" -not -path "*/dev/tests/*" -print0 | xargs -0 wc -l | sort -rn'\`

The output is \`<lines> <repo-relative-path>\` per line, biggest first. The first line is the \`total\` (skip it). Then come the files in descending size: take every line whose line-count is GREATER THAN ${TH} and STOP at the first line ≤ ${TH} (everything below it is too small).

CRITICAL OUTPUT CONTRACT: put EVERY qualifying file (lines > ${TH}) into the \`files\` array of your structured result as {path, lines} — transcribe ALL of them, do NOT summarize in prose, do NOT truncate, and do NOT return an empty array when the command printed qualifying lines. If you counted N files over ${TH}, the files array MUST have N entries. Do NOT edit anything.`,
      { label: 'discover', phase: discoverPhase || 'Discover', agentType: 'Explore', schema: DISCOVER_SCHEMA, model: M_COORD }
    )
  }
  const files = ((res && res.files) || [])
    .map(f => f && f.path ? { path: String(f.path).replace(/^\.\//, ''), lines: f.lines } : f)
    .filter(f => f && f.path && Number.isFinite(f.lines) && f.lines > TH)
    // SCAN_ROOTS / EXCLUDE_GLOBS applied HERE (repo_scan scans the whole repo; the legacy find
    // pre-filters, but re-applying is harmless and keeps both paths consistent).
    .filter(f => underScanRoots(f.path) && !isExcludedPath(f.path))
    .filter(f => !processed.has(f.path))
    .sort((a, b) => b.lines - a.lines)
  return files
}

// ================= Per-stage apply config (prompts for applyMemberOnRoot) =================
// makeDecomposeCfg holds the proven god-file-split prompts (scope/implement/repair/validate/commit);
// makeDeepenCfg adapts them for in-place architectural deepenings. Both close over ctx + CONVENTIONS.
function makeDecomposeCfg(ctx) {
  const { TARGET, SHIM_MODULE, DEST_PKG, DEST_PKG_DOTTED, SCOPE_TAG } = ctx
  // Shadow ROOT/BRANCH from the per-file isolation surface so every prompt below retargets this
  // file's worktree at K>1; falls back to the global values (K=1 / deepen / organize) unchanged.
  const ROOT = ctx.WORKDIR || A.projectDir
  const BRANCH = ctx.FILE_BRANCH || A.branch || 'optimize-codebase/auto'
  const CONV = ctx.CONVENTIONS ? ('\n\n=== REPO ORGANIZATION CONVENTIONS (place the new module in a convention-correct home, not a loose flat sibling) ===\n' + ctx.CONVENTIONS) : ''
  return {
    reportTargetLines: true,
    targetLines: TARGET_LINES,
    floorList: (chosen, FLOOR) => [FLOOR],
    fullList: () => VAL_DIRS,
    initialCurImpl: (impl, mandate) => ({
      new_module: impl.new_module || mandate.dest_module,
      shims_written: impl.shims_written || [],
      files_touched: (impl.files_touched || []).slice(),
      tests_changed: (impl.tests_changed || []).slice(),
      target_lines_after: impl.target_lines_after,
    }),
    scopePrompt: (chosen, FLOOR) =>
      `Read-only — make NO edits. Pick the MINIMAL set of tests that must run to catch any regression from extracting this cluster out of ${TARGET}, in the repo at ${ROOT}. The extraction MOVES these symbols, each left behind as a re-export shim at ${SHIM_MODULE}.<name> (so the import surface is byte-identical):
  symbols: ${JSON.stringify(chosen.cand.symbols)}
  patched_symbols (test seams): ${JSON.stringify(chosen.cand.patched_symbols || [])}
  dest_module: ${chosen.mandate.dest_module}

Because the move leaves shims, the regression surface is bounded by tests that actually exercise these symbols. Grep dev/tests (ripgrep) and, for EVERY moved symbol, find the test files that:
  - patch("${SHIM_MODULE}.<sym>") / patch.object(...,"<sym>") / monkeypatch <sym>
  - \`from ${SHIM_MODULE} import <sym>\` or reference \`${SHIM_MODULE}.<sym>\`
  - use <sym> bare in a test body, or import the destination module ${chosen.mandate.dest_module}
  - SOURCE-TEXT GUARDS: read ${TARGET} as text / ast.parse it / assert a symbol name string appears in it (search: ${TARGET.split('/').pop()}, read_text, ast.parse, each symbol as a quoted string)

MANDATORY FLOOR: ALWAYS include the target file's own test directory **${FLOOR}** as a floor (verify it exists: \`bash -c 'cd "${ROOT}" && ls -d ${FLOOR}'\` — if it does NOT exist, use ${JSON.stringify(KEEP_SET)} as the floor instead). test_paths MUST therefore be NON-EMPTY: at minimum the floor, plus any specific test files your grep surfaced. Prefer specific test files; a whole dir is fine when many files in it match. All paths repo-relative under dev/tests/. NEVER return an empty test_paths list (an empty list is NOT "run nothing" — it would force the entire suite).

Set confident:FALSE ONLY if a moved symbol is SO pervasive that even the floor + your greps cannot bound it safely — referenced across MANY (>~6) different dev/tests subdirectories OR in >~40 files, OR plausibly exercised by integration tests that do not name it. That is the RARE case; the floor handles the common "few/zero direct tests" case with confident:true. When confident:true, test_paths MUST cover the floor + every site you found. Report lint_paths (${TARGET} + ${chosen.mandate.dest_module}) and a site_counts tally of what you grepped.`,
    implPrompt: (chosen) => {
      const c = chosen.cand, mandate = chosen.mandate
      return `You are implementing ONE god-file decomposition from the improve-codebase-architecture skill, under a BINDING MANDATE from a decision panel. You work DIRECTLY in the repo at ${ROOT} (NOT a worktree) — anchor git with git -C "${ROOT}" and edit files under ${ROOT}. The tree is clean and committed. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md first; use that vocabulary. NEVER run \`git clean\`. Do NOT commit (a later step does).

GOAL: extract a cohesive cluster out of the god-file ${TARGET} into a focused module, leaving re-export shims so the external surface (${SHIM_MODULE}.<name>) is byte-identical to callers and test patch() sites.

Candidate:
  title: ${c.title}
  symbols: ${JSON.stringify(c.symbols)}
  line_range: ${c.line_range}${c._approxRange ? ' (APPROXIMATE — reused pooled candidate; the file drifted since the find. Locate the symbols by NAME in the LIVE file, do NOT trust these line numbers)' : ''}
  problem: ${c.problem}
  solution: ${c.solution}
  patched_symbols (test seams that MUST keep biting): ${JSON.stringify(c.patched_symbols || [])}

=== PANEL MANDATE (binding — deviating is grounds to abort) ===
Destination module: ${mandate.dest_module}${mandate.dest_placement_rationale ? ' (placement: ' + mandate.dest_placement_rationale + ')' : ''}
${mandate.new_subpackage_init ? 'CREATE the destination subpackage __init__.py if it does not exist (the dest is a NEW subpackage) so it is importable.\n' : ''}Execution method: ${mandate.execution_method}
${mandate.execution_method === 'staged' ? `STAGED — move ONLY this sub-cluster (the loop continues the rest in later rounds):
  THIS ROUND: ${mandate.this_round_scope || '(see execution plan)'}
  DEFERRED (do NOT attempt now): ${mandate.deferred_stages.length ? mandate.deferred_stages.join(' | ') : '(none listed)'}
` : ''}Execution plan (follow in order):
${mandate.execution_plan.length ? mandate.execution_plan.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n') : '  (none specified — apply the method below with judgement)'}
Re-export shims REQUIRED (every old import path that MUST keep resolving from ${SHIM_MODULE}, so \`from ${SHIM_MODULE} import X\` and \`patch("${SHIM_MODULE}.X")\` survive):
${mandate.shims_required.length ? mandate.shims_required.map(s => '  - ' + s).join('\n') : '  (the panel listed none explicitly — you MUST still shim EVERY name you move that is imported or patched anywhere)'}
Characterization tests REQUIRED (write + keep these):
${mandate.characterization_tests_required.length ? mandate.characterization_tests_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — but if any moved symbol is patched in tests, add a test asserting patch("' + SHIM_MODULE + '.<sym>") still intercepts the live call path)'}
Behaviour invariants / importable names that MUST stay identical:
${mandate.behavior_invariants.length ? mandate.behavior_invariants.map(s => '  - ' + s).join('\n') : '  (none stated)'}
Strongest dissent on record (heed it): ${mandate.dissent || '(none)'}

=== EXECUTION DISCIPLINE ===
- PREFER PROGRAMMATIC TRANSFORMATION. ${TARGET} is large — NEVER hand-retype the slice. Use a throwaway Python ast/libcst codemod (write it under /tmp, run with \`bash -c 'cd "${ROOT}" && uv run python /tmp/<script>.py'\`, then DELETE it before finishing). The codemod must:
    1. slice the mandated symbols BYTE-FOR-BYTE out of ${TARGET} into the new module ${mandate.dest_module} (preserve their bodies exactly — line-by-line diff later must show a pure move),
    2. give the new module the imports it needs (move or duplicate the module-level imports those symbols depend on),
    3. write a RE-EXPORT SHIM block back into ${TARGET} at/near the old location: \`from ${DEST_PKG_DOTTED}.<module> import <names>\` (so ${SHIM_MODULE}.<name> resolves to the SAME object the live code now calls — this is what keeps \`patch("${SHIM_MODULE}.<name>")\` biting),
    4. rewrite any other in-file references and cross-module imports as needed.
- PLACEMENT: put the new module at the convention-correct path the mandate names (an existing/justified subpackage), NOT a loose flat sibling in an already-large directory. Create the subpackage __init__.py if needed.
- WATCH THE patch() SEAM (the import-binding-rename trap): if the moved code calls a sibling that was also moved, callers inside the new module must reference it so that patching \`${SHIM_MODULE}.<name>\` still affects the call — verify by reasoning about WHERE the name is looked up. If a symbol is called via the module global, the shim alone preserves the seam; if it was called bare within the moved cluster, the cluster now resolves it locally and the OLD patch target would go dead — in that case re-export AND keep the call going through a path the test patches (note any such case in detail).
- CHARACTERIZATION FIRST: write the mandated tests (esp. patch-still-bites) against the existing interface BEFORE moving, so drift is caught.
- UPDATE SOURCE-TEXT GUARD TESTS (a failure class a shim CANNOT fix). BEFORE finishing, grep dev/tests for any test that reads ${TARGET} as TEXT and asserts a moved symbol's def/call appears in it (search: \`${TARGET.split('/').pop()}\`, \`read_text\`, \`ast.parse\`, and each moved symbol name as a quoted string). Such a test asserts \`"def <sym>" in source_of_target\` or parametrizes on the target path; moving the symbol makes it FALSE. For each one (the mandate lists them as "source-text-guard: ..."), REPOINT the assertion to the new module ${mandate.dest_module} (or assert the new shim line is present in ${TARGET}) so the guard still verifies the real intent. Add these files to files_touched. A missed guard is the most common silent red for this loop.
- Preserve EXACTLY: public/CLI surface, wire formats, persisted schemas, error contracts, and every importable name. Replace-don't-layer tests at the new module's interface only where it genuinely improves them.
- You MAY run \`bash -c 'cd "${ROOT}" && uv run python -c "import ${SHIM_MODULE}, ${DEST_PKG_DOTTED}.<module>"'\` as a sanity check while working.
- DO NOT COMMIT and DO NOT \`git add\`/\`git stash\`. Leave ALL your changes UNCOMMITTED in the working tree — a later step validates then commits. A commit you make here survives the revert-on-red path and leaks an orphan onto the branch.
- If honoring the mandate proves unsafe/oversized or the cluster is not actually cohesive (entangled with code that stays), make NO partial edits: run the safe revert yourself (git -C "${ROOT}" checkout -- . ; remove only NEW untracked files you created) and return ok:false with the reason. Do NOT commit even on abort.

Report files_touched (every path created/modified, INCLUDING any source-text-guard tests you repointed), new_module, shims_written (the ${SHIM_MODULE}.<name> re-exports), tests_changed, target_lines_after (wc -l of ${TARGET} — it should SHRINK), and a concise detail. Leave the change in the working tree (uncommitted) for validation.${CONV}`
    },
    validatePrompt: (chosen, curImpl, PYTEST_SCOPE, ROUND_RED, ROUND_LINT, IMPORT_SMOKE) =>
      `Validate a god-file decomposition just applied to the repo at ${ROOT}: the cluster "${chosen.cand.title}" was extracted from ${TARGET} into ${curImpl.new_module} behind re-export shims. Run everything through the project's uv env (a bare python/pytest is NOT acceptable — tests live under dev/tests/, not tests/). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

Run, in order (run ALL THREE even if one fails). Run each SYNCHRONOUSLY IN THE FOREGROUND and read its output directly — set the Bash tool timeout to 600000 (10 min) for the pytest call. Do NOT use run_in_background and do NOT redirect to a file then wait for a notification (you are a subagent and will NOT be notified; backgrounding hangs this step). A couple of minutes is expected.
1. Import smoke (this exercises that ${SHIM_MODULE} still exposes the moved names): ${IMPORT_SMOKE}
2. Tests — the TARGETED validation scope for this round: ${PYTEST_SCOPE}
3. Lint (the files this round touched): ${ROUND_LINT}

A test counts as a REGRESSION only if it FAILS now and was NOT already failing in the oracle below. Pre-existing red tests are NOT regressions. Any characterization test the round added MUST be green. PAY SPECIAL ATTENTION to any \`patch("${SHIM_MODULE}.X")\`-based test: if it now fails, the move likely broke the patch seam — flag that explicitly.
PER-ROUND ORACLE (failures on these exact dirs, clean tree, before the change — pre-existing, NOT this round's fault):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none — these dirs were fully green on the clean tree)'}

Set passed:true ONLY if import smoke succeeds AND zero NEW test failures AND lint clean. List every new failure (node id + one-line cause, flag patch-seam breaks) in new_failures. Report raw command tails. Do NOT edit code, do NOT commit.`,
    repairPrompt: (chosen, failures, val, curImpl, ROUND_RED) => {
      const c = chosen.cand
      return `You are REPAIRING a god-file decomposition that is ALREADY APPLIED to the working tree at ${ROOT} (UNCOMMITTED) but FAILED validation. FIX IT FORWARD so it passes — do NOT revert, do NOT \`git checkout\`/discard the extraction. Anchor git with git -C "${ROOT}". NEVER run \`git clean\`. Do NOT commit. Read ${SKILL_DIR}/LANGUAGE.md if you need the vocabulary.

CONTEXT — the extraction in the tree right now:
  cluster "${c.title}" moved from ${TARGET} -> ${curImpl.new_module}, behind re-export shims at ${SHIM_MODULE}.* .
  symbols moved: ${JSON.stringify(c.symbols)}
  patched_symbols (test seams that must keep biting): ${JSON.stringify(c.patched_symbols || [])}
  files touched so far: ${(curImpl.files_touched || []).join(', ') || '(unknown — inspect git status)'}

VALIDATION FAILURES TO FIX (NEW regressions vs the pre-change oracle — the oracle reds below are pre-existing and NOT your problem):
${failures.length ? failures.map(s => '  - ' + s).join('\n') : '  (the validator set passed:false but did not enumerate failures — re-run the checks yourself; validator detail: ' + ((val && val.detail) || 'n/a') + ')'}
PRE-EXISTING ORACLE REDS (ignore):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none)'}

HOW TO FIX (diagnose each failure, then fix the RIGHT layer — do not paper over a real behavior break):
- SOURCE-TEXT / SOURCE-INTROSPECTION GUARD (a test reads ${TARGET} as text, \`ast.parse\`s it, or uses inspect/getsource and asserts a moved symbol appears in ${TARGET}): a shim CANNOT satisfy this. REPOINT the test to inspect ${curImpl.new_module} (or both). Most common red.
- PATCH-SEAM BREAK (a \`patch("${SHIM_MODULE}.X")\` test stopped biting): ensure the moved code resolves X through a path the patch still intercepts (re-export at ${SHIM_MODULE}.X AND make the live call go through the patched module attribute, not a bare local rebind).
- IMPORT / NAME ERROR in the new module or shim: add the missing imports, fix the shim re-export so \`from ${SHIM_MODULE} import <name>\` and the dotted path both resolve.
- A genuine behavior regression: fix the moved code so behavior is identical to before the move.
Leave ALL changes UNCOMMITTED for re-validation. If the extraction is fundamentally unsound (cannot be made green without undoing the move), set ok:false with the reason so the loop reverts as a last resort — but PREFER fixing forward.

Report files_touched (every path you created/modified this repair, INCLUDING repointed guard tests), new_module (${curImpl.new_module}), shims_written, tests_changed, target_lines_after (wc -l of ${TARGET}), and a concise detail. Leave changes uncommitted.`
    },
    commitPrompt: (chosen, curImpl, mtag, repairs) => {
      const c = chosen.cand
      const titleLine = c.title.replace(/\s+/g, ' ').slice(0, 60)
      return `A panel-approved god-file decomposition was applied to the repo at ${ROOT} (branch ${BRANCH}) and PASSED CI-faithful validation (import smoke + targeted tests + lint, no regressions). Commit it. Anchor with git -C "${ROOT}". NEVER push.

Do:
1. git -C "${ROOT}" status --porcelain (expect ${TARGET} shrunk + the new module + any new tests; remove any stray /tmp codemod artifacts if they leaked into the tree).
2. git -C "${ROOT}" add -A
3. git -C "${ROOT}" commit -m "refactor(${SCOPE_TAG}): extract ${titleLine} from ${TARGET}

Decomposition round ${mtag}: moved a cohesive cluster (${(c.symbols || []).slice(0, 6).join(', ')}${(c.symbols || []).length > 6 ? ', …' : ''}) out of the ${TARGET} god-file into ${curImpl.new_module}, behind re-export shims at ${SHIM_MODULE}.* so all imports and patch() seams are preserved. Panel-approved (${chosen.mandate.execution_method}); validated green${repairs > 0 ? ' after ' + repairs + ' repair pass(es)' : ''}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
4. Report the new commit's short hash and files changed.`
    },
  }
}

function makeDeepenCfg(ctx) {
  const { TARGET } = ctx
  // Shadow ROOT/BRANCH from ctx (= globals for deepen, which never isolates) so prompts are consistent.
  const ROOT = ctx.WORKDIR || A.projectDir
  const BRANCH = ctx.FILE_BRANCH || A.branch || 'optimize-codebase/auto'
  const CONV = ctx.CONVENTIONS ? ('\n\n=== REPO ORGANIZATION CONVENTIONS (if you create a NEW module, place it in a convention-correct home) ===\n' + ctx.CONVENTIONS) : ''
  return {
    reportTargetLines: false,
    targetLines: 0,
    floorList: (chosen) => Array.from(new Set([...((chosen.mandate.validation_dirs) || []), ...testDirsForFiles(chosen.cand.files)])),
    fullList: () => VAL_DIRS,
    initialCurImpl: (impl) => ({
      new_module: impl.new_module || '',
      shims_written: impl.shims_written || [],
      files_touched: (impl.files_touched || []).slice(),
      tests_changed: (impl.tests_changed || []).slice(),
      target_lines_after: undefined,
    }),
    scopePrompt: (chosen, FLOOR) =>
      `Read-only — make NO edits. Pick the MINIMAL set of tests that must run to catch any regression from this architecture deepening in the repo at ${ROOT}. The change touches these files (it reshapes internals behind a seam, leaving re-export shims at any moved import path):
  files: ${JSON.stringify(chosen.cand.files)}
  dependency_category: ${chosen.cand.dependency_category}
  mandated validation dirs: ${JSON.stringify((chosen.mandate.validation_dirs) || [])}

Grep dev/tests (ripgrep) for tests that import or patch anything in those files, and ALWAYS include the mandated validation dirs above (and the keep-set ${JSON.stringify(KEEP_SET)}) as a floor. test_paths MUST be NON-EMPTY. Prefer specific test files; whole dirs are fine when many files match. All paths repo-relative under dev/tests/.

Set confident:FALSE only if the change is so cross-cutting that even the mandated dirs + your greps cannot bound it safely (then the loop runs the full sweep). Report lint_paths (the touched .py files) and a site_counts tally.`,
    implPrompt: (chosen) => {
      const c = chosen.cand, mandate = chosen.mandate
      return `You are implementing ONE architecture DEEPENING from the improve-codebase-architecture skill, under a BINDING MANDATE from a decision panel. You work DIRECTLY in the repo at ${ROOT} (NOT a worktree) — anchor git with git -C "${ROOT}" and edit files under ${ROOT}. The tree is clean and committed. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md first; use that vocabulary. NEVER run \`git clean\`. Do NOT commit (a later step does).

GOAL: reshape the shallow module(s) behind a smaller, higher-leverage interface (locality + leverage), preserving EVERY externally observable contract. Leave re-export shims at any import path you move so \`from x import y\` and \`patch("x.y")\` keep resolving.

Candidate:
  title: ${c.title}
  files: ${JSON.stringify(c.files)}
  problem: ${c.problem}
  solution: ${c.solution}
  dependency_category: ${c.dependency_category}

=== PANEL MANDATE (binding — deviating is grounds to abort) ===
Execution method: ${mandate.execution_method}
${mandate.execution_method === 'staged' ? `STAGED — land ONLY this sub-step (the loop continues the rest in later rounds):
  THIS ROUND: ${mandate.this_round_scope || '(see execution plan)'}
  DEFERRED (do NOT attempt now): ${mandate.deferred_stages.length ? mandate.deferred_stages.join(' | ') : '(none listed)'}
` : ''}Execution plan (follow in order):
${mandate.execution_plan.length ? mandate.execution_plan.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n') : '  (none specified — apply the method below with judgement)'}
Re-export shims REQUIRED (old import paths that must keep resolving):
${mandate.shims_required.length ? mandate.shims_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — still shim any import path you move)'}
Characterization tests REQUIRED (write at the EXISTING interface BEFORE refactoring):
${mandate.characterization_tests_required.length ? mandate.characterization_tests_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — add golden-master tests for each behaviour the change touches)'}
Behaviour invariants that MUST stay byte-identical:
${mandate.behavior_invariants.length ? mandate.behavior_invariants.map(s => '  - ' + s).join('\n') : '  (none stated)'}
Strongest dissent on record (heed it): ${mandate.dissent || '(none)'}

=== EXECUTION DISCIPLINE ===
- PREFER PROGRAMMATIC TRANSFORMATION over hand-retyping large files (Python ast/libcst or a throwaway /tmp codemod run via \`bash -c 'cd "${ROOT}" && uv run python /tmp/<script>.py'\`; delete it before finishing). Use \`git mv\` for whole-file moves to preserve history.
- CHARACTERIZATION TESTS FIRST: write the mandated tests against the existing interface; they must survive the refactor.
- Implement the deepening: reshape the shallow module(s) behind a small interface; update ALL call sites + add the mandated shims; preserve the listed invariants, public APIs, CLI, wire formats, persisted schemas EXACTLY. Replace-don't-layer tests at the new interface; only introduce a port/seam if two adapters justify it. If you create a NEW module, place it in a convention-correct home (see conventions below), not a loose sibling.
- WATCH patch() SEAMS exactly as a decomposition would: a moved name must still be resolvable through the patched path.
- DO NOT COMMIT / \`git add\` / \`git stash\`. Leave ALL changes UNCOMMITTED for the validation step. A commit here survives revert-on-red and leaks an orphan.
- If the change proves unsafe/oversized or cannot honor the mandate, make NO partial edits: run the safe revert yourself (git -C "${ROOT}" checkout -- . ; remove only NEW untracked files you created) and return ok:false with the reason.

Report files_touched (every path created/modified, incl. new module + tests), new_module (if any), shims_written, tests_changed, and a concise detail. Leave the change uncommitted for validation.${CONV}`
    },
    validatePrompt: (chosen, curImpl, PYTEST_SCOPE, ROUND_RED, ROUND_LINT, IMPORT_SMOKE) =>
      `Validate an architecture deepening just applied to the repo at ${ROOT}: "${chosen.cand.title}" (files: ${JSON.stringify(chosen.cand.files)}). Run everything through the project's uv env (a bare python/pytest is NOT acceptable — tests live under dev/tests/, not tests/). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

Run, in order (run ALL THREE even if one fails). Run each SYNCHRONOUSLY IN THE FOREGROUND; set the Bash tool timeout to 600000 (10 min) for pytest. Do NOT background or redirect-then-wait (you are a subagent and will NOT be notified).
1. Import smoke: ${IMPORT_SMOKE}
2. Tests — the TARGETED validation scope for this round: ${PYTEST_SCOPE}
3. Lint (the files this round touched): ${ROUND_LINT}

A test is a REGRESSION only if it FAILS now and was NOT already failing in the oracle below. Any characterization test the round added MUST be green.
PER-ROUND ORACLE (pre-existing failures on these exact dirs, clean tree — NOT this round's fault):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none — these dirs were fully green on the clean tree)'}

Set passed:true ONLY if import smoke succeeds AND zero NEW test failures AND lint clean. List every new failure (node id + one-line cause) in new_failures. Report raw command tails. Do NOT edit code, do NOT commit.`,
    repairPrompt: (chosen, failures, val, curImpl, ROUND_RED) => {
      const c = chosen.cand
      return `You are REPAIRING an architecture deepening that is ALREADY APPLIED to the working tree at ${ROOT} (UNCOMMITTED) but FAILED validation. FIX IT FORWARD — do NOT revert/discard the change. Anchor git with git -C "${ROOT}". NEVER run \`git clean\`. Do NOT commit.

CONTEXT: "${c.title}" touching files ${JSON.stringify(c.files)}${curImpl.new_module ? ' (new module ' + curImpl.new_module + ')' : ''}. files touched so far: ${(curImpl.files_touched || []).join(', ') || '(inspect git status)'}.

VALIDATION FAILURES TO FIX (NEW regressions vs the pre-change oracle — the oracle reds below are pre-existing):
${failures.length ? failures.map(s => '  - ' + s).join('\n') : '  (validator set passed:false but did not enumerate failures — re-run the checks; validator detail: ' + ((val && val.detail) || 'n/a') + ')'}
PRE-EXISTING ORACLE REDS (ignore):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none)'}

HOW TO FIX: add missing imports / fix shim re-exports so old import paths resolve; ensure any \`patch("...")\` seam still bites through the patched path; repoint source-text/introspection guards to the new home; fix any genuine behaviour regression so behaviour is identical. Leave ALL changes UNCOMMITTED for re-validation. If the deepening is fundamentally unsound, set ok:false so the loop reverts as a last resort — but PREFER fixing forward.

Report files_touched (incl. repointed guards), new_module, shims_written, tests_changed, and a concise detail.`
    },
    commitPrompt: (chosen, curImpl, mtag, repairs) => {
      const c = chosen.cand
      const titleLine = c.title.replace(/\s+/g, ' ').slice(0, 60)
      return `A panel-approved architecture deepening was applied to the repo at ${ROOT} (branch ${BRANCH}) and PASSED CI-faithful validation (import smoke + mandated suites + lint, no regressions). Commit it. Anchor with git -C "${ROOT}". NEVER push.

Do:
1. git -C "${ROOT}" status --porcelain (expect the reshaped files + any new module/tests; remove any stray /tmp codemod artifacts).
2. git -C "${ROOT}" add -A
3. git -C "${ROOT}" commit -m "refactor(arch): ${titleLine}

Deepening round ${mtag}: reshaped ${JSON.stringify(c.files)} behind a smaller interface, preserving external contracts via shims. Panel-approved (${chosen.mandate.execution_method}); validated green${repairs > 0 ? ' after ' + repairs + ' repair pass(es)' : ''}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
4. Report the new commit's short hash and files changed.`
    },
  }
}

// ================= Phase: per-file engine (decompose + deepen) =================
// Runs the per-file round loop for ONE file in a given STAGE. decompose carves cohesive symbol
// clusters out of a god-file (lane-planned, line-disjoint slate); deepen reshapes shallow modules /
// leaky seams (whole-file find, file-disjoint slate). Both share the decision panel and the
// applyMemberOnRoot apply pipeline (scope -> oracle -> implement -> validate+repair -> commit/revert
// -> org audit). Returns a per-file summary.
async function processOneFile(ctx, fileIndex, stage) {
  const { TARGET, SHIM_MODULE, DEST_PKG, DEST_PKG_DOTTED, SCOPE_TAG, IMPORT_SMOKE, CONTRACT_CENSUS } = ctx
  // Shadow ROOT so every inline prompt (lane plan, find, panel, chair) targets this file's worktree
  // at K>1; falls back to the global ROOT (K=1 / deepen / organize) — behavior unchanged there.
  const ROOT = ctx.WORKDIR || A.projectDir
  const PANEL = ctx.PANEL
  const D = stage === 'deepen'                                  // deepen vs decompose branch
  const cfg = D ? makeDeepenCfg(ctx) : makeDecomposeCfg(ctx)    // stage-specific apply prompts
  const candKeyFn = D ? candKeyFiles : candKey                  // dedup by files (deepen) or symbols (decompose)
  // The file's own test dir (src/<pkg>/… -> dev/tests/<pkg>) — the MANDATORY validation floor so a
  // change with few/zero direct tests still validates against a fast, BOUNDED, relevant subset.
  const FLOOR = TEST_ROOT + '/' + ((TARGET.split('/')[1]) || '')
  // UNIQUE phase name per (stage, file, round). phase() names MUST be globally unique across the whole
  // run — the stage prefix (DEC/DEEP) + monotonic global file index + round number guarantees it.
  const tag = (D ? 'DEEP F' : 'DEC F') + fileIndex
  const phaseOf = (n) => tag + ' ' + SCOPE_TAG + ' · Iter ' + n
  const rounds = []
  const seen = new Set()
  let convergence = 'max-iterations'
  let linesEnd = ctx.FILE_LINES
  // POOL REUSE state (DECOMPOSE only; see REFIND_EVERY). `pool` caches Strong candidates carried across
  // rounds; `extractedSymbols` accumulates symbols moved since the last find (so pooled candidates whose
  // region has since moved are dropped); `findAge` counts reuse passes since the last fresh find.
  let pool = []
  let findAge = 0
  const extractedSymbols = new Set()
  const candSymbols = (c) => (c.symbols || []).map(s => String(s).toLowerCase())
  // A pooled candidate is "consumed" only when MOST (>50%) of its symbols were already extracted since
  // the find pass — an incidental single shared helper must NOT evict an otherwise-distinct candidate.
  const symbolsConsumed = (c) => {
    const syms = candSymbols(c)
    if (!syms.length) return false
    return candSymbols(c).filter(s => extractedSymbols.has(s)).length * 2 > syms.length
  }
  const markExtracted = (c) => candSymbols(c).forEach(s => extractedSymbols.add(s))
  const rankStrong = (list) => list.filter(c => c.strength === 'Strong')
    .sort((a, b) => (candSpan(b) - candSpan(a)) || ((a.est_blast_radius || 99) - (b.est_blast_radius || 99)))

  // DYNAMIC LANE PLANNER: at the top of each round an Opus agent reads the LIVE target in full and
  // carves it into fresh, non-overlapping concern lanes anchored to where the code sits RIGHT NOW.
  // Falls back to a generic equal-region split (or the explicit `lanes` override) if it yields nothing.
  async function planLanes(n) {
    const plan = await agent(
      `You are the LANE PLANNER for a god-file decomposition loop — file ${TARGET}, round ${n}. The target ${ROOT}/${TARGET} is CONSTANTLY CHANGING: every prior round carved a cohesive cluster out into ${DEST_PKG} and left a thin re-export shim behind, so ANY fixed line map is already stale. Read the ENTIRE current ${TARGET} as it exists RIGHT NOW (use the real file, not memory) and partition it into ${LANE_MIN}-${LANE_MAX} concern LANES that downstream read-only find agents will each mine in parallel for ONE extractable cluster.

Do NOT edit anything. After reading the whole file:
- MAP THE LINE MASS as it stands now — identify the largest current method/function clusters (e.g. run-loop orchestration, a big class's method groups, rendering/streaming, command dispatch, input handling) and whatever free-function regions remain.
- Carve into lanes that are MUTUALLY EXCLUSIVE by line range (no two lanes overlap) and each internally COHESIVE (a single concern a find agent can extract behind a shim).
- LARGEST-FIRST: the loop attacks the biggest carve-outs first, so guarantee the largest remaining concentrations each get a lane. If a single method/cluster is very large (> ${GIANT_LINES} lines), give it its OWN lane and set giant:true so one agent focuses entirely on slicing it into a focused module (staged across rounds if needed).
- SKIP DEAD REGIONS: spend NO lane on any region that is already just thin shims / forwards to ${DEST_PKG}. Those have no cluster left to move. Every lane must point at live, still-embedded code.
- Prefer ${LANE_MAX} lanes while the file is large; emit fewer only if there are genuinely fewer distinct live concerns left.

For each lane: key (unique slug), concern, line_range (current, non-overlapping), symbols (names actually in that range now), est_lines, giant. Also report file_lines and a one-paragraph structure_note. Do NOT design the extractions — only the hunting grounds.`,
      { label: 'plan-lanes:' + tag + '.' + n, phase: phaseOf(n), agentType: 'Explore', schema: LANE_PLAN_SCHEMA, model: M_KEY }
    )
    const fallback = STATIC_OVERRIDE ? A.lanes : genericFallbackLanes(linesEnd, LANE_MAX)
    if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length < 2) {
      log(tag + ' round ' + n + ': lane planner returned nothing usable — falling back to ' + fallback.length + ' ' + (STATIC_OVERRIDE ? 'explicit' : 'generic equal-region') + ' lanes')
      return fallback
    }
    if (Number.isFinite(plan.file_lines)) linesEnd = plan.file_lines
    const lanes = plan.lanes
      .slice()
      .sort((a, b) => (b.est_lines || 0) - (a.est_lines || 0))
      .map(L => ({
        key: L.key,
        hint: L.concern
          + ' — current lines ~' + L.line_range
          + (Array.isArray(L.symbols) && L.symbols.length ? ' (symbols present now: ' + L.symbols.join(', ') + ')' : '')
          + (L.giant ? '. This is a GIANT cluster: propose the cleanest single module carve-out that makes the biggest dent — staging across rounds is fine, but pick the largest cohesive leaf that moves safely THIS round.' : ''),
      }))
    log(tag + ' round ' + n + ': planned ' + lanes.length + ' lanes from live ' + TARGET + ' (' + (plan.file_lines || '?') + ' lines) → ' + lanes.map(l => l.key).join(', '))
    return lanes
  }

  // --- per-file round loop ---
  for (let n = 1; n <= MAX_ITERS; n++) {
    if (budget.total && budget.remaining() < BUDGET_FLOOR) {
      convergence = 'budget-exhausted'
      log(tag + ' stopping before round ' + n + ': ~' + Math.round(budget.remaining() / 1000) + 'k tokens left, below floor of ' + Math.round(BUDGET_FLOOR / 1000) + 'k')
      break
    }

    phase(phaseOf(n))

    // --- 1. FIND or REUSE the candidate POOL (read-only) ---
    // A fresh plan+find pass (lane plan + parallel find), wrapped so DECOMPOSE can REUSE its leftover
    // Strong candidates across rounds (pool) instead of re-finding every round. Returns {strong, fresh, rawCount}.
    const findStrong = async () => {
    const CONV_FIND = ctx.CONVENTIONS ? ('\n\nREPO ORGANIZATION CONVENTIONS — any NEW module you propose must land in a convention-correct home (an existing/justified subpackage), NOT a loose flat sibling in an already-large directory:\n' + ctx.CONVENTIONS) : ''
    let laneFindings
    if (D) {
      // DEEPEN: a single whole-file find over the anchor module + its collaborators (no lane planning).
      laneFindings = [await agent(
        `You are running the EXPLORE step of the improve-codebase-architecture skill (read-only) anchored on ${ROOT}/${TARGET} (~${linesEnd} lines) and the modules it collaborates with in src/${(TARGET.split('/')[1]) || ''}. Do NOT edit anything.

FIRST read the skill's vocabulary so every suggestion uses it exactly:
- ${SKILL_DIR}/SKILL.md (process)
- ${SKILL_DIR}/LANGUAGE.md (module / interface / implementation / depth / seam / adapter / leverage / locality — use these, NOT "component/service/API/boundary")
- ${SKILL_DIR}/DEEPENING.md (dependency categories: in-process / local-substitutable / remote-owned / true-external)
If a CONTEXT.md or docs/adr/ exists at ${ROOT}, read the parts touching this area and do NOT re-suggest anything an ADR already settled.

THIS STAGE IS ARCHITECTURAL DEEPENING (not god-file splitting): read ${TARGET} and the modules around it organically and note where you experience friction. Look for DEEP-able shallow modules:
- understanding one concept requires bouncing between many small modules,
- a module whose interface is nearly as complex as its implementation,
- pure functions extracted only for testability where the real bugs hide in how they're called (no locality),
- tightly-coupled modules leaking across their seams,
- parts hard to test through their current interface.

Apply the DELETION TEST to anything you suspect is shallow: would deleting the module concentrate complexity across N callers (earning its keep) or just move it (pass-through)? Report the result per candidate. Rate \`strength\` purely on the DELETION-TEST signal and depth/leverage gain (Strong = a genuine deepening where complexity provably concentrates), regardless of difficulty or blast radius. Set est_blast_radius honestly. If a candidate creates a NEW module, propose a convention-correct path and justify it in placement_rationale. Fill the schema per candidate: title, files, problem, solution, benefits, strength, dependency_category, deletion_test, est_blast_radius, placement_rationale. Return [] if this area is already well-factored. Do NOT propose concrete interfaces yet — just the candidate.${CONV_FIND}`,
        { label: 'find:' + tag, phase: phaseOf(n), agentType: 'Explore', schema: FIND_SCHEMA_DEEPEN, model: M_MECH }
      )]
    } else {
      // DECOMPOSE: fan out over INTRA-FILE concern lanes of this god-file.
      const lanes = LANE_PLAN ? await planLanes(n) : (STATIC_OVERRIDE ? A.lanes : genericFallbackLanes(linesEnd, LANE_MAX))
      log(tag + ' round ' + n + ': finding extractions (read-only fan-out across ' + lanes.length + ' concern lanes of ' + TARGET + ')')
      laneFindings = await parallel(lanes.map((lane) => () =>
        agent(
          `You are running the EXPLORE step of the improve-codebase-architecture skill (read-only) over ONE concern within a single god-file: ${ROOT}/${TARGET} (~${linesEnd} lines). Do NOT edit anything. Your concern lane is **${lane.key}**:
${lane.hint}

FIRST read the skill vocabulary so suggestions use it exactly:
- ${SKILL_DIR}/SKILL.md (process)
- ${SKILL_DIR}/LANGUAGE.md (module / interface / seam / adapter / leverage / locality)
- ${SKILL_DIR}/DEEPENING.md (dependency categories; the two-adapter rule)

THIS LOOP'S GOAL is GOD-FILE DECOMPOSITION: ${TARGET} mixes many concerns in one large file, which is hard to navigate. A good candidate EXTRACTS a cohesive cluster of symbols (the ones in your lane hint, confirmed against the REAL current file) into a focused new module under ${DEST_PKG}, leaving re-export shims at the old ${SHIM_MODULE}.<name> paths so nothing downstream breaks. The win is LOCALITY/NAVIGABILITY (one concern in one place), which is a VALID direction here even if the moved code gains no new leverage — UNLIKE a pure deepening loop.

Read the real file region for your lane and confirm:
- the EXACT symbol names + current line range that form a cohesive, self-contained cluster,
- a navigability DELETION TEST: after extraction, is the concept MORE local (one module) or just scattered across more files you must bounce between? Only the former earns "Strong".
- COHESION: what (if anything) ties the cluster back to code that stays in ${TARGET}, and whether a clean seam (cross-module import or lazy import) handles it. A cluster entangled with code that stays is NOT cohesive — say so and rate it lower.
- which symbols appear in \`patch("${SHIM_MODULE}.X")\` test sites or \`from ${SHIM_MODULE} import X\` (grep dev/tests and src) — these need careful shims + seams.

This loop pursues improvement by ARCHITECTURAL MERIT (locality), not ease. Do NOT down-rank a candidate for being large, cross-cutting, or hard — a decision panel designs the safe path (codemod, staging, characterization nets). Rate \`strength\` purely on the navigability-deletion-test signal and cohesion (Strong = a genuinely cohesive cluster with a clean seam whose extraction makes the concept local). Set est_blast_radius honestly (import + patch sites). Fill the schema per candidate: title, symbols, line_range, dest_module (under ${DEST_PKG}, convention-correct per the conventions below), placement_rationale, problem, solution (incl. the shim left behind), benefits (locality + how tests improve), strength, deletion_test, cohesion_note, est_blast_radius, patched_symbols. Return [] if your lane has no cohesive extractable cluster (e.g. it's already a thin shim block, or too entangled to split cleanly). Do NOT design the new module's internals yet — just the candidate.${CONV_FIND}`,
          { label: 'find:' + tag + ':' + lane.key, phase: phaseOf(n), agentType: 'Explore', schema: FIND_SCHEMA, model: M_MECH }
        )
      ))
    }

    const allCands = laneFindings.filter(Boolean).flatMap(r => (r.candidates || []))
    const fresh = []
    for (const c of allCands) {
      const k = candKeyFn(c)
      if (seen.has(k)) continue
      if (fresh.some(f => candKeyFn(f) === k)) continue
      fresh.push(c)
    }
    // Strong = a real win by the deletion test. DECOMPOSE ranks largest-carve-out-first (span of
    // line_range desc, smaller blast radius as tie-break); DEEPEN ranks smallest-blast-radius-first
    // so safe leaves land early and bigger arcs stage across rounds.
    const strong = D
      ? fresh.filter(c => c.strength === 'Strong').sort((a, b) => (a.est_blast_radius || 99) - (b.est_blast_radius || 99))
      : fresh.filter(c => c.strength === 'Strong').sort((a, b) => (candSpan(b) - candSpan(a)) || ((a.est_blast_radius || 99) - (b.est_blast_radius || 99)))
    return { strong, fresh, rawCount: allCands.length }
    }

    // POOL REUSE (decompose only): feed this round from the cached pool when it can still form a batch
    // and REFIND_EVERY reuse passes have not elapsed; otherwise run a fresh plan+find and refill the pool.
    let strong = [], lastFind = null
    if (!D && pool.length && findAge < REFIND_EVERY) {
      const before = pool.length
      pool = pool.filter(c => !seen.has(candKey(c)) && !symbolsConsumed(c))
      strong = rankStrong(pool)
      log(tag + ' round ' + n + ': pool ' + before + ' cached → ' + pool.length + ' viable after dropping burned/consumed (' + strong.length + ' Strong)')
    }
    if (!D && strong.length) {
      // REUSE: skip plan+find. Line ranges have drifted since the find, so flag them approximate —
      // downstream panel/scope/implement agents locate symbols by NAME, not line number.
      findAge++
      strong.forEach(c => { c._approxRange = true })
      log(tag + ' round ' + n + ': REUSING pooled candidates — ' + strong.length + ' Strong still viable (reuse ' + findAge + '/' + REFIND_EVERY + '; skipped plan+find)')
    } else {
      lastFind = await findStrong()
      strong = lastFind.strong
      if (!D) { pool = strong.slice(); findAge = 0; extractedSymbols.clear() }
      log(tag + ' round ' + n + ' find: ' + lastFind.rawCount + ' raw, ' + lastFind.fresh.length + ' fresh, ' + strong.length + ' Strong (eligible)' + (!D ? '; pool refilled' : ''))
    }

    if (strong.length === 0) {
      convergence = (lastFind && lastFind.fresh.length === 0) ? 'converged' : 'no-strong-candidates'
      rounds.push({ round: n, stage: 'find', raw: lastFind ? lastFind.rawCount : 0, fresh: lastFind ? lastFind.fresh.length : 0, strong: 0,
        note: (lastFind && lastFind.fresh.length === 0) ? (D ? 'no deepening opportunities left around ' + TARGET : 'no cohesive extractions left — ' + TARGET + ' is as decomposed as this loop can take it') : 'only Worth-exploring/Speculative candidates remain — not auto-implementable',
        remaining_candidates: (lastFind ? lastFind.fresh : []).map(c => ({ title: c.title, strength: c.strength, symbols: c.symbols, files: c.files })) })
      log(tag + ' round ' + n + ': CONVERGED (' + convergence + ') — nothing left to auto-implement.')
      break
    }

    // Select the slate we will deliberate on AND land this round. DECOMPOSE: a giant carve-out lands
    // solo, else up to BATCH_MAX line-disjoint. DEEPEN: up to BATCH_MAX file-disjoint deepenings.
    const slate = D ? pickDisjointBatch(strong, BATCH_MAX) : selectBatch(strong)
    // --- 2. PANEL: deliberate on the batch slate IN PARALLEL (lenses + chair each) ---
    log(tag + ' round ' + n + ': slate of ' + slate.length + '/' + strong.length + ' Strong -> convening ' + slate.length + ' panel(s) in parallel (' + PANEL.length + ' lenses + chair each' + (!D && slate.length === 1 && candSpan(slate[0]) >= GIANT_LINES ? '; GIANT solo' : '') + ')')
    const deliberate = (cand) => async () => {
      const candBlock = D
        ? `Candidate (deepening anchored on ${TARGET}):
  title: ${cand.title}
  files: ${JSON.stringify(cand.files)}
  problem: ${cand.problem}
  solution: ${cand.solution}
  benefits: ${cand.benefits || '(none stated)'}
  dependency_category: ${cand.dependency_category}
  deletion_test: ${cand.deletion_test}
  est_blast_radius: ${cand.est_blast_radius}`
        : `Candidate (extraction from ${TARGET}):
  title: ${cand.title}
  symbols: ${JSON.stringify(cand.symbols)}
  line_range: ${cand.line_range}${cand._approxRange ? ' (APPROXIMATE — reused pooled candidate; the file has drifted since the find, so locate the symbols by NAME, not these line numbers)' : ''}
  dest_module: ${cand.dest_module}
  problem: ${cand.problem}
  solution: ${cand.solution}
  benefits: ${cand.benefits || '(none stated)'}
  deletion_test: ${cand.deletion_test}
  cohesion_note: ${cand.cohesion_note || '(none stated)'}
  patched_symbols: ${JSON.stringify(cand.patched_symbols || [])}
  est_blast_radius: ${cand.est_blast_radius}`
      const votes = (await parallel(PANEL.map((p) => () =>
        agent(
          `You are the **${p.role}** on a decision panel ruling on whether an automated loop should ${D ? 'implement an architecture DEEPENING anchored on ' + TARGET : 'EXTRACT a cohesive cluster out of the god-file ' + TARGET + ' into a focused module'}, UNATTENDED, this round. You own exactly ONE lens — judge only through it; trust fellow panelists on theirs. READ THE ACTUAL ${D ? 'FILES the candidate names' : 'FILE (' + ROOT + '/' + TARGET + ', the named line range)'} and grep the import/patch sites before voting; do not trust the candidate's self-description.

${candBlock}

YOUR LENS — ${p.role}:
${p.brief}

${p.hardVeto
  ? 'You hold a HARD VETO: if your lens finds a non-negotiable blocker (false premise, or an inherent contract break no shim can fix), set vote:"veto" AND hard_veto:true — no majority can override it.'
  : 'You do NOT hold a hard veto. Set hard_veto:false. A serious concern is vote:"veto" (soft) — the chair weighs it.'}

Set confidence (0..1) after reading the file. Put concrete preconditions in required_safeguards (shims, characterization "patch-still-bites" tests, execution mechanism) and importable names/behaviours that must not change in behavior_invariants. Cite file:line where you can.`,
          { label: 'panel:' + tag + ':' + p.role.split(' ')[0].toLowerCase() + ':' + cand.title.slice(0, 14).replace(/\s+/g, '-'), phase: phaseOf(n), schema: PANELIST_SCHEMA, model: p.hardVeto ? M_KEY : M_MECH }
        )
      ))).filter(Boolean)

      const hardVetoed = votes.some(v => v.vote === 'veto' && v.hard_veto)
      const tally = {
        approve: votes.filter(v => v.vote === 'approve').length,
        concerns: votes.filter(v => v.vote === 'concerns').length,
        veto: votes.filter(v => v.vote === 'veto').length,
      }
      const tallyStr = tally.approve + ' approve, ' + tally.concerns + ' concerns, ' + tally.veto + ' veto'
      // Keep the chair's INPUT small — a bloated dossier is what made Opus return empty/malformed
      // (HTTP 200) through the gateway. Cap each rationale, dedup safeguards/invariants, cap counts.
      const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s }
      const safeguards = Array.from(new Set(votes.flatMap(v => v.required_safeguards || []))).slice(0, 24)
      const invariants = Array.from(new Set(votes.flatMap(v => v.behavior_invariants || []))).slice(0, 16)
      const dossier = votes.map(v => `- ${v.role} [${v.vote}${v.hard_veto ? ', HARD VETO' : ''}, conf=${v.confidence ?? '?'}]: ${clip(v.rationale, 500)}`).join('\n')

      let chair
      let chairFailed = false
      if (hardVetoed) {
        chair = { decision: 'reject', tally: tallyStr, rationale: 'Hard veto from a non-negotiable lens (Premise Auditor or Contract Guardian).', dissent: '' }
      } else {
        // Retry the chair: a null return is a transient API failure, not a verdict.
        for (let attempt = 1; attempt <= CHAIR_TRIES && !chair; attempt++) {
          chair = await agent(
          `You are the CHAIR of a decision panel for ${D ? 'an architecture DEEPENING anchored on ' + TARGET : 'decomposing the god-file ' + TARGET} in the repo at ${ROOT}, operating in AUTONOMOUS mode. The panel deliberated on the candidate below; no HARD VETO was cast. ${D ? 'PURSUE the deepening if it is the RIGHT DIRECTION (genuinely more leverage at a smaller interface — the deletion test concentrates complexity)' : 'PURSUE the extraction if it is the RIGHT MOVE (a cohesive cluster whose extraction improves locality/navigability)'} — regardless of difficulty — and design the CORRECT PATH to land it safely, rather than rejecting because it is hard.

DECIDE FROM THE DOSSIER BELOW — do NOT read files, run grep/Bash, or otherwise re-explore the repo. The six panelists already verified against the real ${D ? 'files' : 'file'}; their findings are summarized below and that is your evidence base. Respond in ONE shot with the structured decision only (no tool calls, no exploration). Re-reading the repo here bloats context and makes the response fail — keep it to the single structured verdict.

${candBlock}

PANEL VOTES (${tallyStr}):
${dossier}

SAFEGUARDS / PLAN FRAGMENTS the panel demanded (shims, characterization tests, ${D ? 'decomposition stages, ' : 'decomposition stages, '}execution mechanism):
${safeguards.length ? safeguards.map(s => '  - ' + s).join('\n') : '  (none)'}
BEHAVIOUR INVARIANTS / importable names to preserve:
${invariants.length ? invariants.map(s => '  - ' + s).join('\n') : '  (none)'}
${ctx.CONVENTIONS ? '\nREPO ORGANIZATION CONVENTIONS — if the mandate creates a NEW module, set mandate.dest_module to a convention-correct home (an existing/justified subpackage, NOT a loose flat sibling in an already-large directory) and explain it in mandate.dest_placement_rationale; set mandate.new_subpackage_init:true if a new subpackage __init__.py is needed:\n' + ctx.CONVENTIONS + '\n' : ''}
DECISION RULE (autonomous, ${D ? 'deepening' : 'decomposition'} mode):
- decision:"implement" is the DEFAULT. Difficulty, large blast radius, hard-to-test behaviour, or "an unattended agent might struggle" are NOT reasons to reject — they are reasons to design a safer PATH (${D ? 'stage across rounds, add characterization nets, hold contracts via shims' : 'codemod the slice, stage across rounds, add characterization "patch-still-bites" nets, hold the surface via shims'}).
- decision:"reject" ONLY when: (a) the ${D ? 'Deepening' : 'Decomposition'} Steward establishes WRONG DIRECTION — ${D ? 'pure rename/indirection/file-move with NO real depth or locality gain' : 'the move scatters a concept across more files than before (worse navigability) or fabricates a speculative one-adapter port (indirection, not locality)'}, or (b) a lens shows the change INHERENTLY cannot preserve ${TARGET}'s external ${D ? 'behaviour/contracts' : 'surface'} by ANY path (almost never — a shim/adapter fixes it). A soft-veto for size/difficulty is NOT grounds to reject; absorb it into the plan.
- This round lands a small BATCH of ${D ? 'file-disjoint deepenings' : 'line-disjoint extractions'} and this candidate is ONE of them${D ? '' : ' (a giant lands solo)'}; judge it on its own merits and be decisive about ITS single best path.

When implementing, fill the FULL mandate:
${D
  ? '- mandate.shims_required (every old import path that must keep resolving), mandate.characterization_tests_required (golden-master at the EXISTING interface BEFORE refactoring), mandate.behavior_invariants, mandate.validation_dirs (full dev/tests/<sub> dirs that must stay green).\n- mandate.execution_method — "programmatic"/"hybrid" by default (scripted/AST, never hand-retype a large file); "manual" only for small localized changes; "staged" when too large for one round.\n- mandate.execution_plan — ordered concrete steps naming the exact mechanism (git mv / ast|libcst codemod / scripted import rewrite). If the deepening creates a NEW module, place it in a convention-correct home.'
  : '- mandate.dest_module (convention-correct under ' + DEST_PKG + ', NOT a loose flat sibling), mandate.dest_placement_rationale, mandate.new_subpackage_init, mandate.shims_required (EVERY ' + SHIM_MODULE + '.<name> that must keep resolving), mandate.characterization_tests_required (esp. "patch(\\"' + SHIM_MODULE + '.X\\") still bites" for every patched symbol), mandate.behavior_invariants.\n- mandate.execution_method — "programmatic"/AST codemod by DEFAULT (never hand-retype a slice of a large file); "manual" only for a few short helpers; "staged" when the cluster is too tangled for one round.\n- If "staged": mandate.this_round_scope = the SINGLE bounded sub-cluster to move THIS round; mandate.deferred_stages = the rest. The loop re-finds and continues next round.\n- mandate.execution_plan — ordered concrete steps naming the exact mechanism (ast/libcst slice of the named symbols out of ' + TARGET + '; write the new module; write the re-export shim block back into ' + TARGET + '; rewrite cross-module imports; run the throwaway codemod via `uv run python` then delete it).'}
Always record the strongest dissent, even when overruled.`,
          { label: 'chair:' + tag + ':' + cand.title.slice(0, 18).replace(/\s+/g, '-') + (attempt > 1 ? '#' + attempt : ''), phase: phaseOf(n), schema: CHAIR_SCHEMA, model: (attempt < CHAIR_TRIES ? M_CHAIR : M_CHAIR_FALLBACK) }
          )
          if (!chair && attempt < CHAIR_TRIES) log(tag + ' round ' + n + ': chair for "' + cand.title + '" returned empty/null (' + M_CHAIR + ' gateway blip) — retry ' + (attempt + 1) + '/' + CHAIR_TRIES + (attempt + 1 === CHAIR_TRIES ? ' on fallback ' + M_CHAIR_FALLBACK : ''))
        }
        // Chair still down after retries: a transient infra failure must not masquerade as a reject.
        if (!chair) {
          chairFailed = true
          if (tally.veto === 0 && tally.approve > tally.concerns) {
            log(tag + ' round ' + n + ': chair unavailable after ' + CHAIR_TRIES + ' tries for "' + cand.title + '" — panel ' + tallyStr + ', no veto → proceeding on consensus.')
            chair = { decision: 'implement', tally: tallyStr, rationale: 'Chair unavailable (transient API failure); panel majority approved with no veto — proceeding on consensus. Implementer + targeted validation + revert-on-red are the safety net.', dissent: '', mandate: {} }
          } else {
            log(tag + ' round ' + n + ': chair unavailable after ' + CHAIR_TRIES + ' tries for "' + cand.title + '" and panel not a clean approve (' + tallyStr + ') — deferring, NOT rejecting.')
            chair = { decision: 'reject', tally: tallyStr, rationale: 'Chair unavailable (transient API failure) and panel not a clean majority-approve; deferred this round rather than implemented.', dissent: '' }
          }
        }
      }

      const decision = (chair && chair.decision === 'implement') ? 'implement' : 'reject'
      let mandate = null
      if (decision === 'implement') {
        const m = (chair.mandate || {})
        mandate = {
          dest_module: m.dest_module || cand.dest_module || '',
          dest_placement_rationale: m.dest_placement_rationale || cand.placement_rationale || '',
          new_subpackage_init: m.new_subpackage_init === true,
          validation_dirs: (m.validation_dirs && m.validation_dirs.length ? m.validation_dirs : (D ? testDirsForFiles(cand.files) : [])),
          shims_required: m.shims_required || [],
          characterization_tests_required: m.characterization_tests_required || [],
          behavior_invariants: (m.behavior_invariants && m.behavior_invariants.length ? m.behavior_invariants : invariants),
          execution_method: m.execution_method || 'programmatic',
          execution_plan: m.execution_plan || [],
          this_round_scope: m.this_round_scope || '',
          deferred_stages: m.deferred_stages || [],
          chair_rationale: chair.rationale,
          dissent: chair.dissent,
        }
      }
      return {
        cand, decision, mandate, hardVetoed, chairFailed,
        log: { candidate: cand.title, tally: tallyStr, hard_veto: hardVetoed, chair_failed: chairFailed, decision, dissent: chair ? chair.dissent : '' },
      }
    }

    const verdicts = (await parallel(slate.map(deliberate))).filter(Boolean)
    const panelLog = verdicts.map(v => v.log)
    // Decide every candidate; burn them all (a staged approval that is CHOSEN gets un-burned below).
    verdicts.forEach(v => seen.add(candKeyFn(v.cand)))
    const approved = verdicts.filter(v => v.decision === 'implement')
    log(tag + ' round ' + n + ' panels done: ' + approved.length + ' approved, ' + (verdicts.length - approved.length) + ' rejected.')

    if (approved.length === 0) {
      // Distinguish a genuine architectural rejection from a slate where the chair never returned.
      const allChairFailed = verdicts.length > 0 && verdicts.every(v => v.chairFailed)
      convergence = allChairFailed ? 'chair-unavailable' : 'panel-rejected-all'
      rounds.push({ round: n, stage: 'panel', strong: strong.length, slate: slate.length,
        note: allChairFailed
          ? 'NO architectural verdict reached: the chair (Opus) failed to respond for every slate candidate after ' + CHAIR_TRIES + ' tries — a transient API failure, NOT clean-seam exhaustion. Re-run to retry; strong candidates remain.'
          : 'the decision panel rejected every candidate on the batch slate (the largest/best disjoint carve-outs) — clean-seam exhaustion',
        panel: panelLog })
      log(tag + ' round ' + n + ': STOP — ' + (allChairFailed ? 'chair unavailable for the whole slate (API failure) — re-run to retry.' : 'the panel rejected the whole slate. Surfaced for human review.'))
      break
    }

    // --- 2b. APPLY THE BATCH — giants solo, else up to BATCH_MAX disjoint. Each member commits
    // independently; a member that reds is reverted ALONE and the rest stand. Un-burn staged
    // approvals so the next stage of a staged carve-out is re-found in a later round.
    approved.forEach(a => { if (a.mandate.execution_method === 'staged' && a.mandate.deferred_stages.length) seen.delete(candKeyFn(a.cand)) })
    log(tag + ' round ' + n + ': landing ' + approved.length + ' approved ' + (D ? 'deepening(s)' : 'extraction(s)') + ' sequentially' + (approved.length > 1 ? ' (batch)' : '') + '.')
    let stop = false, landed = 0
    for (let bi = 0; bi < approved.length; bi++) {
      const chosen = approved[bi]
      const mtag = tag + '.' + n + '.' + (bi + 1)
      log('Round ' + mtag + ': applying "' + chosen.cand.title + '"' + (chosen.mandate.dest_module ? ' -> ' + chosen.mandate.dest_module : '') + ' (method=' + chosen.mandate.execution_method + '; member ' + (bi + 1) + '/' + approved.length + ')')
      // The shared apply pipeline (scope -> oracle -> implement -> validate+repair -> commit/revert
      // -> org audit). Stage-specific prompts come from cfg (makeDecomposeCfg / makeDeepenCfg).
      const r = await applyMemberOnRoot({ stage, ctx, chosen, mtag, phaseOf, n, FLOOR, rounds, panelLog, cfg })
      if (r.committed) { landed++; if (Number.isFinite(r.newLines)) linesEnd = r.newLines; if (!D) markExtracted(chosen.cand) }
      if (r.stopFile) { if (r.convergence) convergence = r.convergence; stop = true; break }
    }
    if (stop) break
    if (landed === 0) log(tag + ' round ' + n + ': no batch member landed — re-finding (burned candidates are excluded next pass).')
  }

  const applied = rounds.filter(r => r.validated)
  return {
    target: TARGET, shim_module: SHIM_MODULE, dest_pkg: DEST_PKG,
    convergence, rounds_run: rounds.length, extractions_applied: applied.length,
    lines_start: ctx.FILE_LINES, lines_end: linesEnd,
    applied: applied.map(r => ({ round: r.member || r.round, candidate: r.candidate, new_module: r.new_module, execution_method: r.execution_method, commit: r.commit, target_lines_after: r.target_lines_after })),
    rounds,
  }
}

// ================= runFile: per-file context + engine for one (stage, file) =================
const WRITE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'path'],
  properties: { ok: { type: 'boolean' }, path: { type: 'string' }, bytes: { type: 'number' }, detail: { type: 'string' } },
}
// Pure-JS UTF-8 -> base64 (no Buffer/btoa in the workflow sandbox). Used to persist large plans: base64 is
// pure single-byte ASCII, so an agent transcribing a fragment cannot hit the multi-byte counting drift that
// breaks exact char/byte gating on raw JSON (box-drawing glyphs, → arrows). `base64 -d` on disk is itself a
// hard integrity gate, with JSON.parse + move-count as the final encoding-agnostic check.
function toBase64Utf8(str) {
  const uri = encodeURIComponent(str)
  const bytes = []
  for (let i = 0; i < uri.length; i++) {
    if (uri[i] === '%') { bytes.push(parseInt(uri.substr(i + 1, 2), 16)); i += 2 }
    else bytes.push(uri.charCodeAt(i))
  }
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = '', i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const num = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += T[(num >> 18) & 63] + T[(num >> 12) & 63] + T[(num >> 6) & 63] + T[num & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) { const num = bytes[i] << 16; out += T[(num >> 18) & 63] + T[(num >> 12) & 63] + '==' }
  else if (rem === 2) { const num = (bytes[i] << 16) | (bytes[i + 1] << 8); out += T[(num >> 18) & 63] + T[(num >> 12) & 63] + T[(num >> 6) & 63] + '=' }
  return out
}
const processed = { decompose: new Set(), deepen: new Set() }  // per-stage worklist memory (a file can be a decompose target AND a deepen anchor)
const fileResults = []           // engine-stage (decompose/deepen) per-file summaries
const orgResults = []            // organize-stage pass summaries
let globalFileIndex = 0          // monotonic across stages -> phase-name uniqueness
let orgPass = 0

// ---- Concurrent-decompose worktree lifecycle (no-ops unless isolate=true) ----
// MERGE MUTEX: merges into the base BRANCH must be serialized (one checkout, one history). Each file's
// merge-back chains onto this promise so only one runs at a time even with FILE_CONCURRENCY workers.
let mergeLock = Promise.resolve()
const withMergeLock = (fn) => { const run = mergeLock.then(fn, fn); mergeLock = run.then(() => {}, () => {}); return run }
const retryQueue = []            // merge-conflict re-enqueues (re-run FRESH on the updated base)
const retryCount = new Map()     // target -> times re-enqueued after a merge conflict

// Create an ISOLATED checkout for one file on a child branch, with its OWN uv env. Returns the working
// dir / branch / protected-untracked block the engine is parameterized on. No-op (returns globals)
// unless isolate.
async function bringUpWorktree(d, fileIndex, isolate) {
  if (!isolate) {
    return { ok: true, env_ready: true, isolated: false, workdir: ROOT, fileBranch: BRANCH, protectedBlock: PROTECTED_BLOCK }
  }
  const wpath = worktreePathFor(d), cbranch = childBranchFor(d)
  const setupPhase = 'DEC F' + fileIndex + ' ' + d.scopeTag + ' · Setup'
  phase(setupPhase)
  const res = await agent(
    `Create an ISOLATED git worktree so this god-file can be decomposed WITHOUT colliding with other files being decomposed concurrently in their own worktrees. The MAIN repo is at ${ROOT} (base branch ${BRANCH}); anchor every git command as shown and do NOT touch ${ROOT}'s own working tree.

Do, in order:
1. Create the worktree on a NEW child branch off the CURRENT base HEAD (so it starts from all prior merged work). Use the EXACT branch name and path below — the loop's merge-back and teardown look the branch up by this exact name, so you MUST NOT substitute a different name, prefix, or separator:
   git -C "${ROOT}" worktree add -b "${cbranch}" "${wpath}" "${BRANCH}"
   If it fails because the branch/path already exists from a crashed prior run, clean and retry ONCE with the SAME name:
   git -C "${ROOT}" worktree remove --force "${wpath}" 2>/dev/null; git -C "${ROOT}" branch -D "${cbranch}" 2>/dev/null; then re-run the identical add.
   If the add STILL fails, set ok:false and report the exact git error verbatim. Do NOT invent an alternative branch name to work around an error — a mismatched name silently breaks merge-back.
2. Build the worktree's OWN verification env — it starts with NO .venv, and validation MUST run against THIS worktree's edited source, so it CANNOT reuse ${ROOT}'s .venv (whose editable .pth hardcodes ${ROOT}/src):
   bash -c 'cd "${wpath}" && ${ENV_SETUP}'
3. ASSERT ISOLATION (load-bearing): the worktree's editable install must point at the WORKTREE's src, not ${ROOT}/src:
   bash -c 'cd "${wpath}" && cat .venv/lib/python*/site-packages/__editable__.*.pth'
   The printed path MUST start with ${wpath}/src. If it shows ${ROOT}/src (or no .venv was made), set env_ready:false and explain — validating against ROOT's source would green broken extractions.
4. Capture the worktree's OWN protected untracked set: git -C "${wpath}" ls-files --others --directory → protected_untracked.

NEVER run \`git clean\`. NEVER push. Report ok (worktree exists on the child branch), env_ready (own .venv whose .pth points at the worktree src), worktree_path, branch, protected_untracked, detail.`,
    { label: 'worktree:F' + fileIndex, phase: setupPhase, schema: WORKTREE_SETUP_SCHEMA, model: M_COORD }
  )
  if (!res || !res.ok) return { ok: false, env_ready: false, detail: res ? res.detail : 'no result' }
  const protectedBlock = (res.protected_untracked && res.protected_untracked.length)
    ? 'PROTECTED untracked paths (pre-existed in this worktree — deleting any is data loss, OFF-LIMITS):\n' + res.protected_untracked.map(p => '  - ' + p).join('\n')
    : 'PROTECTED untracked paths: (none recorded)'
  return { ok: true, env_ready: res.env_ready !== false, isolated: true, workdir: res.worktree_path || wpath, fileBranch: cbranch, protectedBlock }
}

// Serialized merge of a converged file's child branch back onto the base BRANCH. No-op at !isolate
// (the per-extraction commits already landed directly on BRANCH).
async function mergeBack(d, fileIndex, isolate) {
  if (!isolate) return { merged: true }
  const cbranch = childBranchFor(d)
  const mergePhase = 'DEC F' + fileIndex + ' ' + d.scopeTag + ' · Merge'
  return await withMergeLock(async () => {
    phase(mergePhase)
    const res = await agent(
      `Merge a CONVERGED god-file decomposition branch into the base branch, in the MAIN repo at ${ROOT}. Anchor every command with git -C "${ROOT}". This step is serialized — you are the only merge running right now.

Do, in order:
1. git -C "${ROOT}" checkout "${BRANCH}"
2. git -C "${ROOT}" merge --no-ff "${cbranch}" -m "merge(optimize-codebase): ${d.target} decomposition"
3. If the merge SUCCEEDS cleanly: set merged:true and report the merge commit short hash (git -C "${ROOT}" rev-parse --short HEAD) in merge_commit.
4. If the merge CONFLICTS: do NOT attempt to resolve it. Capture the conflicting paths (git -C "${ROOT}" diff --name-only --diff-filter=U), then git -C "${ROOT}" merge --abort (this restores ${BRANCH} exactly as it was), set merged:false, and list those paths in conflicts.
NEVER run \`git clean\`. NEVER push. Report merged, conflicts, merge_commit, detail.`,
      { label: 'merge:F' + fileIndex, phase: mergePhase, schema: MERGE_SCHEMA, model: M_COORD }
    )
    return res || { merged: false, detail: 'merge agent produced no result' }
  })
}

// Remove a finished worktree (and its .venv). keepBranch=true leaves an unmerged branch for a human.
async function teardownWorktree(d, fileIndex, keepBranch, isolate) {
  if (!isolate) return
  const wpath = worktreePathFor(d), cbranch = childBranchFor(d)
  try {
    await agent(
      `Tear down a finished decomposition worktree in the MAIN repo at ${ROOT}. Anchor with git -C "${ROOT}". Do, in order:
1. git -C "${ROOT}" worktree remove --force "${wpath}"   (removes the worktree directory AND its .venv).
2. ${keepBranch ? 'KEEP the branch "' + cbranch + '" — it holds UNMERGED work for human review; do NOT delete it.' : 'git -C "' + ROOT + '" branch -D "' + cbranch + '"   (delete the now-merged child branch).'}
3. git -C "${ROOT}" worktree prune.
NEVER run \`git clean\`. NEVER push. Report ok + detail.`,
      { label: 'teardown:F' + fileIndex, phase: 'DEC F' + fileIndex + ' ' + d.scopeTag + ' · Merge', schema: REVERT_SCHEMA, model: M_COORD }
    )
  } catch (e) {
    log('File ' + fileIndex + ' worktree teardown failed (' + ((e && e.message) ? e.message.slice(0, 80) : 'error') + ') — it will be pruned at the next Setup.')
  }
}

async function runFile(entry, fileIndex, stage) {
  const d = deriveFile(entry.path)
  const isDeepen = stage === 'deepen'
  // Worktree isolation applies ONLY to the concurrent decompose stage; deepen/organize never isolate.
  const isolate = ISOLATE && stage === 'decompose'
  const prefix = isDeepen ? 'DEEP F' : 'DEC F'
  const filePhase = prefix + fileIndex + ' ' + d.scopeTag
  log('=== ' + (isDeepen ? 'Deepen' : 'Decompose') + ' file ' + fileIndex + ': ' + d.target + ' (' + entry.lines + ' lines) → shim ' + d.shimModule + ', dest ' + d.destPkg + (isolate ? ', isolated worktree' : '') + ' ===')
  const errResult = (convergence, extra) => ({
    target: d.target, shim_module: d.shimModule, dest_pkg: d.destPkg, stage, convergence,
    rounds_run: 0, extractions_applied: 0, lines_start: entry.lines, lines_end: entry.lines,
    applied: [], rounds: [], ...(extra || {}),
  })

  // 1. Isolate (or shared-tree at !isolate).
  const wt = await bringUpWorktree(d, fileIndex, isolate)
  if (!wt.ok || !wt.env_ready) {
    log('File ' + fileIndex + ' worktree bring-up unusable (ok=' + (wt && wt.ok) + ', env_ready=' + (wt && wt.env_ready) + ') — skipping. ' + ((wt && wt.detail) || ''))
    if (wt && wt.ok) await teardownWorktree(d, fileIndex, false, isolate)
    const res = errResult('worktree-setup-failed', { error: (wt && wt.detail) || 'bring-up failed' })
    fileResults.push(res)
    return res
  }
  const WORKDIR = wt.workdir
  phase(filePhase)

  // 2. Live contract census — inside the worktree at K>1 (stable, isolated from concurrent merges).
  let census = null
  try {
    census = await agent(
      `Read-only — make NO edits. Compute the import/patch CONTRACT CENSUS for the Python module ${d.shimModule} (file ${WORKDIR}/${d.target}) so a decision panel knows the real blast radius. Use ripgrep from inside the repo (\`bash -c 'cd "${WORKDIR}" && rg …'\`). Count, across BOTH dev/tests/ and src/:
  - total_patch_sites: occurrences of \`patch("${d.shimModule}.\` / \`patch('${d.shimModule}.\` / \`patch.object(${d.shimModule}\` / monkeypatch of names from this module.
  - total_import_sites: occurrences of \`from ${d.shimModule} import \` plus bare \`${d.shimModule}.\` attribute references.
  - src_importers: rough count of DISTINCT files under src/ that import ${d.shimModule}.
  - top_symbols: the ~6 individual symbols of this module that appear most often across those sites, each with its count (e.g. {name:"_cprint", count:74}).

Return your result ONLY via the StructuredOutput tool, using EXACTLY these fields and NO others: total_patch_sites (number, required), total_import_sites (number, required), src_importers (number), top_symbols (array of {name, count}), detail (string). Do NOT add an "answer" field or any prose field — additional properties are REJECTED. Put any one-line narrative in "detail" only. Do NOT edit anything.`,
      { label: 'census:' + prefix.trim() + fileIndex, phase: filePhase, schema: CENSUS_SCHEMA, model: M_COORD }
    )
  } catch (e) {
    log('File ' + fileIndex + ' census failed (' + ((e && e.message) ? e.message.slice(0, 80) : 'error') + ') — using generic census fallback; panelists grep sites themselves.')
  }
  const CONTRACT_CENSUS = censusString(census, d.shimModule)
  log('File ' + fileIndex + ' census: ' + CONTRACT_CENSUS.replace(/\s+/g, ' ').slice(0, 200))
  const ctx = {
    TARGET: d.target, SHIM_MODULE: d.shimModule, DEST_PKG: d.destPkg, DEST_PKG_DOTTED: d.destPkgDotted,
    SCOPE_TAG: d.scopeTag, FILE_LINES: entry.lines, IMPORT_SMOKE: importSmokeFor(d.shimModule),
    CONTRACT_CENSUS, VAL_DIRS_STR: VAL_DIRS.join(', '), CONVENTIONS,
    // Per-file isolation surface the engine is parameterized on (= globals at !isolate).
    WORKDIR: wt.workdir, FILE_BRANCH: wt.fileBranch, PROTECTED_BLOCK: wt.protectedBlock,
  }
  ctx.PANEL = buildPanel(ctx, stage)
  // Mark processed BEFORE running so a hard throw mid-engine cannot make the next discover re-pick
  // this same file forever (per-stage, so a decomposed file is still eligible as a deepen anchor).
  processed[stage].add(d.target)

  // 3. Run the engine (commits land on ctx.FILE_BRANCH inside the worktree at K>1).
  let res
  try {
    res = await processOneFile(ctx, fileIndex, stage)
  } catch (e) {
    res = errResult('errored', { error: String((e && e.message) || e) })
    log('File ' + fileIndex + ' (' + d.target + ') ERRORED mid-engine: ' + (res.error || '').slice(0, 160) + ' — contained; advancing.')
  }

  // 4. Merge the converged child branch back onto BRANCH (serialized). No-op at !isolate.
  const merge = await mergeBack(d, fileIndex, isolate)
  if (merge.merged) {
    await teardownWorktree(d, fileIndex, false, isolate)
    if (isolate) res.merge = { merged: true, merge_commit: merge.merge_commit }
  } else {
    // Conflict (rare): a shared file two files' extractions both touched (e.g. a concern subpackage
    // __init__.py). Re-run THIS file fresh on the now-updated base, bounded by MERGE_RETRIES; on
    // exhaustion keep the branch for a human.
    const k = retryCount.get(d.target) || 0
    if (k < MERGE_RETRIES) {
      retryCount.set(d.target, k + 1)
      await teardownWorktree(d, fileIndex, false, isolate)   // discard branch; re-derived fresh
      processed['decompose'].delete(d.target)                // make the file eligible again
      retryQueue.push({ path: d.target, lines: (Number.isFinite(res.lines_end) ? res.lines_end : entry.lines) })
      res.convergence = 'merge-conflict-retry'
      log('File ' + fileIndex + ' MERGE CONFLICT (' + ((merge.conflicts || []).join(', ') || 'see detail') + ') — re-enqueued FRESH on updated base (retry ' + (k + 1) + '/' + MERGE_RETRIES + ').')
    } else {
      await teardownWorktree(d, fileIndex, true, isolate)    // keep the branch for human review
      res.convergence = 'merge-conflict-unresolved'
      res.unmerged_branch = childBranchFor(d)
      log('File ' + fileIndex + ' MERGE CONFLICT after ' + MERGE_RETRIES + ' retr(ies) — branch ' + childBranchFor(d) + ' kept for human review; NOT merged.')
    }
  }

  fileResults.push(res)
  log('File ' + fileIndex + ' done: ' + d.target + ' ' + res.lines_start + ' -> ' + res.lines_end + ' lines, ' + res.extractions_applied + ' landed, reason=' + res.convergence)
  return res
}

// ================= runOrganizeStage: drive the codebase-organizer skill in a loop =================
// Reuses the recursive-organize loop: plan (read-only) -> persist -> apply (git mv + ref rewrite) ->
// CI verify -> commit -> re-scan, until a plan finds no structural work, the critic flags unsafe, the
// build reds, or the round cap is hit. Runs on the SAME working branch (BRANCH); the apply workflow
// re-asserts a clean tree (Setup already left us clean on BRANCH) and reuses that branch.
async function runOrganizeStage(passIndex) {
  const PLAN_JS = ORGANIZER_SKILL_DIR + '/workflows/organize-plan.js'
  const APPLY_JS = ORGANIZER_SKILL_DIR + '/workflows/organize-apply.js'
  const rounds = []
  let convergence = 'max-iterations'
  for (let n = 1; n <= ORG_MAX_ROUNDS; n++) {
    if (budget.total && budget.remaining() < BUDGET_FLOOR) {
      convergence = 'budget-exhausted'
      log('Organize pass ' + passIndex + ' stopping before round ' + n + ': ~' + Math.round(budget.remaining() / 1000) + 'k tokens left, below floor.')
      break
    }
    const phaseName = 'Org[' + passIndex + '] · Iter ' + n
    phase(phaseName)
    const planPath = ORG_PLAN_DIR + '/plan-pass' + passIndex + '-iter' + n + '.json'
    // --- PLAN (read-only) ---
    log('Organize pass ' + passIndex + ' round ' + n + ': planning (scan + design + ref-impact + critique)' + (pendingOrgFixes.length ? ' [' + pendingOrgFixes.length + ' audit hint(s) pending]' : ''))
    let planResult
    try {
      planResult = await workflow({ scriptPath: PLAN_JS }, { projectDir: ROOT, dateToday: DATE, skillDir: ORGANIZER_SKILL_DIR, depth: ORG_DEPTH, planPath, exclude: ORG_EXCLUDE })
    } catch (e) {
      convergence = 'plan-error'; rounds.push({ round: n, stage: 'plan', error: String(e && e.message || e) })
      log('Organize round ' + n + ' plan workflow threw: ' + String(e && e.message || e)); break
    }
    if (!planResult || planResult.error || !planResult.plan) {
      convergence = 'plan-error'; rounds.push({ round: n, stage: 'plan', error: planResult ? planResult.error : 'no plan returned' })
      log('Organize round ' + n + ' planning failed: ' + (planResult ? planResult.error : 'no result')); break
    }
    const plan = planResult.plan
    const moveCount = (plan.moves || []).length
    const quarantineCount = ((plan.cruft || {}).quarantine || []).length
    const newFileCount = (plan.new_files || []).length
    const verdict = (plan.critique || {}).verdict || 'unknown'
    const actionable = moveCount + quarantineCount + newFileCount
    const droppedUnsafe = ((plan.totals || {}).dropped_unsafe_moves) || (plan.dropped_unsafe_moves || []).length || 0
    log('Organize round ' + n + ' plan: ' + moveCount + ' moves, ' + quarantineCount + ' quarantine, ' + newFileCount + ' new files, verdict=' + verdict + (droppedUnsafe ? ' (' + droppedUnsafe + ' unsafe move(s) dropped by critic)' : ''))
    if (actionable === 0) {
      convergence = 'converged'
      rounds.push({ round: n, stage: 'plan', moves: 0, verdict, note: 'no structural work remaining' })
      log('Organize pass ' + passIndex + ': CONVERGED — organizer found no moves/quarantine/new-files left.')
      pendingOrgFixes.length = 0
      break
    }
    if (verdict === 'unsafe') {
      convergence = 'unsafe-plan'
      rounds.push({ round: n, stage: 'critique', moves: moveCount, verdict, risks: (plan.critique || {}).risks || [] })
      log('Organize round ' + n + ': STOP — critic verdict=unsafe. Not auto-applying.')
      break
    }
    // --- PERSIST the plan to disk (the plan workflow cannot write it itself) ---
    // The plan JSON can be enormous (100+ moves, each with a full ref_impact fan-out -> ~470KB / ~120k
    // tokens). A single agent cannot re-emit that in one Write tool call: it blows past the 64k output-token
    // cap and the round dies with "response exceeded the output token maximum". And raw-JSON chunking can't
    // be exact-count-gated: the plan has multi-byte UTF-8 glyphs (box-drawing ├│└─ in target_tree, → arrows
    // in ref_impact), so `wc -c` != `wc -m` != JS .length and a transcribing agent drifts by a character.
    // FIX: base64-encode the plan in-workflow (pure single-byte ASCII -> all three counts agree exactly),
    // chunk the base64, write each part verbatim, then `cat | base64 -d` on disk. base64 -d is a hard
    // integrity gate (fails loudly on any corruption); JSON.parse + move-count is the final check. A drift
    // fails the round safely instead of feeding a corrupt plan into the mutating apply step.
    const planJson = JSON.stringify(plan)   // compact (no indent) — pretty-print would inflate ~35% for no gain
    const planB64 = toBase64Utf8(planJson)
    const PERSIST_CHUNK = 40000             // base64 chars/chunk (~10-13k tokens) — well under the 64k output cap
    const planParts = []
    for (let i = 0; i < planB64.length; i += PERSIST_CHUNK) planParts.push(planB64.slice(i, i + PERSIST_CHUNK))
    const partPath = (i) => planPath + '.b64.part-' + String(i).padStart(3, '0')
    log('Organize round ' + n + ': persisting plan (' + planJson.length + ' chars -> ' + planB64.length + ' base64) in ' + planParts.length + ' chunk(s)')
    const partWrites = await parallel(planParts.map((chunk, i) => () =>
      agent(
        `Write a fragment of a base64-encoded file to disk. Use the Write tool.
1. First run \`mkdir -p "${ORG_PLAN_DIR}"\` with Bash (idempotent).
2. Write the EXACT characters between the markers below to "${partPath(i)}" — VERBATIM: no edits, no trimming, no added/removed whitespace, no newlines, no commentary. This is a raw base64 fragment that will be concatenated with its siblings and decoded; a single altered/dropped character corrupts the whole file. The content is pure ASCII (A-Z a-z 0-9 + / =), so this is unambiguous — there are no multi-byte characters.

<<<CHUNK_BEGIN
${chunk}
CHUNK_END

3. After writing, report ok:true, the path, and its character count (\`wc -c "${partPath(i)}"\` — for pure-ASCII base64 the byte and character counts are identical). It MUST equal ${chunk.length}; if it does not, set ok:false and explain in detail. Do NOT add a trailing newline (it would change the count).`,
        { label: 'persist-part:' + passIndex + '.' + n + '.' + (i + 1) + '/' + planParts.length, phase: phaseName, schema: WRITE_SCHEMA }
      )
    ))
    const badPart = partWrites.findIndex(r => !r || !r.ok)
    if (badPart !== -1) {
      const pr = partWrites[badPart]
      convergence = 'persist-error'; rounds.push({ round: n, stage: 'persist', error: 'chunk ' + (badPart + 1) + ' failed: ' + (pr ? pr.detail : 'no result') })
      log('Organize round ' + n + ': failed to persist plan chunk ' + (badPart + 1) + '/' + planParts.length); break
    }
    const partList = planParts.map((_, i) => '"' + partPath(i) + '"').join(' ')
    const b64Path = planPath + '.b64'
    const persist = await agent(
      `Assemble, decode, and validate a reorganization plan on disk. The plan was base64-encoded and written as ${planParts.length} ordered fragment file(s); reassemble, decode, and prove it is intact. Use Bash.
1. Concatenate the base64 fragments IN ORDER (no separators, no newlines):
   \`cat ${partList} > "${b64Path}"\`
2. Verify the assembled base64 length: \`wc -c "${b64Path}"\` must report ${planB64.length} (pure ASCII, no trailing newline). If it differs, set ok:false and report both numbers — do NOT proceed.
3. Decode to the final plan. \`base64 -d\` is strict and will error on any corruption:
   \`base64 -d "${b64Path}" > "${planPath}"\` (use \`base64 --decode\` if \`-d\` is unsupported). If decode errors, set ok:false with the error.
4. Verify the decoded plan parses as JSON and the move count matches — the authoritative integrity check:
   \`python3 -c "import json; d=json.load(open('${planPath}')); print('moves', len(d.get('moves', [])))"\`
   It must print \`moves ${moveCount}\`. If it does not parse, or the count differs, set ok:false and report the error.
5. Only if ALL checks pass, delete the scratch files: \`rm -f ${partList} "${b64Path}"\`
6. Report ok:true ONLY when the base64 length is exactly ${planB64.length} AND base64 -d succeeds AND the JSON parses AND moves == ${moveCount}. Put the decoded plan's byte size (\`wc -c "${planPath}"\`) in the \`bytes\` field. Otherwise ok:false with the failing check in detail.`,
      { label: 'persist-assemble:' + passIndex + '.' + n, phase: phaseName, schema: WRITE_SCHEMA }
    )
    if (!persist || !persist.ok) {
      convergence = 'persist-error'; rounds.push({ round: n, stage: 'persist', error: persist ? persist.detail : 'no result' })
      log('Organize round ' + n + ': failed to assemble/validate plan at ' + planPath); break
    }
    // --- APPLY (mutating) + verify ---
    log('Organize round ' + n + ': applying ' + moveCount + ' moves + rewriting refs, then verifying the build')
    let applyResult
    try {
      applyResult = await workflow({ scriptPath: APPLY_JS }, { projectDir: ROOT, dateToday: DATE, skillDir: ORGANIZER_SKILL_DIR, planPath, branch: BRANCH })
    } catch (e) {
      convergence = 'apply-error'; rounds.push({ round: n, stage: 'apply', error: String(e && e.message || e) })
      log('Organize round ' + n + ' apply workflow threw: ' + String(e && e.message || e)); break
    }
    if (!applyResult || applyResult.aborted) {
      convergence = 'apply-aborted'; rounds.push({ round: n, stage: 'apply', aborted: applyResult ? applyResult.aborted : 'unknown', reason: applyResult ? applyResult.reason : 'no result' })
      log('Organize round ' + n + ': apply aborted at ' + (applyResult ? applyResult.aborted : '?') + ' — ' + (applyResult ? applyResult.reason : '')); break
    }
    const verifyPassed = applyResult.verification && applyResult.verification.passed === true
    if (!verifyPassed) {
      convergence = 'verify-failed'
      rounds.push({ round: n, stage: 'verify', moves_applied: applyResult.moved, verification: applyResult.verification, unresolved_references: applyResult.unresolved_references || [] })
      log('Organize round ' + n + ': VERIFY FAILED — halting organize. Changes left UNCOMMITTED on ' + BRANCH + ' for inspection.'); break
    }
    // --- COMMIT the round ---
    const summaryLine = (plan.summary || ('pass ' + passIndex + ' round ' + n + ' reorganization')).replace(/\s+/g, ' ').slice(0, 72)
    const commit = await agent(
      `An automated reorganization round just applied file moves and rewrote references in the repo at ${ROOT} (branch ${BRANCH}); its build/test check PASSED. Commit the round so the next round starts from a clean tree. Anchor git with git -C "${ROOT}". NEVER push.
Do:
1. git -C "${ROOT}" status --porcelain (expect staged renames + edited files; archive/ may hold quarantined files).
2. git -C "${ROOT}" add -A
3. git -C "${ROOT}" commit -m "reorg(auto): pass ${passIndex} round ${n} — ${summaryLine}

Applied ${applyResult.moved} moves; references rewritten; project build/test verified green by the codebase-organizer apply workflow.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
4. Report the new commit's short hash and how many files changed. If git reports nothing to commit, set commit:"" ok:true with an explanation.`,
      { label: 'commit:org' + passIndex + '.' + n, phase: phaseName, schema: COMMIT_SCHEMA, model: M_MECH }
    )
    if (!commit || !commit.ok) {
      convergence = 'commit-error'; rounds.push({ round: n, stage: 'commit', error: commit ? commit.detail : 'no result' })
      log('Organize round ' + n + ': commit failed — halting. ' + (commit ? commit.detail : '')); break
    }
    rounds.push({ round: n, moves_applied: applyResult.moved, quarantined: (applyResult.quarantined || []).length, references_rewritten: applyResult.references_rewritten, unresolved_references: applyResult.unresolved_references || [], verify_passed: true, commit: commit.commit, verdict, summary: plan.summary })
    pendingOrgFixes.length = 0   // this pass acted on the tree; stale audit hints are superseded
    log('Organize round ' + n + ' committed ' + commit.commit + ' (' + applyResult.moved + ' moves). Re-planning to check for more...')
  }
  const applied = rounds.filter(r => r.verify_passed)
  const result = { stage: 'organize', pass: passIndex, convergence, rounds_run: rounds.length, rounds_applied: applied.length, total_moves: applied.reduce((s, r) => s + (r.moves_applied || 0), 0), rounds }
  orgResults.push(result)
  log('Organize pass ' + passIndex + ' done: ' + applied.length + ' round(s) applied, ' + result.total_moves + ' moves, reason=' + convergence)
  return result
}

// ================= Staged driver =================
const stageResults = {}
let sweepStop = ''

if (SINGLE_TARGET) {
  // Single-file mode: only the engine stages (organize was filtered out), just the named file.
  phase('Measure')
  let lines = 0
  try {
    const wc = await agent(
      `Read-only. Report the line count of ${ROOT}/${SINGLE_TARGET} via \`wc -l\`. Return it as files:[{path:"${SINGLE_TARGET}", lines:<n>}]. If the file does not exist, return files:[]. Make NO edits.`,
      { label: 'measure-target', phase: 'Measure', agentType: 'Explore', schema: DISCOVER_SCHEMA, model: M_COORD })
    lines = ((wc && wc.files) || []).map(f => f.lines).find(Number.isFinite) || 0
  } catch (e) { lines = 0 }
  if (!lines) {
    sweepStop = 'target-not-found'
  } else {
    for (const stage of STAGES) {
      if (budget.total && budget.remaining() < BUDGET_FLOOR) { sweepStop = 'budget-exhausted'; break }
      globalFileIndex++
      await runFile({ path: SINGLE_TARGET, lines }, globalFileIndex, stage)
    }
    sweepStop = sweepStop || 'single-file-done'
  }
} else {
  // Multi-stage sweep: run each selected stage in order over a shared Setup + Conventions.
  for (const stage of STAGES) {
    if (budget.total && budget.remaining() < BUDGET_FLOOR) { stageResults[stage] = { stop: 'budget-exhausted' }; sweepStop = 'budget-exhausted'; log('Budget below floor before stage ' + stage + ' — stopping.'); break }
    if (stage === 'organize') {
      orgPass++
      await runOrganizeStage(orgPass)
      continue
    }
    const isDeepen = stage === 'deepen'
    const MAXF = isDeepen ? DEEP_MAX_FILES : MAX_FILES
    const TH = isDeepen ? DEEP_ANCHOR_LINES : DISCOVER_LINES
    let stageFiles = 0, pass = 0, stop = ''

    if (stage === 'decompose') {
      // WORKER-POOL WAVE DRIVER: each wave discovers the worklist, then FILE_CONCURRENCY workers pull
      // files largest-first and decompose them concurrently (each in its own worktree at K>1). After the
      // wave drains and all merges settle, re-discover to catch newly-oversized modules + conflict
      // re-enqueues. At K=1 this degenerates to a single sequential worker (legacy behavior).
      while (true) {
        if (stageFiles >= MAXF) { stop = 'max-files'; log('decompose: reached max files (' + MAXF + ') — advancing.'); break }
        if (budget.total && budget.remaining() < BUDGET_FLOOR) { stop = 'budget-exhausted'; log('decompose: budget below floor — advancing.'); break }
        pass++
        const discoverPhase = 'Discover[DEC] ' + pass
        phase(discoverPhase)
        const queue = await discover(processed['decompose'], discoverPhase, TH)
        // Fold in any merge-conflict re-enqueues (deduped vs discover output + processed), keep largest-first.
        while (retryQueue.length) {
          const r = retryQueue.shift()
          if (!processed['decompose'].has(r.path) && !queue.some(q => q.path === r.path)) queue.push(r)
        }
        queue.sort((a, b) => b.lines - a.lines)
        log('decompose discover ' + pass + ': ' + queue.length + ' file(s) over ' + TH + ' lines' + (queue.length ? ' — next: ' + queue.slice(0, 5).map(f => f.path + '(' + f.lines + ')').join(', ') + (queue.length > 5 ? ', …' : '') : '') + (ISOLATE ? ' [' + FILE_CONCURRENCY + '-way concurrent]' : ''))
        if (!queue.length) { stop = stop || 'all-clear'; log('decompose: no files over the threshold remain.'); break }

        // A worker pulls the next-largest unclaimed file and runs it to completion (incl. merge-back),
        // then loops for the next — keeping FILE_CONCURRENCY files in flight until the queue drains.
        const worker = async () => {
          while (true) {
            if (stageFiles >= MAXF) return
            if (budget.total && budget.remaining() < BUDGET_FLOOR) return
            const entry = queue.shift()
            if (!entry) return
            const key = String(entry.path).replace(/^\.\//, '')
            if (processed['decompose'].has(key)) continue
            processed['decompose'].add(key)        // claim BEFORE running (crash-safety); atomic under cooperative concurrency
            const myIndex = ++globalFileIndex
            stageFiles++
            try {
              await runFile(entry, myIndex, 'decompose')   // self-contained: per-file try/catch + serialized merge-back
            } catch (e) {
              log('File ' + myIndex + ' (' + key + ') hard-failed in the worker (' + ((e && e.message) ? e.message.slice(0, 100) : 'error') + ') — contained; left for the next discovery pass.')
            }
          }
        }
        const workers = []
        for (let i = 0; i < Math.max(1, FILE_CONCURRENCY); i++) workers.push(() => worker())
        await parallel(workers)
        await mergeLock          // ensure every in-flight merge has settled before the next discovery counts lines
        // loop: re-discover (finished files are in processed; newly-oversized modules + retries surface)
      }
    } else {
      // DEEPEN: sequential per-anchor loop (cross-file candidates → no worktree isolation, no concurrency).
      while (true) {
        if (stageFiles >= MAXF) { stop = 'max-files'; log(stage + ': reached max files (' + MAXF + ') — advancing.'); break }
        if (budget.total && budget.remaining() < BUDGET_FLOOR) { stop = 'budget-exhausted'; log(stage + ': budget below floor — advancing.'); break }
        pass++
        const discoverPhase = 'Discover[DEEP] ' + pass
        phase(discoverPhase)
        const queue = await discover(processed[stage], discoverPhase, TH)
        log(stage + ' discover: ' + queue.length + ' file(s) over ' + TH + ' lines remaining' + (queue.length ? ' — next: ' + queue.slice(0, 5).map(f => f.path + '(' + f.lines + ')').join(', ') + (queue.length > 5 ? ', …' : '') : ''))
        if (!queue.length) { stop = stop || 'all-clear'; log(stage + ': no files over the threshold remain.'); break }
        globalFileIndex++; stageFiles++
        await runFile(queue[0], globalFileIndex, stage)
        // loop: re-discover (the file just done is in processed[stage]; any newly oversized module surfaces)
      }
    }
    stageResults[stage] = { stop, files: stageFiles }
  }
}

// ================= Phase: Report =================
phase('Report')
const engineApplied = fileResults.reduce((a, r) => a + (r.extractions_applied || 0), 0)
const orgMoves = orgResults.reduce((a, r) => a + (r.total_moves || 0), 0)
log('Run finished: stages=[' + STAGES.join(', ') + '] — ' + fileResults.length + ' engine file(s), ' + engineApplied + ' extraction/deepening(s) landed, ' + orgResults.length + ' organize pass(es)/' + orgMoves + ' moves. stop=' + (sweepStop || 'complete'))

return {
  branch: BRANCH,
  stages: STAGES,
  mode: SINGLE_TARGET ? 'single-file' : 'staged-sweep',
  decompose_isolation: (ISOLATE && STAGES.includes('decompose')) ? 'concurrent-worktrees' : 'serial',
  file_concurrency: (ISOLATE && STAGES.includes('decompose')) ? FILE_CONCURRENCY : 1,
  stop_reason: sweepStop || 'complete',
  baseline_commit: setup.baseline_commit || '(tree was already clean)',
  baseline_red_tests: BASELINE_RED.length,
  structure_baseline: STRUCT_BASELINE ? STRUCT_BASELINE.summary : null,
  // child branches kept for human review after MERGE_RETRIES exhausted (concurrent decompose only)
  unmerged_conflict_branches: fileResults.filter(r => r.convergence === 'merge-conflict-unresolved').map(r => ({ target: r.target, branch: r.unmerged_branch })),
  organize: {
    passes: orgResults.length,
    total_moves: orgMoves,
    results: orgResults.map(r => ({ pass: r.pass, convergence: r.convergence, rounds_applied: r.rounds_applied, total_moves: r.total_moves })),
  },
  decompose_deepen: {
    files_processed: fileResults.length,
    landed_total: engineApplied,
    per_stage: stageResults,
    files: fileResults.map(r => ({
      stage: r.stage,
      target: r.target,
      // target-reached | converged | no-strong-candidates | panel-rejected-all | chair-unavailable |
      // commit-error | budget-exhausted | max-iterations | errored | worktree-setup-failed |
      // merge-conflict-retry | merge-conflict-unresolved
      convergence: r.convergence,
      lines_start: r.lines_start,
      lines_end: r.lines_end,
      extractions_applied: r.extractions_applied,
      rounds_run: r.rounds_run,
      reached_target: r.stage === 'decompose' && Number.isFinite(r.lines_end) && r.lines_end <= TARGET_LINES,
      org_audit_findings: (r.rounds || []).flatMap(rd => rd.org_audit || []),
      applied: r.applied,
    })),
  },
  details: { engine: fileResults, organize: orgResults },
  next_steps:
    (sweepStop === 'budget-exhausted')
      ? 'Stopped on the token budget floor. Committed work stands on ' + BRANCH + '; re-run to continue (finished work is skipped on re-discovery / re-scan).'
    : (sweepStop === 'target-not-found')
      ? 'Single-file mode: ' + SINGLE_TARGET + ' was not found. Check the path (repo-relative).'
      : 'Run complete for stages [' + STAGES.join(', ') + ']. Review the per-round commits on ' + BRANCH + ', check any quarantined files under archive/, then merge. Re-run with a lower discoverLines/targetLines or stages:[\'organize\'] to push further.',
}
