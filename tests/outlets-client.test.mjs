import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOutlets } from "../src/lib/outlets-client.ts";

const outlets = [
  { _id: "outlet-id", code: "OUT01", name: "Surdhara", active: true },
];

test("normalizes the outlet array and legacy wrapped response shapes", () => {
  assert.deepEqual(normalizeOutlets(outlets), outlets);
  assert.deepEqual(normalizeOutlets({ outlets }), outlets);
  assert.deepEqual(normalizeOutlets({ data: outlets }), outlets);
});

test("returns an empty array for failures and malformed list entries", () => {
  assert.deepEqual(normalizeOutlets(undefined), []);
  assert.deepEqual(normalizeOutlets({ error: "Unauthorized" }), []);
  assert.deepEqual(normalizeOutlets([null, "not an outlet"]), []);
});
