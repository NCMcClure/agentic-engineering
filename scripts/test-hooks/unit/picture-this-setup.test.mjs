// picture-this's studio: installed once into the plugin's data folder, asked
// for first, retried after a failure, and started for one repo at a time. npm,
// the browser download and the dev server are stand-ins here, so the lane
// needs no network: what is checked is what the commands decide and where
// they put things.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { run as setup } from "../../../plugins/picture-this/scripts/commands/setup.mjs";
import { run as studio } from "../../../plugins/picture-this/scripts/commands/studio.mjs";
import { PtError } from "../../../plugins/picture-this/scripts/lib/args.mjs";
import { DRAFTS_DIR, ensureDrafts, layout, readConfig, slug } from "../../../plugins/picture-this/scripts/lib/config.mjs";
import { dataHome, repoRoot } from "../../../plugins/picture-this/scripts/lib/home.mjs";
import { SOURCE_DIRS, SOURCE_FILES, findOnPath, homeLayout, installState, lockHash, playwrightVersion, prerequisites, runningPort } from "../../../plugins/picture-this/scripts/lib/studio.mjs";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "picture-this");
const PT = path.join(PLUGIN, "scripts", "pt.mjs");
const LOCKFILE = path.join(PLUGIN, "app", "package-lock.json");

/** A machine with npm on PATH, and stand-ins that record what they were asked to run. */
function world(t, { npmStatus = 0, nodeStatus = 0 } = {}) {
  const home = tempDir(t, "pt-home-");
  const bin = tempDir(t, "pt-bin-");
  const npmFile = path.join(bin, process.platform === "win32" ? "npm.cmd" : "npm");
  fs.writeFileSync(npmFile, "");
  if (process.platform !== "win32") fs.chmodSync(npmFile, 0o755);
  const calls = [], said = [];
  const deps = {
    env: { PT_HOME: home, PATH: bin },
    npm: async (args, options) => { calls.push({ tool: "npm", args, cwd: options.cwd, env: options.env }); return npmStatus; },
    node: async (args, options) => { calls.push({ tool: "node", args, cwd: options.cwd, env: options.env }); return nodeStatus; },
    log: (line) => said.push(line),
    warn: (line) => said.push(line),
  };
  return { home, at: homeLayout(home), calls, said, deps };
}
/** Run a command with stdout captured, since the commands print their result themselves. */
async function quiet(fn) {
  const real = process.stdout.write;
  let out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { return { status: await fn(), out }; } finally { process.stdout.write = real; }
}

test("a data folder is required, and an empty one is refused, not resolved to the current folder", () => {
  assert.throws(() => dataHome({}), (e) => e instanceof PtError && e.code === 2 && /CLAUDE_PLUGIN_DATA is not set/.test(e.message));
  assert.throws(() => dataHome({ CLAUDE_PLUGIN_DATA: "" }), PtError);
  assert.throws(() => dataHome({ CLAUDE_PLUGIN_DATA: "   " }), PtError);
  assert.equal(dataHome({ CLAUDE_PLUGIN_DATA: path.join(REPO, "x") }), path.join(REPO, "x"));
  assert.equal(dataHome({ CLAUDE_PLUGIN_DATA: "/a", PT_HOME: path.join(REPO, "y") }), path.join(REPO, "y"), "PT_HOME overrides it");
  const cli = runNode(PT, ["setup", "--check"], { env: { ...process.env, PT_HOME: "", CLAUDE_PLUGIN_DATA: "" } });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /has no data folder/);
});

test("setup --check on a fresh machine says nothing is installed, and changes nothing", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => setup(["--check"], w.deps));
  assert.equal(status, 1);
  assert.equal(out, "studio:  missing\nbrowser: missing\nnot installed: run `setup --yes`\n");
  assert.deepEqual(fs.readdirSync(w.home), []);
  assert.deepEqual(w.calls, []);
});

test("setup without --yes says what it would download, and downloads nothing", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => setup([], w.deps));
  assert.equal(status, 1);
  assert.match(out, /installs once, into its own data folder/);
  assert.match(out, /npm packages: Vite, React, Playwright/);
  assert.match(out, /headless Chromium, for stills/);
  assert.match(out, /Nothing is added to your project/);
  assert.match(out, /run this command again with --yes/);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(fs.readdirSync(w.home), []);
});

