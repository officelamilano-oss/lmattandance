import Decimal from "decimal.js";

export type LoanRepaymentMethod =
  | "FIXED_AMOUNT"
  | "FIXED_INSTALLMENTS"
  | "DATE_RANGE";

export function monthsBetween(startMonth: string, endMonth: string): number {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  return (endYear - startYear) * 12 + endMonthNumber - startMonthNumber;
}

export function addMonths(month: string, count: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + count, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function loanScheduleSummary(input: {
  amount: number;
  method: LoanRepaymentMethod;
  startMonth: string;
  monthlyDeductionAmount: number;
  installmentCount?: number;
  endMonth?: string;
}): { monthlyDeductionAmount: number; installmentCount: number; endMonth: string } {
  const amount = new Decimal(input.amount);
  if (!amount.isFinite() || amount.lessThanOrEqualTo(0))
    throw new Error("Loan amount must be a positive finite amount.");
  if (input.method === "FIXED_AMOUNT") {
    const monthly = new Decimal(input.monthlyDeductionAmount);
    if (!monthly.isFinite() || monthly.lessThanOrEqualTo(0))
      throw new Error("Monthly deduction must be a positive finite amount.");
    const installments = amount.div(monthly).ceil().toNumber();
    return {
      monthlyDeductionAmount: monthly.toDecimalPlaces(2).toNumber(),
      installmentCount: installments,
      endMonth: addMonths(input.startMonth, installments - 1),
    };
  }
  const count =
    input.method === "FIXED_INSTALLMENTS"
      ? input.installmentCount
      : input.endMonth
        ? monthsBetween(input.startMonth, input.endMonth) + 1
        : undefined;
  if (!count || !Number.isInteger(count) || count < 1)
    throw new Error("Repayment duration must include at least one month.");
  if (input.method === "DATE_RANGE" && input.endMonth && input.endMonth < input.startMonth)
    throw new Error("Repayment end month must not precede the start month.");
  const monthly = amount.div(count).toDecimalPlaces(2, Decimal.ROUND_UP);
  return {
    monthlyDeductionAmount: monthly.toNumber(),
    installmentCount: count,
    endMonth: input.method === "DATE_RANGE" ? input.endMonth! : addMonths(input.startMonth, count - 1),
  };
}

export function expectedCompletionMonth(input: {
  balance: number;
  monthlyDeductionAmount: number;
  startMonth: string;
}): string | undefined {
  if (input.balance <= 0 || input.monthlyDeductionAmount <= 0) return undefined;
  const installments = new Decimal(input.balance)
    .div(input.monthlyDeductionAmount)
    .ceil()
    .toNumber();
  return addMonths(input.startMonth, installments - 1);
}
