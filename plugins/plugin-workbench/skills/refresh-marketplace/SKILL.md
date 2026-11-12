---
name: refresh-marketplace
description: Validate a marketplace checkout and reinstall its plugins from the working tree, so the edits made this session are what the next session loads. Use when someone has changed a plugin in a marketplace checkout and asks to refresh, reinstall, or try it.
disable-model-invocation: true
argument-hint: "[--plugins a,b] [--dry-run]"
---

# refresh-marketplace

Plugins load at session start from an installed copy, never from the checkout
you are editing, so a change to a skill is invisible until the copy is
replaced. This is the loop that replaces it: validate the tree, reinstall
it, and say what has to happen next (a new session).

It runs against a checkout, not against the installed copy of itself, so
nothing here assumes where that checkout lives.

## Step 0: find the marketplace root

The root is the directory holding `.claude-plugin/marketplace.json`. Resolve
it in this order and stop at the first hit:

1. `git rev-parse --show-toplevel` from the current working directory, if the
   result carries that file.
2. A path the user names in the request.
3. Ask. Do not guess, and never write a machine path into a tracked file.

Then pick the branch: a root that also carries `scripts/refresh.mjs` has its
own dev loop (Step 1a); a root without one goes through the host CLI
(Step 1b).

Arguments: an optional `--plugins a,b` and an optional `--dry-run`. Anything
else is an error: echo what was passed and list the valid values.

Run every command in a subshell (`(cd <root> && ...)`) so the user's working
directory survives.

*Done when: the root is confirmed to hold the catalog and the branch is
known.*

## Step 1a: a checkout with its own dev loop

```bash
(cd <root> && node scripts/refresh.mjs -- [--plugins a,b] [--dry-run])
```

`refresh.mjs` runs `scripts/validate.mjs` first and installs nothing on a red
gate, which is the point: a tree that fails the structural gate would
otherwise be put in front of every session. Stream the output. On a red
validate, stop and show the `FAIL:` lines; each names the rule and the file.

On green it runs `scripts/install.mjs`, which writes what `/plugin install`
would have written, without the host CLI: a cached copy per plugin version,
the marketplace registered as a directory source at the checkout, the
user-scope install, and the enable flag. `--dry-run` prints every write and
touches nothing.

**The name collision.** Claude Code allows one source per marketplace name.
If the name is already registered from somewhere else (the person installed
it from its remote), the installer stops and says so. Show its message and
ask before re-running with `-- --force`: that repoints the name at the
checkout and parks the old entry, and `node scripts/install.mjs --uninstall`
puts it back.

*Done when: the installer reports the plugins installed (or what it would
write), or validate is red and you have shown why, or the collision is in
front of the person.*

## Step 1b: a checkout with no dev loop of its own

No installer to lean on, so the host does it. Requires the `claude` CLI on
PATH; without it, give the person the slash commands instead
(`/plugin marketplace add <root>`, then `/plugin install <name>@<marketplace>`)
and stop.

```bash
(cd <root> && claude plugin validate <plugin-dir>)        # once per plugin being refreshed
claude plugin marketplace list                            # is this marketplace registered, and from where?
claude plugin marketplace add <root>                      # only when it is not registered
claude plugin marketplace update <marketplace-name>       # when it is, and its source is this checkout
claude plugin install <name>@<marketplace-name>           # a plugin not installed yet
claude plugin update <name>@<marketplace-name>            # one that is
```

The marketplace name is the `name` in `.claude-plugin/marketplace.json`; a
plugin's directory is its entry's `source`. If the name is registered from a
different source, stop and say so: repointing it is the person's call.
A plugin whose version did not move may not be picked up by `update`; say
that and name the version field rather than editing it.

*Done when: each plugin validated and was installed or updated, or the step
that stopped is shown with its output.*

## Step 2: the cross-check

If the `claude` CLI is on PATH and Step 1a ran, validate each refreshed
plugin the way the host itself will read it:

```bash
(cd <root> && claude plugin validate plugins/<name>)
```

Skip this with one line saying so when the CLI is absent; it is a
cross-check, not a gate.

*Done when: every refreshed plugin either validated or was skipped with a
reason.*

## Step 3: report

Print, in this shape:

```
## Marketplace refreshed

**Root:**      <root>
**Validate:**  green | RED, <n> failure(s)
**Plugins:**   <name>@<version>, ...
**Installed:** ok | dry run | FAILED, <reason>
**Host check:** ok | skipped, no claude CLI | FAILED, <plugin>: <reason>
```

Then one line the user acts on: open sessions loaded their plugins at start
and will not pick this up, so start a new session.

Where things went, when the user asks: the cache is
`<config>/plugins/cache/<marketplace>/<plugin>/<version>/`, and the registry
is `known_marketplaces.json` and `installed_plugins.json` beside it, with the
enable flag in `<config>/settings.json`. `<config>` is `CLAUDE_CONFIG_DIR`
when set, `~/.claude` otherwise.

*Done when: the summary is printed and the user has been told to start a new
session.*

## Before a release, not on every refresh

Refreshing is not releasing. When the change is going out, the version in
the plugin's `plugin.json` has to move and its `CHANGELOG.md` needs a new
line on top: patch for a fix or wording, minor for a new skill or behavior,
major for a breaking workflow. Without the bump, installed users never
receive the change. Say which plugins changed and what their next version
should be; do not edit versions without being asked.

## Not in scope

No git operations, no pushing, no tagging, no tests that cost money, and no
uninstall. Taking this checkout's plugins back off is
`node scripts/install.mjs --uninstall`, the person's to run.
