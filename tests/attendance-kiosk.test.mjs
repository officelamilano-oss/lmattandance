import test from "node:test";
import assert from "node:assert/strict";
import {
  getLocalClock,
  getShiftDateDueForAbsence,
  getShiftDateForPunch,
  getShiftPunchAction,
  hasShiftEnded,
  isValidShiftTime,
  SHIFT_GRACE_MINUTES,
} from "../src/lib/attendance-shifts.ts";
import {
  compareFaceDescriptors,
  decryptFaceDescriptor,
  encryptFaceDescriptor,
  isFaceDescriptor,
} from "../src/lib/face-templates.ts";
import { employeeShiftSchema } from "../src/lib/validation/business.ts";

test("shift absence is not due before 10:31 and is due at 10:31", () => {
  assert.equal(SHIFT_GRACE_MINUTES, 30);
  assert.equal(
    getShiftDateDueForAbsence(
      { date: "2026-01-15", minutes: 10 * 60 + 30 },
      "10:00",
    ),
    null,
  );
  assert.equal(
    getShiftDateDueForAbsence(
      { date: "2026-01-15", minutes: 10 * 60 + 31 },
      "10:00",
    ),
    "2026-01-15",
  );
});

test("overnight shift absence is assigned to the prior local date", () => {
  assert.equal(
    getShiftDateDueForAbsence(
      { date: "2026-01-16", minutes: 20 },
      "23:50",
    ),
    null,
  );
  assert.equal(
    getShiftDateDueForAbsence(
      { date: "2026-01-16", minutes: 21 },
      "23:50",
    ),
    "2026-01-15",
  );
  assert.equal(
    getShiftDateForPunch(
      { date: "2026-01-16", minutes: 60 },
      "22:00",
      "06:00",
    ),
    "2026-01-15",
  );
});

test("kiosk checks in at shift start and waits until shift end to check out", () => {
  const date = "2026-01-15";
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 9 * 60 + 59 },
      date,
      "10:00",
      "19:00",
      false,
      false,
    ),
    "WAIT_FOR_SHIFT",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 10 * 60 },
      date,
      "10:00",
      "19:00",
      false,
      false,
    ),
    "CHECK_IN",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 10 * 60 + SHIFT_GRACE_MINUTES },
      date,
      "10:00",
      "19:00",
      false,
      false,
    ),
    "CHECK_IN",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 10 * 60 + SHIFT_GRACE_MINUTES + 1 },
      date,
      "10:00",
      "19:00",
      false,
      false,
    ),
    "ABSENT",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 18 * 60 + 59 },
      date,
      "10:00",
      "19:00",
      true,
      false,
    ),
    "WAIT_FOR_CHECKOUT",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 19 * 60 },
      date,
      "10:00",
      "19:00",
      true,
      false,
    ),
    "CHECK_OUT",
  );
  assert.equal(
    getShiftPunchAction(
      { date, minutes: 19 * 60 + 1 },
      date,
      "10:00",
      "19:00",
      true,
      true,
    ),
    "DONE",
  );
});

test("overnight kiosk check-out belongs to the previous shift date", () => {
  const shiftDate = "2026-01-15";
  const afterMidnight = { date: "2026-01-16", minutes: 6 * 60 };
  assert.equal(
    hasShiftEnded(afterMidnight, shiftDate, "22:00", "06:00"),
    true,
  );
  assert.equal(
    getShiftPunchAction(
      afterMidnight,
      shiftDate,
      "22:00",
      "06:00",
      true,
      false,
    ),
    "CHECK_OUT",
  );
});

test("business clock uses the configured timezone", () => {
  assert.deepEqual(
    getLocalClock(new Date("2026-01-15T04:30:00.000Z"), "Asia/Kolkata"),
    { date: "2026-01-15", minutes: 10 * 60 },
  );
});

test("shift schedule accepts only valid distinct 24-hour times", () => {
  assert.equal(
    employeeShiftSchema.safeParse({
      shiftStartTime: "10:00",
      shiftEndTime: "19:00",
    }).success,
    true,
  );
  assert.equal(
    employeeShiftSchema.safeParse({
      shiftStartTime: "25:00",
      shiftEndTime: "19:00",
    }).success,
    false,
  );
  assert.equal(
    employeeShiftSchema.safeParse({
      shiftStartTime: "10:00",
      shiftEndTime: "10:00",
    }).success,
    false,
  );
  assert.equal(isValidShiftTime("09:30"), true);
  assert.equal(isValidShiftTime("9:30"), false);
});

test("face descriptors are validated, encrypted, decrypted, and compared", () => {
  const previousKey = process.env.KIOSK_ENCRYPTION_KEY;
  process.env.KIOSK_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const descriptor = Array.from({ length: 128 }, (_, index) => index / 256);
    const encrypted = encryptFaceDescriptor(descriptor);
    assert.deepEqual(decryptFaceDescriptor(encrypted), descriptor);
    assert.equal(compareFaceDescriptors(descriptor, descriptor), 0);
    assert.equal(isFaceDescriptor(descriptor), true);
    assert.equal(isFaceDescriptor([1, 2, 3]), false);
  } finally {
    if (previousKey === undefined) delete process.env.KIOSK_ENCRYPTION_KEY;
    else process.env.KIOSK_ENCRYPTION_KEY = previousKey;
  }
});
