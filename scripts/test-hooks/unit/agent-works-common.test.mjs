// agent-works lib/common.mjs: the io a command works through, files, roots,
// project ids, the findings model, frontmatter, templates, the plugins block,
// the argument reader and the way a command module runs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO, runNode, tempDir, tempRepo, write } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "agent-works");
const common = await import(pathToFileURL(path.join(PLUGIN, "lib", "common.mjs")).href);
const {
  AwError, CODES, Finding, LEVELS, NEVER_ACCEPTED, PLUGINS_BLOCK,
  acceptEntries, acceptedLine, agentName, ancestors, appendListLine, atomicWrite, awHome, bufferedIo, currentBranch,
  emit, exclusiveCreate, exitFor, fail, findingsDoc, fnmatch, git, gitDir, indexKind, intArg, ioOf, isMain, jsonText,
  lineCount, linesLost, mainRoot, markdownFiles, nowIso, parseArgs, parseFrontmatter, posix, projectHome, projectId,
  projectName, projectRoot, readJson, readRaw, readStdin, readText, realPath, rel, repoRoot, report, runCommand,
  sortFindings, splitAccepted, splitLines, startDir, today, withPluginsBlock, writeJson,
} = common;

const real = (p) => fs.realpathSync.native(p);
const char = (code) => String.fromCharCode(code);
const BOM = char(0xfeff);
/** The six characters of a JSON escape, spelled so that no editor turns them into the character itself. */
const esc = (hex) => `${char(0x5c)}u${hex}`;

/** A folder that looks like a repository on a branch: a `.git` folder with a HEAD, so no git process is needed. */
function project(t, { branch = "feat/x" } = {}) {
  const tmp = real(tempDir(t, "aw-common-"));
  const root = path.join(tmp, "acme");
  write(root, ".git/HEAD", `ref: refs/heads/${branch}\n`);
  return { tmp, root };
}

/** A linked work tree of `root` at `<tmp>/wt` on the branch `topic`, laid out the way git lays one out. */
function linkedTree(tmp, root) {
  const tree = path.join(tmp, "wt");
  const gitdir = path.join(root, ".git", "worktrees", "wt");
  write(gitdir, "commondir", "../..\n");
  write(gitdir, "HEAD", "ref: refs/heads/topic\n");
  write(tree, ".git", `gitdir: ${gitdir}\n`);
  fs.mkdirSync(path.join(tree, "src"));
  return tree;
}

/** A copy of the plugin's two libraries in a plugin folder of its own, with the files `extra` names beside them. */
async function pluginCopy(t, extra = {}) {
  const dir = real(tempDir(t, "aw-plugin-"));
  for (const f of ["common.mjs", "config.mjs"]) write(dir, `lib/${f}`, fs.readFileSync(path.join(PLUGIN, "lib", f)));
  for (const [file, content] of Object.entries(extra)) write(dir, file, content);
  return { dir, lib: await import(pathToFileURL(path.join(dir, "lib", "common.mjs")).href) };
}

const FINDINGS = () => [
  new Finding("B_WARN", "warning", "b.md", 3, "w"),
  new Finding("A_CRIT", "critical", "a.md", 0, "c"),
  new Finding("C_INFO", "info", "", 0, "i"),
  new Finding("HUB_MISSING", "warning", "src/deep", 0, "no AGENTS.md here"),
  new Finding("HUB_MISSING", "warning", "src/a", 12, "second"),
  new Finding("HUB_MISSING", "warning", "src/a", 2, "first"),
  new Finding("MEM_FILE_SIZE", "info", "./.agents/memory/x.md", 0, "long — très long"),
  new Finding("LINK_BROKEN", "critical", "docs/a.md", 7, "gone"),
  new Finding("A_VERY_LONG_FINDING_CODE_NAME", "odd", "p", 1, "unknown level"),
];

// ------------------------------------------------------------------------------------------------------------- io

test("agent-works common: ioOf fills what the caller left out from the process", () => {
  const io = ioOf();
  assert.equal(io.cwd, process.cwd());
  assert.equal(io.env, process.env);
  assert.equal(io.stdout, process.stdout);
  assert.equal(io.stderr, process.stderr);
  const given = ioOf({ cwd: "elsewhere", env: { A: "1" }, command: "note" });
  assert.deepEqual([given.cwd, given.env, given.command, given.stderr === process.stderr], ["elsewhere", { A: "1" }, "note", true]);
});

test("agent-works common: bufferedIo keeps what is printed and gives it back", () => {
  const io = bufferedIo({ cwd: "x" });
  io.stdout.write("one\n");
  io.stdout.write("two\n");
  io.stderr.write("oops\n");
  assert.deepEqual([io.out(), io.err(), io.cwd, io.env === process.env], ["one\ntwo\n", "oops\n", "x", true]);
});

test("agent-works common: emit prints one JSON document, else the text, else a string as it is", () => {
  const printed = (...args) => {
    const io = bufferedIo();
    emit(io, ...args);
    return io.out();
  };
  const doc = { a: `é — ${char(0x2028)} ${char(0x7f)}`, b: [], c: {}, d: [1, { e: null }], f: true, g: `tab\t"q" ${char(0x5c)} ${char(1)}` };
  const text = `{\n  "a": "${esc("00e9")} ${esc("2014")} ${esc("2028")} ${esc("007f")}",\n  "b": [],\n  "c": {},\n  "d": [\n    1,\n    {\n      "e": null\n    }\n  ],\n`
    + `  "f": true,\n  "g": "tab${char(0x5c)}t${char(0x5c)}"q${char(0x5c)}" ${char(0x5c)}${char(0x5c)} ${esc("0001")}"\n}`;
  assert.equal(jsonText(doc), text);
  assert.deepEqual(JSON.parse(jsonText(doc)), doc);
  assert.equal(printed(doc, true), `${text}\n`);
  assert.equal(printed(doc), `${text}\n`);
  assert.equal(printed("text", true), '"text"\n');
  assert.equal(printed("text"), "text\n");
  assert.equal(printed(3), "3\n");
  assert.equal(printed(null), "null\n");
  assert.equal(printed([], true), "[]\n");
  assert.equal(printed({ a: 1 }, false, "shown"), "shown\n");
  assert.equal(jsonText(`${char(0xd83d)}${char(0xde00)}`), `"${esc("d83d")}${esc("de00")}"`);
});

test("agent-works common: fail prints to stderr and gives back the exit code", () => {
  const io = bufferedIo();
  assert.equal(fail(io, "aw x: no"), 2);
  assert.equal(fail(io, "later", 1), 1);
  assert.deepEqual([io.err(), io.out()], ["aw x: no\nlater\n", ""]);
});

test("agent-works common: readStdin takes the text a caller put on the io", () => {
  assert.equal(readStdin({ stdin: "piped\n" }), "piped\n");
  assert.equal(readStdin({ stdin: "" }), "");
});

