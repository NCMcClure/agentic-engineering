// agentic-teamwork's hooks/lib/config.mjs: the one reader of a repo's
// settings. The defaults are what a repo gets for saying nothing, so they are
// pinned here key by key; a change to one is a change to every repo's rules.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { REPO, tempRepo, write } from "./helpers.mjs";
import {
  DEFAULTS, ENV_EXAMPLE, FIRST_LAYOUT, MANIFEST, RULES, SECRET_PATTERNS, SOURCE_FILE,
  anyOf, blockFromFirstLayout, globTest, loadConfig, modeFor, notWired, settings, toRegExp,
} from "../../../plugins/agentic-teamwork/hooks/lib/config.mjs";

const PLUGIN = path.join(REPO, "plugins", "agentic-teamwork");
const manifest = (extra = {}) => JSON.stringify({ standard: "agentic-engineering", standard_version: 1, project: "fixture", default_branch: "main", lanes: { unit: "npm test" }, owned: {}, ...extra }, null, 2);

// ---- the defaults --------------------------------------------------------

test("the defaults, key by key", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(DEFAULTS)), {
    provider: "auto",
    remote: "origin",
    protectedBranches: null,
    branchPrefixes: [],
    escapeHatch: "TEAMWORK_ALLOW",
    requireTestsPass: false,
    test: { command: null, dir: ".", sourcePatterns: [], testPatterns: [], timeoutSeconds: 240 },
    build: { command: null, dir: "." },
    lint: { command: null, filePatterns: [] },
    junkPatterns: ["(^|/)\\.DS_Store$", "(^|/)Thumbs\\.db$", "(^|/)node_modules/", "(^|/)__pycache__/", "(^|/)\\.env(\\..*)?$"],
    secretPatternsExtra: [],
    coupledFiles: [],
    docs: { files: ["README.md", "CLAUDE.md"], watchPatterns: [] },
    scan: { maxFileBytes: 524288 },
    rules: { blockCommitOnProtected: true, blockPushToProtected: true, blockForcePush: true, blockNoVerify: true, blockSecrets: true, blockJunk: true, askBeforePush: true, stopGate: true },
  });
  assert.deepEqual(Object.keys(DEFAULTS.rules), [...RULES]);
});

test("the defaults cannot be changed by a hook that reads them", () => {
  assert.throws(() => { DEFAULTS.rules.blockSecrets = false; }, TypeError);
  assert.throws(() => { DEFAULTS.junkPatterns.push("x"); }, TypeError);
});

test("no block, an empty block, and a block that is not an object all give the defaults", () => {
  const base = settings(undefined, { defaultBranch: "main" });
  for (const block of [{}, null, [], "strict", 7]) assert.deepEqual(settings(block, { defaultBranch: "main" }), base);
  const { defaultBranch, protectedBranches, ...rest } = base;
  const { protectedBranches: unset, ...defaults } = JSON.parse(JSON.stringify(DEFAULTS));
  assert.deepEqual(rest, defaults);
  assert.equal(unset, null);
  assert.equal(defaultBranch, "main");
  assert.deepEqual(protectedBranches, ["main"]);
});

test("what is protected: the named branches, else the default branch, else main and master", () => {
  assert.deepEqual(settings({ protectedBranches: ["main", "release"] }, { defaultBranch: "trunk" }).protectedBranches, ["main", "release"]);
  assert.deepEqual(settings({}, { defaultBranch: "trunk" }).protectedBranches, ["trunk"]);
  assert.deepEqual(settings({ protectedBranches: [] }, { defaultBranch: "trunk" }).protectedBranches, ["trunk"]);
  assert.deepEqual(settings({}).protectedBranches, ["main", "master"]);
});

