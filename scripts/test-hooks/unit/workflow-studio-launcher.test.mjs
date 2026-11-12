// workflow-studio's launcher, run far enough to prove everything short of the
// dev server itself: it reads its three arguments, finds the bundled app inside
// the plugin, lays the install home out, decides when `npm ci` is due, and
// says plainly what is missing. npm is stood in for by a recorder, so no test
// installs a package, starts a server that stays up, or leaves the machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { findOnPath, lockHash, main, prerequisites, runningPort } from "../../../plugins/workflow-studio/scripts/launch-studio.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "workflow-studio");
const APP = path.join(PLUGIN, "app");
const SCRIPT = path.join(PLUGIN, "scripts", "launch-studio.mjs");
const USAGE = "Usage: node launch-studio.mjs <plugin-root> <studio-root> <data-dir>";
const INSTALLED = [".install-stamp", "docs", "index.html", "package-lock.json", "package.json", "src", "tsconfig.json", "tsconfig.node.json", "vite.config.ts"];
const HASH = lockHash(path.join(APP, "package-lock.json"));

const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => f.split(path.sep).join("/")).sort();
const offline = async () => { throw new Error("nothing is listening"); };

/** A folder that holds an `npm` a PATH search finds on any platform. It is never run. */
function binWithNpm(t) {
  const bin = tempDir(t, "studio-bin-");
  write(bin, "npm", "");
  fs.chmodSync(path.join(bin, "npm"), 0o755);
  write(bin, "npm.cmd", "");
  return bin;
}

/** A person's machine: an empty install home and studio root, and an npm that records what it was asked. */
function machine(t, { ci = 0, dev = 0, env = {}, fetch = offline } = {}) {
  const root = tempDir(t, "studio-");
  const data = path.join(root, "data"), studio = path.join(root, "project", ".claude", "workflow-studio");
  const calls = [], out = [], err = [];
  const stamp = path.join(data, "app", ".install-stamp");
  const npm = async (args, { cwd, env: childEnv }) => {
    calls.push({ args, cwd, env: childEnv, lockfileThere: fs.existsSync(path.join(cwd, "package-lock.json")), stamped: fs.existsSync(stamp) });
    return args[0] === "ci" ? ci : dev;
  };
  const deps = { env: { PATH: binWithNpm(t), ...env }, npm, fetch, log: (line) => out.push(line), warn: (line) => err.push(line) };
  return { root, data, studio, app: path.join(data, "app"), stamp, calls, out, err, deps, launch: (pluginRoot = PLUGIN) => main([pluginRoot, studio, data], deps) };
}

// ---- arguments and prerequisites -------------------------------------------

test("anything but three arguments is a usage error, exit 2", async (t) => {
  for (const args of [[], [PLUGIN], [PLUGIN, "a"], [PLUGIN, "a", "b", "c"]]) {
    const m = machine(t);
    assert.equal(await main(args, m.deps), 2);
    assert.deepEqual(m.err, [USAGE]);
    assert.deepEqual(m.calls, []);
  }
  const cli = runNode(SCRIPT, []);
  assert.equal(cli.status, 2);
  assert.equal(cli.stderr, `${USAGE}\n`);
  assert.equal(cli.stdout, "");
});

test("without npm on PATH it says how to get it, exits 1, and touches nothing", (t) => {
  const root = tempDir(t, "studio-");
  const empty = path.join(root, "empty-bin");
  fs.mkdirSync(empty);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const cli = runNode(SCRIPT, [PLUGIN, path.join(root, "studio"), path.join(root, "data")], { env: { ...env, PATH: empty } });
  assert.equal(cli.status, 1);
  assert.equal(cli.stderr, "Error: 'npm' was not found on PATH. It normally ships with Node.js (20+).\nInstall Node.js from https://nodejs.org/ or via your package manager, then retry.\n");
  assert.equal(cli.stdout, "");
  assert.deepEqual(fs.readdirSync(root), ["empty-bin"]);
});

