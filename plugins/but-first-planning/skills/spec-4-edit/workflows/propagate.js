export const meta = {
  name: 'spec-4-propagate',
  description: 'Propagate a spec change through the plan tree and tracker: find every issue anchored to the changed spec files, classify each (still-valid / update / re-cut / obsolete), apply the plan-side edits, sync published tickets, and re-verify',
  whenToUse: "spec-4-edit's propagation step when the blast radius is wide (roughly 10+ affected issues) and the user has approved the affected-issue list. Args: {root, changedSpecFiles, changeSummary}. Re-cuts are flagged back to the skill, not applied.",
  phases: [
    { title: 'Find', detail: 'grep spec-anchor backlinks for the affected issues' },
    { title: 'Classify', detail: 'one classifier per affected issue' },
    { title: 'Apply', detail: 'plan-side edits per issue', model: 'sonnet' },
    { title: 'Sync', detail: 'rebuild published tickets from their plan files' },
    { title: 'Verify', detail: 'both structural verifiers' },
  ],
}

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !Array.isArray(A.changedSpecFiles) || !A.changedSpecFiles.length || !A.changeSummary) {
  throw new Error('args must be an object: {root: <absolute repo root>, changedSpecFiles: [spec-relative paths], changeSummary: <what changed and why>}')
}
const ROOT = A.root.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`
const PLANDIR = `${ROOT}/.plan/plan`

const BRIEF = 'Be terse in every string field. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

const CTX = `
CONTEXT. The spec at ${SPEC}/ changed and the plan tree at ${PLANDIR}/ (epic/sprint/issue files,
formats enforced by ${PLANDIR}/verify-plan-tree.py) must be brought back into agreement. Issues
link to the spec via spec-anchor paths; the tracker config is ${ROOT}/.plan/tracker.md.
THE CHANGE: ${A.changeSummary}
CHANGED SPEC FILES (relative to ${SPEC}/): ${A.changedSpecFiles.join(', ')}
`

// ---------- Phase 1: find affected issues ----------
phase('Find')
const found = await agent(
  `${CTX}\nFind every plan issue affected by the change. For each changed spec file, grep the plan tree for its path (anchors embed "spec/<path>"): grep -rl "spec/<path>" ${PLANDIR} — check issue files AND the **Spec anchors** lines in epic.md/sprint.md for coarser ripples. For each affected ISSUE file report: its path, which changed spec file(s) it anchors, its **GitHub** ref (<unassigned> or #NNN), and its H1 title. Also report two booleans: layoutTouched=true if any changed spec file is repository-layout.md (the AGENTS.md hubs need review); docsPlanTouched=true if any is user-docs-plan.md (the end-user docs plan changed). ${BRIEF}`,
  {
    label: 'find:affected', phase: 'Find', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['issues', 'layoutTouched', 'docsPlanTouched'],
      properties: {
        issues: {
          type: 'array',
          items: {
            type: 'object', required: ['path', 'anchors', 'ref', 'title'],
            properties: {
              path: { type: 'string', description: 'absolute path of the issue file' },
              anchors: { type: 'array', items: { type: 'string' } },
              ref: { type: 'string', description: '<unassigned> or #NNN' },
              title: { type: 'string' },
            },
          },
        },
        layoutTouched: { type: 'boolean' },
        docsPlanTouched: { type: 'boolean' },
      },
    },
  }
)
const affected = (found && found.issues) || []
const layoutTouched = !!(found && found.layoutTouched)
const docsPlanTouched = !!(found && found.docsPlanTouched)
log(`${affected.length} affected issues (${affected.filter(i => i.ref !== '<unassigned>').length} published)`)
if (!affected.length && !layoutTouched && !docsPlanTouched) return { affected: [], note: 'no plan issues anchor the changed spec files' }

// ---------- Phase 2: classify each affected issue ----------
phase('Classify')
const CLASSIFY_SCHEMA = {
  type: 'object',
  required: ['path', 'verdict', 'reasoning'],
  properties: {
    path: { type: 'string' },
    verdict: { enum: ['still-valid', 'update', 're-cut', 'obsolete'] },
    reasoning: { type: 'string' },
    editInstruction: { type: 'string', description: "for 'update': the concrete edit to the issue's What to build / Acceptance criteria; for 'obsolete': the closure reason" },
    docsImpact: { type: 'string', description: "when the issue's **User-facing** line says yes AND the change alters that surface's behaviour: one line naming what the end-user docs must now say differently; else omit" },
  },
}
// classification is parallel-heavy judgment work — opus per the model-tier policy
const classified = (await parallel(affected.map(i => () =>
  agent(
    `${CTX}\nYou are the impact classifier for one plan issue. Read the issue file ${i.path} and the changed spec file(s) it anchors (${i.anchors.map(a => `${SPEC}/${a}`).join(', ')}). Classify the impact of THE CHANGE on this issue:\n- still-valid: the change doesn't touch what the issue builds\n- update: the behaviour changed but the slice is still one slice — give the concrete edit\n- re-cut: the slice is now too big/too small/wrongly shaped (split, merge, or replace needed)\n- obsolete: the spec section this realises is gone — give the closure reason\nAlso: if the issue's **User-facing** line says yes and the change alters that surface's behaviour, set docsImpact to one line naming what the end-user docs must now say differently.\nSet path="${i.path}". ${BRIEF}`,
    { label: `classify:${i.path.split('/').pop()}`, phase: 'Classify', schema: CLASSIFY_SCHEMA, model: 'opus', effort: 'medium' }
  ).then(v => v && { ...i, ...v })
))).filter(Boolean)

