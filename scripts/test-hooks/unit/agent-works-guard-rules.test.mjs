// agent-works guard rules, called in-process: readers, the git asks, generated
// files, resource locks (warned by default, refused on request), run budgets,
// a project's own rules and what they see of a command's environment. Strings
// and plain objects in, decisions out: nothing here touches a file or git.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { REPO } from "./helpers.mjs";

const load = (rel) => import(pathToFileURL(path.join(REPO, "plugins", "agent-works", rel)).href);
const rules = await load("lib/guard-rules.mjs");
const { defaults, merge } = await load("lib/config.mjs");
const { commandWords, shellWords } = await load("hooks/shell-words.mjs");

const cfgWith = (over) => merge(defaults(), over);
const ENFORCE = { guard: { locks: "deny" } };

/** The facts of a call: a branch, a root, and `locks` as `{ resource: the agent holding it }`. */
function factsOf({ locks = {}, ...over } = {}) {
  return {
    branch: "feat/x", agent: null, root: "/srv/work/acme",
    lockHolders: (agent, names) => ({
      holders: Object.fromEntries(names.filter((n) => locks[n]).map((n) => [n, locks[n]])),
      mine: new Set(names.filter((n) => agent && locks[n] === agent)),
    }),
    ...over,
  };
}
const run = (command, cfg = defaults(), tool = "Bash", env = {}) => rules.decide(tool, { command }, cfg, factsOf(env));
const rule = (command, cfg, tool, env) => run(command, cfg, tool, env)?.rule ?? null;
const kind = (command, cfg, tool, env) => run(command, cfg, tool, env)?.kind ?? null;
const allowed = (commands, cfg, tool, env) => {
  for (const c of commands) assert.equal(run(c, cfg, tool, env), null, c);
};

test("agent-works guard: commands that only read or print are readers", () => {
  const words = (c) => commandWords(shellWords(c)[0]);
  for (const c of ["git log --grep push", "git -C x show HEAD", "grep -rn foo .", "X=1 cat file", "sed -n 1,3p f",
    "Get-Content f", "gh pr view 1", "find . -name x", "git commit -m 'run the tool'", "aw note 'ran the tool'",
    'node "$CLAUDE_PLUGIN_ROOT/scripts/aw.mjs" note "ran the tool"']) {
    assert.equal(rules.isReader(words(c)), true, c);
  }
  for (const c of ["git push", "sed -i s/a/b/ f", "find . -delete", "python tool.py", "& 'C:/x/tool.exe' run", "git stash", "node tool.mjs"]) {
    assert.equal(rules.isReader(words(c)), false, c);
  }
  assert.equal(rules.isReader([]), true);
});

test("agent-works guard: a force push is asked about, in every spelling", () => {
  for (const c of ["git push --force-with-lease origin feat/x", "git push -f", "git push --force", "git push origin +feat/x",
    "git -C sub push -uf origin x", "cd a && git push --force", 'bash -c "git push -f"',
    'powershell -Command "git push --force"', "aw lock run editor --for x -- git push -f"]) {
    const d = run(c);
    assert.deepEqual([c, d?.rule, d?.kind], [c, "force-push", "ask"]);
  }
  allowed(["git push -u origin feat/x", "git push --follow-tags", "git commit -m 'git push --force'",
    "echo git push --force", "git log --grep='push --force'", "cat <<EOF\ngit push --force\nEOF", "ls # git push --force"]);
  assert.equal(kind("git push -f", cfgWith({ guard: { defaultBranch: { forcePush: "deny" } } })), "deny");
  assert.equal(run("git push -f", cfgWith({ guard: { defaultBranch: { forcePush: "off" } } })), null);
});

test("agent-works guard: a commit on the default branch is a warning by default", () => {
  const d = run("git commit -m x", undefined, "Bash", { branch: "main" });
  assert.deepEqual([d.rule, d.kind], ["default-branch-commit", "warn"]);
  assert.match(d.message, /This commits on `main`\. Work goes on a branch/);
  const asked = cfgWith({ guard: { defaultBranch: { commit: "ask" } } });
  assert.equal(kind("git commit -m x", asked, "Bash", { branch: "main" }), "ask");
  assert.equal(rule("git add a.txt && git commit -m x", undefined, "Bash", { branch: "master" }), "default-branch-commit");
  assert.equal(rule("sleep 5 & git commit -m x", undefined, "Bash", { branch: "main" }), "default-branch-commit");
  assert.equal(run("git commit -m x", undefined, "Bash", { branch: "feat/x" }), null);
  assert.equal(run("git commit --dry-run -m x", undefined, "Bash", { branch: "main" }), null);
  assert.equal(run("git log -1 && echo git commit", undefined, "Bash", { branch: "main" }), null);
  assert.equal(run("git commit -m x", undefined, "Bash", { branch: "" }), null, "a detached HEAD is on no branch");
  const trunk = cfgWith({ guard: { defaultBranch: { names: ["trunk"], commit: "deny" } } });
  assert.equal(run("git commit -m x", trunk, "Bash", { branch: "main" }), null);
  assert.equal(kind("git commit -m x", trunk, "Bash", { branch: "trunk" }), "deny");
  // a refusal wins over a question
  assert.equal(rule("git commit -am x", undefined, "Bash", { branch: "main" }), "staging-blanket");
  assert.deepEqual(rules.decideAll("Bash", { command: "git commit -am x && git push -f" }, defaults(), factsOf({ branch: "main" })).map((x) => `${x.kind} ${x.rule}`),
    ["deny staging-blanket", "ask force-push", "warn default-branch-commit"]);
});

