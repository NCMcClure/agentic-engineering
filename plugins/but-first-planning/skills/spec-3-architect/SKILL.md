---
name: spec-3-architect
description: Pressure-test the designed architecture before code exists — find shallow modules, leaky seams, and deepening opportunities; render an HTML report, then grill the chosen candidate into spec edits.
disable-model-invocation: true
---

# spec-3-architect — get the architecture right before code

Surface architectural friction in the **designed system** described by the spec
and propose **deepening opportunities** — places where shallow designed modules
should become deep ones. The whole point of doing this at the spec stage is
leverage: a seam moved in a diagram costs a sentence; the same seam moved after
the codebase is built costs a refactor. You are reviewing a design, not a
codebase — there is no code yet, and that's the advantage.

The aim, as always, is testability and AI-navigability: a design where behaviour
concentrates behind small interfaces, change stays local, and the eventual tests
have an obvious surface to sit on.

## Glossary — use these terms exactly

Consistent language is the point. Don't drift into "component," "service,"
"API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (here: a *designed* unit — a subsystem, a step in a pipeline, a participant in a flow).
- **Interface** — everything a caller must know to use the module: types, invariants, ordering, error modes, config. Not just a signature.
- **Implementation** — what sits behind the interface (in a spec, the behaviour the prose/diagram describes).
- **Depth** — leverage at the interface: much behaviour behind a small interface. **Deep** = high leverage; **shallow** = interface nearly as complex as what it hides.
- **Seam** — where an interface lives; the place behaviour can be altered without editing in place. (Not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth. **Locality** — what maintainers get: change, bugs, and knowledge concentrated in one place.

Key principles (full list in [LANGUAGE.md](LANGUAGE.md)):

- **Deletion test** — imagine removing the designed module. If the complexity vanishes, it was a pass-through. If it reappears across N callers, it was earning its keep. A "reappears" is the signal you want.
- **The interface is the test surface.**
- **One adapter = a hypothetical seam. Two adapters = a real one.**

This skill is *informed* by the project's vocabulary: the glossary
(`.plan/spec/reference/glossary.md`) names good seams; the ADRs
(`.plan/spec/reference/adr/`) record decisions you should not re-litigate.

## Process

### 0. Enter plan mode

If not already in plan mode, enter it now: investigate, then propose — nothing
is edited or created until the user approves.

### 1. Explore the design

Read the glossary and any ADRs touching the area first — so your candidates use
the project's names and don't contradict settled decisions. Then read the
relevant spec files (use the Agent tool with `subagent_type=Explore` for a broad
spec, or read directly for a small one). Don't follow rigid heuristics — read for
friction:

- Where does understanding one concept require bouncing between many spec files?
- Where is a designed module **shallow** — its interface nearly as complex as the behaviour it describes?
- Where does a single responsibility leak across several modules with no clear owner (no **locality**)?
- Where do two designed modules leak across their seam — each needing to know the other's internals?
- Which parts of the design would be hard to test through the interface as drawn? Where is there no seam to substitute a dependency?
- Does `repository-layout.md` hold up under the same pressure? Each spec module gets a directory with locality (one place per concern), the AGENTS.md hub rules hold on the drawn tree (no source files beside a hub, no orphan levels — [CODEBASE-LAYOUT.md](../spec-1-specify/CODEBASE-LAYOUT.md)), and a change to one module stays inside one directory. A layout that scatters a concern across directories is a locality finding like any other.

Apply the **deletion test** to anything that smells shallow: would removing this
designed module concentrate the complexity somewhere sensible, or just shuffle it
around?

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory (nothing lands in the
repo). Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (`%TEMP%` on
Windows), and write `<tmpdir>/spec-architecture-review-<timestamp>.html`. Open it
(`xdg-open` / `open` / `start`) and tell the user the absolute path.

The report uses **Tailwind via CDN** for layout and **Mermaid via CDN** for
graph-shaped diagrams, mixed with hand-built SVG/CSS for the more editorial
before/after visuals. Each candidate is a card: **Files** (which spec files),
**Problem** (the friction, one sentence), **Solution** (what the design becomes,
one sentence), **Wins** (in terms of locality and leverage), a **before/after
diagram** as the centrepiece, and a **recommendation badge** (`Strong` /
`Worth exploring` / `Speculative`). End with a **Top recommendation**. Full
scaffold, diagram patterns, and tone in [HTML-REPORT.md](HTML-REPORT.md).

Use glossary vocabulary for the domain and [LANGUAGE.md](LANGUAGE.md) vocabulary
for the architecture. If a candidate contradicts an ADR, surface it only when the
friction is real enough to reopen the decision, and mark it clearly.

Do **not** propose interfaces yet. After writing the file, ask: "Which of these
would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation (the same
posture as `spec-2-grill`: one question at a time, recommended answers). Walk the
design tree — constraints, dependencies, the shape of the deepened module, what
sits behind the seam, what the eventual tests would assert.

Side effects happen **inline**, because this is the moment the design firms up:

- **Editing the spec.** The spec is the source of truth — when the design changes, change the spec files and bump their `updated`/summary frontmatter. Run `python .plan/spec/scripts/verify-spec-tree.py` after edits.
- **Naming a deepened module after a concept not in the glossary?** Add the term — same discipline as `spec-2-grill` ([its CONTEXT-FORMAT.md](../spec-2-grill/CONTEXT-FORMAT.md)).
- **Sharpening a fuzzy term?** Update the glossary right there.
- **A load-bearing decision, or the user rejecting a candidate for a reason future reviews must respect?** Offer an ADR ([its ADR-FORMAT.md](../spec-2-grill/ADR-FORMAT.md)) — framed as "want me to record this so future architecture reviews don't re-suggest it?" Only when it clears the bar.
- **Want to explore alternative interfaces for the deepened module?** Use the parallel-sub-agent pattern in [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).

How to classify a designed module's dependencies (in-process / local-
substitutable / owned-remote / true-external) and what that implies for seams and
testability is in [DEEPENING.md](DEEPENING.md).

## Autonomous mode

For a broad spec (roughly **10+ sections**) or a hands-off architecture pass,
offer the bundled workflow — parallel deepening hunters per section plus
cross-cutting lenses, adversarial deletion-test verification, a judge ranking,
and the HTML report; `apply: 'strong'` additionally applies the confirmed
Strong candidates as spec edits, writing one ADR per applied deepening:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/spec-3-architect/workflows/deepening-review.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/spec-3-architect",
    // optional: context, extraLenses: [{key, prompt}, ...],
    // apply: "strong"  — default "none" (report-only)
  }
})
```

**Converged when** no Strong candidate survives adversarial verification (with
`apply: 'strong'`, re-run after applying; a clean re-run is convergence). What
stays gated: `Worth exploring`/`Speculative` candidates — those go through the
interactive grilling loop, never auto-applied.

## Done when

The chosen candidate's spec edits are applied and `verify-spec-tree.py` exits 0;
its glossary and ADR side effects are recorded; and the remaining report
candidates are explicitly listed to the user as deferred — not silently dropped.

## Hand off

When the design is sharper, point the user back at `spec-2-grill` if new
ambiguity surfaced, or forward to `plan-0-decompose` to decompose the now-solid design
into work. Deepening done here pays off twice: cleaner spec, and an
implementation plan whose issues have obvious seams to build and test against.