test("a Node older than 20 is named with the version found", (t) => {
  const env = { PATH: binWithNpm(t) };
  assert.equal(prerequisites({ env }), null, "this Node is new enough");
  assert.equal(prerequisites({ env, nodeVersion: "20.0.0" }), null);
  assert.deepEqual(prerequisites({ env, nodeVersion: "18.19.1" }), ["Error: Node.js v18.19.1 is too old. Workflow Studio (Vite 6) needs Node 20+.", "Upgrade Node.js, then retry."]);
  assert.match(prerequisites({ env: { PATH: "" }, nodeVersion: "18.19.1" })[0], /'npm' was not found/, "npm is checked first");
});

test("a program is found on PATH the way each platform finds one", (t) => {
  const bin = binWithNpm(t), other = tempDir(t, "studio-bin-");
  write(other, "plain", "");
  fs.mkdirSync(path.join(other, "npm"));
  const found = findOnPath("npm", { PATH: [other, bin].join(path.delimiter) });
  assert.equal(path.dirname(found), bin, "a folder named npm is not a program");
  assert.match(path.basename(found), /^npm(\.\w+)?$/i);
  assert.equal(findOnPath("npm", { Path: bin }) !== null, true, "the variable is found whatever its case");
  assert.equal(findOnPath("npm", { PATH: other }), null);
  assert.equal(findOnPath("npm", {}), null);
  assert.equal(findOnPath("npm", { PATH: bin, PATHEXT: ".exe;.cmd" }, "win32"), path.join(bin, "npm.cmd"), "Windows tries each PATHEXT ending");
  assert.equal(findOnPath("plain", { PATH: other }, "posix"), null, "a file that cannot be executed is not a program");
});

test("a plugin root without the bundled app is reported by path, exit 1", async (t) => {
  const m = machine(t);
  const elsewhere = tempDir(t, "studio-noapp-");
  assert.equal(await m.launch(elsewhere), 1);
  assert.deepEqual(m.err, [`Error: vendored app not found at ${path.join(elsewhere, "app")} \u2014 is the plugin installed correctly?`]);
  assert.deepEqual(m.calls, []);
  assert.equal(fs.existsSync(m.data), false);
});

// ---- the install home -------------------------------------------------------

test("a first launch copies the app out of the plugin, installs it, then starts the dev server", async (t) => {
  const m = machine(t, { env: { CLAUDE_PROJECT_DIR: path.join("somewhere", "project") } });
  assert.equal(await m.launch(), 0);
  assert.deepEqual(m.err, []);
  assert.deepEqual(m.out, [
    `Workflow Studio: (re)installing app into ${m.app} (first run or lockfile changed)...`,
    `Workflow Studio: starting dev server (STUDIO_ROOT=${m.studio})...`,
  ]);

  assert.deepEqual(m.calls.map((c) => c.args), [["ci"], ["run", "dev"]]);
  const [ci, dev] = m.calls;
  assert.equal(ci.cwd, m.app);
  assert.ok(ci.lockfileThere, "the lockfile is in place before npm ci reads it");
  assert.equal(ci.stamped, false, "the stamp is written only once npm ci has succeeded");
  assert.equal(dev.cwd, m.app);
  assert.ok(dev.stamped);
  assert.equal(dev.env.STUDIO_ROOT, m.studio);
  assert.equal(dev.env.WORKFLOW_EXPORT_ROOT, path.join("somewhere", "project"));
  assert.ok(fs.statSync(m.studio).isDirectory(), "the studio root exists before the server starts");

  assert.deepEqual(fs.readdirSync(m.app).sort(), INSTALLED, "only what the app needs to build and run");
  assert.equal(fs.readFileSync(m.stamp, "utf8"), HASH);
  for (const dir of ["src", "docs"]) assert.deepEqual(tree(path.join(m.app, dir)), tree(path.join(APP, dir)), dir);
  assert.ok(tree(path.join(m.app, "src")).length > 20, "the bundled app was found inside the plugin");
  assert.deepEqual(fs.readFileSync(path.join(m.app, "package-lock.json")), fs.readFileSync(path.join(APP, "package-lock.json")));
});

