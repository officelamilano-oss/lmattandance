import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import {
  attendanceEntryVersionMatches,
  isAttendanceEntryLocked,
  isAttendanceOutletSubmitted,
} from "../src/lib/attendance.ts";
import {
  calculateLoanInstallment,
  calculatePayroll,
  countNotMarkedDays,
  getLatestAttendanceEntries,
  getSubmittedAttendanceStatuses,
} from "../src/lib/payroll/calculate.ts";
import {
  getDateInTimezone,
  getIndiaDate,
  getIndiaMonth,
  getMonthDates,
} from "../src/lib/payroll/dates.ts";
import { findExistingPayrollEmployees } from "../src/lib/payroll/duplicate.ts";
import { hashPassword, verifyPassword } from "../src/lib/passwords.ts";
import {
  attendanceSchema,
  loanSchema,
} from "../src/lib/validation/business.ts";
import {
  expectedCompletionMonth,
  loanScheduleSummary,
} from "../src/lib/payroll/loans.ts";
import {
  getUniformReportItems,
  hasPastUniformMonth,
  normalizeUniformEntries,
  summarizeUniformDeductions,
  uniformEntriesSchema,
} from "../src/lib/uniform-deductions.ts";

const base = {
  monthlyBaseSalary: 30000,
  salaryMethod: "CALENDAR_DAYS",
  salaryEntitlementDays: 26,
  workingDaysDivisor: 26,
  presentDays: 25,
  absentDays: 0,
  halfDays: 2,
  weekOffs: 0,
  paidAbsences: 0,
  advances: 0,
  overtime: 0,
  allowances: 0,
  otherDeductions: 0,
  notMarkedDays: 0,
  pfEnabled: false,
  employeePfPercent: 12,
  employerPfPercent: 12,
};

test("combined three-day allowance and not-marked deductions follow the unified rules", () => {
  const cases = [
    [2, 2, 0, 0, 3, 0, 0, 0],
    [1, 4, 0, 0, 3, 0, 0, 0],
    [3, 6, 0, 0, 6, 3, 1800, 0],
    [2, 0, 1, 0, 3, 0, 0, 0],
    [0, 0, 3, 0, 3, 0, 0, 0],
    [0, 1, 2, 0, 2.5, 0, 0, 0],
    [0, 1, 3, 0, 3.5, 0.5, 300, 0],
    [3, 0, 1, 0, 4, 1, 600, 0],
    [3, 0, 0, 2, 3, 0, 0, 1200],
    [2, 3, 1, 2, 4.5, 1.5, 900, 1200],
  ];

  for (const [
    weekOffs,
    halfDays,
    absentDays,
    notMarkedDays,
    totalEquivalent,
    chargeableDays,
    attendanceDeduction,
    notMarkedDeduction,
  ] of cases) {
    const result = calculatePayroll({
      ...base,
      monthlyBaseSalary: 18000,
      presentDays: 20,
      weekOffs,
      halfDays,
      absentDays,
      notMarkedDays,
      settleMonthlySalary: true,
      salaryEntitlementDays: 30,
    });
    assert.equal(result.allowedWeekOff, 3);
    assert.equal(result.allowanceConsumed, Math.min(3, totalEquivalent));
    assert.equal(result.allowanceRemaining, 3 - Math.min(3, totalEquivalent));
    assert.equal(result.totalEquivalentDays, totalEquivalent);
    assert.equal(result.chargeableDays, chargeableDays);
    assert.equal(result.attendanceDeduction, attendanceDeduction);
    assert.equal(result.notMarkedDeduction, notMarkedDeduction);
  }
});

test("uses each outlet's configured weekly-off allowance for attendance deductions", () => {
  const noWeeklyOffAllowance = calculatePayroll({
    ...base,
    presentDays: 29,
    absentDays: 1,
    halfDays: 0,
    weekOffs: 0,
    allowedWeekOff: 0,
  });
  assert.equal(noWeeklyOffAllowance.allowedWeekOff, 0);
  assert.equal(noWeeklyOffAllowance.chargeableDays, 1);
  assert.equal(noWeeklyOffAllowance.attendanceDeduction, 1000);

  const fiveWeeklyOffAllowance = calculatePayroll({
    ...base,
    presentDays: 24,
    absentDays: 2,
    halfDays: 0,
    weekOffs: 4,
    allowedWeekOff: 5,
  });
  assert.equal(fiveWeeklyOffAllowance.allowedWeekOff, 5);
  assert.equal(fiveWeeklyOffAllowance.allowanceConsumed, 5);
  assert.equal(fiveWeeklyOffAllowance.chargeableDays, 1);
  assert.equal(fiveWeeklyOffAllowance.attendanceDeduction, 1000);
});

