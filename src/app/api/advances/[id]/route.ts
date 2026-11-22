import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { advanceSchema } from "@/lib/validation/business";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AdvanceDocument, EmployeeDocument } from "@/lib/models";
import { getDateInTimezone } from "@/lib/payroll/dates";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("advances.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid advance ID." },
        { status: 400 },
      );
    const advances = (await getDb()).collection<AdvanceDocument>("advances");
    const current = await advances.findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    if (current.payrollRecordId)
      return NextResponse.json(
        { error: "An advance assigned to payroll cannot be deleted." },
        { status: 409 },
      );
    const deletion = await advances.deleteOne({
      _id: current._id,
      payrollRecordId: { $exists: false },
    });
    if (!deletion.deletedCount)
      return NextResponse.json(
        { error: "This advance was assigned to payroll and cannot be deleted." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "ADVANCE_DELETED",
      entityType: "advance",
      entityId: id,
      outletId: current.outletId,
      changes: {
        date: { before: current.date, after: null },
        amount: { before: current.amount, after: null },
        status: { before: current.status, after: "DELETED" },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("advances.write") && !actor.permissions.includes("advances.approve")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: "Invalid advance ID." }, { status: 400 });
    const db = await getDb();
    const current = await db.collection<AdvanceDocument>("advances").findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    const raw = await readJson<Record<string, unknown>>(request);
    if (
      raw.action === "APPROVE" ||
      raw.action === "REJECT" ||
      raw.action === "RESTORE" ||
      raw.action === "RESTORE_AND_APPROVE"
    ) {
      if (!actor.permissions.includes("advances.approve"))
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      const transitions = {
        APPROVE: {
          from: "PENDING",
          to: "APPROVED",
          auditAction: "ADVANCE_APPROVED",
        },
        REJECT: {
          from: ["PENDING", "APPROVED"],
          to: "REJECTED",
          auditAction: "ADVANCE_REJECTED",
        },
        RESTORE: {
          from: "REJECTED",
          to: "PENDING",
          auditAction: "ADVANCE_RESTORED",
        },
        RESTORE_AND_APPROVE: {
          from: "REJECTED",
          to: "APPROVED",
          auditAction: "ADVANCE_RESTORED_AND_APPROVED",
        },
      } as const;
      const transition = transitions[raw.action];
      const now = new Date();
      let approvedDate: string | undefined;
      if (transition.to === "APPROVED") {
        const settings = await db
          .collection<{ _id: string; timezone?: string }>("settings")
          .findOne({ _id: "payroll" });
        approvedDate = getDateInTimezone(
          now,
          settings?.timezone ||
            process.env.BUSINESS_TIMEZONE ||
            "Asia/Kolkata",
        );
      }
      const result = await db.collection<AdvanceDocument>("advances").updateOne(
        {
          _id: current._id,
          status: Array.isArray(transition.from)
            ? { $in: transition.from }
            : transition.from,
          payrollRecordId: { $exists: false },
        },
        {
          $set: {
            status: transition.to,
            updatedBy: actor.id,
            updatedAt: now,
            ...(approvedDate ? { approvedDate } : {}),
          },
          ...(approvedDate ? {} : { $unset: { approvedDate: "" } }),
        },
      );
      if (!result.modifiedCount)
        return NextResponse.json(
          { error: "This advance is no longer in a status that allows this action, or it has already been included in payroll." },
          { status: 409 },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: transition.auditAction,
        entityType: "advance",
        entityId: id,
        outletId: current.outletId,
        changes: {
          status: { before: current.status, after: transition.to },
        },
      });
      return NextResponse.json({ ok: true });
    }
    if (!actor.permissions.includes("advances.write")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (current.payrollRecordId) return NextResponse.json({ error: "This advance is already assigned to payroll and cannot be edited." }, { status: 409 });
    if (current.status === "APPROVED" && actor.role !== "MAIN_ADMIN") return NextResponse.json({ error: "Only MAIN_ADMIN can change an approved advance." }, { status: 403 });
    const isOutletUser = actor.role === "OUTLET_USER";
    if (isOutletUser && (current.editCount ?? 0) >= 2)
      return NextResponse.json(
        { error: "Outlet users can edit an advance no more than twice." },
        { status: 409 },
      );
    const input = advanceSchema.parse(raw);
    const employeeId = new ObjectId(input.employeeId);
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    const employee = await db.collection<EmployeeDocument>("employees").findOne({ _id: employeeId, outletId });
    if (!employee) return NextResponse.json({ error: "Employee does not belong to this outlet." }, { status: 400 });
    const nextStatus = current.status === "APPROVED" ? "PENDING" : current.status;
    const now = new Date();
    const editLimitQuery = isOutletUser
      ? {
          $or: [
            { editCount: { $lt: 2 } },
            { editCount: { $exists: false } },
          ],
        }
      : {};
    const result = await db.collection<AdvanceDocument>("advances").updateOne(
      {
        _id: current._id,
        payrollRecordId: { $exists: false },
        ...editLimitQuery,
      },
      {
        $set: { ...input, employeeId, outletId, status: nextStatus, updatedBy: actor.id, updatedAt: now },
        $unset: { approvedDate: "" },
        ...(isOutletUser ? { $inc: { editCount: 1 } } : {}),
      },
    );
    if (!result.modifiedCount) return NextResponse.json({ error: "Advance was changed concurrently or claimed by payroll." }, { status: 409 });
    await writeAudit({ actorId: actor.id, actorEmail: actor.email, action: "ADVANCE_UPDATED", entityType: "advance", entityId: id, outletId, changes: { amount: { before: current.amount, after: input.amount }, status: { before: current.status, after: nextStatus } } });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}