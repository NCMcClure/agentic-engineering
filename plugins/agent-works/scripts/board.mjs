#!/usr/bin/env node
// aw board (and aw kanban, the name it had first): the task board, for agents,
// scripts and the pane. Run from any worktree of a repo; every worktree reads
// and writes the one board at the main checkout. Every write happens under the
// board's lock, so two writers never mint the same id.
//
// Plan issues are cards too, with their coordinates as the id (01-02-03). They
// are read only: a move runs the plan's funnel in the card's worktree, a move
// to done is refused (the merge does that), and abandon sets the issue back
// to not-started there.
//
// The push grant moves with the card: grant records the person's approval and
// the branch it covers, claim (in the child's worktree, on that branch) writes
// it to git config, and done, abandon, and a move to done take it back.
//
// Exit codes: 0 ok; 1 a finding, a refusal, or a duplicate; 2 a request that
// cannot be carried out as given; 3 still waiting (wait at its timeout).
import fs from "node:fs";
import path from "node:path";
import {
  ARCHIVED, BoardError, KINDS, PRIORITIES, START_MODES, SUGGESTED, abandon, addCard, byPlace, briefLine, cardLine, configOf, doneColumn, editCard,
  epicProgress, findCard, findDuplicate, held, holdOf, inScope, isEpic, isFinished, lintFix, listingLines, note, openEpics, owe, parseScope,
  planCard, planMove, progressBar, ready, reorder, roleIds, scopeLabel, settle, sprintClose, sprintEdit, sprintLine, sprintNew, sprintStart, summary,
} from "../lib/board.mjs";
import { BRANCH, BRIEF_TEMPLATE, defaultBranch, grantText, renderBrief } from "../lib/brief.mjs";
import { cardFile, cardView, doneCriteria } from "../lib/cards.mjs";
import { AwError, TEMPLATES, agentName, emit, intArg, ioOf, jsonText, parseArgs, posix, readStdin, readText, report, runMain } from "../lib/common.mjs";
import { conflictConfig, propose } from "../lib/conflicts.mjs";
import { planCardAbandon, planCardMove, shadowAfter, shadowFile } from "../lib/plan.mjs";
import { parseCardLine } from "../lib/report.mjs";
import { SWEEP_SCOPES, signals, sweepCards } from "../lib/sync.mjs";
import {
  cardFacts, detectRemote, dropGrant, ensureBoard, findings, locate, planBase, readFullBoard, readPlan, remoteStatus, remoteSync, runFunnel, sleepSync,
  stamp, withBoardLock, writeChange, writeGrant, writeShadow,
} from "./io.mjs";

const EXIT = { ok: 0, finding: 1, usage: 2, waiting: 3 };
const AW = path.join(import.meta.dirname, "aw.mjs");
const usage = (message) => new BoardError("usage", message);
const refused = (message) => new BoardError("refused", message);
const list = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
// Card ids come comma separated, space separated, or both: `0001,0002`, `0001 0002`, `"0001, 0002"`.
const idList = (...parts) => parts.flat().flatMap((s) => String(s ?? "").split(/[\s,]+/)).filter(Boolean);
// A flag's value as a whole number, undefined when the flag was not given.
const int = (value, name) => intArg(value, name) ?? undefined;
const flag = { type: "boolean" };
const text = { type: "string" };
const JSON_FLAG = { json: flag };
const BODY = { details: text, "from-file": text };

function usageText(cli) {
  return `usage: ${cli} <action> [arguments]

The project's task board: the cards the /kanban pane shows. Cards live in the main working tree's kanban folder,
so every worktree works one board. Every action takes --json for one JSON document.

read
  list [--scope sprint|backlog|all|gates|plan|<epic id>] [--status S] [--kind K] [--all]
  show <id>      status [--brief]      ready      epics      sprint [list]      lint [--fix]
  remote status  config

write
  add "<title>" [--details T | --from-file F] [--kind task|gate|epic] [--priority low|normal|high] [--labels a,b]
                [--skills a,b] [--owner O] [--ref R] [--needs N] [--status S | --suggest] [--epic ID] [--sprint ID|active]
                [--files a,b] [--after 0003,0004] [--source user|claude] [--allow-duplicate]
  epic "<title>" [--details T | --from-file F]
  edit <id> [--title T] [--details T | --from-file F | --append T] [--kind K] [--priority P] [--labels a,b] [--skills a,b]
            [--owner O] [--ref R] [--needs N] [--epic ID|none] [--sprint ID|active|none] [--files a,b] [--after ids]
  move <id> <column|suggested|archived> [--index N] [--mr NUMBER]      reorder <id> <index>
  plan <id> [--epic ID|none] [--sprint ID|active|none]                 note <id> "<text>"
  owe "<title>" --ref R --needs N [--details T | --from-file F] [--owner O]
  settle <id> --evidence "<the command and its result>"
  sprint new "<title>" [--goal G] [--start D] [--end YYYY-MM-DD] | start [<id>] | close [<id>] | edit <id> [--title|--goal|--start|--end]
  config [--start-mode new-session|queue] [--parallel N]
  remote on | off | sync [--dry-run]

the loop
  propose [--max N] [--ids a,b]      grant <ids...> --by "<who, when>" [--branch <type>/<topic>]
  brief <id>      bind <id> --session NAME | --terminal | --serial      claim <id>
  done <id> --merged <sha>      abandon <id>      wait [--until COLUMN] [--ids a,b] [--timeout SECONDS]
  evidence [<ids...> | --scope in-flight|backlog|suggested]

A gate is a check still owed: owe records it, settle closes it with its evidence. --from-file - reads the body from
standard input. Exit codes: 0 ok, 1 a finding, a refusal or a duplicate, 2 a usage error, 3 wait at its timeout.`;
}

// ---- the actions ------------------------------------------------------

