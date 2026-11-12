// agent-works scripts/aw.mjs and its launchers: one command line, each command
// a module that is imported only when it is asked for.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const real = (p) => fs.realpathSync.native(p);

/** A command module that prints what it was given as one JSON line and exits with its `--exit` (0 without one). */
const ECHO = `import fs from "node:fs";
import { parseArgs, intArg, runMain } from "../lib/common.mjs";
export async function main(argv, io) {
  if (argv.includes("--help")) { io.stdout.write("usage of " + io.command + "\\n"); return 0; }
  const head = argv.includes("--") ? argv.slice(0, argv.indexOf("--")) : argv;
  const at = head.indexOf("--exit");
  io.stdout.write(JSON.stringify({ file: import.meta.url.split("/scripts/")[1], command: io.command ?? null, argv,
    cwd: fs.realpathSync.native(io.cwd), processCwd: fs.realpathSync.native(process.cwd()), env: io.env.AW_TEST ?? null }) + "\\n");
  return at < 0 ? 0 : Number(head[at + 1]);
}
runMain(import.meta.url, main);
`;

const STUBS = {
  "scripts/hubs.mjs": ECHO,
  "scripts/board.mjs": ECHO,
  "scripts/coord/notes.mjs": ECHO.replaceAll("../lib/", "../../lib/"),
  // Leaves a mark when it is imported, so a test can tell that it was not.
  "scripts/status.mjs": `import fs from "node:fs";\nfs.appendFileSync(new URL("./imported.log", import.meta.url), "status\\n");\nexport const main = async () => 0;\n`,
  "scripts/doctor.mjs": 'throw new TypeError("broken at import");\n',
  "scripts/twins.mjs": "export const notMain = 1;\n",
  "scripts/dup.mjs": "export const main = (;\n",
  "scripts/memory.mjs": 'import { AwError } from "../lib/common.mjs";\nexport async function main(argv) {\n  throw new AwError("the slug is kebab-case", argv[0] === "soft" ? 1 : 2);\n}\n',
  "scripts/links.mjs": 'export async function main() {\n  throw new RangeError("a bug in links");\n}\n',
  "scripts/lock.mjs": "export async function main(argv, io) {\n  io.stderr.write(\"lock: still queued\\n\");\n  return 3;\n}\n",
};
const AVAILABLE = ["hubs", "board, kanban", "note, notes", "status", "memory", "links", "lock"];
const UNAVAILABLE = ["setup", "doctor", "twins", "decisions", "dup", "lease, leases", "sys", "claim, claims", "learn", "who, agent"];
const EVERY_COMMAND = ["setup", "doctor", "status", "hubs", "twins", "memory", "decisions", "links", "dup", "board", "kanban", "lock", "lease", "leases",
  "sys", "note", "notes", "claim", "claims", "learn", "who", "agent"];

let plugin;
let aw;
let common;

before(async (t) => {
  plugin = real(tempDir(t, "aw-dispatch-"));
  for (const f of ["lib/common.mjs", "lib/config.mjs", "scripts/aw.mjs", "bin/aw", "bin/aw.cmd"]) write(plugin, f, fs.readFileSync(path.join(PLUGIN, f)));
  fs.chmodSync(path.join(plugin, "bin", "aw"), 0o755);
  write(plugin, ".claude-plugin/plugin.json", '{ "name": "agent-works", "version": "9.8.7" }\n');
  for (const [file, text] of Object.entries(STUBS)) write(plugin, file, text);
  aw = await import(pathToFileURL(path.join(plugin, "scripts", "aw.mjs")).href);
  common = await import(pathToFileURL(path.join(plugin, "lib", "common.mjs")).href);
});

/** `aw <args>` in this process: [exit code, stdout, stderr]. */
async function call(args, io = {}) {
  const through = common.bufferedIo({ cwd: plugin, env: {}, ...io });
  const code = await aw.main(args, through);
  return [code, through.out(), through.err()];
}

/** `aw <args>` as a process of its own: { status, stdout, stderr }. */
const spawned = (args, options = {}) => runNode(path.join(plugin, "scripts", "aw.mjs"), args, { cwd: plugin, ...options });

