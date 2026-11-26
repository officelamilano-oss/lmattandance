import test from "node:test";
import assert from "node:assert/strict";
import { advanceSchema } from "../src/lib/validation/business.ts";

const advance = {
  employeeId: "0123456789abcdef01234567",
  outletId: "0123456789abcdef01234567",
  date: "2026-11-05",
  amount: 5000,
  givenBy: "Head office",
  reference: "Cash",
};

test("advance requires a non-empty reason", () => {
  assert.equal(advanceSchema.safeParse(advance).success, false);
  assert.equal(
    advanceSchema.safeParse({ ...advance, reason: "   " }).success,
    false,
  );
  assert.equal(
    advanceSchema.safeParse({ ...advance, reason: "Medical expense" }).success,
    true,
  );
});
