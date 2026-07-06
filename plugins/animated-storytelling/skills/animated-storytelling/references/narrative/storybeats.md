# Storybeats — Slide Mapping

Storybeats are temporal elements marking narrative progression. In presentations, each storybeat maps to exactly one slide.

## Beat Structure

```json
{
  "id": "beat_001",
  "scope": "event",
  "sequence": 1,
  "throughline": "Objective Story",
  "narrative_function": "Understanding",
  "summary": "Structural purpose of this slide",
  "storytelling": "What the audience sees and experiences"
}
```

## Scope Levels

| Scope | Presentation Mapping | Typical Count |
|-------|---------------------|---------------|
| `signpost` | Major section boundary (act break) | 3-4 per throughline |
| `event` | Individual slide | 8-20 total |
| `progression` | Sub-slide animation beat (optional) | 2-4 per slide |

For most presentations, use only `signpost` (to define sections) and `event` (for individual slides).

## Throughline Interweaving

Slides alternate between throughlines to maintain narrative tension:

```
Slide 1: OS Signpost 1 — Set up the problem space
Slide 2: MC Signpost 1 — Where the audience is now
Slide 3: OS Event — Evidence of the problem
Slide 4: OS Event — Deeper exploration
Slide 5: MC Event — Challenge to current thinking
Slide 6: OS Signpost 2 — Pivot to solution
Slide 7: MC Signpost 2 — New mental model
...
```

The exact interweaving depends on the presentation's pacing needs.

## Narrative Function → Slide Content

The `narrative_function` field guides what kind of content belongs on the slide:

| Function | Content Direction | Component Suggestion |
|----------|------------------|---------------------|
| Understanding | Explain a concept | `SplitPane` + diagram |
| Doing | Show action/process | `CodeBlock` or demo |
| Obtaining | Present evidence | `StatCard` or `ComparisonTable` |
| Learning | Build knowledge step-by-step | `BulletList` with stagger |
| Conceptualizing | Abstract idea | `FullBleed` with metaphor image |
| Becoming | Show transformation | `Timeline` or before/after |
| Being | Evoke emotion | `CenteredContent` with minimal text |
| Conceiving | Plan/next steps | `BulletList` or roadmap |

## Worked Example: 10-Slide Technical Presentation

**Topic:** "Why your team needs a shared knowledge base"
**Audience:** Engineering managers
**POV:** Second person ("you")
**Outcome:** Success (this approach works)
**Resolve:** Change (audience should adopt new behavior)

