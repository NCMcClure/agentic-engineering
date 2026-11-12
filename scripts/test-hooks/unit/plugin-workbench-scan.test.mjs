// plugin-workbench's scanner and scorer. Two things are pinned to the digit:
// what the scan reports for a plugin that has one of everything, and what the
// scorer makes of a fixed set of grades. A published scorecard carries those
// numbers, so a refactor that moves one has changed a verdict somebody read.
// The rest covers the checks that hold a plugin to the marketplace's own
// rules, and the command line.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { hookCommand, parseHookCommand } from "../../lib.mjs";
import { runScan, runScore } from "../../../plugins/plugin-workbench/core/scripts/plugin-scan.mjs";
import { REPO, runNode, tempDir, write } from "./helpers.mjs";

const WORKBENCH = path.join(REPO, "plugins", "plugin-workbench");
const SCAN = path.join(WORKBENCH, "core", "scripts", "plugin-scan.mjs");

/** A plugin directory named `name` holding `files` (relative path to contents). */
function pluginAt(t, name, files) {
  const dir = path.join(tempDir(t, "plugin-scan-"), name);
  for (const [rel, content] of Object.entries(files)) write(dir, rel, content);
  return dir;
}

// ---- the pinned plugin ---------------------------------------------------
// Spelled in pieces, so this file carries no machine path of its own.
const MACHINE_PATH = ["", "Users", "someone", "checkout", "notes.txt"].join("/");
const ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

/** A plugin with one of everything the scanner reads, good and bad. */
function pinnedFiles() {
  const fence = ["```html", ...Array.from({ length: 41 }, (_, i) => `<p>row ${i}</p>`), "```"].join("\n");
  return {
    ".claude-plugin/plugin.json": JSON.stringify({ name: "pinned", version: "1.4.0", description: "Pins what the scanner reports.", author: { name: "Sam Example" }, keywords: ["a", "b"] }, null, 2) + "\n",
    "README.md": "# pinned\n\nWhat it is. See CHANGELOG.md.\n\n## Install\n\n```text\n/plugin install pinned@somewhere\n```\n\n## Skills\n\nTwo.\n",
    "CHANGELOG.md": "# Changelog\n\n- **1.4.0**: the current release.\n- **1.3.0**: the one before.\n",
    "CLAUDE.md": "# never loaded from a plugin\n",
    ".DS_Store": "junk",
    ".mcp.json": "{\"mcpServers\": {}}\n",
    "agents/reviewer.md": "---\nname: reviewer\ndescription: Reviews one file at a time and reports what it found in a fixed shape.\n---\n\nReview it.\n",
    "commands/go.md": "Run the thing.\n",
    "hooks/hooks.json": JSON.stringify({ hooks: {
      SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: `bash "${ROOT_VAR}/hooks/start.sh"` }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `python3 ${ROOT_VAR}/hooks/missing.py --strict` }, { type: "prompt", prompt: "Is this safe?" }] }],
    } }, null, 2) + "\n",
    "hooks/start.sh": "#!/bin/sh\necho ready\n",
    "skills/alpha/SKILL.md": [
      "---",
      "name: alpha",
      "description: >",
      "  Use when the first thing needs doing,",
      "  or the person asks for alpha.",
      "when_to_use: \"Also when beta is busy.\"",
      "license: MIT",
      "---",
      "",
      "# alpha",
      "",
      "Read [the notes](references/notes.md), then [a missing file](references/gone.md),",
      "and never [this one](../../../outside.md). The [site](https://example.com) is not a file.",
      "",
      "Run `scripts/count.py`.",
      "",
      fence,
      "",
      "Workflow({ scriptPath: \"x\" })",
      "",
    ].join("\n"),
    "skills/alpha/references/notes.md": "# notes\n\nKept short.\n",
    "skills/alpha/scripts/count.py": "import sys\nprint(len(sys.argv))\n",
    "skills/alpha/scripts/unmentioned.py": "print('nobody calls this')\n",
    "skills/alpha/workflows/alpha.js": [
      "export const meta = {",
      "  name: 'alpha',",
      "  phases: [{ title: 'Scan' }, { title: 'Grade' }],",
      "}",
      "let A = args",
      "if (typeof A === 'string') { A = JSON.parse(A) }",
      "phase('Scan')",
      "const one = await agent('look', { model: 'haiku', schema: {} })",
      "phase('Report')",
      "// all findings are needed before the dedupe",
      "const many = (await parallel([() => agent('a', { model: 'opus' }), () => agent('b')])).filter(Boolean)",
      "log(`${many.length} back at ${Date.now()}`)",
      "return { one, many }",
      "",
    ].join("\n"),
    "skills/beta/SKILL.md": "---\nname: beta\ndescription: Does the second thing by hand.\ndisable-model-invocation: true\nargument-hint: \"<target> [--fast]\"\n---\n\n# beta\n\nOne step.\n\n*Done when: it ran.*\n",
    "docs/paths.md": `Installed at ${MACHINE_PATH} on my machine.\nRuns ${ROOT_VAR}/../sibling/run.sh afterwards.\n`,
    "assets/template.html": "<html></html>\n",
    "misc/stray.txt": "nothing points here\n",
  };
}