test("agent-works guard: the commit rule reads the branch of the checkout the commit runs in", () => {
  const MAIN = "/srv/main/acme";
  const WORK = "/srv/trees/w1";
  const branches = { [MAIN]: "main", [WORK]: "chore/x" };
  const branchAt = (dir) => Object.entries(branches).find(([top]) => dir === top || dir.startsWith(`${top}/`))?.[1] ?? null;
  const ask = (command, at, tool = "Bash") => rule(command, undefined, tool, { root: at, cwd: at, branch: branches[at], branchAt });

  // a session on main committing in a work tree on a branch
  for (const [c, tool] of [[`cd "${WORK}" && git commit -m x`], [`cd '${WORK}'; git commit -m x`],
    [`cd "${WORK}"\ngit add a.txt\ngit commit -m x`], [`pushd "${WORK}" && git commit -m x`],
    [`(cd "${WORK}/sub" && git commit -m x)`], [`git -C "${WORK}" commit -m x`],
    [`cd "${WORK}/sub" && cd .. && git commit -m x`], [`bash -c "cd '${WORK}' && git commit -m x"`],
    [`Set-Location "${WORK}"; git commit -m x`, "PowerShell"], [`Push-Location "${WORK}"; git commit -m x`, "PowerShell"]]) {
    assert.equal(ask(c, MAIN, tool), null, c);
  }
  assert.equal(ask("git commit -m x", MAIN), "default-branch-commit");
  assert.equal(ask("cd sub && git commit -m x", MAIN), "default-branch-commit");
  assert.equal(ask(`cd "${WORK}" && git status; cd "${MAIN}" && git commit -m x`, MAIN), "default-branch-commit");

  // a session on a branch committing in the main checkout
  for (const [c, tool] of [[`cd "${MAIN}" && git commit -m x`], [`git -C "${MAIN}" commit -m x`],
    [`cd "${MAIN}/sub" && git commit -m x`], [`cd "${MAIN}" && git -C sub commit -m x`],
    [`Set-Location "${MAIN}"; git commit -m x`, "PowerShell"]]) {
    assert.equal(ask(c, WORK, tool), "default-branch-commit", c);
  }
  assert.equal(ask("git commit -m x", WORK), null);
  assert.equal(ask("cd sub && git commit -m x", WORK), null);
  assert.equal(ask(`cd "${MAIN}" && git commit --dry-run -m x`, WORK), null);

  // a folder the guard cannot resolve gives no finding
  for (const c of ['cd "$WT" && git commit -m x', "cd $(git rev-parse --show-toplevel) && git commit -m x", "popd; git commit -m x",
    'git -C "$WT" commit -m x', "cd /no/such/folder/anywhere && git commit -m x", "cd ~ && git commit -m x"]) {
    assert.equal(ask(c, MAIN), null, c);
  }

  // talk about a commit is no commit
  for (const c of ["grep -rn git commit .", "echo git commit", "git log --grep 'git commit'"]) assert.equal(ask(c, MAIN), null, c);
  assert.equal(ask("CI=1 git commit -m x", MAIN), "default-branch-commit");
  assert.equal(ask("time git commit -m x", MAIN), "default-branch-commit");
});

test("agent-works guard: a generated file is not edited by hand", () => {
  const cfg = cfgWith({ guard: { generated: [
    { match: "(^|/)src/gen/", how: "Change src/schema and run `make codegen`." },
    { match: "^docs/layout\\.md$", how: "Codegen writes it." },
    { match: "([broken", how: "never matches" },
    { match: "^notes/", },
  ] } });
  const edit = (file, tool = "Edit", env = {}) => rules.decide(tool, { [tool === "NotebookEdit" ? "notebook_path" : "file_path"]: file }, cfg, factsOf(env));

  const d = edit("/srv/work/acme/pkg/src/gen/layout.h");
  assert.deepEqual([d.rule, d.kind], ["generated-file", "deny"]);
  assert.equal(d.message, "Do not edit /srv/work/acme/pkg/src/gen/layout.h by hand. Change src/schema and run `make codegen`.");
  assert.equal(edit("Q:\\work\\acme\\pkg\\src\\gen\\layout.lua", "Edit", { root: "Q:/work/acme" }).kind, "deny");
  for (const tool of ["Write", "MultiEdit", "NotebookEdit"]) assert.equal(edit("docs/layout.md", tool).rule, "generated-file", tool);
  assert.equal(edit("DOCS/Layout.md").rule, "generated-file", "a generated pattern ignores case");
  assert.match(edit("notes/a.md").message, /It is generated: change its source and run the generator\./);
  assert.equal(edit("pkg/src/schema/frame.ts"), null);
  assert.equal(edit("other/docs/layout.md"), null);
  assert.equal(rules.decide("Read", { file_path: "docs/layout.md" }, cfg, factsOf()), null);
  assert.equal(rules.decide("Edit", {}, cfg, factsOf()), null);
  assert.equal(rules.decide("Edit", "docs/layout.md", cfg, factsOf()), null);

  // relative to where the tool runs
  assert.equal(edit("gen/a.h", "Edit", { cwd: "/srv/work/acme/pkg/src" }).rule, "generated-file");
  assert.equal(edit("../gen.md", "Edit", { cwd: "/srv/work/acme/pkg/src" }), null);
  // a path handed in through a link is judged by where it leads
  assert.equal(edit("/link/to/acme/docs/layout.md", "Edit", { resolve: (p) => p.replace("/link/to", "/srv/work") }).rule, "generated-file");
  assert.equal(edit("/link/to/acme/docs/layout.md"), null);

  const { skipped } = rules.judge("Edit", { file_path: "x.md" }, cfg, factsOf());
  assert.deepEqual(skipped, ['guard.generated: "([broken" is not a regular expression']);
});

