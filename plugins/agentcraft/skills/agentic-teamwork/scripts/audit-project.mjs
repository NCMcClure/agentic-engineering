#!/usr/bin/env node
// Everything checkable about one repo's hold on its team's conventions, in one
// pass. `verify-standard.mjs` (shipped into the repo, run by CI) answers "are
// the marker and the layout right"; this answers the wider question: drift of
// the repo's scripts and pre-commit hook against the ones this plugin ships,
// the shared permission rules, the lane commands against the package scripts,
// a strict test gate with nothing to run, and credentials in the index.
//
// Usage: node audit-project.mjs [--root <dir>] [--json]
// Findings carry a `fix` when there is a mechanical one; the skill applies it.
// Exit 0 always: this reports, the skill decides.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sha256 } from "./render.mjs";

const PLUGIN = path.join(import.meta.dirname, "..");
const TEMPLATES = path.join(PLUGIN, "templates");
const STANDARD = JSON.parse(fs.readFileSync(path.join(PLUGIN, "standard.json"), "utf8"));
const UPGRADE = "run /agentic-teamwork:init-project --upgrade";
const REPO_SCRIPTS = ["verify-standard.mjs", "lane.mjs", "plugin-check.mjs"];
// A dependency whose presence means this repo calls a model, so its tests need a live lane.
const INFERENCE_DEPS = /^(@anthropic-ai\/|@aws-sdk\/client-bedrock|openai$|@google\/(generative-ai|genai)$|@mistralai\/|cohere-ai$|@ai-sdk\/|ai$|langchain|@langchain\/|ollama$)/;
const RULES_TOKEN_BUDGET = 2500;
// High-signal credential shapes only: a pattern here must never fire on ordinary source.
const SECRET_RE = /sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const wired = (command) => typeof command === "string" && command !== "" && !/^not wired\b/i.test(command);
const normalized = (file) => sha256(Buffer.from(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")));

/** One repo's findings: `{ root, errors, warnings, rules_tokens, findings: [{ check, severity, detail, fix? }] }`. */
export function audit(root) {
  const at = (...p) => path.join(root, ...p);
  const read = (...p) => { try { return fs.readFileSync(at(...p), "utf8"); } catch { return null; } };
  const readJson = (...p) => { try { return JSON.parse(read(...p)); } catch { return null; } };
  const findings = [];
  const add = (check, severity, detail, fix = null) => findings.push({ check, severity, detail, ...(fix ? { fix } : {}) });

  // ---- the marker ---------------------------------------------------------
  const parsed = readJson(".agents", "manifest.json");
  const marker = isObject(parsed) ? parsed : null;
  if (!marker) {
    add("marker", "error", read(".agents", "manifest.json") === null ? "no .agents/manifest.json: this repo is not on the conventions" : ".agents/manifest.json does not parse", UPGRADE);
  } else if (marker.standard_version < STANDARD.floor) {
    add("floor", "error", `standard_version ${marker.standard_version} is below the floor ${STANDARD.floor}`, UPGRADE);
  } else if (marker.standard_version < STANDARD.standard_version) {
    add("standard-version", "warn", `on conventions v${marker.standard_version}, current is v${STANDARD.standard_version}`, UPGRADE);
  }
  // The plugin's first layout kept its settings here. The hooks still honor
  // the file; the session hook is what moves it.
  if (fs.existsSync(at(".claude", "teamwork.json"))) {
    add("first-layout", "warn", ".claude/teamwork.json is the plugin's first layout: its settings belong in the marker's `teamwork` block", "start a session with agentic-teamwork enabled: its session hook moves the file");
  }

  // ---- the repo's own scripts, against the ones this plugin ships ---------
  for (const script of marker ? REPO_SCRIPTS : []) {
    const shipped = path.join(TEMPLATES, "common", ".agents", "scripts", script);
    if (!fs.existsSync(at(".agents", "scripts", script))) { add("scripts", "error", `.agents/scripts/${script} is missing`, UPGRADE); continue; }
    if (normalized(at(".agents", "scripts", script)) !== normalized(shipped)) {
      add("script-drift", "warn", `.agents/scripts/${script} differs from the one this plugin ships`, `${UPGRADE} (it shows the diff and keeps an edited file)`);
    }
  }

  // ---- the repo's own rules, and what they cost ----------------------------
  let ruleFiles = [];
  try { ruleFiles = fs.readdirSync(at(".agents", "rules")).filter((f) => f.endsWith(".md")).sort(); } catch { /* none */ }
  let ruleChars = 0;
  for (const rule of ruleFiles) {
    const text = read(".agents", "rules", rule) ?? "";
    ruleChars += text.length;
    const lines = text.split("\n").length;
    if (lines > 51) add("rule-length", "warn", `.agents/rules/${rule} is ${lines} lines; a rule loaded in every session earns its keep under 50`);
  }
  const ruleTokens = Math.floor(ruleChars / 4);
  if (ruleTokens > RULES_TOKEN_BUDGET) add("rules-budget", "warn", `the rules total ${ruleTokens} estimated tokens, over the ${RULES_TOKEN_BUDGET} budget; every one of them costs context in every session`);

  // ---- the repo's own check, run -------------------------------------------
  const verify = at(".agents", "scripts", "verify-standard.mjs");
  if (fs.existsSync(verify)) {
    let out = "";
    let failed = false;
    try { out = execFileSync(process.execPath, [verify, "--floor", String(STANDARD.floor)], { cwd: root, encoding: "utf8", stdio: "pipe" }); }
    catch (e) { out = String(e.stdout ?? ""); failed = true; }
    for (const line of out.trim().split("\n").filter(Boolean)) {
      // The gate's own marker and floor lines repeat the two findings above.
      if (line.startsWith("warning: ")) add("verify-standard", "warn", line.slice("warning: ".length));
      else if (failed && !/finding\(s\)$/.test(line) && !/^(marker|floor): /.test(line)) add("verify-standard", "error", line, /^(ci-gate|gitignore-fence|scripts-present|claude-md|hub): /.test(line) ? UPGRADE : null);
    }
  }

  // ---- the pre-commit hook, for commits made outside an agent --------------
  const hookTemplate = path.join(TEMPLATES, "githooks", "pre-commit");
  if (marker && fs.existsSync(hookTemplate)) {
    const hook = at(".githooks", "pre-commit");
    if (!fs.existsSync(hook)) add("pre-commit", "warn", ".githooks/pre-commit is missing, so a commit made in a terminal is unguarded", UPGRADE);
    else {
      if (normalized(hook) !== normalized(hookTemplate)) add("pre-commit-drift", "warn", ".githooks/pre-commit differs from the one this plugin ships", `${UPGRADE} (it replaces an untouched hook and keeps an edited one)`);
      let hooksPath = "";
      try { hooksPath = execFileSync("git", ["-C", root, "config", "core.hooksPath"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* unset */ }
      if (hooksPath !== ".githooks") add("hooks-path", "info", "core.hooksPath is not .githooks in this clone, so its pre-commit hook does not run", "git config core.hooksPath .githooks (ask first: it changes this clone's behavior)");
    }
  }

  // ---- the shared permission rules -----------------------------------------
  if (marker) {
    const wanted = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "settings.merge.json"), "utf8")).permissions ?? {};
    const have = readJson(".claude", "settings.json")?.permissions ?? {};
    const missing = Object.entries(wanted).flatMap(([list, entries]) => entries.filter((e) => !(Array.isArray(have[list]) ? have[list] : []).includes(e)).map((e) => `${list} ${e}`));
    if (missing.length) add("settings", "warn", `.claude/settings.json lacks ${missing.length} shared permission rule(s), starting with: ${missing[0]}`, UPGRADE);
  }

  // ---- lanes against the package scripts ------------------------------------
  if (marker && !isObject(marker.lanes)) add("lanes", "warn", "the marker has no `lanes`, so an agent has no lane command to run", `${UPGRADE} (it records the test command it finds)`);
  for (const [lane, command] of Object.entries(isObject(marker?.lanes) ? marker.lanes : {})) {
    if (!wired(command)) continue;
    const npm = /\bnpm(?:\s+--prefix\s+(\S+))?\s+(?:run\s+)?([A-Za-z0-9:_-]+)/.exec(command);
    if (!npm) continue;
    const pkgPath = npm[1] ? `${npm[1]}/package.json` : "package.json";
    const pkg = readJson(...pkgPath.split("/"));
    if (!pkg) add("lanes", "warn", `the ${lane} lane runs \`${command}\` but ${pkgPath} does not exist`);
    else if (!pkg.scripts?.[npm[2]]) add("lanes", "warn", `the ${lane} lane runs \`${command}\` but ${pkgPath} has no "${npm[2]}" script`);
  }

  // ---- the opt-in hard gate, with something to run --------------------------
  const teamwork = isObject(marker?.teamwork) ? marker.teamwork : null;
  if (teamwork?.requireTestsPass === true && !wired(teamwork.test?.command) && !wired(teamwork.build?.command)) {
    add("strict-gate", "warn", "the marker's `teamwork.requireTestsPass` is on with no `teamwork.test.command`, so the gate has nothing to run", `${UPGRADE} --strict --test-command "<the command that runs the tests>"`);
  }

  // ---- the live lane, where inference is a dependency -----------------------
  const manifests = [];
  const findPackages = (dir, depth = 0) => {
    if (depth > 2) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      if (entry.isDirectory()) findPackages(path.join(dir, entry.name), depth + 1);
      else if (entry.name === "package.json") manifests.push(path.join(dir, entry.name));
    }
  };
  findPackages(root);
  const packages = manifests.map((file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }).filter(isObject);
  const inferenceDeps = new Set(packages.flatMap((pkg) => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((dep) => INFERENCE_DEPS.test(dep))));
  if (inferenceDeps.size && !wired(marker?.lanes?.live) && !packages.some((pkg) => Object.keys(pkg.scripts ?? {}).some((s) => /live/.test(s)))) {
    add("live-lane", "error", `this repo calls a model (${[...inferenceDeps].join(", ")}) and has no live lane`, "see /agentic-teamwork:tdd, references/live-lane.md");
  }

  // ---- what must never be in the index --------------------------------------
  let tracked = [];
  try { tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\0").filter(Boolean); } catch { /* not a repo */ }
  for (const file of tracked) {
    if (/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip|lock)$/.test(file)) continue;
    let text;
    try { if (fs.statSync(at(file)).size > 512 * 1024) continue; text = fs.readFileSync(at(file), "utf8"); } catch { continue; }
    text.split("\n").forEach((line, i) => {
      // file:line, never the value.
      if (SECRET_RE.test(line)) add("secret", "error", `${file}:${i + 1} matches a credential pattern`, "remove it, then rotate it: it is in the index, so it is compromised");
    });
  }
  if (tracked.includes(".claude/settings.local.json")) {
    add("personal-settings", "error", ".claude/settings.local.json is tracked: it is one person's settings, and .claude/settings.json is the shared file", "git rm --cached .claude/settings.local.json, then check the .gitignore block");
  }

  const count = (s) => findings.filter((f) => f.severity === s).length;
  return { root, errors: count("error"), warnings: count("warn"), rules_tokens: ruleTokens, findings };
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename); } catch { return false; } };

if (isMain()) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--root");
  const summary = audit(path.resolve(i === -1 ? process.cwd() : argv[i + 1] ?? process.cwd()));
  if (argv.includes("--json")) console.log(JSON.stringify(summary));
  else {
    for (const f of summary.findings) console.log(`${f.severity}: ${f.check}: ${f.detail}${f.fix ? ` -> ${f.fix}` : ""}`);
    console.log(summary.findings.length ? `${summary.errors} error(s), ${summary.warnings} warning(s)` : "on the conventions, nothing to report");
  }
  process.exitCode = 0;
}
