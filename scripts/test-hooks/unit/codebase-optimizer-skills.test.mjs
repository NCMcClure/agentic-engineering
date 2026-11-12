// codebase-optimizer's skills, read as an agent's listing reads them: a name
// that matches its folder, the four frontmatter keys and no others, a
// description that says when to reach for it, and no path, link, script flag or
// workflow argument in a body that does not exist. Then the ask-first guard
// itself: the two workflows that change a repo, started without approval.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseFrontmatter, walk } from "../../lib.mjs";
import { REPO } from "./helpers.mjs";

const PLUGIN = path.join(REPO, "plugins", "codebase-optimizer");
const SKILLS = path.join(PLUGIN, "skills");
const ALLOWED_KEYS = ["name", "description", "disable-model-invocation", "argument-hint"];
const SCRIPTS = "skills/codebase-organizer/scripts";
const WORKFLOWS = {
  plan: "skills/codebase-organizer/workflows/organize-plan.js",
  apply: "skills/codebase-organizer/workflows/organize-apply.js",
  engine: "skills/optimize-codebase/workflows/optimize-codebase.js",
};
const read = (rel) => fs.readFileSync(path.join(PLUGIN, ...rel.split("/")), "utf8");

const names = fs.readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const skills = names.map((name) => {
  const file = path.join(SKILLS, name, "SKILL.md");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return { name, dir: path.join(SKILLS, name), text, frontmatter: parseFrontmatter(text) };
});
/** Every markdown file the plugin ships, as [plugin-relative path, text]. */
const pages = walk(PLUGIN).filter((f) => f.endsWith(".md")).map((f) => [f.split(path.sep).join("/"), fs.readFileSync(path.join(PLUGIN, f), "utf8")]);

test("the plugin ships exactly its three skills", () => {
  assert.deepEqual(names, ["codebase-organizer", "improve-codebase-architecture", "optimize-codebase"]);
});

for (const skill of skills) {
  test(`${skill.name}: the frontmatter names the skill and carries only the allowed keys`, () => {
    assert.ok(skill.frontmatter, "SKILL.md starts with a frontmatter block");
    assert.equal(skill.frontmatter.name, skill.name, "the name is the folder's");
    for (const key of Object.keys(skill.frontmatter)) assert.ok(ALLOWED_KEYS.includes(key), `frontmatter key "${key}"`);
    assert.notEqual(skill.frontmatter["disable-model-invocation"], "true", "all three are picked by the model; the gate is the approval, not the listing");
  });

  test(`${skill.name}: the description says when to trigger`, () => {
    const description = skill.frontmatter?.description ?? "";
    assert.ok(description.length >= 80, "long enough to tell this skill from its neighbours");
    assert.ok(description.length <= 700, `${description.length} characters: a listing pays for every one`);
    assert.match(description, /\bUse (when|on)\b/, "it says when to use it, not only what it is");
    assert.doesNotMatch(description, /\/[a-z-]+:[a-z-]+/, "a listing does not send the model to another plugin's skill");
  });

  test(`${skill.name}: every plugin-root path it names exists`, () => {
    const found = [...skill.text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1].replace(/[.,;:]+$/, ""));
    for (const rel of found) assert.ok(fs.existsSync(path.join(PLUGIN, rel)), `\${CLAUDE_PLUGIN_ROOT}/${rel}`);
    if (skill.name !== "improve-codebase-architecture") assert.ok(found.length > 0, "a skill that runs a workflow names it by plugin-root path");
  });

  test(`${skill.name}: every file it mentions by a skill-relative path exists`, () => {
    for (const m of skill.text.matchAll(/`((?:references|scripts|workflows|assets)\/[A-Za-z0-9_.-]+)`/g)) {
      assert.ok(fs.existsSync(path.join(skill.dir, m[1])) || fs.existsSync(path.join(SKILLS, "codebase-organizer", m[1])), m[1]);
    }
  });
}

test("every relative markdown link in the plugin lands on a file inside the plugin", () => {
  let links = 0;
  for (const [rel, text] of pages) {
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1].split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const full = path.resolve(PLUGIN, path.posix.dirname(rel), target);
      assert.ok(full.startsWith(PLUGIN + path.sep), `${rel}: ${target} leaves the plugin`);
      assert.ok(fs.existsSync(full), `${rel}: ${target}`);
      links++;
    }
  }
  assert.ok(links >= 10, "the links were found at all");
});

