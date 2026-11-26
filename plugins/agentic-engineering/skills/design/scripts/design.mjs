#!/usr/bin/env node
// design.mjs: the person's design system, and a repo put on it.
//
//   profile show [--json]                 the profile: source, ref, and whether it holds a description
//   profile set <source> [--ref <ref>]    declare the system: a local folder or a GitHub owner/repo
//   profile manifest <file.json>          keep a description in the profile, for a system that ships none
//   manifest                              print the resolved design-system.json (the source's, else the profile's)
//   rules                                 print the system's usage rules, from the same source and ref
//   catalog                               print the system's component index, from the same source and ref
//   pin --tokens <a,b> [--include <glob>]... [--exclude <glob>]... [--upgrade]
//                                         put the repo on the system: write .agents/design.json, copy the
//                                         checker to .agents/scripts/ and the rules to .agents/rules/design.md,
//                                         add a design:check script and a design lane where there is a
//                                         package.json or a manifest. Never overwrites without --upgrade.
//   status [--json]                       the profile, the pin, and whether they agree on the version
//
// Every command takes --data <dir> (the area's data directory; default
// ${CLAUDE_PLUGIN_DATA}/design) and --root <dir> (the repo; default the
// current folder). Exit 0 done, 1 refused or out of step, 2 a usage error or
// nothing to read. lib/system.mjs beside this file has the shapes.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CHECKER, CHECKER_ASSET, PIN, RULES, buildPin, dataDir, fetchFile, manifestProblems, parseSource, readProfile, readDoc, resolveManifest, rulesHeader, writeProfile } from "./lib/system.mjs";

const USAGE = "usage: design.mjs profile show|set <source> [--ref <ref>]|manifest <file> | manifest | rules | catalog | pin --tokens <paths> [--upgrade] | status  [--data <dir>] [--root <dir>] [--json]";
const VALUED = new Set(["--data", "--root", "--ref", "--tokens", "--include", "--exclude"]);

/** argv as `{ words, flags }`: a valued flag may repeat, and its values are kept in order. */
function parse(argv) {
  const words = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUED.has(a)) { (flags[a] ??= []).push(argv[++i] ?? ""); continue; }
    if (a.startsWith("--")) { flags[a] = [true]; continue; }
    words.push(a);
  }
  return { words, flags, one: (f) => flags[f]?.at(-1), list: (f) => (flags[f] ?? []).flatMap((v) => String(v).split(",")).map((s) => s.trim()).filter(Boolean) };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
