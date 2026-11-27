import { dateAfter } from "@/lib/payroll/dates";

export const SHIFT_GRACE_MINUTES = 30;

export interface LocalClock {
  date: string;
  minutes: number;
}

export type ShiftPunchAction =
  | "CHECK_IN"
  | "CHECK_OUT"
  | "WAIT_FOR_SHIFT"
  | "WAIT_FOR_CHECKOUT"
  | "DONE"
  | "ABSENT";

export function isValidShiftTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function getLocalClock(date: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  if (!year || !month || !day || !hour || !minute)
    throw new Error("Unable to determine local business time.");
  return {
    date: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

export function getShiftDateDueForAbsence(
  clock: LocalClock,
  shiftStartTime: string,
): string | null {
  if (!isValidShiftTime(shiftStartTime)) return null;
  const [hour, minute] = shiftStartTime.split(":").map(Number);
  const startMinutes = hour * 60 + minute;
  const threshold = startMinutes + SHIFT_GRACE_MINUTES + 1;
  if (threshold < 24 * 60)
    return clock.minutes >= threshold ? clock.date : null;

  const wrappedThreshold = threshold - 24 * 60;
  return clock.minutes >= wrappedThreshold && clock.minutes < startMinutes
    ? dateAfter(clock.date, -1)
    : null;
}

export function getShiftDateForPunch(
  clock: LocalClock,
  shiftStartTime: string,
  shiftEndTime: string,
): string {
  if (!isValidShiftTime(shiftStartTime) || !isValidShiftTime(shiftEndTime))
    return clock.date;
  const [startHour, startMinute] = shiftStartTime.split(":").map(Number);
  const [endHour, endMinute] = shiftEndTime.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  return startMinutes > endMinutes && clock.minutes < endMinutes
    ? dateAfter(clock.date, -1)
    : clock.date;
}

export function getShiftDateCandidates(clock: LocalClock): string[] {
  return [clock.date, dateAfter(clock.date, -1)];
}

export function hasShiftEnded(
  clock: LocalClock,
  shiftDate: string,
  shiftStartTime: string,
  shiftEndTime: string,
): boolean {
  if (!isValidShiftTime(shiftStartTime) || !isValidShiftTime(shiftEndTime))
    return false;
  const [startHour, startMinute] = shiftStartTime.split(":").map(Number);
  const [endHour, endMinute] = shiftEndTime.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const overnight = startMinutes > endMinutes;
  const shiftEnd = endMinutes + (overnight ? 24 * 60 : 0);
  const now = clock.minutes + (shiftDate < clock.date ? 24 * 60 : 0);
  return now >= shiftEnd;
}

export function getShiftPunchAction(
  clock: LocalClock,
  shiftDate: string,
  shiftStartTime: string,
  shiftEndTime: string,
  hasCheckedIn: boolean,
  hasCheckedOut: boolean,
): ShiftPunchAction {
  if (hasCheckedOut) return "DONE";
  if (!isValidShiftTime(shiftStartTime) || !isValidShiftTime(shiftEndTime))
    return "WAIT_FOR_SHIFT";

  const [startHour, startMinute] = shiftStartTime.split(":").map(Number);
  const [endHour, endMinute] = shiftEndTime.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;
  const overnight = startMinutes > endMinutes;
  const offset = shiftDate < clock.date ? 24 * 60 : 0;
  const now = clock.minutes + offset;
  const shiftStart = startMinutes;
  const shiftEnd = endMinutes + (overnight ? 24 * 60 : 0);

  if (hasCheckedIn)
    return now >= shiftEnd ? "CHECK_OUT" : "WAIT_FOR_CHECKOUT";
  if (now < shiftStart) return "WAIT_FOR_SHIFT";
  if (now <= shiftStart + SHIFT_GRACE_MINUTES) return "CHECK_IN";
  return "ABSENT";
}
