import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getDb } from "@/lib/mongodb";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import type { FaceAttendanceLogDocument } from "@/lib/models";

const editClockOutSchema = z.object({
  clockOut: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(2).max(500),
});

export async function PATCH(
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
    if (
      actor.role !== "MAIN_ADMIN" &&
      !(
        actor.role === "CO_ADMIN" &&
        actor.permissions.includes("employees.update")
      )
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid face attendance log ID." },
        { status: 400 },
      );
    const input = editClockOutSchema.parse(await request.json());
    const clockOut = new Date(input.clockOut);
    const now = new Date();
    if (clockOut > now)
      return NextResponse.json(
        { error: "Clock-out cannot be in the future." },
        { status: 400 },
      );
    const db = await getDb();
    const collection = db.collection<FaceAttendanceLogDocument>(
      "face_attendance_logs",
    );
    const current = await collection.findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    if (!current.clockIn)
      return NextResponse.json(
        { error: "A clock-out cannot be set until a clock-in exists." },
        { status: 409 },
      );
    if (clockOut < current.clockIn)
      return NextResponse.json(
        { error: "Clock-out must be at or after clock-in." },
        { status: 400 },
      );

    const result = await collection.updateOne(
      { _id: current._id },
      {
        $set: {
          clockOut,
          isOpen: false,
          missingClockOut: false,
          editedBy: actor.id,
          editedAt: now,
          notes: input.reason,
          updatedAt: now,
        },
      },
    );
    if (result.modifiedCount !== 1)
      throw new Error("Face attendance log could not be updated.");
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "FACE_ATTENDANCE_CLOCK_OUT_EDITED",
      entityType: "faceAttendanceLog",
      entityId: id,
      entityLabel: `${current.employeeCode} · ${current.employeeName}`,
      outletId: current.outletId,
      reason: input.reason,
      changes: {
        clockOut: {
          before: current.clockOut instanceof Date
            ? current.clockOut.toISOString()
            : current.missingClockOut
              ? "Missing clock out"
              : "",
          after: clockOut.toISOString(),
        },
      },
    });
    return NextResponse.json({
      ok: true,
      editedBy: actor.email,
      editedAt: now.toISOString(),
      clockOut: clockOut.toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
