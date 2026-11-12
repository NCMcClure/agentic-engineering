// animated-storytelling's contrast checker: the arithmetic the visual audit
// must never eyeball. One line per FG:BG pair, pinned to the digit, and an
// exit code a shell gate can act on: 0 when every pair clears 3:1, 1 when one
// fails it or cannot be read, 2 when no pair is given.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { contrast, parseColor, relLuminance } from "../../../plugins/animated-storytelling/skills/animated-storytelling/scripts/contrast-check.mjs";
import { REPO, runNode } from "./helpers.mjs";

const SCRIPT = path.join(REPO, "plugins", "animated-storytelling", "skills", "animated-storytelling", "scripts", "contrast-check.mjs");
const check = (...pairs) => runNode(SCRIPT, pairs);
const line = (fg, bg, ratio, body, large) => `${fg} on ${bg}: ${ratio}:1  body(4.5:1)=${body}  large/UI(3:1)=${large}\n`;

test("each pair prints its ratio and a verdict at both thresholds, and all clear exits 0", () => {
  const out = check("#5b5b66:#ffffff", "240,8%,55%:#f4f4f5", "hsl(240, 8%, 55%):#F4F4F5", "#fff:#000", "FFF:000", "0,0%,50%:#000", "390,50%,50%:#111", "210.5,33.3%,12.5%:#eee", "hsl(0,0%,100%):hsl(0,0%,0%)");
  assert.equal(out.stdout, [
    line("#5b5b66", "#ffffff", "6.70", "PASS", "PASS"),
    line("240,8%,55%", "#f4f4f5", "3.38", "fail", "PASS"),
    line("hsl(240, 8%, 55%)", "#F4F4F5", "3.38", "fail", "PASS"),
    line("#fff", "#000", "21.00", "PASS", "PASS"),
    line("FFF", "000", "21.00", "PASS", "PASS"),
    line("0,0%,50%", "#000", "5.32", "PASS", "PASS"),
    line("390,50%,50%", "#111", "5.73", "PASS", "PASS"),
    line("210.5,33.3%,12.5%", "#eee", "14.23", "PASS", "PASS"),
    line("hsl(0,0%,100%)", "hsl(0,0%,0%)", "21.00", "PASS", "PASS"),
  ].join(""));
  assert.equal(out.stderr, "");
  assert.equal(out.status, 0, "a pair between 3:1 and 4.5:1 is the caller's judgment, not a failure");
});

test("the verdicts turn exactly at 4.5:1 and 3:1", () => {
  const out = check("#767676:#fff", "#777:#fff", "#949494:#fff", "#959595:#fff");
  assert.equal(out.stdout, [
    line("#767676", "#fff", "4.54", "PASS", "PASS"),
    line("#777", "#fff", "4.48", "fail", "PASS"),
    line("#949494", "#fff", "3.03", "fail", "PASS"),
    line("#959595", "#fff", "3.00", "fail", "FAIL"),
  ].join(""));
  assert.equal(out.status, 1, "2.997 prints as 3.00 and still fails 3:1");
});

test("a pair under 3:1 fails the run, and the pairs after it are still reported", () => {
  const out = check("30,100%,49.8%:#fff", "#000:#000", "#fff:#000");
  assert.equal(out.stdout, line("30,100%,49.8%", "#fff", "2.55", "fail", "FAIL") + line("#000", "#000", "1.00", "fail", "FAIL") + line("#fff", "#000", "21.00", "PASS", "PASS"));
  assert.equal(out.status, 1);
});

test("a pair it cannot read is named on stderr and fails the run without stopping it", () => {
  const out = check("#12:#fff", "rgb(1,2,3):#fff", "nocolon", "it's:#fff", "#fff:", "a:b:#fff", "12,50,50:#fff", "#fff:#000");
  assert.equal(out.stderr, [
    "error: unparseable color: '#12' (use #rrggbb or h,s%,l%)",
    "error: unparseable color: 'rgb(1,2,3)' (use #rrggbb or h,s%,l%)",
    "skipping 'nocolon': expected FG:BG",
    "error: unparseable color: \"it's\" (use #rrggbb or h,s%,l%)",
    "error: unparseable color: '' (use #rrggbb or h,s%,l%)",
    "error: unparseable color: 'a:b' (use #rrggbb or h,s%,l%)",
    "error: unparseable color: '12,50,50' (use #rrggbb or h,s%,l%)",
    "",
  ].join("\n"));
  assert.equal(out.stdout, line("#fff", "#000", "21.00", "PASS", "PASS"));
  assert.equal(out.status, 1);
});

test("the pair is echoed as typed, spaces and all, and split at its last colon", () => {
  assert.equal(check(" #777 : #fff ").stdout, line(" #777 ", " #fff ", "4.48", "fail", "PASS"));
});

test("with no pair it prints how to call it and exits 2", () => {
  const out = check();
  assert.equal(out.status, 2);
  assert.equal(out.stdout, "");
  assert.match(out.stderr, /^WCAG 2\.x contrast-ratio checker\./);
  assert.match(out.stderr, /node contrast-check\.mjs '#5b5b66:#ffffff'/);
  assert.doesNotMatch(out.stderr, /python/i);
});

test("colors parse to the same channels however they are written", () => {
  assert.deepEqual(parseColor("#5B5b66"), [91, 91, 102]);
  assert.deepEqual(parseColor("5b5b66"), [91, 91, 102]);
  assert.deepEqual(parseColor("#abc"), [170, 187, 204]);
  assert.deepEqual(parseColor("0,0%,50%"), [128, 128, 128], "127.5 rounds to the even channel");
  assert.deepEqual(parseColor("0,0%,49.8%"), [127, 127, 127]);
  assert.deepEqual(parseColor("hsl(120, 100%, 50%)"), [0, 255, 0]);
  assert.deepEqual(parseColor("480,100%,50%"), [0, 255, 0], "a hue past 360 wraps");
  assert.deepEqual(parseColor("240,8%,55%"), [131, 131, 149]);
  for (const bad of ["", "#12", "#1234", "red", "rgb(1,2,3)", "12,50,50", "-10,50%,50%"]) assert.throws(() => parseColor(bad), /unparseable color/, bad);
});

test("luminance and ratio follow the WCAG formula, whichever color is given first", () => {
  assert.equal(relLuminance([0, 0, 0]), 0);
  assert.ok(Math.abs(relLuminance([255, 255, 255]) - 1) < 1e-12);
  assert.ok(Math.abs(contrast([255, 255, 255], [0, 0, 0]) - 21) < 1e-9);
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), contrast([255, 255, 255], [0, 0, 0]));
  assert.equal(contrast([18, 52, 86], [18, 52, 86]), 1);
});
