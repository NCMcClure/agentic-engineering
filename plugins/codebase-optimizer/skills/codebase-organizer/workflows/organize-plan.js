export const meta = {
  name: 'codebase-organize-plan',
  description: 'Read-only: scan a repo, design a clean progressive-disclosure target tree, build an ordered move list with predicted reference impact, adversarially critique the plan, and write it to disk for human approval',
  phases: [
    { title: 'Scan', detail: 'deterministic recon + Explore fan-out over the tree' },
    { title: 'Design', detail: 'target tree + root declutter + overstuffed-dir splits' },
    { title: 'RefImpact', detail: 'predict which references each move breaks' },
    { title: 'Critique', detail: 'adversarial critic checks safety/completeness' },
    { title: 'Finalize', detail: 'assemble plan and return it (skill persists to disk)' },
  ],
}

// args may arrive as a JSON string in the sandbox — coerce defensively.
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
if (!A || typeof A !== 'object') A = {}

const ROOT = A.projectDir || ''
const DATE = A.dateToday || 'unknown-date'
const SKILL_DIR = A.skillDir || ''
const DEPTH = A.depth === 'root-only' ? 'root-only' : 'recursive'
const PLAN_PATH = A.planPath || (ROOT + '/.codebase-organizer-plan.json')
// EXCLUDE: repo-relative path prefixes the planner must NOT move or restructure (e.g. test trees
// whose path-depth math / dynamic discovery makes reorg moves unsafe). Normalized to no leading "./"
// and no trailing "/". Used three ways: drop excluded dirs from recon/explore, inject a hard "do not
// touch" constraint into the Design + Critique prompts, and filter any move whose `from` lands under
// an excluded prefix as a backstop.
const EXCLUDE = (Array.isArray(A.exclude) ? A.exclude : (A.exclude ? [A.exclude] : []))
  .map(p => String(p).replace(/^\.\//, '').replace(/\/+$/, ''))
  .filter(Boolean)
// MODEL TIERING. The DESIGN architect and the adversarial CRITIC are heavy-judgment roles whose
// structured output is large and must be coherent — a cheap tier (e.g. Haiku) both reasons worse AND
// flakily emits degenerate StructuredOutput (an empty/placeholder plan that then reds the critic). Pin
// them to a key model (default Opus). Mechanical greps (recon transcription, ref-impact) inherit the
// sub-workflow default unless mechModel is given.
const KEY_MODEL = A.keyModel || 'opus'
const MECH_MODEL = A.mechModel || undefined  // undefined => inherit caller/default tier
const isExcluded = (p) => {
  if (!p) return false
  const n = String(p).replace(/^\.\//, '').replace(/\/+$/, '')
  return EXCLUDE.some(ex => n === ex || n.startsWith(ex + '/'))
}

if (!ROOT) {
  return { error: 'projectDir is required (absolute path to the repo to organize)' }
}

// ---------- Schemas ----------
const PROFILE_NOTES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'observations'],
  properties: {
    area: { type: 'string' },
    grouping_signal: { type: 'string', description: 'How the files in this area naturally cluster (by feature noun? by layer/type? not at all?) and what split the names suggest' },
    entry_points: { type: 'array', items: { type: 'string' }, description: 'Files that look like real entry points (main, cli, index, app) that must stay reachable' },
    observations: { type: 'array', items: { type: 'string' }, description: 'Concrete facts about this area relevant to reorganizing it, with paths' },
  },
}

const MOVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'rationale'],
  properties: {
    from: { type: 'string', description: 'path relative to repo root' },
    to: { type: 'string', description: 'destination path relative to repo root' },
    rationale: { type: 'string', description: 'which philosophy principle / idiom this serves' },
    risk: { enum: ['mechanical', 'risky'], description: 'mechanical = plain move; risky = large blast radius, dynamic refs, or a refactor' },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ecosystems', 'target_tree', 'root_disposition', 'moves', 'cruft', 'summary'],
  properties: {
    ecosystems: { type: 'array', items: { type: 'string' } },
    target_tree: { type: 'string', description: 'ASCII tree of the proposed top 2-3 levels with one-line purpose per top-level dir' },
    root_disposition: {
      type: 'object',
      additionalProperties: false,
      required: ['keep', 'nest'],
      properties: {
        keep: { type: 'array', items: { type: 'string' }, description: 'root entries that stay (intent files)' },
        nest: { type: 'array', items: { type: 'string' }, description: 'root entries being moved off the root, with their destination noted' },
      },
    },
    moves: { type: 'array', items: MOVE_SCHEMA },
    new_files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'purpose'],
        properties: {
          path: { type: 'string', description: 'path of an empty/scaffolding file to create (e.g. a package __init__.py)' },
          purpose: { type: 'string', description: 'why it is needed (e.g. "marks src/messy_pyapp as a package")' },
        },
      },
      description: 'Files to CREATE (not move) to make the target layout valid — e.g. __init__.py for new Python subpackages. Do NOT encode these as moves.',
    },
    cruft: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quarantine: { type: 'array', items: { type: 'string' }, description: 'paths to move to archive/ for human deletion' },
        gitignore: { type: 'array', items: { type: 'string' }, description: 'patterns/paths to add to .gitignore (build caches, ephemera)' },
      },
    },
    summary: { type: 'string', description: 'plain-language before->after, 4-8 sentences' },
  },
}

