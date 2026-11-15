# AI-Tells Catalog

What marks prose as machine-written — the patterns that outlive any word list.

**The cluster principle:** the signal is co-occurrence, never the instance.
Humans use em-dashes, triads, and "crucial" too. A draft fails when tells
stack in one passage — a tricolon inside a hedged paragraph of uniform
sentences ending in an empty summary. Hunt clusters; leave lone instances.

## Lexical framework

LLM excess vocabulary is **style words** — verbs and adjectives of emphasis —
never topic words. Test the register, not the word: **would the writer say it
aloud to a colleague?** Specific markers decay once publicized; the categories
persist:

- **Inflated emphasis verbs** (*underscores, boasts, showcases*) → plain
  verbs, or let the fact carry itself.
- **Grandiosity adjectives** (*crucial, intricate, comprehensive, robust*) →
  say what breaks without it, or the specific ("covers X and Y").
- **Abstraction nouns** (*landscape, tapestry, realm, journey*) → the
  concrete noun actually meant.
- **Formal-register swaps** (*leverage, foster, delve into*) → the spoken
  word (*use, build, look at*).
- **Throat-clearing and reflex connectives** (*"it's important to note that
  X"*, sentence-initial *Additionally,/Moreover,*) → just "X"; "And", "Also",
  or nothing.

## Structural and rhetorical patterns

These survive vocabulary sanitizing — the high-signal cluster:

- **Rule-of-three runs.** Triads of adjectives/phrases/clauses, several per
  paragraph. → Lists as long as the content demands.
- **Negative parallelism.** "Not only X but Y", "it's not X, it's Y" as a
  reflex frame. → Assert Y; mention X only if the contrast earns it.
- **Trailing participles.** "..., highlighting the need for...". → End the
  sentence; the consequence gets its own — or the cut.
- **Weasel hedging.** "Experts argue", "may potentially". → Commit ("X is")
  or attribute precisely.
- **Uniform rhythm.** Same-length sentences, same-size paragraphs. → Vary
  deliberately: a short sentence after a long one.
- **Empty conclusory closers.** "By following these steps...". → End on the
  last real point. No bow on top.
- **Formulaic scaffolding.** Intro-that-previews, summary-that-repeats. →
  Order by what the reader needs next; stop when content is done.

## Formatting patterns

- **Bold-header pseudo-lists** ("**Performance**: it is fast.") → real prose
  or a real list, not the hybrid.
- **Over-bulleting.** Bullets for causally connected ideas → paragraphs;
  bullets only for parallel, order-free items.
- **Em-dash clusters.** Weak, model-specific tell — but 4+ per short piece
  still pattern-matches. Match the writer's own habits.
- **Dangling demonstratives.** "This highlights..." with no referent → name
  the thing.

## Caveats

Tells decay once publicized (humans and models co-evolve). Single signals
misfire — no detector is reliable on one document, and human writers trigger
false positives. Deliberate rhetoric overlaps every pattern above. Hence the
cluster test, in both directions.

## Evidence

- Kobak et al., *Science Advances* 2025 — excess style-word fingerprint
  (~66% verbs/14% adjectives) across 15M+ abstracts; topic spikes are nouns.
- Juzek & Ward, COLING 2025 — overrepresentation consistent with RLHF.
- Geng & Trotta 2025 — flagged markers ("delve") decay after publication.
- Wikipedia "Signs of AI writing"; NIST 2026 — no commercial detector
  operationally reliable (62–84%).