// What the scan of that plugin has to carry. Every value here is one a
// scorecard has shown; the scan may say more, never something else.
const PINNED = {
  manifest: { present: true, parse_ok: true, name: "pinned", version: "1.4.0", version_semver_ok: true, description_chars: 30, author_ok: true, keywords: 2, name_matches_dir: true, missing_fields: [] },
  components: { skills: 2, commands: 1, agents: 1, hooks: true, mcp: true, workflows: 1, scripts: 3, script_files: ["hooks/start.sh", "skills/alpha/scripts/count.py", "skills/alpha/scripts/unmentioned.py"], monitors: false, bin: false, assets_or_templates_dirs: ["assets"], output_styles: 0, settings_json: false, root_claude_md: true },
  skills: [
    { name: "alpha", path: "skills/alpha/SKILL.md", frontmatter: { parse_ok: true, fields: ["name", "description", "when_to_use", "license"], unknown_fields: [] }, model_invoked: true, user_invocable: true, description_chars: 67, when_to_use_chars: 23, combined_chars: 90, over_1536: false, body_lines: 55, body_chars: 816, est_passive_tokens: 22, est_body_tokens: 204, big_fenced_blocks: [41], md_links: ["references/notes.md", "references/gone.md", "../../../outside.md"], broken_links: ["references/gone.md", "../../../outside.md"], sibling_files_unlinked: ["skills/alpha/scripts/unmentioned.py", "skills/alpha/workflows/alpha.js"] },
    { name: "beta", path: "skills/beta/SKILL.md", frontmatter: { parse_ok: true, fields: ["name", "description", "disable-model-invocation", "argument-hint"], unknown_fields: [] }, model_invoked: false, user_invocable: true, description_chars: 30, when_to_use_chars: 0, combined_chars: 30, over_1536: false, body_lines: 8, body_chars: 42, est_passive_tokens: 0, est_body_tokens: 10, big_fenced_blocks: [], md_links: [], broken_links: [], sibling_files_unlinked: [] },
  ],
  agents_passive: [{ agent: "reviewer.md", description_chars: 70, est_passive_tokens: 17 }],
  context_footprint: {
    passive_tokens_est: 69,
    per_source: [{ source: "skills/alpha/SKILL.md (description)", tokens: 22 }, { source: "agents/reviewer.md (description)", tokens: 17 }, { source: ".mcp.json tool names (deferred schemas)", tokens: 30 }],
    cap_violations: [],
    on_invoke: [{ skill: "skills/alpha/SKILL.md", body_tokens_est: 204, body_lines: 55, over_500_lines: false }, { skill: "skills/beta/SKILL.md", body_tokens_est: 10, body_lines: 8, over_500_lines: false }],
  },
  hooks: {
    present: true, parse_ok: true, hook_count: 3, events: ["PreToolUse", "SessionStart"],
    entries: [
      { event: "SessionStart", matcher: "startup", type: "command", command: `bash "${ROOT_VAR}/hooks/start.sh"`, uses_plugin_root: true, referenced_file_exists: true, injects_context: true },
      { event: "PreToolUse", matcher: "Bash", type: "command", command: `python3 ${ROOT_VAR}/hooks/missing.py --strict`, uses_plugin_root: true, referenced_file_exists: false, injects_context: false },
      { event: "PreToolUse", matcher: "Bash", type: "prompt", command: "", uses_plugin_root: false, referenced_file_exists: null, injects_context: true },
    ],
    context_injectors: 2, missing_referenced_files: [`python3 ${ROOT_VAR}/hooks/missing.py --strict`],
  },
  workflow_static: [{ path: "skills/alpha/workflows/alpha.js", meta_ok: true, meta_name: "alpha", phase_titles: ["Scan", "Grade"], phase_calls: ["Scan", "Report"], phase_title_mismatch: ["Report"], has_args_coercion: true, uses_date_now: true, uses_math_random: false, uses_new_date: false, agent_calls: 3, agent_calls_with_schema: 1, models: { haiku: 1, sonnet: 0, opus: 1, omitted: 1 }, parallel_calls: 1, parallel_with_nearby_comment: 1, filter_boolean_uses: 1, log_calls: 1 }],
  lint: { absolute_paths: [{ file: "docs/paths.md", line: 1, match: MACHINE_PATH }], parent_escapes: [{ file: "docs/paths.md", line: 2, match: `Runs ${ROOT_VAR}/../sibling/run.sh afterwards.` }], plugin_root_uses: 3, plugin_data_uses: 0, cruft: [".DS_Store"], own_marketplace_json: false },
  tree: { total_files: 19, max_depth: 4, by_top_dir: { ".DS_Store": 1, ".claude-plugin": 1, ".mcp.json": 1, "CHANGELOG.md": 1, "CLAUDE.md": 1, "README.md": 1, agents: 1, assets: 1, commands: 1, docs: 1, hooks: 2, misc: 1, skills: 6 }, overstuffed_dirs: [] },
  readme: { present: true, lines: 14, headings: ["pinned", "Install", "Skills"], has_install_heading: true },
  orphans: [".DS_Store", ".mcp.json", "agents/reviewer.md", "assets/template.html", "commands/go.md", "docs/paths.md", "misc/stray.txt", "skills/alpha/scripts/unmentioned.py"],
  applicable_judgment_checks: ["AN1", "AN3", "AN4", "CF3", "CF5", "CS1", "CS2", "CS4", "CS5", "CS6", "MH2", "MH4", "SQ1", "SQ2", "SQ3", "SQ4", "SQ5", "SQ6", "WQ3", "WQ4", "WQ5", "WQ6"],
  per_skill_checks: ["SQ1", "SQ2", "SQ3", "SQ4", "SQ5", "SQ6"],
};
const PINNED_GRADES = { SQ7: 0, CS3: 0, WQ1: 2, WQ2: 0, AN2: 0, AN5: 0, CF1: 4, CF2: 4, CF4: 4, MH1: 4 };