const sha = (file) => { try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch { return null; } };
/** JSON written the way the file was indented, or two spaces. */
function writeJsonLike(file, value, before = "") {
  const indent = /^\{\n([ \t]+)"/.exec(before)?.[1] ?? 2;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, indent)}\n`);
}

export async function main(argv, { env = process.env, cwd = process.cwd(), fetch = fetchFile, out = console.log, err = console.error } = {}) {
  const args = parse(argv);
  const [command, sub, arg] = args.words;
  const dir = dataDir({ data: args.one("--data"), env });
  const root = path.resolve(cwd, args.one("--root") ?? ".");
  const json = Boolean(args.one("--json"));
  const profile = readProfile(dir);
  const opts = { fetch, cwd };
  const fail = (message, code = 2) => { err(`design: ${message}`); return code; };

  if (command === "profile") {
    if (!dir) return fail("no data directory: pass --data <dir>, the one the design area names");
    if (sub === "show" || !sub) {
      if (!profile) { out(json ? "null" : "No design system is declared on this machine."); return 0; }
      if (json) out(JSON.stringify(profile, null, 2));
      else out(`Design system: ${profile.source ?? "(no source)"}${profile.ref ? ` at ${profile.ref}` : ""}${profile.manifest ? `; the profile holds its description (${profile.manifest.name ?? "unnamed"} ${profile.manifest.version ?? ""})`.trimEnd() : ""}.`);
      return 0;
    }
    if (sub === "set") {
      const source = parseSource(arg, cwd);
      if (!source) return fail(`${JSON.stringify(arg ?? "")} is neither a folder here nor a GitHub owner/repo`);
      const next = { ...(profile ?? {}), source: source.kind === "local" ? source.dir : `${source.owner}/${source.repo}` };
      const ref = args.one("--ref");
      if (ref) next.ref = ref; else if (profile?.source !== next.source) delete next.ref;
      if (profile?.source && profile.source !== next.source) delete next.manifest;
      out(`Saved ${writeProfile(dir, next)}: ${next.source}${next.ref ? ` at ${next.ref}` : ""}.`);
      return 0;
    }
    if (sub === "manifest") {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(path.resolve(cwd, arg ?? ""), "utf8")); } catch (e) { return fail(`cannot read the description ${JSON.stringify(arg ?? "")}: ${e.message}`); }
      const problems = manifestProblems(manifest);
      if (problems.length) return fail(`the description is not schema 1: ${problems.join("; ")}`);
      out(`Saved ${writeProfile(dir, { ...(profile ?? {}), manifest })}: the profile holds ${manifest.name} ${manifest.version}.`);
      return 0;
    }
    return fail(USAGE);
  }

  if (command === "manifest" || command === "rules" || command === "catalog") {
    let resolved;
    try { resolved = resolveManifest(profile, opts); } catch (e) { return fail(e.message); }
    const problems = manifestProblems(resolved.manifest);
    if (problems.length) return fail(`the ${resolved.from === "source" ? "system's design-system.json" : "profile's description"} is not schema 1: ${problems.join("; ")}`);
    if (command === "manifest") {
      if (resolved.from === "profile") err(`design: ${profile.source ?? "the source"} ships no design-system.json; this is the profile's description.`);
      out(JSON.stringify(resolved.manifest, null, 2));
      return 0;
    }
    try { out(readDoc(profile, resolved.manifest, { ...opts, key: command })); } catch (e) { return fail(e.message); }
    return 0;
  }

  if (command === "pin") return pin({ args, profile, root, opts, out, fail });
  if (command === "status") return status({ profile, root, opts, json, out });
  return fail(USAGE);
}