test("setup --yes copies the app, installs its packages, downloads the browser, and stamps each", async (t) => {
  const w = world(t);
  const { status, out } = await quiet(() => setup(["--yes"], w.deps));
  assert.equal(status, 0);
  assert.equal(out, `ok: installed in ${w.home}\n`);

  for (const file of SOURCE_FILES) assert.ok(fs.existsSync(path.join(w.at.app, file)), file);
  for (const dir of SOURCE_DIRS) assert.ok(fs.statSync(path.join(w.at.app, dir)).isDirectory(), dir);
  assert.ok(fs.existsSync(path.join(w.at.app, "fixtures", "kit", "timeline.ts")), "the fixtures get the kit they draw with");

  assert.equal(w.calls.length, 2);
  const [npm, browser] = w.calls;
  assert.deepEqual([npm.tool, npm.args, npm.cwd], ["npm", ["ci", "--no-audit", "--no-fund"], w.at.app]);
  assert.deepEqual([browser.tool, browser.args, browser.cwd], ["node", [w.at.playwright, "install", "chromium"], w.at.app]);
  assert.equal(browser.env.PLAYWRIGHT_BROWSERS_PATH, w.at.browsers, "the browser goes into the data folder, not the user's cache");
  assert.ok(npm.env.PATH.split(path.delimiter).includes(path.dirname(process.execPath)), "the child can find this Node");

  assert.equal(fs.readFileSync(path.join(w.at.app, ".install-stamp"), "utf8").trim(), lockHash(LOCKFILE));
  assert.equal(fs.readFileSync(path.join(w.at.browsers, ".install-stamp"), "utf8").trim(), playwrightVersion(LOCKFILE));
  assert.match(playwrightVersion(LOCKFILE), /^\d+\.\d+\.\d+$/);
  assert.deepEqual(installState(w.home, PLUGIN), { app: "ready", browser: "ready" });

  const again = await quiet(() => setup(["--yes"], w.deps));
  assert.equal(again.status, 0);
  assert.match(again.out, /studio:  ready\nbrowser: ready\nok: installed in/);
  assert.equal(w.calls.length, 2, "an install that is current is not repeated");
});

test("--no-browser installs the packages alone, and a later setup adds only the browser", async (t) => {
  const w = world(t);
  assert.equal((await quiet(() => setup(["--yes", "--no-browser"], w.deps))).status, 0);
  assert.deepEqual(w.calls.map((c) => c.tool), ["npm"]);
  assert.deepEqual(installState(w.home, PLUGIN), { app: "ready", browser: "missing" });
  assert.equal((await quiet(() => setup(["--check", "--no-browser"], w.deps))).status, 0, "ready enough to preview");
  assert.equal((await quiet(() => setup(["--check"], w.deps))).status, 1, "not ready to take stills");
  assert.equal((await quiet(() => setup(["--yes"], w.deps))).status, 0);
  assert.deepEqual(w.calls.map((c) => c.tool), ["npm", "node"], "the packages were not installed twice");
});

test("a failed install leaves no stamp, says why, and is retried next time", async (t) => {
  const w = world(t, { npmStatus: 1 });
  assert.equal((await quiet(() => setup(["--yes"], w.deps))).status, 1);
  assert.equal(fs.existsSync(path.join(w.at.app, ".install-stamp")), false);
  assert.match(w.said.join("\n"), /`npm ci` failed\. It needs network access the first time/);
  assert.deepEqual(w.calls.map((c) => c.tool), ["npm"], "the browser is not attempted after a failed package install");
  assert.equal(installState(w.home, PLUGIN).app, "missing");

  const b = world(t, { nodeStatus: 3 });
  assert.equal((await quiet(() => setup(["--yes"], b.deps))).status, 3);
  assert.deepEqual(installState(b.home, PLUGIN), { app: "ready", browser: "missing" }, "the packages stay installed when only the browser failed");
  assert.match(b.said.join("\n"), /the browser download failed\. The studio still previews figures/);
});

test("a plugin update that changed the lockfile makes the install stale", async (t) => {
  const w = world(t);
  await quiet(() => setup(["--yes"], w.deps));
  fs.writeFileSync(path.join(w.at.app, ".install-stamp"), "an-older-lockfile\n");
  assert.equal(installState(w.home, PLUGIN).app, "stale");
  const check = await quiet(() => setup(["--check"], w.deps));
  assert.equal(check.status, 1);
  assert.match(check.out, /studio:  stale \(the plugin was updated: its packages changed\)/);
  assert.equal((await quiet(() => setup(["--yes"], w.deps))).status, 0);
  assert.deepEqual(w.calls.map((c) => c.tool), ["npm", "node", "npm"], "the packages are reinstalled, the browser is not");
});

