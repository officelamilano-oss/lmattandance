import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, readJson } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { getDb, getMongoClient } from "@/lib/mongodb";
import type {
  AttendancePunchDocument,
} from "@/lib/models";
import {
  getFaceEncryptionKey,
  isFaceDescriptor,
} from "@/lib/face-templates";
import { insertAttendanceEntryIfMissing } from "@/lib/attendance-system";
import { matchEmployeeFace } from "@/lib/match-employee-face";
import { getKioskAttendanceState } from "@/lib/kiosk-attendance-state";
import {
  getFaceLogAction,
  recordFaceAttendanceEvent,
} from "@/lib/face-attendance-logs";
import type { OutletDocument } from "@/lib/models";
import { getLocalClock } from "@/lib/attendance-shifts";
import { assertOutletAccess, getActor, hasPermission } from "@/lib/permissions";

const punchSchema = z.object({
  outletId: z.string().regex(/^[a-f\d]{24}$/i),
  employeeId: z.string().regex(/^[a-f\d]{24}$/i),
  descriptor: z.custom<number[]>(isFaceDescriptor),
});

const systemActorId = new ObjectId("ffffffffffffffffffffffff");

class PunchConflictError extends Error {}

export async function POST(request: Request) {
  try {
    const actor = await getActor();
    if (!actor)
      return NextResponse.json(
        { error: "Sign in to your workspace to use the attendance kiosk." },
        { status: 401 },
      );
    if (!hasPermission(actor, "attendance.write"))
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
    const input = punchSchema.parse(await readJson<unknown>(request));
    const outletId = new ObjectId(input.outletId);
    assertOutletAccess(actor, outletId);
    getFaceEncryptionKey();
    const db = await getDb();
    const employee = await matchEmployeeFace(db, outletId, input.descriptor);
    if (!employee)
      return NextResponse.json(
        { error: "Face not recognized. Please try again or contact your manager." },
        { status: 404 },
      );
    if (!employee._id.equals(input.employeeId))
      return NextResponse.json(
        { error: "The detected face does not match the selected employee." },
        { status: 409 },
      );
    const now = new Date();
    const outlet = await db
      .collection<OutletDocument>("outlets")
      .findOne({ _id: outletId, active: true });
    if (!outlet)
      return NextResponse.json(
        { error: "The kiosk outlet is unavailable." },
        { status: 404 },
      );
    if (!employee.shiftStartTime || !employee.shiftEndTime) {
      const action = await getFaceLogAction(
        db,
        employee,
        outletId,
        now,
      );
      await recordFaceAttendanceEvent(
        db,
        employee,
        outlet,
        action,
        now,
      );
      return NextResponse.json({
        ok: true,
        action: action === "CHECK_IN" ? "IN" : "OUT",
        attendanceMarked: false,
        employee: {
          name: employee.fullName,
          code: employee.employeeCode,
        },
        punchedAt: now.toISOString(),
        date: getLocalClock(now, "Asia/Kolkata").date,
      });
    }
    const state = await getKioskAttendanceState(
      db,
      employee,
      outletId,
      now,
    );
    if (state.action !== "CHECK_IN" && state.action !== "CHECK_OUT") {
      const logAction = await getFaceLogAction(
        db,
        employee,
        outletId,
        now,
      );
      await recordFaceAttendanceEvent(db, employee, outlet, logAction, now);
      return NextResponse.json({
        ok: true,
        action: logAction === "CHECK_IN" ? "IN" : "OUT",
        attendanceMarked: false,
        employee: {
          name: employee.fullName,
          code: employee.employeeCode,
        },
        punchedAt: now.toISOString(),
        date: getLocalClock(now, "Asia/Kolkata").date,
      });
    }
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
          { employeeId: employee._id, outletId, date },
          { session },
        );
        if (action === "CHECK_IN") {
          if (existing?.checkInAt)
            throw new PunchConflictError("You are already checked in.");
          const attendance = await insertAttendanceEntryIfMissing(db, {
            outletId,
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
                outletId,
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
            outletId,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
    try {
      await recordFaceAttendanceEvent(
        db,
        employee,
        outlet,
        action,
        now,
      );
    } catch (error) {
      console.error("Face attendance report log write failed", {
        employeeId: employee._id.toHexString(),
        outletId: outletId.toHexString(),
        message:
          error instanceof Error ? error.message : "Unknown log write error.",
      });
    }
    return NextResponse.json({
      ok: true,
      action: action === "CHECK_IN" ? "IN" : "OUT",
      attendanceMarked: true,
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
