export const meta = {
  name: 'diagrams-sync-sweep',
  description: 'Assess and update the @system annotations of every module in a large repo: an opus plan of the modules, a haiku or sonnet writer and an opus reviewer per module, an opus settle of the exceptions, the checker to 0 warning, and an opus critique of the whole map',
  whenToUse: "diagrams-sync's whole-repo sweep, after the user asked for a pass over every module and map-sweep.mjs reports large (or they asked for the workflow anyway: force). Args: {root, pluginRoot, force?}. root is the absolute repo path, pluginRoot the absolute marvelous-miro plugin root. Leaves every edit uncommitted and never publishes the board.",
  phases: [
    { title: 'Scan', detail: 'map-sweep.mjs: the modules, their source files, and the whole-repo findings', model: 'haiku' },
    { title: 'Plan', detail: 'which directories are modules, their ids, layers, and writer tier, and the config delta', model: 'opus' },
    { title: 'Config', detail: 'apply the planned externals, config nodes, excludes, and accepts', model: 'sonnet' },
    { title: 'Annotate', detail: 'per module: a haiku or sonnet writer, an opus reviewer, a sonnet fixer' },
    { title: 'Settle', detail: 'what only the config, a layer change, or a code move can fix: opus decides, sonnet applies' },
    { title: 'Verify', detail: 'regenerate the map and loop the checker to 0 warning, escalating to opus' },
    { title: 'Critique', detail: "the whole map against the repo's own description of itself, report only", model: 'opus' },
  ],
}

// Model tiers. The cheap tiers write, opus decides:
//   haiku/low     Scan and every Check: run a script, hand back its JSON. Writers for small modules
//                 (at most HAIKU_MAX files and findings), whose every line an opus reviewer then reads.
//   sonnet        writers for every other module, the fixers, and the two config appliers.
//   opus/high     the planner, the per-module reviewers, the settle judge, the escalation, the critic.
// The planner, settle, escalation, and critic are singletons, which would usually inherit the session
// model; they are pinned to opus because every annotation descends from the plan, and a sweep started
// from a Sonnet session must not plan, settle, or judge on Sonnet.

// ---------- args (may arrive as a JSON string, coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.pluginRoot) {
  throw new Error('args must be an object: {root: <absolute repo root>, pluginRoot: <absolute marvelous-miro plugin root>, force?: boolean}')
}
const ROOT = A.root.replace(/\/+$/, '')
const PLUGIN = A.pluginRoot.replace(/\/+$/, '')
const SWEEP = `node "${PLUGIN}/scripts/map-sweep.mjs" --root "${ROOT}"`
const CHECK = `node "${PLUGIN}/scripts/system-map.mjs" --root "${ROOT}"`
const CONFIG = '.agents/system-map.json'
const LAYERS = ['people', 'surface', 'service', 'adapter', 'runtime', 'external']
const CODE_LAYERS = ['surface', 'service', 'adapter', 'runtime']
const HAIKU_MAX = { files: 3, findings: 4 }
// Findings only a config entry, a layer change, or a code move resolves; writers defer them to Settle.
const DESIGN = new Set(['LAYER_VIOLATION', 'EGRESS_OUTSIDE_ADAPTER'])
const MAX_ROUNDS = 3

const BRIEF = 'Be terse in every string field, telegraphic phrases, no filler. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are one step of a whole-repo sweep of the system map in ${ROOT}; run every command from there.
The annotation grammar and its rules are ${PLUGIN}/skills/diagrams-sync/references/grammar.md
(read it unless it is already in your context). The config is ${CONFIG}; the checker is \`${CHECK}\` (add --json for the findings);
\`${SWEEP} --unit <dir>\` prints one module's source files, the modules nested in it, and its findings now.
Never change git state: no add, commit, stash, checkout, reset, or branch. Never move, rename, or edit code:
the sweep changes @system comment lines, and the config only where your step says so.
`

