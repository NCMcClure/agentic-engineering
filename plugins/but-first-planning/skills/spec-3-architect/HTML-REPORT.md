<!-- Canonical copy shared across skills. Referenced by spec-3-architect, build-improve-architecture, and build-tdd — keep phase-neutral. -->
# HTML report format

The architecture review is a single self-contained HTML file in the OS temp
directory — nothing lands in the repo. Tailwind and Mermaid both come from CDNs.
Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG
handle the more editorial visuals (mass diagrams, cross-sections). Mix the two —
don't lean on Mermaid for everything or it starts to look generic.

## Framing

The skill that runs this format sets the frame; everything else below is shared.

- **Report title**: "Spec architecture review" when run by spec-3-architect (you're visualising a design — the before/after diagrams show how designed modules and seams change); "Architecture review" when run by build-improve-architecture (you're visualising a codebase).
- **Files** means spec files at the spec stage, source files on built code.

## Scaffold

The skeleton is a shipped asset — copy
[assets/report-skeleton.html](assets/report-skeleton.html) to the temp-dir
output path and fill its `{{…}}` placeholders (each names the section below
that specifies its content). Don't retype the head/CDN/mermaid-init block; only
the header, candidate cards, and top recommendation are authored per run.

## Header

Project name, date, and a compact legend: solid box = module, dashed line = seam,
red arrow = leakage, thick dark box = deep module. No intro paragraph — straight
into candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse and uses the [LANGUAGE.md](LANGUAGE.md)
terms without ceremony. Each candidate is one `<article>`:

- **Title** — short, names the deepening (e.g. "Collapse the intake pipeline into one module").
- **Badge row** — recommendation strength (`Strong` = emerald, `Worth exploring` = amber, `Speculative` = slate), plus the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files** — the files involved (per Framing), `font-mono text-sm`.
- **Before / After diagram** — the centrepiece. Two columns, side by side.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤6 words, in glossary terms: "locality: change lands in one module", "leverage: one interface, N callers", "interface shrinks; implementation absorbs the wrappers", "delete 4 shallow wrappers".
- **ADR callout** (if it contradicts a recorded decision) — one line in an amber box.

No paragraphs of explanation. If a diagram needs a paragraph to be understood,
redraw the diagram.

## Diagram patterns

Pick what fits; mix them. Don't make every diagram identical.

- **Mermaid graph** — the workhorse for dependencies / flow. "X feeds Y feeds Z, look at the mess." Style leakage edges red and the deep module dark with `classDef`. Sequence diagrams work well for "before: 6 round-trips; after: 1."
- **Hand-built boxes-and-arrows** — when you want the "after" to read as one thick-bordered deep module with greyed-out internals (Mermaid won't give it the right weight).
- **Cross-section** — stacked horizontal bands for "a call passes through 6 thin layers, each doing nothing" → "one thick band."
- **Mass diagram** — two rectangles per module (interface surface vs implementation). Before: interface nearly as tall as implementation (shallow). After: short interface, tall implementation (deep).
- **Call-graph collapse** — before: a tree of calls as nested boxes; after: the same tree collapsed into one box, the now-internal calls shown faded inside it.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[Intake] --> B[Validator]
      B --> C[Store]
      C -.leak.-> D[Pricing]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

## Style

- Editorial, not corporate-dashboard. Generous whitespace. `font-serif` headings work well with stone/slate.
- Colour sparingly: one accent (emerald or indigo) plus red for leakage, amber for warnings.
- Keep diagrams ~320px tall so before/after sits side by side without scrolling.
- `text-xs uppercase tracking-wider` for module labels inside diagrams — schematic, not UI.
- The only scripts are the Tailwind CDN and the Mermaid import. Otherwise static.

## Top recommendation

One larger card: candidate name, one sentence on why, anchor link to its card.

## Tone

Plain English, concise — but the architectural nouns and verbs come straight from
[LANGUAGE.md](LANGUAGE.md). Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam,
adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for
interface) · boundary (for seam) · layer, wrapper (for module).

**Phrasings that fit:** "Intake module is shallow — interface nearly matches the
implementation." · "Pricing leaks across the seam." · "Deepen: one interface, one
place to test." · "Two adapters justify the seam: HTTP in prod, in-memory in
tests."

No hedging, no throat-clearing. If a sentence could be a bullet, make it a bullet.
If a bullet could be cut, cut it. Don't write "easier to maintain" or "cleaner
design" — name the gain in glossary terms (locality, leverage) instead.
