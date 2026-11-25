import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, scopedOutletQuery } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { outletSchema } from "@/lib/validation/business";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { EmployeeDocument } from "@/lib/models";
import { getEmployeeCodePrefix } from "@/lib/employee-code";
import { updateOutletDocument } from "@/lib/outlet-mutations";
import type { OutletSettingsDocument } from "@/lib/outlet-settings";
import { z } from "zod";

const outletCreateSchema = z.object({
  outletNumber: z.number().int().min(1).max(99),
  name: z.string().trim().min(2).max(100),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default("Ahmedabad"),
  managerName: z.string().trim().max(120).default(""),
  contactPhone: z.string().trim().max(20).default(""),
  active: z.boolean().default(true),
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const outletReadPermissions = new Set([
      "dashboard.read",
      "employees.read",
      "attendance.read",
      "advances.read",
      "salary.read",
      "reports.export",
      "outlets.manage",
      "uniforms.manage",
    ]);
    if (
      !actor.permissions.some((permission) =>
        outletReadPermissions.has(permission),
      )
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const requestedId =
      new URL(request.url).searchParams.get("id") ?? undefined;
    if (requestedId && !ObjectId.isValid(requestedId))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    const db = await getDb();
    const outlets = await db
      .collection<OutletSettingsDocument>("outlets")
      .find(scopedOutletQuery(actor, requestedId))
      .sort({ sort_order: 1, code: 1 })
      .toArray();
    const orderedOutlets = outlets.map((outlet, index) => ({
      ...outlet,
      weekly_off_count:
        typeof outlet.weekly_off_count === "number" &&
        Number.isInteger(outlet.weekly_off_count) &&
        outlet.weekly_off_count >= 0 &&
        outlet.weekly_off_count <= 7
          ? outlet.weekly_off_count
          : 3,
      sort_order:
        typeof outlet.sort_order === "number" &&
        Number.isInteger(outlet.sort_order)
          ? outlet.sort_order
        : index,
    }));
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        orderedOutlets.map((outlet) => {
          const visibleOutlet = { ...outlet };
          delete visibleOutlet.draft_sort_order;
          return visibleOutlet;
        }),
      );
    const [users, employees] = await Promise.all([
      db
        .collection("users")
        .find(
          {
            active: true,
            outletIds: { $in: orderedOutlets.map((outlet) => outlet._id) },
          },
          {
            projection: {
              name: 1,
              emailNormalized: 1,
              role: 1,
              outletIds: 1,
            },
          },
        )
        .toArray(),
      db
        .collection<EmployeeDocument>("employees")
        .find(
          { outletId: { $in: orderedOutlets.map((outlet) => outlet._id) } },
          { projection: { employeeCode: 1, outletId: 1 } },
        )
        .toArray(),
    ]);
    const assigned = new Map(
      orderedOutlets.map((outlet) => [
        outlet._id.toHexString(),
        users
          .filter((user) =>
            user.outletIds?.some((id: ObjectId) => id.equals(outlet._id)),
          )
          .map((user) => ({
            name: user.name,
            email: user.emailNormalized,
            role: user.role,
          })),
      ]),
    );
    return NextResponse.json(
      orderedOutlets.map((outlet) => ({
        ...outlet,
        assignedUsers: assigned.get(outlet._id.toHexString()) ?? [],
        employeeCodeRenameCount: employees.filter((employee) => {
          if (!employee.outletId.equals(outlet._id)) return false;
          const prefix = getEmployeeCodePrefix(outlet.name);
          return new RegExp(`^${prefix}\\d{4}$`, "i").test(
            employee.employeeCode,
          );
        }).length,
      })),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlets." },
        { status: 403 },
      );

    const input = outletCreateSchema.parse(await readJson<unknown>(request));
    const db = await getDb();
    const outlets = db.collection<
      OutletSettingsDocument & { outletCode?: string; outlet_code?: string }
    >("outlets");
    const existing = await outlets
      .find(
        {},
        {
          projection: {
            code: 1,
            outletCode: 1,
            outlet_code: 1,
            sort_order: 1,
            draft_sort_order: 1,
          },
        },
      )
      .toArray();
    const usedCodes = new Set(
      existing.flatMap((outlet) =>
        [outlet.code, outlet.outletCode, outlet.outlet_code].filter(
          (code): code is string => typeof code === "string",
        ).map((code) => code.trim().toUpperCase()),
      ),
    );
    const code = `OUT${String(input.outletNumber).padStart(2, "0")}`;
    if (usedCodes.has(code))
      return NextResponse.json(
        {
          error: `${code} is already assigned to an outlet. Choose an unused outlet number.`,
        },
        { status: 409 },
      );

    const sortOrder =
      Math.max(
        -1,
        ...existing.map((outlet) =>
          typeof outlet.sort_order === "number" &&
          Number.isInteger(outlet.sort_order)
            ? outlet.sort_order
            : -1,
        ),
      ) + 1;
    const draftSortOrder = existing.some((outlet) =>
      Number.isInteger(outlet.draft_sort_order),
    )
      ? Math.max(
          -1,
          ...existing.map((outlet) =>
            typeof outlet.draft_sort_order === "number" &&
            Number.isInteger(outlet.draft_sort_order)
              ? outlet.draft_sort_order
              : -1,
          ),
        ) + 1
      : undefined;
    const outlet = {
      _id: new ObjectId(),
      ...outletSchema.parse({
        ...input,
        code,
      }),
      sort_order: sortOrder,
      ...(draftSortOrder === undefined
        ? {}
        : { draft_sort_order: draftSortOrder }),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await outlets.insertOne(outlet);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "OUTLET_CREATED",
      entityType: "outlet",
      entityId: outlet._id.toHexString(),
      changes: {
        code: { before: null, after: outlet.code },
        name: { before: null, after: outlet.name },
        city: { before: null, after: outlet.city },
      },
    });
    return NextResponse.json({ outlet }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role !== "MAIN_ADMIN")
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can manage outlets." },
        { status: 403 },
      );
    const db = await getDb();
    const body = await readJson<unknown>(request);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return NextResponse.json(
        { error: "Outlet details must be sent as an object." },
        { status: 400 },
      );
    const payload = body as Record<string, unknown>;
    const outletId = payload.outletId ?? payload._id;
    const outletCollection = db.collection<
      OutletSettingsDocument & { outletCode?: string; outlet_code?: string }
    >("outlets");
    const outlet =
      typeof outletId === "string" && ObjectId.isValid(outletId)
        ? await outletCollection.findOne(
            { _id: new ObjectId(outletId) },
            { projection: { _id: 1 } },
          )
        : typeof payload.code === "string"
          ? await outletCollection.findOne(
              { code: payload.code },
              { projection: { _id: 1 } },
            )
          : null;
    if (!outlet) throw new Error("NOT_FOUND");
    const result = await updateOutletDocument(outlet._id, payload, actor);
    if (result.confirmationRequiredCount !== undefined)
      return NextResponse.json(
        {
          error: `Confirm the update of ${result.confirmationRequiredCount} employee codes before renaming this outlet.`,
          employeeCodeUpdateCount: result.confirmationRequiredCount,
        },
        { status: 409 },
      );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
