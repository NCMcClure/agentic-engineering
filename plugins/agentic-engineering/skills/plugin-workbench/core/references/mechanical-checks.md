# The house mechanical checks

Eight of the checks `plugin-scan.mjs` grades hold a plugin to rules a
marketplace gate enforces. Each has one right fix, so the rule and the fix are
written out here, once; [rubric.md](rubric.md) keeps a line per check and the
scan's `basis` names the files. The other mechanical checks (links, orphans,
workflow metadata, paths, sizes, the manifest) say all there is to say in the
rubric.

Grades are 4 when nothing is wrong, 2 when one thing is, 0 when more are,
unless a check says otherwise.

## SQ8

**Frontmatter keys.** A SKILL.md's frontmatter carries `name`, `description`,
`disable-model-invocation`, `user-invocable`, and `argument-hint`, and nothing
else. Every other key is either cost in the listing or behavior that lives in
one host version and not the next; what a skill needs to say goes in its body.
A ROUTE.md carries `name`, `description`, and `argument-hint`: no host reads
it, and those three are what its area's table is built from.

A description that holds a colon followed by a space is written in double
quotes. Unquoted, it is a mapping to a YAML parser, and a host that reads
frontmatter strictly drops the skill without a word.

Read from each file's `frontmatter.extra_fields` and
`frontmatter.unquoted_colon`.

**Fix:** delete the extra keys, moving what they said into the body; quote
the description.

## SQ9

**Areas and routes.** Not applicable where no skill holds `routes/`. For each
area, from `areas[].problems`:

- every directory under `routes/` holds a `ROUTE.md` whose `name` is that
  directory's;
- the area's body names every route in a code span, because nothing else
  sends an agent to it;
- the description lists routes as `<route> (<cue>)`, never `<route>: <cue>`.
  The second is the skill listing's own shape, and a model that reads it
  builds a skill address out of the route and calls something that does not
  exist;
- no `SKILL.md` sits below the area;
- the body says to read the route again after a compaction. The host
  re-attaches the area it invoked, not a file the session read by path;
- the area is callable. One hidden with `disable-model-invocation` is refused
  when a session calls it; `user-invocable: false` keeps it out of the slash
  menu and reachable.

**Fix:** add the missing document or row, rewrite the description's list, add
the compaction line, swap the hiding key.

## CS7

**Node hooks behind the guard.** Not applicable where no hook runs Node. A
hook command that runs Node on a plugin file opens with a guard, so a machine
without Node on PATH gets one line at session start instead of an error on
every event:

- every such command is the guard, then `node "${CLAUDE_PLUGIN_ROOT}/<file>"`;
- the quiet guard is `command -v node >/dev/null 2>&1 || exit 0; `;
- the loud guard echoes a `systemMessage` telling the person Node is missing
  before it exits 0. Exactly one `SessionStart` command of the plugin uses
  it: with none, a machine without Node hears nothing and every hook is
  silently off; with two, the person reads the same line twice. Every other
  Node command takes the quiet guard, on `SessionStart` and on any other
  event;
- every `SessionStart` command carries a `statusMessage`.

The script a hook runs sets `process.exitCode` and lets Node unwind. A hook's
stdout is its whole contract, and a call that ends the process can cut it
short.

Read from `hooks.unguarded_node_commands` and `hooks.exit_calls`.

**Fix:** put the guard in front of the call, the loud one on the one
`SessionStart` command that speaks for the plugin and the quiet one on the
rest; replace the early exit with the exit code and a return.

## WQ7

**Subagent fallback.** Not applicable where no skill calls `Workflow()`. The
Workflow tool is not in every session, and not on every host. A skill whose
autonomous mode is only a `Workflow({...})` block leaves the model with an
instruction it cannot follow, so a skill that calls it also says how to run
the same phases with subagents. Read from each skill's
`mentions_workflow_tool` and `names_subagent_fallback`.

**Fix:** next to the call, say how the phases run with subagents.

## AN6

**Route paths.** Not applicable where the plugin has no route and no file
declares a named directory. A file read by path gets no
`${CLAUDE_PLUGIN_ROOT}`, and a shell runs the variable as empty, so a route
never writes it. It declares each directory its paths need, once, in this
sentence:

```text
`W` below is `../..` from the directory this file is in
```

One capital letter, and a path relative to the route's own directory. Every
path is then written under a declared letter: double-quoted in a command
(`node "W/core/scripts/scan.mjs" <target>`, since an install path may hold a
space) and in a code span of its own in prose. From `route_paths.problems`: a
route that writes the variable, a letter declared twice, a declaration that
leaves the plugin or is no directory, a path that is not there or not quoted,
and a path under a letter the file never declared.

The test behind the check: every command in a route runs as written, from an
installed copy, by an agent that read the file by its path.

**Fix:** declare the directory, write the path under its letter, quote it.

## CF6

**Critical-line caps.** Not applicable where the plugin ships no
`hooks/critical.json`. Each file's block is sized as a session start prints
it (its heading, then a bullet per line, chains included), and the blocks are
added up in `critical_lines.total_chars`:

- **4**: 7,500 characters or fewer in all.
- **2**: over 7,500 and within 10,000.
- **0**: over 10,000, where the host shows the model a preview instead of the
  text, or a file that does not parse.

**Fix:** cut to the lines that earn their place (CF5 says which), and move
reference detail into the skill or route a line names.

## MH3

**Changelog.** A plugin's history lives in `CHANGELOG.md` at its root, so it
ships with the installed copy: newest first, one bullet per release, the first
bullet opening with the version `plugin.json` carries (`- **1.2.0**: ...`).
The README keeps no changelog. Read from `changelog` and
`readme.changelog_section`:

- **4**: present, the top entry is the manifest version, and the README has
  no `## Changelog` section.
- **2**: present, but the top entry is another version or opens with none,
  or the README still carries a `## Changelog` section.
- **0**: no `CHANGELOG.md`. A changelog kept only in the README does not
  count.

**Fix:** move the history, add the missing line. Never bump the version to
match a changelog.

## MH5

**Scripts run on Node.** A shipped `.py`, `.sh`, `.bash`, `.zsh`, `.ps1`,
`.rb`, or `.pl` file, or a file with no extension whose shebang names anything
but `node`, fails this check unless the file itself declares the exception: a
`debt: <ceiling>, <trigger>` comment in its first lines, saying why it stays
and what would end it. Workflows and browser `.js` under an `assets/`
directory are not scripts the plugin runs and are censused separately. Read
from `components.non_node_scripts`: 4 when every one is declared (or there are
none), 0 otherwise.

**Fix:** rewrite it in Node, or declare the debt. Which one is the owner's
call.
