#!/usr/bin/env node
// Structural gate for the marketplace. Every rule here is stated in
// .agents/rules/dev-rules.md; change both together. Node 22 stdlib only.
//
// Usage: node scripts/validate.mjs [--root <dir>] [--tag <plugin>/v<version>]
//
// --root points the checks at another checkout, which is how they get tested
// against a tree that is meant to fail. --tag checks one thing only: that the
// tag names a plugin at the version its plugin.json carries.
//
// The ratchet: scripts/plugins/<name>.json may carry `"legacy": true`. A legacy
// plugin is waived on the rules marked (legacy) below and on nothing else, and
// the flag fails the tree once the plugin no longer needs it, so it can only
// ever be removed.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail, failures, gitLsFiles, note, ok, parseFrontmatter, readJson } from "./lib.mjs";

const here = import.meta.dirname;
const argv = process.argv.slice(2);
const arg = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const ROOT = path.resolve(arg("--root") ?? path.join(here, ".."));
const at = (...p) => path.join(ROOT, ...p);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/") || ".";

// The hook events a plugin here may register. A name outside this list is far
// more often a typo than a new event; add the event when a plugin first needs it.
const HOOK_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "UserPromptSubmit",
  "Notification", "Stop", "SubagentStart", "SubagentStop", "SessionStart", "SessionEnd", "PreCompact", "PostCompact",
  "TaskCompleted"]);
