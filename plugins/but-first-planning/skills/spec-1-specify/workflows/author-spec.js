export const meta = {
  name: 'spec-1-author-spec',
  description: 'Author a complete spec from a product brief: three parallel outline lenses, a judge synthesis, a per-category planner->author pipeline, a verify loop, and a three-critic audit with a fixer',
  whenToUse: "spec-1-specify's autonomous mode — authoring a whole spec from a brief/PRD (roughly 10+ expected pages) or an explicit headless run; interactive authoring stays the default for growing an existing spec. Args: {root, skillDir, brief, context?, sourcePaths?, languagePosture?, today?}. languagePosture is 'agnostic' | '<lang>:minimal' | '<lang>:code-forward' from ADR-0001 (legacy bare `language` still accepted, treated as minimal). brief is inline text or an absolute file path.",
  phases: [
    { title: 'Orient', detail: 'inventory existing spec categories/files/glossary', model: 'haiku' },
    { title: 'Outline', detail: 'three lens proposals: reader-cost, domain-model, behavior-flows', model: 'opus' },
    { title: 'Judge', detail: 'synthesize the winning outline; map every brief requirement to a file' },
    { title: 'Author', detail: 'per-category content planner -> file author, then root index + glossary', model: 'sonnet' },
    { title: 'Verify', detail: 'verify-spec-tree.py fix loop with escalation', model: 'sonnet' },
    { title: 'Audit', detail: 'coverage / disclosure-discipline / coherence critics + fixer', model: 'opus' },
  ],
}

// MODEL-TIER POLICY:
//   haiku+low        = pure retrieval/discovery, never judgment
//   sonnet           = template-driven authoring, mechanical edits, verify rounds
//   opus+high        = parallel-heavy judgment (lens proposals, per-category planners, critics)
//   omit model+high/max = singleton judgment inheriting the session model (judge, escalation, synthesis)

// ---------- args (may arrive as a JSON string — coerce defensively) ----------
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch { A = null } }
if (!A || !A.root || !A.skillDir || !A.brief) {
  throw new Error('args must be an object: {root: <absolute repo root>, skillDir: <spec-1-specify skill dir>, brief: <inline text or absolute path>, context?, sourcePaths?, languagePosture?, today?}')
}
const ROOT = A.root.replace(/\/$/, '')
const SKILL = A.skillDir.replace(/\/$/, '')
const SPEC = `${ROOT}/.plan/spec`

// ---------- language posture (from ADR-0001) ----------
// "agnostic" | "<lang>:minimal" | "<lang>:code-forward"; legacy bare `language` => minimal.
const rawPosture = A.languagePosture || (A.language ? `${A.language}:minimal` : 'agnostic')
const postureMode = rawPosture === 'agnostic' ? 'agnostic' : (rawPosture.split(':')[1] || 'minimal')
const postureLang = rawPosture === 'agnostic' ? null : rawPosture.split(':')[0]
const POSTURE_NOTE = postureMode === 'agnostic'
  ? 'The spec is language-agnostic: logic as pseudocode/numbered steps, structure/flow/state as mermaid diagrams — no real-language code.'
  : postureMode === 'code-forward'
    ? `The spec targets ${postureLang}, CODE-FORWARD: use idiomatic ${postureLang} snippets liberally alongside mermaid diagrams to illustrate behaviour and contracts — code is a first-class way to pin logic here, not a rare exception. Still reach for diagrams for structure/flow/state.`
    : `The project language is ${postureLang}: keep files language-agnostic by default (pseudocode + mermaid), dropping to a short ${postureLang} snippet only where a concrete one pins a decision better than prose.`

const BRIEF = 'Be terse in every string field — telegraphic phrases, no filler. Your total structured output must stay well under 4000 tokens. Your final message is machine-consumed via the structured-output tool; no prose preamble.'

// brief may be inline text or a file path; agents are told to Read a path themselves.
// Detect by string shape (no fs here): POSIX/Git-Bash (/…, /c/…), Windows drive
// (C:\… , C:/…), and relative (./ ../) paths all count as a path, not inline text.
const briefIsPath = /^([A-Za-z]:[\\/]|[\\/]|\.{0,2}[\\/])/.test(A.brief) && !A.brief.includes('\n')
const BRIEF_SRC = briefIsPath
  ? `the product brief at ${A.brief} (Read it first)`
  : `this product brief:\n<brief>\n${A.brief}\n</brief>`

