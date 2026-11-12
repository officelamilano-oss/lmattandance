import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type {
  EmployeeDocument,
  EmployeeFileDocument,
  OutletDocument,
} from "@/lib/models";
import { employeeSchema } from "@/lib/validation/business";
import { employeeDocumentStorage } from "@/lib/employee-document-storage";
import {
  getEmployeeCodePrefix,
} from "@/lib/employee-code";
import {
  EMPLOYEE_DESIGNATIONS,
  isDeliveryRiderDesignation,
  isEmployeeDesignationAllowed,
} from "@/lib/employee-designations";

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
    if (!actor.permissions.includes("employees.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const employee = await (
      await getDb()
    )
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const visible = {
      ...employee,
      employmentType: employee.employmentType ?? "FULL_TIME",
      salaryMethod: "FIXED_30_DAYS",
    } as Record<string, unknown>;
    if (actor.role !== "MAIN_ADMIN")
      for (const field of [
        "monthlyBaseSalary",
        "salaryMethod",
        "pfEnabled",
        "employeePfPercent",
        "employerPfPercent",
        "esiEnabled",
        "esiPercent",
      ])
        delete visible[field];
    if (actor.role === "OUTLET_USER") delete visible.mobile;
    if (actor.role === "OUTLET_USER")
      for (const field of [
        "dateOfBirth",
        "gender",
        "beneficiaryName",
        "bankName",
        "branchName",
        "accountNumber",
        "ifscCode",
        "panNumber",
        "aadhaarNumber",
        "drivingLicenceNumber",
      ])
        delete visible[field];
    delete visible.acceptedAt;
    delete visible.acceptedBy;
    visible.licencePending =
      isDeliveryRiderDesignation(employee) && !employee.drivingLicenceNumber;
    return NextResponse.json({ employee: visible });
  } catch (error) {
    return apiError(error);
  }
}

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
    if (
      actor.role !== "MAIN_ADMIN" ||
      !actor.permissions.includes("employees.deactivate")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const documents = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .find({ employeeId: employee._id })
      .toArray();
    for (const document of documents)
      await employeeDocumentStorage.deleteFile(document.storageKey);
    await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .deleteMany({ employeeId: employee._id });
    const deletion = await db
      .collection<EmployeeDocument>("employees")
      .deleteOne({ _id: employee._id });
    if (deletion.deletedCount !== 1) throw new Error("NOT_FOUND");
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_DELETED",
      entityType: "employee",
      entityId: id,
      outletId: employee.outletId,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

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
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      );
    const db = await getDb();
    const current = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!current) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, current.outletId);
    const raw = await readJson<Record<string, unknown>>(request);
    if (typeof raw.active === "boolean") {
      if (
        actor.role !== "MAIN_ADMIN" ||
        !actor.permissions.includes("employees.deactivate")
      )
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can change employee active status." },
          { status: 403 },
        );
      if (Object.keys(raw).length !== 1)
        return NextResponse.json(
          { error: "Active status must be changed separately from employee details." },
          { status: 400 },
        );
      if (raw.active === current.active)
        return NextResponse.json({ ok: true });
      if (raw.active) {
        await db.collection<EmployeeDocument>("employees").updateOne(
          { _id: current._id },
          {
            $set: { active: true, updatedAt: new Date() },
            $unset: { deactivatedAt: "" },
          },
        );
        await writeAudit({
          actorId: actor.id,
          actorEmail: actor.email,
          action: "EMPLOYEE_ACTIVATED",
          entityType: "employee",
          entityId: id,
          outletId: current.outletId,
        });
        return NextResponse.json({ ok: true });
      }
      const settings = await db
        .collection<{ _id: string; timezone?: string }>("settings")
        .findOne({ _id: "payroll" });
      const deactivatedAt = new Intl.DateTimeFormat("en-CA", {
        timeZone:
          settings?.timezone || process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
      }).format(new Date());
      await db
        .collection<EmployeeDocument>("employees")
        .updateOne(
          { _id: current._id },
          { $set: { active: false, deactivatedAt, updatedAt: new Date() } },
        );
      await writeAudit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: "EMPLOYEE_DEACTIVATED",
        entityType: "employee",
        entityId: id,
        outletId: current.outletId,
      });
      return NextResponse.json({ ok: true });
    }
    if (!actor.permissions.includes("employees.update"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (
      ["termsAccepted", "termsVersion", "acceptedAt", "acceptedBy"].some(
        (field) => field in raw,
      )
    )
      return NextResponse.json(
        { error: "Employee terms acceptance cannot be changed after creation." },
        { status: 400 },
      );
    if (
      actor.role !== "MAIN_ADMIN" &&
      [
        "monthlyBaseSalary",
        "salaryMethod",
        "pfEnabled",
        "employeePfPercent",
        "employerPfPercent",
        "esiEnabled",
        "esiPercent",
      ].some(
        (field) =>
          field in raw &&
          raw[field] !== current[field as keyof EmployeeDocument],
      )
    ) {
      return NextResponse.json(
        {
          error: "Only MAIN_ADMIN can change employee salary and PF settings.",
        },
        { status: 403 },
      );
    }
    const sensitiveFields = [
      "dateOfBirth",
      "gender",
      "beneficiaryName",
      "bankName",
      "branchName",
      "accountNumber",
      "ifscCode",
      "panNumber",
      "aadhaarNumber",
      "drivingLicenceNumber",
    ];
    if (
      actor.role === "OUTLET_USER" &&
      sensitiveFields.some((field) => field in raw)
    )
      return NextResponse.json(
        { error: "Outlet users cannot read or change restricted employee details." },
        { status: 403 },
      );
    for (const field of [
      "beneficiaryName",
      "bankName",
      "branchName",
      "accountNumber",
      "ifscCode",
      "panNumber",
      "aadhaarNumber",
      "drivingLicenceNumber",
    ]) {
      if (typeof raw[field] === "string") {
        const clean = raw[field].trim();
        raw[field] = clean || null;
      }
    }
    for (const field of ["ifscCode", "panNumber"])
      if (typeof raw[field] === "string")
        raw[field] = raw[field].toUpperCase();
    const input = employeeSchema.parse({
      ...current,
      outletId: current.outletId.toHexString(),
      ...raw,
    });
    if (input.outletId !== current.outletId.toHexString()) {
      if (actor.role !== "MAIN_ADMIN")
        return NextResponse.json(
          { error: "Only MAIN_ADMIN can reassign employees." },
          { status: 403 },
        );
      assertOutletAccess(actor, input.outletId);
    }
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: new ObjectId(input.outletId) });
    if (!outlet) throw new Error("NOT_FOUND");
    if (
      input.designationKey &&
      !isEmployeeDesignationAllowed(input.designationKey, outlet.code)
    )
      return NextResponse.json(
        { error: "Choose a designation that matches the selected outlet." },
        { status: 400 },
      );
    const designationDefinition = EMPLOYEE_DESIGNATIONS.find(
      (item) => item.key === input.designationKey,
    );
    if (
      actor.role !== "OUTLET_USER" &&
      isDeliveryRiderDesignation(input) &&
      !input.drivingLicenceNumber
    )
      return NextResponse.json(
        { error: "Driving licence number is required for Delivery Rider." },
        { status: 400 },
      );
    const prefix = getEmployeeCodePrefix(outlet.name);
    if (
      prefix.length !== 3 ||
      !new RegExp(`^${prefix}\\d{4}$`).test(input.employeeCode.toUpperCase())
    )
      return NextResponse.json(
        {
          error: `Employee code must start with ${prefix} and end with 4 digits.`,
        },
        { status: 400 },
      );
    const duplicateCode = await db
      .collection<EmployeeDocument>("employees")
      .findOne({
        employeeCodeNormalized: input.employeeCode.toUpperCase(),
        _id: { $ne: current._id },
      });
    if (duplicateCode)
      return NextResponse.json(
        { error: "This employee code is already in use. Generate another code." },
        { status: 409 },
      );
    await db
      .collection<EmployeeDocument>("employees")
      .updateOne(
        { _id: current._id },
        {
          $set: {
            ...input,
            ...(designationDefinition
              ? {
                  designation: designationDefinition.label,
                  designationGroup: designationDefinition.group,
                }
              : {}),
            employeeCodeNormalized: input.employeeCode.toUpperCase(),
            outletId: new ObjectId(input.outletId),
            updatedAt: new Date(),
          },
        },
      );
    const changes = Object.fromEntries(
      Object.entries({
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        designation: input.designation,
        employmentType: input.employmentType,
        mobile: input.mobile,
        outletId: input.outletId,
        monthlyBaseSalary: input.monthlyBaseSalary,
        salaryMethod: input.salaryMethod,
        pfEnabled: input.pfEnabled,
        employeePfPercent: input.employeePfPercent,
        employerPfPercent: input.employerPfPercent,
        esiEnabled: input.esiEnabled,
        esiPercent: input.esiPercent,
      })
        .filter(
          ([key, after]) =>
            current[key as keyof EmployeeDocument]?.toString() !==
            after?.toString(),
        )
        .map(([key, after]) => [
          key,
          {
            before: String(current[key as keyof EmployeeDocument] ?? ""),
            after: String(after ?? ""),
          },
        ]),
    );
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_UPDATED",
      entityType: "employee",
      entityId: id,
      outletId: current.outletId,
      changes,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
