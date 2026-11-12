export const meta = {
  name: 'agent-works-sync-cards',
  description: 'Bring the cards in one scope of the kanban board level with the work: opus assesses them from their local evidence, an investigator per card (haiku for in-flight and backlog, sonnet for suggested) finds where each really stands, and opus confirms each verdict and moves the card through the board CLI',
  whenToUse: "sync-cards, after the person picked a scope and saw the count. Args: {root, pluginRoot, scope: 'in-flight'|'backlog'|'suggested', ids: [card ids]}. root is the absolute repo path, pluginRoot the absolute agent-works plugin root. Moves only what the evidence settles and the scope allows; what the board leaves to the person comes back as proposals. Changes no file outside the board.",
  phases: [
    { title: 'Assess', detail: "which cards need a look, and each investigator's brief, from board evidence", model: 'opus' },
    { title: 'Investigate', detail: 'per card: where its work really stands, with the commands that showed it' },
    { title: 'Confirm', detail: 'check each verdict against its evidence and move the card, one batch at a time', model: 'opus' },
  ],
}

// Model tiers. Opus decides, the cheap tier looks:
//   opus/medium   Assess (read-only, chunks in parallel) and Confirm (the only step that writes, batches in
//                 series so two moves never renumber one lane at once). Pinned, so a sweep started from a
//                 Sonnet or Haiku session still judges on opus.
//   haiku/low     in-flight and backlog investigators: git, the forge's CLI, and the files say where the work is.
//   sonnet/medium suggested investigators: whether a suggestion is still worth doing, already done, or a
//                 duplicate is a judgment of the code and the board, not a lookup.

// ---------- args (may arrive as a JSON string, coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.pluginRoot || !A.scope) {
  throw new Error("args must be an object: {root: <absolute repo root>, pluginRoot: <absolute agent-works plugin root>, scope: 'in-flight'|'backlog'|'suggested', ids: [card ids]}")
}
const ROOT = A.root.replace(/[\\/]+$/, '')
const BOARD = `node "${A.pluginRoot.replace(/[\\/]+$/, '')}/scripts/aw.mjs" board`
const IDS = (Array.isArray(A.ids) ? A.ids : String(A.ids ?? '').split(/[\s,]+/)).map(String).filter(Boolean)
const ASSESS_CHUNK = 15
const CONFIRM_BATCH = 8

// What each scope looks for, the states an investigator may report, and what each state lets Confirm do.
// apply: Confirm runs it, after a note. propose: the person decides; the skill asks. Anything else: keep.
const SCOPES = {
  'in-flight': {
    investigator: 'haiku', effort: 'low',
    looks: 'cards in progress or in review. Is the work still under way, waiting in an open merge request, merged, or left behind?',
    states: {
      active: 'work is under way and no pull or merge request is open: the card belongs in progress',
      'in-review': 'a pull or merge request is open for its branch: the card belongs in review, with its number',
      merged: 'its request merged, or its branch is in the base: the card is done, at that merge commit',
      abandoned: 'its request was closed unmerged, or its branch and worktree are gone with nothing merged',
      stalled: 'no request, and no commit or change for days',
      unclear: 'the evidence does not settle it',
    },
    apply: {
      active: { to: 'in-progress', command: (c) => `move ${c.id} in-progress` },
      'in-review': { to: 'review', needs: 'mr', command: (c, v) => `move ${c.id} review --mr ${v.mr.iid}` },
      merged: { to: 'done', needs: 'sha', command: (c, v) => `done ${c.id} --merged ${v.sha}` },
    },
    propose: { abandoned: 'abandon', stalled: 'abandon' },
  },
  backlog: {
    investigator: 'haiku', effort: 'low',
    looks: 'loose task cards waiting in the backlog. Is each still unstarted, already under way somewhere, already landed, or no longer needed?',
    states: {
      unstarted: 'nothing has been done toward it: it stays in the backlog',
      started: 'a branch or a worktree carries work toward it, unmerged',
      landed: 'its done criteria hold on the base: a merge or commits delivered it',
      obsolete: 'the code or need it names is gone, or a later change made it moot',
      duplicate: 'another card on the board covers the same work',
      unclear: 'the evidence does not settle it',
    },
    apply: {
      started: { to: 'in-progress', command: (c) => `move ${c.id} in-progress` },
      landed: { to: 'done', command: (c, v) => (v.sha ? `done ${c.id} --merged ${v.sha}` : `move ${c.id} done`) },
    },
    propose: { obsolete: 'archive', duplicate: 'archive' },
  },
  suggested: {
    investigator: 'sonnet', effort: 'medium',
    looks: "suggestions an agent filed, waiting for the person to accept or archive them. Is each still worth doing, already done, gone stale, or a duplicate? The person decides; you give them the reading.",
    states: {
      'worth-doing': 'the problem it names is still there and nothing on the board covers it',
      landed: 'the work it suggests has already been done',
      obsolete: 'the code or need it names is gone, or a later change made it moot',
      duplicate: 'another card on the board covers the same work',
      unclear: 'the evidence does not settle it',
    },
    // A suggestion is the person's to accept or archive, so Confirm only records the reading on the card.
    apply: {},
    propose: { 'worth-doing': 'accept', landed: 'archive', obsolete: 'archive', duplicate: 'archive' },
  },
}
const S = SCOPES[A.scope]
if (!S) throw new Error(`scope is one of ${Object.keys(SCOPES).join(', ')}, not "${A.scope}"`)
if (!IDS.length) return { scope: A.scope, skipped: 'no cards', applied: [], proposed: [], kept: [], failed: [] }