const DATE_NOTE = A.today
  ? `Today's date is ${A.today}; frontmatter created/updated use its YYYY-MM month.`
  : "Derive today's date yourself via `date +%F`; frontmatter created/updated use its YYYY-MM month."

const CTX = `
CONTEXT. You are part of an authoring pipeline writing the SPECIFICATION at ${SPEC}/ from a
product brief. The spec is a progressive-disclosure markdown knowledge base: a thin root
index.md -> numbered category dirs (NN-slug/) each with a thin index.md -> small single-topic
content files with frontmatter; the reserved reference/ dir holds glossary.md and adr/.
Structure is machine-enforced by python3 ${SPEC}/scripts/verify-spec-tree.py. The authoring
rules live in the spec-1-specify skill at ${SKILL}/ (SKILL.md, PROGRESSIVE-DISCLOSURE.md,
FILE-LAYOUT.md, FRONTMATTER.md, DIAGRAMS.md).
${POSTURE_NOTE}
${Array.isArray(A.sourcePaths) && A.sourcePaths.length ? `SOURCE MATERIAL you may Read and cite: ${A.sourcePaths.join(', ')}` : ''}
${A.context ? `PROJECT NOTES: ${A.context}` : ''}
`

// ---------- Phase 0: orient (pure retrieval) ----------
phase('Orient')
const orient = await agent(
  `List the current contents of the spec at ${SPEC}/: (a) category directory names (the numbered NN-slug dirs, not reference/assets/scripts); (b) every content .md file under them as paths relative to ${SPEC}/ (exclude index.md files); (c) the bold term names in ${SPEC}/reference/glossary.md (empty list if none defined yet); (d) isFresh=true only if there are no category dirs and no content beyond spec-0-init's scaffold stubs. Use ls/glob/grep, not judgment. ${BRIEF}`,
  {
    label: 'orient:inventory', phase: 'Orient', model: 'haiku', effort: 'low',
    schema: {
      type: 'object', required: ['categories', 'existingFiles', 'glossaryTerms', 'isFresh'],
      properties: {
        categories: { type: 'array', items: { type: 'string' } },
        existingFiles: { type: 'array', items: { type: 'string' } },
        glossaryTerms: { type: 'array', items: { type: 'string' } },
        isFresh: { type: 'boolean' },
      },
    },
  }
)
const FRESH = !orient || orient.isFresh !== false
const EXTEND_NOTE = FRESH ? '' : `\nThe spec is NOT empty. Existing categories: ${orient.categories.join(', ') || '(none)'}. Existing content files: ${orient.existingFiles.join(', ') || '(none)'}. Existing glossary terms: ${orient.glossaryTerms.join(', ') || '(none)'}. Your outline must EXTEND this structure, not replace it: keep existing category nums/slugs where the brief's topics fit, add new files/categories only where no home exists, and include existing files in your outline (with their current names) so nothing is orphaned. Never propose deleting existing content.`
log(`Orient: ${FRESH ? 'fresh scaffold' : `existing spec — ${orient.categories.length} categories, ${orient.existingFiles.length} files`}`)

// ---------- Phase 1: outline (three lens proposals + judge) ----------
phase('Outline')
const OUTLINE_SCHEMA = {
  type: 'object',
  required: ['categories', 'glossaryTerms', 'openQuestions', 'rationale'],
  properties: {
    categories: {
      type: 'array',
      items: {
        type: 'object',
        required: ['num', 'slug', 'title', 'indexOneLiner', 'files'],
        properties: {
          num: { type: 'string', description: 'two digits, e.g. "01"' },
          slug: { type: 'string', description: 'kebab-case' },
          title: { type: 'string' },
          indexOneLiner: { type: 'string', description: 'the one line the root index gives this category' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'title', 'summary', 'keyTopics', 'relatesTo'],
              properties: {
                name: { type: 'string', description: 'kebab-case filename ending .md' },
                title: { type: 'string' },
                summary: { type: 'string', description: 'the frontmatter summary text: 1-2 sentences, coverage + current state, under ~200 chars' },
                keyTopics: { type: 'array', items: { type: 'string' }, description: 'the topics this file must pin down' },
                relatesTo: { type: 'array', items: { type: 'string' }, description: 'sideways links: paths relative to this file, e.g. ../02-runtime/event-loop.md' },
              },
            },
          },
        },
      },
    },
    glossaryTerms: {
      type: 'array',
      items: { type: 'object', required: ['term', 'definition'], properties: { term: { type: 'string' }, definition: { type: 'string', description: '1-2 sentences, what the term IS' } } },
    },
    openQuestions: {
      type: 'array',
      items: {
        type: 'object', required: ['topic', 'question', 'whyUnresolvable'],
        properties: { topic: { type: 'string' }, question: { type: 'string' }, whyUnresolvable: { type: 'string', description: 'why the brief cannot answer this' } },
      },
    },
    rationale: { type: 'string' },
  },
}

