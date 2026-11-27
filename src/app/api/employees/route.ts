import { ObjectId, type Filter } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb, getMongoClient } from "@/lib/mongodb";
import {
  employeeSchema,
  employeeShiftSchema,
  outletEmployeeRequiredDetailsSchema,
} from "@/lib/validation/business";
import { paginationSchema } from "@/lib/validation/common";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type {
  EmployeeDocument,
  OutletDocument,
  UniformDeductionDocument,
} from "@/lib/models";
import { z } from "zod";
import {
  EMPLOYEE_DESIGNATIONS,
  isDeliveryRiderDesignation,
  isEmployeeDesignationAllowed,
} from "@/lib/employee-designations";
import { EMPLOYEE_TERMS_VERSION } from "@/lib/employee-terms";
import {
  hasPastUniformMonth,
  normalizeUniformEntries,
  uniformEntriesSchema,
} from "@/lib/uniform-deductions";
import { getIndiaMonth } from "@/lib/payroll/dates";
import {
  getEmployeeCodePrefix,
  getNextEmployeeCode,
} from "@/lib/employee-code";

const employeeCreateSchema = employeeSchema.safeExtend({
  employeeCode: z
    .string()
    .regex(/^[A-Z]{3}\d{4}$/, "Employee code must be a 3-letter outlet prefix followed by 4 digits."),
});

