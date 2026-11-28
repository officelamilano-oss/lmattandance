import { ObjectId, type ClientSession } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuditLogDocument, EmployeeDocument } from "@/lib/models";

export async function writeAudit(
  input: Omit<AuditLogDocument, "_id" | "at">,
  session?: ClientSession,
) {
  const db = await getDb();
  await db
    .collection<AuditLogDocument>("auditLogs")
    .insertOne(
      { _id: new ObjectId(), ...input, at: new Date() },
      session ? { session } : {},
    );
}

export function idString(id: ObjectId | string) { return String(id); }

const employeeAuditFields = [
  "employeeCode",
  "fullName",
  "dateOfJoining",
  "dateOfBirth",
  "gender",
  "designation",
  "designationKey",
  "designationGroup",
  "employmentType",
  "shiftStartTime",
  "shiftEndTime",
  "mobile",
  "outletId",
  "monthlyBaseSalary",
  "salaryMethod",
  "pfEnabled",
  "employeePfPercent",
  "employerPfPercent",
  "esiEnabled",
  "esiPercent",
  "beneficiaryName",
  "bankName",
  "branchName",
  "accountNumber",
  "ifscCode",
  "panNumber",
  "aadhaarNumber",
  "drivingLicenceNumber",
  "approvalStatus",
  "active",
  "notes",
] as const;

const employeeAuditSensitiveFields = new Set<string>([
  "dateOfBirth",
  "mobile",
  "monthlyBaseSalary",
  "employeePfPercent",
  "employerPfPercent",
  "esiPercent",
  "beneficiaryName",
  "bankName",
  "branchName",
  "accountNumber",
  "ifscCode",
  "panNumber",
  "aadhaarNumber",
  "drivingLicenceNumber",
  "notes",
]);

function auditValue(value: unknown) {
  if (value instanceof ObjectId) return value.toHexString();
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  return String(value);
}

export function employeeAuditChanges(
  before:
    | (Partial<Omit<EmployeeDocument, "outletId">> & {
        outletId?: ObjectId | string;
      })
    | undefined,
  after: Partial<Omit<EmployeeDocument, "outletId">> & {
    outletId?: ObjectId | string;
  },
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of employeeAuditFields) {
    const previous = auditValue(before?.[field]);
    const next = auditValue(after[field]);
    if (previous === next) continue;

    if (employeeAuditSensitiveFields.has(field)) {
      changes[field] = {
        before: previous ? "Value hidden" : "",
        after: next ? (previous ? "Updated; value hidden" : "Value hidden") : "",
      };
      continue;
    }

    changes[field] = { before: previous, after: next };
  }
  return changes;
}