/** Every value `expected` names is in `actual` at the same place; `actual` may hold more keys. */
function assertCarries(actual, expected, at = "scan") {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${at} is not a list`);
    assert.equal(actual.length, expected.length, `${at} has ${actual.length} item(s): ${JSON.stringify(actual)}`);
    expected.forEach((item, i) => assertCarries(actual[i], item, `${at}[${i}]`));
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `${at} is not an object`);
    for (const [key, value] of Object.entries(expected)) assertCarries(actual[key], value, `${at}.${key}`);
  } else {
    assert.equal(actual, expected, at);
  }
}

test("the scan of a plugin with one of everything reports the pinned facts", (t) => {
  const scan = runScan(pluginAt(t, "pinned", pinnedFiles()));
  assertCarries(scan, PINNED);
  for (const [check, grade] of Object.entries(PINNED_GRADES)) assert.equal(scan.mechanical_grades[check].grade, grade, `${check}: ${scan.mechanical_grades[check].basis}`);
  assert.deepEqual(scan.gates.map((g) => [g.id, g.cap]), [["abs-path", "rework"]]);
  assert.deepEqual(scan.na.dimensions, []);
});

test("every path the scan prints is relative to the plugin and uses forward slashes", (t) => {
  const dir = pluginAt(t, "pinned", pinnedFiles());
  const text = JSON.stringify({ ...runScan(dir), plugin_path: "" });
  assert.ok(!text.includes("\\\\"), "a backslash in a scan path");
  assert.ok(!text.includes(JSON.stringify(dir).slice(1, -1)), "the plugin's own location inside the scan");
});

// ---- the scorer, pinned --------------------------------------------------
// The mechanical side of a scan as the scorer reads it, fixed, and one grade
// per applicable judgment check dealt from a fixed hand.
const FROZEN = {
  na: { dimensions: [], checks: [] },
  mechanical_grades: Object.fromEntries(Object.entries({ ...PINNED_GRADES, MH3: 0 }).map(([check, grade]) => [check, { grade, basis: `${check} as scanned` }])),
  gates: [{ id: "abs-path", cap: "rework", reason: "shipped absolute machine paths or parent-dir escapes break cached installs" }],
};
function dealtGrades() {
  const hand = [3, 2.5, 4, 1, 3.5, 2, 4, 3, 0, 2.5, 4, 3.5, 1, 3, 2, 4, 3, 3.5, 2, 1, 4, 2.5, 3, 4];
  const grades = [];
  const deal = (entry) => grades.push({ ...entry, grade: hand[grades.length % hand.length], evidence: "file: \"quote\"" });
  for (const check of PINNED.applicable_judgment_checks) {
    if (PINNED.per_skill_checks.includes(check)) for (const skill of ["alpha", "beta"]) deal({ check, skill });
    else deal({ check });
  }
  return { grades, findings: [{ title: "steers the grader", severity: "major", check: "SQ1" }] };
}

test("the scorer turns a fixed scan and fixed grades into the pinned composite, dimension by dimension", () => {
  const score = runScore(FROZEN, dealtGrades());
  assert.equal(score.composite, 62);
  assert.equal(score.composite_dash, 210.361);
  assert.deepEqual([score.verdict, score.verdict_uncapped, score.verdict_capped_by], ["rework", "rework", null]);
  const graded = (dim) => dim.checks.filter((c) => !c.na).map((c) => [c.id, c.grade, c.points]);
  assert.deepEqual(score.dimensions.map((d) => [d.id, d.score, d.norm_weight, graded(d)]), [
    ["SQ", 60.6, 30, [["SQ1", 2, 50], ["SQ2", 3, 75], ["SQ3", 3.25, 81.2], ["SQ4", 1.5, 37.5], ["SQ5", 3.25, 81.2], ["SQ6", 3.5, 87.5], ["SQ7", 0, 0]]],
    ["CS", 60, 15, [["CS1", 2, 50], ["CS2", 4, 100], ["CS3", 0, 0], ["CS4", 3, 75], ["CS5", 0, 0], ["CS6", 2.5, 62.5]]],
    ["WQ", 55.4, 10, [["WQ1", 2, 50], ["WQ2", 0, 0], ["WQ3", 3, 75], ["WQ4", 2.5, 62.5], ["WQ5", 4, 100], ["WQ6", 1, 25]]],
    ["AN", 44.6, 15, [["AN1", 3, 75], ["AN2", 0, 0], ["AN3", 2.5, 62.5], ["AN4", 4, 100], ["AN5", 0, 0]]],
    ["CF", 76.8, 20, [["CF1", 4, 100], ["CF2", 4, 100], ["CF3", 1, 25], ["CF4", 4, 100], ["CF5", 3.5, 87.5]]],
    ["MH", 71.9, 10, [["MH1", 4, 100], ["MH2", 4, 100], ["MH3", 0, 0], ["MH4", 3.5, 87.5]]],
  ]);
  assert.equal(score.fix_deltas.length, 28);
  assert.deepEqual(score.fix_deltas.slice(0, 6), [
    { check: "CF3", kind: "j", delta: 4.2, verdict_after: "rework" },
    { check: "AN2", kind: "m", delta: 4.2, verdict_after: "rework" },
    { check: "SQ1", skill: "alpha", kind: "j", delta: 2.5, verdict_after: "rework" },
    { check: "MH3", kind: "m", delta: 2.5, verdict_after: "rework" },
    { check: "SQ7", kind: "m", delta: 2.3, verdict_after: "rework" },
    { check: "AN5", kind: "m", delta: 2.1, verdict_after: "rework" },
  ]);
  // A mechanical check the scan did not grade is listed as not applicable, never as a zero.
  assert.deepEqual(score.dimensions.flatMap((d) => d.checks.filter((c) => c.na).map((c) => c.id)), ["SQ8", "CS7", "WQ7", "MH5"]);
});

// One dimension, two checks of equal weight: the composite is 12.5 * (SQ6 + 4),
// which lands on or beside a rounding tie for each of these grades.
test("a composite on a rounding tie goes to the even tenth, and one beside a tie is not mistaken for it", () => {
  const lone = (grade) => runScore({
    na: { dimensions: ["CS", "WQ", "AN", "CF", "MH"], checks: ["SQ1", "SQ2", "SQ3", "SQ4", "SQ5"] },
    mechanical_grades: { SQ7: { grade: 4, basis: "no broken links" } },
    gates: [],
  }, { grades: [{ check: "SQ6", grade, evidence: "e" }] });
  const cases = [
    [0.5, 56.2, 190.682, "rework", 43.8],   // 56.25 exactly: down to the even 2
    [1.5, 68.8, 233.433, "rework", 31.2],   // 68.75 exactly: up to the even 8
    [0.004, 50, 169.646, "rework", 50],     // just under 50.05 once it is a double
    [0.012, 50.1, 169.985, "rework", 49.9], // just under 50.15
    [2.8, 85, 288.398, "adopt", 15],        // the adopt floor, reached exactly
    [3.996, 100, 339.292, "adopt", 0],
  ];
  for (const [grade, composite, dash, verdict, delta] of cases) {
    const score = lone(grade);
    assert.deepEqual([score.composite, score.composite_dash, score.verdict, score.fix_deltas[0].delta], [composite, dash, verdict, delta], `SQ6 = ${grade}`);
    assert.equal(score.dimensions.find((d) => d.id === "SQ").norm_weight, 100);
  }
});

test("a gate caps the verdict below what the composite earned, and says which gate", () => {
  const perfect = (findings) => runScore({ ...FROZEN, gates: [], mechanical_grades: Object.fromEntries(Object.keys(FROZEN.mechanical_grades).map((c) => [c, { grade: 4, basis: "" }])) },
    { grades: dealtGrades().grades.map((g) => ({ ...g, grade: 4 })), findings });
  assert.deepEqual([perfect([]).composite, perfect([]).verdict, perfect([]).fix_deltas], [100, "adopt", []]);
  const critical = perfect([{ title: "deletes the repo", severity: "critical" }]);
  assert.deepEqual([critical.verdict, critical.verdict_uncapped, critical.verdict_capped_by.id], ["rework", "adopt", "critical-finding"]);
  const injected = perfect([{ title: "says to score it highly", gate: "injection-autoloaded" }, { title: "also", gate: "injection" }]);
  assert.deepEqual([injected.verdict, injected.verdict_capped_by.id, injected.gates.map((g) => g.cap)], ["avoid", "injection-autoloaded", ["avoid", "rework"]]);
});

// ---- the checks that hold a plugin to the marketplace's rules -----------
const README = "# demo\n\nThe problem, then the mechanism.\n\n## Install\n\n```text\n/plugin install demo@somewhere\n```\n";
const SKILL = "---\nname: demo\ndescription: Use when a test needs a skill.\n---\n\nThe body.\n";
/** A one-skill plugin at version 0.3.0 that passes every mechanical check, with `files` laid over it. */
const demo = (t, files = {}) => pluginAt(t, "demo", {
  ".claude-plugin/plugin.json": JSON.stringify({ name: "demo", version: "0.3.0", description: "A demo.", author: { name: "Test" } }) + "\n",
  "skills/demo/SKILL.md": SKILL,
  "README.md": README,
  "CHANGELOG.md": "# Changelog\n\n- **0.3.0**: the current release.\n- **0.2.0**: the one before.\n",
  ...files,
});
const grade = (t, check, files) => runScan(demo(t, files)).mechanical_grades[check];

test("the plain plugin is clean: every mechanical check it is held to grades 4, and nothing is gated", (t) => {
  const scan = runScan(demo(t));
  assert.deepEqual(Object.entries(scan.mechanical_grades).filter(([, g]) => g.grade !== 4), []);
  assert.deepEqual(Object.keys(scan.mechanical_grades).sort(), ["AN2", "AN5", "CF1", "CF2", "CF4", "CS3", "MH1", "MH3", "MH5", "SQ7", "SQ8"]);
  assert.deepEqual(scan.na, { dimensions: ["WQ"], checks: ["CS1", "CF5", "CS4", "CS7", "WQ7"] });
  assert.deepEqual([scan.gates, scan.orphans], [[], []]);
});

test("MH3 reads CHANGELOG.md: 4 when its first bullet opens with the manifest version, bold or plain", (t) => {
  assert.deepEqual(grade(t, "MH3"), { grade: 4, basis: "CHANGELOG.md top 0.3.0 == manifest" });
  assert.equal(grade(t, "MH3", { "CHANGELOG.md": "# Changelog\n\n* v0.3.0: plain, starred, with a v.\n" }).grade, 4);
});

test("MH3 is 2 when the top entry is another version, or opens with none", (t) => {
  const stale = grade(t, "MH3", { "CHANGELOG.md": "# Changelog\n\n- **0.2.0**: a release the manifest has moved past.\n" });
  assert.deepEqual([stale.grade, stale.basis], [2, "CHANGELOG.md top entry (0.2.0) != manifest (0.3.0)"]);
  // The first bullet is the top entry, whatever a heading above it says.
  const headed = grade(t, "MH3", { "CHANGELOG.md": "# Changelog\n\n## 0.3.0\n\n- added a thing\n- **0.3.0**: too late\n" });
  assert.deepEqual([headed.grade, headed.basis], [2, "CHANGELOG.md's first entry does not start with a version"]);
});

test("MH3 is 2 while the README still carries a Changelog section, and 0 when the README is all there is", (t) => {
  const both = grade(t, "MH3", { "README.md": `${README}\n## Changelog\n\n- 0.3.0: kept here too.\n` });
  assert.equal(both.grade, 2);
  assert.match(both.basis, /README still carries a "## Changelog" section/);
  const only = runScan(pluginAt(t, "demo", { ".claude-plugin/plugin.json": JSON.stringify({ name: "demo", version: "0.3.0", description: "A demo.", author: { name: "Test" } }), "skills/demo/SKILL.md": SKILL, "README.md": `${README}\n## Changelog\n\n- 0.3.0: kept in the README.\n` }));
  assert.deepEqual([only.mechanical_grades.MH3.grade, only.changelog], [0, { present: false }]);
  assert.match(only.mechanical_grades.MH3.basis, /^no CHANGELOG\.md \(a README changelog does not count\)$/);
  // A heading that merely mentions the word is not the section.
  assert.equal(grade(t, "MH3", { "README.md": `${README}\n### Changelog format\n\nOne line per release.\n` }).grade, 4);
});

