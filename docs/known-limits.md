# Known limits

What this marketplace leans on in the host and has measured, and what it has
not. Each finding names the build it was seen on, because a host behavior is
true of a build, not forever.

## Host behaviors the one-plugin cutover leans on

The twelve plugins became areas of one plugin, `agentcraft`. For a time each
old name stayed in the catalog as a stub, a manifest that depended on
`agentcraft` and shipped nothing else; the stubs are gone now, and the catalog
lists the one plugin. The move leaned on host behaviors nobody here had run.
Each was run on 2026-11-15 on Claude Code 2.1.325, in a throwaway marketplace
against scratch config, never a person's own. Findings 5 to 7 say what the
host does with a stub and with a plugin the catalog drops, which is what an
install under an old name meets today.

The setup bounds what these runs prove. Every `claude` command ran with a
scrubbed environment, a scratch `HOME`, and a scratch `CLAUDE_CONFIG_DIR`. The
marketplace, `spike-mkt`, was a git repository served on 127.0.0.1 and added
by URL (`claude plugin marketplace add http://127.0.0.1:<port>/spike-mkt.git`),
the source kind a real install has. Sessions were headless,
`claude -p --output-format stream-json --verbose`, the prompt on stdin. A
scratch config has no login, so `ANTHROPIC_BASE_URL` pointed at a local
stand-in that records every request and answers with a scripted reply: a
`Skill`, `Bash`, or `Read` call, then a line of text. The host was real and
the model was not. That leaves three things unproven: no account was signed
in, so anything the server switches per account ran at the build's default;
nothing here says how a real model routes; and no interactive terminal session
was run, so "typed by a person" below means a prompt that opens with a slash.

The scratch plugin `agentcraft` held `bin/probe`, an area `skills/area/`
(`user-invocable: false`, with `routes/go/ROUTE.md`), a plain skill
`skills/start/`, a `SessionStart` hook that writes down its environment, and
the `userConfig` key agent-works declares, `syncIntervalSeconds`. Where a
finding below quotes an address in it, the area is written `<area>`, its route
`<route>`, and the plain skill `<entry>`, so nothing here reads as an address
in the real plugin.

1. **A plugin's `bin/` is on the Bash tool's PATH, and a launcher there can
   import a script under `skills/`.** `bin/probe` was the three lines
   `plugins/agentcraft/bin/aw` is, pointed at
   `../skills/area/scripts/probe.mjs`. A scripted `Bash` call of
   `probe; command -v probe` printed `probe ran from
   <config>/plugins/cache/spike-mkt/agentcraft/1.0.0/skills/area/scripts` and
   resolved `probe` to `<config>/plugins/cache/spike-mkt/agentcraft/1.0.0/bin/probe`:
   the installed copy's `bin/` is one entry of that shell's PATH, and the
   relative import resolved inside the cache copy. A hook's process does not
   get that entry: the `SessionStart` hook's PATH held no plugin directory.
   The Bash tool's shell carries no `CLAUDE_PLUGIN_*` variable.

2. **An area's `SKILL.md` gets `${CLAUDE_PLUGIN_ROOT}` and
   `${CLAUDE_PLUGIN_DATA}` filled in; a route read by path gets neither.** A
   scripted `Skill` call of `agentcraft:<area>` with `<route> 0042` answered
   `Launching skill: agentcraft:<area>`, and the body the model was sent read
   `root=[<config>/plugins/cache/spike-mkt/agentcraft/1.0.0]
   data=[<config>/plugins/data/agentcraft-spike-mkt] args=[<route> 0042]`, under
   `Base directory for this skill: <that root>/skills/area`. A scripted `Read`
   of `routes/go/ROUTE.md` returned the file as written, `${CLAUDE_PLUGIN_ROOT}`,
   `${CLAUDE_PLUGIN_DATA}`, and `$ARGUMENTS` included. So a route that needs
   the data directory has to be told it by its area, which is loaded, or reach
   it through a script. One more thing the same run showed:
   `${user_config.syncIntervalSeconds}` is filled in only once the option is
   set (`45` for a plugin where it was). Unset, the text stays as written, the
   default in the manifest notwithstanding.