const PROPOSALS = {
  abandon: (c) => `abandon ${c.id}`,
  archive: (c) => `move ${c.id} archived`,
  accept: (c) => `move ${c.id} backlog`,
}

const BRIEF = 'Be terse in every string field, telegraphic phrases, no filler. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. You are one step of a sweep that brings kanban cards level with the work, in ${ROOT}; run every command from there.
The board CLI is \`${BOARD}\` (\`board\` below): \`board show <id>\` prints a card, \`board evidence <ids> --json\` what git on
this machine knows about each (its branch, a merge into the base, base commits naming it or touching its files, its
worktree; the person fetched before the sweep). A pull or merge request's state is on the forge the remote points at:
on GitHub \`gh pr view <number> --json state,mergeCommit,headRefName\` or \`gh pr list --head <branch> --state all --json number,state,mergeCommit\`;
on GitLab \`glab mr view <number> --output json\` or \`glab mr list --source-branch <branch> --all --output json\`.
A request that cannot be read (no network, not signed in) is unknown: say so, and never retry it in a loop.
Never change git state (no fetch, add, commit, checkout, switch, reset, stash, push) and never edit a file.
`

const STATE_LIST = Object.entries(S.states).map(([k, v]) => `- ${k}: ${v}`).join('\n')

// ---------- schemas ----------
const ASSESS_SCHEMA = {
  type: 'object', required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'verdict', 'why'],
        properties: {
          id: { type: 'string' },
          verdict: { enum: ['settled', 'investigate'], description: 'settled: the evidence already shows the card stands where it is; investigate: anything else' },
          why: { type: 'string' },
          brief: { type: 'string', description: 'for investigate: what to check and why, the context the investigator needs (branch, MR, files, the done criteria in a line)' },
          checks: { type: 'array', items: { type: 'string' }, description: 'for investigate: the read-only commands most likely to settle it' },
          related: { type: 'array', items: { type: 'string' }, description: 'ids of cards that may cover the same work' },
        },
      },
    },
  },
}
const EVIDENCE_ITEM = { type: 'object', required: ['check', 'saw'], properties: { check: { type: 'string' }, saw: { type: 'string' } } }
const INVESTIGATE_SCHEMA = {
  type: 'object', required: ['id', 'status', 'state', 'confidence', 'evidence', 'summary'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', description: 'the lane the card is in now, as board show prints it' },
    state: { enum: Object.keys(S.states) },
    confidence: { enum: ['high', 'medium', 'low'] },
    mr: {
      type: ['object', 'null'],
      properties: { iid: { type: 'integer' }, state: { type: 'string' }, merge_commit_sha: { type: ['string', 'null'] }, source_branch: { type: 'string' } },
    },
    sha: { type: ['string', 'null'], description: 'the full merge commit that landed the work, when there is one' },
    duplicateOf: { type: ['string', 'null'] },
    evidence: { type: 'array', items: EVIDENCE_ITEM, description: 'each command you ran and what it showed' },
    summary: { type: 'string' },
  },
}
const CONFIRM_SCHEMA = {
  type: 'object', required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'state', 'action', 'why'],
        properties: {
          id: { type: 'string' },
          state: { enum: Object.keys(S.states) },
          action: { enum: ['keep', 'apply', 'propose'] },
          command: { type: ['string', 'null'], description: 'the board command run (apply) or for the person to approve (propose), without the CLI path' },
          why: { type: 'string', description: 'the evidence the decision rests on, in a line' },
          ran: { type: 'boolean', description: 'apply only: the move ran and exited 0' },
          error: { type: ['string', 'null'], description: "apply only: the CLI's refusal, word for word" },
        },
      },
    },
  },
}

