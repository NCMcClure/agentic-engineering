# Golden Rules of Motion Design

## The Five Rules

### 1. Purpose Test
Every animation must serve one of three functions:
- **Orientation** — Helps the user understand where they are or what changed
- **Feedback** — Confirms an action was received or a state changed
- **Continuity** — Maintains spatial/temporal coherence between states

If an animation doesn't serve one of these, remove it.

### 2. The 10th Interaction Test
Play through the interaction 10 times in your head. Does it still feel natural? Or does it feel like the app is showing off?

Animations that pass on first use but fail at 10th use:
- Elaborate page transitions for frequently visited pages
- Bouncy/elastic easing on routine interactions
- Long stagger sequences for content that loads often

### 3. Subtler Exits
Exit animations should be quieter than entrance animations. The user's attention moves forward, not backward. A departing element doesn't need to announce its leaving.

Entrances get the full enter recipe; exits get a smaller, opposite-direction
offset that doesn't mirror the entrance distance. Both value sets are canonical
in [jakub-krehel.md](jakub-krehel.md) ("Exit Animation Subtlety").

### 4. Accessibility is Non-Negotiable
`prefers-reduced-motion` must be respected — not optional, not a nice-to-have,
not something you'll add later. The implementation and the reduced-motion
behavior contract are canonical in [accessibility.md](accessibility.md).

### 5. The Best Animation Goes Unnoticed
> "The best animation is that which goes unnoticed."

If someone watching your presentation comments "nice animation!" on every slide transition, it's too much. The animation should serve the content, not compete with it.

**Exception:** Presentations designed to showcase creative work, where animation IS the content.

## When NOT to Animate

- **Keyboard-initiated navigation** between slides should be near-instant. The user chose to move; don't make them wait.
- **Content that updates frequently** (live data, timers) should never animate each update.
- **Error states** should appear immediately — don't delay critical information behind a transition.
- **Text content** that the user needs to read should not be bouncing or still in motion.

## Duration Guidelines for Presentations

| Element | Duration | Why |
|---------|----------|-----|
| Slide entrance | 400-600ms | Needs to feel deliberate, content-first |
| Content stagger | 60-100ms per item | Fast enough to feel lively, slow enough to be seen |
| Progress bar | 300-350ms | Responsive feedback, shouldn't lag behind scroll |
| Background effects | Continuous | Ambient, never competing for attention |
| Navigation chrome | 150-250ms | Invisible — should feel instant |
| Key reveal moment | 600-1000ms | Can be dramatic if earned by the narrative |
