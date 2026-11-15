export const meta = {
  name: 'perceptual-critique',
  description: 'Blind critique of finished look changes: one vision critic per comparison, then a skeptic per finding, returning the findings that survived',
  whenToUse: "judge-and-queue step 3, for a batch of finished shots, when the person asked for multi-agent work. Args: {pluginRoot, items: [<what pl.mjs blind --json printed for one comparison: {id, images: {A, B, R?}, aIs}> plus {observables: [string], box?: 'x0,y0,x1,y1'}]}. Pictures must be the neutral copies blind made. Returns per item the observables, the findings not refuted (each verified true or false), the differences nobody could rank, and the counts.",
  phases: [
    { title: 'Critique', detail: 'one blind vision critic per comparison: observables, defects, differences' },
    { title: 'Refute', detail: 'a skeptic per finding tries to show it is not in the picture' },
  ],
}

// Why a workflow: the builder knows what it meant and sees it. A critic given only pictures and neutral
// questions is not anchored, and a second look that tries to refute each finding removes the critic's own
// inventions.
// Blinding: the pictures arrive as A.<ext> and B.<ext> in a temp folder, copied by `pl.mjs blind`, which also
// decided from the id which letter is the earlier state (aIs). That key stays in this script: no prompt and no
// path carries it, and the words for the two states never appear in a prompt.
// Both stages dispatch the plugin's vision-critic agent, whose tools and rules keep it to the pictures.

const CRITIC = 'perceptual-loop:vision-critic'
const STATE_WORDS = new Set(['before', 'after', 'old', 'new', 'prev', 'previous', 'baseline', 'candidate', 'cand', 'reference', 'ref',
  'orig', 'original', 'fixed', 'broken', 'good', 'bad', 'expected', 'actual', 'golden', 'current', 'cur', 'wip', 'base', 'head', 'main'])

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !Array.isArray(A.items) || !A.items.length) {
  throw new Error('args must be {pluginRoot, items: [{id, images: {A, B, R?}, aIs: "before"|"after", observables: [string], box?}]}; each item is what pl.mjs blind --json printed')
}
const ROOT = String(A.pluginRoot || '').replace(/[\\/]+$/, '')
if (!ROOT) throw new Error('args.pluginRoot is required: the absolute path of the perceptual-loop plugin, for the critic\'s crops')

const usable = i => i && i.id && i.images && i.images.A && i.images.B && (i.aIs === 'before' || i.aIs === 'after')
const ITEMS = A.items.filter(usable)
const DROPPED = A.items.length - ITEMS.length
if (DROPPED) log(`Skipped ${DROPPED} item(s) without id, images.A, images.B, or aIs`)
if (!ITEMS.length) throw new Error('no usable item: each needs id, images.A, images.B, and aIs from pl.mjs blind --json')

// A name that tells which state a picture is defeats the blinding: refuse rather than run a critique that only
// looks blind. Each picture must be named for its own letter, in a folder whose name gives nothing away.
const parts = p => String(p).split(/[\\/]/).filter(Boolean)
// words of a folder name, digits at their ends dropped: "before1" is "before", a temp suffix "a1old2" is one word
const tokens = s => s.toLowerCase().split(/[^a-z0-9]+/).map(t => t.replace(/^\d+|\d+$/g, '')).filter(Boolean)
function telling(item) {
  const out = []
  for (const [letter, p] of Object.entries(item.images)) {
    if (!p) continue
    const segs = parts(p), base = segs[segs.length - 1] || '', folder = segs[segs.length - 2] || ''
    if (!new RegExp(`^${letter}\\.[A-Za-z0-9]+$`).test(base)) out.push(`${p} (named other than ${letter}.<ext>)`)
    else if (tokens(folder).some(t => STATE_WORDS.has(t))) out.push(`${p} (its folder names a state)`)
  }
  return out
}
const refused = ITEMS.flatMap(telling)
if (refused.length) {
  throw new Error(`these pictures tell the critic which state they are: ${refused.slice(0, 4).join('; ')}. Make neutral copies first: node "${ROOT}/scripts/pl.mjs" blind --id <id> --before <file> --after <file> [--reference <file>] --json`)
}

const ANSWER = { type: 'string', enum: ['yes', 'no', 'cannot tell'] }
const CRITIC_SCHEMA = {
  type: 'object', required: ['observables', 'defects', 'differences', 'couldNotJudge'],
  properties: {
    observables: { type: 'array', items: { type: 'object', required: ['question', 'a', 'b', 'seen'], properties: {
      question: { type: 'string' }, a: ANSWER, b: ANSWER, seen: { type: 'string', description: 'what in the picture makes you say so, and where' } } } },
    defects: { type: 'array', items: { type: 'object', required: ['image', 'where', 'what'], properties: {
      image: { type: 'string', enum: ['A', 'B', 'R'] }, where: { type: 'string' }, what: { type: 'string' } } } },
    differences: { type: 'array', items: { type: 'object', required: ['what', 'where', 'morePlausible', 'why'], properties: {
      what: { type: 'string' }, where: { type: 'string' }, morePlausible: { type: 'string', enum: ['A', 'B', 'neither', 'cannot tell'] }, why: { type: 'string' } } } },
    couldNotJudge: { type: 'array', items: { type: 'string' } },
  },
}
const REFUTE_SCHEMA = { type: 'object', required: ['refuted', 'why'], properties: { refuted: { type: 'boolean' }, why: { type: 'string' } } }