test("not-marked counting excludes future, pre-joining, post-leaving, holiday, and marked dates", () => {
  assert.equal(countNotMarkedDays({
    dates: ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
    markedStatuses: new Map([["2026-10-10", "P"]]),
    dateOfJoining: "2026-10-10",
    cutoffDate: "2026-10-12",
    today: "2026-10-12",
    holidays: ["2026-10-11"],
  }), 0);

  assert.equal(countNotMarkedDays({
    dates: ["2026-10-10", "2026-10-11"],
    markedStatuses: new Map([["2026-10-10", "P"]]),
    deactivatedAt: "2026-10-10",
    cutoffDate: "2026-10-11",
    today: "2026-10-11",
  }), 0);

  assert.equal(countNotMarkedDays({
    dates: ["2026-10-12"],
    markedStatuses: new Map(),
    cutoffDate: "2026-10-12",
    today: "2026-10-12",
    countTodayAsNotMarked: true,
  }), 1);
});

test("submitted attendance statuses are batched by outlet, employee, and date", () => {
  const outletId = new ObjectId();
  const otherOutletId = new ObjectId();
  const employeeId = new ObjectId();
  const updatedBy = new ObjectId();
  const statuses = getSubmittedAttendanceStatuses([
    {
      outletId,
      date: "2026-11-01",
      entries: [
        { employeeId, status: "A", updatedAt: new Date(1), updatedBy },
        { employeeId, status: "P", updatedAt: new Date(2), updatedBy },
      ],
    },
    {
      outletId: otherOutletId,
      date: "2026-11-01",
      entries: [
        { employeeId, status: "HD", updatedAt: new Date(3), updatedBy },
      ],
    },
  ]);

  assert.equal(
    statuses.get(outletId.toHexString())?.get(employeeId.toHexString())?.get("2026-11-01"),
    "P",
  );
  assert.equal(
    statuses.get(otherOutletId.toHexString())?.get(employeeId.toHexString())?.get("2026-11-01"),
    "HD",
  );
});

test("payroll cases A, B, C, and D use calendar gross and separate not-marked deductions", () => {
  const caseA = calculatePayroll({
    ...base,
    monthlyBaseSalary: 18000,
    presentDays: 16,
    halfDays: 2,
    weekOffs: 1,
    salaryEntitlementDays: 19,
    settleMonthlySalary: false,
    notMarkedDays: 0,
  });
  assert.equal(caseA.grossEarnings, 11400);
  assert.equal(caseA.attendanceDeduction, 0);
  assert.equal(caseA.netPayable, 11400);

  const caseB = calculatePayroll({
    ...base,
    monthlyBaseSalary: 18000,
    presentDays: 18,
    halfDays: 2,
    salaryEntitlementDays: 21,
    settleMonthlySalary: false,
    notMarkedDays: 1,
  });
  assert.equal(caseB.grossEarnings, 12600);
  assert.equal(caseB.notMarkedDeduction, 600);
  assert.equal(caseB.netPayable, 12000);

  const caseC = calculatePayroll({
    ...base,
    monthlyBaseSalary: 18000,
    presentDays: 11,
    salaryEntitlementDays: 11,
    settleMonthlySalary: false,
    notMarkedDays: 0,
  });
  assert.equal(caseC.grossEarnings, 6600);

  const caseD = calculatePayroll({
    ...base,
    monthlyBaseSalary: 18000,
    presentDays: 19,
    halfDays: 2,
    salaryEntitlementDays: 21,
    settleMonthlySalary: false,
    notMarkedDays: 0,
  });
  assert.equal(caseD.netPayable - caseB.netPayable, 600);
});

test("latest duplicate attendance status wins for an employee and date", () => {
  const employeeId = new ObjectId();
  const entries = [
    {
      employeeId,
      status: "A",
      updatedAt: new Date("2026-11-20T10:00:00Z"),
      updatedBy: new ObjectId(),
    },
    {
      employeeId,
      status: "P",
      updatedAt: new Date("2026-11-20T11:00:00Z"),
      updatedBy: new ObjectId(),
    },
  ];
  assert.equal(getLatestAttendanceEntries(entries)[0].status, "P");
});

