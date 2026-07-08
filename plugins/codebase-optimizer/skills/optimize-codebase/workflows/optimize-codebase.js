export const meta = {
  name: 'optimize-codebase',
  description: 'Unified, staged, LANGUAGE-AGNOSTIC codebase optimizer that folds three loops into one engine: ORGANIZE (tidy the file tree) -> DECOMPOSE (split god-files) -> DEEPEN (architectural deepenings). An ECOSYSTEM PROFILE (python | node | go | rust | generic — explicit arg or auto-detected from the repo manifests at Setup) supplies every language-specific piece: source extensions, env/test/smoke/lint commands, the module-identity scheme, the compat-shim mechanism (python re-export shims, node barrel re-exports, go same-package splits / alias shims, rust pub use, generic full-reference rewrites), the test-seam census, and the codemod guidance — everything else is neutral machinery. A single Setup pass prepares a clean committed baseline + CI-faithful env + protected-untracked set; a Conventions pass derives the repo organization conventions (codebase-organizer philosophy + the deterministic structure verifier) into a context block injected into every stage so newly-created modules land in logically-organized subdirectories instead of loose siblings. Stages run in order and are toggleable (pass stages:[...] or organizeOnly:true). ORGANIZE reuses the codebase-organizer skill (plan -> persist -> apply -> CI verify -> commit -> re-scan until converged), doing history-preserving git mv + reference rewriting. DECOMPOSE runs the proven per-file engine: lane plan -> parallel find -> decision panel -> select line-disjoint carve-outs -> sequential apply (targeted oracle -> scripted/codemod extraction leaving compat shims -> validate+repair -> commit), reverting any member that reds. DEEPEN reuses the same Setup/panel/apply machinery with improve-architecture find criteria (shallow modules / missing seams), applied SEQUENTIALLY with revert (no worktrees). After each engine apply a cheap org audit runs the structure verifier on the touched tree. Model-tiered: Opus for the chair + codemod implementer, Sonnet for mechanical steps.',
  phases: [
    { title: 'Setup', detail: 'assert git tree, clean committed baseline on the working branch, detect the ecosystem + toolchain, set up the project env, capture a baseline test oracle + protected-untracked set + structure-verifier baseline (once for the whole run)' },
    { title: 'Conventions', detail: 'derive the repo organization conventions (codebase-organizer philosophy + language layouts + live repo_scan/verifier output) into a CONVENTIONS block injected into every decompose/deepen find/panel/chair/implement prompt (once)' },
    { title: 'Org[{p}] · Iter {r}', detail: 'ORGANIZE stage repo-level rounds (when selected): codebase-organizer plan -> persist -> apply (git mv + ref rewrite) -> CI verify -> commit -> re-scan until converged; phases unique per (pass, round)' },
    { title: 'Discover[{stage}] {p}', detail: 'DECOMPOSE worklist scan (files > discoverLines) / DEEPEN anchor scan (files > deepAnchorLines), unique per pass' },
    { title: '{STAGE} F{n} {file} · Iter {r}', detail: 'per-file engine rounds, created DYNAMICALLY and uniquely per (stage, file, round) — e.g. "DEC F2 main · Iter 1": compute the file public import path + contract census, then iterate rounds (find -> panel -> apply+shims -> validate -> commit) until convergence; no phase name is reused across stages, files, or rounds' },
    { title: 'Measure', detail: 'single-target mode only: measure the named file to decide whether the engine stages apply' },
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
// its own git worktree. Ecosystems whose profile sets perWorktreeEnv get their OWN per-worktree env:
// python needs its own .venv (the root .venv's editable .pth hardcodes <ROOT>/src, so a worktree
// sharing it would validate ROOT's source, not its own edits) and node needs its own node_modules;
// go/rust/generic share the toolchain caches and skip the env-sync step. Converged files merge back
// to BRANCH one at a time. 1 = the legacy serial sweep on the main checkout (no worktree, no extra
// env) — identical to the pre-concurrency behavior.
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
// Where to hunt for god-files, and what to never touch. Defaults are NEUTRAL (build/cache/vendor
// trees only); the Setup-phase DETECT step narrows SCAN_ROOTS to the repo's real source root.
// NOTE: SCAN_ROOTS / TEST_DIRS_FOR / ENV_SETUP / BASE_IMPORTS / LINT / KEEP_SET / TEST_PREFIX /
// SRC_EXTS etc. are `let` (not const) because the Setup-phase DETECT step (below) fills
// repo-appropriate defaults when the caller did not pass an explicit arg. Explicit args always win
// (tracked via HAS()).
let SCAN_ROOTS = (Array.isArray(A.scanRoots) && A.scanRoots.length) ? A.scanRoots : ['src']
const EXCLUDE_GLOBS = (Array.isArray(A.excludeGlobs) && A.excludeGlobs.length) ? A.excludeGlobs : ['**/__pycache__/**', '**/node_modules/**', '**/target/**', '**/dist/**', '**/build/**', '**/.venv/**', '**/vendor/**']
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
// SOFT-JUDGMENT tier: the non-veto panel lenses (blast radius, test net, steward, execution
// strategist) are architectural judgment, not mechanics — they never drop below Sonnet even when
// haikuMech swaps the mechanical loop to Haiku. An explicit mechModel still wins.
const M_SOFT = A.mechModel || 'sonnet'
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
// skip the two SLOW setup steps (the env setup — e.g. `uv sync` / `npm ci` — ~minutes, and the
// baseline test oracle ~3-4min). It still does
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
// to the common test trees + archive — test trees' path-depth math + dynamic discovery make reorg
// moves unsafe (a headless critic once vetoed a whole plan over exactly this). Forwarded to
// organize-plan's `exclude` arg.
const ORG_EXCLUDE = (Array.isArray(A.orgExclude) ? A.orgExclude : (A.orgExclude ? [A.orgExclude] : ['tests', 'test', 'dev/tests', 'archive']))

// ---- DEEPEN stage (improve-architecture find criteria, sequential apply on the shared engine) ----
// Anchors: files large enough to host a deepening. A LOWER bar than decompose's discoverLines, since
// shallow-module/seam deepenings live in mid-size modules too.
const DEEP_ANCHOR_LINES = Number.isFinite(A.deepAnchorLines) ? A.deepAnchorLines : 400
const DEEP_MAX_FILES = stageNum('deepen', 'maxFiles', Number.isFinite(A.deepMaxFiles) ? A.deepMaxFiles : 15)
// Subsystem -> full test dirs that must stay green when that subsystem is touched (from improve-arch).
// `let` so DETECT can synthesize it from the real src<->tests mirror when not passed. Explicit wins.
// Default is EMPTY — VAL_DIRS then falls back to TEST_ROOT, which is always a safe superset.
let TEST_DIRS_FOR = (A.testDirsFor && typeof A.testDirsFor === 'object') ? A.testDirsFor : {}

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
// Portable interpreter: PY3 detection already means "python3 OR python" is present,
// so the emitted commands must not hardcode python3 or a python-only box fails.
const PY = '"$(command -v python3 || command -v python)"'
const STRUCT_VERIFY_CMD = A.structVerifyCmd
  || (PY + ' ' + STRUCT_VERIFIER + ' . ' + (SCAN_SCRIPT ? '--scan-script ' + SCAN_SCRIPT + ' ' : '') + '--json')

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

// ======================= ECOSYSTEM PROFILES =======================
// The engine's language-specific knowledge lives HERE (plus the Setup-phase DETECT prompt): source
// extensions, env/test/smoke/lint command shapes, the module-identity scheme, and the prose guides
// (compat-shim mechanism, test-seam census, codemod mechanism, classic traps) that get injected into
// every find/panel/implement/validate/repair prompt. Everything else in the file is language-neutral
// machinery. The 'python' profile preserves the original engine's behavior exactly (re-export shims,
// patch("mod.X") seam census, __init__.py scaffolding, ast/libcst codemods, uv-first commands).
const ALL_ECOSYSTEMS = ['python', 'node', 'go', 'rust', 'generic']
let ECOSYSTEM = (typeof A.ecosystem === 'string' && ALL_ECOSYSTEMS.includes(A.ecosystem.trim().toLowerCase()))
  ? A.ecosystem.trim().toLowerCase() : ''
if (typeof A.ecosystem === 'string' && A.ecosystem.trim() && !ECOSYSTEM) {
  return { error: "unknown ecosystem '" + A.ecosystem + "' — expected one of " + ALL_ECOSYSTEMS.join(' | ') }
}
// Broad default for the 'generic' profile when the caller passes no srcExts.
const GENERIC_EXTS = ['.py', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.cs', '.c', '.h', '.cc', '.cpp', '.hpp', '.swift', '.scala', '.ex', '.exs', '.lua', '.zig']
// SRC_EXTS: resolved source extensions (srcExts arg > profile exts). Filled properly after DETECT;
// helpers below read it at CALL time.
let SRC_EXTS = (Array.isArray(A.srcExts) && A.srcExts.length) ? A.srcExts.map(e => (e[0] === '.' ? e : '.' + e)) : ['.py']
const stripExt = (p) => { const s = String(p); for (const e of SRC_EXTS) { if (s.endsWith(e)) return s.slice(0, -e.length) } return s }
const isSourceFile = (p) => SRC_EXTS.some(e => String(p).endsWith(e))
// Where the tests live, for prompt text (TEST_ROOT is resolved after DETECT; read at call time).
const TDIRX = () => TEST_ROOT || 'the test tree'

// Each guide function takes m = { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED } (per-file identities).
const PROFILES = {
  python: {
    exts: ['.py'],
    perWorktreeEnv: true,                       // each worktree needs its own .venv (editable .pth pins src)
    smokeNoun: 'Import smoke',
    idNoun: 'dotted module path',
    defaultTestPrefix: 'python -m pytest',      // 'uv run python -m pytest' when uv detected (resolved post-DETECT)
    defaultSmoke: '',                           // python smoke is built per-file from BASE_IMPORTS (importSmokeFor)
    defaultLintPerFile: '',
    moduleIdFor: (p) => stripExt(String(p)).replace(/^src\//, '').replace(/\//g, '.'),
    scaffoldNote: 'Python: a NEW subpackage directory is only importable once it has an __init__.py — list every needed __init__.py (repo-relative) in scaffold_files. Most extractions into an existing package need none.',
    siteKinds: (m) => '\`from ' + m.MODULE_ID + ' import <sym>\` sites, \`patch("' + m.MODULE_ID + '.<sym>")\` / monkeypatch sites',
    shimGuide: (m) => 'COMPAT MECHANISM (python re-export shim): every extraction leaves a RE-EXPORT SHIM block (\`from <dest module> import X\`) at the old module, so every name currently importable from ' + m.MODULE_ID + ' (the file\'s public import path) STAYS importable from it, and every \`patch("' + m.MODULE_ID + '.X")\` test seam keeps resolving to the SAME object the live code calls (the seam must keep biting). ALSO audit for SOURCE-TEXT GUARD tests — a failure class a shim CANNOT fix: tests that read ' + m.TARGET + ' as a STRING (read_text / ast.parse / inspect.getsource) and assert a moved symbol\'s def/call appears in its literal contents; moving the symbol makes that assertion FALSE no matter what shim is added, so each such guard test must be REPOINTED at the new module.',
    seamGuide: (m) => 'TEST-SEAM CENSUS (python): count \`patch("' + m.MODULE_ID + '.X")\` / \`patch.object\` / monkeypatch sites — these pin the file\'s public import path and every one must keep biting after a move.',
    codemodGuide: 'a throwaway Python ast/libcst codemod (write it under /tmp, run it through the project\'s env, DELETE it before finishing)',
    censusBody: (m) => 'Count, across BOTH the test tree and the source tree:\n  - total_patch_sites: occurrences of \`patch("' + m.MODULE_ID + '.\` / \`patch(\'' + m.MODULE_ID + '.\` / \`patch.object(' + m.MODULE_ID + '\` / monkeypatch of names from this module.\n  - total_import_sites: occurrences of \`from ' + m.MODULE_ID + ' import \` plus bare \`' + m.MODULE_ID + '.\` attribute references.\n  - src_importers: rough count of DISTINCT source files that import ' + m.MODULE_ID + '.\n  - top_symbols: the ~6 individual symbols of this module that appear most often across those sites, each with its count (e.g. {name:"_cprint", count:74}).',
    contractTraps: (m) => 'Determine whether the extraction can preserve EVERY externally observable contract: every name currently importable from ' + m.MODULE_ID + ' must STAY importable from ' + m.MODULE_ID + ' (via a re-export shim), every `patch("' + m.MODULE_ID + '.X")` must keep resolving to the SAME object the live code uses (so test seams still bite), CLI surface, wire formats, persisted schemas, and error contracts unchanged. A decomposition reshapes file layout BEHIND those unchanged import paths. Cast a HARD VETO ONLY if the extraction INHERENTLY cannot preserve a contract by any path (extremely rare for a pure move — almost always a shim fixes it). If a naive move would break `patch("' + m.MODULE_ID + '.X")` resolution (the classic trap: code moves but the patch target must still point at the object the moved code actually calls), do NOT veto — instead enumerate the exact shim re-exports AND the patch-target invariants required, and vote concerns. Difficulty of preserving the seam is a plan input, not a veto.\nSECOND, audit for SOURCE-TEXT GUARD tests — a distinct failure class a re-export shim CANNOT fix. Some tests read ' + m.TARGET + ' as a STRING and assert on its literal contents (e.g. `source = Path(".../' + (m.TARGET.split('/').pop()) + '").read_text(); assert "def some_symbol" in source`). grep ' + TDIRX() + ' for tests that open/read the target path or parametrize on it (search: the file\'s basename, `read_text`, `.py").read`, `ast.parse`, the bare symbol names as quoted strings). For EVERY moved symbol, check whether any test asserts that symbol\'s def/call appears in ' + m.TARGET + '\'s text — moving it makes that assertion FALSE no matter what shim you add. This is NOT an inherent contract break (do not hard-veto): the fix is to UPDATE the guard test to point at the new module (or assert the shim line is present). List each such guard in required_safeguards as "source-text-guard: <test node id> — repoint to <new module>" and vote concerns. A missed source-text guard is the #1 silent red for this loop.',
    testNetTrap: (m) => 'The classic trap: a name moves, its `patch("' + m.MODULE_ID + '.X")` test seam silently stops biting (now patches a dead shim, not the object the live code calls), and tests pass GREEN while behaviour drifted. Require, in required_safeguards: (a) for every heavily-patched symbol in the cluster, a CHARACTERIZATION assertion that `patch("' + m.MODULE_ID + '.<sym>")` STILL intercepts the live call path after the move (the import-binding-rename regression class from package-reorg-traps.md), and',
    scopeGreps: (m, dest) => '  - patch("' + m.MODULE_ID + '.<sym>") / patch.object(...,"<sym>") / monkeypatch <sym>\n  - `from ' + m.MODULE_ID + ' import <sym>` or reference `' + m.MODULE_ID + '.<sym>`\n  - use <sym> bare in a test body, or import the destination module ' + dest + '\n  - SOURCE-TEXT GUARDS: read ' + m.TARGET + ' as text / ast.parse it / assert a symbol name string appears in it (search: ' + (m.TARGET.split('/').pop()) + ', read_text, ast.parse, each symbol as a quoted string)',
    repairHints: (m, newModule) => '- SOURCE-TEXT / SOURCE-INTROSPECTION GUARD (a test reads ' + m.TARGET + ' as text, `ast.parse`s it, or uses inspect/getsource and asserts a moved symbol appears in ' + m.TARGET + '): a shim CANNOT satisfy this. REPOINT the test to inspect ' + newModule + ' (or both). Most common red.\n- PATCH-SEAM BREAK (a `patch("' + m.MODULE_ID + '.X")` test stopped biting): ensure the moved code resolves X through a path the patch still intercepts (re-export at ' + m.MODULE_ID + '.X AND make the live call go through the patched module attribute, not a bare local rebind).\n- IMPORT / NAME ERROR in the new module or shim: add the missing imports, fix the shim re-export so `from ' + m.MODULE_ID + ' import <name>` and the dotted path both resolve.\n- A genuine behavior regression: fix the moved code so behavior is identical to before the move.',
    implSeamWatch: (m) => '- WATCH THE patch() SEAM (the import-binding-rename trap): if the moved code calls a sibling that was also moved, callers inside the new module must reference it so that patching `' + m.MODULE_ID + '.<name>` still affects the call — verify by reasoning about WHERE the name is looked up. If a symbol is called via the module global, the shim alone preserves the seam; if it was called bare within the moved cluster, the cluster now resolves it locally and the OLD patch target would go dead — in that case re-export AND keep the call going through a path the test patches (note any such case in detail).',
    implGuardAudit: (m, destModule) => '- UPDATE SOURCE-TEXT GUARD TESTS (a failure class a shim CANNOT fix). BEFORE finishing, grep ' + TDIRX() + ' for any test that reads ' + m.TARGET + ' as TEXT and asserts a moved symbol\'s def/call appears in it (search: `' + (m.TARGET.split('/').pop()) + '`, `read_text`, `ast.parse`, and each moved symbol name as a quoted string). Such a test asserts `"def <sym>" in source_of_target` or parametrizes on the target path; moving the symbol makes it FALSE. For each one (the mandate lists them as "source-text-guard: ..."), REPOINT the assertion to the new module ' + destModule + ' (or assert the new shim line is present in ' + m.TARGET + ') so the guard still verifies the real intent. Add these files to files_touched. A missed guard is the most common silent red for this loop.',
    valSeamNote: (m) => 'PAY SPECIAL ATTENTION to any `patch("' + m.MODULE_ID + '.X")`-based test: if it now fails, the move likely broke the patch seam — flag that explicitly.',
  },
  node: {
    exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    perWorktreeEnv: true,                       // each worktree needs its own node_modules
    smokeNoun: 'Type check',
    idNoun: 'import path',
    defaultTestPrefix: '',                      // DETECT resolves: npm test -- | npx vitest run | npx jest
    defaultSmoke: '',                           // DETECT resolves: 'npx tsc --noEmit' when a tsconfig exists
    defaultLintPerFile: '',
    moduleIdFor: (p) => stripExt(String(p)),
    scaffoldNote: 'node: no scaffold files are normally needed — leave scaffold_files empty (an index/barrel file, when wanted, is part of the extraction itself).',
    siteKinds: (m) => '\`import ... from \'' + m.MODULE_ID + '\'\` / \`require(\'' + m.MODULE_ID + '\')\` sites and \`jest.mock(\'' + m.MODULE_ID + '\')\` / \`vi.mock(\'' + m.MODULE_ID + '\')\` sites',
    shimGuide: (m) => 'COMPAT MECHANISM (node barrel re-export): the old file ' + m.TARGET + ' becomes (or gains) a BARREL that re-exports everything that moved — \`export { X } from \'./<new>\'\` / \`export * from \'./<new>\'\` — so every \`import ... from \'<old path>\'\`, \`require(\'<old path>\')\`, and \`jest.mock(\'<old path>\')\` / \`vi.mock(\'<old path>\')\` site keeps resolving through the barrel. WATCH the two classic traps: DEFAULT exports must be re-exported explicitly (\`export { default } from \'./<new>\'\`), and type-only exports need \`export type { T } from \'./<new>\'\` so isolatedModules/verbatimModuleSyntax builds keep passing.',
    seamGuide: (m) => 'TEST-SEAM CENSUS (node): count \`jest.mock(\'' + m.MODULE_ID + '\')\` / \`vi.mock(\'' + m.MODULE_ID + '\')\` and \`require(\'' + m.MODULE_ID + '\')\` sites — module doubles registered at the OLD path must keep intercepting after a move (the barrel keeps the path alive, but the moved code must still import through a path the mock covers).',
    codemodGuide: 'a ts-morph / jscodeshift codemod or a scripted transform, verified with the TypeScript compiler (\`npx tsc --noEmit\`) when a tsconfig exists',
    censusBody: (m) => 'Count, across BOTH the test tree and the source tree:\n  - total_patch_sites: occurrences of \`jest.mock(\'' + m.MODULE_ID + '\'\` / \`vi.mock(\'' + m.MODULE_ID + '\'\` / \`vi.doMock\`/\`jest.doMock\` of this path (module doubles pinned to the old path).\n  - total_import_sites: occurrences of \`from \'' + m.MODULE_ID + '\'\` / \`require(\'' + m.MODULE_ID + '\')\` (match with and without the extension and with relative-path variants).\n  - src_importers: rough count of DISTINCT source files that import this file.\n  - top_symbols: the ~6 exported symbols of this file that appear most often across those sites, each with its count.',
    contractTraps: (m) => 'Determine whether the extraction can preserve EVERY externally observable contract: every symbol currently importable from the old path must STAY importable from it (the old file becomes a BARREL: `export { X } from \'./<new>\'` / `export * from \'./<new>\'`), every `jest.mock(\'<old path>\')` / `vi.mock(\'<old path>\')` module double must keep intercepting the live call path, and every `require(\'<old path>\')` site must keep resolving; public API, CLI surface, wire formats, persisted schemas, and error contracts unchanged. Cast a HARD VETO ONLY if the extraction INHERENTLY cannot preserve a contract by any path (extremely rare — the barrel almost always fixes it). Turn the classic traps into required_safeguards + a concerns vote, NOT a veto: (a) DEFAULT exports — `export *` does NOT forward `default`; require an explicit `export { default } from \'./<new>\'` when the old file has one; (b) TYPE-ONLY exports — require `export type { T } from \'./<new>\'` so isolatedModules/verbatimModuleSyntax builds keep passing; (c) MOCK-PATH STALENESS — a double registered at the old path stops biting if the moved code now imports its sibling directly from the new file; require that intercepted calls keep flowing through a path the mock covers. Difficulty of preserving the surface is a plan input, not a veto.',
    testNetTrap: (m) => 'The classic trap: a symbol moves, a `jest.mock(\'' + m.MODULE_ID + '\')` / `vi.mock(\'' + m.MODULE_ID + '\')` double registered at the OLD path silently stops biting (the moved code now imports its sibling directly from the new file, bypassing the mocked path), and tests pass GREEN while behaviour drifted; a `default` export lost by an `export *` barrel fails the same silent way. Require, in required_safeguards: (a) for every mocked symbol in the cluster, a CHARACTERIZATION assertion that doubles registered at the old path STILL intercept the live call path after the move (and an explicit `default` re-export where one existed), and',
    scopeGreps: (m, dest) => '  - `jest.mock(\'' + m.MODULE_ID + '\')` / `vi.mock(\'' + m.MODULE_ID + '\')` / `jest.doMock`/`vi.doMock` of the old path\n  - `import ... from \'' + m.MODULE_ID + '\'` / `require(\'' + m.MODULE_ID + '\')` (with/without extension, relative variants) or imports of the destination ' + dest + '\n  - use <sym> bare in a test body\n  - SOURCE-TEXT GUARDS (rare): tests that read ' + m.TARGET + ' as text and assert on its literal contents',
    repairHints: (m, newModule) => '- STALE MOCK PATH (a `jest.mock`/`vi.mock` double at the old path stopped biting): re-export the symbol through the barrel AND make the live call flow through the mocked path (import via the old path inside the moved code when tests rely on interception).\n- MISSING DEFAULT / TYPE-ONLY RE-EXPORT: add `export { default } from \'./<new>\'` / `export type { T } from \'./<new>\'` to the barrel at ' + m.TARGET + '.\n- RESOLUTION / COMPILE ERROR (tsc or the test runner names the path/symbol): fix the import path or the barrel re-export in ' + newModule + ' / ' + m.TARGET + '.\n- A genuine behavior regression: fix the moved code so behavior is identical to before the move.',
    implSeamWatch: (m) => '- WATCH THE MOCK SEAM: if a test registers a double at the old path (`jest.mock`/`vi.mock`), the moved code must keep resolving that dependency through a path the double covers — re-export it through the barrel AND, when tests rely on interception, import it in the new file via the mocked path. Re-export `default` explicitly (`export *` does not forward it); use `export type` for type-only names.',
    implGuardAudit: (m, destModule) => '- SOURCE-TEXT GUARDS (rare but possible): grep ' + TDIRX() + ' for any test that reads ' + m.TARGET + ' as text and asserts on its literal contents; repoint any such assertion at ' + destModule + '. Add those test files to files_touched.',
    valSeamNote: (m) => 'PAY SPECIAL ATTENTION to tests that `jest.mock`/`vi.mock` the old path \'' + m.MODULE_ID + '\': if one now fails (or suspiciously passes while asserting nothing), the barrel/mock seam likely broke — flag it explicitly.',
  },
  go: {
    exts: ['.go'],
    perWorktreeEnv: false,                      // module cache is shared; worktrees need no env sync
    smokeNoun: 'Compile smoke',
    idNoun: 'package path',
    defaultTestPrefix: 'go test',
    defaultSmoke: 'go build ./...',
    defaultLintPerFile: 'go vet',
    moduleIdFor: (p) => stripExt(String(p)),
    scaffoldNote: 'go: no scaffold files are needed — leave scaffold_files empty (a new file simply declares its package).',
    siteKinds: (m) => 'importers of the owning package and references to the moved identifiers (Go has no patch-by-import-path test seam)',
    shimGuide: (m) => 'COMPAT MECHANISM (go): PREFER SAME-PACKAGE FILE SPLITS — moving declarations between files of ONE package changes NOTHING for importers and needs NO shims at all (the new file just declares the same \`package\` clause), which makes Go decomposition the safest kind. A CROSS-PACKAGE move is a real API change: either leave alias shims at the old package (type aliases \`type X = newpkg.X\`, \`var Fn = newpkg.Fn\`, re-declared consts) or enumerate and rewrite EVERY call site. A move into a new package MUST NOT create an import cycle — \`go build\` refuses cycles, so plan the dependency direction before moving.',
    seamGuide: (m) => 'TEST-SEAM CENSUS (go): Go has no patch-by-import-path mechanism, so total_patch_sites is reported as 0 by design; the census counts import/reference sites only. Same-package \`_test.go\` files keep compiling untouched across a same-package split.',
    codemodGuide: 'gopls-assisted rename / \`gofmt -r\` / scripted edits, verified with \`go build ./...\`',
    censusBody: (m) => 'This ecosystem has NO patch-by-import-path test seam: report total_patch_sites as 0 and note that in detail. Count:\n  - total_import_sites: files importing the package that owns ' + m.TARGET + ' plus references to identifiers declared in ' + m.TARGET + ' (grep the declared top-level names).\n  - src_importers: rough count of DISTINCT packages importing the owning package.\n  - top_symbols: the ~6 identifiers declared in this file that are referenced most often, each with its count.',
    contractTraps: (m) => 'Determine whether the move preserves every importer. STRONGLY PREFER a SAME-PACKAGE FILE SPLIT: moving declarations between files of ONE package changes NOTHING for importers and needs NO shims — verify the candidate can be done that way first (it almost always can for god-file splitting) and require it in required_safeguards when so. If the candidate is a CROSS-PACKAGE move, it is a real API change: it must either leave alias shims at the old package (type aliases `type X = newpkg.X`, `var Fn = newpkg.Fn`, re-declared consts — note methods do NOT alias, so types with methods must be aliased at the TYPE level) or enumerate and rewrite EVERY call site. Cast a HARD VETO only if the move INHERENTLY cannot preserve the contract by any path — e.g. a cross-package move that unavoidably creates an IMPORT CYCLE in both candidate directions (`go build` refuses cycles). Otherwise enumerate the shims/rewrites and vote concerns. Difficulty is a plan input, not a veto.',
    testNetTrap: (m) => 'Go has no patch-by-path seam, so the net is the compiler + the owning package\'s tests: a same-package split keeps `_test.go` files compiling untouched, while a cross-package move can orphan tests or hit an import cycle. Require, in required_safeguards: (a) `go build ./...` green plus characterization tests at the EXISTING exported surface for each behaviour the cluster owns, and',
    scopeGreps: (m, dest) => '  - files importing the package that owns ' + m.TARGET + '\n  - references to each moved identifier (grep the exact names)\n  - `_test.go` files in the same package as ' + m.TARGET + ' (they compile against the split directly)\n  - any test referencing the destination ' + dest,
    repairHints: (m, newModule) => '- IMPORT CYCLE (go build refuses): restructure the dependency direction — move the shared piece further down, or keep the split SAME-PACKAGE (which needs no import at all).\n- UNDEFINED / UNEXPORTED identifier: the moved code lost sight of a package-private name — keep the split same-package, move the helper along, or export it deliberately.\n- ORPHANED TEST: keep each `_test.go` in the package that declares what it tests.\n- A genuine behavior regression: fix the moved code so behavior is identical to before the move.',
    implSeamWatch: (m) => '- KEEP IT SAME-PACKAGE when the mandate allows: the new file simply declares the SAME `package` clause and NOTHING changes for importers (no shims, no import rewrites). For a mandated cross-package move, add the alias shims the mandate lists (`type X = newpkg.X`, `var Fn = newpkg.Fn`, re-declared consts) and verify no import cycle appears (`go build ./...`).',
    implGuardAudit: (m, destModule) => '- SOURCE-TEXT GUARDS (rare but possible): grep ' + TDIRX() + ' for any test that reads ' + m.TARGET + ' as text and asserts on its literal contents; repoint any such assertion at ' + destModule + '. Add those test files to files_touched.',
    valSeamNote: (m) => 'PAY SPECIAL ATTENTION to compile failures naming import cycles or unexported identifiers — those are the classic split regressions in Go.',
  },
  rust: {
    exts: ['.rs'],
    perWorktreeEnv: false,                      // cargo target/ cache is fine to rebuild; no env sync step
    smokeNoun: 'Compile smoke',
    idNoun: 'module path',
    defaultTestPrefix: 'cargo test',
    defaultSmoke: 'cargo check --all-targets',
    defaultLintPerFile: '',                     // clippy only when DETECT finds it plausible
    moduleIdFor: (p) => stripExt(String(p)),
    scaffoldNote: 'rust: no scaffold files are needed — leave scaffold_files empty (a \`mod <new>;\` declaration in the parent module is part of the extraction itself).',
    siteKinds: (m) => '\`use\` sites of the module\'s items and references to the moved items (Rust has no patch-by-path test seam)',
    shimGuide: (m) => 'COMPAT MECHANISM (rust): \`pub use\` re-exports at the old module path keep the crate\'s public API identical — split a large module into submodules with \`mod <new>;\` + \`pub use <new>::{X, Y};\` at the old path, so every \`use\` of the old path keeps resolving. WATCH visibility: items that were reachable crate-wide may need \`pub(crate)\` in their new home, and the split must not accidentally WIDEN the public API (only \`pub use\` what was public before).',
    seamGuide: (m) => 'TEST-SEAM CENSUS (rust): Rust has no patch-by-path mechanism, so total_patch_sites is reported as 0 by design; the census counts \`use\`/reference sites only.',
    codemodGuide: 'scripted edits driven by a \`cargo check\` loop (the compiler names every broken use-path/visibility to fix)',
    censusBody: (m) => 'This ecosystem has NO patch-by-path test seam: report total_patch_sites as 0 and note that in detail. Count:\n  - total_import_sites: \`use\` sites of this module\'s path plus references to items it declares (grep the declared item names).\n  - src_importers: rough count of DISTINCT source files that \`use\` this module.\n  - top_symbols: the ~6 items declared in this file that are referenced most often, each with its count.',
    contractTraps: (m) => 'Determine whether the split preserves the crate\'s API: `pub use` re-exports at the old module path (`mod <new>; pub use <new>::{X, Y};`) keep every external `use` resolving and the public API byte-identical. Cast a HARD VETO only if no re-export path can preserve the surface (extremely rare). Turn the classic traps into required_safeguards + a concerns vote, NOT a veto: (a) VISIBILITY — items that were module-private but used crate-wide need `pub(crate)` in their new home; (b) API WIDENING — only `pub use` what was public before, or the split silently grows the public API; (c) macro_rules!/attribute items and trait impls follow different scoping rules — call each out explicitly if the cluster contains any. Difficulty is a plan input, not a veto.',
    testNetTrap: (m) => 'Rust has no patch-by-path seam, so the net is `cargo check`/`cargo test`: the silent risks are visibility changes and public-API widening rather than dead seams. Require, in required_safeguards: (a) characterization tests at the EXISTING public surface for each behaviour the cluster owns (committed BEFORE the split), and',
    scopeGreps: (m, dest) => '  - `use` sites of ' + m.MODULE_ID + '\'s path and references to each moved item (grep the exact names)\n  - `#[cfg(test)]` modules inside ' + m.TARGET + ' (they move with the code — flag them)\n  - integration tests under tests/ referencing the crate paths involved\n  - any test referencing the destination ' + dest,
    repairHints: (m, newModule) => '- VISIBILITY ERROR (E0603 / private item): add `pub(crate)` (or adjust the `pub use`) so the item is reachable from its users WITHOUT widening the public API.\n- UNRESOLVED PATH: fix the `mod <new>;` declaration and the `pub use` re-exports at ' + m.TARGET + ' so old paths keep resolving.\n- A genuine behavior regression: fix the moved code so behavior is identical to before the move.',
    implSeamWatch: (m) => '- PRESERVE THE MODULE SURFACE: add `mod <new>;` + `pub use <new>::{...};` at the old path so external `use` paths keep resolving; give moved items the NARROWEST visibility that keeps their users compiling (`pub(crate)` before `pub`), and do not `pub use` anything that was not public before.',
    implGuardAudit: (m, destModule) => '- SOURCE-TEXT GUARDS (rare but possible): grep ' + TDIRX() + ' for any test that reads ' + m.TARGET + ' as text and asserts on its literal contents; repoint any such assertion at ' + destModule + '. Add those test files to files_touched.',
    valSeamNote: (m) => 'PAY SPECIAL ATTENTION to visibility (E0603 / private-item) and unresolved-path errors — those are the classic split regressions in Rust.',
  },
  generic: {
    exts: GENERIC_EXTS,                          // caller should pass srcExts; this broad list is the fallback
    perWorktreeEnv: false,
    smokeNoun: 'Smoke check',
    idNoun: 'file path',
    defaultTestPrefix: '',                       // caller must pass testCmdPrefix (or oracleCmd) to enable the engine
    defaultSmoke: '',
    defaultLintPerFile: '',
    moduleIdFor: (p) => stripExt(String(p)),
    scaffoldNote: 'generic: no scaffold mechanism is assumed — leave scaffold_files empty unless this ecosystem demonstrably needs a marker file.',
    siteKinds: (m) => 'every reference to the moved symbols across the repo (no compat-shim mechanism is assumed)',
    shimGuide: (m) => 'COMPAT MECHANISM (generic): NONE is assumed — there is no known re-export/shim idiom for this ecosystem, so every extraction must ENUMERATE and REWRITE ALL references to the moved symbols across the whole repo. The validation gate (tests + smoke) is the only net, so keep batches SMALL and prefer the most self-contained clusters.',
    seamGuide: (m) => 'TEST-SEAM CENSUS (generic): no patch-equivalent mechanism is assumed, so total_patch_sites is reported as 0 by design; the census counts reference sites only.',
    codemodGuide: 'scripted edits (one-off transform scripts), with the repo\'s own build/test commands as the check loop',
    censusBody: (m) => 'No patch-by-path test seam is assumed for this ecosystem: report total_patch_sites as 0 and note that in detail. Count:\n  - total_import_sites: references to ' + m.TARGET + ' and to the symbols it declares (grep the file path and the top-level symbol names).\n  - src_importers: rough count of DISTINCT source files referencing it.\n  - top_symbols: the ~6 symbols declared in this file that are referenced most often, each with its count.',
    contractTraps: (m) => 'No compat-shim mechanism is assumed for this ecosystem: the extraction is only sound if EVERY reference to the moved symbols is enumerated and rewritten (grep the whole repo, including tests and config). Cast a HARD VETO only if the reference surface cannot even be ENUMERATED (e.g. reflective/string-built references grep cannot find and the candidate does not account for). Otherwise put the exact reference-rewrite plan in required_safeguards and vote concerns; require the batch stay SMALL because the validation gate is the only net. Difficulty is a plan input, not a veto.',
    testNetTrap: (m) => 'No patch-equivalent seam is assumed, so the configured test command is the ONLY net. Require, in required_safeguards: (a) characterization tests at the existing interface for each behaviour the cluster owns, committed BEFORE the move, and',
    scopeGreps: (m, dest) => '  - references to each moved symbol (grep the exact names)\n  - references to the target path ' + m.TARGET + ' itself\n  - any test referencing the destination ' + dest,
    repairHints: (m, newModule) => '- A MISSED REFERENCE to a moved symbol or to the old file path: grep the whole repo again and rewrite it.\n- A genuine behavior regression: fix the moved code so behavior is identical to before the move.',
    implSeamWatch: (m) => '- REWRITE EVERY REFERENCE: there is no shim mechanism — grep the whole repo for each moved symbol and for the old file path, and rewrite ALL of them within this same change.',
    implGuardAudit: (m, destModule) => '- SOURCE-TEXT GUARDS (rare but possible): grep ' + TDIRX() + ' for any test that reads ' + m.TARGET + ' as text and asserts on its literal contents; repoint any such assertion at ' + destModule + '. Add those test files to files_touched.',
    valSeamNote: (m) => 'PAY SPECIAL ATTENTION to failures that name the moved symbols or the old file path — a missed reference rewrite is the classic regression here.',
  },
}
// The resolved profile. Placeholder until DETECT settles ECOSYSTEM; every use is post-DETECT.
let P = PROFILES[ECOSYSTEM || 'python']

// CI-faithful verification surface. Everything runs through the project's own toolchain (uv for a
// uv-managed python repo, the detected package manager for node, go/cargo natively); the loop never
// trusts a bare interpreter on PATH when the project declares an env. These are `let` so the
// Setup-phase DETECT step can fill repo-appropriate values when the caller did not pass them.
// All defaults are NEUTRAL/empty — DETECT (or explicit args) supplies the real values.
// TEST_ROOT: where the suite lives. '' until detected (tests | test | dev/tests | spec | __tests__).
let TEST_ROOT = (typeof A.testRoot === 'string' && A.testRoot.trim()) ? A.testRoot.trim().replace(/\/+$/, '') : ''
let ENV_SETUP = A.envSetup || ''
// RUN_PREFIX: how project commands run ('uv run ' for a uv-managed python repo, else '').
let RUN_PREFIX = ''
// TEST_PREFIX: the command that runs tests on given paths (testCmdPrefix arg > DETECT > profile default).
let TEST_PREFIX = (typeof A.testCmdPrefix === 'string' && A.testCmdPrefix.trim()) ? A.testCmdPrefix.trim() : ''
// SMOKE: smokeCmd arg is a FULL override ('' explicitly disables — distinguished from "not passed").
const SMOKE_OVERRIDE = (typeof A.smokeCmd === 'string') ? A.smokeCmd.trim() : null
let SMOKE_BASE = ''      // non-python file-independent smoke (tsc --noEmit / go build / cargo check); DETECT fills
// BASE_IMPORTS (python-only concept): a fast set of top-level imports catching package-wide breakage.
// Each file's smoke ALSO imports that file's own public import path (see importSmokeFor). '' until
// the python DETECT derives it from the src package layout; ignored (with a log note) elsewhere.
let BASE_IMPORTS = A.baseImports || ''
// Build the smoke command for one file. Reads the resolved state at CALL time (always post-DETECT).
// python appends the file's own module to the import list; other profiles' smoke is file-independent.
// Returns '' when no smoke is configured (the validation prompt then skips that step).
const importSmokeFor = (shimMod) => {
  if (SMOKE_OVERRIDE !== null) return SMOKE_OVERRIDE
  if (ECOSYSTEM === 'python') {
    if (!BASE_IMPORTS.trim() && !shimMod) return ''
    const mods = BASE_IMPORTS.trim() ? BASE_IMPORTS + (shimMod ? ', ' + shimMod : '') : shimMod
    return RUN_PREFIX + 'python -c "import ' + mods + '"'
  }
  return SMOKE_BASE
}
let LINT = (typeof A.lintCmd === 'string' && A.lintCmd.trim()) ? A.lintCmd.trim() : ''
// Per-round lint runs on just the touched files. '' means "no linter configured" -> the per-round
// lint becomes a shell no-op so a linter-less repo is never RED'd by lint. DETECT sets this from the
// repo (python: ruff; node: eslint; go: go vet; rust: clippy when plausible). Explicit lintPerFile wins.
let LINT_PER_FILE_PREFIX = (typeof A.lintPerFile === 'string') ? A.lintPerFile.trim() : ''
// Baseline oracle: a fast keep-set the whole sweep is measured against for pre-existing redness.
// Empty default = the oracle runs over TEST_ROOT once detected.
let KEEP_SET = (Array.isArray(A.keepSet) && A.keepSet.length) ? A.keepSet : []
// Build the test command for a set of paths through the profile's runner. go paths become package
// patterns (./dir/...); rust ignores paths entirely (cargo test is whole-crate — a judgment call:
// path-scoped cargo test selection is by test NAME, not path, so every round runs the full crate
// suite); pytest keeps its quiet/no-cache flags only when the prefix still looks like pytest.
const TEST_CMD = (paths) => {
  const ps = (paths || []).filter(Boolean)
  if (!TEST_PREFIX) return (typeof A.oracleCmd === 'string' ? A.oracleCmd.trim() : '')
  if (ECOSYSTEM === 'rust') return TEST_PREFIX
  if (ECOSYSTEM === 'go') {
    const pk = Array.from(new Set(ps.map(p => {
      const d = isSourceFile(p) ? p.replace(/\/[^/]+$/, '') : p
      return './' + String(d).replace(/^\.\//, '').replace(/\/+$/, '') + '/...'
    })))
    return TEST_PREFIX + ' ' + (pk.length ? pk.join(' ') : './...')
  }
  const tail = /pytest/.test(TEST_PREFIX) ? ' -q -p no:cacheprovider' : ''
  return TEST_PREFIX + (ps.length ? ' ' + ps.join(' ') : '') + tail
}
// ORACLE_CMD: the baseline keep-set oracle command (oracleCmd arg wins; else keep-set/TEST_ROOT).
let ORACLE_CMD = (typeof A.oracleCmd === 'string' && A.oracleCmd.trim()) ? A.oracleCmd.trim() : ''
// Full-sweep validation fallback when a moved symbol is too pervasive to scope safely. The per-round
// `scope` agent narrows to a minimal subset per extraction; this is only the safety net. Defaults to
// the whole test tree (∪ keep-set) so nothing is missed; override valDirs to narrow it. Recomputed
// after DETECT (see recomputeDerived) since it depends on KEEP_SET + TEST_ROOT.
let VAL_DIRS = Array.from(new Set([...KEEP_SET, ...((Array.isArray(A.valDirs) && A.valDirs.length) ? A.valDirs : [TEST_ROOT])])).filter(Boolean)
// Recompute the KEEP_SET/TEST_ROOT-derived commands/sets. Called after DETECT reconciles them.
const recomputeDerived = () => {
  if (!HAS('oracleCmd')) {
    const oraclePaths = KEEP_SET.length ? KEEP_SET : (TEST_ROOT ? [TEST_ROOT] : [])
    ORACLE_CMD = TEST_PREFIX ? TEST_CMD(oraclePaths) : ''
  }
  VAL_DIRS = Array.from(new Set([...KEEP_SET, ...((Array.isArray(A.valDirs) && A.valDirs.length) ? A.valDirs : [TEST_ROOT])])).filter(Boolean)
}
// python3 availability (for the bundled stdlib-only recon scripts repo_scan.py + structure verifier —
// they run on ANY repo, not just Python ones). DETECT sets it; when false the ORGANIZE stage is
// skipped and the org-audit/verifier steps become no-ops (decompose/deepen still run).
let PY3 = true
let py3NoteLogged = false
// Run notes surfaced in the final report (degraded modes, skipped stages, ignored args).
const RUN_NOTES = []

// ---------- Per-file derivation ----------
// From a repo-relative source path derive: the file's public import path (MODULE_ID — the identity
// callers and test seams pin to: python = dotted module, everything else = repo-relative path without
// extension), a commit scope tag (<name>), and the destination package/directory new modules land in
// (the file's OWN directory by default, so extracted modules are flat siblings — a subdirectory named
// after the file would collide with the file itself, so flat siblings is the safe default).
// destPkgFor overrides per file.
const deriveFile = (rawPath) => {
  const target = String(rawPath).replace(/^\.\//, '').replace(/^\/+/, '')
  const moduleId = P.moduleIdFor(target)
  const scopeTag = stripExt(target.split('/').pop() || target)
  const destPkg = DEST_PKG_FOR[target] || (target.includes('/') ? target.replace(/\/[^/]+$/, '') : '.')
  const destPkgDotted = P.moduleIdFor(destPkg)
  return { target, moduleId, scopeTag, destPkg, destPkgDotted }
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
      hint: 'Read the live file and find the largest cohesive cluster of related definitions that can move to a focused sibling module behind the ecosystem\'s compat mechanism (see the shim guide in your brief). Confirm exact symbols + ranges against the real file.',
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
      hint: 'Find the largest cohesive cluster of related definitions within lines ' + lo + '-' + hi + ' of the file that can move to a focused sibling module behind the ecosystem\'s compat mechanism (see the shim guide in your brief). Confirm the exact symbols + current ranges against the live file (the line anchors are hints from the current file shape).',
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
// file's external surface by ANY path — every externally reachable name (and, where the ecosystem
// has one, every test seam pinned to the file's public import path) means EVERY extraction MUST
// keep that surface alive via the profile's compat mechanism (P.shimGuide). The validation gate
// (revert-on-red) + per-round oracle + git-clean ban remain the backstop.
const buildPanel = (ctx, stage) => {
  const { TARGET, MODULE_ID, DEST_PKG, CONTRACT_CENSUS, FILE_LINES, VAL_DIRS_STR } = ctx
  const m = { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED: ctx.DEST_PKG_DOTTED || '' }
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
        brief: `Determine whether the change can be done while preserving EVERY externally observable contract: public/plugin APIs (check package READMEs / doc comments for documented extension points), CLI surface, wire formats / outbound request payloads, persisted schemas (session stores, config files, DBs), error contracts callers depend on. A deepening reshapes internals BEHIND a seam. Cast a HARD VETO ONLY if the candidate INHERENTLY cannot preserve a contract by any implementation path (then it isn't a deepening). If a naive implementation would break a contract but a behaviour-preserving path exists (keep the old signature/shim/adapter), do NOT veto — instead list the exact behavior_invariants that must stay byte-identical (these become characterization-test targets + mandate constraints) and vote concerns. Difficulty of preserving the contract is a plan input, not a veto.`,
      },
      {
        role: 'Blast-Radius Engineer',
        hardVeto: false,
        brief: `Assess scope HONESTLY (the find pass routinely under-counts) and TURN IT INTO A PLAN — never a veto. Count call sites, import sites, and test-seam sites across the source tree AND ${TDIRX()}. ${P.seamGuide(m)} A large or judgment-heavy radius is fine; your job is to make it safe: put concrete preconditions into required_safeguards — every old import path that must keep resolving as "shim: <path>", and, when the change is too large to land correctly in a single round, a DECOMPOSITION into ordered safe sub-steps as "stage N: <bounded leaf-extraction that is independently behaviour-preserving and verifiable>". The loop re-finds after each commit, so a multi-stage change lands one safe leaf per round. Only vote veto if the radius reflects a FALSE PREMISE or an inherent contract break (defer to those lenses); otherwise vote approve (if a clean plan exists) or concerns (plan + caveats). Do NOT veto for size/difficulty/"needs judgment".`,
      },
      {
        role: 'Test-Net Architect',
        hardVeto: false,
        brief: `Make the change CATCHABLE — the classic trap is tests moving with the code so they pass while behaviour drifts. Require CHARACTERIZATION tests (golden-master, written and committed at the EXISTING interface BEFORE refactoring) for each behaviour the change touches; put each into required_safeguards as "characterization test: <behavior>". Name the full ${TDIRX()}/<sub> dirs whose suites must stay green. If behaviour is hard to pin (e.g. concurrency/race/timing), do NOT veto — instead prescribe HOW to net it: deterministic seams, fake clocks/loops, injected executors, thread-join probes, or staging the risky core into its own later round behind a smaller first step. Vote veto ONLY if NO net can exist even in principle for ANY decomposition (extremely rare); otherwise approve/concerns with the net spelled out.`,
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
- Moving/splitting symbols out of a big file: git mv for whole-file moves (preserve history) + ${P.codemodGuide} to relocate definitions and REWRITE all imports + any test-seam refs pinned to old paths — never hand-retype a large file.
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
      brief: `${TARGET} is imported/referenced by other source modules and may be pinned by test seams at its public import path ${MODULE_ID}. ${CONTRACT_CENSUS}
${P.contractTraps(m)}`,
    },
    {
      role: 'Blast-Radius Engineer',
      hardVeto: false,
      brief: `Assess scope HONESTLY (find passes routinely under-count) and TURN IT INTO A PLAN — never a veto. Count, across the source tree AND ${TDIRX()}: ${P.siteKinds(m)}, and internal references within ${TARGET} between the extracted cluster and the code that stays (these become the cross-module imports or seams after the move). A large radius is fine; make it safe: put every old import path that must keep resolving into required_safeguards as "shim: ${MODULE_ID}.<name>" (or this ecosystem's compat equivalent), and if the cluster is too tangled to move in one round, give a DECOMPOSITION into ordered sub-steps as "stage N: <bounded sub-cluster that moves cleanly on its own>". The loop re-finds after each commit, so a big carve-out lands one cohesive leaf per round. Only vote veto if the radius reflects a FALSE PREMISE or an inherent contract break (defer to those lenses); otherwise approve (clean plan) or concerns (plan + caveats). Do NOT veto for size/difficulty.`,
    },
    {
      role: 'Test-Net Architect',
      hardVeto: false,
      brief: `Make the extraction CATCHABLE. ${P.testNetTrap(m)} (b) the test dirs that must stay green (the validation scope): ${VAL_DIRS_STR}. If a symbol's behaviour is hard to pin, prescribe HOW to net it (golden-master against the existing interface BEFORE moving, deterministic seams, fake clocks/loops). Vote veto ONLY if NO net can exist even in principle (extremely rare); otherwise approve/concerns with the net spelled out.`,
    },
    {
      role: 'Decomposition Steward',
      hardVeto: false,
      brief: `You are the DIRECTION arbiter for GOD-FILE DECOMPOSITION. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md for vocabulary, but apply this loop's goal: ${TARGET} is a large god-file (~${FILE_LINES} lines) and the win is LOCALITY + NAVIGABILITY — concentrating one concern in one focused module under ${DEST_PKG} so a maintainer reads one place instead of scrolling a huge file. UNLIKE the deepening loop, a pure ORGANISATION move that improves locality IS a valid direction here even if it adds no new leverage at a smaller interface. Apply a navigability-aware deletion test: after the move, is the concept MORE local (one cohesive module) or did you just scatter it across more files you must now bounce between? Vote veto ONLY for genuine WRONG DIRECTION: (a) the move increases bouncing (splits a tight cluster across many files, or pulls out a fragment that still requires constant cross-reference to what stays), or (b) it fabricates a speculative port/seam with only one adapter (indirection, not locality — the two-adapter rule from DEEPENING.md still holds). A cohesive cluster moving to a focused module behind an UNCHANGED public import surface at ${MODULE_ID} (per this ecosystem's compat mechanism) = APPROVE. Difficulty/size are NOT your concern. Also weigh PLACEMENT: the extracted module should land in a convention-correct home (an existing/justified subdirectory under ${DEST_PKG}), not as yet another loose flat sibling in an already-large directory. Vote approve/concerns/veto with rationale naming the locality gain.${CONV}`,
    },
    {
      role: 'Execution Strategist',
      hardVeto: false,
      brief: `Decide HOW to land it — there is ALWAYS a how; never veto for "too hard/too big". ${TARGET} is ~${FILE_LINES} lines: hand-retyping or hand-moving symbols out of it is the #1 source of silent breakage — STRONGLY PREFER scripted/programmatic transformation. Inspect the real file (note line counts). ${P.shimGuide(m)}
Prescribe the mechanism in required_safeguards as "execution: <method> — <step>":
- Extracting a symbol cluster: ${P.codemodGuide} — a transform that (1) slices the named definitions byte-for-byte out of ${TARGET} into the new ${DEST_PKG}/<module>, (2) writes the compat shims described above back at the old path (where this ecosystem has them), and (3) rewrites any in-file references + cross-module imports. NEVER hand-retype the slice.
- Wide mechanical edits (rename across N sites): scripted, not file-by-file.
- A cluster too tangled for one round: do NOT reject — recommend execution_method:"staged" and split into ordered single-round leaves (coordinate with the Blast-Radius Engineer's stages).
- A tiny, localized move (a few short helpers): manual is acceptable but a scripted transform is still safer.
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
    ecosystem: { type: 'string', description: 'the resolved ecosystem this run operates under (python | node | go | rust | generic)' },
    env_ready: { type: 'boolean', description: 'true if the env-setup command succeeded (or none was needed) and the verification commands are runnable' },
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
          path: { type: 'string', description: 'repo-relative path to a source file' },
          lines: { type: 'number', description: 'wc -l line count of that file' },
        },
      },
    },
    detail: { type: 'string' },
  },
}

// Live import/seam contract census for one file's public import path — replaces hardcoded counts.
const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['total_patch_sites', 'total_import_sites'],
  properties: {
    total_patch_sites: { type: 'number', description: 'count of test-double sites pinned to this file\'s public import path (python patch()/monkeypatch; node jest.mock/vi.mock/require-path). Ecosystems with no patch-by-path mechanism (go/rust/generic) report 0 by design, with a note in detail.' },
    total_import_sites: { type: 'number', description: 'count of import / reference sites of this file\'s public import path across the test tree and the source tree' },
    src_importers: { type: 'number', description: 'rough count of distinct source modules that import this file' },
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
          symbols: { type: 'array', items: { type: 'string' }, description: 'exact top-level definition names (functions/classes/types, or method names) that move out of the target' },
          line_range: { type: 'string', description: 'approximate current line range in the target file, e.g. "1670-2010"' },
          dest_module: { type: 'string', description: 'proposed destination module path under the file\'s dest package — convention-correct per the CONVENTIONS block (an existing/justified subpackage), NOT a loose flat sibling' },
          placement_rationale: { type: 'string', description: 'why dest_module is the convention-correct home for this concern (cite the CONVENTIONS block / a sibling subpackage); avoid flat-sibling path bloat in an already-large directory' },
          problem: { type: 'string', description: 'why this concern is hard to navigate while embedded in the god-file' },
          solution: { type: 'string', description: 'plain-English description of the extraction + the shim left behind' },
          benefits: { type: 'string', description: 'in terms of locality/navigability (and leverage if any), and how tests improve' },
          strength: { type: 'string', enum: ['Strong', 'Worth exploring', 'Speculative'] },
          deletion_test: { type: 'string', description: 'navigability deletion test: after the move is the concept MORE local (one module) or just scattered?' },
          cohesion_note: { type: 'string', description: 'why the cluster is self-contained — what (if anything) ties it back to code that stays, and how the seam handles that' },
          est_blast_radius: { type: 'number', description: 'rough count of import + test-seam sites across the source tree and the test tree that reference these symbols' },
          patched_symbols: { type: 'array', items: { type: 'string' }, description: 'subset of symbols pinned by test seams at the file\'s public import path (python patch()/monkeypatch, node mocked module paths; empty for ecosystems without such seams) — these need extra shim + seam care' },
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
    required_safeguards: { type: 'array', items: { type: 'string' }, description: 'concrete preconditions (e.g. "shim: <old import path>.X", "characterization: the test seam at the old path still bites after the move", "execution: scripted codemod slices lines 1670-2010")' },
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
        dest_module: { type: 'string', description: 'final destination module path the implementer must create — convention-correct per the CONVENTIONS block (prefer an existing/justified subdirectory over a loose flat sibling in an already-large directory)' },
        dest_placement_rationale: { type: 'string', description: 'why dest_module is the convention-correct home (cite the CONVENTIONS block / target subdirectory)' },
        scaffold_files: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths of scaffold files the implementer must create empty so the destination is importable/buildable — e.g. a Python subpackage __init__.py; EMPTY for most other ecosystems' },
        validation_dirs: { type: 'array', items: { type: 'string' }, description: 'full test dirs that must stay green for this change (used by the deepen stage; decompose derives scope from moved symbols)' },
        shims_required: { type: 'array', items: { type: 'string' }, description: 'every <old import path>.<name> that must keep resolving via the ecosystem\'s compat mechanism (re-export shim / barrel / alias / pub use)' },
        characterization_tests_required: { type: 'array', items: { type: 'string' }, description: 'golden-master / seam-still-bites tests to write + commit BEFORE moving' },
        behavior_invariants: { type: 'array', items: { type: 'string' } },
        execution_method: { type: 'string', enum: ['programmatic', 'hybrid', 'staged', 'manual'], description: '"programmatic"/scripted codemod is the default for slicing symbols out of the god-file; "manual" only for a few short helpers; "staged" when the cluster is too tangled for one round.' },
        execution_plan: { type: 'array', items: { type: 'string' }, description: 'ordered concrete steps naming the exact mechanism (scripted slice, compat-shim write-back, reference rewrite)' },
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
    shims_written: { type: 'array', items: { type: 'string' }, description: 'the <old import path>.<name> compat re-exports written back at the target (empty where the ecosystem needs none, e.g. a Go same-package split)' },
    tests_changed: { type: 'array', items: { type: 'string' } },
    target_lines_after: { type: 'number', description: 'line count of the target file after the extraction (should shrink)' },
    detail: { type: 'string' },
  },
}

const VALIDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['passed', 'detail'],
  properties: {
    passed: { type: 'boolean', description: 'true ONLY if the smoke/compile check + the tests + lint all pass with NO new failures vs the per-round oracle' },
    import_smoke_ok: { type: 'boolean' },
    tests_ok: { type: 'boolean' },
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

// Per-file worktree bring-up: create an isolated checkout on a child branch, with its OWN project
// env where the profile requires one (python .venv / node node_modules; go/rust/generic skip it).
const WORKTREE_SETUP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok', 'env_ready'],
  properties: {
    ok: { type: 'boolean', description: 'true if the worktree exists on the child branch and is usable' },
    env_ready: { type: 'boolean', description: 'true if the worktree\'s own env is ready (python: its own .venv whose editable .pth points at the WORKTREE src; node: its own node_modules; ecosystems without a per-worktree env: always true)' },
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

// Per-round TARGETED test scope: the minimal subset of the test tree that exercises the moved symbols.
// confident:false => the symbol is too pervasive to scope safely; the loop runs the full sweep.
const SCOPE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['confident', 'test_paths', 'detail'],
  properties: {
    confident: { type: 'boolean', description: 'true ONLY if a targeted subset safely covers every site that exercises the moved symbols; false if a moved symbol is pervasive (referenced across many test subdirs / 40+ files) or hit indirectly by integration tests that do not name it — then the loop runs the FULL suite' },
    test_paths: { type: 'array', items: { type: 'string' }, description: 'minimal deduped list of test files (preferred) or dirs under the test root (repo-relative) that reference the moved symbols / pin them via a test seam / import the dest module / read the target as source text. Only meaningful when confident:true.' },
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

// Dedup a list of test targets and drop any file nested under an included dir. "File" is judged by
// the resolved source extensions (test files share them in every supported ecosystem).
const normalizePaths = (paths) => {
  const uniq = Array.from(new Set((paths || []).filter(Boolean).map(p => p.replace(/\/+$/, ''))))
  const dirs = uniq.filter(p => !isSourceFile(p))
  return uniq.filter(p => !isSourceFile(p) || !dirs.some(d => p.startsWith(d + '/')))
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

// Build the human-readable contract census string the panel briefs interpolate. moduleId is the
// file's public import path (python: dotted module; elsewhere: repo-relative path without extension).
const censusString = (c, moduleId) => {
  if (!c) return `Contract census for ${moduleId}: (unavailable — grep the import/seam sites yourself before voting).`
  const top = (c.top_symbols || []).map(s => `${s.name} ×${s.count}`).join(', ')
  const seamBit = (c.total_patch_sites || 0) > 0
    ? `~${c.total_patch_sites} test-seam site(s) pinned to ${moduleId} (patch/mock-by-path) and `
    : `no patch/mock-by-path test seams counted (${ECOSYSTEM === 'python' || ECOSYSTEM === 'node' ? 'none found' : 'this ecosystem has no patch-by-path mechanism — 0 by design'}) and `
  return `Contract census for ${moduleId} (computed live this run): ${seamBit}~${c.total_import_sites || 0} import/reference site(s) across ${TDIRX()} and the source tree; ~${c.src_importers || 0} source module(s) import it. Most-referenced symbols: ${top || '(none surfaced)'}. EVERY name currently reachable from ${moduleId} (the file's public import path) must STAY reachable from it after the move, via this ecosystem's compat mechanism, and every test seam pinned to that path must keep biting.`
}

// ================= Phase: Setup (once for the whole sweep) =================
phase('Setup')
log('Repo decomposition sweep starting on ' + ROOT + ' (branch=' + BRANCH + ', discover>' + DISCOVER_LINES + ' lines, per-file target<=' + TARGET_LINES + ', max ' + MAX_FILES + ' file(s), ' + MAX_ITERS + ' round(s)/file' + (SINGLE_TARGET ? ', SINGLE-FILE mode: ' + SINGLE_TARGET : '') + (SKIP_SETUP ? ', FAST SETUP (skip env sync + baseline oracle)' : '') + ')')

// ---- DETECT: derive the ecosystem + repo-appropriate defaults for values the caller did not pin ----
// A single read-only agent inspects the repo manifests, source layout, and toolchain and returns a
// config; each field fills the matching `let` ONLY when the caller passed no explicit arg (HAS()).
// Explicit args always win. Best-effort: if detection fails, neutral profile fallbacks stand and the
// loop proceeds.
const DETECT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: {
    ok: { type: 'boolean' },
    ecosystem: { type: 'string', description: "one of 'python' | 'node' | 'go' | 'rust' | 'generic'" },
    ecosystem_evidence: { type: 'string', description: 'the manifest / dominant-extension evidence the ecosystem verdict rests on' },
    python3_available: { type: 'boolean', description: 'true if a python3 (or python) interpreter is on PATH — required by the bundled stdlib-only recon scripts (repo_scan.py + structure verifier), which run on ANY repo, not just Python ones' },
    toolchain_ready: { type: 'boolean', description: "true if the ecosystem's primary tool is on PATH (python: uv or python; node: node + the detected package manager; go: go; rust: cargo)" },
    uses_uv: { type: 'boolean', description: 'python only: true when the project is uv-managed (uv.lock present, or pyproject + uv on PATH)' },
    src_root: { type: 'string', description: 'the source root dir, repo-relative ("src", "lib", "app", or "." for root-level package dirs / a flat layout)' },
    packages: { type: 'array', items: { type: 'string' }, description: 'python only: top-level importable package names under src_root (dirs with __init__.py)' },
    base_imports: { type: 'string', description: 'python only: comma-separated importable modules for a package-wide import smoke — one stable entry per top-level package (e.g. "pkg_a, pkg_b.cli")' },
    test_root: { type: 'string', description: 'where the test suite lives, repo-relative (manifest-configured location if set — pyproject testpaths, jest/vitest roots — else the first present of tests | test | dev/tests | spec | __tests__); "" when tests are colocated with the source (typical go/rust) or absent' },
    keep_set: { type: 'array', items: { type: 'string' }, description: 'a SMALL fast subset of test dirs (2-4) for the baseline oracle; [test_root] is fine if there are no sub-suites; [] when tests are colocated/absent' },
    env_setup: { type: 'string', description: 'the command that builds the CI-faithful env: python-uv -> "uv sync"; node -> the lockfile-matched install ("npm ci" if package-lock.json, "pnpm install --frozen-lockfile" if pnpm-lock.yaml, "yarn install --frozen-lockfile" if yarn.lock, "bun install" if bun.lockb, else "npm install"); go/rust -> "" (module/registry caches are automatic); else ""' },
    test_prefix: { type: 'string', description: 'the command that runs tests on given paths: python "uv run python -m pytest" (or "python -m pytest" without uv); node "npm test --" ONLY if package.json has a REAL test script (not the npm default error stub), else "npx vitest run" (vitest config/dep) or "npx jest" (jest config/dep), else ""; go "go test"; rust "cargo test"; generic ""' },
    smoke_cmd: { type: 'string', description: 'file-independent compile/smoke command: node "npx tsc --noEmit" when a tsconfig*.json exists else ""; go "go build ./..."; rust "cargo check --all-targets"; python "" (its smoke is built from base_imports); generic ""' },
    lint_cmd: { type: 'string', description: 'whole-repo lint command ONLY if a linter is actually configured (python ruff config/dep -> "uvx ruff check ." with uv else "ruff check ."; node eslint config -> "npx eslint ."; go -> "go vet ./..."; rust -> "cargo clippy -q" only if clippy is plausibly installed), else ""' },
    lint_per_file: { type: 'string', description: 'the per-file lint prefix matching lint_cmd (e.g. "uvx ruff check", "npx eslint", "go vet"), else ""' },
    test_dirs_for: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['package', 'test_dirs'],
        properties: { package: { type: 'string' }, test_dirs: { type: 'array', items: { type: 'string' } } },
      },
      description: 'per-package/subsystem test dirs that must stay green when that package is touched — the <src>/<pkg> <-> <test_root>/<pkg> mirror',
    },
    detail: { type: 'string' },
  },
}
const det = await agent(
  `Read-only — make NO edits. Detect the ECOSYSTEM and build/test configuration of the repo at ${ROOT} so an automated refactor loop uses repo-appropriate defaults. Run commands from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

${ECOSYSTEM
    ? '1. The ecosystem is PINNED by the caller: **' + ECOSYSTEM + '**. Do not second-guess it; report it in `ecosystem` and gather the fields below for it.'
    : '1. DETECT THE ECOSYSTEM from the manifests at the repo ROOT: pyproject.toml / setup.py / setup.cfg / uv.lock / requirements.txt -> python; package.json -> node; go.mod -> go; Cargo.toml -> rust; none of those -> generic. If SEVERAL match, prefer the one whose manifest governs the DOMINANT source extension under ' + JSON.stringify(SCAN_ROOTS) + ' (count files by extension: .py vs .ts/.tsx/.js/.jsx vs .go vs .rs); if still tied, prefer python > node > go > rust. Report the evidence in ecosystem_evidence.'}
2. TOOL AVAILABILITY (\`command -v\`): python3 (or python) — set python3_available (it powers the plugin's bundled stdlib-only recon scripts and is needed on ANY repo, not just Python ones); plus the ecosystem's own tools (python: uv + python; node: node + npm/pnpm/yarn/bun; go: go; rust: cargo) — set toolchain_ready. For python also set uses_uv (uv.lock present, or pyproject + uv on PATH).
3. SOURCE ROOT + layout: \`ls -1 ${ROOT}\`; use src/ if it exists, else the manifest-conventional root — python: src | the top-level package dir(s); node: src | lib | app; go: "." (package dirs at the root); rust: src. For python, also list the top-level importable PACKAGES (subdirs with __init__.py) and derive base_imports: ONE stable importable module per package (prefer the bare package name; if that import is heavy, a light submodule is fine) — they must ALL import cleanly on the current tree.
4. TEST ROOT: the manifest-configured location if set (pyproject [tool.pytest.ini_options] testpaths; jest/vitest config roots); else the first present of tests/ | test/ | dev/tests/ | spec/ | __tests__/; "" when tests are colocated with the source (typical for go/rust). keep_set: a small 2-4 dir fast subset under test_root ([test_root] when there are no sub-suites; [] when colocated/absent).
5. COMMANDS — env_setup, test_prefix, smoke_cmd, lint_cmd, lint_per_file exactly per the field descriptions in the output schema. DETECT, don't invent: for node, read package.json scripts.test and IGNORE the npm default stub (\`echo "Error: no test specified" && exit 1\`); pick the install command from the lockfile actually present; check for tsconfig*.json before proposing tsc; only report a linter that is actually configured (a config file or a declared dependency).
6. test_dirs_for: for each top-level package/subsystem, the test dirs that exercise it (the <test_root>/<package> mirror when it exists; omit packages with no mirror).
${SCAN_SCRIPT ? '7. You MAY run `python3 ' + SCAN_SCRIPT + ' . --large-cap 5000` for a structured view of the tree (stdlib-only, no project env needed) — only if python3 is available.\n' : ''}
Set ok:true if you produced a usable config; ok:false + detail if the repo is unreadable. Do NOT edit anything.`,
  { label: 'detect-config', phase: 'Setup', agentType: 'Explore', schema: DETECT_SCHEMA, model: M_COORD }
)
// ---- Resolve the ecosystem + profile (explicit arg always wins; detection fills the rest) ----
const D = (det && det.ok) ? det : null
if (!D) log('Detect: no usable config (' + ((det && det.detail) || 'agent produced no result') + ') — using neutral profile fallbacks / explicit args.')
if (!ECOSYSTEM && D && typeof D.ecosystem === 'string' && ALL_ECOSYSTEMS.includes(D.ecosystem.trim().toLowerCase())) {
  ECOSYSTEM = D.ecosystem.trim().toLowerCase()
}
if (!ECOSYSTEM) ECOSYSTEM = 'generic'
P = PROFILES[ECOSYSTEM]
PY3 = D ? D.python3_available !== false : true
if (!HAS('srcExts')) SRC_EXTS = P.exts
if (D) {
  if (!HAS('scanRoots') && D.src_root) SCAN_ROOTS = [D.src_root.replace(/\/+$/, '')]
  if (!HAS('testRoot') && typeof D.test_root === 'string') TEST_ROOT = D.test_root.trim().replace(/\/+$/, '')
  if (!HAS('keepSet') && Array.isArray(D.keep_set) && D.keep_set.length) KEEP_SET = D.keep_set
  if (!HAS('testDirsFor') && Array.isArray(D.test_dirs_for) && D.test_dirs_for.length) {
    const map = {}
    for (const e of D.test_dirs_for) { if (e && e.package && Array.isArray(e.test_dirs) && e.test_dirs.length) map[e.package] = e.test_dirs }
    if (Object.keys(map).length) TEST_DIRS_FOR = map
  }
}
if (ECOSYSTEM === 'python') {
  if (!HAS('baseImports') && D && D.base_imports && D.base_imports.trim()) BASE_IMPORTS = D.base_imports.trim()
} else if (HAS('baseImports')) {
  BASE_IMPORTS = ''
  log("Note: baseImports is a python-only concept — ignored for ecosystem '" + ECOSYSTEM + "'.")
  RUN_NOTES.push("baseImports arg ignored (python-only concept; ecosystem is '" + ECOSYSTEM + "')")
}
if (!HAS('envSetup')) ENV_SETUP = (D && typeof D.env_setup === 'string') ? D.env_setup.trim() : ENV_SETUP
const USES_UV = ECOSYSTEM === 'python' && ((D && D.uses_uv === true) || /(^|\s)uv(\s|$)/.test(ENV_SETUP))
RUN_PREFIX = USES_UV ? 'uv run ' : ''
if (!HAS('testCmdPrefix')) {
  TEST_PREFIX = (D && typeof D.test_prefix === 'string' && D.test_prefix.trim()) ? D.test_prefix.trim() : (P.defaultTestPrefix || '')
  if (ECOSYSTEM === 'python' && TEST_PREFIX && USES_UV && !/^uv /.test(TEST_PREFIX)) TEST_PREFIX = 'uv run ' + TEST_PREFIX
}
if (SMOKE_OVERRIDE === null) SMOKE_BASE = (D && typeof D.smoke_cmd === 'string' && D.smoke_cmd.trim()) ? D.smoke_cmd.trim() : (P.defaultSmoke || '')
if (!HAS('lintCmd') && D && typeof D.lint_cmd === 'string') LINT = D.lint_cmd.trim()
if (!HAS('lintPerFile')) {
  const dp = (D && typeof D.lint_per_file === 'string') ? D.lint_per_file.trim() : ''
  LINT_PER_FILE_PREFIX = dp || (LINT ? LINT.replace(/\s+(\.|\.\/\.\.\.)$/, '').trim() : (P.defaultLintPerFile || ''))
}
recomputeDerived()
log('Detect: ecosystem=' + ECOSYSTEM + (D && D.ecosystem_evidence ? ' [' + String(D.ecosystem_evidence).replace(/\s+/g, ' ').slice(0, 80) + ']' : ' [pinned/fallback]')
  + ', src=' + JSON.stringify(SCAN_ROOTS) + ', exts=' + JSON.stringify(SRC_EXTS.slice(0, 6)) + (SRC_EXTS.length > 6 ? '+' : '')
  + ', tests=' + (TEST_ROOT || '(none/colocated)') + ', keep=' + JSON.stringify(KEEP_SET)
  + ', env=' + (ENV_SETUP ? '"' + ENV_SETUP.slice(0, 40) + '"' : '(none needed)')
  + ', test="' + (TEST_PREFIX || '(none)') + '", smoke=' + (importSmokeFor('') ? '"' + importSmokeFor('').slice(0, 40) + '"' : '(none)')
  + ', lint=' + (LINT_PER_FILE_PREFIX || 'none')
  + (ECOSYSTEM === 'python' ? ', base_imports=' + (BASE_IMPORTS ? BASE_IMPORTS.split(',').length : 0) + ' module(s)' : '')
  + ', python3=' + PY3)

// ---- python3-availability hardening: the bundled recon scripts (repo_scan.py + structure verifier)
// are stdlib-python helpers that run on ANY repo. Without python3 the ORGANIZE stage cannot run and
// the org-audit / conventions verifier steps become no-ops (decompose/deepen still run).
if (!PY3) {
  if (STAGES.includes('organize')) {
    STAGES = STAGES.filter(s => s !== 'organize')
    log('ORGANIZE SKIPPED: python3 is not available for the recon scripts (repo_scan.py + structure verifier).')
    RUN_NOTES.push('organize skipped: python3 not available for the recon scripts (repo_scan.py + the structure verifier are stdlib-python helpers bundled by the plugin — install any python3 to enable the organize stage)')
  }
  RUN_NOTES.push('org-audit / conventions structure-verifier steps are no-ops this run: python3 not available')
}
// ---- 'generic' degraded mode: organize still runs (when python3 exists), but decompose/deepen only
// run when the caller supplied enough of a toolchain to gate on (testCmdPrefix or oracleCmd).
if (ECOSYSTEM === 'generic' && !(HAS('testCmdPrefix') || HAS('oracleCmd'))) {
  if (STAGES.some(s => s === 'decompose' || s === 'deepen')) {
    STAGES = STAGES.filter(s => s !== 'decompose' && s !== 'deepen')
    log('GENERIC DEGRADED MODE: decompose/deepen skipped — no test toolchain supplied for this unrecognized ecosystem.')
    RUN_NOTES.push("decompose/deepen skipped (generic ecosystem, degraded mode): pass testCmdPrefix (a command that runs tests on given paths) or oracleCmd (a fixed full-suite test command) — plus optionally smokeCmd and srcExts — to enable these stages")
  }
}
if (!STAGES.length) {
  return { aborted: 'Detect', ecosystem: ECOSYSTEM, reason: 'no runnable stages remain after ecosystem gating', notes: RUN_NOTES }
}

const SETUP_PROMPT = SKIP_SETUP
  ? `FAST SETUP for an automated god-file decomposition loop on the repo at ${ROOT} (ecosystem: ${ECOSYSTEM}). A previous run already set up the env and captured the test oracle, so SKIP the env setup and SKIP the baseline test run — but you MUST still do the cheap, load-bearing safety steps below. Anchor every git command with git -C "${ROOT}" (your cwd is NOT the repo).

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
5. CRITICAL — capture the PROTECTED UNTRACKED SET (this repo legitimately carries untracked dirs a blanket clean would destroy, e.g. .venv/, node_modules/, target/, archive/, build/): git -C "${ROOT}" ls-files --others --directory — put every line into baseline_untracked. Off-limits to all later revert/cleanup. Do NOT skip this even in fast setup.

Set env_ready:true (assumed from a prior run — do NOT run the env setup), ecosystem:"${ECOSYSTEM}", and baseline_red_tests:[] (skipped; each round captures its own targeted oracle). NEVER delete files. NEVER run \`git clean\`. NEVER push. Report branch + clean/commit + untracked state in detail.`
  : `You are preparing the repo at ${ROOT} (ecosystem: ${ECOSYSTEM}) for an AUTOMATED, multi-round loop that sweeps the source tree for oversized god-files and decomposes each into focused modules, driven by the improve-codebase-architecture skill at ${SKILL_DIR}. The loop extracts ONE cohesive cluster per round and commits after each, so it needs (a) a clean committed baseline on a dedicated branch and (b) a runnable, CI-faithful verification environment plus a baseline test oracle. Anchor every git command with git -C "${ROOT}" (your cwd is NOT the repo).

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
5. ${ENV_SETUP
      ? `Set up the CI-faithful env (a bare interpreter/test-runner on PATH is NOT acceptable when the project declares its own env). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`):
       ${ENV_SETUP}
   If the tool is missing or the setup fails, env_ready:false + explain (still return ok:true if git steps succeeded — the loop aborts cleanly at the first validation).`
      : `No env-setup step is needed for this ecosystem (${ECOSYSTEM} manages its own caches). Just verify the toolchain: the test command below (if any) must be runnable from inside the repo; set env_ready accordingly (true when nothing is missing).`}
6. ${ORACLE_CMD
      ? `Capture the BASELINE TEST ORACLE (keep-set already-red tests): cd "${ROOT}" && ${ORACLE_CMD} — record every failing test id into baseline_red_tests (empty = fully green).`
      : `No baseline oracle command is configured — set baseline_red_tests:[] (each round captures its own targeted oracle).`}
7. CRITICAL — capture the PROTECTED UNTRACKED SET (this repo legitimately carries untracked dirs a blanket clean would destroy): git -C "${ROOT}" ls-files --others --directory — put every line into baseline_untracked. Off-limits to all later revert/cleanup.

Set ecosystem:"${ECOSYSTEM}" in your result. NEVER delete files. NEVER run \`git clean\`. NEVER push. Report what you committed and env/oracle/untracked state in detail.`

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

// ---- SMOKE BASELINE ORACLE (Fix #1) ----
// Unlike the tests (which subtract a pre-existing-red oracle), the per-round smoke/compile check must
// pass ABSOLUTELY: anything already broken on the CLEAN tree would fail EVERY round's smoke and revert
// EVERY extraction, so the sweep could never commit. python: test each BASE_IMPORTS module individually
// on the clean tree and DROP the ones already broken at baseline (logged) — smoke then only asserts
// modules importable before we touched anything. Other ecosystems: run the file-independent smoke once
// on the clean tree and DISABLE it (with a note) if it is already red at baseline. Runs only when the
// env is ready (else smoke can't run at all). An explicit smokeCmd override is never auto-disabled.
if (setup.env_ready && ECOSYSTEM === 'python' && SMOKE_OVERRIDE === null && BASE_IMPORTS.trim()) {
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
  \`bash -c 'cd "${ROOT}" && ${RUN_PREFIX}python -c "import <module>"'\`
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
} else if (setup.env_ready && ECOSYSTEM !== 'python' && SMOKE_OVERRIDE === null && SMOKE_BASE) {
  const SMOKE_BASELINE_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['ok'],
    properties: { ok: { type: 'boolean', description: 'true if the smoke command exited 0 on the clean tree' }, detail: { type: 'string' } },
  }
  const smk = await agent(
    `Read-only — make NO edits. On the CLEAN committed tree at ${ROOT}, run the refactor loop's smoke/compile check ONCE so the loop knows whether it passes at baseline (a check that is already red on the clean tree cannot gate anything). Run synchronously in the foreground from inside the repo:
  \`bash -c 'cd "${ROOT}" && ${SMOKE_BASE}'\`
Set ok:true only on exit 0; otherwise ok:false with the tail of the error output in detail. Do NOT try to fix anything. Do NOT edit code.`,
    { label: 'smoke-baseline', phase: 'Setup', schema: SMOKE_BASELINE_SCHEMA, model: M_COORD }
  )
  if (smk && smk.ok === false) {
    log('Smoke baseline: "' + SMOKE_BASE + '" is ALREADY RED on the clean tree — disabling the per-round smoke gate (it could never pass). ' + ((smk.detail || '').slice(0, 120)))
    RUN_NOTES.push('per-round smoke check disabled: "' + SMOKE_BASE + '" was already failing at baseline (pass smokeCmd to override)')
    SMOKE_BASE = ''
  } else if (smk && smk.ok) {
    log('Smoke baseline: "' + SMOKE_BASE + '" passes on the clean tree.')
  } else {
    log('Smoke baseline step produced no result — keeping the smoke command as-is.')
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
2. For EACH such stale worktree: git -C "${ROOT}" worktree remove --force "<path>"  (removes its dir + any env inside it).
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
// back to convention-text-only judgement (mirrors the census-failure fallback). Both scripts are
// stdlib-only python — they need a python3 on PATH (NOT the project env) even on non-Python repos;
// without python3 this is a no-op returning null (noted once).
async function runStructVerify(extraArgs, phaseName, label, model, root) {
  if (!PY3) {
    if (!py3NoteLogged) { log('Structure verifier skipped: python3 is not available for the recon scripts — org checks are no-ops this run.'); py3NoteLogged = true }
    return null
  }
  const RT = root || ROOT   // run in the worktree when isolated; ROOT otherwise
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
      `Read-only — make NO edits. Produce a concise REPO ORGANIZATION CONVENTIONS block for the source tree at ${ROOT} (ecosystem: ${ECOSYSTEM}), to guide WHERE newly-created modules should be placed during automated refactors (so they land in logically-organized subdirectories, not as loose flat siblings that bloat a directory).

Sources to read and distill (do NOT copy verbatim — synthesize into <= ~30 lines):
- ${ORGANIZER_SKILL_DIR}/references/philosophy.md (the 8 organization principles — esp. "root holds intent", "no overstuffed directories" (repo_scan.py owns the flat-max threshold), "directories are nouns", "honor ecosystem idioms", progressive disclosure).
- ${ORGANIZER_SKILL_DIR}/references/language-layouts.md (the idiomatic source layout for this ecosystem: ${ECOSYSTEM}).
${CONVENTIONS_DOC ? '- ' + ROOT + '/' + CONVENTIONS_DOC + ' (project-specific layout notes — honor these over generic advice).\n' : ''}- The ACTUAL package/directory layout under the source root **${SCAN_ROOTS[0]}**: list it with \`bash -c 'cd "${ROOT}" && ls -1 ${SCAN_ROOTS[0]}'\`, then inspect the contents of the 2-3 largest packages/dirs (\`ls -1 ${SCAN_ROOTS[0]}/<pkg>\`) so the conventions name the REAL packages of THIS repo + their existing subdirectory patterns (mirror what already exists — do NOT invent a parallel scheme or copy names from another project).
${PY3 ? '- The current structure-verifier findings (which dirs are ALREADY over the flat-file limit, so new modules there MUST go into a subdirectory): run \`bash -c \'cd "' + ROOT + '" && ' + STRUCT_VERIFY_CMD + ' --subtree ' + SCAN_ROOTS[0] + '\'\`.\n' : '- (The deterministic structure verifier is unavailable this run — python3 is not on PATH — so derive the over-the-limit dirs from the ls listings above.)\n'}
Output a \`conventions\` string with: (1) the 1-line placement rule (a module extracted from <pkg> belongs in <pkg>/<concern-subdirectory> grouped by concern, NOT a flat sibling, especially when <pkg> is already at/over the flat-file limit); (2) the real package map + the existing subdirectory names to mirror (don't invent a parallel scheme); (3) which dirs are currently over the limit so placement avoids worsening them; (4) how tests mirror the source tree (${TEST_ROOT ? 'under ' + TEST_ROOT + '/<pkg>/...' : 'colocated with the source, per this ecosystem'}); (5) every relocation keeps the OLD public import path alive via this ecosystem's compat mechanism (python re-export shim / node barrel / go alias or same-package split / rust pub use). Keep it tight and factual.`,
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
  const dirs = Array.from(new Set((touchedPaths || []).filter(p => isSourceFile(p)).map(p => (String(p).includes('/') ? String(p).replace(/\/[^/]+$/, '') : '')).filter(Boolean)))
  const baseKeys = new Set(((STRUCT_BASELINE && STRUCT_BASELINE.findings) || []).map(f => f.check + '|' + f.path))
  const res = await runStructVerify(dirs.length ? ('--subtree ' + (dirs[0].split('/').slice(0, 2).join('/') || SCAN_ROOTS[0])) : '', phaseName, 'org-audit:' + mtag, M_AUDIT, root)
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
async function applyMemberOnRoot(PARAMS) {
  const { ctx, chosen, mtag, phaseOf, n, FLOOR, rounds, panelLog, cfg } = PARAMS
  const { TARGET, IMPORT_SMOKE } = ctx
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
  const ORACLE_RUN_CMD = TEST_CMD(VAL_PATHS)
  const roundOracle = await agent(
    ORACLE_RUN_CMD
      ? `Capture the CURRENT (pre-change) test failures on the clean committed tree at ${WORKDIR}, so a later validation pass can tell new regressions from pre-existing redness. The tree is clean — make NO edits. Run through the project's own toolchain, from inside the repo (\`bash -c 'cd "${WORKDIR}" && <cmd>'\`):
    ${ORACLE_RUN_CMD}
RUN IT SYNCHRONOUSLY IN THE FOREGROUND in a SINGLE Bash call and read the output directly. Set the Bash tool's timeout to 600000 (10 min) for this call so it does not get cut off. Do NOT use run_in_background. Do NOT redirect the output to a file and then wait for a notification — you are a subagent and will NOT be notified of background completion; backgrounding will hang this step. The command may take a couple of minutes; that is expected — just let it finish in the foreground.
This is the TARGETED validation scope for this round (the minimal subset covering the change's blast radius${ECOSYSTEM === 'rust' ? ' — cargo test selects by name, not path, so this runs the crate suite' : ' — NOT the whole suite'}). Record EVERY failing or erroring test id into red_tests, and the total collected count. Do NOT change the selection above. ALSO record the current HEAD short hash (git -C "${WORKDIR}" rev-parse --short HEAD) into base_sha — this is the round's base commit that the revert-on-red path must return to (undoing any commit an implementer wrongly makes mid-round). Do NOT edit code, do NOT commit.`
      : `No test command is configured for this repo, so there are no pre-change test failures to capture — set red_tests:[] and collected:0. The ONE load-bearing step: record the current HEAD short hash of the clean committed tree at ${WORKDIR} (git -C "${WORKDIR}" rev-parse --short HEAD) into base_sha — this is the round's base commit that the revert-on-red path must return to. Make NO edits, do NOT commit.`,
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
    const lintFiles = (curImpl.files_touched || []).filter(f => isSourceFile(f))
    // No configured linter -> a shell no-op so lint never REDs the round on a linter-less repo.
    const ROUND_LINT = !LINT_PER_FILE_PREFIX ? 'true'
      : (lintFiles.length ? (LINT_PER_FILE_PREFIX + ' ' + lintFiles.map(f => "'" + f + "'").join(' ')) : (LINT || 'true'))
    const TEST_SCOPE_CMD = TEST_CMD(VAL_PATHS)
    return await agent(cfg.validatePrompt(chosen, curImpl, TEST_SCOPE_CMD, ROUND_RED, ROUND_LINT, IMPORT_SMOKE),
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

// List every source file (profile extensions) over the threshold, largest-first. Re-runnable so the
// sweep can refresh the queue after each file (new extracted modules may themselves be oversized).
// DETERMINISTIC PATH (Fix #2): when a scanScript is available AND python3 exists to run it (the
// scanner is a bundled stdlib-python helper that works on ANY repo), drive discovery off
// repo_scan.py's machine-generated `large_source_files` JSON (a bounded {path,lines} array) rather
// than asking an agent to transcribe unbounded `wc -l` output — which silently truncated the
// worklist. The agent only relays a bounded JSON array; SCAN_ROOTS / EXCLUDE_GLOBS / SRC_EXTS /
// threshold filtering happens HERE.
async function discover(processed, discoverPhase, threshold) {
  const TH = Number.isFinite(threshold) ? threshold : DISCOVER_LINES
  let res
  if (SCAN_SCRIPT && PY3) {
    // repo_scan is stdlib-only → plain python3, no project env needed. --large-min at the god-file
    // threshold and a high --large-cap so a big worklist is never truncated.
    res = await agent(
      `Read-only — make NO edits. Run the deterministic repo scanner and relay its large-file list. Run EXACTLY this one command, synchronously in the foreground, and read its stdout directly:
\`bash -c 'cd "${ROOT}" && ${PY} ${SCAN_SCRIPT} . --large-min ${TH} --large-cap 5000'\`
It prints a JSON object. Take its \`large_source_files\` array — each element is {path, lines} (path repo-relative, biggest first) — and transcribe EVERY element VERBATIM into the \`files\` array of your structured result as {path, lines}. Do NOT filter, re-sort, summarize, or truncate; do NOT add or invent entries. If \`large_source_files\` is empty, return files:[]. If the command errors or emits no JSON, return files:[] and explain in detail. Do NOT edit anything.`,
      { label: 'discover', phase: discoverPhase || 'Discover', agentType: 'Explore', schema: DISCOVER_SCHEMA, model: M_COORD }
    )
  } else {
    // Fallback (no scanScript bundled, or no python3 to run it): LLM-transcribed `find | wc -l`
    // over the profile's source extensions.
    const nameClause = SRC_EXTS.map(e => '-name "*' + e + '"').join(' -o ')
    const prunes = ['__pycache__', 'node_modules', '.venv', 'target', 'dist', 'build', 'vendor', '.git', '.worktrees']
      .map(d => '-not -path "*/' + d + '/*"').join(' ')
    const testPrune = TEST_ROOT ? ' -not -path "' + TEST_ROOT + '/*" -not -path "*/' + TEST_ROOT + '/*"' : ''
    res = await agent(
      `Read-only. Find every SOURCE file (extensions: ${SRC_EXTS.join(' ')}) over ${TH} lines that is a candidate in the repo at ${ROOT}. Make NO edits.

Run EXACTLY this command (sorted largest-first so the files you want are all at the TOP of the output):
\`bash -c 'cd "${ROOT}" && find ${SCAN_ROOTS.join(' ')} -type f \\( ${nameClause} \\) ${prunes}${testPrune} -print0 | xargs -0 wc -l | sort -rn'\`

The output is \`<lines> <repo-relative-path>\` per line, biggest first. The first line is the \`total\` (skip it). Then come the files in descending size: take every line whose line-count is GREATER THAN ${TH} and STOP at the first line ≤ ${TH} (everything below it is too small).

CRITICAL OUTPUT CONTRACT: put EVERY qualifying file (lines > ${TH}) into the \`files\` array of your structured result as {path, lines} — transcribe ALL of them, do NOT summarize in prose, do NOT truncate, and do NOT return an empty array when the command printed qualifying lines. If you counted N files over ${TH}, the files array MUST have N entries. Do NOT edit anything.`,
      { label: 'discover', phase: discoverPhase || 'Discover', agentType: 'Explore', schema: DISCOVER_SCHEMA, model: M_COORD }
    )
  }
  const files = ((res && res.files) || [])
    .map(f => f && f.path ? { path: String(f.path).replace(/^\.\//, ''), lines: f.lines } : f)
    .filter(f => f && f.path && Number.isFinite(f.lines) && f.lines > TH)
    // SCAN_ROOTS / EXCLUDE_GLOBS / SRC_EXTS applied HERE (repo_scan scans the whole repo; the
    // fallback find pre-filters, but re-applying is harmless and keeps both paths consistent).
    .filter(f => isSourceFile(f.path) && underScanRoots(f.path) && !isExcludedPath(f.path))
    .filter(f => !processed.has(f.path))
    .sort((a, b) => b.lines - a.lines)
  return files
}

// ================= Per-stage apply config (prompts for applyMemberOnRoot) =================
// makeDecomposeCfg holds the proven god-file-split prompts (scope/implement/repair/validate/commit);
// makeDeepenCfg adapts them for in-place architectural deepenings. Both close over ctx + CONVENTIONS.
function makeDecomposeCfg(ctx) {
  const { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED, SCOPE_TAG } = ctx
  const m = { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED }
  // Shadow ROOT/BRANCH from the per-file isolation surface so every prompt below retargets this
  // file's worktree at K>1; falls back to the global values (K=1 / deepen / organize) unchanged.
  const ROOT = ctx.WORKDIR || A.projectDir
  const BRANCH = ctx.FILE_BRANCH || A.branch || 'optimize-codebase/auto'
  const CONV = ctx.CONVENTIONS ? ('\n\n=== REPO ORGANIZATION CONVENTIONS (place the new module in a convention-correct home, not a loose flat sibling) ===\n' + ctx.CONVENTIONS) : ''
  return {
    reportTargetLines: true,
    targetLines: TARGET_LINES,
    floorList: (chosen, FLOOR) => (FLOOR ? [FLOOR] : (KEEP_SET.length ? KEEP_SET.slice() : VAL_DIRS.slice())),
    fullList: () => VAL_DIRS,
    initialCurImpl: (impl, mandate) => ({
      new_module: impl.new_module || mandate.dest_module,
      shims_written: impl.shims_written || [],
      files_touched: (impl.files_touched || []).slice(),
      tests_changed: (impl.tests_changed || []).slice(),
      target_lines_after: impl.target_lines_after,
    }),
    scopePrompt: (chosen, FLOOR) =>
      `Read-only — make NO edits. Pick the MINIMAL set of tests that must run to catch any regression from extracting this cluster out of ${TARGET}, in the repo at ${ROOT}. The extraction MOVES these symbols while keeping the file's public import path ${MODULE_ID} alive per this ecosystem's compat mechanism (${ECOSYSTEM}):
  symbols: ${JSON.stringify(chosen.cand.symbols)}
  patched_symbols (test seams): ${JSON.stringify(chosen.cand.patched_symbols || [])}
  dest_module: ${chosen.mandate.dest_module}

Because the public surface is preserved, the regression surface is bounded by tests that actually exercise these symbols. Grep ${TDIRX()} (ripgrep) and, for EVERY moved symbol, find the test files that match:
${P.scopeGreps(m, chosen.mandate.dest_module)}

MANDATORY FLOOR: ${FLOOR ? `ALWAYS include the target file's own test directory **${FLOOR}** as a floor (verify it exists: \`bash -c 'cd "${ROOT}" && ls -d ${FLOOR}'\` — if it does NOT exist, use ${JSON.stringify(KEEP_SET.length ? KEEP_SET : [TEST_ROOT].filter(Boolean))} as the floor instead).` : `use ${JSON.stringify(KEEP_SET.length ? KEEP_SET : VAL_DIRS)} as the floor.`} test_paths MUST therefore be NON-EMPTY: at minimum the floor, plus any specific test files your grep surfaced. Prefer specific test files; a whole dir is fine when many files in it match. All paths repo-relative${TEST_ROOT ? ' under ' + TEST_ROOT + '/' : ''}. NEVER return an empty test_paths list (an empty list is NOT "run nothing" — it would force the entire suite).

Set confident:FALSE ONLY if a moved symbol is SO pervasive that even the floor + your greps cannot bound it safely — referenced across MANY (>~6) different test subdirectories OR in >~40 files, OR plausibly exercised by integration tests that do not name it. That is the RARE case; the floor handles the common "few/zero direct tests" case with confident:true. When confident:true, test_paths MUST cover the floor + every site you found. Report lint_paths (${TARGET} + ${chosen.mandate.dest_module}) and a site_counts tally of what you grepped.`,
    implPrompt: (chosen) => {
      const c = chosen.cand, mandate = chosen.mandate
      return `You are implementing ONE god-file decomposition from the improve-codebase-architecture skill, under a BINDING MANDATE from a decision panel. You work DIRECTLY in the repo at ${ROOT} (NOT a worktree) — anchor git with git -C "${ROOT}" and edit files under ${ROOT}. The tree is clean and committed. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md first; use that vocabulary. NEVER run \`git clean\`. Do NOT commit (a later step does).

GOAL: extract a cohesive cluster out of the god-file ${TARGET} into a focused module, keeping the file's external surface byte-identical to callers and test seams. ${P.shimGuide(m)}

Candidate:
  title: ${c.title}
  symbols: ${JSON.stringify(c.symbols)}
  line_range: ${c.line_range}${c._approxRange ? ' (APPROXIMATE — reused pooled candidate; the file drifted since the find. Locate the symbols by NAME in the LIVE file, do NOT trust these line numbers)' : ''}
  problem: ${c.problem}
  solution: ${c.solution}
  patched_symbols (test seams that MUST keep biting): ${JSON.stringify(c.patched_symbols || [])}

=== PANEL MANDATE (binding — deviating is grounds to abort) ===
Destination module: ${mandate.dest_module}${mandate.dest_placement_rationale ? ' (placement: ' + mandate.dest_placement_rationale + ')' : ''}
${(mandate.scaffold_files || []).length ? 'CREATE these scaffold files (empty) so the destination is importable/buildable (' + P.scaffoldNote + '):\n' + mandate.scaffold_files.map(s => '  - ' + s).join('\n') + '\n' : ''}Execution method: ${mandate.execution_method}
${mandate.execution_method === 'staged' ? `STAGED — move ONLY this sub-cluster (the loop continues the rest in later rounds):
  THIS ROUND: ${mandate.this_round_scope || '(see execution plan)'}
  DEFERRED (do NOT attempt now): ${mandate.deferred_stages.length ? mandate.deferred_stages.join(' | ') : '(none listed)'}
` : ''}Execution plan (follow in order):
${mandate.execution_plan.length ? mandate.execution_plan.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n') : '  (none specified — apply the method below with judgement)'}
Compat shims REQUIRED (every old import path that MUST keep resolving from ${MODULE_ID}, per the compat mechanism above):
${mandate.shims_required.length ? mandate.shims_required.map(s => '  - ' + s).join('\n') : '  (the panel listed none explicitly — you MUST still keep EVERY name you move reachable from ' + MODULE_ID + ' wherever it is imported or pinned by a test seam' + (ECOSYSTEM === 'generic' ? ', or rewrite every reference since this ecosystem has no shim mechanism' : '') + ')'}
Characterization tests REQUIRED (write + keep these):
${mandate.characterization_tests_required.length ? mandate.characterization_tests_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — but if any moved symbol is pinned by a test seam at the old path, add a test asserting that seam still intercepts the live call path after the move)'}
Behaviour invariants / externally reachable names that MUST stay identical:
${mandate.behavior_invariants.length ? mandate.behavior_invariants.map(s => '  - ' + s).join('\n') : '  (none stated)'}
Strongest dissent on record (heed it): ${mandate.dissent || '(none)'}

=== EXECUTION DISCIPLINE ===
- PREFER PROGRAMMATIC TRANSFORMATION. ${TARGET} is large — NEVER hand-retype the slice. Use ${P.codemodGuide}. The transform must:
    1. slice the mandated symbols BYTE-FOR-BYTE out of ${TARGET} into the new module ${mandate.dest_module} (preserve their bodies exactly — a line-by-line diff later must show a pure move),
    2. give the new module the imports/uses it needs (move or duplicate the file-level imports those symbols depend on),
    3. write the COMPAT SHIMS back at the old path exactly as the mechanism above describes (where this ecosystem has them), so every old reference keeps resolving to the SAME object/definition the live code now calls,
    4. rewrite any other in-file references and cross-module imports as needed.
- PLACEMENT: put the new module at the convention-correct path the mandate names (an existing/justified subdirectory), NOT a loose flat sibling in an already-large directory. Create any mandated scaffold_files (empty).
${P.implSeamWatch(m)}
- CHARACTERIZATION FIRST: write the mandated tests (esp. seam-still-bites) against the existing interface BEFORE moving, so drift is caught.
${P.implGuardAudit(m, mandate.dest_module)}
- Preserve EXACTLY: public/CLI surface, wire formats, persisted schemas, error contracts, and every externally reachable name. Replace-don't-layer tests at the new module's interface only where it genuinely improves them.
${ctx.IMPORT_SMOKE ? '- You MAY run \`bash -c \'cd "' + ROOT + '" && ' + ctx.IMPORT_SMOKE + '\'\` as a sanity check while working.' : '- No smoke command is configured; rely on the test scope for sanity checks while working.'}
- DO NOT COMMIT and DO NOT \`git add\`/\`git stash\`. Leave ALL your changes UNCOMMITTED in the working tree — a later step validates then commits. A commit you make here survives the revert-on-red path and leaks an orphan onto the branch.
- If honoring the mandate proves unsafe/oversized or the cluster is not actually cohesive (entangled with code that stays), make NO partial edits: run the safe revert yourself (git -C "${ROOT}" checkout -- . ; remove only NEW untracked files you created) and return ok:false with the reason. Do NOT commit even on abort.

Report files_touched (every path created/modified, INCLUDING any source-text-guard tests you repointed), new_module, shims_written (the ${MODULE_ID}.<name> compat re-exports — empty if this ecosystem needed none), tests_changed, target_lines_after (wc -l of ${TARGET} — it should SHRINK), and a concise detail. Leave the change in the working tree (uncommitted) for validation.${CONV}`
    },
    validatePrompt: (chosen, curImpl, TEST_SCOPE, ROUND_RED, ROUND_LINT, IMPORT_SMOKE) =>
      `Validate a god-file decomposition just applied to the repo at ${ROOT}: the cluster "${chosen.cand.title}" was extracted from ${TARGET} into ${curImpl.new_module} behind the ecosystem's compat mechanism (${ECOSYSTEM}). Run everything through the project's own toolchain exactly as given below (do NOT substitute a bare interpreter/test-runner for a project-managed one${TEST_ROOT ? '; tests live under ' + TEST_ROOT + '/' : ''}). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

Run, in order (run ALL of them even if one fails). Run each SYNCHRONOUSLY IN THE FOREGROUND and read its output directly — set the Bash tool timeout to 600000 (10 min) for the test call. Do NOT use run_in_background and do NOT redirect to a file then wait for a notification (you are a subagent and will NOT be notified; backgrounding hangs this step). A couple of minutes is expected.
1. ${IMPORT_SMOKE ? P.smokeNoun + ' (this exercises that the public surface at ' + MODULE_ID + ' still resolves): ' + IMPORT_SMOKE : '(no smoke/compile check is configured for this run — set import_smoke_ok:true and move on)'}
2. ${TEST_SCOPE ? 'Tests — the TARGETED validation scope for this round: ' + TEST_SCOPE : '(no test command is configured — set tests_ok:true and rely on the other checks)'}
3. Lint (the files this round touched): ${ROUND_LINT}

A test counts as a REGRESSION only if it FAILS now and was NOT already failing in the oracle below. Pre-existing red tests are NOT regressions. Any characterization test the round added MUST be green. ${P.valSeamNote(m)}
PER-ROUND ORACLE (failures on these exact dirs, clean tree, before the change — pre-existing, NOT this round's fault):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none — these dirs were fully green on the clean tree)'}

Set passed:true ONLY if the smoke/compile check succeeds AND zero NEW test failures AND lint clean. List every new failure (test id + one-line cause, flag seam breaks) in new_failures. Report raw command tails. Do NOT edit code, do NOT commit.`,
    repairPrompt: (chosen, failures, val, curImpl, ROUND_RED) => {
      const c = chosen.cand
      return `You are REPAIRING a god-file decomposition that is ALREADY APPLIED to the working tree at ${ROOT} (UNCOMMITTED) but FAILED validation. FIX IT FORWARD so it passes — do NOT revert, do NOT \`git checkout\`/discard the extraction. Anchor git with git -C "${ROOT}". NEVER run \`git clean\`. Do NOT commit. Read ${SKILL_DIR}/LANGUAGE.md if you need the vocabulary.

CONTEXT — the extraction in the tree right now:
  cluster "${c.title}" moved from ${TARGET} -> ${curImpl.new_module}, with the old public surface at ${MODULE_ID} kept alive per this ecosystem's compat mechanism (${ECOSYSTEM}).
  symbols moved: ${JSON.stringify(c.symbols)}
  patched_symbols (test seams that must keep biting): ${JSON.stringify(c.patched_symbols || [])}
  files touched so far: ${(curImpl.files_touched || []).join(', ') || '(unknown — inspect git status)'}

VALIDATION FAILURES TO FIX (NEW regressions vs the pre-change oracle — the oracle reds below are pre-existing and NOT your problem):
${failures.length ? failures.map(s => '  - ' + s).join('\n') : '  (the validator set passed:false but did not enumerate failures — re-run the checks yourself; validator detail: ' + ((val && val.detail) || 'n/a') + ')'}
PRE-EXISTING ORACLE REDS (ignore):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none)'}

HOW TO FIX (diagnose each failure, then fix the RIGHT layer — do not paper over a real behavior break):
${P.repairHints(m, curImpl.new_module || '(the new module)')}
Leave ALL changes UNCOMMITTED for re-validation. If the extraction is fundamentally unsound (cannot be made green without undoing the move), set ok:false with the reason so the loop reverts as a last resort — but PREFER fixing forward.

Report files_touched (every path you created/modified this repair, INCLUDING repointed guard tests), new_module (${curImpl.new_module}), shims_written, tests_changed, target_lines_after (wc -l of ${TARGET}), and a concise detail. Leave changes uncommitted.`
    },
    commitPrompt: (chosen, curImpl, mtag, repairs) => {
      const c = chosen.cand
      const titleLine = c.title.replace(/\s+/g, ' ').slice(0, 60)
      return `A panel-approved god-file decomposition was applied to the repo at ${ROOT} (branch ${BRANCH}) and PASSED CI-faithful validation (smoke/compile check + targeted tests + lint, no regressions). Commit it. Anchor with git -C "${ROOT}". NEVER push.

Do:
1. git -C "${ROOT}" status --porcelain (expect ${TARGET} shrunk + the new module + any new tests; remove any stray /tmp codemod artifacts if they leaked into the tree).
2. git -C "${ROOT}" add -A
3. git -C "${ROOT}" commit -m "refactor(${SCOPE_TAG}): extract ${titleLine} from ${TARGET}

Decomposition round ${mtag}: moved a cohesive cluster (${(c.symbols || []).slice(0, 6).join(', ')}${(c.symbols || []).length > 6 ? ', …' : ''}) out of the ${TARGET} god-file into ${curImpl.new_module}, keeping the public surface at ${MODULE_ID} alive via compat shims so all imports and test seams are preserved. Panel-approved (${chosen.mandate.execution_method}); validated green${repairs > 0 ? ' after ' + repairs + ' repair pass(es)' : ''}.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
4. Report the new commit's short hash and files changed.`
    },
  }
}

function makeDeepenCfg(ctx) {
  const { TARGET } = ctx
  const m = { TARGET, MODULE_ID: ctx.MODULE_ID, DEST_PKG: ctx.DEST_PKG, DEST_PKG_DOTTED: ctx.DEST_PKG_DOTTED }
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
      `Read-only — make NO edits. Pick the MINIMAL set of tests that must run to catch any regression from this architecture deepening in the repo at ${ROOT}. The change touches these files (it reshapes internals behind a seam, keeping every moved import path alive per this ecosystem's compat mechanism — ${ECOSYSTEM}):
  files: ${JSON.stringify(chosen.cand.files)}
  dependency_category: ${chosen.cand.dependency_category}
  mandated validation dirs: ${JSON.stringify((chosen.mandate.validation_dirs) || [])}

Grep ${TDIRX()} (ripgrep) for tests that import — or pin via a test seam (patch/mock at an import path, where this ecosystem has that) — anything in those files, and ALWAYS include the mandated validation dirs above (and the keep-set ${JSON.stringify(KEEP_SET)}) as a floor. test_paths MUST be NON-EMPTY. Prefer specific test files; whole dirs are fine when many files match. All paths repo-relative${TEST_ROOT ? ' under ' + TEST_ROOT + '/' : ''}.

Set confident:FALSE only if the change is so cross-cutting that even the mandated dirs + your greps cannot bound it safely (then the loop runs the full sweep). Report lint_paths (the touched source files) and a site_counts tally.`,
    implPrompt: (chosen) => {
      const c = chosen.cand, mandate = chosen.mandate
      return `You are implementing ONE architecture DEEPENING from the improve-codebase-architecture skill, under a BINDING MANDATE from a decision panel. You work DIRECTLY in the repo at ${ROOT} (NOT a worktree) — anchor git with git -C "${ROOT}" and edit files under ${ROOT}. The tree is clean and committed. Read ${SKILL_DIR}/LANGUAGE.md and ${SKILL_DIR}/DEEPENING.md first; use that vocabulary. NEVER run \`git clean\`. Do NOT commit (a later step does).

GOAL: reshape the shallow module(s) behind a smaller, higher-leverage interface (locality + leverage), preserving EVERY externally observable contract. Keep every import path you move alive via this ecosystem's compat mechanism, so imports and any test seams pinned to old paths keep resolving. ${P.shimGuide(m)}

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
Compat shims REQUIRED (old import paths that must keep resolving):
${mandate.shims_required.length ? mandate.shims_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — still keep any import path you move alive per the compat mechanism above)'}
Characterization tests REQUIRED (write at the EXISTING interface BEFORE refactoring):
${mandate.characterization_tests_required.length ? mandate.characterization_tests_required.map(s => '  - ' + s).join('\n') : '  (none explicitly — add golden-master tests for each behaviour the change touches)'}
Behaviour invariants that MUST stay byte-identical:
${mandate.behavior_invariants.length ? mandate.behavior_invariants.map(s => '  - ' + s).join('\n') : '  (none stated)'}
Strongest dissent on record (heed it): ${mandate.dissent || '(none)'}

=== EXECUTION DISCIPLINE ===
- PREFER PROGRAMMATIC TRANSFORMATION over hand-retyping large files (use ${P.codemodGuide}; delete any throwaway transform script before finishing). Use \`git mv\` for whole-file moves to preserve history.
- CHARACTERIZATION TESTS FIRST: write the mandated tests against the existing interface; they must survive the refactor.
- Implement the deepening: reshape the shallow module(s) behind a small interface; update ALL call sites + add the mandated shims; preserve the listed invariants, public APIs, CLI, wire formats, persisted schemas EXACTLY. Replace-don't-layer tests at the new interface; only introduce a port/seam if two adapters justify it. If you create a NEW module, place it in a convention-correct home (see conventions below), not a loose sibling.
${P.implSeamWatch(m)}
- DO NOT COMMIT / \`git add\` / \`git stash\`. Leave ALL changes UNCOMMITTED for the validation step. A commit here survives revert-on-red and leaks an orphan.
- If the change proves unsafe/oversized or cannot honor the mandate, make NO partial edits: run the safe revert yourself (git -C "${ROOT}" checkout -- . ; remove only NEW untracked files you created) and return ok:false with the reason.

Report files_touched (every path created/modified, incl. new module + tests), new_module (if any), shims_written, tests_changed, and a concise detail. Leave the change uncommitted for validation.${CONV}`
    },
    validatePrompt: (chosen, curImpl, TEST_SCOPE, ROUND_RED, ROUND_LINT, IMPORT_SMOKE) =>
      `Validate an architecture deepening just applied to the repo at ${ROOT}: "${chosen.cand.title}" (files: ${JSON.stringify(chosen.cand.files)}). Run everything through the project's own toolchain exactly as given below (do NOT substitute a bare interpreter/test-runner for a project-managed one${TEST_ROOT ? '; tests live under ' + TEST_ROOT + '/' : ''}). Run from inside the repo (\`bash -c 'cd "${ROOT}" && <cmd>'\`).

Run, in order (run ALL of them even if one fails). Run each SYNCHRONOUSLY IN THE FOREGROUND; set the Bash tool timeout to 600000 (10 min) for the test call. Do NOT background or redirect-then-wait (you are a subagent and will NOT be notified).
1. ${IMPORT_SMOKE ? P.smokeNoun + ': ' + IMPORT_SMOKE : '(no smoke/compile check is configured for this run — set import_smoke_ok:true and move on)'}
2. ${TEST_SCOPE ? 'Tests — the TARGETED validation scope for this round: ' + TEST_SCOPE : '(no test command is configured — set tests_ok:true and rely on the other checks)'}
3. Lint (the files this round touched): ${ROUND_LINT}

A test is a REGRESSION only if it FAILS now and was NOT already failing in the oracle below. Any characterization test the round added MUST be green. ${P.valSeamNote(m)}
PER-ROUND ORACLE (pre-existing failures on these exact dirs, clean tree — NOT this round's fault):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none — these dirs were fully green on the clean tree)'}

Set passed:true ONLY if the smoke/compile check succeeds AND zero NEW test failures AND lint clean. List every new failure (test id + one-line cause) in new_failures. Report raw command tails. Do NOT edit code, do NOT commit.`,
    repairPrompt: (chosen, failures, val, curImpl, ROUND_RED) => {
      const c = chosen.cand
      return `You are REPAIRING an architecture deepening that is ALREADY APPLIED to the working tree at ${ROOT} (UNCOMMITTED) but FAILED validation. FIX IT FORWARD — do NOT revert/discard the change. Anchor git with git -C "${ROOT}". NEVER run \`git clean\`. Do NOT commit.

CONTEXT: "${c.title}" touching files ${JSON.stringify(c.files)}${curImpl.new_module ? ' (new module ' + curImpl.new_module + ')' : ''}. files touched so far: ${(curImpl.files_touched || []).join(', ') || '(inspect git status)'}.

VALIDATION FAILURES TO FIX (NEW regressions vs the pre-change oracle — the oracle reds below are pre-existing):
${failures.length ? failures.map(s => '  - ' + s).join('\n') : '  (validator set passed:false but did not enumerate failures — re-run the checks; validator detail: ' + ((val && val.detail) || 'n/a') + ')'}
PRE-EXISTING ORACLE REDS (ignore):
${ROUND_RED.length ? ROUND_RED.map(t => '  - ' + t).join('\n') : '  (none)'}

HOW TO FIX: add missing imports / fix the compat shims so old import paths resolve; ensure any test seam pinned to an old path (patch/mock, where this ecosystem has them) still bites through that path; repoint source-text/introspection guards to the new home; fix any genuine behaviour regression so behaviour is identical. Ecosystem-specific fix classes:
${P.repairHints(m, curImpl.new_module || '(the new module)')}
Leave ALL changes UNCOMMITTED for re-validation. If the deepening is fundamentally unsound, set ok:false so the loop reverts as a last resort — but PREFER fixing forward.

Report files_touched (incl. repointed guards), new_module, shims_written, tests_changed, and a concise detail.`
    },
    commitPrompt: (chosen, curImpl, mtag, repairs) => {
      const c = chosen.cand
      const titleLine = c.title.replace(/\s+/g, ' ').slice(0, 60)
      return `A panel-approved architecture deepening was applied to the repo at ${ROOT} (branch ${BRANCH}) and PASSED CI-faithful validation (smoke/compile check + mandated suites + lint, no regressions). Commit it. Anchor with git -C "${ROOT}". NEVER push.

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
  const { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED, SCOPE_TAG, IMPORT_SMOKE, CONTRACT_CENSUS } = ctx
  const m = { TARGET, MODULE_ID, DEST_PKG, DEST_PKG_DOTTED }
  // Shadow ROOT so every inline prompt (lane plan, find, panel, chair) targets this file's worktree
  // at K>1; falls back to the global ROOT (K=1 / deepen / organize) — behavior unchanged there.
  const ROOT = ctx.WORKDIR || A.projectDir
  const PANEL = ctx.PANEL
  const D = stage === 'deepen'                                  // deepen vs decompose branch
  const cfg = D ? makeDeepenCfg(ctx) : makeDecomposeCfg(ctx)    // stage-specific apply prompts
  const candKeyFn = D ? candKeyFiles : candKey                  // dedup by files (deepen) or symbols (decompose)
  // The file's own test dir (<src>/<pkg>/… -> <test_root>/<pkg>) — the MANDATORY validation floor so
  // a change with few/zero direct tests still validates against a fast, BOUNDED, relevant subset.
  // '' when the repo has no separate test root (colocated tests) — the scope prompt then floors on
  // the keep-set / VAL_DIRS instead.
  const FLOOR = TEST_ROOT ? (TEST_ROOT + '/' + ((TARGET.split('/')[1]) || '')).replace(/\/+$/, '') : ''
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
      `You are the LANE PLANNER for a god-file decomposition loop — file ${TARGET}, round ${n}. The target ${ROOT}/${TARGET} is CONSTANTLY CHANGING: every prior round carved a cohesive cluster out into ${DEST_PKG} and left thin compat shims/forwarders behind (per this ecosystem's mechanism), so ANY fixed line map is already stale. Read the ENTIRE current ${TARGET} as it exists RIGHT NOW (use the real file, not memory) and partition it into ${LANE_MIN}-${LANE_MAX} concern LANES that downstream read-only find agents will each mine in parallel for ONE extractable cluster.

Do NOT edit anything. After reading the whole file:
- MAP THE LINE MASS as it stands now — identify the largest current method/function clusters (e.g. run-loop orchestration, a big class's method groups, rendering/streaming, command dispatch, input handling) and whatever free-function regions remain.
- Carve into lanes that are MUTUALLY EXCLUSIVE by line range (no two lanes overlap) and each internally COHESIVE (a single concern a find agent can extract behind the ecosystem's compat mechanism).
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
        `You are running the EXPLORE step of the improve-codebase-architecture skill (read-only) anchored on ${ROOT}/${TARGET} (~${linesEnd} lines) and the modules it collaborates with under ${TARGET.includes('/') ? TARGET.replace(/\/[^/]+$/, '') : SCAN_ROOTS[0]}. Do NOT edit anything.

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

THIS LOOP'S GOAL is GOD-FILE DECOMPOSITION: ${TARGET} mixes many concerns in one large file, which is hard to navigate. A good candidate EXTRACTS a cohesive cluster of symbols (the ones in your lane hint, confirmed against the REAL current file) into a focused new module under ${DEST_PKG}, keeping the file's public import path ${MODULE_ID} alive so nothing downstream breaks. ${P.shimGuide(m)} The win is LOCALITY/NAVIGABILITY (one concern in one place), which is a VALID direction here even if the moved code gains no new leverage — UNLIKE a pure deepening loop.

Read the real file region for your lane and confirm:
- the EXACT symbol names + current line range that form a cohesive, self-contained cluster,
- a navigability DELETION TEST: after extraction, is the concept MORE local (one module) or just scattered across more files you must bounce between? Only the former earns "Strong".
- COHESION: what (if anything) ties the cluster back to code that stays in ${TARGET}, and whether a clean seam (cross-module import or lazy import) handles it. A cluster entangled with code that stays is NOT cohesive — say so and rate it lower.
- which symbols are pinned by imports or test seams at ${MODULE_ID} (${P.siteKinds(m)}; grep ${TDIRX()} and the source tree) — these need careful shims + seams.

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

Set confidence (0..1) after reading the file. Put concrete preconditions in required_safeguards (compat shims, characterization "seam-still-bites" tests, execution mechanism) and externally reachable names/behaviours that must not change in behavior_invariants. Cite file:line where you can.`,
          { label: 'panel:' + tag + ':' + p.role.split(' ')[0].toLowerCase() + ':' + cand.title.slice(0, 14).replace(/\s+/g, '-'), phase: phaseOf(n), schema: PANELIST_SCHEMA, model: p.hardVeto ? M_KEY : M_SOFT }
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
${ctx.CONVENTIONS ? '\nREPO ORGANIZATION CONVENTIONS — if the mandate creates a NEW module, set mandate.dest_module to a convention-correct home (an existing/justified subdirectory, NOT a loose flat sibling in an already-large directory) and explain it in mandate.dest_placement_rationale; list any scaffold files needed to make the destination importable/buildable in mandate.scaffold_files (' + P.scaffoldNote + '):\n' + ctx.CONVENTIONS + '\n' : ''}
DECISION RULE (autonomous, ${D ? 'deepening' : 'decomposition'} mode):
- decision:"implement" is the DEFAULT. Difficulty, large blast radius, hard-to-test behaviour, or "an unattended agent might struggle" are NOT reasons to reject — they are reasons to design a safer PATH (${D ? 'stage across rounds, add characterization nets, hold contracts via shims' : 'codemod the slice, stage across rounds, add characterization "patch-still-bites" nets, hold the surface via shims'}).
- decision:"reject" ONLY when: (a) the ${D ? 'Deepening' : 'Decomposition'} Steward establishes WRONG DIRECTION — ${D ? 'pure rename/indirection/file-move with NO real depth or locality gain' : 'the move scatters a concept across more files than before (worse navigability) or fabricates a speculative one-adapter port (indirection, not locality)'}, or (b) a lens shows the change INHERENTLY cannot preserve ${TARGET}'s external ${D ? 'behaviour/contracts' : 'surface'} by ANY path (almost never — a shim/adapter fixes it). A soft-veto for size/difficulty is NOT grounds to reject; absorb it into the plan.
- This round lands a small BATCH of ${D ? 'file-disjoint deepenings' : 'line-disjoint extractions'} and this candidate is ONE of them${D ? '' : ' (a giant lands solo)'}; judge it on its own merits and be decisive about ITS single best path.

When implementing, fill the FULL mandate:
${D
  ? '- mandate.shims_required (every old import path that must keep resolving via the ecosystem\'s compat mechanism), mandate.characterization_tests_required (golden-master at the EXISTING interface BEFORE refactoring), mandate.behavior_invariants, mandate.validation_dirs (full ' + (TEST_ROOT ? TEST_ROOT + '/<sub>' : 'test') + ' dirs that must stay green).\n- mandate.execution_method — "programmatic"/"hybrid" by default (scripted transforms, never hand-retype a large file); "manual" only for small localized changes; "staged" when too large for one round.\n- mandate.execution_plan — ordered concrete steps naming the exact mechanism (git mv / ' + P.codemodGuide + ' / scripted import rewrite). If the deepening creates a NEW module, place it in a convention-correct home and list any needed scaffold files in mandate.scaffold_files (' + P.scaffoldNote + ').'
  : '- mandate.dest_module (convention-correct under ' + DEST_PKG + ', NOT a loose flat sibling), mandate.dest_placement_rationale, mandate.scaffold_files (' + P.scaffoldNote + '), mandate.shims_required (EVERY ' + MODULE_ID + '.<name> that must keep resolving via the compat mechanism), mandate.characterization_tests_required (esp. "the test seam at ' + MODULE_ID + '.<sym> still bites" for every seam-pinned symbol), mandate.behavior_invariants.\n- mandate.execution_method — "programmatic"/scripted codemod by DEFAULT (never hand-retype a slice of a large file); "manual" only for a few short helpers; "staged" when the cluster is too tangled for one round.\n- If "staged": mandate.this_round_scope = the SINGLE bounded sub-cluster to move THIS round; mandate.deferred_stages = the rest. The loop re-finds and continues next round.\n- mandate.execution_plan — ordered concrete steps naming the exact mechanism (scripted slice of the named symbols out of ' + TARGET + ' via ' + P.codemodGuide + '; write the new module; write the compat shims back at the old path; rewrite cross-module imports; delete any throwaway transform script before finishing).'}
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
          scaffold_files: (Array.isArray(m.scaffold_files) ? m.scaffold_files.filter(Boolean) : []),
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
    target: TARGET, module_id: MODULE_ID, dest_pkg: DEST_PKG,
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

// Create an ISOLATED checkout for one file on a child branch, with its OWN project env where the
// profile requires one (perWorktreeEnv). Returns the working
// dir / branch / protected-untracked block the engine is parameterized on. No-op (returns globals)
// unless isolate.
async function bringUpWorktree(d, fileIndex, isolate) {
  if (!isolate) {
    return { ok: true, env_ready: true, isolated: false, workdir: ROOT, fileBranch: BRANCH, protectedBlock: PROTECTED_BLOCK }
  }
  const wpath = worktreePathFor(d), cbranch = childBranchFor(d)
  const setupPhase = 'DEC F' + fileIndex + ' ' + d.scopeTag + ' · Setup'
  phase(setupPhase)
  // Per-worktree env only where the profile requires one (python: own .venv because the root venv's
  // editable .pth pins ROOT's source; node: own node_modules). go/rust/generic share toolchain caches
  // safely and skip the env-sync step entirely.
  const envSteps = (P.perWorktreeEnv && ENV_SETUP)
    ? (ECOSYSTEM === 'python'
      ? `2. Build the worktree's OWN verification env — it starts with NO .venv, and validation MUST run against THIS worktree's edited source, so it CANNOT reuse ${ROOT}'s .venv (whose editable .pth hardcodes ${ROOT}/src):
   bash -c 'cd "${wpath}" && ${ENV_SETUP}'
3. ASSERT ISOLATION (load-bearing): the worktree's editable install must point at the WORKTREE's src, not ${ROOT}/src:
   bash -c 'cd "${wpath}" && cat .venv/lib/python*/site-packages/__editable__.*.pth'
   The printed path MUST start with ${wpath}/src. If it shows ${ROOT}/src (or no .venv was made), set env_ready:false and explain — validating against ROOT's source would green broken extractions. (If the project is NOT an editable install — no __editable__ .pth exists at all — a worktree-local .venv is sufficient; sanity-check with a quick import through the env instead.)`
      : `2. Build the worktree's OWN verification env — it starts with NO node_modules and validation MUST resolve THIS worktree's dependencies:
   bash -c 'cd "${wpath}" && ${ENV_SETUP}'
3. ASSERT ISOLATION: after the install, \`ls -d "${wpath}/node_modules"\` must succeed. If it does not (or the install failed), set env_ready:false and explain.`)
    : `2. This ecosystem (${ECOSYSTEM}) needs NO per-worktree env (the toolchain caches are shared safely) — skip any env setup.
3. Set env_ready:true (nothing to isolate).`
  const res = await agent(
    `Create an ISOLATED git worktree so this god-file can be decomposed WITHOUT colliding with other files being decomposed concurrently in their own worktrees. The MAIN repo is at ${ROOT} (base branch ${BRANCH}); anchor every git command as shown and do NOT touch ${ROOT}'s own working tree.

Do, in order:
1. Create the worktree on a NEW child branch off the CURRENT base HEAD (so it starts from all prior merged work). Use the EXACT branch name and path below — the loop's merge-back and teardown look the branch up by this exact name, so you MUST NOT substitute a different name, prefix, or separator:
   git -C "${ROOT}" worktree add -b "${cbranch}" "${wpath}" "${BRANCH}"
   If it fails because the branch/path already exists from a crashed prior run, clean and retry ONCE with the SAME name:
   git -C "${ROOT}" worktree remove --force "${wpath}" 2>/dev/null; git -C "${ROOT}" branch -D "${cbranch}" 2>/dev/null; then re-run the identical add.
   If the add STILL fails, set ok:false and report the exact git error verbatim. Do NOT invent an alternative branch name to work around an error — a mismatched name silently breaks merge-back.
${envSteps}
4. Capture the worktree's OWN protected untracked set: git -C "${wpath}" ls-files --others --directory → protected_untracked.

NEVER run \`git clean\`. NEVER push. Report ok (worktree exists on the child branch), env_ready, worktree_path, branch, protected_untracked, detail.`,
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
1. git -C "${ROOT}" worktree remove --force "${wpath}"   (removes the worktree directory AND any env inside it).
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
  log('=== ' + (isDeepen ? 'Deepen' : 'Decompose') + ' file ' + fileIndex + ': ' + d.target + ' (' + entry.lines + ' lines) → import path ' + d.moduleId + ', dest ' + d.destPkg + (isolate ? ', isolated worktree' : '') + ' ===')
  const errResult = (convergence, extra) => ({
    target: d.target, module_id: d.moduleId, dest_pkg: d.destPkg, stage, convergence,
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
  const mCensus = { TARGET: d.target, MODULE_ID: d.moduleId, DEST_PKG: d.destPkg, DEST_PKG_DOTTED: d.destPkgDotted }
  try {
    census = await agent(
      `Read-only — make NO edits. Compute the import/seam CONTRACT CENSUS for ${d.target} (public import path: ${d.moduleId}) in the repo at ${WORKDIR}, so a decision panel knows the real blast radius. Use ripgrep from inside the repo (\`bash -c 'cd "${WORKDIR}" && rg …'\`). ${P.seamGuide(mCensus)}
${P.censusBody(mCensus)}

Return your result ONLY via the StructuredOutput tool, using EXACTLY these fields and NO others: total_patch_sites (number, required), total_import_sites (number, required), src_importers (number), top_symbols (array of {name, count}), detail (string). Do NOT add an "answer" field or any prose field — additional properties are REJECTED. Put any one-line narrative in "detail" only. Do NOT edit anything.`,
      { label: 'census:' + prefix.trim() + fileIndex, phase: filePhase, schema: CENSUS_SCHEMA, model: M_COORD }
    )
  } catch (e) {
    log('File ' + fileIndex + ' census failed (' + ((e && e.message) ? e.message.slice(0, 80) : 'error') + ') — using generic census fallback; panelists grep sites themselves.')
  }
  const CONTRACT_CENSUS = censusString(census, d.moduleId)
  log('File ' + fileIndex + ' census: ' + CONTRACT_CENSUS.replace(/\s+/g, ' ').slice(0, 200))
  const ctx = {
    TARGET: d.target, MODULE_ID: d.moduleId, DEST_PKG: d.destPkg, DEST_PKG_DOTTED: d.destPkgDotted,
    SCOPE_TAG: d.scopeTag, FILE_LINES: entry.lines, IMPORT_SMOKE: importSmokeFor(d.moduleId),
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
   \`${PY} -c "import json; d=json.load(open('${planPath}')); print('moves', len(d.get('moves', [])))"\`
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
log('Run finished: ecosystem=' + ECOSYSTEM + ', stages=[' + STAGES.join(', ') + '] — ' + fileResults.length + ' engine file(s), ' + engineApplied + ' extraction/deepening(s) landed, ' + orgResults.length + ' organize pass(es)/' + orgMoves + ' moves. stop=' + (sweepStop || 'complete') + (RUN_NOTES.length ? '. Notes: ' + RUN_NOTES.join(' | ') : ''))

return {
  branch: BRANCH,
  ecosystem: ECOSYSTEM,
  notes: RUN_NOTES,
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