const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const count = (xs, pred) => xs.filter(pred).length

// ---------- Phase 1: assess (opus, read-only, chunks in parallel) ----------
phase('Assess')
const assessed = (await parallel(chunks(IDS, ASSESS_CHUNK).map((ids, i) => () => agent(`${CTX}
You assess ${ids.length} card(s) for this sweep. The scope: ${S.looks}
Cards: ${ids.join(' ')}
1. Run \`${BOARD} evidence ${ids.join(' ')} --json\` and read each card's signals, facts, and done criteria.
   \`board show <id>\` any card whose body you need.
2. For each card, one verdict:
   - settled: the evidence already shows the card stands where it is, and nothing would move it. Say why.
   - investigate: anything else. Write the investigator's brief: what to find out, why, and the context it needs
     (the branch, the request, the files, the done criteria in a line, cards that may cover the same work), and the
     read-only commands most likely to settle it.
   Settle only what the evidence shows; when in doubt, investigate. A card with a request on it is never settled without its
   state: investigate it.
The states an investigator will choose from:
${STATE_LIST}
Return every card you were given.
${BRIEF}`, { label: `assess:${i}`, phase: 'Assess', model: 'opus', effort: 'medium', schema: ASSESS_SCHEMA }))))
const verdicts = new Map()
for (const a of assessed.filter(Boolean)) for (const c of a.cards) if (IDS.includes(c.id) && !verdicts.has(c.id)) verdicts.set(c.id, c)
// A card the assessor dropped is investigated rather than lost.
for (const id of IDS) if (!verdicts.has(id)) verdicts.set(id, { id, verdict: 'investigate', why: 'the assessor returned nothing for it', brief: 'Find where its work stands.' })
const settled = IDS.filter((id) => verdicts.get(id).verdict === 'settled')
const toLook = IDS.filter((id) => verdicts.get(id).verdict !== 'settled')
log(`Assess: ${IDS.length} card(s), ${settled.length} settled, ${toLook.length} to investigate${assessed.some((a) => !a) ? `; ${count(assessed, (a) => !a)} chunk(s) lost and investigated whole` : ''}`)

// ---------- Phase 2: investigate (one per card, in parallel, read-only) ----------
phase('Investigate')
const reports = await parallel(toLook.map((id) => () => {
  const v = verdicts.get(id)
  return agent(`${CTX}
You investigate one card: ${id}. The scope: ${S.looks}
The assessor's brief: ${v.brief ?? v.why}
${v.checks?.length ? `Commands it expects to settle it: ${v.checks.join(' ; ')}` : ''}${v.related?.length ? `\nCards that may cover the same work: ${v.related.join(', ')}` : ''}
Start with \`${BOARD} show ${id}\` and \`${BOARD} evidence ${id} --json\`. Then run what settles it: git log, show, diff,
branch, and grep against the base; ls and cat; gh or glab for a request's state. Read only.
Report one state:
${STATE_LIST}
Give status, the lane the card is in now. List every command you ran and what it showed in evidence. Give mr (iid: its number, state, merge_commit_sha, source_branch) when a
pull or merge request decided it, sha (the full merge commit) when the work landed, and duplicateOf when another card covers
it. Say low confidence rather than guessing.
${BRIEF}`, { label: `investigate:${id}`, phase: 'Investigate', model: S.investigator, effort: S.effort, schema: INVESTIGATE_SCHEMA })
}))
const byId = new Map(toLook.map((id, i) => [id, reports[i]]))
const lost = toLook.filter((id) => !byId.get(id))
log(`Investigate: ${toLook.length - lost.length} of ${toLook.length} reported on ${S.investigator}${lost.length ? `; lost: ${lost.join(', ')}` : ''}`)

// ---------- Phase 3: confirm and apply (opus, batches in series) ----------
phase('Confirm')
const TEMPLATE = [{ id: '<id>' }, { mr: { iid: '<iid>' }, sha: '<full merge commit sha>' }]
const allowed = Object.entries(S.apply)
  .map(([state, a]) => `   - ${state}: \`${a.command(...TEMPLATE)}\`${a.needs ? ` (only with the ${a.needs === 'mr' ? "request's number" : 'full merge commit sha'})` : ''}`)
  .join('\n') || '   - none: this scope moves nothing'
