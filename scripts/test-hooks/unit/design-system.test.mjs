// The design system half of the design area: design.mjs and lib/system.mjs.
// The person's profile, the manifest read from a source (a local folder, or a
// GitHub repo through an injected fetcher: no test touches the network), the
// pin a repo commits with the checker and the rules beside it, an upgrade, and
// whether the two agree. The system is house-ui, invented for these tests.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { REPO } from "../fixtures.mjs";
import { tempDir, write } from "./design-fixtures.mjs";
import { main } from "../../../plugins/agentic-engineering/skills/design/scripts/design.mjs";
import { CHECKER_ASSET, buildPin, fetchFile, isWebFrontEnd, manifestProblems, parseSource, readProfile } from "../../../plugins/agentic-engineering/skills/design/scripts/lib/system.mjs";

const FIXTURES = path.join(REPO, "scripts", "test-hooks", "fixtures", "design-system");
const HOUSE = path.join(FIXTURES, "house-ui");
const CONSUMER = path.join(FIXTURES, "consumer");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HOUSE, "design-system.json"), "utf8"));

/** A fetcher that serves house-ui as the GitHub repo house/ui, at any ref, and records each call. `files` overrides or removes (null) a file. */
function github(files = {}) {
  const calls = [];
  const fetch = (source, ref, rel) => {
    calls.push([source.kind, `${source.owner}/${source.repo}`, ref, rel]);
    if (source.kind !== "github" || source.owner !== "house" || source.repo !== "ui") return null;
    if (Object.hasOwn(files, rel)) return files[rel];
    try { return fs.readFileSync(path.join(HOUSE, rel), "utf8"); } catch { return null; }
  };
  return { fetch, calls };
}

/** Run design.mjs in a folder with a data directory; returns the exit code and what it printed. */
async function design(args, { data, cwd = tempDir("ds-cwd-"), fetch = github().fetch, env = {} } = {}) {
  const out = [], err = [];
  const code = await main([...args, ...(data ? ["--data", data] : [])], { cwd, fetch, env, out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** A copy of the consumer app, with a manifest of its own lanes when asked. */
function consumer({ manifest = false, pkg = true } = {}) {
  const dir = tempDir("ds-repo-");
  fs.cpSync(CONSUMER, dir, { recursive: true });
  if (!pkg) fs.rmSync(path.join(dir, "package.json"));
  if (manifest) write(dir, ".agents/manifest.json", `${JSON.stringify({ standard: "x", lanes: { unit: "npm test" } }, null, 2)}\n`);
  return dir;
}

test("profile: none, then a GitHub source at a tag, then a local folder, and a source that is neither is refused", async () => {
  const data = tempDir("ds-data-");
  assert.deepEqual(await design(["profile", "show"], { data }), { code: 0, out: "No design system is declared on this machine.", err: "" });
  let r = await design(["profile", "set", "house/ui", "--ref", "v0.2.0"], { data });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readProfile(data), { source: "house/ui", ref: "v0.2.0" });
  r = await design(["profile", "show", "--json"], { data });
  assert.deepEqual(JSON.parse(r.out), { source: "house/ui", ref: "v0.2.0" });
  assert.equal((await design(["profile", "show"], { data })).out, "Design system: house/ui at v0.2.0.");

  r = await design(["profile", "set", HOUSE], { data });
  assert.equal(r.code, 0);
  assert.deepEqual(readProfile(data), { source: HOUSE }, "a new source drops the old tag");
  r = await design(["profile", "set", "not a source"], { data });
  assert.equal(r.code, 2);
  assert.match(r.err, /neither a folder here nor a GitHub owner\/repo/);
  r = await design(["profile", "show"], { env: { CLAUDE_PLUGIN_DATA: "" } });
  assert.equal(r.code, 2, "no data directory, no profile");
  assert.match(r.err, /pass --data/);
});

test("profile: the data directory defaults to the plugin's, under the area's name", async () => {
  const plugin = tempDir("ds-plugin-data-");
  const r = await design(["profile", "set", "house/ui"], { env: { CLAUDE_PLUGIN_DATA: plugin } });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(plugin, "design", "profile.json"), "utf8")), { source: "house/ui" });
});

test("manifest: read from the source at the profile's tag, through the fetcher", async () => {
  const data = tempDir("ds-data-");
  await design(["profile", "set", "house/ui", "--ref", "v0.2.0"], { data });
  const gh = github();
  const r = await design(["manifest"], { data, fetch: gh.fetch });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), MANIFEST);
  assert.deepEqual(gh.calls, [["github", "house/ui", "v0.2.0", "design-system.json"]]);
  const rules = await design(["rules"], { data, fetch: gh.fetch });
  assert.match(rules.out, /^# house-ui usage rules/);
  assert.deepEqual(gh.calls.at(-1), ["github", "house/ui", "v0.2.0", "docs/RULES.md"]);
  assert.match((await design(["catalog"], { data, fetch: gh.fetch })).out, /^# house-ui components/);
});