const REF_IMPACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['impacts'],
  properties: {
    impacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['move_from', 'move_to', 'fixes'],
        properties: {
          move_from: { type: 'string' },
          move_to: { type: 'string' },
          fixes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['file', 'category', 'detail', 'confidence'],
              properties: {
                file: { type: 'string', description: 'file that references the moved path' },
                category: { enum: ['code-import', 'build-config', 'ci', 'container', 'docs', 'dynamic-runtime', 'test-config', 'path-math', 'name-string', 'discovery-glob', 'test-monkeypatch'] },
                detail: { type: 'string', description: 'old string -> new string, or what must change' },
                confidence: { enum: ['mechanical', 'risky'], description: 'risky = relative-import depth shift, dynamic path, or build-semantics' },
              },
            },
          },
        },
      },
    },
  },
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'risks', 'corrections'],
  properties: {
    verdict: { enum: ['sound', 'sound-with-risks', 'unsafe'], description: 'overall judgment of the SALVAGEABLE plan (i.e. after the unsafe_moves below are dropped). Use "unsafe" ONLY if a hazard cannot be fixed by dropping individual moves (e.g. the whole approach is wrong). If the only problems are specific bad moves, list them in unsafe_moves and set verdict to sound-with-risks.' },
    risks: { type: 'array', items: { type: 'string' }, description: 'specific moves that are unsafe, ambiguous, or high-blast-radius, each with the reason' },
    corrections: { type: 'array', items: { type: 'string' }, description: 'concrete fixes the plan should adopt (moves to drop, merge, reorder, or re-target)' },
    unsafe_moves: {
      type: 'array',
      description: 'EXACT moves that must be DROPPED from the plan before apply because they are unsafe and cannot be made safe by reference-rewriting alone (e.g. require a logic change apply will not make, break path-math the ref_impact got wrong, or are data-loss-adjacent). The workflow drops precisely these and applies the rest. Identify each by its from/to so it can be matched mechanically. Be surgical: list ONLY the genuinely unsafe moves, not every move you have a mild concern about.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'reason'],
        properties: {
          from: { type: 'string', description: 'the move\'s source path, copied verbatim from the plan move' },
          to: { type: 'string', description: 'the move\'s destination path, copied verbatim from the plan move' },
          reason: { type: 'string', description: 'why this specific move is unsafe and unfixable-by-rewrite' },
        },
      },
    },
  },
}