// ---------- helpers (plain code, no agents) ----------
const within = (p, dir) => dir === '.' || p === dir || p.startsWith(`${dir}/`)
const dirname = (p) => { const i = p.lastIndexOf('/'); return i === -1 ? '.' : p.slice(0, i) }
const fkey = (f) => `${f.code}\0${f.path}`
/** The checker's glob: `**\/` any depth (including none), `*` within a segment. */
function globRe(pattern) {
  let out = ''
  for (let i = 0; i < pattern.length;) {
    if (pattern.startsWith('**/', i)) { out += '(?:.*/)?'; i += 3 }
    else if (pattern.startsWith('**', i)) { out += '.*'; i += 2 }
    else if (pattern[i] === '*') { out += '[^/]*'; i++ }
    else if (pattern[i] === '?') { out += '[^/]'; i++ }
    else { out += pattern[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'); i++ }
  }
  return new RegExp(`^${out}$`)
}
const count = (xs, pred) => xs.filter(pred).length

// ---------- schemas ----------
const FINDING = {
  type: 'object', required: ['code', 'path'],
  properties: { code: { type: 'string' }, path: { type: 'string' }, line: { type: 'integer' }, message: { type: 'string' } },
}
const CODES = { type: 'object', additionalProperties: { type: 'integer' } }
const UNIT_ROW = {
  type: 'object', required: ['dir', 'node', 'files', 'findings', 'codes'],
  properties: {
    dir: { type: 'string' }, node: { type: ['string', 'null'] }, title: { type: ['string', 'null'] },
    layer: { type: ['string', 'null'] }, entry: { type: ['string', 'null'] },
    files: { type: 'integer' }, findings: { type: 'integer' }, codes: CODES,
  },
}
const SCAN_SCHEMA = {
  type: 'object', required: ['config', 'large', 'reason', 'totals', 'units', 'configNodes', 'global'],
  properties: {
    config: { type: ['string', 'null'] }, large: { type: 'boolean' }, reason: { type: 'string' },
    totals: {
      type: 'object', required: ['modules', 'sourceFiles', 'warnings'],
      properties: {
        modules: { type: 'integer' }, declared: { type: 'integer' }, config: { type: 'integer' }, loose: { type: 'integer' },
        sourceFiles: { type: 'integer' }, warnings: { type: 'integer' }, byCode: CODES,
      },
    },
    units: { type: 'array', items: UNIT_ROW },
    configNodes: { type: 'array', items: UNIT_ROW },
    global: { type: 'array', items: FINDING },
  },
}
const CALLS = {
  type: 'array',
  items: { type: 'object', required: ['to', 'label'], properties: { to: { type: 'string' }, label: { type: 'string' } } },
}
const CONFIG_DELTA = {
  type: 'object', required: ['externals', 'nodes', 'exclude', 'accept'],
  properties: {
    externals: {
      type: 'array', description: 'systems outside the repo the config does not list yet',
      items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' } } },
    },
    nodes: {
      type: 'array', description: 'config nodes to add or replace, only for what cannot carry a comment',
      items: {
        type: 'object', required: ['id', 'title', 'layer', 'calls'],
        properties: { id: { type: 'string' }, title: { type: 'string' }, layer: { enum: LAYERS.filter((l) => l !== 'external') }, path: { type: 'string' }, calls: CALLS },
      },
    },
    exclude: { type: 'array', items: { type: 'string' }, description: 'globs for generated or vendored code that is not part of the system' },
    accept: {
      type: 'array',
      items: { type: 'object', required: ['code', 'path', 'why'], properties: { code: { type: 'string' }, path: { type: 'string' }, why: { type: 'string' } } },
    },
  },
}
const PLAN_SCHEMA = {
  type: 'object', required: ['units', 'config', 'notes'],
  properties: {
    units: {
      type: 'array',
      items: {
        type: 'object', required: ['dir', 'entry', 'node', 'title', 'layer', 'action', 'tier', 'brief'],
        properties: {
          dir: { type: 'string', description: 'the module directory; the node owns every source file below it that no nested module owns' },
          entry: { type: 'string', description: 'the file directly in dir that carries the node line: the current one for an annotated module, else index.*, main.*, __init__.py, or app.*' },
          node: { type: 'string', description: 'node id; an annotated module keeps its id' },
          title: { type: 'string' },
          layer: { enum: CODE_LAYERS },
          action: { enum: ['keep', 'revise', 'new'], description: 'keep: id, title, and layer stand; revise: the title or layer changes (why goes in brief); new: no node yet' },
          tier: { enum: ['haiku', 'sonnet'] },
          brief: { type: 'string', description: "for the writer: the module's job in a line, then what to look for that the checker will not report" },
        },
      },
    },
    config: CONFIG_DELTA,
    notes: { type: 'array', items: { type: 'string' }, description: 'what the user should know about the plan' },
  },
}
const OK_SCHEMA = {
  type: 'object', required: ['ok', 'changes'],
  properties: { ok: { type: 'boolean' }, changes: { type: 'array', items: { type: 'string' } }, error: { type: 'string' } },
}
const DEFERRED = {
  type: 'array',
  items: {
    type: 'object', required: ['kind', 'path', 'what'],
    properties: {
      kind: { enum: ['accept', 'move', 'external', 'layer', 'config-node'] },
      code: { type: 'string' }, path: { type: 'string' },
      what: { type: 'string', description: 'what you would do and why, in one line' },
    },
  },
}
const WRITE_SCHEMA = {
  type: 'object', required: ['dir', 'changed', 'lines', 'remaining', 'deferred'],
  properties: {
    dir: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' }, description: 'files edited' },
    lines: { type: 'integer', description: '@system lines added, changed, or dropped' },
    remaining: { type: 'array', items: FINDING, description: 'what --unit still reports' },
    deferred: DEFERRED,
  },
}
const REVIEW_SCHEMA = {
  type: 'object', required: ['dir', 'issues', 'deferred'],
  properties: {
    dir: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', required: ['severity', 'path', 'problem', 'fix'],
        properties: {
          severity: { enum: ['critical', 'major', 'minor'] },
          path: { type: 'string' }, line: { type: 'integer' },
          problem: { type: 'string' },
          fix: { type: 'string', description: 'the exact @system line to add, the line to change it to, or the line to drop' },
        },
      },
    },
    deferred: DEFERRED,
  },
}
const FIX_SCHEMA = {
  type: 'object', required: ['dir', 'applied', 'skipped', 'remaining', 'deferred'],
  properties: {
    dir: { type: 'string' }, applied: { type: 'integer' },
    skipped: { type: 'array', items: { type: 'object', required: ['problem', 'why'], properties: { problem: { type: 'string' }, why: { type: 'string' } } } },
    remaining: { type: 'array', items: FINDING }, deferred: DEFERRED,
  },
}
const SETTLE_SCHEMA = {
  type: 'object', required: ['decisions'],
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object', required: ['action', 'item', 'file', 'edit', 'why'],
        properties: {
          action: { enum: ['relayer', 'accept', 'external', 'config', 'move', 'drop'] },
          item: { type: 'string', description: 'the deferred item or finding this settles' },
          code: { type: 'string', description: 'the finding code, when it settles a checker finding' },
          path: { type: 'string', description: "the finding's path, when it settles a checker finding" },
          file: { type: 'string', description: 'the file the edit goes in; empty for move and drop' },
          edit: { type: 'string', description: 'the exact @system line or JSON entry; empty for move and drop' },
          why: { type: 'string' },
        },
      },
    },
  },
}
const CHECK_SCHEMA = {
  type: 'object', required: ['ok', 'warnings', 'info'],
  properties: {
    ok: { type: 'boolean', description: 'false only when the checker exited 2 (it could not run)' },
    error: { type: 'string' },
    warnings: { type: 'array', items: FINDING }, info: { type: 'integer' },
  },
}
const VFIX_SCHEMA = {
  type: 'object', required: ['fixed', 'unresolved'],
  properties: {
    fixed: { type: 'integer' },
    unresolved: { type: 'array', items: { type: 'object', required: ['code', 'path', 'why'], properties: { code: { type: 'string' }, path: { type: 'string' }, why: { type: 'string' } } } },
  },
}
const CRITIQUE_SCHEMA = {
  type: 'object', required: ['notes'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object', required: ['severity', 'problem', 'suggestion'],
        properties: { severity: { enum: ['critical', 'major', 'minor'] }, node: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' } },
      },
    },
  },
}