const LENSES = [
  { key: 'reader-cost', prompt: 'Optimize the five-level progressive-disclosure cost model: a reader must reach the one file they need via root index -> category index -> frontmatter summary with minimal reads. Thin indexes, small single-topic files, summaries that triage perfectly, no category a grab-bag.' },
  { key: 'domain-model', prompt: 'Concepts and vocabulary first: derive the canonical domain terms the glossary will pin, then organize categories and files around those terms — each load-bearing concept gets a home file, relationships between concepts drive relatesTo links, and no file needs a term the glossary will not define.' },
  { key: 'behavior-flows', prompt: 'Organize around end-to-end behaviors and state: files follow the flows a user or component actually traverses (request paths, lifecycles, failure paths), each anchored by the mermaid diagram type that fits per DIAGRAMS.md — sequence for interactions, state for lifecycles, flowchart for pipelines. Mermaid-heavy by design.' },
]

// barrier justified: the judge needs all three lens proposals before it can synthesize.
// Tag each result with its lens key so alignment survives a failed lens (a bare
// .filter(Boolean) then LENSES[i] would misattribute the survivors).
const proposals = (await parallel(LENSES.map(l => () =>
  agent(
    `${CTX}\nYou are a spec-outline architect. Read ${SKILL}/PROGRESSIVE-DISCLOSURE.md and ${SKILL}/FILE-LAYOUT.md for the layout discipline (numbered categories, thin indexes, single-topic files under ~200 lines). Then read ${BRIEF_SRC}\n\nLens: ${l.prompt}\n\nDesign the complete category/file outline for specifying this product. Rules: 3-6 categories; every file one clear topic, scoped to stay under ~200 lines when written; every requirement in the brief maps to a named file; summaries are real frontmatter summaries (coverage + state); glossaryTerms are project-specific domain terms only (no general engineering vocabulary); openQuestions ONLY where the brief genuinely cannot answer — never invent product decisions.${EXTEND_NOTE} ${BRIEF}`,
    { label: `outline:${l.key}`, phase: 'Outline', schema: OUTLINE_SCHEMA, model: 'opus', effort: 'high' }
  ).then(r => r && { key: l.key, outline: r })
))).filter(Boolean)
if (!proposals.length) throw new Error('all outline lens proposals failed')
log(`${proposals.length} outline proposals in — ${proposals.map(p => `${p.key}:${p.outline.categories.length}cat/${p.outline.categories.reduce((n, c) => n + c.files.length, 0)}files`).join(', ')}; judging`)
if (proposals.length < 2) log(`WARNING: only ${proposals.length} lens proposal(s) survived — judge synthesis is effectively single-source`)

// ---------- Phase 2: judge (singleton judgment — inherits the session model) ----------
phase('Judge')
// The judge must actually SEE the proposals it scores — pass their structured
// outlines in-prompt, not just the count/lens names.
const PROPOSALS_BLOCK = proposals.map((p, i) =>
  `### Proposal ${i + 1} — lens: ${p.key}\n${JSON.stringify(p.outline, null, 1)}`).join('\n\n')
const judged = await agent(
  `${CTX}\nYou are the spec-outline judge. Below are ${proposals.length} independent outline proposals (lenses: ${proposals.map(p => p.key).join(', ')}) for the same product brief. Re-read ${BRIEF_SRC}\n\n${PROPOSALS_BLOCK}\n\nScore each proposal on: progressive-disclosure cost (thin indexes, single-topic files), domain-vocabulary coherence, behavior/state coverage, and fidelity to the brief. Synthesize the WINNING outline — best proposal as the base, superior categories/files/terms grafted from the others. Enforce: 3-6 categories; one topic per file, each scoped to stay under ~200 lines; EVERY requirement in the brief maps to a named file (walk the brief requirement by requirement and check); glossaryTerms are the union of the proposals' terms, deduped to one canonical term per concept; openQuestions kept honest — keep only those genuinely unresolvable from the brief, drop any a careful read answers.${EXTEND_NOTE} ${BRIEF}`,
  { label: 'outline:judge', phase: 'Judge', schema: OUTLINE_SCHEMA, effort: 'max' }
)
if (!judged || !judged.categories || !judged.categories.length) throw new Error('outline judge returned no categories')
log(`Outline: ${judged.categories.length} categories — ${judged.categories.map(c => `${c.num}-${c.slug}(${c.files.length}f)`).join(', ')}; ${judged.glossaryTerms.length} glossary terms, ${judged.openQuestions.length} open questions`)