test("attendance updates accept clear requests for saved draft entries", () => {
  const parsed = attendanceSchema.parse({
    outletId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    date: "2026-11-18",
    entries: [],
    clearEmployeeIds: ["bbbbbbbbbbbbbbbbbbbbbbbb"],
    versions: [
      {
        employeeId: "bbbbbbbbbbbbbbbbbbbbbbbb",
        updatedAt: "2026-11-18T10:15:00.000Z",
      },
    ],
  });
  assert.deepEqual(parsed.clearEmployeeIds, ["bbbbbbbbbbbbbbbbbbbbbbbb"]);
});

test("attendance saves validate mixed statuses and employee versions", () => {
  const parsed = attendanceSchema.parse({
    outletId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    date: "2026-11-18",
    entries: [
      { employeeId: "bbbbbbbbbbbbbbbbbbbbbbbb", status: "P" },
      { employeeId: "cccccccccccccccccccccccc", status: "A" },
      { employeeId: "dddddddddddddddddddddddd", status: "WO" },
      { employeeId: "eeeeeeeeeeeeeeeeeeeeeeee", status: "HD" },
    ],
    clearEmployeeIds: [],
    versions: [
      { employeeId: "bbbbbbbbbbbbbbbbbbbbbbbb", updatedAt: null },
      { employeeId: "cccccccccccccccccccccccc", updatedAt: null },
      { employeeId: "dddddddddddddddddddddddd", updatedAt: null },
      { employeeId: "eeeeeeeeeeeeeeeeeeeeeeee", updatedAt: null },
    ],
  });
  assert.deepEqual(
    parsed.entries.map((entry) => entry.status),
    ["P", "A", "WO", "HD"],
  );
  assert.equal(parsed.date, "2026-11-18");
});

test("attendance entry versions distinguish fresh, stale, and unmarked entries", () => {
  const currentVersion = new Date("2026-11-18T10:15:00.000Z");
  assert.equal(
    attendanceEntryVersionMatches(
      "2026-11-18T10:15:00.000Z",
      currentVersion,
    ),
    true,
  );
  assert.equal(
    attendanceEntryVersionMatches(
      "2026-11-18T10:14:59.000Z",
      currentVersion,
    ),
    false,
  );
  assert.equal(attendanceEntryVersionMatches(null, undefined), true);
  assert.equal(attendanceEntryVersionMatches(null, currentVersion), false);
});

test("attendance locks only submitted entries for non-admin users", () => {
  assert.equal(isAttendanceEntryLocked(false, "OUTLET_USER"), false);
  assert.equal(isAttendanceEntryLocked(true, "OUTLET_USER"), true);
  assert.equal(isAttendanceEntryLocked(true, "CO_ADMIN"), true);
  assert.equal(isAttendanceEntryLocked(true, "MAIN_ADMIN"), false);
});

test("an outlet is submitted only after every active employee is submitted", () => {
  const firstEmployee = new ObjectId();
  const secondEmployee = new ObjectId();
  const day = {
    status: "SUBMITTED",
    entries: [
      {
        employeeId: firstEmployee,
        status: "P",
        submitted: true,
      },
      {
        employeeId: secondEmployee,
        status: "A",
        submitted: false,
      },
    ],
  };
  const activeEmployees = [{ _id: firstEmployee }, { _id: secondEmployee }];

  assert.equal(isAttendanceOutletSubmitted(day, activeEmployees), false);
  assert.equal(
    isAttendanceOutletSubmitted(day, [{ _id: firstEmployee }]),
    true,
  );
  assert.equal(
    isAttendanceOutletSubmitted({ ...day, status: "DRAFT" }, []),
    false,
  );
});

test("calendar divisor handles 28, 29, 30, and 31-day months including leap years", () => {
  assert.deepEqual(
    ["2025-02", "2024-02", "2025-04", "2025-01"].map(
      (month) => getMonthDates(month).daysInMonth,
    ),
    [28, 29, 30, 31],
  );
});

test("default business date and month follow India time", () => {
  const nearMidnightUtc = new Date("2026-01-01T20:00:00.000Z");
  assert.equal(getIndiaDate(nearMidnightUtc), "2026-01-02");
  assert.equal(getIndiaMonth(nearMidnightUtc), "2026-01");
});

