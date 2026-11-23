#!/usr/bin/env node
// Deterministic plugin scaffolder for the create-plugin skill.
//
// Reads a confirmed spec (JSON) and emits a complete, installable plugin
// skeleton from the stubs in ../assets/stubs The model never types
// boilerplate; it authors into the TODO(author) markers the stubs leave.
// plugin.json and the CHANGELOG.md seed carry no marker, so a re-run never
// overwrites a manifest or a history without --force.
//
// Usage:
//   node plugin-scaffold.mjs <target-dir> --spec <spec.json> [--force]
//
// Spec shape:
//   {
//     "name": "<must equal the basename of target-dir>",
//     "description": "<one-sentence pitch>",
//     "author": {"name": "...", "email": "..."},
//     "version": "0.1.0",              // optional, default 0.1.0, semver
//     "displayName": "...",            // optional, derived from name
//     "keywords": ["..."],             // optional
//     "skills": [                      // a plain plugin: one skill per job
//       {"name": "<skill-slug>",
//        "mode": "model" | "callable" | "user",
//                                      // callable => user-invocable: false (agents call it, nobody types it)
//                                      // user => disable-model-invocation (only a person starts it)
//        "argumentHint": "...",        // optional
//        "withWorkflow": false,        // optional: workflows/<name>.js stub
//        "withScripts": false,         // optional: scripts/<name>.mjs stub
//        "withReferences": false}      // optional: references/notes.md
//     ],
//     "areas": [                       // a plugin of areas: one skill per body of work
//       {"name": "<area-slug>",
//        "lead": "<when to reach for it, one sentence>",   // optional, else a TODO
//        "default": "<route-slug>",    // optional, the first route
//        "routes": [
//          {"name": "<route-slug>",
//           "cue": "<the route in short, at most 60 characters>",
//           "starts": "person",        // optional: only a person starts it
//           "argumentHint": "...",     // optional
//           "withScripts": false}      // optional: routes/<route>/scripts/<route>.mjs
//        ]}
//     ],
//     "entry": "<skill-slug>",         // optional, with areas: the one skill a person types
//     "install": "<install command block for the README>"   // optional
//   }
//
// A spec holds `skills`, `areas`, or both; which to choose is in the
// workbench's core/references/shapes.md.
//
// Output: one JSON object on stdout, `{ok: true, target, created, skipped}`
// or `{ok: false, error}` with exit 1. A file that exists and no longer holds
// a TODO(author) marker has been authored: it is skipped, never overwritten,
// unless --force. No empty directories are created.
//
// What comes out meets a marketplace's structural gate as it stands: the
// manifest, a README with no changelog in it, a CHANGELOG.md whose top entry
// is the manifest version, and SKILL.md frontmatter of four keys at most. An
// area comes out callable and out of the slash menu, its routes listed as
// `<route> (<cue>)`, each route naming its directory from its own file.
import fs from "node:fs";
import path from "node:path";

const STUBS = path.join(import.meta.dirname, "..", "assets", "stubs");
const SEMVER = /^\d+\.\d+\.\d+$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TODO_MARK = "TODO(author)";
const CUE_CAP = 60;
const MODES = ["model", "callable", "user"];
const USAGE = "usage: node plugin-scaffold.mjs <target-dir> --spec <spec.json> [--force]";

class Bail extends Error {}

const readStub = (name) => fs.readFileSync(path.join(STUBS, name), "utf8");
/** Every `{{KEY}}` the mapping names, replaced in one pass so a value is never re-read as a template. */
const fill = (template, mapping) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (token, key) => (Object.hasOwn(mapping, key) ? mapping[key] : token));

/** A string as it sits between the quotes of a JSON value. */
const jsonText = (value) => JSON.stringify(String(value)).slice(1, -1);
/** "my-plugin2go" -> "My Plugin2Go": a capital wherever a letter follows something that is not one. */
const titleCase = (name) => name.replace(/-/g, " ").replace(/(^|[^a-z])([a-z])/g, (_, before, letter) => before + letter.toUpperCase());