/** Write the pin, the checker and the rules, and wire the check into package.json and the manifest's lanes. */
function pin({ args, profile, root, opts, out, fail }) {
  const upgrade = Boolean(args.one("--upgrade"));
  let resolved, rules;
  try { resolved = resolveManifest(profile, opts); } catch (e) { return fail(e.message); }
  const { manifest } = resolved;
  const problems = manifestProblems(manifest);
  if (problems.length) return fail(`the description is not schema 1: ${problems.join("; ")}`);
  try { rules = readDoc(profile, manifest, opts); } catch (e) { return fail(e.message); }

  const pinFile = path.join(root, PIN);
  const previous = readJson(pinFile);
  if (fs.existsSync(pinFile) && !upgrade) return fail(`${PIN} exists (${previous?.system ?? "?"} ${previous?.version ?? "?"}); --upgrade moves it to ${manifest.name} ${manifest.version}`, 1);
  const tokens = args.list("--tokens");
  if (!tokens.length && !previous?.tokens?.length) return fail("--tokens names the repo's token files, where the installed system defines its raw values");
  const missing = tokens.filter((t) => !fs.existsSync(path.join(root, t)));
  if (missing.length) return fail(`no such token file in the repo: ${missing.join(", ")}`);
  const include = args.list("--include"), exclude = args.list("--exclude");
  const next = buildPin(manifest, profile, { tokens: tokens.length ? tokens : undefined, include: include.length ? include : undefined, exclude: exclude.length ? exclude : undefined }, previous);

  const did = [];
  writeJsonLike(pinFile, next);
  did.push(`${upgrade && previous ? "moved" : "wrote"} ${PIN} (${next.system} ${next.version}${previous ? `, was ${previous.version}` : ""})`);
  for (const [rel, write] of [
    [CHECKER, (file) => fs.copyFileSync(CHECKER_ASSET, file)],
    [RULES, (file) => fs.writeFileSync(file, `${rulesHeader(manifest, profile)}\n\n${rules.replace(/\r\n/g, "\n").replace(/\n*$/, "\n")}`)],
  ]) {
    const file = path.join(root, rel);
    if (fs.existsSync(file) && !upgrade) { did.push(`kept ${rel} (it exists; --upgrade replaces it)`); continue; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    write(file);
    did.push(`wrote ${rel}`);
  }

  const pkgFile = path.join(root, "package.json");
  const command = fs.existsSync(pkgFile) ? "npm run design:check" : `node ${CHECKER}`;
  if (fs.existsSync(pkgFile)) {
    const before = fs.readFileSync(pkgFile, "utf8");
    const pkg = readJson(pkgFile);
    if (!pkg) did.push("left package.json alone (it does not parse)");
    else if (pkg.scripts?.["design:check"]) did.push("kept the design:check script package.json has");
    else { writeJsonLike(pkgFile, { ...pkg, scripts: { ...pkg.scripts, "design:check": `node ${CHECKER}` } }, before); did.push("added the design:check script to package.json"); }
  }
  const manifestFile = path.join(root, ".agents", "manifest.json");
  if (fs.existsSync(manifestFile)) {
    const before = fs.readFileSync(manifestFile, "utf8");
    const repo = readJson(manifestFile);
    if (!repo) did.push("left .agents/manifest.json alone (it does not parse)");
    else if (repo.lanes?.design) did.push("kept the design lane .agents/manifest.json has");
    else { writeJsonLike(manifestFile, { ...repo, lanes: { ...repo.lanes, design: command } }, before); did.push(`added the design lane (${command}) to .agents/manifest.json`); }
  }
  out(did.map((d) => `- ${d}`).join("\n"));
  out(`Run the check: ${command}`);
  return 0;
}

/** The profile, the pin, and whether they agree; the checker against the plugin's copy. */
function status({ profile, root, opts, json, out }) {
  const pinned = readJson(path.join(root, PIN));
  let manifest = null, problem = null;
  if (profile) { try { manifest = resolveManifest(profile, opts).manifest; } catch (e) { problem = e.message; } }
  const checker = fs.existsSync(path.join(root, CHECKER)) ? (sha(path.join(root, CHECKER)) === sha(CHECKER_ASSET) ? "current" : "behind") : "missing";
  const agree = Boolean(pinned && manifest && pinned.system === manifest.name && pinned.version === manifest.version);
  const report = {
    profile: profile ? { source: profile.source ?? null, ref: profile.ref ?? null, describes: Boolean(profile.manifest) } : null,
    system: manifest ? { name: manifest.name, version: manifest.version } : null,
    problem,
    pin: pinned ? { system: pinned.system ?? null, version: pinned.version ?? null, ref: pinned.ref ?? null } : null,
    checker: pinned ? checker : null,
    agree,
  };
  if (json) out(JSON.stringify(report, null, 2));
  else {
    out(profile ? `Profile: ${profile.source ?? "(no source)"}${profile.ref ? ` at ${profile.ref}` : ""}${manifest ? `, ${manifest.name} ${manifest.version}` : ""}.` : "Profile: none on this machine.");
    if (problem) out(`The system could not be read: ${problem}`);
    out(pinned ? `Pin: ${pinned.system} ${pinned.version}${pinned.ref ? ` at ${pinned.ref}` : ""}; checker ${checker}.` : `Pin: none (${PIN} is not in this repo).`);
    if (pinned && manifest) out(agree ? "They agree." : `They differ: the repo is on ${pinned.system} ${pinned.version}, the profile names ${manifest.name} ${manifest.version}.`);
  }
  return pinned && manifest && !agree ? 1 : pinned && checker === "behind" ? 1 : 0;
}

const invoked = (() => { try { return fs.realpathSync(process.argv[1] ?? "") === fs.realpathSync(import.meta.filename); } catch { return false; } })();
if (invoked) process.exitCode = await main(process.argv.slice(2));
