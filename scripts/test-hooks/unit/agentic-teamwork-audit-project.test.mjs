// agentic-teamwork's audit-project.mjs: a repo a fresh scaffold made is clean,
// and each thing that can drift from it is one finding, with its fix.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { audit } from "../../../plugins/agentic-teamwork/scripts/audit-project.mjs";
import { runNode, tempRepo, write } from "./helpers.mjs";

const AUDIT = "plugins/agentic-teamwork/scripts/audit-project.mjs";
const INIT = "plugins/agentic-teamwork/scripts/init-project.mjs";
const UPGRADE = /init-project --upgrade/;

/** A repo a fresh scaffold made, committed, with the pre-commit hook turned on. */
function scaffolded(t, extra = []) {
  const { dir, git } = tempRepo(t, "audit-");
  const run = runNode(INIT, ["--name", "zz-audit", "--template", "library", "--description", "A repo to audit.", "--target", dir, "--forge", "github", "--hooks-path", ...extra]);
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "the scaffold");
  return { dir, git };
}
const marker = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".agents", "manifest.json"), "utf8"));
const saveMarker = (dir, value) => write(dir, ".agents/manifest.json", `${JSON.stringify(value, null, 2)}\n`);
const found = (dir, check) => audit(dir).findings.filter((f) => f.check === check);
const one = (dir, check) => {
  const hits = found(dir, check);
  assert.equal(hits.length, 1, `${check}: ${JSON.stringify(audit(dir).findings)}`);
  return hits[0];
};

test("a freshly scaffolded repo has nothing to report", (t) => {
  const { dir } = scaffolded(t);
  assert.deepEqual(audit(dir), { root: dir, errors: 0, warnings: 0, rules_tokens: 0, findings: [] });
  const cli = runNode(AUDIT, ["--root", dir]);
  assert.equal(cli.status, 0);
  assert.equal(cli.stdout, "on the conventions, nothing to report\n");
  assert.deepEqual(JSON.parse(runNode(AUDIT, ["--json"], { cwd: dir }).stdout).findings, []);
});

test("it reports and never fails: the exit code is 0 whatever it found", (t) => {
  const { dir } = tempRepo(t, "audit-bare-");
  const cli = runNode(AUDIT, ["--root", dir]);
  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /^error: marker: no \.agents\/manifest\.json: this repo is not on the conventions -> run \/agentic-teamwork:init-project --upgrade$/m);
  assert.match(cli.stdout, /^1 error\(s\), 0 warning\(s\)$/m);
  assert.equal(audit(dir).findings.length, 1, "an unmarked repo is one finding, not a list of everything it lacks");
});

test("a marker that does not parse, sits below the floor, or lags the current version", (t) => {
  const { dir } = scaffolded(t);
  write(dir, ".agents/manifest.json", "{ not json");
  assert.match(one(dir, "marker").detail, /does not parse/);
  const lagging = scaffolded(t);
  saveMarker(lagging.dir, { ...marker(lagging.dir), standard_version: 0 });
  const floor = one(lagging.dir, "floor");
  assert.equal(floor.severity, "error");
  assert.match(floor.fix, UPGRADE);
});

test("the lanes come from the marker, checked against the package scripts", (t) => {
  const { dir } = scaffolded(t);
  assert.deepEqual(found(dir, "lanes"), [], "lanes that all resolve are not a finding");
  saveMarker(dir, { ...marker(dir), lanes: { unit: "npm run nope", integration: "npm --prefix server test", e2e: "not wired: none", live: "pytest -m live" } });
  const details = found(dir, "lanes").map((f) => f.detail);
  assert.deepEqual(details, [
    'the unit lane runs `npm run nope` but package.json has no "nope" script',
    "the integration lane runs `npm --prefix server test` but server/package.json does not exist",
  ]);
});

test("a marker with no lanes is a finding whose fix is the upgrade", (t) => {
  const { dir } = scaffolded(t);
  const { lanes: _lanes, ...rest } = marker(dir);
  saveMarker(dir, rest);
  const lane = one(dir, "lanes");
  assert.match(lane.detail, /no `lanes`/);
  assert.match(lane.fix, UPGRADE);
});

test("a repo script that differs from the shipped one is drift, and a missing one is an error", (t) => {
  const { dir } = scaffolded(t);
  fs.appendFileSync(path.join(dir, ".agents", "scripts", "lane.mjs"), "// edited here\n");
  const drift = one(dir, "script-drift");
  assert.equal(drift.severity, "warn");
  assert.match(drift.detail, /lane\.mjs differs/);
  fs.rmSync(path.join(dir, ".agents", "scripts", "plugin-check.mjs"));
  const missing = one(dir, "scripts");
  assert.equal(missing.severity, "error");
  assert.match(missing.detail, /plugin-check\.mjs is missing/);
});

test("what the repo's own check finds is passed on, a warning as a warning", (t) => {
  const { dir } = scaffolded(t);
  fs.rmSync(path.join(dir, "CLAUDE.md"));
  fs.rmSync(path.join(dir, ".github"), { recursive: true });
  const errors = found(dir, "verify-standard");
  assert.deepEqual(errors.map((f) => [f.severity, f.detail.split(":")[0]]), [["error", "claude-md"], ["error", "ci-gate"]]);
  assert.ok(errors.every((f) => UPGRADE.test(f.fix)));

  const unforged = scaffolded(t);
  saveMarker(unforged.dir, { ...marker(unforged.dir), forge: "none" });
  fs.rmSync(path.join(unforged.dir, ".github"), { recursive: true });
  const warned = one(unforged.dir, "verify-standard");
  assert.equal(warned.severity, "warn");
  assert.match(warned.detail, /^ci-gate: no CI runs verify-standard\.mjs yet/);
});

