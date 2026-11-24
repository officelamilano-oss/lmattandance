import test from "node:test";
import assert from "node:assert/strict";
import { ObjectId } from "mongodb";
import {
  getEmployeeCodePrefix,
  getNextEmployeeCode,
} from "../src/lib/employee-code.ts";

test("generates the next employee code within the selected outlet", async () => {
  const outletId = new ObjectId();
  let query;
  const employees = {
    find(filter) {
      query = filter;
      return {
        toArray: async () => [
          { employeeCode: "NIK0011" },
          { employeeCode: "NIK0008" },
        ],
      };
    },
  };

  assert.equal(getEmployeeCodePrefix("Nikita outlet"), "NIK");
  assert.equal(
    await getNextEmployeeCode(employees, "NIK", outletId),
    "NIK0012",
  );
  assert.equal(query.outletId, outletId);
});
