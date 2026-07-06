# Typography — The Voice of the Piece

Typography is 90% of most communication pieces by area, which makes it 90% of the visual impression. When something "looks amateur but I can't say why," the answer is almost always here: freehand sizes, cramped line-height, lines too long to track, or a second font that adds nothing. The fixes are mechanical. Apply them mechanically.

## The Type Scale: Never Freehand a Size

Pick a ratio, generate a scale, and use only values from it. Which ratio depends on the piece:

| Ratio | Name | Use for |
|-------|------|---------|
| 1.2 | Minor third | Body-heavy work: docs, long-form, dense UI |
| 1.25 | Major third | Balanced editorial, most pitch decks |
| 1.333 | Perfect fourth | Display-led work: landing pages, heroes, posters |

A worked 6-step scale at ratio 1.25, base 16px:

| Step | px | rem | Typical job |
|------|-----|------|-------------|
| -1 | 12.8 | 0.8 | Captions, eyebrows, footnotes |
| 0 | 16 | 1.0 | Body |
| 1 | 20 | 1.25 | Lead paragraph, large body |
| 2 | 25 | 1.563 | H3 / card titles |
| 3 | 31.25 | 1.953 | H2 / section heads |
| 4 | 39 | 2.441 | H1 |
| 5 | 48.8 | 3.052 | Display / hero |

Round to the nearest 0.5px if the fractions bother you — but round *the scale*, then use the rounded scale everywhere. The sin isn't imprecision; it's sizes chosen by eye, one element at a time, drifting into 15/17/19/22px soup.

For display type on responsive pieces, make the top steps fluid instead of breakpointed:

```css
h1 {
  font-size: clamp(2.441rem, 1.5rem + 3.5vw, 3.815rem);
  /* floor = step 4, ceiling = one step past your scale, slope tuned by eye once */
}
```

Body text does not get `clamp()` — it stays at step 0 and the *measure* flexes instead.

## Pairing: One Family Is Enough (Usually)

The cheapest professional look is one well-chosen variable family using weight and size to do all the work. Reach for a second family only when the piece needs a deliberate voice contrast — and then pair by **contrast of structure, not mood**: a serif display over a sans body works because the skeletons differ; two similar sans faces "paired" for vibes just looks like a loading error.

Hard limits:

- **Max 2 families + 1 mono.** The mono is for code and data only.
- Before adding a family, try the cheap pairing first: same family, big jump in weight (300 display / 500 body) or optical size. Modern variable fonts make this contrast nearly free.
- If you can't articulate what the second family *does* that weight contrast couldn't, cut it.

## Rhythm: Line-Height, Measure, Tracking

Three numbers control whether text feels composed or cramped:

| Property | Body | Display | Rule |
|----------|------|---------|------|
| Line-height | 1.5–1.7 | 1.05–1.2 | Inversely proportional to size — big type with body line-height looks like a double-spaced ransom note |
| Measure | 45–75ch | n/a (1–2 lines max) | Under 45ch feels choppy; over 75ch, the eye loses the return sweep |
| Letter-spacing | 0 (never touch) | -0.01em to -0.03em | Tighten display slightly; **never** track body text in either direction |

Set body `max-width` in `ch` units so the measure holds as type scales. All-caps eyebrows are the one exception to the tracking rule: +0.05 to +0.1em, because capitals need air.

## Functional vs Expressive Type

Every text element is one or the other. Know which you're setting:

| | Functional | Expressive |
|---|-----------|------------|
| Job | Deliver information invisibly | Carry emotion, be *seen* |
| Where | Body, labels, captions, data, nav | Title beat, the pivot, the closer |
| Faces | Workhorse sans/serif, tight scale steps | Display cuts, variable-axis extremes |
| Budget | Unlimited | 1 moment per view, 2–3 per piece |

Expressive type is allowed only where the narrative has earned a peak: the title beat, the act-2 pivot, the emotional closer — the same signpost moments that structure the arc in `../narrative/storybeats.md`. An expressive treatment on a body paragraph is a costume at a business meeting.

## Kinetic Typography: The Motion Handoff

When type itself animates, typography hands off to motion — but keeps veto power. The rules:

- **Split-by-word or split-by-char stagger applies to display type only.** Body text never animates per-unit; it enters as a block with the standard recipe, or not at all.
- Word stagger: 40–80ms per word, total sequence under 1200ms. Char stagger: 15–30ms per char, and only on lines of ≤ 30 characters — a full sentence at char-level takes 3 seconds nobody will wait through.
- Under `prefers-reduced-motion`, kinetic type collapses to a single opacity fade of the whole block — the words appear, readable, at once.
- Implementation patterns (stagger variants, `staggerChildren`) live in `../motion-api/animation-patterns.md`.

**The Settled Text Rule: text still in motion cannot be read.** Reading begins when motion ends, so every millisecond of type animation is a millisecond of delay you're charging the audience. Kinetic type on the title beat buys drama worth the price; kinetic type on an explanation is theft.

## When NOT

- **Never animate body text.** Not stagger, not blur-in per line, nothing beyond the block-level enter recipe. The audience came to read it.
- **Max one expressive type moment per view.** Two expressive treatments on screen at once cancel each other — expressiveness is contrast, and contrast against another display flourish is zero.
- Don't reach for kinetic type to rescue weak copy. "Ship faster" animated per-character is still two vague words; fix the line first.
