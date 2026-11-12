// The CARD line is the one line of a child's report the session that started
// it acts on, and only the start of a report is quoted back, so its grammar is
// fixed: CARD <id> <review|blocked|failed> !<number> lanes=... owed=... . A
// line that breaks the grammar is a usage error, never a guess.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BoardError } from "../../../plugins/agent-works/lib/board.mjs";
import { cardLineFormat, formatCardLine, parseCardLine } from "../../../plugins/agent-works/lib/report.mjs";

const usage = (fn, pattern) => assert.throws(fn, (e) => e instanceof BoardError && e.kind === "usage" && pattern.test(e.message));

test("a review line formats and parses back", () => {
  const report = { id: "0012", state: "review", mr: 35, lanes: [{ lane: "unit", result: "pass" }, { lane: "e2e", result: "fail" }], owed: ["0014", "live"] };
  const line = formatCardLine(report);
  assert.equal(line, "CARD 0012 review !35 lanes=unit:pass,e2e:fail owed=0014,live");
  assert.deepEqual(parseCardLine(line), report);
});

test("nothing owed, no lanes run, and no change request each have their dash", () => {
  assert.equal(formatCardLine({ id: "01-02-03", state: "blocked", mr: null, lanes: [], owed: [] }), "CARD 01-02-03 blocked !- lanes=- owed=-");
  assert.deepEqual(parseCardLine("CARD 01-02-03 failed !- lanes=- owed=-"), { id: "01-02-03", state: "failed", mr: null, lanes: [], owed: [] });
});

test("the parser finds the CARD line in a whole message, and says null when there is none", () => {
  const message = "CARD 0007 review !12 lanes=unit:pass owed=-\n\nVerdict: done.\nCARD 0008 review !13 lanes=unit:pass owed=-";
  assert.equal(parseCardLine(message).id, "0007", "the first CARD line wins");
  assert.equal(parseCardLine("  CARD 0007 review !12 lanes=unit:pass owed=-  ").mr, 12);
  assert.equal(parseCardLine("Verdict: done, no card line."), null);
});

test("a broken line is a usage error that names what is wrong", () => {
  usage(() => parseCardLine("CARD 0007 merged !12 lanes=unit:pass owed=-"), /state "merged"/);
  usage(() => parseCardLine("CARD 0007 review !- lanes=unit:pass owed=-"), /review needs the pull or merge request/);
  usage(() => parseCardLine("CARD 0007 review !12 lanes=unit owed=-"), /lane "unit"/);
  usage(() => parseCardLine("CARD 0007 review !12 lanes=unit:skipped owed=-"), /lane "unit:skipped"/);
  usage(() => parseCardLine("CARD 0007 review !12 lanes=unit:pass"), /CARD <id>/);
  usage(() => formatCardLine({ id: "0007", state: "review", mr: 12, lanes: [], owed: ["two words"] }), /owed item "two words"/);
});

test("the format a brief shows names the card and every slot", () => {
  assert.equal(cardLineFormat("0012"), "CARD 0012 <review|blocked|failed> !<number> lanes=<lane>:<pass|fail>,... owed=<items|->");
});