const endOnOneNewline = (text) => text.replace(/\n+$/, "\n");

/** Every file the skeleton consists of, as [relative path, content]. */
function planFiles(spec) {
  const name = spec.name;
  const version = spec.version ?? "0.1.0";
  const keywords = spec.keywords?.length ? spec.keywords : [name];
  const install = spec.install
    || `/plugin marketplace add <path-or-repo>\n/plugin install ${name}@<marketplace-name>`;

  const files = [];
  files.push([".claude-plugin/plugin.json", fill(readStub("plugin-json.stub"), {
    NAME: name,
    DISPLAY_NAME: jsonText(spec.displayName || titleCase(name)),
    VERSION: version,
    DESCRIPTION: jsonText(spec.description),
    AUTHOR_NAME: jsonText(spec.author.name),
    AUTHOR_EMAIL: jsonText(spec.author.email),
    KEYWORDS: `[${keywords.map((k) => JSON.stringify(String(k))).join(", ")}]`,
  })]);

  const skillRows = [];
  for (const skill of spec.skills ?? []) {
    const sName = skill.name;
    const mode = skill.mode ?? "model";
    const user = mode === "user";
    const hint = skill.argumentHint ?? "";
    // A skill's own files, each named in its SKILL.md from the start: a file
    // the skill never mentions is one the agent never reaches.
    const sections = [], siblings = [];
    if (skill.withWorkflow) {
      siblings.push([`skills/${sName}/workflows/${sName}.js`, fill(readStub("workflow-js.stub"), { WORKFLOW_NAME: sName })]);
    }
    if (skill.withScripts) {
      siblings.push([`skills/${sName}/scripts/${sName}.mjs`, fill(readStub("script-mjs.stub"), { OWNER: `the ${sName} skill` })]);
      sections.push(fill(readStub("skill-script-section.stub"), { SKILL_NAME: sName }));
    }
    if (skill.withReferences) {
      siblings.push([`skills/${sName}/references/notes.md`,
        `# ${sName} notes\n\n${TODO_MARK}: move detail here when SKILL.md outgrows a quick read; `
        + "SKILL.md must link this file by name.\n"]);
      sections.push(fill(readStub("skill-references-section.stub"), {}));
    }
    if (skill.withWorkflow) sections.push(fill(readStub("skill-workflow-section.stub"), { SKILL_NAME: sName }));
    files.push([`skills/${sName}/SKILL.md`, endOnOneNewline(fill(readStub("skill-md.stub"), {
      SKILL_NAME: sName,
      MODE_LINE: user ? "disable-model-invocation: true\n" : mode === "callable" ? "user-invocable: false\n" : "",
      MODE_NOTE: user
        ? ". It loads only when invoked, so spend words on the contract, not triggers."
        : " AND when to trigger it. This sits in context every turn and must earn it.",
      ARGUMENT_HINT_LINE: hint ? `argument-hint: "${hint.replace(/[\\"]/g, "\\$&")}"\n` : "",
      SECTIONS: sections.join(""),
    }))], ...siblings);
    const invocation = user ? `\`/${name}:${sName}${hint ? " " + hint : ""}\`` : mode === "callable" ? "called by agents" : "model-invoked";
    skillRows.push(`| \`${sName}\` | ${invocation.replace(/\|/g, "\\|")} | ${TODO_MARK} |`);
  }

  // An area: one listed skill for a body of work, and a document per route.
  const cell = (text) => String(text).replace(/\|/g, "\\|");
  const areaRows = [];
  for (const area of spec.areas ?? []) {
    const aName = area.name;
    const lead = area.lead?.trim() || `${TODO_MARK}, when to reach for this area.`;
    const listed = area.routes.map((r) => `${r.name} (${r.cue})`).join("; ");
    files.push([`skills/${aName}/SKILL.md`, fill(readStub("area-md.stub"), {
      AREA_NAME: aName,
      // Routes as `<route> (<cue>)`: `<route>: <cue>` is the listing's own shape, and a model calls it as a skill.
      DESCRIPTION: jsonText(`${lead.replace(/[\s.]+$/, "")}. Routes are its arguments, not skills: ${listed}.`),
      DEFAULT_ROUTE: area.default ?? area.routes[0].name,
      ROUTE_ROWS: area.routes.map((r) => `| \`${r.name}\` | ${cell(r.cue)} | ${r.starts === "person" ? "a person" : "an agent"} |`).join("\n"),
    })]);
    for (const route of area.routes) {
      const rName = route.name;
      const hint = route.argumentHint ?? "";
      files.push([`skills/${aName}/routes/${rName}/ROUTE.md`, endOnOneNewline(fill(readStub("route-md.stub"), {
        ROUTE_NAME: rName,
        ARGUMENT_HINT_LINE: hint ? `argument-hint: "${hint.replace(/[\\"]/g, "\\$&")}"\n` : "",
        SECTIONS: route.withScripts ? fill(readStub("route-script-section.stub"), { ROUTE_NAME: rName }) : "",
      }))]);
      if (route.withScripts) {
        files.push([`skills/${aName}/routes/${rName}/scripts/${rName}.mjs`, fill(readStub("script-mjs.stub"), { OWNER: `the ${rName} route of ${aName}` })]);
      }
    }
    const routes = area.routes.map((r) => `\`${r.name}\``).join(", ");
    skillRows.push(`| \`${aName}\` | an agent calls it; routes: ${routes} | ${TODO_MARK} |`);
    areaRows.push(`| \`${aName}\` | ${TODO_MARK} | ${routes} |`);
  }
  if (spec.entry) {
    files.push([`skills/${spec.entry}/SKILL.md`, fill(readStub("entry-md.stub"), {
      ENTRY_NAME: spec.entry,
      PLUGIN_NAME: name,
      AREA_LIST: spec.areas.map((a) => a.name).join(", "),
      AREA_ROWS: areaRows.join("\n"),
    })]);
    skillRows.unshift(`| \`${spec.entry}\` | \`/${name}:${spec.entry}\`, the one skill to type | ${TODO_MARK} |`);
  }

  files.push(["README.md", fill(readStub("readme.stub"), {
    NAME: name,
    INSTALL_BLOCK: install,
    SKILL_ROWS: skillRows.join("\n"),
  })]);
  files.push(["CHANGELOG.md", fill(readStub("changelog.stub"), { VERSION: version })]);
  return files;
}