test("approval dates use the configured business timezone", () => {
  assert.equal(
    getDateInTimezone(new Date("2026-11-25T18:45:00.000Z"), "Asia/Kolkata"),
    "2026-11-26",
  );
});

test("30-day salary divisor pays every present and week-off day", () => {
  const { daysInMonth } = getMonthDates("2026-01");
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 31000,
    daysInMonth,
    presentDays: 26,
    absentDays: 2,
    halfDays: 0,
    weekOffs: 3,
    salaryEntitlementDays: 29,
  });
  assert.equal(result.dailyRate, 1033.33);
  assert.equal(result.payableDayUnits, 29);
  assert.equal(result.grossEarnings, 29966.67);
});

test("February full-month settlement pays full salary despite a 28-day month", () => {
  const { daysInMonth } = getMonthDates("2025-02");
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth,
    presentDays: 25,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.dailyRate, 666.67);
  assert.equal(result.halfDayDeduction, 0);
  assert.equal(result.weekOffs, 3);
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 20000);
});

test("a complete 30-day month earns the full monthly salary with paid week-offs", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    presentDays: 27,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("each absence deducts one 30th of monthly salary and each half-day deducts half", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 15000,
    daysInMonth: 30,
    presentDays: 1,
    absentDays: 1,
    halfDays: 1,
    weekOffs: 1,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.dailyRate, 500);
  assert.equal(result.halfDayDeduction, 250);
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 15000);
  assert.equal(result.attendanceDeduction, 0);
  assert.equal(result.netPayable, 15000);
});

test("half days earn half a day using decimal-safe INR rounding", () => {
  const result = calculatePayroll({ ...base, daysInMonth: 30 });
  assert.equal(result.halfDayDeduction, 1000);
  assert.equal(result.grossEarnings, 26000);
  assert.equal(result.netPayable, 26000);
});

test("a 31-day month cannot increase full-month base salary above its monthly amount", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 31,
    presentDays: 28,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.weekOffs, 3);
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("salary divisor remains 30 even for legacy 26-day employee settings", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 31,
    presentDays: 26,
    halfDays: 0,
  });
  assert.equal(result.dailyRate, 1000);
  assert.equal(result.grossEarnings, 26000);
});

test("full-month settlement deducts an absence in a 31-day month", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 31,
    presentDays: 27,
    absentDays: 1,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
  assert.equal(result.attendanceDeduction, 1000);
  assert.equal(result.netPayable, 29000);
});

test("full-month salary is prorated for an employee who joined partway through the month", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth: 28,
    presentDays: 13,
    absentDays: 1,
    halfDays: 0,
    weekOffs: 0,
    settleMonthlySalary: true,
    salaryEntitlementDays: 14,
  });
  assert.equal(result.dailyRate, 666.67);
  assert.equal(result.payableDayUnits, 14);
  assert.equal(result.grossEarnings, 9333.33);
});

test("full-month week-offs cannot raise base earnings above monthly salary", () => {
  const result = calculatePayroll({
    ...base,
    salaryMethod: "WORKING_DAYS_26",
    daysInMonth: 30,
    presentDays: 26,
    halfDays: 0,
    weekOffs: 3,
    settleMonthlySalary: true,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.payableDayUnits, 30);
  assert.equal(result.grossEarnings, 30000);
});

test("partial-month gross is based on active calendar days, not marked attendance units", () => {
  const result = calculatePayroll({ ...base, salaryMethod: "WORKING_DAYS_26", daysInMonth: 30, presentDays: 20, halfDays: 0, weekOffs: 5, salaryEntitlementDays: 25 });
  assert.equal(result.dailyRate, 1000);
  assert.equal(result.payableDayUnits, 25);
  assert.equal(result.grossEarnings, 25000);
});

test("an incomplete month does not settle full salary or infer absences", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 20000,
    daysInMonth: 28,
    presentDays: 25,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 2,
    settleMonthlySalary: false,
    salaryEntitlementDays: 27,
  });
  assert.equal(result.payableDayUnits, 27);
  assert.equal(result.grossEarnings, 18000);
});

test("PF is optional and employer PF is reported separately from take-home", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    pfEnabled: true,
    employeePfPercent: 12,
    employerPfPercent: 13,
  });
  assert.equal(result.employeePf, 3120);
  assert.equal(result.employerPf, 3380);
  assert.equal(result.netPayable, 22880);
});

