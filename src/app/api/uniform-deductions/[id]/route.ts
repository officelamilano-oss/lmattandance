import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getIndiaMonth } from "@/lib/payroll/dates";
import { UNIFORM_ITEMS } from "@/lib/uniform-deductions";
import type { UniformDeductionDocument } from "@/lib/models";
import { monthSchema, objectIdSchema } from "@/lib/validation/common";
import { z } from "zod";

const updateSchema = z.object({
  item: z.enum(UNIFORM_ITEMS).optional(),
  amount: z.number().finite().nonnegative().max(10_000_000).optional(),
  deductionMonth: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    monthSchema.optional(),
  ).optional(),
  remark: z.string().trim().max(500).optional(),
  status: z.literal("CANCELLED").optional(),
}).strict();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("uniforms.manage"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    const validId = objectIdSchema.safeParse(id);
    if (!validId.success)
      return NextResponse.json({ error: "Invalid uniform deduction ID." }, { status: 400 });
    const input = updateSchema.parse(await readJson<unknown>(request));
    if (!Object.keys(input).length)
      return NextResponse.json({ error: "No uniform deduction changes were provided." }, { status: 400 });

    const db = await getDb();
    const collection = db.collection<UniformDeductionDocument>("employee_uniform_deductions");
    const deduction = await collection.findOne({ _id: new ObjectId(id) });
    if (!deduction) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, deduction.outletId);
    if (deduction.status !== "SCHEDULED")
      return NextResponse.json(
        { error: "Only scheduled uniform deductions can be edited or cancelled." },
        { status: 409 },
      );

    const set: Partial<UniformDeductionDocument> = {
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    if (input.item !== undefined) {
      set.item = input.item;
      changes.item = { before: deduction.item, after: input.item };
    }
    if (input.amount !== undefined) {
      set.amount = input.amount;
      changes.amount = { before: deduction.amount, after: input.amount };
    }
    if (input.remark !== undefined) {
      set.remark = input.remark;
      changes.remark = {
        before: deduction.remark ?? "",
        after: input.remark,
      };
    }
    if ("deductionMonth" in input) {
      const month = input.deductionMonth ?? getIndiaMonth();
      if (month < getIndiaMonth())
        return NextResponse.json(
          { error: "Uniform deductions cannot be rescheduled to a past month." },
          { status: 400 },
        );
      set.deductionMonth = month;
      changes.deductionMonth = { before: deduction.deductionMonth, after: month };
    }
    if (input.status === "CANCELLED") {
      set.status = "CANCELLED";
      changes.status = { before: deduction.status, after: "CANCELLED" };
    }
    const updated = await collection.updateOne(
      { _id: deduction._id, status: "SCHEDULED" },
      { $set: set },
    );
    if (!updated.matchedCount)
      return NextResponse.json(
        { error: "This uniform deduction was applied or changed; refresh and try again." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: input.status === "CANCELLED"
        ? "UNIFORM_DEDUCTION_CANCELLED"
        : "UNIFORM_DEDUCTION_UPDATED",
      entityType: "employee_uniform_deduction",
      entityId: id,
      outletId: deduction.outletId,
      changes,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("uniforms.manage"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    const validId = objectIdSchema.safeParse(id);
    if (!validId.success)
      return NextResponse.json({ error: "Invalid uniform deduction ID." }, { status: 400 });
    const collection = (await getDb()).collection<UniformDeductionDocument>("employee_uniform_deductions");
    const deduction = await collection.findOne({ _id: new ObjectId(id) });
    if (!deduction) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, deduction.outletId);
    if (deduction.status === "APPLIED")
      return NextResponse.json(
        { error: "Applied uniform deductions cannot be deleted." },
        { status: 409 },
      );
    const deleted = await collection.deleteOne({
      _id: deduction._id,
      status: { $ne: "APPLIED" },
    });
    if (!deleted.deletedCount)
      return NextResponse.json(
        { error: "Applied uniform deductions cannot be deleted." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "UNIFORM_DEDUCTION_DELETED",
      entityType: "employee_uniform_deduction",
      entityId: id,
      outletId: deduction.outletId,
      changes: {
        status: { before: deduction.status, after: "DELETED" },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
