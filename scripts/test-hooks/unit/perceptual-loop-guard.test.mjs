// perceptual-loop's render guard: the budget in bash and PowerShell spellings,
// readers and quoted text, here-document bodies, a command inside `bash -c` or
// `powershell -Command`, the agent-works lock wrapper, a targeted baseline
// update, and the hook itself (inert with no config, silent on allow, silent
// where the plugins are off, fail open).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hookCommand } from "../../lib.mjs";
import * as rules from "../../../plugins/perceptual-loop/scripts/lib/guard-rules.mjs";
import { PLUGIN, runNode, tempDir, write } from "./perceptual-loop-fixtures.mjs";

const HOOK = path.join(PLUGIN, "hooks", "guard.mjs");
const SHOTS = [...Array.from({ length: 6 }, (_, i) => `sky_${i}`), "cockpit_a", "cockpit_b", "road_top"];
const GROUPS = { sky: ["sky_*"], smoke: ["sky_0", "cockpit_a", "road_top"], cabins: ["cockpit_*"], most: ["*", "!road_*"] };
const CONFIG = { budget: { free: 3, match: ["shot-render", "npm run render", String.raw`pl\.mjs["']?\s+iterate\b`] } };
// the CLI as a skill writes it, and as the log shows it once a shell has taken the quotes off
const CLI = 'node "/opt/plugins/perceptual-loop/scripts/pl.mjs"';
const CLI_WORDS = "node /opt/plugins/perceptual-loop/scripts/pl.mjs";

function project(config = CONFIG, dir = ".agents/perceptual") {
  const root = tempDir("pl-guard-");
  for (const s of SHOTS) write(root, `${dir}/shots/${s}/shot.json`, JSON.stringify({ name: s }));
  write(root, `${dir}/config.json`, typeof config === "string" ? config : JSON.stringify(config));
  write(root, `${dir}/groups.json`, JSON.stringify(GROUPS));
  return root;
}

const root = project();
const logFile = path.join(root, ".agents/perceptual/runs/budget.log");
const log = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n") : []);
const clearLog = () => fs.rmSync(logFile, { force: true });
const allow = (cmd) => assert.equal(rules.decide(cmd, root), null, `denied: ${cmd}`);
function deny(cmd, ...needles) {
  const reason = rules.decide(cmd, root);
  assert.ok(reason, `not denied: ${cmd}`);
  for (const n of needles) assert.ok(reason.includes(n), `"${n}" not in: ${reason}`);
  return reason;
}

test("within the free budget nothing is refused or logged", () => {
  clearLog();
  allow("npm run render -- sky_0 sky_1 sky_2");
  allow("npm run render -- sky_0,sky_1 cockpit_a");
  allow(`${CLI} iterate --group smoke`);
  allow(`${CLI} iterate --group sky --match 'sky_[01]'`);
  allow(`${CLI} iterate --all --match 'road_*'`);
  allow(`${CLI} iterate sky_0 sky_1 --source candidate --run candidate`);
  assert.deepEqual(log(), []);
});

test("too many shots is refused, and the message teaches the smallest run in both shells", () => {
  const r = deny("npm run render -- sky_0 sky_1 sky_2 sky_3", "renders 4 shots", "1-3 shots", "--dry-run", 'PL_RUN="verify:', "$env:PL_RUN", "not a security boundary", "in a file");
  assert.match(r, /full suite/);
  deny(`${CLI} iterate --group sky`, "renders 6 shots (--group sky)");
  deny(`${CLI} iterate --group=sky`, "renders 6 shots");
  deny(`${CLI} iterate --all`, "renders 9 shots (--all)");
  deny(`${CLI} iterate --group most`, "renders 8 shots");
  deny(`${CLI} iterate --shots sky_0,sky_1,sky_2,sky_3`, "renders 4 shots");
  deny(`${CLI} iterate 'sky_*'`, "renders 6 shots");
  deny(`${CLI} iterate --match 'sky_*'`, "renders 6 shots");
  deny(`cd tools && ${CLI} iterate --all 2>&1 | tail -5`, "renders 9 shots");
  deny(`FOO=1 env ${CLI} iterate --all`, "renders 9 shots");
  deny(`(${CLI} iterate --all)`, "renders 9 shots");
});