test("employer PF never reduces employee payable, while loan deductions do", () => {
  const withoutEmployerPf = calculatePayroll({
    ...base,
    daysInMonth: 30,
    pfEnabled: true,
    employeePfPercent: 12,
    employerPfPercent: 0,
    loanDeduction: 600,
  });
  const withEmployerPf = calculatePayroll({
    ...base,
    daysInMonth: 30,
    pfEnabled: true,
    employeePfPercent: 12,
    employerPfPercent: 13,
    loanDeduction: 600,
  });
  assert.equal(withEmployerPf.employerPf, 3380);
  assert.equal(withEmployerPf.netPayable, withoutEmployerPf.netPayable);
  assert.equal(withEmployerPf.loanDeduction, 600);
});

test("enabled ESI defaults to 0.75 percent and reduces take-home pay", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    esiEnabled: true,
    esiPercent: 0.75,
  });
  assert.equal(result.esi, 195);
  assert.equal(result.netPayable, 25805);
});

test("loan repayments and ESI are included in take-home deductions", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    loanDeduction: 1200,
    esiEnabled: true,
    esiPercent: 0.75,
  });
  assert.equal(result.loanDeduction, 1200);
  assert.equal(result.esi, 195);
  assert.equal(result.netPayable, 24605);
});

test("monthly loan deduction is capped at the remaining loan balance", () => {
  const loans = [
    { outstandingAmount: 10000, monthlyDeductionAmount: 1000 },
    { outstandingAmount: 500, monthlyDeductionAmount: 1000 },
    { outstandingAmount: 5000 },
  ];
  assert.equal(calculateLoanInstallment(loans), 1500);
  assert.equal(calculateLoanInstallment(loans), 1500);
  assert.deepEqual(loans.map((loan) => loan.outstandingAmount), [10000, 500, 5000]);
});

test("loan installments respect the start month, status, and final balance", () => {
  const loan = {
    outstandingAmount: 10000,
    monthlyDeductionAmount: 600,
    deductionStartMonth: "2026-10",
    status: "ACTIVE",
  };
  assert.equal(calculateLoanInstallment([loan], "2026-09"), 0);
  assert.equal(calculateLoanInstallment([loan], "2026-10"), 600);
  assert.equal(
    calculateLoanInstallment(
      [{ ...loan, outstandingAmount: 400 }],
      "2028-02",
    ),
    400,
  );
  assert.equal(
    calculateLoanInstallment([{ ...loan, status: "PAUSED" }], "2026-10"),
    0,
  );
  assert.equal(
    calculateLoanInstallment(
      [{ ...loan, status: "COMPLETED" }],
      "2026-10",
    ),
    0,
  );
});

test("a 10000 loan with 600 deductions ends in February 2028 with a 400 final payment", () => {
  const schedule = loanScheduleSummary({
    amount: 10000,
    method: "FIXED_AMOUNT",
    monthlyDeductionAmount: 600,
    startMonth: "2026-10",
  });
  assert.equal(schedule.installmentCount, 17);
  assert.equal(schedule.endMonth, "2028-02");
  assert.equal(
    calculateLoanInstallment(
      [{ outstandingAmount: 400, monthlyDeductionAmount: 600 }],
      "2028-02",
    ),
    400,
  );
  assert.equal(
    expectedCompletionMonth({
      balance: 10000,
      monthlyDeductionAmount: 600,
      startMonth: "2026-10",
    }),
    "2028-02",
  );
});

test("fixed installment and date-range methods calculate even monthly deductions", () => {
  assert.deepEqual(
    loanScheduleSummary({
      amount: 10000,
      method: "FIXED_INSTALLMENTS",
      installmentCount: 10,
      monthlyDeductionAmount: 0,
      startMonth: "2026-10",
    }),
    {
      monthlyDeductionAmount: 1000,
      installmentCount: 10,
      endMonth: "2027-07",
    },
  );
  assert.deepEqual(
    loanScheduleSummary({
      amount: 10000,
      method: "DATE_RANGE",
      endMonth: "2027-07",
      monthlyDeductionAmount: 0,
      startMonth: "2026-10",
    }),
    {
      monthlyDeductionAmount: 1000,
      installmentCount: 10,
      endMonth: "2027-07",
    },
  );
});