/** The spec, checked: every rule a later step would otherwise trip on. */
function checkSpec(spec, target) {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) throw new Bail("spec must be a JSON object");
  if (spec.areas !== undefined && !Array.isArray(spec.areas)) throw new Bail("spec.areas must be a list of areas");
  const hasAreas = Array.isArray(spec.areas) && spec.areas.length > 0;
  for (const key of ["name", "description", "author", ...(hasAreas ? [] : ["skills"])]) {
    if (!spec[key]) throw new Bail(`spec missing required key: ${key}`);
  }
  if (typeof spec.author !== "object" || !spec.author.name || !spec.author.email) {
    throw new Bail("spec.author needs name and email");
  }
  if (!hasAreas && (!Array.isArray(spec.skills) || !spec.skills.length)) throw new Bail("spec.skills must list at least one skill");
  if (spec.skills !== undefined && !Array.isArray(spec.skills)) throw new Bail("spec.skills must be a list of skills");
  if (typeof spec.name !== "string" || !SLUG.test(spec.name)) throw new Bail(`name '${spec.name}' is not a lowercase-hyphen slug`);
  if (path.basename(target) !== spec.name) {
    throw new Bail(`spec name '${spec.name}' != target dir basename '${path.basename(target)}'`);
  }
  if (!SEMVER.test(spec.version ?? "0.1.0")) throw new Bail(`version '${spec.version}' is not semver`);
  const taken = new Set();
  const claim = (kind, n) => { if (taken.has(n)) throw new Bail(`${kind} '${n}' shares its name with another skill: each is a directory under skills/`); taken.add(n); };
  for (const skill of spec.skills ?? []) {
    if (typeof skill?.name !== "string" || !SLUG.test(skill.name)) throw new Bail(`skill name '${skill?.name}' is not a lowercase-hyphen slug`);
    if (!MODES.includes(skill.mode ?? "model")) throw new Bail(`skill ${skill.name}: mode must be model, callable, or user`);
    claim("skill", skill.name);
  }
  for (const area of spec.areas ?? []) {
    if (typeof area?.name !== "string" || !SLUG.test(area.name)) throw new Bail(`area name '${area?.name}' is not a lowercase-hyphen slug`);
    claim("area", area.name);
    if (!Array.isArray(area.routes) || !area.routes.length) throw new Bail(`area ${area.name}: routes must list at least one route`);
    const routes = new Set();
    for (const route of area.routes) {
      if (typeof route?.name !== "string" || !SLUG.test(route.name)) throw new Bail(`area ${area.name}: route name '${route?.name}' is not a lowercase-hyphen slug`);
      if (routes.has(route.name)) throw new Bail(`area ${area.name}: route '${route.name}' is listed twice`);
      routes.add(route.name);
      if (typeof route.cue !== "string" || !route.cue.trim()) throw new Bail(`area ${area.name}: route ${route.name} needs a cue, the route in a few words`);
      if (route.cue.length > CUE_CAP) throw new Bail(`area ${area.name}: route ${route.name}: cue is ${route.cue.length} characters, over ${CUE_CAP}`);
      // The description lists a route as "<route> (<cue>)", so a cue cannot close the bracket or end the item early.
      if (/[();]/.test(route.cue)) throw new Bail(`area ${area.name}: route ${route.name}: a cue holds no bracket and no semicolon`);
      if (route.starts !== undefined && route.starts !== "person") throw new Bail(`area ${area.name}: route ${route.name}: starts is "person" or left out`);
    }
    if (area.default !== undefined && !routes.has(area.default)) throw new Bail(`area ${area.name}: default '${area.default}' is not one of its routes`);
  }
  if (spec.entry !== undefined) {
    if (typeof spec.entry !== "string" || !SLUG.test(spec.entry)) throw new Bail(`entry '${spec.entry}' is not a lowercase-hyphen slug`);
    if (!hasAreas) throw new Bail("spec.entry is the way in to a plugin's areas, and this spec lists none");
    claim("entry", spec.entry);
  }
}