// ---------- Shared prose ----------
const READ_REFS = `Before deciding anything, read the organizer's taste from these files (they encode the opinionated rules you must apply):
- ${SKILL_DIR}/references/philosophy.md (the eight principles; the goal is a root a newcomer reads in 30 seconds)
- ${SKILL_DIR}/references/language-layouts.md (idiomatic target tree for the detected ecosystem — honor it over a generic template)`

const EXCLUDE_NOTE = EXCLUDE.length
  ? `\n\nEXCLUDED TREES (do not REORGANIZE, but DO update their references): ${EXCLUDE.map(e => '`' + e + '`').join(', ')}.
The exclusion is about MOVING, not about referencing. Precisely:
- Do NOT propose any move whose source OR destination is under an excluded tree, do NOT restructure their internals, and do NOT quarantine files inside them. They keep their current locations.
- BUT references that live INSIDE these excluded trees ARE rewritten by the apply phase when a NON-excluded module moves. In particular, test files under an excluded test tree commonly pin source modules by string: \`mock.patch("pkg.mod.attr")\`, \`monkeypatch.setattr("pkg.mod.attr", ...)\`, and plain imports. When you move a src/ module, those test references must be (and WILL be) rewritten to the new dotted path.
- THEREFORE: do NOT refuse or avoid a perfectly good src/ reorganization move merely because an excluded test file references the module. That is NOT a blocker — it is an ordinary reference fix. Instead, propose the move AND ensure its ref_impact enumerates every referencing site, INCLUDING the ones inside the excluded test tree (category test-monkeypatch / code-import), so apply rewrites them. The only moves to drop are those with references you genuinely cannot enumerate (truly dynamic/computed), not ones merely referenced from tests.
You may freely reorganize the REST of the repo (notably the src/ packages).`
  : ''

// ---------- Phase 1: Scan ----------
phase('Scan')
log('Running deterministic recon on ' + ROOT)

// repo_scan.py emits JSON to stdout. Anchor cwd to the repo (workflow cwd != project).
// Forward exclusions to the recon script so excluded subtrees are pruned DURING
// the walk — they never enter the census, overstuffed detection, large-file list,
// or sample output the planner sees (post-scan JS filtering left them visible).
const EXCLUDE_FLAGS = EXCLUDE.map(e => ` --exclude ${JSON.stringify(e)}`).join('')
const scanRaw = await agent(
  `Run the repository recon script and return its JSON output verbatim.

Run exactly this (the script is stdlib-only Python):
\`\`\`
cd "${ROOT}" && python3 "${SKILL_DIR}/scripts/repo_scan.py" "${ROOT}"${EXCLUDE_FLAGS}
\`\`\`
If python3 is unavailable, try python. Capture the script's STDOUT (it is a single JSON object) and return it as your entire final message — raw JSON, no commentary, no code fences. If the script errors, return a JSON object {"error": "<the stderr>"}.`,
  { label: 'recon-scan', phase: 'Scan' }
)

let profile = {}
try {
  const m = scanRaw.match(/\{[\s\S]*\}/)
  profile = m ? JSON.parse(m[0]) : {}
} catch (e) { profile = {} }
if (profile.error) log('Scan reported: ' + profile.error)

const overstuffed = (profile.overstuffed_dirs || [])
  .filter(d => (d.source_file_count || d.file_count) >= 25)
  .filter(d => !isExcluded(d.path))
if (EXCLUDE.length) log('Excluding from reorg (will not move/restructure): ' + EXCLUDE.join(', '))
log('Scan done: ' + (profile.totals ? JSON.stringify(profile.totals) : 'no totals') + '; ' + overstuffed.length + ' overstuffed source dirs')

// Fan out read-only Explore agents: one for the root, plus the biggest overstuffed
// source dirs (capped), to characterize how each area naturally groups.
const exploreTargets = [{ area: '.', label: 'root' }]
if (DEPTH === 'recursive') {
  for (const d of overstuffed.slice(0, 6)) exploreTargets.push({ area: d.path, label: d.path })
}