// ---------- Phase 3: author (per-category planner -> file author, pipelined) ----------
const PLAN_SCHEMA = {
  type: 'object',
  required: ['num', 'slug', 'files'],
  properties: {
    num: { type: 'string' },
    slug: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'title', 'frontmatter', 'contentNotes', 'diagrams', 'openQuestionBlocks'],
        properties: {
          name: { type: 'string' },
          title: { type: 'string' },
          frontmatter: {
            type: 'object', required: ['tags', 'summary'],
            properties: { tags: { type: 'array', items: { type: 'string' }, description: '3-7 lowercase-hyphenated terms' }, summary: { type: 'string' } },
          },
          contentNotes: { type: 'string', description: 'authoritative content notes: the decisions, rules, and pseudocode logic the file must pin, in order' },
          diagrams: {
            type: 'array',
            items: { type: 'object', required: ['type', 'what'], properties: { type: { enum: ['flowchart', 'sequence', 'state', 'er'] }, what: { type: 'string', description: 'the one relationship this diagram shows' } } },
          },
          openQuestionBlocks: { type: 'array', items: { type: 'string' }, description: 'exact "**Open question:**" block texts this file must carry' },
        },
      },
    },
  },
}

const perCategory = await pipeline(
  judged.categories,
  // stage 1: content planner per category (parallel-heavy judgment)
  c => agent(
    `${CTX}\nYou are the content planner for spec category ${c.num}-${c.slug} "${c.title}". Read ${SKILL}/DIAGRAMS.md (diagram-type fit, pseudocode style) and ${SKILL}/FRONTMATTER.md (tags/summary contract). Re-read ${BRIEF_SRC}\n\nYOUR CATEGORY (from the judged outline):\n${JSON.stringify(c, null, 1)}\n\nSIBLING CATEGORIES (for relates-to targets only):\n${JSON.stringify(judged.categories.map(x => ({ num: x.num, slug: x.slug, files: x.files.map(f => f.name) })), null, 1)}\n\nOPEN QUESTIONS from the judged outline — each whose topic belongs to this category MUST land in exactly one file's openQuestionBlocks as a "**Open question:** ..." block stating the decision needed and the options; NEVER silently resolve one:\n${JSON.stringify(judged.openQuestions, null, 1)}\n\nFor each file, expand its keyTopics into authoritative contentNotes: the concrete rules and decisions the brief pins (with the pseudocode logic to encode), which mermaid diagram type fits each structural/flow/state relationship per DIAGRAMS.md, the exact frontmatter summary (refine the outline's if the planned content shifted it), and 3-7 tags in the project's own vocabulary. Keep each file's plan scoped to stay under ~200 written lines. ${BRIEF} Cap: total structured output under 8000 tokens.`,
    { label: `plan:${c.num}-${c.slug}`, phase: 'Author', schema: PLAN_SCHEMA, model: 'opus', effort: 'high' }
  ),
  // stage 2: file author (template-driven writing)
  (plan, c) => plan && agent(
    `${CTX}\nYou are a spec-file author. Read ${SKILL}/FRONTMATTER.md and ${SKILL}/FILE-LAYOUT.md FIRST — frontmatter shape (tags, quoted summary, created/updated as YYYY-MM, optional relates-to with paths relative to the file) and index discipline are verifier-enforced. ${DATE_NOTE}\n\nWrite, under ${SPEC}/${c.num}-${c.slug}/:\n(a) index.md — a navigation-only hub: NO frontmatter, a heading, one line per content file below (link + its indexOneLiner-style description), nothing two levels deep, no content;\n(b) every content file from the plan below — frontmatter first (tags, summary, created/updated = current month, relates-to from the outline where the target file will exist), then the body realised from contentNotes: prose + pseudocode + the planned mermaid diagrams (fenced \`mermaid\`, one relationship each), tables for contracts, and every openQuestionBlocks entry verbatim as its own paragraph. Each file self-contained, one topic, under ~200 lines.\n\nOUTLINE ENTRY (for relatesTo and indexOneLiner):\n${JSON.stringify(c, null, 1)}\n\nCONTENT PLAN (authoritative):\n${JSON.stringify(plan, null, 1)}\n\nDo NOT write the root ${SPEC}/index.md or anything under reference/ (other agents own those). Do not run git. Return counts.`,
    {
      label: `author:${c.num}-${c.slug}`, phase: 'Author', model: 'sonnet', effort: 'medium',
      schema: {
        type: 'object', required: ['num', 'filesWritten', 'lines'],
        properties: { num: { type: 'string' }, filesWritten: { type: 'integer' }, lines: { type: 'integer', description: 'total lines written' } },
      },
    }
  )
)
const authored = perCategory.filter(Boolean)
const totalFiles = authored.reduce((n, a) => n + (a.filesWritten || 0), 0)
log(`Authored ${authored.length}/${judged.categories.length} categories, ${totalFiles} files; writing root index + glossary`)

