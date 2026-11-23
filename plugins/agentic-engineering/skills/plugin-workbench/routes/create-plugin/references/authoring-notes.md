# Authoring notes

What the rubric doesn't teach. The rubric (`../../../core/references/rubric.md`)
defines what a good plugin *is*; this file maps interview answers onto plugin
design and documents the scaffold's conventions. Never restate the rubric's
anchors or numeric limits here; read them there, always current.

## Interview → design mapping

| The user says | The design answer |
|---|---|
| "every time I do X, I also want Y" | a hook, not a skill: enforcement shouldn't depend on the model remembering |
| "I want to run X on demand" | user-invoked skill (`disable-model-invocation: true`), zero passive cost, as long as no other skill, agent, or hook sends an agent to it: a call on a hidden skill is refused. In a plugin of areas, a route whose row says a person starts it |
| "only other skills or agents should use X" | a callable skill (`user-invocable: false`): listed for the model, out of the slash menu |
| "it does stock, and orders, and the books" (several subjects, each with jobs) | areas: one skill per subject, its jobs as routes, and an entry skill a person types. The rule of thumb is in `../../../core/references/shapes.md` |
| "I can never remember which command does it" | an entry skill that asks and hands off, over areas; in a plain plugin, fewer skills |
| "the model should just know to do X" | model-invoked skill; the description must state the trigger conditions, and its passive cost has to buy that reach |
| "X is the same steps every time" | a script; the skill invokes it and reads its output; the model never re-derives what code can compute |
| "X produces the same document/page shape every run" | an asset/template the skill fills, never regenerates |
| "X needs many independent judgments" (per-file review, per-item grading) | a workflow with parallel fan-out; judgment on strong tiers, script-driving on cheap ones |
| "X depends on Y's result" | one skill with ordered steps, not two skills: skills split by *job*, not by *step* |
| "I need this info while authoring but rarely" | a references/ file the skill links; keep SKILL.md the map, not the territory |

Skill-count brake: when two candidate skills would share most of their
instructions, merge them and branch inside. The census that matters is what
the plugin costs installed, not how featureful the tree looks.

## Stub conventions

The scaffolder (`../scripts/plugin-scaffold.mjs`) fills these stubs from
`../assets/stubs/`:

| Stub | Becomes | Filled by scaffolder | Left for the author |
|---|---|---|---|
| `plugin-json.stub` | `.claude-plugin/plugin.json` | everything | nothing; bump the version on later releases |
| `readme.stub` | `README.md` | install block, skills table rows | problem statement, mechanism, per-skill "Does" cells |
| `changelog.stub` | `CHANGELOG.md` | the first entry, at the spec's version | a new line on top for every later release |
| `skill-md.stub` | `skills/<name>/SKILL.md` | frontmatter mode/hint lines | description, body, completion criteria |
| `area-md.stub` | `skills/<area>/SKILL.md` | `user-invocable: false`, the description's route list, the route table, the default, the compaction line | the description's lead where the spec gave none, and the opening: what the routes share |
| `route-md.stub`, `route-script-section.stub` | `skills/<area>/routes/<route>/ROUTE.md` | name, argument hint, the named-directory line, the script's path under it | description (what, then when), steps, completion criteria |
| `entry-md.stub` | `skills/<entry>/SKILL.md` | description, the area table's names and routes, how a hand-off is made | the questions to ask, and each area's "use it to" |
| `skill-script-section.stub`, `skill-references-section.stub`, `skill-workflow-section.stub` | a section of that SKILL.md per sibling file the spec asked for | the file's path, the `Workflow()` call | what the file is for and when a run reaches it; for a workflow, the subagent fallback |
| `workflow-js.stub` | `skills/<name>/workflows/<name>.js` | meta.name, args-coercion boilerplate | phases, agents, schemas, models |
| `script-mjs.stub` | `skills/<name>/scripts/<name>.mjs`, or `routes/<route>/scripts/<route>.mjs` under an area | argv/JSON skeleton, Node stdlib only | the actual computation and its contract comment |

Rules the stubs assume:

- `TODO(author)` markers are the authored/unauthored signal: the scaffolder
  refuses to overwrite a file that has none (it's been authored) unless
  `--force`. Never leave a marker in a shipped plugin; the self-eval loop
  treats leftovers as unfinished work.
- Skill directories are self-contained: a skill's SKILL.md must mention every
  sibling file it ships (scripts, references, workflows) by name, or the
  scanner flags them as unlinked. The scaffolder writes that mention for each
  file it creates; keep it when you author the section.
- SKILL.md frontmatter stays at the keys the stub has: `name`, `description`,
  and where the spec asked, `disable-model-invocation` or `user-invocable`,
  and `argument-hint`. A `ROUTE.md` carries `name`, `description`, and
  `argument-hint` only: who starts a route is its row in the area's table.
- An area's route list is written twice, in its description and in its
  table, and nothing regenerates either. A route added later goes in both,
  as `<route> (<cue>)` in the description, and gets its `ROUTE.md` from a
  second run of the scaffolder with the route added to the spec.
- Nothing written for a person tells them to type an area: the host refuses
  it. A README names the entry skill, or says to ask in words.
- A hook that runs Node is registered behind the guard the rubric's CS7
  spells out. The scaffolder writes no hooks; add them by hand, guard first.
- Intra-plugin paths use `${CLAUDE_PLUGIN_ROOT}`; persistent state (caches,
  installed deps) uses `${CLAUDE_PLUGIN_DATA}`, because the plugin root is replaced
  on update. Absolute machine paths never ship. A route is the exception to
  the first: it is read by path, the host fills no variable into it, and it
  writes each path under the directory its own first lines name. Where a
  route needs the data directory, its area's `SKILL.md` names it.

## Authoring order

1. **Scripts.** Their input/output contracts anchor the skill bodies; writing
   prose first means rewriting it when the contract lands differently.
2. **SKILL.md bodies.** Steps in execution order, each with an observable
   *Done when*. Anything deterministic points at a script; anything bulky and
   rarely needed points at a references/ file. For areas: each route first,
   then the area's opening from what its routes turned out to share, then the
   entry skill's questions, last, when every area can be said in a line.
3. **Workflows.** Only after the inline path works: a workflow orchestrates
   steps that already exist, it doesn't invent them. Name the subagent
   fallback in the same section of SKILL.md that shows the `Workflow()` call.
4. **README and manifest.** Written last, when the pitch can be honest:
   problem, mechanism, install, skills table. History goes in `CHANGELOG.md`,
   never the README.
