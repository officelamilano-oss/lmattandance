import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFaceAttendanceDuration,
  getDateInTimeZone,
  getFaceAttendanceDurationSeconds,
  getFaceAttendanceStatus,
} from "../src/lib/face-attendance-report.ts";
import { getIndiaDateRange } from "../src/lib/face-attendance-logs.ts";
import { employeeShiftSchema } from "../src/lib/validation/business.ts";

test("IST report range includes the complete final day", () => {
  const { start, endExclusive } = getIndiaDateRange(
    "2026-08-01",
    "2026-08-31",
  );
  assert.equal(start.toISOString(), "2026-07-31T18:30:00.000Z");
  assert.equal(endExclusive.toISOString(), "2026-08-31T18:30:00.000Z");
});

test("overnight face logs retain their clock-in date in IST", () => {
  const clockIn = new Date("2026-08-31T17:30:00.000Z");
  const clockOut = new Date("2026-08-31T19:30:00.000Z");
  assert.equal(getDateInTimeZone(clockIn), "2026-08-31");
  assert.equal(getDateInTimeZone(clockOut), "2026-09-01");
  assert.equal(getFaceAttendanceDurationSeconds(clockIn, clockOut), 7200);
});

test("open, clock-out-only, stale, and long-duration rows remain distinguishable", () => {
  assert.equal(
    getFaceAttendanceStatus({ clockIn: new Date(), clockOut: undefined }),
    "Open (No Clock Out)",
  );
  assert.equal(
    getFaceAttendanceStatus({ clockIn: undefined, clockOut: new Date() }),
    "No Clock In",
  );
  assert.equal(
    getFaceAttendanceStatus({
      clockIn: new Date("2026-08-31T10:00:00Z"),
      clockOut: new Date("2026-09-01T10:05:38Z"),
    }),
    "Check",
  );
  assert.equal(
    getFaceAttendanceStatus({
      clockIn: new Date("2026-08-31T10:00:00Z"),
      clockOut: null,
      missingClockOut: true,
    }),
    "Missing Clock Out",
  );
});

test("long durations display all hours and missing durations display --", () => {
  assert.equal(
    formatFaceAttendanceDuration(43 * 3600 + 23 * 60 + 43),
    "43:23:43",
  );
  assert.equal(formatFaceAttendanceDuration(null), "--");
});

test("shift times can be empty, but must be configured as a distinct pair", () => {
  assert.equal(employeeShiftSchema.safeParse({}).success, true);
  assert.equal(
    employeeShiftSchema.safeParse({ shiftStartTime: "10:00" }).success,
    false,
  );
  assert.equal(
    employeeShiftSchema.safeParse({
      shiftStartTime: "10:00",
      shiftEndTime: "10:00",
    }).success,
    false,
  );
  assert.equal(
    employeeShiftSchema.safeParse({
      shiftStartTime: "10:00",
      shiftEndTime: "19:00",
      shiftDurationHours: 8,
    }).success,
    true,
  );
});
