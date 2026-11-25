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

test("keeps all 11 unique outlets in order and removes duplicate ids", () => {
  const elevenOutlets = Array.from({ length: 11 }, (_, index) => ({
    _id: `outlet-${index + 1}`,
    code: `OUT${String(index + 1).padStart(2, "0")}`,
    name: `Outlet ${index + 1}`,
    active: true,
  }));
  const duplicate = { ...elevenOutlets[10], name: "Duplicate name" };

  assert.deepEqual(
    normalizeOutlets([...elevenOutlets, duplicate]),
    elevenOutlets,
  );
});
