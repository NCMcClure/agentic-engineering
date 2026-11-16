#!/usr/bin/env node
// Plan-tree structural verifier, count-agnostic. Read-only, Node 22 stdlib only.
// Validates the `.agents/plan/plan/` epic -> sprint -> issue tree authored by
// the `plan-decompose` skill.
//
// Exits 0 on a clean pass, 1 on warnings only, 2 on any critical violation.
// Critical = broken structure, a missing required field, or an unresolved link.
//
// Steady-state success reports the discovered counts:
//   OK: 3 epics, 11 sprints, 84 issues, 0 broken links, 0 missing fields
import fs from "node:fs";
import path from "node:path";

const PLAN_ROOT = import.meta.dirname; //     .agents/plan/plan/
const PLAN_DIR = path.dirname(PLAN_ROOT); //  .agents/plan/

const ISSUE_FILENAME_RE = /^[0-9]{2}_issue_[A-Z][A-Z0-9-]+\.md$/;
const REQUIRED_ISSUE_FIELDS = [
  "**Sprint**", "**Type**", "**Status**",
  "## Parent", "## What to build", "## Acceptance criteria",
  "## Testing checkpoint", "## Blocked by",
];
// `**GitHub**:` is the name the tracker field had before 5.0; either passes.
const TRACKER_FIELD_RE = /\*\*(?:Tracker|GitHub)\*\*:[ \t]*(\S+)?/;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
// `yes - <surface>` or `no - internal`. A dash of any length, a comma or a
// colon separates the two halves.
const USER_FACING_RE = /^\*\*User-facing\*\*:\s*(yes\s*[\u2014\u2013,:-]\s*\S.*|no\s*[\u2014\u2013,:-]\s*internal)\s*$/m;
const PLAN_FORMAT_RE = /plan-format:\s*(\d+)\.(\d+)/;
const SECTION_RE = (name) => new RegExp(`^## ${name}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");

const read = (p) => fs.readFileSync(p, "utf8");
const exists = (p) => fs.existsSync(p);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const entries = (p) => (isDir(p) ? fs.readdirSync(p, { withFileTypes: true }) : []);
const subdirs = (p) => entries(p).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const subfiles = (p) => entries(p).filter((e) => e.isFile()).map((e) => e.name).sort();
const rel = (p) => path.relative(PLAN_DIR, p);

/**
 * True when the plan root index carries a `plan-format: 3.7` (or later) marker,
 * which spec-init scaffolds. A marked tree hard-fails the User-facing rule; an
 * unmarked tree (hand-built, or older than the marker) only warns.
 */
function strictFormat() {
  const indexMd = path.join(PLAN_ROOT, "index.md");
  if (!exists(indexMd)) return false;
  const m = PLAN_FORMAT_RE.exec(read(indexMd));
  return Boolean(m) && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 7));
}

export function verify() {
  const failures = [];
  const warnings = []; // exit 1 when there are no failures
  const strict = strictFormat();
  const fail = (p, msg) => failures.push(`${rel(p)}: ${msg}`);
  const report = (p, msg, critical) => (critical ? failures : warnings).push(`${rel(p)}: ${msg}`);

  const epicDirs = subdirs(PLAN_ROOT).filter((n) => /^\d{2}-/.test(n)).map((n) => path.join(PLAN_ROOT, n));
  const epicMds = epicDirs.map((d) => path.join(d, "epic.md"));
  const sprintMds = [];
  const issueMds = [];

  // An empty plan tree (no epics yet) is a valid post-init state: epics arrive
  // with the plan-decompose skill. Report zero counts rather than failing.
  for (const epicDir of epicDirs) {
    if (!exists(path.join(epicDir, "epic.md"))) { failures.push(`${rel(epicDir)}: missing epic.md`); continue; }
    for (const sName of subdirs(epicDir).filter((n) => /^\d{2}-/.test(n))) {
      const sprintDir = path.join(epicDir, sName);
      const sprintMd = path.join(sprintDir, "sprint.md");
      if (!exists(sprintMd)) { failures.push(`${rel(sprintDir)}: missing sprint.md`); continue; }
      sprintMds.push(sprintMd);

      const issuesDir = path.join(sprintDir, "issues");
      if (!isDir(issuesDir)) { failures.push(`${rel(sprintDir)}: missing issues/ directory`); continue; }
      for (const name of subfiles(issuesDir)) {
        if (!name.endsWith(".md")) continue;
        const issueFile = path.join(issuesDir, name);
        if (!ISSUE_FILENAME_RE.test(name)) fail(issueFile, "filename does not match pattern NN_issue_SLUG.md");
        issueMds.push(issueFile);
      }
    }
  }

  // Per-issue required fields, tracker ref shape, and link integrity.
  for (const issueMd of issueMds) {
    const text = read(issueMd);
    for (const required of REQUIRED_ISSUE_FIELDS) {
      if (!text.includes(required)) fail(issueMd, `missing required field/section: ${required}`);
    }

    const type = /\*\*Type\*\*:\s*(\S+)/.exec(text)?.[1];
    if (type && !["AFK", "HITL", "REVIEW"].includes(type)) fail(issueMd, `Type must be AFK, HITL, or REVIEW (got '${type}')`);

    // The User-facing line is required on AFK and HITL issues; a REVIEW issue
    // builds nothing. Critical on a marked tree, a warning on an unmarked one.
    if ((type === "AFK" || type === "HITL") && !USER_FACING_RE.test(text)) {
      report(issueMd, "missing or malformed **User-facing** line (expected 'yes - <surface>' or 'no - internal')", strict);
    }

    // `#NNN` once published; a local-markdown plan may name the issue `local:<handle>`.
    const tracker = TRACKER_FIELD_RE.exec(text);
    if (!tracker) fail(issueMd, "missing required field/section: **Tracker**");
    else if (!tracker[1] || (tracker[1] !== "<unassigned>" && !/^#\d+$/.test(tracker[1]) && !tracker[1].startsWith("local:"))) {
      fail(issueMd, "Tracker field is neither '<unassigned>' nor a '#NNN' reference");
    }

    const block = SECTION_RE("Blocked by").exec(text);
    if (block) {
      for (const [, , link] of block[1].matchAll(MD_LINK_RE)) {
        if (link.startsWith("http")) continue;
        if (!exists(path.resolve(path.dirname(issueMd), link))) fail(issueMd, `Blocked-by link does not resolve: ${link}`);
      }
    }

    const wtb = SECTION_RE("What to build").exec(text);
    if (wtb) {
      for (const [, , link] of wtb[1].matchAll(MD_LINK_RE)) {
        if (!link.includes("spec/")) continue;
        if (!exists(path.resolve(path.dirname(issueMd), link))) fail(issueMd, `spec anchor does not resolve: ${link}`);
      }
    }
  }

  // Sprint -> issues integrity: table rows match the files on disk.
  for (const sprintMd of sprintMds) {
    const text = read(sprintMd);
    const inTable = [...new Set([...text.matchAll(/\(issues\/([^)]+)\)/g)].map((m) => m[1]))].sort();
    const onDisk = subfiles(path.join(path.dirname(sprintMd), "issues")).filter((n) => n.endsWith(".md"));
    const missing = inTable.filter((n) => !onDisk.includes(n));
    const extra = onDisk.filter((n) => !inTable.includes(n));
    if (missing.length) fail(sprintMd, `sprint.md lists issues not on disk: ${JSON.stringify(missing)}`);
    if (extra.length) fail(sprintMd, `issues on disk not listed in sprint.md: ${JSON.stringify(extra)}`);
  }

  // Epic -> sprint integrity.
  for (const epicMd of epicMds) {
    if (!exists(epicMd)) continue;
    const text = read(epicMd);
    const inTable = [...new Set([...text.matchAll(/\((\d{2}-[a-z0-9-]+)\/sprint\.md\)/g)].map((m) => m[1]))].sort();
    const onDisk = subdirs(path.dirname(epicMd)).filter((n) => /^\d{2}-/.test(n));
    const missing = inTable.filter((n) => !onDisk.includes(n));
    const extra = onDisk.filter((n) => !inTable.includes(n));
    if (missing.length) fail(epicMd, `epic.md lists sprint dirs not on disk: ${JSON.stringify(missing)}`);
    if (extra.length) fail(epicMd, `sprint dirs on disk not listed in epic.md: ${JSON.stringify(extra)}`);
  }

  for (const w of warnings) console.log(`WARN: ${w}`);
  if (failures.length) {
    for (const f of failures) console.log(`FAIL: ${f}`);
    console.log(`\n${failures.length} failure(s), ${warnings.length} warning(s)`);
    return 2;
  }
  console.log(`OK: ${epicMds.length} epics, ${sprintMds.length} sprints, ${issueMds.length} issues, `
    + `0 broken links, 0 missing fields${warnings.length ? `, ${warnings.length} warning(s)` : ""}`);
  return warnings.length ? 1 : 0;
}

const realpath = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realpath(process.argv[1]) === realpath(import.meta.filename)) process.exitCode = verify();
