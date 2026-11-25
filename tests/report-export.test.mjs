import test from "node:test";
import assert from "node:assert/strict";
import { formatExportDates } from "../src/lib/reports/export-dates.ts";

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