test("a machine without npm, or with an old Node, is told so before anything is copied", async (t) => {
  const w = world(t);
  await assert.rejects(() => quiet(() => setup(["--yes"], { ...w.deps, env: { PT_HOME: w.home, PATH: tempDir(t, "empty-") } })), (e) => e instanceof PtError && e.code === 2 && /'npm' was not found on PATH/.test(e.message) && /https:\/\/nodejs\.org\//.test(e.message));
  await assert.rejects(() => quiet(() => setup(["--yes"], { ...w.deps, nodeVersion: "18.19.0" })), /Node\.js v18\.19\.0 is too old: the studio \(Vite 6\) needs Node 20\+/);
  assert.deepEqual(fs.readdirSync(w.home), []);
  assert.equal(prerequisites({ env: w.deps.env }), null);
  assert.equal(findOnPath("npm", w.deps.env), path.join(w.deps.env.PATH, process.platform === "win32" ? "npm.cmd" : "npm"));
  assert.equal(findOnPath("definitely-not-a-program", w.deps.env), null);
});

test("studio refuses to start from an install that is missing or stale", async (t) => {
  const w = world(t);
  const { dir } = tempRepo(t, "pt-repo-");
  await assert.rejects(() => studio(["--repo", dir], w.deps), (e) => e instanceof PtError && e.code === 2 && /the studio is not installed: run `setup --yes` first/.test(e.message));
  await quiet(() => setup(["--yes", "--no-browser"], w.deps));
  fs.writeFileSync(path.join(w.at.app, ".install-stamp"), "older\n");
  await assert.rejects(() => studio(["--repo", dir], w.deps), /out of date \(the plugin was updated\)/);
  assert.equal(fs.existsSync(path.join(dir, ".agents")), false, "a refused start leaves the repo untouched");
});

test("studio starts Vite from the data folder, pointed at the repo's folders", async (t) => {
  const w = world(t);
  const { dir } = tempRepo(t, "pt-repo-");
  const repo = fs.realpathSync(dir);
  await quiet(() => setup(["--yes", "--no-browser"], w.deps));
  w.calls.length = 0;
  fs.rmSync(path.join(w.at.app, "src", "main.tsx"));

  assert.equal(await studio(["--repo", repo], w.deps), 0);
  assert.equal(w.calls.length, 1);
  const [vite] = w.calls;
  assert.deepEqual([vite.tool, vite.args, vite.cwd], ["node", [w.at.vite], w.at.app]);
  assert.equal(vite.env.PT_REPO, repo);
  assert.equal(vite.env.PT_FIGURES, path.join(repo, ".agents", "picture-this", "figures"));
  assert.equal(vite.env.PT_DRAFTS, path.join(repo, ".agents", "picture-this", "drafts"));
  assert.ok(fs.existsSync(path.join(w.at.app, "src", "main.tsx")), "the app's sources are refreshed on every start");
  assert.equal(fs.readFileSync(path.join(repo, DRAFTS_DIR, ".gitignore"), "utf8"), "*\n", "the scratch folder is created ignored");
  assert.match(w.said.join("\n"), /starting the studio for/);
});

test("a studio already serving this repo is handed back, and a dead one's lock is cleared", async (t) => {
  const w = world(t);
  const { dir } = tempRepo(t, "pt-repo-");
  const repo = fs.realpathSync(dir);
  await quiet(() => setup(["--yes", "--no-browser"], w.deps));
  w.calls.length = 0;
  const lock = write(repo, `${DRAFTS_DIR}/.studio.lock`, JSON.stringify({ port: 5199, pid: 1 }));
  const answers = (body) => async (url) => { assert.equal(url, "http://127.0.0.1:5199/api/health"); return { json: async () => body }; };

  assert.equal(await studio(["--repo", repo], { ...w.deps, fetch: answers({ ok: true, app: "picture-this", repo }) }), 0);
  assert.deepEqual(w.calls, [], "no second server");
  assert.match(w.said.join("\n"), /already running for this repo\.\n {2}➜ {2}Local: {3}http:\/\/127\.0\.0\.1:5199\//);

  for (const body of [{ ok: true, app: "workflow-studio", repo }, { ok: true, app: "picture-this", repo: path.join(repo, "other") }]) {
    fs.writeFileSync(lock, JSON.stringify({ port: 5199, pid: 1 }));
    w.calls.length = 0;
    assert.equal(await studio(["--repo", repo], { ...w.deps, fetch: answers(body) }), 0);
    assert.equal(w.calls.length, 1, "something else on that port is not this repo's studio");
    assert.equal(fs.existsSync(lock), false, "the stale lock is removed before the new server writes its own");
  }

  assert.equal(await runningPort(lock, repo), null, "no lock, no port");
  fs.writeFileSync(lock, "not json");
  assert.equal(await runningPort(lock, repo), null);
  fs.writeFileSync(lock, JSON.stringify({ port: "5199" }));
  assert.equal(await runningPort(lock, repo), null);
  fs.writeFileSync(lock, JSON.stringify({ port: 5199 }));
  assert.equal(await runningPort(lock, repo, async () => { throw new Error("refused"); }), null, "a port nothing answers on");
});

test("a repo's folders come from its config, or from the defaults", (t) => {
  const { dir } = tempRepo(t, "pt-repo-");
  assert.deepEqual(readConfig(dir), { configured: false, version: 1, figuresDir: ".agents/picture-this/figures", stillsDir: "docs/figures", mdxComponents: null });
  write(dir, ".agents/picture-this.json", JSON.stringify({ version: 1, figuresDir: "docs/src/figures/", stillsDir: "docs/public/figures", mdxComponents: "docs/src/mdx.tsx" }));
  assert.deepEqual(readConfig(dir), { configured: true, version: 1, figuresDir: "docs/src/figures", stillsDir: "docs/public/figures", mdxComponents: "docs/src/mdx.tsx" });
  const at = layout(dir);
  assert.equal(at.kit, path.join(dir, "docs", "src", "figures", "kit"));
  assert.equal(at.stills, path.join(dir, "docs", "public", "figures"));
  assert.equal(at.lock, path.join(dir, ".agents", "picture-this", "drafts", ".studio.lock"));

  for (const [config, pattern] of [
    ["{ nope", /is not JSON/],
    ["[]", /is not a JSON object/],
    [JSON.stringify({ version: 2 }), /version 2 is not one this plugin reads/],
    [JSON.stringify({ version: 1, figuresDir: "../elsewhere" }), /figuresDir '\.\.\/elsewhere' is not a folder inside the repo/],
    [JSON.stringify({ version: 1, stillsDir: "." }), /stillsDir '\.' is not a folder inside the repo/],
    [JSON.stringify({ version: 1, figuresDir: "" }), /figuresDir is missing/],
  ]) {
    write(dir, ".agents/picture-this.json", config);
    assert.throws(() => readConfig(dir), (e) => e instanceof PtError && pattern.test(e.message), config);
  }
});

test("the scratch folder is ignored once, a figure name is kebab-case, and --repo must exist", (t) => {
  const { dir, git } = tempRepo(t, "pt-repo-");
  const drafts = ensureDrafts(dir);
  write(drafts, "round-1/a/figure.tsx", "x");
  fs.writeFileSync(path.join(drafts, ".gitignore"), "*\n!keep\n");
  ensureDrafts(dir);
  assert.equal(fs.readFileSync(path.join(drafts, ".gitignore"), "utf8"), "*\n!keep\n", "an ignore file that is there is left alone");
  fs.writeFileSync(path.join(drafts, ".gitignore"), "*\n");
  assert.equal(git("status", "--porcelain"), "", "nothing in the scratch folder is ever offered to a commit");

  assert.equal(slug("job-queue"), "job-queue");
  for (const bad of ["Job Queue", "job_queue", "-x", "kit", "", "9lives"]) assert.throws(() => slug(bad), /is not a figure name/, bad);

  assert.equal(fs.realpathSync(repoRoot(null, { cwd: path.join(drafts, "round-1") })), fs.realpathSync(dir), "the git checkout around the current folder");
  assert.equal(repoRoot(dir), path.resolve(dir));
  assert.throws(() => repoRoot(path.join(dir, "absent")), /no such folder/);
  const plain = tempDir(t, "pt-plain-");
  assert.equal(fs.realpathSync(repoRoot(null, { cwd: plain })), fs.realpathSync(plain), "outside git, the folder itself");
});

test("the studio's own files: every source it copies exists, and its lockfile pins Vite 6", () => {
  for (const file of SOURCE_FILES) assert.ok(fs.existsSync(path.join(PLUGIN, "app", file)), `app/${file}`);
  for (const dir of SOURCE_DIRS) assert.ok(fs.statSync(path.join(PLUGIN, "app", dir)).isDirectory(), `app/${dir}`);
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"));
  assert.match(lock.packages["node_modules/vite"].version, /^6\./, "figures outside the server's root are known to load under Vite 6");
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (entry.resolved) assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${name} comes from the public registry`);
  }
  const ignore = fs.readFileSync(path.join(PLUGIN, "app", ".gitignore"), "utf8");
  assert.match(ignore, /^node_modules$/m);
  const config = fs.readFileSync(path.join(PLUGIN, "app", "vite.config.mjs"), "utf8");
  assert.match(config, /tsconfigRaw/, "the user's tsconfig is never read");
  assert.match(config, /dedupe: \["react", "react-dom"\]/);
  assert.match(config, /strict: true/);
  assert.match(config, /app: "picture-this"/, "health names the app the launcher looks for");
});
