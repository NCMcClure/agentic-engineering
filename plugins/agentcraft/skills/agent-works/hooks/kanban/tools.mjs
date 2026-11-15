// The board's model tools, which the model calls as mcp__agent-works__<name>:
// six, each registered deferred, so the session's
// context carries only their names until the model asks for one. They give an
// agent the board without a shell: file out-of-scope work as a suggestion,
// read the board, move a card, plan it into an epic or a sprint, owe a check
// it cannot run, and settle one with its evidence.
//
// Every tool is one run of the board CLI and answers with the CLI's own
// words, so a tool, the pane and a shell follow one set of rules: a title
// already on the board is not filed twice, a gate reaches done only by its
// evidence, and a move never starts a session.
import { BOARD } from "./commands.mjs";
import { answer, runBoard } from "./host.mjs";

const text = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const texts = (value) => (Array.isArray(value) ? value.map(text).filter(Boolean) : undefined);
const some = (list) => (list && list.length ? list : undefined);
const given = (value) => text(value) || undefined;

/** What the model reads for each tool, and the arguments each takes. */
/** A pane tool's name as the model and the hooks see it. */
export const toolId = (name) => `mcp__agent-works__${name}`;

export const TOOLS = {
  surface_task: {
    description: `Put a task on the project's kanban board for the person to consider, without interrupting your current work.

Call this when you notice something worth doing that is outside the change you are making: a bug spotted in passing, a pattern repeated often enough to deserve a fix, stale docs, missing test coverage, a confirmed TODO, a security issue, or a follow-up your own change makes necessary. Do not call it for vague observations, low-confidence hunches, or anything you can fix inline as part of the current task.

The task lands in the board's Suggested lane; the person accepts or dismisses it. Write it to stand alone: a specific title, and details with the file paths, what you saw, and why it matters, so that an agent with none of this conversation could act on it. A title already on the board is not filed twice: the answer names the card that has it. Then carry on with what you were doing.`,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: 'Short and specific, as an imperative: "Fix race in session cache".' },
        details: { type: "string", description: "Markdown. File paths, what you saw, why it matters, and what done looks like." },
        kind: { type: "string", enum: ["bug", "pattern", "debt", "docs", "tests", "security", "followup"], description: "What sort of work it is; kept as the card's label." },
        priority: { type: "string", enum: ["low", "normal", "high"] },
        files: { type: "array", items: { type: "string" }, description: "Paths the task is likely to touch." },
        skills: { type: "array", items: { type: "string" }, description: "Skills the agent that takes this task should use, by name." },
        epic: { type: "string", description: "The id of the epic card this task belongs to, as list_tasks shows them: when you slice an epic, or for a follow-up of an epic's card." },
      },
      required: ["title", "details"],
    },
  },
  list_tasks: {
    description: "List the cards of the project's kanban board: the column ids, the active sprint, the open epics with their progress, then each card's id, column, kind (task or gate), owner, title, what a gate is owed for, and its epic and sprint. Only the cards of one scope are listed, by default the active sprint (every card when none is active), with a count of the rest: ask for scope \"all\" when a card you look for is not there.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", description: '"sprint" (the active sprint, the default), "backlog" (cards in no sprint), "all", "gates" (checks still owed), "plan" (plan issues), or an epic\'s card id.' },
        kind: { type: "string", enum: ["task", "gate", "epic"], description: "Only cards of this kind." },
      },
    },
  },
  move_task: {
    description: "Move a card of the project's kanban board to another column, by the card's id: to the review column when you finish the task a card handed you (pass `mr`, the pull or merge request number, when there is one). `status` is a column id, as list_tasks shows them, or suggested or archived. It records the move and never starts a session. A gate is not moved to done: settle it with settle_gate.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The card's id, as list_tasks shows it." },
        status: { type: "string", description: "The column to move it to." },
        mr: { type: "integer", description: "The pull or merge request number, for a move to review." },
      },
      required: ["id", "status"],
    },
  },
  plan_task: {
    description: 'Put a card of the project\'s kanban board in an epic or a sprint, by the card\'s id. `epic` is an epic\'s card id, `sprint` a sprint id ("s3") or "active"; "none" takes the card out of either. Starting and closing sprints is the person\'s.',
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, epic: { type: "string" }, sprint: { type: "string" } },
      required: ["id"],
    },
  },
  owe_gate: {
    description: "Record a gate that is owed on the project's kanban board: a check that must still be run before work counts as verified and that you cannot run now (a full test pass, a render, a run that needs another checkout, machine or person). It becomes a gate card in the first column. Give what it is owed for (`ref`: the pull request, issue or card) and what running it needs (`needs`). Use it instead of calling the work verified, and say so in your report. Settle it with settle_gate once it has run.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: 'The check to run, as an imperative: "Run the smoke gate on main".' },
        details: { type: "string", description: "Markdown. The exact command, what passing looks like, and why it could not be run now." },
        ref: { type: "string", description: 'What the gate is owed for: a pull request, an issue or a card ("#213").' },
        needs: { type: "string", description: 'What running it needs: "the main checkout", "a free GPU", "the owner".' },
        owner: { type: "string", description: "Who can run it, when that is known." },
      },
      required: ["title", "ref", "needs"],
    },
  },
  settle_gate: {
    description: "Settle an owed gate of the project's kanban board, by the card's id, once the check has run and passed: the evidence (the command and its result, or who looked and what they saw) is recorded on the card and the card moves to done. A gate reaches done only this way.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        evidence: { type: "string", description: "The command that ran and what it showed." },
      },
      required: ["id", "evidence"],
    },
  },
};