const updates = classified.filter(c => c.verdict === 'update')
const obsolete = classified.filter(c => c.verdict === 'obsolete')
const recuts = classified.filter(c => c.verdict === 're-cut')
log(`classified: ${classified.filter(c => c.verdict === 'still-valid').length} still-valid, ${updates.length} update, ${recuts.length} re-cut (flagged, not applied), ${obsolete.length} obsolete`)

// ---------- Phase 3: apply plan-side edits ----------
phase('Apply')
const APPLY_SCHEMA = {
  type: 'object', required: ['path', 'edited', 'summary'],
  properties: { path: { type: 'string' }, edited: { type: 'boolean' }, summary: { type: 'string' } },
}
const applied = (await parallel([...updates, ...obsolete].map(c => () =>
  agent(
    `${CTX}\nYou are a plan-file editor for exactly one issue file: ${c.path}. ${c.verdict === 'update'
      ? `Apply this edit to its ## What to build and/or ## Acceptance criteria, keeping every verifier contract intact (bold fields, section headings, anchor link shapes ../../../../spec/<path>, and the link-free **User-facing** line at the end of What to build — preserve it, or add it as 'yes — <surface>' / 'no — internal' if the file predates it): ${c.editInstruction}`
      : `The issue is OBSOLETE (${c.editInstruction || c.reasoning}). Do NOT delete the file: append a "> **Obsolete**: <reason>" blockquote under the H1 and leave everything else intact — the coordinator closes its ticket separately and status stays funnel-owned.`}\nDo not touch any other file (sprint tables are not affected by body edits). Do not run git. Set path="${c.path}". ${BRIEF}`,
    { label: `apply:${c.path.split('/').pop()}`, phase: 'Apply', model: 'sonnet', effort: 'medium', schema: APPLY_SCHEMA }
  )
))).filter(Boolean)

// ---------- Phase 4: sync published tickets ----------
phase('Sync')
const publishedChanged = [...updates, ...obsolete].filter(c => /^#\d+/.test(c.ref))
let sync = null
if (publishedChanged.length) {
  sync = await agent(
    `${CTX}\nYou are the tracker synchronizer. Read ${ROOT}/.plan/tracker.md for the tracker backend and commands. These plan issues just changed AND have live tickets — sync each ticket from its (now-updated) plan file, in dependency order:\n${JSON.stringify(publishedChanged.map(c => ({ ref: c.ref, path: c.path, verdict: c.verdict, reason: c.editInstruction || c.reasoning })), null, 1)}\n\n- verdict 'update' -> rebuild the ticket's title/body from the plan file: python3 ${PLANDIR}/publish-issues.py sync --iid <NNN> (fall back to the tracker.md update recipe if the script is absent).\n- verdict 'obsolete' -> comment the closure reason on the ticket, then close it (close, never delete).\n- Blocked-by ripples: any OTHER published ticket whose body cites one of these refs in its Blocked-by section also needs its body regenerated — grep the plan tree for the sibling links and sync those too.\nReport per-ticket outcomes. ${BRIEF}`,
    {
      label: 'sync:tickets', phase: 'Sync', model: 'sonnet', effort: 'medium',
      schema: {
        type: 'object', required: ['synced', 'failures'],
        properties: {
          synced: { type: 'array', items: { type: 'string' }, description: 'refs synced, with action taken' },
          failures: { type: 'array', items: { type: 'string' } },
        },
      },
    }
  )
}

// ---------- Phase 5: verify ----------
phase('Verify')
const verify = await agent(
  `Run both verifiers from ${ROOT}: python3 ${SPEC}/scripts/verify-spec-tree.py and python3 ${PLANDIR}/verify-plan-tree.py${layoutTouched ? `, plus python3 ${PLANDIR}/verify-agents-tree.py if that file exists (repository-layout.md changed — the hub structure needs re-checking)` : ''}. If a verifier fails on a file this propagation touched, fix the mechanical fallout (broken anchor, table mismatch) and re-run; report anything you can't fix. ${BRIEF}`,
  {
    label: 'verify:both', phase: 'Verify', model: 'sonnet', effort: 'medium',
    schema: {
      type: 'object', required: ['specExit0', 'planExit0', 'notes'],
      properties: { specExit0: { type: 'boolean' }, planExit0: { type: 'boolean' }, agentsExit: { type: 'integer', description: 'verify-agents-tree.py exit code, when run' }, notes: { type: 'string' } },
    },
  }
)

const docsRipples = [
  ...(docsPlanTouched ? [{ kind: 'docs-plan', note: 'user-docs-plan.md itself changed — the docs stack/page map moved; build-user-docs realigns the managed set on its next pass' }] : []),
  ...classified.filter(c => c.docsImpact).map(c => ({ kind: 'issue', path: c.path, ref: c.ref, note: c.docsImpact })),
]
const agentsRipples = layoutTouched
  ? { note: 'repository-layout.md changed — review the AGENTS.md hubs of the affected source directories and re-run verify-agents-tree.py (see spec-4-edit SYNC.md)' }
  : undefined

return {
  affected: classified.map(c => ({ path: c.path, ref: c.ref, verdict: c.verdict, reasoning: c.reasoning })),
  applied,
  docsRipples, // route through build-user-docs — spec-4-edit never writes product docs
  agentsRipples,
  // anchors included so an autonomous caller can feed re-cuts straight into a scoped
  // build-plan-tree.js run (pages: union of the affected anchors)
  recutsNeedingSkill: recuts.map(c => ({ path: c.path, ref: c.ref, anchors: c.anchors, reasoning: c.reasoning })),
  sync,
  verify,
  note: recuts.length
    ? 're-cut verdicts were NOT applied — route them through plan-0-decompose (split/merge/replace) and republish per SYNC.md'
    : undefined,
}
