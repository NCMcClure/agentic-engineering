#!/usr/bin/env node
// Put a repo on its team's conventions: the marker (`.agents/manifest.json`),
// the root AGENTS.md hub and its CLAUDE.md link, the repo's own check scripts,
// the managed .gitignore block, the CI gate for the repo's forge, the shared
// permission rules in `.claude/settings.json`, and the pre-commit hook for
// commits made outside an agent. Everything is local: nothing is created on a
// forge, nothing is committed, nothing is pushed.
//
// A fresh scaffold also lays down a template's starter source. `--upgrade`
// puts the conventions around a repo that already has files, or brings an
// earlier scaffold forward, and changes nothing the second time it runs: a
// file it wrote and nobody edited is replaced, an edited one is kept with its
// diff shown, and a file it never wrote is never overwritten.
//
// Usage:
//   node init-project.mjs --name <name> --template <t> --description "<one line>" [--target <dir>] [options]
//   node init-project.mjs --upgrade [--target <dir>] [options]
//
//   --template         library or node-service: the starter source of a fresh scaffold
//   --target           where to write (default: ./<name>, or the current folder with --upgrade)
//   --forge            github, gitlab, or none. Read off the origin remote when it
//                      names one; the flag is for a host whose name says nothing,
//                      or a repo with no remote yet. `none` writes no CI gate.
//   --default-branch   the branch every change lands on (default: the remote's, else main)
//   --strict           write the opt-in `teamwork` block that makes passing tests a
//                      hard gate: { "requireTestsPass": true } plus the test command
//   --test-command     the command for --strict, and for the unit lane of a repo
//                      that has none recorded (default: detected from the repo)
//   --claude-md        link (a symlink to AGENTS.md, the default) or import (a one-line
//                      `@AGENTS.md` file, the default on Windows)
//   --hooks-path       also run `git config core.hooksPath .githooks` in this clone
//   --no-plugin-check  leave the session hook that offers the plugin to a teammate
//                      without it out of .claude/settings.json
//   --force            on upgrade, overwrite files edited since they were written;
//                      on a fresh scaffold, write into a folder that has files
//   --dry-run          write nothing; print every path it would write
//   --json             one JSON object on stdout; the progress lines go to stderr
//
// Exit 0 done, 1 failed (the message says why), 2 usage.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { detect, FORGES } from "./lib/provider.mjs";
import { mergeFencedBlock, render, renderText, sha256, walk, writeOwned } from "./render.mjs";

const PLUGIN = path.join(import.meta.dirname, "..");
const TEMPLATES = path.join(PLUGIN, "templates");
const STANDARD = JSON.parse(fs.readFileSync(path.join(PLUGIN, "standard.json"), "utf8"));

export const MANIFEST = ".agents/manifest.json";
export const GITIGNORE_START = "# >>> agentic-teamwork";
export const GITIGNORE_END = "# <<< agentic-teamwork";
/** The CI gate each forge gets, and the pipeline file that has to include GitLab's. */
export const GATE = Object.freeze({ github: ".github/workflows/team-conventions.yml", gitlab: ".gitlab/ci/team-conventions.yml" });
export const GITLAB_PIPELINE = ".gitlab-ci.yml";
const HOOK = ".githooks/pre-commit";
const HOOK_LIBRARY = ".githooks/lib-guard.sh";
// Where files of the plugin's first layout are parked when they are replaced.
const RETIRED = ".agents/retired/agentic-teamwork";
// The settings file of the plugin's first layout. Until its rules are in the
// marker the hooks keep reading it, and the session hook retires it after.
const FIRST_LAYOUT = ".claude/teamwork.json";
// Starter files: written by a fresh scaffold, never dropped onto a repo that is being adopted.
const FRESH_ONLY = new Set(["README.md", "CONTRIBUTING.md", ".gitattributes"]);
// Inputs to the scaffold, not files a repo keeps.
const HELPERS = new Set(["gitignore.block", "template.json"]);
const LANE_TOKENS = { unit: "UNIT_CMD", integration: "INTEGRATION_CMD", e2e: "E2E_CMD", live: "LIVE_CMD" };
const NOT_WIRED = {
  unit: "not wired: no test command found; write this repo's here",
  integration: "not wired: no integration lane yet",
  e2e: "not wired: no e2e lane yet",
  live: "not wired: add one the day this repo calls a model",
};
const OPTIONS = {
  name: { type: "string" }, template: { type: "string" }, description: { type: "string" }, target: { type: "string" },
  forge: { type: "string" }, "default-branch": { type: "string" }, "test-command": { type: "string" }, "claude-md": { type: "string" },
  upgrade: { type: "boolean" }, strict: { type: "boolean" }, force: { type: "boolean" }, "dry-run": { type: "boolean" },
  json: { type: "boolean" }, "hooks-path": { type: "boolean" }, "no-plugin-check": { type: "boolean" },
};