test("fixed installment schedules round up monthly amounts and cap the exact final balance", () => {
  const schedule = loanScheduleSummary({
    amount: 10000,
    method: "FIXED_INSTALLMENTS",
    installmentCount: 3,
    monthlyDeductionAmount: 0,
    startMonth: "2026-10",
  });
  assert.equal(schedule.monthlyDeductionAmount, 3333.34);
  assert.equal(schedule.installmentCount, 3);
  assert.equal(schedule.endMonth, "2026-12");
  assert.equal(
    calculateLoanInstallment(
      [
        {
          outstandingAmount: 3333.32,
          monthlyDeductionAmount: schedule.monthlyDeductionAmount,
          repaymentMethod: "FIXED_INSTALLMENTS",
          installmentCount: schedule.installmentCount,
          deductionStartMonth: "2026-10",
        },
      ],
      "2026-12",
    ),
    3333.32,
  );
});

test("repayment schedule does not start before its start month or continue past its end", () => {
  const dateRangeLoan = {
    outstandingAmount: 500,
    monthlyDeductionAmount: 100,
    repaymentMethod: "DATE_RANGE",
    deductionStartMonth: "2026-10",
    deductionEndMonth: "2026-12",
  };
  assert.equal(calculateLoanInstallment([dateRangeLoan], "2026-09"), 0);
  assert.equal(calculateLoanInstallment([dateRangeLoan], "2027-01"), 0);
  assert.equal(calculateLoanInstallment([dateRangeLoan], "2026-10"), 100);
});

test("resuming a loan defers deductions until its effective payroll month", () => {
  const resumedLoan = {
    outstandingAmount: 1200,
    monthlyDeductionAmount: 600,
    deductionStartMonth: "2026-09",
    status: "ACTIVE",
    resumeEffectiveMonth: "2026-12",
  };
  assert.equal(calculateLoanInstallment([resumedLoan], "2026-11"), 0);
  assert.equal(calculateLoanInstallment([resumedLoan], "2026-12"), 600);
});

test("a zero-balance loan has no future installment", () => {
  assert.equal(
    calculateLoanInstallment(
      [{ outstandingAmount: 0, monthlyDeductionAmount: 600 }],
      "2026-10",
    ),
    0,
  );
});

test("loan validation converts numeric strings and rejects empty or invalid money", () => {
  const loan = loanSchema.parse({
    employeeId: "507f1f77bcf86cd799439011",
    outletId: "507f1f77bcf86cd799439012",
    totalAmount: "10000",
    monthlyDeductionAmount: "600",
    deductionStartMonth: "2026-10",
  });
  assert.equal(loan.totalAmount, 10000);
  assert.equal(loan.monthlyDeductionAmount, 600);

  const installmentLoan = loanSchema.parse({
    employeeId: "507f1f77bcf86cd799439011",
    outletId: "507f1f77bcf86cd799439012",
    totalAmount: "10000",
    monthlyDeductionAmount: "1000",
    deductionStartMonth: "2026-10",
    repaymentMethod: "FIXED_INSTALLMENTS",
    installmentCount: "10",
  });
  assert.equal(installmentLoan.installmentCount, 10);

  for (const invalidAmount of ["", "-1", "NaN", "Infinity"]) {
    assert.throws(() =>
      loanSchema.parse({
        employeeId: "507f1f77bcf86cd799439011",
        outletId: "507f1f77bcf86cd799439012",
        totalAmount: "10000",
        monthlyDeductionAmount: invalidAmount,
        deductionStartMonth: "2026-10",
      }),
    );
  }
  assert.throws(() =>
    loanSchema.parse({
      employeeId: "507f1f77bcf86cd799439011",
      outletId: "507f1f77bcf86cd799439012",
      totalAmount: "10000",
      monthlyDeductionAmount: "600",
      deductionStartMonth: "2026-10",
      repaymentMethod: "FIXED_INSTALLMENTS",
      installmentCount: "",
    }),
  );
  assert.throws(() =>
    loanSchema.parse({
      employeeId: "507f1f77bcf86cd799439011",
      outletId: "507f1f77bcf86cd799439012",
      totalAmount: "10000",
      monthlyDeductionAmount: "600",
      deductionStartMonth: "2026-10",
      repaymentMethod: "DATE_RANGE",
      deductionEndMonth: "2026-09",
    }),
  );
});