```json
{
  "story": {
    "id": "story_kb_pitch",
    "title": "Why Your Team Needs a Shared Knowledge Base",
    "narratives": [
      {
        "id": "narrative_central",
        "title": "Central Form",
        "status": "complete",
        "subtext": {
          "perspectives": [
            {
              "id": "perspective_os",
              "author_structural_pov": "they",
              "summary": "The objective view of knowledge management problems"
            },
            {
              "id": "perspective_mc",
              "author_structural_pov": "you",
              "summary": "The audience's journey from status quo to adoption"
            }
          ],
          "storypoints": [
            {
              "id": "sp_001",
              "summary": "Teams lose institutional knowledge faster than they create it",
              "narrative_function": "Understanding"
            },
            {
              "id": "sp_002",
              "summary": "The solution must be automatic, not require discipline",
              "narrative_function": "Conceptualizing"
            }
          ],
          "storybeats": [
            {
              "id": "beat_01",
              "scope": "signpost",
              "sequence": 1,
              "throughline": "Objective Story",
              "narrative_function": "Understanding",
              "summary": "Frame the knowledge loss problem",
              "storytelling": "Title slide: 'Stop Being Your Team's Memory'"
            },
            {
              "id": "beat_02",
              "scope": "event",
              "sequence": 2,
              "throughline": "Main Character",
              "narrative_function": "Being",
              "summary": "Make the audience feel the pain they already know",
              "storytelling": "Three scenarios they recognize: the new hire asking the same questions, the cross-team handoff that fails, the post-incident where nobody remembers why"
            },
            {
              "id": "beat_03",
              "scope": "event",
              "sequence": 3,
              "throughline": "Objective Story",
              "narrative_function": "Obtaining",
              "summary": "Quantify the cost",
              "storytelling": "Stats: average ramp time, repeated questions per week, knowledge lost per departure"
            },
            {
              "id": "beat_04",
              "scope": "signpost",
              "sequence": 2,
              "throughline": "Main Character",
              "narrative_function": "Learning",
              "summary": "Why existing approaches fail",
              "storytelling": "Confluence/Notion/wikis require discipline. People don't write docs because there's no immediate reward. The problem isn't tooling, it's incentive structure."
            },
            {
              "id": "beat_05",
              "scope": "event",
              "sequence": 5,
              "throughline": "Objective Story",
              "narrative_function": "Conceptualizing",
              "summary": "Introduce the paradigm shift",
              "storytelling": "What if the system captured knowledge automatically as a byproduct of normal work?"
            },
            {
              "id": "beat_06",
              "scope": "signpost",
              "sequence": 3,
              "throughline": "Objective Story",
              "narrative_function": "Doing",
              "summary": "Show the mechanism",
              "storytelling": "Demo: agent reads context, does work, reflects, captures. No human effort required."
            },
            {
              "id": "beat_07",
              "scope": "event",
              "sequence": 7,
              "throughline": "Main Character",
              "narrative_function": "Becoming",
              "summary": "Show the transformation",
              "storytelling": "Before/after: team with vs without. New hire productive in days not weeks. Cross-team handoffs succeed because context travels."
            },
            {
              "id": "beat_08",
              "scope": "event",
              "sequence": 8,
              "throughline": "Objective Story",
              "narrative_function": "Obtaining",
              "summary": "Evidence it works",
              "storytelling": "Real metrics from a 6-month pilot. Knowledge graph growth over time."
            },
            {
              "id": "beat_09",
              "scope": "signpost",
              "sequence": 4,
              "throughline": "Main Character",
              "narrative_function": "Conceiving",
              "summary": "Give the audience agency",
              "storytelling": "Three concrete next steps they can take tomorrow. Low barrier to start."
            },
            {
              "id": "beat_10",
              "scope": "event",
              "sequence": 10,
              "throughline": "Objective Story",
              "narrative_function": "Being",
              "summary": "Close with vision",
              "storytelling": "The compounding effect: a team that never forgets, a network that grows while you sleep."
            }
          ],
          "dynamics": [
            {
              "id": "dyn_outcome",
              "dynamic": "story_outcome",
              "vector": "success",
              "summary": "The approach demonstrably works — evidence proves it"
            },
            {
              "id": "dyn_resolve",
              "dynamic": "mc_resolve",
              "vector": "change",
              "summary": "The audience should change from passive documentation to automatic capture"
            }
          ]
        },
        "storytelling": {
          "overviews": [
            {
              "id": "overview_logline",
              "label": "Logline",
              "storytelling": "A pitch to engineering managers showing why automatic knowledge capture outperforms manual documentation, with evidence from a real pilot."
            }
          ],
          "moments": [
            {
              "id": "moment_act1",
              "summary": "Act 1: The Problem",
              "storybeats": [
                { "sequence": 0, "storybeat_id": "beat_01" },
                { "sequence": 1, "storybeat_id": "beat_02" },
                { "sequence": 2, "storybeat_id": "beat_03" },
                { "sequence": 3, "storybeat_id": "beat_04" }
              ]
            },
            {
              "id": "moment_act2",
              "summary": "Act 2: The Solution",
              "storybeats": [
                { "sequence": 0, "storybeat_id": "beat_05" },
                { "sequence": 1, "storybeat_id": "beat_06" },
                { "sequence": 2, "storybeat_id": "beat_07" }
              ]
            },
            {
              "id": "moment_act3",
              "summary": "Act 3: The Evidence & Call to Action",
              "storybeats": [
                { "sequence": 0, "storybeat_id": "beat_08" },
                { "sequence": 1, "storybeat_id": "beat_09" },
                { "sequence": 2, "storybeat_id": "beat_10" }
              ]
            }
          ]
        }
      }
    ]
  }
}
```

## Deriving Slide Metadata from Beats

| Beat Field | Slide Property |
|-----------|---------------|
| `sequence` | Slide number (for ordering) |
| `throughline` | Eyebrow prefix ("Problem" vs "Your Journey") |
| `narrative_function` | Animation style + component selection |
| `summary` | Internal slide purpose (for planning) |
| `storytelling` | Actual content direction for the slide |
