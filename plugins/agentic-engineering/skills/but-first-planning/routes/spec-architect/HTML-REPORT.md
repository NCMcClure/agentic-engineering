<!-- Canonical copy shared across skills. Referenced by spec-architect, build-improve-architecture, and build-tdd, keep phase-neutral. -->
# HTML report format

The architecture review is a single self-contained HTML file in the OS temp
directory, nothing lands in the repo. Tailwind and Mermaid both come from CDNs.
Mermaid handles graph-shaped diagrams reliably; hand-built divs and inline SVG
handle the more editorial visuals (mass diagrams, cross-sections). Mix the two, don't lean on Mermaid for everything or it starts to look generic.

The report is drawn in the marketplace's house style, and the skeleton
carries all of it: the colour tokens for light and dark, the type, and a small
set of classes. Author with those classes and with Tailwind's layout utilities
(`grid`, `flex`, `gap-*`, `space-y-*`, `p-*`, `mt-*`). Never type a colour:
no hex value, no Tailwind colour utility (`bg-white`, `text-slate-600`,
`border-emerald-600`), no `classDef` or `linkStyle` with a colour in it.

## Framing

The skill that runs this format sets the frame; everything else below is shared.

- **Report title**: "Spec architecture review" when run by spec-architect (you're visualising a design, the before/after diagrams show how designed modules and seams change); "Architecture review" when run by build-improve-architecture (you're visualising a codebase).
- **Files** means spec files at the spec stage, source files on built code.

## Scaffold

The skeleton is a shipped asset, copy
[assets/report-skeleton.html](assets/report-skeleton.html) to the temp-dir
output path and fill its `{{…}}` placeholders (each names the section below
that specifies its content). Don't retype the head/CDN/mermaid-init block or
its `<style>`; only the header, candidate cards, and top recommendation are
authored per run.

What the skeleton gives you:

| Class | What it is |
|-------|------------|
| `card` | a candidate's outer frame: the panel face, a hairline, a 14px radius |
| `card card--top` | the top recommendation: the one thing on the page in the accent |
| `panel` | a frame inside a card, one for each diagram |
| `well` | the sunk face, for an aside |
| `mono-label` | a small mono capital label: an eyebrow, a field name, a legend entry, a module name in a hand-built diagram |
| `chip`, with `chip--strong`, `chip--explore` or `chip--speculative` | a badge |
| `files` | a file list, mono |
| `callout` | a warning line: ink on the accent tint |
| `module`, `seam`, `leak`, `deep`, `faded` | the diagram vocabulary, on a div or an SVG shape (see Diagram patterns) |

The tokens are CSS variables (`--page`, `--panel`, `--sunk`, `--ink`,
`--ink-2`, `--ink-3`, `--line`, `--line-2`, `--rule`, `--accent`,
`--accent-ink`, `--accent-soft`): use one in a `style` attribute where a
hand-built diagram needs a colour no class gives it.

## Header

Project name and date as a `mono-label` eyebrow, the report title as the `h1`,
and a compact legend: outlined box = module, dashed line = seam, orange arrow =
leakage, filled box = deep module. No intro paragraph, straight into candidates.

```html
<p class="mono-label">my-project · 2026-05-14</p>
<h1>Architecture review</h1>
<div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 mono-label">
  <span class="flex items-center gap-2"><span class="module" style="padding:0;width:22px;height:14px"></span>module</span>
  <span class="flex items-center gap-2"><span style="width:22px;border-top:1px dashed var(--line)"></span>seam</span>
  <span class="flex items-center gap-2"><span style="width:22px;border-top:2px solid var(--accent)"></span>leakage</span>
  <span class="flex items-center gap-2"><span class="deep" style="width:22px;height:14px"></span>deep module</span>
</div>
```

## Candidate card

The diagrams carry the weight. Prose is sparse and uses the [LANGUAGE.md](LANGUAGE.md)
terms without ceremony. Each candidate is one `<article class="card">`:

