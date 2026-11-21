import Decimal from "decimal.js";
import type { AttendanceEntry, SalaryMethod } from "@/lib/models";
import { addMonths } from "@/lib/payroll/loans";

export interface PayrollInputs {
  monthlyBaseSalary: number;
  salaryMethod: SalaryMethod;
  daysInMonth: number;
  workingDaysDivisor: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  weekOffs: number;
  paidAbsences: number;
  settleMonthlySalary?: boolean;
  salaryEntitlementDays?: number;
  advances: number;
  loanDeduction?: number;
  overtime: number;
  allowances: number;
  otherDeductions: number;
  uniformDeductions?: number;
  pfEnabled: boolean;
  employeePfPercent: number;
  employerPfPercent: number;
  esiEnabled?: boolean;
  esiPercent?: number;
  notMarkedDays: number;
}

export interface PayrollCalculation {
  dailyRate: number;
  halfDayDeduction: number;
  payableDayUnits: number;
  presentDays: number;
  absentDays: number;
  paidAbsenceDays: number;
  halfDays: number;
  weekOffs: number;
  grossEarnings: number;
  overtime: number;
  allowances: number;
  advances: number;
  loanDeduction: number;
  otherDeductions: number;
  uniformDeductions: number;
  employeePf: number;
  employerPf: number;
  esi: number;
  netPayable: number;
  allowedWeekOff: number;
  allowanceConsumed: number;
  allowanceRemaining: number;
  totalEquivalentDays: number;
  chargeableDays: number;
  attendanceDeduction: number;
  notMarkedDays: number;
  notMarkedDeduction: number;
  totalDeductions: number;
  shortfall: number;
}

const money = (amount: Decimal) => amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

export function getLatestAttendanceEntries(
  entries: AttendanceEntry[],
  context?: { outletId?: string; date?: string },
) {
  const latest = new Map<string, AttendanceEntry>();
  const duplicateIds = new Set<string>();
  for (const entry of entries) {
    const employeeId = entry.employeeId.toHexString();
    const previous = latest.get(employeeId);
    if (previous) duplicateIds.add(employeeId);
    if (!previous || entry.updatedAt.getTime() >= previous.updatedAt.getTime())
      latest.set(employeeId, entry);
  }
  if (duplicateIds.size) {
    console.warn("Duplicate attendance entries found; latest valid entry used.", {
      ...context,
      employeeIds: [...duplicateIds],
    });
  }
  return [...latest.values()];
}

export function getLatestAttendanceEntry(
  entries: AttendanceEntry[],
  employeeId: string,
  context?: { outletId?: string; date?: string },
) {
  return getLatestAttendanceEntries(entries, context).find(
    (entry) => entry.employeeId.toHexString() === employeeId,
  );
}

export function calculateNetPayable(calculation: {
  grossEarnings?: number | string;
  overtime?: number | string;
  allowances?: number | string;
  advances?: number | string;
  loanDeduction?: number | string;
  otherDeductions?: number | string;
  uniformDeductions?: number | string;
  employeePf?: number | string;
  esi?: number | string;
  attendanceDeduction?: number | string;
  notMarkedDeduction?: number | string;
}) {
  const net = new Decimal(Number(calculation.grossEarnings ?? 0))
    .plus(Number(calculation.overtime ?? 0))
    .plus(Number(calculation.allowances ?? 0))
    .minus(Number(calculation.attendanceDeduction ?? 0))
    .minus(Number(calculation.notMarkedDeduction ?? 0))
    .minus(Number(calculation.advances ?? 0))
    .minus(Number(calculation.loanDeduction ?? 0))
    .minus(Number(calculation.otherDeductions ?? 0))
    .minus(Number(calculation.uniformDeductions ?? 0))
    .minus(Number(calculation.employeePf ?? 0))
    .minus(Number(calculation.esi ?? 0));
  return money(Decimal.max(0, net));
}

export function countNotMarkedDays({
  dates,
  markedStatuses,
  dateOfJoining,
  deactivatedAt,
  cutoffDate,
  today,
  holidays = [],
  countTodayAsNotMarked = false,
}: {
  dates: string[];
  markedStatuses: Map<string, string>;
  dateOfJoining?: string;
  deactivatedAt?: string;
  cutoffDate: string;
  today: string;
  holidays?: string[];
  countTodayAsNotMarked?: boolean;
}) {
  const holidaySet = new Set(holidays);
  return dates.filter((date) => {
    if (date > cutoffDate) return false;
    if (dateOfJoining && date < dateOfJoining) return false;
    if (deactivatedAt && date > deactivatedAt) return false;
    if (holidaySet.has(date)) return false;
    if (date > today) return false;
    if (date === today && !countTodayAsNotMarked) return false;
    return !markedStatuses.has(date);
  }).length;
}

