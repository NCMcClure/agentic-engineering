# Animation Patterns

Reusable patterns for presentation animations.

## Enter/Exit Pattern

The most common pattern for elements appearing and disappearing:

```tsx
<AnimatePresence mode="wait">
  {isVisible && (
    <motion.div
      key="content"
      initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
      transition={{ type: "spring", duration: 0.45, bounce: 0 }}
    />
  )}
</AnimatePresence>
```

## Stagger Pattern

For multiple items entering sequentially:

```tsx
const container = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 }
  }
}

const item = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: {
    opacity: 1, y: 0, filter: "blur(0px)",
    transition: { type: "spring", duration: 0.45, bounce: 0 }
  }
}

<motion.div variants={container} initial="hidden" whileInView="visible" viewport={{ once: true }}>
  {items.map(i => <motion.div key={i} variants={item} />)}
</motion.div>
```

## Counter Animation

Animated number counting up:

```tsx
import { useMotionValue, useTransform, animate } from "motion/react"
import { useEffect } from "react"

function AnimatedCounter({ target, duration = 1.5 }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, v => Math.round(v))

  useEffect(() => {
    const controls = animate(count, target, { duration })
    return controls.stop
  }, [target])

  return <motion.span>{rounded}</motion.span>
}
```

## TypeWriter Pattern

Character-by-character text reveal:

```tsx
function TypeWriter({ text, speed = 0.03 }) {
  return (
    <motion.span
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: speed } },
        hidden: {}
      }}
    >
      {text.split("").map((char, i) => (
        <motion.span
          key={i}
          variants={{
            hidden: { opacity: 0 },
            visible: { opacity: 1 }
          }}
        >
          {char}
        </motion.span>
      ))}
    </motion.span>
  )
}
```

## Orchestrated Sequences

Multiple animations in coordinated order:

```tsx
const sequence = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      when: "beforeChildren"
    }
  }
}

// Title enters first, then subtitle, then content
<motion.div variants={sequence} initial="hidden" animate="visible">
  <motion.h1 variants={fadeUp}>Title</motion.h1>
  <motion.p variants={fadeUp}>Subtitle</motion.p>
  <motion.div variants={fadeUp}>Content</motion.div>
</motion.div>
```

## Scale Reveal

For dramatic entrances (titles, key numbers):

```tsx
initial={{ opacity: 0, scale: 0.92 }}
animate={{ opacity: 1, scale: 1 }}
transition={{ type: "spring", duration: 0.6, bounce: 0.05 }}
```

Never scale from 0 — always start at 0.85-0.95.

## Crossfade Pattern

For content switching without direction:

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={activeContent}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
  >
    {content}
  </motion.div>
</AnimatePresence>
```

## Continuous Loop

For ambient/background elements:

```tsx
<motion.div
  animate={{
    y: [0, -10, 0],
    opacity: [0.5, 1, 0.5]
  }}
  transition={{
    duration: 3,
    repeat: Infinity,
    ease: "easeInOut"
  }}
/>
```

## Path Drawing (SVG)

For diagrams and illustrations:

```tsx
<motion.path
  d="M10 10 L90 90"
  initial={{ pathLength: 0 }}
  animate={{ pathLength: 1 }}
  transition={{ duration: 1.5, ease: "easeInOut" }}
  stroke="currentColor"
  strokeWidth={2}
  fill="none"
/>
```

## Gesture-Driven (Interactive Slides)

```tsx
<motion.div
  drag="x"
  dragConstraints={{ left: -100, right: 100 }}
  whileDrag={{ scale: 1.02 }}
  onDragEnd={(_, info) => {
    if (info.offset.x > 50) goNext()
    if (info.offset.x < -50) goPrev()
  }}
/>
```