test("a stated reason allows a large run and logs it, tab-separated", () => {
  clearLog();
  allow(`PL_RUN="verify: the sky colour works on sky_0, this checks the group" ${CLI} iterate --group sky`);
  allow(`PL_RUN='full: issue 12 is finished' ${CLI} iterate --all`);
  allow(`export PL_RUN="full: issue 12 is finished"; ${CLI} iterate --all`);
  const lines = log();
  assert.equal(lines.length, 3);
  const [when, kind, n, why, head] = lines[0].split("\t");
  assert.match(when, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.deepEqual([kind, n, why], ["verify", "6", "the sky colour works on sky_0, this checks the group"]);
  assert.equal(head, `${CLI_WORDS} iterate --group sky`);
  assert.deepEqual(lines[1].split("\t").slice(1, 3), ["full", "9"]);
});

test("a reason must name its kind and say why, where a shell would read it", () => {
  deny(`PL_RUN=1 ${CLI} iterate --all`, 'PL_RUN is "1"');
  deny(`PL_RUN="verify:" ${CLI} iterate --all`);
  deny(`PL_RUN="because I want to" ${CLI} iterate --all`);
  deny(`echo PL_RUN="verify: quoted by a reader does not count"; ${CLI} iterate --all`);
  deny(`git commit -m 'PL_RUN="full: said in a message"' && ${CLI} iterate --all`);
});

test("PowerShell spellings: -Flag, & to call a script, $env: for the reason", () => {
  clearLog();
  deny("powershell -File engines/scripts/shot-render.ps1 -All", "renders 9 shots");
  deny("& ./scripts/shot-render.ps1 -Group sky", "renders 6 shots");
  allow('$env:AGENT = "ue-1"; $env:PL_RUN = "verify: smoke passed, this is the sky group"; ./scripts/shot-render.ps1 -Group sky');
  allow('$env:AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky -Match "sky_[012]"');
  deny('$env:AGENT = "ue-1"; ./scripts/shot-render.ps1 -Group sky', "renders 6 shots");
  // an assignment is not a command, even when its text matches a render pattern
  allow('$env:NOTE = "npm run render -- sky_0 sky_1 sky_2 sky_3"');
  assert.equal(log().length, 1);
});

test("nothing rendered is never blocked", () => {
  for (const flag of ["--dry-run", "--list", "--skip-render", "--help", "-List", "-WhatIf"]) allow(`${CLI} iterate --all ${flag}`);
  allow("./scripts/shot-render.ps1 -All -List");
});

test("a count the text does not give never blocks", () => {
  allow("npm run render");
  allow("npm run render -- new_shot_1 new_shot_2 new_shot_3 new_shot_4");
  allow(`${CLI} iterate --group nosuchgroup`);
  allow("npm run render -- $SHOTS");
});

test("readers and quoted text do not match", () => {
  allow(`git commit -m 'npm run render -- sky_0 sky_1 sky_2 sky_3; pl.mjs iterate --all'`);
  allow('git commit -m "render: pl.mjs iterate --all is refused; use shot-render with --group"');
  allow('gh pr create --title "pl.mjs iterate --all" --body "ran shot-render -All && pl.mjs iterate --all | tail"');
  allow('glab mr create --description "pl.mjs iterate --all ran once"');
  allow(`echo '${CLI} iterate --all'`);
  allow("grep -rn 'pl.mjs iterate --all' docs/ | head -3");
  allow("cat scripts/pl.mjs; ls shot-render.sh; rg 'npm run render -- --all'");
  allow("Get-Content scripts/shot-render.ps1 | Select-String 'pl.mjs iterate --all'");
  allow("cd tools/shot-render && ls");
});

test("here-document and here-string bodies are skipped, and what follows them is a command again", () => {
  allow(`git commit -F - <<'EOF'\nrender: ${CLI} iterate --all\nshot-render.sh --all\nEOF`);
  allow(`node notes.mjs <<EOF\n${CLI} iterate --all\nEOF\nnpm run render -- sky_0`);
  allow(`node notes.mjs <<-EOF\n\t${CLI} iterate --all\n\tEOF`);
  allow(`$body = @'\n${CLI} iterate --all\n./shot-render.ps1 -All\n'@\nSet-Content note.md $body`);
  allow(`$body = @"\n${CLI} iterate --all\n"@; Write-Output $body`);
  deny(`node notes.mjs <<EOF\nharmless\nEOF\n${CLI} iterate --all`, "renders 9 shots");
  deny(`node - <<< 'x'; ${CLI} iterate --all`, "renders 9 shots");
});

test("a command inside bash -c or powershell -Command is read as the command it runs", () => {
  clearLog();
  deny(`bash -c '${CLI} iterate --all'`, "renders 9 shots");
  deny(`bash -lc "cd tools && npm run render -- sky_0 sky_1 sky_2 sky_3"`, "renders 4 shots");
  deny(`sh -c 'bash -c "npm run render -- sky_0 sky_1 sky_2 sky_3"'`, "renders 4 shots");
  deny(`powershell -NoProfile -Command "./scripts/shot-render.ps1 -All"`, "renders 9 shots");
  deny(`pwsh -c "& ./scripts/shot-render.ps1 -Group sky"`, "renders 6 shots");
  deny(`bash -c '${CLI} baseline update'`, "--source");
  allow(`bash -c '${CLI} iterate sky_0 sky_1'`);
  allow(`bash -c "echo 'pl.mjs iterate --all'"`);
  allow(`powershell -Command "Write-Output 'shot-render.ps1 -All'"`);
  assert.deepEqual(log(), []);
  // a reason set inside the line, or in front of the shell, both count
  allow(`bash -c 'PL_RUN="full: finished" ${CLI} iterate --all'`);
  allow(`PL_RUN="verify: sky_0 works" bash -c '${CLI} iterate --group sky'`);
  assert.deepEqual(log().map((l) => l.split("\t").slice(1, 3)), [["full", "9"], ["verify", "6"]]);
});

test("the agent-works lock wrapper is judged as the command it runs", () => {
  clearLog();
  allow('aw lock run editor --for "tests, 3 min" -- ./scripts/shot-render.sh sky_0 sky_1');
  allow('aw lock run editor --as ue-1 --for "x" --max-minutes 5 -- "./scripts/shot-render.sh sky_0 sky_1"');
  allow('aw lease gpu --share 0.5 --mem 12GB --for "three shots" -- npm run render -- sky_0 sky_1 sky_2');
  allow("aw lock run sim --for x -- aw lock run editor --for x -- ./run-in-session.ps1 shot-render sky_0");
  allow(`aw lease gpu --for x -- aw lock run editor --for x -- ${CLI} iterate --group smoke`);
  allow(`node "/plugins/agent-works/cli/aw.mjs" lock run editor --for "x" -- ${CLI} iterate sky_0`);
  assert.deepEqual(log(), []);
  deny('aw lock run editor --for "x" -- ./scripts/shot-render.sh --all', "renders 9 shots");
  deny(`aw lease gpu --share 1 --for "x" -- ${CLI} iterate --group sky`, "renders 6 shots (--group sky)");
  deny(`aw lock run sim --for x -- aw lease gpu --for x -- ${CLI} iterate --all`, "renders 9 shots");
  deny(`aw.cmd lock run editor --for x -- "${CLI_WORDS} iterate --all"`, "renders 9 shots");
  deny(`python -B "/plugins/agent-works/cli/aw.py" lease gpu --for x -- ${CLI} iterate --all`, "renders 9 shots");
  deny("AGENT=ue-1 aw lock run editor --for x -- npm run render -- sky_0 sky_1 sky_2 sky_3", "renders 4 shots");
  deny(`bash -c 'aw lock run editor --for x -- ${CLI} iterate --all'`, "renders 9 shots");
  deny(`aw lock run editor --for x -- bash -c '${CLI} iterate --all'`, "renders 9 shots");
  deny(`aw lock run editor --for x -- bash -c 'aw lease gpu --for y -- ${CLI} baseline update'`, "--source");
  // a flag of the wrapper is not a flag of the render
  deny(`aw lock run editor --for "list the --dry-run output" -- ${CLI} iterate --all`, "renders 9 shots");
  allow(`aw lock run editor --for x -- ${CLI} iterate --all --dry-run`);
  allow("aw lock run editor --for x -- ./scripts/shot-render.ps1 -All -List");
  deny(`aw lock run editor --for x -- ${CLI} baseline update`, "--source");
});

test("a reason reaches through the wrapper, and the inner command is logged", () => {
  clearLog();
  allow('PL_RUN="full: card 12 finished" aw lock run editor --for "x" -- ./scripts/shot-render.sh --all');
  allow(`aw lease gpu --for x -- PL_RUN="verify: sky_0 works, this is the group" ${CLI} iterate --group sky`);
  allow(`aw lock run editor --for x -- 'PL_RUN="full: one quoted line" ${CLI_WORDS} iterate --all'`);
  const lines = log();
  assert.deepEqual(lines.map((l) => l.split("\t").slice(1, 3)), [["full", "9"], ["verify", "6"], ["full", "9"]]);
  assert.ok(lines[0].split("\t")[4].startsWith("./scripts/shot-render.sh --all"), lines[0]);
  assert.ok(lines[1].split("\t")[4].startsWith(`${CLI_WORDS} iterate --group sky`), lines[1]);
});

test("other agent-works commands are left alone", () => {
  allow('aw lock acquire editor --for "pl.mjs iterate --all, 3 min"');
  allow("aw lock release editor && aw lock status");
  allow('aw note "pl.mjs iterate --all is next; then shot-render.ps1 -All"');
  allow('node "/plugins/agent-works/cli/aw.mjs" note "npm run render -- sky_0 sky_1 sky_2 sky_3"');
  const read = (line) => rules.commandsOf(line.split(" "));
  assert.deepEqual(read("aw lock run a --for x -- cmd --flag").commands, [["cmd", "--flag"]]);
  assert.deepEqual(read("aw lock run a -- aw lease b -- cmd one two").commands, [["cmd", "one", "two"]]);
  assert.deepEqual(read("aw lock status").commands, []);
  assert.deepEqual(read("draw.mjs lock run a -- cmd").commands, [["draw.mjs", "lock", "run", "a", "--", "cmd"]], "another program's `lock run` is not the wrapper");
  assert.deepEqual(read("FOO=1 env cmd --a").commands, [["cmd", "--a"]]);
  assert.deepEqual(read("export AGENT=a").commands, []);
  assert.deepEqual(read("C:/Tools/Git/git.exe log").commands, [], "a reader by its base name, .exe and folder dropped");
});

test("a baseline update is always targeted, wrapped or not", () => {
  deny(`${CLI} baseline update`, "--source", "a selection");
  deny(`${CLI} baseline update --group smoke`, "--source <one candidate>");
  deny(`${CLI} baseline update --source candidate`, "a selection");
  deny(`${CLI} baseline update --source candidate --run 2026-01-01`, "a selection");
  deny(`${CLI} baseline update --source candidate --all`, "a selection");
  deny(`node "C:/plugins/pl/scripts/pl.mjs" baseline update --source candidate`, "a selection");
  deny(String.raw`node scripts\pl.mjs baseline update --source candidate --run 2026-01-01`, "a selection");
  allow(`${CLI} baseline update --source candidate --run last sky_0 sky_1`);
  allow(`${CLI} baseline update --source=candidate --run last --group smoke`);
  allow(`${CLI} baseline update --source candidate --shots sky_0,sky_1 --run last`);
  allow(`${CLI} baseline update --all-shots-of-run --source candidate --run last`);
  allow(`${CLI} baseline check --group smoke`);
  allow("git commit -m 'pl.mjs baseline update is refused without --source'");
  allow("cat scripts/pl.mjs | grep update");
});

test("a repo still on the first layout is guarded where it is", () => {
  const old = project(CONFIG, ".perceptual-loop");
  assert.match(rules.decide(`${CLI} iterate --all`, old), /renders 9 shots/);
  assert.equal(rules.decide(`PL_RUN="full: done" ${CLI} iterate --all`, old), null);
  assert.ok(fs.existsSync(path.join(old, ".perceptual-loop/runs/budget.log")), "the log goes where the state is");
  // moved, with a config that still spells the old shots folder
  const moved = project({ ...CONFIG, shotsDir: ".perceptual-loop/shots" });
  assert.match(rules.decide(`${CLI} iterate --all`, moved), /renders 9 shots/);
});

// ---- the hook, run the way a host runs it ---------------------------------------------

const hook = (payload, { cwd = tempDir("pl-hook-cwd-"), env = {} } = {}) =>
  runNode(HOOK, [], { cwd, env: { CLAUDE_PROJECT_DIR: "", PL_DIR: "", PERCEPTUAL_LOOP_DIR: "", ...env }, input: typeof payload === "string" ? payload : JSON.stringify(payload) });

test("a deny is one JSON document on stdout that the model reads, and the exit code is 0", () => {
  const r = hook({ tool_name: "Bash", tool_input: { command: `${CLI} iterate --all` }, cwd: path.join(root, ".agents", "perceptual") });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.deepEqual([out.hookEventName, out.permissionDecision], ["PreToolUse", "deny"]);
  assert.match(out.permissionDecisionReason, /renders 9 shots/);
  const ps = hook({ tool_name: "PowerShell", tool_input: { command: `powershell -Command "${CLI_WORDS} iterate --all"` }, cwd: root });
  assert.match(JSON.parse(ps.stdout).hookSpecificOutput.permissionDecisionReason, /renders 9 shots/);
});

test("an allow is silent, and the project dir stands in when the payload has no cwd", () => {
  const r = hook({ tool_name: "PowerShell", tool_input: { command: `${CLI} iterate sky_0` }, cwd: root });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
  const viaEnv = hook({ tool_name: "Bash", tool_input: { command: `${CLI} iterate --all` } }, { env: { CLAUDE_PROJECT_DIR: root } });
  assert.match(viaEnv.stdout, /deny/);
  // the payload's cwd wins over the project dir: a worktree session's project dir is the main checkout
  const bare = tempDir("pl-bare-");
  const worktree = hook({ tool_name: "Bash", tool_input: { command: `${CLI} iterate --all` }, cwd: bare }, { env: { CLAUDE_PROJECT_DIR: root } });
  assert.deepEqual([worktree.status, worktree.stdout], [0, ""]);
});

test("with no config the hook does nothing", () => {
  const bare = tempDir("pl-bare-");
  const r = hook({ tool_name: "Bash", tool_input: { command: `${CLI} iterate --all; ${CLI} baseline update` }, cwd: bare });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""]);
});

