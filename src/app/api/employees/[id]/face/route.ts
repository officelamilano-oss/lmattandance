import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertSameOrigin, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getActor, assertOutletAccess, hasPermission } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import type {
  EmployeeDocument,
  EmployeeFaceTemplateDocument,
} from "@/lib/models";
import {
  encryptFaceDescriptor,
  FACE_CONSENT_VERSION,
  getFaceEncryptionKey,
  isFaceDescriptor,
} from "@/lib/face-templates";

const enrollmentSchema = z.object({
  descriptor: z.custom<number[]>(isFaceDescriptor),
  consentConfirmed: z.literal(true),
});

async function getAuthorizedEmployee(id: string) {
  const actor = await getActor();
  if (!actor)
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  if (!hasPermission(actor, "employees.face.manage"))
    return {
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  if (!ObjectId.isValid(id))
    return {
      response: NextResponse.json(
        { error: "Invalid employee ID." },
        { status: 400 },
      ),
    };
  const db = await getDb();
  const employee = await db
    .collection<EmployeeDocument>("employees")
    .findOne({ _id: new ObjectId(id) });
  if (!employee) throw new Error("NOT_FOUND");
  if (!employee.active)
    return {
      response: NextResponse.json(
        { error: "Inactive employees cannot be enrolled for face attendance." },
        { status: 409 },
      ),
    };
  assertOutletAccess(actor, employee.outletId);
  return { actor, employee, db };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const access = await getAuthorizedEmployee(id);
    if (access.response) return access.response;
    const template = await access.db
      .collection<EmployeeFaceTemplateDocument>("employeeFaceTemplates")
      .findOne(
        { employeeId: access.employee._id },
        { projection: { consentAt: 1, consentVersion: 1 } },
      );
    return NextResponse.json({
      enrolled: !!template,
      consentAt: template?.consentAt.toISOString() ?? null,
      consentVersion: template?.consentVersion ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const access = await getAuthorizedEmployee(id);
    if (access.response) return access.response;
    if (!process.env.KIOSK_ENCRYPTION_KEY)
      return NextResponse.json(
        { error: "Face enrollment is unavailable until KIOSK_ENCRYPTION_KEY is configured." },
        { status: 503 },
      );
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384)
      return NextResponse.json(
        { error: "Face descriptor request is too large." },
        { status: 413 },
      );
    const input = enrollmentSchema.parse(
      await readJson<Record<string, unknown>>(request),
    );
    getFaceEncryptionKey();
    const now = new Date();
    const template: EmployeeFaceTemplateDocument = {
      _id: new ObjectId(),
      employeeId: access.employee._id,
      outletId: access.employee.outletId,
      encryptedDescriptor: encryptFaceDescriptor(input.descriptor),
      consentAt: now,
      consentBy: access.actor.id,
      consentVersion: FACE_CONSENT_VERSION,
      createdAt: now,
      updatedAt: now,
    };
    await access.db
      .collection<EmployeeFaceTemplateDocument>("employeeFaceTemplates")
      .updateOne(
        { employeeId: access.employee._id },
        {
          $set: {
            outletId: template.outletId,
            encryptedDescriptor: template.encryptedDescriptor,
            consentAt: template.consentAt,
            consentBy: template.consentBy,
            consentVersion: template.consentVersion,
            updatedAt: template.updatedAt,
          },
          $setOnInsert: {
            _id: template._id,
            employeeId: template.employeeId,
            createdAt: template.createdAt,
          },
        },
        { upsert: true },
      );
    await writeAudit({
      actorId: access.actor.id,
      actorEmail: access.actor.email,
      action: "EMPLOYEE_FACE_ENROLLED",
      entityType: "employee",
      entityId: id,
      outletId: access.employee.outletId,
      changes: {
        faceEnrollment: {
          before: "previous enrollment or none",
          after: now.toISOString(),
        },
      },
    });
    return NextResponse.json({ ok: true, consentAt: now.toISOString() });
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
    const { id } = await context.params;
    const access = await getAuthorizedEmployee(id);
    if (access.response) return access.response;
    const result = await access.db
      .collection<EmployeeFaceTemplateDocument>("employeeFaceTemplates")
      .deleteOne({ employeeId: access.employee._id });
    if (result.deletedCount)
      await writeAudit({
        actorId: access.actor.id,
        actorEmail: access.actor.email,
        action: "EMPLOYEE_FACE_DELETED",
        entityType: "employee",
        entityId: id,
        outletId: access.employee.outletId,
      });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
