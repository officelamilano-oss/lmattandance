import type { Db, ObjectId } from "mongodb";
import type {
  AttendancePunchDocument,
  AttendanceStatus,
  EmployeeDocument,
  SalarySettings,
} from "@/lib/models";
import { ensureEmployeeAbsent } from "@/lib/auto-absence";
import {
  getLocalClock,
  getShiftDateCandidates,
  getShiftDateForPunch,
  getShiftPunchAction,
  hasShiftEnded,
  type ShiftPunchAction,
} from "@/lib/attendance-shifts";

export type KioskAttendanceState = {
  date: string;
  action: ShiftPunchAction | "CONTACT_MANAGER";
  message?: string;
};

export async function getKioskAttendanceState(
  db: Db,
  employee: EmployeeDocument,
  outletId: ObjectId,
  now: Date,
): Promise<KioskAttendanceState> {
  if (!employee.shiftStartTime || !employee.shiftEndTime)
    return {
      date: "",
      action: "CONTACT_MANAGER",
      message: "Your shift schedule is not configured. Contact your manager.",
    };
  const shiftStartTime = employee.shiftStartTime;
  const shiftEndTime = employee.shiftEndTime;

  const settings = await db
    .collection<SalarySettings & { _id: string }>("settings")
    .findOne({ _id: "payroll" });
  const timezone =
    settings?.timezone ?? process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";
  const clock = getLocalClock(now, timezone);
  const candidateDates = getShiftDateCandidates(clock);
  const punches = await db
    .collection<AttendancePunchDocument>("attendancePunches")
    .find({
      employeeId: employee._id,
      outletId,
      date: { $in: candidateDates },
    })
    .toArray();
  const openCompletedShift = punches
    .filter(
      (punch) =>
        punch.checkInAt &&
        !punch.checkOutAt &&
        hasShiftEnded(
          clock,
          punch.date,
          shiftStartTime,
          shiftEndTime,
        ),
    )
    .sort((first, second) => second.date.localeCompare(first.date))[0];
  const date =
    openCompletedShift?.date ??
    getShiftDateForPunch(
      clock,
      shiftStartTime,
      shiftEndTime,
    );
  const punch =
    openCompletedShift ?? punches.find((item) => item.date === date);
  const attendanceDay = await db
    .collection<{
      entries: Array<{ employeeId: ObjectId; status: AttendanceStatus }>;
    }>("attendance")
    .findOne(
      { outletId, date },
      { projection: { entries: 1 } },
    );
  const attendanceStatus = attendanceDay?.entries.find((entry) =>
    entry.employeeId.equals(employee._id),
  )?.status;

  if (attendanceStatus && attendanceStatus !== "P")
    return {
      date,
      action: "CONTACT_MANAGER",
      message: "Attendance is already marked. Please contact your manager.",
    };

  const action = getShiftPunchAction(
    clock,
    date,
    shiftStartTime,
    shiftEndTime,
    !!punch?.checkInAt,
    !!punch?.checkOutAt,
  );
  if (action === "ABSENT") {
    const absence = await ensureEmployeeAbsent(db, {
      outletId,
      employeeId: employee._id,
      date,
      now,
    });
    if (absence.status !== "P")
      return {
        date,
        action: absence.status === "A" ? "ABSENT" : "CONTACT_MANAGER",
        message:
          absence.status === "A"
            ? "The 30-minute grace period has ended. Attendance is marked absent; contact your manager."
            : "Attendance is locked for this day. Please contact your manager.",
      };
    return {
      date,
      action: "CONTACT_MANAGER",
      message: "Attendance is already marked present. Contact your manager to correct the punch.",
    };
  }

  if (action === "WAIT_FOR_SHIFT")
    return {
      date,
      action,
      message: `Your shift starts at ${shiftStartTime}. Attendance will be marked automatically when your shift starts.`,
    };
  if (action === "WAIT_FOR_CHECKOUT")
    return {
      date,
      action,
      message: `Check-out is available at ${shiftEndTime}. Show your face again after your shift ends.`,
    };
  if (action === "DONE")
    return {
      date,
      action,
      message: "Check-in and check-out are already complete for this shift.",
    };
  return { date, action };
}