test("a second launch skips the install and refreshes the sources, leaving node_modules alone", async (t) => {
  const m = machine(t);
  await m.launch();
  write(m.app, "node_modules/vite/package.json", "{}\n");
  write(m.app, "src/left-over.ts", "export {};\n");
  fs.writeFileSync(path.join(m.app, "index.html"), "edited in place");
  m.calls.length = 0;
  m.out.length = 0;

  assert.equal(await m.launch(), 0);
  assert.deepEqual(m.calls.map((c) => c.args), [["run", "dev"]]);
  assert.deepEqual(m.out, [`Workflow Studio: starting dev server (STUDIO_ROOT=${m.studio})...`]);
  assert.equal(fs.existsSync(path.join(m.app, "src", "left-over.ts")), false, "a file the plugin no longer ships is gone");
  assert.deepEqual(fs.readFileSync(path.join(m.app, "index.html")), fs.readFileSync(path.join(APP, "index.html")));
  assert.ok(fs.existsSync(path.join(m.app, "node_modules", "vite", "package.json")));
});

test("an install home that already carries the lockfile's stamp is reused as it is, final newline or not", async (t) => {
  for (const stamp of [HASH, `${HASH}\n`]) {
    const m = machine(t);
    write(m.app, ".install-stamp", stamp);
    write(m.app, "node_modules/.package-lock.json", "{}\n");
    assert.equal(await m.launch(), 0);
    assert.deepEqual(m.calls.map((c) => c.args), [["run", "dev"]], JSON.stringify(stamp));
    assert.equal(fs.readFileSync(m.stamp, "utf8"), stamp);
  }
});

test("a stamp from another lockfile means a reinstall", async (t) => {
  const m = machine(t);
  write(m.app, ".install-stamp", "0".repeat(64));
  assert.equal(await m.launch(), 0);
  assert.deepEqual(m.calls.map((c) => c.args), [["ci"], ["run", "dev"]]);
  assert.equal(fs.readFileSync(m.stamp, "utf8"), HASH);
});

test("a failed install exits with npm's code, starts nothing, and is retried on the next launch", async (t) => {
  const m = machine(t, { ci: 7 });
  write(m.app, ".install-stamp", "0".repeat(64));
  assert.equal(await m.launch(), 7);
  assert.deepEqual(m.calls.map((c) => c.args), [["ci"]]);
  assert.equal(fs.existsSync(m.stamp), false, "no stamp, so the install is not taken for done");
  assert.equal(await m.launch(), 7);
  assert.deepEqual(m.calls.map((c) => c.args), [["ci"], ["ci"]]);
});

test("the launcher exits with the dev server's code", async (t) => {
  assert.equal(await machine(t, { dev: 143 }).launch(), 143);
});

test("the project Publish may write into is WORKFLOW_EXPORT_ROOT, else CLAUDE_PROJECT_DIR, else nothing", async (t) => {
  for (const [env, expected] of [
    [{ WORKFLOW_EXPORT_ROOT: "export", CLAUDE_PROJECT_DIR: "project" }, "export"],
    [{ WORKFLOW_EXPORT_ROOT: "", CLAUDE_PROJECT_DIR: "project" }, "project"],
    [{}, ""],
  ]) {
    const m = machine(t, { env });
    await m.launch();
    assert.equal(m.calls.at(-1).env.WORKFLOW_EXPORT_ROOT, expected);
  }
});

test("the dev server inherits the environment, with this Node's folder at the end of PATH", async (t) => {
  const m = machine(t, { env: { KEPT: "yes" } });
  await m.launch();
  const { env } = m.calls.at(-1);
  assert.equal(env.KEPT, "yes");
  assert.deepEqual(env.PATH.split(path.delimiter), [m.deps.env.PATH, path.dirname(process.execPath)]);
});

test("relative arguments are resolved before the launcher moves anywhere", async (t) => {
  const m = machine(t);
  const cwd = process.cwd();
  process.chdir(m.root);
  try { assert.equal(await main([PLUGIN, "studio", "data"], m.deps), 0); } finally { process.chdir(cwd); }
  const dev = m.calls.at(-1);
  assert.ok(path.isAbsolute(dev.cwd) && path.isAbsolute(dev.env.STUDIO_ROOT));
  assert.equal(path.basename(dev.env.STUDIO_ROOT), "studio");
  assert.equal(path.basename(path.dirname(dev.cwd)), "data");
});