const line = (text, commands) => text.split("\n").find((l) => l.startsWith(`  ${commands.padEnd(16)} `));

test("agent-works aw: --help lists every command with its line and marks the ones that cannot be had", async () => {
  const [code, out, err] = await call(["--help"]);
  assert.deepEqual([code, err], [0, ""]);
  assert.ok(out.startsWith("usage: aw [--root DIR] <command> [args]\n\nagent-works: project tools and machine-wide coordination.\n"), out);
  for (const flag of ["-h, --help", "--version", "--root DIR"]) assert.ok(out.includes(`\n  ${flag}`), flag);
  for (const command of EVERY_COMMAND) assert.match(out, new RegExp(`^  [a-z, ]*\\b${command}\\b`, "m"), command);
  for (const commands of AVAILABLE) assert.doesNotMatch(line(out, commands), /\(unavailable\)/, commands);
  for (const commands of UNAVAILABLE) assert.match(line(out, commands), /  \(unavailable\)$/, commands);
  assert.equal(line(out, "hubs"), "  hubs             verify the AGENTS.md hub tree");
  assert.equal(line(out, "board, kanban"), "  board, kanban    the task board: list, add, move, owe, settle, lint");
  assert.equal(line(out, "lease, leases"), "  lease, leases    declare shared use of a machine resource for the length of a command  (unavailable)");
  assert.ok(out.endsWith("\nexit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error; aw lock: 3 still queued\n"), out);
  const why = out.split("\nunavailable:\n")[1].split("\n\n")[0].split("\n");
  assert.equal(why.length, UNAVAILABLE.length);
  assert.ok(why.includes("  scripts/setup.mjs is missing"));
  assert.ok(why.includes("  scripts/coord/leases.mjs is missing"));
  assert.ok(why.includes("  scripts/doctor.mjs: TypeError: broken at import"));
  assert.ok(why.includes("  scripts/twins.mjs exports no main"));
  assert.ok(why.some((l) => l.startsWith("  scripts/dup.mjs: SyntaxError: ")), why.join("\n"));
});

test("agent-works aw: no arguments and -h print the help and exit 0; a stray option prints it and exits 2", async () => {
  const [, help] = await call(["--help"]);
  assert.deepEqual(await call([]), [0, help, ""]);
  assert.deepEqual(await call(["-h"]), [0, help, ""]);
  assert.deepEqual(await call(["--help", "hubs"]), [0, help, ""]);
  assert.deepEqual(await call(["-h", "no-such-command-either"]).then(([code]) => code), 2);
  assert.deepEqual(await call(["--bogus"]), [2, help, ""]);
});

test("agent-works aw: --version prints the plugin's version", async () => {
  assert.deepEqual(await call(["--version"]), [0, "aw 9.8.7\n", ""]);
  assert.deepEqual(await call(["--version", "hubs"]), [0, "aw 9.8.7\n", ""]);
  const own = runNode(path.join(PLUGIN, "scripts", "aw.mjs"), ["--version"]);
  const version = JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version;
  assert.deepEqual([own.status, own.stdout, own.stderr], [0, `aw ${version}\n`, ""]);
});

test("agent-works aw: an unknown command exits 2 with the list on stderr", async () => {
  const [code, out, err] = await call(["no-such-command", "--json"]);
  assert.deepEqual([code, out], [2, ""]);
  assert.ok(err.startsWith("aw: no command 'no-such-command'\n\ncommands:\n  setup "), err);
  for (const command of EVERY_COMMAND) assert.match(err, new RegExp(`^  [a-z, ]*\\b${command}\\b`, "m"), command);
  assert.match(err, /exit codes: 0 clean/);
  assert.doesNotMatch(err, /^usage:/m);
});

test("agent-works aw: a command gets what followed it, untouched, and its exit code comes back", async () => {
  const [code, out, err] = await call(["hubs", ".", "--json", "--exclude", "a", "--", "--root", "x", "-h"], { env: { AW_TEST: "seen" } });
  assert.deepEqual([code, err], [0, ""]);
  assert.deepEqual(JSON.parse(out), {
    file: "hubs.mjs", command: "hubs", argv: [".", "--json", "--exclude", "a", "--", "--root", "x", "-h"], cwd: plugin, processCwd: real(process.cwd()), env: "seen",
  });
  for (const exit of [0, 1, 2, 3, 124]) assert.equal((await call(["hubs", "--exit", String(exit)]))[0], exit);
  assert.deepEqual(await call(["lock", "run", "gpu"]), [3, "", "lock: still queued\n"]);
});