/** The board CLI's arguments for one tool call, or `{ say }` when the call cannot be made as given. */
export function toolArgs(name, e) {
  if (name === "surface_task") {
    if (!text(e.title)) return { say: "Not added: a task needs a title." };
    return BOARD.add({
      title: text(e.title), suggest: true, source: "claude", details: given(e.details), priority: given(e.priority), labels: some(texts([e.kind])),
      files: some(texts(e.files)), skills: some(texts(e.skills)), epic: given(e.epic),
    });
  }
  if (name === "list_tasks") return BOARD.list({ scope: given(e.scope), kind: given(e.kind) });
  if (name === "move_task") {
    const to = text(e.status) || text(e.column);
    if (!text(e.id) || !to) return { say: "Not moved: give the card's id and the column (status)." };
    return BOARD.move({ id: text(e.id), to, mr: given(e.mr) });
  }
  if (name === "plan_task") {
    if (!text(e.id)) return { say: "Nothing to change: give the card's id." };
    if (!text(e.epic) && !text(e.sprint)) return { say: "Nothing to change: give an epic or a sprint." };
    return BOARD.plan({ id: text(e.id), epic: given(e.epic), sprint: given(e.sprint) });
  }
  if (name === "owe_gate") {
    if (!text(e.title) || !text(e.ref) || !text(e.needs)) return { say: "Not added: a gate needs a title, what it is owed for (ref) and what running it needs (needs)." };
    return BOARD.owe({ title: text(e.title), ref: text(e.ref), needs: text(e.needs), owner: given(e.owner), details: given(e.details), source: "claude" });
  }
  if (name === "settle_gate") {
    if (!text(e.id)) return { say: "Not settled: give the gate card's id." };
    if (!text(e.evidence)) return { say: "Not settled: a gate is settled with its evidence, the command that ran and what it showed." };
    return BOARD.settle({ id: text(e.id), evidence: text(e.evidence) });
  }
  return { say: `No board tool "${name}".` };
}

/**
 * One tool call, answered. The CLI's answer is the result, a refusal or a duplicate included (the model reads why
 * and carries on); a call the CLI could not make sense of, or that could not be run, is an error result.
 */
export async function runTool(host, name, e) {
  const args = toolArgs(name, e ?? {});
  if (!Array.isArray(args)) return { result: args.say };
  let r;
  try { r = await runBoard(host, args); } catch (err) {
    return { deny: `the board tool could not run: ${err?.message ?? err}` };
  }
  const said = answer(r).text;
  if (r.code > 1) return { deny: said };
  if (r.code === 0 && name === "surface_task") host.toast(`Claude suggested a task on the kanban board: ${text(e.title)}. /kanban to review it.`);
  if (r.code === 0 && name === "owe_gate") host.toast(`A gate is owed on the kanban board: ${text(e.title)} (for ${text(e.ref)}). /kanban to see it.`);
  if (r.code === 0 && name === "list_tasks") return { result: said === "Done." ? "No cards in this scope." : said };
  return { result: said };
}
