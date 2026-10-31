import Decimal from "decimal.js";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb, getMongoClient } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type {
  LoanDocument,
  LoanInstallmentDocument,
  SalaryRecordDocument,
} from "@/lib/models";
import { calculateLoanInstallment } from "@/lib/payroll/calculate";
import { z } from "zod";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ADJUST"), kind: z.enum(["OVERTIME", "ALLOWANCE", "DEDUCTION", "LOAN"]), label: z.string().trim().min(2).max(100), amount: z.number().finite().positive().max(10_000_000), reason: z.string().trim().min(5).max(500) }),
  z.object({
    action: z.literal("EDIT_PAID"),
    reason: z.string().trim().min(5).max(500),
    amounts: z.object({
      grossEarnings: z.number().finite().nonnegative().max(10_000_000),
      advances: z.number().finite().nonnegative().max(10_000_000),
      esi: z.number().finite().nonnegative().max(10_000_000),
      employeePf: z.number().finite().nonnegative().max(10_000_000),
      employerPf: z.number().finite().nonnegative().max(10_000_000),
      loanDeduction: z.number().finite().nonnegative().max(10_000_000),
    }),
  }),
  z.object({ action: z.literal("APPROVE") }),
  z.object({ action: z.literal("PAY") }),
  z.object({
    action: z.literal("UNPAY"),
    reason: z.string().trim().min(5).max(500),
  }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid salary ID." }, { status: 400 });
    const input = actionSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const collection = db.collection<SalaryRecordDocument>("salaryRecords");
    const record = await collection.findOne({ _id: new ObjectId(id) });
    if (!record) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, record.outletId);
    const now = new Date();
    if (input.action === "EDIT_PAID") {
      if (actor.role !== "MAIN_ADMIN")
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can edit a paid payroll record." },
          { status: 403 },
        );
      if (record.status !== "PAID")
        return NextResponse.json(
          { error: "Only paid payroll records can be corrected here." },
          { status: 409 },
        );
      if (
        Math.abs(
          input.amounts.loanDeduction -
            Number(record.calculation.loanDeduction ?? 0),
        ) > 0.009
      )
        return NextResponse.json(
          {
            error:
              "Paid loan deductions must be corrected through the authorized loan installment reversal workflow.",
          },
          { status: 409 },
        );
      const client = await getMongoClient();
      const session = client.startSession();
      const before = record.calculation;
      const loanChanges: Array<{
        loan: LoanDocument;
        before: number;
        after: number;
      }> = [];
      const netPayable = calculateNetPayable({
        ...before,
        ...input.amounts,
      });
      try {
        await session.withTransaction(async () => {
          loanChanges.length = 0;
          const current = await collection.findOne(
            {
              _id: record._id,
              status: "PAID",
              updatedAt: record.updatedAt,
            },
            { session },
          );
          if (!current) throw new Error("SALARY_CHANGED");
          const previousLoanDeduction = Number(
            current.calculation.loanDeduction ?? 0,
          );
          const loanDelta = new Decimal(input.amounts.loanDeduction)
            .minus(previousLoanDeduction)
            .toDecimalPlaces(2);
          if (!loanDelta.isZero()) {
            const loans = await db
              .collection<LoanDocument>("loans")
              .find(
                {
                  employeeId: record.employeeId,
                  outletId: record.outletId,
                },
                { session },
              )
              .sort({ createdAt: 1, _id: 1 })
              .toArray();
            if (loanDelta.greaterThan(0)) {
              let remaining = loanDelta;
              for (const loan of loans) {
                if (remaining.lessThanOrEqualTo(0)) break;
                const outstanding = new Decimal(loan.outstandingAmount);
                const applied = Decimal.min(outstanding, remaining);
                if (applied.lessThanOrEqualTo(0)) continue;
                const after = outstanding.minus(applied).toDecimalPlaces(2).toNumber();
                const update = await db.collection<LoanDocument>("loans").updateOne(
                  { _id: loan._id, outstandingAmount: loan.outstandingAmount },
                  {
                    $set: {
                      outstandingAmount: after,
                      updatedBy: actor.id,
                      updatedAt: now,
                    },
                  },
                  { session },
                );
                if (!update.modifiedCount) throw new Error("LOAN_CHANGED");
                loanChanges.push({
                  loan,
                  before: loan.outstandingAmount,
                  after,
                });
                remaining = remaining.minus(applied);
              }
              if (remaining.greaterThan(0))
                throw new Error("LOAN_BALANCE_INSUFFICIENT");
            } else {
              if (!loans.length) throw new Error("LOAN_RESTORE_UNAVAILABLE");
              let remaining = loanDelta.abs();
              for (const loan of loans) {
                if (remaining.lessThanOrEqualTo(0)) break;
                const applied = remaining;
                const after = new Decimal(loan.outstandingAmount)
                  .plus(applied)
                  .toDecimalPlaces(2)
                  .toNumber();
                const update = await db.collection<LoanDocument>("loans").updateOne(
                  { _id: loan._id, outstandingAmount: loan.outstandingAmount },
                  {
                    $set: {
                      outstandingAmount: after,
                      updatedBy: actor.id,
                      updatedAt: now,
                    },
                  },
                  { session },
                );
                if (!update.modifiedCount) throw new Error("LOAN_CHANGED");
                loanChanges.push({
                  loan,
                  before: loan.outstandingAmount,
                  after,
                });
                remaining = remaining.minus(applied);
              }
            }
          }
          const update = await collection.updateOne(
            {
              _id: record._id,
              status: "PAID",
              updatedAt: record.updatedAt,
            },
            {
              $set: {
                ...Object.fromEntries(
                  Object.entries(input.amounts).map(([key, value]) => [
                    `calculation.${key}`,
                    value,
                  ]),
                ),
                "calculation.netPayable": netPayable,
                "inputSnapshot.paidPayrollCorrection": {
                  reason: input.reason,
                  actorId: actor.id,
                  at: now,
                },
                updatedAt: now,
              },
            },
            { session },
          );
          if (!update.modifiedCount) throw new Error("SALARY_CHANGED");
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "LOAN_BALANCE_INSUFFICIENT")
          return NextResponse.json(
            { error: "The increased loan deduction exceeds outstanding loan balance." },
            { status: 400 },
          );
        if (message === "LOAN_RESTORE_UNAVAILABLE")
          return NextResponse.json(
            { error: "No employee loan is available to restore the reduced deduction to." },
            { status: 409 },
          );
        if (message === "LOAN_CHANGED" || message === "SALARY_CHANGED")
          return NextResponse.json(
            { error: "Salary or loan changed concurrently. Refresh and try again." },
            { status: 409 },
          );
        throw error;
      } finally {
        await session.endSession();
      }
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "PAID_SALARY_CORRECTED",
        entityType: "salary",
        entityId: id,
        outletId: record.outletId,
        reason: input.reason,
        changes: {
          ...Object.fromEntries(
            Object.entries(input.amounts).map(([key, after]) => [
              key,
              { before: Number(before[key] ?? 0), after },
            ]),
          ),
          netPayable: {
            before: Number(before.netPayable ?? 0),
            after: netPayable,
          },
          ...Object.fromEntries(
            loanChanges.map(({ loan, before: loanBefore, after }) => [
              `loan:${loan._id.toHexString()}`,
              { before: loanBefore, after },
            ]),
          ),
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "UNPAY") {
      if (actor.role !== "MAIN_ADMIN")
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can mark a payroll payment as unpaid." },
          { status: 403 },
        );
      const result = await collection.updateOne(
        {
          _id: record._id,
          status: "PAID",
          updatedAt: record.updatedAt,
        },
        {
          $set: { status: "APPROVED", updatedAt: now },
          $unset: { paidBy: "", paidAt: "" },
        },
      );
      if (!result.modifiedCount)
        return NextResponse.json(
          { error: "Only paid payroll records can be marked unpaid." },
          { status: 409 },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "SALARY_MARKED_UNPAID",
        entityType: "salary",
        entityId: id,
        outletId: record.outletId,
        reason: input.reason,
      });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "ADJUST") {
      if (!actor.permissions.includes("salary.adjust")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      if (record.status !== "DRAFT") return NextResponse.json({ error: "Only draft salaries may be adjusted." }, { status: 409 });
      if (input.kind === "LOAN") {
        return NextResponse.json(
          {
            error:
              "Loan repayments are generated from the active loan schedule. Change loan terms on the Employee loans page or use the authorized reversal workflow.",
          },
          { status: 409 },
        );
      }
      const current = record.calculation;
      const key = input.kind === "OVERTIME" ? "overtime" : input.kind === "ALLOWANCE" ? "allowances" : "otherDeductions";
      const amount = new Decimal(Number(current[key] ?? 0)).plus(input.amount).toNumber();
      const netPayable = calculateNetPayable({ ...current, [key]: amount });
      const result = await collection.updateOne({ _id: record._id, status: "DRAFT" }, {
        $set: { [`calculation.${key}`]: amount, "calculation.netPayable": netPayable, updatedAt: now },
        $push: { adjustments: { label: input.label, amount: input.amount, reason: input.reason, actorId: actor.id, at: now } },
      });
      if (!result.modifiedCount) return NextResponse.json({ error: "Salary changed concurrently." }, { status: 409 });
      await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "SALARY_ADJUSTED", entityType: "salary", entityId: id, outletId: record.outletId, reason: input.reason, changes: { [key]: { before: current[key], after: amount }, netPayable: { before: current.netPayable, after: netPayable } } });
      return NextResponse.json({ ok: true, calculation: { ...current, [key]: amount, netPayable } });
    }
    if (input.action === "APPROVE") {
      if (!actor.permissions.includes("salary.approve")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      if (record.status !== "DRAFT")
        return NextResponse.json({ error: "Only draft salaries can be approved." }, { status: 409 });
      const client = await getMongoClient();
      const session = client.startSession();
      const posted: LoanInstallmentDocument[] = [];
      let updatedLoanDeduction = 0;
      let updatedNetPayable = 0;
      try {
        await session.withTransaction(async () => {
          posted.length = 0;
          const current = await collection.findOne(
            { _id: record._id, status: "DRAFT", updatedAt: record.updatedAt },
            { session },
          );
          if (!current) throw new Error("SALARY_CHANGED");
          const skipped = await db
            .collection<LoanInstallmentDocument>("loanInstallments")
            .find(
              {
                employeeId: record.employeeId,
                outletId: record.outletId,
                payrollMonth: record.month,
                status: "SKIPPED",
              },
              { session },
            )
            .project<{ loanId: ObjectId }>({ loanId: 1 })
            .toArray();
          const skippedIds = skipped.map((entry) => entry.loanId);
          const loans = await db
            .collection<LoanDocument>("loans")
            .find(
              {
                employeeId: record.employeeId,
                outletId: record.outletId,
                _id: { $nin: skippedIds },
                outstandingAmount: { $gt: 0 },
                status: { $nin: ["PAUSED", "COMPLETED"] },
                $or: [
                  { deductionStartMonth: { $exists: false } },
                  { deductionStartMonth: { $lte: record.month } },
                ],
              },
              { session },
            )
            .sort({ createdAt: 1, _id: 1 })
            .toArray();
          const scheduled = loans.reduce(
            (sum, loan) =>
              sum + calculateLoanInstallment([loan], record.month),
            0,
          );
          const targetLoanDeduction = scheduled;
          let remaining = new Decimal(targetLoanDeduction).toDecimalPlaces(2);
          const nowApproved = new Date();
          for (const loan of loans) {
            if (remaining.lessThanOrEqualTo(0)) break;
            const scheduledAmount = calculateLoanInstallment(
              [loan],
              record.month,
            );
            const applied = Decimal.min(
              new Decimal(loan.outstandingAmount),
              remaining,
            );
            if (applied.lessThanOrEqualTo(0)) continue;
            const closingBalance = new Decimal(loan.outstandingAmount)
              .minus(applied)
              .toDecimalPlaces(2)
              .toNumber();
            const changed = await db
              .collection<LoanDocument>("loans")
              .updateOne(
                {
                  _id: loan._id,
                  outstandingAmount: loan.outstandingAmount,
                  updatedAt: loan.updatedAt,
                },
                {
                  $set: {
                    outstandingAmount: closingBalance,
                    repaidAmount: new Decimal(
                      loan.repaidAmount ??
                        loan.totalAmount - loan.outstandingAmount,
                    )
                      .plus(applied)
                      .toDecimalPlaces(2)
                      .toNumber(),
                    ...(closingBalance === 0
                      ? {
                          status: "COMPLETED",
                          completedAt: nowApproved,
                          completedBy: actor.id,
                          completionReason: "Fully repaid through payroll.",
                          completionAmount: applied.toDecimalPlaces(2).toNumber(),
                          statusUpdatedAt: nowApproved,
                          statusUpdatedBy: actor.id,
                        }
                      : {}),
                    updatedBy: actor.id,
                    updatedAt: nowApproved,
                  },
                  ...(closingBalance === 0
                    ? {
                        $push: {
                          statusHistory: {
                            status: "COMPLETED" as const,
                            effectiveAt: nowApproved,
                            actorId: actor.id,
                            reason: "Fully repaid through payroll.",
                          },
                        },
                      }
                    : {}),
                },
                { session },
              );
            if (!changed.modifiedCount) throw new Error("LOAN_CHANGED");
            posted.push({
              _id: new ObjectId(),
              loanId: loan._id,
              employeeId: loan.employeeId,
              outletId: loan.outletId,
              payrollMonth: record.month,
              openingBalance: loan.outstandingAmount,
              scheduledDeduction: scheduledAmount,
              actualDeduction: applied.toDecimalPlaces(2).toNumber(),
              closingBalance,
              status: "POSTED",
              payrollRecordId: record._id,
              actorId: actor.id,
              createdAt: nowApproved,
              updatedAt: nowApproved,
            });
            remaining = remaining.minus(applied);
          }
          updatedLoanDeduction = new Decimal(targetLoanDeduction)
            .minus(remaining)
            .toDecimalPlaces(2)
            .toNumber();
          const nextCalculation = {
            ...current.calculation,
            loanDeduction: updatedLoanDeduction,
          };
          updatedNetPayable = calculateNetPayable(nextCalculation);
          const loanSnapshot = loans.map((loan) => {
            const installment = posted.find((entry) =>
              entry.loanId.equals(loan._id),
            );
            return {
              loanId: loan._id,
              payrollMonth: record.month,
              originalAmount: loan.totalAmount,
              openingBalance: loan.outstandingAmount,
              scheduledDeduction: calculateLoanInstallment(
                [loan],
                record.month,
              ),
              actualDeduction: installment?.actualDeduction ?? 0,
              closingBalance:
                installment?.closingBalance ?? loan.outstandingAmount,
              status: installment ? "POSTED" : "SCHEDULED",
            };
          });
          for (const installment of posted) {
            const { _id: ignoredId, ...postedFields } = installment;
            void ignoredId;
            const scheduledUpdate = await db
              .collection<LoanInstallmentDocument>("loanInstallments")
              .updateOne(
                {
                  loanId: installment.loanId,
                  payrollMonth: installment.payrollMonth,
                  status: "SCHEDULED",
                },
                { $set: postedFields },
                { session },
              );
            if (!scheduledUpdate.matchedCount)
              await db
                .collection<LoanInstallmentDocument>("loanInstallments")
                .insertOne(installment, { session });
          }
          const approved = await collection.updateOne(
            {
              _id: record._id,
              status: "DRAFT",
              updatedAt: current.updatedAt,
            },
            {
              $set: {
                status: "APPROVED",
                approvedBy: actor.id,
                approvedAt: nowApproved,
                "calculation.loanDeduction": updatedLoanDeduction,
                "calculation.netPayable": updatedNetPayable,
                "inputSnapshot.loans": loanSnapshot,
                updatedAt: nowApproved,
              },
            },
            { session },
          );
          if (!approved.modifiedCount) throw new Error("SALARY_CHANGED");
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "LOAN_CHANGED" || message === "SALARY_CHANGED")
          return NextResponse.json(
            { error: "Salary or loan changed concurrently. Refresh and try again." },
            { status: 409 },
          );
        throw error;
      } finally {
        await session.endSession();
      }
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "SALARY_APPROVED",
        entityType: "salary",
        entityId: id,
        outletId: record.outletId,
        changes: {
          loanDeduction: {
            before: Number(record.calculation.loanDeduction ?? 0),
            after: updatedLoanDeduction,
          },
          netPayable: {
            before: Number(record.calculation.netPayable ?? 0),
            after: updatedNetPayable,
          },
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (!actor.permissions.includes("salary.pay")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const result = await collection.updateOne({ _id: record._id, status: "APPROVED" }, { $set: { status: "PAID", paidBy: actor.id, paidAt: now, updatedAt: now } });
    if (!result.modifiedCount) return NextResponse.json({ error: "Only approved salaries can be marked paid." }, { status: 409 });
    await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "SALARY_PAID", entityType: "salary", entityId: id, outletId: record.outletId });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

  function calculateNetPayable(calculation: Record<string, number | string>) {
    return new Decimal(Number(calculation.grossEarnings ?? 0))
      .plus(Number(calculation.overtime ?? 0))
      .plus(Number(calculation.allowances ?? 0))
      .minus(Number(calculation.advances ?? 0))
      .minus(Number(calculation.loanDeduction ?? 0))
      .minus(Number(calculation.otherDeductions ?? 0))
      .minus(Number(calculation.employeePf ?? 0))
      .minus(Number(calculation.esi ?? 0))
      .toDecimalPlaces(2)
      .toNumber();
  }