test("manifest: a source that ships none falls back to the profile's description, saved by interview", async () => {
  const data = tempDir("ds-data-");
  await design(["profile", "set", "house/ui"], { data });
  const bare = github({ "design-system.json": null });
  let r = await design(["manifest"], { data, fetch: bare.fetch });
  assert.equal(r.code, 2);
  assert.match(r.err, /house\/ui has no design-system\.json, and the profile holds no description: the system route interviews for one/);

  const answers = write(tempDir("ds-answers-"), "answers.json", JSON.stringify({ ...MANIFEST, name: "house-ui-described" }));
  r = await design(["profile", "manifest", answers], { data });
  assert.equal(r.code, 0, r.err);
  r = await design(["manifest"], { data, fetch: bare.fetch });
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(r.out).name, "house-ui-described");
  assert.match(r.err, /ships no design-system\.json; this is the profile's description/);
  r = await design(["manifest"], { data, fetch: github().fetch });
  assert.equal(JSON.parse(r.out).name, "house-ui", "the source's own file wins once it ships one");
  assert.match((await design(["profile", "show"], { data })).out, /the profile holds its description \(house-ui-described 0\.2\.0\)/);

  const broken = write(tempDir("ds-answers-"), "broken.json", JSON.stringify({ ...MANIFEST, schema: 2, install: { kit: "x", item: "y", pin: "z" } }));
  r = await design(["profile", "manifest", broken], { data });
  assert.equal(r.code, 2);
  assert.match(r.err, /schema is 2, expected 1; install\.item has no \{item\} placeholder/);
});

test("manifestProblems: every field of schema 1, and a banned pattern that does not compile", () => {
  assert.deepEqual(manifestProblems(MANIFEST), []);
  assert.deepEqual(manifestProblems([]), ["it is not a JSON object"]);
  const { tokens: _t, ...noTokens } = MANIFEST;
  assert.deepEqual(manifestProblems(noTokens), ["tokens is not a list of paths"]);
  assert.deepEqual(manifestProblems({ ...MANIFEST, banned: { values: ["spacing"], classes: [{ name: "radius", pattern: "(" }] } }).map((p) => p.split(":")[0]), [
    "banned.values names \"spacing\"; the checker knows \"color\"", "banned.classes[0] (radius) is not a regular expression"]);
  assert.deepEqual(manifestProblems({ ...MANIFEST, entry: { css: ["a.css"] } }), ["entry needs css and root, each a list of strings"]);
});

test("pin: writes the pin, the checker and the rules, wires package.json and the lanes, and the check runs", async () => {
  const data = tempDir("ds-data-");
  await design(["profile", "set", "house/ui", "--ref", "v0.2.0"], { data });
  const repo = consumer({ manifest: true });
  const r = await design(["pin", "--tokens", "src/styles/tokens.css", "--exclude", "src/generated/**"], { data, cwd: repo });
  assert.equal(r.code, 0, r.err);
  const pin = JSON.parse(fs.readFileSync(path.join(repo, ".agents", "design.json"), "utf8"));
  assert.deepEqual(pin, {
    schema: 1, system: "house-ui", version: "0.2.0", source: "house/ui", ref: "v0.2.0", tokens: ["src/styles/tokens.css"],
    banned: MANIFEST.banned, allow: "design-allow.json", include: ["**/*.{css,scss,ts,tsx,js,jsx,vue,svelte,html,astro}"], exclude: ["src/generated/**"],
  });
  assert.equal(fs.readFileSync(path.join(repo, ".agents", "scripts", "design-check.mjs"), "utf8"), fs.readFileSync(CHECKER_ASSET, "utf8"));
  const rules = fs.readFileSync(path.join(repo, ".agents", "rules", "design.md"), "utf8").split("\n");
  assert.equal(rules[0], "> The usage rules of house-ui 0.2.0 (house/ui at v0.2.0), copied by the design area's adopt route. Change them in the system; an upgrade replaces this file.");
  assert.equal(rules[2], "# house-ui usage rules");
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).scripts["design:check"], "node .agents/scripts/design-check.mjs");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, ".agents", "manifest.json"), "utf8")).lanes, { unit: "npm test", design: "npm run design:check" });
  assert.match(r.out, /- wrote \.agents\/design\.json \(house-ui 0\.2\.0\)\n- wrote \.agents\/scripts\/design-check\.mjs\n- wrote \.agents\/rules\/design\.md\n- added the design:check script to package\.json\n- added the design lane \(npm run design:check\) to \.agents\/manifest\.json\nRun the check: npm run design:check/);

  const check = spawnSync(process.execPath, [".agents/scripts/design-check.mjs"], { cwd: repo, encoding: "utf8" });
  assert.equal(check.status, 1, "the repo's own copy runs with no plugin, and finds what is off-system");
  assert.match(check.stdout, /5 finding\(s\) in 3 file\(s\) against house-ui 0\.2\.0\./);

  const again = await design(["pin", "--tokens", "src/styles/tokens.css"], { data, cwd: repo });
  assert.equal(again.code, 1);
  assert.match(again.err, /\.agents\/design\.json exists \(house-ui 0\.2\.0\); --upgrade moves it/);
});