test("requireTestsPass is off unless the block turns it on, at its top or under rules", () => {
  assert.equal(settings({}).requireTestsPass, false);
  assert.equal(settings({ requireTestsPass: true }).requireTestsPass, true);
  assert.equal(settings({ rules: { requireTestsPass: true } }).requireTestsPass, true);
  assert.equal(settings({ requireTestsPass: false, rules: { requireTestsPass: true } }).requireTestsPass, false, "the top-level key wins");
  assert.equal(settings({ requireTestsPass: "yes" }).requireTestsPass, false, "only true is on");
  assert.equal("requireTestsPass" in settings({ rules: { requireTestsPass: true } }).rules, false, "it is not one of the switches");
});

test("a rule is on unless the block says false", () => {
  const { rules } = settings({ rules: { blockForcePush: false, blockJunk: 0, askBeforePush: null, madeUp: false } });
  assert.equal(rules.blockForcePush, false);
  assert.equal(rules.blockJunk, true);
  assert.equal(rules.askBeforePush, true);
  assert.deepEqual(Object.keys(rules), [...RULES]);
});

test("every key is optional and a set key keeps its neighbours' defaults", () => {
  const s = settings({ test: { command: "npm test" }, lint: { filePatterns: ["\\.ts$"] }, scan: {}, provider: "gitlab", remote: "team", branchPrefixes: ["feature/"] });
  assert.deepEqual(s.test, { command: "npm test", dir: ".", sourcePatterns: [], testPatterns: [], timeoutSeconds: 240 });
  assert.deepEqual(s.lint, { command: null, filePatterns: ["\\.ts$"] });
  assert.deepEqual(s.scan, { maxFileBytes: 524288 });
  assert.equal(s.provider, "gitlab");
  assert.equal(s.remote, "team");
  assert.deepEqual(s.branchPrefixes, ["feature/"]);
});

test("a key of the wrong type takes its default: a guard that cannot read a setting keeps guarding", () => {
  const s = settings({
    provider: "bitbucket", remote: 7, protectedBranches: "main", escapeHatch: "NOT A NAME", test: "npm test", lint: { command: 5, filePatterns: "ts" },
    junkPatterns: [], secretPatternsExtra: [3, "sk_live_x"], coupledFiles: [{ files: [] }, "x", { files: ["a", 4], message: 9 }], scan: { maxFileBytes: -1 }, rules: "none",
  }, { defaultBranch: "main" });
  assert.equal(s.provider, "auto");
  assert.equal(s.remote, "origin");
  assert.deepEqual(s.protectedBranches, ["main"]);
  assert.equal(s.escapeHatch, "TEAMWORK_ALLOW");
  assert.equal(s.test.command, null);
  assert.deepEqual(s.lint, { command: null, filePatterns: [] });
  assert.deepEqual(s.junkPatterns, [...DEFAULTS.junkPatterns]);
  assert.deepEqual(s.secretPatternsExtra, ["sk_live_x"]);
  assert.deepEqual(s.coupledFiles, [{ files: ["a"], message: "These files change together." }]);
  assert.equal(s.scan.maxFileBytes, 524288);
  assert.deepEqual(s.rules, { ...DEFAULTS.rules });
});

// ---- patterns ------------------------------------------------------------

test("patterns: a bad one is skipped, and grep's bracket classes are honored", () => {
  assert.equal(toRegExp("("), null);
  assert.equal(toRegExp(""), null);
  assert.equal(toRegExp(7), null);
  assert.ok(toRegExp("^key_[[:alnum:]]{4}$").test("key_a1B2"));
  assert.ok(!toRegExp("^key_[[:alnum:]]{4}$").test("key_a1_2"));
  assert.ok(toRegExp("a[[:space:]]+b").test("a \t b"));
  const any = anyOf(["(", "^src/", "\\.md$"]);
  assert.ok(any("src/a.mjs") && any("docs/a.md"));
  assert.ok(!any("lib/a.mjs"));
  assert.equal(anyOf([])("anything"), false);
  assert.equal(anyOf(undefined)("anything"), false);
});