// ---------- Phase 1: scan ----------
phase('Scan')
const scanPrompt = (extra) => `${CTX}
Run \`${SWEEP}\` and return what it prints, field for field: config, large, reason, totals, every entry of units
and of configNodes (dir, node, title, layer, entry, files, findings, codes), and global. Copy, do not judge.
If it prints config: null, return config null, large false, its message as reason, zero totals, and empty arrays.${extra}
${BRIEF}`
let scan = await agent(scanPrompt(''), { label: 'scan', phase: 'Scan', model: 'haiku', effort: 'low', schema: SCAN_SCHEMA })
const tallied = (s) => s && s.units.length + s.configNodes.length === s.totals.modules
if (scan && scan.config && !tallied(scan)) {
  log(`Scan returned ${scan.units.length + scan.configNodes.length} of ${scan.totals.modules} modules; reading it again`)
  scan = await agent(scanPrompt(`\nA first read returned ${scan.units.length} units and ${scan.configNodes.length} configNodes against totals.modules ${scan.totals.modules}: return every one.`),
    { label: 'scan:again', phase: 'Scan', model: 'haiku', effort: 'low', schema: SCAN_SCHEMA })
}
if (!scan) throw new Error(`the scan returned nothing; run ${SWEEP} by hand to see why`)
if (!scan.config) return { skipped: 'not-adopted', reason: scan.reason }
if (!tallied(scan)) throw new Error(`the scan lost modules twice (${scan.units.length + scan.configNodes.length} of ${scan.totals.modules}); nothing was edited`)
if (!scan.large && !A.force) return { skipped: 'small', reason: scan.reason, totals: scan.totals }
log(`Scan: ${scan.reason}; ${scan.totals.warnings} warning(s) across the repo`)