3. **A person cannot type an area: the host refuses it, and names the skill.**
   The session's init event listed `agentcraft:<entry>` under `skills` and
   `slash_commands` and `agentcraft:<area>` under neither. Each of these was the
   whole prompt:
   - `/agentcraft:<entry> hello there`: run as a command. The model was sent
     `<command-name>/agentcraft:<entry></command-name>`, the arguments, and the
     skill's body.
   - `/agentcraft:<area> <route> 0042`: refused with no request to the model. The
     result was `This skill can only be invoked by Claude, not directly by
     users. Ask Claude to use the "agentcraft:<area>" skill for you.`
   - `/old-a:thing now`, where the stub `old-a` kept an alias skill `thing`
     that is `user-invocable: false`: the same refusal, naming `old-a:thing`.
   - `/old-a:thing now` once the alias was gone, `/old-a:nothing now`, and
     `/agentcraft:<route> 0042` (a route written as if it were a skill): no
     refusal and no command. The text went to the model as an ordinary prompt.

   So `/agentcraft:<area> <route>` is an address for an agent, a brief, or a
   hook's message, never something to tell a person to type. A person types
   the entry skill, or asks in words. An alias that is `user-invocable: false`
   answers a model that follows an old address and turns a person away.

4. **A `userConfig` value belongs to the plugin id and does not carry to
   another.** `claude plugin configure old-a@spike-mkt --values-stdin` with
   `{"syncIntervalSeconds":"45"}` wrote
   `pluginConfigs["old-a@spike-mkt"].options.syncIntervalSeconds = 45` into
   `<config>/settings.json`. `old-a`'s hook then ran with
   `CLAUDE_PLUGIN_OPTION_SYNCINTERVALSECONDS=45`. After `old-a` became a stub
   and `agentcraft` arrived declaring the same key,
   `claude plugin configure agentcraft@spike-mkt` showed it `not set`, the
   settings held only the old id's entry, and `agentcraft`'s hook ran with no
   such variable. Uninstalling `old-a` removed its `pluginConfigs` entry. How
   a mod reads the option (the kanban pane does) was not tested.

5. **Removing a stub leaves the plugin it depended on installed and enabled,
   and marks it as removable.** A dependency the host installed is recorded
   with `"auto": true` in `installed_plugins.json`.
   - `claude plugin uninstall old-b@spike-mkt` kept its dependency enabled
     and printed `1 auto-installed dependency no longer needed: core-b. Run
     claude plugin prune to remove.`
   - With every stub gone, `claude plugin prune --dry-run` listed
     `agentcraft@spike-mkt` for removal. `claude plugin uninstall --prune`
     does the same in one step.
   - `claude plugin install agentcraft@spike-mkt` on the installed plugin
     answered `already installed ... marked as manually installed`, cleared
     `auto`, and `prune --dry-run` no longer listed it.
   - A stub dropped from the catalog while still installed stays in
     `enabledPlugins` and reports `failed to load: Plugin old-a not found in
     marketplace spike-mkt` until it is uninstalled; `claude plugin update`
     of it fails with `not found`, and `prune` refuses to run while it fails
     to load. The plugin it depended on kept working throughout.

   The stubs are deleted now. So an install under an old name reports
   `not found` until it is uninstalled, and an `agentcraft` that arrived as a
   stub's dependency stays one `prune` from removal until a person installs
   it by name.

6. **A plugin's data directory is `<config>/plugins/data/<plugin>-<marketplace>`,
   and an uninstall deletes it.** The hook's `CLAUDE_PLUGIN_DATA` was
   `<config>/plugins/data/old-a-spike-mkt` for `old-a@spike-mkt` and
   `<config>/plugins/data/agentcraft-spike-mkt` for the new plugin. The old
   directory, and a file the hook wrote in it, survived the update that made
   `old-a` a stub and were gone after `claude plugin uninstall old-a@spike-mkt`.
   `uninstall --keep-data` exists to preserve it. So state an area inherits
   from its old plugin is copied while the old name is still installed, by
   the first session that runs the new plugin, not later.

