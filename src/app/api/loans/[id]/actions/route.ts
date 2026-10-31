import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type {
  LoanDocument,
  LoanInstallmentDocument,
  LoanTransactionDocument,
  SalaryRecordDocument,
  UserDocument,
} from "@/lib/models";
import { getActor } from "@/lib/permissions";
import { calculateLoanInstallment } from "@/lib/payroll/calculate";
import { getIndiaMonth } from "@/lib/payroll/dates";
import { dateOnlySchema, monthSchema } from "@/lib/validation/common";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("SKIP"),
    payrollMonth: monthSchema,
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.enum(["PAUSE", "RESUME"]),
    reason: z.string().trim().min(5).max(500),
    effectiveMonth: monthSchema.optional(),
  }),
  z.object({
    action: z.literal("ADJUST"),
    direction: z.enum(["INCREASE", "REDUCE"]),
    amount: z.number().finite().positive().max(10_000_000),
    transactionDate: dateOnlySchema,
    reference: z.string().trim().max(200).optional(),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("CLOSE"),
    closureType: z.enum(["EXTERNAL_SETTLEMENT", "WRITE_OFF", "OTHER"]),
    amount: z.number().finite().positive().max(10_000_000).optional(),
    transactionDate: dateOnlySchema,
    reference: z.string().trim().max(200).optional(),
    reason: z.string().trim().min(5).max(500),
  }),
  z.object({
    action: z.literal("REVERSE"),
    payrollMonth: monthSchema,
    transactionDate: dateOnlySchema,
    reason: z.string().trim().min(5).max(500),
  }),
]);

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export async function GET(
  _request: Request,
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
    const db = await getDb();
    const loanId = new ObjectId(id);
    const [installments, transactions] = await Promise.all([
      db
        .collection<LoanInstallmentDocument>("loanInstallments")
        .find({ loanId })
        .sort({ payrollMonth: -1, createdAt: -1 })
        .toArray(),
      db
        .collection<LoanTransactionDocument>("loanTransactions")
        .find({ loanId })
        .sort({ createdAt: -1 })
        .toArray(),
    ]);
    const actorIds = [
      ...new Map(
        [
          ...installments.flatMap((entry) =>
            [entry.actorId, entry.reversedBy].filter(
              (actorId): actorId is ObjectId => actorId !== undefined,
            ),
          ),
          ...transactions.map((entry) => entry.actorId),
        ]
          .map((actorId) => [actorId.toHexString(), actorId]),
      ).values(),
    ];
    const users = actorIds.length
      ? await db
          .collection<UserDocument>("users")
          .find({ _id: { $in: actorIds } })
          .project<{ _id: ObjectId; name: string; email: string }>({
            name: 1,
            email: 1,
          })
          .toArray()
      : [];
    const userById = new Map(users.map((user) => [user._id.toHexString(), user]));
    return NextResponse.json({
      installments: installments.map((entry) => ({
        ...entry,
        _id: entry._id.toHexString(),
        loanId: entry.loanId.toHexString(),
        employeeId: entry.employeeId.toHexString(),
        outletId: entry.outletId.toHexString(),
        payrollRecordId: entry.payrollRecordId?.toHexString(),
        actorId: entry.actorId.toHexString(),
        actorName: userById.get(entry.actorId.toHexString())?.name ?? "Unknown user",
        reversedBy: entry.reversedBy?.toHexString(),
        reversedByName: entry.reversedBy
          ? userById.get(entry.reversedBy.toHexString())?.name ?? "Unknown user"
          : undefined,
      })),
      transactions: transactions.map((entry) => ({
        ...entry,
        _id: entry._id.toHexString(),
        loanId: entry.loanId.toHexString(),
        employeeId: entry.employeeId.toHexString(),
        outletId: entry.outletId.toHexString(),
        actorId: entry.actorId.toHexString(),
        actorName: userById.get(entry.actorId.toHexString())?.name ?? "Unknown user",
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
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
    const input = actionSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const loans = db.collection<LoanDocument>("loans");
    const loan = await loans.findOne({ _id: new ObjectId(id) });
    if (!loan) throw new Error("NOT_FOUND");
    const now = new Date();

    if (input.action === "SKIP") {
      if (loan.status === "COMPLETED" || loan.outstandingAmount <= 0)
        return NextResponse.json(
          { error: "A completed loan cannot have an installment skipped." },
          { status: 409 },
        );
      if (loan.status === "PAUSED")
        return NextResponse.json(
          { error: "Resume the loan before skipping an installment." },
          { status: 409 },
        );
      const startMonth =
        loan.deductionStartMonth ?? loan.createdAt.toISOString().slice(0, 7);
      if (input.payrollMonth < startMonth)
        return NextResponse.json(
          { error: "An installment cannot be skipped before the loan start month." },
          { status: 400 },
        );
      const payrollRecord = await db
        .collection<SalaryRecordDocument>("salaryRecords")
        .findOne({
          employeeId: loan.employeeId,
          outletId: loan.outletId,
          month: input.payrollMonth,
        });
      if (payrollRecord && payrollRecord.status !== "DRAFT")
        return NextResponse.json(
          { error: "This payroll month is finalized; use the authorized payroll correction workflow." },
          { status: 409 },
        );
      const scheduledDeduction = calculateLoanInstallment([loan], input.payrollMonth);
      if (scheduledDeduction <= 0)
        return NextResponse.json(
          { error: "No installment is due for this loan in the selected month." },
          { status: 409 },
        );
      const currentInstallment = await db
        .collection<LoanInstallmentDocument>("loanInstallments")
        .findOne({ loanId: loan._id, payrollMonth: input.payrollMonth });
      if (currentInstallment?.status === "SKIPPED")
        return NextResponse.json(
          { error: "This installment is already skipped.", status: "SKIPPED" },
          { status: 409 },
        );
      if (
        currentInstallment &&
        currentInstallment.status !== "SCHEDULED"
      )
        return NextResponse.json(
          { error: `This installment is already ${currentInstallment.status.toLowerCase()}.` },
          { status: 409 },
        );
      const installment: LoanInstallmentDocument = {
        _id: new ObjectId(),
        loanId: loan._id,
        employeeId: loan.employeeId,
        outletId: loan.outletId,
        payrollMonth: input.payrollMonth,
        openingBalance: loan.outstandingAmount,
        scheduledDeduction,
        actualDeduction: 0,
        closingBalance: loan.outstandingAmount,
        status: "SKIPPED",
        skipReason: input.reason,
        actorId: actor.id,
        createdAt: now,
        updatedAt: now,
      };
      try {
        if (payrollRecord) {
          const client = await getMongoClient();
          const session = client.startSession();
          try {
            await session.withTransaction(async () => {
              const currentPayroll = await db
                .collection<SalaryRecordDocument>("salaryRecords")
                .findOne(
                  {
                    _id: payrollRecord._id,
                    status: "DRAFT",
                    updatedAt: payrollRecord.updatedAt,
                  },
                  { session },
                );
              if (!currentPayroll) throw new Error("SALARY_CHANGED");
              const { _id: ignoredId, ...skipFields } = installment;
              void ignoredId;
              const scheduleUpdate = await db
                .collection<LoanInstallmentDocument>("loanInstallments")
                .updateOne(
                  {
                    loanId: loan._id,
                    payrollMonth: input.payrollMonth,
                    status: "SCHEDULED",
                  },
                  { $set: skipFields },
                  { session },
                );
              if (!scheduleUpdate.matchedCount)
                await db
                  .collection<LoanInstallmentDocument>("loanInstallments")
                  .insertOne(installment, { session });
              const otherScheduledLoans = await db
                .collection<LoanDocument>("loans")
                .find(
                  {
                    employeeId: loan.employeeId,
                    outletId: loan.outletId,
                    _id: { $ne: loan._id },
                    outstandingAmount: { $gt: 0 },
                    status: { $nin: ["PAUSED", "COMPLETED"] },
                    $or: [
                      { deductionStartMonth: { $exists: false } },
                      { deductionStartMonth: { $lte: input.payrollMonth } },
                    ],
                  },
                  { session },
                )
                .toArray();
              const alreadySkipped = await db
                .collection<LoanInstallmentDocument>("loanInstallments")
                .find(
                  {
                    employeeId: loan.employeeId,
                    outletId: loan.outletId,
                    payrollMonth: input.payrollMonth,
                    status: "SKIPPED",
                    loanId: { $ne: loan._id },
                  },
                  { session },
                )
                .project<{ loanId: ObjectId }>({ loanId: 1 })
                .toArray();
              const skippedIds = new Set(
                alreadySkipped.map((entry) => entry.loanId.toHexString()),
              );
              const nextLoanDeduction = otherScheduledLoans
                .filter((scheduledLoan) => !skippedIds.has(scheduledLoan._id.toHexString()))
                .reduce(
                  (sum, scheduledLoan) =>
                    sum +
                    calculateLoanInstallment(
                      [scheduledLoan],
                      input.payrollMonth,
                    ),
                  0,
                );
              const previousLoanDeduction = Number(
                currentPayroll.calculation.loanDeduction ?? 0,
              );
              const nextNetPayable = Number(
                (
                  Number(currentPayroll.calculation.netPayable ?? 0) +
                  previousLoanDeduction -
                  nextLoanDeduction
                ).toFixed(2),
              );
              const loanSnapshots = Array.isArray(
                currentPayroll.inputSnapshot.loans,
              )
                ? (currentPayroll.inputSnapshot.loans as Array<
                    Record<string, unknown>
                  >)
                : [];
              const nextLoanSnapshots = loanSnapshots.map((snapshot) =>
                String(snapshot.loanId) === loan._id.toHexString()
                  ? {
                      ...snapshot,
                      scheduledDeduction,
                      actualDeduction: 0,
                      closingBalance: loan.outstandingAmount,
                      status: "SKIPPED",
                    }
                  : snapshot,
              );
              if (
                !loanSnapshots.some(
                  (snapshot) =>
                    String(snapshot.loanId) === loan._id.toHexString(),
                )
              )
                nextLoanSnapshots.push({
                  loanId: loan._id,
                  payrollMonth: input.payrollMonth,
                  originalAmount: loan.totalAmount,
                  openingBalance: loan.outstandingAmount,
                  scheduledDeduction,
                  actualDeduction: 0,
                  closingBalance: loan.outstandingAmount,
                  status: "SKIPPED",
                });
              const updatedPayroll = await db
                .collection<SalaryRecordDocument>("salaryRecords")
                .updateOne(
                  {
                    _id: currentPayroll._id,
                    status: "DRAFT",
                    updatedAt: currentPayroll.updatedAt,
                  },
                  {
                    $set: {
                      "calculation.loanDeduction": nextLoanDeduction,
                      "calculation.netPayable": nextNetPayable,
                      "inputSnapshot.loans": nextLoanSnapshots,
                      updatedAt: now,
                    },
                  },
                  { session },
                );
              if (!updatedPayroll.modifiedCount)
                throw new Error("SALARY_CHANGED");
            });
          } finally {
            await session.endSession();
          }
        } else {
          const { _id: ignoredId, ...skipFields } = installment;
          void ignoredId;
          const scheduleUpdate = await db
            .collection<LoanInstallmentDocument>("loanInstallments")
            .updateOne(
              {
                loanId: loan._id,
                payrollMonth: input.payrollMonth,
                status: "SCHEDULED",
              },
              {
                $set: skipFields,
              },
            );
          if (!scheduleUpdate.matchedCount)
            await db
              .collection<LoanInstallmentDocument>("loanInstallments")
              .insertOne(installment);
        }
      } catch (error) {
        if (error instanceof Error && error.message === "SALARY_CHANGED")
          return NextResponse.json(
            { error: "Draft payroll changed concurrently. Refresh and retry." },
            { status: 409 },
          );
        if (isDuplicateKey(error))
          return NextResponse.json(
            { error: "An installment record already exists for this loan and month." },
            { status: 409 },
          );
        throw error;
      }
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_LOAN_INSTALLMENT_SKIPPED",
        entityType: "loan",
        entityId: id,
        outletId: loan.outletId,
        reason: input.reason,
        changes: {
          payrollMonth: { before: null, after: input.payrollMonth },
          scheduledDeduction: { before: 0, after: scheduledDeduction },
          outstandingAmount: { before: loan.outstandingAmount, after: loan.outstandingAmount },
        },
      });
      return NextResponse.json({ ok: true }, { status: 201 });
    }

    if (input.action === "PAUSE" || input.action === "RESUME") {
      const nextStatus = input.action === "PAUSE" ? "PAUSED" : "ACTIVE";
      if (input.action === "PAUSE" && loan.status !== "ACTIVE" && loan.status !== undefined)
        return NextResponse.json({ error: "Only an active loan can be paused." }, { status: 409 });
      if (input.action === "RESUME" && loan.status !== "PAUSED")
        return NextResponse.json({ error: "Only a paused loan can be resumed." }, { status: 409 });
      if (loan.outstandingAmount <= 0 || loan.status === "COMPLETED")
        return NextResponse.json({ error: "Completed loans cannot be paused or resumed." }, { status: 409 });
      if (
        input.action === "RESUME" &&
        input.effectiveMonth &&
        input.effectiveMonth < getIndiaMonth(now)
      )
        return NextResponse.json(
          { error: "A loan cannot resume in a past payroll month." },
          { status: 400 },
        );
      const updated = await loans.updateOne(
        { _id: loan._id, updatedAt: loan.updatedAt },
        {
          $set: {
            status: nextStatus,
            ...(input.action === "RESUME" && input.effectiveMonth
              ? { resumeEffectiveMonth: input.effectiveMonth }
              : {}),
            statusReason: input.reason,
            statusUpdatedAt: now,
            statusUpdatedBy: actor.id,
            updatedBy: actor.id,
            updatedAt: now,
          },
          ...(input.action === "RESUME" && !input.effectiveMonth
            ? { $unset: { resumeEffectiveMonth: "" } }
            : {}),
          $push: {
            statusHistory: {
              status: nextStatus,
              effectiveAt: now,
              ...(input.action === "RESUME" && input.effectiveMonth
                ? { effectivePayrollMonth: input.effectiveMonth }
                : {}),
              actorId: actor.id,
              reason: input.reason,
            },
          },
        },
      );
      if (!updated.modifiedCount)
        return NextResponse.json({ error: "Loan changed concurrently. Refresh and try again." }, { status: 409 });
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: input.action === "PAUSE" ? "EMPLOYEE_LOAN_PAUSED" : "EMPLOYEE_LOAN_RESUMED",
        entityType: "loan",
        entityId: id,
        outletId: loan.outletId,
        reason: input.reason,
        changes: {
          status: { before: loan.status ?? "ACTIVE", after: nextStatus },
          ...(input.action === "RESUME" && input.effectiveMonth
            ? { effectivePayrollMonth: { before: null, after: input.effectiveMonth } }
            : {}),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (loan.status === "COMPLETED" && input.action !== "REVERSE")
      return NextResponse.json({ error: "Completed loans cannot be financially adjusted." }, { status: 409 });
    if (loan.outstandingAmount <= 0 && input.action !== "REVERSE") {
      if (input.action !== "CLOSE")
        return NextResponse.json({ error: "A zero-balance loan has no balance to adjust." }, { status: 409 });
      const completed = await loans.updateOne(
        { _id: loan._id, outstandingAmount: 0, updatedAt: loan.updatedAt },
        {
          $set: {
            status: "COMPLETED",
            completedAt: now,
            completedBy: actor.id,
            completionReason: input.reason,
            completionReference: input.reference,
            completionAmount: 0,
            statusUpdatedAt: now,
            statusUpdatedBy: actor.id,
            updatedBy: actor.id,
            updatedAt: now,
          },
          $push: {
            statusHistory: {
              status: "COMPLETED",
              effectiveAt: now,
              actorId: actor.id,
              reason: input.reason,
            },
          },
        },
      );
      if (!completed.modifiedCount)
        return NextResponse.json({ error: "Loan changed concurrently. Refresh and try again." }, { status: 409 });
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_LOAN_COMPLETED",
        entityType: "loan",
        entityId: id,
        outletId: loan.outletId,
        reason: input.reason,
        changes: { status: { before: loan.status ?? "ACTIVE", after: "COMPLETED" } },
      });
      return NextResponse.json({ ok: true, completed: true });
    }
    if (input.action !== "ADJUST" && input.action !== "CLOSE")
      if (input.action !== "REVERSE")
        return NextResponse.json({ error: "Unsupported loan action." }, { status: 400 });

    if (input.action === "REVERSE") {
      const installment = await db
        .collection<LoanInstallmentDocument>("loanInstallments")
        .findOne({
          loanId: loan._id,
          payrollMonth: input.payrollMonth,
          status: "POSTED",
        });
      if (!installment || !installment.payrollRecordId)
        return NextResponse.json({ error: "No posted payroll installment is available to reverse for this month." }, { status: 404 });
      const laterInstallment = await db
        .collection<LoanInstallmentDocument>("loanInstallments")
        .findOne({
          loanId: loan._id,
          status: "POSTED",
          createdAt: { $gt: installment.createdAt },
        });
      const laterTransaction = await db
        .collection<LoanTransactionDocument>("loanTransactions")
        .findOne({
          loanId: loan._id,
          createdAt: { $gt: installment.createdAt },
        });
      if (laterInstallment || laterTransaction)
        return NextResponse.json(
          { error: "This installment cannot be reversed because later loan transactions exist. Use an authorized balance adjustment." },
          { status: 409 },
        );
      const client = await getMongoClient();
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const currentLoan = await loans.findOne(
            { _id: loan._id },
            { session },
          );
          const salary = await db
            .collection<SalaryRecordDocument>("salaryRecords")
            .findOne(
              { _id: installment.payrollRecordId },
              { session },
            );
          const currentInstallment = await db
            .collection<LoanInstallmentDocument>("loanInstallments")
            .findOne(
              { _id: installment._id, status: "POSTED" },
              { session },
            );
          if (!currentLoan || !salary || !currentInstallment)
            throw new Error("LOAN_CHANGED");
          const balanceAfter = Number(
            (currentLoan.outstandingAmount + installment.actualDeduction).toFixed(2),
          );
          const deductionAfter = Number(
            (Number(salary.calculation.loanDeduction ?? 0) - installment.actualDeduction).toFixed(2),
          );
          if (deductionAfter < 0)
            throw new Error("PAYROLL_DEDUCTION_CHANGED");
          const netAfter = Number(
            (Number(salary.calculation.netPayable ?? 0) + installment.actualDeduction).toFixed(2),
          );
          const loanSnapshots = Array.isArray(salary.inputSnapshot.loans)
            ? (salary.inputSnapshot.loans as Array<Record<string, unknown>>)
            : [];
          const reversedSnapshots = loanSnapshots.map((snapshot) =>
            String(snapshot.loanId) === loan._id.toHexString()
              ? {
                  ...snapshot,
                  actualDeduction: 0,
                  closingBalance: balanceAfter,
                  status: "REVERSED",
                }
              : snapshot,
          );
          const updatedLoan = await loans.updateOne(
            {
              _id: currentLoan._id,
              outstandingAmount: currentLoan.outstandingAmount,
              updatedAt: currentLoan.updatedAt,
            },
            {
              $set: {
                outstandingAmount: balanceAfter,
                repaidAmount: Math.max(
                  0,
                  Number(
                    ((currentLoan.repaidAmount ??
                      currentLoan.totalAmount - currentLoan.outstandingAmount) -
                      installment.actualDeduction).toFixed(2),
                  ),
                ),
                status: "ACTIVE",
                updatedBy: actor.id,
                updatedAt: now,
              },
              ...(completing
                ? {
                    $push: {
                      statusHistory: {
                        status: "COMPLETED" as const,
                        effectiveAt: now,
                        actorId: actor.id,
                        reason: input.reason,
                      },
                    },
                  }
                : {}),
              $unset: {
                completedAt: "",
                completedBy: "",
                completionReason: "",
                completionReference: "",
                completionAmount: "",
              },
              $push: {
                statusHistory: {
                  status: "ACTIVE",
                  effectiveAt: now,
                  actorId: actor.id,
                  reason: input.reason,
                },
              },
            },
            { session },
          );
          if (!updatedLoan.modifiedCount) throw new Error("LOAN_CHANGED");
          const updatedInstallment = await db
            .collection<LoanInstallmentDocument>("loanInstallments")
            .updateOne(
              { _id: installment._id, status: "POSTED" },
              {
                $set: {
                  status: "REVERSED",
                  reversalReason: input.reason,
                  reversedBy: actor.id,
                  reversedAt: now,
                  updatedAt: now,
                },
              },
              { session },
            );
          if (!updatedInstallment.modifiedCount) throw new Error("LOAN_CHANGED");
          await db.collection<LoanTransactionDocument>("loanTransactions").insertOne(
            {
              _id: new ObjectId(),
              loanId: loan._id,
              employeeId: loan.employeeId,
              outletId: loan.outletId,
              type: "REVERSAL",
              amount: installment.actualDeduction,
              balanceBefore: currentLoan.outstandingAmount,
              balanceAfter,
              reason: input.reason,
              transactionDate: input.transactionDate,
              actorId: actor.id,
              createdAt: now,
            },
            { session },
          );
          const updatedSalary = await db
            .collection<SalaryRecordDocument>("salaryRecords")
            .updateOne(
              {
                _id: salary._id,
                updatedAt: salary.updatedAt,
              },
              {
                $set: {
                  "calculation.loanDeduction": deductionAfter,
                  "calculation.netPayable": netAfter,
                  "inputSnapshot.loans": reversedSnapshots,
                  updatedAt: now,
                },
                $push: {
                  adjustments: {
                    label: "Loan deduction reversal",
                    amount: installment.actualDeduction,
                    reason: input.reason,
                    actorId: actor.id,
                    at: now,
                  },
                },
              },
              { session },
            );
          if (!updatedSalary.modifiedCount) throw new Error("LOAN_CHANGED");
        });
      } finally {
        await session.endSession();
      }
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_LOAN_INSTALLMENT_REVERSED",
        entityType: "loan",
        entityId: id,
        outletId: loan.outletId,
        reason: input.reason,
        changes: {
          payrollMonth: { before: input.payrollMonth, after: input.payrollMonth },
          amount: { before: installment.actualDeduction, after: 0 },
        },
      });
      return NextResponse.json({ ok: true });
    }

    const transactionDate = input.transactionDate;
    let balanceAfter: number;
    let transactionType: LoanTransactionDocument["type"];
    let transactionAmount: number;
    let newRepaidAmount = loan.repaidAmount ?? loan.totalAmount - loan.outstandingAmount;
    let completing = false;
    if (input.action === "ADJUST") {
      transactionAmount = input.amount;
      transactionType = "BALANCE_ADJUSTMENT";
      balanceAfter =
        input.direction === "INCREASE"
          ? Number((loan.outstandingAmount + input.amount).toFixed(2))
          : Number((loan.outstandingAmount - input.amount).toFixed(2));
      if (balanceAfter < 0)
        return NextResponse.json({ error: "A balance reduction cannot exceed the outstanding balance." }, { status: 400 });
      completing = balanceAfter === 0;
    } else {
      const closureType = input.closureType;
      if (
        closureType === "EXTERNAL_SETTLEMENT" &&
        (!input.amount || input.amount > loan.outstandingAmount + 0.009)
      )
        return NextResponse.json(
          { error: "External settlement must be positive and cannot exceed the outstanding balance." },
          { status: 400 },
        );
      if (
        closureType !== "EXTERNAL_SETTLEMENT" &&
        input.amount !== undefined &&
        Math.abs(input.amount - loan.outstandingAmount) > 0.009
      )
        return NextResponse.json({ error: "Closure amount must match the outstanding balance." }, { status: 400 });
      transactionType =
        closureType === "EXTERNAL_SETTLEMENT"
          ? "EXTERNAL_SETTLEMENT"
          : closureType === "WRITE_OFF"
            ? "WRITE_OFF"
            : "OTHER_CLOSURE";
      transactionAmount =
        closureType === "EXTERNAL_SETTLEMENT"
          ? input.amount!
          : loan.outstandingAmount;
      balanceAfter = Number(
        (loan.outstandingAmount - transactionAmount).toFixed(2),
      );
      completing = balanceAfter === 0;
      if (closureType === "EXTERNAL_SETTLEMENT")
        newRepaidAmount = Number((newRepaidAmount + transactionAmount).toFixed(2));
    }

    const transaction: LoanTransactionDocument = {
      _id: new ObjectId(),
      loanId: loan._id,
      employeeId: loan.employeeId,
      outletId: loan.outletId,
      type: transactionType,
      amount: transactionAmount,
      balanceBefore: loan.outstandingAmount,
      balanceAfter,
      reason: input.reason,
      reference: input.reference,
      transactionDate,
      actorId: actor.id,
      createdAt: now,
    };
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const updated = await loans.updateOne(
          {
            _id: loan._id,
            outstandingAmount: loan.outstandingAmount,
            updatedAt: loan.updatedAt,
            status: { $ne: "COMPLETED" },
          },
          {
            $set: {
              outstandingAmount: balanceAfter,
              repaidAmount: newRepaidAmount,
              ...(completing
                ? {
                    status: "COMPLETED",
                    completedAt: now,
                    completedBy: actor.id,
                    completionReason: input.reason,
                    completionReference: input.reference,
                    completionAmount: transactionAmount,
                    statusUpdatedAt: now,
                    statusUpdatedBy: actor.id,
                  }
                : {}),
              updatedBy: actor.id,
              updatedAt: now,
            },
          },
          { session },
        );
        if (!updated.modifiedCount) throw new Error("LOAN_CHANGED");
        await db.collection<LoanTransactionDocument>("loanTransactions").insertOne(
          transaction,
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action:
        input.action === "ADJUST"
          ? "EMPLOYEE_LOAN_BALANCE_ADJUSTED"
          : `EMPLOYEE_LOAN_${transactionType}`,
      entityType: "loan",
      entityId: id,
      outletId: loan.outletId,
      reason: input.reason,
      changes: {
        outstandingAmount: {
          before: loan.outstandingAmount,
          after: balanceAfter,
        },
        transactionType: { before: null, after: transactionType },
        transactionAmount: { before: null, after: transactionAmount },
      },
    });
    return NextResponse.json({ ok: true, completed: completing }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "LOAN_CHANGED")
      return NextResponse.json(
        { error: "Loan changed concurrently. Refresh and try again." },
        { status: 409 },
      );
    return apiError(error);
  }
}
