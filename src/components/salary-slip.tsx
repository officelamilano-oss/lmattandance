"use client";

import { Printer } from "lucide-react";
import { UNIFORM_ITEM_LABELS } from "@/lib/uniform-deductions";
import type { UniformItemKey } from "@/lib/models";
import type { PayrollCalculation } from "@/lib/payroll/calculate";

function currency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(amount);
}

export function SalarySlip({
  month,
  periodStart,
  periodEnd,
  employeeName,
  employeeCode,
  monthlySalary,
  status,
  calculation,
  uniformDeductions,
}: {
  month: string;
  periodStart: string;
  periodEnd: string;
  employeeName: string;
  employeeCode: string;
  monthlySalary: number;
  status: string;
  calculation: Record<string, number | string>;
  uniformDeductions: Array<{ item: UniformItemKey; amount: number; remark?: string }>;
}) {
  const value = (key: keyof PayrollCalculation) =>
    Number(calculation[key] ?? 0);
  return (
    <main className="content-area salary-slip-page">
      <div className="salary-slip-toolbar">
        <button className="button button-primary" onClick={() => window.print()}>
          <Printer size={16} /> Print / Save as PDF
        </button>
      </div>
      <article className="salary-slip">
        <header className="salary-slip-header">
          <div>
            <span className="eyebrow">LA MILANO / PAYROLL</span>
            <h1>Salary slip</h1>
          </div>
          <div className="salary-slip-period">
            <strong>{month}</strong>
            <span>{periodStart && periodEnd ? `${periodStart} to ${periodEnd}` : "Full month"}</span>
            <span>{status}</span>
          </div>
        </header>
        <section className="salary-slip-employee">
          <div><span>Employee</span><strong>{employeeName}</strong></div>
          <div><span>Employee ID</span><strong>{employeeCode}</strong></div>
          <div><span>Monthly salary</span><strong>{currency(monthlySalary)}</strong></div>
          <div><span>Payable days</span><strong>{value("payableDayUnits")}</strong></div>
          <div><span>Not marked</span><strong>{value("notMarkedDays")}</strong></div>
        </section>
        <section className="salary-slip-columns">
          <div>
            <h2>Earnings</h2>
            <SlipRow label="Gross earnings" amount={value("grossEarnings")} />
            <SlipRow label="Overtime" amount={value("overtime")} />
            <SlipRow label="Allowances" amount={value("allowances")} />
            <SlipRow label="Total earnings" amount={value("grossEarnings") + value("overtime") + value("allowances")} total />
          </div>
          <div>
            <h2>Deductions</h2>
            <SlipRow label="Allowed week off" amount={value("allowedWeekOff")} />
            <SlipRow label="Total equivalent days" amount={value("totalEquivalentDays")} />
            <SlipRow label="Chargeable days" amount={value("chargeableDays")} />
            <SlipRow label="Attendance deduction" amount={value("attendanceDeduction")} />
            <SlipRow label="Not marked deduction" amount={value("notMarkedDeduction")} />
            <div className="salary-slip-row">
              <span>Used / allowed (days)</span>
              <strong>
                {value("allowanceConsumed")} of {value("allowedWeekOff")}
              </strong>
            </div>
            <SlipRow label="Advances" amount={value("advances")} />
            <SlipRow label="ESI" amount={value("esi")} />
            <SlipRow label="PF deduction" amount={value("employeePf")} />
            <SlipRow label="Loan deduction" amount={value("loanDeduction")} />
            <SlipRow label="Other deductions" amount={value("otherDeductions")} />
            {uniformDeductions.map((item, index) => (
              <SlipRow
                key={`${item.item}-${index}`}
                label={`Uniform · ${UNIFORM_ITEM_LABELS[item.item]}`}
                amount={item.amount}
              />
            ))}
            <SlipRow label="Uniform deduction total" amount={value("uniformDeductions")} total />
            <SlipRow label="Total deductions" amount={value("totalDeductions")} total />
            <SlipRow label="Employer PF (tracked)" amount={value("employerPf")} />
          </div>
        </section>
        <footer className="salary-slip-net">
          <span>Net payable</span>
          <strong>{currency(value("netPayable"))}</strong>
        </footer>
        {value("shortfall") > 0 && (
          <p className="salary-slip-note">
            Payable is capped at zero. Shortfall carried:{" "}
            {currency(value("shortfall"))}.
          </p>
        )}
        <p className="salary-slip-note">This is a system-generated payroll statement.</p>
      </article>
    </main>
  );
}

function SlipRow({
  label,
  amount,
  total = false,
}: {
  label: string;
  amount: number;
  total?: boolean;
}) {
  return (
    <div className={`salary-slip-row${total ? " is-total" : ""}`}>
      <span>{label}</span>
      <strong>{currency(amount)}</strong>
    </div>
  );
}
