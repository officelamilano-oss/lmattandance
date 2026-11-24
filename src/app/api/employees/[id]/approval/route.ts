import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type { EmployeeDocument, EmployeeFileDocument } from "@/lib/models";
import { isDeliveryRiderDesignation } from "@/lib/employee-designations";
import { requiredEmployeeDocumentTypes } from "@/lib/employee-documents-config";

const employeeApprovalSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REJECT") }),
  z.object({
    action: z.literal("APPROVE"),
    monthlyBaseSalary: z.number().positive().max(100_000_000),
    salaryMethod: z.enum([
      "FIXED_30_DAYS",
      "CALENDAR_DAYS",
      "WORKING_DAYS_26",
    ]),
    pfEnabled: z.boolean(),
    employeePfPercent: z.number().min(0).max(100),
    employerPfPercent: z.number().min(0).max(100),
    esiEnabled: z.boolean(),
    esiPercent: z.number().min(0).max(100),
  }),
]);

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
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const input = employeeApprovalSchema.parse(
      await readJson<unknown>(request),
    );
    const db = await getDb();
    const employeeCollection =
      db.collection<EmployeeDocument>("employees");
    const employee = await employeeCollection.findOne({
      _id: new ObjectId(id),
      active: false,
      approvalStatus: "PENDING",
    });
    if (!employee)
      return NextResponse.json(
        { error: "This employee request is no longer pending." },
        { status: 409 },
      );
    assertOutletAccess(actor, employee.outletId);
    const updatedAt = new Date();

    if (input.action === "REJECT") {
      const result = await employeeCollection.updateOne(
        {
          _id: employee._id,
          active: false,
          approvalStatus: "PENDING",
        },
        {
          $set: {
            approvalStatus: "REJECTED",
            rejectedAt: updatedAt,
            rejectedBy: actor.id,
            updatedAt,
          },
        },
      );
      if (result.modifiedCount !== 1)
        return NextResponse.json(
          { error: "This employee request is no longer pending." },
          { status: 409 },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_REQUEST_REJECTED",
        entityType: "employee",
        entityId: employee._id.toHexString(),
        outletId: employee.outletId,
      });
      return NextResponse.json({ ok: true, approvalStatus: "REJECTED" });
    }

    const requiredDocuments = requiredEmployeeDocumentTypes(
      isDeliveryRiderDesignation(employee),
    );
    const documents = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .find({ employeeId: employee._id }, { projection: { documentType: 1 } })
      .toArray();
    const availableTypes = new Set(
      documents.map((document) => document.documentType),
    );
    const missingDocuments = requiredDocuments.filter(
      (documentType) => !availableTypes.has(documentType),
    );
    if (missingDocuments.length)
      return NextResponse.json(
        {
          error: `Upload the required documents before approval: ${missingDocuments.join(", ")}.`,
        },
        { status: 400 },
      );

    const result = await employeeCollection.updateOne(
      {
        _id: employee._id,
        active: false,
        approvalStatus: "PENDING",
      },
      {
        $set: {
          active: true,
          approvalStatus: "APPROVED",
          approvedAt: updatedAt,
          approvedBy: actor.id,
          monthlyBaseSalary: input.monthlyBaseSalary,
          salaryMethod: input.salaryMethod,
          pfEnabled: input.pfEnabled,
          employeePfPercent: input.employeePfPercent,
          employerPfPercent: input.employerPfPercent,
          esiEnabled: input.esiEnabled,
          esiPercent: input.esiPercent,
          updatedAt,
        },
        $unset: { rejectedAt: "", rejectedBy: "" },
      },
    );
    if (result.modifiedCount !== 1)
      return NextResponse.json(
        { error: "This employee request is no longer pending." },
        { status: 409 },
      );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_REQUEST_APPROVED",
      entityType: "employee",
      entityId: employee._id.toHexString(),
      outletId: employee.outletId,
      changes: {
        monthlyBaseSalary: {
          before: employee.monthlyBaseSalary,
          after: input.monthlyBaseSalary,
        },
      },
    });
    return NextResponse.json({ ok: true, approvalStatus: "APPROVED" });
  } catch (error) {
    return apiError(error);
  }
}
