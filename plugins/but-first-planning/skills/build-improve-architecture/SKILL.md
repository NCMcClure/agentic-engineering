---
name: build-improve-architecture
description: Find deepening refactors in built code — shallow modules, missing seams — fed back into glossary and ADRs. Use for architecture improvement asks: "find refactors", "where are the seams".
---

# Improve Architecture (built code)

Surface architectural friction in the **actual codebase** and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

This is the *post-code* counterpart to `spec-3-architect`: that skill pressure-tests the designed system in the spec before code exists; this one works on what's been built. When a refactor reveals a decision worth keeping — or worth changing — it flows back into the same glossary and ADRs the planning skills maintain (see [§ Close the loop](#close-the-loop)).

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in the canonical [LANGUAGE.md](../spec-3-architect/LANGUAGE.md) (shared with `spec-3-architect`).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](../spec-3-architect/LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language gives names to good seams; ADRs record decisions the skill should not re-litigate.

## Process

### 1. Explore

Read the project's domain glossary and any ADRs in the area you're touching first. If a `.plan/` workspace exists, those are `.plan/spec/reference/glossary.md` and `.plan/spec/reference/adr/`. The spec under `.plan/spec/` is the design intent — read the sections that cover the area you're refactoring, so you can tell a genuine deepening from a drift away from what was specified.

Then use the Agent tool with `subagent_type=Explore` to walk the codebase. Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates as an HTML report

Write a self-contained HTML file to the OS temp directory so nothing lands in the repo. Resolve the temp dir from `$TMPDIR`, falling back to `/tmp` (or `%TEMP%` on Windows), and write to `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Open it for the user — `xdg-open <path>` on Linux, `open <path>` on macOS, `start <path>` on Windows — and tell them the absolute path.

The report uses **Tailwind via CDN** for layout and styling, and **Mermaid via CDN** for diagrams where a graph/flow/sequence reliably communicates the structure. Mix Mermaid with hand-crafted CSS/SVG visuals — use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences), and hand-built divs/SVG when you want something more editorial (mass diagrams, cross-sections, collapse animations). Each candidate gets a **before/after visualisation**. Be visual.

For each candidate, render a card with:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and how tests would improve
- **Before / After diagram** — side-by-side, custom-drawn, illustrating the shallowness and the deepening
- **Recommendation strength** — one of `Strong`, `Worth exploring`, `Speculative`, rendered as a badge

End the report with a **Top recommendation** section: which candidate you'd tackle first and why.

**Use the project glossary's vocabulary for the domain, and [LANGUAGE.md](../spec-3-architect/LANGUAGE.md) vocabulary for the architecture.** If the glossary (`.plan/spec/reference/glossary.md`) defines "Order," talk about "the Order intake module" — not "the FooBarHandler," and not "the Order service."

**ADR conflicts**: if a candidate contradicts an existing ADR, only surface it when the friction is real enough to warrant revisiting the ADR. Mark it clearly in the card (e.g. a warning callout: _"contradicts ADR-0007 — but worth reopening because…"_). Don't list every theoretical refactor an ADR forbids.

See the canonical [HTML-REPORT.md](../spec-3-architect/HTML-REPORT.md) for the full HTML scaffold, diagram patterns, and styling guidance — its Framing section says how this skill's report differs from spec-3's (title "Architecture review"; Files means source files).

Do NOT propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation. Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in the glossary?** Add the term to `.plan/spec/reference/glossary.md` — same discipline as `spec-2-grill` (see [its CONTEXT-FORMAT.md](../spec-2-grill/CONTEXT-FORMAT.md)). Create the file lazily if no `.plan/` workspace exists.
- **Sharpening a fuzzy term during the conversation?** Update the glossary right there.
- **User rejects the candidate with a load-bearing reason?** Offer an ADR in `.plan/spec/reference/adr/`, framed as: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Only offer when the reason would actually be needed by a future explorer to avoid re-suggesting the same thing — skip ephemeral reasons ("not worth it right now") and self-evident ones. See [ADR-FORMAT.md](../spec-2-grill/ADR-FORMAT.md).
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](../spec-3-architect/INTERFACE-DESIGN.md).

## Close the loop

A refactor on built code often teaches you something the spec didn't capture. Feed it back so the design and the code stay honest with each other:

- **The deepening sharpened or added a concept** → it's already in the glossary (above). Good.
- **The deepening changed a load-bearing decision** → record or supersede an ADR in `.plan/spec/reference/adr/`.
- **The code, as built, has drifted from what the spec describes** → don't silently "fix" the spec here. Surface the drift and route it through `spec-4-edit`, which updates the affected spec files and the plan issues anchored to them. That keeps spec ↔ plan ↔ code in agreement instead of letting three sources of truth diverge.

## Autonomous mode

For a codebase too big for one Explore pass (roughly **20+ modules**), offer
the bundled workflow — per-area deepening hunters plus churn/test-surface/
pass-through lenses, adversarial verification, a judge ranking, and the HTML
report:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/build-improve-architecture/workflows/deepening-hunt.js",
  args: {
    root: "<absolute repo root>",
    skillDir: "${CLAUDE_PLUGIN_ROOT}/skills/build-improve-architecture",
    // optional: areas: ["src/core", ...] (else auto-discovered with churn signals),
    // context, extraLenses: [{key, prompt}, ...]
  }
})
```

**Report-only by design** — applying a refactor is test-gated implementation
work that goes through the grilling loop and `build-tdd`, never auto-applied.
The returned `specDriftFindings` route to `spec-4-edit`. **Converged when** the
ranked report is delivered; open it and walk the user through the top
recommendation.

## Done when

The report is written and opened, and its absolute path told to the user; the
chosen candidate ends in exactly one terminal state — refactor applied with
tests green, or user rejection with an ADR offered and decided; and any spec
drift found is routed to `spec-4-edit` or explicitly declined by the user.
