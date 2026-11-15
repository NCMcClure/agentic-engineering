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
// scripts/plugins/<name>.json carries a plugin's gate data: `shared` (its
// copies of files in scripts/shared/) and `critical` (the cap on its critical
// lines, and the allowance for its session briefing).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HASH_PAIRS, addressFinder, areaOwner, fail, failures, gitLsFiles, isRecording, isTemplateCopy, namedDirs, namedPaths, note, ok, parseFrontmatter, parseHookCommand, placed, pluginRootPaths, readJson, sha256, sharedCopies, skillBody, stringSet } from "./lib.mjs";

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
// `user-invocable: false` keeps a skill agents call out of the slash menu. It is never the way to hide one from
// the model: the host refuses a call on a `disable-model-invocation` skill and tells the model to stop.
const SKILL_KEYS = new Set(["name", "description", "disable-model-invocation", "user-invocable", "argument-hint"]);
// Non-Node files a plugin ships on purpose, by exact path. Two need numpy and
// a model download, which no stdlib rewrite replaces; the third fronts a
// MkDocs site, which is Python already wherever it runs.
const NON_NODE_ALLOWLIST = new Set([
  "plugins/agentcraft/skills/but-first-planning/routes/spec-init/assets/comments-server.py",
  "plugins/agentcraft/skills/perceptual-loop/scripts/keypoints.py",
  "plugins/agentcraft/skills/perceptual-loop/scripts/semantic.py",
]);
const NON_NODE_EXT = /\.(py|sh|bash|zsh|ps1|rb|pl)$/;
// A vendored app tree carries its toolchain's own files; path rules skip it.
// It sits at a plugin's root, or at an area's once the plugin is one.
const VENDORED = /^plugins\/[^/]+\/(?:skills\/[^/]+\/)?app\//;
const ABS_PATH = new RegExp("/(?:Users|home/[a-z]|fast)/");
// A Node file here never calls exit, and neither does a one-line command a
// test hands to node: with NODE_USE_SYSTEM_CA set, Node 24 reads the system's
// certificates on a thread at start-up, and an exit that lands before it has
// finished crashes the process. A line that is only a comment may name it.
const NODE_FILE = /^(?:plugins|scripts)\/.*\.(?:mjs|js|cjs)$/;
const EXIT_CALL = /^(?!\s*(?:\/\/|\/?\*)).*\bprocess\.exit\(/;
// Critical lines are paid for on every request of every session, so each
// plugin's lines and chain lines stay under its own cap, all of them together
// under the combined target, and each session hook's worst case under the
// host's limit on a hook's output, past which the model reads a preview.
const CRITICAL_TOTAL = 7500;
const HOOK_OUTPUT_CAP = 10000;
// What the first enabled plugin can add to its own block: the catalog notices
// or the question, and a migration's report.
const ASKER_ALLOWANCE = 2600;
const KERNEL = "scripts/shared/critical-context.mjs";
// A route is a document no host parses, so its frontmatter is the table's data and nothing else.
const ROUTE_KEYS = new Set(["name", "description", "argument-hint"]);
// An area is one entry in the skill listing, and the host cuts an entry's
// description at 1,536 characters. Invoking an area again with another route
// appends its body to the conversation again, so the body has a cap too. A
// cue is what a table says of one route, in a line.
const AREA_DESCRIPTION_CAP = 1536;
const AREA_BODY_CAP = 8000;
const CUE_CAP = 60;
// The addresses a stub still answers: the ones a file copied into a user's
// repo, or their own rules file, still prints. An alias points at a route and
// holds none of its steps.
const ALIASES = { "agentic-teamwork": ["init-project"], "but-first-planning": ["plan-decompose", "spec-open"], "write-like-me": ["review"] };
const ALIAS_BODY_CAP = 600;
// What else a stub may hold: the README publishes a curl to this path, so it stays and says where to go.
const STUB_EXTRAS = { "but-first-planning": ["install.mjs"] };
// A marker one plugin writes into a user's AGENTS.md, which reads like an address and is not one.
const NOT_ADDRESSES = new Set(["agent-works:plugins"]);
// The plugin that is a Claude Code mod, by the paths its files have as a
// plugin's own: the handlers that answer its tools, and the pattern the card
// sync reads a tool's name with.
const MOD = { plugin: "agent-works", handlers: "plugins/agentcraft/skills/agent-works/hooks/kanban/register.mjs", observer: "plugins/agentcraft/skills/agent-works/lib/sync.mjs" };

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
  await validate();
}