// ---------- Phase 2: plan (opus, singleton) ----------
phase('Plan')
const annotated = scan.units.filter((u) => u.node)
const loose = scan.units.filter((u) => !u.node)
const scanSummary = JSON.stringify({ totals: scan.totals, units: scan.units, configNodes: scan.configNodes, global: scan.global })
const planPrompt = (extra) => `${CTX}
You plan the sweep: decide what every module is, so the writers after you only annotate. Read what the repo says
about its own layout (the root README, an AGENTS.md or CLAUDE.md and the files they point at), then ${CONFIG} and
the committed map (the config's "map", default diagrams/system-map.json). Open source files only where those do
not settle a module's job or layer.

The scan. units are modules with a node line (node set) or directories of source files no node owns (node null);
configNodes are the config's own nodes, which this plan may change through config.nodes:
${scanSummary}

Decide:
1. Every annotated unit stays a unit under its id and entry file: the board card is keyed on the id, so never
   rename one. Use action revise only when the code shows its title or layer is wrong, and say why in brief.
2. Every unowned directory is covered: by a new unit whose dir is that directory or an ancestor of it (a module
   owns every file below its dir that no nested module owns, so split only where the jobs split), by an exclude
   glob when it is generated or vendored code, or by an accept for NODE_MISSING (its exact path, and a why) when
   it is deliberately outside the map. A new unit's entry is a file directly in its dir.
3. Layers are the grammar's rows and calls go down or across; give each module the layer its real imports fit.
4. config.externals: every system outside the repo the code talks to (SDK clients, HTTP base URLs, queues,
   databases) the config does not list. config.nodes: only for what cannot carry a comment.
5. tier: haiku only for a module with at most ${HAIKU_MAX.files} source files and ${HAIKU_MAX.findings} findings whose lines are short
   and obvious from its code; sonnet for the rest, and for any module whose calls the checker cannot see
   (HTTP, queues, events, script paths built at runtime). An opus reviewer reads every module afterwards.
6. brief: the module's job in one line, then what its writer must look for that the checker will not report.
No two units share a dir, an entry, or a node id; a new id is kebab-case and unique against every existing one.${extra}
${BRIEF}`
let plan = await agent(planPrompt(''), { label: 'plan', phase: 'Plan', model: 'opus', effort: 'high', schema: PLAN_SCHEMA })
if (!plan) throw new Error('the planner returned nothing; nothing was edited')

// Deterministic checks on a plan, in plain code. An annotated module keeps its id and entry whatever the
// planner wrote, and is put back if the planner left it out: everything needed to audit it is in the scan.
function pin(p) {
  for (const a of annotated) {
    const u = p.units.find((x) => x.dir === a.dir)
    if (!u) {
      log(`Plan left out annotated module ${a.node} (${a.dir}); auditing it as it stands`)
      p.units.push({ dir: a.dir, entry: a.entry, node: a.node, title: a.title, layer: a.layer, action: 'keep', tier: 'sonnet', brief: 'audit the module as it stands' })
    } else if (u.node !== a.node || u.entry !== a.entry) {
      log(`Plan renamed ${a.node} (${a.dir}); keeping its id and entry, since the board card is keyed on the id`)
      Object.assign(u, { node: a.node, entry: a.entry, action: u.action === 'new' ? 'revise' : u.action })
    }
  }
  // Annotated modules first, so a new unit that collides with one is the one dropped.
  const isAnnotated = (u) => (annotated.some((a) => a.dir === u.dir) ? 1 : 0)
  p.units.sort((a, b) => isAnnotated(b) - isAnnotated(a))
}
/** The units to write, and why any other was dropped: a shared dir, entry, or id, or an entry outside its dir. */
function dedupe(units) {
  const seen = { dir: new Set(), entry: new Set(), node: new Set() }, kept = [], dropped = []
  for (const u of units) {
    const clash = ['dir', 'entry', 'node'].find((k) => seen[k].has(u[k]))
    if (clash) { dropped.push(`unit ${u.dir} shares its ${clash} ${u[clash]} with another unit`); continue }
    if (dirname(u.entry) !== u.dir) { dropped.push(`unit ${u.dir}: entry ${u.entry} is not directly in its dir, and the node line roots a module at its file's directory`); continue }
    for (const k of ['dir', 'entry', 'node']) seen[k].add(u[k])
    kept.push(u)
  }
  return { kept, dropped }
}
/** Unowned directories the plan neither puts under a unit, excludes, nor accepts. */
function uncovered(p, units) {
  const excluded = (d) => p.config.exclude.some((g) => globRe(g).test(`${d}/x`) || globRe(g).test(d))
  const accepted = (d) => p.config.accept.some((x) => x.code === 'NODE_MISSING' && within(d, x.path))
  return loose.filter((l) => !units.some((u) => within(l.dir, u.dir)) && !excluded(l.dir) && !accepted(l.dir)).map((l) => l.dir)
}
const problemsOf = (p) => {
  const { kept, dropped } = dedupe(p.units)
  return [...dropped, ...uncovered(p, kept).map((d) => `unowned directory ${d} is not covered`)]
}
pin(plan)
let problems = problemsOf(plan)
if (problems.length) {
  log(`Plan: ${problems.length} problem(s); asking the planner to repair it`)
  const repaired = await agent(planPrompt(`\n\nYour first plan had these problems; return the whole plan again with them fixed:\n- ${problems.join('\n- ')}\nThe first plan: ${JSON.stringify(plan)}`),
    { label: 'plan:repair', phase: 'Plan', model: 'opus', effort: 'high', schema: PLAN_SCHEMA })
  if (repaired) { plan = repaired; pin(plan) }
}
// What is still wrong after one repair is dropped and reported, never written twice.
const { kept, dropped: clashes } = dedupe(plan.units)
plan.units = kept
const unplanned = uncovered(plan, kept)
if (clashes.length) log(`Plan: dropped ${clashes.length} unit(s): ${clashes.join('; ')}`)
if (unplanned.length) log(`Plan: ${unplanned.length} unowned director${unplanned.length === 1 ? 'y' : 'ies'} left out, reported: ${unplanned.join(', ')}`)

