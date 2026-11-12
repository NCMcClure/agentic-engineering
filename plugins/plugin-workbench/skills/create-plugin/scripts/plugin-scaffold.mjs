#!/usr/bin/env node
// Deterministic plugin scaffolder for the create-plugin skill.
//
// Reads a confirmed spec (JSON) and emits a complete, installable plugin
// skeleton from the stubs in ../assets/stubs/. The model never types
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
//     "skills": [
//       {"name": "<skill-slug>",
//        "mode": "model" | "user",     // user => disable-model-invocation
//        "argumentHint": "...",        // optional
//        "withWorkflow": false,        // optional: workflows/<name>.js stub
//        "withScripts": false,         // optional: scripts/<name>.mjs stub
//        "withReferences": false}      // optional: references/notes.md
//     ],
//     "install": "<install command block for the README>"   // optional
//   }
//
// Output: one JSON object on stdout, `{ok: true, target, created, skipped}`
// or `{ok: false, error}` with exit 1. A file that exists and no longer holds
// a TODO(author) marker has been authored: it is skipped, never overwritten,
// unless --force. No empty directories are created.
//
// What comes out meets a marketplace's structural gate as it stands: the
// manifest, a README with no changelog in it, a CHANGELOG.md whose top entry
// is the manifest version, and SKILL.md frontmatter of four keys at most.
import fs from "node:fs";
import path from "node:path";

const STUBS = path.join(import.meta.dirname, "..", "assets", "stubs");
const SEMVER = /^\d+\.\d+\.\d+$/;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TODO_MARK = "TODO(author)";
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
  for (const skill of spec.skills) {
    const sName = skill.name;
    const user = (skill.mode ?? "model") === "user";
    const hint = skill.argumentHint ?? "";
    // A skill's own files, each named in its SKILL.md from the start: a file
    // the skill never mentions is one the agent never reaches.
    const sections = [], siblings = [];
    if (skill.withWorkflow) {
      siblings.push([`skills/${sName}/workflows/${sName}.js`, fill(readStub("workflow-js.stub"), { WORKFLOW_NAME: sName })]);
    }
    if (skill.withScripts) {
      siblings.push([`skills/${sName}/scripts/${sName}.mjs`, fill(readStub("script-mjs.stub"), { SKILL_NAME: sName })]);
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
      MODE_LINE: user ? "disable-model-invocation: true\n" : "",
      MODE_NOTE: user
        ? ". It loads only when invoked, so spend words on the contract, not triggers."
        : " AND when to trigger it. This sits in context every turn and must earn it.",
      ARGUMENT_HINT_LINE: hint ? `argument-hint: "${hint.replace(/[\\"]/g, "\\$&")}"\n` : "",
      SECTIONS: sections.join(""),
    }))], ...siblings);
    const invocation = user ? `\`/${name}:${sName}${hint ? " " + hint : ""}\`` : "model-invoked";
    skillRows.push(`| \`${sName}\` | ${invocation.replace(/\|/g, "\\|")} | ${TODO_MARK} |`);
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
  for (const key of ["name", "description", "author", "skills"]) {
    if (!spec[key]) throw new Bail(`spec missing required key: ${key}`);
  }
  if (typeof spec.author !== "object" || !spec.author.name || !spec.author.email) {
    throw new Bail("spec.author needs name and email");
  }
  if (!Array.isArray(spec.skills) || !spec.skills.length) throw new Bail("spec.skills must list at least one skill");
  if (typeof spec.name !== "string" || !SLUG.test(spec.name)) throw new Bail(`name '${spec.name}' is not a lowercase-hyphen slug`);
  if (path.basename(target) !== spec.name) {
    throw new Bail(`spec name '${spec.name}' != target dir basename '${path.basename(target)}'`);
  }
  if (!SEMVER.test(spec.version ?? "0.1.0")) throw new Bail(`version '${spec.version}' is not semver`);
  for (const skill of spec.skills) {
    if (typeof skill?.name !== "string" || !SLUG.test(skill.name)) throw new Bail(`skill name '${skill?.name}' is not a lowercase-hyphen slug`);
    if (!["model", "user"].includes(skill.mode ?? "model")) throw new Bail(`skill ${skill.name}: mode must be model or user`);
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
