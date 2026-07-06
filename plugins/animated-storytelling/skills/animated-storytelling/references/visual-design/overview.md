# Visual Design — The Credibility Layer

Why this section exists: motion on a weak layout is polish on sand, and narrative without hierarchy is a speech nobody can skim. Visual design is what makes the audience trust the piece in the first 3 seconds — before they've read a word, before a single animation fires, they've already decided whether this looks like the work of someone who knows what they're doing. Get this layer right and the narrative gets a fair hearing and the motion reads as craft. Get it wrong and everything downstream is fighting uphill.

## The Three Levers, Properly Divided

Each lever answers a different question. Don't let one do another's job:

| Lever | Question it answers | Failure mode when missing |
|-------|--------------------|--------------------------|
| **Narrative** | What order do things land in? | Logically complete but unpersuasive |
| **Visual** | What matters on screen *right now*? | Everything shouts, nothing lands |
| **Motion** | How does change *feel*? | Correct but lifeless — or worse, garish |

Narrative decides the sequence. Visual decides the emphasis within each moment. Motion decides the texture of the transitions between them. A piece that's strong on two levers and weak on the third still reads as amateur — audiences can't name which lever failed, but they feel it instantly.

## Routing: Which Deep File Do You Need?

Diagnose by symptom, then go deep:

| Problem you're seeing | Read |
|----------------------|------|
| "Everything looks equally important" | [hierarchy-and-composition.md](hierarchy-and-composition.md) |
| "It looks amateur but I can't say why" | [typography.md](typography.md) |
| "Readable but joyless" — or garish | [color-and-contrast.md](color-and-contrast.md) |
| "It's pretty but it doesn't sell" | [persuasion-and-craft.md](persuasion-and-craft.md) |

If more than one applies, fix them in that table's order: hierarchy first, then type, then color, then persuasion polish. Hierarchy problems masquerade as color problems constantly — don't reach for a new palette when the real issue is that six elements are competing for the same visual rank.

## The Three-Lever Handshake

Visual decisions are not made in isolation. Every significant visual choice should shake hands with a narrative beat and a motion choice:

| Visual decision | Narrative counterpart | Motion counterpart |
|----------------|----------------------|-------------------|
| Layout shift (new grid, new density) | Signpost / act break | Layout animation or deliberate hard cut |
| The single focal point of a view | The beat's core claim | Earns the showcase animation — nothing else does |
| Generous whitespace around a group | A beat given room to breathe | Makes stagger legible (items need space to arrive *into*) |
| Maximum contrast placement | The line the audience must remember | Slower, more deliberate entrance (600ms+) |
| Accent color placement | Where the story currently *is* | Accent elements may move; neutrals stay still |

The rule underneath the table: **motion amplifies whatever the visual hierarchy already says.** Animate the focal point and the moment sings. Animate a background element and you've promoted noise to signal. This is why the visual system must exist *before* motion decisions — see the workflow ordering in `../motion-design/golden-rules.md`'s Purpose Test: an animation can't serve orientation if the layout hasn't established what to orient toward.

## Where Visual Sits in the Workflow

If you're building from scratch: narrative skeleton → visual system → motion. Spend 15 minutes establishing a type scale, a spacing scale, palette roles, and a grid before producing any screen. Every later decision then becomes a lookup instead of a judgment call, and consistency — the thing audiences read as competence — comes free.

If you're repairing an existing piece: run the audit below first. If it fails, fix visual before touching motion. Adding animation to a piece that fails the squint test is the most common way to make something worse while doing more work.

## The Five-Point Quick Audit

Run this on every view before shipping. Each item is pass/fail — no partial credit:

1. **Squint test** — Blur your eyes (or blur the screenshot 8px). Does exactly one thing dominate? If two or more elements survive the squint at equal strength, the hierarchy is broken.
2. **One focal point per view** — Can you point at *the* element this view exists to deliver? If you hesitate, the audience will too.
3. **Type sizes from a scale, not by eye** — Every font size on screen appears in your scale table. A single freehand `17px` is a fail.
4. **Contrast ratios pass** — 4.5:1 for body text, 3:1 for large text and UI elements. Check the muted text; that's where it always fails.
5. **Every color has a job** — Point at each distinct color and name its role (background, surface, text, muted, accent, semantic). A color you can't assign a job to is decoration, and decoration is debt.

A view that passes all five is ready for motion. A view that fails any of them isn't — and no amount of spring tuning will fix it.

## Reference Files (this folder)

- [hierarchy-and-composition.md](hierarchy-and-composition.md) — The squint test, the hierarchy toolkit, reading gravity, grids, whitespace as budget
- [typography.md](typography.md) — Type scales, pairing, rhythm, kinetic type and the motion handoff
- [color-and-contrast.md](color-and-contrast.md) — Color roles, tinted-neutral ramps, WCAG, dark mode, color as narrative device
- [persuasion-and-craft.md](persuasion-and-craft.md) — Aesthetic-usability, credibility signals, hero moments, the Craft Pass