test("CS3: CHANGELOG.md is structural like README.md; one or two orphans grade 2, three grade 0", (t) => {
  assert.deepEqual(runScan(demo(t)).orphans, []);
  const two = runScan(demo(t, { "notes/a.txt": "a\n", "notes/b.txt": "b\n" }));
  assert.deepEqual([two.orphans, two.mechanical_grades.CS3.grade], [["notes/a.txt", "notes/b.txt"], 2]);
  assert.equal(grade(t, "CS3", { "notes/a.txt": "a\n", "notes/b.txt": "b\n", "notes/c.txt": "c\n" }).grade, 0);
});

test("SQ8: a frontmatter key beyond the four costs the skill, and the scan names the key", (t) => {
  const withKeys = (keys) => `---\nname: demo\ndescription: Use when a test needs a skill.\n${keys}---\n\nThe body.\n`;
  const allFour = runScan(demo(t, { "skills/demo/SKILL.md": withKeys("disable-model-invocation: true\nargument-hint: \"<x>\"\n") }));
  assert.deepEqual([allFour.skills[0].frontmatter.extra_fields, allFour.mechanical_grades.SQ8.grade], [[], 4]);
  const one = runScan(demo(t, { "skills/demo/SKILL.md": withKeys("license: MIT\nallowed-tools: Read\n") }));
  assert.deepEqual(one.skills[0].frontmatter.extra_fields, ["allowed-tools", "license"]);
  assert.deepEqual(one.skills[0].frontmatter.unknown_fields, [], "both are keys a host reads; SQ8 is the stricter list");
  assert.equal(one.mechanical_grades.SQ8.grade, 2);
  assert.match(one.mechanical_grades.SQ8.basis, /skills\/demo\/SKILL\.md: allowed-tools, license/);
  const two = grade(t, "SQ8", { "skills/demo/SKILL.md": withKeys("model: haiku\n"), "skills/other/SKILL.md": "---\nname: other\ndescription: Use when a second skill is needed.\nuser-invocable: false\n---\n\nBody.\n" });
  assert.equal(two.grade, 0);
});

