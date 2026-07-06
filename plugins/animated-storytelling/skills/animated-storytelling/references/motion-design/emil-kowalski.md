# Emil Kowalski — Restraint & Speed

Known for Sonner (toast library), Vaul (drawer), and animations.dev. Previously at Vercel, now at Linear. His philosophy centers on animations that serve the user rather than impress them.

## Core Philosophy

> "Animations should be quick, purposeful, and never in the way."

Emil's approach is **frequency-driven**: the more often an interaction occurs, the less animation it should have.

## The Frequency Rule

| Interaction Frequency | Animation Level |
|----------------------|-----------------|
| Every few seconds (typing, scrolling) | None |
| Every few minutes (navigation, toggles) | Minimal (150-200ms) |
| Once per session (onboarding, first action) | Moderate (300-400ms) |
| Rare (achievements, milestones) | Can be delightful |

### For Presentations
- Slide transitions: Every ~30-60 seconds → moderate animation is appropriate
- Keyboard nav (rapid): Could happen every second → keep feedback minimal
- Progress bar updates: Every transition → smooth but fast (300ms)
- Background effects: Continuous → ambient only, never distracting

## Seven Tips (Adapted for Presentations)

### 1. Keep Durations Short
Under 300ms for chrome/UI, 400-600ms for content transitions. Longer only if the narrative demands it (a big reveal moment).

### 2. Use Custom Easing
Never use default `ease` or `linear` for UI motion. Always use:
- `[0.25, 0.1, 0.25, 1]` — Smooth, professional
- Spring with `bounce: 0` — Natural deceleration
- Custom beziers from easings.co for specific feels

### 3. Don't Animate from scale(0)
```tsx
// Bad — feels unnatural
initial={{ scale: 0 }}

// Good — feels like it was always almost there
initial={{ scale: 0.92, opacity: 0 }}
```

### 4. Origin-Aware Motion
Elements should enter/exit from their logical source:
- Dropdown content: `transform-origin: top center`
- Tooltip: Origin from the trigger element
- Slide content: Origin from scroll direction

### 5. Prefer Transitions over Keyframes
CSS transitions can be interrupted mid-animation (when user rapidly navigates). Keyframes cannot — they complete or jump.

For presentations: use Motion's spring transitions (interruptible) rather than CSS @keyframes for navigation-triggered animations.

### 6. Blur as Transition Bridge
When a state change would otherwise feel abrupt, a brief blur (2-4px) masks the imperfection:
```tsx
transition={{ filter: { duration: 0.2 } }}
```

### 7. Clip-Path for Hardware Acceleration
Use `clip-path: inset()` for reveal effects instead of width/height animations:
- Hardware accelerated
- No layout shifts
- No additional DOM elements

```tsx
style={{ clipPath: `inset(0 0 ${100 - progress}% 0)` }}
```

## When Emil's Rules Apply in Presentations

- Navigation chrome (progress bar, slide counter)
- Keyboard interaction feedback
- Rapid navigation between slides
- Any UI that the presenter interacts with frequently during the talk

## When to Override Emil

- Opening slide entrance (this is a once-per-presentation event — can be dramatic)
- Key reveal moments (rare, narratively important)
- Closing slide (the final impression)
- Background ambient effects (these are Jhey's territory)
