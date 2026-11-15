// The unit lane. node:test and node:assert, no dependencies: a library that
// needs a test framework to prove a pure function works has already lost.
import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.mjs";

test("lowercases and hyphenates", () => {
  assert.equal(slugify("Hello World"), "hello-world");
});

test("strips accents and punctuation", () => {
  assert.equal(slugify("Crème Brûlée!"), "creme-brulee");
});

test("trims the hyphens it would otherwise leave at the ends", () => {
  assert.equal(slugify("  --spaced--  "), "spaced");
});

test("refuses a non-string rather than coercing one", () => {
  assert.throws(() => slugify(42), TypeError);
});