test("run for real, it starts npm twice in the install home and passes npm's exit code on", { skip: process.platform === "win32" && "the stand-in npm is a shebang script" }, (t) => {
  const root = tempDir(t, "studio-");
  // An npm that reports how it was called. `env node` finds Node only because the launcher adds its folder to PATH.
  const npm = write(path.join(root, "bin"), "npm", '#!/usr/bin/env node\nconsole.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), studio: process.env.STUDIO_ROOT ?? null }));\nprocess.exitCode = process.argv[2] === "run" ? 3 : 0;\n');
  fs.chmodSync(npm, 0o755);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"));
  const studio = path.join(root, "studio"), data = path.join(root, "data");
  const cli = runNode(SCRIPT, [PLUGIN, studio, data], { env: { ...env, PATH: path.dirname(npm) } });
  assert.equal(cli.stderr, "");
  assert.equal(cli.status, 3, "the dev server's exit code is the launcher's");
  const lines = cli.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^Workflow Studio: \(re\)installing app into /);
  assert.match(lines[2], /^Workflow Studio: starting dev server \(STUDIO_ROOT=/);
  const app = fs.realpathSync(path.join(data, "app"));
  assert.deepEqual(JSON.parse(lines[1]), { args: ["ci"], cwd: app, studio: null });
  assert.deepEqual(JSON.parse(lines[3]), { args: ["run", "dev"], cwd: app, studio });
  assert.equal(fs.readFileSync(path.join(data, "app", ".install-stamp"), "utf8"), HASH);
});

// ---- a studio already running ----------------------------------------------

/** A local server that answers /api/health with `body`; resolves to its port. */
function health(t, body) {
  const seen = [];
  const server = http.createServer((request, response) => {
    seen.push(request.url);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  });
  t.after(() => { server.close(); server.closeAllConnections(); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, seen })));
}

test("a studio already serving this studio root is handed back, not started twice", async (t) => {
  const { port, seen } = await health(t, { ok: true, app: "workflow-studio" });
  const m = machine(t, { fetch: globalThis.fetch });
  write(m.studio, ".studio.lock", JSON.stringify({ port, pid: 1 }));
  assert.equal(await m.launch(), 0);
  assert.deepEqual(m.out, ["Workflow Studio is already running.", `  \u279c  Local:   http://localhost:${port}/`]);
  assert.deepEqual(seen, ["/api/health"]);
  assert.deepEqual(m.calls, [], "nothing is installed or started");
  assert.equal(fs.existsSync(m.data), false);
  assert.ok(fs.existsSync(path.join(m.studio, ".studio.lock")), "the running studio keeps its lock");
});

test("a lock nobody stands behind is removed and the launch goes on", async (t) => {
  const other = await health(t, { ok: true, app: "something-else" });
  for (const [what, lock, fetch] of [
    ["another app answers on that port", JSON.stringify({ port: other.port }), globalThis.fetch],
    ["nothing answers", JSON.stringify({ port: 9 }), offline],
    ["the lock is not JSON", "nope", offline],
    ["the port is not a whole number", JSON.stringify({ port: "5173" }), offline],
  ]) {
    const m = machine(t, { fetch });
    write(m.studio, ".studio.lock", lock);
    assert.equal(await m.launch(), 0, what);
    assert.equal(fs.existsSync(path.join(m.studio, ".studio.lock")), false, what);
    assert.deepEqual(m.calls.map((c) => c.args), [["ci"], ["run", "dev"]], what);
  }
});

test("the health check asks only this machine, and only for a lock that names a port", async (t) => {
  const dir = tempDir(t, "studio-lock-");
  const asked = [];
  const fetch = async (url) => { asked.push(url); return { json: async () => ({ ok: true, app: "workflow-studio" }) }; };
  assert.equal(await runningPort(write(dir, "a.lock", '{"port": 4321}'), fetch), 4321);
  assert.equal(await runningPort(write(dir, "b.lock", '{"port": 1.5}'), fetch), null);
  assert.equal(await runningPort(path.join(dir, "missing.lock"), fetch), null);
  assert.deepEqual(asked, ["http://127.0.0.1:4321/api/health"]);
});
