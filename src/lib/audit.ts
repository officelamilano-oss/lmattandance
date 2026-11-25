import { ObjectId, type ClientSession } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type { AuditLogDocument } from "@/lib/models";

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