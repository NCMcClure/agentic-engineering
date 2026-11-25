#!/usr/bin/env node
// Structural gate for the marketplace. Every rule here is stated in
// .agents/rules/dev-rules.md; change both together. Node 22 stdlib only.
//
// Usage: node scripts/validate.mjs [--root <dir>] [--tag agentic-engineering/v<version>]
//
// --root points the checks at another checkout, which is how they get tested
// against a tree that is meant to fail. --tag checks one thing only: that the
// tag is the one plugin's, at the version its plugin.json carries.
//
// The one plugin's session hooks are held to budgets kept here: CRITICAL_CAPS
// (each area's critical lines) and the totals a hook's output must stay
// under. What a hook may print at run time is in the plugin's own helper.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AREA_PLUGIN, HASH_PAIRS, NEVER_PLUGINS, OLD_NAMES, OLD_PLUGIN_NAMES, addressFinder, fail, failures, gitLsFiles, isHistory, isRecording, isTemplateCopy, namedDirs, namedPaths, note, ok, oldRouteIn, outsideDirs, parseFrontmatter, parseHookCommand, pluginRootPaths, readJson, renamedRoute, sha256, skillBody, stringSet } from "./lib.mjs";

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
  `plugins/${AREA_PLUGIN}/skills/planning/routes/spec-init/assets/comments-server.py`,
  `plugins/${AREA_PLUGIN}/skills/design/scripts/keypoints.py`,
  `plugins/${AREA_PLUGIN}/skills/design/scripts/semantic.py`,
]);
const NON_NODE_EXT = /\.(py|sh|bash|zsh|ps1|rb|pl)$/;
// A vendored app tree carries its toolchain's own files; path rules skip it.
// It sits at an area's root.
const VENDORED = new RegExp(`^plugins/${AREA_PLUGIN}/skills/[^/]+/app/`);
const ABS_PATH = new RegExp("/(?:Users|home/[a-z]|fast)/");
// A Node file here never calls exit, and neither does a one-line command a
// test hands to node: with NODE_USE_SYSTEM_CA set, Node 24 reads the system's
// certificates on a thread at start-up, and an exit that lands before it has
// finished crashes the process. A line that is only a comment may name it.
const NODE_FILE = /^(?:plugins|scripts)\/.*\.(?:mjs|js|cjs)$/;
const EXIT_CALL = /^(?!\s*(?:\/\/|\/?\*)).*\bprocess\.exit\(/;
// Critical lines are paid for on every request of every session, so each
// area's lines stay under its own cap, all of them together under the
// combined target, and each session command's worst case under the host's
// limit on a hook's output, past which the model reads a preview.
const CRITICAL_CAPS = { "delivery": 1500, "agents": 1850, "harness": 250, "code": 550, "docs": 1050, "planning": 750, "design": 1100 };
const CRITICAL_TOTAL = 7500;
const HOOK_OUTPUT_CAP = 10000;
// What the lines command can print beside the lines: the once-per-clone
// question, and the JSON it all goes out in.
const QUESTION_ALLOWANCE = 800;
const ENVELOPE_ALLOWANCE = 200;
// The one plugin, the one copy of the session helper, and the two commands built on it.
// plugins/ holds no other directory.
const ONE_PLUGIN = AREA_PLUGIN;
const HELPER = `plugins/${ONE_PLUGIN}/hooks/critical-context.mjs`;
const LINES_HOOK = "hooks/session-start.mjs";
const BRIEFING_HOOK = "hooks/briefing.mjs";
const SESSION_MATCHER = "startup|resume|clear|compact";
// A route is a document no host parses, so its frontmatter is the table's data and nothing else.
const ROUTE_KEYS = new Set(["name", "description", "argument-hint"]);
// An area is one entry in the skill listing, and the host cuts an entry's
// description at 1,536 characters. Invoking an area again with another route
// appends its body to the conversation again, so the body has a cap too. A
// cue is what a table says of one route, in a line.
const AREA_DESCRIPTION_CAP = 1536;
const AREA_BODY_CAP = 8000;
const CUE_CAP = 60;
// A marker one plugin writes into a user's AGENTS.md, which reads like an address and is not one.
const NOT_ADDRESSES = new Set(["agent-works:plugins"]);
// The area that is a Claude Code mod: the handlers that answer its tools, and
// the pattern the card sync reads a tool's name with.
const MOD = { handlers: `plugins/${AREA_PLUGIN}/skills/agents/hooks/kanban/register.mjs`, observer: `plugins/${AREA_PLUGIN}/skills/agents/lib/sync.mjs` };

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const exists = (p) => fs.existsSync(p);
const listDirs = (p) => (isDir(p) ? fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);
const versionOf = (plugin) => readJson(at("plugins", plugin, ".claude-plugin", "plugin.json")).version;

// ---- release tag -------------------------------------------------------
if (arg("--tag")) {
  const tag = arg("--tag");
  const m = /^([a-z0-9-]+)\/v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!m) fail(`tag "${tag}" is not ${ONE_PLUGIN}/v<version>`);
  else if (m[1] !== ONE_PLUGIN) fail(`tag "${tag}" names ${m[1]}; the one release tag is ${ONE_PLUGIN}/v<version>`);
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

  const pluginDirs = listDirs(at("plugins"));

  // ---- per plugin ------------------------------------------------------
  const entryNames = new Set(catalog.plugins.map((p) => p.name));
  // One plugin, so one directory: a second with something of its own to ship is an area that has not moved in.
  for (const dir of pluginDirs) {
    if (dir !== ONE_PLUGIN) fail(`plugins/${dir}: the marketplace ships one plugin, plugins/${ONE_PLUGIN}, and plugins/ holds no other directory; what is new goes in as an area, plugins/${ONE_PLUGIN}/skills/<area>/`, `plugins/${dir}`);
    else if (!entryNames.has(dir)) fail(`plugins/${dir} has no catalog entry`, `plugins/${dir}`);
  }

  const pluginFailures = failures();
  const allowed = NON_NODE_ALLOWLIST;
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
      // One SessionStart command says so to the person; said by each of
      // several, the message prints once per command.
      const loud = [];
      for (const [event, groups] of Object.entries(map?.hooks ?? {})) {
        const starts = [];
        for (const hook of [].concat(groups ?? []).flatMap((g) => g?.hooks ?? [])) {
          if (!/\bnode\b/.test(String(hook.command ?? "")) || !/\.m?js\b/.test(String(hook.command))) continue;
          const parsed = parseHookCommand(hook.command, name);
          const what = `${name}/hooks/hooks.json: the ${event} command`;
          if (!parsed) fail(`${what} is not a guard followed by node "\${CLAUDE_PLUGIN_ROOT}/<file>"`, rel(hooks));
          else if (!parsed.guard) fail(`${what} for ${parsed.script} has no guard for a machine without Node`, rel(hooks));
          else if (event !== "SessionStart" && parsed.guard === "loud") fail(`${what} for ${parsed.script} uses the guard that tells the person Node is missing; only a SessionStart command does`, rel(hooks));
          if (parsed && event === "SessionStart") {
            starts.push(parsed);
            if (parsed.guard === "loud") loud.push(parsed.script);
            if (!hook.statusMessage) fail(`${what} for ${parsed.script} has no statusMessage`, rel(hooks));
          }
        }
        if (event !== "SessionStart" || !starts.some((s) => s.guard)) continue;
        if (!loud.length) fail(`${name}/hooks/hooks.json: the SessionStart command for ${starts[0].script} must use the guard that tells the person Node is missing`, rel(hooks));
        for (const script of loud.slice(1)) fail(`${name}/hooks/hooks.json: the SessionStart command for ${script} repeats the guard that tells the person Node is missing; ${loud[0]} says it, and the rest stay quiet`, rel(hooks));
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
  // What several areas use sits once, in the one plugin's lib/, and is tested
  // once, by a suite of its own name. (A copy a user's repo gets is a
  // duplicated file, below.)
  {
    const before = failures();
    const lib = `plugins/${ONE_PLUGIN}/lib`;
    const shared = isDir(at(lib)) ? fs.readdirSync(at(lib)).sort() : [];
    for (const f of shared) {
      const suite = `scripts/test-hooks/unit/${f.replace(/\.mjs$/, ".test.mjs")}`;
      if (!f.endsWith(".mjs")) fail(`${lib}/${f} is not a .mjs file`, `${lib}/${f}`);
      else if (!exists(at(suite))) fail(`${lib}/${f} has no ${suite}`, `${lib}/${f}`);
    }
    for (const gone of ["scripts/shared", "scripts/plugins"]) {
      if (exists(at(gone))) fail(`${gone}/ is still here: one plugin holds one copy of what its areas share, in ${lib}/, and its budgets are in this gate`, gone);
    }
    if (shared.length && failures() === before) ok(`${shared.length} shared file(s) in ${lib}/, each with a suite`);
  }

  // ---- the session hooks -----------------------------------------------
  // The plugin speaks once. One command prints every area's critical lines
  // (and, where nothing settles the repo, the question); another prints the
  // briefing. Each stays under what a host shows the model in full.
  if (exists(at(HELPER))) {
    const before = failures();
    const skills = `plugins/${ONE_PLUGIN}/skills`;
    let helper = null;
    try { helper = await import(pathToFileURL(at(HELPER)).href); } catch (e) { fail(`${HELPER} does not load (${e.message})`, HELPER); }
    const capped = Object.keys(CRITICAL_CAPS);
    const speaking = listDirs(at(skills)).filter((a) => exists(at(skills, a, "hooks", "critical.json")));
    let total = helper ? helper.SHARED_LINE.length + 3 : 0;
    if (helper) {
      const listed = helper.AREAS ?? [];
      for (const area of capped) if (!listed.includes(area)) fail(`${HELPER}: AREAS does not list ${area}, which CRITICAL_CAPS in scripts/validate.mjs gives a cap`, HELPER);
      for (const area of listed) if (!capped.includes(area)) fail(`${HELPER}: AREAS lists ${area}, which has no cap in CRITICAL_CAPS in scripts/validate.mjs`, HELPER);
      for (const area of listed) if (!speaking.includes(area)) fail(`${HELPER}: AREAS lists ${area}, which has no ${skills}/${area}/hooks/critical.json`, HELPER);
    }
    for (const area of helper ? speaking : []) {
      const file = `${skills}/${area}/hooks/critical.json`;
      const bad = (what) => fail(`${file}: ${what}`, file);
      if (!(helper.AREAS ?? []).includes(area)) bad(`${area} is not in AREAS in ${HELPER}, so its lines never print`);
      let data;
      try { data = readJson(at(file)); } catch (e) { bad(e.message); continue; }
      if (data.area !== area) bad(`area is ${JSON.stringify(data.area ?? null)}, expected ${area}`);
      // Every area is always there, so no line waits on another plugin.
      if ("chains" in data) bad("it carries a chains block; a line that waited on another plugin is a line of its own now, behind its own when");
      const lines = Array.isArray(data.lines) ? data.lines : [];
      for (const l of lines) {
        const which = `"${String(l.text).slice(0, 40)}"`;
        if (typeof l.text !== "string" || !l.text) bad(`${which} has no text`);
        if (!helper.AUDIENCES.includes(l.for)) bad(`${which} needs for: ${helper.AUDIENCES.join(" or ")}`);
        if (!helper.MODES.includes(l.mode)) bad(`${which} needs mode: ${helper.MODES.join(", ")}`);
        if ("partner" in l) bad(`${which} names a partner; every area is present, so the line stands behind its own when`);
        if ("when" in l && ![l.when].flat().every((p) => typeof p === "string" && p)) bad(`${which} needs when: a repo path, or a list of them`);
      }
      // What the block costs as printed: a header, and "- " plus a newline a line.
      const size = `Critical, from ${area}:`.length + lines.reduce((n, l) => n + String(l.text).length + 3, 0);
      total += size;
      const cap = CRITICAL_CAPS[area];
      if (Number.isInteger(cap) && size > cap) bad(`critical lines are ${size} characters, over the ${cap} cap`);
    }
    // The plugin speaks through one command, never an area's own, whether or not the area keeps lines.
    for (const area of listDirs(at(skills))) {
      const own = `${skills}/${area}/hooks/session-start.mjs`;
      if (exists(at(own))) fail(`${own}: an area has no session hook of its own; its lines are critical.json and its briefing is hooks/briefing.mjs`, own);
    }
    for (const copy of tracked.filter((f) => f.startsWith("plugins/") && f.endsWith("/critical-context.mjs") && f !== HELPER && exists(at(f)))) {
      fail(`${copy} is a second copy of the session helper; the one copy is ${HELPER}`, copy);
    }
    // The route index rides with the lines, and every request pays for it the same way, so it counts toward the same total.
    const index = helper?.routeIndex ? helper.routeIndex({ mode: "full", subagent: false }, helper.readRoutes(at(skills))) : "";
    if (helper && !index) fail(`${HELPER}: routeIndex prints nothing for the main session of an opted-in repo; at a 200k window it is the only text that names every route`, HELPER);
    total += index.length;
    if (total > CRITICAL_TOTAL) fail(`critical lines and the route index total ${total} characters, over the ${CRITICAL_TOTAL} target`, skills);
    const linesWorst = total + QUESTION_ALLOWANCE + ENVELOPE_ALLOWANCE;
    if (linesWorst > HOOK_OUTPUT_CAP) fail(`the lines command can print ${linesWorst} characters, over the host's ${HOOK_OUTPUT_CAP}`, HELPER);

    // The briefing: each part is cut to its allowance at run time, so the sum is the worst case.
    let briefingWorst = 0;
    if (helper) {
      const parts = helper.BRIEFING_CHARS ?? {};
      const have = listDirs(at(skills)).filter((a) => exists(at(skills, a, "hooks", "briefing.mjs")));
      for (const area of Object.keys(parts)) if (!have.includes(area)) fail(`${HELPER}: BRIEFING_CHARS gives ${area} an allowance, and ${skills}/${area}/hooks/briefing.mjs is not there`, HELPER);
      for (const area of have) if (!Number.isInteger(parts[area])) fail(`${skills}/${area}/hooks/briefing.mjs has no allowance in BRIEFING_CHARS in ${HELPER}, so the briefing command never loads it`, `${skills}/${area}/hooks/briefing.mjs`);
      briefingWorst = Object.values(parts).reduce((n, c) => n + c, 0) + (helper.MIGRATION_CHARS ?? 0) + (helper.CATALOG_CHARS ?? 0) + ENVELOPE_ALLOWANCE;
      if (!Number.isInteger(briefingWorst)) fail(`${HELPER}: BRIEFING_CHARS, MIGRATION_CHARS, and CATALOG_CHARS are whole numbers of characters`, HELPER);
      else if (briefingWorst > HOOK_OUTPUT_CAP) fail(`the briefing command can print ${briefingWorst} characters, over the host's ${HOOK_OUTPUT_CAP}`, HELPER);
    }

    // The hook map: the lines once per event, the briefing once, in the main session only.
    const mapFile = `plugins/${ONE_PLUGIN}/hooks/hooks.json`;
    let registered = {};
    try { registered = readJson(at(mapFile)).hooks ?? {}; } catch { /* reported with the plugin's hooks */ }
    const runs = (event, script) => [].concat(registered[event] ?? []).flatMap((g) => (g?.hooks ?? []).map((h) => ({ matcher: g.matcher ?? "", parsed: parseHookCommand(h.command, ONE_PLUGIN) }))).filter((r) => r.parsed?.script === script);
    for (const [event, script, want] of [["SessionStart", LINES_HOOK, 1], ["SubagentStart", LINES_HOOK, 1], ["SessionStart", BRIEFING_HOOK, 1], ["SubagentStart", BRIEFING_HOOK, 0]]) {
      const n = runs(event, script).length;
      if (n !== want) fail(`${mapFile} runs ${script} ${n} time(s) on ${event}; it runs ${want === 1 ? "once" : "never: a subagent gets no briefing"}`, mapFile);
    }
    for (const event of Object.keys(registered).filter((e) => e !== "SessionStart" && e !== "SubagentStart")) {
      for (const script of [LINES_HOOK, BRIEFING_HOOK]) if (runs(event, script).length) fail(`${mapFile} runs ${script} on ${event}; it is a session-start command`, mapFile);
    }
    for (const script of [LINES_HOOK, BRIEFING_HOOK]) {
      for (const r of runs("SessionStart", script)) if (r.matcher !== SESSION_MATCHER) fail(`${mapFile}: ${script} runs on SessionStart "${r.matcher}"; it is "${SESSION_MATCHER}", so the context comes back after a compaction and a /clear`, mapFile);
    }
    if (failures() === before) ok(`critical lines within budget (${total} of ${CRITICAL_TOTAL} characters across ${speaking.length} area(s)); the lines command prints at most ${linesWorst} and the briefing ${briefingWorst}, of ${HOOK_OUTPUT_CAP}`);
  }

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
      // A person is asked about the plugin's areas, each once.
      const areas = entry.areas(ROOT).map((a) => a.area);
      const asked = front.groups.flatMap((g) => g.areas);
      for (const name of areas) if (!asked.includes(name)) fail(`${data}: no group asks about ${name}, so a person is never offered it`, data);
      for (const name of asked) {
        if (!areas.includes(name)) fail(`${data}: a group names ${name}, which is not an area of ${entry.ENTRY_PLUGIN}`, data);
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
          if (!u.found) { fail(`${data}: ${a.name} hands off to ${u.to || "nothing"}, which is not one of its routes`, data); continue; }
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
      if (failures() === before) ok(`the entry skill offers ${front.areas.length} areas in ${front.groups.length} questions, and every hand-off names a route that is there`);
    }
  } catch (e) { fail(`the entry skill could not be read (${e.message})`, "scripts/gen-guide.mjs"); }

  // ---- one plugin of areas ------------------------------------------------
  // The marketplace ships one plugin, whose skills are the entry skill and
  // the areas, and nothing else is under plugins/.
  let gen = null;
  try { gen = await import(pathToFileURL(at("scripts", "gen-guide.mjs")).href); } catch { /* reported with the guide */ }
  const textFiles = tracked.filter((f) => exists(at(f)) && !fs.lstatSync(at(f)).isSymbolicLink() && !fs.readFileSync(at(f)).includes(0));
  const foundAreas = gen ? gen.areas(ROOT) : [];
  const local = catalog.plugins.filter((p) => !isExternal(p) && p.name && isDir(at("plugins", p.name)));
  if (!isDir(at("plugins", ONE_PLUGIN))) fail(`plugins/${ONE_PLUGIN} is missing: it is the one plugin this marketplace ships`, "plugins");

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
    // The plugin's skills are its areas and the one a person types, and nothing else.
    for (const skill of gen ? listDirs(at("plugins", ONE_PLUGIN, "skills")) : []) {
      if (skill !== gen.ENTRY_SKILL && !isDir(at("plugins", ONE_PLUGIN, "skills", skill, "routes"))) fail(`${ONE_PLUGIN}/${skill}: a skill of ${ONE_PLUGIN} is ${gen.ENTRY_SKILL} or an area; this one is neither. Make it a route, skills/<area>/routes/${skill}/ROUTE.md`, `plugins/${ONE_PLUGIN}/skills/${skill}`);
    }
    if (gen && !exists(at(gen.ENTRY_FILE))) fail(`${gen.ENTRY_FILE} is missing: it is the one skill of ${ONE_PLUGIN} a person can type`, `plugins/${ONE_PLUGIN}/skills`);
    if (foundAreas.length && failures() === before) ok(`${foundAreas.length} area${foundAreas.length === 1 ? "" : "s"}: current, within the caps, user-invocable: false and callable, every route a ROUTE.md in its table, no SKILL.md below`);
  }

  // ---- old names -------------------------------------------------------------
  // Each area was a plugin of its own, and the catalog lists none of them now:
  // a line that tells its reader to install one sends them to a plugin that is
  // not there. So does the plugin's own name before 2.0.0 (OLD_PLUGIN_NAMES).
  // A changelog, a recording, and a template copy keep what they say.
  const oldNames = [...new Set([...foundAreas.map((a) => a.area), ...Object.keys(OLD_NAMES), ...OLD_PLUGIN_NAMES])].filter((name) => name !== ONE_PLUGIN);
  {
    const before = failures();
    const install = oldNames.length ? new RegExp(`\\binstall\\b[^\\n]*?(?<![\\w-])(${oldNames.join("|")})@${catalog.name}(?![\\w-])`) : null;
    for (const f of install ? textFiles : []) {
      if (isHistory(f) || isRecording(f) || isTemplateCopy(f)) continue;
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        const hit = install.exec(line);
        if (hit) fail(`${f}:${i + 1}: tells its reader to install ${hit[1]}@${catalog.name}, which the catalog does not list; the plugin to install is ${ONE_PLUGIN}@${catalog.name}`, f);
      });
    }
    if (install && failures() === before) ok(`no install line names an area or a plugin's old name: the one to install is ${ONE_PLUGIN}@${catalog.name}`);
  }

  // ---- addresses ------------------------------------------------------------
  // `/<plugin>:<name>`, with the slash or bare, is how a file names a skill,
  // an agent, or an MCP server, and an address whose target was renamed or
  // removed reads exactly like one that works. Each one in a tracked file
  // resolves to something its plugin ships.
  //
  // A route is reached through its area, `/<plugin>:<area> <route>`. The word
  // after a slash-led area address is the first word of its arguments, so it
  // is held to the area's routes: a sentence that names the area alone ends
  // the address with punctuation or the end of its code span. A route's own
  // name as a skill, `/<plugin>:<route>`, names nothing and fails with what to
  // write. So does an area's old name as a plugin, `/<area>:<route>`: no
  // plugin of that name is left. A recording names a skill as
  // data and is not held to that, a template copy is another repo's file, and
  // a CHANGELOG.md is history.
  {
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
    const owners = new Map([...targets].flatMap(([plugin, target]) => [...target.areas.keys()].filter((area) => area !== plugin && !NEVER_PLUGINS.has(area)).map((area) => [area, { owner: plugin, area }])));
    for (const [old, area] of Object.entries(OLD_NAMES)) if (!targets.has(old) && targets.get(ONE_PLUGIN)?.areas.has(area)) owners.set(old, { owner: ONE_PLUGIN, area });
    const find = addressFinder([...new Set([...targets.keys(), ...owners.keys(), ...OLD_PLUGIN_NAMES])]);
    const counted = { skill: 0, agent: 0, server: 0, route: 0 };
    for (const f of textFiles) {
      if (isHistory(f) || VENDORED.test(f)) continue;
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        for (const a of find(line)) {
          if (NOT_ADDRESSES.has(`${a.plugin}:${a.name}`)) continue;
          // The area's old name as a plugin: `/<area>:<route>`, or through the
          // skill named after it, `/<area>:<area> <route>`.
          // The plugin's own name before the rename: the plugin it is now owns the address.
          if (OLD_PLUGIN_NAMES.includes(a.plugin)) {
            if (!isRecording(f) && !isTemplateCopy(f)) fail(`${f}:${i + 1}: ${a.text} names ${a.plugin}, the plugin's name before ${ONE_PLUGIN}; write ${a.text.replace(a.plugin, ONE_PLUGIN)}${a.route ? ` ${a.route}` : ""}`, f);
            continue;
          }
          const { owner, area: most } = owners.get(a.plugin) ?? {};
          if (owner) {
            if (isRecording(f)) continue;
            const through = a.name === a.plugin, given = through ? a.route : a.name;
            // A name retired when the areas were regrouped took its routes along, some renamed, a few to another area.
            const moved = renamedRoute(a.plugin, given), route = moved?.route ?? given, area = moved?.area ?? most;
            // An agent and an MCP server are the one plugin's own now, named
            // with no area: `<plugin>:<name>`, which is not a route to pass.
            const own = targets.get(owner), shipped = !through && (own.agent.has(a.name) || own.server.has(a.name));
            const known = shipped || (route ? own.areas.get(area)?.has(route) : through);
            const write = shipped ? `${a.slash ? "/" : ""}${owner}:${a.name}` : `/${owner}:${area}${route ? ` ${route}` : ""}`;
            if (!isTemplateCopy(f)) fail(`${f}:${i + 1}: ${a.text} names ${a.plugin} as a plugin, and it is ${area === a.plugin ? "an area" : `the ${area} area`} of ${owner}; write ${write}`, f);
            else if (!known) fail(`${f}:${i + 1}: ${a.text} names nothing: ${given} is not a route of the ${area} area`, f);
            continue;
          }
          const target = targets.get(a.plugin);
          const kind = ["skill", "agent", "server"].find((k) => target[k].has(a.name));
          if (!kind) {
            if (isRecording(f) || isTemplateCopy(f)) continue;
            // An area retired when the areas were regrouped: the area it went into, and the route by its name there.
            const moved = renamedRoute(a.name, a.route);
            if (moved && target.areas.has(moved.area)) {
              fail(`${f}:${i + 1}: ${a.text}${a.route ? ` ${a.route}` : ""} names ${a.name}, an area of ${a.plugin} before it moved into ${moved.area}; write /${a.plugin}:${moved.area}${moved.route ? ` ${moved.route}` : ""}`, f);
              continue;
            }
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
          else if (oldRouteIn(a.name, a.route)) {
            const was = oldRouteIn(a.name, a.route), write = `${a.slash ? "/" : ""}${a.plugin}:${was.area} ${was.route}`;
            if (was.area !== a.name) fail(`${f}:${i + 1}: ${a.text} ${a.route}: ${a.route} went from ${was.old} to the ${was.area} area; write ${write}`, f);
            else fail(`${f}:${i + 1}: ${a.text} ${a.route}: ${a.route} is the name the route had in ${was.old}; write ${write}`, f);
          }
          else fail(`${f}:${i + 1}: ${a.text} ${a.route}: ${a.route} is not a route of the ${a.name} area; an area named alone is followed by punctuation or the end of its code span`, f);
        }
      });
    }
    // A tool of the plugin's mod under the plugin's old name, mcp__<old>__<tool>,
    // is no address `find` reads (it has no colon); it is held to the same rule.
    const deadTool = OLD_PLUGIN_NAMES.length ? new RegExp(`(?<![\\w-])mcp__(${OLD_PLUGIN_NAMES.join("|")})__(\\w+)`, "g") : null;
    for (const f of deadTool ? textFiles : []) {
      if (isHistory(f) || VENDORED.test(f) || isRecording(f) || isTemplateCopy(f)) continue;
      fs.readFileSync(at(f), "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(deadTool)) fail(`${f}:${i + 1}: ${m[0]} names ${m[1]}, the plugin's name before ${ONE_PLUGIN}; write mcp__${ONE_PLUGIN}__${m[2]}`, f);
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
      if (top !== "plugins" || !holders.has(plugin) || !rest.length || !f.endsWith(".md") || isHistory(f) || isTemplateCopy(f) || VENDORED.test(f)) continue;
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
  // shell runs it as empty, so a route never writes it, nor the data
  // directory's: it names the directories its commands use from its own file
  // ("`W` below is `../..` from the directory this file is in") and writes
  // each path under one, quoted in a command and in a code span of its own in
  // prose. Every such path is in the plugin. A skill may name a directory the
  // same way, and is held to it. The data directory is named by the area's
  // SKILL.md, which the host does fill in.
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
      // A name for a directory of the repo the route works in: declared, and resolved by nothing here.
      const outside = new Set(outsideDirs(text));
      for (const name of outside) if (dirs.has(name)) fail(`${f}: \`${name}\` is declared twice`, f);
      if (dirs.size) files++;
      text.split("\n").forEach((line, i) => {
        if (route && line.includes("${CLAUDE_PLUGIN_ROOT}")) fail(`${f}:${i + 1}: a route writes no \${CLAUDE_PLUGIN_ROOT}: read by path it is not filled in, and a shell runs it as empty; name the directory from this file ("\`W\` below is \`../..\` from the directory this file is in")`, f);
        if (route && line.includes("${CLAUDE_PLUGIN_DATA}")) fail(`${f}:${i + 1}: a route writes no \${CLAUDE_PLUGIN_DATA}: read by path it is not filled in; the area's SKILL.md, which the host does fill in, names the data directory for its routes`, f);
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
          if (!dirs.has(m[1]) && !outside.has(m[1])) fail(`${f}:${i + 1}: ${m[0]} is under \`${m[1]}\`, which this file does not declare`, f);
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
    const file = exists(at(HELPER)) ? HELPER : null;
    const entries = file ? stringSet(fs.readFileSync(at(file), "utf8"), "DENYLIST") : [];
    if (!entries) fail("DENYLIST is not a Set of string literals any more, so its entries cannot be checked; change this check with it", file);
    else {
      const before = failures();
      const qualified = entries.filter((e) => e.includes(":"));
      for (const entry of qualified) {
        const plugin = entry.slice(0, entry.indexOf(":")), owner = foundAreas.find((a) => a.area === plugin)?.plugin;
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
    const plugin = ONE_PLUGIN;
    const hooksFile = `plugins/${plugin}/hooks/hooks.json`, handlers = MOD.handlers, observer = MOD.observer;
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

  // ---- the READMEs a person lands on -----------------------------------
  // The plugin's README is held to the rules the plugin gives its users: at
  // most 800 words, standard-readme's section order, a one-line description,
  // and no agent plumbing. The root README is the marketplace's front page,
  // with a figure for every area, and is held to the voice rules alone.
  try {
    const checker = at("plugins", AREA_PLUGIN, "skills", "docs", "scripts", "readme-check.mjs");
    const { checkReadme } = await import(pathToFileURL(checker).href);
    // The root README is named for the marketplace, which the catalog states: a checkout's folder can be called anything.
    const landing = [
      { file: "README.md", name: catalog.name, hasLicense: exists(at("LICENSE")), voiceOnly: true },
      { file: `plugins/${AREA_PLUGIN}/README.md`, name: AREA_PLUGIN, hasLicense: false },
    ];
    const before = failures();
    for (const { file, name, hasLicense, voiceOnly } of landing) {
      if (!exists(at(file))) continue;
      const text = fs.readFileSync(at(file), "utf8");
      const found = voiceOnly ? { findings: [], warnings: [] } : checkReadme(text, { path: file, name, hasLicense });
      for (const f of found.findings) fail(`${f.finding}: ${f.detail}`, file);
      for (const w of found.warnings ?? []) note(`${w.finding}: ${w.detail}`);
      if (/\u2014/.test(text)) fail(`${file} uses an em-dash; write a comma, a colon, or two sentences`, file);
      if (/\p{Extended_Pictographic}/u.test(text)) fail(`${file} uses an emoji`, file);
    }
    if (failures() === before) ok("the plugin README passes the README check, and neither landing README has an em-dash or an emoji");
  } catch (e) { fail(`the README check could not run (${e.message})`, "scripts/validate.mjs"); }

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
