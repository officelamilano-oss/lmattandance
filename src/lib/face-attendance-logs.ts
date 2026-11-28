import { ObjectId, type Db } from "mongodb";
import type {
  EmployeeDocument,
  FaceAttendanceLogDocument,
  OutletDocument,
} from "@/lib/models";

export type FaceAttendanceAction = "CHECK_IN" | "CHECK_OUT";

const DEFAULT_MAX_OPEN_HOURS = 16;
const MAX_CONFIGURED_OPEN_HOURS = 168;
let faceAttendanceIndexes: Promise<void> | undefined;

export function getMaxOpenFaceLogHours() {
  const configured = process.env.FACE_ATTENDANCE_MAX_OPEN_HOURS;
  if (!configured) return DEFAULT_MAX_OPEN_HOURS;
  const hours = Number(configured);
  if (
    !Number.isFinite(hours) ||
    hours < 1 ||
    hours > MAX_CONFIGURED_OPEN_HOURS
  )
    throw new Error(
      `FACE_ATTENDANCE_MAX_OPEN_HOURS must be between 1 and ${MAX_CONFIGURED_OPEN_HOURS}.`,
    );
  return hours;
}

export async function ensureFaceAttendanceLogIndexes(db: Db) {
  if (!faceAttendanceIndexes) {
    const logs = db.collection<FaceAttendanceLogDocument>(
      "face_attendance_logs",
    );
    faceAttendanceIndexes = (async () => {
      const openLogs = await logs
        .find({
          clockIn: { $type: "date" },
          clockOut: { $exists: false },
        })
        .sort({ employeeId: 1, outletId: 1, clockIn: -1, _id: -1 })
        .toArray();
      const seenOpenShifts = new Set<string>();
      const now = new Date();
      for (const log of openLogs) {
        const key = `${log.employeeId.toHexString()}:${log.outletId.toHexString()}`;
        if (seenOpenShifts.has(key)) {
          await logs.updateOne(
            { _id: log._id, clockOut: { $exists: false } },
            {
              $set: {
                clockOut: null,
                isOpen: false,
                missingClockOut: true,
                notes: "Automatically flagged while preparing face log indexes.",
                updatedAt: now,
              },
            },
          );
        } else {
          seenOpenShifts.add(key);
          await logs.updateOne(
            { _id: log._id },
            { $set: { isOpen: true } },
          );
        }
      }

      await Promise.all([
        logs.createIndex({ clockIn: -1 }, { name: "face_log_clock_in_desc" }),
        logs.createIndex(
          { outletId: 1, clockIn: -1 },
          { name: "face_log_outlet_clock_in" },
        ),
        logs.createIndex(
          { employeeId: 1, clockIn: -1 },
          { name: "face_log_employee_clock_in" },
        ),
        logs.createIndex(
          { employeeId: 1, outletId: 1 },
          {
            name: "face_log_one_open_per_employee_outlet_v2",
            unique: true,
            partialFilterExpression: { isOpen: true },
          },
        ),
      ]);
    })()
      .then(() => undefined)
      .catch((error: unknown) => {
        faceAttendanceIndexes = undefined;
        throw error;
      });
  }
  await faceAttendanceIndexes;
}

export async function getOpenFaceAttendanceLog(
  db: Db,
  employeeId: ObjectId,
  outletId: ObjectId,
) {
  await ensureFaceAttendanceLogIndexes(db);
  return db
    .collection<FaceAttendanceLogDocument>("face_attendance_logs")
    .findOne(
      {
        employeeId,
        outletId,
        isOpen: true,
      },
      { sort: { clockIn: -1 } },
    );
}

export async function getFaceLogAction(
  db: Db,
  employee: EmployeeDocument,
  outletId: ObjectId,
  now: Date,
): Promise<FaceAttendanceAction> {
  const openLog = await getOpenFaceAttendanceLog(db, employee._id, outletId);
  const maxOpenMs = getMaxOpenFaceLogHours() * 60 * 60 * 1000;
  return openLog?.clockIn &&
    now.getTime() - openLog.clockIn.getTime() < maxOpenMs
    ? "CHECK_OUT"
    : "CHECK_IN";
}

export async function recordFaceAttendanceEvent(
  db: Db,
  employee: EmployeeDocument,
  outlet: Pick<OutletDocument, "_id" | "code" | "name">,
  action: FaceAttendanceAction,
  now = new Date(),
) {
  await ensureFaceAttendanceLogIndexes(db);
  const logs = db.collection<FaceAttendanceLogDocument>(
    "face_attendance_logs",
  );
  const openLog = await logs.findOne(
    {
      employeeId: employee._id,
      outletId: outlet._id,
      isOpen: true,
    },
    { sort: { clockIn: -1 } },
  );
  const maxOpenMs = getMaxOpenFaceLogHours() * 60 * 60 * 1000;

  if (action === "CHECK_OUT") {
    if (openLog) {
      const update = await logs.updateOne(
        { _id: openLog._id, isOpen: true },
        {
          $set: {
            clockOut: now,
            isOpen: false,
            updatedAt: now,
          },
        },
      );
      if (update.modifiedCount === 1) return { logId: openLog._id, action };
      throw new Error("Face attendance log changed while recording clock-out.");
    }

    const log: FaceAttendanceLogDocument = {
      _id: new ObjectId(),
      ...snapshot(employee, outlet),
      clockOut: now,
      source: "face",
      createdAt: now,
      updatedAt: now,
    };
    await logs.insertOne(log);
    return { logId: log._id, action };
  }

  if (openLog?.clockIn) {
    const duration = now.getTime() - openLog.clockIn.getTime();
    if (duration < maxOpenMs)
      return { logId: openLog._id, action: "CHECK_IN" as const, duplicate: true };
    const expired = await logs.updateOne(
      { _id: openLog._id, isOpen: true },
      {
        $set: {
          clockOut: null,
          isOpen: false,
          missingClockOut: true,
          notes: "Automatically flagged when a new clock-in was recorded.",
          updatedAt: now,
        },
      },
    );
    if (expired.modifiedCount !== 1)
      throw new Error("Previous face attendance log could not be closed.");
  }

  const log: FaceAttendanceLogDocument = {
    _id: new ObjectId(),
    ...snapshot(employee, outlet),
    clockIn: now,
    isOpen: true,
    source: "face",
    createdAt: now,
    updatedAt: now,
  };
  try {
    await logs.insertOne(log);
    return { logId: log._id, action };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const currentOpenLog = await logs.findOne(
      {
        employeeId: employee._id,
        outletId: outlet._id,
        isOpen: true,
      },
      { sort: { clockIn: -1 } },
    );
    if (!currentOpenLog) throw error;
    return {
      logId: currentOpenLog._id,
      action: "CHECK_IN" as const,
      duplicate: true,
    };
  }
}

function snapshot(
  employee: EmployeeDocument,
  outlet: Pick<OutletDocument, "_id" | "code" | "name">,
) {
  return {
    employeeId: employee._id,
    employeeCode: employee.employeeCode,
    employeeName: employee.fullName,
    outletId: outlet._id,
    outletCode: outlet.code,
    outletName: outlet.name,
    companyName: "La Milano",
    ...(employee.shiftDurationHours
      ? { shiftDurationHours: employee.shiftDurationHours }
      : {}),
  };
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

export function getIndiaDateRange(from: string, to: string) {
  const dayAfterTo = new Date(
    Date.parse(`${to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  return {
    start: new Date(`${from}T00:00:00.000+05:30`),
    endExclusive: new Date(`${dayAfterTo}T00:00:00.000+05:30`),
  };
}