test("agent-works aw: several names reach one module, which is told the one it was called by", async () => {
  const asked = async (...args) => {
    const [code, out] = await call(args);
    const { file, command, argv } = JSON.parse(out);
    return [code, file, command, argv];
  };
  assert.deepEqual(await asked("board", "list", "--json"), [0, "board.mjs", "board", ["list", "--json"]]);
  assert.deepEqual(await asked("kanban", "list", "--json"), [0, "board.mjs", "kanban", ["list", "--json"]]);
  assert.deepEqual(await asked("note", "a line"), [0, "coord/notes.mjs", "note", ["a line"]]);
  assert.deepEqual(await asked("notes", "5", "--all"), [0, "coord/notes.mjs", "notes", ["5", "--all"]]);
  // A word after the command is the command's, even when it is the name of another.
  assert.deepEqual(await asked("note", "notes"), [0, "coord/notes.mjs", "note", ["notes"]]);
});

test("agent-works aw: help asked after a command is the command's own", async () => {
  assert.deepEqual(await call(["hubs", "--help"]), [0, "usage of hubs\n", ""]);
  assert.deepEqual(await call(["kanban", "list", "--help"]), [0, "usage of kanban\n", ""]);
});

test("agent-works aw: an option before the command that is not aw's is a usage error", async () => {
  const [code, out, err] = await call(["--json", "hubs"]);
  assert.deepEqual([code, out], [2, ""]);
  assert.match(err, /^aw: no option '--json' /);
});

test("agent-works aw: a module that is missing, broken or without a main is unavailable, and the others still run", async () => {
  assert.deepEqual(await call(["setup", "--plan"]), [2, "", "aw setup: unavailable (scripts/setup.mjs is missing)\n"]);
  assert.deepEqual(await call(["leases"]), [2, "", "aw leases: unavailable (scripts/coord/leases.mjs is missing)\n"]);
  assert.deepEqual(await call(["doctor", "--json"]), [2, "", "aw doctor: unavailable (scripts/doctor.mjs: TypeError: broken at import)\n"]);
  assert.deepEqual(await call(["twins"]), [2, "", "aw twins: unavailable (scripts/twins.mjs exports no main)\n"]);
  const [code, out, err] = await call(["dup"]);
  assert.deepEqual([code, out], [2, ""]);
  assert.match(err, /^aw dup: unavailable \(scripts\/dup\.mjs: SyntaxError: .+\)\n$/);
  assert.equal((await call(["hubs", "--exit", "1"]))[0], 1);
});

test("agent-works aw: a command's usage error is printed under its name; a bug is printed with its stack and exits 1", async () => {
  assert.deepEqual(await call(["memory", "new"]), [2, "", "aw memory: the slug is kebab-case\n"]);
  assert.deepEqual(await call(["memory", "soft"]), [1, "", "aw memory: the slug is kebab-case\n"]);
  const [code, out, err] = await call(["links"]);
  assert.deepEqual([code, out], [1, ""]);
  assert.match(err, /^aw links: RangeError: a bug in links\n\s+at /);
});

test("agent-works aw: only the module of the command asked for is imported", () => {
  const log = path.join(plugin, "scripts", "imported.log");
  fs.rmSync(log, { force: true });
  assert.equal(spawned(["hubs"]).status, 0);
  assert.equal(spawned(["doctor"]).status, 2);
  assert.equal(fs.existsSync(log), false);
  assert.equal(spawned(["--help"]).status, 0);
  assert.equal(fs.readFileSync(log, "utf8"), "status\n");
  fs.rmSync(log);
});