test("the two workflow-bearing skills and the fan-out in the third point at the fallback reference", () => {
  assert.ok(fs.existsSync(path.join(PLUGIN, "references", "subagent-fallback.md")));
  for (const rel of ["skills/codebase-organizer/SKILL.md", "skills/optimize-codebase/SKILL.md", "skills/improve-codebase-architecture/SKILL.md", "skills/improve-codebase-architecture/INTERFACE-DESIGN.md"]) {
    assert.match(read(rel), /\]\(\.\.\/\.\.\/references\/subagent-fallback\.md\)/, rel);
  }
});

test("no page names a script, a finding or a workflow argument that is gone", () => {
  const gone = [/repo_scan\.py/, /verify_source_structure/, /verify_agents_hubs/, /hubVerifyCommand/, /\bhubVerifier\b/, /claude-md-not-symlink/, /claude_md_optin/, /agents-root\.md/, /\bpython3\b.*recon/];
  for (const [rel, text] of pages.filter(([rel]) => rel !== "CHANGELOG.md")) {
    for (const pattern of gone) assert.doesNotMatch(text, pattern, rel);
  }
  for (const rel of Object.values(WORKFLOWS)) {
    for (const pattern of gone.slice(0, 8)) assert.doesNotMatch(read(rel), pattern, rel);
  }
});

test("every script a page or a workflow runs is one the plugin ships", () => {
  const shipped = fs.readdirSync(path.join(PLUGIN, ...SCRIPTS.split("/"))).sort();
  assert.deepEqual(shipped, ["repo-scan.mjs", "verify-hubs.mjs", "verify-structure.mjs"]);
  const sources = [...pages, ...Object.values(WORKFLOWS).map((rel) => [rel, read(rel)])];
  for (const [rel, text] of sources) {
    for (const m of text.matchAll(/\b([a-z][a-z-]*\.mjs)\b/g)) assert.ok(shipped.includes(m[1]), `${rel}: ${m[1]}`);
  }
});

test("every flag a page or a workflow passes a script is one the script takes", () => {
  const flags = {
    "repo-scan.mjs": ["--overstuffed", "--max-list", "--large-min", "--large-cap", "--exclude"],
    "verify-hubs.mjs": ["--json", "--require-hubs"],
    "verify-structure.mjs": ["--subtree", "--flat-max", "--module-max", "--exclude", "--strict", "--json"],
  };
  for (const [script, known] of Object.entries(flags)) {
    const source = read(`${SCRIPTS}/${script}`);
    for (const flag of known) assert.ok(source.includes(`"${flag}"`), `${script} takes ${flag}`);
  }
  const sources = [...pages.filter(([rel]) => rel !== "CHANGELOG.md"), ...Object.values(WORKFLOWS).map((rel) => [rel, read(rel)])];
  let seen = 0;
  for (const [rel, text] of sources) {
    for (const line of text.split("\n")) {
      // The command, from `node` to the end of its code span, fence line or quoted shell string.
      for (const m of line.matchAll(/\bnode\b[^`']*?\b(repo-scan|verify-hubs|verify-structure)\.mjs([^`']*)/g)) {
        for (const flag of m[2].match(/--[a-z][a-z-]*/g) ?? []) {
          assert.ok(flags[`${m[1]}.mjs`].includes(flag), `${rel}: ${m[1]}.mjs ${flag}`);
          seen++;
        }
      }
    }
  }
  assert.ok(seen >= 8, `the commands were found at all (${seen})`);
});

test("every argument a skill passes a workflow is one the workflow reads", () => {
  const calls = [
    ["skills/codebase-organizer/SKILL.md", "organize-plan.js", WORKFLOWS.plan],
    ["skills/codebase-organizer/SKILL.md", "organize-apply.js", WORKFLOWS.apply],
    ["skills/optimize-codebase/SKILL.md", "optimize-codebase.js", WORKFLOWS.engine],
  ];
  for (const [page, script, workflow] of calls) {
    const text = read(page);
    const at = text.indexOf(`workflows/${script}"`);
    assert.ok(at > 0, `${page} calls ${script}`);
    const block = text.slice(at, text.indexOf("```", at));
    // An argument is a camelCase key at the start of a line, commented out or not.
    const passed = [...block.matchAll(/^\s*(?:\/\/\s*)?([a-z][A-Za-z]*):/gm)].map((m) => m[1]).filter((k) => !["args", "scriptPath"].includes(k));
    assert.ok(passed.includes("projectDir") && passed.length >= 5, `${page}: ${passed.join(", ")}`);
    const source = read(workflow);
    for (const key of passed) assert.ok(new RegExp(`\\bA\\.${key}\\b|HAS\\('${key}'\\)`).test(source), `${script} reads ${key}`);
  }
});

test("the engine hands the organizer's workflows the approval and the twin setting it was given", () => {
  const engine = read(WORKFLOWS.engine);
  assert.match(engine, /workflow\(\{ scriptPath: PLAN_JS \}, \{[^}]*claudeMd: CLAUDE_MD[^}]*\}\)/);
  assert.match(engine, /workflow\(\{ scriptPath: APPLY_JS \}, \{[^}]*approved: APPROVED[^}]*\}\)/);
});