test("where the person turned the plugins off and the state lives outside the repo, the guard is silent", () => {
  const state = project();
  const stateDir = path.join(state, ".agents", "perceptual");
  const repo = tempDir("pl-off-");
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main");
  const payload = { tool_name: "Bash", tool_input: { command: `${CLI} iterate --all` }, cwd: repo };
  const env = { PL_DIR: stateDir, PL_SHOTS_DIR: path.join(stateDir, "shots") };
  assert.equal(hook(payload, { env }).stdout, "", "unanswered: nothing has opted this repo in");
  git("config", "--local", "agentic-engineering.plugins", "off test 2026-01-01T00:00Z");
  assert.deepEqual((({ status, stdout, stderr }) => [status, stdout, stderr])(hook(payload, { env })), [0, "", ""]);
  git("config", "--local", "agentic-engineering.plugins", "on test 2026-01-01T00:00Z");
  assert.match(hook(payload, { env }).stdout, /renders 9 shots/);
  // a committed marker outranks a personal off: the state folder in the repo is that marker
  git("config", "--local", "agentic-engineering.plugins", "off test 2026-01-01T00:00Z");
  const marked = project();
  execFileSync("git", ["-C", marked, "init", "-q", "-b", "main"], { stdio: "pipe" });
  execFileSync("git", ["-C", marked, "config", "--local", "agentic-engineering.plugins", "off test 2026-01-01T00:00Z"], { stdio: "pipe" });
  assert.match(hook({ ...payload, cwd: marked }).stdout, /renders 9 shots/);
});