const LOCKS = {
  resources: {
    editor: { scope: "project", match: ["scripts/(render|run-tests)\\.ps1", "\\bbuild\\.sh\\b"], unless: ["(^|\\s)(-List|--dry-run)\\b"] },
    sim: { scope: "machine", match: ["run-in-session\\.ps1"] },
  },
  lockOrder: ["sim", "editor"],
};
const ED = "powershell -NoProfile -File scripts/run-tests.ps1";
const SIM = "powershell -NoProfile -File tools/run-in-session.ps1 app run demo --duration 60";

test("agent-works guard: by default a held resource is a warning, and a free one is nothing", () => {
  const cfg = cfgWith(LOCKS);
  assert.equal(rules.lockLevel(cfg), "warn");
  assert.equal(run(ED, cfg, "PowerShell"), null, "nobody holds it");
  assert.equal(run("./build.sh all", cfg), null);
  const d = run(`$env:AW_AGENT = "a1"; ${ED}`, cfg, "PowerShell", { locks: { editor: "a2" } });
  assert.deepEqual([d.kind, d.rule], ["warn", "resource-lock"]);
  assert.match(d.message, /another agent holds the lock: editor \(held by a2\)/);
  assert.match(d.message, /aw lock run editor --for "<what, how long>" -- <command>/);
  assert.equal(rules.answer(d).hookSpecificOutput.additionalContext, d.message, "the warning reaches the model");
  assert.equal(kind("./build.sh", cfg, "Bash", { locks: { editor: "a2" } }), "warn", "an unnamed caller is warned too");
  // the holder and the wrapper go through in silence
  assert.equal(run("AW_AGENT=a2 ./build.sh", cfg, "Bash", { locks: { editor: "a2" } }), null);
  assert.equal(run("aw lock run editor --for x -- ./build.sh", cfg, "Bash", { locks: { editor: "a2" } }), null);
  // only the held ones are named, in lock order
  const both = run(`${ED}; ${SIM}`, cfg, "PowerShell", { locks: { editor: "a2", sim: "a3" } });
  assert.match(both.message, /starts sim and editor,/);
  assert.match(run(`${ED}; ${SIM}`, cfg, "PowerShell", { locks: { editor: "a2" } }).message, /starts editor,/);
  // what starts nothing warns about nothing
  allowed(["cat scripts/render.ps1", "git add build.sh", "./build.sh --dry-run"], cfg, "Bash", { locks: { editor: "a2" } });
});

test("agent-works guard: guard.locks sets what a held resource gets", () => {
  const held = { locks: { editor: "a2" } };
  for (const [value, want] of [["deny", "deny"], ["enforce", "deny"], ["Enforce", "deny"], ["ask", "ask"], ["warn", "warn"], [undefined, "warn"], ["off", null], ["allow", null], [false, null]]) {
    const cfg = cfgWith({ ...LOCKS, guard: { locks: value } });
    assert.equal(rules.lockLevel(cfg), want, String(value));
    assert.equal(kind("./build.sh", cfg, "Bash", held), want, String(value));
  }
  assert.equal(kind("./build.sh", cfgWith({ ...LOCKS, guard: { locks: "ask" } })), "ask", "asked even while it is free");
  assert.equal(run("./build.sh", cfgWith({ ...LOCKS, guard: { locks: "off" } }), "Bash", held), null);
});

test("agent-works guard: with locks enforced, starting without the lock or without a name is refused", () => {
  const cfg = cfgWith({ ...LOCKS, ...ENFORCE });
  assert.equal(rule(ED, cfg, "PowerShell"), "resource-lock");
  assert.equal(kind(ED, cfg, "PowerShell"), "deny");
  assert.equal(rule(`$env:AW_AGENT = "a1"; ${ED}`, cfg, "PowerShell"), "resource-lock");
  const d = run(`$env:AW_AGENT = "a1"; ${ED}`, cfg, "PowerShell", { locks: { editor: "a2" } });
  assert.match(d.message, /"a1" does not hold the lock \(editor: held by a2\)/);
  assert.match(d.message, /aw lock run editor --for/);
  assert.match(d.message, /AW_AGENT=<name> <command> {10}PowerShell: \$env:AW_AGENT = "<name>"; <command>/);
  assert.match(run(ED, cfg, "PowerShell").message, /it does not say which agent runs it \(editor: free\)/);
  assert.equal(rule(SIM, cfg, "PowerShell", { locks: { editor: "a1" } }), "resource-lock");
  assert.equal(rule("AW_AGENT=a1 ./build.sh all", cfg, "Bash", { locks: { sim: "a1" } }), "resource-lock");
  const both = run(`${ED}; ${SIM}`, cfg, "PowerShell");
  assert.match(both.message, /starts sim and editor,/);
  assert.match(both.message, /take them in this order: sim, editor\./);
  assert.equal(rule('bash -c "./build.sh all"', cfg), "resource-lock");
  assert.equal(rule('powershell -Command "& scripts/run-tests.ps1"', cfg, "PowerShell"), "resource-lock");
  assert.equal(rule("sleep 1 & ./build.sh", cfg), "resource-lock");
});