// The commands are built by the function hooks.json is written with, so the
// scanner is checked against the gate's own idea of a guarded command.
const hooksJson = (map) => ({ "hooks/hooks.json": `${JSON.stringify({ hooks: map }, null, 2)}\n`, "hooks/start.mjs": "process.exitCode = 0;\n", "skills/demo/SKILL.md": `${SKILL}\nThe hook is hooks/start.mjs.\n` });
const hook = (command, extra = {}) => ({ hooks: [{ type: "command", command, ...extra }] });

test("CS7: Node hooks behind the guard grade 4, and the scan reads each guard as the gate does", (t) => {
  const loud = hookCommand("demo", "hooks/start.mjs", { loud: true });
  const quiet = hookCommand("demo", "hooks/start.mjs", { args: ["--event=pre"] });
  const scan = runScan(demo(t, hooksJson({ SessionStart: [hook(loud, { statusMessage: "Starting" })], SubagentStart: [hook(quiet)], PreToolUse: [hook(quiet)] })));
  assert.deepEqual(scan.mechanical_grades.CS7, { grade: 4, basis: "0/3 Node hook command(s) off the guard: []" });
  assert.deepEqual(scan.hooks.entries.map((e) => [e.event, e.runs_node, e.node_guard, e.plain_node_call, e.status_message]),
    [["SessionStart", true, "loud", true, true], ["SubagentStart", true, "quiet", true, false], ["PreToolUse", true, "quiet", true, false]]);
  for (const command of [loud, quiet]) assert.equal(scan.hooks.entries.find((e) => command.startsWith(e.command.slice(0, 190)))?.node_guard, parseHookCommand(command, "demo").guard);
  assert.ok(!scan.na.checks.includes("CS7"));
  assert.ok(loud.length > 200 || scan.hooks.entries[0].command === loud, "the guard is read from the whole command, not the 200 characters the scan prints");
});

