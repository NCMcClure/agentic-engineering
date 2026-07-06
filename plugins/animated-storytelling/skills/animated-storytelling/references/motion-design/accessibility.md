# Motion Accessibility

## The Non-Negotiable Rule

Every presentation must respect `prefers-reduced-motion`. This is not optional.

```tsx
<MotionConfig reducedMotion="user">
  {/* Entire presentation */}
</MotionConfig>
```

## What `reducedMotion="user"` Does

When the OS accessibility setting is active:
- All `motion.*` animations are suppressed (instant state changes)
- `whileInView` still fires but without animation
- Layout changes happen instantly
- Only `opacity` transitions remain (for visibility semantics)

## What You Must Handle Manually

`MotionConfig` covers Motion library animations but not:
- CSS `@keyframes` animations — Add media query:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .animated { animation: none; }
  }
  ```
- CSS transitions — Reduce duration:
  ```css
  @media (prefers-reduced-motion: reduce) {
    * { transition-duration: 0.01ms !important; }
  }
  ```
- RequestAnimationFrame loops — Check and disable:
  ```tsx
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (prefersReduced) return // Skip RAF loop
  ```

## Vestibular Triggers to Avoid

These can cause physical discomfort (nausea, dizziness) in sensitive users:

| Trigger | Why It's Harmful | Alternative |
|---------|-----------------|-------------|
| Parallax scrolling | Conflicting motion cues | Static or opacity-only |
| Large-scale zooming | Spatial disorientation | Cross-fade |
| Auto-playing video backgrounds | Unexpected motion | Still image + play button |
| Rapid strobing/flashing | Photosensitive seizures | Gradual transitions |
| Spinning/rotating elements | Vestibular confusion | Static or fade |

## Safe Alternatives for Reduced Motion

| Full Motion Effect | Reduced Motion Alternative |
|-------------------|---------------------------|
| Slide from bottom + fade | Instant opacity crossfade |
| Staggered bullet points | All visible at once |
| Counter animation (0→100) | Show final number |
| Background ambient motion | Static gradient |
| Progress bar animation | Instant width update |
| TypeWriter effect | Show complete text |

## Testing

1. **macOS:** System Settings → Accessibility → Display → Reduce motion
2. **Chrome DevTools:** Rendering tab → Emulate CSS media feature `prefers-reduced-motion: reduce`
3. **Firefox:** about:config → `ui.prefersReducedMotion` → 1

Always test the full presentation with reduced motion enabled. It should still be perfectly usable and understandable — just without animation.

## ARIA Considerations for Presentations

- Slides are `<section>` elements with `aria-labelledby` pointing to their title
- Navigation doesn't trap focus — natural tab order is maintained
- Progress updates don't use `aria-live` (too noisy) — visual-only feedback is appropriate for a presentation context
- Keyboard navigation supports all standard patterns (arrows, page keys, home/end)