export async function GET(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    const url = new URL(request.url);
    const wantsNextCode = url.searchParams.get("nextCode") === "true";
    if (
      (wantsNextCode &&
        actor.role !== "OUTLET_USER" &&
        !actor.permissions.includes("employees.create") &&
        !actor.permissions.includes("employees.update")) ||
      (!wantsNextCode &&
        !actor.permissions.includes("employees.read") &&
      !actor.permissions.includes("attendance.read") &&
        !actor.permissions.includes("advances.read") &&
        !actor.permissions.includes("uniforms.manage"))
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    if (wantsNextCode) {
      const outletId = url.searchParams.get("outletId");
      if (!outletId || !ObjectId.isValid(outletId))
        return NextResponse.json(
          { error: "Choose an outlet before generating an employee code." },
          { status: 400 },
        );
      assertOutletAccess(actor, outletId);
      const excludeEmployeeId = url.searchParams.get("employeeId");
      if (
        excludeEmployeeId &&
        (!ObjectId.isValid(excludeEmployeeId) ||
          !actor.permissions.includes("employees.update"))
      )
        return NextResponse.json(
          { error: "Invalid employee for code generation." },
          { status: 400 },
        );
      const db = await getDb();
      const excludedEmployee = excludeEmployeeId
        ? await db
            .collection<EmployeeDocument>("employees")
            .findOne({ _id: new ObjectId(excludeEmployeeId) })
        : null;
      if (excludeEmployeeId) {
        if (!excludedEmployee) throw new Error("NOT_FOUND");
        assertOutletAccess(actor, excludedEmployee.outletId);
      }
      const outlet = await db
        .collection<OutletDocument>("outlets")
        .findOne({ _id: new ObjectId(outletId), active: true });
      if (!outlet)
        return NextResponse.json(
          { error: "Outlet is inactive or unavailable." },
          { status: 400 },
        );
      const prefix = getEmployeeCodePrefix(outlet.name);
      if (prefix.length !== 3)
        return NextResponse.json(
          { error: "Outlet name must contain at least 3 letters to generate an employee code." },
          { status: 400 },
        );
      const employeeCode = await getNextEmployeeCode(
        db.collection<EmployeeDocument>("employees"),
        prefix,
        new ObjectId(outletId),
        excludedEmployee?._id,
      );
      if (!employeeCode)
        return NextResponse.json(
          { error: "No employee codes are available for this outlet." },
          { status: 409 },
        );
      return NextResponse.json({ employeeCode });
    }
    const page = paginationSchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const requested = url.searchParams.get("outletId");
    if (requested && !ObjectId.isValid(requested))
      return NextResponse.json(
        { error: "Invalid outlet ID." },
        { status: 400 },
      );
    if (
      actor.role !== "MAIN_ADMIN" &&
      url.searchParams.get("active") &&
      url.searchParams.get("active") !== "true"
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can view inactive employees." },
        { status: 403 },
      );
    const db = await getDb();
    const allowed =
      actor.role === "MAIN_ADMIN"
        ? requested
          ? [new ObjectId(requested)]
          : undefined
        : actor.outletIds;
    if (requested) assertOutletAccess(actor, requested);
    const activeFilter: Filter<EmployeeDocument> | null =
      actor.role === "OUTLET_USER"
        ? {
            $or: [
              { active: true },
              {
                approvalStatus: { $in: ["PENDING", "REJECTED"] },
                createdBy: actor.id,
              },
            ],
          }
        : url.searchParams.get("active") === "all"
          ? null
          : {
              active: url.searchParams.get("active") === "false" ? false : true,
            };
    const searchFilter: Filter<EmployeeDocument> | null = page.q
      ? {
          $or: [
            { fullName: { $regex: escapeRegex(page.q), $options: "i" } },
            { employeeCode: { $regex: escapeRegex(page.q), $options: "i" } },
            { mobile: { $regex: escapeRegex(page.q), $options: "i" } },
          ],
        }
      : null;
    const query: Filter<EmployeeDocument> = {
      ...(allowed ? { outletId: { $in: allowed } } : {}),
      ...([activeFilter, searchFilter].filter(
        (filter): filter is Filter<EmployeeDocument> => filter !== null,
      ).length
        ? {
            $and: [activeFilter, searchFilter].filter(
              (filter): filter is Filter<EmployeeDocument> =>
                filter !== null,
            ),
          }
        : {}),
    };
    const projection = {
      beneficiaryName: 0,
      bankName: 0,
      branchName: 0,
      accountNumber: 0,
      ifscCode: 0,
      panNumber: 0,
      aadhaarNumber: 0,
      drivingLicenceNumber: 0,
      acceptedAt: 0,
      acceptedBy: 0,
      ...(actor.role === "MAIN_ADMIN"
        ? {}
        : {
            monthlyBaseSalary: 0,
            salaryMethod: 0,
            pfEnabled: 0,
            employeePfPercent: 0,
            employerPfPercent: 0,
            esiEnabled: 0,
            esiPercent: 0,
          }),
      ...(actor.role === "OUTLET_USER" ? { mobile: 0 } : {}),
    };
    const employeeCollection =
      db.collection<EmployeeDocument>("employees");
    const [employees, total] = await Promise.all([
      actor.role === "MAIN_ADMIN" &&
      url.searchParams.get("active") === "all"
        ? employeeCollection
            .aggregate<EmployeeDocument>([
              { $match: query },
              {
                $addFields: {
                  pendingApprovalOrder: {
                    $cond: [
                      { $eq: ["$approvalStatus", "PENDING"] },
                      0,
                      1,
                    ],
                  },
                },
              },
              { $sort: { pendingApprovalOrder: 1, employeeCode: 1, _id: 1 } },
              { $unset: "pendingApprovalOrder" },
              { $project: projection },
              { $skip: (page.page - 1) * page.pageSize },
              { $limit: page.pageSize },
            ])
            .toArray()
        : employeeCollection
            .find(query, { projection })
            .sort({ employeeCode: 1, _id: 1 })
            .skip((page.page - 1) * page.pageSize)
            .limit(page.pageSize)
            .toArray(),
      employeeCollection.countDocuments(query),
    ]);
    const visibleEmployees = employees.map((employee) =>
      employeeResponse(
        employee,
        actor.role === "MAIN_ADMIN",
        actor.role !== "OUTLET_USER",
      ),
    
    
    );
    return NextResponse.json({
      employees: visibleEmployees,
      total,
      page: page.page,
      pageSize: page.pageSize,
    });
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
    if (
      !actor.permissions.includes("employees.create") &&
      actor.role !== "OUTLET_USER"
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const body = await readJson<unknown>(request);
    if (typeof body !== "object" || body === null || Array.isArray(body))
      return NextResponse.json(
        { error: "Employee details must be sent as an object." },
        { status: 400 },
      );
    const payload = body as Record<string, unknown>;
    const hasShiftFields =
      "shiftStartTime" in payload || "shiftEndTime" in payload;
    if (
      hasShiftFields &&
      !actor.permissions.includes("employees.shift.manage")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const shiftSchedule = hasShiftFields
      ? employeeShiftSchema.parse(payload)
      : undefined;
    let uniformEntries: ReturnType<typeof normalizeUniformEntries> = [];
    if ("uniformDeductions" in payload) {
      if (!actor.permissions.includes("uniforms.manage"))
        return NextResponse.json({ error: "Forbidden." }, { status: 403 });
      const currentMonth = getIndiaMonth();
      uniformEntries = normalizeUniformEntries(
        uniformEntriesSchema.parse(payload.uniformDeductions),
        currentMonth,
      );
      if (hasPastUniformMonth(uniformEntries, currentMonth))
        return NextResponse.json(
          { error: "Uniform deductions cannot be scheduled for a past month." },
          { status: 400 },
        );
    }
    if (payload.termsAccepted !== true)
      return NextResponse.json(
        { error: "Employee terms must be accepted before creating this record." },
        { status: 400 },
      );
    const isOutletUser = actor.role === "OUTLET_USER";
    const canManageCompensation = actor.role === "MAIN_ADMIN";
    const compensationFields = [
      "monthlyBaseSalary",
      "salaryMethod",
      "pfEnabled",
      "employeePfPercent",
      "employerPfPercent",
      "esiEnabled",
      "esiPercent",
    ];
    const restrictedOutletFields = [
      "dateOfBirth",
      ...compensationFields,
      "documents",
    ];
    if (isOutletUser && restrictedOutletFields.some((field) => field in payload))
      return NextResponse.json(
        { error: "Outlet users cannot submit restricted employee details." },
        { status: 403 },
      );
    if (
      !canManageCompensation &&
      compensationFields.some((field) => field in payload)
    )
      return NextResponse.json(
        { error: "Only MAIN_ADMIN can submit employee compensation details." },
        { status: 403 },
      );
    if (isOutletUser && actor.outletIds.length !== 1)
      return NextResponse.json(
        { error: "Your account must have exactly one assigned outlet." },
        { status: 403 },
      );
    const requestedOutletId = isOutletUser
      ? actor.outletIds[0].toHexString()
      : payload.outletId;
    if (
      typeof requestedOutletId !== "string" ||
      !ObjectId.isValid(requestedOutletId)
    )
      return NextResponse.json(
        { error: "Choose a valid outlet before creating an employee." },
        { status: 400 },
      );
    const outletId = new ObjectId(requestedOutletId);
    assertOutletAccess(actor, outletId);
    const db = await getDb();
    const outlet = await db.collection<OutletDocument>("outlets").findOne({
      _id: outletId,
      active: true,
    });
    if (!outlet)
      return NextResponse.json(
        { error: "Outlet is inactive or unavailable." },
        { status: 400 },
      );
    const prefix = getEmployeeCodePrefix(outlet.name);
    if (prefix.length !== 3)
      return NextResponse.json(
        { error: "Outlet name must contain at least 3 letters to generate an employee code." },
        { status: 400 },
      );
    const employeeCode =
      payload.autoGenerate === true ||
      payload.autoGenerate === "true" ||
      isOutletUser ||
      typeof payload.employeeCode !== "string" ||
      !payload.employeeCode.trim()
        ? await getNextEmployeeCode(
            db.collection<EmployeeDocument>("employees"),
            prefix,
            outletId,
          )
        : payload.employeeCode;
    if (!employeeCode)
      return NextResponse.json(
        { error: `No employee codes are available for ${prefix}.` },
        { status: 409 },
      );
    if (
      typeof employeeCode !== "string" ||
      !new RegExp(`^${prefix}\\d{4}$`).test(employeeCode.toUpperCase())
    )
      return NextResponse.json(
        {
          error: `Employee code must start with ${prefix} and end with 4 digits.`,
        },
        { status: 400 },
      );
    const designationKey =
      typeof payload.designationKey === "string"
        ? payload.designationKey
        : undefined;
    const designationDefinition = EMPLOYEE_DESIGNATIONS.find(
      (designation) => designation.key === designationKey,
    );
    if (!designationDefinition)
      return NextResponse.json(
        { error: "Choose a valid employee designation." },
        { status: 400 },
      );
    if (
      designationKey &&
      !isEmployeeDesignationAllowed(designationKey, outlet.code)
    )
      return NextResponse.json(
        { error: "Choose a designation that matches the selected outlet." },
        { status: 400 },
      );
    if (
      isOutletUser &&
      (!designationKey || designationDefinition?.group !== "OUTLET")
    )
      return NextResponse.json(
        { error: "Outlet users must select an outlet designation." },
        { status: 400 },
      );
    if (isOutletUser)
      outletEmployeeRequiredDetailsSchema.parse(payload);
    const normalizedPayload = normalizeSensitiveFields(payload);
    if (
      isDeliveryRiderDesignation({
        designationKey,
        designation:
          designationDefinition?.label ?? String(payload.designation ?? ""),
      }) &&
      !normalizedPayload.drivingLicenceNumber
    )
      return NextResponse.json(
        { error: "Driving licence number is required for Delivery Rider." },
        { status: 400 },
      );
    const input = employeeCreateSchema.parse({
      ...payload,
      ...normalizedPayload,
      ...(!canManageCompensation
        ? {
            monthlyBaseSalary: 0,
            salaryMethod: "FIXED_30_DAYS",
            pfEnabled: false,
            employeePfPercent: 0,
            employerPfPercent: 0,
            esiEnabled: false,
            esiPercent: 0.75,
          }
        : {}),
      ...(designationDefinition
        ? {
            designation: designationDefinition.label,
            designationKey: designationDefinition.key,
            designationGroup: designationDefinition.group,
          }
        : {}),
      employeeCode: employeeCode.toUpperCase(),
      outletId: outletId.toHexString(),
    });
    const now = new Date();
    const document: EmployeeDocument = {
      _id: new ObjectId(),
      ...input,
      ...(shiftSchedule ?? {}),
      termsAccepted: true,
      termsVersion: EMPLOYEE_TERMS_VERSION,
      acceptedAt: now,
      acceptedBy: actor.id,
      employeeCodeNormalized: input.employeeCode.trim().toUpperCase(),
      outletId,
      active: !isOutletUser,
      approvalStatus: isOutletUser ? "PENDING" : "APPROVED",
      ...(isOutletUser
        ? { approvalRequestedAt: now }
        : { approvedAt: now, approvedBy: actor.id }),
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    const uniformDocuments: UniformDeductionDocument[] = uniformEntries.map(
      (entry) => ({
        _id: new ObjectId(),
        employeeId: document._id,
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
      }),
    );
    try {
      if (uniformDocuments.length) {
        const session = (await getMongoClient()).startSession();
        try {
          await session.withTransaction(async () => {
            await db
              .collection<EmployeeDocument>("employees")
              .insertOne(document, { session });
            await db
              .collection<UniformDeductionDocument>("employee_uniform_deductions")
              .insertMany(uniformDocuments, { session });
          });
        } finally {
          await session.endSession();
        }
      } else {
        await db.collection<EmployeeDocument>("employees").insertOne(document);
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      )
        return NextResponse.json(
          { error: "This employee code is already in use. Generate another code." },
          { status: 409 },
        );
      throw error;
    }
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: isOutletUser ? "EMPLOYEE_REQUESTED" : "EMPLOYEE_CREATED",
      entityType: "employee",
      entityId: document._id.toHexString(),
      outletId,
    });
    await Promise.all(
      uniformDocuments.map((deduction) =>
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
    const employee = employeeResponse(
      document,
      actor.role === "MAIN_ADMIN",
      actor.role !== "OUTLET_USER",
    );
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSensitiveFields(payload: Record<string, unknown>) {
  const normalized = { ...payload };
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
    if (typeof normalized[field] === "string") {
      const clean = normalized[field].trim();
      normalized[field] = clean || null;
    }
  }
  for (const field of ["ifscCode", "panNumber"])
    if (typeof normalized[field] === "string")
      normalized[field] = normalized[field].toUpperCase();
  return normalized;
}

function employeeResponse(
  employee: EmployeeDocument,
  canViewCompensation: boolean,
  canViewContact: boolean,
) {
  const visible = {
    ...employee,
    employmentType: employee.employmentType ?? "FULL_TIME",
    salaryMethod: "FIXED_30_DAYS",
  } as Record<string, unknown>;
  for (const key of [
    "beneficiaryName",
    "bankName",
    "branchName",
    "accountNumber",
    "ifscCode",
    "panNumber",
    "aadhaarNumber",
    "drivingLicenceNumber",
    "acceptedAt",
    "acceptedBy",
  ])
    delete visible[key];
  if (!canViewCompensation)
    for (const key of [
    "monthlyBaseSalary",
    "salaryMethod",
    "pfEnabled",
    "employeePfPercent",
    "employerPfPercent",
    "esiEnabled",
    "esiPercent",
    ])
      delete visible[key];
  if (!canViewContact) delete visible.mobile;
  return visible;
}
