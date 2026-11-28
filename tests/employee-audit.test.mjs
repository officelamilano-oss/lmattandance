import assert from "node:assert/strict";
import test from "node:test";
import { employeeAuditChanges } from "../src/lib/audit.ts";

test("employee audit captures changed safe fields and hides private values", () => {
  const changes = employeeAuditChanges(
    {
      employeeCode: "OUT0001",
      fullName: "Ravi Patel",
      mobile: "9876543210",
      monthlyBaseSalary: 25000,
      accountNumber: "123456789012",
    },
    {
      employeeCode: "OUT0001",
      fullName: "Ravi Shah",
      mobile: "9876543211",
      monthlyBaseSalary: 30000,
      accountNumber: "123456789099",
    },
  );

  assert.deepEqual(changes.fullName, {
    before: "Ravi Patel",
    after: "Ravi Shah",
  });
  assert.deepEqual(changes.mobile, {
    before: "Value hidden",
    after: "Updated; value hidden",
  });
  assert.deepEqual(changes.monthlyBaseSalary, {
    before: "Value hidden",
    after: "Updated; value hidden",
  });
  assert.deepEqual(changes.accountNumber, {
    before: "Value hidden",
    after: "Updated; value hidden",
  });
  assert.equal(JSON.stringify(changes).includes("9876543210"), false);
  assert.equal(JSON.stringify(changes).includes("123456789012"), false);
});

test("new employee audit includes readable identity fields without private data", () => {
  const changes = employeeAuditChanges(undefined, {
    employeeCode: "OUT0001",
    fullName: "Ravi Patel",
    accountNumber: "123456789012",
  });

  assert.deepEqual(changes.employeeCode, { before: "", after: "OUT0001" });
  assert.deepEqual(changes.fullName, { before: "", after: "Ravi Patel" });
  assert.deepEqual(changes.accountNumber, {
    before: "",
    after: "Value hidden",
  });
  assert.equal(JSON.stringify(changes).includes("123456789012"), false);
});