// root index + glossary (needs every category dir on disk — pipeline() completion is that barrier)
const rootDone = await agent(
  `${CTX}\nYou are the root-index and glossary author. ${DATE_NOTE}\n(1) Rewrite ${SPEC}/index.md as a navigation-only root hub per ${SKILL}/FILE-LAYOUT.md: NO frontmatter, one line per category directory on disk (link to NN-slug/index.md + the one-liner below) plus one line for reference/ — never reach two levels deep. One-liners: ${JSON.stringify(judged.categories.map(c => ({ dir: `${c.num}-${c.slug}`, oneLiner: c.indexOneLiner })))}\n(2) Seed ${SPEC}/reference/glossary.md with these judged terms per the glossary format at ${SKILL}/../spec-2-grill/CONTEXT-FORMAT.md (READ IT FIRST — frontmatter kept, "## Language" section, "**Term**:" then definition then "_Avoid_:" aliases where obvious). PRESERVE any pre-existing glossary entries — merge, never drop; on a term collision keep the sharper definition. Bump the glossary's updated field.\nTERMS:\n${JSON.stringify(judged.glossaryTerms, null, 1)}\nDo not run git. ${BRIEF}`,
  {
    label: 'author:root-index+glossary', phase: 'Author', model: 'sonnet', effort: 'medium',
    schema: { type: 'object', required: ['indexWritten', 'glossaryTerms'], properties: { indexWritten: { type: 'boolean' }, glossaryTerms: { type: 'integer', description: 'total terms now in glossary.md' } } },
  }
)

// ---------- Phase 4: verify loop ----------
phase('Verify')
const VERIFY_SCHEMA = { type: 'object', required: ['exit0', 'summary'], properties: { exit0: { type: 'boolean' }, summary: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } } } }
let vres = null
for (let round = 1; round <= 3; round++) {
  vres = await agent(
    `Run: python3 ${SPEC}/scripts/verify-spec-tree.py (cwd ${ROOT}). If it exits 0, report exit0=true and stop. Otherwise fix EVERY reported violation in the spec tree under ${SPEC}/ — missing/invalid frontmatter, non-YYYY-MM dates, unresolved relates-to links, indexes carrying frontmatter or reaching two levels deep, oversized files — per ${SKILL}/FILE-LAYOUT.md and ${SKILL}/FRONTMATTER.md, re-running the verifier until it exits 0 or you are stuck. Never delete a content file to silence the verifier; fix the reference or split the file instead. Do not run git. ${BRIEF}`,
    { label: `verify-fix:round${round}`, phase: 'Verify', model: 'sonnet', effort: 'medium', schema: VERIFY_SCHEMA }
  )
  if (vres && vres.exit0) break
  log(`verify round ${round}: ${vres ? vres.summary : 'agent failed'}`)
}
if (!vres || !vres.exit0) {
  // escalation is singleton judgment — inherits the session model
  vres = await agent(
    `The spec tree at ${SPEC}/ still fails python3 ${SPEC}/scripts/verify-spec-tree.py after 3 fix rounds (last state: ${JSON.stringify(vres && vres.summary)}). Read ${SKILL}/FILE-LAYOUT.md and ${SKILL}/FRONTMATTER.md, diagnose the root cause (often a systematic template deviation), fix it tree-wide, and re-run until exit 0. Never delete a content file to silence the verifier. ${BRIEF}`,
    { label: 'verify-fix:escalate', phase: 'Verify', effort: 'high', schema: VERIFY_SCHEMA }
  )
}
log(`Verifier: ${vres && vres.exit0 ? 'exit 0' : 'STILL FAILING'}`)