function bodyOf(values, ctx) {
  const source = values["from-file"];
  if (source !== undefined) {
    const body = source === "-" ? readStdin(ctx.io) : readText(path.resolve(ctx.io.cwd, source));
    if (body === null) throw usage(`cannot read ${source}`);
    return body.trim();
  }
  return values.details === undefined ? undefined : values.details.trim();
}

function choice(value, flagName, allowed) {
  if (value !== undefined && !allowed.includes(value)) throw usage(`${flagName} is ${allowed.join(", ")}, not "${value}"`);
  return value;
}

const sourceOf = (values, ctx) => choice(values.source, "--source", ["user", "claude"]) ?? (ctx.by || ctx.io.env.CLAUDECODE ? "claude" : "user");
const SKELETON = "## Done when\n\n## Notes";

/** add and epic: checks the title against the open cards, then files the card. */
function fileCard(ctx, title, values, kind) {
  const b = ctx.board();
  if (!String(title ?? "").trim()) throw usage("a card needs a title");
  choice(kind, "--kind", KINDS);
  choice(values.priority, "--priority", PRIORITIES);
  const twin = values["allow-duplicate"] ? null : findDuplicate(b, title, kind === "gate" ? values.ref : undefined);
  if (twin) {
    ctx.say(`Already on the kanban board as card ${twin.id} (${twin.status}); nothing added.`);
    return EXIT.finding;
  }
  const body = bodyOf(values, ctx);
  const change = addCard(b, {
    title, status: values.suggest ? SUGGESTED : values.status, kind, priority: values.priority, labels: list(values.labels), skills: list(values.skills),
    owner: values.owner?.trim(), ref: values.ref?.trim(), needs: values.needs?.trim(), epic: values.epic, sprint: values.sprint,
    files: list(values.files), after: idList(values.after).map((id) => findCard(b, id)?.id ?? id), source: sourceOf(values, ctx),
    body: body ?? (kind === "gate" ? "" : SKELETON),
  }, stamp());
  ctx.write(change);
  const [card] = change.cards;
  return ctx.done(values, cardView(card), `Added card ${card.id} [${card.status}]: ${card.title}`);
}

