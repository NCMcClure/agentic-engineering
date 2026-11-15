// The brief: the whole prompt a child session starts from. It stands alone,
// because the child cannot ask what the orchestrating session meant: the task
// and its done criteria, the files it owns, the files other children own right
// now, the cadence down to the one push a grant covers, how findings come back,
// and the CARD line it ends with. It is pasted where no plugin root is set, so
// the caller passes every path absolute and the brief names no plugin-root
// variable.
//
// Also the grant's two strings: the branch a card's push is granted for, and
// the text recorded as the person's approval.
//
// Pure: the template text and the card in, the brief out.
import { BoardError, byPlace, roleIds } from "./board.mjs";
import { DONE_HEADINGS, doneCriteria, sections, slugify } from "./cards.mjs";
import { conflictConfig, locksFor } from "./conflicts.mjs";
import { cardLineFormat } from "./report.mjs";

/** `<type>/<topic>`: the branch names a grant covers. */
export const BRANCH = /^(feat|fix|chore|docs|test|ci)\/\w[\w.-]*(\/\w[\w.-]*)*$/;
const PERCEPTUAL_LABELS = ["look", "motion", "sound"];
// Sections of a card body that are not the task: the criteria get their own block, the rest is the loop's record.
const NOT_TASK = [...DONE_HEADINGS, "Review", "Evidence", "Report"];

/** `feat/` and the title's slug, cut at a word to 40 characters. */
export function defaultBranch(card) {
  let topic = slugify(card.title);
  if (topic.length > 40) topic = topic.slice(0, 41).replace(/-[^-]*$/, "") || topic.slice(0, 40);
  return `feat/${topic}`;
}

/** What `grant` records: who approved and when, then what the approval covers. */
export const grantText = (by, branch, id) => `${by.trim()}: push ${branch} and open the pull or merge request (card ${id})`;

const code = (p) => `\`${p}\``;
const isTask = (c) => c.kind !== "epic" && c.kind !== "gate";

function taskOf(card, planRef) {
  if (card.source === "plan") {
    return `Plan issue ${card.plan} (${card.type ?? "AFK"}), at ${code(card.file)} in your worktree${planRef ? `, as ${planRef} has it` : ""}. `
      + "Build it with `/but-first-planning:build-tdd`, which flips the issue to done through the plan's funnel in your last commit before the push, without `--evidence`. "
      + "The issue is quoted at the end of this brief.";
  }
  const kept = sections(card.body).filter((s) => !NOT_TASK.includes(s.head) && s.text);
  const text = kept.map((s) => (s.head ? `### ${s.head}\n\n${s.text}`.trim() : s.text)).join("\n\n").trim();
  return text || "The title is the task.";
}

function doneOf(card) {
  if (card.source === "plan") {
    if (!card.acceptance?.length) return "";
    return [...card.acceptance.map((a) => `- [ ] ${a.text}`), "- [ ] the issue's testing checkpoint exits 0"].join("\n");
  }
  return doneCriteria(card.body);
}

function notYours(card, board) {
  const live = new Set([...roleIds(board, "start"), ...roleIds(board, "review")]);
  const others = board.cards.filter((c) => c.id !== card.id && isTask(c) && live.has(c.status)).sort(byPlace(board));
  if (!others.length) return "Nothing else is in flight.";
  return [
    "Other children are changing these right now. Leave them alone; if the task needs one, stop and report `blocked`.",
    "",
    ...others.map((c) => `- ${c.id}${c.session ? ` (${c.session})` : ""}: ${c.files?.length ? c.files.map(code).join(", ") : "names no files; ask the session that started you before touching anything outside your own"}`),
  ].join("\n");
}

function syncOf(config) {
  const out = ["Another branch landing first moves the base. Sync with a merge, never a rebase or a force push, then re-run your lanes before you push again."];
  const list = [];
  for (const r of config.rederived) {
    list.push(`- ${code(r.path)} is generated: never merge it by hand; after the sync run ${r.command ? code(r.command) : "its generator"} and commit what it writes.`);
  }
  if (config.merge.length) list.push(`- ${config.merge.map(code).join(", ")}: keep both sides' entries.`);
  if (config.shared.length) {
    list.push(`- ${config.shared.map(code).join(", ")}: a version line always conflicts. Take the base's side, then bump once above the base's version, with your changelog line on top.`);
  }
  return [...out, ...(list.length ? ["", ...list] : [])].join("\n");
}

function firstOf(card) {
  const out = [];
  const skills = card.skills ?? [];
  if (card.labels?.some((l) => PERCEPTUAL_LABELS.includes(l)) || skills.some((s) => s.includes("perceptual-loop"))) {
    out.push("This task is judged by eye or ear: if the perceptual-loop plugin is installed, load `/perceptual-loop:iterate-shots` before the first test, so the check is measured rather than eyeballed.");
  }
  const own = skills.filter((s) => !s.includes("perceptual-loop")).map((s) => code(s.startsWith("/") ? s : `/${s}`));
  if (own.length) out.push(`Load first: ${own.join(", ")}.`);
  return out.join("\n\n");
}

