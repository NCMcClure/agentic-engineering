# HTML Report Format

The architectural review is rendered as a single self-contained HTML file in the OS temp directory. Its look is the marketplace's house style, and the skeleton carries all of it: one stylesheet, in the page, that follows the reader's light or dark theme. The only thing fetched is Mermaid, from a CDN, for graph-shaped diagrams; everything else draws offline. Hand-built divs and inline SVG handle the more editorial visuals (mass diagrams, cross-sections). Mix the two, don't lean on Mermaid for everything, it'll start to look generic.

## Scaffold

The report chrome is a shipped asset, copy
[assets/report-skeleton.html](assets/report-skeleton.html) to the temp-dir
output path and fill its `{{…}}` placeholders (each names the section below
that specifies its content). Don't retype the head, the stylesheet, the
mermaid-init or the arrowhead markers, and don't add a stylesheet, a CSS
framework or a font; only the header, candidate cards, and top recommendation
are authored per run, out of the classes below.

## Header

Repo name, date, and a compact legend: hairline box = module, dashed line = seam, orange line = leakage, heavy-outlined box = deep module. No introduction paragraph, straight into the candidates.

```html
<p class="eyebrow">Architecture review</p>
<h1>repo-name</h1>
<p class="meta">2026-01-31 · src/orders · 3 candidates</p>
<ul class="legend">
  <li><span class="key module"></span>module</li>
  <li><span class="key seam"></span>seam</li>
  <li><span class="key leak"></span>leakage</li>
  <li><span class="key deep"></span>deep module</li>
</ul>
```

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the glossary terms ([LANGUAGE.md](LANGUAGE.md)) without ceremony.

Each candidate is one `<article class="candidate" id="…">`:

- **Title**: an `<h2>`, short, names the deepening (e.g. "Collapse the Order intake pipeline").
- **Badge row**: recommendation strength as three weights of ink, never three colours (`Strong` = `badge strong`, filled ink; `Worth exploring` = `badge explore`, an ink outline; `Speculative` = `badge speculative`, a dashed quiet outline), plus a `tag` for the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files**: `<ul class="files">`, one `<li>` per path; the class sets them in the mono face.
- **Before / After diagram**: the centrepiece. `<div class="pair">` holding two `<figure class="fig">`, each with a `<figcaption>` (`Before`, `After`) and one diagram. See patterns below.
- **Problem** and **Solution**: `<dl class="case">`, a `<dt>` and a one-sentence `<dd>` each. What hurts; what changes.
- **Wins**: `<ul class="wins">`, ≤6 words each. e.g. "Tests hit one interface", "Pricing logic stops leaking", "Delete 4 shallow wrappers".
- **ADR callout** (if applicable): one line, `<p class="adr"><b>ADR</b> contradicts ADR-0007, …</p>`. It sits on a tint of the accent, the page's one warning.

```html
<article class="candidate" id="order-intake">
  <header>
    <h2>Collapse the Order intake pipeline</h2>
    <p class="badges"><span class="badge strong">Strong</span><span class="tag">in-process</span></p>
  </header>
  <ul class="files"><li>src/orders/handler.ts</li><li>src/orders/validator.ts</li></ul>
  <div class="pair">
    <figure class="fig"><figcaption>Before</figcaption>…</figure>
    <figure class="fig"><figcaption>After</figcaption>…</figure>
  </div>
  <dl class="case">
    <dt>Problem</dt><dd>…</dd>
    <dt>Solution</dt><dd>…</dd>
  </dl>
  <ul class="wins"><li>Tests hit one interface</li></ul>
</article>
```

No paragraphs of explanation. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Don't make every diagram look the same, variety is part of the point.

Every pattern draws with the same six marks, which work as classes on a `<div>` and on an SVG shape alike:

| Class | Draws | Means |
|---|---|---|
| `mod` | a panel with a quiet hairline | a module |
| `mod deep` | the same panel, a heavier ink outline | a deep module |
| `mod inner` | a sunk, quieter face | what a deep module absorbed |
| `wire` | a thin line with an arrowhead | a call or a dependency |
| `leak` (on a `mod`, a `wire`, a `band`, a `label`) | the orange accent | leakage across a seam |
| `seam` | a dashed hairline | a seam |

Names inside a diagram are small mono capitals: a `<b>` inside a `div.mod`, or `<text class="label">` in SVG (`label quiet` on an inner module, `label leak` beside a leak). A second, quieter line is a `<small>` or `<text class="note">`.

### Mermaid graph (the workhorse for dependencies / call flow)

Use a Mermaid `flowchart` or `graph` when the point is "X calls Y calls Z, and look at the mess." Put the `<pre class="mermaid">` straight inside the figure. The skeleton redraws Mermaid in the house style, so write no `classDef`, no `style` and no `linkStyle`: mark nodes with `class`, and let the arrow say what kind of edge it is. `-->` is a call, `==>` is leakage (it draws in the accent), `-.->` crosses a seam (dashed), and a `subgraph` draws as a seam around its nodes. Sequence diagrams work well for "before: 6 round-trips; after: 1."