async function validate() {
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

  // ---- per-plugin gate data --------------------------------------------
  const pluginDirs = listDirs(at("plugins"));
  const meta = new Map();
  for (const file of isDir(at("scripts", "plugins")) ? fs.readdirSync(at("scripts", "plugins")).filter((f) => f.endsWith(".json")).sort() : []) {
    const name = file.slice(0, -5);
    const where = `scripts/plugins/${file}`;
    if (!pluginDirs.includes(name)) { fail(`${where} describes a plugin that is not under plugins/`, where); continue; }
    try { meta.set(name, readJson(at(where))); } catch (e) { fail(`${where} does not parse (${e.message})`, where); }
  }

  // ---- per plugin ------------------------------------------------------
  const entryNames = new Set(catalog.plugins.map((p) => p.name));
  for (const dir of pluginDirs) if (!entryNames.has(dir)) fail(`plugins/${dir} has no catalog entry`, `plugins/${dir}`);

  const pluginFailures = failures();
  // Named by its path as a plugin's own, and found where that is once the plugin is an area.
  const allowed = new Set([...NON_NODE_ALLOWLIST].map((file) => placed(ROOT, file)));
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
      // Five keys, so a listing costs what its description costs.
      for (const key of Object.keys(fm)) if (!SKILL_KEYS.has(key)) fail(`${name}/${skill}: frontmatter key "${key}" is not one of the five allowed`, rel(md));
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
      // A Node hook sits behind a guard, so a machine without Node hears about
      // it once at session start instead of failing on every event.
      for (const [event, groups] of Object.entries(map?.hooks ?? {})) {
        for (const hook of [].concat(groups ?? []).flatMap((g) => g?.hooks ?? [])) {
          if (!/\bnode\b/.test(String(hook.command ?? "")) || !/\.m?js\b/.test(String(hook.command))) continue;
          const parsed = parseHookCommand(hook.command, name);
          const what = `${name}/hooks/hooks.json: the ${event} command`;
          if (!parsed) fail(`${what} is not a guard followed by node "\${CLAUDE_PLUGIN_ROOT}/<file>"`, rel(hooks));
          else if (!parsed.guard) fail(`${what} for ${parsed.script} has no guard for a machine without Node`, rel(hooks));
          else if (event === "SessionStart" && parsed.guard !== "loud") fail(`${what} for ${parsed.script} must use the guard that tells the person Node is missing`, rel(hooks));
          if (parsed && event === "SessionStart" && !hook.statusMessage) fail(`${what} for ${parsed.script} has no statusMessage`, rel(hooks));
        }
      }
      for (const mod of [].concat(map?.modules ?? [])) {
        const target = typeof mod === "string" ? path.resolve(path.dirname(hooks), mod) : "";
        if (!target) fail(`${name}/hooks/hooks.json: module ${JSON.stringify(mod)} is not a path`, rel(hooks));
        else if (!target.startsWith(dir + path.sep)) fail(`${name}/hooks/hooks.json: module ${mod} is outside the plugin`, rel(hooks));
        else if (!exists(target)) fail(`${name}/hooks/hooks.json: module ${mod} does not exist`, rel(hooks));
        // A module the host loads without a build step.
        else if (!/\.(mjs|js)$/.test(target)) fail(`${name}/hooks/hooks.json: module ${mod} is not a .mjs or .js file`, rel(hooks));
      }
    }

    // Plugins run on Node: one runtime to install, one to test on
    // three operating systems. Extension first, then the shebang for files
    // that carry none.
    for (const f of tracked.filter((t) => t.startsWith(`plugins/${name}/`) && !VENDORED.test(t) && !allowed.has(t))) {
      if (NON_NODE_EXT.test(f)) { fail(`${f} is not Node`, f); continue; }
      if (path.extname(f) || !exists(at(f))) continue;
      const shebang = /^#!(.*)/.exec(fs.readFileSync(at(f), "utf8").slice(0, 200))?.[1];
      if (shebang && !/\bnode\b/.test(shebang)) fail(`${f} runs under "${shebang.trim()}", not Node`, f);
    }
  }
  if (failures() === pluginFailures) ok(`${pluginDirs.length} plugin director${pluginDirs.length === 1 ? "y" : "ies"}: manifests, names, README, CHANGELOG, skills, hooks`);

  // ---- shared files ---------------------------------------------------
  // A file several plugins ship has one copy that is edited, in
  // scripts/shared/, and every plugin's copy is byte-identical to it.
  const { copies, problems } = sharedCopies(ROOT);
  const sharedFailures = failures();
  for (const problem of problems) fail(problem, "scripts/plugins");
  for (const { copy, canonical } of copies) {
    if (!exists(at(canonical))) fail(`${copy} is listed as shared, but ${canonical} does not exist`, canonical);
    else if (!exists(at(copy))) fail(`${copy} is missing: node scripts/sync-shared.mjs --write`, copy);
    else if (sha256(at(copy)) !== sha256(at(canonical))) fail(`${copy} has drifted from ${canonical}: edit that one, then node scripts/sync-shared.mjs --write`, copy);
  }
  // What ships in several plugins is tested once, where it is edited.
  const sharedFiles = isDir(at("scripts", "shared")) ? fs.readdirSync(at("scripts", "shared")).sort() : [];
  for (const f of sharedFiles) {
    if (!f.endsWith(".mjs")) fail(`scripts/shared/${f} is not a .mjs file`, `scripts/shared/${f}`);
    else if (!exists(at("scripts", "test-hooks", "unit", f.replace(/\.mjs$/, ".test.mjs")))) fail(`scripts/shared/${f} has no scripts/test-hooks/unit/${f.replace(/\.mjs$/, ".test.mjs")}`, `scripts/shared/${f}`);
  }
  if (failures() === sharedFailures) ok(`${copies.length} shared copy/copies match scripts/shared, ${sharedFiles.length} shared file(s) each with a suite`);

  // ---- critical lines --------------------------------------------------
  const speakers = pluginDirs.filter((p) => exists(at("plugins", p, "hooks", "critical.json")));
  const criticalFailures = failures();
  let kernel = null;
  if (speakers.length) {
    try { kernel = await import(pathToFileURL(at(KERNEL)).href); } catch (e) { fail(`${KERNEL} does not load (${e.message})`, KERNEL); }
  }
  let total = kernel ? kernel.SHARED_LINE.length + 3 : 0;
  for (const plugin of kernel ? speakers : []) {
    const file = `plugins/${plugin}/hooks/critical.json`;
    const bad = (what) => fail(`${file}: ${what}`, file);
    if (!kernel.ORDER.includes(plugin)) bad(`${plugin} is not in ORDER in ${KERNEL}`);
    if (!copies.some((c) => c.copy === `plugins/${plugin}/hooks/critical-context.mjs`)) bad(`scripts/plugins/${plugin}.json does not list hooks/critical-context.mjs under shared`);
    let registered = {};
    try { registered = readJson(at("plugins", plugin, "hooks", "hooks.json")).hooks ?? {}; } catch { /* reported above */ }
    for (const event of ["SessionStart", "SubagentStart"]) {
      if (!JSON.stringify(registered[event] ?? "").includes("/hooks/session-start.mjs")) bad(`hooks.json does not run hooks/session-start.mjs on ${event}`);
    }
    let data;
    try { data = readJson(at(file)); } catch (e) { bad(e.message); continue; }
    if (data.plugin !== plugin) bad(`plugin is ${JSON.stringify(data.plugin)}, expected ${plugin}`);
    const entries = [...(data.lines ?? []), ...(data.chains ?? [])];
    for (const l of entries) {
      const which = `"${String(l.text).slice(0, 40)}"`;
      if (typeof l.text !== "string" || !l.text) bad(`${which} has no text`);
      if (!kernel.AUDIENCES.includes(l.for)) bad(`${which} needs for: ${kernel.AUDIENCES.join(" or ")}`);
      if (!kernel.MODES.includes(l.mode)) bad(`${which} needs mode: ${kernel.MODES.join(", ")}`);
    }
    for (const c of data.chains ?? []) {
      if (!kernel.ORDER.includes(c.partner) || c.partner === plugin) bad(`chain partner ${JSON.stringify(c.partner)} is not another plugin in ORDER`);
    }
    // What the block costs as printed: a header, and "- " plus a newline a line.
    const size = `Critical, from ${plugin}:`.length + entries.reduce((n, l) => n + String(l.text).length + 3, 0);
    total += size;
    const { cap, briefing = 0 } = meta.get(plugin)?.critical ?? {};
    if (!Number.isInteger(cap)) bad(`scripts/plugins/${plugin}.json carries no critical.cap`);
    else if (size > cap) bad(`critical and chain lines are ${size} characters, over the ${cap} cap`);
    const worst = size + kernel.SHARED_LINE.length + 3 + briefing + ASKER_ALLOWANCE;
    if (worst > HOOK_OUTPUT_CAP) bad(`the session hook can print ${worst} characters, over the host's ${HOOK_OUTPUT_CAP}`);
  }
  if (total > CRITICAL_TOTAL) fail(`critical lines total ${total} characters across the plugins, over the ${CRITICAL_TOTAL} target`, "plugins");
  if (failures() === criticalFailures) ok(`critical lines within budget (${total} of ${CRITICAL_TOTAL} characters across ${speakers.length} plugin(s))`);

  // ---- the generated guide ---------------------------------------------
  // docs/plugins.md is written from the catalog, the manifests and the skills'
  // own descriptions, so a copy that differs from a fresh one is stale.
  try {
    const { GUIDE, guide } = await import(pathToFileURL(at("scripts", "gen-guide.mjs")).href);
    const have = exists(at(GUIDE)) ? fs.readFileSync(at(GUIDE), "utf8") : null;
    if (have === null) fail(`${GUIDE} is missing: node scripts/gen-guide.mjs --write`, GUIDE);
    else if (have !== guide(ROOT)) fail(`${GUIDE} is stale: node scripts/gen-guide.mjs --write`, GUIDE);
    else ok(`${GUIDE} matches the catalog, the manifests and the skills`);
  } catch (e) { fail(`the plugin guide could not be generated (${e.message})`, "scripts/gen-guide.mjs"); }

  // ---- the entry skill ----------------------------------------------------
  // The one skill a person types. Its flow is written by hand; its area
  // tables are generated from start-here.json and the tree, so every address
  // a person is handed is one that exists, and every area is asked about.
  try {
    const entry = await import(pathToFileURL(at("scripts", "gen-guide.mjs")).href);
    if (entry.hasEntry(ROOT)) {
      const before = failures();
      const data = entry.ENTRY_DATA, file = entry.ENTRY_FILE;
      const front = entry.readEntry(ROOT);
      // Every plugin the catalog ships from this tree is an area, bar the entry
      // skill's own, and so is every area that plugin holds: a plugin that
      // moved in is both, under one name.
      const areas = [...new Set([...catalog.plugins.filter((p) => typeof p.source === "string" && p.name !== entry.ENTRY_PLUGIN).map((p) => p.name), ...entry.areas(ROOT).filter((a) => a.plugin === entry.ENTRY_PLUGIN).map((a) => a.area)])];
      const asked = front.groups.flatMap((g) => g.areas);
      for (const name of areas) if (!asked.includes(name)) fail(`${data}: no group asks about ${name}, so a person is never offered it`, data);
      for (const name of asked) {
        if (!areas.includes(name)) fail(`${data}: a group names ${name}, which is not a plugin of this catalog or an area of ${entry.ENTRY_PLUGIN}`, data);
        if (asked.indexOf(name) !== asked.lastIndexOf(name)) fail(`${data}: ${name} is in two groups`, data);
      }
      for (const name of front.unknown) fail(`${data}: an entry for ${name}, which no group names`, data);
      // A question takes two to four options and a call four questions; the last group carries "Learn more" too.
      if (front.groups.length < 1 || front.groups.length > 4) fail(`${data}: ${front.groups.length} groups; a call takes one to four questions`, data);
      front.groups.forEach((g, i) => {
        const options = g.areas.length + (i === front.groups.length - 1 ? 1 : 0);
        const label = g.title || `group ${i + 1}`;
        if (!g.title) fail(`${data}: group ${i + 1} has no title, which is the question a person is asked`, data);
        if (!g.header || g.header.length > 12) fail(`${data}: "${label}" needs a header of 1 to 12 characters, the question's short label`, data);
        if (options < 2 || options > 4) fail(`${data}: "${label}" offers ${options} option${options === 1 ? "" : "s"}; a question takes two to four`, data);
      });
      for (const a of front.areas) {
        if (!a.listed) { fail(`${data}: ${a.name} has no entry`, data); continue; }
        if (!a.cue || a.cue.length > 60) fail(`${data}: ${a.name} needs a cue of 1 to 60 characters, what a person picks it to do`, data);
        if (!a.how || a.how.includes("\n")) fail(`${data}: ${a.name} needs a one-line how`, data);
        if (a.uses.length < 1 || a.uses.length > 4) fail(`${data}: ${a.name} has ${a.uses.length} uses; a question takes one to four`, data);
        for (const u of a.uses) {
          if (!u.want) fail(`${data}: a use of ${a.name} says nothing a person would want`, data);
          if (!u.found) { fail(`${data}: ${a.name} hands off to ${u.to || "nothing"}, which is not one of its skills or routes`, data); continue; }
          if (u.starts !== "agent" && u.starts !== "person") fail(`${data}: ${u.address} starts by ${JSON.stringify(u.starts)}; it is agent or person`, data);
          else if (u.person !== (u.starts === "person")) fail(`${data}: ${u.address} ${u.person ? "is one only a person can start, so its use says \"starts\": \"person\"" : "can be started by an agent, so its use carries no \"starts\": \"person\""}`, data);
        }
      }
      const text = exists(at(file)) ? fs.readFileSync(at(file), "utf8") : null;
      if (text === null) fail(`${file} is missing: ${data} is there, and the skill it belongs to is written by hand`, file);
      else {
        const fm = parseFrontmatter(text) ?? {};
        if (String(fm["disable-model-invocation"]) === "true" || String(fm["user-invocable"]) === "false") fail(`${file}: the entry skill is the one a person types and an agent may be sent to; it carries neither disable-model-invocation nor user-invocable: false`, file);
        const count = (needle) => text.split(needle).length - 1;
        if (count(entry.AREAS_END) !== 1 || count(entry.AREAS_TABLE_HEAD) !== 1) fail(`${file}: it holds one generated areas section, from "${entry.AREAS_HEADING}" to its end marker`, file);
        else if (text !== entry.renderEntry(ROOT)) fail(`${file} is stale: node scripts/gen-guide.mjs --write`, file);
      }
      if (failures() === before) ok(`the entry skill offers ${front.areas.length} areas in ${front.groups.length} questions, and every hand-off names a skill that is there`);
    }
  } catch (e) { fail(`the entry skill could not be read (${e.message})`, "scripts/gen-guide.mjs"); }

  // ---- one plugin of areas ------------------------------------------------
  // The plugins are becoming areas of one plugin. Until they have, the gate
  // takes both shapes: a plugin with its own skills, held to everything above,
  // and an area of another plugin, held to what follows. None of it finds
  // anything to judge in a tree with no area and no stub.
  let gen = null;
  try { gen = await import(pathToFileURL(at("scripts", "gen-guide.mjs")).href); } catch { /* reported with the guide */ }
  const textFiles = tracked.filter((f) => exists(at(f)) && !fs.lstatSync(at(f)).isSymbolicLink() && !fs.readFileSync(at(f)).includes(0));
  const foundAreas = gen ? gen.areas(ROOT) : [];
  const local = catalog.plugins.filter((p) => !isExternal(p) && p.name && isDir(at("plugins", p.name)));
  // A stub is what is left of a plugin that moved into another as an area.
  const stubs = local.map((p) => ({ name: p.name, owner: areaOwner(ROOT, p.name) })).filter((s) => s.owner && s.owner !== s.name);

  // ---- areas ---------------------------------------------------------------
  // An area is a skill directory that holds routes/. It is user-invocable:
  // false, out of the slash menu, and a model can still call it: one hidden
  // from the model is refused, and the refusal tells the model to do the work
  // no other way. Each route is a document, routes/<route>/ROUTE.md, which no
  // host lists or refuses, with its frontmatter as the table's data.
  {
    const before = failures();
    for (const { plugin, area } of foundAreas) {
      const who = `${plugin}/${area}`, dir = `plugins/${plugin}/skills/${area}`;
      const file = gen.areaFile(plugin, area), data = gen.areaData(plugin, area);
      let door = null;
      try { door = gen.readArea(ROOT, plugin, area); } catch (e) { fail(`${data} is missing or does not parse (${e.message})`, data); }
      if (door) {
        if (!door.lead) fail(`${who}: the area has no lead; door.json's lead is one sentence on what the area is for`, data);
        else if (/[\r\n]/.test(door.lead)) fail(`${who}: the area's lead holds a line break; a lead is one line`, data);
        if (!door.routes.some((r) => r.name === door.default)) fail(`${who}: the area has no default route${door.default ? `: "${door.default}" is not one of its routes` : ""}`, data);
        for (const r of door.routes) {
          if (!r.cue || r.cue.length > CUE_CAP) fail(`${who}: the cue for ${r.name} is ${r.cue.length} characters; a cue is 1 to ${CUE_CAP}`, data);
          if (!["agent", "person"].includes(r.starts)) fail(`${who}: route ${r.name} is started by ${JSON.stringify(r.starts)}; it is "agent" or "person"`, data);
          if (!r.fm) fail(`${who}: the area routes ${r.name}, and routes/${r.name}/ROUTE.md is not there`, data);
        }
        for (const route of door.unrouted) fail(`${who}: route ${route} is not in the area's Route table; give it a cue in door.json`, data);
      }
      const have = exists(at(file)) ? fs.readFileSync(at(file), "utf8") : null;
      // One the generator refuses (a code fence that never closes) says why
      // itself, and is neither stale nor current.
      let want = null;
      if (door) try { want = gen.renderArea(ROOT, plugin, area); } catch (e) { fail(e.message, file); }
      if (want !== null && have !== want) fail(`${file} is stale or missing; run node scripts/gen-guide.mjs --write`, file);
      if (have !== null) {
        // One generated block has one end marker and one table header.
        const lines = have.split("\n").map((l) => l.trim());
        const ends = lines.filter((l) => l === gen.ROUTE_END).length, heads = lines.filter((l) => l === gen.ROUTE_TABLE_HEAD).length;
        if (ends !== 1 || heads !== 1) fail(`${who}: the area holds ${ends} end marker${ends === 1 ? "" : "s"} and ${heads} Route table header${heads === 1 ? "" : "s"}; one generated block has one of each. Delete the leftover lines by hand, then run node scripts/gen-guide.mjs --write`, file);
        const fm = parseFrontmatter(have) ?? {};
        if ((fm.description ?? "").length > AREA_DESCRIPTION_CAP) fail(`${who}: the area's description is ${fm.description.length} characters, over the ${AREA_DESCRIPTION_CAP} cap`, file);
        const body = skillBody(have).length;
        if (body > AREA_BODY_CAP) fail(`${who}: the area's body is ${body} characters, over the ${AREA_BODY_CAP} cap`, file);
        if (fm["user-invocable"] !== "false") fail(`${who}: an area carries user-invocable: false, which keeps it out of the slash menu while a model can call it`, file);
        if (fm["disable-model-invocation"] === "true") fail(`${who}: an area stays callable: disable-model-invocation: true hides it from the model, and the host refuses the call`, file);
      }
      const documents = new Set(gen.routeNames(ROOT, plugin, area));
      for (const route of listDirs(at(dir, "routes"))) {
        const routeFile = gen.routeFile(plugin, area, route);
        if (!documents.has(route)) { fail(`${who}: routes/${route} has no ROUTE.md`, `${dir}/routes/${route}`); continue; }
        const routeFm = parseFrontmatter(fs.readFileSync(at(routeFile), "utf8"));
        if (!routeFm) { fail(`${who}: routes/${route}/ROUTE.md has no frontmatter`, routeFile); continue; }
        if (routeFm.name !== route) fail(`${who}: routes/${route}/ROUTE.md's frontmatter name is "${routeFm.name}"`, routeFile);
        if (!routeFm.description) fail(`${who}: routes/${route}/ROUTE.md's frontmatter has no description`, routeFile);
        for (const key of Object.keys(routeFm)) if (!ROUTE_KEYS.has(key)) fail(`${who}: routes/${route}/ROUTE.md's frontmatter key "${key}" is not one a route carries (${[...ROUTE_KEYS].join(", ")})`, routeFile);
      }
      for (const f of tracked) {
        if (f.startsWith(`${dir}/`) && f !== file && path.basename(f) === "SKILL.md") fail(`${f} is a SKILL.md below the ${area} area; a route is routes/<route>/ROUTE.md, a document no host lists`, f);
      }
    }
    // A plugin that holds areas lists them and the skill a person types, and nothing else.
    for (const plugin of new Set(foundAreas.map((a) => a.plugin))) {
      for (const skill of listDirs(at("plugins", plugin, "skills"))) {
        if (skill !== gen.ENTRY_SKILL && !isDir(at("plugins", plugin, "skills", skill, "routes"))) fail(`${plugin}/${skill}: a skill of a plugin that holds areas is ${gen.ENTRY_SKILL} or an area; this one is neither. Make it a route, skills/<area>/routes/${skill}/ROUTE.md`, `plugins/${plugin}/skills/${skill}`);
      }
    }
    if (foundAreas.length && failures() === before) ok(`${foundAreas.length} area${foundAreas.length === 1 ? "" : "s"}: current, within the caps, user-invocable: false and callable, every route a ROUTE.md in its table, no SKILL.md below`);
  }

  // ---- stubs ----------------------------------------------------------------
  // An install of the old name has to end up running the plugin it moved
  // into, once: so the stub depends on that plugin, which a host then
  // installs and enables, and it ships nothing that would run or be listed
  // beside the real thing. The one exception is an alias, a skill at an
  // address that a copied file still prints, which gives the new address.
  {
    const before = failures();
    for (const { name, owner } of stubs) {
      const dir = `plugins/${name}`;
      let manifest = {};
      try { manifest = readJson(at(dir, ".claude-plugin", "plugin.json")); } catch { /* reported with the plugin */ }
      if (JSON.stringify(manifest.dependencies) !== JSON.stringify([owner])) fail(`${name}: a stub's plugin.json carries "dependencies": ["${owner}"], so an install of the old name brings the plugin it moved into`, dir);
      if (manifest.description && !manifest.description.includes(owner)) fail(`${name}: a stub's description says where it moved: it names ${owner}`, dir);
      for (const key of ["hooks", "agents", "mcpServers", "commands", "userConfig"]) if (key in manifest) fail(`${name}: a stub's plugin.json names ${key}, and a stub ships none`, dir);
      const aliases = ALIASES[name] ?? [], extras = STUB_EXTRAS[name] ?? [];
      const allowed = new Set([".claude-plugin/plugin.json", "README.md", "CHANGELOG.md", ...extras, ...aliases.map((a) => `skills/${a}/SKILL.md`)]);
      for (const f of tracked.filter((t) => t.startsWith(`${dir}/`))) {
        if (!allowed.has(f.slice(dir.length + 1))) fail(`${f}: a stub holds its manifest, a README.md, a CHANGELOG.md${aliases.length ? `, its aliases (${aliases.join(", ")})` : ""}${extras.length ? `, and ${extras.join(", ")}` : ""}, and nothing else; this belongs in plugins/${owner}/skills/${name}/`, f);
      }
      const routes = new Set(gen.routeNames(ROOT, owner, name));
      for (const alias of aliases) {
        const md = `${dir}/skills/${alias}/SKILL.md`;
        if (!exists(at(md))) { fail(`${name}: the alias ${alias} is missing; a file copied into a user's repo still prints its old address`, dir); continue; }
        const text = fs.readFileSync(at(md), "utf8");
        const fm = parseFrontmatter(text) ?? {};
        // A model follows an old address too, and a hidden skill refuses it
        // and tells it to stop: so an alias is callable, out of the slash
        // menu, and says only where to go.
        if (fm["disable-model-invocation"] === "true") fail(`${name}/${alias}: an alias stays callable by a model: hidden, the host refuses the old address and tells the model to stop`, md);
        if (fm["user-invocable"] !== "false") fail(`${name}/${alias}: an alias carries user-invocable: false, which keeps it out of the slash menu`, md);
        if (skillBody(text).length > ALIAS_BODY_CAP) fail(`${name}/${alias}: an alias says where the route moved and nothing else; its body is ${skillBody(text).length} characters, over ${ALIAS_BODY_CAP}`, md);
        if (!routes.has(alias)) fail(`${name}/${alias}: an alias is named after a route of the ${name} area, and ${alias} is not one`, md);
        else if (!text.includes(`/${owner}:${name} ${alias}`)) fail(`${name}/${alias}: an alias gives the new address, /${owner}:${name} ${alias}`, md);
      }
    }
    // A stub installs, and on a build that does not resolve its dependency it
    // loads nothing: a line that tells its reader to install one sends them to
    // an empty plugin. A stub's own files, a changelog, a recording, and a
    // template copy keep what they say.
    const install = stubs.length ? new RegExp(`\\binstall\\b[^\\n]*?(?<![\\w-])(${stubs.map((s) => s.name).join("|")})@${catalog.name}(?![\\w-])`) : null;
    for (const f of install ? textFiles : []) {
      if (stubs.some((s) => f.startsWith(`plugins/${s.name}/`)) || path.basename(f) === "CHANGELOG.md" || isRecording(f) || isTemplateCopy(f)) continue;
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        const hit = install.exec(line);
        if (hit) fail(`${f}:${i + 1}: tells its reader to install ${hit[1]}@${catalog.name}, a stub; the plugin to install is ${areaOwner(ROOT, hit[1])}@${catalog.name}`, f);
      });
    }
    if (stubs.length && failures() === before) ok(`${stubs.length} stub${stubs.length === 1 ? "" : "s"}: each depends on the plugin it moved into and ships no hook, agent, or MCP server, and no skill but its aliases; no install line names one`);
  }

  // ---- addresses ------------------------------------------------------------
  // `/<plugin>:<name>`, with the slash or bare, is how a file names a skill,
  // an agent, or an MCP server, and an address whose target was renamed or
  // removed reads exactly like one that works. Once the tree holds an area,
  // each one in a tracked file resolves to something its plugin ships.
  //
  // A route is reached through its area, `/<plugin>:<area> <route>`. The word
  // after a slash-led area address is the first word of its arguments, so it
  // is held to the area's routes: a sentence that names the area alone ends
  // the address with punctuation or the end of its code span. A route's own
  // name as a skill, `/<plugin>:<route>`, names nothing and fails with what to
  // write. So does an area's old name as a plugin, `/<area>:<route>`: the stub
  // left under that name ships no such skill. A recording names a skill as
  // data and is not held to that, a template copy is another repo's file, and
  // a CHANGELOG.md is history.
  if (foundAreas.length) {
    const before = failures();
    const targets = new Map();
    for (const entry of local) {
      const dir = at("plugins", entry.name);
      const md = (sub) => (isDir(path.join(dir, sub)) ? fs.readdirSync(path.join(dir, sub)).filter((n) => n.endsWith(".md")).map((n) => n.slice(0, -3)) : []);
      let servers = {};
      try { servers = readJson(path.join(dir, ".mcp.json")).mcpServers ?? {}; } catch { /* the plugin ships no MCP server */ }
      targets.set(entry.name, {
        skill: new Set(listDirs(path.join(dir, "skills")).filter((skill) => exists(path.join(dir, "skills", skill, "SKILL.md")))),
        agent: new Set(md("agents")),
        server: new Set(Object.keys(servers)),
        areas: new Map(foundAreas.filter((a) => a.plugin === entry.name).map(({ plugin, area }) => [area, new Set(gen.routeNames(ROOT, plugin, area))])),
      });
    }
    // An area was a plugin, and what named it then names nothing now: the old
    // name is read as a plugin's too, so an address left behind is found.
    const owners = new Map([...targets].flatMap(([plugin, target]) => [...target.areas.keys()].filter((area) => area !== plugin).map((area) => [area, plugin])));
    const find = addressFinder([...new Set([...targets.keys(), ...owners.keys()])]);
    const counted = { skill: 0, agent: 0, server: 0, route: 0 };
    for (const f of textFiles) {
      if (path.basename(f) === "CHANGELOG.md" || VENDORED.test(f)) continue;
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        for (const a of find(line)) {
          if (NOT_ADDRESSES.has(`${a.plugin}:${a.name}`)) continue;
          // The area's old name as a plugin: `/<area>:<route>`, or through the
          // skill named after it, `/<area>:<area> <route>`.
          const owner = owners.get(a.plugin);
          if (owner) {
            if (isRecording(f)) continue;
            const through = a.name === a.plugin, route = through ? a.route : a.name;
            // An agent and an MCP server are the one plugin's own now, named
            // with no area: `<plugin>:<name>`, which is not a route to pass.
            const own = targets.get(owner), shipped = !through && (own.agent.has(a.name) || own.server.has(a.name));
            const known = shipped || (route ? own.areas.get(a.plugin).has(route) : through);
            const write = shipped ? `${a.slash ? "/" : ""}${owner}:${a.name}` : `/${owner}:${a.plugin}${route ? ` ${route}` : ""}`;
            // A stub's alias answers its own old address.
            if (f.startsWith(`plugins/${a.plugin}/skills/`) && (ALIASES[a.plugin] ?? []).includes(a.name)) continue;
            if (!isTemplateCopy(f)) fail(`${f}:${i + 1}: ${a.text} names ${a.plugin} as a plugin, and it is an area of ${owner}; write ${write}`, f);
            else if (!known) fail(`${f}:${i + 1}: ${a.text} names nothing: ${route} is not a route of the ${a.plugin} area`, f);
            continue;
          }
          const target = targets.get(a.plugin);
          const kind = ["skill", "agent", "server"].find((k) => target[k].has(a.name));
          if (!kind) {
            if (isRecording(f) || isTemplateCopy(f)) continue;
            // A route is a document, so the plugin has no skill of its name.
            const within = [...target.areas].filter(([, documents]) => documents.has(a.name)).map(([area]) => area);
            if (within.length) fail(`${f}:${i + 1}: ${a.text} names a route of the ${within.join(" and the ")} area directly; write /${a.plugin}:${within[0]} ${a.name}`, f);
            else fail(`${f}:${i + 1}: ${a.text} is not a skill, agent, or MCP server of ${a.plugin}`, f);
            continue;
          }
          counted[kind]++;
          // The word after an area's address is its route.
          const routes = target.areas.get(a.name);
          if (!a.route || !routes) continue;
          if (routes.has(a.route)) counted.route++;
          else fail(`${f}:${i + 1}: ${a.text} ${a.route}: ${a.route} is not a route of the ${a.name} area; an area named alone is followed by punctuation or the end of its code span`, f);
        }
      });
    }
    if (failures() === before) ok(`${counted.skill + counted.agent + counted.server} addresses resolve (${counted.skill} skill, ${counted.agent} agent, ${counted.server} MCP server), ${counted.route} of them on through an area to its route`);
  }

  // ---- plugin-root paths ------------------------------------------------------
  // Skill markdown names its plugin's files as `${CLAUDE_PLUGIN_ROOT}/<path>`,
  // and an agent that follows one to a file that moved finds nothing. In a
  // plugin that holds areas, each such path in its tracked markdown is in the
  // plugin: an installed copy holds nothing else. A path holding a placeholder
  // is a pattern and is not read, a template copy is another repo's file, and
  // a CHANGELOG.md is history.
  {
    const before = failures();
    let paths = 0, patterns = 0;
    const holders = new Set(foundAreas.map((a) => a.plugin));
    for (const f of textFiles) {
      const [top, plugin, ...rest] = f.split("/");
      if (top !== "plugins" || !holders.has(plugin) || !rest.length || !f.endsWith(".md") || path.basename(f) === "CHANGELOG.md" || isTemplateCopy(f) || VENDORED.test(f)) continue;
      const dir = at("plugins", plugin);
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        for (const p of pluginRootPaths(line)) {
          if (p.placeholder) { patterns++; continue; }
          // A full stop that ends the sentence is not part of the path.
          const target = exists(path.join(dir, p.path)) ? p.path : p.path.replace(/\.+$/, "");
          const full = path.resolve(dir, target);
          paths++;
          if (full !== dir && !full.startsWith(dir + path.sep)) fail(`${f}:${i + 1}: \${CLAUDE_PLUGIN_ROOT}/${target} leaves the plugin; an installed copy holds nothing outside plugins/${plugin}`, f);
          else if (!exists(full)) fail(`${f}:${i + 1}: \${CLAUDE_PLUGIN_ROOT}/${target} is not in plugins/${plugin}`, f);
        }
      });
    }
    if (holders.size && failures() === before) ok(`${paths} plugin-root paths in the markdown of a plugin that holds areas are in that plugin (${patterns} with a placeholder not read)`);
  }

  // ---- named directories ------------------------------------------------------
  // A route is read by path. Nothing fills in the root variable there, and a
  // shell runs it as empty, so a route never writes it: it names the
  // directories its commands use from its own file ("`W` below is `../..` from
  // the directory this file is in") and writes each path under one, quoted in
  // a command and in a code span of its own in prose. Every such path is in
  // the plugin. A skill may name a directory the same way, and is held to it.
  {
    const before = failures();
    let paths = 0, files = 0, declared = 0;
    for (const f of textFiles) {
      // A skill, `skills/<skill>/SKILL.md`, or an area's route document,
      // `skills/<area>/routes/<route>/ROUTE.md`, which is read by path always.
      const [top, plugin, kind, , ...below] = f.split("/");
      const route = below.length === 3 && below[0] === "routes" && below[2] === "ROUTE.md";
      if (top !== "plugins" || kind !== "skills" || !(route || below.join("/") === "SKILL.md")) continue;
      const text = fs.readFileSync(at(f), "utf8");
      const pluginDir = at("plugins", plugin), here = path.dirname(at(f));
      const dirs = new Map();
      for (const d of namedDirs(text)) {
        const full = path.resolve(here, d.rel);
        if (dirs.has(d.name)) fail(`${f}: \`${d.name}\` is declared twice`, f);
        else if (full !== pluginDir && !full.startsWith(pluginDir + path.sep)) fail(`${f}: \`${d.name}\` is ${d.rel} from this file, which leaves the plugin; an installed copy holds nothing outside plugins/${plugin}`, f);
        else if (!isDir(full)) fail(`${f}: \`${d.name}\` is ${d.rel} from this file, which is not a directory`, f);
        else { dirs.set(d.name, full); declared++; }
      }
      if (dirs.size) files++;
      text.split("\n").forEach((line, i) => {
        if (route && line.includes("${CLAUDE_PLUGIN_ROOT}")) fail(`${f}:${i + 1}: a route writes no \${CLAUDE_PLUGIN_ROOT}: read by path it is not filled in, and a shell runs it as empty; name the directory from this file ("\`W\` below is \`../..\` from the directory this file is in")`, f);
        for (const p of namedPaths(line, [...dirs.keys()])) {
          const base = dirs.get(p.name);
          // A full stop that ends the sentence is not part of the path.
          const target = exists(path.join(base, p.path)) ? p.path : p.path.replace(/\.+$/, "");
          const full = path.resolve(base, target);
          const written = `${p.name}/${target}`;
          paths++;
          if (!p.quoted) fail(`${f}:${i + 1}: ${written} is not quoted; write "${written}" in a command, or \`${written}\` in prose`, f);
          if (full !== pluginDir && !full.startsWith(pluginDir + path.sep)) fail(`${f}:${i + 1}: ${written} leaves the plugin; an installed copy holds nothing outside plugins/${plugin}`, f);
          else if (!exists(full)) fail(`${f}:${i + 1}: ${written} is not there: \`${p.name}\` is ${rel(base)}`, f);
        }
        // A path copied in from another route, whose name this one never declared.
        if (route) for (const m of line.matchAll(/(?<=["`])([A-Z])\/[a-z][A-Za-z0-9_.\/-]*/g)) {
          if (!dirs.has(m[1])) fail(`${f}:${i + 1}: ${m[0]} is under \`${m[1]}\`, which this file does not declare`, f);
        }
      });
    }
    if ((declared || foundAreas.length) && failures() === before) ok(`${paths} named-directory paths in ${files} skills and routes resolve from the file's own directory (${declared} declarations); no route writes the root variable`);
  }

  // ---- the subagent denylist ---------------------------------------------------
  // The session hook withholds the critical lines from the agents in DENYLIST,
  // and it matches a plugin's agent by `<plugin>:<name>`. An entry left behind
  // by a rename matches nothing and says nothing: the blind critic would then
  // be sent the builder's lines. Each plugin-qualified entry is an agent file
  // in that plugin. An entry with no plugin is one of the host's own agents.
  {
    const file = [KERNEL, `plugins/${gen?.ENTRY_PLUGIN}/hooks/critical-context.mjs`].find((f) => exists(at(f)));
    const entries = file ? stringSet(fs.readFileSync(at(file), "utf8"), "DENYLIST") : [];
    if (!entries) fail("DENYLIST is not a Set of string literals any more, so its entries cannot be checked; change this check with it", file);
    else {
      const before = failures();
      const qualified = entries.filter((e) => e.includes(":"));
      for (const entry of qualified) {
        const plugin = entry.slice(0, entry.indexOf(":")), owner = areaOwner(ROOT, plugin);
        const agent = `plugins/${plugin}/agents/${entry.slice(entry.indexOf(":") + 1)}.md`;
        // An agent is named by the plugin that ships it, and an area ships none.
        if (owner && owner !== plugin) fail(`DENYLIST entry "${entry}" names an agent by the plugin it was in; ${plugin} is an area of ${owner}, so the host names it ${owner}${entry.slice(entry.indexOf(":"))}`, file);
        else if (!exists(at(agent))) fail(`DENYLIST entry "${entry}" matches no agent: ${agent} is not there, so that agent would be sent the critical lines`, file);
      }
      if (qualified.length && failures() === before) ok(`${qualified.length} plugin-qualified DENYLIST entr${qualified.length === 1 ? "y" : "ies"}: each an agent its plugin ships`);
    }
  }

  // ---- the mod's tool prefix ----------------------------------------------------
  // The host names a mod's tools by the plugin that loads it,
  // mcp__<plugin>__<tool>, and each site that spells the prefix out stops
  // matching without a word when it is wrong. The handlers and the matcher
  // name the prefix outright, so each is held to the plugin's name; the card
  // sync reads it with a pattern, which is held to what it has to do, which is
  // match a tool the handlers answer.
  {
    const plugin = areaOwner(ROOT, MOD.plugin) ?? MOD.plugin;
    const hooksFile = `plugins/${plugin}/hooks/hooks.json`, handlers = placed(ROOT, MOD.handlers), observer = placed(ROOT, MOD.observer);
    if (exists(at(handlers))) {
      const before = failures();
      const prefix = `mcp__${plugin}__`;
      const source = (f) => (exists(at(f)) ? fs.readFileSync(at(f), "utf8") : "");
      // A server's name holds no double underscore: that is where the tool starts.
      const SERVER = "((?:(?!__)[A-Za-z0-9_-])+)";
      const answered = [...source(handlers).matchAll(new RegExp(`["'\`]mcp__${SERVER}__(\\w+)["'\`]`, "g"))].map((m) => ({ server: m[1], tool: m[2] }));
      if (!answered.length) fail(`${handlers} names no mcp__ tool, and the prefix check reads the mod's tools off it; change this check with it`, handlers);
      for (const a of answered) {
        if (a.server !== plugin) fail(`${handlers} answers mcp__${a.server}__${a.tool}; the mod's tools are ${prefix}<tool>`, handlers);
      }
      const tools = [...new Set(answered.map((a) => prefix + a.tool))];
      let hooks = {};
      try { hooks = readJson(at(hooksFile)).hooks ?? {}; } catch { /* reported with the plugin's hooks */ }
      for (const matcher of (hooks.PostToolUse ?? []).map((h) => String(h.matcher ?? "")).filter((m) => m.includes("mcp__"))) {
        const stale = [...matcher.matchAll(new RegExp(`mcp__${SERVER}__`, "g"))].map((m) => m[1]).filter((server) => server !== plugin);
        for (const server of new Set(stale)) fail(`${hooksFile}: a PostToolUse matcher names mcp__${server}__; the mod's tools are ${prefix}<tool>`, hooksFile);
      }
      // The sync's pattern is a regular expression on purpose (it also reads a
      // plugin MCP server's longer prefix), so it is run, not read.
      const patterns = [...source(observer).matchAll(/\/(\^?mcp__(?:\\.|\[[^\]\n]*\]|[^/\\\n])*)\/[dgimsuvy]*/g)].map((m) => m[1]);
      if (!patterns.length) fail(`${observer} holds no /^mcp__.../ pattern, and the prefix check runs the one it reads a tool's name with; change this check with it`, observer);
      for (const pattern of patterns) {
        let reads = false;
        try { const re = new RegExp(pattern); reads = tools.some((t) => re.test(t)); } catch { /* not a pattern: it reads nothing */ }
        if (tools.length && !reads) fail(`${observer} reads a tool's name with /${pattern}/, which matches none of the mod's tools (${tools.join(", ")})`, observer);
      }
      if (failures() === before) ok(`the mod's ${tools.length} tools are ${prefix}<tool> wherever ${path.basename(hooksFile)}, ${path.basename(handlers)}, and ${path.basename(observer)} name them`);
    }
  }

  // ---- duplicated files -----------------------------------------------------------
  // One plugin holds one copy of what several plugins each carried. What is
  // left to hold equal is a file a user's repo gets a copy of.
  if (HASH_PAIRS.length) {
    let pairs = 0, pairBad = 0;
    for (const { canonical, copies: held } of HASH_PAIRS) {
      if (!exists(at(canonical))) { fail(`${canonical} is missing; copies of it cannot be checked`, canonical); pairBad++; continue; }
      const want = sha256(at(canonical));
      for (const copy of held) {
        if (!exists(at(copy))) continue;
        pairs++;
        if (sha256(at(copy)) !== want) { fail(`${copy} has drifted from ${canonical}`, copy); pairBad++; }
      }
    }
    if (!pairBad) ok(`duplicated files hash-equal (${pairs} copy/copies present)`);
  }

  // ---- tree-wide -------------------------------------------------------
  let text = 0, crlf = 0, abs = 0, junk = 0, exits = 0;
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
    if (!VENDORED.test(f) && NODE_FILE.test(f)) {
      body.split("\n").forEach((line, i) => {
        if (EXIT_CALL.test(line)) { fail(`${f}:${i + 1} calls process.exit: set process.exitCode and let Node unwind`, f); exits++; }
      });
    }
  }
  if (!junk) ok("no .DS_Store, node_modules, or __pycache__ tracked");
  if (!crlf) ok(`no CRLF in ${text} tracked text file(s)`);
  if (!abs) ok("no absolute machine paths in tracked files");
  if (!exits) ok("no process.exit call in a Node file under plugins/ or scripts/");

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
