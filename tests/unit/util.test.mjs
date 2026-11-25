import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./shim.mjs";

const { norm, isMasked } = await load("util.js");

test("norm: numbers ignore dashes, spaces, dots and brackets", () => {
  assert.equal(norm("555-0142"), "5550142");
  assert.equal(norm(" (555) 01.42 "), "5550142");
  assert.equal(norm("555‑0142"), "5550142"); // typographic dash
});

test("norm: names are trimmed and lower-cased", () => {
  assert.equal(norm("  Paul Martin "), "paul martin");
  assert.equal(norm("PAUL"), "paul");
});

test("isMasked: the stored value and both languages", () => {
  assert.ok(isMasked("Numéro masqué"));
  assert.ok(isMasked("hidden number"));
  assert.ok(!isMasked("555-0142"));
});
