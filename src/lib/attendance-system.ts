import { ObjectId, type ClientSession, type Db } from "mongodb";
import type {
  AttendanceDayDocument,
  AttendanceStatus,
} from "@/lib/models";

export interface SystemAttendanceWrite {
  inserted: boolean;
  dayId: ObjectId;
  existingStatus?: AttendanceStatus;
}

export async function insertAttendanceEntryIfMissing(
  db: Db,
  input: {
    outletId: ObjectId;
    employeeId: ObjectId;
    date: string;
    status: AttendanceStatus;
    actorId: ObjectId;
    now: Date;
    session?: ClientSession;
  },
): Promise<SystemAttendanceWrite> {
  const collection = db.collection<AttendanceDayDocument>("attendance");
  const entry = {
    employeeId: input.employeeId,
    status: input.status,
    updatedAt: input.now,
    updatedBy: input.actorId,
    correctionCount: 0,
    submitted: false,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await collection.findOne(
      { outletId: input.outletId, date: input.date },
      { session: input.session },
    );
    if (existing) {
      const currentEntry = existing.entries.find((item) =>
        item.employeeId.equals(input.employeeId),
      );
      if (currentEntry)
        return {
          inserted: false,
          dayId: existing._id,
          existingStatus: currentEntry.status,
        };
      const result = await collection.updateOne(
        {
          _id: existing._id,
          "entries.employeeId": { $ne: input.employeeId },
        },
        {
          $push: { entries: entry },
          $set: { updatedAt: input.now, updatedBy: input.actorId },
        },
        { session: input.session },
      );
      if (result.modifiedCount === 1)
        return { inserted: true, dayId: existing._id };
      continue;
    }

    const newDay: AttendanceDayDocument = {
      _id: new ObjectId(),
      outletId: input.outletId,
      date: input.date,
      entries: [entry],
      status: "DRAFT",
      corrections: [],
      updatedAt: input.now,
      updatedBy: input.actorId,
    };
    try {
      await collection.insertOne(newDay, { session: input.session });
      return { inserted: true, dayId: newDay._id };
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== 11000
      )
        throw error;
    }
  }

  throw new Error("Attendance changed concurrently; retry the operation.");
}