/** The planned unit that owns a directory: the deepest planned dir at or above it. */
const ownerOf = (d) => plan.units.map((u) => u.dir).filter((p) => within(d, p)).sort((a, b) => b.length - a.length)[0]
const promoted = []
for (const u of plan.units) {
  const mine = scan.units.filter((s) => ownerOf(s.dir) === u.dir && (s.node ? s.dir === u.dir : true))
  u.files = mine.reduce((n, s) => n + s.files, 0)
  u.findings = mine.reduce((n, s) => n + s.findings, 0)
  u.nested = plan.units.map((x) => x.dir).filter((d) => d !== u.dir && within(d, u.dir))
  if (u.tier === 'haiku' && (u.files > HAIKU_MAX.files || u.findings > HAIKU_MAX.findings)) { u.tier = 'sonnet'; promoted.push(u.dir) }
}
if (promoted.length) log(`Plan: ${promoted.length} module(s) over the haiku cap moved to sonnet: ${promoted.join(', ')}`)
log(`Plan: ${plan.units.length} module(s): ${count(plan.units, (u) => u.action === 'new')} new, ${count(plan.units, (u) => u.action === 'revise')} revised, `
  + `${count(plan.units, (u) => u.action === 'keep')} kept; ${count(plan.units, (u) => u.tier === 'haiku')} on haiku, ${count(plan.units, (u) => u.tier === 'sonnet')} on sonnet`)

// ---------- Phase 3: config (serial: one shared file) ----------
const delta = plan.config
const hasDelta = delta.externals.length + delta.nodes.length + delta.exclude.length + delta.accept.length > 0
if (hasDelta) {
  phase('Config')
  const applied = await agent(`${CTX}
Apply this delta to ${CONFIG}, and change nothing else in the repo:
${JSON.stringify(delta)}
- externals: add each id with its title; never change or remove an existing one.
- nodes: add each config node, or replace the title, layer, path, and calls of one already under nodes.
- exclude, accept: append each entry that is not already there.
Keep 2-space indentation and one trailing newline. Then run \`${CHECK} --json\`: exit 0 or 1 is a report, and exit 2
means the config no longer parses, so fix it.
${BRIEF}`, { label: 'config', phase: 'Config', model: 'sonnet', effort: 'low', schema: OK_SCHEMA })
  if (!applied || !applied.ok) throw new Error(`the config step failed (${applied?.error ?? 'no result'}); only ${CONFIG} was edited, so read git diff on it`)
  log(`Config: ${applied.changes.length} change(s) to ${CONFIG}`)
}

