# Known limits

What this marketplace leans on in the host and has measured, and what it has
not. Each finding names the build it was seen on, because a host behavior is
true of a build, not forever.

## Host behaviors the one-plugin cutover leans on

The twelve plugins are becoming areas of one plugin, `agentcraft`, with the
old names left as stubs that depend on it. That leans on host behaviors nobody
here had run. Each was run on 2026-11-15 on Claude Code 2.1.325, in a
throwaway marketplace against scratch config, never a person's own.

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
the `userConfig` key agent-works declares, `syncIntervalSeconds`.

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
   scripted `Skill` call of `agentcraft:area` with `go 0042` answered
   `Launching skill: agentcraft:area`, and the body the model was sent read
   `root=[<config>/plugins/cache/spike-mkt/agentcraft/1.0.0]
   data=[<config>/plugins/data/agentcraft-spike-mkt] args=[go 0042]`, under
   `Base directory for this skill: <that root>/skills/area`. A scripted `Read`
   of `routes/go/ROUTE.md` returned the file as written, `${CLAUDE_PLUGIN_ROOT}`,
   `${CLAUDE_PLUGIN_DATA}`, and `$ARGUMENTS` included. So a route that needs
   the data directory has to be told it by its area, which is loaded, or reach
   it through a script. One more thing the same run showed:
   `${user_config.syncIntervalSeconds}` is filled in only once the option is
   set (`45` for a plugin where it was). Unset, the text stays as written, the
   default in the manifest notwithstanding.

3. **A person cannot type an area: the host refuses it, and names the skill.**
   The session's init event listed `agentcraft:start` under `skills` and
   `slash_commands` and `agentcraft:area` under neither. Each of these was the
   whole prompt:
   - `/agentcraft:start hello there`: run as a command. The model was sent
     `<command-name>/agentcraft:start</command-name>`, the arguments, and the
     skill's body.
   - `/agentcraft:area go 0042`: refused with no request to the model. The
     result was `This skill can only be invoked by Claude, not directly by
     users. Ask Claude to use the "agentcraft:area" skill for you.`
   - `/old-a:thing now`, where the stub `old-a` kept an alias skill `thing`
     that is `user-invocable: false`: the same refusal, naming `old-a:thing`.
   - `/old-a:thing now` once the alias was gone, `/old-a:nothing now`, and
     `/agentcraft:go 0042` (a route written as if it were a skill): no
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

   So before the stubs are deleted, a person has to have installed
   `agentcraft` by name, or one `prune` takes it away.

6. **A plugin's data directory is `<config>/plugins/data/<plugin>-<marketplace>`,
   and an uninstall deletes it.** The hook's `CLAUDE_PLUGIN_DATA` was
   `<config>/plugins/data/old-a-spike-mkt` for `old-a@spike-mkt` and
   `<config>/plugins/data/agentcraft-spike-mkt` for the new plugin. The old
   directory, and a file the hook wrote in it, survived the update that made
   `old-a` a stub and were gone after `claude plugin uninstall old-a@spike-mkt`.
   `uninstall --keep-data` exists to preserve it. So state an area inherits
   from its old plugin is copied while the stub is still installed, by the
   first session that runs the new plugin, not later.

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
