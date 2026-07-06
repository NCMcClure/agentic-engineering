# Visual Metaphors

Animation patterns that make abstract concepts tangible through convergence, emergence, transformation, and spatial relationships.

## Generalized Patterns

### Convergence

Multiple elements animate toward a central processing point:

```tsx
const CYCLE = 7
const t = (s: number) => s / CYCLE

const inputs = [
  { label: "Source A", color: palette.red, startY: 20 },
  { label: "Source B", color: palette.blue, startY: 60 },
  { label: "Source C", color: palette.purple, startY: 100 },
]

function Convergence() {
  return (
    <svg viewBox="0 0 320 140">
      {inputs.map((input, i) => (
        <motion.g
          key={input.label}
          animate={{
            x: [0, 0, 100, 100],
            opacity: [1, 1, 0, 0],
          }}
          transition={{
            duration: CYCLE,
            times: [0, t(1.4 + i * 0.18), t(2.6 + i * 0.18), 1],
            repeat: Infinity,
            ease: [0.4, 0.05, 0.4, 1],
          }}
        >
          <rect x="10" y={input.startY} width="80" height="20" rx="6"
            fill={palette.bg} stroke={input.color} strokeWidth="2" />
          <text x="50" y={input.startY + 14} textAnchor="middle" fontSize="9">
            {input.label}
          </text>
        </motion.g>
      ))}
    </svg>
  )
}
```

Key: staggered `times` offset per index (`i * 0.18`) creates a cascading arrival.

### Pulsing Processing

A central element that pulses scale + opacity to indicate work happening:

```tsx
{/* Outer aura (pulsing glow) */}
<motion.circle
  cx={centerX} cy={centerY} r={outerRadius}
  fill={palette.accent} opacity="0.22"
  animate={{
    scale: [0.4, 1.0, 1.0, 0.4],
    opacity: [0, 0.3, 0.3, 0],
  }}
  transition={{
    duration: CYCLE,
    times: [0, t(2.4), t(3.6), t(4.0)],
    repeat: Infinity,
    ease: "easeOut",
  }}
  style={{ originX: `${centerX}px`, originY: `${centerY}px` }}
/>

{/* Inner core (scales up) */}
<motion.circle
  cx={centerX} cy={centerY} r={innerRadius}
  fill={palette.bg} stroke={palette.accent} strokeWidth="2.5"
  animate={{
    opacity: [0, 1, 1, 0],
    scale: [0.7, 1, 1, 0.7],
  }}
  transition={{
    duration: CYCLE,
    times: [0, t(2.4), t(3.6), t(4.0)],
    repeat: Infinity,
    ease: "easeOut",
  }}
  style={{ originX: `${centerX}px`, originY: `${centerY}px` }}
/>

{/* Rotating indicator (gear/spinner) */}
<motion.path
  d={gearPath}
  fill="none" stroke={palette.accentDark} strokeWidth="1.6"
  animate={{
    rotate: [0, 360],
    opacity: [0, 1, 1, 0],
  }}
  transition={{
    duration: CYCLE,
    times: [0, t(2.4), t(3.6), t(4.0)],
    repeat: Infinity,
    ease: "linear",
  }}
  style={{ originX: `${centerX}px`, originY: `${centerY}px` }}
/>
```

### Emergence (Post-Processing Output)

After convergence completes, new structured output materializes:

```tsx
{/* Container appears */}
<motion.g
  animate={{ opacity: [0, 0, 1, 1] }}
  transition={{
    duration: CYCLE,
    times: [0, t(3.4), t(4.0), 1],
    repeat: Infinity,
  }}
>
  <rect x="186" y="20" width="124" height="100" rx="10"
    fill={palette.bg} stroke={palette.accent} strokeWidth="2.5" />

  {/* Tree rows appear one by one with stagger */}
  {treeRows.map((row, i) => (
    <motion.g
      key={row.label}
      animate={{ opacity: [0, 0, 1, 1] }}
      transition={{
        duration: CYCLE,
        times: [0, t(4.0 + i * 0.18), t(4.2 + i * 0.18), 1],
        repeat: Infinity,
      }}
    >
      <rect x={rowX} y={rowY - 6} width="3" height="10" rx="1"
        fill={row.color} opacity="0.8" />
      <text x={rowX + 8} y={rowY + 2} fontSize="8">{row.label}</text>
    </motion.g>
  ))}
</motion.g>
```

