# Authoring notes

What the rubric doesn't teach. The rubric (`../../../core/references/rubric.md`)
defines what a good plugin *is*; this file maps interview answers onto plugin
design and documents the scaffold's conventions. Never restate the rubric's
anchors or numeric limits here — read them there, always current.

## Interview → design mapping

| The user says | The design answer |
|---|---|
| "every time I do X, I also want Y" | a hook, not a skill — enforcement shouldn't depend on the model remembering |
| "I want to run X on demand" | user-invoked skill (`disable-model-invocation: true`), zero passive cost |
| "the model should just know to do X" | model-invoked skill; the description must state the trigger conditions, and its passive cost has to buy that reach |
| "X is the same steps every time" | a script; the skill invokes it and reads its output — the model never re-derives what code can compute |
| "X produces the same document/page shape every run" | an asset/template the skill fills, never regenerates |
| "X needs many independent judgments" (per-file review, per-item grading) | a workflow with parallel fan-out; judgment on strong tiers, script-driving on cheap ones |
| "X depends on Y's result" | one skill with ordered steps, not two skills — skills split by *job*, not by *step* |
| "I need this info while authoring but rarely" | a references/ file the skill links; keep SKILL.md the map, not the territory |

Skill-count brake: when two candidate skills would share most of their
instructions, merge them and branch inside. The census that matters is what
the plugin costs installed, not how featureful the tree looks.

## Stub conventions

The scaffolder (`../scripts/plugin_scaffold.py`) fills these stubs from
`../assets/stubs/`:

| Stub | Becomes | Filled by scaffolder | Left for the author |
|---|---|---|---|
| `plugin-json.stub` | `.claude-plugin/plugin.json` | everything | nothing — bump version on later releases |
| `readme.stub` | `README.md` | install block, skills table rows, changelog seed | problem statement, mechanism, per-skill "Does" cells |
| `skill-md.stub` | `skills/<name>/SKILL.md` | frontmatter mode/hint lines | description, body, completion criteria |
| `workflow-js.stub` | `skills/<name>/workflows/<name>.js` | meta.name, args-coercion boilerplate | phases, agents, schemas, models |
| `script-py.stub` | `skills/<name>/scripts/<name>.py` | argparse/JSON skeleton | the actual computation and its contract docstring |

Rules the stubs assume:

- `TODO(author)` markers are the authored/unauthored signal — the scaffolder
  refuses to overwrite a file that has none (it's been authored) unless
  `--force`. Never leave a marker in a shipped plugin; the self-eval loop
  treats leftovers as unfinished work.
- Skill directories are self-contained: a skill's SKILL.md must mention every
  sibling file it ships (scripts, references, workflows) by name, or the
  scanner flags them as unlinked.
- Intra-plugin paths use `${CLAUDE_PLUGIN_ROOT}`; persistent state (caches,
  installed deps) uses `${CLAUDE_PLUGIN_DATA}` — the plugin root is replaced
  on update. Absolute machine paths never ship.

## Authoring order

1. **Scripts.** Their input/output contracts anchor the skill bodies; writing
   prose first means rewriting it when the contract lands differently.
2. **SKILL.md bodies.** Steps in execution order, each with an observable
   *Done when*. Anything deterministic points at a script; anything bulky and
   rarely needed points at a references/ file.
3. **Workflows.** Only after the inline path works — a workflow orchestrates
   steps that already exist, it doesn't invent them.
4. **README and manifest.** Written last, when the pitch can be honest:
   problem, mechanism, install, skills table, changelog.