const profileNotes = (await parallel(exploreTargets.map(t => () =>
  agent(
    `You are characterizing one area of the repository at ${ROOT} for a reorganization plan. Read-only.

AREA: ${t.area === '.' ? 'the repository ROOT (loose top-level files and directories)' : t.area}

${READ_REFS}

Recon profile (facts already gathered — do not recompute, build on it):
${JSON.stringify(t.area === '.' ? { root: profile.root, ecosystems: profile.ecosystems, totals: profile.totals } : (overstuffed.find(d => d.path === t.area) || {}), null, 1)}

Examine the actual files in this area (read names, peek at a few to confirm intent). Determine: how do these files naturally cluster — by feature/domain noun, by layer/type, or not at all? What does that imply for splitting them? Which files are genuine entry points that must stay reachable after moving? Note anything that would make a move risky (dynamic imports, files read by path at runtime, package boundaries). Report concrete facts with paths, not vague impressions.`,
    { label: 'explore:' + t.label, phase: 'Scan', agentType: 'Explore', schema: PROFILE_NOTES_SCHEMA }
  )
))).filter(Boolean)

// ---------- Phase 2: Design ----------
phase('Design')
const plan = await agent(
  `You are the lead architect of a codebase reorganization for the repo at ${ROOT}. Produce a concrete, opinionated plan that makes the root readable in 30 seconds and gives every overstuffed area a second organizing layer. Read-only — you are designing, not moving.

${READ_REFS}

DETECTED ECOSYSTEMS: ${JSON.stringify(profile.ecosystems || [])}
DEPTH MODE: ${DEPTH}${DEPTH === 'root-only' ? ' (declutter the root and one level of top-level dirs only; do NOT restructure deep subdirectory internals)' : ' (recurse: declutter the root AND split overstuffed subdirectories, applying language-idiomatic layouts)'}${EXCLUDE_NOTE}

RECON PROFILE (facts):
${JSON.stringify({ root: profile.root, totals: profile.totals, overstuffed_dirs: overstuffed, cruft: profile.cruft, large_source_files: profile.large_source_files, ecosystems: profile.ecosystems }, null, 1)}

AREA CHARACTERIZATIONS (from read-only explorers):
${JSON.stringify(profileNotes, null, 1)}

Build the plan in this order (per philosophy.md "How to apply this when planning"):
1. Root: sort every loose root entry into keep (intent files) vs nest (implementation), with each nested entry's destination.
2. Top level: name the coarse concerns as a handful of well-purposed directories; choose the idiomatic layout for the detected ecosystem (language-layouts.md). For a multi-language repo, keep each language in its own idiomatic subtree.
3. ${DEPTH === 'recursive' ? 'Overstuffed dirs: split each using its common_prefixes to pick by-feature (preferred) vs by-type; recurse if a new subdir is still overstuffed. A giant single file becoming a package is a refactor — mark risk:"risky".' : 'Skip deep subdirectory restructuring (root-only mode).'}
4. Cruft: list quarantine targets (backup/migration/old files -> archive/ for HUMAN deletion, never auto-deleted) and gitignore targets (build caches, compiled output, editor junk, duplicate cache dirs).

Rules: every move is a git mv (preserves history); never propose deleting files; do not move a file out of a path a build glob/workspace expects; keep entry points reachable; honor nested manifests as self-contained units. Mark any move with large blast radius, dynamic-reference exposure, or that is really a refactor as risk:"risky".

REFERENCE-INTEGRITY MANDATE (this is how the apply phase keeps the build green — there are NO re-export shims; every broken reference is rewritten in place from the ref_impact you enable, so a move is only safe if its full reference fan-out is PREDICTABLE):
- Whenever a move turns a flat module into a package (e.g. \`foo.py\` -> \`foo/bar.py\`) or moves a module INTO a new package, add that package's \`__init__.py\` to new_files. The apply phase creates it EMPTY and then rewrites import sites to the new dotted path — it does NOT auto-generate re-export bodies, so do not rely on \`from foo import X\` continuing to resolve unless foo stays importable.
- For any move of a HIGH-REUSE module (imported from many sites — e.g. session, credential pool, an adapter), the rationale must state the new dotted import path so the ref-impact pass can enumerate EVERY call site. If a module is imported from 15+ sites AND also has dynamic/attribute/runtime references you cannot fully enumerate, prefer to LEAVE IT IN PLACE rather than move it — locality is not worth a silent runtime break.
- Treat these reference classes as first-class, not afterthoughts; if a move touches one you cannot pin down precisely, mark it risk:"risky" (or drop it): (a) PATH MATH — \`__file__\`, \`Path(__file__).parent[.parent...]\`, \`parents[N]\`: moving a file changes its directory depth, so any \`parent.parent\` / \`parents[N]\` anchored to it must be re-counted; (b) NAMESPACE/LOGGER PREFIX STRINGS — module-name string constants used for logger names, component prefixes, feature flags, or telemetry tags (e.g. a COMPONENT_PREFIXES table keyed by \`'model_tools'\`); (c) DISCOVERY GLOBS / EXCLUDE FILTERS — registry or plugin loaders that scan a directory and exclude/include by bare filename or glob (moving the file changes both its name and its dir); (d) TEST MONKEYPATCH / patch() TARGETS — \`monkeypatch.setattr("pkg.mod.attr", ...)\` and \`mock.patch("pkg.mod.attr")\` strings bind to the OLD dotted path and must be rewritten; a service/env cluster consolidation with 50+ patch sites is high-risk — only propose it if every site is enumerable; (e) DOC PATH REFERENCES — CONTRIBUTING.md / README / inline docs that name the file path.

CRITICAL — moves vs new files: a "move" is ALWAYS an existing file going from one path to another (from must be a real current path; to its destination). Brand-new scaffolding files that the target layout needs but that do not exist yet — most commonly __init__.py for new Python subpackages — go in new_files, NEVER in moves. Do not invent a move whose "from" is a directory or a not-yet-existing file; that corrupts the apply phase. Destination directories are created implicitly by the apply phase (mkdir -p) before each move, so you do not need a move to "create" a directory.

The target_tree should show the proposed top 2-3 levels with a one-line purpose per top-level directory. The move list must be concrete (from -> to, both real paths) and ordered so a parent's content lands before nested splits depend on it.`,
  { label: 'design-plan', phase: 'Design', schema: PLAN_SCHEMA, model: KEY_MODEL }
)