test("agent-works common: nowIso is UTC to the second and today is the local date", () => {
  assert.match(nowIso(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.ok(Math.abs(Date.parse(nowIso()) - Date.now()) < 5000);
  const d = new Date();
  const local = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  assert.match(today(), /^\d{4}-\d\d-\d\d$/);
  // A run across midnight may see the next day.
  assert.ok([local, new Date(Date.now() + 5000).toLocaleDateString("sv")].includes(today()));
});

// ---------------------------------------------------------------------------------------------------------- files

test("agent-works common: atomicWrite makes the folder, writes LF as given and leaves no temp file", (t) => {
  const dir = tempDir(t, "aw-common-");
  const file = path.join(dir, "deep", "er", "x.json");
  atomicWrite(file, "one\ntwo\n");
  assert.deepEqual([...fs.readFileSync(file)], [...Buffer.from("one\ntwo\n")]);
  atomicWrite(file, "three\r\n");
  assert.equal(fs.readFileSync(file, "utf8"), "three\r\n");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["x.json"]);
});

test("agent-works common: writeJson writes two-space ASCII JSON with a final newline", (t) => {
  const file = path.join(tempDir(t, "aw-common-"), "w", "x.json");
  writeJson(file, { name: "café", list: [1, 2], empty: {} });
  assert.equal(fs.readFileSync(file, "utf8"), `{\n  "name": "caf${esc("00e9")}",\n  "list": [\n    1,\n    2\n  ],\n  "empty": {}\n}\n`);
  assert.deepEqual(readJson(file), { name: "café", list: [1, 2], empty: {} });
});

test("agent-works common: exclusiveCreate creates once and says who won", (t) => {
  const lock = path.join(tempDir(t, "aw-common-"), "locks", "a.lock");
  assert.equal(exclusiveCreate(lock, "me"), true);
  assert.equal(exclusiveCreate(lock, "you"), false);
  assert.equal(readText(lock), "me");
  const empty = path.join(path.dirname(lock), "b.lock");
  assert.equal(exclusiveCreate(empty), true);
  assert.equal(fs.readFileSync(empty, "utf8"), "");
});

test("agent-works common: readText drops a byte order mark and gives LF; readRaw gives the file as it is", (t) => {
  const dir = tempDir(t, "aw-common-");
  const bom = write(dir, "bom.json", `${BOM}{"a": 1}`);
  const crlf = write(dir, "crlf.txt", "a\r\nb\rc\n");
  const bad = write(dir, "bad.bin", Buffer.from([0xff, 0xfe, 0x20, 0x6f, 0x6b]));
  assert.equal(readText(bom), '{"a": 1}');
  assert.equal(readText(crlf), "a\nb\nc\n");
  assert.equal(readRaw(crlf), "a\r\nb\rc\n");
  assert.equal(readRaw(bom), `${BOM}{"a": 1}`);
  assert.equal(readText(bad), null);
  assert.equal(readText(bad, "fallback"), "fallback");
  assert.equal(readRaw(bad), null);
  assert.equal(readText(path.join(dir, "none")), null);
  assert.equal(readText(null, "none"), "none");
  assert.equal(readText(0, "not a file descriptor"), "not a file descriptor");
  assert.equal(readRaw(undefined), null);
  assert.equal(readText(dir, "a folder"), "a folder");
});

test("agent-works common: readJson gives the fallback for a missing file and for one that is not JSON", (t) => {
  const dir = tempDir(t, "aw-common-");
  assert.deepEqual(readJson(path.join(dir, "none.json"), { d: 1 }), { d: 1 });
  assert.equal(readJson(path.join(dir, "none.json")), null);
  assert.deepEqual(readJson(write(dir, "bad.json", "{"), []), []);
  assert.deepEqual(readJson(write(dir, "bom.json", `${BOM}{"a": 1}`)), { a: 1 });
});

test("agent-works common: posix and rel speak forward slashes", (t) => {
  const { tmp, root } = project(t);
  assert.equal(posix("a\\b\\c.md"), "a/b/c.md");
  assert.equal(rel(path.join(root, "a", "b.md"), root), "a/b.md");
  assert.equal(rel(path.join(root, "not", "there", "yet.md"), root), "not/there/yet.md");
  assert.equal(rel(root, root), ".");
  assert.equal(rel(tmp, root), posix(tmp));
  assert.equal(rel(path.join(tmp, "acme-other", "x"), root), posix(path.join(tmp, "acme-other", "x")));
  assert.equal(rel(path.join(root, "..name"), root), "..name");
});

test("agent-works common: realPath resolves what exists and keeps the rest", (t) => {
  const dir = tempDir(t, "aw-common-");
  assert.equal(realPath(dir), real(dir));
  assert.equal(realPath(path.join(dir, "no", "such", "file.md")), path.join(real(dir), "no", "such", "file.md"));
  assert.equal(realPath("."), real(process.cwd()));
});

test("agent-works common: a link on the way is resolved", { skip: process.platform === "win32" && "making a link needs a privilege there" }, (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  write(dir, "real/a.md", "x");
  fs.symlinkSync(path.join(dir, "real"), path.join(dir, "link"));
  assert.equal(realPath(path.join(dir, "link", "a.md")), path.join(dir, "real", "a.md"));
  assert.equal(rel(path.join(dir, "link", "a.md"), path.join(dir, "real")), "a.md");
});

test("agent-works common: splitLines ends a line where a text file does", () => {
  const cases = [
    ["", [], []],
    ["a", ["a"], ["a"]],
    ["a\n", ["a"], ["a\n"]],
    ["a\n\nb\n", ["a", "", "b"], ["a\n", "\n", "b\n"]],
    ["\n", [""], ["\n"]],
    ["a\r\nb\r\n", ["a", "b"], ["a\r\n", "b\r\n"]],
    ["a\rb", ["a", "b"], ["a\r", "b"]],
    ["x\vy\fz", ["x", "y", "z"], ["x\v", "y\f", "z"]],
    [`a${char(0x2028)}b${char(0x85)}c${char(0x1c)}d`, ["a", "b", "c", "d"], [`a${char(0x2028)}`, `b${char(0x85)}`, `c${char(0x1c)}`, "d"]],
  ];
  for (const [text, plain, kept] of cases) {
    assert.deepEqual(splitLines(text), plain, JSON.stringify(text));
    assert.deepEqual(splitLines(text, true), kept, JSON.stringify(text));
  }
});

// ---------------------------------------------------------------------------------------------------------- roots

test("agent-works common: startDir and ancestors walk from a folder, or from a file's folder, to the top", (t) => {
  const { root } = project(t);
  const file = write(root, "a/b/c.md", "x");
  assert.equal(startDir(file), path.join(root, "a", "b"));
  assert.equal(startDir(path.join(root, "a")), path.join(root, "a"));
  assert.equal(startDir(path.join(root, "not", "there")), path.join(root, "not", "there"));
  assert.equal(startDir(), real(process.cwd()));
  const up = [...ancestors(path.join(root, "a", "b"))];
  assert.deepEqual(up.slice(0, 3), [path.join(root, "a", "b"), path.join(root, "a"), root]);
  assert.equal(up.at(-1), path.parse(root).root);
});

test("agent-works common: repoRoot, gitDir and currentBranch read the repository from its files", (t) => {
  const { tmp, root } = project(t);
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(repoRoot(sub), root);
  assert.equal(repoRoot(write(root, "a/file.md", "x")), root);
  assert.equal(repoRoot(tmp), null);
  assert.equal(gitDir(root), path.join(root, ".git"));
  assert.equal(gitDir(tmp), null);
  assert.equal(mainRoot(sub), root);
  assert.equal(mainRoot(tmp), null);
  assert.equal(currentBranch(sub), "feat/x");
  assert.equal(currentBranch(tmp), null);
  write(root, ".git/HEAD", "0123456789abcdef\n");
  assert.equal(currentBranch(root), null);
});

test("agent-works common: a linked work tree resolves to the main checkout", (t) => {
  const { tmp, root } = project(t);
  const tree = linkedTree(tmp, root);
  const src = path.join(tree, "src");
  assert.equal(repoRoot(src), tree);
  assert.equal(gitDir(tree), path.join(root, ".git", "worktrees", "wt"));
  assert.equal(mainRoot(src), root);
  assert.equal(mainRoot(root), root);
  assert.equal(currentBranch(tree), "topic");
  assert.equal(currentBranch(root), "feat/x");
  assert.equal(projectRoot(src), tree);
  assert.equal(projectId(tree), projectId(root));
  assert.match(projectId(tree), /^acme-[0-9a-f]{8}$/);
  assert.equal(projectName(src), "acme");
  assert.equal(projectName(root), "acme");
});

test("agent-works common: a `.git` file that names no common directory is its own repository", (t) => {
  const { tmp, root } = project(t);
  const module = path.join(root, "vendor", "lib");
  write(root, ".git/modules/lib/HEAD", "ref: refs/heads/main\n");
  write(module, ".git", "gitdir: ../../.git/modules/lib\n");
  assert.equal(gitDir(module), path.join(root, ".git", "modules", "lib"));
  assert.equal(mainRoot(module), module);
  assert.equal(currentBranch(module), "main");
  write(tmp, "odd/.git", "not a pointer\n");
  assert.equal(gitDir(path.join(tmp, "odd")), null);
  assert.equal(mainRoot(path.join(tmp, "odd")), path.join(tmp, "odd"));
});

test("agent-works common: projectId is the folder's name and eight hex digits of its path's sha1", (t) => {
  const { tmp, root } = project(t);
  const key = (dir) => (process.platform === "win32" ? dir.toLowerCase() : dir).replace(/\\/g, "/");
  const id = (dir, name) => `${name}-${createHash("sha1").update(key(dir)).digest("hex").slice(0, 8)}`;
  assert.equal(projectId(root), id(root, "acme"));
  assert.equal(projectId(path.join(root, "a", "deep", "folder")), id(root, "acme"));
  const odd = path.join(tmp, "My Project (v2)!");
  fs.mkdirSync(odd);
  assert.equal(projectId(odd), id(odd, "My-Project-v2"));
  assert.equal(projectName(odd), "My Project (v2)!");
  assert.equal(projectRoot(path.join(odd, "x", "y")), path.join(odd, "x", "y"));
  assert.equal(projectHome(root, { AW_HOME: path.join(tmp, "home") }), path.join(tmp, "home", "projects", id(root, "acme")));
});

test("agent-works common: the top of the file system is the project `project`", { skip: process.platform === "win32" && "a drive's top keeps its letter in the key" }, () => {
  assert.equal(projectId("/"), "project-da39a3ee");
});

test("agent-works common: projectRoot and projectName follow the config", (t) => {
  const { root } = project(t);
  const sub = path.join(root, "a", "b");
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(projectRoot(sub), root);
  write(root, ".agents/agent-works.json", JSON.stringify({ name: "  Acme Works  " }));
  assert.equal(projectName(sub), "Acme Works");
  assert.equal(projectName(sub, { name: "" }), "acme");
  assert.equal(projectName(sub, { name: 7 }), "acme");
  // A project kept below the top of a repository keeps its own folder's name.
  write(root, "a/.agents/agent-works.json", "{}");
  assert.equal(projectRoot(sub), path.join(root, "a"));
  assert.equal(projectName(sub), "a");
  assert.equal(projectId(sub), projectId(root));
});

test("agent-works common: git gives the exit code and stdout, and 127 when git cannot run", (t) => {
  const { dir } = tempRepo(t, "aw-common-");
  const [code, out] = git(["rev-parse", "--is-inside-work-tree"], dir);
  assert.deepEqual([code, out.trim()], [0, "true"]);
  assert.notEqual(git(["no-such-git-command"], dir)[0], 0);
  assert.deepEqual(git(["--version"], dir, { env: { PATH: path.join(dir, "empty"), Path: path.join(dir, "empty") } }), [127, ""]);
  assert.deepEqual(git(["--version"], path.join(dir, "no", "such", "folder")), [127, ""]);
});

test("agent-works common: awHome is AW_HOME, else the earlier variable, else ~/.agent-works", () => {
  const home = { HOME: path.join("h", "me"), USERPROFILE: path.join("h", "me") };
  assert.equal(awHome(home), path.join("h", "me", ".agent-works"));
  assert.equal(awHome({ ...home, AGENT_WORKS_HOME: path.join("some", "where") }), path.join("some", "where"));
  assert.equal(awHome({ ...home, AW_HOME: path.join("first", "x"), AGENT_WORKS_HOME: path.join("second", "y") }), path.join("first", "x"));
  assert.equal(awHome({ ...home, AW_HOME: "", AGENT_WORKS_HOME: "" }), path.join("h", "me", ".agent-works"));
  assert.equal(awHome({ ...home, AW_HOME: "~/store" }), path.join("h", "me", "store"));
  assert.equal(awHome({ ...home, AW_HOME: "~" }), path.join("h", "me"));
  assert.equal(awHome({ AW_HOME: "~x" }), "~x");
  assert.equal(awHome({}), path.join(os.homedir(), ".agent-works"));
});

test("agent-works common: agentName reads the configured variable, its aliases, then the host's", async () => {
  const { defaults } = await import(pathToFileURL(path.join(PLUGIN, "lib", "config.mjs")).href);
  const cfg = defaults();
  const env = {};
  assert.equal(agentName(cfg, env), null);
  env.CLAUDE_AGENT_NAME = "c";
  assert.equal(agentName(cfg, env), "c");
  env.PL_AGENT = " p ";
  assert.equal(agentName(cfg, env), "p");
  env.AW_AGENT = "a";
  assert.equal(agentName(cfg, env), "a");
  cfg.guard.agentVar = "ACME_AGENT";
  assert.equal(agentName(cfg, env), "p");
  env.ACME_AGENT = "x";
  assert.equal(agentName(cfg, env), "x");
  assert.equal(agentName({}, { AW_AGENT: "  ", CLAUDE_AGENT_NAME: "host" }), "host");
  assert.equal(agentName({ guard: null }, { AW_AGENT: "plain" }), "plain");
});

// ------------------------------------------------------------------------------------------------------- findings

test("agent-works common: a finding prints as one aligned line", () => {
  assert.deepEqual(FINDINGS().map((f) => f.text()), [
    "WARNING  B_WARN                 b.md:3 — w",
    "CRITICAL A_CRIT                 a.md — c",
    "INFO     C_INFO                 i",
    "WARNING  HUB_MISSING            src/deep — no AGENTS.md here",
    "WARNING  HUB_MISSING            src/a:12 — second",
    "WARNING  HUB_MISSING            src/a:2 — first",
    "INFO     MEM_FILE_SIZE          ./.agents/memory/x.md — long — très long",
    "CRITICAL LINK_BROKEN            docs/a.md:7 — gone",
    "ODD      A_VERY_LONG_FINDING_CODE_NAME p:1 — unknown level",
  ]);
  assert.deepEqual({ ...new Finding("X", "info") }, { code: "X", level: "info", path: "", line: 0, message: "" });
  assert.equal(JSON.stringify(new Finding("X", "info", "p", 2, "m")), '{"code":"X","level":"info","path":"p","line":2,"message":"m"}');
});

test("agent-works common: exit codes and the one JSON shape of a finding list", () => {
  const fs_ = FINDINGS();
  assert.deepEqual(LEVELS, ["critical", "warning", "info"]);
  assert.equal(exitFor([]), 0);
  assert.equal(exitFor(fs_.slice(2, 3)), 0);
  assert.equal(exitFor(fs_.slice(0, 1)), 1);
  assert.equal(exitFor(fs_), 2);
  assert.equal(exitFor(new Set(fs_.slice(0, 1))), 1);
  const doc = findingsDoc(fs_.slice(0, 3), { root: "x" });
  assert.deepEqual(Object.keys(doc), ["root", "summary", "findings"]);
  assert.deepEqual(doc.summary, { critical: 1, warning: 1, info: 1 });
  assert.deepEqual(doc.findings.map((f) => f.code), ["A_CRIT", "B_WARN", "C_INFO"]);
  assert.deepEqual(doc.findings[1], { code: "B_WARN", level: "warning", path: "b.md", line: 3, message: "w" });
  assert.deepEqual(Object.keys(doc.findings[1]), ["code", "level", "path", "line", "message"]);
  // A key of the check's own named `summary` keeps its place and loses its value.
  assert.deepEqual(Object.keys(findingsDoc([], { summary: "mine", root: "x" })), ["summary", "root", "findings"]);
  assert.deepEqual(findingsDoc([]), { summary: { critical: 0, warning: 0, info: 0 }, findings: [] });
});

test("agent-works common: sortFindings puts the gravest first, then code, path and line, and leaves its input alone", () => {
  const fs_ = FINDINGS();
  const sorted = sortFindings(fs_);
  assert.deepEqual(sorted.map((f) => `${f.code} ${f.path}:${f.line}`), [
    "A_CRIT a.md:0", "LINK_BROKEN docs/a.md:7", "B_WARN b.md:3", "HUB_MISSING src/a:2", "HUB_MISSING src/a:12", "HUB_MISSING src/deep:0",
    "C_INFO :0", "MEM_FILE_SIZE ./.agents/memory/x.md:0", "A_VERY_LONG_FINDING_CODE_NAME p:1",
  ]);
  assert.equal(fs_[0].code, "B_WARN");
});

test("agent-works common: the finding codes are a sorted list without repeats, and two are never accepted", () => {
  assert.equal(CODES.length, 60);
  assert.deepEqual([...CODES], [...new Set(CODES)].sort());
  for (const code of ["HUB_MISSING", "HUB_SIZE", "KANBAN_STALE_START", "KANBAN_REVIEW_UNLINKED", "KANBAN_GRANT_ORPHAN", "GATE_OWED_OLD", "TASKS_TWO_HOMES", "ROOT_PLUGINS"]) assert.ok(CODES.includes(code), code);
  assert.deepEqual([...NEVER_ACCEPTED], ["CONFIG_INVALID", "ACCEPT_UNUSED"]);
  for (const code of NEVER_ACCEPTED) assert.ok(CODES.includes(code));
});

test("agent-works common: acceptEntries keeps the entries that hold and says what is wrong with the others", () => {
  assert.deepEqual(acceptEntries({}), [[], []]);
  assert.deepEqual(acceptEntries({ accept: null }), [[], []]);
  assert.deepEqual(acceptEntries({ accept: [] }), [[], []]);
  assert.deepEqual(acceptEntries({ accept: "nope" }), [[], ['"accept" must be a list']]);
  const [good, bad] = acceptEntries({ accept: [
    { code: "MEM_FILE_SIZE", path: "./.agents/memory/x.md/", why: " ok " },
    7, "s", [1, "two"], null, true,
    { code: "NOPE", path: "a", why: "b" },
    { code: 5, path: "a", why: "b" },
    { code: "CONFIG_INVALID", path: "a", why: "b" },
    { code: "ACCEPT_UNUSED", path: "a", why: "b" },
    { code: "DUP_RULE", path: " ", why: "b" },
    { code: "DUP_RULE", path: 3, why: "b" },
    { code: "DUP_RULE", path: "a", why: "" },
    { code: "DUP_RULE", path: "a" },
    { code: { k: [1, "é"] }, path: "a", why: "b" },
    { path: "a", why: "b" },
    { code: "DUP_RULE", path: "a\\b\\", why: "back slashes" },
  ] });
  assert.deepEqual(good, [
    { index: 0, code: "MEM_FILE_SIZE", path: ".agents/memory/x.md", why: "ok" },
    { index: 16, code: "DUP_RULE", path: "a/b", why: "back slashes" },
  ]);
  const entry = 'an entry is {"code": …, "path": …, "why": …}, not';
  const notCode = "is not a finding code (aw doctor --json lists the codes it found)";
  assert.deepEqual(bad, [
    `accept[1]: ${entry} 7`,
    `accept[2]: ${entry} "s"`,
    `accept[3]: ${entry} [1, "two"]`,
    `accept[4]: ${entry} null`,
    `accept[5]: ${entry} true`,
    `accept[6]: "code" "NOPE" ${notCode}`,
    `accept[7]: "code" 5 ${notCode}`,
    "accept[8]: CONFIG_INVALID is never accepted",
    "accept[9]: ACCEPT_UNUSED is never accepted",
    'accept[10]: "path" is the finding\'s path, or a glob over paths, as a non-empty string',
    'accept[11]: "path" is the finding\'s path, or a glob over paths, as a non-empty string',
    'accept[12]: "why" is required: the reason this finding stays, in a sentence',
    'accept[13]: "why" is required: the reason this finding stays, in a sentence',
    `accept[14]: "code" {"k": [1, "${esc("00e9")}"]} ${notCode}`,
    `accept[15]: "code" null ${notCode}`,
  ]);
});

test("agent-works common: splitAccepted takes out what the project accepted, never a critical finding", () => {
  const cfg = { accept: [
    { code: "HUB_MISSING", path: "src/*", why: " all of src " },
    { code: "LINK_BROKEN", path: "docs/a.md", why: "x" },
    { code: "DUP_RULE", path: "never", why: "unused" },
    { code: "MEM_FILE_SIZE", path: ".agents/memory/x.md", why: "the path is compared without its ./" },
  ] };
  const [kept, accepted, entries] = splitAccepted(FINDINGS(), cfg);
  assert.deepEqual(kept.map((f) => f.code), ["B_WARN", "A_CRIT", "C_INFO", "LINK_BROKEN", "A_VERY_LONG_FINDING_CODE_NAME"]);
  assert.ok(kept[0] instanceof Finding);
  assert.deepEqual(accepted, [
    { code: "HUB_MISSING", level: "warning", path: "src/deep", line: 0, message: "no AGENTS.md here", why: "all of src" },
    { code: "HUB_MISSING", level: "warning", path: "src/a", line: 12, message: "second", why: "all of src" },
    { code: "HUB_MISSING", level: "warning", path: "src/a", line: 2, message: "first", why: "all of src" },
    { code: "MEM_FILE_SIZE", level: "info", path: "./.agents/memory/x.md", line: 0, message: "long — très long", why: "the path is compared without its ./" },
  ]);
  assert.deepEqual(entries.map((e) => [e.index, e.code, e.used, e.critical]), [
    [0, "HUB_MISSING", true, false], [1, "LINK_BROKEN", false, true], [2, "DUP_RULE", false, false], [3, "MEM_FILE_SIZE", true, false],
  ]);
  assert.deepEqual(splitAccepted(FINDINGS(), null)[0].length, 9);
  assert.deepEqual(splitAccepted(FINDINGS(), { accept: [{ code: "HUB_MISSING", path: "src/[ad]*", why: "set" }] })[1].length, 3);
  assert.equal(acceptedLine(accepted), "4 accepted (aw doctor --accepted lists them)");
});

test("agent-works common: report prints the findings, the accepted count and a summary, and gives the exit code", () => {
  const run = (findings, options) => {
    const io = bufferedIo();
    return [report(io, findings, options), io.out(), io.err()];
  };
  assert.deepEqual(run(FINDINGS(), { title: "aw hubs", cfg: {} }), [2, [
    "CRITICAL A_CRIT                 a.md — c",
    "CRITICAL LINK_BROKEN            docs/a.md:7 — gone",
    "WARNING  B_WARN                 b.md:3 — w",
    "WARNING  HUB_MISSING            src/a:2 — first",
    "WARNING  HUB_MISSING            src/a:12 — second",
    "WARNING  HUB_MISSING            src/deep — no AGENTS.md here",
    "INFO     C_INFO                 i",
    "INFO     MEM_FILE_SIZE          ./.agents/memory/x.md — long — très long",
    "ODD      A_VERY_LONG_FINDING_CODE_NAME p:1 — unknown level",
    "aw hubs: 2 critical, 4 warning, 2 info",
    "",
  ].join("\n"), ""]);
  const cfg = { accept: [{ code: "HUB_MISSING", path: "src/*", why: "all of src" }, { code: "LINK_BROKEN", path: "docs/a.md", why: "x" }] };
  assert.deepEqual(run(FINDINGS(), { title: "aw hubs", cfg }), [2, [
    "CRITICAL A_CRIT                 a.md — c",
    "CRITICAL LINK_BROKEN            docs/a.md:7 — gone",
    "WARNING  B_WARN                 b.md:3 — w",
    "INFO     C_INFO                 i",
    "INFO     MEM_FILE_SIZE          ./.agents/memory/x.md — long — très long",
    "ODD      A_VERY_LONG_FINDING_CODE_NAME p:1 — unknown level",
    "3 accepted (aw doctor --accepted lists them)",
    "aw hubs: 2 critical, 1 warning, 2 info",
    "",
  ].join("\n"), ""]);
  assert.deepEqual(run(FINDINGS().slice(2, 3), { cfg: {} }), [0, "INFO     C_INFO                 i\n1 info\n", ""]);
  assert.deepEqual(run([], { title: "t", cfg: {} }), [0, "t: clean\n", ""]);
  assert.deepEqual(run([new Finding("HUB_MISSING", "warning", "src/x", 0, "m")], { cfg }), [0, "1 accepted (aw doctor --accepted lists them)\nclean\n", ""]);
});

test("agent-works common: report --json is one document, with `accepted` only when something was", () => {
  const run = (findings, options) => {
    const io = bufferedIo();
    const code = report(io, findings, { json: true, ...options });
    return [code, io.out()];
  };
  const [code, out] = run(FINDINGS().slice(0, 4), { extra: { root: "r" }, cfg: { accept: [{ code: "HUB_MISSING", path: "src/deep", why: "generated" }] } });
  assert.equal(code, 2);
  assert.equal(out, `{
  "root": "r",
  "accepted": [
    {
      "code": "HUB_MISSING",
      "level": "warning",
      "path": "src/deep",
      "line": 0,
      "message": "no AGENTS.md here",
      "why": "generated"
    }
  ],
  "summary": {
    "critical": 1,
    "warning": 1,
    "info": 1
  },
  "findings": [
    {
      "code": "A_CRIT",
      "level": "critical",
      "path": "a.md",
      "line": 0,
      "message": "c"
    },
    {
      "code": "B_WARN",
      "level": "warning",
      "path": "b.md",
      "line": 3,
      "message": "w"
    },
    {
      "code": "C_INFO",
      "level": "info",
      "path": "",
      "line": 0,
      "message": "i"
    }
  ]
}
`);
  assert.deepEqual(run([], { cfg: {} }), [0, '{\n  "summary": {\n    "critical": 0,\n    "warning": 0,\n    "info": 0\n  },\n  "findings": []\n}\n']);
  const dashed = run([new Finding("DUP_RULE", "info", "a.md", 0, "long — très long")], { cfg: {} })[1];
  assert.ok(dashed.includes(`"message": "long ${esc("2014")} tr${esc("00e8")}s long"`), dashed);
});

test("agent-works common: report without a config reads the one of the io's folder", (t) => {
  const { root } = project(t);
  write(root, ".agents/agent-works.json", JSON.stringify({ accept: [{ code: "HUB_MISSING", path: "src/*", why: "generated" }] }));
  const io = bufferedIo({ cwd: path.join(root, ".agents") });
  assert.equal(report(io, [new Finding("HUB_MISSING", "warning", "src/x", 0, "m")]), 0);
  assert.equal(io.out(), "1 accepted (aw doctor --accepted lists them)\nclean\n");
});

test("agent-works common: fnmatch is a whole-name shell pattern in which * crosses a slash", () => {
  const yes = [
    ["a/b/c.md", "a/*.md"], ["a/b/c.md", "a/*/c.md"], ["abc", "a?c"], ["a/c", "a?c"], ["abc", "a[bx]c"], ["a]c", "a[]]c"], ["abc", "a[a-c]c"],
    ["a.c", "a.c"], ["a[c", "a[c"], ["a+c", "a+c"], ["a\nb", "a*b"], ["a^c", "a[^b]c"], ["abc", "a[^b]c"], ["", "*"], ["", ""], ["src/a", "src/[ad]*"],
    ["a\\c", "a[\\\\]c"], ["(a)", "(a)"], ["a{1}", "a{1}"], ["a|b", "a|b"], ["ab", "a**b"], ["a$", "a$"], ["a b", "a b"], ["é", "?"], ["a&c", "a[&]c"],
    ["-", "[a-]"], ["-", "[-a]"], ["b", "[a-c-e]"], ["[", "[[]"],
  ];
  const no = [
    ["axc", "a[!bx]c"], ["abc", "a[!bx]c"], ["a-c", "a[a-c]c"], ["abc", "a.c"], ["A", "a"], ["x", "[]"], ["x", "[!]"], ["a", ""],
    ["b", "[z-a]"], ["d", "[a-c-e]"], ["a", "[!]a]"], ["]", "[!]a]"], ["ab", "a"], ["ba", "a"],
  ];
  for (const [name, pattern] of yes) assert.equal(fnmatch(name, pattern), true, `${JSON.stringify(name)} ~ ${pattern}`);
  for (const [name, pattern] of no) assert.equal(fnmatch(name, pattern), false, `${JSON.stringify(name)} !~ ${pattern}`);
  assert.equal(fnmatch("ayc", "a[!bx]c"), true);
});

// ---------------------------------------------------------------------------------------------------- frontmatter

test("agent-works common: parseFrontmatter reads the subset the agent files use", () => {
  const text = '---\nname: a-b\ndescription: "One: two"\ntags: [machine, tooling]\nlabels:\n  - x\n  - y\nremote:\n  id: 7\nempty:\n---\n\n# T\n';
  assert.deepEqual(parseFrontmatter(text), [
    { name: "a-b", description: "One: two", tags: ["machine", "tooling"], labels: ["x", "y"], remote: { id: "7" }, empty: "" },
    "\n# T\n",
  ]);
  assert.deepEqual(parseFrontmatter("# no front\n"), [null, "# no front\n"]);
  assert.deepEqual(parseFrontmatter("---\r\na: 1\r\n---\r\nx"), [{ a: "1" }, "x"]);
  assert.deepEqual(parseFrontmatter("---\na: 1\n---"), [{ a: "1" }, ""]);
  assert.deepEqual(parseFrontmatter("---\n---\nbody"), [null, "---\n---\nbody"]);
  assert.deepEqual(parseFrontmatter("---\n\n---\nbody"), [{}, "body"]);
  assert.deepEqual(parseFrontmatter(" ---\na: 1\n---\n"), [null, " ---\na: 1\n---\n"]);
  assert.deepEqual(parseFrontmatter("---\na: 1\n--- trailing\nb: 2\n---\nend"), [{ a: "1", b: "2" }, "end"]);
});

test("agent-works common: parseFrontmatter on the odd lines", () => {
  const odd = "--- \t\n# comment\n  indented: before any key\nkey: 'single'\nlist: []\nother: [ a,b,  'c d' , \"e\"]\nurl: http://x.y/z\nnocolon\n"
    + "\tnested: [1, 2]\n\t- item one\n  -notanitem\n  plain text\nk2:   spaced value  \nk2b: \"unbalanced\n---  \nrest\n";
  assert.deepEqual(parseFrontmatter(odd), [
    { indented: "before any key", key: "single", list: [], other: ["a", "b", "c d", "e"], url: ["item one"], k2: "spaced value", k2b: '"unbalanced' },
    "rest\n",
  ]);
  assert.deepEqual(parseFrontmatter("---\nlabels:\n- x\n- y: z\nq: \"\"\nr: '\ns: [,]\n---\n"), [{ labels: "", "- y": "z", q: "", r: "'", s: ["", ""] }, ""]);
  assert.deepEqual(parseFrontmatter("---\nname: x\n  sub: 1\n  - a\n  sub2: 2\n---\n"), [{ name: { sub2: "2" } }, ""]);
  assert.deepEqual(parseFrontmatter("---\na:1\nb : 2\n: empty key\n---\n"), [{ a: "1", b: "2", "": "empty key" }, ""]);
});

// ------------------------------------------------------------------------------------------------------ templates

const ROWS = `<!-- agent-works:plugins — written by a command -->
## Agent plugins

| Plugin | What it is for |
|---|---|
| **agent-works** | the board |
| **codebase-optimizer** | the shape of the code |
| **perceptual-loop** | work judged by eye |
| **docs-parity** | the docs |

Not installed: say so once.
<!-- /agent-works:plugins -->
`;

test("agent-works common: template fills the places it is given and leaves the others visible", async (t) => {
  const { dir, lib } = await pluginCopy(t, {
    "assets/templates/decision.md": "# {{number}}. {{title}}\r\n\r\n{{status}} since {{number}}\r\n",
    ".claude-plugin/plugin.json": '{ "name": "agent-works", "version": "9.8.7" }',
  });
  assert.equal(lib.PLUGIN_ROOT, dir);
  assert.equal(lib.TEMPLATES, path.join(dir, "assets", "templates"));
  assert.equal(lib.template("decision.md", { number: "0007", title: "Use $& and {{status}}" }), "# 0007. Use $& and {{status}}\n\n{{status}} since 0007\n");
  assert.equal(lib.template("decision.md", { number: 7, title: "T", status: "accepted" }), "# 7. T\n\naccepted since 7\n");
  assert.equal(lib.template("decision.md"), "# {{number}}. {{title}}\n\n{{status}} since {{number}}\n");
  assert.throws(() => lib.template("no-such-template.md"), (e) => e instanceof lib.AwError && e.exitCode === 2
    && e.message === "the plugin's template assets/templates/no-such-template.md is missing: the installation is incomplete");
  assert.equal(lib.pluginVersion(), "9.8.7");
});

test("agent-works common: pluginVersion is 0.0.0 when the manifest cannot say", async (t) => {
  assert.equal((await pluginCopy(t)).lib.pluginVersion(), "0.0.0");
  assert.equal((await pluginCopy(t, { ".claude-plugin/plugin.json": "[1]" })).lib.pluginVersion(), "0.0.0");
  assert.equal((await pluginCopy(t, { ".claude-plugin/plugin.json": '{"version": ""}' })).lib.pluginVersion(), "0.0.0");
  assert.equal(common.pluginVersion(), JSON.parse(fs.readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")).version);
});

test("agent-works common: pluginsBlock keeps the rows of the plugins the config names", async (t) => {
  const { lib } = await pluginCopy(t, { "assets/templates/agents-plugins.md": ROWS });
  const rows = (text) => [...text.matchAll(/^\| \*\*([^*]+)\*\*/gm)].map((m) => m[1]);
  for (const cfg of [null, {}, { plugins: null }]) assert.deepEqual(rows(lib.pluginsBlock(cfg)), ["agent-works", "codebase-optimizer", "perceptual-loop"]);
  assert.equal(lib.pluginsBlock({ plugins: [] }), "");
  assert.equal(lib.pluginsBlock({ plugins: "agent-works" }), "");
  assert.deepEqual(rows(lib.pluginsBlock({ plugins: ["docs-parity", "perceptual-loop", "nope"] })), ["perceptual-loop", "docs-parity"]);
  assert.equal(lib.pluginsBlock({ plugins: ["agent-works"] }), ROWS.split("\n").filter((line) => !/^\| \*\*(?!agent-works)/.test(line)).join("\n"));
  assert.deepEqual(rows(lib.pluginsBlock({ plugins: [1] })), []);
  assert.match(lib.pluginsBlock({ plugins: [1] }), PLUGINS_BLOCK);
  await assert.rejects(async () => (await pluginCopy(t)).lib.pluginsBlock({}), /agents-plugins\.md is missing/);
});

test("agent-works common: the plugin's own plugins template is one block the config can thin", () => {
  const block = common.pluginsBlock({ plugins: ["agent-works"] });
  assert.equal(block.match(PLUGINS_BLOCK)?.[0], block);
  assert.deepEqual([...block.matchAll(/^\| \*\*([^*]+)\*\*/gm)].map((m) => m[1]), ["agent-works"]);
});

test("agent-works common: withPluginsBlock puts the block in, or brings it up to date, and touches nothing else", () => {
  const block = "<!-- agent-works:plugins x -->\nB\n<!-- /agent-works:plugins -->\n";
  assert.equal(withPluginsBlock("# P\n\nwhat\n\n## One\n\na\n\n## Two\n\nb\n", block), `# P\n\nwhat\n\n## One\n\na\n\n${block}\n## Two\n\nb\n`);
  assert.equal(withPluginsBlock("# P\n\n## One\n\na\n", block), `# P\n\n## One\n\na\n\n${block}`);
  assert.equal(withPluginsBlock("# P", block), `# P\n\n${block}`);
  assert.equal(withPluginsBlock("", "BLOCK\n"), "\n\nBLOCK\n");
  assert.equal(withPluginsBlock("# P\r\n\r\n## One\r\n\r\n## Two\r\n", ""), "# P\n\n## One\n\n## Two\n");
  const old = "<!-- agent-works:plugins old -->\nold $1 $&\n<!-- /agent-works:plugins -->\n";
  const second = "<!-- agent-works:plugins second -->\nkeep\n<!-- /agent-works:plugins -->\n";
  const fresh = "<!-- agent-works:plugins x -->\nnew $& \\1\n<!-- /agent-works:plugins -->\n";
  assert.equal(withPluginsBlock(`# P\n\n${old}## Two\n${second}`, fresh), `# P\n\n${fresh}## Two\n${second}`);
  assert.equal(withPluginsBlock(`# P\n\n${old}## Two\n`, ""), "# P\n\n## Two\n");
  // A marker of another name is not the block: the block goes in as if none were there.
  const other = "# P\n\n<!-- agent-works:pluginsX old -->\nold\n<!-- /agent-works:plugins -->\n## One\n## Two\n";
  assert.equal(withPluginsBlock(other, "BLOCK\n"), "# P\n\n<!-- agent-works:pluginsX old -->\nold\n<!-- /agent-works:plugins -->\n## One\nBLOCK\n\n## Two\n");
  const once = withPluginsBlock("# P\n\n## One\n\n## Two\n", block);
  assert.equal(withPluginsBlock(once, block), once);
});

// -------------------------------------------------------------------------------------------------------- indexes

test("agent-works common: lineCount counts a last line without its ending", () => {
  const cases = [["", 0], ["a", 1], ["a\n", 1], ["a\nb", 2], ["a\n\nb\n", 3], ["\n", 1], ["a\r\nb\r\n", 2], ["a\rb", 1]];
  for (const [text, n] of cases) assert.equal(lineCount(text), n, JSON.stringify(text));
});

test("agent-works common: indexKind tells a generated index from one written by hand", (t) => {
  const dir = tempDir(t, "aw-common-");
  const kind = (text, marker = "<!-- gen -->", within = undefined) => indexKind(write(dir, "INDEX.md", text), marker, within);
  assert.equal(kind("<!-- gen -->\n- a\n"), "generated");
  assert.equal(kind("# T\n<!-- gen -->\n"), "generated");
  assert.equal(kind("# T\n\n<!-- gen -->\n"), "handwritten");
  assert.equal(kind("# T\n\n<!-- gen -->\n", "<!-- gen -->", 3), "generated");
  assert.equal(kind("  <!-- gen -->  \r\nx"), "generated");
  assert.equal(kind(""), "handwritten");
  assert.equal(indexKind(path.join(dir, "none.md"), "x"), "missing");
});

test("agent-works common: linesLost counts what generating an index would drop", () => {
  assert.equal(linesLost("- [a](a.md)\n- [b](b.md)\nnote\n", "- [a](a.md)\n"), 2);
  assert.equal(linesLost("  x  \n\n y\n", "x\ny\n"), 0);
  assert.equal(linesLost("a\nb\nc", ""), 3);
  assert.equal(linesLost("", "a"), 0);
});

test("agent-works common: appendListLine adds after the last list line and keeps the file's line endings", (t) => {
  const dir = tempDir(t, "aw-common-");
  const cases = [
    ["", "- [n](n.md): new\n"],
    ["# Index\n", "# Index\n\n- [n](n.md): new\n"],
    ["# Index", "# Index\n\n- [n](n.md): new\n"],
    ["# Index\n\n- [a](a.md): one\n- [b](b.md): two\n\ntail\n", "# Index\n\n- [a](a.md): one\n- [b](b.md): two\n- [n](n.md): new\n\ntail\n"],
    ["- [a](a.md)", "- [a](a.md)\n- [n](n.md): new\n"],
    ["* [a](a.md)\r\n- [b](b.md)\r\nend\r\n", "* [a](a.md)\r\n- [b](b.md)\r\n- [n](n.md): new\r\nend\r\n"],
    ["# T\r\n", "# T\r\n\r\n- [n](n.md): new\r\n"],
    ["# T\r", "# T\r\n- [n](n.md): new\n"],
    [`${BOM}- [a](a.md)\n`, `${BOM}- [a](a.md)\n\n- [n](n.md): new\n`],
    ["x\n- [a](a.md)\r", "x\n- [a](a.md)\r- [n](n.md): new\n"],
  ];
  for (const [before, after] of cases) {
    const file = write(dir, "INDEX.md", before);
    assert.equal(appendListLine(file, "- [n](n.md): new"), true);
    assert.equal(fs.readFileSync(file, "utf8"), after, JSON.stringify(before));
  }
  assert.equal(appendListLine(path.join(dir, "none.md"), "x"), false);
  assert.equal(fs.existsSync(path.join(dir, "none.md")), false);
});

test("agent-works common: markdownFiles is what git tracks or would add, folder by folder", (t) => {
  const { dir, git: run } = tempRepo(t, "aw-common-");
  for (const f of ["b.md", "a/x.md", "a-b/y.md", "a/z.txt", "ignored/i.md", "sp ace/s p.md", "café.md", ".agents/m.md"]) write(dir, f, "x");
  write(dir, ".gitignore", "ignored/\n");
  run("add", "b.md");
  write(dir, "gone.md", "x");
  run("add", "gone.md");
  fs.rmSync(path.join(dir, "gone.md"));
  assert.deepEqual(markdownFiles(dir).map((f) => rel(f, dir)), [".agents/m.md", "a/x.md", "a-b/y.md", "b.md", "café.md", "sp ace/s p.md"]);
  assert.ok(markdownFiles(dir).every((f) => path.isAbsolute(f) && f.startsWith(dir)));
});

test("agent-works common: without git, markdownFiles walks and skips dependency and hidden folders", (t) => {
  const dir = tempDir(t, "aw-common-");
  const saved = process.env.GIT_CEILING_DIRECTORIES;
  // Whatever repository the temp folder may sit in is not this tree's.
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(real(dir));
  t.after(() => {
    if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = saved;
  });
  const tree = path.join(real(dir), "tree");
  for (const f of ["b.md", "a/x.MD", "a-b/y.md", "a/z.txt", "node_modules/n.md", ".hidden/h.md", ".agents/m.md", "vendor/v.md", "a/build/q.md", "a.md", "venv/v.md", "c/d/e.md"]) write(tree, f, "x");
  assert.deepEqual(markdownFiles(tree).map((f) => rel(f, tree)), [".agents/m.md", "a/x.MD", "a-b/y.md", "a.md", "b.md", "c/d/e.md"]);
  assert.deepEqual(markdownFiles(path.join(tree, "none")), []);
});

// ------------------------------------------------------------------------------------------------------- commands

test("agent-works common: parseArgs reads flags, positionals, help and what follows a --", () => {
  const options = { json: { type: "boolean" }, as: { type: "string" }, exclude: { type: "string", multiple: true }, merges: { type: "string", default: "20" } };
  const read = (...argv) => parseArgs(argv, options);
  const plain = read("gpu", "--as", "me", "--json", "more");
  assert.deepEqual([{ ...plain.values }, plain.positionals, plain.rest, plain.help], [{ as: "me", json: true, merges: "20" }, ["gpu", "more"], null, false]);
  assert.equal(read("--as=me=too").values.as, "me=too");
  assert.deepEqual(read("--exclude", "a", "--exclude=b").values.exclude, ["a", "b"]);
  assert.equal(read("-h").help, true);
  assert.equal(read("x", "--help").help, true);
  const run = read("run", "gpu", "--as", "me", "--", "echo", "--json", "--", "-h");
  assert.deepEqual([run.positionals, run.rest, run.values.json, run.help], [["run", "gpu"], ["echo", "--json", "--", "-h"], undefined, false]);
  assert.deepEqual(read("--").rest, []);
  assert.deepEqual(parseArgs(["a", "-h"]).positionals, ["a"]);
  for (const bad of [["--no-such-flag"], ["--as"], ["--json=1"], ["-x"]]) {
    assert.throws(() => read(...bad), (e) => e instanceof AwError && e.exitCode === 2 && e.message.length > 0, bad.join(" "));
  }
});

test("agent-works common: intArg is a whole number, the fallback, or a usage error", () => {
  assert.equal(intArg("20", "--merges"), 20);
  assert.equal(intArg(" -3 ", "--n"), -3);
  assert.equal(intArg(undefined, "--merges", 20), 20);
  assert.equal(intArg(undefined, "--merges"), null);
  for (const bad of ["x", "1.5", "", "1e3", "0x10"]) {
    assert.throws(() => intArg(bad, "--merges"), (e) => e instanceof AwError && e.message === `--merges takes a whole number, not "${bad}"`);
  }
});

test("agent-works common: AwError carries the exit code of a usage error unless it is given another", () => {
  const e = new AwError("no");
  assert.deepEqual([e.name, e.message, e.exitCode, e instanceof Error], ["AwError", "no", 2, true]);
  assert.equal(new AwError("later", 1).exitCode, 1);
});

test("agent-works common: runCommand passes the exit code through and turns an error into a message", async () => {
  const run = async (main, argv = []) => {
    const io = bufferedIo({ cwd: "here" });
    return [await runCommand(main, argv, io, "aw demo"), io.out(), io.err()];
  };
  assert.deepEqual(await run(async (argv, io) => { io.stdout.write(`${argv.join(",")} in ${io.cwd}\n`); return 3; }, ["a", "--json"]), [3, "a,--json in here\n", ""]);
  assert.deepEqual(await run(() => 1), [1, "", ""]);
  assert.deepEqual(await run(() => undefined), [0, "", ""]);
  assert.deepEqual(await run(() => null), [0, "", ""]);
  assert.deepEqual(await run(() => true), [1, "", ""]);
  assert.deepEqual(await run(() => "not a number"), [0, "", ""]);
  assert.deepEqual(await run(() => { throw new AwError("say --plan or --apply"); }), [2, "", "aw demo: say --plan or --apply\n"]);
  assert.deepEqual(await run(async () => { throw new AwError("not now", 1); }), [1, "", "aw demo: not now\n"]);
  assert.deepEqual(await run(() => { throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" }); }), [0, "", ""]);
  const [code, out, err] = await run(() => { throw new TypeError("a bug"); });
  assert.deepEqual([code, out], [1, ""]);
  assert.match(err, /^aw demo: TypeError: a bug\n\s+at /);
  // Without an io, the process's own is used: nothing to capture, only the code.
  assert.equal(await runCommand(() => 4, []), 4);
});

const COMMAND = (lib) => `import fs from "node:fs";
import { AwError, runMain } from ${JSON.stringify(pathToFileURL(lib).href)};
export async function main(argv, io) {
  if (argv[0] === "boom") throw new AwError("refused");
  io.stdout.write(JSON.stringify({ argv, cwd: fs.realpathSync.native(io.cwd), own: io.stdout === process.stdout }) + "\\n");
  return Number(argv[0] ?? 0);
}
runMain(import.meta.url, main);
`;

test("agent-works common: runMain runs main when the module is the script, with the process's arguments and exit code", (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  const script = write(dir, "scripts/twins.mjs", COMMAND(path.join(PLUGIN, "lib", "common.mjs")));
  const ok = runNode(script, ["3", "--json"], { cwd: dir });
  assert.deepEqual([ok.status, JSON.parse(ok.stdout), ok.stderr], [3, { argv: ["3", "--json"], cwd: dir, own: true }, ""]);
  assert.equal(runNode(script, [], { cwd: dir }).status, 0);
  const refused = runNode(script, ["boom"], { cwd: dir });
  assert.deepEqual([refused.status, refused.stdout, refused.stderr], [2, "", "aw twins: refused\n"]);
});

test("agent-works common: runMain does nothing when the module is imported", async (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  const script = write(dir, "scripts/twins.mjs", COMMAND(path.join(PLUGIN, "lib", "common.mjs")));
  const importer = write(dir, "importer.mjs", `const m = await import(${JSON.stringify(pathToFileURL(script).href)});\nprocess.stdout.write(typeof m.main + " imported\\n");\n`);
  const r = runNode(importer, ["7"], { cwd: dir });
  assert.deepEqual([r.status, r.stdout, r.stderr], [0, "function imported\n", ""]);
  const saved = process.exitCode;
  const mod = await import(pathToFileURL(script).href);
  assert.equal(process.exitCode, saved);
  assert.equal(isMain(pathToFileURL(script).href), false);
  assert.equal(isMain("not a url"), false);
  const io = bufferedIo({ cwd: dir });
  assert.equal(await mod.main(["5"], io), 5);
  assert.deepEqual(JSON.parse(io.out()), { argv: ["5"], cwd: dir, own: false });
});

test("agent-works common: runMain knows its script through a link", { skip: process.platform === "win32" && "making a link needs a privilege there" }, (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  const script = write(dir, "scripts/twins.mjs", COMMAND(path.join(PLUGIN, "lib", "common.mjs")));
  fs.symlinkSync(path.join(dir, "scripts"), path.join(dir, "linked"));
  const r = runNode(path.join(dir, "linked", "twins.mjs"), ["4"], { cwd: dir });
  assert.deepEqual([r.status, JSON.parse(r.stdout).argv, r.stderr], [4, ["4"], ""]);
  fs.symlinkSync(script, path.join(dir, "aw-twins"));
  assert.equal(runNode(path.join(dir, "aw-twins"), ["6"], { cwd: dir }).status, 6);
});

test("agent-works common: a reader that stops early ends the command quietly", { skip: process.platform === "win32" && "a closed pipe is not reported to the writer there" }, async (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  const script = write(dir, "scripts/flood.mjs", `import { runMain } from ${JSON.stringify(pathToFileURL(path.join(PLUGIN, "lib", "common.mjs")).href)};
export async function main(argv, io) {
  for (let i = 0; i < 40; i++) {
    io.stdout.write("x".repeat(65536) + "\\n");
    await new Promise((done) => setTimeout(done, 5));
  }
  return 0;
}
runMain(import.meta.url, main);
`);
  const child = spawn(process.execPath, [script], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (chunk) => { err += chunk; });
  child.stdout.once("data", () => child.stdout.destroy());
  const [status] = await once(child, "close");
  assert.deepEqual([status, err], [0, ""]);
});

// ---------------------------------------------------------------------------------------------------- the library

test("agent-works common: either library can be the first one imported", (t) => {
  const dir = real(tempDir(t, "aw-common-"));
  const url = (f) => JSON.stringify(pathToFileURL(path.join(PLUGIN, "lib", f)).href);
  const body = (first, second) => `const a = await import(${url(first)});\nconst b = await import(${url(second)});\n`
    + "const { loadConfig } = a.loadConfig ? a : b;\nconst { projectRoot } = a.projectRoot ? a : b;\n"
    + "process.stdout.write(JSON.stringify([loadConfig(process.cwd()).budgets.hubLines, typeof projectRoot(process.cwd())]) + \"\\n\");\n";
  for (const [first, second] of [["common.mjs", "config.mjs"], ["config.mjs", "common.mjs"]]) {
    const r = runNode(write(dir, `${first}-first.mjs`, body(first, second)), [], { cwd: dir });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '[40,"string"]\n', ""], first);
  }
});

test("agent-works common: the libraries let Node unwind and write only through the io", () => {
  for (const f of ["lib/common.mjs", "lib/config.mjs", "scripts/aw.mjs"]) {
    const text = fs.readFileSync(path.join(PLUGIN, f), "utf8");
    assert.doesNotMatch(text, /process\.exit\(/, f);
    assert.doesNotMatch(text, /console\.(log|error|warn)\(/, f);
    assert.doesNotMatch(text, /\r/, f);
  }
});

test("agent-works common: every export says in one comment what it is", () => {
  for (const f of ["common.mjs", "config.mjs"]) {
    const lines = fs.readFileSync(path.join(PLUGIN, "lib", f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^export (?:async )?(?:function\*?|const|class) /.test(line)) return;
      assert.match(lines[i - 1], /^(?:\/\*\*.*\*\/| \*\/)$/, `${f}:${i + 1} ${line}`);
    });
  }
});