const pathsLine = item => `A: ${item.images.A}\nB: ${item.images.B}${item.images.R ? `\nR (a reference, not assumed to be right): ${item.images.R}` : ''}`
const cropLine = `The plugin root, for a crop, is ${ROOT}.`

const criticPrompt = item => [
  'Judge these pictures.',
  pathsLine(item),
  item.box ? `Attend to the box ${item.box} (fractions of the frame: x0,y0,x1,y1).` : '',
  'Observables, to answer for A and for B:',
  (item.observables || []).map((q, i) => `${i + 1}. ${q}`).join('\n') || '(none given: report defects and differences only)',
  cropLine,
].filter(Boolean).join('\n')

const refutePrompt = (item, finding) => [
  'A critic claims this about a picture. Try to refute it by looking yourself: answer refuted=true unless you can clearly see it.',
  `Claim (${finding.kind}): ${finding.text}`,
  'Pictures:',
  pathsLine(item),
  'Open the pictures with the Read tool and look at the stated place; a crop is allowed. Edit nothing.',
  cropLine,
].join('\n')

const results = await pipeline(
  ITEMS,
  item => agent(criticPrompt(item), { label: `critic:${item.id}`, phase: 'Critique', schema: CRITIC_SCHEMA, agentType: CRITIC })
    .then(c => (c ? { item, c } : null)),
  r => {
    if (!r) return null
    const ranked = r.c.differences.filter(d => d.morePlausible === 'A' || d.morePlausible === 'B')
    const findings = [
      ...r.c.defects.map(d => ({ kind: 'defect', side: d.image, text: `in picture ${d.image}, ${d.where}: ${d.what}`, raw: d })),
      ...ranked.map(d => ({ kind: 'difference', side: d.morePlausible, text: `${d.what} (${d.where}); ${d.morePlausible} is more plausible because ${d.why}`, raw: d })),
    ]
    // a barrier per item: its result needs all of its findings' verdicts together
    return parallel(findings.map(f => () =>
      agent(refutePrompt(r.item, f), { label: `refute:${r.item.id}`, phase: 'Refute', schema: REFUTE_SCHEMA, agentType: CRITIC })
    )).then(verdicts => ({
      ...r,
      // three states: a skeptic that failed refuted nothing, so its finding is kept and marked unverified
      judged: findings.map((f, i) => ({ ...f, state: verdicts[i] ? (verdicts[i].refuted ? 'refuted' : 'confirmed') : 'unverified' })),
      // a difference nobody could rank is still one the builder should know of: kept, not judged
      unranked: r.c.differences.filter(d => !ranked.includes(d)),
    }))
  },
)

// Letters become states only here, once every judgement is in.
const stateOf = (item, side) => (side === 'R' ? 'reference' : (side === 'A') === (item.aIs === 'before') ? 'before' : 'after')
const out = results.filter(Boolean).map(r => {
  const aFirst = r.item.aIs === 'before'
  return {
    id: r.item.id,
    observables: r.c.observables.map(o => ({ question: o.question, before: aFirst ? o.a : o.b, after: aFirst ? o.b : o.a, seen: o.seen })),
    // a defect is on a side; a difference names the side that is more plausible
    findings: r.judged.filter(f => f.state !== 'refuted').map(f => (f.kind === 'defect'
      ? { kind: 'defect', verified: f.state === 'confirmed', on: stateOf(r.item, f.side), what: f.raw.what, where: f.raw.where }
      : { kind: 'difference', verified: f.state === 'confirmed', morePlausible: stateOf(r.item, f.side), what: f.raw.what, where: f.raw.where, why: f.raw.why })),
    unrankedDifferences: r.unranked.map(d => ({ what: d.what, where: d.where, why: d.why })),
    refutedCount: r.judged.filter(f => f.state === 'refuted').length,
    unverifiedCount: r.judged.filter(f => f.state === 'unverified').length,
    couldNotJudge: r.c.couldNotJudge,
  }
})
const missing = ITEMS.length - out.length
if (missing) log(`${missing} comparison(s) produced no critique (an agent was skipped or failed): not covered`)
const sum = key => out.reduce((n, o) => n + (Array.isArray(o[key]) ? o[key].length : o[key]), 0)
const refutedTotal = sum('refutedCount'), unverified = sum('unverifiedCount'), unranked = sum('unrankedDifferences')
log(`${out.length} critiqued; ${refutedTotal} finding(s) refuted and dropped; ${unverified} not verified (kept, verified false); ${unranked} difference(s) with no more plausible side (kept, unranked)`)
return { critiqued: out.length, notCovered: missing + DROPPED, refuted: refutedTotal, unverified, unranked, items: out }