function main(argv) {
  let specPath = null, target = null, force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--spec") specPath = argv[++i] ?? null;
    else if (a.startsWith("--spec=")) specPath = a.slice("--spec=".length);
    else if (a === "--force") force = true;
    else if (a.startsWith("--")) throw new Bail(`unknown option ${a}; ${USAGE}`);
    else if (target === null) target = a;
    else throw new Bail(`one target directory at a time; ${USAGE}`);
  }
  if (!target || !specPath) throw new Bail(USAGE);

  let spec;
  try { spec = JSON.parse(fs.readFileSync(specPath, "utf8")); }
  catch (e) { throw new Bail(`spec unreadable: ${e.message}`); }
  const root = path.resolve(target);
  checkSpec(spec, root);

  const created = [], skipped = [];
  for (const [relPath, content] of planFiles(spec)) {
    const file = path.join(root, relPath);
    try {
      if (!force && fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(TODO_MARK)) { skipped.push(relPath); continue; }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    } catch (e) { throw new Bail(`cannot write ${relPath}: ${e.message}`); }
    created.push(relPath);
  }

  const result = { ok: true, target: root, created, skipped };
  if (skipped.length) {
    result.note = "skipped files were authored already (no TODO(author) marker); pass --force to overwrite";
  }
  console.log(JSON.stringify(result, null, 1));
}

try { main(process.argv.slice(2)); }
catch (e) {
  if (!(e instanceof Bail)) throw e;
  console.log(JSON.stringify({ ok: false, error: e.message }));
  process.exitCode = 1;
}