// A workflow script is the body of an async function the host calls with its
// tools in scope. Run one the same way, with tools that record what was asked.
// `agent` answers a call (prompt, options); with none given, every agent
// returns the smallest value its schema accepts.
const AsyncFunction = (async () => {}).constructor;
function minimal(schema) {
  if (!schema) return null;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "object" || schema.properties) return Object.fromEntries((schema.required ?? []).map((key) => [key, minimal(schema.properties?.[key])]));
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return true;
  return schema.type === "number" || schema.type === "integer" ? 0 : "x";
}
async function runWorkflow(rel, args, { agent = () => null, workflow = () => null } = {}) {
  const calls = [];
  const prompts = {};
  const tools = {
    args,
    agent: async (prompt, options = {}) => {
      const label = options.label ?? "agent";
      calls.push(label);
      prompts[label] = prompt;
      return agent(prompt, options);
    },
    phase: () => {}, log: () => {},
    parallel: async (thunks) => Promise.all(thunks.map((thunk) => thunk())),
    pipeline: async () => null,
    workflow: async (ref, given) => { calls.push(`workflow:${path.posix.basename(ref.scriptPath)}`); return workflow(ref, given); },
    budget: { total: 0, remaining: () => Infinity },
  };
  const body = read(rel).replace(/^export const meta/m, "const meta");
  const result = await new AsyncFunction(...Object.keys(tools), body)(...Object.values(tools));
  return { result, calls, prompts };
}

test("ask first: the apply workflow touches nothing until it is told the plan was approved", async () => {
  for (const args of [{ projectDir: "/repo" }, { projectDir: "/repo", approved: "yes" }, JSON.stringify({ projectDir: "/repo", approved: false })]) {
    const { result, calls } = await runWorkflow(WORKFLOWS.apply, args);
    assert.equal(result.aborted, "Approval");
    assert.match(result.reason, /^Nothing was changed\./);
    assert.match(result.reason, /approved: true/);
    assert.deepEqual(calls, [], "no agent was started");
  }
});

test("ask first: approved, the apply workflow starts with its preflight and stops there when the tree is not ready", async () => {
  const { result, calls } = await runWorkflow(WORKFLOWS.apply, { projectDir: "/repo", approved: true }, { agent: () => ({ ok: false, detail: "dirty: a.txt" }) });
  assert.deepEqual(calls, ["preflight"]);
  assert.deepEqual([result.aborted, result.reason], ["Preflight", "dirty: a.txt"]);
});

test("ask first: the engine changes nothing until it is told the run plan was approved", async () => {
  const args = { projectDir: "/repo", dateToday: "2026-01-01", skillDir: "/plugin/skills/improve-codebase-architecture" };
  const { result, calls } = await runWorkflow(WORKFLOWS.engine, args);
  assert.match(result.error, /^not approved, nothing was changed/);
  assert.deepEqual(calls, []);
});

