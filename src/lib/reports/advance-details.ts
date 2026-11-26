import { formatExportDates } from "./export-dates";

export type ReportAdvanceDetail = {
  date: string;
  amount: number;
};

const amountFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAdvanceDetails(advances: ReportAdvanceDetail[]) {
  return [...advances]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(
      (advance) =>
        `${formatExportDates(advance.date)}: ₹${amountFormatter.format(advance.amount)}`,
    )
    .join(", ");
}

export function addEmployeeAdvanceSummaries<
  T extends Record<string, string | number | boolean | null>,
>(
  advances: T[],
) {
  const grouped = new Map<string, T[]>();
  for (const advance of advances) {
    if (advance.Status !== "APPROVED") continue;
    const employeeCode = String(advance["Employee Code"] ?? "Unknown");
    const records = grouped.get(employeeCode) ?? [];
    records.push(advance);
    grouped.set(employeeCode, records);
  }

  const summaryByEmployee = new Map<
    string,
    { details: string; total: number }
  >();
  for (const [employeeCode, records] of grouped) {
    summaryByEmployee.set(employeeCode, {
      details: formatAdvanceDetails(
        records.map((record) => ({
          date: String(record.Date ?? ""),
          amount: Number(record["Amount INR"] ?? 0),
        })),
      ),
      total: Number(
        records
          .reduce(
            (sum, record) => sum + Number(record["Amount INR"] ?? 0),
            0,
          )
          .toFixed(2),
      ),
    });
  }

  return advances.map((advance) => {
    const summary = summaryByEmployee.get(
      String(advance["Employee Code"] ?? "Unknown"),
    );
    return {
      Date: advance.Date,
      "Approval Date": advance["Approval Date"],
      "Employee Code": advance["Employee Code"],
      Employee: advance.Employee,
      "Amount INR": advance["Amount INR"],
      "Given By": advance["Given By"],
      Reference: advance.Reference,
      "Advance Details (Date / Amount INR)": summary?.details ?? "",
      Reason: advance.Reason,
      "Total Advances INR": summary?.total ?? 0,
      Status: advance.Status,
      "Payroll Claimed": advance["Payroll Claimed"],
    };
  });
}
