import "server-only";

import type {
  AttendanceDayDocument,
  EmployeeDocument,
  SalarySettings,
} from "@/lib/models";
import { getDb } from "@/lib/mongodb";
import {
  countNotMarkedDays,
  getLatestAttendanceEntry,
} from "@/lib/payroll/calculate";
import { dateAfter, getMonthDates } from "@/lib/payroll/dates";

export async function getNotMarkedDays(
  employee: EmployeeDocument,
  month: string,
  cutoffDate: string,
  periodStart = `${month}-01`,
): Promise<number> {
  const db = await getDb();
  const settings = await db
    .collection<SalarySettings & { _id: string }>("settings")
    .findOne({ _id: "payroll" });
  const timezone =
    settings?.timezone || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
  const latestDate = [
    cutoffDate,
    `${month}-${String(getMonthDates(month).daysInMonth).padStart(2, "0")}`,
    employee.deactivatedAt ?? cutoffDate,
    (settings?.countTodayAsNotMarked ?? true) ? today : dateAfter(today, -1),
  ].sort()[0];
  const firstDate = [
    `${month}-01`,
    employee.dateOfJoining,
    periodStart,
  ].sort().reverse()[0];
  if (firstDate > latestDate) return 0;
  const attendanceDays = await db
    .collection<AttendanceDayDocument>("attendance")
    .find({
      outletId: employee.outletId,
      date: { $gte: firstDate, $lte: latestDate },
      status: "SUBMITTED",
    })
    .project<Pick<AttendanceDayDocument, "date" | "entries" | "updatedAt">>({
      date: 1,
      entries: 1,
      updatedAt: 1,
    })
    .toArray();
  const statusByDate = new Map<string, string>();
  for (const day of attendanceDays) {
    const entry = getLatestAttendanceEntry(
      day.entries.filter((item) =>
        ["P", "A", "HD", "WO"].includes(item.status),
      ),
      employee._id.toHexString(),
      {
        outletId: employee.outletId.toHexString(),
        date: day.date,
      },
    );
    if (entry) statusByDate.set(day.date, entry.status);
  }
  const dates = getMonthDates(month).dates.filter(
    (date) => date >= firstDate && date <= latestDate,
  );
  return countNotMarkedDays({
    dates,
    markedStatuses: statusByDate,
    dateOfJoining: employee.dateOfJoining,
    deactivatedAt: employee.deactivatedAt,
    cutoffDate: latestDate,
    today,
    holidays: settings?.declaredOffDays ?? [],
    countTodayAsNotMarked: settings?.countTodayAsNotMarked ?? true,
  });
}
