# AI-Tells Catalog

What marks prose as machine-written, distilled from 2024–2026 detection
research (full corpus with citations: `research/` in the plugin repo). Each
tell is paired with the move that replaces it.

**How to use this list:** the signal is the *cluster*, not the instance.
Humans use em-dashes, tricolons, and "crucial" too. A draft fails when several
tells co-occur — a tricolon inside a hedged paragraph of uniform sentences
ending in an empty summary. Hunt clusters; leave lone instances that read
naturally.

## Lexical tells (highest-evidence, fastest-decaying)

Corpus studies of 15M+ abstracts found LLM-era excess vocabulary is ~66% verbs
and ~14% adjectives — style words, not topic words. The flagged set:

| Reaches for | Write instead |
|---|---|
| delve into, dive into | look at, examine, dig into — or just start doing it |
| tapestry, landscape, realm, journey | the concrete noun you actually mean |
| boasts, showcases | has, shows |
| underscores, highlights (as verbs of emphasis) | shows, means — or let the fact carry itself |
| crucial, pivotal, vital | important — or better, say *what breaks without it* |
| intricate, comprehensive, robust | specific: "three interlocking parts", "covers X, Y" |
| leverage, utilize, harness | use |
| foster, garner, embark | build, get, start |
| testament to, stands as, serves as | is |
| "it's important to note that X" | "X" |
| sentence-initial "Additionally," "Moreover," "Notably," | And, Also, or no connective at all |

Rule of thumb: use the word the writer would say aloud to a colleague.

## Structural and rhetorical tells (the high-signal cluster)

These survive vocabulary sanitizing and are what practiced readers key on:

- **Rule-of-three runs.** Triads of adjectives, phrases, or clauses, several
  per paragraph ("fast, reliable, and scalable"). *Instead:* let lists be the
  length the content demands — one strong item beats three padded ones.
- **Negative parallelism.** "Not only X but Y", "it's not X, it's Y", "X
  rather than Y" as a reflex frame. *Instead:* assert Y directly; mention X
  only if the contrast genuinely earns its place.
- **Trailing participles.** "..., highlighting the need for...",
  "..., underscoring its importance." Appear at 2–5× human rates. *Instead:*
  end the sentence, then say the consequence as its own sentence — or cut it.
- **Weasel hedging.** "Experts argue," "observers have cited," "generally
  speaking," "may potentially." *Instead:* commit ("X is") or attribute
  precisely ("Kobak et al. found").
- **Uniform rhythm.** Same-length sentences, same-size paragraphs — low
  burstiness is a core statistical detector feature. *Instead:* vary
  deliberately. Short sentence after a long one. A one-line paragraph when the
  point deserves it.
- **Empty conclusory closers.** "By following these steps, you can achieve
  better outcomes." *Instead:* end on the last real point. No bow on top.
- **Formulaic scaffolding.** Intro-that-previews, body, summary-that-repeats;
  "Challenges and Future Directions" boilerplate. *Instead:* order by what the
  reader needs next; stop when the content is done.

## Formatting-as-rhetoric tells

- **Inline bold-header pseudo-lists.** "**Performance**: the system is fast."
  repeated as fake prose. *Instead:* if it's a list, make it a list; if it's
  prose, write sentences.
- **Over-bulleting.** Bullets where the ideas connect causally. *Instead:*
  connected reasoning gets paragraphs; bullets are for genuinely parallel,
  order-free items.
- **Em-dash clusters.** Weak, model-specific tell (some models barely use
  them) and being trained out — but 4+ per short piece still pattern-matches.
  Match the writer's own punctuation habits.
- **Dangling demonstratives.** "This highlights...", "These findings..." with
  no clear referent. *Instead:* name the thing: "This drop in latency...".

## Why this list is probabilistic, not proof

- **Tells decay once publicized.** "Delve" plunged in academic text within
  months of being called out (early 2024) while other markers kept rising.
  Humans and models co-evolve; any word list has a shelf life.
- **Single signals misfire.** A 2026 NIST evaluation found no commercial
  detector "operationally reliable" (62–84% accuracy), and detectors falsely
  flag non-native English writers at high rates. Never treat one tell as a
  verdict — in either direction.
- **Legitimate rhetoric overlaps.** Intentional repetition, signposting,
  parallel structure, and em-dashes are sound craft when deployed on purpose.
  The failure mode is *reflexive* use, which is why co-occurrence is the test.