class Usage extends Error {}

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")); } catch { return null; } };
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const wired = (command) => typeof command === "string" && command !== "" && !/^not wired\b/i.test(command);
const git = (dir, ...args) => {
  try { return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
};

/** A fresh scaffold's name goes into package manifests, so it is held to what those accept. */
export function validateName(name, { fresh = true } = {}) {
  if (!name) return "a name is required: --name <name>";
  if (fresh && !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) return `"${name}" is not a usable project name: lowercase letters, digits, dots, hyphens and underscores, starting with a letter or digit, 64 characters or fewer`;
  if (!fresh && /[\s/\\"]/.test(name)) return `"${name}" is not a usable project name: no spaces, slashes or quotes`;
  return null;
}

export function validateDescription(description, { required = true } = {}) {
  if (!description) return required ? 'a description is required: --description "<one line on what this is>"' : null;
  if (description.length > 120) return `the description is ${description.length} characters; keep it to 120 or fewer`;
  if (/["\\\r\n]/.test(description)) return "keep the description plain: no double quotes, backslashes or line breaks (it is written into package manifests)";
  return null;
}

/** The command that runs a repo's tests, read off the manifests it has, or null. */
export function detectTestCommand(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  const script = readJson(path.join(dir, "package.json"))?.scripts?.test;
  if (typeof script === "string" && script && !/no test specified/.test(script)) return has("pnpm-lock.yaml") ? "pnpm test" : has("yarn.lock") ? "yarn test" : "npm test";
  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("pytest.ini") || /pytest/.test(readText(path.join(dir, "pyproject.toml")) ?? "")) return "pytest";
  if (has("Package.swift")) return "swift test";
  if (/^test:/m.test(readText(path.join(dir, "Makefile")) ?? "")) return "make test";
  return null;
}

/** The branch every change lands on: the remote's HEAD, else main or master where one exists, else an unborn repo's own. */
function defaultBranchOf(target) {
  const remote = git(target, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD").replace(/^origin\//, "");
  if (remote) return remote;
  for (const branch of ["main", "master"]) if (git(target, "rev-parse", "--verify", "-q", `refs/heads/${branch}`)) return branch;
  if (!git(target, "rev-parse", "--verify", "-q", "HEAD")) return git(target, "symbolic-ref", "--short", "-q", "HEAD") || "main";
  return "main";
}

/**
 * `addition` merged into a settings object: permission lists gain the entries
 * they lack, each hook event gains the groups whose command is not there yet.
 * Everything already in the settings is kept, in its order.
 */
export function mergeSettings(current, addition) {
  const next = structuredClone(isObject(current) ? current : {});
  for (const [list, entries] of Object.entries(addition.permissions ?? {})) {
    const have = Array.isArray(next.permissions?.[list]) ? next.permissions[list] : [];
    const missing = entries.filter((e) => !have.includes(e));
    if (missing.length) next.permissions = { ...(next.permissions ?? {}), [list]: [...have, ...missing] };
  }
  for (const [event, groups] of Object.entries(addition.hooks ?? {})) {
    const have = Array.isArray(next.hooks?.[event]) ? next.hooks[event] : [];
    const commands = new Set(have.flatMap((g) => (g?.hooks ?? []).map((h) => h?.command)));
    const missing = groups.filter((g) => (g.hooks ?? []).some((h) => !commands.has(h.command)));
    if (missing.length) next.hooks = { ...(next.hooks ?? {}), [event]: [...have, ...missing] };
  }
  return next;
}

/**
 * A `.gitlab-ci.yml` that includes the gate. An empty one becomes `fresh`; one
 * with an include list gains an item; one with no include gains the block. An
 * include written any other way is left for a person: `how` is "manual".
 */
export function ensureGitlabInclude(existing, fresh) {
  if (!existing.trim()) return { text: fresh, how: "created" };
  if (existing.includes(GATE.gitlab)) return { text: existing, how: "present" };
  const lines = existing.split("\n");
  const at = lines.findIndex((l) => /^include:\s*(#.*)?$/.test(l));
  if (at !== -1) {
    const first = lines.slice(at + 1).find((l) => l.trim() && !l.trim().startsWith("#"));
    if (!first || !/^\s*-\s/.test(first)) return { text: existing, how: "manual" };
    lines.splice(at + 1, 0, `${/^\s*/.exec(first)[0]}- local: ${GATE.gitlab}`);
    return { text: lines.join("\n"), how: "added to the include list" };
  }
  if (/^include:/m.test(existing)) return { text: existing, how: "manual" };
  return { text: `include:\n  - local: ${GATE.gitlab}\n\n${existing}`, how: "include added" };
}

/**
 * The `teamwork` block that keeps a first-layout file's rules as they were.
 * The mapping is the hooks' own, so a rule means the same thing before and
 * after; null where there is no such file, or the mapping cannot be loaded.
 */
async function firstLayoutBlock(target) {
  try {
    const { blockFromFirstLayout, firstLayout } = await import("../hooks/lib/config.mjs");
    const old = firstLayout(target);
    return old ? blockFromFirstLayout(old) : null;
  } catch { return null; }
}

const templateNames = () => fs.readdirSync(TEMPLATES).filter((d) => fs.existsSync(path.join(TEMPLATES, d, "template.json"))).sort();

async function main(argv, { out = (line) => console.log(line) } = {}) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }); } catch (e) { throw new Usage(e.message); }
  const v = parsed.values;
  const dryRun = Boolean(v["dry-run"]);
  const upgrade = Boolean(v.upgrade);
  const force = Boolean(v.force);
  const say = v.json ? (line) => console.error(line) : out;
  const will = (verb) => (dryRun ? `would ${verb}` : verb);

  // ---- preflight
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error(`node ${process.versions.node} is too old; this needs node 22 or newer`);
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { throw new Error("git is not installed or not on PATH"); }
  if (v.forge && !["github", "gitlab", "none"].includes(v.forge)) throw new Usage(`--forge takes github, gitlab or none, not "${v.forge}"`);
  if (v["claude-md"] && !["link", "import"].includes(v["claude-md"])) throw new Usage(`--claude-md takes link or import, not "${v["claude-md"]}"`);

  const target = path.resolve(v.target ?? (upgrade ? process.cwd() : path.join(process.cwd(), v.name ?? "")));
  const at = (...p) => path.join(target, ...p);
  const existing = readJson(at(MANIFEST));
  if (fs.existsSync(at(MANIFEST)) && !isObject(existing)) throw new Error(`${MANIFEST} does not parse: fix or remove it, then run this again`);
  if (existing && !upgrade && !force) throw new Error(`${target} already carries ${MANIFEST}: use --upgrade to bring it forward`);
  const before = upgrade ? existing : null;
  const firstLayout = readJson(at(FIRST_LAYOUT));
  const unmoved = isObject(firstLayout) && !isObject(before?.teamwork);

  const name = v.name ?? before?.project ?? path.basename(target);
  const description = v.description ?? before?.description ?? "";
  for (const problem of [validateName(name, { fresh: !upgrade }), validateDescription(description, { required: !upgrade })]) {
    if (problem) throw new Usage(problem);
  }
  const template = upgrade ? (before?.template ?? null) : v.template;
  if (!upgrade && !template) throw new Usage(`--template is required: one of ${templateNames().join(", ")}`);
  if (!upgrade && !templateNames().includes(template)) throw new Usage(`unknown template "${template}"; one of ${templateNames().join(", ")}`);
  // An upgrade lays down no starter source, but the hub it may rewrite still
  // names the directories the template gave the repo.
  const templateConfig = template && templateNames().includes(template) ? JSON.parse(fs.readFileSync(path.join(TEMPLATES, template, "template.json"), "utf8")) : {};

  // The flag, then what the remote's host name says, then what an earlier run recorded.
  const forge = v.forge ?? detect(target).kind ?? (["github", "gitlab"].includes(before?.forge) ? before.forge : "none");
  const defaultBranch = v["default-branch"] ?? before?.default_branch ?? (typeof firstLayout?.baseBranch === "string" && firstLayout.baseBranch ? firstLayout.baseBranch : null) ?? defaultBranchOf(target);

  // ---- lanes: the four commands an agent runs by name
  let lanes;
  if (isObject(before?.lanes) && Object.keys(before.lanes).length) lanes = before.lanes;
  else if (!upgrade) lanes = Object.fromEntries(Object.entries(LANE_TOKENS).map(([lane, token]) => [lane, templateConfig.lanes?.[token] ?? NOT_WIRED[lane]]));
  else {
    const old = isObject(firstLayout?.test) && typeof firstLayout.test.command === "string" ? firstLayout.test : null;
    const earlier = old?.command.trim() ? (typeof old.dir === "string" && old.dir && old.dir !== "." ? `cd ${old.dir} && ${old.command.trim()}` : old.command.trim()) : null;
    lanes = { ...NOT_WIRED, unit: v["test-command"] ?? earlier ?? detectTestCommand(target) ?? NOT_WIRED.unit };
  }

  // ---- the opt-in block
  // A repo on the first layout has its rules written into the marker as they
  // were enforced, so putting it on the conventions loosens nothing.
  let teamwork = isObject(before?.teamwork) ? before.teamwork : null;
  const carried = unmoved && upgrade ? await firstLayoutBlock(target) : null;
  if (carried) teamwork = carried;
  if (v.strict) {
    if (unmoved && !carried) throw new Error(`this repo's settings still sit in ${FIRST_LAYOUT}, which the hooks keep honoring. Start a session with the plugin enabled so its session hook moves them into ${MANIFEST}, then run --strict.`);
    const command = v["test-command"] ?? teamwork?.test?.command ?? (wired(lanes.unit) ? lanes.unit : null) ?? detectTestCommand(target);
    if (!command) throw new Usage('--strict needs a command to run: pass --test-command "<the command that runs the tests>"');
    teamwork = { ...(teamwork ?? {}), requireTestsPass: true, test: { ...(isObject(teamwork?.test) ? teamwork.test : {}), command } };
  }

  const noun = FORGES[forge]?.noun ?? "change request";
  const tokens = {
    PROJECT: name,
    DESCRIPTION: description || "Describe this repo in one line here.",
    TEMPLATE: template ?? "none",
    DEFAULT_BRANCH: defaultBranch,
    STANDARD_VERSION: String(STANDARD.standard_version),
    CHANGE_NOUN: noun,
    LAYOUT: [
      ...(templateConfig.layout ?? ["- Add this repo's own directories here, one line each: what it holds, and when to open it."]),
      ...(forge === "none" ? [] : [`- \`${GATE[forge]}\` - the CI gate: the conventions check and the unit lane on every ${noun}.`]),
    ].join("\n"),
    ...Object.fromEntries(Object.entries(LANE_TOKENS).map(([lane, token]) => [token, lanes[lane] ?? NOT_WIRED[lane]])),
  };

  say(`${upgrade ? "upgrade" : "init"}: ${name} (${upgrade ? "the conventions around what is here" : `template ${template}`}, conventions v${STANDARD.standard_version}, forge ${forge}, default branch ${defaultBranch})`);
  if (dryRun) say("  DRY RUN: nothing is written");

  // ---- the tree
  // A fresh scaffold writes every template file over whatever is there, and an
  // agent can run it, so a folder with files of its own fails here instead of
  // losing them. Dotfiles and .git do not count: that is what an empty folder
  // looks like after git init.
  if (!upgrade && !force) {
    const own = walk(target).filter((f) => !f.split("/")[0].startsWith("."));
    if (own.length) throw new Error(`${target} already has ${own.length} file(s) of its own (${own.slice(0, 3).join(", ")}${own.length > 3 ? ", ..." : ""}). A fresh scaffold would overwrite them: use --upgrade to put the conventions around them, or --force to scaffold anyway.`);
  }
  if (!dryRun) fs.mkdirSync(target, { recursive: true });
  let changes = 0;

  // A repo whose instructions live in CLAUDE.md keeps every word of them: the
  // file becomes the hub, and CLAUDE.md becomes the link to it.
  const twin = at("CLAUDE.md");
  const twinState = () => {
    let st = null;
    try { st = fs.lstatSync(twin); } catch { return "absent"; }
    if (st.isSymbolicLink()) return fs.readlinkSync(twin) === "AGENTS.md" ? "linked" : "elsewhere";
    return ["@AGENTS.md", "AGENTS.md"].includes((readText(twin) ?? "").trim()) ? "linked" : "content";
  };
  const adopted = upgrade && twinState() === "content" && !fs.existsSync(at("AGENTS.md"));
  if (adopted) {
    say(`  ${will("move")} CLAUDE.md to AGENTS.md: the hub every agent reads; CLAUDE.md becomes its link`);
    if (!dryRun) fs.renameSync(twin, at("AGENTS.md"));
    changes++;
  }

  // An empty map, not null, on the first upgrade of an unmarked repo: only a
  // map makes the render guard the files that are already there.
  const owned = upgrade ? { ...(isObject(before?.owned) ? before.owned : {}) } : null;
  const hashes = {};
  const kept = [];
  const written = [];
  const note = (rel, result, next) => {
    if (result.hash) hashes[rel] = result.hash;
    if (result.action === "written") { written.push(rel); say(`  ${will("write")} ${rel} (${next.length} bytes)`); changes++; }
    else if (result.action === "kept") {
      kept.push(rel);
      say(`  keep  ${rel}: ${result.reason}`);
      if (result.reason.startsWith("edited") && !v.json) showDiff(target, rel, next, say);
    }
  };
  const sources = upgrade ? ["common"] : ["common", template];
  const shipped = new Set();
  const unknown = new Set();
  for (const source of sources) {
    const skip = (rel) => HELPERS.has(rel) || (upgrade && FRESH_ONLY.has(rel)) || (adopted && rel === "AGENTS.md");
    const part = render(path.join(TEMPLATES, source), target, tokens, { dryRun, owned, force, skip });
    for (const rel of walk(path.join(TEMPLATES, source))) if (!HELPERS.has(rel)) shipped.add(rel);
    for (const u of part.unknown) unknown.add(u);
    Object.assign(hashes, part.hashes);
    for (const f of part.plan) { written.push(f.path); say(`  ${will("write")} ${f.path} (${f.bytes} bytes)`); changes++; }
    for (const s of part.skipped) {
      if (s.reason === "identical") continue;
      kept.push(s.path);
      say(`  keep  ${s.path}: ${s.reason}`);
      if (s.reason.startsWith("edited") && !v.json) showDiff(target, s.path, s.next, say);
    }
  }
  if (unknown.size) say(`  note: unreplaced template tokens: ${[...unknown].join(", ")}`);

  // ---- a script or rule the marker owns that the scaffold no longer ships
  // Untouched, it goes; edited, it stays as the repo's own. Either way the
  // marker stops owning it. Rules reach a session through the plugin now, so
  // a copy left in the repo would load twice.
  const removed = [];
  const released = [];
  for (const rel of Object.keys(owned ?? {}).sort()) {
    if (!/^\.agents\/(scripts|rules)\//.test(rel) || shipped.has(rel)) continue;
    if (!fs.existsSync(at(rel))) { released.push(rel); continue; }
    if (force || sha256(fs.readFileSync(at(rel))) === owned[rel]) {
      say(`  ${will("remove")} ${rel}: the scaffold no longer ships it`);
      if (!dryRun) fs.rmSync(at(rel));
      removed.push(rel);
      changes++;
    } else {
      say(`  keep  ${rel}: no longer shipped, and edited since it was written, so it stays as this repo's own`);
      released.push(rel);
    }
  }
  // A removed rule's import line would point at nothing.
  const imports = new Set(removed.filter((rel) => rel.startsWith(".agents/rules/")).map((rel) => `@${rel}`));
  const hubText = imports.size ? readText(at("AGENTS.md")) : null;
  if (hubText !== null) {
    const next = hubText.split("\n").filter((l) => !imports.has(l.trim())).join("\n").replace(/\n{3,}/g, "\n\n");
    if (next !== hubText) {
      say(`  ${will("drop")} ${imports.size} @ import(s) from AGENTS.md`);
      if (!dryRun) fs.writeFileSync(at("AGENTS.md"), next);
    }
  }

  // ---- the pre-commit hook, for commits made outside an agent
  const hookTemplate = path.join(TEMPLATES, "githooks", "pre-commit");
  if (fs.existsSync(hookTemplate)) {
    const next = Buffer.from(fs.readFileSync(hookTemplate, "utf8").replace(/\r\n/g, "\n"), "utf8");
    // The first layout's hook was a shell script beside a library it sourced,
    // reading a settings file that is on its way out. It is replaced, and
    // parked rather than deleted: a step the team added to it is still there.
    const current = readText(at(HOOK));
    const earlier = upgrade && current !== null && current.includes(HOOK_LIBRARY) && !next.includes(HOOK_LIBRARY);
    if (earlier) {
      say(`  ${will("move")} ${HOOK} and its library to ${RETIRED}/: the earlier shell hook, kept in case the team added steps to it`);
      for (const rel of [HOOK, HOOK_LIBRARY]) {
        if (dryRun || !fs.existsSync(at(rel))) continue;
        if (!fs.existsSync(at(RETIRED, rel))) { fs.mkdirSync(path.dirname(at(RETIRED, rel)), { recursive: true }); fs.copyFileSync(at(rel), at(RETIRED, rel)); }
        if (rel === HOOK_LIBRARY) { fs.rmSync(at(rel)); removed.push(rel); }
      }
    }
    const result = writeOwned(target, HOOK, next, { dryRun, owned: earlier ? { ...owned, [HOOK]: sha256(Buffer.from(current)) } : owned, force, executable: true });
    note(HOOK, result, next);
  }

  // ---- the managed ignore block
  {
    const block = fs.readFileSync(path.join(TEMPLATES, "common", "gitignore.block"), "utf8").replace(/\r\n/g, "\n");
    const current = readText(at(".gitignore")) ?? "";
    const next = mergeFencedBlock(current, block, GITIGNORE_START, GITIGNORE_END);
    if (next !== current) {
      say(`  ${will("write")} .gitignore (the managed block ${current.includes(GITIGNORE_START) ? "replaced" : "added"}; everything else kept)`);
      if (!dryRun) fs.writeFileSync(at(".gitignore"), next);
      changes++;
    }
  }

  // ---- the CI gate
  if (forge === "none") {
    if (!upgrade || !before) say("  note: no forge is known for this repo, so no CI gate was written. Once it has a remote, run this again with --upgrade (and --forge github or --forge gitlab if the host name does not say).");
  } else {
    const next = Buffer.from(renderText(fs.readFileSync(path.join(TEMPLATES, "ci", `${forge}.yml`), "utf8").replace(/\r\n/g, "\n"), tokens).text, "utf8");
    const others = forge === "github"
      ? walk(at(".github", "workflows")).filter((f) => `.github/workflows/${f}` !== GATE.github)
      : (readText(at(GITLAB_PIPELINE)) ?? "").trim() ? [GITLAB_PIPELINE] : [];
    const result = writeOwned(target, GATE[forge], next, { dryRun, owned, force });
    note(GATE[forge], result, next);
    if (result.action === "written" && others.length && wired(lanes.unit)) say(`  note: the gate also runs the unit lane (${lanes.unit}). If ${others[0]} already runs it, delete the gate's unit job: the file is yours to edit.`);
    if (forge === "gitlab") {
      const current = readText(at(GITLAB_PIPELINE)) ?? "";
      const fresh = renderText(fs.readFileSync(path.join(TEMPLATES, "ci", "gitlab-ci.yml"), "utf8").replace(/\r\n/g, "\n"), tokens).text;
      const { text, how } = ensureGitlabInclude(current, fresh);
      if (how === "manual") say(`  note: ${GITLAB_PIPELINE} has an include this script will not rewrite. Add \`- local: ${GATE.gitlab}\` to it by hand; verify-standard.mjs reports it until then.`);
      else if (text !== current) {
        say(`  ${will("write")} ${GITLAB_PIPELINE} (${how})`);
        if (!dryRun) fs.writeFileSync(at(GITLAB_PIPELINE), text);
        changes++;
      }
    }
  }

  // ---- the shared permission rules, and the hook that offers the plugin
  {
    const addition = JSON.parse(fs.readFileSync(path.join(TEMPLATES, "settings.merge.json"), "utf8"));
    if (v["no-plugin-check"]) delete addition.hooks;
    const file = at(".claude", "settings.json");
    const text = readText(file);
    const current = text === null ? {} : readJson(file);
    if (!isObject(current)) say("  note: .claude/settings.json does not parse, so it was left alone. Fix it and run this again to add the permission rules.");
    else {
      const next = mergeSettings(current, addition);
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        say(`  ${will("write")} .claude/settings.json (${text === null ? "created" : "merged; everything already there kept"})`);
        if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(next, null, 2) + "\n"); }
        changes++;
      }
    }
  }

  // ---- the CLAUDE.md link
  {
    const state = adopted ? "absent" : twinState();
    if (state === "absent") {
      const mode = v["claude-md"] ?? (process.platform === "win32" ? "import" : "link");
      let made = mode;
      if (!dryRun) {
        try {
          if (mode === "import") fs.writeFileSync(twin, "@AGENTS.md\n");
          else fs.symlinkSync("AGENTS.md", twin);
        } catch {
          // A checkout that cannot hold a symlink gets the import instead.
          fs.writeFileSync(twin, "@AGENTS.md\n");
          made = "import";
        }
      }
      say(`  ${will("write")} CLAUDE.md (${made === "link" ? "a symlink to AGENTS.md" : "one line, @AGENTS.md"})`);
      changes++;
    } else if (state !== "linked") {
      say(`  keep  CLAUDE.md: ${state === "content" ? "it has content of its own beside AGENTS.md. Merge it into AGENTS.md, delete it, and run this again" : "it links somewhere other than AGENTS.md"}; verify-standard.mjs reports it until then`);
    }
  }

  // ---- the marker
  const { standard, standard_version, project, description: _d, template: _t, default_branch, forge: _f, lanes: _l, owned: _o, teamwork: _w, ...extras } = before ?? {};
  const gone = new Set([...removed, ...released]);
  const marker = {
    standard: "agentic-engineering",
    standard_version: STANDARD.standard_version,
    project: name,
    description,
    template,
    default_branch: defaultBranch,
    forge,
    lanes,
    ...extras,
    ...(teamwork ? { teamwork } : {}),
    owned: Object.fromEntries(Object.entries({ ...(owned ?? {}), ...hashes }).filter(([rel]) => !gone.has(rel)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  const markerText = JSON.stringify(marker, null, 2) + "\n";
  if (markerText !== readText(at(MANIFEST))) {
    say(`  ${will("write")} ${MANIFEST} (${Object.keys(marker.owned).length} owned file(s)${v.strict ? ", the strict test gate on" : ""})`);
    if (!dryRun) { fs.mkdirSync(at(".agents"), { recursive: true }); fs.writeFileSync(at(MANIFEST), markerText); }
    changes++;
  }
  const unchanged = upgrade && changes === 0;
  if (unchanged) say(`  nothing to do: already on conventions v${STANDARD.standard_version}${kept.length ? `, ${kept.length} file(s) kept as they are` : ""}`);
  if (carried) say(`  note: the rules ${FIRST_LAYOUT} enforced are now the marker's \`teamwork\` block, spelled out as they were. The next session with the plugin enabled retires the old files.`);
  else if (unmoved) say(`  note: ${FIRST_LAYOUT} holds this repo's settings from the plugin's first layout. The hooks keep honoring it, and the session hook moves it into ${MANIFEST}.`);

  // ---- git, the hook path, and the repo's own check
  if (!dryRun) {
    if (!fs.existsSync(at(".git"))) {
      execFileSync("git", ["-C", target, "init", "-q", "-b", defaultBranch], { stdio: "ignore" });
      say(`  git init -b ${defaultBranch}`);
    }
    if (fs.existsSync(at(HOOK))) {
      if (v["hooks-path"]) {
        execFileSync("git", ["-C", target, "config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
        say("  git config core.hooksPath .githooks (this clone only)");
      } else if (git(target, "config", "core.hooksPath") !== ".githooks") {
        say("  note: the pre-commit hook guards terminal commits once a clone turns it on: git config core.hooksPath .githooks");
      }
    }
    const check = path.join(".agents", "scripts", "verify-standard.mjs");
    try {
      const outText = execFileSync(process.execPath, [check, "--floor", String(STANDARD.floor)], { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      say(`  verify-standard.mjs: ${outText.trim().split("\n").pop()}`);
    } catch (e) {
      const findings = String(e.stdout || e.stderr || e.message).trim();
      // On an upgrade the scaffold's own files are written; what is left is the repo's.
      throw new Error(upgrade
        ? `verify-standard.mjs still reports findings. The scaffold's files are written; these are this repo's own to fix, and CI checks the same ones:\n${findings}`
        : `verify-standard.mjs failed on the scaffolded tree:\n${findings}`);
    }
  }

  if (v.json) console.log(JSON.stringify({ ok: true, target, project: name, template, forge, default_branch: defaultBranch, standard_version: STANDARD.standard_version, written, kept, removed, unchanged }));
  return 0;
}

/** What an edited file would have become, as a diff against what it is. */
function showDiff(target, rel, next, say) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-diff-"));
  try {
    const proposed = path.join(dir, path.basename(rel));
    fs.writeFileSync(proposed, next);
    let diff = "";
    // git diff exits 1 when the files differ, which is the case being read.
    try { execFileSync("git", ["diff", "--no-index", "--", path.join(target, rel), proposed], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { diff = String(e.stdout ?? ""); }
    if (diff) say(diff.trimEnd().split("\n").map((l) => `    ${l}`).join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(import.meta.filename); } catch { return false; } };

if (isMain()) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`init-project: ${e.message}`);
    process.exitCode = e instanceof Usage ? 2 : 1;
  }
}