/**
 * The brief for `card`. `cli` holds the command lines a child types, each ready to take its arguments: `board`
 * (`node "<...>/aw.mjs" board`) and `lock`. `cardPath` is the card's file at the main checkout, `base` the base
 * branch, `planRef` where the plan was read, `change` what the forge calls a change request (`pull request`,
 * `merge request`). A card with no done criteria is refused: nobody can check work that has none.
 */
export function renderBrief(template, { card, board, config = conflictConfig(), cli, cardPath, base = "main", planRef = null, change = "pull or merge request" }) {
  const done = doneOf(card);
  if (!done) {
    throw new BoardError("refused", `${card.id} has no done criteria${card.source === "plan" ? " in its issue" : " under ## Done when"}: write them first, then brief it`);
  }
  const holder = `card-${card.id}`;
  const branch = card.branch ?? "<type>/<topic>";
  const locks = locksFor(card, config);
  const files = card.files ?? [];
  const values = {
    id: card.id,
    title: card.title,
    holder,
    branch,
    base,
    change,
    board: cli.board,
    cardFile: cardPath,
    first: firstOf(card),
    task: taskOf(card, planRef),
    done,
    files: files.length ? files.map((f) => `- ${code(f)}`).join("\n") : "None predicted, so this card runs alone. Say in your report which files you touched.",
    notYours: notYours(card, board),
    locks: locks.length
      ? locks.map((l) => `   - ${code(l.resource)} (${l.scope}): \`${cli.lock} run ${l.resource} --as ${holder} --for "<what, how long>" --max-minutes <n> --wait 90 -- <command>\``).join("\n")
      : `   None is named for this card's files; \`${cli.lock} status\` shows what other sessions hold.`,
    push: card.grant
      ? `The claim writes the person's push grant ("${card.grant}") to your branch, so the push goes through without asking, but only as exactly \`git push -u origin ${branch}\`, as a command of its own. A chained command, another flag, or another refspec asks the person.`
      : "No push grant was given for this card, so the push asks the person first.",
    sync: syncOf(config),
    cardLine: cardLineFormat(card.id),
    issue: card.source === "plan"
      ? `## The plan issue\n\nVerbatim from ${code(card.file)}${planRef ? ` on ${planRef}` : ""}:\n\n~~~~markdown\n${String(card.body ?? "").trim()}\n~~~~`
      : "",
  };
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new Error(`the brief template names {{${key}}}, which the renderer does not fill`);
    return values[key];
  });
  return `${text.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** The brief every card starts from. `{{name}}` marks what `renderBrief` fills. */
export const BRIEF_TEMPLATE = `# Card {{id}}: {{title}}

You are a child session of an orchestrated round, working card {{id}} on the board that every worktree of this repo shares. The session that started you reviews your {{change}}, waits for its checks, and merges it. You do not merge, approve, or tag, and you never force push or pass \`--no-verify\`.

{{first}}

## The task

{{task}}

## Done when

{{done}}

## Your files

{{files}}

These are predictions. Touch what the task needs, and say in your report where you went outside them.

## Not yours

{{notYours}}

## Cadence

1. **Branch, then claim.** \`git switch -c {{branch}}\`, then \`{{board}} claim {{id}}\`. The claim records your branch and worktree on the card and, where the person granted the push, writes that grant to the branch's git config. It refuses in the main checkout and on a branch another card holds.
2. **Sync with the base** before the first test: \`git fetch origin\`, then \`git merge origin/{{base}}\`. Never rebase a pushed branch.
3. **Build test-first.** Commit at each green step, with a subject that says what changed.
4. **Take a lock for anything scarce**, passing \`--as {{holder}}\` so your place in line holds between commands.
{{locks}}
5. **Owe what you cannot check** (credentials, a device, a person's eye), never claim it: \`{{board}} owe "<what>" --ref <the change or commit> --needs <who or what>\`. Out-of-scope work you notice goes on the board, not into this branch: \`{{board}} add "<title>" --suggest --details "<what you saw>"\`.
6. **Push.** {{push}}
7. **Open the {{change}}**, then \`{{board}} move {{id}} review --mr <number>\`.

## When the base moves

{{sync}}

## When findings come back

The session that started you reviews the diff against the done criteria. Its findings arrive as a message in this session, or are written under \`## Review\` in the card, which \`{{board}} show {{id}}\` prints. Fix them on the same branch, commit, push the same way, move the card to review again, and report again.

## Your report

The first line of your final message is the CARD line, because only the start of it is quoted to the session that started you:

    {{cardLine}}

\`owed=\` lists the gate ids you filed, or a short name for each check you could not run. After that line: the verdict; an evidence table of each lane, the exact command, and its result; what is not verified; the decisions you made; anything that needs the person. Blocked or failed, also put the CARD line at the top of a \`## Report\` section in \`{{cardFile}}\`, so a wait on the card sees it.

{{issue}}
`;