test("approved advances, other deductions, overtime, and allowances reconcile", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    advances: 3000,
    overtime: 500,
    allowances: 200,
    otherDeductions: 100,
  });
  assert.equal(result.netPayable, 23600);
});

test("uses the 30-day divisor and rounds half paise upward consistently", () => {
  const result = calculatePayroll({
    ...base,
    monthlyBaseSalary: 1000,
    daysInMonth: 28,
    presentDays: 1,
    halfDays: 0,
    salaryEntitlementDays: 1,
  });
  assert.equal(result.dailyRate, 33.33);
  assert.equal(result.grossEarnings, 33.33);
});

test("duplicate payroll runs are detected for employees already generated", () => {
  assert.deepEqual(
    findExistingPayrollEmployees(["employee-a"], ["employee-a", "employee-b"]),
    ["employee-a"],
  );
  assert.deepEqual(findExistingPayrollEmployees([], ["employee-a"]), []);
});

test("passwords are salted hashes and verify only against the original password", async () => {
  const password = "Fresh-Admin-Pass-2026";
  const hash = await hashPassword(password);
  assert.notEqual(hash, password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword("different-password", hash), false);
});

test("password hashes accept long passwords and preserve existing bcrypt hashes", async () => {
  const longPassword = "Long-Admin-Pass-" + "x".repeat(200);
  const longHash = await hashPassword(longPassword);
  assert.equal(await verifyPassword(longPassword, longHash), true);
  assert.equal(await verifyPassword(`${longPassword}x`, longHash), false);

  const legacyPassword = "Existing-Admin-Pass-2026";
  const legacyHash = await bcrypt.hash(legacyPassword, 12);
  assert.equal(await verifyPassword(legacyPassword, legacyHash), true);
});

test("uniform deductions reduce net payroll and remain separately itemized", () => {
  const result = calculatePayroll({
    ...base,
    daysInMonth: 30,
    presentDays: 30,
    absentDays: 0,
    halfDays: 0,
    weekOffs: 0,
    uniformDeductions: 500,
    salaryEntitlementDays: 30,
  });
  assert.equal(result.grossEarnings, 30000);
  assert.equal(result.uniformDeductions, 500);
  assert.equal(result.netPayable, 29500);
});

test("uniform entries allow optional fields and default blank months", () => {
  const entries = uniformEntriesSchema.parse([
    { item: "shirt", selected: true, amount: "", deductionMonth: "", remark: "" },
    { item: "pant", selected: false, amount: "250", deductionMonth: "2027-01" },
    { item: "cap", selected: false, amount: "", remark: "not selected" },
  ]);
  const normalized = normalizeUniformEntries(entries, "2026-12");
  assert.deepEqual(normalized, [
    { item: "shirt", amount: 0, deductionMonth: "2026-12", remark: "" },
    { item: "pant", amount: 250, deductionMonth: "2027-01", remark: "" },
  ]);
  assert.equal(hasPastUniformMonth(normalized, "2026-12"), false);
  assert.equal(
    hasPastUniformMonth([{ deductionMonth: "2026-11" }], "2026-12"),
    true,
  );
});

test("uniform report sums only due installments and tracks future scheduled balance", () => {
  const summary = summarizeUniformDeductions(
    [
      { item: "cap", amount: 100, deductionMonth: "2026-11", status: "SCHEDULED" },
      { item: "shirt", amount: 300, deductionMonth: "2026-11", status: "APPLIED" },
      { item: "pant", amount: 400, deductionMonth: "2026-11", status: "SCHEDULED" },
      { item: "pant", amount: 200, deductionMonth: "2026-12", status: "SCHEDULED" },
      { item: "cap", amount: 50, deductionMonth: "2026-11", status: "CANCELLED" },
    ],
    "2026-11",
    "2026-11",
  );
  assert.deepEqual(summary, {
    byItem: { cap: 100, shirt: 300, pant: 400 },
    total: 800,
    remaining: 200,
  });
});

test("uniform report columns follow configured items and include items found in records", () => {
  assert.deepEqual(
    getUniformReportItems(
      [
        { key: "cap", label: "Uniform Cap" },
        { key: "jacket", label: "Jacket" },
      ],
      ["belt"],
    ),
    [
      { key: "cap", label: "Uniform Cap" },
      { key: "jacket", label: "Jacket" },
      { key: "belt", label: "Belt" },
    ],
  );
});
