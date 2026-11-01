import type {
  AttendanceDayDocument,
  EmployeeDocument,
  UserRole,
} from "@/lib/models";

export function isAttendanceEntryLocked(
  submitted: boolean,
  role: UserRole,
) {
  return submitted && role !== "MAIN_ADMIN";
}

export function isAttendanceOutletSubmitted(
  day: AttendanceDayDocument | undefined,
  activeEmployees: Pick<EmployeeDocument, "_id">[],
) {
  if (day?.status !== "SUBMITTED") return false;
  const submittedEmployeeIds = new Set(
    day.entries
      .filter((entry) => entry.submitted !== false)
      .map((entry) => entry.employeeId.toHexString()),
  );
  return activeEmployees.every((employee) =>
    submittedEmployeeIds.has(employee._id.toHexString()),
  );
}
