#!/usr/bin/env node
// WCAG 2.x contrast-ratio checker. Node stdlib only.
//
// The five-point visual audit needs exact contrast arithmetic, and that is this
// script's job, never the model's. Each argument is one FG:BG pair; a color is
// hex (#rgb or #rrggbb) or hsl (h,s%,l%).
//
//   node contrast-check.mjs '#5b5b66:#ffffff' '240,8%,55%:#f4f4f5' ...
//
// One line per pair: the ratio, and pass or fail at the two WCAG thresholds
// (4.5:1 body text, 3:1 large text and UI). Whether a pair is body text is your
// judgment, so a pair between the two thresholds still exits 0. Exit 1 when
// any pair fails 3:1 outright or cannot be read, so a shell gate catches hard
// failures. Exit 2 when no pair is given.
import fs from "node:fs";

const USAGE = `WCAG 2.x contrast-ratio checker.

Each argument is one FG:BG pair; colors are hex (#rgb / #rrggbb) or hsl (h,s%,l%).

Usage:
    node contrast-check.mjs '#5b5b66:#ffffff' '240,8%,55%:#f4f4f5' ...

Output: one line per pair: the ratio, and pass/fail at the two WCAG thresholds
(4.5:1 body text, 3:1 large text / UI). Exit 0 when every pair passes 3:1
(which pairs must also pass 4.5:1 as body text is your judgment); exit 1 when
any pair fails 3:1 outright, so a shell gate can catch hard failures.`;

/** Round to the nearest integer, a tie going to the even one, so a channel is never biased upward. */
function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return [r, g, b].map((v) => roundHalfEven((v + m) * 255));
}

/** A string in quotes for an error message, the quote chosen so the text needs no escaping where it can. */
function quoted(text) {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  return quote + text.replace(/\\/g, "\\\\").replace(new RegExp(quote, "g"), `\\${quote}`).replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + quote;
}

/** `[r, g, b]`, each 0 to 255. Throws on a token that is neither hex nor hsl. */
export function parseColor(token) {
  const tok = token.trim().toLowerCase();
  let m = /^#?([0-9a-f]{6})$/.exec(tok);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#?([0-9a-f]{3})$/.exec(tok);
  if (m) return [...m[1]].map((ch) => parseInt(ch + ch, 16));
  m = /^(?:hsl\()?\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)?$/.exec(tok);
  if (m) return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  throw new Error(`unparseable color: ${quoted(tok)} (use #rrggbb or h,s%,l%)`);
}

export function relLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg, bg) {
  const [dark, light] = [relLuminance(fg), relLuminance(bg)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

export function main(argv) {
  if (!argv.length) {
    console.error(USAGE);
    return 2;
  }
  let hardFail = false;
  for (const pair of argv) {
    const cut = pair.lastIndexOf(":");
    if (cut === -1) {
      console.error(`skipping ${quoted(pair)}: expected FG:BG`);
      hardFail = true;
      continue;
    }
    const fg = pair.slice(0, cut), bg = pair.slice(cut + 1);
    let ratio;
    try { ratio = contrast(parseColor(fg), parseColor(bg)); } catch (error) {
      console.error(`error: ${error.message}`);
      hardFail = true;
      continue;
    }
    if (ratio < 3) hardFail = true;
    console.log(`${fg} on ${bg}: ${ratio.toFixed(2)}:1  body(4.5:1)=${ratio >= 4.5 ? "PASS" : "fail"}  large/UI(3:1)=${ratio >= 3 ? "PASS" : "FAIL"}`);
  }
  return hardFail ? 1 : 0;
}

const invoked = () => { try { return fs.realpathSync(process.argv[1]) === import.meta.filename; } catch { return false; } };
if (invoked()) process.exitCode = main(process.argv.slice(2));
