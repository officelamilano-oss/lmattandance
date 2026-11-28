import type { FaceAttendanceLogDocument } from "@/lib/models";

export type FaceAttendanceStatus =
  | "Completed"
  | "Open (No Clock Out)"
  | "No Clock In"
  | "Missing Clock Out"
  | "Check";

export function getFaceAttendanceStatus(
  log: Pick<
    FaceAttendanceLogDocument,
    "clockIn" | "clockOut" | "missingClockOut" | "shiftDurationHours"
  >,
  maxHours = 16,
): FaceAttendanceStatus {
  if (log.missingClockOut) return "Missing Clock Out";
  if (!log.clockIn) return "No Clock In";
  if (!log.clockOut) return "Open (No Clock Out)";
  const durationHours =
    (log.clockOut.getTime() - log.clockIn.getTime()) / 3_600_000;
  if (
    durationHours < 0 ||
    durationHours > maxHours ||
    (log.shiftDurationHours !== undefined &&
      durationHours > log.shiftDurationHours + 2)
  )
    return "Check";
  return "Completed";
}

export function getFaceAttendanceDurationSeconds(
  clockIn?: Date | null,
  clockOut?: Date | null,
) {
  if (!clockIn || !clockOut) return null;
  const seconds = Math.floor(
    (clockOut.getTime() - clockIn.getTime()) / 1000,
  );
  return seconds >= 0 ? seconds : null;
}

export function formatFaceAttendanceDuration(seconds: number | null) {
  if (seconds === null) return "--";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function getDateInTimeZone(
  date: Date,
  timeZone = "Asia/Kolkata",
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  if (!year || !month || !day)
    throw new Error("Unable to determine local attendance date.");
  return `${year}-${month}-${day}`;
}

export function getFaceAttendanceStatusRank(status: FaceAttendanceStatus) {
  switch (status) {
    case "Completed":
      return 0;
    case "No Clock In":
      return 1;
    case "Open (No Clock Out)":
      return 2;
    case "Check":
      return 3;
    case "Missing Clock Out":
      return 4;
  }
}
