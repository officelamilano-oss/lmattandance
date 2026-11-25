import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { AdvanceDocument } from "@/lib/models";
import { getDateInTimezone } from "@/lib/payroll/dates";

const bulkApprovalSchema = z.object({
  outletId: z.string().optional(),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("advances.approve"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const input = bulkApprovalSchema.parse(await readJson<unknown>(request));
    if (input.outletId && !ObjectId.isValid(input.outletId))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (input.outletId) assertOutletAccess(actor, input.outletId);
    const outletId = input.outletId
      ? new ObjectId(input.outletId)
      : undefined;
    const outletIds =
      actor.role === "MAIN_ADMIN"
        ? outletId
          ? [outletId]
          : undefined
        : outletId
          ? [outletId]
          : actor.outletIds;

    const db = await getDb();
    const settings = await db
      .collection<{ _id: string; timezone?: string }>("settings")
      .findOne({ _id: "payroll" });
    const now = new Date();
    const approvedDate = getDateInTimezone(
      now,
      settings?.timezone ||
        process.env.BUSINESS_TIMEZONE ||
        "Asia/Kolkata",
    );
    const result = await db
      .collection<AdvanceDocument>("advances")
      .updateMany(
        {
          ...(outletIds ? { outletId: { $in: outletIds } } : {}),
          status: "PENDING",
          payrollRecordId: { $exists: false },
        },
        {
          $set: {
            status: "APPROVED",
            approvedDate,
            updatedBy: actor.id,
            updatedAt: now,
          },
        },
      );

    if (result.modifiedCount > 0) {
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "ADVANCES_BULK_APPROVED",
        entityType: "advance",
        entityId: outletId?.toHexString() ?? "ALL_ACCESSIBLE_OUTLETS",
        ...(outletId ? { outletId } : {}),
        changes: {
          status: { before: "PENDING", after: "APPROVED" },
          count: { before: 0, after: result.modifiedCount },
        },
      });
    }

    return NextResponse.json({ approvedCount: result.modifiedCount });
  } catch (error) {
    return apiError(error);
  }
}