test("its own failures never block", () => {
  for (const payload of ["", "not json", "[]", '{"tool_input": {"command": 5}}', '{"tool_input": null}', "\uFEFF{}"]) {
    const r = hook(payload);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], payload);
  }
  for (const broken of ["{ broken", "[]", "null", '{"budget": 7}', '{"budget": {"free": "many", "match": "iterate"}}']) {
    const r = hook({ tool_input: { command: `${CLI} iterate sky_0` }, cwd: project(broken) });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], broken);
  }
  const badPattern = project({ budget: { free: 3, match: ["(unclosed", "iterate"] } });
  const r = hook({ tool_input: { command: `${CLI} iterate --all` }, cwd: badPattern });
  assert.match(r.stdout, /deny/, "a broken pattern is skipped, the good one still works");
  const badGroups = project();
  fs.writeFileSync(path.join(badGroups, ".agents/perceptual/groups.json"), "{ broken");
  const g = hook({ tool_input: { command: `${CLI} iterate --group sky` }, cwd: badGroups });
  assert.deepEqual([g.status, g.stdout, g.stderr], [0, "", ""]);
});

test("the hook map runs the guard on Bash and PowerShell for five seconds, behind the quiet Node check", () => {
  const map = JSON.parse(fs.readFileSync(path.join(PLUGIN, "hooks", "hooks.json"), "utf8"));
  const [entry] = map.hooks.PreToolUse;
  assert.equal(entry.matcher, "Bash|PowerShell");
  assert.equal(entry.hooks[0].timeout, 5);
  assert.equal(entry.hooks[0].command, hookCommand("perceptual-loop", "hooks/guard.mjs"));
  assert.ok(!fs.readFileSync(HOOK, "utf8").includes("PLUGIN_ROOT"), "the script finds its files beside itself");
});