test("the default junk patterns, and the env files that are not junk", () => {
  const junk = (file) => anyOf(DEFAULTS.junkPatterns)(file) && !ENV_EXAMPLE.test(file);
  for (const file of [".DS_Store", "a/b/.DS_Store", "Thumbs.db", "node_modules/x/index.js", "pkg/node_modules/x.js", "src/__pycache__/a.pyc", ".env", "api/.env", ".env.local", ".env.production"]) assert.ok(junk(file), file);
  for (const file of [".env.example", "api/.env.sample", ".env.template", "src/env.mjs", "docs/.envrc.md", "my_node_modules.txt", ".environment"]) assert.ok(!junk(file), file);
});

test("the built-in credential shapes fire on a credential and not on ordinary source", () => {
  const found = anyOf(SECRET_PATTERNS);
  const real = [`sk-ant-${"a".repeat(12)}`, `AKIA${"A".repeat(16)}`, `ghp_${"a".repeat(36)}`, `github_pat_${"a".repeat(22)}`, `glpat-${"a".repeat(20)}`, `xoxb-${"1".repeat(12)}`, "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----"];
  for (const text of real) assert.ok(found(`const k = "${text}";`), text.slice(0, 12));
  for (const text of ["const token = process.env.GITHUB_TOKEN;", "AKIA is how an access key id starts", "-----BEGIN PUBLIC KEY-----", "ghp_tooshort", "skeleton-ant-hill"]) assert.ok(!found(text), text);
});

test("coupled-file globs: * crosses folders, ? is one character, a plain path is itself", () => {
  assert.ok(globTest("docs/api/*.md")("docs/api/users.md"));
  assert.ok(globTest("docs/*.md")("docs/api/users.md"));
  assert.ok(!globTest("docs/*.md")("docs/api/users.mdx"));
  assert.ok(globTest("src/v?/schema.json")("src/v2/schema.json"));
  assert.ok(globTest("a+b (1).txt")("a+b (1).txt"));
  assert.ok(!globTest("a.txt")("aXtxt"));
});

test("what counts as source where no pattern says, and what a not-wired lane looks like", () => {
  for (const file of ["src/a.ts", "a.py", "cmd/main.go", "lib/x.rs", "db/1.sql"]) assert.ok(SOURCE_FILE.test(file), file);
  for (const file of ["README.md", "package.json", "notes.txt", "a.tsv"]) assert.ok(!SOURCE_FILE.test(file), file);
  assert.ok(notWired("not wired: no browser yet"));
  assert.ok(!notWired("npm test"));
});

// ---- reading a repo ------------------------------------------------------

test("loadConfig reads the manifest's teamwork block, its default branch and its lanes", (t) => {
  const { dir } = tempRepo(t, "tw-config-");
  write(dir, MANIFEST, manifest({ default_branch: "trunk", lanes: { unit: "npm test", e2e: "not wired: later", bad: 4 }, teamwork: { requireTestsPass: true, test: { command: "npm test" } } }));
  const config = loadConfig(dir);
  assert.equal(config.root, dir);
  assert.equal(config.manifest.project, "fixture");
  assert.equal(config.unmoved, false);
  assert.equal(config.defaultBranch, "trunk");
  assert.deepEqual(config.protectedBranches, ["trunk"]);
  assert.deepEqual(config.lanes, { unit: "npm test", e2e: "not wired: later" });
  assert.equal(config.requireTestsPass, true);
  assert.equal(config.test.command, "npm test");
});

test("loadConfig never throws: no repo, no manifest and an unreadable one all give the defaults", (t) => {
  const { dir } = tempRepo(t, "tw-config-");
  const bare = loadConfig(dir);
  assert.equal(bare.manifest, null);
  assert.deepEqual(bare.protectedBranches, ["main", "master"]);
  assert.deepEqual(bare.lanes, {});
  write(dir, MANIFEST, "{ not json");
  assert.deepEqual(loadConfig(dir), bare);
  write(dir, MANIFEST, "[1, 2]");
  assert.deepEqual(loadConfig(dir), bare);
  assert.equal(loadConfig(null).manifest, null);
  assert.equal(loadConfig(path.join(dir, "nowhere")).requireTestsPass, false);
});