test("agent-works guard: with locks enforced, the holder goes through", () => {
  const cfg = cfgWith({ ...LOCKS, ...ENFORCE });
  const held = { locks: { editor: "a1" } };
  assert.equal(run(`$env:AW_AGENT = "a1"; ${ED}`, cfg, "PowerShell", held), null);
  assert.equal(run("AW_AGENT=a1 ./build.sh all", cfg, "Bash", held), null);
  assert.equal(run("PL_AGENT=a1 ./build.sh all", cfg, "Bash", held), null, "the alias");
  assert.equal(run("./build.sh all", cfg, "Bash", { ...held, agent: "a1" }), null, "the session's own name");
  assert.equal(run('AW_AGENT=a1 bash -c "./build.sh all"', cfg, "Bash", held), null);
  const named = cfgWith({ ...LOCKS, guard: { agentVar: "ACME_AGENT", locks: "deny" } });
  assert.equal(run("ACME_AGENT=a1 ./build.sh", named, "Bash", held), null);
  assert.match(run("./build.sh", named).message, /ACME_AGENT=<name> <command>/);
});

test("agent-works guard: the lock wrapper holds the lock for what it runs", () => {
  const cfg = cfgWith({ ...LOCKS, ...ENFORCE });
  assert.equal(run(`aw lock run editor --for "tests, 5 min" -- ${ED}`, cfg, "PowerShell"), null);
  assert.equal(run('aw lock run editor --for "build" -- "./build.sh all && ./build.sh test"', cfg), null);
  assert.equal(run('aw lock run editor --for x -- bash -c "./build.sh all && ./build.sh test"', cfg), null);
  assert.equal(run('node "$CLAUDE_PLUGIN_ROOT/scripts/aw.mjs" lock run editor --for x -- ./build.sh', cfg), null);
  assert.equal(run("aw.cmd lock run editor --for x -- ./build.sh", cfg, "PowerShell"), null);
  assert.equal(run("aw lock run --json editor --for x -- ./build.sh", cfg), null);
  assert.equal(run("aw lock run sim --for x -- aw lock run editor --for x -- ./build.sh", cfg), null);
  // the wrong resource, or a lease, holds nothing
  assert.equal(rule("aw lock run sim --for x -- ./build.sh", cfg), "resource-lock");
  assert.equal(rule("aw lease gpu --share 0.5 --for x -- ./build.sh", cfg), "resource-lock");
  assert.equal(rule(`aw lock run editor --for x -- ./build.sh && ${SIM}`, cfg), "resource-lock", "what follows the wrapped command is its own command");
  // the wrapped command is still judged by every other rule
  assert.equal(rule("aw lock run editor --for x -- git add -A", cfg), "staging-blanket");
  assert.equal(rule("aw lease gpu --for x -- git push --force", cfg), "force-push");
  assert.equal(rule('aw lease gpu --for x -- bash -c "git push -f"', cfg), "force-push");
  assert.equal(rule("aw lock run editor --for x -- git commit -m x", cfg, "Bash", { branch: "main" }), "default-branch-commit");
  assert.deepEqual(rules.unwrapLock(["aw", "lock", "run", "editor", "--for", "x", "--", "./build.sh", "all"]),
    { held: new Set(["editor"]), segments: [["./build.sh", "all"]], wrapped: true });
  assert.deepEqual(rules.unwrapLock(["aw", "lease", "gpu", "--", "a b && c"]), { held: new Set(), segments: [["a", "b"], ["c"]], wrapped: true });
  assert.deepEqual(rules.unwrapLock(["aw", "lock", "status", "--", "x"]), { held: new Set(), segments: [["aw", "lock", "status", "--", "x"]], wrapped: false });
});

test("agent-works guard: what starts nothing needs no lock", () => {
  const cfg = cfgWith({ ...LOCKS, ...ENFORCE });
  allowed([`${ED} -List`, "./build.sh --dry-run", "git log --grep run-tests.ps1", "grep -rn build.sh .",
    'aw lock acquire editor --as a1 --for "run-tests.ps1"', 'aw note "build.sh is slow today"',
    'node "$CLAUDE_PLUGIN_ROOT/scripts/aw.mjs" note "build.sh is slow today"',
    "git commit -m 'Speed up build.sh'", "cat scripts/render.ps1", "echo ./build.sh", "make test", "ls # ./build.sh",
    "cat <<EOF\n./build.sh\nEOF"], cfg);
});

const ITEMS = Array.from({ length: 40 }, (_, i) => `item${i % 4}__view${i}`).sort();
const RUNS = cfgWith({ runs: [{
  id: "render", match: ["render\\.(py|ps1)\\b", "\\bsuite\\s+iterate\\b"], reasonVar: "AW_RUN", free: 3, fullAt: 100,
  count: { names: true, allFlags: ["--all"], groupFlag: "--group", matchFlag: "--match", valueFlags: ["--out", "--port"],
    groupsFile: "groups.json", itemsDir: "shots" },
  dryFlags: ["--dry-run", "--list", "--skip-render"],
}] });
const RUN_FACTS = {
  items: (dir) => (dir === "shots" ? ITEMS : null),
  groups: (file) => (file === "groups.json" ? { smoke: ["item1__*", "!*view5"], one: ["*view7"] } : null),
};
const budget = (command, tool = "Bash", cfg = RUNS) => run(command, cfg, tool, RUN_FACTS);