// ---------- Phase 5: audit (three critics + fixer) ----------
phase('Audit')
const AUDIT_SCHEMA = {
  type: 'object', required: ['findings'],
  properties: {
    findings: {
      type: 'array', maxItems: 25,
      items: {
        type: 'object', required: ['severity', 'where', 'problem', 'fix'],
        properties: {
          severity: { enum: ['critical', 'major', 'minor'] },
          where: { type: 'string', description: 'spec file path or "outline"' },
          problem: { type: 'string' }, fix: { type: 'string', description: 'concrete instruction for the fixer' },
        },
      },
    },
  },
}
const CRITICS = [
  { key: 'coverage-vs-brief', prompt: `Audit COVERAGE of the spec at ${SPEC}/ against ${BRIEF_SRC}\nWalk the brief requirement by requirement: each must be findable in some content file — grep ${SPEC} for its key terms BEFORE claiming a gap. Also: every open question in this judged ledger must appear as a "**Open question:**" block in some file (grep for it); flag any silently resolved or dropped:\n${JSON.stringify(judged.openQuestions, null, 1)}\n` },
  { key: 'disclosure-discipline', prompt: `Audit PROGRESSIVE-DISCLOSURE DISCIPLINE per ${SKILL}/PROGRESSIVE-DISCLOSURE.md and ${SKILL}/FILE-LAYOUT.md (read both first) across ${SPEC}/: indexes are thin navigation-only hubs (no frontmatter, no content, no index reaching two levels deep); every content file stays under ~200 lines (wc -l them all); frontmatter summaries accurately describe their bodies (sample broadly — open the file, compare); tags are lowercase-hyphenated project vocabulary.\n` },
  { key: 'coherence', prompt: `Audit COHERENCE across ${SPEC}/: no two content files contradict each other (compare files whose topics touch); every glossary term in reference/glossary.md is used consistently by the files that use it (and files don't coin competing synonyms the glossary lists as avoid-aliases); every relates-to link resolves to a real file; category index one-liners still match their children.\n` },
]
// barrier justified: the fixer needs the merged finding set from all three critics
const criticResults = await parallel(CRITICS.map(c => () =>
  agent(`${CTX}\n${c.prompt}\nReport findings with concrete per-file fixes. Empty findings list is acceptable if genuinely clean. ${BRIEF}`,
    { label: `audit:${c.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, model: 'opus', effort: 'high' })
))
const findings = criticResults.filter(Boolean).flatMap(r => r.findings)
log(`Audit: ${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical)`)

let auditFix = null
if (findings.length) {
  auditFix = await agent(
    `${CTX}\nYou are the spec fixer. Apply these audit findings to the tree at ${SPEC}/ (rules: ${SKILL}/FILE-LAYOUT.md, ${SKILL}/FRONTMATTER.md, ${SKILL}/DIAGRAMS.md — match each file's existing conventions, bump updated on meaningful edits, keep indexes thin, never silently resolve an "**Open question:**" block). Skip a finding only if on inspection it is wrong, with a reason. Then run python3 ${SPEC}/scripts/verify-spec-tree.py until exit 0. Do not run git.\n\nFINDINGS:\n${JSON.stringify(findings, null, 1)}\n${BRIEF}`,
    {
      label: 'audit:fixer', phase: 'Audit', model: 'opus', effort: 'high',
      schema: {
        type: 'object', required: ['applied', 'skipped', 'verifierExit0'],
        properties: { applied: { type: 'integer' }, skipped: { type: 'array', items: { type: 'object', required: ['problem', 'reason'], properties: { problem: { type: 'string' }, reason: { type: 'string' } } } }, verifierExit0: { type: 'boolean' } },
      },
    }
  )
}

// verify-still-red after escalation is returned, not thrown: the tree exists and is fixable interactively
return {
  outline: { categories: judged.categories.map(c => ({ num: c.num, slug: c.slug, title: c.title, files: c.files.length })), rationale: judged.rationale },
  counts: { categories: authored.length, files: totalFiles, glossaryTerms: rootDone ? rootDone.glossaryTerms : judged.glossaryTerms.length },
  openQuestions: judged.openQuestions, // the hand-off contract to spec-2-grill / autopilot
  verifier: vres,
  audit: { findings: findings.length, critical: findings.filter(f => f.severity === 'critical').length, fix: auditFix },
}