test("a manifest with a byte order mark still reads", (t) => {
  const { dir } = tempRepo(t, "tw-config-");
  write(dir, MANIFEST, `﻿${manifest({ teamwork: { remote: "team" } })}`);
  assert.equal(loadConfig(dir).remote, "team");
});

// ---- the first layout ----------------------------------------------------

const OLD_DEFAULT = {
  version: 1, provider: "auto", remote: "origin", baseBranch: "main", protectedBranches: ["main", "master"], branchPrefixes: ["feature/", "fix/", "chore/"],
  escapeHatch: "TEAMWORK_ALLOW", test: { command: null, dir: ".", sourcePatterns: [], testPatterns: [], timeoutSeconds: 240 }, build: { command: null, dir: "." },
  lint: { command: null, filePatterns: [] }, junkPatterns: ["(^|/)\\.DS_Store$", "(^|/)Thumbs\\.db$", "(^|/)node_modules/", "(^|/)__pycache__/", "(^|/)\\.env(\\..*)?$"],
  secretPatternsExtra: [], coupledFiles: [], docs: { files: ["README.md", "CLAUDE.md"], watchPatterns: [] }, scan: { maxFileBytes: 524288 },
  rules: { blockCommitOnProtected: true, blockPushToProtected: true, blockForcePush: true, blockNoVerify: true, blockSecrets: true, blockJunk: true, requireTestsPass: true, stopGate: true },
};

test("the block for a first-layout file carries every key and spells out what was the default there", () => {
  const block = blockFromFirstLayout(OLD_DEFAULT);
  assert.equal("version" in block || "baseBranch" in block, false);
  assert.equal(block.requireTestsPass, true);
  assert.deepEqual(block.protectedBranches, ["main", "master"]);
  assert.deepEqual(block.branchPrefixes, ["feature/", "fix/", "chore/"]);
  assert.equal("requireTestsPass" in block.rules, false, "it moved to the top of the block");
  assert.deepEqual(block.rules, { blockCommitOnProtected: true, blockPushToProtected: true, blockForcePush: true, blockNoVerify: true, blockSecrets: true, blockJunk: true, stopGate: true });
  for (const key of ["provider", "remote", "escapeHatch", "test", "build", "lint", "junkPatterns", "secretPatternsExtra", "coupledFiles", "docs", "scan"]) assert.deepEqual(block[key], OLD_DEFAULT[key], key);
});

test("a minimal first-layout file still means what it meant: main and master, the test gate on", () => {
  for (const old of [{}, { version: 1 }, { protectedBranches: [], rules: {} }, null, "x"]) {
    const block = blockFromFirstLayout(old);
    assert.deepEqual(block, { protectedBranches: ["main", "master"], branchPrefixes: ["feature/", "fix/", "chore/"], requireTestsPass: true });
  }
  assert.equal(blockFromFirstLayout({ rules: { requireTestsPass: false, blockJunk: false } }).requireTestsPass, false);
  assert.deepEqual(blockFromFirstLayout({ rules: { requireTestsPass: false, blockJunk: false } }).rules, { blockJunk: false });
});