test("agent-works aw: --root, before or after the command, is where the command works", async (t) => {
  const elsewhere = real(tempDir(t, "aw-root-"));
  fs.mkdirSync(path.join(elsewhere, "deep"));
  for (const args of [["--root", elsewhere, "hubs", "--json"], ["hubs", "--json", "--root", elsewhere], [`--root=${elsewhere}`, "hubs", "--json"]]) {
    const [code, out, err] = await call(args);
    assert.deepEqual([code, err], [0, ""], args.join(" "));
    const seen = JSON.parse(out);
    // In this process only the io moves; the process stays where it was.
    assert.deepEqual([seen.cwd, seen.argv, seen.processCwd], [elsewhere, ["--json"], real(process.cwd())], args.join(" "));
  }
  assert.equal(JSON.parse((await call(["--root", "deep", "hubs"], { cwd: elsewhere }))[1]).cwd, path.join(elsewhere, "deep"));
  // After a `--` it is the command's own word.
  assert.deepEqual(JSON.parse((await call(["hubs", "--", "--root", elsewhere]))[1]).argv, ["--", "--root", elsewhere]);
  assert.deepEqual(await call(["--root", path.join(elsewhere, "nope"), "hubs"]), [2, "", `aw: --root ${path.join(elsewhere, "nope")}: not a directory\n`]);
  assert.equal((await call(["--root", write(elsewhere, "file.txt", "x"), "hubs"]))[0], 2);
});

test("agent-works aw: run as a process it is the same command line, and --root moves the process too", (t) => {
  const elsewhere = real(tempDir(t, "aw-root-"));
  const plain = spawned(["hubs", "--json", "--exit", "1"], { env: { ...process.env, AW_TEST: "from the process" } });
  assert.deepEqual([plain.status, plain.stderr], [1, ""]);
  assert.deepEqual(JSON.parse(plain.stdout), { file: "hubs.mjs", command: "hubs", argv: ["--json", "--exit", "1"], cwd: plugin, processCwd: plugin, env: "from the process" });
  const moved = spawned(["hubs", "--root", elsewhere]);
  assert.deepEqual([moved.status, JSON.parse(moved.stdout).cwd, JSON.parse(moved.stdout).processCwd], [0, elsewhere, elsewhere]);
  const unknown = spawned(["no-such-command"]);
  assert.deepEqual([unknown.status, unknown.stdout], [2, ""]);
  assert.match(unknown.stderr, /^aw: no command 'no-such-command'\n/);
  const refused = spawned(["memory", "new"]);
  assert.deepEqual([refused.status, refused.stdout, refused.stderr], [2, "", "aw memory: the slug is kebab-case\n"]);
  assert.equal(spawned([]).status, 0);
  assert.equal(spawned(["--bogus"]).status, 2);
});

test("agent-works aw: importing the dispatcher runs nothing", (t) => {
  const importer = write(real(tempDir(t, "aw-import-")), "importer.mjs",
    `const m = await import(${JSON.stringify(pathToFileURL(path.join(plugin, "scripts", "aw.mjs")).href)});\nprocess.stdout.write([typeof m.main, typeof m.cli, m.MODULES.length].join(" ") + "\\n");\n`);
  const r = runNode(importer, ["--help"]);
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "function function 17\n", ""]);
});

test("agent-works aw: a command module run by itself is the same command", () => {
  const r = runNode(path.join(plugin, "scripts", "coord", "notes.mjs"), ["a line", "--exit", "1"], { cwd: plugin });
  assert.deepEqual([r.status, r.stderr], [1, ""]);
  assert.deepEqual([JSON.parse(r.stdout).command, JSON.parse(r.stdout).argv], [null, ["a line", "--exit", "1"]]);
});

test("agent-works aw: the launcher in bin/ is the same command line", () => {
  const launcher = path.join(plugin, "bin", "aw");
  const viaNode = runNode(launcher, ["kanban", "list", "--exit", "1"], { cwd: plugin });
  assert.deepEqual([viaNode.status, viaNode.stderr, JSON.parse(viaNode.stdout).command], [1, "", "kanban"]);
  assert.equal(runNode(launcher, ["--version"], { cwd: plugin }).stdout, "aw 9.8.7\n");
  assert.equal(runNode(launcher, ["no-such-command"], { cwd: plugin }).status, 2);
});

