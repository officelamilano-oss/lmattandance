import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type {
  AttendancePunchDocument,
} from "@/lib/models";
import {
  getFaceEncryptionKey,
  isFaceDescriptor,
} from "@/lib/face-templates";
import { authorizeKioskDevice } from "@/lib/kiosk-auth";
import { insertAttendanceEntryIfMissing } from "@/lib/attendance-system";
import { matchEmployeeFace } from "@/lib/match-employee-face";
import { getKioskAttendanceState } from "@/lib/kiosk-attendance-state";

const punchSchema = z.object({
  descriptor: z.custom<number[]>(isFaceDescriptor),
});

const systemActorId = new ObjectId("ffffffffffffffffffffffff");

class PunchConflictError extends Error {}

export async function POST(request: Request) {
  try {
    const device = await authorizeKioskDevice(request);
    if (!device)
      return NextResponse.json(
        { error: "This kiosk is not authorized. Contact an administrator." },
        { status: 401 },
      );
    if (!process.env.KIOSK_ENCRYPTION_KEY)
      return NextResponse.json(
        { error: "Face matching is unavailable until KIOSK_ENCRYPTION_KEY is configured." },
        { status: 503 },
      );
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384)
      return NextResponse.json(
        { error: "Face descriptor request is too large." },
        { status: 413 },
      );
    const input = punchSchema.parse(await request.json());
    getFaceEncryptionKey();
    const db = await getDb();
    const employee = await matchEmployeeFace(
      db,
      device.outletId,
      input.descriptor,
    );
    if (!employee)
      return NextResponse.json(
        { error: "Face not recognized. Please try again or contact your manager." },
        { status: 404 },
      );
    const now = new Date();
    const state = await getKioskAttendanceState(
      db,
      employee,
      device.outletId,
      now,
    );
    if (state.action !== "CHECK_IN" && state.action !== "CHECK_OUT")
      return NextResponse.json(
        { error: state.message ?? "Attendance cannot be recorded at this time." },
        { status: 409 },
      );
    const action = state.action;
    const date = state.date;

    const client = await getMongoClient();
    const session = client.startSession();
    let punchId = new ObjectId();
    try {
      await session.withTransaction(async () => {
        const punches =
          db.collection<AttendancePunchDocument>("attendancePunches");
        const existing = await punches.findOne(
          { employeeId: employee._id, outletId: device.outletId, date },
          { session },
        );
        if (action === "CHECK_IN") {
          if (existing?.checkInAt)
            throw new PunchConflictError("You are already checked in.");
          const attendance = await insertAttendanceEntryIfMissing(db, {
            outletId: device.outletId,
            employeeId: employee._id,
            date,
            status: "P",
            actorId: systemActorId,
            now,
            session,
          });
          if (!attendance.inserted && attendance.existingStatus !== "P")
            throw new PunchConflictError(
              "Attendance is already marked. Please contact your manager.",
            );
          if (existing) {
            const updated = await punches.updateOne(
              { _id: existing._id, checkInAt: { $exists: false } },
              { $set: { checkInAt: now, updatedAt: now } },
              { session },
            );
            if (updated.modifiedCount !== 1)
              throw new PunchConflictError("You are already checked in.");
          } else {
            punchId = new ObjectId();
            await punches.insertOne(
              {
                _id: punchId,
                employeeId: employee._id,
                outletId: device.outletId,
                date,
                checkInAt: now,
                createdAt: now,
                updatedAt: now,
              },
              { session },
            );
          }
        } else {
          if (!existing?.checkInAt)
            throw new PunchConflictError(
              "Check in before recording a check-out.",
            );
          if (existing.checkOutAt)
            throw new PunchConflictError("You are already checked out.");
          punchId = existing._id;
          const updated = await punches.updateOne(
            { _id: existing._id, checkOutAt: { $exists: false } },
            { $set: { checkOutAt: now, updatedAt: now } },
            { session },
          );
          if (updated.modifiedCount !== 1)
            throw new PunchConflictError("You are already checked out.");
        }

        await writeAudit(
          {
            actorId: systemActorId,
            actorEmail: "attendance-kiosk@invalid",
            action:
              action === "CHECK_IN"
                ? "ATTENDANCE_PUNCHED_IN"
                : "ATTENDANCE_PUNCHED_OUT",
            entityType: "attendancePunch",
            entityId: punchId.toHexString(),
            outletId: device.outletId,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({
      ok: true,
      action: action === "CHECK_IN" ? "IN" : "OUT",
      employee: {
        name: employee.fullName,
        code: employee.employeeCode,
      },
      punchedAt: now.toISOString(),
      date,
    });
  } catch (error) {
    if (error instanceof PunchConflictError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    return apiError(error);
  }
}