7. **An update of a stub installs and enables the plugin it depends on in the
   same step, unless non-essential traffic is turned off.** With `old-b` at
   1.0.0 installed and a 2.0.0 published that adds `"dependencies":
   ["core-b"]`, `claude plugin update old-b@spike-mkt` printed `updated from
   1.0.0 to 2.0.0 ... (+ 1 dependency: core-b)`, and `core-b@spike-mkt` was in
   `installed_plugins.json` and `enabledPlugins`. The same update run with
   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` in the environment printed `1
   dependency still unresolved ... Dependencies are not installed while
   non-essential traffic is turned off`, and `claude plugin list` showed the
   stub as `failed to load: Dependency "agentcraft@spike-mkt" is not
   installed`. Running the update again without the variable resolved it.
   Builds before 2.1.321 were not run here; measured elsewhere, the
   dependency arrives a session late on them.

Not tested: an interactive session's slash menu; a signed-in account; a real
model; the background auto-update pass; a `renames` entry; and how a mod reads
`userConfig`.

## Host behaviors the plan gate leans on

The agent-works area holds a session to a plan approved in Claude Code's plan
mode, and that reads what the host hands a hook while a session plans. The
hooks reference states little of it. Each behavior below was run on 2026-11-19
on Claude Code 2.1.326, in a scratch repo, on Haiku under a real login, with a
command hook on every event that wrote its stdin to a file. Plain
`claude -p --permission-mode plan` does not offer `ExitPlanMode` at all, so the
runs used the protocol the desktop app drives a session with
(`--input-format stream-json --output-format stream-json --permission-prompt-tool stdio`),
and a driver answered the approval prompt. The payloads are kept, with their
paths replaced, in
`scripts/test-hooks/cases/agent-works/plan-mode/payloads.json`, and the unit
suites of the two plan hooks are built from them.

Plan mode here is the host's: a plan file the session writes and the person
approves. It is not the spec and plan tree the but-first-planning area keeps
under `.agents/plan/`, which no finding below touches.

8. **`permission_mode` is `plan` on UserPromptSubmit, PreToolUse, PostToolUse,
   and Stop while a session plans.** SessionStart and SubagentStart carry no
   `permission_mode`. So a prompt in plan mode is where the section's format
   is told.

9. **A plan-file write is an ordinary `Write` or `Edit`** whose `file_path` is
   the plan file, with `permission_mode: "plan"`. A `plansDirectory` passed
   with `--settings` was not honoured: the plan file went to the default plans
   folder.

10. **PreToolUse on `ExitPlanMode` carries the plan, and a deny's reason
    reaches the model.** `tool_input` is `{ plan, planFilePath }`, the plan's
    markdown read from the file. A hook that denied the first call with a
    reason saw the model edit the plan file as the reason said and call again
    with the longer plan.

11. **PostToolUse on `ExitPlanMode` fires on approval only.** A prompt
    answered "keep planning" fired PreToolUse and PermissionRequest and no
    PostToolUse. On approval `tool_input` is `{}`, `tool_response` is
    `{ plan, isAgent, filePath }`, and `permission_mode` is already `default`.

12. **`EnterPlanMode` fires both tool hooks**, and its PostToolUse already
    carries `permission_mode: "plan"`. So a model that enters plan mode itself
    is told the format there.

13. **An Agent call's `tool_input` is `{ description, prompt, subagent_type,
    model }`, and a background agent's PostToolUse fires at launch.** Its
    `tool_response` is `{ isAsync: true, status: "async_launched", agentId,
    resolvedModel, ... }`, and SubagentStop fires later with that id as
    `agent_id`. A subagent's own tool hooks carry `agent_id` and `agent_type`;
    the main session's carry neither.

Not run, and the plan hooks fail open on each:

- An interactive session in the desktop app, so the approval dialog itself,
  and what a session is told when the person approves and clears the context
  in one step. The approved plan is kept under the work tree's git dir and the
  session briefing prints it again, so nothing depends on the session id.
- Whether a command hook fires for the desktop app's
  `mcp__ccd_session__start_session` tool. The check on a child session's start
  is built and unit-tested, and has not been seen firing.
- A foreground agent's PostToolUse, which the plan hooks read as the agent
  having returned.
- An anchored matcher such as `^(Agent|Task)$` in a plugin's hook map. The
  plan hooks are registered with anchored matchers; every other matcher in the
  map is a bare alternation, and only the payloads above were recorded, not
  which matcher form delivered them.