test("pin: refuses without token files or with one that is not there, and keeps what a repo already has", async () => {
  const data = tempDir("ds-data-");
  await design(["profile", "set", "house/ui"], { data });
  const repo = consumer({ pkg: false });
  let r = await design(["pin"], { data, cwd: repo });
  assert.equal(r.code, 2);
  assert.match(r.err, /--tokens names the repo's token files/);
  r = await design(["pin", "--tokens", "src/styles/nope.css"], { data, cwd: repo });
  assert.match(r.err, /no such token file in the repo: src\/styles\/nope\.css/);
  assert.equal(fs.existsSync(path.join(repo, ".agents")), false, "a refusal writes nothing");

  write(repo, ".agents/rules/design.md", "# Our own notes\n");
  r = await design(["pin", "--tokens", "src/styles/tokens.css"], { data, cwd: repo });
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(path.join(repo, ".agents", "rules", "design.md"), "utf8"), "# Our own notes\n");
  assert.match(r.out, /- kept \.agents\/rules\/design\.md \(it exists; --upgrade replaces it\)/);
  assert.match(r.out, /Run the check: node \.agents\/scripts\/design-check\.mjs$/, "no package.json: the check is run with node");

  const noRules = github({ "docs/RULES.md": null });
  r = await design(["pin", "--tokens", "src/styles/tokens.css", "--upgrade"], { data, cwd: repo, fetch: noRules.fetch });
  assert.equal(r.code, 2);
  assert.match(r.err, /the rules file docs\/RULES\.md is not in house\/ui/);
});

test("upgrade and status: a new tag moves the pin, keeps its globs and tokens, replaces the rules; status says whether they agree", async () => {
  const data = tempDir("ds-data-");
  await design(["profile", "set", "house/ui", "--ref", "v0.2.0"], { data });
  const repo = consumer();
  await design(["pin", "--tokens", "src/styles/tokens.css", "--exclude", "src/generated/**"], { data, cwd: repo });
  let s = await design(["status", "--json"], { data, cwd: repo });
  assert.equal(s.code, 0, s.err);
  assert.deepEqual(JSON.parse(s.out), {
    profile: { source: "house/ui", ref: "v0.2.0", describes: false }, system: { name: "house-ui", version: "0.2.0" }, problem: null,
    pin: { system: "house-ui", version: "0.2.0", ref: "v0.2.0" }, checker: "current", agree: true,
  });

  await design(["profile", "set", "house/ui", "--ref", "v0.3.0"], { data });
  const next = github({ "design-system.json": JSON.stringify({ ...MANIFEST, version: "0.3.0" }), "docs/RULES.md": "# house-ui usage rules\n\n- New in 0.3.0.\n" });
  s = await design(["status"], { data, cwd: repo, fetch: next.fetch });
  assert.equal(s.code, 1);
  assert.match(s.out, /They differ: the repo is on house-ui 0\.2\.0, the profile names house-ui 0\.3\.0\./);

  const r = await design(["pin", "--upgrade"], { data, cwd: repo, fetch: next.fetch });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /- moved \.agents\/design\.json \(house-ui 0\.3\.0, was 0\.2\.0\)/);
  assert.match(r.out, /- kept the design:check script package\.json has/);
  const pin = JSON.parse(fs.readFileSync(path.join(repo, ".agents", "design.json"), "utf8"));
  assert.deepEqual([pin.version, pin.ref, pin.tokens, pin.exclude], ["0.3.0", "v0.3.0", ["src/styles/tokens.css"], ["src/generated/**"]]);
  assert.match(fs.readFileSync(path.join(repo, ".agents", "rules", "design.md"), "utf8"), /^> The usage rules of house-ui 0\.3\.0 \(house\/ui at v0\.3\.0\)[^\n]*\n\n# house-ui usage rules\n\n- New in 0\.3\.0\.\n$/);
  assert.match((await design(["status"], { data, cwd: repo, fetch: next.fetch })).out, /They agree\./);

  fs.appendFileSync(path.join(repo, ".agents", "scripts", "design-check.mjs"), "// edited\n");
  s = await design(["status"], { data, cwd: repo, fetch: next.fetch });
  assert.equal(s.code, 1, "a checker that drifted from the plugin's is out of step");
  assert.match(s.out, /checker behind/);
  const none = await design(["status"], { data: tempDir("ds-data-"), cwd: tempDir("ds-empty-") });
  assert.deepEqual([none.code, none.out], [0, "Profile: none on this machine.\nPin: none (.agents/design.json is not in this repo)."]);
});