- **Title**: short, names the deepening (e.g. "Collapse the intake pipeline into one module").
- **Badge row**: recommendation strength, plus the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`) as a plain `chip`. Strength reads as weight, not as a traffic light: `Strong` is `chip chip--strong` (filled ink), `Worth exploring` is `chip chip--explore` (an ink outline), `Speculative` is `chip chip--speculative` (a dashed outline).
- **Files**: the files involved (per Framing), in a `<p class="files">`.
- **Before / After diagram**: the centrepiece. Two columns, side by side, each in a `panel` under a `mono-label` ("Before", "After").
- **Problem**: one sentence, under a `mono-label`. What hurts.
- **Solution**: one sentence, under a `mono-label`. What changes.
- **Wins**: bullets, ≤6 words, in glossary terms: "locality: change lands in one module", "leverage: one interface, N callers", "interface shrinks; implementation absorbs the wrappers", "delete 4 shallow wrappers".
- **ADR callout** (if it contradicts a recorded decision), one line in a `<p class="callout">`.

No paragraphs of explanation. If a diagram needs a paragraph to be understood,
redraw the diagram.

## Diagram patterns

Pick what fits; mix them. Don't make every diagram identical.

- **Mermaid graph**: the workhorse for dependencies / flow. "X feeds Y feeds Z, look at the mess." The skeleton themes Mermaid in both light and dark and gives it the vocabulary below, so a diagram never carries a `classDef` or a colour. Sequence diagrams work well for "before: 6 round-trips; after: 1."
- **Hand-built boxes-and-arrows**: when you want the "after" to read as one filled deep module (`deep`) with its now-internal parts dashed and dim inside it (`faded`); Mermaid won't give it the right weight.
- **Cross-section**: stacked horizontal bands for "a call passes through 6 thin layers, each doing nothing" → "one thick band."
- **Mass diagram**: two rectangles per module (interface surface vs implementation). Before: interface nearly as tall as implementation (shallow). After: short interface, tall implementation (deep).
- **Call-graph collapse**: before: a tree of calls as nested boxes; after: the same tree collapsed into one box, the now-internal calls shown faded inside it.

The vocabulary is the same in Mermaid and by hand:

| Meaning | In Mermaid | By hand |
|---------|-----------|---------|
| a module | a plain node | `class="module"` |
| a seam | a dashed link, `A -.- B` or `A -.-> B` | `class="module seam"`, or a dashed line |
| leakage | a thick arrow, `A ==> B`, drawn in the accent; `class A,B leak` outlines the modules it joins | `class="module leak"` |
| a deep module | `A:::deep` | `class="deep"` |
| a module that is now internal | `A:::faded` | `class="module faded"` |

```html
<div class="panel">
  <p class="mono-label mb-3">Before</p>
  <pre class="mermaid">
    flowchart LR
      A[Intake] --> B[Validator]
      B --> C[Store]
      C ==>|leak| D[Pricing]
      class C,D leak
  </pre>
</div>
```

## Style

- Editorial, not corporate-dashboard. Generous whitespace. The page reads in greyscale: the panel face over the page, hairlines, ink.
- One accent, orange, and it means "look here now": leakage, the ADR callout's tint, and the top recommendation. Nothing else is coloured. No green for a strong candidate, no red for a weak one.
- No shadows, no gradients, no rounded-full pills. Radius is 14px on a card, 8px on a panel, 6px on a chip or a module box; the classes already carry these.
- Headings are the system sans at weight 600, close to the body size (the skeleton sets `h1`, `h2`, `h3`). Hierarchy comes from the `mono-label` labels, weight and space, not from big or serif type.
- Keep diagrams ~320px tall so before/after sits side by side without scrolling. A Mermaid flowchart of five or six nodes fits a half-width panel at its own size; past that it is scaled down, so split it or draw it top-down (`flowchart TD`).
- `mono-label` for module labels inside hand-built diagrams, schematic, not UI.
- The report follows the reader's light or dark setting on its own. Open it in both before handing it over: a colour typed by hand is the usual thing that breaks one of them.
- The only scripts are the Tailwind CDN and the Mermaid import. Otherwise static.

## Top recommendation

One larger card, `<div class="card card--top">`: a `mono-label` eyebrow, the candidate name, one sentence on why, anchor link to its card.

## Tone

Plain English, concise, but the architectural nouns and verbs come straight from
[LANGUAGE.md](LANGUAGE.md). Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam,
adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for
interface) · boundary (for seam) · layer, wrapper (for module).

**Phrasings that fit:** "Intake module is shallow, interface nearly matches the
implementation." · "Pricing leaks across the seam." · "Deepen: one interface, one
place to test." · "Two adapters justify the seam: HTTP in prod, in-memory in
tests."

No hedging, no throat-clearing. If a sentence could be a bullet, make it a bullet.
If a bullet could be cut, cut it. Don't write "easier to maintain" or "cleaner
design", name the gain in glossary terms (locality, leverage) instead.