test("CS7: no guard, a quiet guard at SessionStart, no status message, and a wrapped call are each a finding", (t) => {
  const bare = `node "${ROOT_VAR}/hooks/start.mjs"`;
  const quiet = hookCommand("demo", "hooks/start.mjs");
  const loud = hookCommand("demo", "hooks/start.mjs", { loud: true });
  const problems = (map) => runScan(demo(t, hooksJson(map))).hooks.unguarded_node_commands.map((p) => `${p.event}: ${p.problem}`);
  assert.deepEqual(problems({ PreToolUse: [hook(bare)] }), ["PreToolUse: no guard for a machine without Node"]);
  assert.deepEqual(problems({ SessionStart: [hook(quiet, { statusMessage: "Starting" })] }), ["SessionStart: SessionStart needs the guard that tells the person Node is missing"]);
  assert.deepEqual(problems({ SessionStart: [hook(loud)] }), ["SessionStart: SessionStart command has no statusMessage"]);
  assert.deepEqual(problems({ Stop: [hook(`${quiet} || true`)] }), [`Stop: not a guard followed by node "${ROOT_VAR}/<file>"`]);
  assert.equal(grade(t, "CS7", hooksJson({ PreToolUse: [hook(bare)] })).grade, 2);
  assert.equal(grade(t, "CS7", hooksJson({ PreToolUse: [hook(bare)], Stop: [hook(bare)] })).grade, 0);
});