// ---------- Phase 4: annotate (pipeline: write -> review -> fix, per module) ----------
phase('Annotate')
const ids = [...plan.units.map((u) => u.node), ...scan.configNodes.map((c) => c.node), ...delta.nodes.map((n) => n.id)]
const idList = [...new Set(ids)].sort().join(', ')
const addedExternals = delta.externals.map((e) => e.id).join(', ') || 'none'
const items = [
  ...plan.units.map((u) => ({ ...u, kind: 'code' })),
  // Config nodes are reviewed too; their fixes go to Settle, since the config is one shared file.
  ...scan.configNodes.map((c) => ({
    dir: c.dir, entry: CONFIG, node: c.node, title: c.title, layer: c.layer, action: 'keep', tier: null, brief: '', findings: c.findings, kind: 'config',
    nested: plan.units.map((u) => u.dir).filter((d) => within(d, c.dir)),
  })),
]
const unitLine = (u) => JSON.stringify({ dir: u.dir, entry: u.entry, node: u.node, title: u.title, layer: u.layer, action: u.action, brief: u.brief })
const nestedLine = (u) => `Modules nested inside it, which are other writers' work, so leave their files alone: ${u.nested.join(', ') || 'none'}.`
const nodeStep = (u) => u.action === 'keep' ? 'The node line stands as it is.'
  : u.action === 'revise' ? `Change the node line in ${u.entry} to: @system node ${u.node} "${u.title}" layer=${u.layer}`
    : `Add the node line @system node ${u.node} "${u.title}" layer=${u.layer} at the top of ${u.entry}, in that file's comment syntax and below any shebang.`
const LIMITS = `Expected while other writers work: TARGET_MISSING for a planned id that is not declared yet. Not yours to fix,
so report each in deferred with what you would do: LAYER_VIOLATION and EGRESS_OUTSIDE_ADAPTER (kind layer, move, or
accept), and a system outside the repo that is not under externals (kind external).`

const records = await pipeline(items,
  async (u) => {
    // An annotated module the checker has nothing on goes straight to review: the reviewer is its audit.
    if (u.kind === 'config' || (u.action === 'keep' && u.findings === 0)) return { u, write: null }
    const write = await agent(`${CTX}
You annotate one module: ${unitLine(u)}
${nestedLine(u)}
Node ids you may name in calls lines: ${idList}. Externals are the ids under externals in ${CONFIG} (this sweep added: ${addedExternals}); name them ext:<id>.
1. Run \`${SWEEP} --unit ${u.dir}\` for the files the module owns and its findings.
2. ${nodeStep(u)}
3. Every UNDECLARED_IMPORT and UNDECLARED_RUN becomes a line in ${u.entry}: calls <id> "<label>", the label saying in a few
   words what passes. Then read the module's code for calls the checker cannot see (an HTTP request, a queue publish,
   an event, a script path built at runtime) and add those as calls lines too.
4. Every export of ${u.entry} gets exposes <name> "<what it does>" when it is the module's interface, or goes on one
   internal <name>... line when it is a helper exported for tests. Drop exposes lines for names it no longer exports.
   Rewrite any PARSE line to the grammar.
5. Rerun the --unit command and fix what it still reports. ${LIMITS}
Edit only @system lines in files this module owns, nearly always ${u.entry} alone.
${BRIEF}`, { label: `write:${u.dir}`, phase: 'Annotate', model: u.tier, effort: u.tier === 'haiku' ? 'low' : 'medium', schema: WRITE_SCHEMA })
    return { u, write, failed: write ? null : 'write' }
  },
  async (r) => {
    if (r.failed) return r
    const u = r.u
    const config = u.kind === 'config'
      ? ` This is a config node: its title, layer, and calls live under nodes in ${CONFIG}, and it owns the files under its dir.`
        + ' Name every fix as the exact JSON for its entry.'
      : ''
    const review = await agent(`${CTX}
You review one module's @system annotations against its code, adversarially: assume they are wrong somewhere and find
where. ${r.write ? `A writer just edited them; \`git diff -- ${r.write.changed.join(' ') || u.dir}\` shows how.` : 'Nobody edited them in this sweep; you are auditing what is there.'}
Module: ${unitLine(u)}${config}
${nestedLine(u)}
Run \`${SWEEP} --unit ${u.dir}\` for its files and findings, then read the code. Check that:
- the title names the module's job, and the layer fits its role and its real calls (calls go down or across);
- every calls label says what passes, specifically enough that a reader of the map learns something, and no call
  names a module the code does not use;
- no call is missing: the imports and child-process runs the checker flags, and those it cannot see (HTTP, queues,
  events, script paths built at runtime);
- exposes covers the module's interface with labels that say what each does, and internal holds only helpers
  exported for tests.
Report an issue only with a file and a line you read and the exact line to write instead; when the evidence is thin,
report nothing. critical: the map is wrong (a missing or false call, a wrong layer). major: a title or label that
misleads. minor: wording. ${LIMITS}
${BRIEF}`, { label: `review:${u.dir}`, phase: 'Annotate', model: 'opus', effort: 'high', schema: REVIEW_SCHEMA })
    return { ...r, review, failed: review ? null : 'review' }
  },
  async (r) => {
    if (r.failed || !r.review.issues.length) return r
    const u = r.u
    if (u.kind === 'config') {
      const moved = r.review.issues.map((i) => ({ kind: 'config-node', path: CONFIG, what: `${u.node}: ${i.problem}; ${i.fix}` }))
      return { ...r, review: { ...r.review, deferred: [...r.review.deferred, ...moved] } }
    }
    const fix = await agent(`${CTX}
A reviewer found these problems in the @system lines of module ${u.dir} (node ${u.node}, entry ${u.entry}):
${JSON.stringify(r.review.issues)}
${nestedLine(u)}
Apply each fix, editing only @system lines in files the module owns. Skip one only when its line would break the
grammar or name an id that is neither planned (${idList}) nor an external, and say why. Then rerun
\`${SWEEP} --unit ${u.dir}\` and fix what it reports. ${LIMITS}
${BRIEF}`, { label: `fix:${u.dir}`, phase: 'Annotate', model: 'sonnet', effort: 'medium', schema: FIX_SCHEMA })
    return { ...r, fix, failed: fix ? null : 'fix' }
  },
)
const done = records.filter(Boolean)
const failed = done.filter((r) => r.failed)
const issues = done.flatMap((r) => r.review?.issues ?? [])
log(`Annotate: ${count(done, (r) => r.write)} written, ${count(done, (r) => r.review)} reviewed of ${items.length}; `
  + `${count(issues, (i) => i.severity === 'critical')} critical, ${count(issues, (i) => i.severity === 'major')} major, ${count(issues, (i) => i.severity === 'minor')} minor issue(s); `
  + `${count(done, (r) => r.fix)} fixed; ${failed.length} failed, ${items.length - done.length} lost`)