if (!plan) return { error: 'design phase produced no plan' }
// BACKSTOP: enforce the exclusion deterministically — drop any move whose source or destination
// lands under an excluded prefix, and scrub excluded paths from quarantine. The prompt asks the
// design agent to respect EXCLUDE, but we never rely on prompt compliance for a safety constraint.
if (EXCLUDE.length) {
  const before = (plan.moves || []).length
  plan.moves = (plan.moves || []).filter(m => !isExcluded(m.from) && !isExcluded(m.to))
  if (plan.cruft && Array.isArray(plan.cruft.quarantine)) {
    plan.cruft.quarantine = plan.cruft.quarantine.filter(p => !isExcluded(p))
  }
  const dropped = before - plan.moves.length
  if (dropped > 0) log('Exclusion backstop: dropped ' + dropped + ' move(s) touching excluded paths')
}
log('Design done: ' + (plan.moves || []).length + ' moves proposed')

// ---------- Phase 3: Reference impact ----------
phase('RefImpact')
const moves = plan.moves || []
// Chunk moves so each agent reasons about a manageable batch and they run in parallel.
const CHUNK = 12
const chunks = []
for (let i = 0; i < moves.length; i += CHUNK) chunks.push(moves.slice(i, i + CHUNK))

const impactResults = (await parallel(chunks.map((chunk, idx) => () =>
  agent(
    `You predict the reference breakage from a batch of file moves in the repo at ${ROOT}. Read-only — grep and read, do not modify anything.

${SKILL_DIR}/references/reference-rewriting.md describes every category of reference (code imports incl. relative-import depth shifts, build/packaging config, CI, containers, docs, and dynamic/runtime path references) and how to find them. Read it first.

MOVES IN THIS BATCH:
${JSON.stringify(chunk, null, 1)}

For each move, grep the repo for: the dotted/module form of the old path, relative-import fragments targeting it, the bare filename, and the bare directory name. Bucket each hit by category and write a concrete fix (file + old-string -> new-string, or what must change). Rate each fix mechanical (plain swap) or risky (relative-import depth change, dynamic/runtime path, or build-config semantics).

The apply phase rewrites EVERY reference in place (there are NO re-export shims), so a move with an incomplete ref_impact list = a broken build. Be exhaustive — these classes are the ones a naive import-grep misses and the ones the critic will (correctly) reject the plan over if you leave them out:
- dynamic-runtime: a path computed from __file__, importlib/require-by-variable, or a directory-scanning plugin loader touching the moved path.
- path-math: the moved file's OWN internal use of \`Path(__file__).parent\`, \`.parent.parent\`, or \`parents[N]\` — moving the file changes its directory depth, so the index/levels must be re-counted. Read the moved file and report the exact line + corrected level if it uses any.
- name-string: module-name STRING constants (not imports) used as logger names, component/telemetry prefixes, feature-flag keys, or registry keys — e.g. a COMPONENT_PREFIXES dict keyed by the bare module name. grep for the bare module stem as a quoted string.
- discovery-glob: registry/loader code that scans a directory and includes/excludes by bare filename or glob (e.g. \`exclude={'mcp_tool.py'}\` or \`glob('*.py')\` over the old dir) — moving the file changes both its name and its directory, so the filter/glob must change.
- test-monkeypatch: \`monkeypatch.setattr("pkg.mod.attr", ...)\`, \`mock.patch("pkg.mod.attr")\`, and patch decorators whose TARGET STRING is the old dotted path — these bind by string and must be rewritten. grep test dirs for the old dotted path as a quoted string.
- docs: CONTRIBUTING.md / README / inline docs that name the file path.
For any of these you find but cannot write an exact fix for, still report it with confidence:"risky" so the critic and the human see it. Anchor your greps to ${ROOT}.`,
    { label: 'refimpact:' + idx, phase: 'RefImpact', agentType: 'Explore', schema: REF_IMPACT_SCHEMA }
  )
))).filter(Boolean)

