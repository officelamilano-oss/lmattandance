import { ObjectId, type Filter } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getIndiaMonth } from "@/lib/payroll/dates";
import {
  normalizeUniformEntries,
  hasPastUniformMonth,
  UNIFORM_ITEMS,
  UNIFORM_ITEM_LABELS,
  uniformEntriesSchema,
} from "@/lib/uniform-deductions";
import { monthSchema, objectIdSchema, paginationSchema } from "@/lib/validation/common";
import type {
  EmployeeDocument,
  OutletDocument,
  UniformDeductionDocument,
  UniformItemDocument,
} from "@/lib/models";
import { z } from "zod";

const createSchema = z.object({
  outletId: objectIdSchema,
  employeeId: objectIdSchema,
  entries: uniformEntriesSchema,
});

const statusSchema = z.enum(["SCHEDULED", "APPLIED", "CANCELLED"]);

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("uniforms.manage"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });

    const url = new URL(request.url);
    const pagination = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    const outletValue = url.searchParams.get("outletId") || undefined;
    const employeeValue = url.searchParams.get("employeeId") || undefined;
    const itemValue = url.searchParams.get("item") || undefined;
    const monthValue = url.searchParams.get("month") || undefined;
    const statusValue = url.searchParams.get("status") || undefined;
    const outletId = outletValue ? objectIdSchema.parse(outletValue) : undefined;
    const employeeId = employeeValue ? objectIdSchema.parse(employeeValue) : undefined;
    const item = itemValue
      ? z.enum(UNIFORM_ITEMS).parse(itemValue)
      : undefined;
    const month = monthValue ? monthSchema.parse(monthValue) : undefined;
    const status = statusValue === "ALL"
      ? undefined
      : statusValue
        ? statusSchema.parse(statusValue)
        : undefined;
    if (outletId) assertOutletAccess(actor, outletId);

    const now = new Date();
    const itemsCollection = (await getDb()).collection<UniformItemDocument>("uniform_items");
    await Promise.all(
      UNIFORM_ITEMS.map((key) =>
        itemsCollection.updateOne(
          { _id: key },
          {
            $setOnInsert: {
              label: UNIFORM_ITEM_LABELS[key],
              defaultAmount: null,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        ),
      ),
    );

    const db = await getDb();
    const allowedOutletIds =
      actor.role === "MAIN_ADMIN"
        ? outletId
          ? [new ObjectId(outletId)]
          : undefined
        : outletId
          ? [new ObjectId(outletId)]
          : actor.outletIds;
    const filter: Filter<UniformDeductionDocument> = {
      ...(allowedOutletIds ? { outletId: { $in: allowedOutletIds } } : {}),
      ...(employeeId ? { employeeId: new ObjectId(employeeId) } : {}),
      ...(item ? { item } : {}),
      ...(month ? { deductionMonth: month } : {}),
      ...(status ? { status } : {}),
    };
    const [deductions, total, outlets, items] = await Promise.all([
      db
        .collection<UniformDeductionDocument>("employee_uniform_deductions")
        .find(filter)
        .sort({ deductionMonth: -1, createdAt: -1, _id: -1 })
        .skip((pagination.page - 1) * pagination.pageSize)
        .limit(pagination.pageSize)
        .toArray(),
      db.collection<UniformDeductionDocument>("employee_uniform_deductions").countDocuments(filter),
      db.collection<OutletDocument>("outlets")
        .find(allowedOutletIds ? { _id: { $in: allowedOutletIds } } : {})
        .toArray(),
      itemsCollection.find({}).sort({ _id: 1 }).toArray(),
    ]);
    const employeeIds = [...new Map(
      deductions.map((deduction) => [deduction.employeeId.toHexString(), deduction.employeeId]),
    ).values()];
    const employees = employeeIds.length
      ? await db.collection<EmployeeDocument>("employees")
          .find({ _id: { $in: employeeIds } })
          .toArray()
      : [];
    const employeeById = new Map(
      employees.map((employee) => [employee._id.toHexString(), employee]),
    );
    const outletById = new Map(
      outlets.map((outlet) => [outlet._id.toHexString(), outlet]),
    );

    return NextResponse.json({
      deductions: deductions.map((deduction) => {
        const employee = employeeById.get(deduction.employeeId.toHexString());
        const outlet = outletById.get(deduction.outletId.toHexString());
        return {
          ...deduction,
          employeeName: employee?.fullName ?? "Employee",
          employeeCode: employee?.employeeCode ?? "",
          mobile: employee?.mobile ?? "",
          outletCode: outlet?.code ?? "",
        };
      }),
      items,
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (!actor.permissions.includes("uniforms.manage"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const input = createSchema.parse(await readJson<unknown>(request));
    assertOutletAccess(actor, input.outletId);
    const db = await getDb();
    const outletId = new ObjectId(input.outletId);
    const employeeId = new ObjectId(input.employeeId);
    const employee = await db.collection<EmployeeDocument>("employees").findOne({
      _id: employeeId,
      outletId,
      active: true,
    });
    if (!employee)
      return NextResponse.json(
        { error: "Select an active employee from the chosen outlet." },
        { status: 400 },
      );

    const currentMonth = getIndiaMonth();
    const entries = normalizeUniformEntries(input.entries, currentMonth);
    if (hasPastUniformMonth(entries, currentMonth))
      return NextResponse.json(
        { error: "Uniform deductions cannot be scheduled for a past month." },
        { status: 400 },
      );
    const now = new Date();
    const deductions: UniformDeductionDocument[] = entries.map((entry) => ({
      _id: new ObjectId(),
      employeeId,
      outletId,
      item: entry.item,
      amount: entry.amount,
      deductionMonth: entry.deductionMonth,
      status: "SCHEDULED",
      ...(entry.remark ? { remark: entry.remark } : {}),
      createdBy: actor.id,
      updatedBy: actor.id,
      createdAt: now,
      updatedAt: now,
    }));
    if (deductions.length)
      await db
        .collection<UniformDeductionDocument>("employee_uniform_deductions")
        .insertMany(deductions);
    await Promise.all(
      deductions.map((deduction) =>
        writeAudit({
          actorId: actor.id,
          actorEmail: actor.email,
          action: "UNIFORM_DEDUCTION_CREATED",
          entityType: "employee_uniform_deduction",
          entityId: deduction._id.toHexString(),
          outletId,
          changes: {
            item: { before: "", after: deduction.item },
            amount: { before: 0, after: deduction.amount },
            deductionMonth: { before: "", after: deduction.deductionMonth },
          },
        }),
      ),
    );
    return NextResponse.json({ deductions }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
