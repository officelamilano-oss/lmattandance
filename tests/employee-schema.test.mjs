import test from "node:test";
import assert from "node:assert/strict";
import { employeeSchema } from "../src/lib/validation/business.ts";

const employee = {
  employeeCode: "OUT0001",
  fullName: "Ravi Patel",
  dateOfJoining: "2026-10-28",
  designation: "Kitchen Staff (Outlet)",
  employmentType: "FULL_TIME",
  mobile: "9876543210",
  outletId: "0123456789abcdef01234567",
  monthlyBaseSalary: 25000,
  salaryMethod: "FIXED_30_DAYS",
  pfEnabled: false,
  employeePfPercent: 0,
  employerPfPercent: 0,
};

test("employee profile accepts valid personal, bank, and identity details", () => {
  const result = employeeSchema.safeParse({
    ...employee,
    dateOfBirth: "2008-10-28",
    gender: "MALE",
    accountNumber: "123456789012",
    ifscCode: "ABCD0123456",
    panNumber: "ABCDE1234F",
    aadhaarNumber: "123456789012",
  });

  assert.equal(result.success, true);
});

test("employee profile requires employees to be at least 18 on joining date", () => {
  const result = employeeSchema.safeParse({
    ...employee,
    dateOfBirth: "2008-10-29",
  });

  assert.equal(result.success, false);
  if (!result.success)
    assert.ok(
      result.error.issues.some(
        (issue) =>
          issue.path[0] === "dateOfBirth" &&
          issue.message === "Employee must be at least 18 on the joining date.",
      ),
    );
});

test("employee profile rejects malformed account and identity numbers", () => {
  const result = employeeSchema.safeParse({
    ...employee,
    accountNumber: "123",
    ifscCode: "bad",
    panNumber: "bad",
    aadhaarNumber: "1234",
  });

  assert.equal(result.success, false);
});