const allImpacts = impactResults.flatMap(r => r.impacts || [])
// Attach impacts back onto the moves by from/to key.
const impactByKey = {}
for (const im of allImpacts) impactByKey[im.move_from + '::' + im.move_to] = im.fixes
const movesWithImpact = moves.map(m => ({ ...m, ref_impact: impactByKey[m.from + '::' + m.to] || [] }))
const riskyRefCount = allImpacts.flatMap(i => i.fixes || []).filter(f => f.confidence === 'risky').length
log('RefImpact done: ' + allImpacts.flatMap(i => i.fixes || []).length + ' references predicted (' + riskyRefCount + ' risky)')

// ---------- Phase 4: Adversarial critique ----------
phase('Critique')
const critique = await agent(
  `You are an adversarial reviewer of a codebase reorganization plan for ${ROOT}. Your job is to find what is unsafe or incomplete BEFORE any file moves. Be skeptical; a wrong move breaks the user's build. Read-only.

${READ_REFS}

${EXCLUDE.length ? 'EXCLUDED TREES (must not be MOVED/restructured/quarantined, but their references ARE rewritten by apply): ' + EXCLUDE.map(e => '`' + e + '`').join(', ') + '. If a move has a source or destination UNDER one of these, flag it and add a "drop this move" correction. But do NOT flag a move just because a file inside an excluded tree (e.g. a test using mock.patch/monkeypatch on the moved module) references it — that is a normal reference fix, and the correct response is to ensure the move\'s ref_impact lists those test references (test-monkeypatch/code-import), NOT to drop the move. A good src/ reorg move referenced only from excluded tests is SAFE, not unsafe.\n\n' : ''}THE PROPOSED PLAN:
target_tree:
${plan.target_tree}

root_disposition: ${JSON.stringify(plan.root_disposition, null, 1)}
moves (with predicted reference impact): ${JSON.stringify(movesWithImpact, null, 1)}
cruft: ${JSON.stringify(plan.cruft, null, 1)}

HOW APPLY PRESERVES THE BUILD (judge against THIS mechanism, not an imagined one): the apply phase does git mv, creates each plan.new_files \`__init__.py\` EMPTY, then REWRITES every broken reference in place using each move's ref_impact list (plus a re-grep for misses). There are NO re-export shims and apply does not invent them. So the correct safety question is NOT "does the plan promise a re-export shim?" — it is "is each move's ref_impact list COMPLETE and correct enough that rewriting exactly those references keeps the build green?" Do NOT raise a risk that merely says "needs a re-export shim in __init__.py" — that is not how apply works; instead check whether the import sites are fully enumerated in ref_impact.

Check, by inspecting the actual repo where needed:
- Does the new root actually hold only intent files, and does the top level read like a clear table of contents? (If not, say which entries are wrong.)
- Are any moves unsafe: orphaning an entry point, crossing a package/workspace boundary, moving a file a build glob or nested manifest depends on, or a "mechanical" move that actually has dynamic references the ref-impact pass underrated?
- For each move, is its ref_impact list COMPLETE? Spot-check by grepping the repo for the old dotted path / bare name. A move is unsafe if real references exist that ref_impact omits. Pay special attention to the easily-missed classes: path-math (the moved file's own \`Path(__file__).parent[.parent]\`/\`parents[N]\`), name-string (module-name string constants for loggers/prefixes/registry keys), discovery-glob (loaders that scan a dir and filter by bare filename), and test-monkeypatch (\`monkeypatch.setattr\`/\`mock.patch\` target strings binding the old dotted path). If any are present but absent from ref_impact, that is a concrete correction, not a blocker on the whole plan.
- Could anything be lost or collide (two files mapped to the same destination, a move into a path that doesn't exist yet, or a package/module name collision — a \`foo.py\` and a new \`foo/\` package coexisting)?
- Is the ecosystem idiom honored, or does the layout fight the language's conventions?
- Are quarantine vs delete handled correctly (nothing proposed for deletion; cruft genuinely cruft)?

Verdict calibration — THE PLAN IS SALVAGED BY DROPPING BAD MOVES, NOT REJECTED WHOLESALE. The workflow is all-or-nothing on your verdict, EXCEPT that it will first DROP every move you list in unsafe_moves and then apply the rest. So:
- For each move that is genuinely unsafe AND cannot be made safe by reference-rewriting alone — it needs a LOGIC change apply won't make (e.g. a non-recursive discovery glob that must learn to recurse), it breaks path-math the ref_impact got wrong (e.g. parents[N] / parent.parent that shifts when the file's depth changes), it is data-loss-adjacent (quarantining a module that is still a LIVE import), or it has a truly un-enumerable dynamic reference — put it in unsafe_moves with its exact from/to and reason. These get dropped surgically.
- After mentally dropping those, judge what REMAINS. If the remainder is safe (every remaining gap is a concrete, listable reference edit apply can do), set verdict = "sound-with-risks" even if you dropped several moves. The good 100+ moves should not die because 4 are bad — quarantine the 4 in unsafe_moves.
- Reserve verdict = "unsafe" for when the plan is unsalvageable as a WHOLE: the target layout itself is wrong, or so many moves are unsafe that what remains is pointless. Do NOT use "unsafe" just because some individual moves are bad — that is exactly what unsafe_moves is for.
Return verdict, a specific risks list (each naming the move and reason), the unsafe_moves drop-list (exact from/to), and concrete corrections. Do not rubber-stamp, but do not reject a mostly-good plan as unsafe — drop the bad moves and pass the rest.`,
  { label: 'critique', phase: 'Critique', agentType: 'Explore', schema: CRITIQUE_SCHEMA, model: KEY_MODEL }
)