test("fetchFile: GitHub through gh api with the raw media type at the ref, a 404 is no file, and no gh says so", () => {
  const seen = [];
  const spawn = (reply) => (cmd, args) => { seen.push([cmd, ...args]); return reply; };
  const gh = parseSource("house/ui", tempDir("ds-nowhere-"));
  assert.deepEqual(gh, { kind: "github", owner: "house", repo: "ui" });
  assert.equal(fetchFile(gh, "v0.2.0", "docs/RULES.md", { spawn: spawn({ status: 0, stdout: "# rules\n", stderr: "" }) }), "# rules\n");
  assert.deepEqual(seen[0], ["gh", "api", "-H", "Accept: application/vnd.github.raw", "repos/house/ui/contents/docs/RULES.md?ref=v0.2.0"]);
  fetchFile(gh, null, "design-system.json", { spawn: spawn({ status: 0, stdout: "{}" }) });
  assert.equal(seen[1].at(-1), "repos/house/ui/contents/design-system.json", "no ref: the default branch");
  assert.equal(fetchFile(gh, null, "x", { spawn: spawn({ status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }) }), null);
  assert.throws(() => fetchFile(gh, null, "x", { spawn: spawn({ status: 1, stdout: "", stderr: "gh: To get started with GitHub CLI, please run: gh auth login" }) }), /gh api could not read house\/ui: gh: To get started/);
  assert.throws(() => fetchFile(gh, null, "x", { spawn: spawn({ error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }) }) }), /gh is not on PATH/);
});

test("fetchFile: a local folder is read from its work tree, or from git at the ref", () => {
  const dir = tempDir("ds-local-");
  fs.cpSync(HOUSE, dir, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "0.2.0");
  git("tag", "v0.2.0");
  fs.writeFileSync(path.join(dir, "docs", "RULES.md"), "# work in progress\n");
  const local = parseSource(dir);
  assert.equal(local.kind, "local");
  assert.equal(fetchFile(local, null, "docs/RULES.md"), "# work in progress\n");
  assert.match(fetchFile(local, "v0.2.0", "docs/RULES.md"), /^# house-ui usage rules/);
  assert.equal(fetchFile(local, "v0.2.0", "nope.md"), null);
  assert.equal(fetchFile(local, null, "nope.md"), null);
});

test("buildPin and isWebFrontEnd: an upgrade keeps the scan settings; a front end is a components.json or a web framework dependency", () => {
  const before = buildPin(MANIFEST, { source: "house/ui", ref: "v0.2.0" }, { tokens: ["a.css"], exclude: ["gen/**"] });
  const after = buildPin({ ...MANIFEST, version: "0.3.0" }, { source: "house/ui", ref: "v0.3.0" }, {}, before);
  assert.deepEqual([after.tokens, after.exclude, after.include, after.version], [["a.css"], ["gen/**"], before.include, "0.3.0"]);
  const app = (files) => { const dir = tempDir("ds-app-"); for (const [rel, text] of Object.entries(files)) write(dir, rel, text); return dir; };
  assert.equal(isWebFrontEnd(app({ "components.json": "{}" })), true);
  for (const dep of ["react", "vue", "svelte", "solid-js", "astro", "next"]) assert.equal(isWebFrontEnd(app({ "package.json": JSON.stringify({ devDependencies: { [dep]: "1" } }) })), true, dep);
  assert.equal(isWebFrontEnd(app({ "package.json": JSON.stringify({ dependencies: { express: "4" } }) })), false);
  assert.equal(isWebFrontEnd(app({ "package.json": "{ not json" })), false);
  assert.equal(isWebFrontEnd(app({})), false);
});
