import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getActor, assertOutletAccess, hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import type { EmployeeDocument } from "@/lib/models";
import { employeeShiftSchema } from "@/lib/validation/business";

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
    if (!hasPermission(actor, "employees.shift.manage"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const input = employeeShiftSchema.parse(
      await readJson<Record<string, unknown>>(request),
    );
    const db = await getDb();
    const employees = db.collection<EmployeeDocument>("employees");
    const employee = await employees.findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const updatedAt = new Date();
    const update = {
      $set: {
        updatedAt,
        ...(input.shiftStartTime && input.shiftEndTime
          ? {
              shiftStartTime: input.shiftStartTime,
              shiftEndTime: input.shiftEndTime,
            }
          : {}),
        ...(typeof input.shiftDurationHours === "number"
          ? { shiftDurationHours: input.shiftDurationHours }
          : {}),
      },
      $unset: {
        ...(!input.shiftStartTime || !input.shiftEndTime
          ? { shiftStartTime: true as const, shiftEndTime: true as const }
          : {}),
        ...(input.shiftDurationHours === null
          ? { shiftDurationHours: true as const }
          : {}),
      },
    };
    await employees.updateOne(
      { _id: employee._id },
      update,
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_SHIFT_UPDATED",
      entityType: "employee",
      entityId: id,
      entityLabel: `${employee.employeeCode} · ${employee.fullName}`,
      outletId: employee.outletId,
      changes: {
        shiftStartTime: {
          before: employee.shiftStartTime ?? null,
          after: input.shiftStartTime,
        },
        shiftEndTime: {
          before: employee.shiftEndTime ?? null,
          after: input.shiftEndTime ?? null,
        },
        shiftDurationHours: {
          before: employee.shiftDurationHours ?? null,
          after: input.shiftDurationHours ?? employee.shiftDurationHours ?? null,
        },
      },
    });
    return NextResponse.json({ ok: true, ...input });
  } catch (error) {
    return apiError(error);
  }
}
