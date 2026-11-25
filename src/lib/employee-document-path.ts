import { randomUUID } from "node:crypto";
import path from "node:path";
import type { EmployeeDocumentType } from "@/lib/employee-documents-config";

export function buildEmployeeDocumentPath(input: {
  outletCode?: string;
  outletName: string;
  employeeName: string;
  employeeCode: string;
  fileName: string;
}) {
  const outlet =
    slug(input.outletCode ?? "") || slug(input.outletName) || "outlet";
  const employeeName = slug(input.employeeName) || "employee";
  const employee = `${employeeName}-${safeSegment(input.employeeCode)}`;
  const fileName = safeFileName(input.fileName);
  return `/employees/${outlet}/${employee}/${fileName}`;
}

export function createStoredEmployeeFileName(
  documentType: EmployeeDocumentType,
  originalName: string,
) {
  const extension = path.extname(originalName).toLowerCase();
  const baseName = slug(path.basename(originalName, extension)) || "document";
  const type = documentType.toLowerCase().replace(/_/g, "-");
  return `${type}-${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}${extension}`;
}

export function safeFileName(fileName: string) {
  const name = path.posix.basename(fileName.replace(/\\/g, "/"));
  const extension = path.posix.extname(name).toLowerCase();
  const baseName = slug(path.posix.basename(name, extension)) || "document";
  return `${baseName}${extension.replace(/[^a-z0-9.]/g, "")}`;
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeSegment(value: string) {
  const segment = value.trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!segment) throw new Error("Employee code cannot form a storage path.");
  return segment;
}
