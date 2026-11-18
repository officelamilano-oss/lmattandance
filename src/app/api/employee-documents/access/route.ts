import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import type { EmployeeDocument, EmployeeFileDocument } from "@/lib/models";
import {
  getEmployeeFileId,
  getStorageAdapter,
} from "@/lib/storage";
import {
  verifySignedLocalStorageUrl,
} from "@/lib/storage/signed-local-url";

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const requestedProvider = url.searchParams.get("provider");
    const filePath = url.searchParams.get("path");
    const expires = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    if (
      requestedProvider !== "local" &&
      requestedProvider !== "mongodb"
    )
      return NextResponse.json(
        { error: "This private document link is invalid or has expired." },
        { status: 403 },
      );
    const provider = requestedProvider;
    if (
      !filePath ||
      !verifySignedLocalStorageUrl(
        provider,
        filePath,
        expires,
        signature,
        process.env.AUTH_SECRET ?? "",
      )
    )
      return NextResponse.json(
        { error: "This private document link is invalid or has expired." },
        { status: 403 },
      );

    const db = await getDb();
    const employeeFiles =
      db.collection<EmployeeFileDocument>("employeeFiles");
    const document =
      provider === "mongodb"
        ? await employeeFiles.findOne({
            $or: [
              { provider: "mongodb", filePath },
              { provider: { $exists: false }, storageKey: filePath },
            ],
          })
        : await employeeFiles.findOne({ provider, filePath });
    if (!document) throw new Error("NOT_FOUND");
    const employee = await db
      .collection<EmployeeDocument>("employees")
      .findOne({ _id: document.employeeId });
    if (!employee) throw new Error("NOT_FOUND");
    assertOutletAccess(actor, employee.outletId);

    const storage = await getStorageAdapter(provider);
    const bytes = await storage.download(getEmployeeFileId(document));
    const fileType = document.fileType ?? document.mimeType;
    if (!fileType)
      throw new Error("Employee document has no file type metadata.");
    const fileName =
      document.fileName ?? filePath.split("/").pop() ?? "document";
    const safeFileName = fileName.replace(/[\r\n"]/g, "_");
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": fileType,
        "Content-Length": String(document.size),
        "Content-Disposition": `inline; filename="${safeFileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