// ---------- Phase 5: settle (barrier: it needs every module's deferred items, and the config is one shared file) ----------
phase('Settle')
const CHECK_PROMPT = `${CTX}
Run \`${CHECK} --write\`, then \`${CHECK} --json\`. Return ok false (with the error) only if the checker exited 2.
Return every finding of severity warning (code, path, line, message) and the count of info findings. Copy, do not judge.
${BRIEF}`
let checks = 0
const runCheck = (ph) => agent(CHECK_PROMPT, { label: `check:${checks++}`, phase: ph, model: 'haiku', effort: 'low', schema: CHECK_SCHEMA })
let check = await runCheck('Settle')
if (!check || !check.ok) throw new Error(`the checker could not run after the writers (${check?.error ?? 'no result'}); the annotations are on disk, uncommitted`)
const deferred = done.flatMap((r) => [...(r.write?.deferred ?? []), ...(r.review?.deferred ?? []), ...(r.fix?.deferred ?? [])])
const design = check.warnings.filter((f) => DESIGN.has(f.code))
let decisions = []
if (deferred.length || design.length) {
  const settled = await agent(`${CTX}
You settle what the module writers could not fix: exceptions only a config entry, a layer change, or a code move
resolves. You decide; you edit nothing.
Deferred by writers and reviewers: ${JSON.stringify(deferred)}
Design findings from the checker now: ${JSON.stringify(design)}
Read the code each one names, then give every item one decision:
- relayer: the module's layer is wrong; file is its entry, edit the exact node line.
- accept: the exception is deliberate (a CLI that must call the network itself, a call that really goes up); file is
  ${CONFIG}, edit the accept entry as JSON {code, path, why}. Accept sparingly: an accepted finding is never checked again.
- external: an outside system to add; file is ${CONFIG}, edit {id, title}; add a second decision for the calls line.
- config: a change to a config node; file is ${CONFIG}, edit its whole entry as JSON.
- move: the code sits in the wrong module (a network call outside its adapter); say in why what should move where.
  A move is the user's call, so nothing is edited.
- drop: the item is wrong; say why.
Set code and path on every decision that settles a checker finding.
${BRIEF}`, { label: 'settle', phase: 'Settle', model: 'opus', effort: 'high', schema: SETTLE_SCHEMA })
  decisions = settled ? settled.decisions : []
  if (!settled) log('Settle: the judge returned nothing; the items stay in the report and the verify loop sees the findings')
  const edits = decisions.filter((d) => !['move', 'drop'].includes(d.action))
  if (edits.length) {
    const applied = await agent(`${CTX}
Apply these decisions exactly, and nothing else:
${JSON.stringify(edits.map(({ action, file, edit }) => ({ action, file, edit })))}
Edits to ${CONFIG} keep 2-space indentation: accept and externals entries are added, a config entry replaces the node
of that id under nodes. Annotation edits change only @system lines. Then run \`${CHECK} --json\` and confirm it parses.
${BRIEF}`, { label: 'settle:apply', phase: 'Settle', model: 'sonnet', effort: 'low', schema: OK_SCHEMA })
    log(`Settle: ${decisions.length} decision(s), ${edits.length} edit(s) ${applied?.ok ? 'applied' : 'NOT applied'}, ${count(decisions, (d) => d.action === 'move')} move(s) for the user`)
  } else log(`Settle: ${decisions.length} decision(s), no edits, ${count(decisions, (d) => d.action === 'move')} move(s) for the user`)
} else log('Settle: nothing deferred and no design findings')