const proposable = Object.entries(S.propose).map(([state, p]) => `   - ${state}: \`${PROPOSALS[p](TEMPLATE[0])}\``).join('\n')
const decided = []
for (const [i, batch] of chunks(toLook.filter((id) => byId.get(id)), CONFIRM_BATCH).entries()) {
  const result = await agent(`${CTX}
You confirm the investigators' verdicts for ${batch.length} card(s) and move what the evidence settles. You are the only
step that writes, and you write only through the board CLI.
${batch.map((id) => `Card ${id}: ${JSON.stringify(byId.get(id))}`).join('\n')}
For each card:
1. Judge the verdict against its evidence. Where it is thin, low confidence, or rests on one fact (a merge, an open request),
   re-run the one command it rests on. Overturn it when the evidence says otherwise; unclear when nothing settles it.
2. Act on the confirmed state:
   apply, when the card is not already where the state puts it: run \`${BOARD} note <id> "sync: <state>, <the evidence
   in a line>"\` (a plan card, id like 01-02-03, takes no note: its record is the plan's), then the move. Only these:
${allowed}
   propose, for the person to decide (run nothing):
${proposable}
   keep: every other state, a card already where its state puts it, and any apply that lacks what it needs.
   Run one command at a time and read its exit code. A refusal is not retried another way: record ran false and the
   CLI's words in error. Never run done without the full merge commit sha the evidence shows.
Return every card in the batch, with command as the board verb and its arguments, without the CLI path.
${BRIEF}`, { label: `confirm:${i}`, phase: 'Confirm', model: 'opus', effort: 'medium', schema: CONFIRM_SCHEMA })
  if (!result) {
    log(`Confirm: batch ${i} returned nothing; its cards are reported unconfirmed and may have moved: board show them`)
    for (const id of batch) decided.push({ id, state: byId.get(id).state, action: 'keep', why: 'confirm returned nothing', unconfirmed: true })
    continue
  }
  for (const c of result.cards) if (batch.includes(c.id)) decided.push(c)
  for (const id of batch) if (!result.cards.some((c) => c.id === id)) decided.push({ id, state: byId.get(id).state, action: 'keep', why: 'confirm left it out', unconfirmed: true })
}

// ---------- the report ----------
const proposals = decided.filter((c) => c.action === 'propose').map((c) => {
  const kind = S.propose[c.state]
  return { id: c.id, state: c.state, action: kind ?? null, command: kind ? PROPOSALS[kind]({ id: c.id }) : c.command ?? null, why: c.why }
})
const applied = decided.filter((c) => c.action === 'apply' && c.ran)
// An apply the scope does not allow is reported, not hidden: Confirm already ran it.
const violations = decided.filter((c) => c.action === 'apply' && !S.apply[c.state])
const failed = [
  ...decided.filter((c) => c.action === 'apply' && !c.ran).map((c) => ({ id: c.id, step: 'apply', command: c.command ?? null, error: c.error ?? 'did not run' })),
  ...lost.map((id) => ({ id, step: 'investigate', error: 'the investigator returned nothing' })),
  ...decided.filter((c) => c.unconfirmed).map((c) => ({ id: c.id, step: 'confirm', error: c.why })),
]
const kept = [
  ...settled.map((id) => ({ id, why: verdicts.get(id).why, by: 'assess' })),
  ...decided.filter((c) => c.action === 'keep' && !c.unconfirmed).map((c) => ({ id: c.id, state: c.state, why: c.why, by: 'confirm' })),
]
log(`Confirm: ${applied.length} moved, ${proposals.length} for the person, ${kept.length} kept, ${failed.length} failed${violations.length ? `, ${violations.length} outside the scope's rules` : ''}`)

return {
  scope: A.scope,
  investigator: S.investigator,
  cards: IDS.length,
  applied: applied.map((c) => ({ id: c.id, state: c.state, command: c.command, why: c.why })),
  proposed: proposals,
  kept,
  failed,
  violations: violations.map((c) => ({ id: c.id, state: c.state, command: c.command, why: c.why })),
  next: proposals.length
    ? `Show the person the moves made and ask about each proposal; on a yes run ${BOARD} note <id> "sync: <why>" and then its command.`
    : 'Show the person the moves made; nothing waits on them.',
}