// ---------- Phase 5: Finalize ----------
phase('Finalize')

// SURGICAL DROP: the critic isolates genuinely-unsafe individual moves (e.g. a discovery-glob that
// needs a logic change, path-math the ref_impact got wrong, a live-import quarantine) in unsafe_moves.
// Drop EXACTLY those and keep the rest, so a handful of bad moves don't sink 100+ good ones. Match by
// from/to (normalized) to be robust to incidental whitespace.
const normPath = (p) => String(p || '').replace(/^\.\//, '').replace(/\/+$/, '').trim()
const unsafeMoves = (critique && Array.isArray(critique.unsafe_moves)) ? critique.unsafe_moves : []
const unsafeKeys = new Set(unsafeMoves.map(u => normPath(u.from) + '::' + normPath(u.to)))
let keptMoves = movesWithImpact
let droppedForSafety = []
if (unsafeKeys.size) {
  keptMoves = movesWithImpact.filter(m => !unsafeKeys.has(normPath(m.from) + '::' + normPath(m.to)))
  droppedForSafety = movesWithImpact.filter(m => unsafeKeys.has(normPath(m.from) + '::' + normPath(m.to)))
  log('Dropped ' + droppedForSafety.length + ' critic-flagged unsafe move(s); ' + keptMoves.length + ' safe move(s) remain.')
}
// Also scrub any quarantine target the critic named as unsafe (e.g. a still-live import wrongly tagged
// as a finished migration). Match a quarantine path against unsafe_moves[].from too.
let keptQuarantine = (plan.cruft && Array.isArray(plan.cruft.quarantine)) ? plan.cruft.quarantine : []
const unsafeFroms = new Set(unsafeMoves.map(u => normPath(u.from)))
if (unsafeFroms.size) {
  const before = keptQuarantine.length
  keptQuarantine = keptQuarantine.filter(q => !unsafeFroms.has(normPath(q)))
  if (keptQuarantine.length !== before) log('Dropped ' + (before - keptQuarantine.length) + ' critic-flagged unsafe quarantine target(s).')
}
const keptCruft = { quarantine: keptQuarantine, gitignore: (plan.cruft && plan.cruft.gitignore) || [] }

const finalPlan = {
  generated: DATE,
  repo_path: ROOT,
  depth: DEPTH,
  ecosystems: plan.ecosystems,
  git: profile.git || {},
  summary: plan.summary,
  target_tree: plan.target_tree,
  root_disposition: plan.root_disposition,
  moves: keptMoves,
  new_files: plan.new_files || [],
  cruft: keptCruft,
  critique: critique || { verdict: 'unknown', risks: [], corrections: [] },
  dropped_unsafe_moves: droppedForSafety.map((m, i) => ({ from: m.from, to: m.to, reason: (unsafeMoves.find(u => normPath(u.from) === normPath(m.from) && normPath(u.to) === normPath(m.to)) || {}).reason || 'flagged unsafe by critic' })),
  totals: {
    moves: keptMoves.length,
    dropped_unsafe_moves: droppedForSafety.length,
    risky_moves: keptMoves.filter(m => m.risk === 'risky').length,
    predicted_references: allImpacts.flatMap(i => i.fixes || []).length,
    risky_references: riskyRefCount,
    quarantine: keptQuarantine.length,
  },
}

// NOTE: the workflow runtime has no direct filesystem access, and delegating a
// byte-for-byte transcription of a large plan to an agent stalls on big repos
// (the plan JSON can be enormous). So we do NOT write the plan from inside the
// workflow. We return it as structured data; the orchestrating skill (which has
// Write access) persists it to plan_path. This scales to any repo size.
log('Plan finalized: ' + finalPlan.totals.moves + ' moves, verdict=' + finalPlan.critique.verdict + ' (skill writes it to ' + PLAN_PATH + ')')

return {
  plan_path: PLAN_PATH,
  plan: finalPlan,
}