export function calculateLoanInstallment(
  loans: Array<{
    outstandingAmount: number;
    monthlyDeductionAmount?: number;
    deductionStartMonth?: string;
    resumeEffectiveMonth?: string;
    repaymentMethod?: "FIXED_AMOUNT" | "FIXED_INSTALLMENTS" | "DATE_RANGE";
    installmentCount?: number;
    deductionEndMonth?: string;
    createdAt?: Date | string;
    status?: "ACTIVE" | "PAUSED" | "COMPLETED";
  }>,
  month?: string,
): number {
  return money(
    loans.reduce(
      (sum, loan) => {
        const createdMonth =
          loan.createdAt instanceof Date
            ? loan.createdAt.toISOString().slice(0, 7)
            : loan.createdAt?.slice(0, 7);
        const startMonth = loan.deductionStartMonth ?? createdMonth;
        if (
          loan.outstandingAmount <= 0 ||
          loan.status === "PAUSED" ||
          loan.status === "COMPLETED" ||
          (month && startMonth && startMonth > month)
          || (month && loan.resumeEffectiveMonth && loan.resumeEffectiveMonth > month)
        )
          return sum;
        if (
          loan.repaymentMethod === "DATE_RANGE" &&
          month &&
          loan.deductionEndMonth &&
          month > loan.deductionEndMonth
        )
          return sum;
        if (
          loan.repaymentMethod === "FIXED_INSTALLMENTS" &&
          month &&
          startMonth &&
          loan.installmentCount &&
          month > addMonths(startMonth, loan.installmentCount - 1)
        )
          return sum;
        const scheduled = new Decimal(loan.monthlyDeductionAmount ?? 0);
        return sum.plus(Decimal.min(new Decimal(loan.outstandingAmount), scheduled));
      },
      new Decimal(0),
    ),
  );
}

export function calculatePayroll(input: PayrollInputs): PayrollCalculation {
  const divisor = 30;
  if (!Number.isInteger(divisor) || divisor < 1) throw new Error("Payroll divisor must be a positive integer.");
  const base = new Decimal(input.monthlyBaseSalary);
  const dailyRate = base.div(divisor);
  const paidAbsenceDays = Math.min(input.absentDays, input.paidAbsences);
  const eligibleSalaryDays = Math.max(
    0,
    Math.min(divisor, input.salaryEntitlementDays ?? divisor),
  );
  const paidAttendanceUnits =
    input.presentDays +
    input.halfDays * 0.5 +
    input.weekOffs +
    paidAbsenceDays;
  const payableDayUnits = input.settleMonthlySalary
    ? eligibleSalaryDays
    : Math.max(0, Math.min(paidAttendanceUnits, eligibleSalaryDays));
  const grossEarnings =
    eligibleSalaryDays >= divisor
      ? base
      : dailyRate.mul(eligibleSalaryDays);
  const halfDayDeduction = dailyRate.mul(input.halfDays * 0.5);
  const totalEquivalentDays =
    input.weekOffs + input.halfDays * 0.5 + input.absentDays;
  const allowanceConsumed = Math.min(3, totalEquivalentDays);
  const allowanceRemaining = Math.max(0, 3 - allowanceConsumed);
  const chargeableDays = Math.max(0, totalEquivalentDays - 3);
  const attendanceDeduction = dailyRate.mul(chargeableDays);
  const notMarkedDays = Math.max(0, input.notMarkedDays);
  const notMarkedDeduction = dailyRate.mul(notMarkedDays);
  const overtime = new Decimal(input.overtime);
  const allowances = new Decimal(input.allowances);
  const advances = new Decimal(input.advances);
  const loanDeduction = new Decimal(input.loanDeduction ?? 0);
  const otherDeductions = new Decimal(input.otherDeductions);
  const uniformDeductions = new Decimal(input.uniformDeductions ?? 0);
  const employeePf = input.pfEnabled ? grossEarnings.mul(input.employeePfPercent).div(100) : new Decimal(0);
  const employerPf = input.pfEnabled ? grossEarnings.mul(input.employerPfPercent).div(100) : new Decimal(0);
  const esi = input.esiEnabled
    ? grossEarnings.mul(input.esiPercent ?? 0).div(100)
    : new Decimal(0);
  const totalDeductions = attendanceDeduction
    .plus(notMarkedDeduction)
    .plus(advances)
    .plus(employeePf)
    .plus(esi)
    .plus(loanDeduction)
    .plus(uniformDeductions)
    .plus(otherDeductions);
  const grossWithExtras = grossEarnings.plus(overtime).plus(allowances);
  const netBeforeClamp = grossWithExtras.minus(totalDeductions);
  const netPayable = Decimal.max(0, netBeforeClamp);

  return {
    dailyRate: money(dailyRate), halfDayDeduction: money(halfDayDeduction),
    payableDayUnits, presentDays: input.presentDays, absentDays: input.absentDays,
    paidAbsenceDays, halfDays: input.halfDays, weekOffs: input.weekOffs,
    grossEarnings: money(grossEarnings),
    overtime: money(overtime), allowances: money(allowances), advances: money(advances),
    loanDeduction: money(loanDeduction), otherDeductions: money(otherDeductions), uniformDeductions: money(uniformDeductions), employeePf: money(employeePf), employerPf: money(employerPf), esi: money(esi),
    netPayable: money(netPayable),
    allowedWeekOff: 3,
    allowanceConsumed: money(new Decimal(allowanceConsumed)),
    allowanceRemaining: money(new Decimal(allowanceRemaining)),
    totalEquivalentDays: money(new Decimal(totalEquivalentDays)),
    chargeableDays: money(new Decimal(chargeableDays)),
    attendanceDeduction: money(attendanceDeduction),
    notMarkedDays: money(new Decimal(notMarkedDays)),
    notMarkedDeduction: money(notMarkedDeduction),
    totalDeductions: money(totalDeductions),
    shortfall: money(Decimal.max(0, netBeforeClamp.neg())),
  };
}