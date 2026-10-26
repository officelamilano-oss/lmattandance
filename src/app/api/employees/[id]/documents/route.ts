import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, assertSameOrigin } from "@/lib/http";
import type { EmployeeDocument, EmployeeFileDocument } from "@/lib/models";
import {
  EMPLOYEE_DOCUMENT_MAX_BYTES,
  EMPLOYEE_DOCUMENT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_TYPES,
} from "@/lib/employee-documents-config";
import { employeeDocumentStorage } from "@/lib/employee-document-storage";

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
    if (
      actor.role === "OUTLET_USER" ||
      !actor.permissions.includes("employees.read")
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid employee ID." }, { status: 400 });
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const documents = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .find({ employeeId: employee._id })
      .sort({ uploadedAt: -1 })
      .toArray();
    return NextResponse.json({
      documents: documents.map((document) => ({
        id: document._id.toHexString(),
        documentType: document.documentType,
        mimeType: document.mimeType,
        size: document.size,
        uploadedAt: document.uploadedAt,
        url: employeeDocumentStorage.getFileUrl(document._id.toHexString()),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const createdKeys: string[] = [];
  const createdDocumentIds: ObjectId[] = [];
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role === "OUTLET_USER" || !actor.permissions.includes("employees.update"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    if (!ObjectId.isValid(id))
      return NextResponse.json({ error: "Invalid employee ID." }, { status: 400 });
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);

    const form = await request.formData();
    const files = form.getAll("files");
    const types = form.getAll("documentTypes");
    if (!files.length || files.some((file) => !(file instanceof File)))
      return NextResponse.json(
        { error: "Select at least one valid document." },
        { status: 400 },
      );
    if (files.length !== types.length)
      return NextResponse.json(
        { error: "Choose a document type for every file." },
        { status: 400 },
      );
    const uploadPlans: Array<{
      bytes: Uint8Array;
      documentType: EmployeeFileDocument["documentType"];
      extension: string;
      mimeType: string;
    }> = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index] as File;
      const documentType = types[index];
      if (
        typeof documentType !== "string" ||
        !EMPLOYEE_DOCUMENT_TYPES.some((item) => item === documentType)
      )
        return NextResponse.json(
          { error: "Choose a valid document type." },
          { status: 400 },
        );
      if (file.size <= 0 || file.size > EMPLOYEE_DOCUMENT_MAX_BYTES)
        return NextResponse.json(
          { error: "Each document must be between 1 byte and 5 MB." },
          { status: 400 },
        );
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const expectedMime =
        EMPLOYEE_DOCUMENT_MIME_TYPES[
          extension as keyof typeof EMPLOYEE_DOCUMENT_MIME_TYPES
        ];
      if (!expectedMime || file.type !== expectedMime)
        return NextResponse.json(
          { error: "Only JPG, PNG, WEBP, and PDF documents are allowed." },
          { status: 400 },
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!hasValidFileSignature(bytes, expectedMime))
        return NextResponse.json(
          { error: `The selected ${file.name} file is not a valid ${expectedMime} document.` },
          { status: 400 },
        );
      uploadPlans.push({
        bytes,
        documentType: documentType as EmployeeFileDocument["documentType"],
        extension,
        mimeType: expectedMime,
      });
    }

    const documents: EmployeeFileDocument[] = [];
    for (const plan of uploadPlans) {
      const stored = await employeeDocumentStorage.uploadFile(plan.bytes, {
        mimeType: plan.mimeType,
        extension: plan.extension,
      });
      createdKeys.push(stored.key);
      const document = {
        _id: new ObjectId(),
        employeeId: employee._id,
        documentType: plan.documentType,
        storageKey: stored.key,
        mimeType: stored.mimeType,
        size: stored.size,
        uploadedBy: actor.id,
        uploadedAt: new Date(),
      } satisfies EmployeeFileDocument;
      documents.push(document);
      createdDocumentIds.push(document._id);
    }
    await db.collection<EmployeeFileDocument>("employeeFiles").insertMany(documents);
    return NextResponse.json({
      documents: documents.map((document) => ({
        id: document._id.toHexString(),
        documentType: document.documentType,
        mimeType: document.mimeType,
        size: document.size,
        uploadedAt: document.uploadedAt,
        url: employeeDocumentStorage.getFileUrl(document._id.toHexString()),
      })),
    });
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (createdDocumentIds.length) {
      try {
        await (await getDb())
          .collection<EmployeeFileDocument>("employeeFiles")
          .deleteMany({ _id: { $in: createdDocumentIds } });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    const cleanupResults = await Promise.allSettled(
      createdKeys.map((key) => employeeDocumentStorage.deleteFile(key)),
    );
    cleanupErrors.push(
      ...cleanupResults.flatMap((result) =>
        result.status === "rejected" ? [result.reason] : [],
      ),
    );
    return apiError(
      cleanupErrors.length
        ? new AggregateError(
            [error, ...cleanupErrors],
            "Employee document upload failed and cleanup was incomplete.",
          )
        : error,
    );
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
    if (actor.role === "OUTLET_USER" || !actor.permissions.includes("employees.update"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { id } = await context.params;
    const documentId = new URL(request.url).searchParams.get("documentId");
    if (!ObjectId.isValid(id) || !documentId || !ObjectId.isValid(documentId))
      return NextResponse.json({ error: "Invalid document request." }, { status: 400 });
    const db = await getDb();
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: new ObjectId(id) });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const document = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .findOne({ _id: new ObjectId(documentId), employeeId: employee._id });
    if (!document) throw new Error("NOT_FOUND");
    const deletion = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .deleteOne({ _id: document._id });
    if (deletion.deletedCount !== 1) throw new Error("NOT_FOUND");
    try {
      await employeeDocumentStorage.deleteFile(document.storageKey);
    } catch (error) {
      await db
        .collection<EmployeeFileDocument>("employeeFiles")
        .insertOne(document);
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function hasValidFileSignature(bytes: Uint8Array, mimeType: string) {
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  if (mimeType === "image/webp")
    return (
      bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  if (mimeType === "application/pdf")
    return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  return false;
}