test("the pre-commit hook: missing, drifted, and not turned on in this clone", (t) => {
  const { dir, git } = scaffolded(t);
  git("config", "--unset", "core.hooksPath");
  const off = one(dir, "hooks-path");
  assert.equal(off.severity, "info");
  assert.match(off.fix, /git config core\.hooksPath \.githooks \(ask first/);
  assert.equal(audit(dir).warnings, 0, "one clone's setting is not a warning on the repo");

  fs.appendFileSync(path.join(dir, ".githooks", "pre-commit"), "// a step of our own\n");
  assert.equal(one(dir, "pre-commit-drift").severity, "warn");
  fs.rmSync(path.join(dir, ".githooks"), { recursive: true });
  assert.match(one(dir, "pre-commit").detail, /a commit made in a terminal is unguarded/);
});

test("a shared permission rule that has gone missing is a finding", (t) => {
  const { dir } = scaffolded(t);
  const file = path.join(dir, ".claude", "settings.json");
  const settings = JSON.parse(fs.readFileSync(file, "utf8"));
  settings.permissions.deny = settings.permissions.deny.filter((e) => !e.includes("--no-verify"));
  fs.writeFileSync(file, JSON.stringify(settings));
  const missing = one(dir, "settings");
  assert.match(missing.detail, /lacks 2 shared permission rule\(s\), starting with: deny Bash\(git commit --no-verify:\*\)/);
  assert.match(missing.fix, UPGRADE);
});

test("a strict test gate with nothing to run is a finding; one with a command is not", (t) => {
  const { dir } = scaffolded(t, ["--strict"]);
  assert.deepEqual(found(dir, "strict-gate"), []);
  saveMarker(dir, { ...marker(dir), teamwork: { requireTestsPass: true } });
  assert.match(one(dir, "strict-gate").fix, /--strict --test-command/);
  saveMarker(dir, { ...marker(dir), teamwork: { requireTestsPass: true, build: { command: "make" } } });
  assert.deepEqual(found(dir, "strict-gate"), [], "a build command stands in where there are no tests yet");
});

test("the first layout's settings file is named, with who moves it", (t) => {
  const { dir } = scaffolded(t);
  write(dir, ".claude/teamwork.json", '{ "version": 1 }\n');
  const first = one(dir, "first-layout");
  assert.equal(first.severity, "warn");
  assert.match(first.fix, /session hook moves the file/);
});

test("a repo that calls a model and has no live lane is an error", (t) => {
  const { dir } = scaffolded(t);
  const pkgFile = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
  fs.writeFileSync(pkgFile, JSON.stringify({ ...pkg, dependencies: { "@anthropic-ai/sdk": "1.0.0", express: "5.0.0" } }));
  const live = one(dir, "live-lane");
  assert.equal(live.severity, "error");
  assert.match(live.detail, /calls a model \(@anthropic-ai\/sdk\) and has no live lane/);
  assert.match(live.fix, /\/agentic-teamwork:tdd, references\/live-lane\.md/);

  saveMarker(dir, { ...marker(dir), lanes: { ...marker(dir).lanes, live: "RUN_LIVE_TESTS=1 node --test test/live" } });
  assert.deepEqual(found(dir, "live-lane"), [], "a wired live lane answers it");
});

test("a credential in the index is reported as file:line, never as its value", (t) => {
  const { dir, git } = scaffolded(t);
  // Built here so that no credential-shaped text sits in this file.
  const token = `ghp_${"a1B2".repeat(9)}`;
  write(dir, "src/config.mjs", `export const port = 8080;\nexport const token = "${token}";\n`);
  git("add", "src/config.mjs");
  const secret = one(dir, "secret");
  assert.equal(secret.severity, "error");
  assert.equal(secret.detail, "src/config.mjs:2 matches a credential pattern");
  assert.match(secret.fix, /rotate it/);
  assert.equal(JSON.stringify(audit(dir)).includes(token), false);
});

test("one person's settings in the index is an error", (t) => {
  const { dir, git } = scaffolded(t);
  write(dir, ".claude/settings.local.json", "{}\n");
  assert.deepEqual(found(dir, "personal-settings"), [], "ignored and untracked is how it should be");
  git("add", "-f", ".claude/settings.local.json");
  assert.match(one(dir, "personal-settings").fix, /git rm --cached \.claude\/settings\.local\.json/);
});

test("the repo's own rules are counted, and a long one is named", (t) => {
  const { dir } = scaffolded(t);
  write(dir, ".agents/rules/house.md", `${"A rule line.\n".repeat(60)}`);
  fs.appendFileSync(path.join(dir, "AGENTS.md"), "\n@.agents/rules/house.md\n");
  const report = audit(dir);
  assert.equal(report.rules_tokens, Math.floor((60 * 13) / 4));
  assert.match(one(dir, "rule-length").detail, /house\.md is 61 lines/);
  write(dir, ".agents/rules/house.md", "x".repeat(4 * 2501));
  assert.match(one(dir, "rules-budget").detail, /over the 2500 budget/);
});