test("agent-works aw: bin/aw runs by its own name", { skip: process.platform === "win32" && "a script has no interpreter line there: aw.cmd is the launcher" }, () => {
  // The launcher's `env node` finds the Node that runs this test.
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}` };
  const r = spawnSync(path.join(plugin, "bin", "aw"), ["note", "hello", "--exit", "2"], { cwd: plugin, env, encoding: "utf8" });
  assert.deepEqual([r.status, r.stderr, JSON.parse(r.stdout).argv], [2, "", ["hello", "--exit", "2"]]);
});

test("agent-works aw: aw.cmd runs the command line under cmd", { skip: process.platform !== "win32" && "cmd is the Windows shell" }, () => {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}` };
  const r = spawnSync(`"${path.join(plugin, "bin", "aw.cmd")}" hubs --json --exit 2`, { shell: true, cwd: plugin, env, encoding: "utf8" });
  assert.deepEqual([r.status, JSON.parse(r.stdout).argv], [2, ["--json", "--exit", "2"]]);
});

test("agent-works aw: the launchers that ship", () => {
  const sh = fs.readFileSync(path.join(PLUGIN, "bin", "aw"), "utf8");
  const cmd = fs.readFileSync(path.join(PLUGIN, "bin", "aw.cmd"), "utf8");
  assert.ok(sh.startsWith("#!/usr/bin/env node\n"));
  assert.match(sh, /\.\.\/scripts\/aw\.mjs/);
  assert.match(cmd, /^node "%~dp0\.\.\\scripts\\aw\.mjs" %\*$/m);
  assert.match(cmd, /no Node\.js on the PATH/);
  assert.match(cmd, /exit \/b 127/);
  for (const text of [sh, cmd]) assert.doesNotMatch(text, /\r/);
  if (process.platform !== "win32") assert.ok(fs.statSync(path.join(PLUGIN, "bin", "aw")).mode & 0o111, "bin/aw is executable");
  assert.ok(fs.readFileSync(path.join(PLUGIN, "scripts", "aw.mjs"), "utf8").startsWith("#!/usr/bin/env node\n"));
});

test("agent-works aw: the command table is the contract", async () => {
  const { MODULES } = await import(pathToFileURL(path.join(PLUGIN, "scripts", "aw.mjs")).href);
  assert.deepEqual(MODULES.map((m) => [m.file, m.commands]), [
    ["setup.mjs", ["setup"]], ["doctor.mjs", ["doctor"]], ["status.mjs", ["status"]], ["hubs.mjs", ["hubs"]], ["twins.mjs", ["twins"]],
    ["memory.mjs", ["memory"]], ["decisions.mjs", ["decisions"]], ["links.mjs", ["links"]], ["dup.mjs", ["dup"]],
    ["board.mjs", ["board", "kanban"]], ["lock.mjs", ["lock"]], ["coord/leases.mjs", ["lease", "leases"]], ["coord/sysinfo.mjs", ["sys"]],
    ["coord/notes.mjs", ["note", "notes"]], ["coord/claims.mjs", ["claim", "claims"]], ["coord/learnings.mjs", ["learn"]],
    ["coord/agents.mjs", ["who", "agent"]],
  ]);
  const names = MODULES.flatMap((m) => m.commands);
  assert.deepEqual([...names].sort(), [...EVERY_COMMAND].sort());
  assert.equal(new Set(names).size, names.length);
  for (const m of MODULES) assert.ok(m.text.length > 10 && m.commands.join(", ").length <= 16, m.file);
});

test("agent-works aw: the plugin's own aw lists every command, whichever of its modules are there yet", () => {
  const r = runNode(path.join(PLUGIN, "scripts", "aw.mjs"), ["--help"], { cwd: PLUGIN });
  assert.deepEqual([r.status, r.stderr], [0, ""]);
  for (const command of EVERY_COMMAND) assert.match(r.stdout, new RegExp(`^  [a-z, ]*\\b${command}\\b`, "m"), command);
  assert.match(r.stdout, /exit codes: 0 clean, 1 warnings or not now, 2 critical or a usage error/);
  const unknown = runNode(path.join(PLUGIN, "scripts", "aw.mjs"), ["no-such-command"], { cwd: PLUGIN });
  assert.deepEqual([unknown.status, unknown.stdout], [2, ""]);
});