### Badge Reveals

Small annotation labels that pop in to highlight specific aspects:

```tsx
<motion.rect
  x={badgeX} y={badgeY} width="22" height="8" rx="2"
  fill={palette.yellow} opacity="0.85"
  animate={{ opacity: [0, 0, 0.85, 0.85] }}
  transition={{
    duration: CYCLE,
    times: [0, t(4.4 + i * 0.18), t(4.6 + i * 0.18), 1],
    repeat: Infinity,
  }}
/>
<motion.text
  x={badgeX + 11} y={badgeY + 6}
  textAnchor="middle" fontSize="6" fontWeight="700" fill={palette.bg}
  animate={{ opacity: [0, 0, 1, 1] }}
  transition={{
    duration: CYCLE,
    times: [0, t(4.4 + i * 0.18), t(4.6 + i * 0.18), 1],
    repeat: Infinity,
  }}
>
  +fm
</motion.text>
```

### Radial Layouts

Spokes from a center point for "one core, many outputs":

```tsx
const SPOKES = 5
const CENTER = { x: 160, y: 70 }
const RADIUS = 50

function RadialLayout() {
  return (
    <svg viewBox="0 0 320 140">
      <circle cx={CENTER.x} cy={CENTER.y} r="16"
        fill={palette.accent} opacity="0.8" />
      {Array.from({ length: SPOKES }).map((_, i) => {
        const angle = (i / SPOKES) * Math.PI * 2 - Math.PI / 2
        const endX = CENTER.x + Math.cos(angle) * RADIUS
        const endY = CENTER.y + Math.sin(angle) * RADIUS
        return (
          <g key={i}>
            <motion.line
              x1={CENTER.x} y1={CENTER.y} x2={endX} y2={endY}
              stroke={palette.border} strokeWidth="1.5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
            />
            <motion.circle
              cx={endX} cy={endY} r="8"
              fill={palette.surface} stroke={palette.accent} strokeWidth="2"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, delay: 0.3 + i * 0.1, ease: [0.22, 0.61, 0.36, 1] }}
            />
          </g>
        )
      })}
    </svg>
  )
}
```

### Color-Coded Semantics

Use consistent color assignment across the animation to encode meaning:

```tsx
const semanticColors = {
  input: palette.orange,
  processing: palette.yellow,
  output: palette.green,
  error: palette.red,
  reference: palette.blue,
}
```

Apply the same color to a concept everywhere it appears (border, text, badge, indicator dot). This creates implicit visual grouping without labels.

---

## Production Example: Ingest Animation

Documents flow into a processing pipeline, get transformed, and emerge as structured knowledge. From the loom-agent-website:

```tsx
import { motion } from "motion/react"

const CYCLE = 7
const t = (s: number) => s / CYCLE

const rawDocs = [
  { Icon: PdfIcon, x: 10, y: 16, color: palette.red },
  { Icon: WebIcon, x: 10, y: 56, color: palette.blue },
  { Icon: DocIcon, x: 10, y: 96, color: palette.purple },
]

const treeRows = [
  { label: "index.md", indent: 0, color: palette.orange },
  { label: "concepts/", indent: 1, color: palette.fg2 },
  { label: "lacing.md", indent: 2, color: palette.blue },
  { label: "caching.md", indent: 2, color: palette.green },
]

export function Ingest() {
  return (
    <svg viewBox="0 0 320 140" className="h-full w-full">
      {/* Phase 1: Documents slide toward center */}
      {rawDocs.map(({ Icon, x, y, color }, i) => (
        <motion.g
          key={i}
          animate={{
            x: [0, 0, 100, 100],
            opacity: [1, 1, 0, 0],
          }}
          transition={{
            duration: CYCLE,
            times: [0, t(1.4 + i * 0.18), t(2.6 + i * 0.18), 1],
            repeat: Infinity,
            ease: [0.4, 0.05, 0.4, 1],
          }}
        >
          <Icon x={x} y={y} color={color} />
        </motion.g>
      ))}

      {/* Phase 2: Pulsing processing indicator */}
      <motion.circle
        cx="155" cy="70" r="22"
        fill={palette.orange} opacity="0.22"
        animate={{ scale: [0.4, 1.0, 1.0, 0.4], opacity: [0, 0.3, 0.3, 0] }}
        transition={{
          duration: CYCLE,
          times: [0, t(2.4), t(3.6), t(4.0)],
          repeat: Infinity, ease: "easeOut",
        }}
        style={{ originX: "155px", originY: "70px" }}
      />
      <motion.circle
        cx="155" cy="70" r="12"
        fill={palette.bg} stroke={palette.orange} strokeWidth="2.5"
        animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1, 1, 0.7] }}
        transition={{
          duration: CYCLE,
          times: [0, t(2.4), t(3.6), t(4.0)],
          repeat: Infinity, ease: "easeOut",
        }}
        style={{ originX: "155px", originY: "70px" }}
      />
      {/* Rotating gear */}
      <motion.path
        d="M 149 66 a 6 6 0 1 0 12 0 a 6 6 0 1 0 -12 0"
        fill="none" stroke={palette.orangeDark} strokeWidth="1.6"
        animate={{ rotate: [0, 360], opacity: [0, 1, 1, 0] }}
        transition={{
          duration: CYCLE,
          times: [0, t(2.4), t(3.6), t(4.0)],
          repeat: Infinity, ease: "linear",
        }}
        style={{ originX: "155px", originY: "70px" }}
      />

      {/* Phase 3: Output structure materializes */}
      <motion.g
        animate={{ opacity: [0, 0, 1, 1] }}
        transition={{
          duration: CYCLE,
          times: [0, t(3.4), t(4.0), 1],
          repeat: Infinity,
        }}
      >
        {/* Folder container */}
        <rect x="186" y="20" width="124" height="100" rx="10"
          fill={palette.bg} stroke={palette.orange} strokeWidth="2.5" />
        <path
          d="M 190 30 l 6 -4 h 8 l 4 4 h 14 a 2 2 0 0 1 2 2 v 6 a 2 2 0 0 1 -2 2 h -32 z"
          fill={palette.orange} opacity="0.65"
        />

        {/* File tree rows with staggered appearance + "+fm" badges */}
        {treeRows.map((row, i) => {
          const rowY = 50 + i * 16
          const rowX = 196 + row.indent * 12
          return (
            <motion.g
              key={row.label}
              animate={{ opacity: [0, 0, 1, 1] }}
              transition={{
                duration: CYCLE,
                times: [0, t(4.0 + i * 0.18), t(4.2 + i * 0.18), 1],
                repeat: Infinity,
              }}
            >
              <rect x={rowX} y={rowY - 6} width="3" height="10" rx="1"
                fill={row.color} opacity="0.8" />
              <text x={rowX + 8} y={rowY + 2} fontSize="8" fill={palette.fg}>
                {row.label}
              </text>
              {/* "+fm" badge */}
              <motion.rect
                x={rowX + 64} y={rowY - 5} width="22" height="8" rx="2"
                fill={palette.yellow} opacity="0.85"
                animate={{ opacity: [0, 0, 0.85, 0.85] }}
                transition={{
                  duration: CYCLE,
                  times: [0, t(4.4 + i * 0.18), t(4.6 + i * 0.18), 1],
                  repeat: Infinity,
                }}
              />
              <motion.text
                x={rowX + 75} y={rowY + 1}
                textAnchor="middle" fontSize="6" fontWeight="700" fill={palette.bg}
                animate={{ opacity: [0, 0, 1, 1] }}
                transition={{
                  duration: CYCLE,
                  times: [0, t(4.4 + i * 0.18), t(4.6 + i * 0.18), 1],
                  repeat: Infinity,
                }}
              >
                +fm
              </motion.text>
            </motion.g>
          )
        })}
      </motion.g>
    </svg>
  )
}
```

### Key Techniques

- **Three-act structure** within a single cycle: inputs converge → processing pulses → output emerges
- **`times` arrays** choreograph the three acts so they don't overlap
- **Per-element stagger** via index offset creates natural cascading without explicit stagger containers
- **Color continuity** — document colors (red/blue/purple) establish "raw input" while orange marks "processed output"
- **Badge annotations** ("+fm") add explanatory detail that appears AFTER the structural element, drawing attention to what changed
- **Rotating gear** as a universal "processing" metaphor — simple but instantly recognizable
- **`style={{ originX, originY }}`** ensures scale animations pulse from center rather than top-left corner of the element's bounding box
