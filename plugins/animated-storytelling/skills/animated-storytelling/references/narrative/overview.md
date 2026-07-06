# Narrative Context Protocol (NCP) — Giving an Idea a Dramatic Arc

NCP is a structured vocabulary for encoding authorial intent into *any* piece of communication — a presentation, a blog post, a product walkthrough, a pitch, a documentation page, a video script. Use it whenever a concept, idea, or story needs an **intentional dramatic arc** rather than an arbitrary order of points.

The mapping below uses **slides** as the running example because it's concrete, but the same structure applies to sections of an essay, scenes in a script, steps in an onboarding flow, or chapters in a guide. Wherever you read "slide," substitute "the next unit of your medium."

## Core Concept

Any piece of persuasive or explanatory communication is a narrative. It has:
- A **thesis** (what you want the audience to believe or do afterward)
- An **arc** (how you move them from where they are to where you want them)
- **Beats** (individual moments of revelation, tension, or resolution)

NCP gives you the structural vocabulary to make these intentional rather than accidental. This is equally useful for **creating** a narrative from scratch and for **diagnosing/enhancing** an existing one — when something "reads flat" or "is just a list," it usually lacks an arc, lacks tension between throughlines, or orders its beats by topic instead of by dramatic function.

## The Storyform (Minimal NCP)

Use exactly **2 throughlines** and a simplified structure:

| NCP Concept | Mapping |
|-------------|---------|
| **Objective Story Throughline** | The topic/problem space — what the piece is *about* |
| **Main Character Throughline** | The audience's journey — their transformation from before to after |
| **Signposts** (scope: signpost) | Major act boundaries — sections (3-5 per throughline) |
| **Storybeats** (scope: event) | Individual units — each slide / section / scene is one beat |
| **Dynamics: story_outcome** | The conclusion — success/failure framing of the thesis |
| **Dynamics: mc_resolve** | Whether the audience changes their mind (change) or is reinforced (steadfast) |
| **Perspectives** | Narrative voice choices — maps to POV/framing |

## How to Generate a Storyform

### Step 1: Define Perspectives

Map the chosen POV to NCP perspectives:

| Voice | `author_structural_pov` | Effect |
|-------|------------------------|--------|
| First person ("we built...") | `"i"` | Author as protagonist, audience as witness |
| Second person ("you can...") | `"you"` | Audience as protagonist, author as guide |
| Third person ("the team...") | `"they"` | External narrative, author as narrator |
| Collective ("we all face...") | `"we"` | Shared journey, author + audience together |

### Step 2: Define Dynamics

These determine the conclusion strategy:

| Dynamic | Vector | Meaning |
|---------|--------|---------|
| `story_outcome` | `success` | "This approach works" — optimistic conclusion |
| `story_outcome` | `failure` | "This is what we're losing" — urgency conclusion |
| `mc_resolve` | `change` | Audience should change their mind/behavior |
| `mc_resolve` | `steadfast` | Audience's existing beliefs are reinforced |

### Step 3: Map Signposts to Sections

A typical piece has 3-4 signposts per throughline:

**Objective Story Signposts** (the topic):
1. Context/Problem setup
2. Exploration of the space
3. Solution/approach reveal
4. Evidence/proof

**Main Character Signposts** (audience journey):
1. Where the audience is now (status quo)
2. What challenges that (the provocation)
3. The new mental model
4. What they can do with it (agency)

### Step 4: Generate Storybeats (= Units)

Each signpost contains 2-5 storybeats. Each beat = one unit (slide, section, scene).

```json
{
  "id": "beat_001",
  "scope": "event",
  "sequence": 1,
  "throughline": "Objective Story",
  "narrative_function": "Understanding",
  "summary": "Show the three failure modes teams hit without shared context",
  "storytelling": "Three side-by-side scenarios: the new hire, the cross-team handoff, the post-incident debrief. Each one fails the same way."
}
```

The `storytelling` field becomes the content direction for that unit. The `narrative_function` guides the animation/motion choice (see the motion references).

## Narrative Function → Treatment

| Narrative Function | Treatment |
|-------------------|-----------|
| Understanding | Explanatory — diagrams, comparisons, code |
| Doing | Interactive — demos, live examples |
| Obtaining | Evidence — stats, testimonials, screenshots |
| Learning | Progressive reveal — staggered points, timeline |
| Conceptualizing | Abstract — metaphors, illustrations, animations |
| Becoming | Transformation — before/after, evolution |
| Being | Emotional — full-bleed imagery, minimal text |
| Conceiving | Planning — roadmaps, architectures, next steps |

## Worked Example

See [storybeats.md](storybeats.md) for a complete 10-beat storyform worked end to end.

## Reference Files (this folder)

- [schema-overview.md](schema-overview.md) — Top-level NCP structure, required fields
- [storybeats.md](storybeats.md) — Beat-to-unit mapping with worked example
- [perspectives-and-dynamics.md](perspectives-and-dynamics.md) — Voice choices and conclusion strategies
- [from-story-to-medium.md](from-story-to-medium.md) — Turning the storyform into concrete units (section counts, transitions, complexity tiers)