const ACTIONS = {
  list: {
    options: { ...JSON_FLAG, status: text, kind: text, all: flag, scope: text },
    run({ values }, ctx) {
      const b = ctx.board();
      const whole = Boolean(values.status) || values.all;
      const scope = whole ? "all" : parseScope(b, values.scope);
      const none = `No board yet: ${posix(ctx.loc.dir)} does not exist.`;
      const here = b.exists || b.cards.length > 0;
      if (!values.json && !whole) return ctx.say(here ? listingLines(b, scope, values.kind).join("\n") : none);
      let cards = [...b.cards];
      if (values.status) cards = cards.filter((c) => c.status === values.status);
      else if (!values.all) cards = cards.filter((c) => c.status !== ARCHIVED && (isEpic(c) || inScope(b, c, scope)));
      if (values.kind) cards = cards.filter((c) => c.kind === values.kind);
      cards.sort(byPlace(b));
      if (values.json) {
        return ctx.json({ dir: posix(ctx.loc.dir), oldFolder: ctx.loc.isOld, columns: b.columns, sprints: b.sprints, scope: scopeLabel(b, scope), cards: cards.map(cardView) });
      }
      return ctx.say([`Columns: ${b.columns.map((c) => c.id).join(", ")} (plus ${SUGGESTED})`, ...cards.map(cardLine), ...(cards.length ? [] : [here ? "No cards." : none])].join("\n"));
    },
  },

  show: {
    positionals: ["id"],
    options: JSON_FLAG,
    run({ id, values }, ctx) {
      const b = ctx.board();
      const card = ctx.card(b, id);
      const children = isEpic(card) ? b.cards.filter((c) => c.epic === card.id && !isEpic(c)).sort(byPlace(b)) : [];
      if (values.json) {
        return ctx.json({
          ...cardView(card), hold: holdOf(b, card), doneCriteria: card.source === "plan" ? "" : doneCriteria(card.body),
          ...(isEpic(card) ? { progress: epicProgress(b, card.id), children: children.map((c) => c.id) } : {}),
        });
      }
      if (card.source === "plan") return ctx.say(planShow(b, card));
      let out = fs.readFileSync(path.join(ctx.loc.dir, card.file), "utf8").trimEnd();
      if (isEpic(card)) {
        const p = epicProgress(b, card.id);
        out += `\n\nChildren: ${p.done} of ${p.total} finished.${children.map((c) => `\n  ${cardLine(c)}`).join("")}`;
      }
      return ctx.say(out);
    },
  },

  status: {
    options: { ...JSON_FLAG, brief: flag },
    run({ values }, ctx) {
      const b = ctx.board();
      const s = summary(b, Date.now());
      if (values.json) return ctx.json({ exists: b.exists, dir: posix(ctx.loc.dir), ...s, held: held(b), remote: b.remote, startMode: b.startMode, parallel: b.parallel });
      if (!b.exists && !b.cards.length) return ctx.say(`No board yet: ${ctx.cli} add "<title>" starts one.`);
      if (values.brief) return ctx.say(briefLine(s));
      const out = [`Board at ${posix(ctx.loc.dir)}`];
      if (b.cards.some((c) => c.source === "plan")) out.push(`Plan issues read from ${b.planRef}`);
      if (s.sprint) out.push(`${sprintLine(s.sprint)}`);
      for (const col of b.columns) {
        const here = b.cards.filter((c) => c.status === col.id && !isEpic(c)).sort(byPlace(b));
        out.push(`${col.title} (${here.length})`, ...here.slice(0, col.role === "done" ? 5 : Infinity).map((c) => `  ${cardLine(c)}`));
      }
      out.push(`Ready: ${s.ready}. Gates owed: ${s.owed}. Suggested: ${s.suggested}.`);
      const found = findings(ctx.io.cwd, { loc: ctx.loc, board: b, cli: ctx.cli }).filter((f) => f.level !== "info").length;
      if (found) out.push(`Lint: ${found} finding(s), ${ctx.cli} lint lists them.`);
      return ctx.say(out.join("\n"));
    },
  },

  ready: {
    options: JSON_FLAG,
    run({ values }, ctx) {
      const picked = ready(ctx.board());
      return values.json ? ctx.json(picked.map(cardView)) : ctx.say(picked.map(cardLine).join("\n") || "Nothing is ready.");
    },
  },

  epics: {
    options: JSON_FLAG,
    run({ values }, ctx) {
      const b = ctx.board();
      const epics = openEpics(b);
      const progress = (e) => { const { done, total } = epicProgress(b, e.id); return { done, total }; };
      if (values.json) return ctx.json(epics.map((e) => ({ ...cardView(e), progress: progress(e) })));
      return ctx.say(epics.map((e) => `${e.id} ${progressBar(progress(e))}: ${e.title}`).join("\n") || `No open epics. Add one: ${ctx.cli} add "<goal>" --kind epic`);
    },
  },

  lint: {
    options: { ...JSON_FLAG, fix: flag },
    write: (values) => values.fix === true,
    run({ values }, ctx) {
      if (values.fix) {
        const b = ctx.board();
        const change = lintFix(b, stamp());
        if (change.cards.length) {
          // A card given a new id moves to a file named for it.
          const remove = [];
          for (const fixed of change.cards) {
            if (b.cards.find((c) => c.file === fixed.file)?.id === fixed.id) continue;
            remove.push(fixed.file);
            fixed.file = cardFile(fixed);
          }
          ctx.write({ ...change, remove });
          if (!values.json) ctx.say(change.cards.map((c) => `fixed ${c.id} (${c.file})`).join("\n"));
        }
      }
      ctx.flush();
      return report(ctx.io, findings(ctx.io.cwd, { cli: ctx.cli }), { json: values.json, title: ctx.name, cfg: ctx.loc.cfg });
    },
  },

  add: {
    positionals: ["title"],
    options: {
      ...JSON_FLAG, ...BODY, kind: text, priority: text, labels: text, skills: text, owner: text, ref: text, needs: text, status: text, suggest: flag,
      source: text, epic: text, sprint: text, files: text, after: text, "allow-duplicate": flag,
    },
    write: true, creates: true,
    run: ({ title, values }, ctx) => fileCard(ctx, title, values, values.kind ?? "task"),
  },

  epic: {
    positionals: ["title"],
    options: { ...JSON_FLAG, ...BODY, source: text, "allow-duplicate": flag },
    write: true, creates: true,
    run: ({ title, values }, ctx) => fileCard(ctx, title, values, "epic"),
  },

  edit: {
    positionals: ["id"],
    options: {
      ...JSON_FLAG, ...BODY, append: text, title: text, kind: text, priority: text, labels: text, skills: text, owner: text, ref: text, needs: text,
      epic: text, sprint: text, files: text, after: text,
    },
    write: true,
    run({ id, values }, ctx) {
      const b = ctx.board();
      const card = ctx.card(b, id);
      const patch = {};
      for (const key of ["title", "kind", "priority", "owner", "ref", "needs", "epic", "sprint"]) if (values[key] !== undefined) patch[key] = values[key];
      for (const key of ["labels", "skills", "files"]) if (values[key] !== undefined) patch[key] = list(values[key]);
      if (values.after !== undefined) patch.after = idList(values.after).map((dep) => findCard(b, dep)?.id ?? dep);
      const body = bodyOf(values, ctx);
      if (body !== undefined) patch.body = body;
      if (values.append?.trim()) patch.body = `${patch.body ?? card.body ?? ""}\n\n${values.append.trim()}`.trim();
      if (!Object.keys(patch).length) throw usage("nothing to change: give a field, such as --title or --labels");
      const change = editCard(b, card.id, patch, stamp());
      ctx.write(change);
      return ctx.done(values, cardView(change.cards[0]), `Card ${card.id} changed: ${Object.keys(patch).join(", ")}.`);
    },
  },

  move: {
    positionals: ["id", "column"],
    options: { ...JSON_FLAG, mr: text, index: text },
    write: true,
    run({ id, column, values }, ctx) {
      const b = ctx.board();
      const mr = values.mr === undefined ? undefined : Number(values.mr.replace(/^[!#]/, ""));
      if (mr !== undefined && !(Number.isInteger(mr) && mr > 0)) throw usage(`--mr is a pull or merge request number, not "${values.mr}"`);
      const index = int(values.index, "--index");
      const card = ctx.card(b, id);
      const tail = mr !== undefined ? ` (!${mr})` : "";
      if (card.source === "plan") {
        const said = planChange(ctx, b, card, planCardMove(b, card, column, { mr, at: stamp() }));
        return ctx.done(values, { id: card.id, status: column }, `Card ${card.id} is now in ${column}${tail}${said}.`);
      }
      const at = stamp();
      const change = planMove(b, card.id, column, { index, at });
      let moved = change.cards.find((c) => c.id === card.id);
      if (mr !== undefined) {
        if (!moved) change.cards.push(moved = { ...card, updated: at });
        moved.mr = mr;
      }
      if (change.cards.length) ctx.write(change);
      // A finished card holds no push grant.
      const revoked = Boolean(card.branch) && roleIds(b, "done").includes(column);
      if (revoked) dropGrant(ctx.loc, card.branch);
      return ctx.done(values, cardView(moved ?? card), `Card ${card.id} is now in ${column}${tail}.${revoked ? ` The push grant for ${card.branch} is revoked.` : ""}`);
    },
  },

  reorder: {
    positionals: ["id", "index"],
    options: JSON_FLAG,
    write: true,
    run({ id, index, values }, ctx) {
      const b = ctx.board();
      const card = ctx.card(b, id);
      const change = reorder(b, card.id, int(index, "the index"), stamp());
      if (change.cards.length) ctx.write(change);
      const now = change.cards.find((c) => c.id === card.id) ?? card;
      return ctx.done(values, cardView(now), `Card ${card.id} is at place ${now.order} of ${now.status}.`);
    },
  },

  plan: {
    positionals: ["id"],
    options: { ...JSON_FLAG, epic: text, sprint: text },
    write: true,
    run({ id, values }, ctx) {
      const b = ctx.board();
      const change = planCard(b, ctx.card(b, id).id, { epic: values.epic, sprint: values.sprint }, stamp());
      ctx.write(change);
      const [card] = change.cards;
      return ctx.done(values, cardView(card), `Card ${card.id}: epic ${card.epic ?? "none"}, sprint ${card.sprint ?? "none"}.`);
    },
  },

  owe: {
    positionals: ["title"],
    options: { ...JSON_FLAG, ...BODY, ref: text, needs: text, owner: text, source: text },
    write: true, creates: true,
    run({ title, values }, ctx) {
      const b = ctx.board();
      const [ref, needs] = [String(values.ref ?? "").trim(), String(values.needs ?? "").trim()];
      if (!String(title ?? "").trim() || !ref || !needs) throw usage("a gate needs a title, what it is owed for (--ref) and what running it needs (--needs)");
      const twin = findDuplicate(b, title, ref);
      if (twin) {
        ctx.say(`Already owed as card ${twin.id} (${twin.status}); nothing added.`);
        return EXIT.finding;
      }
      const change = owe(b, { title, ref, needs, owner: values.owner, source: sourceOf(values, ctx), body: bodyOf(values, ctx) }, stamp());
      ctx.write(change);
      const [card] = change.cards;
      return ctx.done(values, cardView(card),
        `Owed as gate card ${card.id}: ${card.title} (for ${ref}; needs ${needs}). Settle it with: ${ctx.cli} settle ${card.id} --evidence "…"`);
    },
  },

  settle: {
    positionals: ["id"],
    options: { ...JSON_FLAG, evidence: text },
    write: true,
    run({ id, values }, ctx) {
      if (!String(values.evidence ?? "").trim()) throw usage("a gate is settled with its evidence: the command that ran and what it showed");
      const b = ctx.board();
      const change = settle(b, ctx.card(b, id).id, values.evidence, stamp(), ctx.by);
      ctx.write(change);
      const card = change.cards.find((c) => c.id === findCard(b, id).id);
      return ctx.done(values, cardView(card), `Gate ${card.id} is settled and in ${card.status}.`);
    },
  },

  note: {
    positionals: ["id", "text"],
    options: JSON_FLAG,
    write: true,
    run({ id, text: said, values }, ctx) {
      const b = ctx.board();
      const change = note(b, ctx.card(b, id).id, said, stamp());
      ctx.write(change);
      return ctx.done(values, cardView(change.cards[0]), `Card ${change.cards[0].id}: noted.`);
    },
  },

  sprint: {
    positionals: ["action?", "arg?"],
    options: { ...JSON_FLAG, title: text, goal: text, start: text, end: text },
    write: (values, positionals) => ["new", "start", "close", "edit"].includes(positionals[0]),
    creates: (values, positionals) => positionals[0] === "new",
    run({ action = "list", arg, values }, ctx) {
      const b = ctx.board();
      if (action === "list") {
        if (values.json) return ctx.json(b.sprints);
        const lines = b.sprints.map((s) => {
          const open = b.cards.filter((c) => c.sprint === s.id && c.status !== ARCHIVED).length;
          return sprintLine(s) + (s.state !== "closed" ? ` · ${open} card(s)` : s.closed ? ` · ${s.closed.done} done, ${s.closed.rolled} rolled on` : "");
        });
        return ctx.say(lines.join("\n") || `No sprints. Plan one: ${ctx.cli} sprint new "<title>"`);
      }
      if (action === "new") {
        const change = sprintNew(b, { title: arg, goal: values.goal, start: values.start, end: values.end });
        ctx.write(change);
        return ctx.done(values, change.sprint, `Planned sprint ${change.sprint.id}: ${change.sprint.title}. Start it: ${ctx.cli} sprint start ${change.sprint.id}`);
      }
      if (action === "start") {
        const change = sprintStart(b, arg, stamp().slice(0, 10));
        ctx.write(change);
        return ctx.done(values, change.sprint, `Sprint ${change.sprint.id} "${change.sprint.title}" is active.`);
      }
      if (action === "close") {
        const change = sprintClose(b, arg, stamp());
        ctx.write(change);
        const { closed } = change.sprint;
        return ctx.done(values, { sprint: change.sprint, next: change.next?.id ?? null },
          `Sprint ${change.sprint.id} closed: ${closed.done} done card(s) archived, ${closed.rolled} unfinished card(s) to ${change.next ? `sprint ${change.next.id}` : "the backlog"}.`);
      }
      if (action === "edit") {
        if (!arg) throw usage("sprint edit takes the sprint's id");
        const change = sprintEdit(b, arg, { title: values.title, goal: values.goal, start: values.start, end: values.end });
        ctx.write(change);
        return ctx.done(values, change.sprint, `Sprint ${change.sprint.id} changed.`);
      }
      throw usage(`sprint takes list, new, start, close, or edit, not "${action}"`);
    },
  },

  config: {
    options: { ...JSON_FLAG, "start-mode": text, parallel: text },
    write: (values) => values["start-mode"] !== undefined || values.parallel !== undefined,
    creates: true,
    run({ values }, ctx) {
      const b = ctx.board();
      const config = configOf(b);
      const mode = choice(values["start-mode"], "--start-mode", START_MODES);
      const parallel = int(values.parallel, "--parallel");
      if (parallel !== undefined && parallel < 1) throw usage(`--parallel is a whole number above 0, not "${values.parallel}"`);
      if (mode !== undefined || parallel !== undefined) {
        Object.assign(config, mode ? { startMode: mode } : {}, parallel ? { parallel } : {});
        ctx.write({ config });
      }
      const { extra, ...shown } = config;
      return ctx.done(values, shown, [
        `Columns: ${config.columns.map((c) => `${c.id}${c.role ? ` (${c.role})` : ""}`).join(", ")}`,
        `Start mode: ${config.startMode}. Parallel: ${config.parallel}. Tracker sync: ${config.remote.enabled ? "on" : "off"}.`,
      ].join("\n"));
    },
  },

  remote: {
    positionals: ["action?"],
    options: { ...JSON_FLAG, "dry-run": flag },
    run({ action = "status", values }, ctx) {
      const opts = { run: ctx.io.run, env: ctx.io.env };
      if (action === "status") {
        const s = remoteStatus(ctx.loc, ctx.board(), opts);
        return ctx.done(values, s, [
          `Tracker sync is ${s.enabled ? "on" : "off"}${s.provider ? `: ${s.provider}${s.repo ? ` ${s.repo}` : ""}` : ": the origin remote is neither GitHub nor GitLab"}.`,
          `${s.linked} card(s) linked to an issue, ${s.unlinked} without one, ${s.changed} changed since the last pass.`,
          ...(s.enabled ? [] : [`${ctx.cli} remote on turns it on; the first pass opens an issue for each card without one.`]),
        ].join("\n"));
      }
      if (action === "on" || action === "off") {
        ensureBoard(ctx.loc);
        const config = withBoardLock(ctx.loc.dir, () => {
          const next = { ...configOf(ctx.board(true)), remote: { enabled: action === "on" } };
          writeChange(ctx.loc.dir, { config: next });
          return next;
        });
        return ctx.done(values, { remote: config.remote }, `Tracker sync is ${action}.${action === "on" ? ` ${ctx.cli} remote sync runs a pass.` : ""}`);
      }
      if (action === "sync") {
        const r = remoteSync(ctx.loc, { ...opts, dryRun: values["dry-run"] === true });
        return ctx.done(values, r, [
          `${r.dryRun ? "Would sync" : "Synced"} with ${r.provider}: ${r.pushed} pushed, ${r.pulled} pulled${r.created ? ` (${r.created} new card(s))` : ""}${r.skipped ? `, ${r.skipped} left for the next pass` : ""}.`,
          ...(r.columns ? ["The board took the tracker board's columns."] : []), ...r.notices,
        ].join("\n"));
      }
      throw usage(`remote takes status, sync, on, or off, not "${action}"`);
    },
  },

  // ---- the loop ---------------------------------------------------------

  propose: {
    options: { ...JSON_FLAG, max: text, ids: text },
    run({ values }, ctx) {
      const max = int(values.max, "--max");
      if (max !== undefined && max < 1) throw usage(`--max is a whole number above 0, not "${values.max}"`);
      const p = propose(ctx.board(), { config: conflictConfig(ctx.loc.cfg), max, ids: values.ids === undefined ? undefined : idList(values.ids) });
      if (values.json) return ctx.json(p);
      const out = [];
      if (p.inFlight.length) out.push(`In flight (${p.inFlight.length}): ${p.inFlight.map((c) => [c.id, c.session].filter(Boolean).join(" ")).join(", ")}`);
      if (p.run.length) {
        out.push(`Run (${p.run.length} of ${p.max}):`);
        for (const c of p.run) out.push(`  ${c.id} ${c.title}${c.locks.length ? `  (locks: ${c.locks.map((l) => `${l.resource} ${l.scope}`).join(", ")})` : ""}`);
      } else out.push("Nothing can start now.");
      if (p.held.length) out.push("Held:", ...p.held.map((c) => `  ${c.id} ${c.title}: ${c.reasons.join("; ")}`));
      if (p.warnings.length) out.push("Warnings:", ...p.warnings.map((w) => `  ${w}`));
      if (p.run.length) {
        out.push("Ask the person, showing the set, the held cards and why, and the locks. The approval to ask for: each child pushes its branch and opens its pull or merge request without asking; this session merges on green after review.");
        out.push(`On a clear yes: ${ctx.cli} grant ${p.run.map((c) => c.id).join(",")} --by "<who, when>"`);
      }
      return ctx.say(out.join("\n"));
    },
  },

  grant: {
    positionals: ["ids..."],
    options: { ...JSON_FLAG, by: text, branch: text },
    write: true,
    run({ ids, values }, ctx) {
      if (!values.by?.trim()) throw usage('grant needs --by "<who, when>": whose approval this is and when they gave it');
      const picked = idList(ids);
      if (values.branch !== undefined && picked.length !== 1) throw usage("--branch names one card's branch: grant the cards one at a time");
      const b = ctx.board();
      const taken = new Map(b.cards.filter((c) => c.branch && !isFinished(b, c)).map((c) => [c.branch, c.id]));
      const changes = picked.map((id) => {
        const card = ctx.loopable(b, ctx.card(b, id));
        const branch = values.branch ?? card.branch ?? defaultBranch(card);
        if (!BRANCH.test(branch)) throw usage(`a granted branch is <type>/<topic>, the type one of feat, fix, chore, docs, test, ci; "${branch}" is not`);
        if (card.worktree && card.branch && card.branch !== branch) throw refused(`${card.id} is claimed on ${card.branch}: abandon it before granting another branch`);
        if (taken.has(branch) && taken.get(branch) !== card.id) throw refused(`${branch} is already bound to ${taken.get(branch)}`);
        taken.set(branch, card.id);
        return { card, branch, grant: grantText(values.by, branch, card.id) };
      });
      for (const { card, branch, grant } of changes) {
        ctx.bind(b, card, { grant, branch, updated: stamp() });
        // A card already claimed carries its grant in git config too.
        if (card.worktree) writeGrant(ctx.loc, branch, grant);
      }
      return ctx.done(values, changes.map((c) => ({ id: c.card.id, branch: c.branch, grant: c.grant })), changes.map((c) => `Card ${c.card.id} granted: "${c.grant}"`).join("\n"));
    },
  },

  brief: {
    positionals: ["id"],
    run({ id }, ctx) {
      const b = ctx.board();
      const card = ctx.loopable(b, ctx.card(b, id));
      const cardPath = path.join(ctx.loc.dir, card.source === "plan" ? shadowFile(card.plan) : card.file);
      const template = readText(path.join(TEMPLATES, "brief.md")) ?? BRIEF_TEMPLATE;
      const aw = `node "${AW}"`;
      return ctx.say(renderBrief(template, {
        card, board: b, config: conflictConfig(ctx.loc.cfg), cli: { board: `${aw} board`, lock: `${aw} lock` }, cardPath, base: planBase(ctx.loc),
        planRef: b.planRef, change: detectRemote(ctx.loc, { run: ctx.io.run, env: ctx.io.env }).noun ?? undefined,
      }).trimEnd());
    },
  },

  bind: {
    positionals: ["id"],
    options: { ...JSON_FLAG, session: text, terminal: flag, serial: flag },
    write: true,
    run({ id, values }, ctx) {
      if ([values.session !== undefined, values.terminal, values.serial].filter(Boolean).length !== 1) {
        throw usage("bind takes one of --session <name>, --terminal, or --serial");
      }
      const session = values.terminal ? "terminal" : values.serial ? "serial" : values.session.trim();
      if (!session) throw usage("--session takes the child session's name");
      const b = ctx.board();
      const card = ctx.loopable(b, ctx.card(b, id));
      if (card.session && card.session !== session) throw refused(`${card.id} is bound to ${card.session}: abandon it first`);
      ctx.start(b, card, { session, updated: stamp() });
      return ctx.done(values, { id: card.id, session }, `Card ${card.id} is bound to ${session}${card.grant ? "" : "; it carries no push grant, so the child's push asks the person"}.`);
    },
  },

  claim: {
    positionals: ["id"],
    options: JSON_FLAG,
    write: true,
    run({ id, values }, ctx) {
      const { loc } = ctx;
      if (!loc.git) throw refused("claim runs in a card's own worktree: this folder is in no git repository");
      if (loc.toplevel === loc.main) throw refused(`claim runs in the card's own worktree, never the main checkout at ${loc.main}`);
      const branch = loc.branch;
      if (!branch) throw refused("this worktree is on a detached HEAD: git switch -c <type>/<topic> first");
      if (branch === planBase(loc)) throw refused(`this worktree is on ${branch}, the base branch: git switch -c <type>/<topic> first`);
      const b = ctx.board();
      const card = ctx.loopable(b, ctx.card(b, id));
      if (card.branch && card.branch !== branch) throw refused(`${card.id}'s grant covers ${card.branch}, and this worktree is on ${branch}: git switch -c ${card.branch} first`);
      const other = b.cards.find((c) => c.id !== card.id && c.branch === branch && !isFinished(b, c));
      if (other) throw refused(`${branch} is already bound to ${other.id}: start a branch of its own for ${card.id}`);
      if (card.worktree && card.worktree !== loc.toplevel) throw refused(`${card.id} is claimed by the worktree at ${card.worktree}`);
      // The first claim of a plan card sets its issue in progress here, so this branch's next commit carries it.
      const said = card.source === "plan" && !card.worktree ? runFunnel(loc, loc.toplevel, card.plan, "in-progress", ctx.io.stderr) : "";
      ctx.start(b, card, { branch, worktree: loc.toplevel, updated: stamp() });
      if (card.grant) writeGrant(loc, branch, card.grant);
      const grant = card.grant ? `; push grant written to branch.${branch}.agentic-engineering-push` : "; it carries no push grant, so the push asks the person";
      return ctx.done(values, { id: card.id, branch, worktree: loc.toplevel, granted: Boolean(card.grant) }, `Card ${card.id} is claimed on ${branch} in ${loc.toplevel}${grant}${said ? `: ${said}` : ""}`);
    },
  },

  done: {
    positionals: ["id"],
    options: { ...JSON_FLAG, merged: text },
    write: true,
    run({ id, values }, ctx) {
      const sha = values.merged?.trim() ?? "";
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw usage(`done needs --merged <sha>, the merge commit in full, not "${values.merged ?? ""}"`);
      const b = ctx.board();
      const card = ctx.loopable(b, ctx.card(b, id));
      const at = stamp();
      const out = [`Card ${card.id} is done at ${sha.slice(0, 12)}${card.branch ? `; the push grant for ${card.branch} is revoked` : ""}.`];
      if (card.source === "plan") {
        // The lane follows the issue on the base branch: done once the merged flip is fetched.
        ctx.shadow(b, card, { merged: sha, updated: at });
        if (card.planStatus !== "done") out.push(`${card.id} is still ${card.planStatus} on ${b.planRef}: fetch origin, or check that its done flip merged.`);
      } else {
        const change = planMove(b, card.id, doneColumn(b).id, { at });
        let moved = change.cards.find((c) => c.id === card.id);
        if (!moved) change.cards.push(moved = { ...card, updated: at });
        moved.merged = sha;
        ctx.write(change);
      }
      dropGrant(ctx.loc, card.branch);
      if (card.epic) {
        const fresh = ctx.board(true);
        const epic = fresh.cards.find((c) => c.id === card.epic);
        const children = fresh.cards.filter((c) => c.epic === card.epic && c.status !== SUGGESTED);
        if (epic && !isFinished(fresh, epic) && children.every((c) => isFinished(fresh, c))) {
          ctx.write(planMove(fresh, epic.id, doneColumn(fresh).id, { at }));
          out.push(`Epic ${epic.id} is done: its last card closed.`);
        }
      }
      return ctx.done(values, { id: card.id, merged: sha }, out.join("\n"));
    },
  },

  abandon: {
    positionals: ["id"],
    options: JSON_FLAG,
    write: true,
    run({ id, values }, ctx) {
      const b = ctx.board();
      const card = ctx.card(b, id);
      let said = "";
      if (card.source === "plan") said = planChange(ctx, b, card, planCardAbandon(card, stamp()));
      else ctx.write(abandon(b, card.id, stamp()));
      dropGrant(ctx.loc, card.branch);
      return ctx.done(values, { id: card.id, status: b.columns[0].id },
        `Card ${card.id} is abandoned, back in ${b.columns[0].id}${card.branch ? `; the push grant for ${card.branch} is revoked` : ""}${said}.`);
    },
  },

  evidence: {
    positionals: ["ids...?"],
    options: { ...JSON_FLAG, scope: text },
    run({ ids, values }, ctx) {
      const b = ctx.board();
      if (ids.length && values.scope !== undefined) throw usage("evidence takes card ids or --scope, not both");
      const scope = ids.length ? null : values.scope ?? SWEEP_SCOPES[0];
      const picked = scope ? sweepCards(b, scope) : idList(ids).map((id) => ctx.card(b, id));
      if (!picked) throw usage(`--scope is ${SWEEP_SCOPES.join(", ")}, not "${scope}"`);
      const at = Date.now();
      const { base, cards } = cardFacts(ctx.loc, picked);
      const rows = picked.map((c, i) => ({
        ...cardView(c), body: undefined, extra: undefined,
        doneWhen: c.source === "plan" ? (c.acceptance ?? []).map((a) => `- [${a.done ? "x" : " "}] ${a.text}`).join("\n") : doneCriteria(c.body),
        facts: cards[i], signals: signals(c, { base, ...cards[i] }, at),
      }));
      if (values.json) return ctx.json({ base, scope, cards: rows });
      if (!rows.length) return ctx.say(`No cards ${scope ? `in ${scope}` : "named"}.`);
      return ctx.say([`Read from ${base}; fetch first for what origin knows.`, ...rows.flatMap((r, i) => [cardLine(picked[i]), ...r.signals.map((s) => `  - ${s}`)])].join("\n"));
    },
  },

  wait: {
    options: { until: text, ids: text, timeout: text },
    run({ values }, ctx) {
      const timeout = Number(values.timeout ?? "540");
      if (!String(values.timeout ?? "540").trim() || !(Number.isFinite(timeout) && timeout >= 0)) throw usage(`--timeout takes seconds, not "${values.timeout}"`);
      let b = ctx.board();
      const until = values.until ?? roleIds(b, "review")[0] ?? "review";
      const target = b.columns.findIndex((c) => c.id === until);
      if (target === -1) throw usage(`--until takes a column: ${b.columns.map((c) => c.id).join(", ")}`);
      const start = new Set(roleIds(b, "start"));
      const ids = values.ids !== undefined ? idList(values.ids).map((id) => ctx.card(b, id).id) : b.cards.filter((c) => c.kind === "task" && start.has(c.status)).map((c) => c.id);
      if (!ids.length) throw usage("nothing is in progress to wait for: pass --ids");
      // A CARD line a child writes into its card counts once, so one left from an earlier round never wakes this wait.
      const reports = (board, c) => String(c.source === "plan" ? board.shadows[c.plan]?.body ?? "" : c.body ?? "").split("\n")
        .map((l) => l.trim()).filter((l) => l.startsWith(`CARD ${c.id} `));
      const seen = new Map(ids.map((id) => [id, new Set(reports(b, ctx.card(b, id)))]));
      const rank = (status) => (status === ARCHIVED ? b.columns.length : b.columns.findIndex((c) => c.id === status));
      const interval = Number(ctx.io.env.AW_WAIT_POLL_MS) > 0 ? Number(ctx.io.env.AW_WAIT_POLL_MS) : 2000;
      const deadline = Date.now() + timeout * 1000;
      for (;;) {
        const woke = [];
        for (const id of ids) {
          const c = b.cards.find((x) => x.id === id);
          if (!c) { woke.push(`${id} is no longer on the board`); continue; }
          if (rank(c.status) >= target) { woke.push(`${id} reached ${c.status}${c.mr !== undefined ? ` (!${c.mr})` : ""}`); continue; }
          const line = reports(b, c).find((l) => !seen.get(id).has(l));
          if (!line) continue;
          let readable = true;
          try { parseCardLine(line); } catch { readable = false; }
          woke.push(`${id} reported${readable ? "" : " a CARD line that does not parse"}: ${line}`);
        }
        if (woke.length) return ctx.say(woke.join("\n"));
        const left = deadline - Date.now();
        if (left <= 0) {
          ctx.say(`Still waiting after ${timeout}s: ${ids.map((id) => `${id} ${b.cards.find((x) => x.id === id)?.status}`).join(", ")}. Run wait again.`);
          return EXIT.waiting;
        }
        sleepSync(Math.min(interval, left));
        b = ctx.board(true);
      }
    },
  },
};

/** A plan card's header (where it was read, its blockers, its files, what holds it), then the issue as the base has it. */
function planShow(b, c) {
  const out = [cardLine(c), `plan issue ${c.file}, read from ${b.planRef}`, `type ${c.type}, status ${c.planStatus}, tracker ${c.tracker ?? "none"}`];
  if (c.after.length) out.push(`blocked by: ${c.after.map((id) => `${id} (${b.cards.find((x) => x.id === id)?.status ?? "not in the plan"})`).join(", ")}`);
  if (c.files.length) out.push(`files: ${c.files.join(", ")}`);
  const bound = ["session", "branch", "worktree"].filter((k) => c[k]).map((k) => `${k} ${c[k]}`);
  if (c.mr !== undefined) bound.push(`!${c.mr}`);
  if (bound.length) out.push(`bound: ${bound.join(", ")}`);
  return `${out.join("\n")}\n\n${String(c.body).trimEnd()}`;
}

/** Run the funnel for a plan card when the move calls for it, then write the shadow. Returns what the funnel said. */
function planChange(ctx, b, card, { status, change }) {
  const said = status ? runFunnel(ctx.loc, card.worktree, card.plan, status, ctx.io.stderr) : "";
  ctx.shadow(b, card, change);
  return said ? `: ${said}` : "";
}

// ---- running an action ------------------------------------------------

function context(io, name) {
  const loc = locate(io.cwd);
  const cli = `aw ${name}`;
  let cached = null;
  let plan = null;
  const lines = [];
  const ctx = {
    io, loc, cli, name,
    by: agentName(loc.cfg, io.env),
    // The plan is read from git once per run; the cards and shadows are re-read on a fresh board.
    board: (fresh = false) => (cached && !fresh ? cached : (cached = readFullBoard(loc, plan ??= readPlan(loc)))),
    fresh: () => { cached = null; },
    card: (b, id) => {
      const c = findCard(b, id);
      if (!c) throw usage(`no card with id "${id}" (${cli} list shows the ids)`);
      return c;
    },
    locked: false,
    // Every write, a card's or a shadow's, happens holding the board's lock.
    under: (fn) => {
      ensureBoard(loc);
      const out = ctx.locked ? fn() : withBoardLock(loc.dir, fn);
      cached = null;
      return out;
    },
    write: (change) => ctx.under(() => writeChange(loc.dir, change)),
    shadow: (b, card, change) => ctx.under(() => writeShadow(loc, shadowAfter(card, b.shadows[card.plan], change))),
    /** A card the loop can work: a task, accepted by the person, not finished. */
    loopable: (b, card) => {
      if (card.kind !== "task") throw refused(`${card.id} is ${isEpic(card) ? "an epic" : `a ${card.kind}`}: the loop works task cards`);
      if (card.status === SUGGESTED) throw refused(`${card.id} is suggested: the person accepts it first (${cli} move ${card.id} ${b.columns[0].id})`);
      if (isFinished(b, card)) throw refused(`${card.id} is ${card.status}: there is nothing left to work`);
      return card;
    },
    /** Set a card's loop fields (undefined drops one): a plan card's go on its shadow, a loose card's on its file. */
    bind: (b, card, change) => {
      if (card.source === "plan") return ctx.shadow(b, card, change);
      const next = { ...card, ...change };
      for (const k of Object.keys(change)) if (change[k] === undefined) delete next[k];
      return ctx.write({ cards: [next] });
    },
    /** bind, and a loose card still in the first column moves to in progress. A plan card's lane follows its session and worktree. */
    start: (b, card, change) => {
      if (card.source === "plan" || card.status !== b.columns[0].id) return ctx.bind(b, card, change);
      const moved = planMove(b, card.id, roleIds(b, "start")[0] ?? "in-progress", { at: change.updated });
      Object.assign(moved.cards.find((c) => c.id === card.id), change);
      return ctx.write(moved);
    },
    say: (line) => { lines.push(line); return EXIT.ok; },
    json: (doc) => { lines.push(jsonText(doc)); return EXIT.ok; },
    done: (values, doc, line) => (values.json ? ctx.json(doc) : ctx.say(line)),
    flush: () => { if (lines.length) io.stdout.write(`${lines.splice(0).join("\n")}\n`); },
  };
  return ctx;
}

/** `aw board <action> ...`, and `aw kanban`, the same under its first name. Resolves to the exit code. */
export async function main(argv, io) {
  io = ioOf(io);
  const name = io.command === "kanban" ? "kanban" : "board";
  const cli = `aw ${name}`;
  const [verb, ...rest] = argv;
  if (!verb || verb === "-h" || verb === "--help") {
    emit(io, usageText(cli));
    return verb ? EXIT.ok : EXIT.usage;
  }
  const spec = ACTIONS[verb];
  if (!spec) throw new AwError(`no action "${verb}" (${cli} --help lists them)`);
  const ctx = context(io, name);
  try {
    const parsed = parseArgs(rest, spec.options ?? {});
    if (parsed.help) {
      emit(io, usageText(cli));
      return EXIT.ok;
    }
    // A trailing `name...` takes every remaining positional, at least one; `name...?` takes any number.
    const names = spec.positionals ?? [];
    const variadic = /\.\.\.\??$/.test(names.at(-1) ?? "");
    const required = names.filter((n) => !n.endsWith("?"));
    const shown = names.map((n) => `<${n.replace(/\?$/, "")}>`).join(" ");
    if (parsed.positionals.length < required.length) throw usage(`${verb} takes ${shown}`);
    if (!variadic && parsed.positionals.length > names.length) throw usage(`${verb}: unexpected "${parsed.positionals[names.length]}"`);
    const args = { values: parsed.values };
    names.forEach((n, i) => {
      const many = /^(.+)\.\.\.\??$/.exec(n);
      if (many) args[many[1]] = parsed.positionals.slice(i);
      else if (parsed.positionals[i] !== undefined) args[n.replace("?", "")] = parsed.positionals[i];
    });
    const writes = typeof spec.write === "function" ? spec.write(parsed.values, parsed.positionals) : spec.write === true;
    // A writer reads the board inside the lock. An action that needs a card on a board nobody has made yet runs
    // without one: it has nothing to find, and making the folder for it would leave an empty board behind.
    const creates = typeof spec.creates === "function" ? spec.creates(parsed.values, parsed.positionals) : spec.creates === true;
    const lock = writes && (creates || fs.existsSync(ctx.loc.dir));
    let code;
    if (lock) {
      if (creates) ensureBoard(ctx.loc);
      code = withBoardLock(ctx.loc.dir, () => {
        ctx.locked = true;
        try { return spec.run(args, ctx); } finally { ctx.locked = false; }
      });
    } else code = spec.run(args, ctx);
    ctx.flush();
    return code;
  } catch (e) {
    ctx.flush();
    if (e instanceof BoardError) throw new AwError(e.message.replaceAll("{cli}", cli), e.kind === "usage" ? EXIT.usage : EXIT.finding);
    if (e instanceof AwError) throw new AwError(e.message.replaceAll("{cli}", cli), e.exitCode);
    throw e;
  }
}

// What lint reports, for a caller that has this module in hand.
export { findings };

runMain(import.meta.url, main);
