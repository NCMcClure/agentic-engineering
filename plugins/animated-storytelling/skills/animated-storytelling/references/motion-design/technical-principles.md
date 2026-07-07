# Technical Principles

Implementation details for motion in presentations.

## Easing

### Spring vs Tween

| Type | When to Use | Config |
|------|-------------|--------|
| Spring | Interactive elements, content entrances | the enter recipe's bounce-0 spring — values canonical in [jakub-krehel.md](jakub-krehel.md) |
| Tween | Progress bars, precise timing needs | `duration: 0.35, ease: [0.25, 0.1, 0.25, 1]` |

### Common Easing Curves

```tsx
// Professional, smooth (used in loom presentation chrome)
ease: [0.25, 0.1, 0.25, 1]

// Snappy entrance
ease: [0.16, 1, 0.3, 1]

// Gentle deceleration
ease: [0, 0, 0.2, 1]

// Dramatic (for key moments)
ease: [0.77, 0, 0.175, 1]
```

### Spring Parameters

| Parameter | Effect | Typical Range |
|-----------|--------|---------------|
| `duration` | How long the animation takes | 0.3-0.7s |
| `bounce` | Overshoot amount (0=none) | 0-0.3 |
| `stiffness` | Spring force (higher=faster) | 100-400 |
| `damping` | Resistance (higher=less bounce) | 10-40 |
| `mass` | Weight (higher=more momentum) | 0.5-2 |

Use `duration + bounce` for simple cases. Use `stiffness + damping + mass` for physics-accurate springs.

## GPU-Accelerated Properties

Only these properties are composited on the GPU without triggering layout:
- `transform` (translate, scale, rotate)
- `opacity`
- `filter` (blur, brightness, etc.)

Everything else (width, height, top, left, padding, margin) triggers layout recalculation.

### For Presentations
- Slide entrances: `opacity` + `transform: translateY()` + `filter: blur()`
- Progress bar: `transform: scaleX()` (not width!)
- Background effects: `opacity` + `transform` only
- Never animate `height` for expanding content — use `max-height` with overflow or `transform: scaleY()`

## Performance Patterns

### Batch DOM Reads and Writes
RAF loops should read all measurements first, then write all mutations:

```tsx
function animate() {
  // READ phase
  const scrollTop = container.scrollTop
  const rect = element.getBoundingClientRect()
  
  // WRITE phase
  element.style.transform = `translateY(${calculated}px)`
  
  requestAnimationFrame(animate)
}
```

### Avoid Layout Thrashing
Reading a layout property after writing one forces synchronous layout:

```tsx
// BAD — forces layout between each pair
elements.forEach(el => {
  const height = el.offsetHeight  // READ (forces layout)
  el.style.height = height + 10   // WRITE
})

// GOOD — batch reads, then batch writes
const heights = elements.map(el => el.offsetHeight)
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10
})
```

### will-change Sparingly
```css
.animating { will-change: transform, opacity; }
```

Use ONLY during active animation, not permanently. Permanent `will-change` wastes GPU memory.

## Timing Coordination

### Stagger Math

For N items with total animation window T:
- Per-item duration: `T - (N-1) * stagger_delay`
- Stagger delay: `T / (N * 2)` for a comfortable pace

Example: 5 items, 600ms total window
- Stagger: `600 / (5 * 2) = 60ms`
- Each item duration: `600 - (4 * 60) = 360ms`

### Orchestration Timing

For sequential animations (A → B → C):
```tsx
// A starts immediately
// B starts when A is 70% done (overlap creates flow)
// C starts when B is 70% done

delayB = durationA * 0.7
delayC = delayB + (durationB * 0.7)
```

Full sequential (A completes → B starts) feels robotic. 60-80% overlap feels natural.

## IntersectionObserver Configuration

For slide tracking (matching the website pattern):

```tsx
const observer = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter(e => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
    if (visible) setActiveSlide(visible.target.id)
  },
  { root: scrollContainer, threshold: [0.45, 0.6, 0.75] }
)
```

Multiple thresholds ensure the callback fires at meaningful visibility levels rather than the moment 1px enters view.

## Reduced Motion Implementation

The full implementation — `MotionConfig reducedMotion="user"` at the root,
plus the CSS media-query and RAF-loop escapes it does *not* cover — is
canonical in [accessibility.md](accessibility.md); apply it from there.