test("CS7 has nothing to judge when no hook runs Node", (t) => {
  const scan = runScan(demo(t, { "hooks/hooks.json": JSON.stringify({ hooks: { Stop: [hook(`bash "${ROOT_VAR}/hooks/stop.sh"`)] } }), "hooks/stop.sh": "#!/bin/sh\n# debt: one line of shell, rewrite it when it grows a second\nexit 0\n", "skills/demo/SKILL.md": `${SKILL}\nThe hook is hooks/stop.sh.\n` }));
  assert.ok(scan.na.checks.includes("CS7"));
  assert.equal(scan.mechanical_grades.CS7, undefined);
  assert.equal(scan.hooks.node_commands, 0);
});

const WORKFLOW = "export const meta = { name: 'demo', phases: [{ title: 'Go' }] }\nlet A = args\nif (typeof A === 'string') { A = JSON.parse(A) }\nphase('Go')\nreturn {}\n";
const calling = (tail) => ({ "skills/demo/workflows/demo.js": WORKFLOW, "skills/demo/SKILL.md": `${SKILL}\nWorkflow({ scriptPath: "workflows/demo.js" })\n${tail}` });

test("WQ7: a skill that calls Workflow() names a subagent fallback, or loses the check", (t) => {
  const bare = runScan(demo(t, calling("")));
  assert.deepEqual([bare.mechanical_grades.WQ7.grade, bare.skills[0].mentions_workflow_tool, bare.skills[0].names_subagent_fallback], [2, true, false]);
  assert.match(bare.mechanical_grades.WQ7.basis, /1\/1 skill\(s\) call Workflow\(\) with no subagent fallback named: \["skills\/demo\/SKILL\.md"\]/);
  const named = runScan(demo(t, calling("\nWith no Workflow tool, run the phases with subagents.\n")));
  assert.equal(named.mechanical_grades.WQ7.grade, 4);
  assert.deepEqual(named.na.dimensions, []);
});

test("WQ7 is not applicable where no skill reaches for the tool", (t) => {
  const scan = runScan(demo(t, { "skills/demo/workflows/demo.js": WORKFLOW, "skills/demo/SKILL.md": `${SKILL}\nSee workflows/demo.js.\n` }));
  assert.ok(scan.na.checks.includes("WQ7"));
  assert.equal(scan.mechanical_grades.WQ7, undefined);
  assert.equal(scan.mechanical_grades.WQ1.grade, 4);
});

test("MH5: a script that is not Node fails the check unless the file declares itself as debt", (t) => {
  const mention = { "skills/demo/SKILL.md": `${SKILL}\nRuns scripts/count.py, scripts/tidy.sh and scripts/go.mjs.\n` };
  const drift = runScan(demo(t, { ...mention, "scripts/count.py": "print(1)\n", "scripts/tidy.sh": "#!/bin/sh\nexit 0\n", "scripts/go.mjs": "console.log(1);\n" }));
  assert.equal(drift.mechanical_grades.MH5.grade, 0);
  assert.deepEqual(drift.components.non_node_scripts, ["scripts/count.py", "scripts/tidy.sh"]);
  assert.deepEqual(drift.components.script_files, ["scripts/count.py", "scripts/go.mjs", "scripts/tidy.sh"]);
  const declared = runScan(demo(t, { ...mention, "scripts/count.py": "# debt: needs numpy, drop it when the count moves to Node\nprint(1)\n", "scripts/tidy.sh": "#!/bin/sh\n# debt: three lines of shell, rewrite at the fourth\nexit 0\n", "scripts/go.mjs": "console.log(1);\n" }));
  assert.equal(declared.mechanical_grades.MH5.grade, 4);
  assert.match(declared.mechanical_grades.MH5.basis, /^0 shipped script\(s\) .*; 2 declared exception\(s\): \["scripts\/count\.py","scripts\/tidy\.sh"\]$/);
});

test("MH5 judges a file with no extension by its shebang, and leaves workflows and page scripts out", (t) => {
  const scan = runScan(demo(t, {
    "skills/demo/SKILL.md": `${SKILL}\nRuns bin/run and bin/setup; the page is assets/page.js; see workflows/demo.js and LICENSE.\n`,
    "bin/run": "#!/usr/bin/env node\nconsole.log(1);\n",
    "bin/setup": "#!/bin/bash\nexit 0\n",
    "LICENSE": "MIT\n",
    "skills/demo/assets/page.js": "document.title = 'x';\n",
    "skills/demo/workflows/demo.js": WORKFLOW,
  }));
  assert.deepEqual(scan.components.script_files, ["bin/run", "bin/setup"]);
  assert.deepEqual(scan.components.non_node_scripts, ["bin/setup"]);
  assert.deepEqual(scan.components.browser_assets, ["skills/demo/assets/page.js"]);
  assert.deepEqual([scan.components.workflows, scan.mechanical_grades.MH5.grade], [1, 0]);
});

