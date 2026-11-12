---
name: browser-setup
description: Set up the browser the live Miro check drives (chrome-devtools MCP plus Google Chrome, signed in to Miro) in Claude Code, the Claude Desktop Code tab, or Cowork. Use when the miro-board skill's live check has no evaluate_script or list_pages tool, when the marvelous-miro session note says the check cannot run on this machine, when the Miro tab cannot be found or reached, or to repair the browser for Miro.
disable-model-invocation: true
---

# browser-setup

The live check in the miro-board skill runs a script in a Miro tab through chrome-devtools MCP. This plugin bundles that server as `miro-browser` (`.mcp.json` at the plugin root starts `scripts/miro-browser.mjs`). The server is pinned to one chrome-devtools-mcp version and gives Chrome its own profile under `~/.cache/marvelous-miro/`, so a Miro sign-in made there persists. In `/mcp` it is listed as `plugin:marvelous-miro:miro-browser`. Any other chrome-devtools server works too, provided its browser is signed in to Miro.

`S` below is `${CLAUDE_PLUGIN_ROOT}/skills/browser-setup/scripts`.

The sign-in is the person's, made by them, in that Chrome window. No step here reads, copies, or prints a password, token, or cookie, and none goes into the repo.

## Step 1, Check the machine

Run `node S/check-setup.mjs`. It reports Node (chrome-devtools-mcp needs 20.19, 22.12, or newer), npx, Google Chrome, the profile, and Claude Desktop's config, with a `fixes` list.

For each thing that is missing, say in one line what it is, where it comes from, and the exact command, and wait for the person's yes before running it. Use official sources only: nodejs.org or the system's package manager for Node, google.com/chrome or the package manager for Chrome. For example: "Google Chrome is missing. On this Mac I can install it from the Homebrew `google-chrome` cask with `brew install --cask google-chrome`. Go ahead?" An install that asks for an administrator password runs in the person's own terminal: hand them the command, and never type a password. The server itself needs no install: npx fetches the `chrome-devtools-mcp` version `miro-browser.mjs` pins on first start.

*Done when: `check-setup.mjs` exits 0 (`"ok": true`).*

## Step 2, Get the server connected

Find the surface first.

- **Claude Code (terminal or the desktop Code tab, local session):** plugin servers start with the session. If the browser tools are missing after an install or a fix, ask the person to start a new session, then check `/mcp` for `plugin:marvelous-miro:miro-browser`. Cloud and remote sessions have no local Chrome, so the live check cannot run there; say so and stop.
- **Cowork:** a plugin's local server loads only when the Cowork session runs on the person's computer. When the browser tools are still missing there, offer the Claude Desktop config route below.
- **Claude Desktop config route:** use it for Cowork or the desktop chat when the plugin's server does not load. `node S/check-setup.mjs --desktop` prints the entry and the config path. Show it to the person and ask before writing, since it changes their Desktop configuration. On a yes, run `node S/check-setup.mjs --desktop --write`. It merges the entry and keeps the old file as `.bak`. Then the person quits Claude Desktop completely and reopens it.

*Done when: `list_pages` answers from a browser server.*

## Step 3, Sign in to Miro once

Open the board from `miro/board.json` (or `https://miro.com/app/dashboard/`) with `new_page`. If Miro shows a sign-in page, ask the person to sign in in that Chrome window and wait for them. The profile keeps the session for every later check.

*Done when: the board loads in the tab.* Then go back to the miro-board skill's Step 3.

## When it breaks

| Symptom | Cause and fix |
| --- | --- |
| "The browser is already running" | Another server holds the same profile. Close that Chrome window, or use the server that owns it. |
| `evaluate_script` refuses a path | The server reads and writes only inside the session's workspace. Use the paths `live.mjs prepare` printed, from the project root. |
| `miro.board` or `cmd` is undefined | The tab is not a loaded board (a sign-in, the dashboard, or still loading). Wait for the board, then run it again. |
| No Miro MCP tools | Miro's server is separate from this plugin. Ask the person to connect Miro: the Miro connector, or `claude mcp add --transport http miro https://mcp.miro.com/` in Claude Code. |
