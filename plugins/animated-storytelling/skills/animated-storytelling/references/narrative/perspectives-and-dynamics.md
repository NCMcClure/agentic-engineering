# Perspectives & Dynamics

## Perspectives

Perspectives define where the author positions the source of conflict. In presentations, they map directly to narrative voice and framing choices.

### The Four Structural POVs

| `author_structural_pov` | Voice | Presentation Effect | When to Use |
|------------------------|-------|-------------------|-------------|
| `"i"` | First person | "I built this..." / "We discovered..." | Personal stories, founder pitches, experience reports |
| `"you"` | Second person | "You've seen this..." / "Your team faces..." | Persuasion, pitches to decision-makers, training |
| `"they"` | Third person | "The team found..." / "Users reported..." | Case studies, research presentations, neutral analysis |
| `"we"` | Collective | "We all face..." / "Together we can..." | Team rallies, shared-problem framing, inclusive pitches |

### Two-Perspective Model for Presentations

Every presentation benefits from exactly two perspectives:

1. **Objective Story Perspective** — The external view of the problem/solution space. Usually `"they"` (observing the situation) or `"we"` (shared experience).

2. **Main Character Perspective** — The audience's internal journey. Usually `"you"` (direct address) or `"we"` (inclusive journey).

The interplay between these creates tension: the objective perspective shows "what's happening out there" while the main character perspective shows "what this means for you."

### Matching User Input to Perspectives

When the user selects a voice/POV:

| User Says | OS Perspective | MC Perspective |
|-----------|---------------|----------------|
| "First person" | `"i"` | `"i"` (rare — very personal) or `"you"` |
| "Third person" | `"they"` | `"you"` |
| "Instructional" | `"they"` or `"we"` | `"you"` |
| "Collective/inclusive" | `"we"` | `"we"` |

## Dynamics

Dynamics are narrative forces that encode the author's intended message. For presentations, two dynamics are essential:

### story_outcome — How the Thesis Resolves

| Vector | Meaning | Presentation Strategy |
|--------|---------|----------------------|
| `success` | "This works" | Build to evidence, end with proof and optimism |
| `failure` | "This is what we're losing" | Build urgency, end with cost-of-inaction |

**Success presentations** follow: Problem → Solution → Evidence → Success → CTA
**Failure presentations** follow: Status Quo → Creeping Problem → Consequences → What We Lose → Urgent CTA

### mc_resolve — What the Audience Should Do

| Vector | Meaning | Conclusion Strategy |
|--------|---------|---------------------|
| `change` | "You should do something different" | Challenge assumptions, present new model, give concrete next steps |
| `steadfast` | "You're on the right track, keep going" | Reinforce existing beliefs, provide deeper evidence, validate their instincts |

### Combining Dynamics

| Outcome × Resolve | Narrative Arc |
|-------------------|---------------|
| Success + Change | "Here's something new that works — adopt it" (most common pitch) |
| Success + Steadfast | "What you're doing works — here's proof to keep going" (validation talk) |
| Failure + Change | "What we're doing is failing — we must change" (urgency pitch) |
| Failure + Steadfast | "The world is getting worse but our approach remains right" (resilience talk) |

### Additional Dynamics (Optional)

For richer narrative structure, you can also define:

- `mc_growth` — Does the audience grow by starting something (`start`) or stopping something (`stop`)?
- `os_driver` — Is the narrative driven by actions (`action`) or decisions (`decision`)?
- `story_judgment` — Does the audience feel good (`good`) or bad (`bad`) about the outcome?

These are optional refinements. For most presentations, `story_outcome` + `mc_resolve` is sufficient.

## From Dynamics to Slide Arcs

### Success + Change (most common)

```
Slides 1-3:  Establish the problem (OS perspective)
Slides 4-5:  Challenge current thinking (MC perspective)
Slides 6-8:  Reveal the solution + evidence (OS perspective)
Slides 9-10: Give agency + vision (MC perspective)
```

### Failure + Change (urgency pitch)

```
Slides 1-2:  Show the status quo (MC perspective — "you're here")
Slides 3-5:  Escalate the problem (OS perspective — getting worse)
Slides 6-7:  Show consequences (MC perspective — "this affects you")
Slides 8-9:  Present alternative (OS perspective)
Slide 10:    Urgent CTA (MC perspective — "act now")
```
