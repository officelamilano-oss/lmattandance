import { ObjectId } from "mongodb";
import { connection, NextResponse } from "next/server";
import { getActor } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import type { AuditLogDocument, EmployeeDocument } from "@/lib/models";

export async function GET(request: Request) {
  try {
    await connection();
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (!actor.permissions.includes("audit.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const url = new URL(request.url);
    const page = Math.min(
      1000,
      Math.max(0, Number(url.searchParams.get("page") || 0)),
    );
    const outletId = url.searchParams.get("outletId");
    if (outletId && !ObjectId.isValid(outletId))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (
      outletId &&
      actor.role !== "MAIN_ADMIN" &&
      !actor.outletIds.some((id) => id.toHexString() === outletId)
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const outletIds = actor.role === "MAIN_ADMIN" ? undefined : actor.outletIds;
    const query = {
      ...(outletId
        ? { outletId: new ObjectId(outletId) }
        : outletIds
          ? {
              $or: [
                { outletId: { $in: outletIds } },
                { outletId: { $exists: false } },
              ],
            }
          : {}),
    };
    const db = await getDb();
    const logs = await db
      .collection<AuditLogDocument>("auditLogs")
      .find(query)
      .sort({ at: -1 })
      .skip(page * 50)
      .limit(50)
      .toArray();
    const employeeIds = logs
      .filter(
        (log) =>
          log.entityType === "employee" &&
          !log.entityLabel &&
          ObjectId.isValid(log.entityId),
      )
      .map((log) => new ObjectId(log.entityId));
    const employees = employeeIds.length
      ? await db
          .collection<EmployeeDocument>("employees")
          .find(
            {
              _id: { $in: employeeIds },
              ...(actor.role === "MAIN_ADMIN"
                ? {}
                : { outletId: { $in: actor.outletIds } }),
            },
            { projection: { employeeCode: 1, fullName: 1 } },
          )
          .toArray()
      : [];
    const employeeLabels = new Map(
      employees.map((employee) => [
        employee._id.toHexString(),
        `${employee.employeeCode} · ${employee.fullName}`,
      ]),
    );
    return NextResponse.json({
      logs: logs.map((log) => ({
        ...log,
        entityLabel:
          log.entityLabel ?? employeeLabels.get(log.entityId),
      })),
      page,
      hasMore: logs.length === 50,
    });
  } catch (error) {
    return apiError(error);
  }
}
