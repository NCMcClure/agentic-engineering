# NCP Schema Overview

The Narrative Context Protocol schema defines a story as a top-level container holding one or more narratives, each with subtext (structural meaning) and storytelling (audience-facing presentation).

## Top-Level Shape

```json
{
  "story": {
    "id": "story_<uuid>",
    "title": "Presentation Title",
    "narratives": [
      {
        "id": "narrative_<uuid>",
        "title": "Central Form",
        "status": "draft",
        "subtext": {
          "perspectives": [],
          "players": [],
          "storypoints": [],
          "storybeats": [],
          "dynamics": []
        },
        "storytelling": {
          "overviews": [],
          "moments": []
        }
      }
    ]
  }
}
```

## Required Fields Per Object

### Perspective
- `id` (string) — Unique identifier
- `author_structural_pov` (enum: "i", "you", "they", "we") — The authorial vantage point
- `summary` (string) — Brief description of this perspective

### Storybeat
- `id` (string) — Unique identifier
- `scope` (enum: "signpost", "event", "progression") — Granularity level
- `sequence` (integer) — Order within its scope
- `throughline` (string) — Which throughline this beat belongs to
- `summary` (string) — What happens in this beat

### Storypoint
- `id` (string) — Unique identifier
- `summary` (string) — The thematic concept

### Dynamic
- `id` (string) — Unique identifier
- `dynamic` (enum) — The narrative force type
- `vector` (string) — The chosen direction

### Overview (storytelling)
- `id` (string) — Unique identifier
- `label` (string) — What this overview describes
- `storytelling` (string) — The audience-facing text

### Moment (storytelling)
- `id` (string) — Unique identifier
- `summary` (string) — Brief description
- `storybeats` (array) — References to storybeat IDs with sequence

## Optional Fields

All objects support additional optional fields:
- `narrative_function` — A canonical term describing the conflict engine (e.g., "Understanding", "Doing", "Obtaining")
- `illustration` — Concrete example of the function in context
- `storytelling` — Audience-facing prose version
- `perspectives` — Array of `{ perspective_id }` linking to which perspective this element is viewed from

## For Presentations

A presentation storyform typically uses:
- 1 narrative (single central form)
- 2 perspectives (Objective Story = "they", Main Character = "you" or "we")
- 0 players (not needed for presentations)
- 4-8 storypoints (optional — thematic concepts being explored)
- 8-20 storybeats (= slides)
- 2-4 dynamics (outcome + resolve minimum)
- 1-2 overviews (logline + throughline summary)
- 3-5 moments (acts/sections grouping beats)
