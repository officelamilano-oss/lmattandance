import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError, assertSameOrigin } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import type {
  EmployeeDocument,
  EmployeeFileDocument,
  OutletDocument,
} from "@/lib/models";
import {
  EMPLOYEE_DOCUMENT_MIME_TYPES,
  EMPLOYEE_DOCUMENT_TYPES,
} from "@/lib/employee-documents-config";
import {
  buildEmployeeDocumentPath,
  createStoredEmployeeFileName,
} from "@/lib/employee-document-path";
import {
  getEmployeeFileId,
  getEmployeeFilePath,
  getEmployeeFileProvider,
  getStorageAdapter,
  type StorageProviderName,
} from "@/lib/storage";
import {
  getStorageMaxFileSizeBytes,
} from "@/lib/storage/config";

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
      .sort({ createdAt: -1, uploadedAt: -1 })
      .toArray();
    return NextResponse.json({ documents: documents.map(serializeDocument) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const createdFiles: Array<{ provider: StorageProviderName; fileId: string }> =
    [];
  const createdDocumentIds: ObjectId[] = [];
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (
      actor.role !== "OUTLET_USER" &&
      !actor.permissions.includes("employees.update")
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
    if (
      actor.role === "OUTLET_USER" &&
      (!employee.approvalStatus ||
        employee.approvalStatus !== "PENDING" ||
        !employee.createdBy.equals(actor.id))
    )
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    assertOutletAccess(actor, employee.outletId);
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: employee.outletId });
    if (!outlet) throw new Error("NOT_FOUND");

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
      mimeType: string;
      originalFileName: string;
      storedFileName: string;
    }> = [];
    const maxFileSizeBytes = getStorageMaxFileSizeBytes();
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
      if (file.size <= 0 || file.size > maxFileSizeBytes)
        return NextResponse.json(
          {
            error: `Each document must be between 1 byte and ${Math.floor(maxFileSizeBytes / (1024 * 1024))} MB.`,
          },
          { status: 400 },
        );
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const expectedMime =
        EMPLOYEE_DOCUMENT_MIME_TYPES[
          extension as keyof typeof EMPLOYEE_DOCUMENT_MIME_TYPES
        ];
      if (!expectedMime || file.type !== expectedMime)
        return NextResponse.json(
          {
            error:
              "Only JPG, JPEG, PNG, WEBP, PDF, and DOCX documents are allowed.",
          },
          { status: 400 },
        );
      if (
        (documentType === "PHOTO" || documentType === "SIGNATURE") &&
        !expectedMime.startsWith("image/")
      )
        return NextResponse.json(
          { error: `${documentType} documents must be image files.` },
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
        mimeType: expectedMime,
        originalFileName: file.name,
        storedFileName: createStoredEmployeeFileName(
          documentType as EmployeeFileDocument["documentType"],
          file.name,
        ),
      });
    }

    const storage = await getStorageAdapter();
    const documents: EmployeeFileDocument[] = [];
    for (const plan of uploadPlans) {
      const filePath = buildEmployeeDocumentPath({
        outletCode: outlet.code,
        outletName: outlet.name,
        employeeName: employee.fullName,
        employeeCode: employee.employeeCode,
        fileName: plan.storedFileName,
      });
      const stored = await storage.upload(plan.bytes, filePath, {
        fileName: plan.storedFileName,
        mimeType: plan.mimeType,
      });
      createdFiles.push({ provider: stored.provider, fileId: stored.fileId });
      const createdAt = new Date();
      const document = {
        _id: new ObjectId(),
        employeeId: employee._id,
        outletId: employee.outletId,
        provider: stored.provider,
        fileId: stored.fileId,
        filePath: stored.filePath,
        fileName: plan.originalFileName,
        fileType: plan.mimeType,
        documentType: plan.documentType,
        size: plan.bytes.byteLength,
        uploadedBy: actor.id,
        uploadedAt: createdAt,
        createdAt,
      } satisfies EmployeeFileDocument;
      documents.push(document);
      createdDocumentIds.push(document._id);
    }
    await db.collection<EmployeeFileDocument>("employeeFiles").insertMany(documents);
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_DOCUMENTS_UPLOADED",
      entityType: "employee",
      entityId: employee._id.toHexString(),
      entityLabel: `${employee.employeeCode} · ${employee.fullName}`,
      outletId: employee.outletId,
      changes: {
        documentsUploaded: { before: 0, after: documents.length },
        documentTypes: {
          before: "",
          after: [...new Set(documents.map((document) => document.documentType))].join(", "),
        },
      },
    });
    return NextResponse.json({
      documents: documents.map(serializeDocument),
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
      createdFiles.map(async ({ provider, fileId }) =>
        (await getStorageAdapter(provider)).delete(fileId),
      ),
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
      await (
        await getStorageAdapter(getEmployeeFileProvider(document))
      ).delete(getEmployeeFileId(document));
    } catch (error) {
      await db
        .collection<EmployeeFileDocument>("employeeFiles")
        .insertOne(document);
      throw error;
    }
    await writeAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: "EMPLOYEE_DOCUMENT_DELETED",
      entityType: "employee",
      entityId: employee._id.toHexString(),
      entityLabel: `${employee.employeeCode} · ${employee.fullName}`,
      outletId: employee.outletId,
      changes: {
        documentType: { before: document.documentType, after: "" },
      },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

function serializeDocument(document: EmployeeFileDocument) {
  const fileType = document.fileType ?? document.mimeType;
  if (!fileType) throw new Error("Employee document has no file type metadata.");
  const filePath = getEmployeeFilePath(document);
  return {
    id: document._id.toHexString(),
    documentType: document.documentType,
    fileName: document.fileName ?? filePath.split("/").pop() ?? "document",
    fileType,
    mimeType: fileType,
    size: document.size,
    uploadedAt: document.createdAt ?? document.uploadedAt ?? new Date(0),
  };
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
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return hasZipEntry(bytes, "[Content_Types].xml") &&
      hasZipEntry(bytes, "word/document.xml");
  return false;
}

function hasZipEntry(bytes: Uint8Array, expectedName: string) {
  for (let offset = 0; offset + 30 <= bytes.length; offset += 1) {
    if (
      bytes[offset] !== 0x50 ||
      bytes[offset + 1] !== 0x4b ||
      bytes[offset + 2] !== 0x03 ||
      bytes[offset + 3] !== 0x04
    )
      continue;
    const nameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.length || nameEnd + extraLength > bytes.length) continue;
    if (new TextDecoder().decode(bytes.slice(nameStart, nameEnd)) === expectedName)
      return true;
    offset = nameEnd + extraLength - 1;
  }
  return false;
}
