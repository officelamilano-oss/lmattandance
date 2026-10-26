import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getActor, assertOutletAccess } from "@/lib/permissions";
import { getDb } from "@/lib/mongodb";
import { apiError } from "@/lib/http";
import type { EmployeeDocument, EmployeeFileDocument } from "@/lib/models";
import { employeeDocumentStorage } from "@/lib/employee-document-storage";

export async function GET(
  _request: Request,
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
    const bytes = await employeeDocumentStorage.readFile(document.storageKey);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": document.mimeType,
        "Content-Length": String(document.size),
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
