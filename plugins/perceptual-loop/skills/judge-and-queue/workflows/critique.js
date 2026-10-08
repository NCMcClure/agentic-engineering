export const meta = {
  name: 'perceptual-critique',
  description: 'Unanchored visual critique of finished look changes: one blind critic per comparison, then a refuter per finding, returning the findings that were not refuted',
  whenToUse: "judge-and-queue step 3, for a batch of finished shots, only when the user asked for multi-agent work. Args: {pluginRoot, items: [<the JSON blind.py printed for a comparison: {id, images: {A, B, R?}, aIs}> plus {observables: [string], box?}]}. The pictures must be the neutral copies blind.py made; the critics never learn which letter is the earlier state. Returns per item the observables, the findings not refuted (each verified true or false), the differences nobody could rank, and the counts.",
  phases: [
    { title: 'Critique', detail: 'one blind critic per comparison: observables, defects, differences', model: 'opus' },
    { title: 'Refute', detail: 'a skeptic per finding tries to show it is not there', model: 'opus' },
  ],
}

// Why a workflow: the builder knows what it meant and sees it. A critic that gets only pictures and neutral
// questions is not anchored, and a second agent that tries to refute each finding removes the critic's own
// inventions.
// Blinding: the pictures arrive as A.png / B.png, copied by scripts/blind.py, which also decided from the id which
// letter is the earlier state (aIs). That key stays in this script; no prompt carries it, and no path does either.
// Tiers: both stages are judgment fan-outs, so both run on the top tier at the session's effort. A refuter told to
// "answer refuted if you cannot clearly see it" on a cheap or hurried look would delete real defects.

let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !Array.isArray(A.items) || !A.items.length) {
  throw new Error('args must be {pluginRoot, items: [{id, images: {A, B, R?}, aIs: "before"|"after", observables: [string], box?}]} (items come from scripts/blind.py --json)')
}
const ROOT = String(A.pluginRoot || '').replace(/[\\/]$/, '')
if (!ROOT) throw new Error('args.pluginRoot is required: the absolute path of the perceptual-loop plugin (the critic crops with its sheet.py)')
const usable = i => i && i.id && i.images && i.images.A && i.images.B && (i.aIs === 'before' || i.aIs === 'after')
const ITEMS = A.items.filter(usable)
const DROPPED = A.items.length - ITEMS.length
if (DROPPED) log(`Skipped ${DROPPED} item(s) without id / images.A / images.B / aIs`)
// A file name that says which state it is defeats the blinding: refuse rather than run a critique that only looks blind.
const baseName = p => String(p).split(/[\\/]/).pop()
const telling = ITEMS.flatMap(i => [i.images.A, i.images.B]).filter(p => /before|after|old|new|prev|baseline|candidate/i.test(baseName(p)))
if (telling.length) {
  throw new Error(`these picture names tell the critic which state they are: ${telling.slice(0, 4).join(', ')}. Make neutral copies first: uv run --no-project "${ROOT}/scripts/blind.py" --id <id> --before <file> --after <file> --json`)
}

const CRITIC_SCHEMA = {
  type: 'object', required: ['observables', 'defects', 'differences', 'couldNotJudge'],
  properties: {
    observables: { type: 'array', items: { type: 'object', required: ['question', 'a', 'b', 'seen'], properties: {
      question: { type: 'string' }, a: { type: 'string', enum: ['yes', 'no', 'cannot tell'] }, b: { type: 'string', enum: ['yes', 'no', 'cannot tell'] },
      seen: { type: 'string', description: 'what in the picture makes you say so, and where' } } } },
    defects: { type: 'array', items: { type: 'object', required: ['image', 'where', 'what'], properties: {
      image: { type: 'string', enum: ['A', 'B', 'R'] }, where: { type: 'string' }, what: { type: 'string' } } } },
    differences: { type: 'array', items: { type: 'object', required: ['what', 'where', 'morePlausible', 'why'], properties: {
      what: { type: 'string' }, where: { type: 'string' }, morePlausible: { type: 'string', enum: ['A', 'B', 'neither', 'cannot tell'] }, why: { type: 'string' } } } },
    couldNotJudge: { type: 'array', items: { type: 'string' } },
  },
}
const REFUTE_SCHEMA = {
  type: 'object', required: ['refuted', 'why'],
  properties: { refuted: { type: 'boolean' }, why: { type: 'string' } },
}

const pathsLine = item => `A: ${item.images.A}\nB: ${item.images.B}${item.images.R ? `\nR (a reference; not assumed to be right): ${item.images.R}` : ''}`

