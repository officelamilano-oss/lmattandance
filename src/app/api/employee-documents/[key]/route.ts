import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import type { EmployeeDocument, EmployeeFileDocument } from "@/lib/models";
import {
  getEmployeeFileId,
  getEmployeeFilePath,
  getEmployeeFileProvider,
  getStorageAdapter,
} from "@/lib/storage";
import { getStorageSignedUrlExpirySeconds } from "@/lib/storage/config";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string }> },
) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      );
    if (actor.role === "OUTLET_USER" || !actor.permissions.includes("employees.read"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const { key } = await context.params;
    const db = await getDb();
    if (!ObjectId.isValid(key))
      return NextResponse.json(
        { error: "Invalid employee document ID." },
        { status: 400 },
      );
    const document = await db
      .collection<EmployeeFileDocument>("employeeFiles")
      .findOne({ _id: new ObjectId(key) });
    if (!document) throw new Error("NOT_FOUND");
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: document.employeeId });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);
    const filePath = getEmployeeFilePath(document);
    const provider = getEmployeeFileProvider(document);
    const storage = await getStorageAdapter(provider);
    const mode = new URL(request.url).searchParams;
    if (mode.get("download") === "1" || mode.get("preview") === "1") {
      const fileType = document.fileType ?? document.mimeType;
      if (!fileType)
        throw new Error("Employee document has no file type metadata.");
      const fileIdentifier =
        provider === "imagekit" ? filePath : getEmployeeFileId(document);
      const bytes = await storage.download(fileIdentifier);
      const fileName =
        document.fileName ?? filePath.split("/").pop() ?? "document";
      const asciiFileName = fileName
        .replace(/[\r\n"]/g, "_")
        .replace(/[^\x20-\x7E]/g, "_");
      const disposition =
        mode.get("preview") === "1" ? "inline" : "attachment";
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": fileType,
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `${disposition}; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const expiresIn = getStorageSignedUrlExpirySeconds();
    const signedUrl = await storage.getSignedUrl(filePath, expiresIn);
    const absoluteSignedUrl = new URL(signedUrl, request.url).toString();
    if (mode.get("signed") === "1")
      return NextResponse.json(
        { url: absoluteSignedUrl, expiresIn },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    return NextResponse.redirect(absoluteSignedUrl, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