test("the planning workflow needs no approval: it is read-only, and says so to every agent it starts", async () => {
  const source = read(WORKFLOWS.plan);
  assert.doesNotMatch(source, /A\.approved/);
  assert.match(source, /^  description: 'Read-only:/m);
  const { result, calls } = await runWorkflow(WORKFLOWS.plan, {});
  assert.match(result.error, /projectDir is required/);
  assert.deepEqual(calls, []);
});

// The engine, driven end to end with stand-ins: every agent answers with the
// smallest value its schema accepts (so every check "passes"), the planning
// workflow returns a one-move plan once, and the apply workflow says whether
// its verification was green.
const ENGINE_ARGS = {
  projectDir: "/repo", dateToday: "2026-01-01", approved: true, ecosystem: "python", testCmdPrefix: "pytest",
  skillDir: "/plugin/skills/improve-codebase-architecture", organizerSkillDir: "/plugin/skills/codebase-organizer",
  structVerifier: "/plugin/skills/codebase-organizer/scripts/verify-structure.mjs",
  scanScript: "/plugin/skills/codebase-organizer/scripts/repo-scan.mjs",
};
function engineRun(args, { green }) {
  const given = [];
  let plans = 0;
  const run = runWorkflow(WORKFLOWS.engine, { ...ENGINE_ARGS, ...args }, {
    agent: (prompt, options) => {
      const answer = minimal(options.schema);
      if (/^(structure-|org-audit)/.test(options.label ?? "")) return { summary: { critical: 0, warning: 2, info: 1 }, findings: [{ severity: "WARNING", check: "HUB_MISSING", path: "src/AGENTS.md", message: "no hub" }, { severity: "INFO", check: "OVERSIZED_MODULE", path: "src/big.py", message: "long" }] };
      return answer;
    },
    workflow: (ref, passed) => {
      given.push([path.posix.basename(ref.scriptPath), passed]);
      if (ref.scriptPath.endsWith("organize-plan.js")) {
        const moves = plans++ ? [] : [{ from: "a.py", to: "src/a.py" }];
        return { plan_path: passed.planPath, plan: { summary: "nest a.py", moves, hubs: [], new_files: [], cruft: { quarantine: [], gitignore: [] }, critique: { verdict: "sound", risks: [] } } };
      }
      return { moved: 1, quarantined: [], references_rewritten: 0, hubs_written: 0, structure_summary: { critical: green ? 0 : 1, warning: 0, info: 0, failing: green ? [] : ["HUB_LOOSE_CODE AGENTS.md"] }, verification: { passed: green, detail: green ? "green" : "structure gate exit 2" } };
    },
  });
  return run.then((r) => ({ ...r, given }));
}

test("engine: an ORGANIZE round that reds is reverted, the stage stops, and the plan is kept", async () => {
  const { result, calls, prompts, given } = await engineRun({ stages: ["organize"] }, { green: false });
  assert.deepEqual(given.map(([script]) => script), ["organize-plan.js", "organize-apply.js"]);
  assert.equal(given[0][1].claudeMd, "detect");
  assert.equal(given[1][1].approved, true);

  assert.ok(calls.includes("revert:org1.1"), calls.join(", "));
  assert.ok(!calls.some((label) => label.startsWith("commit:org")), "a red round is never committed");
  assert.match(prompts["revert:org1.1"], /FAILED its build\/test check or its structure gate/);
  assert.match(prompts["revert:org1.1"], /WITHOUT destroying pre-existing untracked content/);

  const [pass] = result.details.organize;
  assert.equal(pass.convergence, "verify-failed");
  assert.equal(pass.rounds_applied, 0);
  assert.deepEqual(pass.rounds, [{
    round: 1, stage: "verify", moves_applied: 1,
    verification: { passed: false, detail: "structure gate exit 2" },
    structure_summary: { critical: 1, warning: 0, info: 0, failing: ["HUB_LOOSE_CODE AGENTS.md"] },
    unresolved_references: [], reverted: true, plan_path: "/repo.optimize-codebase-plans/plan-pass1-iter1.json",
  }]);
});

test("engine: a green ORGANIZE round is committed and nothing is reverted", async () => {
  const { result, calls } = await engineRun({ stages: ["organize"] }, { green: true });
  assert.ok(calls.includes("commit:org1.1"), calls.join(", "));
  assert.ok(!calls.some((label) => label.startsWith("revert:")));
  assert.equal(result.details.organize[0].rounds[0].verify_passed, true);
  assert.equal(result.organize.total_moves, 1);
});

test("engine: the structure gate is run for a baseline and a final state, and reported by severity", async () => {
  const { result, calls, prompts } = await engineRun({}, { green: true });
  assert.ok(calls.indexOf("structure-baseline") > -1 && calls.indexOf("structure-baseline") < calls.indexOf("structure-final"));
  assert.ok(prompts["structure-baseline"].includes(`node "${ENGINE_ARGS.structVerifier}" . --json --subtree src`), "the gate is run on the detected source root");
  assert.match(prompts["structure-baseline"], /Its exit code is 1 when there are warnings and 2 when a finding is CRITICAL: that is its verdict/);
  assert.deepEqual(result.structure, {
    baseline: { critical: 0, warning: 2, info: 1 },
    final: { critical: 0, warning: 2, info: 1 },
    remaining: ["WARNING HUB_MISSING at src/AGENTS.md"],
  });
  assert.equal("hubs" in result, false);
});

test("engine: with no structure gate passed, the structure checks are skipped and the run still finishes", async () => {
  const { result, calls } = await engineRun({ structVerifier: "", stages: ["organize"] }, { green: true });
  assert.ok(!calls.some((label) => label.startsWith("structure-")));
  assert.equal(result.structure, null);
  assert.equal(result.stop_reason, "complete");
});