// The critic's role, method and answer rules live in agents/vision-critic.md (their one home): the stage dispatches
// that agent, and this prompt carries only the pictures and the questions.
const criticPrompt = item => `Judge these pictures.
${pathsLine(item)}
${item.box ? `Attend to the region ${item.box} (fractions of the frame: x0,y0,x1,y1).` : ''}
Observables, to answer for A and for B:
${(item.observables || []).map((q, i) => `${i + 1}. ${q}`).join('\n') || '(none given: report defects and differences only)'}
The plugin root, for a crop, is ${ROOT}.`

const refutePrompt = (item, finding) => `A critic claims this about a picture. Try to REFUTE it by looking yourself; answer refuted=true if you cannot clearly see it.
Claim (${finding.kind}): ${finding.text}
Images:
${pathsLine(item)}
Open the image(s) with the Read tool and look at the stated place. Edit nothing, run nothing.`

const results = await pipeline(
  ITEMS,
  item => agent(criticPrompt(item), { label: `critic:${item.id}`, phase: 'Critique', schema: CRITIC_SCHEMA, agentType: 'perceptual-loop:vision-critic', model: 'opus' })
    .then(c => (c ? { item, c } : null)),
  (r) => {
    if (!r) return null
    const ranked = r.c.differences.filter(d => d.morePlausible === 'A' || d.morePlausible === 'B')
    const findings = [
      ...r.c.defects.map(d => ({ kind: 'defect', side: d.image, text: `in image ${d.image}, ${d.where}: ${d.what}`, raw: d })),
      ...ranked.map(d => ({ kind: 'difference', side: d.morePlausible, text: `${d.what} (${d.where}); ${d.morePlausible} is more plausible because ${d.why}`, raw: d })),
    ]
    // Barrier per item: an item's result needs all of its findings' verdicts together.
    return parallel(findings.map(f => () =>
      agent(refutePrompt(r.item, f), { label: `refute:${r.item.id}`, phase: 'Refute', schema: REFUTE_SCHEMA, model: 'opus' })
    )).then(verdicts => ({
      ...r,
      // Three states. A verifier that failed has refuted nothing: its finding is kept and marked unverified.
      judged: findings.map((f, i) => {
        const v = verdicts[i]
        return { ...f, state: v ? (v.refuted ? 'refuted' : 'confirmed') : 'unverified' }
      }),
      // A difference nobody could rank is still a difference the builder should know of: kept, not judged.
      unranked: r.c.differences.filter(d => !ranked.includes(d)),
    }))
  }
)

// Translate A/B back to before/after only here, after every judgement is in.
const name = (r, side) => (side === 'R' ? 'reference' : ((side === 'A') === (r.item.aIs === 'before') ? 'before' : 'after'))
const out = results.filter(Boolean).map(r => {
  const aBefore = r.item.aIs === 'before'
  return {
    id: r.item.id,
    observables: r.c.observables.map(o => ({ question: o.question, before: aBefore ? o.a : o.b, after: aBefore ? o.b : o.a, seen: o.seen })),
    // a defect is ON a side; a difference names the side that is MORE PLAUSIBLE
    findings: r.judged.filter(f => f.state !== 'refuted').map(f => f.kind === 'defect'
      ? { kind: 'defect', verified: f.state === 'confirmed', on: name(r, f.side), what: f.raw.what, where: f.raw.where }
      : { kind: 'difference', verified: f.state === 'confirmed', morePlausible: name(r, f.side), what: f.raw.what, where: f.raw.where, why: f.raw.why }),
    unrankedDifferences: r.unranked.map(d => ({ what: d.what, where: d.where, why: d.why })),
    refutedCount: r.judged.filter(f => f.state === 'refuted').length,
    unverifiedCount: r.judged.filter(f => f.state === 'unverified').length,
    couldNotJudge: r.c.couldNotJudge,
  }
})
const missing = ITEMS.length - out.length
if (missing) log(`${missing} comparison(s) produced no critique (agent skipped or failed): not covered`)
const sum = key => out.reduce((n, o) => n + (Array.isArray(o[key]) ? o[key].length : o[key]), 0)
const refuted = sum('refutedCount')
const unverified = sum('unverifiedCount')
const unranked = sum('unrankedDifferences')
log(`${out.length} critiqued; ${refuted} finding(s) refuted and dropped; ${unverified} could not be verified (kept, verified:false); ${unranked} difference(s) with no more plausible side (kept, unranked)`)
return { critiqued: out.length, notCovered: missing + DROPPED, refuted, unverified, unranked, items: out }