test("agent-works guard: a run budget lets up to `free` named items through", () => {
  for (const c of ["python render.py a b c", "python render.py a,b,c --out dir --port 9", "suite iterate a b", "python render.py"]) {
    assert.equal(budget(c), null, c);
  }
  const d = budget("python render.py a b c d");
  assert.deepEqual([d.kind, d.rule], ["deny", "run-budget"]);
  assert.match(d.message, /Run budget \(render\): this command asks for 4 items \(named\)\./);
  assert.match(d.message, /AW_RUN="verify: /);
  assert.match(d.message, /1-3 items that show the thing you changed/);
  assert.equal(budget("PASSES=beauty suite iterate a b c d").kind, "deny");
  assert.equal(budget('bash -c "python render.py a b c d"').kind, "deny");
  assert.equal(budget("aw lock run gpu --for x -- python render.py a b c d").rule, "run-budget");
});

test("agent-works guard: a run of everything is refused in every spelling", () => {
  for (const c of ["python render.py --all", "powershell -File render.ps1 -All", "suite iterate --all --engine x",
    "cd x && python render.py --all 2>&1 | tail -5"]) {
    const d = budget(c);
    assert.equal(d?.kind, "deny", c);
    assert.match(d.message, /"full: /, c);
    assert.match(d.message, /40 items: everything \(40\) \(all\)/, c);
  }
  // narrowed to a few it is an iteration
  assert.equal(budget("python render.py --all --match *view7"), null);
  assert.equal(budget("python render.py --all --match item1__*").kind, "deny");
});

test("agent-works guard: a run budget counts a group from its file", () => {
  assert.equal(budget("suite iterate --group one"), null);
  const d = budget("suite iterate --group smoke");
  assert.equal(d.kind, "deny");
  assert.match(d.message, /9 items \(group smoke\)/); // 10 of item1, less view5
  assert.equal(budget("suite iterate --group smoke --match *view9"), null);
  assert.equal(budget("suite iterate --group=one"), null);
  // an unknown group is refused rather than guessed
  const unknown = budget("suite iterate --group no-such-group");
  assert.equal(unknown.kind, "deny");
  assert.match(unknown.message, /a run whose size the command does not say \(group no-such-group\)/);
});

test("agent-works guard: listing, dry runs and talk about a run start nothing", () => {
  for (const c of ["python render.py --all --list", "suite iterate --all --dry-run", "suite iterate --group smoke --skip-render",
    "powershell -File render.ps1 -All -List", "suite compare --group smoke",
    "git grep -n 'render.py --all' docs", "git log --oneline -- tools/render.py", "git commit -m 'render.py --all is slow'",
    "echo python render.py --all", 'aw note "ran render.py --all"']) {
    assert.equal(budget(c), null, c);
  }
});

test("agent-works guard: a stated reason lets a larger run through and is on record", () => {
  const d = budget('$env:AW_RUN = "verify: dither works on one wheel, checking the others"; python render.py a b c d e', "PowerShell");
  assert.equal(d.kind, "warn");
  assert.match(d.notice, /5 items let through — verify: dither works on one wheel, checking the others/);
  const out = rules.answer(d);
  assert.equal(out.hookSpecificOutput.additionalContext, d.message, "the model is told it was the exception");
  assert.equal(out.systemMessage, d.notice, "and the person sees the reason");
  assert.equal(budget('AW_RUN="full: the work is finished, the one pass before the baseline" python render.py --all').kind, "warn");
  // verify does not buy everything, and a token reason buys nothing
  const verify = budget('AW_RUN="verify: checking everything after the change" python render.py --all');
  assert.equal(verify.kind, "deny");
  assert.match(verify.message, /is "verify", and this run needs "full"\./);
  const short = budget('AW_RUN="full: ok" python render.py --all');
  assert.equal(short.kind, "deny");
  assert.match(short.message, /too short/);
  assert.match(budget('AW_RUN="because I want to see it all" python render.py a b c d').message, /must start with/);
});

test("agent-works guard: without an items folder, everything needs `full`", () => {
  const cfg = cfgWith({ runs: [{ id: "t", match: ["\\bpytest\\b"], free: 5, count: { names: false, allFlags: ["--everything"] }, message: "Pick the tests that cover the change." }] });
  assert.equal(budget("pytest tests/a.py tests/b.py -k x", "Bash", cfg), null);
  const d = budget("pytest --everything", "Bash", cfg);
  assert.equal(d.kind, "deny");
  assert.match(d.message, /asks for everything \(all\)/);
  assert.match(d.message, /\nPick the tests that cover the change\.\n/);
  assert.equal(budget('AW_RUN="full: release candidate, the one pass" pytest --everything', "Bash", cfg).kind, "warn");
  assert.deepEqual(rules.countRun(["pytest", "--everything"], cfg.runs[0]), { dry: false, all: true, count: null, total: null, how: "all" });
});

const PROJECT = cfgWith({ guard: { rules: [
  { id: "no-direct-launch", decision: "deny", match: ["(^|[\\\\/\\s])sim(\\.exe)?(\\s|$)", "steam://run"], unless: ["run-in-session"], message: "Launch through the session runner." },
  { id: "live-mode", decision: "deny", match: ["--live-wheel|LIVE_MODE"], skipReaders: false, scope: "command", message: "Live mode is started by a person." },
  { id: "slow-import", decision: "warn", match: ["import\\.ps1.*\\s-All\\b.*\\s-Force\\b"], message: "Name what changed." },
  { id: "release-only", decision: "ask", match: ["\\bnpm publish\\b"], when: { branch: ["main"] }, message: "Publishing." },
  { id: "lockfile", decision: "ask", scope: "file", match: ["(^|/)package-lock\\.json$"], message: "Use npm install." },
  { id: "broken", decision: "deny", match: ["([a"], message: "never" },
  { id: "off", decision: "off", match: ["."], message: "never" },
  "not a rule",
] } });

test("agent-works guard: a project's rules read commands, not readers", () => {
  const d = run('& "C:\\Games\\sim.exe" -fast', PROJECT, "PowerShell");
  assert.deepEqual([d.rule, d.kind, d.message], ["no-direct-launch", "deny", "Launch through the session runner."]);
  assert.equal(rule("sim --headless", PROJECT), "no-direct-launch");
  assert.equal(rule("start steam://run/123", PROJECT), "no-direct-launch");
  assert.equal(rule('bash -c "sim --headless"', PROJECT), "no-direct-launch");
  assert.equal(rule("aw lock run editor --for x -- sim --headless", PROJECT), "no-direct-launch");
  assert.equal(run("powershell -File tools/run-in-session.ps1 sim --headless", PROJECT), null);
  allowed(["tasklist | grep -i sim.exe", "git log --grep 'sim --headless'", "echo sim", "git commit -m 'sim launch'"], PROJECT);
  assert.equal(run("SIM --headless", PROJECT), null, "a rule's pattern is matched as written: case counts");
  // a rule may read readers too
  assert.equal(rule("echo '{\"mode\":\"LIVE_MODE\"}' > scenario.json", PROJECT), "live-mode");
  assert.equal(rule("app run demo --live-wheel", PROJECT), "live-mode");
  assert.equal(run("app run demo", PROJECT), null);
});

test("agent-works guard: a project's rule may warn, ask, name a branch or read a file's path", () => {
  const d = run("powershell -File import.ps1 -All -Force", PROJECT, "PowerShell");
  assert.deepEqual([d.rule, d.kind], ["slow-import", "warn"]);
  assert.equal(run("npm publish", PROJECT, "Bash", { branch: "feat/x" }), null);
  assert.equal(kind("npm publish", PROJECT, "Bash", { branch: "main" }), "ask");
  const e = rules.decide("Edit", { file_path: "web/package-lock.json" }, PROJECT, factsOf());
  assert.deepEqual([e.rule, e.kind], ["lockfile", "ask"]);
  assert.equal(run("cat web/package-lock.json && rm web/package-lock.json", PROJECT), null);
  const unnamed = cfgWith({ guard: { rules: [{ match: ["\\bdeploy\\b"] }] } });
  assert.deepEqual(run("deploy now", unnamed), { kind: "deny", rule: "project-rule", message: "A project rule matched this call (guard.rules in .agents/agent-works.json)." });
});

test("agent-works guard: a pattern that does not compile is skipped and named, never thrown", () => {
  const { decisions, skipped } = rules.judge("Bash", { command: "anything at all" }, PROJECT, factsOf());
  assert.deepEqual(decisions, []);
  assert.deepEqual(skipped, ['guard.rules[broken]: "([a" is not a regular expression']);
  assert.deepEqual(rules.judge("Bash", { command: "cat x" }, PROJECT, factsOf()).skipped, [], "a pattern never asked is never named");
  // a shape the guard cannot read blocks nothing
  const cfg = cfgWith({
    resources: { a: { match: [{ unless: ["x"] }, 7, null, { pattern: "([a" }, { pattern: 3 }] }, b: { match: "build\\.sh", unless: "--dry-run" }, c: 5 },
    runs: [{ id: "r", match: [{ pattern: "([a" }, {}] }, "not a run"],
    guard: { rules: [{ id: "r", match: [{ nope: 1 }, 4] }], locks: "deny" },
  });
  assert.equal(run("anything at all 7", cfg), null);
  assert.equal(rule("./build.sh", cfg), "resource-lock"); // one string is read as a list of one
  assert.equal(run("./build.sh --dry-run", cfg), null);
  assert.deepEqual(rules.judge("Bash", { command: "x" }, cfg, factsOf()).skipped.sort(),
    ['resources.a: "([a" is not a regular expression', 'runs[r]: "([a" is not a regular expression']);
});

const marker = (skipReaders, pattern = "SAFE_MARKER") => cfgWith({
  guard: { rules: [{ id: "marker", decision: "deny", skipReaders, match: [pattern], message: "The marker stays." }] },
  runs: [{ id: "r", match: ["\\brender\\b"], reasonVar: "ACME_RUN" }],
});

test("agent-works guard: a rule about a variable sees the command set it, in every spelling", () => {
  const clears = [["SAFE_MARKER= bun run something"], ["env SAFE_MARKER= cmd"], ["export SAFE_MARKER=; cmd"], ["set SAFE_MARKER="],
    ["OTHER=1 SAFE_MARKER=0 cmd"], ["(SAFE_MARKER= cmd)"], ["cd x && SAFE_MARKER= ./tool.sh | tail -3"],
    ['bash -c "SAFE_MARKER= cmd"'], ["SAFE_MARKER= bash -c 'cmd one'"], ["SAFE_MARKER= aw lock run editor --for x -- cmd"],
    ["aw lock run editor --for x -- SAFE_MARKER= cmd"], ["aw lease gpu --for x -- SAFE_MARKER= cmd"],
    ['$env:SAFE_MARKER = ""; cmd', "PowerShell"], ['$env:SAFE_MARKER=""; cmd', "PowerShell"], ["$env:SAFE_MARKER = $null; cmd", "PowerShell"]];
  for (const skip of [false, true]) {
    for (const pattern of ["SAFE_MARKER", "\\bSAFE_MARKER="]) { // the name alone, and the name with its `=`
      for (const [c, tool] of clears) assert.equal(rule(c, marker(skip, pattern), tool), "marker", `${skip} ${pattern} ${c}`);
    }
    // what sets nothing goes through
    allowed(["cmd --flag", "OTHER=1 cmd", "env OTHER=1 cmd", "export OTHER=1", '$env:OTHER = "1"; cmd'], marker(skip));
  }
  // a reader with the prefix is a reader still, unless the rule reads readers
  assert.equal(run("SAFE_MARKER= cat notes.txt", marker(true)), null);
  assert.equal(rule("SAFE_MARKER= cat notes.txt", marker(false)), "marker");
  // scope "command" sees it too
  const whole = cfgWith({ guard: { rules: [{ id: "marker", decision: "deny", scope: "command", match: ["SAFE_MARKER=.*\\n.*deploy"] }] } });
  assert.equal(rule("SAFE_MARKER= prepare && deploy now", whole), "marker");
  assert.equal(rule('$env:SAFE_MARKER = ""; deploy now', whole, "PowerShell"), "marker");
  assert.equal(run("prepare && deploy now", whole), null);
});

test("agent-works guard: the guard's own variables are prose, and still read", () => {
  // a reason or an agent's name may use any word: it is no command and sets nothing a rule is about
  for (const skip of [false, true]) {
    for (const [c, tool] of [['AW_RUN="verify: SAFE_MARKER is back in place" tool'], ['ACME_RUN="verify: SAFE_MARKER is back in place" tool'],
      ["AW_AGENT=SAFE_MARKER tool"], ["PL_AGENT=SAFE_MARKER tool"],
      ['$env:AW_RUN = "verify: SAFE_MARKER is back in place"; tool', "PowerShell"], ['$env:AW_AGENT="SAFE_MARKER"; tool', "PowerShell"]]) {
      assert.equal(run(c, marker(skip), tool), null, `${skip} ${c}`);
    }
  }
  const editor = cfgWith({ resources: { editor: { match: ["run-tests\\.ps1"] } }, ...ENFORCE });
  assert.equal(run('$env:AW_RUN = "verify: run-tests.ps1 passes alone"; ./other.ps1', editor, "PowerShell"), null);
  // the reason is still read, and the agent's name too
  const cfg = cfgWith({ runs: [{ id: "r", match: ["\\brender\\b"], free: 1 }], resources: { editor: { match: ["\\bbuild\\b"] } }, ...ENFORCE });
  const ok = run('$env:AW_RUN = "verify: the two shots that show it"; render a b', cfg, "PowerShell");
  assert.deepEqual([ok.kind, ok.rule], ["warn", "run-budget"]);
  assert.equal(run('$env:AW_AGENT = "a1"; build', cfg, "PowerShell", { locks: { editor: "a1" } }), null);
});

test("agent-works guard: a pattern written for the bare command still matches behind an environment", () => {
  const cfg = cfgWith({ guard: { rules: [{ id: "publish", decision: "deny", match: ["^npm publish\\b"], unless: ["--dry-run"] }] } });
  for (const c of ["npm publish", "CI=1 npm publish", "env CI=1 npm publish", "CI=1 aw lock run x --for y -- npm publish"]) {
    assert.equal(rule(c, cfg), "publish", c);
  }
  assert.equal(run("CI=1 npm publish --dry-run", cfg), null);
  // `unless` may name the environment as well
  const release = cfgWith({ guard: { rules: [{ id: "publish", decision: "deny", match: ["^npm publish\\b"], unless: ["\\bRELEASE=1\\b"] }] } });
  assert.equal(run("RELEASE=1 npm publish", release), null);
  assert.equal(rule("RELEASE=0 npm publish", release), "publish");
  const whole = cfgWith({ guard: { rules: [{ id: "publish", decision: "deny", scope: "command", match: ["npm publish\\b"], unless: ["\\bRELEASE=1\\b"] }] } });
  assert.equal(run('$env:RELEASE = "1"\nnpm publish', whole, "PowerShell"), null);
});

const FILES = cfgWith({
  resources: { editor: { match: ["run-tests\\.ps1", "\\bbuild\\.sh\\b"] }, raw: { match: ["raw-thing\\.ps1"], matchFileCommands: true } },
  runs: [{ id: "render", match: ["shot-render\\.ps1"], free: 3 }, { id: "raw", match: ["raw-render\\.ps1"], free: 3, matchFileCommands: true }],
  guard: { rules: [{ id: "no-rm", decision: "deny", match: ["^rm\\b.*run-tests\\.ps1"] }], locks: "deny" },
});

test("agent-works guard: naming a file is not running it", () => {
  allowed(["git add engines/app/scripts/run-tests.ps1", "git mv scripts/run-tests.ps1 tools/run-tests.ps1",
    "git rm scripts/run-tests.ps1", "git -C sub restore scripts/run-tests.ps1", "git stash push build.sh",
    "git checkout main -- build.sh", "cp scripts/run-tests.ps1 /tmp/x.ps1", "mv build.sh old-build.sh",
    "chmod +x build.sh", "sed -i s/a/b/ build.sh", "touch scripts/run-tests.ps1", "mkdir -p out/build.sh",
    "Copy-Item scripts/run-tests.ps1 x.ps1", "Remove-Item scripts/run-tests.ps1", "code build.sh",
    "find . -name build.sh -delete", "X=1 git add build.sh", "cd a && git add build.sh && git commit -m 'build.sh'"], FILES);
  for (const c of ["./build.sh", "bash build.sh", "powershell -File scripts/run-tests.ps1", "& scripts/run-tests.ps1",
    "git add build.sh && ./build.sh", "cp build.sh /tmp/b.sh; bash build.sh", "xargs ./build.sh < list",
    "find . -name '*.x' -exec ./build.sh {} ;", "git bisect run ./build.sh", "git rebase -x ./build.sh main",
    "git submodule foreach ./build.sh", "python tools/wrap.py scripts/run-tests.ps1"]) {
    assert.equal(rule(c, FILES), "resource-lock", c);
  }
  // a resource may ask for the raw reading
  assert.equal(rule("git add tools/raw-thing.ps1", FILES), "resource-lock");
  assert.equal(rule("rm tools/raw-thing.ps1", FILES), "resource-lock");
  assert.equal(run("cat tools/raw-thing.ps1", FILES), null, "a reader is a reader");
  // a run budget counts runs, not files
  assert.equal(run("git add tools/x/shot-render.ps1 a b c d", FILES), null);
  assert.equal(run("cp tools/x/shot-render.ps1 a b c d", FILES), null);
  assert.equal(rule("powershell -File tools/x/shot-render.ps1 a b c d", FILES), "run-budget");
  assert.equal(rule("git add tools/raw-render.ps1 a b c d", FILES), "run-budget");
  // a project's rules still read them
  assert.equal(rule("rm scripts/run-tests.ps1", FILES), "no-rm");
  assert.equal(rules.handlesFiles(["git", "add", "x"]), true);
  assert.equal(rules.handlesFiles(["git", "bisect", "run", "x"]), false);
  assert.equal(rules.handlesFiles([]), false);
});

test("agent-works guard: an excuse belongs to its pattern", () => {
  const cfg = cfgWith({
    resources: { editor: {
      match: [{ pattern: "shot-render\\.ps1", unless: ["(^|\\s)-List\\b"] }, "\\bEditor(\\.exe)?\\b", { pattern: "import\\.ps1", unless: "-WhatIf\\b" }],
      unless: ["--version\\b"],
    } },
    runs: [{ id: "render", free: 1, unless: ["--help\\b"], match: [{ pattern: "\\brender\\b", unless: ["\\s--plan\\b"] }, "\\bbake\\b"] }],
    guard: { rules: [{ id: "launch", decision: "deny", match: [{ pattern: "\\bsim\\b", unless: ["--offline\\b"] }, "steam://"], unless: ["run-in-session"] }], locks: "deny" },
  });
  assert.equal(rule("powershell -File shot-render.ps1 a", cfg), "resource-lock");
  assert.equal(run("powershell -File shot-render.ps1 -List", cfg), null);
  assert.equal(run("powershell -File import.ps1 -WhatIf", cfg), null);
  // -List excuses the script, not the editor named in the same command, and not the editor alone
  assert.equal(rule("Editor.exe -List", cfg), "resource-lock");
  assert.equal(rule("powershell -File shot-render.ps1 -List -With Editor", cfg), "resource-lock");
  // the resource's own `unless` excuses every pattern
  assert.equal(run("Editor.exe --version", cfg), null);
  assert.equal(run("powershell -File shot-render.ps1 a --version", cfg), null);
  // runs and project rules take the same shape
  assert.equal(rule("render a b", cfg), "run-budget");
  assert.equal(run("render a b --plan", cfg), null);
  assert.equal(rule("bake a b --plan", cfg), "run-budget");
  assert.equal(run("bake a b --help", cfg), null);
  assert.equal(run("render a", cfg), null); // counted from the program's name
  assert.equal(rule("sim --fast", cfg), "launch");
  assert.equal(run("sim --offline", cfg), null);
  assert.equal(rule("start steam://run/1 --offline", cfg), "launch");
  assert.equal(run("run-in-session start steam://run/1", cfg), null);
  assert.deepEqual(rules.entries(["a", { pattern: "b", unless: "c" }, { unless: ["x"] }, 7]), [["a", []], ["b", ["c"]]]);
});

test("agent-works guard: a call the rules do not cover is no decision", () => {
  for (const [tool, input] of [["Bash", {}], ["Bash", { command: "   " }], ["Bash", { command: 5 }], ["Bash", "git add -A"], ["Bash", null],
    ["Read", { file_path: "x" }], ["Task", { command: "git add -A" }], ["Write", { file_path: "" }]]) {
    assert.deepEqual(rules.judge(tool, input, defaults(), factsOf()), { decisions: [], skipped: [] }, `${tool} ${JSON.stringify(input)}`);
  }
  assert.equal(rules.decide("Bash", { command: "git add -A" }, {}, {})?.rule, "staging-blanket", "an empty config and no facts still judge");
});