test("loadConfig reads a first-layout file until a manifest carries the block", (t) => {
  const { dir } = tempRepo(t, "tw-config-");
  const old = { ...OLD_DEFAULT, baseBranch: "trunk", protectedBranches: ["trunk", "release"], test: { ...OLD_DEFAULT.test, command: "make test" }, rules: { ...OLD_DEFAULT.rules, blockForcePush: false } };
  write(dir, FIRST_LAYOUT, JSON.stringify(old));
  const before = loadConfig(dir);
  assert.equal(before.unmoved, true);
  assert.equal(before.manifest, null);
  assert.equal(before.defaultBranch, "trunk");
  assert.deepEqual(before.protectedBranches, ["trunk", "release"]);
  assert.equal(before.requireTestsPass, true);
  assert.equal(before.rules.blockForcePush, false);

  // A manifest with no block of its own does not take the old rules away.
  write(dir, MANIFEST, manifest());
  const beside = loadConfig(dir);
  assert.equal(beside.unmoved, true);
  assert.equal(beside.defaultBranch, "main", "the manifest names the default branch once there is one");
  assert.deepEqual(beside.protectedBranches, ["trunk", "release"]);
  assert.equal(beside.requireTestsPass, true);

  // Once the manifest has the block, the old file is not read at all.
  write(dir, MANIFEST, manifest({ teamwork: {} }));
  const after = loadConfig(dir);
  assert.equal(after.unmoved, false);
  assert.equal(after.requireTestsPass, false);
  assert.deepEqual(after.protectedBranches, ["main"]);
});

test("the block written for a first-layout file reads back as the same settings", (t) => {
  const { dir } = tempRepo(t, "tw-config-");
  const old = { ...OLD_DEFAULT, test: { command: "npm test", dir: "server", sourcePatterns: ["^server/src/"], testPatterns: ["^server/test/"], timeoutSeconds: 90 }, lint: { command: "eslint {file}", filePatterns: ["\\.ts$"] }, secretPatternsExtra: ["sk_live_[A-Za-z0-9]{8,}"], coupledFiles: [{ files: ["a", "b"], message: "together" }] };
  write(dir, FIRST_LAYOUT, JSON.stringify(old));
  const { manifest: none, unmoved, lanes, ...before } = loadConfig(dir);
  write(dir, MANIFEST, manifest({ default_branch: old.baseBranch, teamwork: blockFromFirstLayout(old) }));
  fs.rmSync(path.join(dir, FIRST_LAYOUT));
  const { manifest: some, unmoved: moved, lanes: now, ...after } = loadConfig(dir);
  assert.deepEqual(after, before);
  assert.equal(unmoved, true);
  assert.equal(moved, false);
});

// ---- the mode ------------------------------------------------------------

test("modeFor is the kernel's mode, with a first-layout repo counted as full", (t) => {
  const { dir, git } = tempRepo(t, "tw-config-");
  assert.equal(modeFor(dir), "none");
  assert.equal(modeFor(null), "none");
  git("config", "--local", "agentic-engineering.plugins", "on Test 2026-01-01T00:00Z");
  assert.equal(modeFor(dir), "portable");
  git("config", "--local", "agentic-engineering.plugins", "off Test 2026-01-01T00:00Z");
  assert.equal(modeFor(dir), "none");
  write(dir, FIRST_LAYOUT, "{}");
  assert.equal(modeFor(dir), "full", "a repo that set the plugin up keeps it on");
  fs.rmSync(path.join(dir, FIRST_LAYOUT));
  write(dir, MANIFEST, manifest());
  assert.equal(modeFor(dir), "full", "a committed manifest outranks a personal off");
});

// ---- the pre-commit mirror keeps the same lists --------------------------

test("the pre-commit mirror, which cannot import this file, carries the same patterns", () => {
  const mirror = fs.readFileSync(path.join(PLUGIN, "templates", "githooks", "pre-commit"), "utf8");
  for (const pattern of [...DEFAULTS.junkPatterns, ...SECRET_PATTERNS]) assert.ok(mirror.includes(JSON.stringify(pattern)), `the mirror lacks ${pattern}`);
  assert.ok(mirror.includes(String(ENV_EXAMPLE)), "the mirror lacks the env-example exception");
  assert.ok(mirror.includes(`"${MANIFEST}"`));
  assert.ok(mirror.includes(`"${DEFAULTS.escapeHatch}"`));
  assert.ok(mirror.includes(String(DEFAULTS.scan.maxFileBytes)));
  assert.ok(mirror.includes(String(DEFAULTS.test.timeoutSeconds)));
});
