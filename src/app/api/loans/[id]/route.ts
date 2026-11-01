import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import type { LoanDocument } from "@/lib/models";
import { getActor } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { loanTermsSchema } from "@/lib/validation/business";
import { loanScheduleSummary } from "@/lib/payroll/loans";
import { getIndiaMonth } from "@/lib/payroll/dates";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid loan ID." }, { status: 400 });
    const current = await (await getDb())
      .collection<LoanDocument>("loans")
      .findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    if (current.status === "COMPLETED" || current.outstandingAmount <= 0)
      return NextResponse.json(
        { error: "Completed loans cannot have their repayment terms edited." },
        { status: 409 },
      );
    const input = loanTermsSchema.parse(await readJson<unknown>(request));
    if (input.deductionStartMonth < getIndiaMonth())
      return NextResponse.json(
        { error: "Repayment term changes must take effect in the current or a future payroll month." },
        { status: 400 },
      );
    const repaymentTerms = loanScheduleSummary({
      amount: current.outstandingAmount,
      method: input.repaymentMethod,
      startMonth: input.deductionStartMonth,
      monthlyDeductionAmount: input.monthlyDeductionAmount,
      installmentCount: input.installmentCount,
      endMonth: input.deductionEndMonth,
    });
    const now = new Date();
    const update = await (await getDb())
      .collection<LoanDocument>("loans")
      .updateOne(
        { _id: current._id, updatedAt: current.updatedAt },
        {
          $set: {
            monthlyDeductionAmount: repaymentTerms.monthlyDeductionAmount,
            deductionStartMonth: input.deductionStartMonth,
            repaymentMethod: input.repaymentMethod,
            installmentCount: repaymentTerms.installmentCount,
            deductionEndMonth: repaymentTerms.endMonth,
            notes: input.notes,
            updatedBy: actor.id,
            updatedAt: now,
          },
          $push: {
            repaymentTermsHistory: {
              method: input.repaymentMethod,
              monthlyDeductionAmount: repaymentTerms.monthlyDeductionAmount,
              deductionStartMonth: input.deductionStartMonth,
              installmentCount: repaymentTerms.installmentCount,
              deductionEndMonth: repaymentTerms.endMonth,
              effectiveAt: now,
              actorId: actor.id,
            },
          },
        },
      );
    if (!update.modifiedCount)
      return NextResponse.json(
        { error: "Loan changed concurrently. Refresh and try again." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_LOAN_UPDATED",
      entityType: "loan",
      entityId: id,
      outletId: current.outletId,
      changes: {
        monthlyDeductionAmount: {
          before: current.monthlyDeductionAmount ?? 0,
          after: repaymentTerms.monthlyDeductionAmount,
        },
        deductionStartMonth: {
          before: current.deductionStartMonth ?? null,
          after: input.deductionStartMonth,
        },
        repaymentMethod: {
          before: current.repaymentMethod ?? "FIXED_AMOUNT",
          after: input.repaymentMethod,
        },
        installmentCount: {
          before: current.installmentCount ?? null,
          after: input.installmentCount ?? null,
        },
        deductionEndMonth: {
          before: current.deductionEndMonth ?? null,
          after: input.deductionEndMonth ?? null,
        },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  const actor = await getActor();
  if (!actor)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  return NextResponse.json(
    {
      error:
        "Loans cannot be deleted because payroll and repayment history must be preserved. Use an authorized balance adjustment or closure workflow.",
    },
    { status: 409 },
  );
}
