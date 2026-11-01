import Decimal from "decimal.js";
import type { SalaryMethod } from "@/lib/models";
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
  pfEnabled: boolean;
  employeePfPercent: number;
  employerPfPercent: number;
  esiEnabled?: boolean;
  esiPercent?: number;
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
  employeePf: number;
  employerPf: number;
  esi: number;
  netPayable: number;
}

const money = (amount: Decimal) => amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();

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
  const eligibleSalaryDays = Math.min(
    divisor,
    input.salaryEntitlementDays ?? divisor,
  );
  const rawPayableDayUnits = input.settleMonthlySalary
    ? eligibleSalaryDays -
      (input.absentDays - paidAbsenceDays) -
      input.halfDays * 0.5
    : input.presentDays +
      input.halfDays * 0.5 +
      input.weekOffs +
      paidAbsenceDays;
  const payableDayUnits = Math.max(0, Math.min(rawPayableDayUnits, divisor));
  const grossEarnings = dailyRate.mul(payableDayUnits);
  const halfDayDeduction = dailyRate.mul(input.halfDays * 0.5);
  const overtime = new Decimal(input.overtime);
  const allowances = new Decimal(input.allowances);
  const advances = new Decimal(input.advances);
  const loanDeduction = new Decimal(input.loanDeduction ?? 0);
  const otherDeductions = new Decimal(input.otherDeductions);
  const employeePf = input.pfEnabled ? grossEarnings.mul(input.employeePfPercent).div(100) : new Decimal(0);
  const employerPf = input.pfEnabled ? grossEarnings.mul(input.employerPfPercent).div(100) : new Decimal(0);
  const esi = input.esiEnabled
    ? grossEarnings.mul(input.esiPercent ?? 0).div(100)
    : new Decimal(0);
  const netPayable = grossEarnings.plus(overtime).plus(allowances).minus(advances).minus(loanDeduction).minus(otherDeductions).minus(employeePf).minus(esi);

  return {
    dailyRate: money(dailyRate), halfDayDeduction: money(halfDayDeduction),
    payableDayUnits, presentDays: input.presentDays, absentDays: input.absentDays,
    paidAbsenceDays, halfDays: input.halfDays, weekOffs: input.weekOffs,
    grossEarnings: money(grossEarnings),
    overtime: money(overtime), allowances: money(allowances), advances: money(advances),
    loanDeduction: money(loanDeduction), otherDeductions: money(otherDeductions), employeePf: money(employeePf), employerPf: money(employerPf), esi: money(esi),
    netPayable: money(netPayable),
  };
}