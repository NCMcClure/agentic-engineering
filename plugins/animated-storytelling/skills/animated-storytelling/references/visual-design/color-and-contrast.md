# Color & Contrast — Every Color Has a Job

Color problems present as taste problems ("it looks joyless," "it looks garish") but they're almost always role problems: colors chosen as swatches instead of assigned as jobs. Fix the roles and the taste follows.

## Roles, Not Swatches

Before picking a single hue, define the jobs. Every piece needs exactly these:

| Role | Job | Typical share of screen |
|------|-----|------------------------|
| **Background** | The canvas; sets light/dark temperament | ~60% |
| **Surface** | Cards, panels — one step off background | with background, most of the 60% |
| **Text** | Primary reading color | ~30% (with muted) |
| **Muted** | Secondary text, captions, borders | part of the 30% |
| **Accent** | The pointer — where the story is right now | ~10%, often less |
| **Semantic** | Success / warning / error, and nothing else | as events require |

That's the 60-30-10 discipline: 60% background/surface, 30% text tones, 10% accent. When a view feels garish, measure it — garish is almost always the accent share creeping past 20%.

**ONE accent.** The accent is the narrative pointer: it goes wherever the story currently is — the key stat, the CTA, the highlighted line of code, the delta in the before/after. Two accents means two pointers, and two pointers point nowhere. If you think you need a second accent, what you actually need is to decide which moment matters more.

## The Worked Recipe: Tinted Neutrals + One Ramp

Pure gray (`#808080`, `hsl(0 0% x%)`) reads as lifeless — the "readable but joyless" symptom. Instead, tint every neutral toward your accent hue (or its complement) at 5–15% saturation. The audience won't consciously see the tint; they'll see "warm" or "cool" and read it as intentional.

A 9-step ramp, accent hue 240 (blue), in HSL (OKLCH works the same way with better perceptual spacing — prefer it where supported):

| Step | HSL | Job |
|------|-----|-----|
| 50 | 240 20% 98% | Light-mode background |
| 100 | 240 15% 94% | Light surface, hover fills |
| 200 | 240 12% 86% | Borders, dividers |
| 300 | 240 10% 70% | Disabled text, placeholders |
| 400 | 240 8% 55% | Muted text (check contrast!) |
| 500 | 240 10% 42% | Secondary text |
| 700 | 240 15% 24% | Primary text (light mode), dark surface |
| 800 | 240 18% 14% | Dark-mode surface |
| 900 | 240 20% 8% | Dark-mode background, max-contrast text |

Note the saturation curve: higher at the extremes, lower in the middle — mid-tones carry tint poorly and go muddy if you push them. Build the accent as its own small ramp (400/500/600) so you have hover and active states that aren't `opacity: 0.8` hacks.

## Contrast Is Not Negotiable

The same posture as `../motion-design/accessibility.md` takes on reduced motion: this is not optional, not a nice-to-have, not something you'll fix later.

| Text | Minimum ratio |
|------|---------------|
| Body text (< 24px, or < 18.66px bold) | **4.5:1** |
| Large text (≥ 24px, or ≥ 18.66px bold) | **3:1** |
| UI components, focus indicators, chart strokes | **3:1** |

The place it always fails: muted text on a surface. Step 400 in the ramp above sits near the 4.5:1 line on white — check it against *surface*, not background, because that's where captions actually live. Check the accent-on-background pairing too; saturated accents around 50% lightness routinely fail as text.

Contrast is also a hierarchy instrument, which gives you a second reason to be stingy with it: **reserve maximum contrast for the focal point.** If every text block sits at 15:1, the ratio stops ranking anything. Body at a comfortable 8–12:1, muted at 4.5–6:1, and the one number that matters at full 16:1+ — now contrast is doing hierarchy work for free.

## Dark & Light: Re-map, Don't Invert

Inverting a light palette produces a broken dark one — pure-white text vibrates on pure black, shadows disappear, and the accent glows radioactive. Instead, re-assign the roles:

- Background takes step 900, surface 800, text ~step 100 (never pure white on pure black; 90–95% lightness on 8–10% background).
- **Elevation flips from shadows to lightness.** In dark mode, a raised card is a *lighter* surface (800 over 900), not a darker shadow — shadows have nothing to fall on.
- **Desaturate accents 10–20% in dark mode.** A saturated hue that sang on white will bloom and halo on dark; pull it down and nudge lightness up to hold the 4.5:1 ratio.
- Re-run every contrast check. Dark mode passes nothing by inheritance.

## Color as a Narrative Device

Because color is assigned by role, you can re-cast the roles as the story turns — this is the visual lever shaking hands with the narrative arc (see `../narrative/from-story-to-medium.md` for how acts map to sections):

- **Palette shift per act.** Cool, muted tones through the problem act; warmth and saturation arriving with the resolution. Keep the shift subtle — a 10–20° hue drift in the background tint and a warmer accent, not a full re-skin. The audience should feel the weather change, not see the set swap.
- **Semantic consistency is a contract.** If red meant "the old way's cost" on slide 3, red cannot decorate a happy chart on slide 9. One meaning per semantic color for the piece's whole runtime.
- **Before/after lives on color contrast.** Render the "before" in muted neutrals — honestly drab, not cartoonishly broken — and let the "after" own the accent. The palette delta *is* the argument, and it's cheaper and more credible than any animation.

## When NOT

- **A second accent within a view.** Two pointers, no direction. If two elements both feel accent-worthy, the hierarchy upstream is undecided — fix that instead.
- **Decorating with semantic colors.** Green bullets because green is friendly, red headings for energy — you're spending trust words as filler. Semantic colors fire only on semantic events.
- **Gradients as default.** A gradient is an event — a hero, a showcase moment, the closer — not a body-copy background or an every-card treatment. When each surface has its own gradient, the piece reads as a template, and the one moment that deserved the flourish has nothing left to wear.
