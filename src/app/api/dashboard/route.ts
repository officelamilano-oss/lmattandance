import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
import { assertOutletAccess, getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import { calculatePayroll } from "@/lib/payroll/calculate";
import { isAttendanceOutletSubmitted } from "@/lib/attendance";
import { dateAfter, getMonthDates } from "@/lib/payroll/dates";
import { dateOnlySchema } from "@/lib/validation/common";
import type {
  AdvanceDocument,
  AttendanceDayDocument,
  EmployeeDocument,
  OutletDocument,
  SalaryRecordDocument,
  SalarySettings,
} from "@/lib/models";

type DashboardPart =
  | "summary"
  | "trend"
  | "away"
  | "outlets"
  | "attendance"
  | "notifications";

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("dashboard.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const db = await getDb();
    const settings = await db
      .collection<SalarySettings & { _id: string }>("settings")
      .findOne({ _id: "payroll" });
    const timezone =
      settings?.timezone ?? process.env.BUSINESS_TIMEZONE ?? "Asia/Kolkata";
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
    }).format(new Date());
    const url = new URL(request.url);
    const requestedParts = url.searchParams.get("parts");
    const validParts: DashboardPart[] = [
      "summary",
      "trend",
      "away",
      "outlets",
      "attendance",
      "notifications",
    ];
    const parts = new Set<DashboardPart>(
      requestedParts
        ? requestedParts.split(",").filter((part): part is DashboardPart =>
            validParts.includes(part as DashboardPart),
          )
        : validParts,
    );
    if (
      requestedParts &&
      (!parts.size ||
        requestedParts.split(",").some((part) => !validParts.includes(part as DashboardPart)))
    )
      return NextResponse.json(
        { error: "Dashboard parts must be summary, trend, away, outlets, attendance, or notifications." },
        { status: 400 },
      );
    const wants = (part: DashboardPart) => parts.has(part);
    const requestedDate = url.searchParams.get("date") ?? today;
    const dateResult = dateOnlySchema.safeParse(requestedDate);
    if (!dateResult.success || requestedDate > today)
      return NextResponse.json(
        { error: "Dashboard date must be a valid date no later than today." },
        { status: 400 },
      );
    const dashboardDate = dateResult.data;
    const requestedAttendanceFrom =
      url.searchParams.get("from") ?? `${dashboardDate.slice(0, 7)}-01`;
    const requestedAttendanceTo =
      url.searchParams.get("to") ?? dashboardDate;
    const attendanceFromResult = dateOnlySchema.safeParse(
      requestedAttendanceFrom,
    );
    const attendanceToResult = dateOnlySchema.safeParse(requestedAttendanceTo);
    if (
      !attendanceFromResult.success ||
      !attendanceToResult.success ||
      requestedAttendanceFrom > requestedAttendanceTo ||
      requestedAttendanceTo > today ||
      (Date.parse(`${requestedAttendanceTo}T00:00:00Z`) -
        Date.parse(`${requestedAttendanceFrom}T00:00:00Z`)) /
        86_400_000 >
        366
    )
      return NextResponse.json(
        { error: "Dashboard attendance range must be valid and no later than today." },
        { status: 400 },
      );
    const attendanceFrom = attendanceFromResult.data;
    const attendanceTo = attendanceToResult.data;
    const requestedAwayFrom = url.searchParams.get("awayFrom") ?? dashboardDate;
    const requestedAwayTo = url.searchParams.get("awayTo") ?? dashboardDate;
    const awayFromResult = dateOnlySchema.safeParse(requestedAwayFrom);
    const awayToResult = dateOnlySchema.safeParse(requestedAwayTo);
    if (
      !awayFromResult.success ||
      !awayToResult.success ||
      requestedAwayFrom > requestedAwayTo ||
      requestedAwayTo > today
    )
      return NextResponse.json(
        { error: "Who’s Away date range must be valid and no later than today." },
        { status: 400 },
      );
    const awayFrom = awayFromResult.data;
    const awayTo = awayToResult.data;
    const month = dashboardDate.slice(0, 7);
    const monthStart = `${month}-01`;
    const { daysInMonth } = getMonthDates(month);
    const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
    const requestedOutlet =
      url.searchParams.get("outletId") ?? undefined;
    if (requestedOutlet && !ObjectId.isValid(requestedOutlet))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (requestedOutlet) assertOutletAccess(actor, requestedOutlet);
    const allowed =
      actor.role === "MAIN_ADMIN"
        ? requestedOutlet
          ? [new ObjectId(requestedOutlet)]
          : undefined
        : requestedOutlet
          ? [new ObjectId(requestedOutlet)]
          : actor.outletIds;
    const canReadSalary = actor.permissions.includes("salary.read");
    const canReviewAdvances = actor.permissions.includes("advances.approve");
    const wantsSummary = wants("summary");
    const wantsTrend = wants("trend");
    const wantsAway = wants("away");
    const wantsOutlets = wants("outlets");
    const wantsAttendance = wants("attendance");
    const outlets = await db
      .collection<OutletDocument>("outlets")
      .find({ ...(allowed ? { _id: { $in: allowed } } : {}), active: true })
      .sort({ code: 1 })
      .toArray();
    const outletIds = outlets.map((outlet) => outlet._id);
    const [activeEmployees, fullTimeEmployees, partTimeEmployees, todayDays, salaryRecords, pendingAdvances, employees, monthDays, attendanceSubmissionEmployees] =
      await Promise.all([
        wantsSummary
          ? db
          .collection<EmployeeDocument>("employees")
          .countDocuments({ active: true, outletId: { $in: outletIds } })
          : Promise.resolve(0),
        wantsSummary
          ? db
          .collection<EmployeeDocument>("employees")
          .countDocuments({
            active: true,
            outletId: { $in: outletIds },
            employmentType: { $ne: "PART_TIME" },
          })
          : Promise.resolve(0),
        wantsSummary
          ? db
          .collection<EmployeeDocument>("employees")
          .countDocuments({
            active: true,
            outletId: { $in: outletIds },
            employmentType: "PART_TIME",
          })
          : Promise.resolve(0),
        wantsSummary || wantsOutlets || wantsAttendance || wants("notifications")
          ? db
          .collection<AttendanceDayDocument>("attendance")
          .find({ date: dashboardDate, outletId: { $in: outletIds } })
          .toArray()
          : Promise.resolve([]),
        wantsSummary && canReadSalary
          ? db
              .collection<SalaryRecordDocument>("salaryRecords")
              .find({ month, outletId: { $in: outletIds } })
              .toArray()
          : Promise.resolve([]),
        wantsSummary && canReviewAdvances
          ? db.collection("advances").countDocuments({
              status: "PENDING",
              outletId: { $in: outletIds },
            })
          : Promise.resolve(0),
        wantsSummary && canReadSalary && outletIds.length
            ? db
                .collection<EmployeeDocument>("employees")
                .find({ outletId: { $in: outletIds } })
                .toArray()
            : Promise.resolve([]),
        wantsSummary && canReadSalary && outletIds.length
            ? db
                .collection<AttendanceDayDocument>("attendance")
                .find({
                  outletId: { $in: outletIds },
                  date: { $gte: monthStart, $lte: dashboardDate },
                  status: "SUBMITTED",
                })
                .toArray()
            : Promise.resolve([]),
        (wantsSummary || wantsTrend || wantsOutlets) && outletIds.length
          ? db
              .collection<EmployeeDocument>("employees")
              .find(
                {
                  outletId: { $in: outletIds },
                  dateOfJoining: { $lte: attendanceTo },
                  $or: [
                    { deactivatedAt: { $exists: false } },
                    { deactivatedAt: { $gte: attendanceFrom } },
                  ],
                },
                {
                  projection: {
                    _id: 1,
                    outletId: 1,
                    dateOfJoining: 1,
                    deactivatedAt: 1,
                  },
                },
              )
              .toArray()
          : Promise.resolve([]),
      ]);
    const attendanceDays =
      (wantsSummary || wantsTrend) &&
      actor.permissions.includes("attendance.read") &&
      outletIds.length
        ? await db
            .collection<AttendanceDayDocument>("attendance")
            .find({
              outletId: { $in: outletIds },
              date: { $gte: attendanceFrom, $lte: attendanceTo },
            })
            .sort({ date: 1 })
            .toArray()
        : [];
    const whoIsAway: Array<{
      employeeId: string;
      employeeName: string;
      employeeCode: string;
      outletCode: string;
      date: string;
      status: "A" | "HD";
    }> = [];
    if (wantsAway && actor.permissions.includes("attendance.read") && outletIds.length) {
      const [awayDays, awayEmployees] = await Promise.all([
        db
          .collection<AttendanceDayDocument>("attendance")
          .find({
            outletId: { $in: outletIds },
            date: { $gte: awayFrom, $lte: awayTo },
            status: "SUBMITTED",
            "entries.status": { $in: ["A", "HD"] },
          })
          .sort({ date: -1 })
          .toArray(),
        db
          .collection<EmployeeDocument>("employees")
          .find({
            outletId: { $in: outletIds },
            dateOfJoining: { $lte: awayTo },
            $or: [
              { deactivatedAt: { $exists: false } },
              { deactivatedAt: { $gte: awayFrom } },
            ],
          })
          .toArray(),
      ]);
      const employeeById = new Map(
        awayEmployees.map((employee) => [
          employee._id.toHexString(),
          employee,
        ]),
      );
      const outletCodeById = new Map(
        outlets.map((outlet) => [outlet._id.toHexString(), outlet.code]),
      );
      for (const day of awayDays) {
        for (const entry of day.entries) {
          if (entry.status !== "A" && entry.status !== "HD") continue;
          const employee = employeeById.get(entry.employeeId.toHexString());
          if (
            !employee ||
            day.date < employee.dateOfJoining ||
            (employee.deactivatedAt && day.date > employee.deactivatedAt)
          )
            continue;
          whoIsAway.push({
            employeeId: employee._id.toHexString(),
            employeeName: employee.fullName,
            employeeCode: employee.employeeCode,
            outletCode: outletCodeById.get(day.outletId.toHexString()) ?? "",
            date: day.date,
            status: entry.status,
          });
        }
      }
    }
    let liveGrossSalary = 0;
    let liveNetPayable = 0;
    let projectedMonthEndBase = 0;
    let approvedAdvancesPendingPayroll = 0;
    if (wantsSummary && canReadSalary) {
      const activePayrollEmployees = employees.filter(
        (employee) =>
            employee.dateOfJoining <= dashboardDate &&
            (!employee.deactivatedAt || employee.deactivatedAt >= monthStart),
      );
      const employeeIds = activePayrollEmployees.map((employee) => employee._id);
      projectedMonthEndBase = activePayrollEmployees
        .filter((employee) => employee.active)
        .reduce(
          (sum, employee) =>
            sum + Number(employee.monthlyBaseSalary ?? 0),
          0,
        );
      const approvedAdvances = employeeIds.length
        ? await db
              .collection<AdvanceDocument>("advances")
              .find({
                employeeId: { $in: employeeIds },
                status: "APPROVED",
                date: { $gte: monthStart, $lte: dashboardDate },
                payrollRecordId: { $exists: false },
              })
              .toArray()
        : [];
      const advanceTotals = new Map<string, number>();
      for (const advance of approvedAdvances) {
        const employeeId = advance.employeeId.toHexString();
        advanceTotals.set(
            employeeId,
            (advanceTotals.get(employeeId) ?? 0) + advance.amount,
        );
      }
      approvedAdvancesPendingPayroll = approvedAdvances.reduce(
        (sum, advance) => sum + advance.amount,
        0,
      );
      const attendanceCounts = new Map<
        string,
        { P: number; A: number; HD: number; WO: number }
      >();
      const markedDaysByEmployee = new Map<string, number>();
      const employeeById = new Map(
        activePayrollEmployees.map((employee) => [
            employee._id.toHexString(),
            employee,
        ]),
      );
      for (const day of monthDays) {
        for (const entry of day.entries) {
            const employeeId = entry.employeeId.toHexString();
            const employee = employeeById.get(employeeId);
            if (
              !employee ||
              day.date < employee.dateOfJoining ||
              (employee.deactivatedAt && day.date > employee.deactivatedAt)
            )
              continue;
            const counts = attendanceCounts.get(employeeId) ?? {
              P: 0,
              A: 0,
              HD: 0,
              WO: 0,
            };
            counts[entry.status] += 1;
            attendanceCounts.set(employeeId, counts);
            markedDaysByEmployee.set(
              employeeId,
              (markedDaysByEmployee.get(employeeId) ?? 0) + 1,
            );
        }
      }
      const salaryRecordByEmployee = new Map(
        salaryRecords.map((record) => [
            record.employeeId.toHexString(),
            record,
        ]),
      );
      const fullMonthSelected = dashboardDate >= monthEnd;
      for (const employee of activePayrollEmployees) {
        const savedRecord = salaryRecordByEmployee.get(
            employee._id.toHexString(),
        );
        if (fullMonthSelected && savedRecord) {
            liveGrossSalary += Number(
              savedRecord.calculation.grossEarnings ?? 0,
            );
            liveNetPayable += Number(savedRecord.calculation.netPayable ?? 0);
            continue;
        }
        const counts =
            attendanceCounts.get(employee._id.toHexString()) ?? {
              P: 0,
              A: 0,
              HD: 0,
              WO: 0,
            };
        const employedStart =
          employee.dateOfJoining > monthStart
            ? employee.dateOfJoining
            : monthStart;
        const employedEnd =
          employee.deactivatedAt && employee.deactivatedAt < monthEnd
            ? employee.deactivatedAt
            : monthEnd;
        const eligibleCalendarDays =
          employedStart > employedEnd
            ? 0
            : (Date.parse(`${employedEnd}T00:00:00Z`) -
                Date.parse(`${employedStart}T00:00:00Z`)) /
                86_400_000 +
              1;
        const employedFullMonth =
          employee.dateOfJoining <= monthStart &&
          (!employee.deactivatedAt || employee.deactivatedAt >= monthEnd);
        const completeAttendance =
          fullMonthSelected &&
          (markedDaysByEmployee.get(employee._id.toHexString()) ?? 0) >=
            eligibleCalendarDays;
        const calculation = calculatePayroll({
            monthlyBaseSalary: employee.monthlyBaseSalary,
            salaryMethod:
              employee.salaryMethod || settings?.defaultSalaryMethod || "FIXED_30_DAYS",
            daysInMonth,
            workingDaysDivisor: 30,
            presentDays: counts.P,
            absentDays: counts.A,
            halfDays: counts.HD,
            weekOffs: counts.WO,
            paidAbsences: settings?.paidAbsences ?? 0,
            settleMonthlySalary: completeAttendance,
            salaryEntitlementDays: employedFullMonth
              ? 30
              : eligibleCalendarDays,
            advances: advanceTotals.get(employee._id.toHexString()) ?? 0,
            loanDeduction: 0,
            overtime: 0,
            allowances: 0,
            otherDeductions: 0,
            pfEnabled: employee.pfEnabled,
            employeePfPercent: employee.employeePfPercent,
            employerPfPercent: employee.employerPfPercent,
            esiEnabled: employee.esiEnabled ?? false,
            esiPercent: employee.esiPercent ?? 0.75,
        });
        liveGrossSalary += calculation.grossEarnings;
        liveNetPayable += calculation.netPayable;
      }
    }
    const attendance = { P: 0, A: 0, WO: 0, HD: 0 };
    for (const day of todayDays)
      for (const entry of day.entries) attendance[entry.status] += 1;
    const periodAttendance = { P: 0, A: 0, WO: 0, HD: 0 };
    const periodAttendanceByDate = new Map<
      string,
      { P: number; A: number; HD: number; WO: number }
    >();
    const periodAttendanceByOutlet = new Map<
      string,
      { code: string; P: number; A: number; HD: number; WO: number }
    >();
    if (wantsSummary) {
      for (const day of attendanceDays) {
        const dailyCounts = periodAttendanceByDate.get(day.date) ?? {
          P: 0,
          A: 0,
          HD: 0,
          WO: 0,
        };
        const outletId = day.outletId.toHexString();
        const outletCounts = periodAttendanceByOutlet.get(outletId) ?? {
          code: outlets.find((outlet) => outlet._id.equals(day.outletId))?.code ?? "",
          P: 0,
          A: 0,
          HD: 0,
          WO: 0,
        };
        for (const entry of day.entries) {
          dailyCounts[entry.status] += 1;
          outletCounts[entry.status] += 1;
          periodAttendance[entry.status] += 1;
        }
        periodAttendanceByDate.set(day.date, dailyCounts);
        periodAttendanceByOutlet.set(outletId, outletCounts);
      }
    }
    const attendanceRateForCounts = (counts: {
      P: number;
      A: number;
      HD: number;
      WO: number;
    }) => {
      const marked = counts.P + counts.A + counts.HD;
      return marked > 0 ? ((counts.P + counts.HD / 2) / marked) * 100 : null;
    };
    const dailyRates: Array<number | null> = [];
    if (wantsSummary) {
      for (
        let day = attendanceFrom;
        day <= attendanceTo;
        day = dateAfter(day, 1)
      )
        dailyRates.push(
          attendanceRateForCounts(
            periodAttendanceByDate.get(day) ?? {
              P: 0,
              A: 0,
              HD: 0,
              WO: 0,
            },
          ),
        );
    }
    const averageRate = (rates: Array<number | null>) => {
      const validRates = rates.filter(
        (rate): rate is number => rate !== null,
      );
      return validRates.length
        ? validRates.reduce((sum, rate) => sum + rate, 0) / validRates.length
        : null;
    };
    const recentRates = dailyRates.slice(-7);
    const previousRates = dailyRates.slice(-14, -7);
    const attendanceRateChange =
      recentRates.some((rate) => rate !== null) &&
      previousRates.some((rate) => rate !== null)
        ? averageRate(recentRates)! - averageRate(previousRates)!
        : null;
    const lowestOutletWithData = [...periodAttendanceByOutlet.entries()]
      .map(([id, counts]) => ({
        id,
        code: counts.code,
        rate: attendanceRateForCounts(counts),
      }))
      .filter((outlet) => outlet.rate !== null)
      .sort((left, right) => left.rate! - right.rate!)[0];
    const bestOutletWithData = [...periodAttendanceByOutlet.entries()]
      .map(([id, counts]) => ({
        id,
        code: counts.code,
        rate: attendanceRateForCounts(counts),
      }))
      .filter((outlet) => outlet.rate !== null)
      .sort((left, right) => right.rate! - left.rate!)[0];
    const markedTodayIds = new Set(
      todayDays.flatMap((day) =>
        day.entries.map((entry) => entry.employeeId.toHexString()),
      ),
    );
    const unmarkedAttendanceEmployees = attendanceSubmissionEmployees.filter(
      (employee) =>
        employee.dateOfJoining <= dashboardDate &&
        (!employee.deactivatedAt || employee.deactivatedAt >= dashboardDate) &&
        !markedTodayIds.has(employee._id.toHexString()),
    ).length;
    const attendanceEmployees =
      wantsAttendance && actor.permissions.includes("attendance.read")
      ? await db
          .collection<EmployeeDocument>("employees")
          .find({
            outletId: { $in: outletIds },
            dateOfJoining: { $lte: dashboardDate },
            $or: [
              { deactivatedAt: { $exists: false } },
              { deactivatedAt: { $gte: dashboardDate } },
            ],
          })
          .sort({ fullName: 1 })
          .toArray()
      : [];
    const absentEmployeeIds = wants("notifications")
      ? [
          ...new Set(
            todayDays
              .flatMap((day) =>
                day.entries
                  .filter((entry) => entry.status === "A")
                  .map((entry) => entry.employeeId.toHexString()),
              ),
          ),
        ].map((id) => new ObjectId(id))
      : [];
    const notificationEmployees =
      wants("notifications") &&
      actor.permissions.includes("attendance.read") &&
      absentEmployeeIds.length
        ? await db
            .collection<EmployeeDocument>("employees")
            .find({
              _id: { $in: absentEmployeeIds },
              outletId: { $in: outletIds },
              dateOfJoining: { $lte: dashboardDate },
              $or: [
                { deactivatedAt: { $exists: false } },
                { deactivatedAt: { $gte: dashboardDate } },
              ],
            })
            .sort({ fullName: 1 })
            .toArray()
        : [];
    const submittedOutlets = new Set(
      wantsSummary || wantsOutlets
        ? todayDays
        .filter((day) => {
          if (day.status !== "SUBMITTED") return false;
          return isAttendanceOutletSubmitted(
            day,
            attendanceSubmissionEmployees.filter(
              (employee) =>
                employee.outletId.equals(day.outletId) &&
                employee.dateOfJoining <= dashboardDate &&
                (!employee.deactivatedAt ||
                  employee.deactivatedAt >= dashboardDate),
            ),
          );
        })
        .map((day) => day.outletId.toHexString())
        : [],
    );
    const attendanceStatusByEmployee = new Map(
      wantsAttendance
        ? todayDays.flatMap((day) =>
        day.entries.map((entry) => [
          entry.employeeId.toHexString(),
          {
            status: entry.status,
            submitted:
              day.status === "SUBMITTED" && entry.submitted !== false,
          },
        ] as const),
      )
        : [],
    );
    const outletCodeById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet.code]),
    );
    const attendanceEmployeeSummaries = attendanceEmployees.map((employee) => {
      const attendance = attendanceStatusByEmployee.get(
        employee._id.toHexString(),
      );
      return {
        employeeId: employee._id.toHexString(),
        employeeName: employee.fullName,
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        outletCode: outletCodeById.get(employee.outletId.toHexString()) ?? "",
        status: attendance?.status ?? null,
        submitted: attendance?.submitted ?? false,
      };
    });
    const notificationAttendanceSummaries = notificationEmployees.map(
      (employee) => {
        const attendance = attendanceStatusByEmployee.get(
          employee._id.toHexString(),
        );
        const day = todayDays.find((item) =>
          item.outletId.equals(employee.outletId),
        );
        const entry = day?.entries.find((item) =>
          item.employeeId.equals(employee._id),
        );
        return {
          employeeId: employee._id.toHexString(),
          employeeName: employee.fullName,
          employeeCode: employee.employeeCode,
          designation: employee.designation,
          outletCode: outletCodeById.get(employee.outletId.toHexString()) ?? "",
          status: attendance?.status ?? entry?.status ?? null,
          submitted:
            attendance?.submitted ??
            (day?.status === "SUBMITTED" && entry?.submitted !== false),
        };
      },
    );
    const attendanceDayByDate = new Map(
      attendanceDays.map((day) => [
        `${day.outletId.toHexString()}:${day.date}`,
        day,
      ]),
    );
    const attendanceTrend = [];
    for (
      let trendDate = wantsTrend ? attendanceFrom : attendanceTo;
      wantsTrend &&
      trendDate <= attendanceTo;
      trendDate = dateAfter(trendDate, 1)
    ) {
      const trendDays = attendanceDays.filter((day) => day.date === trendDate);
      const trendAttendance = { P: 0, A: 0, WO: 0, HD: 0 };
      const trendOutletRows = outlets.map((outlet) => {
        const day = attendanceDayByDate.get(
          `${outlet._id.toHexString()}:${trendDate}`,
        );
        const counts = { P: 0, A: 0, WO: 0, HD: 0 };
        if (day)
          for (const entry of day.entries) counts[entry.status] += 1;
        return {
          id: outlet._id.toHexString(),
          code: outlet.code,
          attendance: counts,
        };
      });
      for (const day of trendDays)
        for (const entry of day.entries)
          trendAttendance[entry.status] += 1;
      attendanceTrend.push({
        date: trendDate,
        attendance: trendAttendance,
        submittedOutlets: new Set(
          trendDays
            .filter((day) =>
              isAttendanceOutletSubmitted(
                day,
                attendanceSubmissionEmployees.filter(
                  (employee) =>
                    employee.outletId.equals(day.outletId) &&
                    employee.dateOfJoining <= trendDate &&
                    (!employee.deactivatedAt ||
                      employee.deactivatedAt >= trendDate),
                ),
              ),
            )
            .map((day) => day.outletId.toHexString()),
        ).size,
        markedEmployees: Object.values(trendAttendance).reduce(
          (sum, count) => sum + count,
          0,
        ),
        outlets: trendOutletRows,
      });
    }
    const outletSummaries = wantsOutlets ? await Promise.all(
      outlets.map(async (outlet) => {
        const employeeCount = await db
          .collection<EmployeeDocument>("employees")
          .countDocuments({ outletId: outlet._id, active: true });
        const day = todayDays.find((item) => item.outletId.equals(outlet._id));
        const counts = { P: 0, A: 0, WO: 0, HD: 0 };
        if (day) for (const entry of day.entries) counts[entry.status] += 1;
        return {
          id: outlet._id.toHexString(),
          _id: outlet._id.toHexString(),
          code: outlet.code,
          name: outlet.name,
          active: outlet.active,
          employees: employeeCount,
          attendance: counts,
          submitted: submittedOutlets.has(outlet._id.toHexString()),
        };
      }),
    ) : [];
    return NextResponse.json({
      today: dashboardDate,
      month,
      ...(wantsSummary
        ? {
      metrics: {
        activeEmployees,
        fullTimeEmployees,
        partTimeEmployees,
        activeOutlets: outlets.length,
        attendance,
        periodAttendance,
        attendanceRateChange,
        lowestOutletCode: lowestOutletWithData?.code ?? null,
        bestOutletCode: bestOutletWithData?.code ?? null,
        bestOutletRate: bestOutletWithData?.rate ?? null,
        unmarkedAttendanceEmployees,
        missingSubmissions: outlets.length - submittedOutlets.size,
        submittedOutlets: submittedOutlets.size,
        payrollCount: canReadSalary ? salaryRecords.length : null,
        pendingPayroll: canReadSalary
          ? salaryRecords.filter((record) => record.status === "DRAFT").length
          : null,
        pendingApprovals:
          (canReadSalary
            ? salaryRecords.filter((record) => record.status === "DRAFT").length
            : 0) + pendingAdvances,
        pendingAdvanceApprovals: pendingAdvances,
        grossSalary: canReadSalary ? liveGrossSalary : null,
        netPayable: canReadSalary ? liveNetPayable : null,
        projectedMonthEndBase: canReadSalary ? projectedMonthEndBase : null,
        approvedAdvancesPendingPayroll: canReadSalary
          ? approvedAdvancesPendingPayroll
          : null,
        recordedLoanDeductions: canReadSalary
          ? salaryRecords.reduce(
              (sum, record) =>
                sum + Number(record.calculation.loanDeduction ?? 0),
              0,
            )
          : null,
        recordedPayrollGross: canReadSalary
          ? salaryRecords.reduce(
              (sum, record) =>
                sum + Number(record.calculation.grossEarnings ?? 0),
              0,
            )
          : null,
        recordedPayrollNet: canReadSalary
          ? salaryRecords.reduce(
              (sum, record) =>
                sum + Number(record.calculation.netPayable ?? 0),
              0,
            )
          : null,
      },
        }
        : {}),
      ...(wantsOutlets ? { outlets: outletSummaries } : {}),
      ...(wantsAttendance
        ? { attendanceEmployees: attendanceEmployeeSummaries }
        : {}),
      ...(wants("notifications")
        ? { dashboardNotifications: notificationAttendanceSummaries }
        : {}),
      ...(wantsTrend ? { attendanceTrend } : {}),
      ...(wantsAway ? { whoIsAway } : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