// ---------- Phase 6: verify (serial loop to 0 warning, escalating once) ----------
phase('Verify')
// A finding settled as a move stays until someone moves the code; it is reported, not looped on.
const parked = new Set(decisions.filter((d) => d.action === 'move' && d.code && d.path).map(fkey))
let rounds = 0, escalated = false, open = []
for (;;) {
  check = await runCheck('Verify')
  if (!check || !check.ok) break
  open = check.warnings.filter((f) => !parked.has(fkey(f)))
  log(`Verify: ${open.length} open warning(s), ${check.warnings.length - open.length} parked as moves, ${check.info} info`)
  if (!open.length || escalated) break
  const last = rounds >= MAX_ROUNDS
  if (last) escalated = true
  else rounds++
  await agent(`${CTX}
${last ? `${MAX_ROUNDS} fix rounds did not clear these warnings. Diagnose why first, then fix them.` : 'These warnings remain after the module writers.'}
${JSON.stringify(open)}
Fix each in the @system lines of any file, or in the externals and nodes of ${CONFIG}. ${last
    ? 'You may add an accept entry {code, path, why} when the exception is deliberate and the why would convince a reviewer.'
    : 'Do not add accept entries.'} Never move code: a finding you cannot fix this way goes in unresolved with why.
Then run \`${CHECK} --write\`.
${BRIEF}`, last
    ? { label: 'verify:escalate', phase: 'Verify', model: 'opus', effort: 'high', schema: VFIX_SCHEMA }
    : { label: `verify:fix:${rounds}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VFIX_SCHEMA })
}
const clean = Boolean(check && check.ok && !open.length)
if (!clean) log(`Verify: ${check?.ok ? `${open.length} warning(s) remain after ${rounds} round(s)${escalated ? ' and the escalation' : ''}` : `the checker could not run (${check?.error ?? 'no result'})`}`)

// ---------- Phase 7: critique (opus, singleton, report only) ----------
phase('Critique')
const critique = check && check.ok ? await agent(`${CTX}
The sweep is done; judge the map as a picture. Read the committed map (the config's "map", default
diagrams/system-map.json) and what the repo says about its own layout (the root README, an AGENTS.md), and the code
where a doubt needs it. Report only what is wrong with the whole that no review of one module could see: two nodes
that are one module, one node that is two, a system outside the repo the map never names, a layer that reads wrong
beside its neighbours, a module the repo's docs describe that the map lacks. You edit nothing; the user decides.
${BRIEF}`, { label: 'critique', phase: 'Critique', model: 'opus', effort: 'high', schema: CRITIQUE_SCHEMA }) : null
log(`Critique: ${critique ? `${critique.notes.length} note(s)` : 'not run'}`)

return {
  skipped: false,
  scan: scan.totals,
  plan: {
    modules: plan.units.length,
    new: plan.units.filter((u) => u.action === 'new').map((u) => ({ node: u.node, dir: u.dir, layer: u.layer, title: u.title })),
    revised: plan.units.filter((u) => u.action === 'revise').map((u) => ({ node: u.node, dir: u.dir, layer: u.layer, title: u.title, why: u.brief })),
    tiers: { haiku: count(plan.units, (u) => u.tier === 'haiku'), sonnet: count(plan.units, (u) => u.tier === 'sonnet') },
    promoted,
    config: delta,
    notes: plan.notes,
    unplanned,
    dropped: clashes,
  },
  modules: items.map((u, i) => {
    const r = records[i]
    const iss = r?.review?.issues ?? []
    return {
      dir: u.dir, node: u.node, kind: u.kind, tier: u.tier, action: u.action,
      written: Boolean(r?.write), changed: r?.write?.changed ?? [],
      issues: { critical: count(iss, (x) => x.severity === 'critical'), major: count(iss, (x) => x.severity === 'major'), minor: count(iss, (x) => x.severity === 'minor') },
      fixed: r?.fix?.applied ?? 0, skipped: r?.fix?.skipped ?? [],
      failed: r ? (r.failed ?? null) : 'lost',
    }
  }),
  settled: decisions.filter((d) => d.action !== 'move'),
  moves: decisions.filter((d) => d.action === 'move'),
  verify: { clean, rounds, escalated, open, parked: check?.ok ? check.warnings.filter((f) => parked.has(fkey(f))) : [], checkerError: check?.ok ? null : (check?.error ?? 'no result') },
  critique: critique ? critique.notes : null,
  next: 'Every edit is uncommitted. Read git diff, diagrams/system-map.json first; then diagrams-sync step 3 publishes the board.',
}