```html
<figure class="fig">
  <figcaption>Before</figcaption>
  <pre class="mermaid">
flowchart LR
  A[OrderHandler] --> B[OrderValidator]
  B --> C[OrderRepo]
  C ==>|leak| D[PricingClient]
  </pre>
</figure>
```

In an "after" graph, `class S deep` marks the deep module and `class G inner` what it absorbed.

### Hand-built boxes-and-arrows (when Mermaid's layout fights you)

One inline `<svg viewBox="0 0 440 280">` per figure: modules as `<rect class="mod" rx="8">` with a `<text class="label">`, arrows as `<path class="wire">` that run along the axes (`M150 66 V91 H265 V116`), never at an angle. The arrowhead comes with the class. Reach for this when you want the "after" diagram to be one heavy-outlined deep module with its internals sunk inside it, Mermaid won't render that with the right weight. Give the `<svg>` a `role="img"` and an `aria-label` that says what it shows.

```html
<svg viewBox="0 0 440 280" role="img" aria-label="OrderHandler reads PricingClient past OrderRepo.">
  <rect class="mod" x="20" y="14" width="170" height="52" rx="8" />
  <text class="label" x="34" y="36">OrderHandler</text>
  <text class="note" x="34" y="54">validates, prices, saves</text>
  <rect class="mod" x="250" y="200" width="170" height="52" rx="8" />
  <text class="label" x="264" y="222">PricingClient</text>
  <path class="wire leak" d="M105 66 V226 H250" />
  <text class="label leak" x="117" y="216">reads past the seam</text>
</svg>
```

The same picture can be built from `<div class="mod">` boxes when it is only nesting: a `div.mod` holds a `<div class="stack">` of the modules inside it.

### Cross-section (good for layered shallowness)

`<div class="bands">` stacks horizontal `<div class="band">` rows to show the layers a call passes through. Before: 6 `band thin` rows each doing nothing. After: 1 `band deep`, which takes the height the thin ones had, labelled with the consolidated responsibility. `band leak` marks the layer that leaks.

### Mass diagram (good for "interface as wide as implementation")

`<div class="mass">`, one child `<div>` per module holding two rectangles, `iface` over `impl`, and a `<b>` name. Set each rectangle's height inline (`style="height: 96px"`) from a number you measured. Before: the interface rectangle is nearly as tall as the implementation rectangle (shallow). After: the interface rectangle is short, the implementation rectangle is tall (deep).

### Call-graph collapse

Before: a tree of function calls rendered as nested `mod` boxes. After: the same tree collapsed into one `mod deep` box, with the now-internal calls shown as `mod inner` inside it.

## Style guidance

The stylesheet decides the look; these rules decide how it is used.

- Monochrome first. The page should read in greyscale: neutral faces, ink, hairlines. Depth is a hairline and a face tone, never a shadow, a gradient or a glow.
- One accent, orange, and it means "look here". It belongs to leakage, to an ADR conflict, and to the top recommendation. Nothing else is orange: not a title, not a badge, not a module that is merely important. No green for good, no red for bad, no amber for caution.
- Never write a colour. A diagram that needs one outside the classes uses a token in an inline style (`var(--ink)`, `var(--ink-2)`, `var(--line-2)`, `var(--panel)`, `var(--sunk)`, `var(--accent)`), so it holds in dark mode too. No hex, no named colour, no `rgb()`.
- Type is the system sans for prose and the system mono for labels, file names and numbers. Headings stay close to the body size; hierarchy comes from the small mono capitals, weight and space.
- Keep diagrams ~320px tall so before/after sits comfortably side by side without scrolling, and to five to eight things each: nine is the limit.
- Dim by colour, not by opacity: what the deepening absorbed is `inner`, not a faded copy.
- The only script is the Mermaid ESM import. The report is otherwise static, no app code, no interactivity beyond Mermaid's own rendering.

## Top recommendation section

One larger card. Candidate name, one sentence on why, anchor link to its card. That's it.

```html
<article class="top">
  <p class="eyebrow">Top recommendation</p>
  <h2>Collapse the Order intake pipeline</h2>
  <p>One sentence on why this one first.</p>
  <p><a href="#order-intake">See the card</a></p>
</article>
```

## Tone

Plain English, concise, but the architectural nouns and verbs come straight from [LANGUAGE.md](LANGUAGE.md). Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) · boundary (for seam) · layer, wrapper (for module, when you mean module).

**Phrasings that fit the style:**

- "Order intake module is shallow, interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or *"cleaner code"*, those terms aren't in the glossary and don't earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't in [LANGUAGE.md](LANGUAGE.md), reach for one that is before inventing a new one.
