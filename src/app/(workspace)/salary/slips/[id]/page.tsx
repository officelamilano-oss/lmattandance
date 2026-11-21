import "../../../../globals.css";
import { ObjectId } from "mongodb";
import { notFound } from "next/navigation";
import { SalarySlip } from "@/components/salary-slip";
import { getDb } from "@/lib/mongodb";
import { requireActor, assertOutletAccess } from "@/lib/permissions";
import type { SalaryRecordDocument } from "@/lib/models";

export default async function SalarySlipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor("salary.read");
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();
  const record = await (await getDb())
    .collection<SalaryRecordDocument>("salaryRecords")
    .findOne({ _id: new ObjectId(id) });
  if (!record) notFound();
  assertOutletAccess(actor, record.outletId);

  const employee = record.inputSnapshot.employee;
  const uniformDeductions = record.inputSnapshot.uniformDeductions ?? [];
  return (
    <SalarySlip
      month={record.month}
      periodStart={record.periodStart ?? ""}
      periodEnd={record.periodEnd ?? ""}
      employeeName={employee.fullName}
      employeeCode={employee.employeeCode}
      monthlySalary={employee.monthlyBaseSalary ?? 0}
      status={record.status}
      calculation={record.calculation}
      uniformDeductions={uniformDeductions}
    />
  );
}
