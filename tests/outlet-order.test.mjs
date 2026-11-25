import assert from "node:assert/strict";
import test from "node:test";
import { moveOutletOrder } from "../src/lib/outlet-order.ts";

test("moves one outlet up or down by swapping adjacent positions", () => {
  const outlets = ["OUT01", "OUT02", "OUT03"];
  assert.deepEqual(moveOutletOrder(outlets, 1, -1), [
    "OUT02",
    "OUT01",
    "OUT03",
  ]);
  assert.deepEqual(moveOutletOrder(outlets, 1, 1), [
    "OUT01",
    "OUT03",
    "OUT02",
  ]);
  assert.deepEqual(outlets, ["OUT01", "OUT02", "OUT03"]);
});

test("keeps the order unchanged when moving beyond the first or last item", () => {
  const outlets = ["OUT01", "OUT02"];
  assert.deepEqual(moveOutletOrder(outlets, 0, -1), outlets);
  assert.deepEqual(moveOutletOrder(outlets, 1, 1), outlets);
});