const SKILL_KEYS = new Set(["name", "description", "disable-model-invocation", "argument-hint"]);
// Non-Node files a plugin ships on purpose, by exact path. Both need numpy and
// a model download, which no stdlib rewrite replaces.
const NON_NODE_ALLOWLIST = new Set([
  "plugins/perceptual-loop/scripts/keypoints.py",
  "plugins/perceptual-loop/scripts/semantic.py",
]);
const NON_NODE_EXT = /\.(py|sh|bash|zsh|ps1|rb|pl)$/;
// A vendored app tree carries its toolchain's own files; path rules skip it.
const VENDORED = /^plugins\/[^/]+\/app\//;
const ABS_PATH = new RegExp("/(?:Users|home/[a-z]|fast)/");

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => fs.existsSync(p);
const listDirs = (p) => (isDir(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const versionOf = (plugin) => readJson(at("plugins", plugin, ".claude-plugin", "plugin.json")).version;

// ---- release tag -------------------------------------------------------
if (arg("--tag")) {
  const tag = arg("--tag");
  const m = /^([a-z0-9-]+)\/v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) fail(`tag "${tag}" is not <plugin>/v<version>`);
  else if (!isDir(at("plugins", m[1]))) fail(`tag "${tag}" names plugins/${m[1]}, which does not exist`);
  else if (versionOf(m[1]) !== m[2]) fail(`tag "${tag}" says ${m[2]}, but plugins/${m[1]}/.claude-plugin/plugin.json is at ${versionOf(m[1])}`);
  else ok(`tag ${tag} matches plugin.json`);
  process.exitCode = failures() ? 1 : 0;
} else {
  validate();
}

function validate() {
  const tracked = gitLsFiles(ROOT);

  // ---- catalog ---------------------------------------------------------
  const CATALOG = ".claude-plugin/marketplace.json";
  let catalog = { plugins: [] };
  try {
    const m = readJson(at(CATALOG));
    if (!m.name || !m.owner?.name || !Array.isArray(m.plugins) || !m.plugins.length) throw new Error("needs name, owner.name, and a non-empty plugins[]");
    catalog = m;
    ok(`${CATALOG} parses with name, owner, plugins[]`);
  } catch (e) {
    fail(`${CATALOG}: ${e.message}`, CATALOG);
  }

  const versioned = catalog.plugins.filter((p) => "version" in p).map((p) => p.name);
  if (versioned.length) fail(`entries carry a version key (version lives only in plugin.json): ${versioned.join(", ")}`, CATALOG);
  else ok("no version key on any catalog entry");

  // An external entry is a plugin released from its own repo: nothing of it
  // lives under plugins/, and its releases never touch this tree.
  const isExternal = (entry) => entry.source && typeof entry.source === "object";
  const external = catalog.plugins.filter(isExternal);
  const externalFailures = failures();
  for (const { name, source } of external) {
    if (!["github", "git"].includes(source.source)) fail(`entry ${name}: unknown object source kind "${source.source}"`, CATALOG);
    if (isDir(at("plugins", name))) fail(`entry ${name}: external, but plugins/${name} exists`, `plugins/${name}`);
  }
  if (external.length && failures() === externalFailures) ok(`${external.length} external entr${external.length === 1 ? "y" : "ies"}: github or git source, nothing vendored`);

  // ---- the legacy ratchet ----------------------------------------------
  const pluginDirs = listDirs(at("plugins"));
  const legacy = new Set();
  const waived = new Map();
  for (const file of isDir(at("scripts", "plugins")) ? fs.readdirSync(at("scripts", "plugins")).filter((f) => f.endsWith(".json")).sort() : []) {
    const name = file.slice(0, -5);
    const where = `scripts/plugins/${file}`;
    if (!pluginDirs.includes(name)) { fail(`${where} describes a plugin that is not under plugins/`, where); continue; }
    try { if (readJson(at(where)).legacy === true) legacy.add(name); } catch (e) { fail(`${where} does not parse (${e.message})`, where); }
  }
  /** A finding on a rule a legacy plugin is waived on: counted for a legacy plugin, a failure for any other. */
  const strict = (plugin, what, where) => {
    if (legacy.has(plugin)) waived.set(plugin, (waived.get(plugin) ?? 0) + 1);
    else fail(what, where);
  };

  // ---- per plugin ------------------------------------------------------
  const entryNames = new Set(catalog.plugins.map((p) => p.name));
  for (const dir of pluginDirs) if (!entryNames.has(dir)) fail(`plugins/${dir} has no catalog entry`, `plugins/${dir}`);

  const pluginFailures = failures();
  for (const entry of catalog.plugins) {
    if (isExternal(entry)) continue;
    const name = entry.name;
    if (!name) { fail("a catalog entry has no name", CATALOG); continue; }
    if (entry.source !== `./plugins/${name}`) { fail(`entry ${name}: source must be ./plugins/${name} or a github/git object, got ${JSON.stringify(entry.source ?? "")}`, CATALOG); continue; }
    const dir = at("plugins", name);
    if (!isDir(dir)) { fail(`entry ${name}: ${entry.source} does not exist`, CATALOG); continue; }

    let manifest = null;
    const manifestPath = path.join(dir, ".claude-plugin", "plugin.json");
    if (!exists(manifestPath)) fail(`${name}: missing .claude-plugin/plugin.json`, rel(dir));
    else try { manifest = readJson(manifestPath); } catch (e) { fail(`${name}: plugin.json does not parse (${e.message})`, rel(manifestPath)); }
    if (manifest) {
      for (const key of ["name", "version", "description"]) if (!manifest[key]) fail(`${name}: plugin.json missing ${key}`, rel(manifestPath));
      if (manifest.name && manifest.name !== name) fail(`${name}: plugin.json name is ${manifest.name}`, rel(manifestPath));
    }
    if (exists(path.join(dir, ".claude-plugin", "marketplace.json"))) fail(`${name}: plugin carries its own catalog`, rel(dir));

    // History has one home, CHANGELOG.md inside the plugin so it ships with the
    // installed copy, newest first: its top entry is the version being released.
    const readme = path.join(dir, "README.md");
    if (!exists(readme)) fail(`${name}: missing README.md`, rel(dir));
    else if (/^## Changelog\s*$/m.test(fs.readFileSync(readme, "utf8"))) fail(`${name}: README carries a "## Changelog" section; history lives in CHANGELOG.md`, rel(readme));
    const changelog = path.join(dir, "CHANGELOG.md");
    if (!exists(changelog)) fail(`${name}: missing CHANGELOG.md`, rel(dir));
    else {
      const first = /^[-*] .*$/m.exec(fs.readFileSync(changelog, "utf8"))?.[0] ?? "";
      const top = /^[-*] +\**v?(\d+\.\d+\.\d+)/.exec(first)?.[1];
      if (!top) fail(`${name}: CHANGELOG.md's first entry does not start with a version`, rel(changelog));
      else if (manifest?.version && top !== manifest.version) fail(`${name}: CHANGELOG.md top entry is ${top}, plugin.json is ${manifest.version}`, rel(changelog));
    }

    for (const skill of listDirs(path.join(dir, "skills"))) {
      const md = path.join(dir, "skills", skill, "SKILL.md");
      if (!exists(md)) { fail(`${name}/${skill}: no SKILL.md`, rel(path.dirname(md))); continue; }
      const fm = parseFrontmatter(fs.readFileSync(md, "utf8"));
      if (!fm) { fail(`${name}/${skill}: SKILL.md has no frontmatter`, rel(md)); continue; }
      if (fm.name !== skill) fail(`${name}/${skill}: frontmatter name is "${fm.name}"`, rel(md));
      if (!fm.description) fail(`${name}/${skill}: frontmatter has no description`, rel(md));
      // (legacy) Four keys, so a listing costs what its description costs.
      for (const key of Object.keys(fm)) if (!SKILL_KEYS.has(key)) strict(name, `${name}/${skill}: frontmatter key "${key}" is not one of the four allowed`, rel(md));
    }

    // Hooks: known events, commands that point inside the plugin, and a hooks
    // module the host can load from the plugin's own copy.
    const hooks = path.join(dir, "hooks", "hooks.json");
    if (exists(hooks)) {
      const text = fs.readFileSync(hooks, "utf8");
      let map = null;
      try { map = readJson(hooks); } catch (e) { fail(`${name}/hooks/hooks.json does not parse (${e.message})`, rel(hooks)); }
      for (const event of Object.keys(map?.hooks ?? {})) {
        if (!HOOK_EVENTS.has(event)) fail(`${name}/hooks/hooks.json: "${event}" is not a known hook event`, rel(hooks));
      }
      for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)) {
        if (!exists(path.join(dir, m[1]))) fail(`${name}/hooks/hooks.json points at ${m[1]}, which is not in the plugin`, rel(hooks));
      }
      for (const mod of [].concat(map?.modules ?? [])) {
        const target = typeof mod === "string" ? path.resolve(path.dirname(hooks), mod) : "";
        if (!target) fail(`${name}/hooks/hooks.json: module ${JSON.stringify(mod)} is not a path`, rel(hooks));
        else if (!target.startsWith(dir + path.sep)) fail(`${name}/hooks/hooks.json: module ${mod} is outside the plugin`, rel(hooks));
        else if (!exists(target)) fail(`${name}/hooks/hooks.json: module ${mod} does not exist`, rel(hooks));
        // (legacy) A module the host loads without a build step.
        else if (!/\.(mjs|js)$/.test(target)) strict(name, `${name}/hooks/hooks.json: module ${mod} is not a .mjs or .js file`, rel(hooks));
      }
    }

    // (legacy) Plugins run on Node: one runtime to install, one to test on
    // three operating systems. Extension first, then the shebang for files
    // that carry none.
    for (const f of tracked.filter((t) => t.startsWith(`plugins/${name}/`) && !VENDORED.test(t) && !NON_NODE_ALLOWLIST.has(t))) {
      if (NON_NODE_EXT.test(f)) { strict(name, `${f} is not Node`, f); continue; }
      if (path.extname(f) || !exists(at(f))) continue;
      const shebang = /^#!(.*)/.exec(fs.readFileSync(at(f), "utf8").slice(0, 200))?.[1];
      if (shebang && !/\bnode\b/.test(shebang)) strict(name, `${f} runs under "${shebang.trim()}", not Node`, f);
    }
  }
  if (failures() === pluginFailures) ok(`${pluginDirs.length} plugin director${pluginDirs.length === 1 ? "y" : "ies"}: manifests, names, README, CHANGELOG, skills, hooks`);

  const ratchetFailures = failures();
  for (const name of [...legacy].sort()) {
    if (waived.get(name)) note(`${name} is legacy: ${waived.get(name)} finding(s) waived`);
    else fail(`${name} no longer needs its legacy flag: delete scripts/plugins/${name}.json`, `scripts/plugins/${name}.json`);
  }
  if (failures() === ratchetFailures) ok(legacy.size ? `${legacy.size} legacy plugin(s), each still needing its flag` : "no legacy plugins");

  // ---- tree-wide -------------------------------------------------------
  let text = 0, crlf = 0, abs = 0, junk = 0;
  for (const f of tracked) {
    if (/(^|\/)(\.DS_Store|node_modules|__pycache__)(\/|$)/.test(f)) { fail(`${f} is junk and is tracked`, f); junk++; }
    const full = at(f);
    if (!exists(full) || fs.lstatSync(full).isSymbolicLink()) continue;
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) continue;
    text++;
    const body = buf.toString("utf8");
    if (body.includes("\r\n")) { fail(`${f} has CRLF line endings`, f); crlf++; }
    if (!VENDORED.test(f) && ABS_PATH.test(body)) { fail(`${f} carries an absolute machine path`, f); abs++; }
  }
  if (!junk) ok("no .DS_Store, node_modules, or __pycache__ tracked");
  if (!crlf) ok(`no CRLF in ${text} tracked text file(s)`);
  if (!abs) ok("no absolute machine paths in tracked files");

  let checked = 0, bad = 0;
  for (const f of tracked.filter((t) => t.endsWith(".mjs") && exists(at(t)))) {
    try { execFileSync(process.execPath, ["--check", at(f)], { stdio: "pipe" }); checked++; }
    catch (e) { fail(`${f} fails node --check: ${String(e.stderr ?? e).split("\n").find((l) => l.includes("Error")) ?? ""}`, f); bad++; }
  }
  if (!bad) ok(`node --check passes on ${checked} .mjs file(s)`);

  // Shell scripts parse, for as long as any are left. Windows has no bash to
  // trust (the one on PATH may be the WSL stub), so the check is skipped there.
  const shell = tracked.filter((t) => t.endsWith(".sh") && exists(at(t)));
  if (shell.length && process.platform !== "win32") {
    const broken = shell.filter((f) => spawnSync("bash", ["-n", at(f)], { stdio: "pipe" }).status !== 0);
    for (const f of broken) fail(`${f} fails bash -n`, f);
    if (!broken.length) ok(`bash -n passes on ${shell.length} .sh file(s)`);
  }

  // ---- hubs ------------------------------------------------------------
  // AGENTS.md is the one instruction file; CLAUDE.md only points at it, as a
  // link (or, where a checkout cannot hold one, the link's text or an import).
  const hubFailures = failures();
  for (const hub of ["AGENTS.md", "plugins/AGENTS.md", ".agents/rules/dev-rules.md"]) if (!exists(at(hub))) fail(`${hub} is missing`, hub);
  if (exists(at("AGENTS.md")) && !fs.readFileSync(at("AGENTS.md"), "utf8").includes("@.agents/rules/dev-rules.md")) fail("AGENTS.md does not import @.agents/rules/dev-rules.md", "AGENTS.md");
  let twin = null;
  try { twin = fs.lstatSync(at("CLAUDE.md")).isSymbolicLink() ? fs.readlinkSync(at("CLAUDE.md")) : fs.readFileSync(at("CLAUDE.md"), "utf8").trim(); } catch { /* reported below */ }
  if (!["AGENTS.md", "@AGENTS.md"].includes(twin)) fail("CLAUDE.md is not a link to AGENTS.md", "CLAUDE.md");
  if (failures() === hubFailures) ok("AGENTS.md hubs present, CLAUDE.md points at AGENTS.md");

  console.log(failures() ? `validate: ${failures()} failure(s)` : "validate: all green");
  process.exitCode = failures() ? 1 : 0;
}
