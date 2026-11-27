import { ObjectId, type Db } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { writeAudit } from "@/lib/audit";
import { insertAttendanceEntryIfMissing } from "@/lib/attendance-system";
import type { AttendanceStatus } from "@/lib/models";

const systemActorId = new ObjectId("ffffffffffffffffffffffff");

export async function ensureEmployeeAbsent(
  db: Db,
  input: {
    outletId: ObjectId;
    employeeId: ObjectId;
    date: string;
    now: Date;
  },
) {
  const day = await db
    .collection<{
      _id: ObjectId;
      entries: Array<{ employeeId: ObjectId; status: AttendanceStatus }>;
    }>("attendance")
    .findOne(
      { outletId: input.outletId, date: input.date },
      { projection: { _id: 1, entries: 1 } },
    );
  const existing = day?.entries.find((entry) =>
    entry.employeeId.equals(input.employeeId),
  );
  if (existing)
    return { marked: false, status: existing.status, dayId: day?._id };
  const session = (await getMongoClient()).startSession();
  let result:
    | Awaited<ReturnType<typeof insertAttendanceEntryIfMissing>>
    | undefined;
  try {
    await session.withTransaction(async () => {
      result = await insertAttendanceEntryIfMissing(db, {
        outletId: input.outletId,
        employeeId: input.employeeId,
        date: input.date,
        status: "A",
        actorId: systemActorId,
        now: input.now,
        session,
      });
      if (result.inserted)
        await writeAudit(
          {
            actorId: systemActorId,
            actorEmail: "attendance-system@invalid",
            action: "ATTENDANCE_AUTO_ABSENT",
            entityType: "attendance",
            entityId: result.dayId.toHexString(),
            outletId: input.outletId,
            reason: "No face check-in by shift start plus 30-minute grace period.",
          },
          session,
        );
    });
  } finally {
    await session.endSession();
  }
  if (!result) throw new Error("Automatic absence transaction did not complete.");
  return {
    marked: result.inserted,
    status: result.inserted ? "A" : result.existingStatus,
    dayId: result.dayId,
  };
}
