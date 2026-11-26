import test from "node:test";
import assert from "node:assert/strict";
import { formatExportDates } from "../src/lib/reports/export-dates.ts";
import {
  addEmployeeAdvanceSummaries,
  formatAdvanceDetails,
} from "../src/lib/reports/advance-details.ts";

test("formats standalone ISO dates and comma-separated date lists for exports", () => {
  assert.equal(formatExportDates("2026-10-01"), "01/10/2026");
  assert.equal(
    formatExportDates("2026-10-01, 2026-10-02, 2026-10-03"),
    "01/10/2026, 02/10/2026, 03/10/2026",
  );
});

test("formats date ranges while leaving payroll month values unchanged", () => {
  assert.equal(
    formatExportDates("2026-10-01 - 2026-10-31"),
    "01/10/2026 - 31/10/2026",
  );
  assert.equal(formatExportDates("Payroll month 2026-10"), "Payroll month 2026-10");
});

test("formats ISO timestamps in India date and time", () => {
  assert.equal(
    formatExportDates("2026-10-28T20:22:46.616Z"),
    "29/10/2026, 01:52",
  );
});

test("does not rewrite invalid ISO-like dates", () => {
  assert.equal(formatExportDates("2026-02-30"), "2026-02-30");
});

test("formats each advance by transaction date in date order", () => {
  assert.equal(
    formatAdvanceDetails([
      { date: "2026-11-06", amount: 2000 },
      { date: "2026-11-05", amount: 5000 },
    ]),
    "05/11/2026: ₹5,000.00, 06/11/2026: ₹2,000.00",
  );
});

test("keeps every advance row and adds date-wise details and employee totals", () => {
  const rows = addEmployeeAdvanceSummaries([
      {
        Date: "2026-11-06",
        "Approval Date": "2026-11-09",
        "Employee Code": "EMP002",
        Employee: "Ravi Patel",
        "Amount INR": 2000,
        "Given By": "Head office",
        Reference: "Second",
        Reason: "Medical expense",
        Status: "APPROVED",
        "Payroll Claimed": "No",
      },
      {
        Date: "2026-11-05",
        "Approval Date": "2026-11-08",
        "Employee Code": "EMP001",
        Employee: "Asha Shah",
        "Amount INR": 5000,
        "Given By": "Head office",
        Reference: "First",
        Reason: "Family emergency",
        Status: "APPROVED",
        "Payroll Claimed": "Yes",
      },
      {
        Date: "2026-11-05",
        "Approval Date": "2026-11-08",
        "Employee Code": "EMP002",
        Employee: "Ravi Patel",
        "Amount INR": 5000,
        "Given By": "Head office",
        Reference: "First",
        Reason: "Rent payment",
        Status: "APPROVED",
        "Payroll Claimed": "No",
      },
    ]);

  assert.deepEqual(Object.keys(rows[0]), [
    "Date",
    "Approval Date",
    "Employee Code",
    "Employee",
    "Amount INR",
    "Given By",
    "Reference",
    "Advance Details (Date / Amount INR)",
    "Reason",
    "Total Advances INR",
    "Status",
    "Payroll Claimed",
  ]);
  assert.deepEqual(rows, [
      {
        Date: "2026-11-06",
        "Approval Date": "2026-11-09",
        "Employee Code": "EMP002",
        Employee: "Ravi Patel",
        "Amount INR": 2000,
        "Given By": "Head office",
        Reference: "Second",
        Reason: "Medical expense",
        Status: "APPROVED",
        "Payroll Claimed": "No",
        "Advance Details (Date / Amount INR)":
          "05/11/2026: ₹5,000.00, 06/11/2026: ₹2,000.00",
        "Total Advances INR": 7000,
      },
      {
        Date: "2026-11-05",
        "Approval Date": "2026-11-08",
        "Employee Code": "EMP001",
        Employee: "Asha Shah",
        "Amount INR": 5000,
        "Given By": "Head office",
        Reference: "First",
        Reason: "Family emergency",
        Status: "APPROVED",
        "Payroll Claimed": "Yes",
        "Advance Details (Date / Amount INR)": "05/11/2026: ₹5,000.00",
        "Total Advances INR": 5000,
      },
      {
        Date: "2026-11-05",
        "Approval Date": "2026-11-08",
        "Employee Code": "EMP002",
        Employee: "Ravi Patel",
        "Amount INR": 5000,
        "Given By": "Head office",
        Reference: "First",
        Reason: "Rent payment",
        Status: "APPROVED",
        "Payroll Claimed": "No",
        "Advance Details (Date / Amount INR)":
          "05/11/2026: ₹5,000.00, 06/11/2026: ₹2,000.00",
        "Total Advances INR": 7000,
      },
  ]);
});
