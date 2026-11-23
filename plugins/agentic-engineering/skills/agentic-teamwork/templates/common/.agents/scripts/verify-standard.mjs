#!/usr/bin/env node
// Does this repo still carry its team's conventions? CI runs this on every
// change request; run it by hand any time. Node 22 stdlib only: no network, no
// git, nothing to install. It reads the tree it sits in.
//
// Usage: node .agents/scripts/verify-standard.mjs [--floor <n>] [--json] [--root <dir>]
//   --floor  the lowest standard_version the marker may declare (default: none,
//            so only its shape is checked)
//   --json   one JSON object instead of lines
//   --root   check another checkout (default: the repo this script is in)
//   --quick  accepted and ignored: every check here is already cheap
//
// Findings, exit 1 on any:
//   marker            .agents/manifest.json is missing, does not parse, or has
//                     no integer standard_version
//   floor             standard_version is below the floor
//   hub               the root AGENTS.md is missing
//   claude-md         the root CLAUDE.md is missing, or is not a link to
//                     AGENTS.md (a symlink, or one line: @AGENTS.md)
//   rules-imported    a file in .agents/rules/ that AGENTS.md does not import
//   gitignore-fence   the managed .gitignore block is missing
//   ci-gate           no CI config on this repo's forge runs this script
//   scripts-present   a script the gate or the session hook runs is missing
//
// A warning prints as `warning: <finding>: <detail>` and never fails the run.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1] ?? null; };
const JSON_OUT = argv.includes("--json");

const root = path.resolve(flag("--root") ?? path.join(import.meta.dirname, "..", ".."));
const at = (...p) => path.join(root, ...p);
const read = (...p) => { try { return fs.readFileSync(at(...p), "utf8"); } catch { return null; } };
const list = (...p) => { try { return fs.readdirSync(at(...p)); } catch { return []; } };

const GITIGNORE_START = "# >>> agentic-teamwork";
const GITIGNORE_END = "# <<< agentic-teamwork";
const SELF = "verify-standard.mjs";
const GATE_SCRIPTS = [SELF, "lane.mjs"];
const GITLAB_PIPELINE = ".gitlab-ci.yml";

const findings = [];
const warnings = [];
const add = (finding, detail) => findings.push({ finding, detail });
const warn = (finding, detail) => warnings.push({ finding, detail });

// --- the marker -----------------------------------------------------------
let manifest = null;
const manifestText = read(".agents", "manifest.json");
if (manifestText === null) add("marker", ".agents/manifest.json is missing: this repo has not been put on the conventions");
else {
  try { manifest = JSON.parse(manifestText); } catch (e) { add("marker", `.agents/manifest.json does not parse: ${e.message}`); }
}
if (manifest) {
  const version = Number(manifest.standard_version);
  if (!Number.isInteger(version)) add("marker", `.agents/manifest.json standard_version is "${manifest.standard_version}", not an integer`);
  else {
    const floor = flag("--floor");
    if (floor !== null && version < Number(floor)) add("floor", `standard_version ${version} is below the floor ${floor}`);
  }
}

// --- the hub and its link -------------------------------------------------
const hub = read("AGENTS.md");
if (hub === null) add("hub", "AGENTS.md is missing at the repo root");

let twin = null;
try { twin = fs.lstatSync(at("CLAUDE.md")); } catch { /* absent */ }
if (!twin) add("claude-md", "CLAUDE.md is missing at the repo root: link it to AGENTS.md (a symlink, or one line: @AGENTS.md)");
else if (twin.isSymbolicLink()) {
  const to = fs.readlinkSync(at("CLAUDE.md"));
  if (to !== "AGENTS.md") add("claude-md", `the root CLAUDE.md links to ${to}, not AGENTS.md`);
} else if (!["@AGENTS.md", "AGENTS.md"].includes((read("CLAUDE.md") ?? "").trim())) {
  // A checkout that cannot hold a symlink has the link's text in its place.
  add("claude-md", "the root CLAUDE.md has content of its own: move it into AGENTS.md and make CLAUDE.md a link to it");
}

// --- the repo's own rules and their imports -------------------------------
if (hub !== null) {
  const missing = list(".agents", "rules").filter((f) => f.endsWith(".md") && !hub.includes(`@.agents/rules/${f}`));
  if (missing.length) add("rules-imported", `AGENTS.md carries no @ import for: ${missing.sort().join(", ")}`);
}

// --- the managed .gitignore block -----------------------------------------
const gitignore = read(".gitignore");
if (gitignore === null || !gitignore.includes(GITIGNORE_START) || !gitignore.includes(GITIGNORE_END)) {
  add("gitignore-fence", `.gitignore is missing the managed block between "${GITIGNORE_START}" and "${GITIGNORE_END}"`);
}

// --- the CI gate ----------------------------------------------------------
// Where the gate lives is the repo's business; that some CI config on its
// forge runs this script is the check.
const workflows = list(".github", "workflows").filter((f) => /\.ya?ml$/.test(f));
const onGithub = workflows.some((f) => (read(".github", "workflows", f) ?? "").includes(SELF));
const pipeline = read(GITLAB_PIPELINE);
// Every local YAML file the pipeline names, whichever way its include is written.
const included = [...(pipeline ?? "").matchAll(/[A-Za-z0-9_.\/-]+\.ya?ml/g)].map((m) => m[0].replace(/^\/+/, ""));
const onGitlab = pipeline !== null && (pipeline.includes(SELF) || included.some((f) => (read(...f.split("/")) ?? "").includes(SELF)));
const forge = ["github", "gitlab"].includes(manifest?.forge) ? manifest.forge : null;
const fix = "/agentic-teamwork:init-project --upgrade writes it";
if (forge === "github" && !onGithub) add("ci-gate", `no workflow under .github/workflows/ runs ${SELF}; ${fix}`);
else if (forge === "gitlab" && !onGitlab) add("ci-gate", pipeline === null ? `${GITLAB_PIPELINE} is missing; ${fix}` : `${GITLAB_PIPELINE} neither runs ${SELF} nor includes a local file that does; ${fix}`);
else if (!forge && !onGithub && !onGitlab) warn("ci-gate", `no CI runs ${SELF} yet: the marker names no forge. Once the repo has a remote, ${fix}`);

// --- the scripts the gate and the session hook run --------------------------
for (const script of GATE_SCRIPTS) {
  if (!fs.existsSync(at(".agents", "scripts", script))) add("scripts-present", `.agents/scripts/${script} is missing`);
}
if ((read(".claude", "settings.json") ?? "").includes("plugin-check.mjs") && !fs.existsSync(at(".agents", "scripts", "plugin-check.mjs"))) {
  add("scripts-present", ".claude/settings.json runs .agents/scripts/plugin-check.mjs, which is missing");
}

if (JSON_OUT) console.log(JSON.stringify({ ok: findings.length === 0, findings, warnings }));
else {
  for (const f of findings) console.log(`${f.finding}: ${f.detail}`);
  for (const w of warnings) console.log(`warning: ${w.finding}: ${w.detail}`);
  console.log(findings.length ? `${findings.length} finding(s)` : "conventions ok");
}
process.exitCode = findings.length ? 1 : 0;