test("the workbench passes the mechanical checks it applies to others", () => {
  const scan = runScan(WORKBENCH);
  const short = Object.entries(scan.mechanical_grades).filter(([check, g]) => g.grade !== 4 && check !== "CF1");
  assert.deepEqual(short, []);
  assert.ok(scan.mechanical_grades.CF1.grade >= 3, scan.mechanical_grades.CF1.basis);
  assert.deepEqual([scan.gates, scan.orphans, scan.components.non_node_scripts], [[], [], []]);
  assert.equal(scan.skills.length, 5);
});

// ---- the command line ----------------------------------------------------
test("scan mode prints the profile as JSON and exits 0", (t) => {
  const dir = demo(t);
  const result = runNode(SCAN, [dir]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), JSON.parse(JSON.stringify(runScan(dir))));
});

test("score mode wants every applicable judgment check, and lists the ones it did not get", (t) => {
  const dir = demo(t);
  const scan = runScan(dir);
  const all = { grades: scan.applicable_judgment_checks.map((check) => ({ check, grade: 3, evidence: "f: \"q\"", ...(scan.per_skill_checks.includes(check) ? { skill: "demo" } : {}) })) };
  const file = write(dir, "../grades.json", JSON.stringify(all));
  for (const args of [[dir, "--score", file], ["--score", file, dir], [dir, `--score=${file}`]]) {
    const scored = runNode(SCAN, args);
    assert.equal(scored.status, 0, scored.stderr);
    const score = JSON.parse(scored.stdout);
    assert.deepEqual([score.verdict, score.dimensions.find((d) => d.id === "WQ").applicable], ["adopt-with-fixes", false]);
    assert.equal(score.dimensions.reduce((n, d) => n + d.norm_weight, 0).toFixed(1), "100.0", "the weights of the applicable dimensions are renormalized to 100");
  }
  const partial = runNode(SCAN, [dir, "--score", write(dir, "../partial.json", JSON.stringify({ grades: all.grades.filter((g) => !["SQ4", "MH2"].includes(g.check)) }))]);
  assert.equal(partial.status, 1);
  assert.equal(partial.stdout, "");
  assert.match(partial.stderr, /^error: grades\.json is missing grades for applicable judgment checks: MH2, SQ4\./);
});

test("score mode rejects a check it does not know and a grade outside 0 to 4", (t) => {
  const dir = demo(t);
  const run = (grades) => runNode(SCAN, [dir, "--score", write(dir, "../bad.json", JSON.stringify({ grades }))]);
  const unknown = run([{ check: "ZZ9", grade: 3 }]);
  assert.deepEqual([unknown.status, unknown.stderr.trim()], [1, "error: unknown check id in grades.json: ZZ9"]);
  for (const bad of [5, -1, "3", null]) {
    const result = run([{ check: "SQ1", grade: bad }]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), `error: grade for SQ1 must be a number 0-4, got ${JSON.stringify(bad)}`);
  }
});

test("a target that is not a directory exits 1; a missing or surplus argument exits 2 with the usage", (t) => {
  const dir = demo(t);
  const missing = runNode(SCAN, [path.join(dir, "nowhere")]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^error: not a directory: /);
  const unreadable = runNode(SCAN, [dir, "--score", path.join(dir, "no-grades.json")]);
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /^error: cannot read grades file /);
  for (const args of [[], ["--score"], [dir, dir], [dir, "--verbose"]]) {
    const result = runNode(SCAN, args);
    assert.equal(result.status, 2, JSON.stringify(args));
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /usage: node plugin-scan\.mjs <plugin_path> \[--score <grades\.json>\]/);
  }
  const help = runNode(SCAN, ["--help"]);
  assert.deepEqual([help.status, help.stdout.trim()], [0, "usage: node plugin-scan.mjs <plugin_path> [--score <grades.json>]"]);
});

test("a manifest that is missing, broken, or not an object is a gate, not a crash", (t) => {
  const bare = runScan(pluginAt(t, "bare", { "skills/demo/SKILL.md": SKILL }));
  assert.deepEqual([bare.manifest, bare.gates.map((g) => g.id), bare.mechanical_grades.MH1.grade], [{ present: false, parse_ok: false, missing_fields: ["<file>"] }, ["manifest"], 0]);
  for (const text of ["{ not json", "[]", "\"a string\"", "null"]) {
    const scan = runScan(pluginAt(t, "odd", { ".claude-plugin/plugin.json": text, "skills/demo/SKILL.md": SKILL }));
    assert.deepEqual(scan.manifest, { present: true, parse_ok: false, missing_fields: ["<unparseable>"] }, text);
  }
});

test("a SKILL.md saved with CRLF line endings still has its frontmatter read", (t) => {
  const scan = runScan(demo(t, { "skills/demo/SKILL.md": SKILL.replace(/\n/g, "\r\n") }));
  assert.deepEqual([scan.skills[0].frontmatter.parse_ok, scan.skills[0].frontmatter.fields, scan.skills[0].description_chars], [true, ["name", "description"], 30]);
});
